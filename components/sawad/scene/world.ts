import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PMREMGenerator,
  PlaneGeometry,
  Quaternion,
  BackSide,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  palmPositions,
  planAmenities,
  planApartmentBlocks,
  planGates,
  planRoads,
  planTerrainHeight,
  planVillas,
  planWalls,
  PLAN_GATE,
  PLAN_LEVELS,
  PLAN_WALL,
  riverGeometryParams,
  terrainHeight,
  treePositions,
  villaPlots,
  type PlanApartmentBlock,
  type TreeInstance,
  type VillaPlot,
} from "./layout";
import { planLandscape } from "./landscape";
import { buildPlanPool, buildPlanStream, buildPlanTerrain } from "./planWorld";
import { usesPlan } from "./site";
import type { QualityTier, SceneVariant } from "./types";

/*
 * The procedural world, as plain three.js factories: sky, terrain, water, palms, trees and the
 * fallback architecture. SceneWorld.tsx mounts them in the React Three Fiber scene and owns their
 * lifetime; nothing here needs a renderer except buildSkyEnvironment.
 */

/**
 * Sky light on every PBR surface. Tuned against the posters (mean frame luminance within ~1%
 * across variants and views), so matte plaster, palms and terrain keep today's brightness.
 */
export const ENVIRONMENT_INTENSITY = 0.08;
/** Full-strength sky reflections on the model's mirror-like materials (brass, bronze, glass). */
export const REFLECTIVE_ENV_INTENSITY = 1;

/** Metals and polished glass in the baked model get the sky reflection at full strength. */
export function applyReflections(root: Object3D, env: WebGLRenderTarget["texture"] | null): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      // Scalar materials only: textured ones (the trim sheet) carry glTF's default factors of 1.
      const mirror = (std.metalness >= 0.5 && !std.metalnessMap) || (std.roughness <= 0.1 && !std.roughnessMap);
      if (!mirror) continue;
      std.envMap = env;
      std.envMapIntensity = REFLECTIVE_ENV_INTENSITY;
      std.needsUpdate = true;
    }
  });
}

type SunSetup = { elevationDeg: number; azimuthX: number; azimuthZ: number };

const SUN: Record<SceneVariant, SunSetup> = {
  dijla: { elevationDeg: 3.4, azimuthX: 0.96, azimuthZ: 0.2 },
  zaitun: { elevationDeg: 4.2, azimuthX: 0.97, azimuthZ: 0.16 },
  shatt: { elevationDeg: 2.9, azimuthX: 0.95, azimuthZ: 0.26 },
};

/** Light rides a few degrees above the visible sun so the ground still reads at golden hour. */
const LIGHT_LIFT_DEG = 4.5;

/** The golden-hour sun: a warm directional light, with one large shadow map on the high tier. */
export const SUN_LIGHT = {
  color: "#ffa65c",
  intensity: 4.2,
  distance: 700,
  shadow: { mapSize: 4096, extent: 330, near: 10, far: 1600, bias: -0.0004, normalBias: 0.25, radius: 3 },
} as const;
/** Soft fill from the sky above and the warm ground below. */
export const HEMISPHERE_LIGHT = { sky: "#ffe0bf", ground: "#6f6446", intensity: 1.8 } as const;

export function sunDirection(variant: SceneVariant, liftDeg = 0): Vector3 {
  const s = SUN[variant];
  const el = ((s.elevationDeg + liftDeg) * Math.PI) / 180;
  const h = Math.cos(el);
  const len = Math.hypot(s.azimuthX, s.azimuthZ);
  return new Vector3((s.azimuthX / len) * h, Math.sin(el), (s.azimuthZ / len) * h).normalize();
}

/** Where the sun light sits: along the lifted sun direction, aimed at the origin. */
export function sunLightPosition(variant: SceneVariant): Vector3 {
  return sunDirection(variant, LIGHT_LIFT_DEG).multiplyScalar(SUN_LIGHT.distance);
}

// Palette (sRGB hex, converted to linear by Color).
const C = {
  earth: new Color("#a48a63"),
  earthDry: new Color("#b89c72"),
  field: new Color("#6f8638"),
  fallow: new Color("#8f7350"),
  grass: new Color("#87904c"),
  green: new Color("#8c9c4f"),
  greenDeep: new Color("#76873f"),
  bank: new Color("#6b5a44"),
  bed: new Color("#3a3226"),
  cream: new Color("#ecdfc7"),
  creamShade: new Color("#dccaa8"),
  parapet: new Color("#f3e9d6"),
  courtyard: new Color("#9b8466"),
  glass: new Color("#6d5d4e"),
  brass: new Color("#c9a24a"),
  stone: new Color("#d2c3a2"),
  wall: new Color("#d6c29c"),
  pool: new Color("#4f9a9a"),
  hedge: new Color("#56692f"),
  wood: new Color("#6b5038"),
  slab: new Color("#efe6d5"),
};

