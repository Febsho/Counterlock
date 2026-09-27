import assert from "node:assert/strict";
import test from "node:test";
import { laneState, inferLaneIntent, laneBuyScore } from "../app/lib/match-intelligence/lane.ts";
import { enemyTeamProfile } from "../app/lib/match-intelligence/team-profile.ts";
import { counterCoverage, counterRedundancyPenalty } from "../app/lib/match-intelligence/counter-coverage.ts";
import { buildDeviation, shouldPreservePowerSpike } from "../app/lib/match-intelligence/deviation.ts";

test("lane state and intent are conservative with missing data and distinguish behind/ahead", () => {
  assert.equal(laneState(null,[10000]),"unknown");
  assert.equal(laneState(5000,[9000]),"behind");
  assert.equal(inferLaneIntent("behind"),"SURVIVE");
  assert.equal(inferLaneIntent("ahead",0,.8),"PRESSURE");
});
test("lane value decays out of early game",()=>{
 const input={matchupFit:.8,earlyHeroFit:.8,sustainNeed:.8,pressureFit:.8,earlyTimingFit:.8,affordabilityFit:.8,lanePowerSpikeFit:.8,deviationPenalty:0,gameTimeSeconds:300};
 assert.ok(laneBuyScore(input)>laneBuyScore({...input,gameTimeSeconds:600}));
 assert.equal(laneBuyScore({...input,gameTimeSeconds:600}),0);
});
test("behind lane sustain and ahead lane pressure signals add lane value",()=>{
 const common={matchupFit:.4,earlyHeroFit:.5,sustainNeed:0,pressureFit:0,earlyTimingFit:.6,affordabilityFit:.8,lanePowerSpikeFit:.5,deviationPenalty:0,gameTimeSeconds:300};
 const survive=laneBuyScore({...common,sustainNeed:.9});
 const pressure=laneBuyScore({...common,pressureFit:.9});
 assert.ok(survive>laneBuyScore(common));
 assert.ok(pressure>laneBuyScore(common));
});
test("hero threat profile retains separated damage and crowd control axes",()=>{
 const profile=enemyTeamProfile([{heroId:11},{heroId:6}]);
 assert.ok(profile.hardCc>profile.weaponDamage);
 assert.ok(profile.meleePressure>0);
 assert.ok(profile.confidence>0);
 const unknown=enemyTeamProfile([{heroId:999}]);
 assert.equal(unknown.weaponDamage,.5);
 assert.equal(unknown.confidence,0);
});
test("counter coverage weights live threat and redundancy responds to existing coverage",()=>{
 const enemies=[{heroId:11,netWorth:18000,kills:12,deaths:1,assists:4},{heroId:25,netWorth:14000,kills:8,deaths:2,assists:5},{heroId:6,netWorth:4000,kills:0,deaths:8,assists:1}];
 const result=counterCoverage(enemies,new Map([[11,{strength:.9,reasons:["hard cc"]}],[25,{strength:.75,reasons:["hard cc"]}],[6,{strength:.3,reasons:["melee"]}]]));
 assert.equal(result.coveredEnemies.length,3);
 assert.ok(result.weightedThreatCoverage>.5);
 assert.ok(counterRedundancyPenalty(.9,.3)>counterRedundancyPenalty(.3,.9));
});
test("one counter shared by high threats outweighs a counter for one low threat",()=>{
 const enemies=[{heroId:11,netWorth:20000,kills:13,deaths:1,assists:5},{heroId:25,netWorth:17000,kills:9,deaths:2,assists:6},{heroId:6,netWorth:3000,kills:0,deaths:8,assists:1}];
 const shared=counterCoverage(enemies,new Map([[11,{strength:.9,reasons:["cc"]}],[25,{strength:.8,reasons:["cc"]}]]));
 const lowOnly=counterCoverage(enemies,new Map([[6,{strength:1,reasons:["melee"]}]]));
 assert.ok(shared.weightedThreatCoverage>lowOnly.weightedThreatCoverage);
});
test("deviation records detour costs and protects a near spike except at urgency",()=>{
 const deviation=buildDeviation({normalNextItemId:4,candidateItemId:9,delayedItems:[4],soulDelayCost:.02,flowTransitionPenalty:.03,slotPressurePenalty:0,powerSpikeDelay:.08});
 assert.equal(deviation.totalDeviationCost,.13);
 const spike={itemId:4,score:.8,estimatedSoulsRemaining:900,currentProgress:.8,reason:"flow completion"};
 assert.equal(shouldPreservePowerSpike(spike,.5),true);
 assert.equal(shouldPreservePowerSpike(spike,.9),false);
});
