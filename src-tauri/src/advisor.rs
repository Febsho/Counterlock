//! Live item ranking from Counterlock matchup evidence and normalized telemetry.
//! The existing web analytics fetch supplies evidence until it has a Rust cache.
use crate::provider::Capabilities;
use crate::state::MatchSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct EnemyEvidence {
    pub hero_id: u32,
    pub hero_name: String,
    pub rate: f64,
    pub matches: u32,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ItemEvidence {
    pub item_id: u32,
    pub name: String,
    pub cost: u32,
    pub baseline_rate: f64,
    pub team_rate: f64,
    pub team_matches: u32,
    #[serde(default)]
    pub average_buy_time_s: Option<f64>,
    pub enemy_rates: Vec<EnemyEvidence>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct EvidenceSet {
    pub hero_id: u32,
    pub enemy_ids: Vec<u32>,
    pub items: Vec<ItemEvidence>,
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
    pub recommended: Option<AdviceItem>,
    pub alternatives: Vec<AdviceItem>,
}

pub fn recommend(
    snapshot: &MatchSnapshot,
    capabilities: Capabilities,
    evidence: &EvidenceSet,
) -> Option<AdviceSet> {
    let account_id = snapshot.account_id?;
    let player = snapshot
        .players
        .iter()
        .find(|player| player.account_id == Some(account_id))?;
    if player.hero_id != Some(evidence.hero_id) {
        return None;
    }
    let own_team = player.team?;
    let enemies: Vec<_> = snapshot
        .players
        .iter()
        .filter(|entry| entry.team.is_some() && entry.team != Some(own_team))
        .collect();
    let roster_ids: Vec<u32> = enemies.iter().filter_map(|entry| entry.hero_id).collect();
    if roster_ids.is_empty()
        || evidence.enemy_ids.is_empty()
        || !evidence.enemy_ids.iter().all(|id| roster_ids.contains(id))
    {
        return None;
    }
    let threat = enemies
        .iter()
        .filter_map(|entry| Some((entry.hero_id?, entry.net_worth?)))
        .max_by_key(|(_, souls)| *souls);
    let inventory_known = capabilities.items && player.items.is_some();
    let mut ranked: Vec<AdviceItem> = evidence.items.iter().filter_map(|item| {
        if item.team_matches < 80 || item.cost == 0 || !item.team_rate.is_finite() || !item.baseline_rate.is_finite() { return None; }
        if inventory_known && player.items.as_ref().is_some_and(|items| items.contains(&item.item_id)) { return None; }
        let confidence = ((item.team_matches as f64).log10() / 4.7).min(1.0);
        let team_lift = (item.team_rate - item.baseline_rate).clamp(-0.06, 0.06);
        let mut score = (item.team_rate + team_lift * 0.35) * confidence;
        let mut reason = format!("{:.1}% matchup win rate across {} matched games against this team.", item.team_rate * 100.0, item.team_matches);
        if let Some((hero_id, souls)) = threat {
            if let Some(enemy) = item.enemy_rates.iter().find(|enemy| enemy.hero_id == hero_id && enemy.matches >= 80 && enemy.rate.is_finite()) {
                let lift = (enemy.rate - item.baseline_rate).clamp(-0.06, 0.06);
                score += lift * 0.3;
                reason = format!("{} leads known enemy souls ({souls}); this item has {:+.1} percentage points against them across {} matches.",
                    enemy.hero_name, lift * 100.0, enemy.matches);
            }
        }
        if let (Some(time), Some(buy_time)) = (snapshot.game_time_s, item.average_buy_time_s) {
            if buy_time.is_finite() && (buy_time - time as f64).abs() > 900.0 { score -= 0.02; }
        }
        Some(AdviceItem { item_id: item.item_id, name: item.name.clone(), cost: item.cost,
            score: (score * 1000.0).round() / 1000.0,
            // Net worth includes purchased items, so it cannot prove that the
            // player has enough unspent souls for this purchase.
            reason, affordable: None, priority: 0 })
    }).collect();
    ranked.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.item_id.cmp(&b.item_id))
    });
    for (index, item) in ranked.iter_mut().enumerate() {
        item.priority = index + 1;
    }
    let recommended = ranked.first().cloned();
    let alternatives = ranked.into_iter().skip(1).take(3).collect();
    Some(AdviceSet {
        match_id: snapshot.match_id,
        inventory_known,
        recommended,
        alternatives,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PlayerState;

    #[test]
    fn unknown_souls_and_inventory_do_not_become_zero_or_empty() {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.account_id = Some(1);
        snapshot.players = vec![
            PlayerState {
                account_id: Some(1),
                hero_id: Some(10),
                team: Some(0),
                ..Default::default()
            },
            PlayerState {
                account_id: Some(2),
                hero_id: Some(20),
                team: Some(1),
                ..Default::default()
            },
        ];
        let evidence = EvidenceSet {
            hero_id: 10,
            enemy_ids: vec![20],
            items: vec![ItemEvidence {
                item_id: 3,
                name: "Example".into(),
                cost: 3000,
                baseline_rate: 0.5,
                team_rate: 0.55,
                team_matches: 1000,
                average_buy_time_s: Some(600.0),
                enemy_rates: vec![],
            }],
        };
        let result = recommend(&snapshot, Capabilities::default(), &evidence).unwrap();
        assert_eq!(result.recommended.unwrap().affordable, None);
        assert!(!result.inventory_known);
        snapshot.players[0].net_worth = Some(3500);
        let result = recommend(&snapshot, Capabilities::default(), &evidence).unwrap();
        assert_eq!(result.recommended.unwrap().affordable, None);
        snapshot.players[0].items = Some(vec![3]);
        let result = recommend(
            &snapshot,
            Capabilities {
                items: true,
                ..Default::default()
            },
            &evidence,
        )
        .unwrap();
        assert!(result.recommended.is_none());
    }

    #[test]
    fn stale_hero_evidence_is_rejected() {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.account_id = Some(1);
        snapshot.players.push(crate::state::PlayerState {
            account_id: Some(1),
            hero_id: Some(10),
            team: Some(0),
            ..Default::default()
        });
        let evidence = EvidenceSet {
            hero_id: 11,
            enemy_ids: vec![20],
            items: vec![],
        };
        assert!(recommend(&snapshot, Capabilities::default(), &evidence).is_none());
    }

    #[test]
    fn strongest_known_enemy_shapes_the_reason() {
        let mut snapshot = MatchSnapshot::new("test");
        snapshot.account_id = Some(1);
        snapshot.players = vec![
            PlayerState {
                account_id: Some(1),
                hero_id: Some(10),
                team: Some(0),
                net_worth: Some(3000),
                ..Default::default()
            },
            PlayerState {
                account_id: Some(2),
                hero_id: Some(20),
                team: Some(1),
                net_worth: Some(5000),
                ..Default::default()
            },
            PlayerState {
                account_id: Some(3),
                hero_id: Some(21),
                team: Some(1),
                net_worth: Some(4000),
                ..Default::default()
            },
        ];
        let evidence = EvidenceSet {
            hero_id: 10,
            enemy_ids: vec![20, 21],
            items: vec![ItemEvidence {
                item_id: 3,
                name: "Example".into(),
                cost: 3000,
                baseline_rate: 0.5,
                team_rate: 0.55,
                team_matches: 1000,
                average_buy_time_s: Some(600.0),
                enemy_rates: vec![EnemyEvidence {
                    hero_id: 20,
                    hero_name: "Haze".into(),
                    rate: 0.58,
                    matches: 400,
                }],
            }],
        };
        let result = recommend(&snapshot, Capabilities::default(), &evidence).unwrap();
        let item = result.recommended.unwrap();
        assert!(item.reason.contains("Haze leads known enemy souls (5000)"));
        assert_eq!(item.affordable, None);
    }
}
