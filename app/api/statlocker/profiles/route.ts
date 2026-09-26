export const runtime = "edge";

/** Server-side only Statlocker proxy. The API key is never accepted from a client. */
export async function POST(request: Request) {
  const apiKey = process.env.STATLOCKER_API_KEY;
  if (!apiKey) return Response.json({ status: "not_configured", profiles: [] }, { status: 200 });
  let accountIds: unknown;
  try { accountIds = await request.json(); } catch { return Response.json({ status: "invalid_request" }, { status: 400 }); }
  if (!Array.isArray(accountIds) || accountIds.length > 100 || accountIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 4_294_967_295)) {
    return Response.json({ status: "invalid_request" }, { status: 400 });
  }
  try {
    const response = await fetch("https://statlocker.gg/api/public/profiles", {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify(accountIds),
    });
    if (response.status === 401) return Response.json({ status: "unauthorized", profiles: [] }, { status: 200 });
    if (response.status === 403) return Response.json({ status: "forbidden", profiles: [] }, { status: 200 });
    if (response.status === 429) return Response.json({ status: "rate_limited", profiles: [] }, { status: 200 });
    if (!response.ok) return Response.json({ status: "unavailable", profiles: [] }, { status: 200 });
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) return Response.json({ status: "unavailable", profiles: [] }, { status: 200 });
    const requestedIds = new Set(accountIds as number[]);
    const profiles = payload.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const profile = value as Record<string, unknown>;
      if (!Number.isInteger(profile.accountId) || !requestedIds.has(profile.accountId as number)) return [];
      const safeText = (input: unknown, max: number) => typeof input === "string" && input.trim().length > 0 ? input.trim().slice(0, max) : null;
      const safeUrl = (input: unknown) => {
        if (typeof input !== "string") return null;
        try { const url = new URL(input); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
      };
      const rank = profile.estimatedRankNumber;
      return [{
        accountId: profile.accountId,
        name: safeText(profile.name, 80),
        avatarUrl: safeUrl(profile.avatarUrl),
        ppScore: Number.isFinite(profile.ppScore) ? profile.ppScore : null,
        estimatedRankNumber: Number.isInteger(rank) && (rank as number) >= 11 && (rank as number) <= 116 && (rank as number) % 10 >= 1 && (rank as number) % 10 <= 6 ? rank : null,
        region: safeText(profile.region, 24),
      }];
    });
    return Response.json({ status: "connected", profiles }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    console.warn("Statlocker profile lookup failed; continuing without skill priors.", error);
    return Response.json({ status: "unavailable", profiles: [] }, { status: 200 });
  }
}
