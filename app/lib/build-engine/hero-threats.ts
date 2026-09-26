export type ThreatTag = "weapon_dps" | "weapon_burst" | "spirit_damage" | "healing" | "sustain" | "hard_cc" | "soft_cc" | "melee" | "mobility";
export type HeroThreatProfile = Partial<Record<ThreatTag, number>>;

/** Conservative manually curated profiles keyed by Deadlock's stable hero asset IDs. */
const profiles: Readonly<Record<number, HeroThreatProfile>> = {
  6: { melee: 0.9, sustain: 0.8, healing: 0.45, hard_cc: 0.35 }, // Abrams
  11: { hard_cc: 1, spirit_damage: 0.55, weapon_burst: 0.25 }, // Dynamo
  13: { weapon_dps: 1, mobility: 0.5 }, // Haze
  25: { hard_cc: 0.65, weapon_dps: 0.5 }, // Warden
  1: { weapon_dps: 0.65, sustain: 0.8, healing: 0.5 }, // Infernus
};

export function threatsForHero(heroId: number): HeroThreatProfile { return profiles[heroId] ?? {}; }
