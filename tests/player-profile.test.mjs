import assert from "node:assert/strict";
import test from "node:test";
import { playerRank } from "../app/lib/player-rank.ts";
import { fetchStatlockerProfiles } from "../app/lib/data/statlocker.ts";

test("rank helper formats validated tiers and rejects missing or invalid values", () => {
  assert.deepEqual(playerRank(94), {
    tier: 9,
    subrank: 4,
    label: "Phantom IV",
    badgeUrl: "https://assets.deadlock-api.com/images/ranks/rank9/badge_lg_subrank4.webp",
  });
  assert.equal(playerRank(null), null);
  assert.equal(playerRank(19), null);
  assert.equal(playerRank(120), null);
});

test("profile lookup deduplicates account IDs, batches them, and caches results", async () => {
  const originalFetch = globalThis.fetch;
  const batches = [];
  globalThis.fetch = async (_url, init) => {
    batches.push(JSON.parse(init.body));
    return Response.json({ status: "connected", profiles: [{ accountId: 4_294_000_111, name: "Example", avatarUrl: "https://example.com/avatar.png", ppScore: 51, estimatedRankNumber: 94, region: "EU" }] });
  };
  try {
    const ids = [4_294_000_111, 4_294_000_112, 4_294_000_111];
    const first = await fetchStatlockerProfiles(ids);
    const cached = await fetchStatlockerProfiles(ids);
    assert.deepEqual(batches, [[4_294_000_111, 4_294_000_112]]);
    assert.equal(first.profiles[0].name, "Example");
    assert.equal(cached.profiles[0].estimatedRankNumber, 94);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
