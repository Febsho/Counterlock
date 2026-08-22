//! Attached game-state reader.
//!
//! Follows the client's entity list and game-rules object and copies out the
//! same scoreboard values the local HUD already draws. It is strictly
//! read-only: no writes, no injection, no hooks. An external reader can only
//! observe what the server already replicated to this client.

pub mod entity;
pub mod mem;

use crate::config::Offsets;
use crate::state::{MatchSnapshot, PlayerState};
use anyhow::{anyhow, bail, Result};
use entity::EntityList;
use mem::ProcessMemory;

pub const SOURCE: &str = "attached";

/// Phases in which the full 12-player roster is already replicated but the
/// match has not started. Reading here is what makes a draft-time roster
/// possible at all.
pub const PREGAME_STATES: &[&str] = &["HeroSelection", "MatchIntro", "PreGameWait"];
pub const LIVE_STATE: &str = "GameInProgress";

pub struct GameReader {
    mem: ProcessMemory,
    client_base: u64,
    offsets: Offsets,
    /// Wall-clock fallback for the match clock, used only when the engine
    /// clock offsets are not configured.
    first_seen_live: Option<i64>,
}

impl GameReader {
    /// Opens the process and resolves the client module base.
    pub fn attach(pid: u32, client_module: &str, offsets: Offsets) -> Result<Self> {
        let modules = mem::read_modules(pid)?;
        let client = modules
            .get(&client_module.to_ascii_lowercase())
            .ok_or_else(|| anyhow!("{client_module} is not mapped yet"))?;
        let client_base = client.base;
        let size = client.size();
        let mem = ProcessMemory::open(pid)?;
        tracing::info!(
            pid,
            module = client_module,
            base = format_args!("{client_base:#x}"),
            size,
            "attached to the game process (read-only)"
        );
        Ok(Self {
            mem,
            client_base,
            offsets,
            first_seen_live: None,
        })
    }

    pub fn alive(&self) -> bool {
        self.mem.alive()
    }

    /// Reads one snapshot, or `Ok(None)` when the client is not in a match this
    /// reader can see (menus, post-game, unknown phase).
    pub fn poll(&mut self, account_id: Option<u32>) -> Result<Option<MatchSnapshot>> {
        if !self.mem.alive() {
            bail!("game process {} exited", self.mem.pid());
        }

        let rules = self.rules_object()?;
        let state_value = match self.offsets.rules.game_state {
            Some(offset) => self.mem.read_u32(rules + offset)?,
            None => bail!("offsets.rules.game_state is not configured"),
        };
        let phase_name = self
            .offsets
            .states
            .get(state_value as usize)
            .map(String::as_str)
            .unwrap_or("Unknown");

        let live = phase_name == LIVE_STATE;
        let pregame = PREGAME_STATES.contains(&phase_name);
        if !live && !pregame {
            self.first_seen_live = None;
            return Ok(None);
        }

        let mut snapshot = MatchSnapshot::new(SOURCE);
        snapshot.account_id = account_id;
        snapshot.match_id = self
            .offsets
            .rules
            .match_id
            .and_then(|offset| self.mem.read_u64(rules + offset).ok())
            .filter(|id| *id > 0);
        snapshot.paused = self
            .offsets
            .rules
            .paused
            .and_then(|offset| self.mem.read_u8(rules + offset).ok())
            .map(|value| value != 0);

        // Before the horn there is no match clock, and reporting one would push
        // the snapshot out of the draft phase the UI keys off.
        snapshot.duration_s = if live { self.elapsed(rules) } else { Some(0) };

        snapshot.players = self.roster();

        if live && snapshot.players.is_empty() {
            // A live match with no readable controllers means the player
            // offsets no longer match this build. Reporting an empty roster
            // would look like an empty lobby, so fail loudly instead.
            bail!(
                "live match but no player controllers were readable; \
                 the offsets likely need updating for this game build"
            );
        }

        Ok(Some(snapshot.finalize()))
    }

    fn rules_object(&self) -> Result<u64> {
        let offset = self
            .offsets
            .client
            .game_rules
            .ok_or_else(|| anyhow!("offsets.client.game_rules is not configured"))?;
        let address = self.client_base + offset;
        match self.mem.read_ptr(address) {
            Ok(Some(pointer)) => Ok(pointer),
            Ok(None) => Err(anyhow!("game rules pointer at {address:#x} was null")),
            Err(error) => {
                // Logged with the address so a patched-out offset is
                // diagnosable from the log alone.
                tracing::warn!(
                    address = format_args!("{address:#x}"),
                    %error,
                    "direct pointer read failed"
                );
                Err(error)
            }
        }
    }

    fn roster(&self) -> Vec<PlayerState> {
        let Some(offset) = self.offsets.client.entity_system else {
            return Vec::new();
        };
        let Ok(Some(system)) = self.mem.read_ptr(self.client_base + offset) else {
            tracing::warn!(
                address = format_args!("{:#x}", self.client_base + offset),
                "entity system pointer was unreadable"
            );
            return Vec::new();
        };
        let list = EntityList::new(&self.mem, system, &self.offsets.entity);
        entity::collect_players(
            &list,
            &self.mem,
            &self.offsets.player,
            self.offsets.client.max_entities,
        )
        .into_iter()
        .map(|(_, player)| player)
        .collect()
    }

    /// Match clock: `curtime - m_flGameStartTime` when both offsets are
    /// configured, otherwise wall-clock since the match first went live.
    fn elapsed(&mut self, rules: u64) -> Option<i64> {
        if let Some(seconds) = self.engine_elapsed(rules) {
            return Some(seconds);
        }
        let now = crate::state::unix_now();
        let started = *self.first_seen_live.get_or_insert(now);
        Some(now.saturating_sub(started))
    }

    fn engine_elapsed(&self, rules: u64) -> Option<i64> {
        let start = self
            .mem
            .read_f32(rules + self.offsets.rules.game_start_time?)
            .ok()?;
        let globals = self
            .mem
            .read_ptr(self.client_base + self.offsets.client.global_vars?)
            .ok()
            .flatten()?;
        let now = self
            .mem
            .read_f32(globals + self.offsets.rules.cur_time?)
            .ok()?;
        let elapsed = now - start;
        if start <= 0.0 || !elapsed.is_finite() || elapsed < 0.0 {
            return None;
        }
        Some(elapsed as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pregame_states_are_the_documented_three() {
        assert_eq!(PREGAME_STATES.len(), 3);
        assert!(PREGAME_STATES.contains(&"HeroSelection"));
        assert!(PREGAME_STATES.contains(&"MatchIntro"));
        assert!(PREGAME_STATES.contains(&"PreGameWait"));
        assert!(!PREGAME_STATES.contains(&LIVE_STATE));
    }

    #[test]
    fn attaching_without_the_client_module_is_an_error() {
        // This process never maps client.dll, so attach must refuse rather
        // than fall through to reading arbitrary addresses.
        let error = match GameReader::attach(std::process::id(), "client.dll", Offsets::default()) {
            Ok(_) => panic!("client.dll is not mapped in the test binary"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("client.dll"));
    }
}
