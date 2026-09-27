import type { RecommendationOutcome } from "./data/recommendation-outcomes.ts";

export type ReviewDecision = RecommendationOutcome["recommendations"][number] & {
  bought: RecommendationOutcome["actualPurchases"][number] | null;
  delay: number | null;
  state: "FOLLOWED" | "DELAYED" | "SKIPPED" | "UNKNOWN";
};
export type ReviewEvent = { time: number; id: number; kind: "purchase" | "recommendation" | "threat" };
export type ThreatSnapshot = { time: number; threats: NonNullable<RecommendationOutcome["recommendations"][number]["enemyThreats"]> };

export function orderedMatches(outcomes: RecommendationOutcome[]) {
  return [...outcomes].sort((a, b) => (b.date ?? b.matchId) - (a.date ?? a.matchId));
}

export function filterMatches(outcomes: RecommendationOutcome[], filters: { hero?: string; result?: string; since?: number | null; queue?: "all" | "ranked" | "unranked" }) {
  return orderedMatches(outcomes).filter((match) =>
    (filters.hero == null || filters.hero === "all" || String(match.heroId) === filters.hero) &&
    (filters.result == null || filters.result === "all" || match.result === filters.result) &&
    (filters.since == null || (match.date != null && match.date >= filters.since)) &&
    (filters.queue == null || filters.queue === "all" || rankedQueue(match.matchMode) === (filters.queue === "ranked")));
}

function rankedQueue(mode:string|null):boolean|null { if(!mode)return null;const value=mode.toLowerCase();if(value.includes("unranked")||value.includes("normal"))return false;if(value.includes("ranked"))return true;return null; }

export function recommendationDecisions(match: RecommendationOutcome): ReviewDecision[] {
  const purchases = [...new Map(match.actualPurchases.filter((p) => p.itemId > 0 && p.gameTime >= 0).sort((a, b) => a.gameTime - b.gameTime).map((p) => [`${p.itemId}:${p.gameTime}`, p])).values()];
  const used = new Set<string>();
  return compactRecommendations(match.recommendations).map((rec) => {
    const bought = purchases.find((purchase) => !used.has(`${purchase.itemId}:${purchase.gameTime}`) && purchase.itemId === rec.recommendedItemId && purchase.gameTime >= rec.gameTime) ?? null;
    if (bought) used.add(`${bought.itemId}:${bought.gameTime}`);
    const delay = bought ? bought.gameTime - rec.gameTime : null;
    return { ...rec, bought, delay, state: bought ? delay! <= 60 ? "FOLLOWED" : "DELAYED" : purchases.length ? "SKIPPED" : "UNKNOWN" };
  });
}

export function reviewTimeline(match: RecommendationOutcome): ReviewEvent[] {
  const events: ReviewEvent[] = [
    ...match.actualPurchases.filter((p) => p.itemId > 0 && p.gameTime >= 0).map((p) => ({ time: p.gameTime, id: p.itemId, kind: "purchase" as const })),
    ...compactRecommendations(match.recommendations).filter((r) => r.recommendedItemId > 0 && r.gameTime >= 0).map((r) => ({ time: r.gameTime, id: r.recommendedItemId, kind: "recommendation" as const })),
    ...threatEvolution(match).map(snapshot => ({time:snapshot.time,id:snapshot.threats[0].heroId,kind:"threat" as const})),
  ];
  return [...new Map(events.sort((a, b) => a.time - b.time || a.kind.localeCompare(b.kind) || a.id - b.id).map((event) => [`${event.time}:${event.kind}:${event.id}`, event])).values()];
}

/** Return only snapshots where the visible top-threat ordering/priority changed. */
export function threatEvolution(match: RecommendationOutcome): ThreatSnapshot[] {
  const snapshots = [...match.recommendations].filter((entry) => entry.enemyThreats?.length).sort((a,b)=>a.gameTime-b.gameTime);
  let previous = "";
  const result: ThreatSnapshot[] = [];
  snapshots.forEach(entry => {
    const threats = [...(entry.enemyThreats??[])].sort((a,b)=>b.weight-a.weight).slice(0,3);
    const signature = threats.map(threat=>`${threat.heroId}:${Math.round(threat.weight*4)}`).join("|");
    if (signature !== previous) result.push({time:entry.gameTime,threats});
    previous=signature;
  });
  return result;
}

function compactRecommendations(recommendations: RecommendationOutcome["recommendations"]) {
  const sorted = [...recommendations].filter((item) => item.recommendedItemId > 0 && item.gameTime >= 0).sort((a, b) => a.gameTime - b.gameTime || b.score - a.score);
  const byItem = new Map<number, RecommendationOutcome["recommendations"]>();
  sorted.forEach((entry) => {
    const existing = byItem.get(entry.recommendedItemId) ?? [];
    const last = existing.at(-1);
    const signature = (value: RecommendationOutcome["recommendations"][number]) => JSON.stringify({reasons:[...(value.reasonCodes??[])].sort(),threats:(value.enemyThreats??[]).map(enemy=>[enemy.heroId,Math.round(enemy.weight*4)]).sort((a,b)=>Number(a[0])-Number(b[0])),phase:value.phase,core:value.normalCoreItemId,lane:value.laneState});
    if (last && entry.gameTime - last.gameTime <= 120 && signature(last) === signature(entry)) {
      if (entry.gameTime === last.gameTime && entry.score > last.score) existing[existing.length - 1] = entry;
    } else existing.push(entry);
    byItem.set(entry.recommendedItemId, existing);
  });
  return [...byItem.values()].flat().sort((a, b) => a.gameTime - b.gameTime || b.score - a.score);
}
