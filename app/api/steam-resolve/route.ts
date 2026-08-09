export const runtime = "edge";

const STEAM_ID64_BASE = BigInt("76561197960265728");

function firstXmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get("url")?.trim() ?? "";
  let profileUrl: URL;
  try { profileUrl = new URL(input); } catch { return Response.json({ error: "Invalid Steam profile URL" }, { status: 400 }); }
  if (profileUrl.hostname !== "steamcommunity.com" && !profileUrl.hostname.endsWith(".steamcommunity.com")) return Response.json({ error: "Only Steam Community URLs are supported" }, { status: 400 });
  if (!/^\/(id|profiles)\//i.test(profileUrl.pathname)) return Response.json({ error: "Unsupported Steam profile URL" }, { status: 400 });
  profileUrl.search = "?xml=1";
  try {
    const response = await fetch(profileUrl.toString(), { headers: { "User-Agent": "Counterlock match importer" } });
    if (!response.ok) return Response.json({ error: "Steam profile was not found" }, { status: 404 });
    const xml = await response.text();
    const steamId64 = firstXmlValue(xml, "steamID64");
    const numericId = BigInt(steamId64);
    const accountId = numericId - STEAM_ID64_BASE;
    if (accountId <= BigInt(0) || accountId > BigInt("4294967295")) throw new Error("Invalid account id");
    return Response.json({
      account_id: Number(accountId),
      personaname: firstXmlValue(xml, "steamID") || profileUrl.pathname.split("/").filter(Boolean).at(-1) || "Steam player",
      profileurl: input,
      avatar: firstXmlValue(xml, "avatarMedium"),
    });
  } catch { return Response.json({ error: "Steam profile could not be resolved" }, { status: 404 }); }
}
