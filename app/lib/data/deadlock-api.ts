import { cachedJson } from "./cache.ts";

export const DEADLOCK_API = "https://api.deadlock-api.com/v1";

export function itemStatsUrl(heroId: number, params: URLSearchParams, enemyIds?: number[], exact = false) {
  const query = new URLSearchParams(params);
  query.set("hero_ids", String(heroId));
  if (enemyIds?.length) {
    query.set("enemy_hero_ids", enemyIds.join(","));
    if (exact) query.set("enemy_hero_ids_all_match", "true");
  }
  return `${DEADLOCK_API}/analytics/item-stats?${query}`;
}

export type ItemFlowNode = { column: number; item_id: number; matches: number; adjusted_win_rate: number; avg_net_worth_at_buy: number };
export type ItemFlowEdge = { from_column: number; from_item_id: number; to_item_id: number; matches: number; wins: number };
export type ItemFlowStats = { nodes: ItemFlowNode[]; edges: ItemFlowEdge[]; baseline: { matches: number }; reached_per_column: number[] };

/** Reject malformed external flow payloads before they enter path scoring. */
export function parseItemFlowStats(payload: unknown): ItemFlowStats | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.reached_per_column) || !value.baseline || typeof value.baseline !== "object") return null;
  const nodes = value.nodes.filter((node): node is ItemFlowNode => Boolean(node && typeof node === "object" && Number.isInteger((node as ItemFlowNode).column) && Number.isInteger((node as ItemFlowNode).item_id) && Number.isFinite((node as ItemFlowNode).matches) && Number.isFinite((node as ItemFlowNode).adjusted_win_rate) && Number.isFinite((node as ItemFlowNode).avg_net_worth_at_buy)));
  const edges = value.edges.filter((edge): edge is ItemFlowEdge => Boolean(edge && typeof edge === "object" && Number.isInteger((edge as ItemFlowEdge).from_column) && Number.isInteger((edge as ItemFlowEdge).from_item_id) && Number.isInteger((edge as ItemFlowEdge).to_item_id) && Number.isFinite((edge as ItemFlowEdge).matches) && Number.isFinite((edge as ItemFlowEdge).wins)));
  const reached = value.reached_per_column.filter((number): number is number => Number.isFinite(number));
  const matches = (value.baseline as Record<string, unknown>).matches;
  if (!Number.isFinite(matches) || nodes.length !== value.nodes.length || edges.length !== value.edges.length || reached.length !== value.reached_per_column.length) return null;
  return { nodes, edges, baseline: { matches: matches as number }, reached_per_column: reached };
}

export async function itemFlowStats(url: string): Promise<ItemFlowStats> {
  const payload = await cachedJson<unknown>(url, 60 * 60 * 1000);
  const parsed = parseItemFlowStats(payload);
  if (!parsed) throw new Error("Deadlock API returned malformed item-flow statistics");
  return parsed;
}
