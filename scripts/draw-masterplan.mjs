#!/usr/bin/env node
/**
 * Draws docs/zaitun/masterplan.svg, the 28 ha masterplan, from components/sawad/scene/layout.ts.
 * The drawing is generated, so it cannot drift from the layout: the plots, streets, amenities,
 * parking, planting, levels and the area schedule all come from the functions the scene and
 * the Blender build read.
 *
 *   node scripts/draw-masterplan.mjs        (Node 22.18+ strips the TypeScript types)
 *
 * The sheet looks down on the site with the stream at the bottom and the foothills at the top:
 * +x (downstream, toward the evening sun) runs right, +z (across the stream) runs down.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLAN_GARDEN_BAY,
  PLAN_GATE,
  PLAN_LANDSCAPE,
  PLAN_LEVELS,
  PLAN_LINK,
  PLAN_PROMENADE,
  PLAN_SITE,
  PLAN_STREET,
  PLAN_SUN,
  planAmenities,
  planApartmentBlocks,
  planAreas,
  planBank,
  planBoulevardZ,
  planGates,
  planLandUseAt,
  planLamps,
  planParking,
  planReserve,
  planRiverCenterZ,
  planRoads,
  planTerrainHeight,
  planTreeZones,
  planVillas,
  planWalls,
  riverGeometryParams,
  seeded,
} from "../components/sawad/scene/layout.ts";

export const SVG_PATH = fileURLToPath(new URL("../docs/zaitun/masterplan.svg", import.meta.url));

// ---------------------------------------------------------------- sheet

/** Pixels per metre on the plan. */
const S = 1.72;
/** The part of the world the plan shows. */
const VIEW = { minX: -530, maxX: 530, minZ: -336, maxZ: 176 };
const MARGIN = 44;
const PLAN_TOP = 132;
const PLAN_W = (VIEW.maxX - VIEW.minX) * S;
const PLAN_H = (VIEW.maxZ - VIEW.minZ) * S;
const BAND_TOP = PLAN_TOP + PLAN_H + 34;
const BAND_H = 372;
export const SHEET = { width: Math.round(PLAN_W + 2 * MARGIN), height: Math.round(BAND_TOP + BAND_H + MARGIN) };
/** Where the plan sits on the sheet, and the part of the world it shows. */
export const PLAN_FRAME = { x: MARGIN, y: PLAN_TOP, width: PLAN_W, height: PLAN_H, view: VIEW, pixelsPerMetre: S };

const INK = "#2b2622";
const MUTED = "#6f665b";
const PAPER = "#f6f2ea";
/**
 * Home types: colour, and a footprint shape that tells them apart without colour. The four
 * colours stay apart from each other for every kind of colour vision (checked pair by pair);
 * the gold is light against the paper, so every plot also carries its number.
 */
export const TYPE_STYLE = {
  courtyard: { fill: "#b4502c", label: "Courtyard villa, 5 bed", note: "24 × 22 m around a court, 780 m² plot" },
  "garden-4": { fill: "#d99a1e", label: "Garden villa, 4 bed", note: "20 × 16 m with a lower wing, 560 m² plot" },
  "garden-3": { fill: "#2a72c4", label: "Garden villa, 3 bed", note: "17 × 14 m with a lower wing, 420 m² plot" },
  apartment: { fill: "#7a3f8f", label: "Apartment block, 4 homes", note: "32 m wide, floors step to the stream" },
};
const C = {
  outside: "#e8dcc1",
  contour: "#b9a37d",
  water: "#a9cdd0",
  waterLine: "#7fb1b6",
  olive: "#cfd2a6",
  terrace: "#dcdfb9",
  garden: "#c5d596",
  lawn: "#b9d089",
  riverLawn: "#cfdca4",
  verge: "#c2d08f",
  carriageway: "#d9ccae",
  paving: "#efe6d2",
  kerb: "#b7a88a",
  plot: "#f3ecda",
  hedge: "#56692f",
  roof: "#ecdfc7",
  roofLine: "#a8946d",
  wall: "#5b4b3a",
  brass: "#c9a24a",
  pool: "#4f9a9a",
  palm: "#4f6b2a",
  oliveTree: "#8a9668",
  citrus: "#7c9a3c",
  court: "#7fb0a8",
  clay: "#c98a68",
  play: "#e7b98a",
};

