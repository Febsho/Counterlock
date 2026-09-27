import type { ItemFlowStats } from "../data/deadlock-api.ts";

/** Build a deterministic high-support path through phase transitions. */
export function bestFlowPath(flow: ItemFlowStats | null, maxItems = 4): number[] {
  if (!flow?.nodes.length) return [];
  const sorted = [...flow.nodes].sort((a, b) => a.column - b.column || b.matches - a.matches || a.item_id - b.item_id);
  const score = new Map<string, { value: number; path: number[] }>();
  for (const node of sorted) {
    const key = `${node.column}:${node.item_id}`;
    const reached = Math.max(node.matches, flow.reached_per_column[node.column] ?? flow.baseline.matches, 1);
    const cohortShare = node.matches / reached;
    // adjusted_win_rate limits buy-affordability confounding; reached_per_column
    // discounts nodes supported by only a small sliver of the phase population.
    const baseValue = (Number.isFinite(node.adjusted_win_rate) ? node.adjusted_win_rate : 0.5) * Math.log1p(node.matches) * Math.sqrt(cohortShare);
    let best = { value: baseValue, path: [node.item_id] };
    for (const edge of flow.edges) {
      if (edge.to_item_id !== node.item_id || edge.from_column !== node.column - 1 || edge.matches < 20) continue;
      const previous = score.get(`${edge.from_column}:${edge.from_item_id}`);
      if (!previous) continue;
      const edgeSupport = Math.log1p(edge.matches) / Math.log1p(Math.max(1, node.matches));
      const candidate = { value: previous.value + baseValue + Math.min(1, edgeSupport), path: [...previous.path, node.item_id] };
      if (candidate.value > best.value) best = candidate;
    }
    score.set(key, best);
  }
  const terminal = [...score.values()].sort((a, b) => b.value - a.value || a.path.join(",").localeCompare(b.path.join(",")))[0];
  if (!terminal) return [];
  return [...new Set(terminal.path)].slice(0, maxItems);
}

export function flowCoreFit(flow: ItemFlowStats | null, itemId: number, phase: number) {
  const node = flow?.nodes.find((candidate) => candidate.item_id === itemId && candidate.column === phase);
  return node ? { rate: node.adjusted_win_rate, matches: node.matches, phase: node.column } : null;
}

/** Confidence-shrunk phase and purchase-chain evidence for the next-buy rank. */
export function flowItemEvidence(flow: ItemFlowStats | null, itemId: number, phase: number, ownedItemIds: number[]) {
  if (!flow) return 0;
  const node = flow.nodes.find((candidate) => candidate.item_id === itemId && candidate.column === phase);
  if (!node || node.matches < 20) return 0;
  const cohort = Math.max(1, flow.reached_per_column[phase] ?? flow.baseline.matches);
  const support = Math.min(1, node.matches / Math.max(1, cohort));
  const peerNodes = flow.nodes.filter((candidate) => candidate.column === phase && candidate.item_id !== itemId && candidate.matches >= 20);
  const peerRate = peerNodes.length ? peerNodes.reduce((sum, candidate) => sum + candidate.adjusted_win_rate, 0) / peerNodes.length : 0.5;
  const phaseLift = Math.max(-0.08, Math.min(0.08, node.adjusted_win_rate - peerRate));
  const incoming = flow.edges.filter((edge) => edge.to_item_id === itemId && edge.from_column === phase - 1 && ownedItemIds.includes(edge.from_item_id) && edge.matches >= 20);
  const bestTransition = incoming.reduce((best, edge) => Math.max(best, Math.max(-0.08, Math.min(0.08, edge.wins / edge.matches - 0.5)) * Math.min(1, edge.matches / 100)), 0);
  return Math.max(-0.08, Math.min(0.08, (phaseLift * support + bestTransition) * Math.min(1, node.matches / 100)));
}

export function itemFlowPhase(gameTimeSeconds: number | null): number {
  if (gameTimeSeconds == null || !Number.isFinite(gameTimeSeconds) || gameTimeSeconds < 9 * 60) return 0;
  if (gameTimeSeconds < 20 * 60) return 1;
  if (gameTimeSeconds < 30 * 60) return 2;
  return 3;
}
