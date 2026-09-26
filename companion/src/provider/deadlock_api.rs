//! Deadlock API provider (`GET /v1/matches/active`).
//!
//! This is the community API the web app already uses. It is a documented,
//! public endpoint: no game files, no process memory, no reverse-engineered
//! offsets. Its live feed is limited to what Deadlock's own spectator/Watch tab
//! publishes, so per-player combat stats are frequently absent - those fields
//! stay `null` and the capability matrix says so.

use super::{Capabilities, MatchDataProvider};
use crate::state::{MatchSnapshot, PlayerState};
use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::time::Duration;

pub struct DeadlockApiProvider {
    base_url: String,
    agent: ureq::Agent,
}

impl DeadlockApiProvider {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            agent: ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(5))
                .timeout_read(Duration::from_secs(8))
                .user_agent(concat!("counterlock-companion/", env!("CARGO_PKG_VERSION")))
                .build(),
        }
    }
}

/// Wire format. Every stat field is optional because the upstream feed omits
/// most of them for live matches; `#[serde(default)]` keeps a missing field
/// from failing the whole parse.
#[derive(Debug, Deserialize)]
struct WirePlayer {
    #[serde(default)]
    account_id: Option<u32>,
    #[serde(default)]
    hero_id: Option<u32>,
    #[serde(default)]
    team: Option<u8>,
    #[serde(default)]
    player_slot: Option<u8>,
    #[serde(default)]
    kills: Option<u32>,
    #[serde(default)]
    deaths: Option<u32>,
    #[serde(default)]
    assists: Option<u32>,
    #[serde(default, alias = "networth")]
    net_worth: Option<u32>,
    #[serde(default)]
    items: Option<Vec<u32>>,
}

#[derive(Debug, Deserialize)]
struct WireMatch {
    #[serde(default)]
    match_id: Option<u64>,
    #[serde(default)]
    start_time: Option<i64>,
    #[serde(default)]
    duration_s: Option<i64>,
    #[serde(default)]
    match_mode_parsed: Option<String>,
    #[serde(default)]
    players: Vec<WirePlayer>,
}

impl From<WirePlayer> for PlayerState {
    fn from(wire: WirePlayer) -> Self {
        PlayerState {
            account_id: wire.account_id,
            hero_id: wire.hero_id,
            team: wire.team,
            slot: wire.player_slot,
            kills: wire.kills,
            deaths: wire.deaths,
            assists: wire.assists,
            net_worth: wire.net_worth,
            unspent_souls: None,
            owned_item_class_tokens: None,
            // Derived later by MatchSnapshot::finalize.
            souls_per_minute: None,
            items: wire.items,
        }
    }
}

