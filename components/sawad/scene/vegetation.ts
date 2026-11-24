import { Euler, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D } from "three";
import { reportError } from "@/lib/monitoring";
import { applyWindToScene, bakeNodeTransforms, createWind, type Wind } from "@/lib/sawad/wind";
import { LOD_DISTANCE, lodFor, planLandscape, type Landscape } from "./landscape";
import type { QualityTier } from "./types";

/*
 * The 28 ha plan's planting, drawn from the vegetation library (public/sawad/models/vegetation-*.glb,
 * track 3A) at the spots landscape.ts gives (track 3B). Each species is one InstancedMesh per level
 * of detail and primitive; which plants each level draws is re-sorted as the camera moves: by
 * distance (landscape.ts `lodFor`, the levels its triangle budget assumes) and by a cone around the
 * view direction, so nothing behind the camera is drawn.
 */

export type Level = "LOD0" | "LOD1" | "LOD2" | "card";
export const LEVELS: readonly Level[] = ["LOD0", "LOD1", "LOD2", "card"];
const LOD_LEVEL: Record<string, Level> = { "0": "LOD0", "1": "LOD1", "2": "LOD2", card: "card" };

/** One kind of placed thing: where each one stands and how it is drawn. */
export type Species = {
  id: string;
  /** Library node for each level; one-level species (hedges, grass) use the same node for every level they show at. */
  nodes: Partial<Record<Level, string>>;
  /** Instance transforms, 16 floats each. */
  matrices: Float32Array;
  /** Instance positions, 3 floats each (for distance and culling). */
  positions: Float32Array;
  /** Not drawn beyond this distance (metres). */
  maxDistance: number;
  /** Trees switch levels with distance; everything else is one level. */
  levels: boolean;
  castShadow: boolean;
};

type Placed = { x: number; y: number; z: number; rotation?: number; scale?: number; lean?: number };

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, "YXZ");
const _p = new Vector3();
const _s = new Vector3();

/** Packs placements into instance matrices (turned about +y, tilted by `lean`, scaled uniformly). */
export function packPlacements(list: ReadonlyArray<Placed>): { matrices: Float32Array; positions: Float32Array } {
  const matrices = new Float32Array(list.length * 16);
  const positions = new Float32Array(list.length * 3);
  list.forEach((p, i) => {
    _e.set((p.lean ?? 0) * 0.4, p.rotation ?? 0, 0);
    _q.setFromEuler(_e);
    const k = p.scale ?? 1;
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(k, k, k));
    _m.toArray(matrices, i * 16);
    positions.set([p.x, p.y, p.z], i * 3);
  });
  return { matrices, positions };
}

const treeNodes = (asset: string): Partial<Record<Level, string>> => ({ LOD0: `${asset}_LOD0`, LOD1: `${asset}_LOD1`, LOD2: `${asset}_LOD2`, card: `${asset}_card` });
const single = (node: string): Partial<Record<Level, string>> => ({ LOD0: node });

/** Grass tufts are drawn this close only (the budget in landscape.ts `visibleTriangles` counts them to 90 m). */
export const GRASS_DISTANCE = 90;

/** Every species of the plan's landscape on a tier. */
export function speciesFor(land: Landscape, tier: QualityTier): Species[] {
  const near = LOD_DISTANCE[tier][1]; // hedges and shrubs: as far as a tree's middle level
  const far = Infinity;
  const shadows = tier === "high";
  const make = (id: string, nodes: Partial<Record<Level, string>>, list: ReadonlyArray<Placed>, maxDistance: number, levels: boolean, castShadow: boolean): Species => ({
    id,
    nodes,
    ...packPlacements(list),
    maxDistance,
    levels,
    castShadow,
  });
  return [
    make("olive-a", treeNodes("olive-a"), land.olives.filter((p) => p.variant === 0).map((p) => ({ ...p, lean: 0 })), far, true, shadows),
    make("olive-b", treeNodes("olive-b"), land.olives.filter((p) => p.variant === 1).map((p) => ({ ...p, lean: 0 })), far, true, shadows),
    make("palm", treeNodes("palm"), land.palms, far, true, shadows),
    make("citrus", treeNodes("citrus"), land.citrus.map((p) => ({ ...p, lean: 0 })), far, true, shadows),
    make("hedge-low", single("hedge-low"), land.hedges.filter((h) => h.kind === "hedge-low"), near, false, shadows),
    make("hedge-tall", single("hedge-tall"), land.hedges.filter((h) => h.kind === "hedge-tall"), near, false, shadows),
    make("shrub-ball", single("shrub-ball"), land.shrubs, near, false, shadows),
    make("grass-green", single("grass-green"), land.grass.filter((t) => t.kind === "grass-green"), GRASS_DISTANCE, false, false),
    make("grass-dry", single("grass-dry"), land.grass.filter((t) => t.kind === "grass-dry"), GRASS_DISTANCE, false, false),
  ];
}

