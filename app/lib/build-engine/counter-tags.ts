import type { ThreatTag } from "./hero-threats.ts";

/** Curated stable game class names; extend only after checking current item mechanics. */
const itemCounterTags: Readonly<Record<string, Partial<Record<ThreatTag, number>>>> = {
  upgrade_metal_skin: { weapon_dps: 0.9, weapon_burst: 0.8 },
  upgrade_spirit_armor: { spirit_damage: 0.9 },
  upgrade_healbane: { healing: 0.85, sustain: 0.75 },
  upgrade_rupture: { healing: 0.8, sustain: 0.7 }, // Decay's current asset class name
  upgrade_debuff_reducer: { hard_cc: 0.8, soft_cc: 0.7 },
  upgrade_unstoppable: { hard_cc: 0.95, soft_cc: 0.8 },
};

export function tagsForItem(className: string | null | undefined): readonly ThreatTag[] {
  return className ? Object.keys(itemCounterTags[className] ?? {}) as ThreatTag[] : [];
}

export function counterCapability(className: string | null | undefined, targetThreats: Partial<Record<ThreatTag, number>>) {
  const capabilities = className ? itemCounterTags[className] : undefined;
  if (!capabilities) return 0;
  const total = Object.values(targetThreats).reduce((sum, value) => sum + (value ?? 0), 0);
  if (!total) return 0;
  return Object.entries(capabilities).reduce((sum, [tag, value]) => sum + (value ?? 0) * (targetThreats[tag as ThreatTag] ?? 0), 0) / total;
}

export function tagMatchesManualThreat(className: string | null | undefined, threats: { healing: boolean; weapon: boolean; spirit: boolean; crowdControl: boolean }) {
  const tags = tagsForItem(className);
  return (threats.healing && tags.includes("healing")) || (threats.weapon && tags.includes("weapon_dps")) ||
    (threats.spirit && tags.includes("spirit_damage")) || (threats.crowdControl && tags.includes("hard_cc"));
}
