export type WinSample = { wins: number; matches: number };
export type ItemSample = WinSample & { item_id: number; avg_buy_time_s: number };
export type MatchupSample = { enemy_hero_id: number; wins: number; matches_played: number };
export type PatchSample = { client_version: number; version_datetime: string };

export function winRate(sample: WinSample) {
  return sample.matches > 0 ? sample.wins / sample.matches : null;
}

export function filterSampleSize<T>(rows: readonly T[], minimum: number, matchesOf: (row: T) => number) {
  return rows.filter((row) => matchesOf(row) >= minimum);
}

export function sortHeroItems<T extends ItemSample>(rows: readonly T[], sort: "popular" | "winrate", minimum = 25) {
  return rows.filter((row) => sort !== "winrate" || row.matches >= minimum).slice().sort((a, b) => sort === "popular"
    ? b.matches - a.matches || a.item_id - b.item_id
    : (winRate(b) ?? -1) - (winRate(a) ?? -1) || b.matches - a.matches);
}

export function sortBuilds<T>(rows: readonly T[], sort: "popular" | "winrate", popularity: (row: T) => number, result: (row: T) => WinSample | null, minimum = 20) {
  return rows.filter((row) => sort !== "winrate" || (result(row)?.matches ?? 0) >= minimum).slice().sort((a, b) => sort === "popular"
    ? popularity(b) - popularity(a)
    : (winRate(result(b)!) ?? -1) - (winRate(result(a)!) ?? -1) || (result(b)?.matches ?? 0) - (result(a)?.matches ?? 0));
}

export function sortMatchups<T extends MatchupSample>(rows: readonly T[], view: "tough" | "favorable", minimum = 10) {
  return filterSampleSize(rows, minimum, (row) => row.matches_played).slice().sort((a, b) => {
    const delta = a.wins / a.matches_played - b.wins / b.matches_played;
    return (view === "tough" ? delta : -delta) || b.matches_played - a.matches_played;
  });
}

export function aggregateRankSamples<T extends WinSample & { bucket: number }, R extends { tier: number; label: string }>(rows: readonly T[], tierFor: (bucket: number) => R | null) {
  const aggregates = new Map<number, WinSample & R>();
  for (const row of rows) {
    const tier = tierFor(row.bucket);
    if (!tier) continue;
    const current = aggregates.get(tier.tier) ?? { ...tier, wins: 0, matches: 0 };
    current.wins += row.wins;
    current.matches += row.matches;
    aggregates.set(tier.tier, current);
  }
  return [...aggregates.values()].filter((row) => row.matches > 0).sort((a, b) => a.tier - b.tier).map((row) => ({ ...row, rate: row.wins / row.matches }));
}

export function groupDurationSamples<T extends WinSample & { hero_id: number }>(groups: readonly (readonly T[])[], heroId: number) {
  return groups.map((group) => group.filter((row) => row.hero_id === heroId));
}

export function patchWindow(params: URLSearchParams, patches: readonly PatchSample[], selectedPatch: string) {
  if (selectedPatch === "all") return;
  const index = patches.findIndex((patch) => String(patch.client_version) === selectedPatch);
  if (index < 0) return;
  const start = Date.parse(`${patches[index].version_datetime}Z`);
  const newer = index > 0 ? Date.parse(`${patches[index - 1].version_datetime}Z`) : NaN;
  if (!Number.isFinite(start)) return;
  params.set("min_unix_timestamp", String(Math.floor(start / 1000)));
  if (Number.isFinite(newer)) params.set("max_unix_timestamp", String(Math.floor(newer / 1000)));
}
