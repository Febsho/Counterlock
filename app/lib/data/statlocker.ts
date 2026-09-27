import { buildPersonalHeroProfile, type PersonalHeroProfile, type PersonalMatch } from "../build-engine/personal-profile.ts";
import { DEADLOCK_API } from "./deadlock-api.ts";

export type StatlockerStatus = "connected" | "not_configured" | "unauthorized" | "forbidden" | "rate_limited" | "unavailable";
export type StatlockerProfile = { accountId: number; name: string | null; avatarUrl: string | null; ppScore: number | null; estimatedRankNumber: number | null; rankSource?: "deadlock_api" | "statlocker"; region: string | null };
const profileCache = new Map<number, { until: number; profile: StatlockerProfile | null; status: StatlockerStatus }>();
const profileRequests = new Map<string, Promise<{ status: StatlockerStatus; profiles: StatlockerProfile[] }>>();
const statlockerProxy = (path: string) => {
  const origin = process.env.NEXT_PUBLIC_COUNTERLOCK_API_ORIGIN?.replace(/\/+$/, "");
  return `${origin ?? ""}/api/statlocker/${path}`;
};

/** Optional, server-keyed profile priors. Failures never prevent Deadlock recommendations. */
export async function fetchStatlockerProfiles(accountIds: number[]) {
  const ids = [...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).slice(0, 12);
  if (!ids.length) return { status: "not_configured" as const, profiles: [] };
  const now = Date.now();
  const missing = ids.filter((id) => (profileCache.get(id)?.until ?? 0) <= now);
  const cachedProfiles = ids.flatMap((id) => { const entry = profileCache.get(id); return entry?.until && entry.until > now && entry.profile ? [entry.profile] : []; });
  if (!missing.length) return { status: profileCache.get(ids[0])?.status ?? "connected", profiles: cachedProfiles };
  const key = missing.join(",");
  const pending = profileRequests.get(key);
  if (pending) {
    const result = await pending;
    return { status: result.status, profiles: [...cachedProfiles, ...result.profiles].filter((profile, index, list) => list.findIndex((item) => item.accountId === profile.accountId) === index) };
  }
  const request = (async () => {
  const query = new URLSearchParams({ account_ids: ids.join(",") }).toString();
  const getJson = async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`Profile source returned ${response.status}`);
    return response.json() as Promise<unknown>;
  };
  const [statlockerResult, steamResult, ranksResult] = await Promise.allSettled([
    (async () => {
      const response = await fetch(statlockerProxy("profiles"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids), signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error(`Statlocker returned ${response.status}`);
      return await response.json() as { status?: StatlockerStatus; profiles?: unknown };
    })(),
    getJson(`${DEADLOCK_API}/players/steam?${query}`),
    getJson(`${DEADLOCK_API}/players/rank?${query}`),
  ]);
  const byId = new Map<number, StatlockerProfile>();
  const steamRows = steamResult.status === "fulfilled" && Array.isArray(steamResult.value) ? steamResult.value : [];
  steamRows.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const row = raw as Record<string, unknown>, id = row.account_id;
    if (!Number.isInteger(id) || !missing.includes(id as number)) return;
    const profile: StatlockerProfile = byId.get(id as number) ?? { accountId: id as number, name: null, avatarUrl: null, ppScore: null, estimatedRankNumber: null, region: null };
    profile.name = typeof row.personaname === "string" && row.personaname.trim() ? row.personaname : profile.name;
    profile.avatarUrl = typeof row.avatarfull === "string" ? row.avatarfull : typeof row.avatar === "string" ? row.avatar : profile.avatarUrl;
    byId.set(profile.accountId, profile);
  });
  const rankRows = ranksResult.status === "fulfilled" && Array.isArray(ranksResult.value) ? ranksResult.value : [];
  rankRows.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const row = raw as Record<string, unknown>, id = row.account_id, badge = row.badge;
    if (!Number.isInteger(id) || !missing.includes(id as number)) return;
    const profile: StatlockerProfile = byId.get(id as number) ?? { accountId: id as number, name: null, avatarUrl: null, ppScore: null, estimatedRankNumber: null, region: null };
    profile.estimatedRankNumber = Number.isInteger(badge) && (badge as number) >= 11 && (badge as number) <= 116 ? badge as number : null;
    profile.rankSource = "deadlock_api";
    byId.set(profile.accountId, profile);
  });
  const statlockerData = statlockerResult.status === "fulfilled" ? statlockerResult.value : null;
  const allowed: StatlockerStatus[] = ["connected", "not_configured", "unauthorized", "forbidden", "rate_limited", "unavailable"];
  const status = statlockerData && allowed.includes(statlockerData.status as StatlockerStatus) ? statlockerData.status! :
    steamResult.status === "fulfilled" || ranksResult.status === "fulfilled" ? "connected" as const : "unavailable" as const;
  if (Array.isArray(statlockerData?.profiles)) statlockerData.profiles.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const row = raw as Record<string, unknown>, id = row.accountId, rank = row.estimatedRankNumber;
    if (!Number.isInteger(id) || !missing.includes(id as number)) return;
    const profile: StatlockerProfile = byId.get(id as number) ?? { accountId: id as number, name: null, avatarUrl: null, ppScore: null, estimatedRankNumber: null, region: null };
    profile.name = profile.name ?? (typeof row.name === "string" ? row.name : null);
    profile.avatarUrl = profile.avatarUrl ?? (typeof row.avatarUrl === "string" ? row.avatarUrl : null);
    profile.ppScore = Number.isFinite(row.ppScore) ? row.ppScore as number : null;
    if (!profile.rankSource && Number.isInteger(rank) && (rank as number) >= 11 && (rank as number) <= 116) { profile.estimatedRankNumber = rank as number; profile.rankSource = "statlocker"; }
    profile.region = typeof row.region === "string" ? row.region : null;
    byId.set(profile.accountId, profile);
  });
  const profiles = [...byId.values()];
  missing.forEach((id) => {
    const profile = byId.get(id) ?? null;
    profileCache.set(id, { profile, until: Date.now() + (profile?.name ? 15 * 60_000 : 60_000), status });
  });
  return { status, profiles };
  })();
  profileRequests.set(key, request);
  try {
    const result = await request;
    return { status: result.status, profiles: [...cachedProfiles, ...result.profiles].filter((profile, index, list) => list.findIndex((item) => item.accountId === profile.accountId) === index) };
  } finally { profileRequests.delete(key); }
}

