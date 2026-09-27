export type PurchaseState = { status: "unknown"; shortfall: null } | { status: "buy"; shortfall: 0 } | { status: "save"; shortfall: number };

/** Affordability uses only the shop's unspent souls and a known item cost. */
export function purchaseState(cost: number | null | undefined, unspentSouls: number | null | undefined): PurchaseState {
  if (cost == null || unspentSouls == null || !Number.isFinite(cost) || !Number.isFinite(unspentSouls) || cost < 0 || unspentSouls < 0) return { status: "unknown", shortfall: null };
  return unspentSouls >= cost ? { status: "buy", shortfall: 0 } : { status: "save", shortfall: cost - unspentSouls };
}

export function buildStageAt(gameTimeSeconds: number | null | undefined): "early" | "mid" | "late" {
  const seconds = gameTimeSeconds != null && Number.isFinite(gameTimeSeconds) ? Math.max(0, gameTimeSeconds) : 0;
  return seconds < 720 ? "early" : seconds < 1260 ? "mid" : "late";
}