/** The palette as sRGB hex ("#ecdfc7"), for checking the baked model's materials against it. */
export function paletteHex(): Record<keyof typeof C, string> {
  return Object.fromEntries(Object.entries(C).map(([k, c]) => [k, `#${c.getHexString()}`])) as Record<keyof typeof C, string>;
}

/** Dusty golden-hour haze: the fog colour and the clear colour behind the sky dome. */
export const HAZE_COLOR = "#e6ae86";
const HAZE = new Color(HAZE_COLOR);
/** Exponential fog density (Shatt sits lower and hazier). */
export const fogDensity = (variant: SceneVariant): number => (variant === "shatt" ? 0.00085 : 0.00072);

/** Art-directed golden-hour sky (a physical model turns teal opposite a low sun). */
const SKY = {
  zenith: new Color("#56618a"),
  horizonAway: new Color("#e2ae98"),
  horizonSun: new Color("#ffbd70"),
  ground: new Color("#c99a72"),
};

// ---------------------------------------------------------------- geometry helpers

type Part = BufferGeometry;

function colorize(geo: BufferGeometry, color: Color): BufferGeometry {
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new BufferAttribute(arr, 3));
  return geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: Color): Part {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return colorize(g, color);
}

function merge(parts: Part[]): BufferGeometry {
  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!geo) throw new Error("mergeGeometries failed");
  return geo;
}

function transformParts(parts: Part[], m: Matrix4): Part[] {
  for (const p of parts) p.applyMatrix4(m);
  return parts;
}

// ---------------------------------------------------------------- sky

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizonAway;
uniform vec3 uHorizonSun;
uniform vec3 uGround;
uniform float uTime;
uniform float uSunDisc; // 1 on screen; 0 for the environment map (no HDR spike to prefilter)
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sunCos = dot(d, uSunDir);
  vec2 dh = normalize(d.xz + 1e-5);
  // Clamped: rounding can push the dot below -1, and pow() of a negative is NaN. One NaN texel
  // would spread through the whole prefiltered environment map.
  float az = clamp(dot(dh, normalize(uSunDir.xz)) * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = mix(uHorizonAway, uHorizonSun, pow(az, 2.2));
  float t = pow(clamp(h, 0.0, 1.0), 0.36);
  vec3 col = mix(horizon, uZenith, t);
  // Warm glow around the sun, strongest near the horizon.
  col += uSunColor * pow(max(sunCos, 0.0), 10.0) * 0.55 * (1.0 - t * 0.7);
  col += uSunColor * pow(max(sunCos, 0.0), 160.0) * 2.2 * uSunDisc;
  col += uSunColor * smoothstep(0.99975, 0.9999, sunCos) * 18.0 * uSunDisc;
  // Thin high streaks of cloud catching the light.
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.06);
    float band = sin(p.x * 0.9 + sin(p.y * 0.45 + 1.7) * 2.6 + uTime * 0.004) * 0.5 + 0.5;
    band *= sin(p.y * 2.3 + p.x * 0.3) * 0.5 + 0.5;
    float c = smoothstep(0.62, 0.95, band) * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.18, 0.5, h));
    vec3 cloud = mix(vec3(0.95, 0.62, 0.55), uSunColor * 1.15, pow(az, 3.0));
    col = mix(col, cloud, c * 0.45);
  } else {
    col = mix(horizon, uGround, smoothstep(0.0, -0.06, h));
  }
  if (uSunDisc < 0.5) col = clamp(col, 0.0, 16.0); // environment map: keep the prefilter finite
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export type Sky = { mesh: Mesh; material: ShaderMaterial };

export function buildSky(sunDir: Vector3): Sky {
  const material = new ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new Color(1.0, 0.6, 0.28).multiplyScalar(1.6) },
      uZenith: { value: SKY.zenith.clone().multiplyScalar(1.5) },
      uHorizonAway: { value: SKY.horizonAway.clone().multiplyScalar(1.7) },
      uHorizonSun: { value: SKY.horizonSun.clone().multiplyScalar(1.9) },
      uGround: { value: SKY.ground.clone().multiplyScalar(1.4) },
      uTime: { value: 0 },
      uSunDisc: { value: 1 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
  mesh.scale.setScalar(9000);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = "sky";
  return { mesh, material };
}

// ---------------------------------------------------------------- terrain

