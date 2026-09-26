import type { ItemFlowStats } from "../data/deadlock-api.ts";
import { bestFlowPath } from "./build-flow.ts";

export type PlanCandidate = {
  itemId: number;
  score: number;
  buyTime: number | null;
  tier: number | null;
  cost: number | null;
  category: string | null;
  counterUrgency: number;
  coreFit: number;
  mechanicFit: number;
  components: number[];
  owned: boolean;
};

export const NEXT_BUY_WEIGHTS = { liveValue: 0.24, counter: 0.32, core: 0.22, timing: 0.05, path: 0.1, affordability: 0.07 } as const;

export type SellDecision = { sellId: number; replacementId: number; gain: number; reason: "upgrade_obsolete" | "slot_pressure" | "replacement_gain" };

/** Rank next purchases by current marginal value; time only nudges the result. */
export function rankNextBuys<T extends { score: number; counterUrgency?: number; coreFit?: number; timingFit?: number; pathSynergy?: number; affordabilityUtility?: number; opportunityCost?: number; deviationCost?: number; redundancyPenalty?: number; owned?: boolean }>(items: T[]) {
  return items.filter((item) => !item.owned).map((item) => ({ ...item, nextBuyScore:
    item.score * NEXT_BUY_WEIGHTS.liveValue + (item.counterUrgency ?? 0) * NEXT_BUY_WEIGHTS.counter + (item.coreFit ?? 0) * NEXT_BUY_WEIGHTS.core + (item.timingFit ?? 0) * NEXT_BUY_WEIGHTS.timing + (item.pathSynergy ?? 0) * NEXT_BUY_WEIGHTS.path + (item.affordabilityUtility ?? 0) * NEXT_BUY_WEIGHTS.affordability - (item.deviationCost ?? 0) - (item.opportunityCost ?? 0) - (item.redundancyPenalty ?? 0),
  })).sort((a, b) => b.nextBuyScore - a.nextBuyScore);
}

/** Follow supported item-flow transitions, then fill only with compatible core candidates. */
export function planPurchasePath(candidates: PlanCandidate[], flow: ItemFlowStats | null, limit = 16): number[] {
  const eligible = candidates.filter((item) => !item.owned && item.itemId > 0);
  const byId = new Map(eligible.map((item) => [item.itemId, item]));
  const path = bestFlowPath(flow, limit).filter((id) => byId.has(id));
  const remaining = eligible.filter((item) => !path.includes(item.itemId)).sort((a, b) =>
    (b.counterUrgency * 0.35 + b.coreFit * 0.35 + b.score * 0.3) - (a.counterUrgency * 0.35 + a.coreFit * 0.35 + a.score * 0.3) || a.itemId - b.itemId);
  for (const item of remaining) {
    if (path.length >= limit) break;
    // An upgrade replaces its components in the final inventory, but both remain in purchase history.
    path.push(item.itemId);
  }
  return path.slice(0, limit);
}

/** Recommend a sale only when a replacement has a positive measured value gain. */
export function findSellDecisions(candidates: PlanCandidate[], purchaseOrder: number[], slotPressure = 0.08): SellDecision[] {
  const byId = new Map(candidates.map((item) => [item.itemId, item]));
  const ownedOrder = purchaseOrder.flatMap((id, index) => { const item = byId.get(id); return item?.owned ? [{ item, index }] : []; });
  for (const item of candidates.filter((candidate) => candidate.owned && !ownedOrder.some((entry) => entry.item.itemId === candidate.itemId))) ownedOrder.push({ item, index: -1 });
  const decisions: SellDecision[] = [];
  for (const { item } of ownedOrder) {
    const replacement = candidates.filter((next) => !next.owned && next.itemId !== item.itemId && next.category === item.category &&
      (next.components.includes(item.itemId) || next.score > item.score + slotPressure))
      .sort((a, b) => ((b.components.includes(item.itemId) ? 0.06 : 0) + b.score - item.score) - ((a.components.includes(item.itemId) ? 0.06 : 0) + a.score - item.score))[0];
    if (!replacement) continue;
    const upgrade = replacement.components.includes(item.itemId);
    decisions.push({ sellId: item.itemId, replacementId: replacement.itemId, gain: replacement.score - item.score, reason: upgrade ? "upgrade_obsolete" : replacement.score - item.score > slotPressure ? "replacement_gain" : "slot_pressure" });
  }
  return decisions;
}
