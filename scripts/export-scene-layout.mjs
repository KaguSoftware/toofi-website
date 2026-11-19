#!/usr/bin/env node
/**
 * Writes scripts/blender/layout.json from components/sawad/scene/layout.ts, the single
 * source of truth for where every building sits. scripts/blender/build_compound.py reads
 * it to place the baked compound model.
 *
 *   node scripts/export-scene-layout.mjs        (Node 22.18+ strips the TypeScript types)
 *
 * Coordinates are three.js world space in metres: +x downstream, +y up, +z across the river.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APARTMENT_BACK_Z,
  APARTMENT_BUILDINGS_X,
  APARTMENT_WIDTH,
  BOULEVARD_WIDTH,
  BOULEVARD_Z,
  FLOOR_HEIGHT,
  PAD_Y,
  SITE,
  apartmentFloorDepth,
  boulevardCurve,
  boulevardPath,
  villaPlots,
} from "../components/sawad/scene/layout.ts";

export const LAYOUT_PATH = fileURLToPath(new URL("./blender/layout.json", import.meta.url));

/** Everything the Blender build needs, as plain JSON. */
export function sceneLayout() {
  const [boulevardA, boulevardB, promenade, gardenAxis] = boulevardPath();
  const gateZ = (x) => BOULEVARD_Z.map((z) => z + boulevardCurve(x));
  return {
    version: 1,
    padY: PAD_Y,
    site: { ...SITE },
    villas: villaPlots().map(({ index, x, z, facing, type, width, depth, height }) => ({ index, x, z, facing, type, width, depth, height })),
    apartments: {
      x: [...APARTMENT_BUILDINGS_X],
      backZ: APARTMENT_BACK_Z,
      width: APARTMENT_WIDTH,
      floorHeight: FLOOR_HEIGHT,
      floors: 4,
      floorDepths: [0, 1, 2, 3].map(apartmentFloorDepth),
    },
    boulevards: { width: BOULEVARD_WIDTH, paths: [boulevardA, boulevardB] },
    promenade: { width: 8, path: promenade },
    gardenAxis: { width: 5, path: gardenAxis },
    gates: { minX: gateZ(SITE.minX), maxX: gateZ(SITE.maxX) },
    poolRim: { x: 0, z: -46, width: 9.2, height: 0.35, depth: 61 },
  };
}

export function writeSceneLayout(path = LAYOUT_PATH) {
  const layout = sceneLayout();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(layout, null, 2) + "\n");
  return layout;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const layout = writeSceneLayout();
  console.log(`wrote ${LAYOUT_PATH} (${layout.villas.length} villas, ${layout.apartments.x.length} apartment blocks)`);
}
