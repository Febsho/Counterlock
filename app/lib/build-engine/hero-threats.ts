export type ThreatTag = "weapon_dps" | "weapon_burst" | "spirit_damage" | "healing" | "sustain" | "hard_cc" | "soft_cc" | "melee" | "mobility" | "channeling" | "shields";
export type HeroThreatProfile = Partial<Record<ThreatTag, number>>;

export type HeroAbilityEvidence = { description?: string | Record<string, unknown> | null; behaviours?: string[] | null; behaviors?: string[] | null };

/** Derive only mechanics explicitly present in the current game asset descriptions/behavior flags. */
export function threatsFromAbilities(abilities: HeroAbilityEvidence[]): HeroThreatProfile {
  const descriptions = abilities.flatMap((ability) => {
    const value = ability.description;
    return typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).filter((entry): entry is string => typeof entry === "string") : [];
  });
  const text = descriptions.join(" ").toLowerCase();
  const behaviors = abilities.flatMap((ability) => [...(ability.behaviours ?? []), ...(ability.behaviors ?? [])]).join(" ").toLowerCase();
  const seen = (pattern: RegExp) => pattern.test(text);
  const profile: HeroThreatProfile = {};
  if (seen(/(?:spiritdamage|spiritdps|spirit damage|spirit dps)/)) profile.spirit_damage = .8;
  if (seen(/(?:bulletdamage|bulletdps|weapondamage|bullet damage|weapon damage)/)) profile.weapon_dps = .75;
  if (seen(/(?:weaponburst|bulletburst|headshotdamage|weapon burst)/)) profile.weapon_burst = .7;
  if (seen(/(?:\bstun\w*\b|\bknockdown\w*\b|\broot\w*\b|\bsilenc\w*\b|\bdisarm\w*\b|\bimmobiliz\w*\b|\bincapacitat\w*\b)/)) profile.hard_cc = .8;
  if (seen(/(?:\bslow\b|\bknockback\b|\bpull\b|\bdisplac\w*\b|\bsuspend\w*\b)/)) profile.soft_cc = .65;
  if (seen(/(?:\bheal\w*\b|\blifesteal\b|\bleech\b|\brestore health\b|\bhealth regeneration\b)/)) { profile.healing = .65; profile.sustain = .65; }
  if (/(?:\bchannel\w*\b|CHANNEL)/i.test(text + " " + behaviors)) profile.channeling = .7;
  if (/(?:\bbarrier\b|\bshield\w*\b|BARRIER)/i.test(text + " " + behaviors)) profile.shields = .65;
  if (/(?:\bmelee\b|MELEE)/i.test(text + " " + behaviors)) profile.melee = .65;
  if (/(?:\bdash\b|\bteleport\b|\bblink\b|\bleap\b|\bgrapple\b|MOVEMENT)/i.test(text + " " + behaviors)) profile.mobility = .65;
  return profile;
}

/** Conservative manually curated profiles keyed by Deadlock's stable hero asset IDs. */
const profiles: Readonly<Record<number, HeroThreatProfile>> = {
  6: { melee: 0.9, sustain: 0.8, healing: 0.45, hard_cc: 0.35 }, // Abrams
  11: { hard_cc: 1, spirit_damage: 0.55, weapon_burst: 0.25 }, // Dynamo
  13: { weapon_dps: 1, mobility: 0.5 }, // Haze
  25: { hard_cc: 0.65, weapon_dps: 0.5 }, // Warden
  1: { weapon_dps: 0.65, sustain: 0.8, healing: 0.5 }, // Infernus
};

export function threatsForHero(heroId: number): HeroThreatProfile { return profiles[heroId] ?? {}; }

export function mergedHeroThreats(heroId: number, abilities: HeroAbilityEvidence[] = []): HeroThreatProfile {
  const merged = { ...threatsForHero(heroId) };
  Object.entries(threatsFromAbilities(abilities)).forEach(([tag, value]) => { merged[tag as ThreatTag] = Math.max(merged[tag as ThreatTag] ?? 0, value ?? 0); });
  return merged;
}
