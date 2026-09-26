//! Submit locally observed match replay salts, then notify Statlocker.
use crate::storage::{PendingStatlockerMatch, Storage};
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const STATLOCKER_POPULATE_URL: &str = "https://statlocker.gg/api/match";
const DEADLOCK_SALTS_URL: &str = "https://api.deadlock-api.com/v1/matches/salts";
const DEADLOCK_APP_ID: &str = "1422450";
const CACHE_HEADER_BYTES: usize = 512;
const URL_END_MARKERS: &[u8] = b" '\0\n\r\"";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct MatchSalts {
    match_id: u64,
    cluster_id: Option<u32>,
    metadata_salt: Option<u32>,
    replay_salt: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
}

impl MatchSalts {
    fn from_replay_url(url: &str, account_id: Option<u32>) -> Option<Self> {
        let base_url = url.split_once('?').map_or(url, |(base, _)| base);
        let (host, path) = base_url.strip_prefix("http://")?.split_once('/')?;
        let cluster_id = host
            .strip_prefix("replay")?
            .strip_suffix(".valve.net")?
            .parse()
            .ok()?;
        let mut path_parts = path.split('/');
        if path_parts.next()? != DEADLOCK_APP_ID {
            return None;
        }
        let filename = path_parts.next()?;
        if path_parts.next().is_some() {
            return None;
        }
        let (name, metadata_salt, replay_salt) =
            if let Some(name) = filename.strip_suffix(".meta.bz2") {
                (name, true, false)
            } else if let Some(name) = filename.strip_suffix(".dem.bz2") {
                (name, false, true)
            } else {
                return None;
            };
        let (match_id, salt) = name.split_once('_')?;
        let match_id: u64 = match_id.parse().ok()?;
        if match_id == 0 || match_id > 10_000_000_000 {
            return None;
        }
        let salt = salt.parse().ok()?;
        Some(Self {
            match_id,
            cluster_id: Some(cluster_id),
            metadata_salt: metadata_salt.then_some(salt),
            replay_salt: replay_salt.then_some(salt),
            username: account_id.map(|id| format!("ingest-tool:{id}")),
        })
    }
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn populate_url(match_id: u64, account_id: Option<u32>) -> String {
    let base = format!("{STATLOCKER_POPULATE_URL}/{match_id}/populate");
    match account_id {
        Some(account_id) => format!("{base}?username=ingest-tool:{account_id}"),
        None => base,
    }
}

fn retry_delay(attempts: u32) -> i64 {
    15_i64.saturating_mul(1_i64 << attempts.min(6)).min(900)
}

fn notify_one(agent: &ureq::Agent, pending: PendingStatlockerMatch) -> Result<(), String> {
    let url = populate_url(pending.match_id, pending.account_id);
    match agent.get(&url).call() {
        Ok(response) if (200..300).contains(&response.status()) => Ok(()),
        Ok(response) => Err(format!("Statlocker returned HTTP {}", response.status())),
        Err(ureq::Error::Status(status, _)) => Err(format!("Statlocker returned HTTP {status}")),
        Err(error) => Err(error.to_string()),
    }
}

fn extract_replay_url(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut bytes = vec![0; CACHE_HEADER_BYTES];
    let count = file.read(&mut bytes).ok()?;
    bytes.truncate(count);
    let marker = b".valve.net";
    for (index, _) in bytes
        .windows(marker.len())
        .enumerate()
        .filter(|(_, w)| *w == marker)
    {
        let host_start = (0..index)
            .rev()
            .find(|position| !bytes[*position].is_ascii_alphanumeric() && bytes[*position] != b'.')
            .map_or(0, |position| position + 1);
        let host_end = index + marker.len();
        let host = std::str::from_utf8(&bytes[host_start..host_end]).ok()?;
        if !host.starts_with("replay") {
            continue;
        }
        let path_start = host_end + bytes[host_end..].iter().position(|byte| *byte == b'/')?;
        let path_bytes = &bytes[path_start..];
        let path_end = path_bytes
            .iter()
            .position(|byte| URL_END_MARKERS.contains(byte))?;
        let path = std::str::from_utf8(&path_bytes[..path_end]).ok()?;
        if !path.starts_with(&format!("/{DEADLOCK_APP_ID}/")) {
            continue;
        }
        return Some(format!("http://{host}{path}"));
    }
    None
}

fn collect_match_salts(root: &Path, match_id: u64, account_id: Option<u32>) -> Vec<MatchSalts> {
    fn visit(path: &Path, match_id: u64, account_id: Option<u32>, found: &mut Vec<MatchSalts>) {
        let Ok(entries) = std::fs::read_dir(path) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(&path, match_id, account_id, found);
            } else if path.is_file() {
                let Some(url) = extract_replay_url(&path) else {
                    continue;
                };
                if let Some(salts) = MatchSalts::from_replay_url(&url, account_id) {
                    if salts.match_id == match_id
                        && !found.iter().any(|known| {
                            known.metadata_salt == salts.metadata_salt
                                && known.replay_salt == salts.replay_salt
                        })
                    {
                        found.push(salts);
                    }
                }
            }
        }
    }

    let mut found = Vec::new();
    visit(root, match_id, account_id, &mut found);
    found
}

