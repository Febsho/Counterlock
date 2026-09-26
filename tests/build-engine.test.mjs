import assert from "node:assert/strict";
import test from "node:test";
import { sampleConfidence, shrinkLift } from "../app/lib/build-engine/confidence.ts";
import { rankItems } from "../app/lib/build-engine/scoring.ts";
import { scoreThreats } from "../app/lib/build-engine/threat-score.ts";
import { bestFlowPath } from "../app/lib/build-engine/build-flow.ts";
import { optimizeSlots } from "../app/lib/build-engine/slot-optimizer.ts";
import { findSellDecisions, planPurchasePath, rankNextBuys } from "../app/lib/build-engine/planner.ts";
import { tagsForItem, tagMatchesManualThreat } from "../app/lib/build-engine/counter-tags.ts";
import { counterCapability } from "../app/lib/build-engine/counter-tags.ts";
import { mergedHeroThreats, threatsForHero, threatsFromAbilities } from "../app/lib/build-engine/hero-threats.ts";
import { itemStatsUrl } from "../app/lib/data/deadlock-api.ts";
import { buildPersonalHeroProfile, personalSequencePrior, personalSignals, rankCohort, rankDataHasCoverage } from "../app/lib/build-engine/personal-profile.ts";
import { completeRecommendationOutcome, recommendationOutcomeCache, recordRecommendationSnapshot } from "../app/lib/data/recommendation-outcomes.ts";

test("team matchup URL explicitly requires every selected enemy", () => {
  const url = new URL(itemStatsUrl(10, new URLSearchParams("game_mode=normal"), [20, 21, 22], true));
  assert.equal(url.searchParams.get("enemy_hero_ids"), "20,21,22");
  assert.equal(url.searchParams.get("enemy_hero_ids_all_match"), "true");
});

test("tiny samples are shrunk and missing evidence has no effect", () => {
  assert.ok(shrinkLift(0.2, 20) < shrinkLift(0.03, 20_000));
  assert.equal(sampleConfidence(0), 0);
  const ranked = rankItems([
    { itemId: 1, baselineRate: 0.52, exactRate: 0.9, exactMatches: 25, enemyRates: [] },
    { itemId: 2, baselineRate: 0.52, exactRate: null, exactMatches: 0, enemyRates: [] },
  ], [], null);
  assert.ok(Math.abs(ranked[0].score - ranked[1].score) < 0.01);
});

test("strong exact-lineup evidence matters while a small exact sample barely moves the score", () => {
  const evidence = (matches) => rankItems([
    { itemId: 1, baselineRate: 0.5, exactRate: 0.61, exactMatches: matches, enemyRates: [] },
    { itemId: 2, baselineRate: 0.5, exactRate: null, exactMatches: 0, enemyRates: [] },
  ], [], null);
  assert.ok(evidence(800)[0].itemId === 1);
  assert.ok(evidence(25).find((item) => item.itemId === 1).exactFit < 0.001);
});

test("a fed enemy gains relative threat weight while unknown telemetry stays neutral", () => {
  const balanced = scoreThreats([{ heroId: 1 }, { heroId: 2 }], null);
  assert.ok(Math.abs(balanced[0].weight - 0.5) < 1e-9);
  const fed = scoreThreats([{ heroId: 1, netWorth: 18000, kills: 9, deaths: 1, assists: 4 }, { heroId: 2, netWorth: 9000, kills: 1, deaths: 5, assists: 2 }], 900);
  assert.equal(fed[0].heroId, 1);
});

test("weighted matchup evidence follows the strongest enemy and equal threats split evenly", () => {
  const items = [
    { itemId: 1, baselineRate: 0.5, exactRate: null, exactMatches: 0, enemyRates: [{ heroId: 1, rate: 0.6, matches: 4000 }, { heroId: 2, rate: 0.5, matches: 4000 }] },
    { itemId: 2, baselineRate: 0.5, exactRate: null, exactMatches: 0, enemyRates: [{ heroId: 1, rate: 0.5, matches: 4000 }, { heroId: 2, rate: 0.6, matches: 4000 }] },
  ];
  const againstFedOne = rankItems(items, [{ heroId: 1, netWorth: 20000 }, { heroId: 2, netWorth: 9000 }], 900);
  assert.equal(againstFedOne[0].itemId, 1);
  const even = rankItems(items, [{ heroId: 1 }, { heroId: 2 }], 900);
  assert.equal(even[0].itemId, 1); // stable item-ID tiebreak when both threats are equal
  assert.ok(Math.abs(scoreThreats([{ heroId: 1 }, { heroId: 2 }], null)[0].weight - 0.5) < 1e-9);
});

