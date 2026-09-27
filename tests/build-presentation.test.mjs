import assert from "node:assert/strict";
import test from "node:test";
import { buildStageAt, purchaseState } from "../app/lib/build-engine/presentation.ts";

test("buy state uses unspent souls and makes unknown values explicit", () => {
  assert.deepEqual(purchaseState(3000, 3450), { status: "buy", shortfall: 0 });
  assert.deepEqual(purchaseState(3000, 2150), { status: "save", shortfall: 850 });
  assert.deepEqual(purchaseState(3000, null), { status: "unknown", shortfall: null });
  assert.deepEqual(purchaseState(null, 3450), { status: "unknown", shortfall: null });
  assert.deepEqual(purchaseState(3000, -1), { status: "unknown", shortfall: null });
});

test("build stage follows the live match clock and handles missing time", () => {
  assert.equal(buildStageAt(null), "early");
  assert.equal(buildStageAt(719), "early");
  assert.equal(buildStageAt(720), "mid");
  assert.equal(buildStageAt(1259), "mid");
  assert.equal(buildStageAt(1260), "late");
});
