export type StatlockerStatus = "connected" | "not_configured" | "unauthorized" | "forbidden" | "rate_limited" | "unavailable";
export type StatlockerProfile = { accountId: number; ppScore: number };
const profileCache = new Map<string, { until: number; value: { status: StatlockerStatus; profiles: StatlockerProfile[] } }>();

/** Optional, server-keyed profile priors. Failures never prevent Deadlock recommendations. */
export async function fetchStatlockerProfiles(accountIds: number[]) {
  const ids = [...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b).slice(0, 12);
  if (!ids.length) return { status: "not_configured" as const, profiles: [] };
  const key = ids.join(",");
  const cached = profileCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
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
      return Number.isInteger(profile.accountId) && Number.isFinite(profile.ppScore)
        ? [{ accountId: profile.accountId as number, ppScore: profile.ppScore as number }] : [];
    }) : [];
    const value = { status: allowed.includes(data.status as StatlockerStatus) ? data.status! : "unavailable" as const, profiles };
    profileCache.set(key, { value, until: Date.now() + 15 * 60_000 });
    return value;
  } catch (error) {
    console.warn("Optional Statlocker profile source is unavailable; recommendations use live and Deadlock API evidence.", error);
    return { status: "unavailable" as const, profiles: [] };
  }
}
