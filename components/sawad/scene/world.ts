import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  HemisphereLight,
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
  riverGeometryParams,
  terrainHeight,
  treePositions,
  villaPlots,
  type TreeInstance,
  type VillaPlot,
} from "./layout";
import { disposeObject } from "./compoundModel";
import type { QualityTier, SceneVariant } from "./types";

export type World = {
  scene: Scene;
  sun: DirectionalLight;
  water: Mesh;
  /** Unit vector toward the sun. */
  sunDirection: Vector3;
  update: (timeSec: number) => void;
  /** Swaps the procedural architecture for the baked model. dispose() then frees the model. */
  setArchitecture: (object: Object3D) => void;
  /** Reflections of the golden-hour sky (glass, brass, pools), prefiltered once with PMREM. */
  setEnvironment: (renderer: WebGLRenderer) => void;
  dispose: () => void;
};

/**
 * Sky light on every PBR surface. Tuned against the posters (mean frame luminance within ~1%
 * across variants and views), so matte plaster, palms and terrain keep today's brightness.
 */
export const ENVIRONMENT_INTENSITY = 0.08;
/** Full-strength sky reflections on the model's mirror-like materials (brass, bronze, glass). */
export const REFLECTIVE_ENV_INTENSITY = 1;

/** Metals and polished glass in the baked model get the sky reflection at full strength. */
function applyReflections(root: Object3D, env: WebGLRenderTarget["texture"] | null): void {
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

export function sunDirection(variant: SceneVariant, liftDeg = 0): Vector3 {
  const s = SUN[variant];
  const el = ((s.elevationDeg + liftDeg) * Math.PI) / 180;
  const h = Math.cos(el);
  const len = Math.hypot(s.azimuthX, s.azimuthZ);
  return new Vector3((s.azimuthX / len) * h, Math.sin(el), (s.azimuthZ / len) * h).normalize();
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

const HAZE = new Color("#e6ae86");

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

function buildSky(sunDir: Vector3): { mesh: Mesh; material: ShaderMaterial } {
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

function buildTerrain(variant: SceneVariant, tier: QualityTier): Mesh {
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
      uFogDensity: { value: 0 },
      uChop: { value: variant === "zaitun" ? 1.3 : 1.0 },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
  });
}

function buildWater(variant: SceneVariant, material: ShaderMaterial): Mesh {
  const r = riverGeometryParams(variant);
  const depth = r.width + 220;
  const geo = new PlaneGeometry(3600, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, r.near + r.width / 2);
  const mesh = new Mesh(geo, material);
  mesh.name = "river";
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

function buildPalms(variant: SceneVariant, tier: QualityTier, disposables: Array<{ dispose: () => void }>): Object3D[] {
  const palms = palmPositions(variant, tier === "high" ? 1800 : 700);
  const trunkGeo = palmTrunkGeometry();
  const crownGeo = palmCrownGeometry();
  const trunkMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  // A touch of emission reads as light passing through backlit fronds.
  const crownMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: DoubleSide, emissive: new Color("#3d4416"), emissiveIntensity: 0.55 });
  disposables.push(trunkGeo, crownGeo, trunkMat, crownMat);
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
  return [trunks, crowns];
}