export function buildTerrain(variant: SceneVariant, tier: QualityTier): Mesh {
  if (usesPlan(variant)) return buildPlanTerrain(tier);
  const size = 3600;
  const seg = tier === "high" ? 300 : 170;
  const geo = new PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(variant, x, z);
    pos.setY(i, y);
    // Irrigated green near water and on the pad, dry ochre on the rises.
    const inSite = x > SITE.minX - 20 && x < SITE.maxX + 20 && z > SITE.minZ - 20 && z < SITE.maxZ + 20;
    const river = riverGeometryParams(variant);
    const fromWater = Math.abs(z - river.near - river.width / 2) - river.width / 2;
    const wet = y < 0.4 ? 1 : Math.max(0, 1 - fromWater / 22);
    const mottled = 0.5 + 0.5 * Math.sin(x * 0.031 + Math.cos(z * 0.027) * 2.0);
    if (y < -0.2) tmp.copy(C.bed);
    else if (inSite) tmp.copy(C.green).lerp(C.greenDeep, mottled * 0.6);
    else {
      // Patchwork of irrigated fields and fallow plots, greener toward the river.
      const plot = Math.sin(Math.floor(x / 70) * 12.9898 + Math.floor(z / 55) * 78.233) * 43758.5453;
      const irrigated = plot - Math.floor(plot) < 0.55;
      const nearRiver = Math.max(0, 1 - fromWater / 900);
      tmp.copy(C.earth).lerp(C.earthDry, Math.min(1, Math.max(0, (y - 3) / 14)));
      if (variant === "zaitun") tmp.lerp(C.grass, 0.55 + 0.25 * mottled);
      if (irrigated) tmp.lerp(C.field, (0.55 + 0.3 * mottled) * (variant === "zaitun" ? 0.6 : 1) * (0.35 + 0.65 * nearRiver));
      else tmp.lerp(C.fallow, 0.35 * mottled);
      tmp.lerp(C.bank, wet * 0.7);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}

// ---------------------------------------------------------------- water

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uDeep;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uChop;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Sum of directional waves; returns slope (d/dx, d/dz).
vec2 waves(vec2 p, float t) {
  vec2 s = vec2(0.0);
  vec2 dirs[6];
  dirs[0] = normalize(vec2(1.0, 0.25)); dirs[1] = normalize(vec2(0.8, -0.6));
  dirs[2] = normalize(vec2(0.3, 1.0));  dirs[3] = normalize(vec2(-0.7, 0.7));
  dirs[4] = normalize(vec2(0.95, 0.1)); dirs[5] = normalize(vec2(-0.2, -1.0));
  float freq = 0.07; float amp = 0.045; float speed = 0.7;
  for (int i = 0; i < 6; i++) {
    float ph = dot(dirs[i], p) * freq + t * speed;
    s += dirs[i] * cos(ph) * amp;
    freq *= 1.62; amp *= 0.7; speed *= 1.18;
  }
  return s * uChop;
}

void main() {
  vec2 sl = waves(vWorld.xz, uTime);
  // Fine glitter that only shows where the sun hits.
  float g = hash(floor(vWorld.xz * 1.6) + floor(uTime * 6.0));
  sl += (vec2(g, fract(g * 7.13)) - 0.5) * 0.018;
  vec3 n = normalize(vec3(-sl.x, 1.0, -sl.y));
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float sunAmt = max(dot(R, uSunDir), 0.0);
  sky += uSunColor * (pow(sunAmt, 6.0) * 0.35 + pow(sunAmt, 40.0) * 0.9);
  float glint = pow(sunAmt, 1200.0) * 90.0 + pow(sunAmt, 260.0) * 9.0;
  vec3 body = mix(uDeep, uHorizon * 0.32, 0.45) * (0.7 + 0.3 * max(dot(n, uSunDir), 0.0));
  vec3 col = mix(body, sky, fres) + uSunColor * glint;
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createWaterMaterial(sunDir: Vector3, variant: SceneVariant): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone() },
      uSunColor: { value: new Color(1.0, 0.62, 0.32).multiplyScalar(2.2) },
      uHorizon: { value: SKY.horizonSun.clone().lerp(SKY.horizonAway, 0.35).multiplyScalar(1.6) },
      uZenith: { value: SKY.zenith.clone().multiplyScalar(1.4) },
      uDeep: { value: new Color(variant === "zaitun" ? "#24352c" : "#203029") },
      uFogColor: { value: HAZE.clone() },
      uFogDensity: { value: fogDensity(variant) },
      uChop: { value: variant === "zaitun" ? 1.3 : 1.0 },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
  });
}

/** The river surface: one wide quad along the channel. */
export function buildWater(variant: SceneVariant, material: ShaderMaterial): Mesh {
  if (usesPlan(variant)) return buildPlanStream(material);
  const r = riverGeometryParams(variant);
  const depth = r.width + 220;
  const geo = new PlaneGeometry(3600, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, r.near + r.width / 2);
  const mesh = new Mesh(geo, material);
  mesh.name = "river";
  return mesh;
}

/** The reflecting pool in the central garden. It shares the river's water material. */
export function buildGardenPool(material: ShaderMaterial, variant: SceneVariant = "dijla"): Mesh {
  if (usesPlan(variant)) return buildPlanPool(material);
  const geo = new PlaneGeometry(8, 60);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, PAD_Y + 0.3, -46);
  const mesh = new Mesh(geo, material);
  mesh.name = "garden-pool";
  return mesh;
}

// ---------------------------------------------------------------- palms & trees

function palmTrunkGeometry(): BufferGeometry {
  const g = new CylinderGeometry(0.2, 0.34, 1, 7, 10, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const a = new Color("#9a8062");
  const b = new Color("#7a634b");
  const tmp = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) + 0.9 * y * y); // gentle curve; scale gives the lean
    tmp.copy(Math.round(y * 10) % 2 === 0 ? a : b);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** One drooping, V-folded frond as a strip. */