const personalCacheKey = (accountId: number, heroId: number) => `counterlock:personal-matches:v1:${accountId}:${heroId}`;
function validPersonalMatch(value: unknown, accountId: number): PersonalMatch | null {
  if (!value || typeof value !== "object") return null;
  const match = value as Record<string, unknown>;
  const player = Array.isArray(match.players) ? match.players.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).account_id === accountId) as Record<string, unknown> | undefined : undefined;
  const matchId = match.matchId ?? match.match_id;
  if (!Number.isSafeInteger(matchId) || !player || !Number.isInteger(player.hero_id)) return null;
  const metrics = (player.metrics && typeof player.metrics === "object" ? player.metrics : {}) as Record<string, unknown>;
  const items = Array.isArray(player.items) ? player.items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const itemId = item.item_id ?? item.itemId, time = item.game_time_s ?? item.gameTimeSeconds;
    return Number.isInteger(itemId) && Number.isFinite(time) ? [{ itemId: itemId as number, gameTimeSeconds: time as number }] : [];
  }) : [];
  const duration = match.matchDurationSeconds ?? match.match_duration_s;
  return { matchId: matchId as number, heroId: player.hero_id as number, won: player.playerWon === true || player.player_won === true,
    gameDurationSeconds: Number.isFinite(duration) ? duration as number : 0, items,
    kda: finite(metrics.kdaRatio ?? metrics.kda), spm: finite(metrics.soulsPerMinute ?? metrics.spm),
    damagePerMinute: finite(metrics.damagePerMinute), killParticipation: finite(metrics.killParticipation), mvpScore: finite(player.mvpScore ?? player.mvp_score) };
}
function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

