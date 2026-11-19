#!/usr/bin/env node
/**
 * Writes scripts/blender/layout.json from components/sawad/scene/layout.ts, the single
 * source of truth for where every building sits. scripts/blender/build_compound.py reads
 * it to place the baked compound model.
 *
 *   node scripts/export-scene-layout.mjs        (Node 22.18+ strips the TypeScript types)
 *
 * The file holds two layouts:
 * - The top-level keys are the 7 ha layout the shipped model is built from today.
 * - `masterplan` is the 28 ha plan for Zaitun Hills (everything named `plan...` in layout.ts):
 *   the homes, streets, gates, walls, amenities, parking, lamps, planting zones and the ground.
 *   The model is rebuilt from it; the top-level keys go away once nothing reads them.
 *
 * For ground beyond the grid in `masterplan.terrain` (a film backdrop, say):
 *
 *   node scripts/export-scene-layout.mjs --terrain <minX>,<maxX>,<minZ>,<maxZ>,<step> <out.json>
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
  PLAN_ASSET_SIZE,
  PLAN_GARDEN_BAY,
  PLAN_GATE,
  PLAN_HILL_SLOPE,
  PLAN_LEVELS,
  PLAN_LINK,
  PLAN_PADS,
  PLAN_PROMENADE,
  PLAN_SITE,
  PLAN_STREET,
  PLAN_SUN,
  PLAN_WALL,
  SITE,
  apartmentFloorDepth,
  boulevardCurve,
  boulevardPath,
  planAmenities,
  planApartmentBlocks,
  planBank,
  planBenches,
  planGates,
  planLamps,
  planParking,
  planReserve,
  planRoads,
  planTerrainHeight,
  planTreeZones,
  planVillas,
  planWalls,
  riverGeometryParams,
  villaPlots,
} from "../components/sawad/scene/layout.ts";

export const LAYOUT_PATH = fileURLToPath(new URL("./blender/layout.json", import.meta.url));

/** The ground the model is built on: the walled site and 60 m around it, every 4 m. */
export const TERRAIN_GRID = { minX: -490, maxX: 490, minZ: -320, maxZ: 128, step: 4 };

const two = (n) => String(n).padStart(2, "0");

/** Rounds every number to a tenth of a millimetre, so the file reads cleanly and stays stable. */
function rounded(value) {
  if (typeof value === "number") return Math.round(value * 10_000) / 10_000 + 0;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
}

/** Ground heights on a grid, in whole centimetres: `heightsCm[row][column]` is the ground at (minX + column * step, minZ + row * step). */
export function terrainGrid({ minX, maxX, minZ, maxZ, step }) {
  const columns = Math.round((maxX - minX) / step) + 1;
  const rows = Math.round((maxZ - minZ) / step) + 1;
  const heightsCm = Array.from({ length: rows }, (_, j) => Array.from({ length: columns }, (_, i) => Math.round(planTerrainHeight(minX + i * step, minZ + j * step) * 100) + 0));
  return { minX, minZ, step, columns, rows, heightsCm };
}