impl MatchDataProvider for DeadlockApiProvider {
    fn id(&self) -> &'static str {
        "deadlock-api"
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            match_id: true,
            roster: true,
            hero_ids: true,
            teams: true,
            game_time: true,
            // Present only for matches the spectator feed fully publishes.
            kills_deaths_assists: false,
            net_worth: false,
            unspent_souls: false,
            items: false,
            // The live feed exposes no pause state.
            pause_state: false,
        }
    }

    fn fetch(&self, account_id: Option<u32>) -> Result<Option<MatchSnapshot>> {
        let account_id = account_id
            .ok_or_else(|| anyhow!("no Steam account id resolved; set account_id in the config"))?;
        let url = format!("{}/matches/active?account_ids={account_id}", self.base_url);

        let response = self
            .agent
            .get(&url)
            .call()
            .with_context(|| format!("requesting {url}"))?;
        let matches: Vec<WireMatch> = response
            .into_json()
            .context("decoding the active-match response")?;

        let Some(wire) = matches
            .into_iter()
            .find(|m| m.players.iter().any(|p| p.account_id == Some(account_id)))
        else {
            return Ok(None);
        };

        let mut snapshot = MatchSnapshot::new(self.id());
        snapshot.match_id = wire.match_id;
        snapshot.account_id = Some(account_id);
        snapshot.start_time = wire.start_time;
        snapshot.duration_s = wire.duration_s;
        snapshot.match_mode_parsed = wire.match_mode_parsed;
        snapshot.players = wire.players.into_iter().map(PlayerState::from).collect();
        Ok(Some(snapshot.finalize()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Phase;

    fn parse(json: &str) -> Vec<WireMatch> {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn parses_a_minimal_live_match_without_stats() {
        let matches = parse(
            r#"[{"match_id":123,"start_time":1000,"duration_s":600,
                 "match_mode_parsed":"Ranked",
                 "players":[{"account_id":42,"hero_id":7,"team":0},
                            {"account_id":43,"hero_id":9,"team":1}]}]"#,
        );
        let wire = matches.into_iter().next().unwrap();
        let mut snapshot = MatchSnapshot::new("deadlock-api");
        snapshot.match_id = wire.match_id;
        snapshot.duration_s = wire.duration_s;
        snapshot.players = wire.players.into_iter().map(PlayerState::from).collect();
        let snapshot = snapshot.finalize();

        assert_eq!(snapshot.match_id, Some(123));
        assert_eq!(snapshot.phase, Some(Phase::Early));
        assert_eq!(snapshot.players.len(), 2);
        // Absent stats must stay null, not become zero.
        assert_eq!(snapshot.players[0].kills, None);
        assert_eq!(snapshot.players[0].net_worth, None);
        assert_eq!(snapshot.players[0].souls_per_minute, None);
        assert!(snapshot.players[0].items.is_none());
    }

    #[test]
    fn uses_stats_when_the_feed_does_supply_them() {
        let matches = parse(
            r#"[{"match_id":9,"duration_s":600,
                 "players":[{"account_id":42,"hero_id":7,"team":0,"kills":5,"deaths":1,
                             "assists":3,"net_worth":12000,"items":[101,102]}]}]"#,
        );
        let wire = matches.into_iter().next().unwrap();
        let mut snapshot = MatchSnapshot::new("deadlock-api");
        snapshot.duration_s = wire.duration_s;
        snapshot.players = wire.players.into_iter().map(PlayerState::from).collect();
        let snapshot = snapshot.finalize();

        let player = &snapshot.players[0];
        assert_eq!(player.kills, Some(5));
        assert_eq!(player.net_worth, Some(12_000));
        assert_eq!(player.souls_per_minute, Some(1200.0));
        assert_eq!(player.items, Some(vec![101, 102]));
    }

    #[test]
    fn accepts_the_networth_spelling_variant() {
        let matches = parse(r#"[{"players":[{"account_id":1,"networth":500}]}]"#);
        let player: PlayerState = matches
            .into_iter()
            .next()
            .unwrap()
            .players
            .pop()
            .unwrap()
            .into();
        assert_eq!(player.net_worth, Some(500));
    }

    #[test]
    fn unknown_upstream_fields_do_not_break_parsing() {
        let matches = parse(
            r#"[{"match_id":1,"some_new_field":true,
                 "players":[{"account_id":1,"another_new_field":"x"}]}]"#,
        );
        assert_eq!(matches[0].match_id, Some(1));
    }

    #[test]
    fn an_empty_feed_means_no_match_rather_than_an_error() {
        assert!(parse("[]").is_empty());
    }

    #[test]
    fn fetch_without_an_account_id_is_an_error() {
        let provider = DeadlockApiProvider::new("https://example.invalid/v1");
        assert!(provider.fetch(None).is_err());
    }

    #[test]
    fn capabilities_admit_what_the_feed_cannot_supply() {
        let provider = DeadlockApiProvider::new("https://example.invalid/v1");
        let missing = provider.capabilities().unavailable_fields();
        assert!(missing.contains(&"net_worth"));
        assert!(missing.contains(&"items"));
        assert!(missing.contains(&"kills_deaths_assists"));
        assert!(missing.contains(&"pause_state"));
    }
}