/** Incrementally cache at most the last 50 completed current-hero matches per local account. */
export async function syncPersonalHeroProfile(accountId: number, heroId: number, profile: StatlockerProfile): Promise<PersonalHeroProfile | null> {
  if (typeof window === "undefined" || !Number.isInteger(accountId) || accountId <= 0 || !Number.isInteger(heroId) || heroId <= 0) return null;
  try {
    const cacheKey = personalCacheKey(accountId, heroId);
    let cached: PersonalMatch[] = [];
    try { const raw = localStorage.getItem(cacheKey); const parsed: unknown = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) cached = parsed.filter((row): row is PersonalMatch => Boolean(row && Number.isInteger(row.matchId) && Number.isInteger(row.heroId))); } catch { cached = []; }
    // Completed local recommendation reviews are first-party history too. Keep them
    // available to personal learning even when optional remote history is offline.
    try {
      const raw = localStorage.getItem(`counterlock:recommendation-outcomes:v1:${accountId}`);
      const parsed = raw ? JSON.parse(raw) as { completed?: Record<string, Record<string, unknown>> } : null;
      for (const value of Object.values(parsed?.completed ?? {})) {
        const matchId = value.matchId, matchHero = value.heroId;
        if (!Number.isSafeInteger(matchId) || matchHero !== heroId || !Array.isArray(value.actualPurchases)) continue;
        const performance = value.performance && typeof value.performance === "object" ? value.performance as Record<string, unknown> : {};
        const items = value.actualPurchases.flatMap(entry => { if (!entry || typeof entry !== "object") return []; const row=entry as Record<string,unknown>; return Number.isInteger(row.itemId)&&Number.isFinite(row.gameTime)?[{itemId:row.itemId as number,gameTimeSeconds:row.gameTime as number}]:[]; });
        cached.push({matchId:matchId as number,heroId,won:value.result==="win",gameDurationSeconds:finite(value.durationSeconds)??0,items,kda:finite(performance.kda),spm:finite(performance.spm),damagePerMinute:finite(performance.damagePerMinute),killParticipation:finite(performance.killParticipation),mvpScore:finite(performance.mvpScore)});
      }
    } catch { /* malformed local review data does not block profile refresh */ }
    const historyResponse = await fetch(`${DEADLOCK_API}/players/${accountId}/match-history`);
    if (!historyResponse.ok) return buildPersonalHeroProfile(accountId, heroId, cached, profile);
    const history: unknown = await historyResponse.json();
    if (!Array.isArray(history)) return buildPersonalHeroProfile(accountId, heroId, cached, profile);
    const cachedIds = new Set(cached.map((match) => match.matchId));
    const historyRows = history.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>, id = row.match_id ?? row.matchId;
      const matchHero = row.hero_id ?? row.heroId, result = row.player_match_outcome;
      return Number.isSafeInteger(id) && Number.isInteger(matchHero) && matchHero === heroId && !cachedIds.has(id as number) && (result === 1 || result === 2) ? [{ row, matchId: id as number, matchHero: matchHero as number, won: result === 1 }] : [];
    }).slice(0, Math.max(0, 50 - cached.filter((match) => match.heroId === heroId).length));
    const ids = historyRows.map((match) => match.matchId);
    cached.push(...historyRows.map(({ row, matchId, matchHero, won }) => ({ matchId, heroId: matchHero, won,
      gameDurationSeconds: finite(row.match_duration_s) ?? 0, items: [],
      kda: finite(row.player_kills) != null && finite(row.player_deaths) != null && finite(row.player_assists) != null ? ((finite(row.player_kills) ?? 0) + (finite(row.player_assists) ?? 0)) / Math.max(1, finite(row.player_deaths) ?? 0) : null,
      spm: null, damagePerMinute: null, killParticipation: null, mvpScore: null,
    })));
    for (let start = 0; start < ids.length; start += 50) {
      const response = await fetch(statlockerProxy("matches"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids.slice(start, start + 50)) });
      if (!response.ok) break;
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !Array.isArray((result as Record<string, unknown>).matches)) break;
      cached.push(...((result as { matches: unknown[] }).matches.flatMap((row) => { const parsed = validPersonalMatch(row, accountId); return parsed ? [parsed] : []; })));
    }
    cached = [...new Map(cached.filter((match) => match.heroId === heroId).sort((a, b) => b.matchId - a.matchId).slice(0, 50).map((match) => [match.matchId, match])).values()];
    try { localStorage.setItem(cacheKey, JSON.stringify(cached)); } catch { /* recommendations still use this session's in-memory profile */ }
    return buildPersonalHeroProfile(accountId, heroId, cached, profile);
  } catch (error) {
    console.warn("Optional Statlocker personal history unavailable; using population recommendations.", error);
    return null;
  }
}
