//! Attached game-state provider.
//!
//! The only source that can report per-player combat stats: it reads them out
//! of the running client, which already received them from the game server in
//! order to draw its own scoreboard. Everything it reports is data this client
//! was sent — an external reader cannot surface information the server withheld.
//!
//! It degrades rather than lies. When the process cannot be read (no
//! `CAP_SYS_PTRACE`, sandboxed unit, game not running) or the configured
//! offsets no longer fit the running build, it falls back to the public API
//! provider and reports that provider's narrower capabilities, so
//! `/v1/capabilities` always describes the source that actually produced the
//! last snapshot.

use super::{deadlock_api::DeadlockApiProvider, Capabilities, MatchDataProvider};
use crate::config::Config;
use crate::state::MatchSnapshot;
use anyhow::Result;
use std::sync::Mutex;

use crate::game::GameReader;

/// What the reader can supply once it is attached and the offsets fit.
///
/// Item class tokens are walked from the pawn ability list on the exact-build
/// profile and resolved to catalog item IDs by the desktop.
pub const ATTACHED_CAPABILITIES: Capabilities = Capabilities {
    match_id: true,
    roster: true,
    hero_ids: true,
    teams: true,
    game_time: true,
    kills_deaths_assists: true,
    net_worth: true,
    unspent_souls: true,
    items: true,
    pause_state: true,
};

pub struct AttachedProvider {
    config: Config,
    fallback: DeadlockApiProvider,
    fallback_allowed: bool,
    reader: Mutex<Option<GameReader>>,
    /// Capabilities of whichever source produced the most recent snapshot.
    active: Mutex<Capabilities>,
    /// Set once the reason for falling back has been logged, so a permanently
    /// unreadable process does not spam a line per poll.
    reported_fallback: Mutex<bool>,
}

impl AttachedProvider {
    pub fn new(config: Config) -> Self {
        Self::with_fallback(config, true)
    }

    /// Desktop mode never consults the public Watch-tab match list.
    // Used by the desktop shell, while the standalone companion uses `new`.
    #[allow(dead_code)]
    pub fn new_local_only(config: Config) -> Self {
        Self::with_fallback(config, false)
    }

    fn with_fallback(config: Config, fallback_allowed: bool) -> Self {
        let fallback = DeadlockApiProvider::new(config.deadlock_api_base.clone());
        let active = Mutex::new(if fallback_allowed {
            fallback.capabilities()
        } else {
            Capabilities::default()
        });
        Self {
            config,
            fallback,
            fallback_allowed,
            reader: Mutex::new(None),
            active,
            reported_fallback: Mutex::new(false),
        }
    }

    /// Logs a fallback reason once per attach attempt.
    fn report_fallback(&self, reason: &str) {
        let mut reported = self.reported_fallback.lock().unwrap();
        if !*reported {
            tracing::info!(reason, "attached reader unavailable");
            *reported = true;
        }
    }

    fn try_attached(&self, account_id: Option<u32>) -> Option<Result<Option<MatchSnapshot>>> {
        if !self.config.offsets.usable() {
            self.report_fallback(&format!(
                "offsets not configured: {}",
                self.config.offsets.missing_essentials().join(", ")
            ));
            return None;
        }

        let mut guard = self.reader.lock().unwrap();
        if guard.as_ref().is_some_and(|reader| !reader.alive()) {
            tracing::info!("game process exited, detaching");
            *guard = None;
        }
        if guard.is_none() {
            let mut detector = crate::platform::detector();
            let pid = detector.game_pid()?;
            match GameReader::attach(pid, &self.config.client_module, self.config.offsets.clone()) {
                Ok(reader) => {
                    *self.reported_fallback.lock().unwrap() = false;
                    *guard = Some(reader);
                }
                Err(error) => {
                    self.report_fallback(&error.to_string());
                    return None;
                }
            }
        }

        let reader = guard.as_mut()?;
        match reader.poll(account_id) {
            Ok(snapshot) => Some(Ok(snapshot)),
            Err(error) => {
                // A read failure mid-match means the offsets stopped fitting
                // (a patch landed) or the process died. Drop the reader so the
                // next poll re-attaches, and let the fallback answer this one.
                tracing::warn!(%error, "attached read failed, dropping the reader");
                *guard = None;
                *self.reported_fallback.lock().unwrap() = false;
                None
            }
        }
    }
}

impl MatchDataProvider for AttachedProvider {
    fn id(&self) -> &'static str {
        // Per-snapshot truth lives in `MatchSnapshot::source`, which names the
        // source that actually produced it.
        "attached"
    }

    fn capabilities(&self) -> Capabilities {
        *self.active.lock().unwrap()
    }

    fn fetch(&self, account_id: Option<u32>) -> Result<Option<MatchSnapshot>> {
        if let Some(result) = self.try_attached(account_id) {
            *self.active.lock().unwrap() =
                match result.as_ref().ok().and_then(|snapshot| snapshot.as_ref()) {
                    Some(snapshot) => Capabilities {
                        match_id: snapshot.match_id.is_some(),
                        pause_state: snapshot.paused.is_some(),
                        net_worth: snapshot
                            .players
                            .iter()
                            .any(|player| player.net_worth.is_some()),
                        unspent_souls: snapshot
                            .players
                            .iter()
                            .any(|player| player.unspent_souls.is_some()),
                        items: snapshot
                            .players
                            .iter()
                            .find(|player| player.account_id == snapshot.account_id)
                            .and_then(|player| player.owned_item_class_tokens.as_ref())
                            .is_some(),
                        kills_deaths_assists: snapshot
                            .players
                            .iter()
                            .any(|player| player.kills.is_some()),
                        ..ATTACHED_CAPABILITIES
                    },
                    None => Capabilities::default(),
                };
            return result;
        }
        if self.fallback_allowed {
            *self.active.lock().unwrap() = self.fallback.capabilities();
            self.fallback.fetch(account_id)
        } else {
            *self.active.lock().unwrap() = Capabilities::default();
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_out_reporting_only_what_the_fallback_can_do() {
        // Until the reader has actually attached, promising KDA would be a lie.
        let provider = AttachedProvider::new(Config::default());
        assert!(!provider.capabilities().kills_deaths_assists);
        assert!(!provider.capabilities().net_worth);
    }

    #[test]
    fn unconfigured_offsets_fall_back_instead_of_reading() {
        let provider = AttachedProvider::new(Config::default());
        assert!(provider.try_attached(None).is_none());
    }

    #[test]
    fn desktop_local_only_never_uses_the_public_provider() {
        let provider = AttachedProvider::new_local_only(Config::default());
        assert!(provider.fetch(None).unwrap().is_none());
        assert_eq!(provider.capabilities(), Capabilities::default());
    }

    #[test]
    fn the_attached_matrix_adds_combat_stats_the_public_api_cannot_supply() {
        let api = DeadlockApiProvider::new("http://127.0.0.1".to_string()).capabilities();
        let attached = ATTACHED_CAPABILITIES;
        assert!(!api.kills_deaths_assists && attached.kills_deaths_assists);
        assert!(!api.net_worth && attached.net_worth);
        assert!(!api.pause_state && attached.pause_state);
        assert!(!api.unspent_souls && attached.unspent_souls);
        assert!(!api.items && attached.items);
        assert!(attached.unavailable_fields().is_empty());
    }
}