const n1 = (v) => (Math.round(v * 10) / 10).toString();
const px = (x) => (x - VIEW.minX) * S;
const pz = (z) => (z - VIEW.minZ) * S;
const pt = (x, z) => `${n1(px(x))},${n1(pz(z))}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function rect(r, attrs = "") {
  return `<rect x="${n1(px(r.minX))}" y="${n1(pz(r.minZ))}" width="${n1((r.maxX - r.minX) * S)}" height="${n1((r.maxZ - r.minZ) * S)}" ${attrs}/>`;
}
const poly = (points, attrs = "") => `<polygon points="${points.map(([x, z]) => pt(x, z)).join(" ")}" ${attrs}/>`;
const line = (points, attrs = "") => `<polyline points="${points.map(([x, z]) => pt(x, z)).join(" ")}" fill="none" ${attrs}/>`;
function text(x, z, body, attrs = "") {
  return `<text x="${n1(px(x))}" y="${n1(pz(z))}" ${attrs}>${esc(body)}</text>`;
}
const xsBetween = (from, to, step) => {
  const n = Math.max(1, Math.round(Math.abs(to - from) / step));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
};

// ---------------------------------------------------------------- ground

/** Contour lines by marching squares: one path of short segments per level. */
function contours(levels, step) {
  const cols = Math.round((VIEW.maxX - VIEW.minX) / step);
  const rows = Math.round((VIEW.maxZ - VIEW.minZ) / step);
  const h = [];
  for (let j = 0; j <= rows; j++) {
    const row = new Float64Array(cols + 1);
    for (let i = 0; i <= cols; i++) row[i] = planTerrainHeight(VIEW.minX + i * step, VIEW.minZ + j * step);
    h.push(row);
  }
  const paths = new Map(levels.map((l) => [l, []]));
  const cross = (a, b, level) => (level - a) / (b - a);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [a, b, c, d] = [h[j][i], h[j][i + 1], h[j + 1][i + 1], h[j + 1][i]];
      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      for (const level of levels) {
        if (level <= lo || level > hi) continue;
        const x0 = VIEW.minX + i * step;
        const z0 = VIEW.minZ + j * step;
        const hits = [];
        if (a < level !== b < level) hits.push([x0 + cross(a, b, level) * step, z0]);
        if (b < level !== c < level) hits.push([x0 + step, z0 + cross(b, c, level) * step]);
        if (d < level !== c < level) hits.push([x0 + cross(d, c, level) * step, z0 + step]);
        if (a < level !== d < level) hits.push([x0, z0 + cross(a, d, level) * step]);
        for (let k = 0; k + 1 < hits.length; k += 2) paths.get(level).push(`M${pt(...hits[k])}L${pt(...hits[k + 1])}`);
      }
    }
  }
  return paths;
}

function ground() {
  const out = [];
  out.push(`<rect x="0" y="0" width="${n1(PLAN_W)}" height="${n1(PLAN_H)}" fill="${C.outside}"/>`);
  // The stream.
  const r = riverGeometryParams("zaitun");
  const xs = xsBetween(VIEW.minX, VIEW.maxX, 10);
  const near = xs.map((x) => [x, planRiverCenterZ(x) - r.width / 2]);
  const far = xs.map((x) => [x, planRiverCenterZ(x) + r.width / 2]).reverse();
  out.push(poly([...near, ...far], `fill="${C.water}"`));
  for (const k of [-0.25, 0.1, 0.32]) out.push(line(xs.map((x) => [x, planRiverCenterZ(x) + k * r.width]), `stroke="${C.waterLine}" stroke-width="0.8" stroke-dasharray="14 9" opacity="0.8"`));
  return out.join("\n");
}

/** The graded site inside the walls: valley floor, olive bank, terrace, hillside and the garden. */
function siteGround() {
  const { minX, maxX, minZ } = PLAN_SITE;
  const xs = xsBetween(minX, maxX, 5);
  const bank = xs.map((x) => planBank(x));
  const along = (pick) => xs.map((x, i) => [x, pick(bank[i], x)]);
  const band = (a, b, fill) => poly([...a, ...b.slice().reverse()], `fill="${fill}"`);
  const out = [];
  out.push(rect(PLAN_SITE, `fill="${C.terrace}"`));
  // Hillside above the terrace, the bank below it.
  out.push(band(along(() => minZ), along((b) => b.hillZ), C.olive));
  out.push(band(along((b) => b.crestZ), along((b) => b.toeZ), C.olive));
  // Valley floor behind boulevard A.
  out.push(band(along((b) => b.toeZ), along((_, x) => planBoulevardZ("a", x)), C.terrace));
  // The central garden: a level bay in the bank, with the olive slope around it.
  const bay = PLAN_GARDEN_BAY;
  const mouth = planBank(0).toeZ + 10;
  const slope = bay.run * S;
  out.push(`<rect x="${n1(px(-bay.halfWidth - bay.run))}" y="${n1(pz(bay.headZ - bay.run))}" width="${n1((2 * bay.halfWidth + 2 * bay.run) * S)}" height="${n1((mouth - bay.headZ + bay.run) * S)}" rx="${n1(slope)}" fill="${C.olive}"/>`);
  out.push(rect({ minX: -bay.halfWidth, maxX: bay.halfWidth, minZ: bay.headZ, maxZ: mouth }, `fill="${C.garden}"`));
  const gx = xsBetween(-96, 96, 4);
  out.push(poly([...gx.map((x) => [x, planBank(x).toeZ]), ...gx.map((x) => [x, planBoulevardZ("a", x) - PLAN_STREET.frontage]).reverse()], `fill="${C.garden}"`));
  // Riverside lawn between boulevard A and the promenade.
  out.push(band(along((_, x) => planBoulevardZ("a", x)), along(() => PLAN_SITE.maxZ), C.riverLawn));
  // Land kept for phase two.
  for (const outline of planReserve()) out.push(poly(outline, `fill="url(#reserve)" stroke="${MUTED}" stroke-width="0.9" stroke-dasharray="7 5"`));
  return out.join("\n");
}

// ---------------------------------------------------------------- streets and walks

function streets() {
  const out = [];
  const roads = planRoads();
  const flat = (road) => road.path.map(([x, , z]) => [x, z]);
  const stroke = (points, metres, colour, extra = "") => line(points, `stroke="${colour}" stroke-width="${n1(metres * S)}" stroke-linejoin="round" ${extra}`);
  const { carriageway, verge, sidewalk } = PLAN_STREET;
  const boulevards = roads.filter((r) => r.kind === "boulevard");
  const links = roads.filter((r) => r.kind === "street");
  for (const r of boulevards) out.push(stroke(flat(r), carriageway + 2 * (verge + sidewalk), C.paving));
  for (const r of links) out.push(stroke(flat(r), PLAN_LINK.carriageway + 2 * PLAN_LINK.sidewalk, C.paving));
  for (const r of boulevards) out.push(stroke(flat(r), carriageway + 2 * verge, C.verge));
  for (const r of [...boulevards, ...links]) out.push(stroke(flat(r), r.width + 0.6, C.kerb));
  for (const r of [...boulevards, ...links]) out.push(stroke(flat(r), r.width, C.carriageway));
  for (const r of roads.filter((x) => x.kind === "promenade" || x.kind === "walk")) out.push(stroke(flat(r), r.width, C.paving, `stroke-linecap="butt"`));
  return out.join("\n");
}

// ---------------------------------------------------------------- homes

/** A point in a home's own axes (x to its right, z toward its entrance) placed in the world. */
const local = (home, lx, lz) => [home.x + home.facing * lx, home.z + home.facing * lz];
const localRect = (home, x0, x1, z0, z1) => {
  const [ax, az] = local(home, x0, z0);
  const [bx, bz] = local(home, x1, z1);
  return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
};

/** Roof plan of a villa: the courtyard type shows its court, the garden types their lower wing. */
function villaRoof(v, fill) {
  const { width: w, depth: d } = v;
  const out = [];
  const edge = `stroke="${INK}" stroke-width="0.7"`;
  if (v.type === "courtyard") {
    out.push(rect(localRect(v, -w / 2, w / 2, -d / 2, d / 2), `fill="${fill}" ${edge}`));
    out.push(rect(localRect(v, -w / 2 + 6, w / 2 - 6, -d / 2 + 6, d / 2 - 6), `fill="${C.plot}" stroke="${INK}" stroke-width="0.5"`));
    out.push(rect(localRect(v, w / 2 - 5.1, w / 2 - 0.9, -d / 2 + 0.9, -d / 2 + 5.1), `fill="${fill}" stroke="${INK}" stroke-width="0.5"`));
  } else {
    const low = w * 0.42;
    out.push(rect(localRect(v, w / 2 - low, w / 2, -d * 0.5, d * 0.3), `fill="${fill}" fill-opacity="0.72" ${edge}`));
    out.push(rect(localRect(v, -w / 2, w / 2 - low, -d / 2, d / 2), `fill="${fill}" ${edge}`));
  }
  return out.join("");
}

/** Villa plots with their hedges, and the drives across the verge. */
function plots() {
  const out = [];
  for (const v of planVillas()) {
    out.push(rect(v.driveway, `fill="${C.carriageway}"`));
    out.push(rect(v.plot, `fill="${C.plot}" stroke="${C.hedge}" stroke-width="1.1"`));
    out.push(rect(v.plot, `fill="${TYPE_STYLE[v.type].fill}" fill-opacity="0.16"`));
  }
  for (const p of planParking()) out.push(rect(p.driveway, `fill="${C.carriageway}"`));
  return out.join("\n");
}

function homes() {
  const out = [];
  for (const v of planVillas()) {
    const style = TYPE_STYLE[v.type];
    out.push(`<g id="villa-${String(v.index).padStart(2, "0")}">`);
    // Carport: 6.6 x 6 m roof in the forecourt.
    out.push(rect({ minX: v.carport.x - 3.3, maxX: v.carport.x + 3.3, minZ: v.carport.z - 3, maxZ: v.carport.z + 3 }, `fill="${C.paving}" stroke="${C.roofLine}" stroke-width="0.6"`));
    out.push(villaRoof(v, style.fill));
    const [lx, lz] = v.type === "courtyard" ? local(v, 0, 8.2) : local(v, -v.width * 0.21, 0);
    out.push(text(lx, lz, `V${String(v.index + 1).padStart(2, "0")}`, `class="num"`));
    out.push(`</g>`);
  }
  for (const b of planApartmentBlocks()) {
    const style = TYPE_STYLE.apartment;
    out.push(`<g id="apartment-${b.index}">`);
    b.floorDepths.forEach((depth, f) => {
      out.push(rect({ minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.backZ, maxZ: b.backZ + depth }, `fill="${style.fill}" fill-opacity="${n1(0.4 + f * 0.2)}" stroke="${INK}" stroke-width="${f === 0 ? 0.7 : 0.35}"`));
    });
    const first = b.index * b.floors + 1;
    out.push(text(b.x, b.backZ + 5.6, `A${String(first).padStart(2, "0")}–${String(first + b.floors - 1).padStart(2, "0")}`, `class="num"`));
    out.push(`</g>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- amenities and parking