function frond(azimuth: number, length: number, rise: number, droop: number, width: number, base: Color, tip: Color): BufferGeometry {
  const seg = 7;
  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const dir = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const side = new Vector3(-dir.z, 0, dir.x);
  const tmp = new Color();
  for (let s = 0; s <= seg; s++) {
    const t = s / seg;
    const along = length * t;
    const y = rise * t - droop * t * t;
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (1 - t * 0.35);
    const centre = dir.clone().multiplyScalar(along).setY(y);
    const fold = w * 0.35;
    const l = centre.clone().addScaledVector(side, -w / 2).setY(y - fold);
    const r = centre.clone().addScaledVector(side, w / 2).setY(y - fold);
    verts.push(l.x, l.y, l.z, centre.x, centre.y, centre.z, r.x, r.y, r.z);
    tmp.copy(base).lerp(tip, t);
    for (let k = 0; k < 3; k++) cols.push(tmp.r, tmp.g, tmp.b);
    if (s < seg) {
      const i0 = s * 3;
      const i1 = (s + 1) * 3;
      idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1, i0 + 1, i1 + 1, i0 + 2, i0 + 2, i1 + 1, i1 + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(cols), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function palmCrownGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const base = new Color("#94a050");
  const tip = new Color("#56692c");
  const n = 16;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
    const outer = i % 2 === 0;
    parts.push(frond(az, outer ? 5.2 : 4.4, outer ? 1.9 : 2.6, outer ? 5.0 : 3.6, outer ? 0.75 : 0.62, base, tip));
  }
  // Young upright fronds.
  for (let i = 0; i < 4; i++) parts.push(frond((i / 4) * Math.PI * 2 + 0.4, 2.6, 3.0, 1.2, 0.7, new Color("#8d9a48"), new Color("#56662a")));
  // Dry skirt.
  for (let i = 0; i < 3; i++) parts.push(frond((i / 3) * Math.PI * 2 + 1.1, 2.4, -0.3, 1.6, 0.6, new Color("#8a6a40"), new Color("#6e5434")));
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error("palm crown merge failed");
  return g;
}

function roundTreeGeometry(): { trunk: BufferGeometry; crown: BufferGeometry } {
  const trunk = colorize(new CylinderGeometry(0.16, 0.26, 2.2, 6, 1, true).translate(0, 1.1, 0), new Color("#5f5040"));
  const blobs: BufferGeometry[] = [];
  const offsets: Array<[number, number, number, number]> = [
    [0, 3.0, 0, 1.9],
    [1.1, 2.6, 0.5, 1.4],
    [-1.0, 2.7, -0.4, 1.5],
    [0.2, 3.6, -0.9, 1.2],
  ];
  for (const [x, y, z, r] of offsets) {
    const g = new IcosahedronGeometry(r, 1);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const k = 1 + 0.12 * Math.sin(p.getX(i) * 5.1 + p.getY(i) * 3.7 + p.getZ(i) * 4.3);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.82, p.getZ(i) * k);
    }
    g.translate(x, y, z);
    g.deleteAttribute("uv");
    blobs.push(colorize(g, new Color("#ffffff")));
  }
  const crown = mergeGeometries(blobs, false)!;
  crown.computeVertexNormals();
  for (const b of blobs) b.dispose();
  trunk.deleteAttribute("uv");
  return { trunk, crown };
}

