export const runtime = "edge";

/** Fetch completed match details through the documented Statlocker batch endpoint. */
export async function POST(request: Request) {
  const apiKey = process.env.STATLOCKER_API_KEY;
  if (!apiKey) return Response.json({ status: "not_configured", matches: [] });
  let ids: unknown;
  try { ids = await request.json(); } catch { return Response.json({ status: "invalid_request" }, { status: 400 }); }
  if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return Response.json({ status: "invalid_request" }, { status: 400 });
  const results: unknown[] = [];
  try {
    for (let index = 0; index < ids.length; index += 10) {
      const response = await fetch("https://statlocker.gg/api/public/matches", { method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey }, body: JSON.stringify(ids.slice(index, index + 10)) });
      if (!response.ok) return Response.json({ status: response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 429 ? "rate_limited" : "unavailable", matches: [] });
      const batch: unknown = await response.json();
      if (!Array.isArray(batch)) return Response.json({ status: "unavailable", matches: [] });
      results.push(...batch);
    }
    return Response.json({ status: "connected", matches: results }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    console.warn("Statlocker match history lookup failed; population recommendations remain available.", error);
    return Response.json({ status: "unavailable", matches: [] });
  }
}