function buildRoundTrees(variant: SceneVariant, tier: QualityTier, disposables: Array<{ dispose: () => void }>): Object3D[] {
  const count = variant === "zaitun" ? (tier === "high" ? 2600 : 900) : 72;
  const trees = treePositions(variant, count);
  const { trunk, crown } = roundTreeGeometry();
  const trunkMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const crownMat = new MeshStandardMaterial({ color: variant === "zaitun" ? "#7f8b62" : "#4a6230", roughness: 0.9 });
  disposables.push(trunk, crown, trunkMat, crownMat);
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const s = new Vector3();
  const p = new Vector3();
  const place = (t: TreeInstance, m: Matrix4) => {
    q.setFromAxisAngle(up, t.rotation);
    m.compose(p.set(t.x, t.y - 0.1, t.z), q, s.setScalar(t.scale * (variant === "zaitun" ? 1.15 : 1)));
  };
  return [instanceTrees(trees, trunk, trunkMat, place, "tree-trunks"), instanceTrees(trees, crown, crownMat, place, "tree-crowns")];
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
function villaParts(plot: VillaPlot): Part[] {
  const parts: Part[] = [];
  const { width: w, depth: d, height: h } = plot;
  const y0 = PAD_Y;
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

function apartmentParts(cx: number): Part[] {
  const parts: Part[] = [];
  const w = APARTMENT_WIDTH;
  for (let f = 0; f < 4; f++) {
    const depth = apartmentFloorDepth(f);
    const y = PAD_Y + f * FLOOR_HEIGHT;
    const back = APARTMENT_BACK_Z;
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
  const roofY = PAD_Y + 4 * FLOOR_HEIGHT;
  parts.push(box(w + 0.8, 0.38, apartmentFloorDepth(3) + 0.4, cx, roofY, APARTMENT_BACK_Z + apartmentFloorDepth(3) / 2, C.slab));
  parapet(parts, w + 0.8, apartmentFloorDepth(3) + 0.4, roofY + 0.38, cx, APARTMENT_BACK_Z + apartmentFloorDepth(3) / 2);
  // Brass-lined entrance canopy on the garden side.
  parts.push(box(6, 0.22, 2.4, cx, PAD_Y + 3.0, APARTMENT_BACK_Z - 1.2, C.brass));
  return parts;
}

function ribbon(points: Array<[number, number]>, width: number, y: number, color: Color): Part {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
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

/** The procedural compound: every building merged from flat-coloured boxes (the fallback). */
export function buildArchitecture(): Mesh {
  const parts: Part[] = [];
  const m = new Matrix4();
  for (const plot of villaPlots()) {
    const local = villaParts(plot);
    m.makeRotationY(plot.facing === 1 ? 0 : Math.PI);
    m.setPosition(plot.x, 0, plot.z);
    parts.push(...transformParts(local, m));
  }
  for (const cx of APARTMENT_BUILDINGS_X) parts.push(...apartmentParts(cx));
  parts.push(...siteParts());
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

// ---------------------------------------------------------------- world

export function buildWorld({ variant, tier }: { variant: SceneVariant; tier: QualityTier }): World {
  const scene = new Scene();
  const disposables: Array<{ dispose: () => void }> = [];
  const sunDir = sunDirection(variant);

  scene.fog = new FogExp2(HAZE.clone(), variant === "shatt" ? 0.00085 : 0.00072);
  scene.background = HAZE.clone();

  const sky = buildSky(sunDir);
  scene.add(sky.mesh);
  disposables.push(sky.mesh.geometry, sky.material);

  const hemi = new HemisphereLight(new Color("#ffe0bf"), new Color("#6f6446"), 1.8);
  scene.add(hemi);

  const sun = new DirectionalLight(new Color("#ffa65c"), 4.2);
  sun.position.copy(sunDirection(variant, LIGHT_LIFT_DEG)).multiplyScalar(700);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  if (tier === "high") {
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const cam = sun.shadow.camera;
    cam.left = -330;
    cam.right = 330;
    cam.top = 330;
    cam.bottom = -330;
    cam.near = 10;
    cam.far = 1600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.25;
    sun.shadow.radius = 3;
  }

  const terrain = buildTerrain(variant, tier);
  disposables.push(terrain.geometry, terrain.material as Material);
  scene.add(terrain);

  const waterMat = createWaterMaterial(sunDir, variant);
  const water = buildWater(variant, waterMat);
  disposables.push(water.geometry, waterMat);
  scene.add(water);

  // Reflecting pool in the central garden shares the water shader.
  const poolGeo = new PlaneGeometry(8, 60);
  poolGeo.rotateX(-Math.PI / 2);
  poolGeo.translate(0, PAD_Y + 0.3, -46);
  const pool = new Mesh(poolGeo, waterMat);
  pool.name = "garden-pool";
  disposables.push(poolGeo);
  scene.add(pool);

  for (const o of buildPalms(variant, tier, disposables)) scene.add(o);
  for (const o of buildRoundTrees(variant, tier, disposables)) scene.add(o);
  // Procedural fallback, shown until (or unless) the baked model arrives.
  const procedural = buildArchitecture();
  scene.add(procedural);
  let architecture: Object3D = procedural;
  let envTarget: WebGLRenderTarget | null = null;

  const fog = scene.fog as FogExp2;
  waterMat.uniforms.uFogDensity.value = fog.density;
  waterMat.uniforms.uFogColor.value = fog.color;

  return {
    scene,
    sun,
    water,
    sunDirection: sunDir,
    update(timeSec: number) {
      waterMat.uniforms.uTime.value = timeSec;
      sky.material.uniforms.uTime.value = timeSec;
    },
    setArchitecture(object: Object3D) {
      if (object === architecture) return;
      scene.remove(architecture);
      disposeObject(architecture);
      architecture = object;
      scene.add(object);
      if (envTarget) applyReflections(object, envTarget.texture);
    },
    setEnvironment(renderer: WebGLRenderer) {
      // Only the sky, so the environment never depends on the camera or the compound.
      const envScene = new Scene();
      const envSky = sky.material.clone();
      envSky.uniforms.uSunDisc.value = 0; // the sun's highlight comes from the directional light
      const skyCopy = new Mesh(sky.mesh.geometry, envSky);
      skyCopy.scale.copy(sky.mesh.scale);
      skyCopy.frustumCulled = false;
      envScene.add(skyCopy);
      const pmrem = new PMREMGenerator(renderer);
      envTarget?.dispose();
      envTarget = pmrem.fromScene(envScene, 0.02, 0.1, 100, { size: 256 });
      pmrem.dispose();
      envSky.dispose();
      scene.environment = envTarget.texture;
      scene.environmentIntensity = ENVIRONMENT_INTENSITY;
      applyReflections(architecture, envTarget.texture);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      disposeObject(architecture); // (never the shared env map: disposeObject skips envMap)

      envTarget?.dispose();
      envTarget = null;
      scene.environment = null;
      sun.shadow.map?.dispose();
      scene.clear();
    },
  };
}

