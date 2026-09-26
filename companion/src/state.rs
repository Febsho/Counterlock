//! Domain model for live match data.
//!
//! Every per-player metric is optional on purpose: providers differ in what they
//! expose, and a missing field must surface as `null` rather than a fabricated
//! zero. See `docs/DATA_SOURCES.md` for the per-provider availability matrix.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Coarse match phase, derived from elapsed game time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Hero selection / pre-horn.
    Draft,
    Early,
    Mid,
    Late,
}

impl Phase {
    /// Mirrors the thresholds the web UI uses (`app/page.tsx`): <11 early,
    /// <21 mid, otherwise late. Negative or zero elapsed time is still draft.
    pub fn from_game_seconds(seconds: i64) -> Self {
        match seconds {
            i64::MIN..=0 => Phase::Draft,
            1..=659 => Phase::Early,
            660..=1259 => Phase::Mid,
            _ => Phase::Late,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PlayerState {
    pub account_id: Option<u32>,
    pub hero_id: Option<u32>,
    pub team: Option<u8>,
    pub slot: Option<u8>,
    pub kills: Option<u32>,
    pub deaths: Option<u32>,
    pub assists: Option<u32>,
    /// Total gold net worth, not the unspent shop balance.
    pub net_worth: Option<u32>,
    /// Current unspent shop souls, read from the hero pawn currency array.
    #[serde(default)]
    pub unspent_souls: Option<u32>,
    /// String-token hashes for ability entities in shop item slots.
    /// Resolved to canonical item IDs by the desktop asset catalog.
    #[serde(default)]
    pub owned_item_class_tokens: Option<Vec<u32>>,
    /// Derived: `net_worth / active_game_minutes`. `None` whenever net worth is
    /// absent or no active time has elapsed yet.
    pub souls_per_minute: Option<f64>,
    /// Item ids in purchase order. `None` when the provider cannot read inventory.
    #[serde(default)]
    pub items: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchSnapshot {
    pub match_id: Option<u64>,
    /// Account id of the local player, when it could be resolved.
    pub account_id: Option<u32>,
    pub start_time: Option<i64>,
    pub duration_s: Option<i64>,
    /// Seconds the match has spent paused, when the provider reports it.
    pub paused_s: Option<i64>,
    pub paused: Option<bool>,
    pub match_mode_parsed: Option<String>,
    /// Active (unpaused) game time in seconds.
    pub game_time_s: Option<i64>,
    pub phase: Option<Phase>,
    pub players: Vec<PlayerState>,
    /// Identifier of the provider that produced this snapshot.
    pub source: String,
    /// Unix seconds at which the companion observed this snapshot.
    pub observed_at: i64,
}

impl MatchSnapshot {
    pub fn new(source: impl Into<String>) -> Self {
        Self {
            match_id: None,
            account_id: None,
            start_time: None,
            duration_s: None,
            paused_s: None,
            paused: None,
            match_mode_parsed: None,
            game_time_s: None,
            phase: None,
            players: Vec::new(),
            source: source.into(),
            observed_at: unix_now(),
        }
    }

    /// Active game seconds: elapsed time minus any reported paused time.
    ///
    /// Falls back to wall-clock since `start_time` when the provider gives no
    /// duration, which is how `matches/active` behaves early in a match.
    pub fn active_game_seconds(&self) -> Option<i64> {
        let elapsed = match (self.duration_s, self.start_time) {
            (Some(duration), _) => duration,
            (None, Some(start)) => unix_now().saturating_sub(start),
            (None, None) => return None,
        };
        Some((elapsed - self.paused_s.unwrap_or(0)).max(0))
    }

    /// Fills in `game_time_s`, `phase`, and each player's `souls_per_minute`.
    ///
    /// Call once after a provider populates the raw fields so every derived
    /// value is computed in exactly one place.
    pub fn finalize(mut self) -> Self {
        let active = self.active_game_seconds();
        self.game_time_s = active;
        self.phase = active.map(Phase::from_game_seconds);
        for player in &mut self.players {
            player.souls_per_minute = souls_per_minute(player.net_worth, active);
        }
        self
    }
}

/// Souls per minute, or `None` when net worth is unknown or no active minute
/// has elapsed. Guarding on `active_seconds <= 0` keeps the first seconds of a
/// match from producing a division blow-up or an absurd rate.
pub fn souls_per_minute(net_worth: Option<u32>, active_seconds: Option<i64>) -> Option<f64> {
    let net_worth = net_worth? as f64;
    let seconds = active_seconds?;
    if seconds <= 0 {
        return None;
    }
    let rate = net_worth / (seconds as f64 / 60.0);
    Some((rate * 100.0).round() / 100.0)
}

pub fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase_boundaries_match_the_web_ui() {
        assert_eq!(Phase::from_game_seconds(0), Phase::Draft);
        assert_eq!(Phase::from_game_seconds(-30), Phase::Draft);
        assert_eq!(Phase::from_game_seconds(1), Phase::Early);
        assert_eq!(Phase::from_game_seconds(659), Phase::Early);
        assert_eq!(Phase::from_game_seconds(660), Phase::Mid);
        assert_eq!(Phase::from_game_seconds(1259), Phase::Mid);
        assert_eq!(Phase::from_game_seconds(1260), Phase::Late);
    }

    #[test]
    fn souls_per_minute_divides_by_active_minutes() {
        // 12000 souls over 10 active minutes.
        assert_eq!(souls_per_minute(Some(12_000), Some(600)), Some(1200.0));
    }

    #[test]
    fn souls_per_minute_is_none_without_data() {
        assert_eq!(souls_per_minute(None, Some(600)), None);
        assert_eq!(souls_per_minute(Some(12_000), None), None);
    }

    #[test]
    fn souls_per_minute_guards_against_zero_and_negative_time() {
        assert_eq!(souls_per_minute(Some(12_000), Some(0)), None);
        assert_eq!(souls_per_minute(Some(12_000), Some(-5)), None);
    }

    #[test]
    fn active_seconds_subtracts_pauses() {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.duration_s = Some(600);
        snapshot.paused_s = Some(120);
        assert_eq!(snapshot.active_game_seconds(), Some(480));
    }

    #[test]
    fn active_seconds_never_goes_negative() {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.duration_s = Some(60);
        snapshot.paused_s = Some(120);
        assert_eq!(snapshot.active_game_seconds(), Some(0));
    }

    #[test]
    fn finalize_derives_phase_and_rates_for_every_player() {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.duration_s = Some(600);
        snapshot.players = vec![
            PlayerState {
                net_worth: Some(12_000),
                ..Default::default()
            },
            PlayerState {
                net_worth: None,
                ..Default::default()
            },
        ];
        let snapshot = snapshot.finalize();
        assert_eq!(snapshot.game_time_s, Some(600));
        // 600s is minute 10, which the UI still counts as early.
        assert_eq!(snapshot.phase, Some(Phase::Early));
        assert_eq!(snapshot.players[0].souls_per_minute, Some(1200.0));
        // Missing net worth stays null instead of becoming a fabricated 0.
        assert_eq!(snapshot.players[1].souls_per_minute, None);
    }
}
