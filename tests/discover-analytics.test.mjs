import assert from "node:assert/strict";
import test from "node:test";
import { settleLabeledRequests } from "../app/lib/analytics/analytics-results.ts";
import { toggleTeamHero, uniqueHeroPicks } from "../app/lib/analytics/team-builder.ts";
import { steamAccountId } from "../app/lib/steam-account-id.ts";

test("team builder enforces cross-team uniqueness, six-player limits, and unlocks removed heroes", () => {
  const teamA = [1, 2, 3, 4, 5, 6];
  const teamB = [7, 8, 9, 10, 11];
  assert.deepEqual(toggleTeamHero(teamA, teamB, "b", 1), { teamA, teamB });
  assert.deepEqual(toggleTeamHero(teamA, teamB, "b", 12).teamB, [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(toggleTeamHero(teamA, [7, 8, 9, 10, 11, 12], "b", 13).teamB, [7, 8, 9, 10, 11, 12]);
  const removed = toggleTeamHero([1, 2], [3], "a", 1);
  assert.deepEqual(toggleTeamHero(removed.teamA, removed.teamB, "b", 1).teamB, [3, 1]);
});

test("lane picks normalize duplicates to the next available unique hero", () => {
  assert.deepEqual(uniqueHeroPicks([1, 2, 3, 4, 5], [1, 2, 3, 4]), [1, 2, 3, 4]);
  assert.deepEqual(uniqueHeroPicks([1, 2, 3, 4, 5], [1, 1, 3, 4], 1), [2, 1, 3, 4]);
  assert.deepEqual(uniqueHeroPicks([8, 9, 10, 11], [8, 8, 8, 8]), [8, 9, 10, 11]);
});

test("partial analytics failures retain successful datasets and name only failed sources", async () => {
  const result = await settleLabeledRequests([
    { label: "Lane matchup", promise: Promise.resolve(["sample"]) },
    { label: "Soul curve", promise: Promise.reject(new Error("offline")) },
    { label: "Opening items", promise: Promise.resolve([]) },
  ]);
  assert.deepEqual(result.values.get("Lane matchup"), ["sample"]);
  assert.deepEqual(result.values.get("Opening items"), []);
  assert.deepEqual(result.errors, ["Soul curve"]);
});

test("Steam account ID parser accepts account IDs, SteamID64, Steam3, and profile URLs", () => {
  assert.equal(steamAccountId("123456"), 123456);
  assert.equal(steamAccountId("76561197960265728"), null);
  assert.equal(steamAccountId("76561197960265729"), 1);
  assert.equal(steamAccountId("[U:1:1]"), 1);
  assert.equal(steamAccountId("https://steamcommunity.com/profiles/76561197960265729"), 1);
  assert.equal(steamAccountId("0"), null);
  assert.equal(steamAccountId("not a player"), null);
});
