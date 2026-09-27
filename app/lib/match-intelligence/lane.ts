export type LaneName = "yellow" | "blue" | "green" | "purple" | "unknown";
export type LaneContext = {
  ownHeroId: number; laneOpponentIds: number[]; lane: LaneName; gameTimeSeconds: number;
  ownNetWorth: number | null; opponentNetWorth: number | null; laneState: "ahead" | "even" | "behind" | "unknown";
};
export type LaneIntent = "SURVIVE" | "EVEN" | "PRESSURE" | "FARM";

export function laneState(own: number | null, opponents: Array<number | null>): LaneContext["laneState"] {
  const known = opponents.filter((value): value is number => value != null && Number.isFinite(value));
  if (own == null || !known.length) return "unknown";
  const delta = own - known.reduce((a, b) => a + b, 0) / known.length;
  return delta < -1800 ? "behind" : delta > 1800 ? "ahead" : "even";
}

export function inferLaneIntent(state: LaneContext["laneState"], deathDelta = 0, matchupFit = 0): LaneIntent {
  if (state === "behind" || deathDelta >= 2) return "SURVIVE";
  if (state === "ahead" && matchupFit >= 0.55) return "PRESSURE";
  if (state === "even") return "FARM";
  return "EVEN";
}

/** Early lane weighting decays to zero by the transition into mid game. */
export function laneBuyScore(input: { matchupFit: number; earlyHeroFit: number; sustainNeed: number; pressureFit: number; earlyTimingFit: number; affordabilityFit: number; lanePowerSpikeFit: number; deviationPenalty: number; gameTimeSeconds: number }): number {
  const phaseWeight = Math.max(0, Math.min(1, 1 - input.gameTimeSeconds / 600));
  const fit = input.matchupFit * .24 + input.earlyHeroFit * .18 + input.sustainNeed * .16 + input.pressureFit * .13 + input.earlyTimingFit * .12 + input.affordabilityFit * .08 + input.lanePowerSpikeFit * .09 - input.deviationPenalty;
  return fit * phaseWeight;
}
