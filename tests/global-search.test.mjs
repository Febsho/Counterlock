import assert from "node:assert/strict";
import test from "node:test";
import { commandPaletteKeyAction, globalSearchRoute, moveSearchSelection, platformShortcutLabel } from "../app/lib/global-search.ts";

test("global results route heroes, exact items, Steam names, and numeric account IDs", () => {
  assert.deepEqual(globalSearchRoute({ kind: "Hero", label: "Haze", id: 15 }, "haze"), { section: "Heroes", heroId: 15 });
  assert.deepEqual(globalSearchRoute({ kind: "Item", label: "Metal Skin", id: 100 }, "metal"), { section: "Items", query: "Metal Skin" });
  assert.deepEqual(globalSearchRoute({ kind: "Player", label: "Search players", id: 0 }, "  Febsho  "), { section: "Players", query: "Febsho" });
  assert.deepEqual(globalSearchRoute({ kind: "Player", label: "Search players", id: 0 }, "76561198000000000"), { section: "Players", query: "76561198000000000" });
});

test("command palette selection wraps, clamps after result changes, and handles Enter and Escape", () => {
  assert.equal(moveSearchSelection(0, "ArrowUp", 3), 2);
  assert.equal(moveSearchSelection(2, "ArrowDown", 3), 0);
  assert.equal(moveSearchSelection(8, "", 3), 2);
  assert.equal(moveSearchSelection(8, "", 0), 0);
  assert.deepEqual(commandPaletteKeyAction("ArrowDown", 0, 3), { type: "move", index: 1 });
  assert.deepEqual(commandPaletteKeyAction("Enter", 1, 3), { type: "open", index: 1 });
  assert.deepEqual(commandPaletteKeyAction("Enter", 1, 0), { type: "open", index: null });
  assert.deepEqual(commandPaletteKeyAction("Escape", 1, 3), { type: "close" });
  assert.equal(commandPaletteKeyAction("x", 1, 3), null);
});

test("shortcut label follows the host platform", () => {
  assert.equal(platformShortcutLabel("MacIntel"), "⌘ K");
  assert.equal(platformShortcutLabel("Win32"), "Ctrl K");
  assert.equal(platformShortcutLabel("Linux x86_64"), "Ctrl K");
});
