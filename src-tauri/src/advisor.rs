//! Desktop bridge for the canonical TypeScript build engine.
//! Rust validates match identity and inventory, then preserves the supplied ranking.
use crate::provider::Capabilities;
use crate::state::MatchSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct ItemEvidence {
    pub item_id: u32,
    pub name: String,
    pub cost: u32,
    pub score: f64,
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ItemClassEvidence {
    pub item_id: u32,
    pub class_name: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EvidenceSet {
    pub hero_id: u32,
    pub enemy_ids: Vec<u32>,
    pub items: Vec<ItemEvidence>,
    #[serde(default)]
    pub item_catalog: Vec<ItemClassEvidence>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AdviceItem {
    pub item_id: u32,
    pub name: String,
    pub cost: u32,
    pub score: f64,
    pub reason: String,
    pub affordable: Option<bool>,
    pub priority: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AdviceSet {
    pub match_id: Option<u64>,
    pub inventory_known: bool,
    pub owned_item_ids: Vec<u32>,
    pub recommended: Option<AdviceItem>,
    pub alternatives: Vec<AdviceItem>,
}

pub const RECOMMENDATION_SWITCH_MARGIN: f64 = 0.002;

/// Keep a still-valid live choice through tiny score changes, but switch when
/// the canonical engine has a material lead or the current item is invalid.
pub fn stabilize(previous: Option<AdviceSet>, mut next: Option<AdviceSet>) -> Option<AdviceSet> {
    let (Some(previous), Some(next_advice)) = (previous, next.as_mut()) else { return next; };
    if previous.match_id != next_advice.match_id || previous.inventory_known != next_advice.inventory_known { return Some(next_advice.clone()); }
    let Some(current) = previous.recommended else { return Some(next_advice.clone()); };
    let Some(new_top) = next_advice.recommended.clone() else { return Some(next_advice.clone()); };
    if current.item_id == new_top.item_id || new_top.score > current.score + RECOMMENDATION_SWITCH_MARGIN { return Some(next_advice.clone()); }
    let Some(updated_current) = next_advice.alternatives.iter().find(|item| item.item_id == current.item_id).cloned() else { return Some(next_advice.clone()); };
    let new_top_id = new_top.item_id;
    let mut alternatives = vec![new_top];
    alternatives.extend(next_advice.alternatives.iter().filter(|item| item.item_id != current.item_id && item.item_id != new_top_id).cloned());
    alternatives.truncate(3);
    next_advice.recommended = Some(updated_current);
    next_advice.alternatives = alternatives;
    Some(next_advice.clone())
}

pub fn recommend(snapshot: &MatchSnapshot, capabilities: Capabilities, evidence: &EvidenceSet) -> Option<AdviceSet> {
    let account_id = snapshot.account_id?;
    let player = snapshot.players.iter().find(|player| player.account_id == Some(account_id))?;
    if player.hero_id != Some(evidence.hero_id) { return None; }
    let own_team = player.team?;
    let enemies: Vec<_> = snapshot.players.iter().filter(|entry| entry.team.is_some() && entry.team != Some(own_team)).collect();
    let roster_ids: Vec<u32> = enemies.iter().filter_map(|entry| entry.hero_id).collect();
    if roster_ids.is_empty() || evidence.enemy_ids.is_empty() || !evidence.enemy_ids.iter().all(|id| roster_ids.contains(id)) { return None; }
    let inventory_known = capabilities.items && player.owned_item_class_tokens.is_some();
    let owned_item_ids: Vec<u32> = if inventory_known {
        let tokens = player.owned_item_class_tokens.as_ref().unwrap();
        evidence.item_catalog.iter().filter(|item| tokens.contains(&string_token_hash(&item.class_name))).map(|item| item.item_id).collect()
    } else { Vec::new() };
    let mut ranked: Vec<_> = evidence.items.iter().filter(|item| {
        item.cost > 0 && item.score.is_finite() && !owned_item_ids.contains(&item.item_id)
    }).map(|item| AdviceItem {
        item_id: item.item_id, name: item.name.clone(), cost: item.cost,
        score: (item.score * 1000.0).round() / 1000.0, reason: item.reason.clone(),
        // Only the pawn's replicated EGold value is shop balance; net worth is not.
        affordable: capabilities.unspent_souls.then(|| player.unspent_souls).flatten().map(|souls| souls >= item.cost), priority: 0,
    }).collect();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.item_id.cmp(&b.item_id)));
    for (index, item) in ranked.iter_mut().enumerate() { item.priority = index + 1; }
    let recommended = ranked.first().cloned();
    let alternatives = ranked.into_iter().skip(1).take(3).collect();
    Some(AdviceSet { match_id: snapshot.match_id, inventory_known, owned_item_ids, recommended, alternatives })
}

/// Source 2 CUtlStringToken uses MurmurHash2 with the engine's fixed seed.
pub fn string_token_hash(value: &str) -> u32 {
    let bytes = value.as_bytes();
    let mut hash = 0x3141_5926u32 ^ bytes.len() as u32;
    let mut offset = 0;
    while offset + 4 <= bytes.len() {
        let mut key = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        key = key.wrapping_mul(0x5bd1_e995);
        key ^= key >> 24;
        key = key.wrapping_mul(0x5bd1_e995);
        hash = hash.wrapping_mul(0x5bd1_e995) ^ key;
        offset += 4;
    }
    let tail = &bytes[offset..];
    if tail.len() >= 3 { hash ^= u32::from(tail[2]) << 16; }
    if tail.len() >= 2 { hash ^= u32::from(tail[1]) << 8; }
    if let Some(first) = tail.first() { hash ^= u32::from(*first); hash = hash.wrapping_mul(0x5bd1_e995); }
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(0x5bd1_e995);
    hash ^ (hash >> 15)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PlayerState;

    fn snapshot() -> MatchSnapshot {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.account_id = Some(1);
        snapshot.players = vec![
            PlayerState { account_id: Some(1), hero_id: Some(10), team: Some(0), ..Default::default() },
            PlayerState { account_id: Some(2), hero_id: Some(20), team: Some(1), ..Default::default() },
        ];
        snapshot
    }

    fn evidence() -> EvidenceSet {
        EvidenceSet { hero_id: 10, enemy_ids: vec![20], item_catalog: vec![], items: vec![
            ItemEvidence { item_id: 1, name: "Core".into(), cost: 3000, score: 0.51, reason: "Core fit".into() },
            ItemEvidence { item_id: 2, name: "Counter".into(), cost: 3000, score: 0.57, reason: "Urgent counter".into() },
        ] }
    }

    #[test]
    fn rust_preserves_canonical_frontend_order_and_reason() {
        let advice = recommend(&snapshot(), Capabilities::default(), &evidence()).unwrap();
        let item = advice.recommended.unwrap();
        assert_eq!(item.item_id, 2);
        assert_eq!(item.reason, "Urgent counter");
    }

    #[test]
    fn net_worth_does_not_imply_affordability_and_unknown_inventory_stays_unknown() {
        let mut state = snapshot();
        state.players[0].net_worth = Some(20_000);
        let result = recommend(&state, Capabilities::default(), &evidence()).unwrap();
        assert_eq!(result.recommended.unwrap().affordable, None);
        assert!(!result.inventory_known);
    }

    #[test]
    fn owned_items_are_excluded_only_when_inventory_is_verified() {
        let mut state = snapshot();
        state.players[0].owned_item_class_tokens = Some(vec![string_token_hash("owned_item")]);
        let mut evidence = evidence();
        evidence.item_catalog = vec![ItemClassEvidence { item_id: 2, class_name: "owned_item".into() }];
        let result = recommend(&state, Capabilities { items: true, ..Default::default() }, &evidence).unwrap();
        assert_eq!(result.recommended.unwrap().item_id, 1);
        assert_eq!(result.owned_item_ids, vec![2]);
        assert!(recommend(&state, Capabilities::default(), &evidence).unwrap().recommended.is_some());
    }

    #[test]
    fn source_string_token_hash_matches_live_item_subclass_ids() {
        assert_eq!(string_token_hash("upgrade_cold_front"), 0x75cd56b4);
    }

    #[test]
    fn recommendation_holds_for_small_changes_and_switches_for_a_material_lead() {
        let mut first = recommend(&snapshot(), Capabilities::default(), &evidence()).unwrap();
        first.recommended = first.alternatives.iter().find(|item| item.item_id == 1).cloned();
        first.alternatives.retain(|item| item.item_id != 1);
        first.match_id = Some(99);
        let mut second = recommend(&snapshot(), Capabilities::default(), &evidence()).unwrap();
        second.match_id = Some(99);
        second.recommended.as_mut().unwrap().score = first.recommended.as_ref().unwrap().score + 0.001;
        assert_eq!(stabilize(Some(first.clone()), Some(second.clone())).unwrap().recommended.unwrap().item_id, 1);
        second.recommended.as_mut().unwrap().score = first.recommended.as_ref().unwrap().score + 0.01;
        assert_eq!(stabilize(Some(first), Some(second)).unwrap().recommended.unwrap().item_id, 2);
    }
}