test("mechanic tags use stable class names and Statlocker data is not required", () => {
  assert.deepEqual(tagsForItem("upgrade_metal_skin"), ["weapon_dps", "weapon_burst"]);
  assert.ok(tagsForItem("upgrade_rupture").includes("healing"));
  assert.equal(tagMatchesManualThreat("upgrade_debuff_reducer", { healing: false, weapon: false, spirit: false, crowdControl: true }), true);
  assert.equal(rankItems([{ itemId: 1, baselineRate: 0.52, exactRate: null, exactMatches: 0, enemyRates: [] }], [{ heroId: 1 }], null).length, 1);
});

test("item-flow edges determine a connected core path", () => {
  const path = bestFlowPath({
    nodes: [
      { column: 0, item_id: 1, matches: 500, adjusted_win_rate: 0.53, avg_net_worth_at_buy: 3000 },
      { column: 1, item_id: 2, matches: 300, adjusted_win_rate: 0.54, avg_net_worth_at_buy: 7000 },
      { column: 1, item_id: 3, matches: 100, adjusted_win_rate: 0.56, avg_net_worth_at_buy: 7000 },
    ],
    edges: [{ from_column: 0, from_item_id: 1, to_item_id: 2, matches: 180, wins: 100 }], baseline: { matches: 1000 }, reached_per_column: [1000, 500],
  });
  assert.deepEqual(path, [1, 2]);
});

test("slot plan caps categories and replaces an owned component with its upgrade", () => {
  const candidates = [
    { id: 1, category: "vitality", score: 0.9 },
    { id: 2, category: "vitality", score: 0.95, components: [1] },
    ...Array.from({ length: 18 }, (_, index) => ({ id: index + 10, category: ["weapon", "vitality", "spirit"][index % 3], score: 0.8 - index * 0.01 })),
  ];
  const plan = optimizeSlots(candidates);
  assert.ok(!plan.finalInventory.some((item) => item.id === 1));
  assert.ok(plan.finalInventory.some((item) => item.id === 2));
  assert.equal(plan.flex.length, 4);
  assert.ok(plan.finalInventory.length <= 16);
});

test("an urgent adaptive counter can overtake the core item as next buy", () => {
  const ranked = rankNextBuys([
    { id: "core", score: 0.55, coreFit: 0.8, counterUrgency: 0.02 },
    { id: "counter", score: 0.51, coreFit: 0.5, counterUrgency: 0.35 },
  ]);
  assert.equal(ranked[0].id, "counter");
});

test("deviation cost keeps a low value counter behind the normal core buy", () => {
  const ranked = rankNextBuys([
    { id: "core", score: .55, coreFit: .4, counterUrgency: .02, deviationCost: 0 },
    { id: "weak-counter", score: .53, coreFit: .05, counterUrgency: .15, deviationCost: .08 },
  ]);
  assert.equal(ranked[0].id, "core");
});

test("purchase planner keeps supported flow transitions and does not double-purchase owned nodes", () => {
  const candidates = [10, 20, 30].map((itemId) => ({ itemId, score: 0.5, buyTime: 600, tier: 1, cost: 1250, category: "vitality", counterUrgency: 0, coreFit: 0.5, mechanicFit: 0, components: [], owned: itemId === 20 }));
  const flow = { nodes: [10, 20, 30].map((item_id, column) => ({ item_id, column, matches: 100, adjusted_win_rate: 0.54, avg_net_worth_at_buy: 10000 })),
    edges: [{ from_column: 0, from_item_id: 10, to_item_id: 20, matches: 80, wins: 40 }, { from_column: 1, from_item_id: 20, to_item_id: 30, matches: 80, wins: 40 }], baseline: { matches: 1000 }, reached_per_column: [1000, 700, 300] };
  assert.deepEqual(planPurchasePath(candidates, flow, 3), [10, 30]);
});

test("sell suggestions require a replacement gain or explicit upgrade relationship", () => {
  const candidates = [
    { itemId: 1, score: 0.4, category: "vitality", owned: true, components: [] },
    { itemId: 2, score: 0.5, category: "vitality", owned: false, components: [1] },
    { itemId: 3, score: 0.401, category: "vitality", owned: false, components: [] },
  ].map((item) => ({ buyTime: 600, tier: 1, cost: 1000, counterUrgency: 0, coreFit: 0.5, mechanicFit: 0, ...item }));
  assert.deepEqual(findSellDecisions(candidates, [2]).map(({ sellId, replacementId, reason }) => ({ sellId, replacementId, reason })), [
    { sellId: 1, replacementId: 2, reason: "upgrade_obsolete" },
  ]);
});

