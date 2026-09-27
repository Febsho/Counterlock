export type RecommendationThreat = { heroId: number; weight: number; playerName: string | null };
export type RecommendationSnapshot = { gameTime: number; recommendedItemId: number; score: number; reasonCodes?: string[]; enemyThreats?: RecommendationThreat[]; phase?: "early" | "mid" | "late"; normalCoreItemId?: number | null; laneState?: "ahead" | "even" | "behind" | "unknown" };
export type MatchRankSnapshot = { estimatedRankNumber: number | null; ppScore: number | null; playerName: string | null };
export type PendingMatchRecord = { heroId: number; recommendations: RecommendationSnapshot[]; matchMode?: string | null; rankSnapshot?: MatchRankSnapshot | null };
export type ActualPurchase = { itemId: number; gameTime: number };
export type RecommendationOutcome = {
  matchId: number; heroId: number; recommendations: RecommendationSnapshot[]; actualPurchases: ActualPurchase[];
  result: "win" | "loss"; durationSeconds: number | null; date: number | null; netWorth: number | null; matchMode: string | null; rankSnapshot: MatchRankSnapshot | null;
  performance: { kills: number | null; deaths: number | null; assists: number | null; spm: number | null; kda: number | null; damagePerMinute: number | null; killParticipation: number | null; mvpScore: number | null };
};

export type OutcomeCache = { pending: Record<number, PendingMatchRecord>; completed: Record<number, RecommendationOutcome> };
export type StorageLike = Pick<Storage, "getItem" | "setItem">;
const key = (accountId: number) => `counterlock:recommendation-outcomes:v1:${accountId}`;
const empty = (): OutcomeCache => ({ pending: {}, completed: {} });

function read(accountId: number, storage: StorageLike): OutcomeCache {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key(accountId)) ?? "null");
    if (parsed && typeof parsed === "object" && (parsed as OutcomeCache).pending && (parsed as OutcomeCache).completed) return parsed as OutcomeCache;
  } catch { /* malformed or unavailable local cache: start fresh */ }
  return empty();
}

function write(accountId: number, cache: OutcomeCache, storage: StorageLike) {
  const completed = Object.fromEntries(Object.entries(cache.completed).sort(([a], [b]) => Number(b) - Number(a)).slice(0, 100));
  const pending = Object.fromEntries(Object.entries(cache.pending).sort(([a], [b]) => Number(b) - Number(a)).slice(0, 20));
  try { storage.setItem(key(accountId), JSON.stringify({ completed, pending })); } catch { /* recommendation logic must survive storage quota/privacy failures */ }
}

export function recordRecommendationSnapshot(accountId: number, matchId: number, heroId: number, gameTime: number, choices: Array<Omit<RecommendationSnapshot, "gameTime" | "recommendedItemId" | "score"> & { itemId: number; score: number }>, storage: StorageLike, context: { matchMode?: string | null; rankSnapshot?: MatchRankSnapshot | null } = {}): void {
  if (![accountId, matchId, heroId].every((value) => Number.isSafeInteger(value) && value > 0) || !Number.isFinite(gameTime)) return;
  const cache = read(accountId, storage);
  if (cache.completed[matchId]) return;
  const previous = cache.pending[matchId] ?? { heroId, recommendations: [] };
  if (previous.heroId !== heroId) return;
  const contextChanged = (context.matchMode != null && context.matchMode !== previous.matchMode) || (context.rankSnapshot != null && JSON.stringify(context.rankSnapshot) !== JSON.stringify(previous.rankSnapshot));
  const pendingContext: PendingMatchRecord = { ...previous, ...(context.matchMode != null ? {matchMode:context.matchMode} : {}), ...(context.rankSnapshot != null ? {rankSnapshot:context.rankSnapshot} : {}) };
  const recommendations = [...previous.recommendations];
  const minute = Math.floor(gameTime / 60) * 60;
  const choice = choices[0];
  if (!choice || !Number.isInteger(choice.itemId) || !Number.isFinite(choice.score)) { if(contextChanged){cache.pending[matchId]=pendingContext;write(accountId,cache,storage);} return; }
  const { itemId, score, ...itemContext } = choice;
  const entry: RecommendationSnapshot = { gameTime: minute, recommendedItemId: itemId, score, ...itemContext };
  const previousEvent = recommendations.at(-1);
  const signature = (value: RecommendationSnapshot) => JSON.stringify({ item:value.recommendedItemId, reasons:[...(value.reasonCodes??[])].sort(), threats:(value.enemyThreats??[]).map(enemy=>[enemy.heroId,Math.round(enemy.weight*4)]).sort((a,b)=>Number(a[0])-Number(b[0])), phase:value.phase, core:value.normalCoreItemId, lane:value.laneState });
  if (previousEvent && signature(previousEvent) === signature(entry)) { if(contextChanged){cache.pending[matchId]=pendingContext;write(accountId,cache,storage);} return; }
  recommendations.push(entry);
  cache.pending[matchId] = { ...pendingContext, heroId, recommendations: recommendations.slice(-240) };
  write(accountId, cache, storage);
}

