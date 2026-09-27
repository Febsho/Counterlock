const STEAM_ID64_BASE = BigInt("76561197960265728");
const MAX_ACCOUNT_ID = BigInt("4294967295");

export function steamAccountId(input: string): number | null {
  const value = input.trim();
  const steam3 = value.match(/^\[?U:1:(\d+)\]?$/i)?.[1];
  const profile = value.match(/steamcommunity\.com\/profiles\/(\d+)/i)?.[1];
  const raw = steam3 ?? profile ?? (/^\d+$/.test(value) ? value : "");
  if (!raw) return null;
  try {
    const parsed = BigInt(raw);
    const accountId = parsed > MAX_ACCOUNT_ID ? parsed - STEAM_ID64_BASE : parsed;
    return accountId > BigInt(0) && accountId <= MAX_ACCOUNT_ID ? Number(accountId) : null;
  } catch {
    return null;
  }
}