function instanceTrees(
  trees: TreeInstance[],
  geometry: BufferGeometry,
  material: Material,
  place: (t: TreeInstance, m: Matrix4) => void,
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, trees.length));
  const m = new Matrix4();
  trees.forEach((t, i) => {
    place(t, m);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = trees.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Instanced planting: the meshes to mount, and one call that frees everything they use. */
export type Planting = { objects: InstancedMesh[]; dispose: () => void };

function planting(objects: InstancedMesh[]): Planting {
  return {
    objects,
    dispose() {
      for (const mesh of objects) {
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
        mesh.dispose(); // the instance buffers
      }
    },
  };
}

/** Fallback planting caps on the 28 ha plan: the procedural trees are heavier than the library's distance cards. */
const PLAN_FALLBACK_TREES: Record<QualityTier, { palms: number; olives: number }> = { high: { palms: 1400, olives: 2600 }, low: { palms: 700, olives: 900 } };

/** Every k-th item, so a thinned list still covers the whole site. */
function spread<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const step = list.length / max;
  return Array.from({ length: max }, (_, i) => list[Math.floor(i * step)]);
}

export function buildPalms(variant: SceneVariant, tier: QualityTier): Planting {
  const palms = usesPlan(variant) ? spread(planLandscape(tier).palms, PLAN_FALLBACK_TREES[tier].palms) : palmPositions(variant, tier === "high" ? 1800 : 700);
  return buildPalmsAt(palms);
}

/** Procedural date palms at the given spots: instanced trunks and crowns. */
export function buildPalmsAt(palms: TreeInstance[]): Planting {
  const trunkGeo = palmTrunkGeometry();
  const crownGeo = palmCrownGeometry();
  const trunkMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  // A touch of emission reads as light passing through backlit fronds.
  const crownMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: DoubleSide, emissive: new Color("#3d4416"), emissiveIntensity: 0.55 });
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const s = new Vector3();
  const p = new Vector3();
  const heightOf = (t: TreeInstance) => 9 + t.scale * 6.5 + Math.abs(t.lean) * 3;
  const trunks = instanceTrees(
    palms,
    trunkGeo,
    trunkMat,
    (t, m) => {
      q.setFromAxisAngle(up, t.rotation);
      const h = heightOf(t);
      s.set(1 + Math.abs(t.lean) * 2.4, h, 1);
      m.compose(p.set(t.x, t.y - 0.3, t.z), q, s);
    },
    "palm-trunks",
  );
  const crowns = instanceTrees(
    palms,
    crownGeo,
    crownMat,
    (t, m) => {
      const h = heightOf(t);
      const leanX = 0.9 * (1 + Math.abs(t.lean) * 2.4);
      // Trunk top in world space (the bend is along local +x).
      const top = new Vector3(leanX, h - 0.3, 0).applyAxisAngle(up, t.rotation);
      q.setFromAxisAngle(up, t.rotation * 1.7 + 0.3);
      const k = 0.85 + t.scale * 0.25;
      m.compose(p.set(t.x + top.x, t.y + top.y, t.z + top.z), q, s.set(k, k, k));
    },
    "palm-crowns",
  );
  crowns.castShadow = true;
  // Per-palm colour variation.
  const tint = new Color();
  palms.forEach((t, i) => {
    const v = 0.82 + ((Math.sin(t.x * 12.9 + t.z * 78.2) + 1) / 2) * 0.32;
    crowns.setColorAt(i, tint.setRGB(v, v * (0.96 + t.scale * 0.04), v * 0.9));
  });
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  return planting([trunks, crowns]);
}

/** Round-crowned trees: olives across Zaitun's foothills, a few shade trees elsewhere. */
export function buildRoundTrees(variant: SceneVariant, tier: QualityTier): Planting {
  if (usesPlan(variant)) {
    const land = planLandscape(tier);
    return buildRoundTreesAt(spread([...land.olives, ...land.citrus], PLAN_FALLBACK_TREES[tier].olives), variant);
  }
  const count = variant === "zaitun" ? (tier === "high" ? 2600 : 900) : 72;
  return buildRoundTreesAt(treePositions(variant, count), variant);
}

/** Procedural round-crowned trees at the given spots (olives on Zaitun, shade trees elsewhere). */
export function buildRoundTreesAt(trees: TreeInstance[], variant: SceneVariant): Planting {
  const { trunk, crown } = roundTreeGeometry();
  const trunkMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const crownMat = new MeshStandardMaterial({ color: variant === "zaitun" ? "#7f8b62" : "#4a6230", roughness: 0.9 });
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const s = new Vector3();
  const p = new Vector3();
  const place = (t: TreeInstance, m: Matrix4) => {
    q.setFromAxisAngle(up, t.rotation);
    m.compose(p.set(t.x, t.y - 0.1, t.z), q, s.setScalar(t.scale * (variant === "zaitun" ? 1.15 : 1)));
  };
  return planting([instanceTrees(trees, trunk, trunkMat, place, "tree-trunks"), instanceTrees(trees, crown, crownMat, place, "tree-crowns")]);
}

// ---------------------------------------------------------------- architecture

function windowRow(parts: Part[], width: number, y: number, z: number, spacing: number, h: number) {
  const n = Math.max(1, Math.floor((width - 3) / spacing));
  const start = -((n - 1) * spacing) / 2;
  for (let i = 0; i < n; i++) parts.push(box(0.95, h, 0.2, start + i * spacing, y, z, C.glass));
}

function parapet(parts: Part[], w: number, d: number, y: number, cx = 0, cz = 0) {
  const t = 0.35;
  const h = 0.7;
  parts.push(box(w, h, t, cx, y, cz + d / 2 - t / 2, C.parapet));
  parts.push(box(w, h, t, cx, y, cz - d / 2 + t / 2, C.parapet));
  parts.push(box(t, h, d - 2 * t, cx + w / 2 - t / 2, y, cz, C.parapet));
  parts.push(box(t, h, d - 2 * t, cx - w / 2 + t / 2, y, cz, C.parapet));
}

