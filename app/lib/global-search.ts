export type SearchResult = {
  kind: "Hero" | "Item" | "Player";
  label: string;
  id: number;
  image?: string;
};

export type SearchRoute =
  | { section: "Heroes"; heroId: number }
  | { section: "Items"; query: string }
  | { section: "Players"; query: string };

export function globalSearchRoute(result: SearchResult, query: string): SearchRoute {
  if (result.kind === "Hero") return { section: "Heroes", heroId: result.id };
  if (result.kind === "Item") return { section: "Items", query: result.label };
  return { section: "Players", query: query.trim() };
}

export function moveSearchSelection(index: number, key: string, resultCount: number) {
  if (resultCount <= 0) return 0;
  if (key === "ArrowDown") return (Math.max(0, index) + 1) % resultCount;
  if (key === "ArrowUp") return (Math.max(0, index) - 1 + resultCount) % resultCount;
  return Math.min(Math.max(index, 0), resultCount - 1);
}

export function commandPaletteKeyAction(key: string, index: number, resultCount: number) {
  if (key === "Escape") return { type: "close" as const };
  if (key === "Enter") return { type: "open" as const, index: resultCount > 0 && index >= 0 && index < resultCount ? index : null };
  if (key === "ArrowDown" || key === "ArrowUp") return { type: "move" as const, index: moveSearchSelection(index, key, resultCount) };
  return null;
}

export function platformShortcutLabel(platform: string) {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘ K" : "Ctrl K";
}