test("hero compatibility keeps mechanic counters focused on the threat they address", () => {
  assert.ok(counterCapability("upgrade_metal_skin", threatsForHero(13)) > counterCapability("upgrade_metal_skin", threatsForHero(11)));
  assert.ok(counterCapability("upgrade_debuff_reducer", threatsForHero(11)) > counterCapability("upgrade_debuff_reducer", threatsForHero(13)));
});

test("hero ability evidence derives explicit mechanics and keeps curated fallback", () => {
  const parsed = threatsFromAbilities([
    { description: { active: "Deals SpiritDamage and stuns enemies" }, behaviours: ["BARRIER", "CHANNEL"] },
    { description: "Dash forward, then heal allies" },
  ]);
  assert.equal(parsed.spirit_damage, 0.8);
  assert.equal(parsed.hard_cc, 0.8);
  assert.equal(parsed.shields, 0.65);
  assert.equal(parsed.channeling, 0.7);
  assert.equal(parsed.mobility, 0.65);
  assert.equal(parsed.healing, 0.65);
  assert.equal(mergedHeroThreats(13, []).weapon_dps, threatsForHero(13).weapon_dps);
  assert.equal(mergedHeroThreats(999, [{ description: "Deals bullet damage" }]).weapon_dps, 0.75);
});

test("individual enemy evidence remains useful when exact lineup evidence is absent", () => {
  const result = rankItems([{ itemId: 9, baselineRate: 0.5, exactRate: null, exactMatches: 0, enemyRates: [{ heroId: 11, rate: 0.56, matches: 2400 }] }], [{ heroId: 11 }], 900);
  assert.ok(result[0].counterFit > 0);
  assert.match(result[0].reason, /individual matchups/);
});

test("personal profile is hero-specific, bounded, and turns match purchases into item and path priors", () => {
  const matches = [
    { matchId: 9, heroId: 10, won: true, gameDurationSeconds: 1800, items: [{ itemId: 1, gameTimeSeconds: 100 }, { itemId: 2, gameTimeSeconds: 300 }], kda: 4, spm: 900, damagePerMinute: 800, killParticipation: .6, mvpScore: .7 },
    { matchId: 8, heroId: 10, won: true, gameDurationSeconds: 1800, items: [{ itemId: 1, gameTimeSeconds: 120 }, { itemId: 2, gameTimeSeconds: 320 }], kda: 5, spm: 1000, damagePerMinute: 900, killParticipation: .7, mvpScore: .8 },
    { matchId: 7, heroId: 20, won: false, gameDurationSeconds: 1800, items: [{ itemId: 99, gameTimeSeconds: 80 }], kda: 1, spm: 500, damagePerMinute: 400, killParticipation: .2, mvpScore: .1 },
  ];
  const profile = buildPersonalHeroProfile(123, 10, matches);
  assert.equal(profile.matches, 2);
  assert.equal(buildPersonalHeroProfile(123, 10, [...matches, matches[0]]).matches, 2);
  assert.deepEqual(profile.itemStats.map((item) => item.itemId), [1, 2]);
  assert.equal(profile.avgSpm, 950);
  assert.ok(personalSequencePrior(profile, [1], 2) > 0);
  assert.equal(personalSequencePrior(profile, [1], 99), 0);
  assert.equal(personalSignals(profile).get(1).matches, 2);
});

test("personal evidence is capped: two matches cannot overturn population data and 50 weigh more than five", () => {
  const items = [
    { itemId: 1, baselineRate: .57, exactRate: null, exactMatches: 0, enemyRates: [] },
    { itemId: 2, baselineRate: .55, exactRate: null, exactMatches: 0, enemyRates: [] },
  ];
  const profileWith = (matches) => new Map([[2, { personalFit: .95, matches, avgBuyTimeSeconds: 600 }]]);
  const population = rankItems(items, [], 600);
  const two = rankItems(items, [], 600, profileWith(2));
  const five = rankItems(items, [], 600, profileWith(5));
  const fifty = rankItems(items, [], 600, profileWith(50));
  assert.equal(two[0].itemId, 1);
  const delta = (ranked) => ranked.find((item) => item.itemId === 2).score - population.find((item) => item.itemId === 2).score;
  assert.ok(delta(two) < delta(five));
  assert.ok(delta(five) < delta(fifty));
});

