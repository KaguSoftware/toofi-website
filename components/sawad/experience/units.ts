import { planApartmentBlocks, planVilla } from "../scene/layout";
import type { SceneMarker, Vec3 } from "../scene/types";

/**
 * The homes as boxes: what a click on a building hits, and what the highlight draws around the
 * selected home. A villa is its whole volume; an apartment is its own floor of the block.
 */
export type UnitBox = { id: string; center: Vec3; size: Vec3 };

/** Room for the highlight to stand clear of the walls it surrounds. */
const SKIN = 0.35;

export function unitBox(marker: Pick<SceneMarker, "id" | "kind" | "slot">): UnitBox {
  if (marker.kind === "villa") {
    const v = planVilla(marker.slot);
    return { id: marker.id, center: [v.x, v.y + v.height / 2, v.z], size: [v.width + SKIN, v.height + SKIN, v.depth + SKIN] };
  }
  const blocks = planApartmentBlocks();
  const floors = blocks[0].floors;
  const count = blocks.length * floors;
  const index = ((marker.slot % count) + count) % count;
  const block = blocks[Math.floor(index / floors)];
  const floor = index % floors;
  const depth = block.floorDepths[floor];
  return {
    id: marker.id,
    center: [block.x, block.y + (floor + 0.5) * block.floorHeight, block.backZ + depth / 2],
    size: [block.width + SKIN, block.floorHeight, depth + SKIN],
  };
}

export function unitBoxes(markers: ReadonlyArray<Pick<SceneMarker, "id" | "kind" | "slot">>): UnitBox[] {
  return markers.map(unitBox);
}

/** The id of the nearest home among pointer hits (objects that carry `userData.unit`). */
export function pickUnit(hits: ReadonlyArray<{ distance: number; object: { userData: Record<string, unknown> } }>): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const h of hits) {
    const id = h.object.userData.unit;
    if (typeof id !== "string") continue;
    if (!best || h.distance < best.distance) best = { id, distance: h.distance };
  }
  return best?.id ?? null;
}
