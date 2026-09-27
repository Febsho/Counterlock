"use client";

import { useEffect, useMemo, useState } from "react";
import type { PendingMatchRecord, RecommendationOutcome } from "./lib/data/recommendation-outcomes.ts";
import { MatchReview } from "./components/match-history/MatchReview";
import { MatchLibrary } from "./components/match-history/MatchLibrary";
import { orderedMatches } from "./lib/match-history";

type PendingMatch = PendingMatchRecord & { matchId: number };
export type SteamHistoryProfile = { account_id: number; personaname: string; profileurl: string; avatar: string };
type Props = { outcomes: RecommendationOutcome[]; pendingMatches?: PendingMatch[]; accountId?: number | null; playerName?: string | null; onLinkSteamProfile?: (profile: SteamHistoryProfile) => void; onForgetSteamProfile?: () => void; onOpenHero?: (heroId: number) => void; heroNames: Map<number, string>; itemNames: Map<number, string>; itemCategories?: Map<number, string>; heroImages?: Map<number, string>; itemImages?: Map<number, string>; initialReview?: boolean };

export function MatchHistory({ outcomes, pendingMatches = [], accountId, playerName, onLinkSteamProfile, onForgetSteamProfile, onOpenHero, heroNames, itemNames, itemCategories, heroImages, itemImages, initialReview = false }: Props) {
  const [apiMatchState, setApiMatchState] = useState<{ accountId: number | null; rows: RecommendationOutcome[] }>({ accountId: null, rows: [] });
  const [statlockerMatchState, setStatlockerMatchState] = useState<{ accountId: number | null; rows: RecommendationOutcome[] }>({ accountId: null, rows: [] });
  const apiMatches = apiMatchState.accountId === accountId ? apiMatchState.rows : [];
  const statlockerMatches = statlockerMatchState.accountId === accountId ? statlockerMatchState.rows : [];
  const [historyStatus, setHistoryStatus] = useState<"loading" | "connected" | "local" | "unavailable">(() => accountId ? "loading" : "local");
  const localMatchIdKey = outcomes.map((match) => match.matchId).sort((a, b) => a - b).join(",");
  useEffect(() => {
    if (!accountId || typeof window === "undefined") return;
    let active = true;
    const load = async () => {
      setHistoryStatus("loading");
      try {
        const response = await fetch(`https://api.deadlock-api.com/v1/players/${accountId}/match-history`);
        if (!response.ok) throw new Error("History lookup failed");
        const history: unknown = await response.json();
        if (!Array.isArray(history)) throw new Error("Invalid history response");
        const localMatchIds = new Set(localMatchIdKey ? localMatchIdKey.split(",").map(Number) : []);
        const rows = history.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const row = entry as Record<string, unknown>, id = row.match_id ?? row.matchId, heroId = row.hero_id ?? row.heroId;
          const outcome = row.player_match_outcome, result = outcome === 1 ? "win" : outcome === 2 ? "loss" : null;
          if (!Number.isSafeInteger(id) || !Number.isInteger(heroId) || !result || localMatchIds.has(id as number)) return [];
          const badge = row.ranked_display_badge;
          return [{ matchId: id as number, heroId: heroId as number, recommendations: [], actualPurchases: [], purchaseHistoryAvailable: false, result,
            durationSeconds: typeof row.match_duration_s === "number" ? row.match_duration_s : null,
            date: typeof row.start_time === "number" ? row.start_time : null,
            netWorth: typeof row.net_worth === "number" ? row.net_worth : null, matchMode: null,
            rankSnapshot: { estimatedRankNumber: Number.isInteger(badge) && (badge as number) >= 11 && (badge as number) <= 116 ? badge as number : null, ppScore: null, playerName: playerName ?? null },
            performance: { kills: finite(row.player_kills), deaths: finite(row.player_deaths), assists: finite(row.player_assists), spm: null, kda: null, damagePerMinute: null, killParticipation: null, mvpScore: null } } satisfies RecommendationOutcome];
        }).slice(0, 100);
        if (active) setApiMatchState({ accountId, rows });
        const ids = rows.map((row) => row.matchId);
        if (!ids.length) { if (active) setHistoryStatus("connected"); return; }
        const fetched: RecommendationOutcome[] = [];
        for (let i = 0; i < ids.length; i += 50) {
          const batch = await fetch("/api/statlocker/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids.slice(i, i + 50)) });
          if (!batch.ok) continue;
          const payload = await batch.json() as { status?: string; matches?: unknown[] };
          if (payload.status === "not_configured") { if (active) setHistoryStatus("connected"); return; }
          if (payload.status !== "connected" || !Array.isArray(payload.matches)) continue;
          for (const value of payload.matches) { const parsed = statlockerOutcome(value, accountId); if (parsed) fetched.push(parsed); }
        }
        if (active) { setStatlockerMatchState({ accountId, rows: fetched }); setHistoryStatus("connected"); }
      } catch { if (active) setHistoryStatus("unavailable"); }
    };
    void load(); return () => { active = false; };
  }, [accountId, localMatchIdKey, playerName]);
  const sorted = useMemo(() => {
    const byId = new Map<number, RecommendationOutcome>();
    for (const next of [...apiMatches, ...statlockerMatches, ...outcomes]) {
      const previous = byId.get(next.matchId);
      if (!previous) { byId.set(next.matchId, next); continue; }
      byId.set(next.matchId, { ...previous, ...next,
        recommendations: next.recommendations.length ? next.recommendations : previous.recommendations,
        actualPurchases: next.actualPurchases.length ? next.actualPurchases : previous.actualPurchases,
        purchaseHistoryAvailable: next.purchaseHistoryAvailable ?? previous.purchaseHistoryAvailable,
        rankSnapshot: next.rankSnapshot?.playerName || next.rankSnapshot?.estimatedRankNumber != null ? next.rankSnapshot : previous.rankSnapshot,
        durationSeconds: next.durationSeconds ?? previous.durationSeconds, date: next.date ?? previous.date,
        netWorth: next.netWorth ?? previous.netWorth, matchMode: next.matchMode ?? previous.matchMode,
        performance: Object.fromEntries(Object.entries(next.performance).map(([key, value]) => [key, value ?? previous.performance[key as keyof RecommendationOutcome["performance"]]])) as RecommendationOutcome["performance"],
      });
    }
    return orderedMatches([...byId.values()]);
  }, [apiMatches, outcomes, statlockerMatches]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const resolvedSelectedId = selectedId === -1 ? null : selectedId ?? (initialReview ? sorted[0]?.matchId ?? null : null);
  const selected = sorted.find((match) => match.matchId === resolvedSelectedId) ?? null;
  return <section className="match-history-page" aria-label={selected ? "Match review" : "My matches"}>
    {selected ? <MatchReview match={selected} heroNames={heroNames} itemNames={itemNames} itemCategories={itemCategories} heroImages={heroImages} itemImages={itemImages} onBack={() => setSelectedId(-1)} onOpenHero={onOpenHero} /> :
      <MatchLibrary outcomes={sorted} pendingMatches={pendingMatches} heroNames={heroNames} itemNames={itemNames} heroImages={heroImages} itemImages={itemImages} historyStatus={accountId ? historyStatus : "local"} accountId={accountId} playerName={playerName} onLinkSteamProfile={onLinkSteamProfile} onForgetSteamProfile={onForgetSteamProfile} onSelect={(id) => setSelectedId(id)} />}
  </section>;
}

