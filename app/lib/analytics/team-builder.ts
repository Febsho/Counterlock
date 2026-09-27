export type TeamSide = "a" | "b";

export function toggleTeamHero(teamA: readonly number[], teamB: readonly number[], team: TeamSide, heroId: number, maximumPerTeam = 6) {
  const own = team === "a" ? teamA : teamB;
  const other = team === "a" ? teamB : teamA;
  if (own.includes(heroId)) {
    const updated = own.filter((id) => id !== heroId);
    return team === "a" ? { teamA: updated, teamB: [...teamB] } : { teamA: [...teamA], teamB: updated };
  }
  if (own.length >= maximumPerTeam || other.includes(heroId)) return { teamA: [...teamA], teamB: [...teamB] };
  const updated = [...own, heroId];
  return team === "a" ? { teamA: updated, teamB: [...teamB] } : { teamA: [...teamA], teamB: updated };
}

export function uniqueHeroPicks(heroIds: readonly number[], requested: readonly number[], priorityIndex = 0) {
  const ordered = requested.map((_, index) => index).sort((a, b) => (a === priorityIndex ? -1 : b === priorityIndex ? 1 : a - b));
  const result = Array<number>(requested.length).fill(0);
  for (const index of ordered) {
    const candidate = requested[index];
    result[index] = heroIds.includes(candidate) && !result.includes(candidate)
      ? candidate
      : heroIds.find((id) => !result.includes(id)) ?? 0;
  }
  return result;
}