/**
 * The node that draws a level: the level itself, else the next coarser one, else the next finer
 * one. The low tier ships no LOD0 and citrus has no LOD2, so those fall back to their neighbours.
 */
export function resolveNode(nodes: Partial<Record<Level, string>>, level: Level, has: (name: string) => boolean): string | null {
  const i = LEVELS.indexOf(level);
  const order = [...LEVELS.slice(i), ...LEVELS.slice(0, i).reverse()];
  for (const l of order) {
    const name = nodes[l];
    if (name && has(name)) return name;
  }
  return null;
}

/**
 * Makes a loaded vegetation library ready to instance, once: geometry baked into each plant's own
 * metres (origin at the base), and every foliage material patched for one wind, which is kept with
 * the library and returned (a remount must drive the same uniforms the materials were patched with).
 */
export function prepareVegetationLibrary(root: Object3D): Wind {
  const kept = root.userData.sawadWind as Wind | undefined;
  if (kept) return kept;
  const wind = createWind();
  bakeNodeTransforms(root);
  applyWindToScene(root, wind);
  root.userData.sawadWind = wind;
  return wind;
}

/** The meshes (one per glTF primitive) that make up a library node. */
function nodeMeshes(root: Object3D, name: string): Mesh[] {
  const node = root.getObjectByName(name);
  const out: Mesh[] = [];
  node?.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

export type ViewCone = {
  eye: { x: number; y: number; z: number };
  /** Unit view direction. */
  forward: { x: number; y: number; z: number };
  /** Cosine of the cone's half angle: plants outside it are not drawn. */
  cosHalf: number;
};

/** Half the frame's diagonal field of view plus a margin, as the cosine a ViewCone wants. */
export function coneCos(fovDeg: number, aspect: number, marginDeg = 14): number {
  const half = Math.atan(Math.tan((fovDeg * Math.PI) / 360) * Math.hypot(1, aspect));
  return Math.cos(Math.min(Math.PI, half + (marginDeg * Math.PI) / 180));
}

/** Always drawn, whatever the view direction: a plant this close may lean into the frame. */
const ALWAYS_NEAR = 18;

type Bucket = { level: Level; meshes: InstancedMesh[]; attribute: InstancedBufferAttribute; count: number };
type Field = { species: Species; buckets: Map<Level, Bucket> };

/**
 * How the field picks what to draw. "distance": each plant at the level its distance from the
 * camera gives, nothing behind the camera or past its species' range (the live scene, which has a
 * frame budget). "max": every plant, always, at the finest level the library has. That is for
 * frames rendered offline (the story reel, scripts/render-story-reel.mjs), where a frame may take
 * as long as it likes and nothing may change detail or appear as the camera comes closer.
 */
export type VegetationDetail = "distance" | "max";

export type VegetationField = {
  /** Every InstancedMesh, to mount once. */
  objects: InstancedMesh[];
  /** Re-sorts the plants for a camera; returns how many instances of each level are drawn. */
  update: (cone: ViewCone) => Record<Level, number>;
  dispose: () => void;
};

/**
 * Builds the instanced planting for a tier from a prepared library. Species whose nodes the
 * library lacks are reported as `sawad-scene` and left out; the rest still draw.
 */
export function buildVegetationField(root: Object3D, tier: QualityTier, species: Species[] = speciesFor(planLandscape(tier), tier), detail: VegetationDetail = "distance"): VegetationField {
  const max = detail === "max";
  const objects: InstancedMesh[] = [];
  const fields: Field[] = [];
  const has = (name: string) => !!root.getObjectByName(name);
  for (const sp of species) {
    const capacity = sp.positions.length / 3;
    if (!capacity) continue;
    const buckets = new Map<Level, Bucket>();
    const byNode = new Map<string, Bucket>();
    const missing: Level[] = [];
    for (const level of sp.levels ? LEVELS : (["LOD0"] as Level[])) {
      const name = resolveNode(sp.nodes, level, has);
      if (!name) {
        missing.push(level);
        continue;
      }
      // Two levels that fall back to the same node share one set of meshes.
      const shared = byNode.get(name);
      if (shared) {
        buckets.set(level, shared);
        continue;
      }
      const parts = nodeMeshes(root, name);
      const attribute = new InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
      const meshes = parts.map((part) => {
        const mesh = new InstancedMesh(part.geometry as BufferGeometry, part.material as Material, capacity);
        mesh.instanceMatrix = attribute;
        mesh.count = 0;
        mesh.name = `${sp.id}:${level}:${part.name || "part"}`;
        mesh.frustumCulled = false; // culled per plant in update()
        mesh.castShadow = sp.castShadow && level !== "card";
        mesh.receiveShadow = true;
        objects.push(mesh);
        return mesh;
      });
      const bucket: Bucket = { level, meshes, attribute, count: 0 };
      buckets.set(level, bucket);
      byNode.set(name, bucket);
    }
    if (missing.length) reportError("sawad-scene", new Error(`vegetation library has no node for ${sp.id}`), { stage: "vegetation", species: sp.id, levels: missing, tier });
    if (buckets.size) fields.push({ species: sp, buckets });
  }

  return {
    objects,
    update(cone) {
      const drawn: Record<Level, number> = { LOD0: 0, LOD1: 0, LOD2: 0, card: 0 };
      const { eye, forward: f, cosHalf } = cone;
      for (const { species: sp, buckets } of fields) {
        for (const b of buckets.values()) b.count = 0;
        const pos = sp.positions;
        for (let i = 0, n = pos.length / 3; i < n; i++) {
          const dx = pos[i * 3] - eye.x;
          const dy = pos[i * 3 + 1] - eye.y;
          const dz = pos[i * 3 + 2] - eye.z;
          const d = Math.hypot(dx, dy, dz);
          if (!max) {
            if (d > sp.maxDistance) continue;
            if (d > ALWAYS_NEAR && dx * f.x + dy * f.y + dz * f.z < cosHalf * d) continue;
          }
          const level = sp.levels && !max ? LOD_LEVEL[String(lodFor(d, tier))] : "LOD0";
          const b = buckets.get(level);
          if (!b) continue;
          b.attribute.array.set(sp.matrices.subarray(i * 16, i * 16 + 16), b.count * 16);
          b.count += 1;
        }
        const seen = new Set<Bucket>();
        for (const [level, b] of buckets) {
          if (seen.has(b)) continue;
          seen.add(b);
          for (const m of b.meshes) m.count = b.count;
          b.attribute.needsUpdate = true;
          drawn[level] += b.count;
        }
      }
      return drawn;
    },
    dispose() {
      // The geometry and materials belong to the library; only the instance buffers are ours.
      for (const m of objects) m.dispose();
    },
  };
}

/**
 * When the field needs sorting again: the camera has moved `moveMetres` or turned `turnDeg`
 * since the last sort. Keeps the work off frames where the camera holds still.
 */
export function needsResort(last: ViewCone | null, next: ViewCone, moveMetres = 2, turnDeg = 3): boolean {
  if (!last) return true;
  const moved = Math.hypot(next.eye.x - last.eye.x, next.eye.y - last.eye.y, next.eye.z - last.eye.z);
  const turn = last.forward.x * next.forward.x + last.forward.y * next.forward.y + last.forward.z * next.forward.z;
  return moved > moveMetres || turn < Math.cos((turnDeg * Math.PI) / 180) || Math.abs(next.cosHalf - last.cosHalf) > 1e-3;
}
