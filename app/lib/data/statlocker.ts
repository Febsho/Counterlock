import { buildPersonalHeroProfile, type PersonalHeroProfile, type PersonalMatch } from "../build-engine/personal-profile.ts";
import { DEADLOCK_API } from "./deadlock-api.ts";

export type StatlockerStatus = "connected" | "not_configured" | "unauthorized" | "forbidden" | "rate_limited" | "unavailable";
export type StatlockerProfile = { accountId: number; name: string | null; avatarUrl: string | null; ppScore: number | null; estimatedRankNumber: number | null; region: string | null };
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
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(statlockerProxy("profiles"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids), signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!response.ok) return { status: "unavailable" as const, profiles: [] };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return { status: "unavailable" as const, profiles: [] };
    const data = payload as { status?: StatlockerStatus; profiles?: unknown };
    const allowed: StatlockerStatus[] = ["connected", "not_configured", "unauthorized", "forbidden", "rate_limited", "unavailable"];
    const profiles = Array.isArray(data.profiles) ? data.profiles.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const profile = raw as Record<string, unknown>;
      const rank = profile.estimatedRankNumber;
      return Number.isInteger(profile.accountId) && missing.includes(profile.accountId as number)
        ? [{ accountId: profile.accountId as number, name: typeof profile.name === "string" ? profile.name : null,
          avatarUrl: typeof profile.avatarUrl === "string" ? profile.avatarUrl : null,
          ppScore: Number.isFinite(profile.ppScore) ? profile.ppScore as number : null,
          estimatedRankNumber: Number.isInteger(rank) && (rank as number) >= 11 && (rank as number) <= 116 ? rank as number : null,
          region: typeof profile.region === "string" ? profile.region : null }] : [];
    }) : [];
    const status = allowed.includes(data.status as StatlockerStatus) ? data.status! : "unavailable" as const;
    const fetched = new Map(profiles.map((profile) => [profile.accountId, profile]));
    missing.forEach((id) => {
      const profile = fetched.get(id) ?? null;
      // Missing names should be retried while a live roster is still present.
      const ttl = profile?.name ? 15 * 60_000 : 60_000;
      profileCache.set(id, { profile, until: Date.now() + ttl, status });
    });
    return { status, profiles };
  } catch (error) {
    console.warn("Optional Statlocker profile source is unavailable; recommendations use live and Deadlock API evidence.", error);
    return { status: "unavailable" as const, profiles: [] };
  }
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
    const ids = history.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>, id = row.match_id ?? row.matchId;
      const matchHero = row.hero_id ?? row.heroId;
      return Number.isSafeInteger(id) && Number.isInteger(matchHero) && matchHero === heroId && !cachedIds.has(id as number) ? [id as number] : [];
    }).slice(0, Math.max(0, 50 - cached.filter((match) => match.heroId === heroId).length));
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