/** The 28 ha masterplan as plain JSON. */
export function masterplanLayout() {
  const site = { ...PLAN_SITE };
  const lineXs = Array.from({ length: (site.maxX - site.minX) / 10 + 1 }, (_, i) => site.minX + i * 10);
  return {
    ...rounded({
      site,
      areaHa: ((site.maxX - site.minX) * (site.maxZ - site.minZ)) / 10_000,
      levels: { ...PLAN_LEVELS },
      sun: { ...PLAN_SUN },
      river: { ...riverGeometryParams("zaitun") },
      street: { ...PLAN_STREET },
      link: { ...PLAN_LINK },
      promenade: { ...PLAN_PROMENADE },
      wall: { ...PLAN_WALL },
      gate: { ...PLAN_GATE },
      // Homes. A villa's (x, y, z) is the centre of the house on the ground; `facing` 1 means its entrance faces +z.
      villas: planVillas().map((v) => ({ name: `villa-${two(v.index)}`, ...v })),
      apartments: planApartmentBlocks().map((b) => ({ name: `apartment-${b.index}`, ...b })),
      gates: planGates(),
      walls: planWalls(),
      roads: planRoads(),
      // Amenities and parking courts are placed by their origin and a turn about +y (0: the front faces +z).
      amenities: planAmenities(),
      parking: planParking(),
      assetSizes: { ...PLAN_ASSET_SIZE },
      lamps: planLamps(),
      benches: planBenches(),
      treeZones: planTreeZones(),
      reserve: planReserve(),
      // How the ground inside the walls is graded: valley floor above `toeZ`, an even climb to the
      // terrace at `crestZ`, level to `hillZ`, then `hillSlope` up the hillside; the garden bay and
      // the pads are level areas cut into that. `terrain` is the result, sampled.
      ground: {
        hillSlope: PLAN_HILL_SLOPE,
        gardenBay: { ...PLAN_GARDEN_BAY },
        pads: PLAN_PADS,
        lines: lineXs.map((x) => ({ x, ...planBank(x) })),
      },
    }),
    terrain: terrainGrid(TERRAIN_GRID),
  };
}

/** Everything the Blender build needs, as plain JSON. */
export function sceneLayout() {
  const [boulevardA, boulevardB, promenade, gardenAxis] = boulevardPath();
  const gateZ = (x) => BOULEVARD_Z.map((z) => z + boulevardCurve(x));
  return {
    version: 2,
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
    masterplan: masterplanLayout(),
  };
}

/** JSON with lists of plain values (a point, a row of heights) kept on one line. */
export function formatJson(value, indent = "") {
  const plain = (v) => v === null || typeof v !== "object";
  if (Array.isArray(value)) {
    if (value.every(plain)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    return `[\n${value.map((v) => `${indent}  ${formatJson(v, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    const pair = ([k, v]) => `${JSON.stringify(k)}: ${formatJson(v, `${indent}  `)}`;
    if (entries.length <= 6 && entries.every(([, v]) => plain(v))) return `{ ${entries.map(pair).join(", ")} }`;
    return `{\n${entries.map((e) => `${indent}  ${pair(e)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatJson(value) + "\n");
}

export function writeSceneLayout(path = LAYOUT_PATH) {
  const layout = sceneLayout();
  writeJson(path, layout);
  return layout;
}

/** `--terrain minX,maxX,minZ,maxZ,step out.json`: the ground over any area, for work outside the model's own grid. */
export function writeTerrain(bounds, path) {
  const [minX, maxX, minZ, maxZ, step] = bounds.split(",").map(Number);
  if (!path || ![minX, maxX, minZ, maxZ, step].every(Number.isFinite) || maxX <= minX || maxZ <= minZ || step <= 0) {
    throw new Error("usage: --terrain <minX>,<maxX>,<minZ>,<maxZ>,<step> <out.json>");
  }
  const grid = terrainGrid({ minX, maxX, minZ, maxZ, step });
  writeJson(path, grid);
  return grid;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf("--terrain");
  if (at !== -1) {
    const grid = writeTerrain(process.argv[at + 1] ?? "", process.argv[at + 2] ?? "");
    console.log(`wrote ${process.argv[at + 2]} (${grid.columns} x ${grid.rows} heights)`);
  } else {
    const layout = writeSceneLayout();
    const plan = layout.masterplan;
    console.log(`wrote ${LAYOUT_PATH}`);
    console.log(`  7 ha layout: ${layout.villas.length} villas, ${layout.apartments.x.length} apartment blocks`);
    console.log(`  28 ha masterplan: ${plan.villas.length} villas, ${plan.apartments.length} apartment blocks, ${plan.amenities.length} amenities, ${plan.lamps.length} lamps`);
  }
}
