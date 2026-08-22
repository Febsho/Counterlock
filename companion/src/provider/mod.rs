//! Telemetry providers.
//!
//! A provider turns some permitted data source into a [`MatchSnapshot`]. Each
//! one declares a [`Capabilities`] matrix so the UI can tell "the enemy has 0
//! souls" apart from "this source does not report souls" - the companion never
//! substitutes a zero for an unknown.

use crate::state::MatchSnapshot;
use anyhow::Result;
use serde::Serialize;

pub mod deadlock_api;

/// Which fields a provider can populate.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub struct Capabilities {
    pub match_id: bool,
    pub roster: bool,
    pub hero_ids: bool,
    pub teams: bool,
    pub game_time: bool,
    pub kills_deaths_assists: bool,
    pub net_worth: bool,
    pub items: bool,
    pub pause_state: bool,
}

impl Capabilities {
    /// Field names this provider cannot supply, for the `data unavailable`
    /// section of `/v1/capabilities`.
    pub fn unavailable_fields(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        for (available, name) in [
            (self.match_id, "match_id"),
            (self.roster, "roster"),
            (self.hero_ids, "hero_ids"),
            (self.teams, "teams"),
            (self.game_time, "game_time"),
            (self.kills_deaths_assists, "kills_deaths_assists"),
            (self.net_worth, "net_worth"),
            (self.items, "items"),
            (self.pause_state, "pause_state"),
        ] {
            if !available {
                missing.push(name);
            }
        }
        missing
    }
}

/// A source of live match data.
pub trait MatchDataProvider: Send {
    /// Stable identifier, surfaced as `source` on every snapshot.
    fn id(&self) -> &'static str;

    /// What this source can report.
    fn capabilities(&self) -> Capabilities;

    /// Fetches the current match, or `Ok(None)` when the player is not in one
    /// the source can see. Transport failures are `Err` so they can be logged
    /// and retried without being mistaken for "no match".
    fn fetch(&self, account_id: Option<u32>) -> Result<Option<MatchSnapshot>>;
}

/// Provider that reports nothing. Used when telemetry is disabled: the
/// companion still serves the UI and process lifecycle.
pub struct NullProvider;

impl MatchDataProvider for NullProvider {
    fn id(&self) -> &'static str {
        "none"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities::default()
    }

    fn fetch(&self, _account_id: Option<u32>) -> Result<Option<MatchSnapshot>> {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_provider_reports_no_match_and_no_capabilities() {
        let provider = NullProvider;
        assert_eq!(provider.id(), "none");
        assert!(provider.fetch(Some(1)).unwrap().is_none());
        assert_eq!(provider.capabilities().unavailable_fields().len(), 9);
    }

    #[test]
    fn unavailable_fields_lists_only_the_missing_ones() {
        let capabilities = Capabilities {
            roster: true,
            hero_ids: true,
            ..Default::default()
        };
        let missing = capabilities.unavailable_fields();
        assert!(!missing.contains(&"roster"));
        assert!(missing.contains(&"net_worth"));
        assert!(missing.contains(&"items"));
    }
}