function statlockerOutcome(value: unknown, accountId: number): RecommendationOutcome | null {
  if (!value || typeof value !== "object") return null;
  const match = value as Record<string, unknown>;
  const player = Array.isArray(match.players) ? match.players.find((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).account_id === accountId) as Record<string, unknown> | undefined : undefined;
  const id = match.matchId ?? match.match_id, heroId = player?.hero_id;
  if (!Number.isSafeInteger(id) || !Number.isInteger(heroId)) return null;
  const metrics = player?.metrics && typeof player.metrics === "object" ? player.metrics as Record<string, unknown> : {};
  const n = (...keys: string[]) => { for (const key of keys) { const v = metrics[key] ?? player?.[key]; if (typeof v === "number" && Number.isFinite(v)) return v; } return null; };
  const purchases = Array.isArray(player?.items) ? player!.items.flatMap((entry) => { if (!entry || typeof entry !== "object") return []; const item = entry as Record<string, unknown>; const itemId = item.item_id ?? item.itemId, time = item.game_time_s ?? item.gameTimeSeconds; return Number.isInteger(itemId) && typeof time === "number" ? [{ itemId: itemId as number, gameTime: time }] : []; }) : [];
  const wonValue = player?.playerWon ?? player?.player_won;
  if (typeof wonValue !== "boolean") return null;
  const duration = match.matchDurationSeconds ?? match.match_duration_s;
  const date = match.startTime ?? match.start_time ?? match.matchTime ?? match.match_time;
  return { matchId: id as number, heroId: heroId as number, result: wonValue ? "win" : "loss", recommendations: [], actualPurchases: purchases, purchaseHistoryAvailable: Array.isArray(player?.items), durationSeconds: typeof duration === "number" ? duration : null, date: typeof date === "number" ? date : null, netWorth: n("netWorth", "net_worth"), matchMode: typeof (match.match_mode_parsed ?? match.matchMode) === "string" ? String(match.match_mode_parsed ?? match.matchMode) : null, rankSnapshot: null, performance: { kills: n("kills", "killCount"), deaths: n("deaths", "deathCount"), assists: n("assists", "assistCount"), spm: n("soulsPerMinute", "spm"), kda: n("kdaRatio", "kda"), damagePerMinute: n("damagePerMinute"), killParticipation: n("killParticipation"), mvpScore: n("mvpScore") } };
}

function finite(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
