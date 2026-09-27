import assert from "node:assert/strict";
import test from "node:test";
import { filterMatches, orderedMatches, recommendationDecisions, reviewTimeline, threatEvolution } from "../app/lib/match-history.ts";

const match = (overrides = {}) => ({ matchId: 7, heroId: 11, recommendations: [], actualPurchases: [], result: "win", durationSeconds: 1800, date: 1_000, netWorth: null, matchMode:null,rankSnapshot:null, performance: { kills: null, deaths: null, assists: null, spm: null, kda: null, damagePerMinute: null, killParticipation: null, mvpScore: null }, ...overrides });

test("local match history sorts newest first and applies hero, result, and date filters", () => {
  const outcomes = [match({ matchId: 1, date: 10, heroId: 11,matchMode:"Ranked" }), match({ matchId: 2, date: 30, heroId: 12, result: "loss",matchMode:"Normal" }), match({ matchId: 3, date: 20, heroId: 11 })];
  assert.deepEqual(orderedMatches(outcomes).map((m) => m.matchId), [2, 3, 1]);
  assert.deepEqual(filterMatches(outcomes, { hero: "11", result: "win", since: 15 }).map((m) => m.matchId), [3]);
  assert.deepEqual(filterMatches(outcomes, { result: "loss" }).map((m) => m.matchId), [2]);
  assert.deepEqual(filterMatches(outcomes,{queue:"ranked"}).map(m=>m.matchId),[1]);
  assert.deepEqual(filterMatches(outcomes,{queue:"unranked"}).map(m=>m.matchId),[2]);
});

test("recommendations distinguish followed, delayed, skipped, and unknown without reusing a purchase", () => {
  const source = match({ recommendations: [
    { gameTime: 600, recommendedItemId: 1, score: 0.8 },
    { gameTime: 600, recommendedItemId: 2, score: 0.7 },
    { gameTime: 800, recommendedItemId: 3, score: 0.6 },
  ], actualPurchases: [{ itemId: 1, gameTime: 630 }, { itemId: 2, gameTime: 900 }] });
  assert.deepEqual(recommendationDecisions(source).map((d) => d.state), ["FOLLOWED", "DELAYED", "SKIPPED"]);
  assert.equal(recommendationDecisions(match({ recommendations: [{ gameTime: 5, recommendedItemId: 4, score: 1 }] }))[0].state, "UNKNOWN");
});

test("review timeline stays chronological and removes duplicate snapshots", () => {
  const events = reviewTimeline(match({
    actualPurchases: [{ itemId: 3, gameTime: 90 }, { itemId: 3, gameTime: 90 }, { itemId: 4, gameTime: 30 }],
    recommendations: [{ gameTime: 60, recommendedItemId: 8, score: 1 }, { gameTime: 60, recommendedItemId: 8, score: 0.9 }],
  }));
  assert.deepEqual(events.map((event) => [event.time, event.kind, event.id]), [[30, "purchase", 4], [60, "recommendation", 8], [90, "purchase", 3]]);
});

test("review captures primary-threat changes only when recorded threat priority changes",()=>{
 const source=match({recommendations:[
  {gameTime:60,recommendedItemId:1,score:.8,enemyThreats:[{heroId:11,weight:.7,playerName:"Dynamo"},{heroId:25,weight:.3,playerName:"Warden"}]},
  {gameTime:120,recommendedItemId:1,score:.8,enemyThreats:[{heroId:11,weight:.72,playerName:"Dynamo"},{heroId:25,weight:.28,playerName:"Warden"}]},
  {gameTime:180,recommendedItemId:2,score:.8,enemyThreats:[{heroId:25,weight:.75,playerName:"Warden"},{heroId:11,weight:.25,playerName:"Dynamo"}]},
 ]});
 assert.deepEqual(threatEvolution(source).map(s=>[s.time,s.threats[0].heroId]),[[60,11],[180,25]]);
 assert.ok(reviewTimeline(source).some(event=>event.kind==="threat"&&event.id===25));
});

test("missing metric values remain unknown", () => {
  const saved = match();
  assert.equal(saved.performance.spm, null);
  assert.equal(saved.netWorth, null);
  assert.equal(saved.performance.kills, null);
});
