export type StatlockerStatus = "connected" | "not_configured" | "unauthorized" | "forbidden" | "rate_limited" | "unavailable";
export type StatlockerProfile = { accountId: number; name: string | null; avatarUrl: string | null; ppScore: number | null; estimatedRankNumber: number | null; region: string | null };
const profileCache = new Map<number, { until: number; profile: StatlockerProfile | null }>();
const profileRequests = new Map<string, Promise<{ status: StatlockerStatus; profiles: StatlockerProfile[] }>>();

/** Optional, server-keyed profile priors. Failures never prevent Deadlock recommendations. */
export async function fetchStatlockerProfiles(accountIds: number[]) {
  const ids = [...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).slice(0, 12);
  if (!ids.length) return { status: "not_configured" as const, profiles: [] };
  const now = Date.now();
  const missing = ids.filter((id) => (profileCache.get(id)?.until ?? 0) <= now);
  const cachedProfiles = ids.flatMap((id) => { const entry = profileCache.get(id); return entry?.until && entry.until > now && entry.profile ? [entry.profile] : []; });
  if (!missing.length) return { status: "connected" as const, profiles: cachedProfiles };
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
    const response = await fetch("/api/statlocker/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids), signal: controller.signal }).finally(() => clearTimeout(timeout));
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
    const until = Date.now() + 15 * 60_000;
    missing.forEach((id) => profileCache.set(id, { profile: fetched.get(id) ?? null, until }));
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