fn steam_cache_dirs() -> Vec<PathBuf> {
    crate::steam::steam_roots()
        .into_iter()
        .map(|root| root.join("appcache/httpcache"))
        .filter(|path| path.is_dir())
        .collect()
}

fn ingest_match_salts(agent: &ureq::Agent, pending: PendingStatlockerMatch) -> Result<(), String> {
    let salts = steam_cache_dirs()
        .into_iter()
        .flat_map(|root| collect_match_salts(&root, pending.match_id, pending.account_id))
        .collect::<Vec<_>>();
    if salts.is_empty() {
        return Err(format!(
            "Steam replay cache has no metadata or replay salt for match {} yet",
            pending.match_id
        ));
    }
    match agent.post(DEADLOCK_SALTS_URL).send_json(&salts) {
        Ok(response) if (200..300).contains(&response.status()) => Ok(()),
        Ok(response) => Err(format!(
            "Deadlock API salt ingest returned HTTP {}",
            response.status()
        )),
        Err(ureq::Error::Status(status, _)) => {
            Err(format!("Deadlock API salt ingest returned HTTP {status}"))
        }
        Err(error) => Err(format!("Deadlock API salt ingest failed: {error}")),
    }
}

fn upload_match(agent: &ureq::Agent, pending: PendingStatlockerMatch) -> Result<(), String> {
    ingest_match_salts(agent, pending)?;
    notify_one(agent, pending)
}

pub fn run(app: AppHandle, wake: mpsc::Receiver<()>) {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .build();
    loop {
        let pending = match app.state::<Storage>().next_statlocker_match(unix_now()) {
            Ok(pending) => pending,
            Err(error) => {
                tracing::warn!(%error, "reading Statlocker notification queue failed");
                None
            }
        };
        let Some(pending) = pending else {
            match wake.recv_timeout(Duration::from_secs(20)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        };

        match upload_match(&agent, pending) {
            Ok(()) => {
                if let Err(error) = app
                    .state::<Storage>()
                    .complete_statlocker_match(pending.match_id)
                {
                    tracing::warn!(%error, match_id = pending.match_id, "clearing Statlocker notification failed");
                } else {
                    tracing::info!(
                        match_id = pending.match_id,
                        "match replay salts submitted and Statlocker notified"
                    );
                }
            }
            Err(error) => {
                let next_attempt_at = unix_now() + retry_delay(pending.attempts);
                if let Err(storage_error) = app.state::<Storage>().retry_statlocker_match(
                    pending.match_id,
                    next_attempt_at,
                    &error,
                ) {
                    tracing::warn!(%storage_error, match_id = pending.match_id, "scheduling Statlocker notification retry failed");
                }
                tracing::warn!(%error, match_id = pending.match_id, retry_at = next_attempt_at, "match ingestion retry scheduled");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_metadata_and_replay_salts_for_deadlock_only() {
        let metadata = MatchSalts::from_replay_url(
            "http://replay404.valve.net/1422450/37959196_937530290.meta.bz2",
            Some(123),
        )
        .unwrap();
        assert_eq!(metadata.match_id, 37_959_196);
        assert_eq!(metadata.cluster_id, Some(404));
        assert_eq!(metadata.metadata_salt, Some(937_530_290));
        assert_eq!(metadata.replay_salt, None);
        assert_eq!(metadata.username.as_deref(), Some("ingest-tool:123"));

        let replay = MatchSalts::from_replay_url(
            "http://replay183.valve.net/1422450/42476710_428480166.dem.bz2?v=2",
            None,
        )
        .unwrap();
        assert_eq!(replay.match_id, 42_476_710);
        assert_eq!(replay.metadata_salt, None);
        assert_eq!(replay.replay_salt, Some(428_480_166));
        assert!(replay.username.is_none());
        assert!(MatchSalts::from_replay_url(
            "http://replay183.valve.net/123/42476710_428480166.dem.bz2",
            None
        )
        .is_none());
    }

    #[test]
    fn extracts_replay_url_from_steam_cache_header() {
        let dir =
            std::env::temp_dir().join(format!("counterlock-cache-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("cache-entry");
        std::fs::write(
            &file,
            b"\0http://replay404.valve.net/1422450/37959196_937530290.meta.bz2\0more",
        )
        .unwrap();
        assert_eq!(
            extract_replay_url(&file).as_deref(),
            Some("http://replay404.valve.net/1422450/37959196_937530290.meta.bz2")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
