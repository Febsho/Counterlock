import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRankSamples, filterSampleSize, groupDurationSamples, patchWindow, sortBuilds, sortHeroItems, sortMatchups, winRate } from "../app/lib/analytics/hero-profile.ts";

test("win rates and minimum sample filters preserve unknown zero-sample outcomes", () => {
  assert.equal(winRate({ wins: 3, matches: 4 }), 0.75);
  assert.equal(winRate({ wins: 0, matches: 0 }), null);
  assert.deepEqual(filterSampleSize([{ matches: 9 }, { matches: 10 }], 10, (row) => row.matches), [{ matches: 10 }]);
});

test("hero item and build sorts apply sample gates and rank by the selected metric", () => {
  const items = [{ item_id: 2, matches: 100, wins: 50, avg_buy_time_s: 120 }, { item_id: 1, matches: 30, wins: 24, avg_buy_time_s: 200 }, { item_id: 3, matches: 10, wins: 9, avg_buy_time_s: 300 }];
  assert.deepEqual(sortHeroItems(items, "popular").map((row) => row.item_id), [2, 1, 3]);
  assert.deepEqual(sortHeroItems(items, "winrate").map((row) => row.item_id), [1, 2]);
  const builds = [{ id: 1, likes: 80, result: { wins: 5, matches: 10 } }, { id: 2, likes: 20, result: { wins: 18, matches: 20 } }, { id: 3, likes: 100, result: { wins: 2, matches: 4 } }];
  assert.deepEqual(sortBuilds(builds, "popular", (row) => row.likes, (row) => row.result).map((row) => row.id), [3, 1, 2]);
  assert.deepEqual(sortBuilds(builds, "winrate", (row) => row.likes, (row) => row.result).map((row) => row.id), [2]);
});

test("matchup sorts distinguish tough and favorable while honoring sample minimum", () => {
  const rows = [{ enemy_hero_id: 1, wins: 20, matches_played: 40 }, { enemy_hero_id: 2, wins: 30, matches_played: 40 }, { enemy_hero_id: 3, wins: 1, matches_played: 2 }];
  assert.deepEqual(sortMatchups(rows, "tough").map((row) => row.enemy_hero_id), [1, 2]);
  assert.deepEqual(sortMatchups(rows, "favorable").map((row) => row.enemy_hero_id), [2, 1]);
});

test("rank samples aggregate across rows and game duration groups retain their buckets", () => {
  const rows = [{ bucket: 10, wins: 6, matches: 10, hero_id: 7 }, { bucket: 11, wins: 2, matches: 5, hero_id: 7 }, { bucket: 20, wins: 0, matches: 0, hero_id: 7 }];
  assert.deepEqual(aggregateRankSamples(rows, (bucket) => bucket < 20 ? { tier: 1, label: "Initiate" } : { tier: 2, label: "Seeker" }), [{ tier: 1, label: "Initiate", wins: 8, matches: 15, rate: 8 / 15 }]);
  assert.deepEqual(groupDurationSamples([[...rows], [rows[0]], []], 7).map((group) => group.length), [3, 1, 0]);
});

test("patch window applies the selected patch start and next patch boundary", () => {
  const params = new URLSearchParams();
  patchWindow(params, [{ client_version: 3, version_datetime: "2026-03-01T00:00:00" }, { client_version: 2, version_datetime: "2026-02-01T00:00:00" }], "2");
  assert.equal(params.get("min_unix_timestamp"), String(Date.parse("2026-02-01T00:00:00Z") / 1000));
  assert.equal(params.get("max_unix_timestamp"), String(Date.parse("2026-03-01T00:00:00Z") / 1000));
});
