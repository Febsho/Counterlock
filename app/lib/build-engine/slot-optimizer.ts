export type SlotCandidate = { id: number; category: "weapon" | "vitality" | "spirit"; score: number; components?: number[] };

/** Assign 4 fixed slots per category and 4 flex slots; upgraded components replace their base state. */
export function optimizeSlots(candidates: SlotCandidate[], fixedPerCategory = 4, flexSlots = 4) {
  const ranked = [...candidates].sort((a, b) => b.score - a.score || a.id - b.id);
  const chosen: SlotCandidate[] = [];
  const counts = { weapon: 0, vitality: 0, spirit: 0 };
  for (const item of ranked) {
    if (chosen.some((current) => current.id === item.id) || chosen.some((current) => (current.components ?? []).includes(item.id))) continue;
    const components = chosen.filter((current) => (item.components ?? []).includes(current.id));
    for (const component of components) {
      chosen.splice(chosen.indexOf(component), 1);
      counts[component.category]--;
    }
    if (counts[item.category] >= fixedPerCategory) {
      for (const component of components) { chosen.push(component); counts[component.category]++; }
      continue;
    }
    chosen.push(item); counts[item.category]++;
    if (chosen.length === fixedPerCategory * 3 + flexSlots) break;
  }
  const flex = ranked.filter((item) => !chosen.some((current) => current.id === item.id) && !chosen.some((current) => (current.components ?? []).includes(item.id)) && !(item.components ?? []).some((id) => chosen.some((current) => current.id === id))).slice(0, flexSlots);
  return { fixed: chosen, flex, finalInventory: [...chosen, ...flex] };
}
