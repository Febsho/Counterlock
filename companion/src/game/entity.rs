//! Entity-list traversal and player-controller reads.
//!
//! Source 2 keeps entities in a two-level table: the entity system holds chunk
//! pointers, each chunk holds fixed-stride slots. Every read is sanity-checked,
//! because a stale offset after a game patch must produce an empty roster
//! rather than a crash loop or a plausible-looking fabricated number.

use super::mem::ProcessMemory;
use crate::config::{EntityLayout, PlayerOffsets};
use crate::state::PlayerState;

/// Individual Steam accounts all fall inside this Steam64 range, which makes a
/// cheap validity test for "is this entity actually a player controller".
const STEAM64_MIN: u64 = 76_561_197_960_265_729;
const STEAM64_MAX: u64 = 76_561_202_255_233_023;

/// Upper bound for a counter that is believable as a scoreboard value. Anything
/// larger means the offset is wrong, not that someone had a great game.
const COUNTER_CEILING: u32 = 1_000_000;

pub struct EntityList<'a> {
    mem: &'a ProcessMemory,
    system: u64,
    layout: &'a EntityLayout,
}

impl<'a> EntityList<'a> {
    pub fn new(mem: &'a ProcessMemory, system: u64, layout: &'a EntityLayout) -> Self {
        Self {
            mem,
            system,
            layout,
        }
    }

    /// Resolves one entity index to its instance pointer.
    pub fn entity(&self, index: u32) -> Option<u64> {
        let index = u64::from(index);
        let chunk_size = self.layout.chunk_size.max(1);
        let chunk = self
            .mem
            .read_ptr(self.system + self.layout.chunk_table + (index / chunk_size) * 8)
            .ok()
            .flatten()?;
        self.mem
            .read_ptr(chunk + (index % chunk_size) * self.layout.entry_stride)
            .ok()
            .flatten()
    }
}

/// Reads one `CCitadelPlayerController` into the shared player model.
///
/// Returns `None` when the entity carries no plausible Steam id, which is how a
/// non-controller entity (or a wrong offset) is filtered out.
pub fn read_player(
    mem: &ProcessMemory,
    controller: u64,
    offsets: &PlayerOffsets,
) -> Option<(u64, PlayerState)> {
    let steam_id = mem.read_u64(controller + offsets.steam_id?).ok()?;
    if steam_id != 0 && !(STEAM64_MIN..=STEAM64_MAX).contains(&steam_id) {
        return None;
    }

    let counter = |offset: Option<u64>| -> Option<u32> {
        mem.read_u32(controller + offset?)
            .ok()
            .filter(|value| *value < COUNTER_CEILING)
    };

    let hero_id = counter(offsets.hero_id).filter(|id| *id > 0 && *id < 1000);
    let team = offsets
        .team
        .and_then(|off| mem.read_u8(controller + off).ok())
        .filter(|team| (1..=3).contains(team));
    // Bots in local test matches have no Steam ID. Require both game-specific
    // fields before accepting one; otherwise any entity full of zeroes fits.
    if steam_id == 0 && (hero_id.is_none() || team.is_none()) {
        return None;
    }
    let player = PlayerState {
        account_id: crate::steam::account_id_from_steam_id64(steam_id).ok(),
        hero_id,
        team,
        slot: None,
        kills: counter(offsets.kills),
        deaths: counter(offsets.deaths),
        assists: counter(offsets.assists),
        net_worth: counter(offsets.net_worth),
        // Derived by MatchSnapshot::finalize once the match clock is known.
        souls_per_minute: None,
        // The reader does not walk the inventory yet.
        items: None,
    };
    Some((steam_id, player))
}

/// Walks the low entity indices and collects every player controller found.
///
/// Controllers live near the start of the entity list, so a short scan keeps
/// the per-tick read count small. Stops at 12: a full Deadlock lobby.
pub fn collect_players(
    list: &EntityList<'_>,
    mem: &ProcessMemory,
    offsets: &PlayerOffsets,
    max_entities: u32,
) -> Vec<(u64, PlayerState)> {
    let mut players: Vec<(u64, PlayerState)> = Vec::with_capacity(12);
    for index in 1..=max_entities {
        let Some(entity) = list.entity(index) else {
            continue;
        };
        let Some((steam_id, mut player)) = read_player(mem, entity, offsets) else {
            continue;
        };
        if steam_id != 0 && players.iter().any(|(seen, _)| *seen == steam_id) {
            continue;
        }
        player.slot = u8::try_from(players.len()).ok();
        players.push((steam_id, player));
        if players.len() == 12 {
            break;
        }
    }
    players.sort_by_key(|(_, player)| (player.team.unwrap_or(u8::MAX), player.slot));
    players
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_controller_without_offsets_reads_nothing() {
        // Every field is None, so read_player must bail before touching memory.
        let offsets = PlayerOffsets::default();
        assert!(offsets.steam_id.is_none());
        // Reading is skipped entirely, which is what keeps an unconfigured
        // provider from fabricating a roster of zeros.
        let mem = ProcessMemory::open(std::process::id()).expect("own memory is readable");
        assert!(read_player(&mem, 0x1000, &offsets).is_none());
    }

    #[test]
    fn steam_id_bounds_cover_real_accounts_only() {
        assert!(!(STEAM64_MIN..=STEAM64_MAX).contains(&0));
        assert!((STEAM64_MIN..=STEAM64_MAX).contains(&76_561_198_333_692_097));
    }
}