export function completeRecommendationOutcome(accountId: number, payload: unknown, storage: StorageLike): RecommendationOutcome | null {
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !payload || typeof payload !== "object") return null;
  const match = payload as Record<string, unknown>;
  const matchId = match.matchId ?? match.match_id;
  if (!Number.isSafeInteger(matchId) || (match.matchWasAbandoned ?? match.match_was_abandoned) === true) return null;
  const cache = read(accountId, storage);
  const previousOutcome = cache.completed[matchId as number];
  const players = Array.isArray(match.players) ? match.players : [];
  const player = players.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).account_id === accountId) as Record<string, unknown> | undefined;
  if (!player || !Number.isInteger(player.hero_id) || typeof player.playerWon !== "boolean") return null;
  const itemRows = Array.isArray(player.items) ? player.items : [];
  const actualPurchases = itemRows.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>, itemId = item.item_id, gameTime = item.game_time_s;
    return Number.isInteger(itemId) && Number.isFinite(gameTime) && (gameTime as number) >= 0 ? [{ itemId: itemId as number, gameTime: gameTime as number }] : [];
  });
  const metrics = player.metrics && typeof player.metrics === "object" ? player.metrics as Record<string, unknown> : {};
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const durationSeconds = number(match.duration_s ?? match.duration);
  const pending = cache.pending[matchId as number];
  const outcome: RecommendationOutcome = {
    matchId: matchId as number, heroId: player.hero_id as number,
    recommendations: pending?.heroId === player.hero_id ? pending.recommendations : previousOutcome?.recommendations ?? [],
    actualPurchases: [...new Map([...previousOutcome?.actualPurchases ?? [], ...actualPurchases].map(item=>[`${item.itemId}:${item.gameTime}`,item])).values()].sort((a,b)=>a.gameTime-b.gameTime),
    result: player.playerWon ? "win" : "loss", durationSeconds: durationSeconds ?? previousOutcome?.durationSeconds,
    date: number(match.start_time ?? match.startTime) ?? previousOutcome?.date, netWorth: number(player.net_worth ?? metrics.netWorth) ?? previousOutcome?.netWorth,
    matchMode: typeof (match.match_mode_parsed ?? match.matchMode) === "string" ? String(match.match_mode_parsed ?? match.matchMode) : pending?.matchMode ?? previousOutcome?.matchMode ?? null,
    rankSnapshot: pending?.rankSnapshot ?? previousOutcome?.rankSnapshot ?? null,
    performance: { kills: number(player.kills) ?? previousOutcome?.performance.kills ?? null, deaths: number(player.deaths) ?? previousOutcome?.performance.deaths ?? null, assists: number(player.assists) ?? previousOutcome?.performance.assists ?? null, spm: number(metrics.soulsPerMinute) ?? previousOutcome?.performance.spm ?? null, kda: number(metrics.kdaRatio) ?? previousOutcome?.performance.kda ?? null, damagePerMinute: number(metrics.damagePerMinute) ?? previousOutcome?.performance.damagePerMinute ?? null, killParticipation: number(metrics.killParticipation) ?? previousOutcome?.performance.killParticipation ?? null, mvpScore: number(player.mvpScore) ?? previousOutcome?.performance.mvpScore ?? null },
  };
  cache.completed[outcome.matchId] = outcome;
  delete cache.pending[outcome.matchId];
  write(accountId, cache, storage);
  return outcome;
}

export function recommendationOutcomeCache(accountId: number, storage: StorageLike): OutcomeCache {
  return read(accountId, storage);
}
