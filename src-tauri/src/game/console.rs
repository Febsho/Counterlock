//! Incremental console.log reader. Only game-state strings observed in a local
//! Deadlock log are recognized; IDs and hero selections are deliberately absent.
use crate::state::{MatchSnapshot, PlayerState};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::Duration;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ConsoleState {
    pub phase: Option<String>,
    pub in_match: Option<bool>,
    pub match_id: Option<u64>,
    pub lobby_id: Option<u64>,
}

/// A roster the user confirmed from a local scoreboard capture. Team numbers
/// are relative (own side = 0, opposing side = 1), not Valve's team IDs.
#[derive(Clone, Debug, Deserialize)]
pub struct LocalRoster {
    pub own_hero_id: u32,
    pub ally_hero_ids: Vec<u32>,
    pub enemy_hero_ids: Vec<u32>,
    #[serde(skip)]
    pub pid: Option<u32>,
    #[serde(skip)]
    pub match_id: Option<u64>,
}

impl LocalRoster {
    pub fn valid(&self) -> bool {
        let ids = std::iter::once(self.own_hero_id)
            .chain(self.ally_hero_ids.iter().copied())
            .chain(self.enemy_hero_ids.iter().copied())
            .collect::<Vec<_>>();
        self.own_hero_id != 0
            && self.ally_hero_ids.len() <= 5
            && (1..=6).contains(&self.enemy_hero_ids.len())
            && ids.iter().all(|id| *id != 0)
            && ids.iter().collect::<std::collections::HashSet<_>>().len() == ids.len()
    }

    pub fn applies_to(&self, pid: Option<u32>, match_id: Option<u64>) -> bool {
        self.pid == pid && (self.match_id.is_none() || self.match_id == match_id)
    }

    pub fn merge(&self, mut snapshot: MatchSnapshot) -> MatchSnapshot {
        let own_account = snapshot.account_id;
        snapshot.players = std::iter::once(PlayerState {
            account_id: own_account,
            hero_id: Some(self.own_hero_id),
            team: Some(0),
            ..Default::default()
        })
        .chain(
            self.ally_hero_ids
                .iter()
                .copied()
                .map(|hero_id| PlayerState {
                    hero_id: Some(hero_id),
                    team: Some(0),
                    ..Default::default()
                }),
        )
        .chain(
            self.enemy_hero_ids
                .iter()
                .copied()
                .map(|hero_id| PlayerState {
                    hero_id: Some(hero_id),
                    team: Some(1),
                    ..Default::default()
                }),
        )
        .collect();
        snapshot.source = "local-scoreboard".into();
        snapshot
    }
}

pub const CAPABILITIES: crate::provider::Capabilities = crate::provider::Capabilities {
    match_id: true,
    roster: false,
    hero_ids: false,
    teams: false,
    game_time: false,
    kills_deaths_assists: false,
    net_worth: false,
    unspent_souls: false,
    items: false,
    pause_state: false,
};

pub const SCOREBOARD_CAPABILITIES: crate::provider::Capabilities = crate::provider::Capabilities {
    match_id: true,
    roster: true,
    hero_ids: true,
    teams: true,
    ..CAPABILITIES
};

pub fn snapshot(state: &ConsoleState, account_id: Option<u32>) -> Option<MatchSnapshot> {
    if state.in_match != Some(true) {
        return None;
    }
    let mut match_state = MatchSnapshot::new("local-console");
    match_state.match_id = state.match_id;
    match_state.account_id = account_id;
    Some(match_state)
}

pub fn parse_line(line: &str) -> Option<ConsoleState> {
    if let Some(text) = line
        .split_once("ChangeGameState: ")
        .map(|(_, rest)| rest)
        .or_else(|| {
            line.split_once("OnGameStateChanged: ")
                .map(|(_, rest)| rest)
        })
    {
        let phase = text.split_whitespace().next()?.to_string();
        let in_match = match phase.as_str() {
            "HeroSelection" | "MatchIntro" | "WaitForMapToLoad" | "PreGameWait"
            | "GameInProgress" => Some(true),
            "PostGame" | "GameOver" | "WaitingForPlayersToJoin" => Some(false),
            _ => return None,
        };
        return Some(ConsoleState {
            phase: Some(phase),
            in_match,
            ..Default::default()
        });
    }
    if line.contains("[SteamNetSockets] Received Steam datagram ticket") {
        return number_after(line, "match_id=").map(|match_id| ConsoleState {
            match_id: Some(match_id),
            ..Default::default()
        });
    }
    if let Some((_, rest)) = line.split_once("Lobby ") {
        if let Some((lobby, rest)) = rest.split_once(" for Match ") {
            let lobby_id = lobby.parse().ok()?;
            let match_id = rest.split_whitespace().next()?.parse().ok()?;
            if rest.contains(" created") {
                return Some(ConsoleState {
                    in_match: Some(true),
                    match_id: Some(match_id),
                    lobby_id: Some(lobby_id),
                    ..Default::default()
                });
            }
            if rest.contains(" destroyed") {
                return Some(ConsoleState {
                    in_match: Some(false),
                    match_id: Some(match_id),
                    lobby_id: Some(lobby_id),
                    ..Default::default()
                });
            }
        }
    }
    if line.contains("Persisting reconnect info to disk:") {
        return number_after(line, "lobby_id:").map(|lobby_id| ConsoleState {
            lobby_id: Some(lobby_id),
            ..Default::default()
        });
    }
    None
}

