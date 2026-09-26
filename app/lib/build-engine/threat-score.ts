export type ThreatPlayer = {
  heroId: number;
  netWorth?: number | null;
  soulsPerMinute?: number | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  statlockerPP?: number | null;
};

const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const normalize = (value: number | null, mean: number | null) => value == null || mean == null ? null : Math.max(-1, Math.min(1, (value - mean) / Math.max(1000, mean * 0.35)));

/** Relative live pressure. Unknown telemetry is omitted, never treated as zero. */
export function scoreThreats(players: ThreatPlayer[], gameTimeSeconds: number | null) {
  const knownWorth = players.flatMap((p) => p.netWorth == null ? [] : [p.netWorth]);
  const worthMean = average(knownWorth);
  const knownSpm = players.flatMap((p) => p.soulsPerMinute == null ? [] : [p.soulsPerMinute]);
  const spmMean = average(knownSpm);
  const kdaValues = players.map((p) => p.kills == null || p.deaths == null || p.assists == null ? null : (p.kills + p.assists * 0.5) / Math.max(1, p.deaths));
  const knownKda = kdaValues.filter((v): v is number => v != null);
  const kdaMean = average(knownKda);
  const values = players.map((player, index) => {
    const parts: Array<[number, number]> = [];
    const econ = normalize(player.netWorth ?? null, worthMean);
    const spm = normalize(player.soulsPerMinute ?? null, spmMean);
    // The attached provider derives SPM from net worth and elapsed time; do not
    // count the same economic signal twice. SPM is a fallback when worth is absent.
    if (econ != null) parts.push([econ, 0.78]);
    else if (spm != null) parts.push([spm, 0.78]);
    const kda = normalize(kdaValues[index] ?? null, kdaMean);
    if (kda != null) parts.push([kda, 0.23]);
    if (player.statlockerPP != null) {
      const ppMean = average(players.flatMap((p) => p.statlockerPP == null ? [] : [p.statlockerPP]));
      const prior = normalize(player.statlockerPP, ppMean);
      if (prior != null) parts.push([prior, 0.03]);
    }
    const denominator = parts.reduce((sum, [, weight]) => sum + weight, 0);
    const relative = denominator ? parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / denominator : 0;
    const lateGameFactor = gameTimeSeconds == null ? 1 : Math.min(1, 0.72 + gameTimeSeconds / 5400);
    return { heroId: player.heroId, score: 1 + relative * 0.3 * lateGameFactor };
  });
  const min = Math.min(...values.map((v) => v.score), 1);
  const shifted = values.map((v) => ({ ...v, score: Math.max(0.2, v.score - min + 0.2) }));
  const total = shifted.reduce((sum, v) => sum + v.score, 0);
  return shifted.map((v) => ({ ...v, weight: total ? v.score / total : 1 / Math.max(1, shifted.length) })).sort((a, b) => b.weight - a.weight);
}