/** A villa in local space: entrance faces +z, origin at plot centre, y from the pad. */
function villaParts(plot: VillaPlot, y0 = PAD_Y): Part[] {
  const parts: Part[] = [];
  const { width: w, depth: d, height: h } = plot;
  if (plot.type === "courtyard") {
    const wing = 6;
    parts.push(box(w, h, wing, 0, y0, d / 2 - wing / 2, C.cream));
    parts.push(box(w, h - 0.6, wing, 0, y0, -d / 2 + wing / 2, C.creamShade));
    parts.push(box(wing, h - 0.3, d - 2 * wing, w / 2 - wing / 2, y0, 0, C.cream));
    parts.push(box(wing, h - 0.3, d - 2 * wing, -w / 2 + wing / 2, y0, 0, C.creamShade));
    parts.push(box(w - 2 * wing, 0.12, d - 2 * wing, 0, y0, 0, C.courtyard));
    parts.push(box(2.2, 0.5, 2.2, 0, y0, 0, C.pool)); // courtyard fountain
    parapet(parts, w, d, y0 + h);
    parts.push(box(4.2, 2.6, 4.2, w / 2 - 3, y0 + h, -d / 2 + 3, C.cream)); // stair tower
    parapet(parts, 4.2, 4.2, y0 + h + 2.6, w / 2 - 3, -d / 2 + 3);
  } else {
    const lowW = w * 0.42;
    parts.push(box(w - lowW, h, d, -lowW / 2, y0, 0, C.cream));
    parts.push(box(lowW, h * 0.55, d * 0.8, (w - lowW) / 2, y0, -d * 0.1, C.creamShade));
    parapet(parts, w - lowW, d, y0 + h, -lowW / 2, 0);
    // Pergola on the low wing's roof terrace.
    for (let i = 0; i < 6; i++) parts.push(box(0.18, 0.18, d * 0.7, (w - lowW) / 2 - lowW / 2 + 0.6 + i * (lowW / 6), y0 + h * 0.55 + 2.4, -d * 0.1, C.wood));
    for (const sx of [-1, 1]) parts.push(box(0.25, 2.4, 0.25, (w - lowW) / 2 + sx * (lowW / 2 - 0.5), y0 + h * 0.55, -d * 0.1 + d * 0.33, C.wood));
    // Garden pool behind.
    parts.push(box(w * 0.5, 0.3, 4, -w * 0.15, y0 - 0.15, -d / 2 - 4.5, C.pool));
  }
  // Facades: tall slots on two floors, front and back.
  windowRow(parts, w, y0 + 1.0, d / 2 + 0.02, 3.4, 2.3);
  windowRow(parts, w, y0 + 4.4, d / 2 + 0.02, 3.4, 1.9);
  windowRow(parts, w, y0 + 4.4, -d / 2 - 0.02, 4.2, 1.9);
  // Entrance: dark door + slim brass canopy.
  parts.push(box(1.8, 2.8, 0.3, 0, y0, d / 2 + 0.05, C.glass));
  parts.push(box(4.4, 0.14, 1.8, 0, y0 + 3.2, d / 2 + 0.9, C.brass));
  // Low hedge around the plot.
  const pw = w + 6;
  const pd = d + 12;
  parts.push(box(pw, 0.9, 0.7, 0, y0, -pd / 2 + 2, C.hedge));
  parts.push(box(0.7, 0.9, pd - 4, pw / 2, y0, -2, C.hedge));
  parts.push(box(0.7, 0.9, pd - 4, -pw / 2, y0, -2, C.hedge));
  return parts;
}

function apartmentParts(cx: number, y0 = PAD_Y, back = APARTMENT_BACK_Z): Part[] {
  const parts: Part[] = [];
  const w = APARTMENT_WIDTH;
  for (let f = 0; f < 4; f++) {
    const depth = apartmentFloorDepth(f);
    const y = y0 + f * FLOOR_HEIGHT;
    const front = back + depth;
    const wallDepth = depth - 2.6;
    // Floor slab (with a crisp lighter edge) and the enclosed volume set back behind the terrace.
    parts.push(box(w + 0.8, 0.38, depth + 0.4, cx, y, back + depth / 2, C.slab));
    parts.push(box(w, FLOOR_HEIGHT - 0.38, wallDepth, cx, y + 0.38, back + wallDepth / 2, f % 2 ? C.creamShade : C.cream));
    // Glazing band facing the river.
    parts.push(box(w - 3, 2.5, 0.12, cx, y + 0.7, back + wallDepth + 0.06, C.glass));
    for (let i = 0; i <= 7; i++) parts.push(box(0.35, FLOOR_HEIGHT - 0.38, 0.5, cx - w / 2 + 1 + i * ((w - 2) / 7), y + 0.38, back + wallDepth + 0.2, C.cream));
    // Terrace balustrade.
    parts.push(box(w, 1.0, 0.18, cx, y + 0.38, front - 0.1, C.parapet));
    // Planter along each terrace edge.
    parts.push(box(w - 4, 0.6, 0.7, cx, y + 0.38, front - 0.7, C.hedge));
  }
  const roofY = y0 + 4 * FLOOR_HEIGHT;
  parts.push(box(w + 0.8, 0.38, apartmentFloorDepth(3) + 0.4, cx, roofY, back + apartmentFloorDepth(3) / 2, C.slab));
  parapet(parts, w + 0.8, apartmentFloorDepth(3) + 0.4, roofY + 0.38, cx, back + apartmentFloorDepth(3) / 2);
  // Brass-lined entrance canopy on the garden side.
  parts.push(box(6, 0.22, 2.4, cx, y0 + 3.0, back - 1.2, C.brass));
  return parts;
}

