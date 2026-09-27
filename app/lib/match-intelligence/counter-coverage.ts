import { scoreThreats, type ThreatPlayer } from "../build-engine/threat-score.ts";
export type CounterCoverage = { coveredEnemies:Array<{accountId:number|null;heroId:number;playerName:string|null;strength:number;reasons:string[]}>; coverageScore:number; weightedThreatCoverage:number };
export function counterCoverage(enemies:Array<ThreatPlayer & {accountId?:number|null;playerName?:string|null}>, strength:ReadonlyMap<number,{strength:number;reasons:string[]}>) : CounterCoverage {
 const threats=scoreThreats(enemies,null); const rows=enemies.flatMap(e=>{const found=strength.get(e.heroId); return found && found.strength>0 ? [{accountId:e.accountId??null,heroId:e.heroId,playerName:e.playerName??null,strength:Math.max(0,Math.min(1,found.strength)),reasons:found.reasons}] : [];});
 const weightedThreatCoverage=rows.reduce((sum,r)=>sum+(threats.find(t=>t.heroId===r.heroId)?.weight??0)*r.strength,0);
 return {coveredEnemies:rows,weightedThreatCoverage,coverageScore:Math.min(1,weightedThreatCoverage)};
}
export function counterRedundancyPenalty(existing:number, teamThreat:number):number { return Math.max(0,Math.min(.2,existing-teamThreat*.7)); }