test("rank cohort spans adjacent ranks and safely disables for unknown rank", () => {
  assert.deepEqual(rankCohort(94), { min: 84, max: 104 });
  assert.deepEqual(rankCohort(11), { min: 11, max: 21 });
  assert.equal(rankCohort(null), null);
  assert.equal(rankDataHasCoverage([20, 200, 80, 30, 25, 20, 70, 100]), true);
  assert.equal(rankDataHasCoverage([20, 30, 15, 5]), false);
});

test("recommendation outcome logging joins actual purchases once and is idempotent by match ID", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  recordRecommendationSnapshot(123, 9001, 10, 601, [{ itemId: 1, score: .7 }, { itemId: 2, score: .6 }], storage);
  recordRecommendationSnapshot(123, 9001, 10, 630, [{ itemId: 1, score: .8 }, { itemId: 3, score: .55 }], storage);
  const match = { matchId: 9001, players: [{ account_id: 123, hero_id: 10, playerWon: true, items: [{ item_id: 2, game_time_s: 500 }], metrics: { soulsPerMinute: 920, kdaRatio: 3.1, damagePerMinute: 1100, killParticipation: .68 }, mvpScore: .75 }] };
  const first = completeRecommendationOutcome(123, match, storage);
  const again = completeRecommendationOutcome(123, match, storage);
  assert.deepEqual(again, first);
  assert.equal(first.result, "win");
  assert.deepEqual(first.actualPurchases, [{ itemId: 2, gameTime: 500 }]);
  assert.equal(first.recommendations.length, 3);
  assert.equal(recommendationOutcomeCache(123, storage).pending[9001], undefined);
  assert.equal(recommendationOutcomeCache(123, storage).completed[9001].performance.spm, 920);
});

test("Statlocker batch match proxy keeps API key server-side and maps rate limits", async () => {
  const { POST } = await import("../app/api/statlocker/matches/route.ts");
  const originalKey = process.env.STATLOCKER_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.STATLOCKER_API_KEY = "server-only-key";
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://statlocker.gg/api/public/matches");
      assert.equal(new Headers(init?.headers).get("X-API-Key"), "server-only-key");
      assert.deepEqual(JSON.parse(init.body), [1, 2]);
      return new Response("", { status: 429 });
    };
    const response = await POST(new Request("http://localhost/api/statlocker/matches", { method: "POST", body: JSON.stringify([1, 2]) }));
    assert.deepEqual(await response.json(), { status: "rate_limited", matches: [] });
    const invalid = await POST(new Request("http://localhost/api/statlocker/matches", { method: "POST", body: JSON.stringify([0]) }));
    assert.equal(invalid.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STATLOCKER_API_KEY;
    else process.env.STATLOCKER_API_KEY = originalKey;
  }
});

test("Statlocker profile route never needs a client-supplied key and handles disabled configuration", async () => {
  const { POST } = await import("../app/api/statlocker/profiles/route.ts");
  const original = process.env.STATLOCKER_API_KEY;
  delete process.env.STATLOCKER_API_KEY;
  try {
    const response = await POST(new Request("http://localhost/api/statlocker/profiles", { method: "POST", body: JSON.stringify([123]) }));
    assert.deepEqual(await response.json(), { status: "not_configured", profiles: [] });
  } finally {
    if (original === undefined) delete process.env.STATLOCKER_API_KEY;
    else process.env.STATLOCKER_API_KEY = original;
  }
});

test("Statlocker profile route degrades on documented auth and rate-limit failures", async () => {
  const { POST } = await import("../app/api/statlocker/profiles/route.ts");
  const originalKey = process.env.STATLOCKER_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.STATLOCKER_API_KEY = "test-only-server-key";
  try {
    for (const [code, status] of [[401, "unauthorized"], [403, "forbidden"], [429, "rate_limited"]]) {
      globalThis.fetch = async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("X-API-Key"), "test-only-server-key");
        return new Response("", { status: code });
      };
      const response = await POST(new Request("http://localhost/api/statlocker/profiles", { method: "POST", body: JSON.stringify([123]) }));
      assert.deepEqual(await response.json(), { status, profiles: [] });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STATLOCKER_API_KEY;
    else process.env.STATLOCKER_API_KEY = originalKey;
  }
});
