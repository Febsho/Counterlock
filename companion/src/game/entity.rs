//! Entity-list traversal and player-controller reads.
//!
//! Source 2 keeps entities in a two-level table: the entity system holds chunk
//! pointers, each chunk holds fixed-stride slots. Every read is sanity-checked,
//! because a stale offset after a game patch must produce an empty roster
//! rather than a crash loop or a plausible-looking fabricated number.

use super::mem::ProcessMemory;
use crate::config::{EntityLayout, PawnOffsets, PlayerOffsets};
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
        unspent_souls: None,
        owned_item_class_tokens: None,
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
    pawn_offsets: &PawnOffsets,
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
        if let (Some(handle_offset), Some(currency_offset)) =
            (offsets.hero_pawn, pawn_offsets.currencies)
        {
            // Source 2 entity handles store the entity-list index in the low
            // 15 bits; the remaining serial bits prevent stale references.
            let handle = mem.read_u32(entity + handle_offset).ok().unwrap_or(0);
            let pawn_index = handle & 0x7fff;
            if pawn_index != 0 && pawn_index < 0x7fff {
                if let Some(pawn) = list.entity(pawn_index) {
                    player.unspent_souls = mem
                        .read_u32(
                            pawn + currency_offset
                                + u64::from(pawn_offsets.gold_currency_index) * 4,
                        )
                        .ok()
                        .filter(|value| *value <= 1_000_000);
                    player.owned_item_class_tokens =
                        read_owned_item_tokens(mem, list, pawn, pawn_offsets);
                }
            }
        }
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

fn read_owned_item_tokens(
    mem: &ProcessMemory,
    list: &EntityList<'_>,
    pawn: u64,
    offsets: &PawnOffsets,
) -> Option<Vec<u32>> {
    let component = pawn.checked_add(offsets.ability_component?)?;
    let vector = component.checked_add(offsets.abilities_vector?)?;
    let count = mem.read_u32(vector).ok()?;
    if count > 64 {
        return None;
    }
    let data = mem
        .read_ptr(vector.checked_add(offsets.abilities_data?)?)
        .ok()
        .flatten()?;
    let slot_offset = offsets.ability_slot?;
    let token_offset = offsets.ability_subclass_id?;
    let mut tokens = Vec::new();
    for position in 0..count {
        let handle = mem.read_u32(data + u64::from(position) * 4).ok()?;
        let index = handle & 0x7fff;
        if index == 0 || index >= 0x7fff {
            return None;
        }
        let ability = list.entity(index)?;
        let slot = mem.read_u32(ability + slot_offset).ok()?;
        // Shop items occupy active slots 4-7; passive shop items use None (23).
        if !(4..=7).contains(&slot) && slot != 23 {
            continue;
        }
        let token = mem.read_u32(ability + token_offset).ok()?;
        if token != 0 && !tokens.contains(&token) {
            tokens.push(token);
        }
    }
    Some(tokens)
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
