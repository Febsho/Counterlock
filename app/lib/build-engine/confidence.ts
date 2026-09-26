/** Smooth confidence for observational win-rate evidence. */
export function sampleConfidence(matches: number, halfTrustAt = 400): number {
  if (!Number.isFinite(matches) || matches <= 0) return 0;
  return matches / (matches + halfTrustAt);
}

/** Smoothly blend exact-lineup evidence in without a hard sample-count cliff. */
export function exactLineupConfidence(matches: number): number {
  return sampleConfidence(matches, 800);
}

export function shrinkLift(lift: number, matches: number, cap = 0.08): number {
  if (!Number.isFinite(lift)) return 0;
  return Math.max(-cap, Math.min(cap, lift)) * sampleConfidence(matches);
}

export function confidenceTier(matches: number): "limited" | "medium" | "high" {
  return matches >= 2000 ? "high" : matches >= 250 ? "medium" : "limited";
}