function ribbon(points: Array<[number, number]>, width: number, y: number, color: Color): Part {
  return ribbonPath(points.map(([x, z]) => [x, y, z]), width, 0, color);
}

/** A flat strip along a centre line that follows the ground ([x, y, z] points), `lift` above it. */
function ribbonPath(path: Array<[number, number, number]>, width: number, lift: number, color: Color): Part {
  const points = path.map(([x, , z]): [number, number] => [x, z]);
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const y = path[i][1] + lift;
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)];
    const [px, pz] = points[Math.max(0, i - 1)];
    const dx = nx - px;
    const dz = nz - pz;
    const len = Math.hypot(dx, dz) || 1;
    const ox = (-dz / len) * (width / 2);
    const oz = (dx / len) * (width / 2);
    verts.push(x + ox, y, z + oz, x - ox, y, z - oz);
    if (i < points.length - 1) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Make sure normals point up.
  const nrm = g.getAttribute("normal");
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  g.setAttribute("uv", new BufferAttribute(new Float32Array((verts.length / 3) * 2), 2));
  return colorize(g.toNonIndexed(), color);
}

function siteParts(): Part[] {
  const parts: Part[] = [];
  const [a, b, promenade, axis] = boulevardPath();
  parts.push(ribbon(a, BOULEVARD_WIDTH, PAD_Y + 0.06, C.stone));
  parts.push(ribbon(b, BOULEVARD_WIDTH, PAD_Y + 0.06, C.stone));
  parts.push(ribbon(promenade, 8, PAD_Y + 0.06, C.stone));
  parts.push(ribbon(axis, 5, PAD_Y + 0.07, C.stone));
  // Boundary wall with gate gaps where the boulevards leave the site.
  const h = 2.8;
  const t = 0.6;
  const wallY = PAD_Y;
  const gaps = BOULEVARD_Z.map((z) => z + boulevardCurve(SITE.maxX));
  const sideWall = (x: number) => {
    const zs = [SITE.minZ, gaps[1] - 9, gaps[1] + 9, gaps[0] - 9, gaps[0] + 9, SITE.maxZ - 8];
    for (let i = 0; i < zs.length; i += 2) {
      const len = zs[i + 1] - zs[i];
      parts.push(box(t, h, len, x, wallY, zs[i] + len / 2, C.wall));
    }
  };
  sideWall(SITE.minX);
  sideWall(SITE.maxX);
  parts.push(box(SITE.maxX - SITE.minX, h, t, 0, wallY, SITE.minZ, C.wall));
  // Gate pavilions with a brass lintel.
  for (const x of [SITE.minX, SITE.maxX]) {
    for (const z of BOULEVARD_Z.map((bz) => bz + boulevardCurve(x))) {
      for (const s of [-1, 1]) parts.push(box(4.5, 5, 4.5, x, wallY, z + s * 9.5, C.cream));
      parts.push(box(1.2, 0.5, 23.5, x, wallY + 5, z, C.brass));
    }
  }
  // Central garden reflecting pool rim.
  parts.push(box(9.2, 0.35, 61, 0, PAD_Y, -46, C.parapet));
  return parts;
}

/** Walls along a run, as boxes about 8 m long that step with the ground. */
function wallRun(parts: Part[], from: [number, number], to: [number, number]) {
  const { height: h, thickness: t } = PLAN_WALL;
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const n = Math.max(1, Math.round(len / 8));
  const alongX = Math.abs(to[0] - from[0]) > Math.abs(to[1] - from[1]);
  for (let i = 0; i < n; i++) {
    const x = from[0] + ((to[0] - from[0]) * (i + 0.5)) / n;
    const z = from[1] + ((to[1] - from[1]) * (i + 0.5)) / n;
    const piece = len / n + 0.05;
    const y = planTerrainHeight(x, z) - 0.3;
    parts.push(alongX ? box(piece, h + 0.3, t, x, y, z, C.wall) : box(t, h + 0.3, piece, x, y, z, C.wall));
  }
}

const AMENITY_COLORS: Partial<Record<string, Color>> = { padel: C.pool, tennis: C.fallow, playground: C.wood, terrace: C.slab, belvedere: C.slab, plaza: C.slab, steps: C.stone };