function amenities() {
  const out = [];
  const byId = Object.fromEntries(planAmenities().map((a) => [a.id, a]));
  const paved = `fill="${C.paving}" stroke="${C.kerb}" stroke-width="0.6"`;
  out.push(rect(byId["garden-terrace"].footprint, paved));
  out.push(rect(byId["stream-plaza"].footprint, paved));
  out.push(rect(byId.lawn.footprint, `fill="${C.lawn}" stroke="${C.hedge}" stroke-width="0.5" stroke-opacity="0.5"`));
  // Garden steps: treads across the flight.
  const steps = byId["garden-steps"].footprint;
  out.push(rect(steps, paved));
  for (let z = steps.minZ + 1.5; z < steps.maxZ; z += 1.5) out.push(line([[steps.minX, z], [steps.maxX, z]], `stroke="${C.kerb}" stroke-width="0.5"`));
  out.push(rect(byId.belvedere.footprint, `fill="${C.paving}" stroke="${INK}" stroke-width="0.7"`));
  // Reflecting pool: limestone rim, mosaic water.
  const pool = byId.pool.footprint;
  out.push(rect(pool, `fill="${C.paving}" stroke="${C.kerb}" stroke-width="0.6"`));
  out.push(rect({ minX: pool.minX + 0.6, maxX: pool.maxX - 0.6, minZ: pool.minZ + 0.5, maxZ: pool.maxZ - 0.5 }, `fill="${C.pool}"`));
  // Gym: the hall and wing, with its timber terrace toward the courts.
  const gym = byId.gym.footprint;
  out.push(rect({ minX: gym.maxX - 5.6, maxX: gym.maxX, minZ: gym.minZ + 12, maxZ: gym.maxZ }, `fill="#b08a5e" fill-opacity="0.55" stroke="${C.roofLine}" stroke-width="0.5"`));
  out.push(rect({ minX: gym.minX, maxX: gym.maxX - 5.6, minZ: gym.minZ, maxZ: gym.maxZ }, `fill="${C.roof}" stroke="${INK}" stroke-width="0.8"`));
  // Courts.
  for (const id of ["padel-1", "padel-2"]) {
    const f = byId[id].footprint;
    out.push(rect(f, `fill="${C.court}" stroke="${INK}" stroke-width="0.6"`));
    out.push(line([[f.minX, byId[id].z], [f.maxX, byId[id].z]], `stroke="${PAPER}" stroke-width="0.8"`));
  }
  const tennis = byId.tennis.footprint;
  out.push(rect(tennis, `fill="${C.court}" fill-opacity="0.55" stroke="${INK}" stroke-width="0.6"`));
  out.push(rect(rectOf(byId.tennis.x, byId.tennis.z, 10.97, 23.77), `fill="${C.clay}" stroke="${PAPER}" stroke-width="0.7"`));
  out.push(line([[byId.tennis.x - 5.5, byId.tennis.z], [byId.tennis.x + 5.5, byId.tennis.z]], `stroke="${PAPER}" stroke-width="0.8"`));
  // Playground under shade sails.
  const play = byId.playground.footprint;
  out.push(rect(play, `fill="${C.play}" stroke="${C.roofLine}" stroke-width="0.6"`));
  const [mx, mz] = [(play.minX + play.maxX) / 2, (play.minZ + play.maxZ) / 2];
  out.push(poly([[play.minX + 1.5, play.minZ + 1.5], [mx + 2, play.minZ + 2.5], [mx - 1, mz + 1]], `fill="${PAPER}" fill-opacity="0.75" stroke="${C.roofLine}" stroke-width="0.4"`));
  out.push(poly([[play.maxX - 1.5, play.maxZ - 1.5], [mx - 2, play.maxZ - 2.5], [mx + 1.5, mz - 1]], `fill="${PAPER}" fill-opacity="0.75" stroke="${C.roofLine}" stroke-width="0.4"`));
  // Mosque: platform, prayer hall, dome and minaret. Drawn at its provisional bearing.
  const mosque = byId.mosque;
  out.push(rect(mosque.footprint, `fill="${C.paving}" stroke="${C.kerb}" stroke-width="0.6"`));
  out.push(rect(rectOf(mosque.x, mosque.z, 16, 16), `fill="${C.roof}" stroke="${INK}" stroke-width="0.8"`));
  out.push(rect(rectOf(mosque.x, mosque.z + 10, 16, 4), `fill="${C.roof}" fill-opacity="0.6" stroke="${INK}" stroke-width="0.5"`));
  out.push(`<circle cx="${n1(px(mosque.x))}" cy="${n1(pz(mosque.z))}" r="${n1(4.2 * S)}" fill="${C.paving}" stroke="${INK}" stroke-width="0.7"/>`);
  out.push(`<circle cx="${n1(px(mosque.x + 10.1))}" cy="${n1(pz(mosque.z + 10.3))}" r="${n1(1.5 * S)}" fill="${C.brass}" stroke="${INK}" stroke-width="0.6"/>`);
  // Sales gallery: a courtyard villa by the gate.
  const gallery = byId.gallery;
  out.push(rect(gallery.footprint, `fill="${C.plot}" stroke="${C.hedge}" stroke-width="1.1"`));
  out.push(villaRoof({ x: gallery.x, z: gallery.z, facing: -1, type: "courtyard", width: gallery.size.width, depth: gallery.size.depth }, C.roof));
  return out.join("\n");
}

