export type UpgradeItem = { id: number; class_name?: string; component_items?: string[] };

/** Resolve the asset API's component identifiers into stable item IDs once. */
export function buildUpgradeGraph(items: UpgradeItem[]) {
  const idByClass = new Map(items.flatMap((item) => item.class_name ? [[item.class_name, item.id] as const] : []));
  return new Map(items.map((item) => [item.id, (item.component_items ?? []).flatMap((component) => {
    const id = /^\d+$/.test(component) ? Number(component) : idByClass.get(component);
    return id == null ? [] : [id];
  })]));
}
