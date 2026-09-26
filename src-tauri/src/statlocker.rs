//! Reliably notify Statlocker after a locally observed match has completed.
use crate::storage::{PendingStatlockerMatch, Storage};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const STATLOCKER_POPULATE_URL: &str = "https://statlocker.gg/api/match";

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

        match notify_one(&agent, pending) {
            Ok(()) => {
                if let Err(error) = app
                    .state::<Storage>()
                    .complete_statlocker_match(pending.match_id)
                {
                    tracing::warn!(%error, match_id = pending.match_id, "clearing Statlocker notification failed");
                } else {
                    tracing::info!(
                        match_id = pending.match_id,
                        "match notification sent to Statlocker"
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
                tracing::warn!(%error, match_id = pending.match_id, retry_at = next_attempt_at, "Statlocker notification failed");
            }
        }
    }
}
