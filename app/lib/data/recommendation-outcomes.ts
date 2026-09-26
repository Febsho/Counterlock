export type RecommendationSnapshot = { gameTime: number; recommendedItemId: number; score: number };
export type ActualPurchase = { itemId: number; gameTime: number };
export type RecommendationOutcome = {
  matchId: number; heroId: number; recommendations: RecommendationSnapshot[]; actualPurchases: ActualPurchase[];
  result: "win" | "loss"; performance: { spm: number | null; kda: number | null; damagePerMinute: number | null; killParticipation: number | null; mvpScore: number | null };
};

export type OutcomeCache = { pending: Record<number, { heroId: number; recommendations: RecommendationSnapshot[] }>; completed: Record<number, RecommendationOutcome> };
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

export function recordRecommendationSnapshot(accountId: number, matchId: number, heroId: number, gameTime: number, choices: Array<{ itemId: number; score: number }>, storage: StorageLike): void {
  if (![accountId, matchId, heroId].every((value) => Number.isSafeInteger(value) && value > 0) || !Number.isFinite(gameTime)) return;
  const cache = read(accountId, storage);
  if (cache.completed[matchId]) return;
  const previous = cache.pending[matchId] ?? { heroId, recommendations: [] };
  if (previous.heroId !== heroId) return;
  const minute = Math.floor(gameTime / 60) * 60;
  const recommendations = [...previous.recommendations];
  choices.slice(0, 3).forEach(({ itemId, score }) => {
    if (!Number.isInteger(itemId) || !Number.isFinite(score)) return;
    const entry = { gameTime: minute, recommendedItemId: itemId, score };
    const index = recommendations.findIndex((value) => value.gameTime === minute && value.recommendedItemId === itemId);
    if (index >= 0) recommendations[index] = entry;
    else recommendations.push(entry);
  });
  cache.pending[matchId] = { heroId, recommendations: recommendations.slice(-240) };
  write(accountId, cache, storage);
}

export function completeRecommendationOutcome(accountId: number, payload: unknown, storage: StorageLike): RecommendationOutcome | null {
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !payload || typeof payload !== "object") return null;
  const match = payload as Record<string, unknown>;
  const matchId = match.matchId ?? match.match_id;
  if (!Number.isSafeInteger(matchId) || (match.matchWasAbandoned ?? match.match_was_abandoned) === true) return null;
  const cache = read(accountId, storage);
  if (cache.completed[matchId as number]) return cache.completed[matchId as number];
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
  const pending = cache.pending[matchId as number];
  const outcome: RecommendationOutcome = {
    matchId: matchId as number, heroId: player.hero_id as number,
    recommendations: pending?.heroId === player.hero_id ? pending.recommendations : [],
    actualPurchases, result: player.playerWon ? "win" : "loss",
    performance: { spm: number(metrics.soulsPerMinute), kda: number(metrics.kdaRatio), damagePerMinute: number(metrics.damagePerMinute), killParticipation: number(metrics.killParticipation), mvpScore: number(player.mvpScore) },
  };
  cache.completed[outcome.matchId] = outcome;
  delete cache.pending[outcome.matchId];
  write(accountId, cache, storage);
  return outcome;
}

export function recommendationOutcomeCache(accountId: number, storage: StorageLike): OutcomeCache {
  return read(accountId, storage);
}
