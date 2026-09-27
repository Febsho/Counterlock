export const runtime = "edge";

const STEAM_ID64_BASE = BigInt("76561197960265728");

async function steamProfile(accountId: number) {
  try {
    const response = await fetch(`https://steamcommunity.com/profiles/${STEAM_ID64_BASE + BigInt(accountId)}?xml=1`, {
      headers: { "User-Agent": "Counterlock live roster" },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const rawName = xml.match(/<steamID>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/steamID>/i)?.[1]?.trim();
    const name = rawName?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    const avatar = xml.match(/<avatarMedium>([\s\S]*?)<\/avatarMedium>/i)?.[1]?.trim();
    return {
      name: name && name.length <= 80 ? name : null,
      avatarUrl: avatar?.startsWith("https://") ? avatar : null,
    };
  } catch { return null; }
}

async function steamFallback(ids: number[]) {
  return Promise.all(ids.map(async (accountId) => ({ accountId, ...(await steamProfile(accountId)) })));
}

/** Server-side only Statlocker proxy. The API key is never accepted from a client. */
export async function POST(request: Request) {
  const apiKey = process.env.STATLOCKER_API_KEY;
  let accountIds: unknown;
  try { accountIds = await request.json(); } catch { return Response.json({ status: "invalid_request" }, { status: 400 }); }
  if (!Array.isArray(accountIds) || accountIds.length > 100 || accountIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 4_294_967_295)) {
    return Response.json({ status: "invalid_request" }, { status: 400 });
  }
  const ids = accountIds as number[];
  if (!apiKey) {
    const profiles = await Promise.all(ids.map(async (accountId) => ({ accountId, ...(await steamProfile(accountId)), ppScore: null, estimatedRankNumber: null, region: null })));
    return Response.json({ status: "not_configured", profiles }, { headers: { "Cache-Control": "private, max-age=900" } });
  }
  try {
    const response = await fetch("https://statlocker.gg/api/public/profiles", {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify(accountIds),
    });
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      const profiles = (await steamFallback(ids)).filter((profile) => profile.name).map((profile) => ({ ...profile, avatarUrl: profile.avatarUrl ?? null, ppScore: null, estimatedRankNumber: null, region: null }));
      const status = response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : "rate_limited";
      return Response.json({ status, profiles }, { headers: { "Cache-Control": "private, max-age=900" } });
    }
    if (!response.ok) {
      const profiles = (await steamFallback(ids)).filter((profile) => profile.name).map((profile) => ({ ...profile, avatarUrl: profile.avatarUrl ?? null, ppScore: null, estimatedRankNumber: null, region: null }));
      return Response.json({ status: "unavailable", profiles }, { headers: { "Cache-Control": "private, max-age=900" } });
    }
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
        accountId: profile.accountId as number,
        name: safeText(profile.name, 80),
        avatarUrl: safeUrl(profile.avatarUrl),
        ppScore: Number.isFinite(profile.ppScore) ? profile.ppScore as number : null,
        estimatedRankNumber: Number.isInteger(rank) && (rank as number) >= 11 && (rank as number) <= 116 && (rank as number) % 10 >= 1 && (rank as number) % 10 <= 6 ? rank : null,
        region: safeText(profile.region, 24),
      }];
    });
    const missingNames = new Set(ids.filter((id) => !profiles.find((profile) => profile.accountId === id)?.name));
    if (missingNames.size) {
      const steamProfiles = await steamFallback([...missingNames]);
      const steamById = new Map(steamProfiles.map((profile) => [profile.accountId, profile]));
      for (const profile of profiles) {
        const steam = steamById.get(profile.accountId);
        if (steam?.name) profile.name = steam.name;
        if (!profile.avatarUrl && steam?.avatarUrl) profile.avatarUrl = steam.avatarUrl;
      }
      for (const steam of steamProfiles) if (steam.name && !profiles.some((profile) => profile.accountId === steam.accountId)) {
        profiles.push({ accountId: steam.accountId, name: steam.name, avatarUrl: steam.avatarUrl ?? null, ppScore: null, estimatedRankNumber: null, region: null });
      }
    }
    return Response.json({ status: "connected", profiles }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    console.warn("Statlocker profile lookup failed; continuing without skill priors.", error);
    const profiles = (await steamFallback(ids)).filter((profile) => profile.name).map((profile) => ({ ...profile, avatarUrl: profile.avatarUrl ?? null, ppScore: null, estimatedRankNumber: null, region: null }));
    return Response.json({ status: "unavailable", profiles }, { headers: { "Cache-Control": "private, max-age=900" } });
  }
}