/** Streets, walls, gates and the garden of the 28 ha plan, as flat-coloured parts. */
function planSiteParts(): Part[] {
  const parts: Part[] = [];
  for (const road of planRoads()) parts.push(ribbonPath(road.path, road.width, road.kind === "walk" ? 0.07 : 0.06, C.stone));
  for (const w of planWalls()) wallRun(parts, w.from, w.to);
  for (const gate of planGates()) {
    for (const p of gate.pavilions) parts.push(box(PLAN_GATE.pavilion, PLAN_GATE.pavilionHeight, PLAN_GATE.pavilion, p.x, gate.y, p.z, C.cream));
    parts.push(box(1.2, 0.5, PLAN_GATE.lintelLength, gate.x, gate.y + PLAN_GATE.pavilionHeight, gate.z, C.brass));
  }
  for (const a of planAmenities()) {
    const f = a.footprint;
    const w = f.maxX - f.minX;
    const d = f.maxZ - f.minZ;
    const cx = (f.minX + f.maxX) / 2;
    const cz = (f.minZ + f.maxZ) / 2;
    if (a.kind === "pool") parts.push(box(w, a.size?.height ?? 0.35, d, cx, a.y, cz, C.parapet));
    else if (a.kind === "gym") parts.push(box(w * 0.9, 7.2, d * 0.7, cx, a.y, cz, C.cream));
    else if (a.kind === "mosque") {
      parts.push(box(16, 7.5, 16, a.x, a.y, a.z, C.cream));
      parts.push(box(3, 17, 3, a.x + 9.5, a.y, a.z + 9.5, C.creamShade));
    } else if (a.kind === "gallery") {
      const local = villaParts({ index: -1, x: 0, z: 0, facing: 1, type: "courtyard", width: 24, depth: 22, height: 7.6 }, a.y);
      parts.push(...transformParts(local, new Matrix4().makeRotationY(a.rotation).setPosition(a.x, 0, a.z)));
    } else if (a.kind === "steps") {
      // A ramp up the bank, under the steps the model draws.
      const rise = a.size?.rise ?? PLAN_LEVELS.terrace - PLAN_LEVELS.valley;
      parts.push(ribbonPath([[cx, a.y, f.maxZ], [cx, a.y + rise, f.minZ]], w, 0.05, C.stone));
    } else if (a.kind !== "lawn") parts.push(box(w, a.kind === "terrace" || a.kind === "plaza" ? 0.09 : 0.12, d, cx, a.y, cz, AMENITY_COLORS[a.kind] ?? C.slab));
  }
  return parts;
}

function planBlockParts(b: PlanApartmentBlock): Part[] {
  return apartmentParts(b.x, b.y, b.backZ);
}

/** The procedural compound: every building merged from flat-coloured boxes (the fallback). */
export function buildArchitecture(variant: SceneVariant = "dijla"): Mesh {
  const parts: Part[] = [];
  const m = new Matrix4();
  const plan = usesPlan(variant);
  const plots = plan ? planVillas() : villaPlots();
  for (const plot of plots) {
    const local = villaParts(plot, "y" in plot ? (plot as { y: number }).y : PAD_Y);
    m.makeRotationY(plot.facing === 1 ? 0 : Math.PI);
    m.setPosition(plot.x, 0, plot.z);
    parts.push(...transformParts(local, m));
  }
  if (plan) {
    for (const b of planApartmentBlocks()) parts.push(...planBlockParts(b));
    parts.push(...planSiteParts());
  } else {
    for (const cx of APARTMENT_BUILDINGS_X) parts.push(...apartmentParts(cx));
    parts.push(...siteParts());
  }
  for (const p of parts) if (!p.getAttribute("uv")) p.setAttribute("uv", new BufferAttribute(new Float32Array(p.getAttribute("position").count * 2), 2));
  const nonIndexed = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const geo = merge(nonIndexed);
  for (const p of parts) p.dispose();
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "architecture";
  return mesh;
}

// ---------------------------------------------------------------- environment

/**
 * Reflections of the golden-hour sky (glass, brass, pools), prefiltered once with PMREM. Only
 * the sky is rendered, so the environment never depends on the camera or the compound, and the
 * sun disc is left out: its highlight comes from the directional light. The caller disposes
 * the returned target.
 */
export function buildSkyEnvironment(renderer: WebGLRenderer, sky: Sky): WebGLRenderTarget {
  const envScene = new Scene();
  const envSky = sky.material.clone();
  envSky.uniforms.uSunDisc.value = 0;
  const skyCopy = new Mesh(sky.mesh.geometry, envSky);
  skyCopy.scale.copy(sky.mesh.scale);
  skyCopy.frustumCulled = false;
  envScene.add(skyCopy);
  const pmrem = new PMREMGenerator(renderer);
  try {
    return pmrem.fromScene(envScene, 0.02, 0.1, 100, { size: 256 });
  } finally {
    pmrem.dispose();
    envSky.dispose();
  }
}

/** Lights a scene with the prefiltered sky (null removes it again). */
export function setSceneEnvironment(scene: Scene, texture: WebGLRenderTarget["texture"] | null): void {
  scene.environment = texture;
  if (texture) scene.environmentIntensity = ENVIRONMENT_INTENSITY;
}

/** The longest step the sky and water advance in one frame, so a stalled tab resumes smoothly. */
const MAX_STEP_SECONDS = 0.1;

/** Moves an animated material (the sky's clouds, the water) forward by one frame. */
export function advanceTime(material: ShaderMaterial, deltaSeconds: number): void {
  material.uniforms.uTime.value += Math.min(deltaSeconds, MAX_STEP_SECONDS);
}
