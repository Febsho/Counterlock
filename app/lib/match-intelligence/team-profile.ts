import { mergedHeroThreats, type HeroAbilityEvidence, type HeroThreatProfile } from "../build-engine/hero-threats.ts";
import { scoreThreats, type ThreatPlayer } from "../build-engine/threat-score.ts";
export type EnemyTeamProfile = { weaponDamage:number; weaponBurst:number; spiritDamage:number; spiritBurst:number; healing:number; sustain:number; hardCc:number; softCc:number; meleePressure:number; mobility:number; channeling:number; shields:number; confidence:number };
const keys = ["weapon_dps","weapon_burst","spirit_damage","healing","sustain","hard_cc","soft_cc","melee","mobility","channeling","shields"] as const;
const fields = ["weaponDamage","weaponBurst","spiritDamage","healing","sustain","hardCc","softCc","meleePressure","mobility","channeling","shields"] as const;
export function enemyTeamProfile(enemies: Array<{heroId:number; netWorth?:number|null; soulsPerMinute?:number|null; kills?:number|null; deaths?:number|null; assists?:number|null; statlockerPP?:number|null}>, abilities: ReadonlyMap<number, HeroAbilityEvidence[]> = new Map()): EnemyTeamProfile {
  const ranked = scoreThreats(enemies.map(e => ({...e, heroId:e.heroId} as ThreatPlayer)), null);
  const total = ranked.reduce((sum,t)=>sum+t.weight,0) || 1;
  const out = Object.fromEntries(fields.map(k=>[k,0])) as unknown as EnemyTeamProfile;
  out.spiritBurst = 0;
  let evidence = 0;
  enemies.forEach(enemy => { const weight=(ranked.find(t=>t.heroId===enemy.heroId)?.weight ?? 0)/total; const profile: HeroThreatProfile=mergedHeroThreats(enemy.heroId, abilities.get(enemy.heroId) ?? []); const known=Object.keys(profile).length>0; const vals=keys.map(k=>profile[k] ?? (known?0:.5)); evidence += (known?vals.filter(v=>v>0).length/keys.length:0)*weight; vals.forEach((v,i)=>{ out[fields[i]] += v*weight; }); });
  out.confidence = enemies.length ? Math.min(1, evidence*2) : 0;
  return out;
}
