import type { PersonalItemSignal } from "./scoring.ts";

export type PersonalMatch = {
  matchId: number; heroId: number; won: boolean; gameDurationSeconds: number;
  items: Array<{ itemId: number; gameTimeSeconds: number }>;
  kda: number | null; spm: number | null; damagePerMinute: number | null; killParticipation: number | null; mvpScore: number | null;
};
export type PersonalBuildSequence = { itemIds: number[]; matches: number; wins: number; avgPerformance: number | null };
export type PersonalHeroProfile = {
  accountId: number; heroId: number; matches: number; wins: number; ppScore: number | null; estimatedRankNumber: number | null;
  avgKda: number | null; avgSpm: number | null; avgDamagePerMinute: number | null; avgKillParticipation: number | null; avgMvpScore: number | null;
  itemStats: Array<PersonalItemSignal & { itemId: number; wins: number; avgSpm: number | null; avgKda: number | null; avgMvpScore: number | null }>;
  buildSequences: PersonalBuildSequence[];
};

const mean = (values: Array<number | null | undefined>) => { const valid = values.filter((value): value is number => value != null && Number.isFinite(value)); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; };

/** Build only from this hero's cached completed matches; capped to the recent 50. */
export function buildPersonalHeroProfile(accountId: number, heroId: number, matches: PersonalMatch[], rank: { ppScore: number | null; estimatedRankNumber: number | null } = { ppScore: null, estimatedRankNumber: null }): PersonalHeroProfile {
  const own = [...new Map(matches.filter((match) => match.heroId === heroId && match.matchId > 0).map((match) => [match.matchId, match])).values()].sort((a, b) => b.matchId - a.matchId).slice(0, 50);
  const itemMap = new Map<number, PersonalMatch[]>();
  own.forEach((match) => new Set(match.items.map((item) => item.itemId)).forEach((id) => itemMap.set(id, [...(itemMap.get(id) ?? []), match])));
  const itemStats = [...itemMap].map(([itemId, rows]) => ({ itemId, matches: rows.length, wins: rows.filter((match) => match.won).length,
    avgBuyTimeSeconds: mean(rows.flatMap((match) => match.items.filter((item) => item.itemId === itemId).map((item) => item.gameTimeSeconds))),
    avgSpm: mean(rows.map((match) => match.spm)), avgKda: mean(rows.map((match) => match.kda)), avgMvpScore: mean(rows.map((match) => match.mvpScore)),
    personalFit: .5 + ((rows.filter((match) => match.won).length / rows.length) - .5) * Math.min(1, rows.length / 12) }));
  const sequences = new Map<string, PersonalMatch[]>();
  own.forEach((match) => { const ids = [...new Map(match.items.filter((item) => item.itemId > 0 && item.gameTimeSeconds >= 0).sort((a, b) => a.gameTimeSeconds - b.gameTimeSeconds).map((item) => [item.itemId, item])).values()].map((item) => item.itemId).slice(0, 4); if (ids.length < 2) return; const key = ids.join(","); sequences.set(key, [...(sequences.get(key) ?? []), match]); });
  const buildSequences = [...sequences].map(([key, rows]) => ({ itemIds: key.split(",").map(Number), matches: rows.length, wins: rows.filter((match) => match.won).length, avgPerformance: mean(rows.map((match) => match.spm)) })).sort((a, b) => b.matches - a.matches).slice(0, 20);
  return { accountId, heroId, matches: own.length, wins: own.filter((match) => match.won).length, ...rank,
    avgKda: mean(own.map((match) => match.kda)), avgSpm: mean(own.map((match) => match.spm)), avgDamagePerMinute: mean(own.map((match) => match.damagePerMinute)),
    avgKillParticipation: mean(own.map((match) => match.killParticipation)), avgMvpScore: mean(own.map((match) => match.mvpScore)), itemStats, buildSequences };
}

export function personalSignals(profile: PersonalHeroProfile | null): ReadonlyMap<number, PersonalItemSignal> {
  return new Map((profile?.itemStats ?? []).map((item) => [item.itemId, { personalFit: item.personalFit, matches: item.matches, avgBuyTimeSeconds: item.avgBuyTimeSeconds }]));
}

/** Small, confidence-shrunk prior for the next item in an observed personal sequence. */
export function personalSequencePrior(profile: PersonalHeroProfile | null, ownedItemIds: readonly number[], candidateItemId: number): number {
  if (!profile) return 0;
  const owned = new Set(ownedItemIds);
  return Math.max(0, ...profile.buildSequences.flatMap((sequence) => {
    const next = sequence.itemIds.findIndex((id) => !owned.has(id));
    if (next < 0 || sequence.itemIds[next] !== candidateItemId || !sequence.itemIds.slice(0, next).every((id) => owned.has(id))) return [];
    const confidence = sequence.matches / (sequence.matches + 25);
    const outcome = sequence.matches ? sequence.wins / sequence.matches : 0.5;
    return [Math.max(0, Math.min(0.06, (outcome - 0.5) * 0.12 * confidence + confidence * 0.01))];
  }));
}

/** A broad +/- one rank tier cohort; use it only when each selected item has adequate support. */
export function rankCohort(rank: number | null): { min: number; max: number } | null {
  if (rank == null || !Number.isInteger(rank) || rank < 11 || rank > 116) return null;
  return { min: Math.max(11, rank - 10), max: Math.min(116, rank + 10) };
}

export function rankDataHasCoverage(itemMatchCounts: readonly number[]): boolean {
  return itemMatchCounts.filter((matches) => Number.isFinite(matches) && matches >= 20).length >= 8;
}
