"use client";

import { useMemo, useState } from "react";
import type { PendingMatchRecord, RecommendationOutcome } from "./lib/data/recommendation-outcomes.ts";
import { MatchReview } from "./components/match-history/MatchReview";
import { MatchLibrary } from "./components/match-history/MatchLibrary";
import { orderedMatches } from "./lib/match-history";

type PendingMatch = PendingMatchRecord & { matchId: number };
type Props = { outcomes: RecommendationOutcome[]; pendingMatches?: PendingMatch[]; heroNames: Map<number, string>; itemNames: Map<number, string>; itemCategories?: Map<number, string>; heroImages?: Map<number, string>; itemImages?: Map<number, string>; initialReview?: boolean };

export function MatchHistory({ outcomes, pendingMatches = [], heroNames, itemNames, itemCategories, heroImages, itemImages, initialReview = false }: Props) {
  const sorted = useMemo(() => orderedMatches(outcomes), [outcomes]);
  const [selectedId, setSelectedId] = useState<number | null>(() => initialReview ? sorted[0]?.matchId ?? null : null);
  const selected = sorted.find((match) => match.matchId === selectedId) ?? null;
  return <section className="match-history-page" aria-label={selected ? "Match review" : "My matches"}>
    {selected ? <MatchReview match={selected} heroNames={heroNames} itemNames={itemNames} itemCategories={itemCategories} heroImages={heroImages} itemImages={itemImages} onBack={() => setSelectedId(null)} /> :
      <MatchLibrary outcomes={sorted} pendingMatches={pendingMatches} heroNames={heroNames} itemNames={itemNames} heroImages={heroImages} itemImages={itemImages} onSelect={(id) => setSelectedId(id)} />}
  </section>;
}