const rectOf = (x, z, width, depth) => ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });

function parking() {
  const out = [];
  for (const p of planParking()) {
    const f = p.footprint;
    out.push(`<g id="parking-${p.id}">`);
    out.push(rect(f, `fill="${C.carriageway}" stroke="${C.hedge}" stroke-width="1"`));
    // Bays either side of the aisle, which runs along the long side.
    const longZ = f.maxZ - f.minZ > f.maxX - f.minX;
    const from = (longZ ? f.minZ : f.minX) + 1.3;
    for (let k = 0; k <= p.baysPerSide; k++) {
      const t = from + k * 2.5;
      for (const side of [0, 1]) {
        const a = side ? (longZ ? f.maxX : f.maxZ) - 1.3 : (longZ ? f.minX : f.minZ) + 1.3;
        const b = a + (side ? -5 : 5);
        out.push(line(longZ ? [[a, t], [b, t]] : [[t, a], [t, b]], `stroke="${PAPER}" stroke-width="0.6"`));
      }
    }
    out.push(`</g>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- planting (indicative)

/** A field of dots as one path: round caps on zero-length segments. */
const dots = (points, radius, colour, opacity = 1) =>
  `<path d="${points.map(([x, z]) => `M${pt(x, z)}h0`).join("")}" stroke="${colour}" stroke-opacity="${opacity}" stroke-width="${n1(radius * 2 * S)}" stroke-linecap="round" fill="none"/>`;

/** Tree positions read off the planting zones. Indicative: track 3B sets out the real ones. */
export function indicativeTrees() {
  const rand = seeded(2026);
  const jitter = (k) => (rand() - 0.5) * k;
  const roads = Object.fromEntries(planRoads().map((r) => [r.id, r.path.map(([x, , z]) => [x, z])]));
  /** @type {Record<"date-palm" | "olive" | "citrus", Array<[number, number]>>} */
  const trees = { "date-palm": [], olive: [], citrus: [] };
  const clear = (x, z, uses) => uses.includes(planLandUseAt(x, z));
  const alongLine = (species, points, spacing, offsets, keep) => {
    let carried = spacing / 2;
    for (let i = 0; i + 1 < points.length; i++) {
      const [ax, az] = points[i];
      const [bx, bz] = points[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const [ux, uz] = [(bx - ax) / len, (bz - az) / len];
      for (; carried <= len; carried += spacing) {
        for (const off of offsets) {
          const x = ax + ux * carried - uz * off;
          const z = az + uz * carried + ux * off;
          if (keep(x, z)) trees[species].push([x, z]);
        }
      }
      carried -= len;
    }
  };
  for (const zone of planTreeZones()) {
    if (zone.pattern === "allee") alongLine(zone.species, roads[zone.along], zone.spacing, [-zone.offset, zone.offset], (x, z) => clear(x, z, ["verge", "olive-terrace", "olive-grove", "river-lawn", "palm-garden"]));
    else if (zone.pattern === "row") alongLine(zone.species, zone.line, zone.spacing, [0], (x, z) => clear(x, z, ["river-lawn"]));
    else if (zone.pattern === "garden") {
      for (const area of zone.areas) {
        const count = 2;
        for (let k = 0; k < count; k++) trees[zone.species].push([area.minX + ((k + 0.5) * (area.maxX - area.minX)) / count + jitter(1.5), (area.minZ + area.maxZ) / 2 + jitter(1)]);
      }
    } else {
      const wobble = zone.pattern === "terraces" ? 1.2 : 2.2;
      for (let x = PLAN_SITE.minX + zone.spacing / 2; x < PLAN_SITE.maxX; x += zone.spacing) {
        for (let z = PLAN_SITE.minZ + zone.spacing / 2; z < PLAN_SITE.maxZ; z += zone.spacing) {
          const [tx, tz] = [x + jitter(wobble), z + jitter(wobble)];
          if (clear(tx, tz, zone.fills) && clear(tx + 2.5, tz, zone.fills) && clear(tx - 2.5, tz, zone.fills)) trees[zone.species].push([tx, tz]);
        }
      }
    }
  }
  // Beyond the walls: olive terraces on the slopes, palms along the stream.
  const r = riverGeometryParams("zaitun");
  for (let x = VIEW.minX + 4; x < VIEW.maxX; x += 9) {
    for (let z = VIEW.minZ + 4; z < VIEW.maxZ; z += 9) {
      const [tx, tz] = [x + jitter(1.6), z + jitter(1.6)];
      if (planLandUseAt(tx, tz) !== "outside") continue;
      const beyondWall = Math.max(PLAN_SITE.minX - tx, tx - PLAN_SITE.maxX, PLAN_SITE.minZ - tz, 0);
      const fromStream = Math.abs(tz - planRiverCenterZ(tx)) - r.width / 2;
      const y = planTerrainHeight(tx, tz);
      if (fromStream < 4 || (beyondWall < 5 && tz < PLAN_SITE.maxZ)) continue;
      if (y > 4.4 && rand() < 0.8) trees.olive.push([tx, tz]);
      else if (y <= 4.4 && fromStream < 55 && rand() < 0.34) trees["date-palm"].push([tx, tz]);
    }
  }
  return trees;
}

function planting() {
  const trees = indicativeTrees();
  const inside = (t) => planLandUseAt(t[0], t[1]) !== "outside";
  const outside = (t) => !inside(t);
  return [
    dots(trees.olive.filter(outside), 1.9, C.oliveTree, 0.38),
    dots(trees.olive.filter(inside), 2, C.oliveTree, 0.62),
    dots(trees.citrus, 1.4, C.citrus, 0.95),
    dots(trees["date-palm"].filter(outside), 2.6, C.palm, 0.16),
    dots(trees["date-palm"].filter(outside), 0.9, C.palm, 0.55),
    dots(trees["date-palm"].filter(inside), 2.9, C.palm, 0.26),
    dots(trees["date-palm"].filter(inside), 1, C.palm, 0.95),
  ].join("\n");
}

// ---------------------------------------------------------------- walls, gates, lamps

function boundary() {
  const out = [];
  for (const w of planWalls()) out.push(line([w.from, w.to], `stroke="${C.wall}" stroke-width="2.2" stroke-linecap="butt"`));
  for (const g of planGates()) {
    const [a, b] = g.pavilions;
    out.push(line([[g.x, a.z], [g.x, b.z]], `stroke="${C.brass}" stroke-width="2.6"`));
    for (const p of g.pavilions) out.push(rect(rectOf(p.x, p.z, PLAN_GATE.pavilion, PLAN_GATE.pavilion), `fill="${C.roof}" stroke="${INK}" stroke-width="0.9"`));
  }
  out.push(dots(planLamps().map((l) => [l.x, l.z]), 0.55, "#8a6a2f", 0.9));
  return out.join("\n");
}

// ---------------------------------------------------------------- labels

function labels() {
  const out = [];
  const byId = Object.fromEntries(planAmenities().map((a) => [a.id, a]));
  const at = (id) => byId[id].footprint;
  const lot = Object.fromEntries(planParking().map((p) => [p.id, p.footprint]));
  const tag = (x, z, body, cls = "tag") => out.push(text(x, z, body, `class="${cls}"`));
  /** A label at (tx, tz) with a leader to the thing it names at (x, z). */
  const leader = (x, z, tx, tz, body, anchor = "start") => {
    out.push(line([[x, z], [tx, tz]], `stroke="${INK}" stroke-width="0.6"`));
    out.push(`<circle cx="${n1(px(x))}" cy="${n1(pz(z))}" r="1.6" fill="${INK}"/>`);
    const nudge = anchor === "start" ? 2.5 : anchor === "end" ? -2.5 : 0;
    out.push(text(tx + nudge, tz + (anchor === "middle" ? (tz < z ? -2.5 : 6.5) : 1.8), body, `class="tag" text-anchor="${anchor}"`));
  };
  // Streets.
  for (const x of [-250, 250]) {
    tag(x, planBoulevardZ("a", x), "BOULEVARD A", "street");
    tag(x, planBoulevardZ("b", x), "BOULEVARD B", "street");
    tag(x * 1.2, PLAN_PROMENADE.z, "RIVERSIDE PROMENADE", "street");
  }
  // The garden, west of the pool.
  leader(at("gym").minX, byId.gym.z, -100, -55, "Gym, terrace to the courts", "end");
  leader(at("padel-2").minX, -75, -100, -75, "Padel courts", "end");
  leader(at("tennis").minX, -100, -100, -96, "Tennis court", "end");
  leader(lot.gym.minX, -24, -100, -40, "Gym parking, 16", "end");
  leader(-4, -133, -44, -129, "Garden steps, +6 m", "end");
  // East of the pool.
  leader(6, -34, 66, -30, "Reflecting pool, 72 × 12 m");
  leader(at("playground").maxX, -46, 66, -46, "Playground under shade sails");
  leader(at("lawn").maxX, -88, 66, -88, "Lawn");
  leader(0, -151, 0, -173, "Belvedere", "middle");
  leader(24, 51, 38, 78, "Stream plaza", "middle");
  // The arrival court and the east gate.
  leader(byId.mosque.x, at("mosque").minZ, byId.mosque.x, -58, "Mosque", "middle");
  leader(byId.gallery.x, at("gallery").maxZ, byId.gallery.x - 6, 80, "Sales gallery (show villa)", "middle");
  leader((lot.visitors.minX + lot.visitors.maxX) / 2, lot.visitors.maxZ, -350, 80, "Visitor parking, 20", "middle");
  leader((lot.service.minX + lot.service.maxX) / 2, lot.service.maxZ, 420, 80, "Service parking, 12", "middle");
  leader((lot["apartments-2"].minX + lot["apartments-2"].maxX) / 2, lot["apartments-2"].maxZ, -104, 80, "Apartment parking, 4 courts of 16", "middle");
  tag(PLAN_SITE.minX - 7, planBoulevardZ("a", PLAN_SITE.minX) - 19, "MAIN GATE", "gate end");
  tag(PLAN_SITE.maxX + 7, planBoulevardZ("a", PLAN_SITE.maxX) - 19, "EAST GATE", "gate");
  tag(-370, -95, "WEST LINK", "street turn");
  tag(410, -95, "EAST LINK", "street turn");
  // Levels.
  const level = (x, z, y) => out.push(text(x, z, `+${y.toFixed(1)}`, `class="level"`));
  for (const x of [-290, 290]) {
    level(x, planBoulevardZ("a", x) - 6.2, PLAN_LEVELS.valley);
    level(x, planBoulevardZ("b", x) + 7.6, PLAN_LEVELS.terrace);
    level(x * 0.72, -254, planTerrainHeight(x * 0.72, -254));
  }
  level(0, -112, PLAN_LEVELS.valley);
  level(0, -300, planTerrainHeight(0, -300));
  // Zones.
  for (const x of [-235, 235]) {
    tag(x, -76, "OLIVE BANK", "zone");
    tag(x, -231, "PHASE TWO RESERVE", "zone");
    tag(x, -222, "olive terraces until then", "note");
  }
  tag(0, -312, "OLIVE-TERRACED FOOTHILLS", "zone");
  tag(-250, 104, "STREAM · 36 m", "zone water");
  tag(0, 156, "FAR BANK", "zone");
  return out.join("\n");
}

// ---------------------------------------------------------------- frame

function frame() {
  const out = [];
  const inset = (r) => rect(r, `fill="${PAPER}" fill-opacity="0.92" stroke="${INK}" stroke-width="0.7"`);
  // Scale bar, bottom left of the plan.
  const [bx, bz] = [VIEW.minX + 22, VIEW.maxZ - 14];
  out.push(inset({ minX: bx - 12, maxX: bx + 224, minZ: bz - 14, maxZ: bz + 8 }));
  [0, 50, 100, 200].forEach((m, i, all) => {
    if (i + 1 < all.length) out.push(rect({ minX: bx + m, maxX: bx + all[i + 1], minZ: bz, maxZ: bz + 3 }, `fill="${i % 2 ? PAPER : INK}" stroke="${INK}" stroke-width="0.7"`));
    out.push(text(bx + m, bz - 3.5, `${m}${m === 200 ? " m" : ""}`, `class="small" text-anchor="middle"`));
  });
  // Sun, bottom right: the arrow shows the way the light travels.
  const len = Math.hypot(PLAN_SUN.azimuthX, PLAN_SUN.azimuthZ);
  const [sx, sz] = [PLAN_SUN.azimuthX / len, PLAN_SUN.azimuthZ / len];
  const box = { minX: VIEW.maxX - 236, maxX: VIEW.maxX - 10, minZ: VIEW.maxZ - 38, maxZ: VIEW.maxZ - 6 };
  out.push(inset(box));
  const [cx, cz] = [box.maxX - 36, (box.minZ + box.maxZ) / 2];
  out.push(line([[cx + sx * 14, cz + sz * 14], [cx - sx * 26, cz - sz * 26]], `stroke="${C.brass}" stroke-width="2.2" marker-end="url(#arrow)"`));
  out.push(`<circle cx="${n1(px(cx + sx * 20))}" cy="${n1(pz(cz + sz * 20))}" r="8" fill="${C.brass}"/>`);
  out.push(text(box.minX + 6, box.minZ + 10, "Golden-hour sun", `class="small strong"`));
  out.push(text(box.minX + 6, box.minZ + 18.5, `${PLAN_SUN.elevationDeg}° above the horizon, light falls this way`, `class="tiny"`));
  out.push(text(box.minX + 6, box.minZ + 26.5, "North: not confirmed yet", `class="tiny"`));
  // Flow of the stream.
  out.push(line([[40, 102], [104, 102]], `stroke="#3f7479" stroke-width="1.4" marker-end="url(#flow)"`));
  out.push(text(112, 104, "downstream", `class="tiny" style="fill:#3f7479"`));
  return out.join("\n");
}

// ---------------------------------------------------------------- schedule and section

export function planSchedule() {
  const areas = planAreas(1);
  const site = Object.values(areas).reduce((s, v) => s + v, 0);
  const sum = (uses) => uses.reduce((s, u) => s + (areas[u] ?? 0), 0);
  const villas = planVillas();
  const count = (type) => villas.filter((v) => v.type === type).length;
  const blocks = planApartmentBlocks();
  return {
    siteHa: site / 10_000,
    landscapePct: (100 * sum(PLAN_LANDSCAPE)) / site,
    reservePct: (100 * (areas.reserve ?? 0)) / site,
    rows: [
      ["Private villa plots", sum(["plot"])],
      ["Streets and parking", sum(["road", "parking"])],
      ["Walks, promenade and terraces", sum(["paving"])],
      ["Buildings, courts and playground", sum(["building", "court", "play"])],
      ["Phase two reserve", sum(["reserve"])],
      ["Gardens, lawns and water", sum(["river-lawn", "palm-garden", "lawn", "verge", "water"])],
      ["Olive groves and terraces", sum(["olive-grove", "olive-terrace"])],
    ].map(([label, m2]) => ({ label, ha: m2 / 10_000, pct: (100 * m2) / site })),
    villas: { courtyard: count("courtyard"), "garden-4": count("garden-4"), "garden-3": count("garden-3"), total: villas.length },
    blocks: blocks.length,
    apartments: blocks.reduce((s, b) => s + b.floors, 0),
    parking: { shared: planParking().reduce((s, p) => s + p.spaces, 0), carports: villas.length * 2 },
  };
}

function legend(summary, x0, y0) {
  const out = [];
  let y = y0;
  const row = (swatch, label, note) => {
    out.push(`<g transform="translate(${x0},${y})">${swatch}<text x="34" y="4" class="legend">${esc(label)}</text>${note ? `<text x="34" y="17" class="tiny">${esc(note)}</text>` : ""}</g>`);
    y += note ? 34 : 24;
  };
  out.push(`<text x="${x0}" y="${y - 18}" class="head">Homes</text>`);
  const homes = [
    ["courtyard", `× ${summary.villas.courtyard}`, `<rect x="0" y="-9" width="24" height="20" fill="${TYPE_STYLE.courtyard.fill}" stroke="${INK}" stroke-width="0.7"/><rect x="7" y="-3" width="10" height="8" fill="${C.plot}" stroke="${INK}" stroke-width="0.5"/>`],
    ["garden-4", `× ${summary.villas["garden-4"]}`, `<rect x="14" y="-6" width="10" height="13" fill="${TYPE_STYLE["garden-4"].fill}" fill-opacity="0.72" stroke="${INK}" stroke-width="0.7"/><rect x="0" y="-9" width="14" height="18" fill="${TYPE_STYLE["garden-4"].fill}" stroke="${INK}" stroke-width="0.7"/>`],
    ["garden-3", `× ${summary.villas["garden-3"]}`, `<rect x="12" y="-5" width="9" height="11" fill="${TYPE_STYLE["garden-3"].fill}" fill-opacity="0.72" stroke="${INK}" stroke-width="0.7"/><rect x="0" y="-7" width="12" height="15" fill="${TYPE_STYLE["garden-3"].fill}" stroke="${INK}" stroke-width="0.7"/>`],
    ["apartment", `× ${summary.blocks} (${summary.apartments} homes)`, `<rect x="0" y="-9" width="24" height="18" fill="${TYPE_STYLE.apartment.fill}" fill-opacity="0.4" stroke="${INK}" stroke-width="0.7"/><rect x="0" y="-9" width="24" height="12" fill="${TYPE_STYLE.apartment.fill}" fill-opacity="0.75"/><rect x="0" y="-9" width="24" height="6" fill="${TYPE_STYLE.apartment.fill}"/>`],
  ];
  for (const [key, count, swatch] of homes) row(swatch, `${TYPE_STYLE[key].label}  ${count}`, TYPE_STYLE[key].note);
  y += 34;
  out.push(`<text x="${x0}" y="${y - 18}" class="head">Planting and ground</text>`);
  const dot = (colour, r, halo) => `<circle cx="12" cy="1" r="${halo ?? r}" fill="${colour}" fill-opacity="${halo ? 0.32 : 0.9}"/>${halo ? `<circle cx="12" cy="1" r="${r}" fill="${colour}"/>` : ""}`;
  row(dot(C.palm, 2, 5.5), "Date palm", "boulevard allées, riverside, garden grid");
  row(dot(C.oliveTree, 4.4), "Olive", "the bank, the terraces, between the plots");
  row(dot(C.citrus, 2.8), "Citrus", "villa back gardens");
  row(`<rect x="0" y="-8" width="24" height="16" fill="url(#reserve)" stroke="${MUTED}" stroke-width="0.9" stroke-dasharray="5 4"/>`, "Phase two reserve");
  row(`<line x1="0" y1="1" x2="24" y2="1" stroke="${C.contour}" stroke-width="1"/>`, "Contour, every 2 m");
  row(`<line x1="0" y1="1" x2="24" y2="1" stroke="${C.wall}" stroke-width="2.4"/>`, "Boundary wall, 2.8 m");
  return out.join("\n");
}

function schedule(summary, x0, y0) {
  const out = [];
  out.push(`<text x="${x0}" y="${y0 - 18}" class="head">Land</text>`);
  let y = y0;
  const line2 = (label, ha, pct, strong = false) => {
    out.push(`<text x="${x0}" y="${y}" class="${strong ? "legend strong" : "legend"}">${esc(label)}</text>`);
    out.push(`<text x="${x0 + 268}" y="${y}" class="${strong ? "legend strong" : "legend"} num-col">${ha.toFixed(2)} ha</text>`);
    out.push(`<text x="${x0 + 330}" y="${y}" class="${strong ? "legend strong" : "legend"} num-col">${pct.toFixed(1)}%</text>`);
    y += 21;
  };
  for (const r of summary.rows) line2(r.label, r.ha, r.pct);
  out.push(`<line x1="${x0}" y1="${y - 12}" x2="${x0 + 330}" y2="${y - 12}" stroke="${INK}" stroke-width="0.7"/>`);
  y += 6;
  line2("Site inside the wall", summary.siteHa, 100, true);
  y += 8;
  out.push(`<text x="${x0}" y="${y}" class="legend strong">Landscape ${summary.landscapePct.toFixed(0)}% once phase two is built</text>`);
  y += 19;
  out.push(`<text x="${x0}" y="${y}" class="tiny">${(summary.landscapePct + summary.reservePct).toFixed(0)}% until then: the reserve is planted as olive terraces.</text>`);
  y += 28;
  out.push(`<text x="${x0}" y="${y}" class="legend strong">Parking</text>`);
  y += 19;
  out.push(`<text x="${x0}" y="${y}" class="legend">${summary.parking.carports} carport spaces (two per villa) and ${summary.parking.shared} in shared courts</text>`);
  y += 30;
  out.push(`<text x="${x0}" y="${y}" class="legend strong">Still open</text>`);
  for (const note of [
    "North is not confirmed. The sun shown is the scene's golden-hour sun.",
    "The mosque is drawn facing the boulevard; it turns to face Mecca once north is known.",
    "Tree positions are indicative. The planting zones are what the plan fixes.",
  ]) {
    y += 17;
    out.push(`<text x="${x0}" y="${y}" class="tiny">${esc(note)}</text>`);
  }
  return out.join("\n");
}

/** Section along the garden axis, stream to hillside, heights doubled. */
function section(x0, y0, width, height) {
  const from = 150;
  const to = -300;
  const sx = width / (from - to);
  const sy = sx * 2;
  const base = y0 + height - 26;
  const X = (z) => x0 + (from - z) * sx;
  const Y = (y) => base - y * sy;
  const out = [];
  const zs = xsBetween(from, to, 2);
  out.push(`<text x="${x0}" y="${y0 - 18}" class="head">Section along the garden axis</text>`);
  out.push(`<text x="${x0}" y="${y0 - 2}" class="tiny">Stream to hillside. Heights are drawn at twice their scale; the homes beyond the line are shown faintly.</text>`);
  // Homes beyond the section line, projected onto it.
  const ghost = (z0, z1, y, h, fill) => out.push(`<rect x="${n1(X(Math.max(z0, z1)))}" y="${n1(Y(y + h))}" width="${n1(Math.abs(z1 - z0) * sx)}" height="${n1(h * sy)}" fill="${fill}" fill-opacity="0.34" stroke="${fill}" stroke-width="0.6"/>`);
  const block = planApartmentBlocks()[3];
  block.floorDepths.forEach((d, f) => ghost(block.backZ, block.backZ + d, block.y + f * block.floorHeight, block.floorHeight, TYPE_STYLE.apartment.fill));
  const rows = [15 + 8, 30 + 7, 45 + 8].map((i) => planVillas()[i]);
  for (const v of rows) ghost(v.z - v.depth / 2, v.z + v.depth / 2, v.y, v.height, TYPE_STYLE[v.type].fill);
  // Water, then the ground.
  out.push(`<rect x="${n1(X(120))}" y="${n1(Y(0))}" width="${n1(36 * sx)}" height="${n1(2.4 * sy)}" fill="${C.water}"/>`);
  const profile = zs.map((z) => `${n1(X(z))},${n1(Y(planTerrainHeight(0, z)))}`);
  out.push(`<polygon points="${n1(X(from))},${n1(base + 14)} ${profile.join(" ")} ${n1(X(to))},${n1(base + 14)}" fill="${C.outside}" stroke="none"/>`);
  out.push(`<polyline points="${profile.join(" ")}" fill="none" stroke="${INK}" stroke-width="1.3"/>`);
  // The pool, and marks along the line.
  const pool = planAmenities().find((a) => a.id === "pool").footprint;
  out.push(`<rect x="${n1(X(pool.maxZ))}" y="${n1(Y(PLAN_LEVELS.valley + 0.3))}" width="${n1((pool.maxZ - pool.minZ) * sx)}" height="2.4" fill="${C.pool}"/>`);
  const mark = (z, label, up = 0) => {
    const y = planTerrainHeight(0, z);
    out.push(`<line x1="${n1(X(z))}" y1="${n1(Y(y) - 4)}" x2="${n1(X(z))}" y2="${n1(Y(y) - 20 - up)}" stroke="${INK}" stroke-width="0.5"/>`);
    out.push(`<text x="${n1(X(z))}" y="${n1(Y(y) - 24 - up)}" class="tiny" text-anchor="middle">${esc(label)}</text>`);
  };
  mark(102, "Stream");
  mark(PLAN_PROMENADE.z, "Promenade", 14);
  mark(34, "Apartments", 62);
  mark(planBoulevardZ("a", 0), "Boulevard A", 34);
  mark(-66, "Reflecting pool");
  mark(-128, "Garden steps", 30);
  mark(planBoulevardZ("b", 0), "Boulevard B", 44);
  mark(-228, "Olive terraces");
  mark(PLAN_SITE.minZ, "Wall", 12);
  const lvl = (z, y) => out.push(`<text x="${n1(X(z))}" y="${n1(Y(y) + 15)}" class="level" text-anchor="middle">+${y.toFixed(1)}</text>`);
  lvl(-40, PLAN_LEVELS.valley);
  lvl(-172, PLAN_LEVELS.terrace);
  lvl(-262, planTerrainHeight(0, -262));
  return out.join("\n");
}

// ---------------------------------------------------------------- sheet

const STYLE = `
text { font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif; fill: ${INK}; }
.title { font-size: 34px; font-weight: 600; letter-spacing: -0.4px; }
.title-ar { font-size: 30px; font-weight: 600; font-family: "Geeza Pro", "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif; }
.sub { font-size: 15px; fill: ${MUTED}; }
.head { font-size: 13px; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; fill: ${MUTED}; }
.legend { font-size: 13.5px; }
.strong { font-weight: 700; }
.num-col { text-anchor: end; font-variant-numeric: tabular-nums; }
.small { font-size: 11px; }
.tiny { font-size: 10.5px; fill: ${MUTED}; }
.num { font-size: 7.6px; font-weight: 700; text-anchor: middle; dominant-baseline: central; fill: #fff; paint-order: stroke; stroke: ${INK}; stroke-width: 1.6px; stroke-linejoin: round; }
.tag { font-size: 10.5px; font-weight: 600; paint-order: stroke; stroke: ${PAPER}; stroke-width: 3px; stroke-linejoin: round; }
.street { font-size: 8.4px; font-weight: 700; letter-spacing: 2.2px; text-anchor: middle; dominant-baseline: central; fill: ${MUTED}; }
.gate { font-size: 10px; font-weight: 700; letter-spacing: 1.4px; }
.end { text-anchor: end; }
.zone { font-size: 10px; font-weight: 700; letter-spacing: 1.8px; text-anchor: middle; fill: #4f5c30; paint-order: stroke; stroke: ${PAPER}; stroke-opacity: 0.85; stroke-width: 3.2px; }
.note { font-size: 9.5px; font-style: italic; text-anchor: middle; fill: #4f5c30; paint-order: stroke; stroke: ${PAPER}; stroke-opacity: 0.85; stroke-width: 3px; }
.turn { writing-mode: vertical-rl; }
.water { fill: #3f7479; }
.level { font-size: 9.5px; font-weight: 700; text-anchor: middle; fill: #7a5a1e; paint-order: stroke; stroke: ${PAPER}; stroke-width: 2.6px; }
`;

export function masterplanSvg() {
  const summary = planSchedule();
  const levels = [];
  for (let l = 2; l <= 44; l += 2) levels.push(l);
  const lines = contours(levels, 4);
  const contourPaths = levels.map((l) => `<path d="${lines.get(l).join("")}" stroke="${C.contour}" stroke-width="${l % 10 === 0 ? 0.9 : 0.45}" stroke-opacity="${l % 10 === 0 ? 0.9 : 0.7}" fill="none"/>`).join("\n");
  const site = PLAN_SITE;
  const bandY = BAND_TOP + 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.width} ${SHEET.height}" width="${SHEET.width}" height="${SHEET.height}" role="img" aria-labelledby="mp-title mp-desc">
<title id="mp-title">Zaitun Hills: 28 ha masterplan</title>
<desc id="mp-desc">Site plan of Zaitun Hills seen from above, the stream at the bottom and the foothills at the top. ${summary.villas.total} numbered villa plots in four rows and ${summary.blocks} apartment blocks, two boulevards, the central garden with its reflecting pool, the gym and courts, the playground, the mosque by the main gate, parking, planting and levels.</desc>
<defs>
<style>${STYLE}</style>
<clipPath id="plan-clip"><rect x="0" y="0" width="${n1(PLAN_W)}" height="${n1(PLAN_H)}"/></clipPath>
<clipPath id="site-clip">${rect(site)}</clipPath>
<pattern id="reserve" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><rect width="7" height="7" fill="${C.olive}"/><line x1="0" y1="0" x2="0" y2="7" stroke="${MUTED}" stroke-width="1" stroke-opacity="0.45"/></pattern>
<marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${C.brass}"/></marker>
<marker id="flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#3f7479"/></marker>
</defs>
<rect width="${SHEET.width}" height="${SHEET.height}" fill="${PAPER}"/>
<g id="titles">
<text x="${MARGIN}" y="62" class="title">Zaitun Hills</text>
<text x="${MARGIN + 232}" y="62" class="title-ar" direction="rtl" text-anchor="end" xml:lang="ar">تلال الزيتون</text>
<text x="${MARGIN}" y="92" class="sub">28 ha masterplan · phase one: ${summary.villas.total} villas and ${summary.apartments} apartments · Northern foothills, Erbil</text>
<text x="${SHEET.width - MARGIN}" y="62" class="sub" text-anchor="end">Sawad Holding · sample content</text>
<text x="${SHEET.width - MARGIN}" y="92" class="sub" text-anchor="end">Drawn from components/sawad/scene/layout.ts · metres · scale 1:${Math.round(3780 / S / 10) * 10} at 96 dpi</text>
</g>
<g id="plan" transform="translate(${MARGIN},${PLAN_TOP})" clip-path="url(#plan-clip)">
<g id="ground">${ground()}</g>
<g id="site-ground" clip-path="url(#site-clip)">${siteGround()}</g>
<g id="contours">${contourPaths}</g>
<g id="streets" clip-path="url(#plan-clip)">${streets()}</g>
<g id="amenity-ground">${amenities()}</g>
<g id="parking">${parking()}</g>
<g id="plots">${plots()}</g>
<g id="planting">${planting()}</g>
<g id="homes">${homes()}</g>
<g id="boundary">${boundary()}</g>
<g id="labels">${labels()}</g>
<g id="frame">${frame()}</g>
<rect x="0" y="0" width="${n1(PLAN_W)}" height="${n1(PLAN_H)}" fill="none" stroke="${INK}" stroke-width="1"/>
</g>
<g id="section">${section(MARGIN, bandY, 880, BAND_H - 60)}</g>
<g id="legend">${legend(summary, MARGIN + 960, bandY + 6)}</g>
<g id="schedule">${schedule(summary, MARGIN + 1390, bandY + 6)}</g>
</svg>
`;
}

export function writeMasterplan(path = SVG_PATH) {
  const svg = masterplanSvg();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
  return svg;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const svg = writeMasterplan();
  console.log(`wrote ${SVG_PATH} (${(svg.length / 1024).toFixed(0)} KB)`);
}
