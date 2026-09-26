const tiers = ["Initiate", "Seeker", "Alchemist", "Arcanist", "Ritualist", "Emissary", "Archon", "Oracle", "Phantom", "Ascendant", "Eternus"];

export type PlayerRank = { tier: number; subrank: number; label: string; badgeUrl: string };
const numerals = ["I", "II", "III", "IV", "V", "VI"];

export function playerRank(rankNumber: number | null | undefined): PlayerRank | null {
  if (!Number.isInteger(rankNumber) || rankNumber == null) return null;
  const tier = Math.floor(rankNumber / 10);
  const subrank = rankNumber % 10;
  if (tier < 1 || tier > tiers.length || subrank < 1 || subrank > 6) return null;
  return {
    tier,
    subrank,
    label: `${tiers[tier - 1]} ${numerals[subrank - 1]}`,
    badgeUrl: `https://assets.deadlock-api.com/images/ranks/rank${tier}/badge_lg_subrank${subrank}.webp`,
  };
}

export const getRankTier = (rankNumber: number | null | undefined) => playerRank(rankNumber)?.tier ?? null;
export const getRankSubrank = (rankNumber: number | null | undefined) => playerRank(rankNumber)?.subrank ?? null;
export const getRankName = (rankNumber: number | null | undefined) => playerRank(rankNumber)?.label ?? null;
export const getRankBadgeUrl = (rankNumber: number | null | undefined) => playerRank(rankNumber)?.badgeUrl ?? null;
export const formatRank = (rankNumber: number | null | undefined) => playerRank(rankNumber)?.label ?? "Rank —";