fn number_after(line: &str, marker: &str) -> Option<u64> {
    let rest = line.split_once(marker)?.1.trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

impl ConsoleState {
    fn apply(&mut self, patch: ConsoleState) {
        if let Some(phase) = patch.phase {
            if phase == "WaitingForPlayersToJoin" || phase == "HeroSelection" {
                self.match_id = None;
                self.lobby_id = None;
            }
            self.phase = Some(phase);
        }
        if let Some(in_match) = patch.in_match {
            self.in_match = Some(in_match);
        }
        if let Some(match_id) = patch.match_id {
            self.match_id = Some(match_id);
        }
        if let Some(lobby_id) = patch.lobby_id {
            self.lobby_id = Some(lobby_id);
        }
        if self.in_match == Some(false) {
            self.match_id = None;
            self.lobby_id = None;
        }
    }
}

pub fn watch(path: PathBuf, mut on_change: impl FnMut(ConsoleState)) -> notify::Result<()> {
    let (sender, receiver) = channel();
    let mut watcher = notify::recommended_watcher(sender)?;
    let parent = path
        .parent()
        .ok_or_else(|| notify::Error::generic("console log has no parent"))?;
    watcher.watch(parent, RecursiveMode::NonRecursive)?;
    let mut offset = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let mut pending = String::new();
    let mut state = ConsoleState::default();
    loop {
        match receiver.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(_)) | Err(RecvTimeoutError::Timeout) => {}
            Ok(Err(error)) => {
                tracing::warn!(%error, "console watcher event failed");
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(notify::Error::generic("console watcher disconnected"))
            }
        }
        let Ok(mut file) = File::open(&path) else {
            offset = 0;
            pending.clear();
            continue;
        };
        let Ok(size) = file.metadata().map(|m| m.len()) else {
            continue;
        };
        if size < offset {
            offset = 0;
            pending.clear();
            state = ConsoleState::default();
            on_change(state.clone());
        }
        if file.seek(SeekFrom::Start(offset)).is_err() {
            continue;
        }
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() {
            continue;
        }
        offset += bytes.len() as u64;
        pending.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(newline) = pending.find('\n') {
            let line = pending[..newline].trim_end_matches('\r').to_owned();
            pending.drain(..=newline);
            if let Some(patch) = parse_line(&line) {
                state.apply(patch);
                on_change(state.clone());
            }
        }
        // Bound memory if an untrusted log writes an extremely long line.
        if pending.len() > 64 * 1024 {
            pending.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_observed_game_state_lines_are_parsed() {
        assert_eq!(
            parse_line("09/25 20:10:24 ChangeGameState: GameInProgress (7)")
                .unwrap()
                .in_match,
            Some(true)
        );
        assert_eq!(
            parse_line("09/25 21:01:36 OnGameStateChanged: PostGame (8)")
                .unwrap()
                .in_match,
            Some(false)
        );
        assert!(parse_line("[NetworkCodeGen] m_unMatchID").is_none());
        assert!(parse_line("ChangeGameState: Unrecognized").is_none());
        let id = parse_line("[SteamNetSockets] Received Steam datagram ticket for server steamid:90293418020473873 vport -1. match_id=107686836").unwrap();
        assert_eq!(id.match_id, Some(107686836));
        let mut state = parse_line("ChangeGameState: HeroSelection (3)").unwrap();
        state.apply(id);
        assert_eq!(state.phase.as_deref(), Some("HeroSelection"));
        assert_eq!(state.match_id, Some(107686836));
        state.apply(parse_line("ChangeGameState: HeroSelection (3)").unwrap());
        assert_eq!(state.match_id, None);
        assert_eq!(parse_line("Persisting reconnect info to disk: server_steam_id: 1 lobby_id: 174149489677151317 time_updated: 0").unwrap().lobby_id, Some(174149489677151317));
        let created =
            parse_line("09/25 20:17:28 Lobby 174149489677151317 for Match 107686836 created")
                .unwrap();
        assert_eq!(created.match_id, Some(107686836));
        assert_eq!(created.in_match, Some(true));
        assert_eq!(snapshot(&created, Some(42)).unwrap().account_id, Some(42));
        assert!(snapshot(&created, Some(42)).unwrap().players.is_empty());
        let destroyed =
            parse_line("09/25 21:01:38 Lobby 174149489677151317 for Match 107686836 destroyed")
                .unwrap();
        assert_eq!(destroyed.in_match, Some(false));
        assert!(snapshot(&destroyed, Some(42)).is_none());
        state.apply(created);
        assert_eq!(state.match_id, Some(107686836));
        state.apply(destroyed);
        assert_eq!(state.match_id, None);
    }

    #[test]
    fn confirmed_local_roster_preserves_unknown_combat_and_inventory() {
        let roster = LocalRoster {
            own_hero_id: 10,
            ally_hero_ids: vec![11],
            enemy_hero_ids: vec![20],
            pid: Some(7),
            match_id: Some(42),
        };
        assert!(roster.valid());
        assert!(roster.applies_to(Some(7), Some(42)));
        assert!(!roster.applies_to(Some(8), Some(42)));
        let mut match_state = MatchSnapshot::new("local-console");
        match_state.account_id = Some(123);
        let merged = roster.merge(match_state);
        assert_eq!(merged.source, "local-scoreboard");
        assert_eq!(merged.players.len(), 3);
        assert_eq!(merged.players[0].account_id, Some(123));
        assert_eq!(merged.players[2].team, Some(1));
        assert_eq!(merged.players[0].net_worth, None);
        assert_eq!(merged.players[0].items, None);
    }
}
