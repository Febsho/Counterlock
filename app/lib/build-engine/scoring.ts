import { confidenceTier, exactLineupConfidence, shrinkLift } from "./confidence.ts";
import { scoreThreats, type ThreatPlayer } from "./threat-score.ts";

export type EnemyEvidence = { heroId: number; rate: number; matches: number };
export type ItemEvidence = { itemId: number; baselineRate: number; coreRate?: number | null; coreMatches?: number; exactRate: number | null; exactMatches: number; mechanicFit?: number; preferenceFit?: number; averageBuyTimeSeconds?: number | null; enemyRates: EnemyEvidence[] };
export type RankedItem = ItemEvidence & { score: number; coreFit: number; counterFit: number; counterUrgency: number; exactFit: number; timingFit: number; confidence: "limited" | "medium" | "high"; threatTargets: number[]; reason: string };

export const COUNTER_SIGNAL_WEIGHTS = { matchup: 0.55, mechanics: 0.45, referenceLift: 0.05 } as const;
export function normalizeCounterFit(lift: number): number {
  return Math.max(-1, Math.min(1, lift / COUNTER_SIGNAL_WEIGHTS.referenceLift));
}

export const LINEUP_CONFIDENCE = { weakSamples: 100, strongSamples: 800 } as const;

/** Core baseline stays meaningful; exact lineup only contributes after its sample clears a threshold. */
export function rankItems(items: ItemEvidence[], threats: ThreatPlayer[], gameTimeSeconds: number | null): RankedItem[] {
  const threatWeights = scoreThreats(threats, gameTimeSeconds);
  return items.map((item) => {
    const enemyEvidence = item.enemyRates.flatMap((e) => {
      const weight = threatWeights.find((t) => t.heroId === e.heroId)?.weight;
      return weight == null ? [] : [{ ...e, weight, lift: shrinkLift(e.rate - item.baselineRate, e.matches) }];
    });
    const evidenceWeight = enemyEvidence.reduce((sum, e) => sum + e.weight * Math.min(1, e.matches / 250), 0);
    const counterFit = evidenceWeight ? enemyEvidence.reduce((sum, e) => sum + e.lift * e.weight * Math.min(1, e.matches / 250), 0) / evidenceWeight : 0;
    const exactConfidence = exactLineupConfidence(item.exactMatches);
    const exactFit = item.exactRate == null ? 0 : shrinkLift(item.exactRate - item.baselineRate, item.exactMatches) * exactConfidence;
    const coreFit = item.coreRate == null ? 0 : shrinkLift(item.coreRate - item.baselineRate, item.coreMatches ?? 0);
    const mechanicFit = Math.max(0, Math.min(1, item.mechanicFit ?? 0));
    const counterUrgency = normalizeCounterFit(counterFit) * COUNTER_SIGNAL_WEIGHTS.matchup + mechanicFit * COUNTER_SIGNAL_WEIGHTS.mechanics;
    const preferenceFit = Math.max(0, Math.min(1, item.preferenceFit ?? 0));
    const timingFit = item.averageBuyTimeSeconds == null || gameTimeSeconds == null ? 0.5 : 1 / (1 + Math.abs(item.averageBuyTimeSeconds - gameTimeSeconds) / 900);
    const score = item.baselineRate * 0.34 + coreFit * 0.18 + counterUrgency * 0.23 + exactFit * 0.05 + preferenceFit * 0.12 + timingFit * 0.08;
    const orderedEvidence = [...enemyEvidence].sort((a, b) => b.weight * b.lift - a.weight * a.lift);
    const targets = orderedEvidence.slice(0, 3).map((e) => e.heroId);
    const samples = Math.max(item.exactMatches, ...item.enemyRates.map((e) => e.matches), 0);
    const matchup = orderedEvidence[0];
    const matchupText = matchup ? `Best weighted matchup: Hero #${matchup.heroId}, ${((matchup.rate - item.baselineRate) * 100).toFixed(1)} pp raw lift across ${matchup.matches.toLocaleString()} matches.` : "No per-enemy item sample is available.";
    return { ...item, score, coreFit, counterFit, counterUrgency, exactFit, timingFit, confidence: confidenceTier(samples), threatTargets: targets,
      reason: item.exactMatches >= LINEUP_CONFIDENCE.strongSamples ? `Exact selected lineup: ${item.exactMatches.toLocaleString()} matches. ${matchupText}` : `Using weighted individual matchups. ${matchupText} ${item.exactMatches ? `Exact lineup sample (${item.exactMatches}) is too small to dominate.` : "Exact lineup evidence unavailable."}` };
  }).sort((a, b) => b.score - a.score || a.itemId - b.itemId);
}
