import { invalidate } from "@react-three/fiber";
import { NormalBlending, type AnimationClip, type BufferAttribute, type BufferGeometry, type Group, type InstancedBufferAttribute, type Material, type Mesh, type Object3D, type Texture, type WebGLRenderer } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { reportError } from "@/lib/monitoring";
import { assetUrl } from "./assetUrl";
import { applyBakedLight, bakedHalfPageUrl, copyNamed, createBakedLight, loadBakedManifest, loadBakedPage, loadBakedPages, setBakedDayPage, type BakedLight } from "./bakedLight";
import { usesPlan } from "./site";
import type { QualityTier, SceneVariant } from "./types";

/**
 * Every address below is versioned (`assetUrl`, ledger T32): the file name carries a hash of its
 * content, so the tables change whenever a file does.
 *
 * The baked compound architecture (scripts/blender/build_compound.py). The high tier has the
 * 2048 trim sheet and 1024 AO; the low tier 1024 / 512, without mashrabiya screens or benches.
 */
export const COMPOUND_MODEL_URL: Record<QualityTier, string> = {
  high: assetUrl("/sawad/models/compound-high.glb"),
  low: assetUrl("/sawad/models/compound-low.glb"),
};
/**
 * The compound rebuilt on the 28 ha masterplan (Zaitun Hills, `build_compound.py --plan zaitun`).
 * The 7 ha files above stay for Bustan Dijla and Shatt Gardens until they move onto the new layout.
 */
export const PLAN_COMPOUND_MODEL_URL: Record<QualityTier, string> = {
  high: assetUrl("/sawad/models/compound-zaitun-high.glb"),
  low: assetUrl("/sawad/models/compound-zaitun-low.glb"),
};
/**
 * The Zaitun far set (scripts/blender/export-far.sh): the same nodes, copies and materials as the
 * full file above, with simplified geometry and far-view textures. The first frame waits for this
 * file only; the full file loads beside it and replaces it in place (`upgradeToFull`).
 */
export const PLAN_FAR_MODEL_URL: Record<QualityTier, string> = {
  high: assetUrl("/sawad/models/compound-zaitun-far-high.glb"),
  low: assetUrl("/sawad/models/compound-zaitun-far-low.glb"),
};

/** The baked compound a variant draws. */
export function compoundModelUrl(variant: SceneVariant, tier: QualityTier): string {
  return usesPlan(variant) ? PLAN_COMPOUND_MODEL_URL[tier] : COMPOUND_MODEL_URL[tier];
}

/**
 * Instanced libraries placed at runtime on the 28 ha plan: the plants (scripts/blender/vegetation.py,
 * placed by landscape.ts `planLandscape`) and the people, cars and birds (scripts/blender/life.py,
 * moved by `planLife`).
 */
export type LibraryKind = "vegetation" | "life";
export const LIBRARY_URL: Record<LibraryKind, Record<QualityTier, string>> = {
  vegetation: { high: assetUrl("/sawad/models/vegetation-high.glb"), low: assetUrl("/sawad/models/vegetation-low.glb") },
  life: { high: assetUrl("/sawad/models/life-high.glb"), low: assetUrl("/sawad/models/life-low.glb") },
};

/** A loaded library: its scene (the source meshes, never mounted as is) and its animation clips. */
export type GltfLibrary = { scene: Group; animations: AnimationClip[] };

/** Basis Universal transcoder for the KTX2 textures (copied from three/examples/jsm/libs/basis), in a folder named by its hash. */
export const BASIS_TRANSCODER_PATH = assetUrl("/sawad/basis/");
export const COMPOUND_NAME = "architecture-model";

type MaterialWithMaps = Material & Partial<Record<"map" | "aoMap" | "normalMap" | "roughnessMap" | "metalnessMap" | "emissiveMap" | "alphaMap" | "lightMap", Texture | null>>;
const TEXTURE_SLOTS = ["map", "aoMap", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap", "lightMap"] as const;
/** The slots a glTF material fills from its own file (the lightmap comes from the bake). */
const MODEL_SLOTS = ["map", "aoMap", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap"] as const;

const materialsOf = (mesh: Mesh): Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);

/** The baked light a loaded compound carries (Zaitun Hills only), or null. */
export function bakedLightOf(model: Object3D | null): BakedLight | null {
  return (model?.userData.bakedLight as BakedLight | undefined) ?? null;
}

/** Frees the GPU resources of an object tree: geometries, materials and their textures. */
export function disposeObject(root: Object3D): void {
  // A far set still waiting for its full detail: the detail is freed when it arrives, never swapped in.
  detailOf(root)?.cancel();
  dayPageOf(root)?.cancel();
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const m of materialsOf(mesh)) materials.add(m);
    (o as Mesh & { dispose?: () => void }).dispose?.(); // InstancedMesh frees its instance buffers
  });
  for (const m of materials) {
    for (const slot of TEXTURE_SLOTS) {
      const t = (m as MaterialWithMaps)[slot];
      if (t) textures.add(t);
    }
    m.dispose();
  }
  for (const t of textures) t.dispose();
  bakedLightOf(root)?.dispose();
}

/**
 * Shadows on every mesh (transparent glass receives but does not cast), AO read from UV1, and the
 * matrices composed once. The model never moves (it is mounted as is), so three need not recompose
 * every node's matrix each frame (S5-8: `updateMatrixWorld` was the second-largest script cost).
 *
 * Zaitun ships AO maps only on the court lattices (scripts/blender/diet.mjs, ledger T6): elsewhere
 * the baked light holds the occlusion. A mesh that kept the lightmap UVs keeps a `TEXCOORD_1` the file
 * defines as zeros (glTF wants its UV sets without a gap); nothing samples it, so it is dropped here
 * before it is ever uploaded.
 */
export function prepareCompound(root: Object3D): void {
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const materials = materialsOf(mesh);
    const blended = materials.some((m) => m.transparent && m.blending === NormalBlending);
    mesh.castShadow = !blended;
    mesh.receiveShadow = true;
    let ao = false;
    for (const m of materials as MaterialWithMaps[]) {
      // The bake lives on its own lightmap UVs (glTF occlusionTexture.texCoord = 1).
      if (m.aoMap) {
        m.aoMap.channel = 1;
        ao = true;
      }
    }
    if (!ao && mesh.geometry.getAttribute("uv1")) mesh.geometry.deleteAttribute("uv1");
  });
}

/** A KTX2 loader for this renderer, with the transcoder in public/sawad/basis. */
function createKtx2(renderer: WebGLRenderer): KTX2Loader {
  return new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH).detectSupport(renderer);
}

/**
 * Runs `work` with a KTX2 loader for this renderer (the transcoder in public/sawad/basis), then
 * ends its transcoder workers; the decoded textures stay valid.
 */
export async function withKtx2<T>(renderer: WebGLRenderer, work: (ktx2: KTX2Loader) => Promise<T>): Promise<T> {
  const ktx2 = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH);
  try {
    ktx2.detectSupport(renderer);
    return await work(ktx2);
  } finally {
    ktx2.dispose();
  }
}

/**
 * Meshopt geometry decodes in two workers instead of on the main thread. It matters once the far
 * set is on screen: the full file (10 MB) then decodes while the scene is live, and on the main
 * thread that cost a dropped frame or two on the opening (F2A.md). Started once, on first use.
 */
let meshoptWorkers = false;
function startMeshoptWorkers(): void {
  if (meshoptWorkers) return;
  meshoptWorkers = true;
  const decoder = MeshoptDecoder as typeof MeshoptDecoder & { useWorkers?: (count: number) => void };
  decoder.useWorkers?.(2);
}

/** Loads a GLB with the KTX2 textures and meshopt geometry the pipeline ships. */
function loadGltf(url: string, ktx2: KTX2Loader): Promise<GLTF> {
  startMeshoptWorkers();
  return new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
}

/**
 * The day pages of the baked light, loaded beside the model. A failure is reported and leaves
 * the model on real-time light: the scene still shows, only without the bake.
 *
 * With `half`, the buildings page comes as its half-size mip level (`bakedHalfPageUrl`): what the
 * first frame waits for drops from 0.72 to about 0.2 MB on the high tier (ledger T36), and the full
 * page replaces it after the poster hold (`upgradeDayPage`).
 */
async function loadDayLight(tier: QualityTier, ktx2: KTX2Loader, half = false): Promise<BakedLight | null> {
  try {
    const manifest = await loadBakedManifest();
    return createBakedLight(manifest, tier, await loadBakedPages(manifest, tier, "day", ktx2, half ? { buildings: bakedHalfPageUrl(manifest, tier, "buildings", "day") } : {}));
  } catch (error) {
    reportError("sawad-scene", error, { stage: "baked-light", tier });
    return null;
  }
}

/** Names, prepares and lights a loaded compound. */
function finishCompound(group: Group, baked: BakedLight | null): Group {
  group.name = COMPOUND_NAME;
  prepareCompound(group);
  if (baked) {
    applyBakedLight(group, baked);
    group.userData.bakedLight = baked;
  }
  return group;
}

/**
 * Loads the compound model for a quality tier (and variant: Zaitun Hills has its own 28 ha model).
 * Rejects (after reporting the error) when the file is missing or broken, so the caller can keep
 * the procedural fallback.
 *
 * Zaitun Hills resolves with its far set as soon as that and the day light are in, and starts the
 * full file at the same time; the full detail then replaces the far set in place (`upgradeToFull`),
 * so the group the caller holds stays the same object. If the far set cannot load, it waits for
 * the full file instead, as before the far set existed.
 */
/**
 * How much of the Zaitun model a scene wants: `full`, the far set and then the full detail in its
 * place (Home); `far`, the far set only (the finder's stage card, ledger T30 and the owner's D12:
 * its views stay on far-view detail and the 7 MB full file is never fetched).
 */
export type CompoundDetailWanted = "full" | "far";

export async function loadCompound(tier: QualityTier, renderer: WebGLRenderer, variant: SceneVariant = "dijla", detail: CompoundDetailWanted = "full"): Promise<Group> {
  if (usesPlan(variant)) return loadPlanCompound(tier, renderer, variant, detail);
  const url = compoundModelUrl(variant, tier);
  try {
    const gltf = await withKtx2(renderer, (ktx2) => loadGltf(url, ktx2));
    return finishCompound(gltf.scene, null);
  } catch (error) {
    reportError("sawad-scene", error, { stage: "compound-model", tier, variant, url });
    throw error;
  }
}

/** Tiers whose first frame takes the buildings page at half size, the full page following (ledger T36). */
export const HALF_DAY_PAGE: Record<QualityTier, boolean> = { high: true, low: false };

async function loadPlanCompound(tier: QualityTier, renderer: WebGLRenderer, variant: SceneVariant, detail: CompoundDetailWanted): Promise<Group> {
  const url = PLAN_COMPOUND_MODEL_URL[tier];
  const farUrl = PLAN_FAR_MODEL_URL[tier];
  // One loader for the far set, the light and the full file: one transcoder start-up, not three.
  const ktx2 = createKtx2(renderer);
  const half = HALF_DAY_PAGE[tier];
  const light = loadDayLight(tier, ktx2, half);
  let far: GLTF;
  try {
    far = await loadGltf(farUrl, ktx2);
  } catch (error) {
    // No far set: the first frame waits for the full file, as before it existed.
    reportError("sawad-scene", error, { stage: "compound-far", tier, variant, url: farUrl });
    try {
      const [gltf, baked] = await Promise.all([loadGltf(url, ktx2), light]);
      const group = finishCompound(gltf.scene, baked);
      // The first frame already waited for the full model: the full page comes with it, no swap.
      if (baked && half) await upgradeDayPage(baked, () => loadBakedPage(baked.manifest, baked.tier, "buildings", "day", ktx2), { renderer, tier, holdFrames: 0 }).settled;
      return group;
    } catch (fullError) {
      reportError("sawad-scene", fullError, { stage: "compound-model", tier, variant, url });
      throw fullError;
    } finally {
      ktx2.dispose();
    }
  }
  const baked = await light;
  const group = finishCompound(far.scene, baked);
  // The full file and the full lightmap page wait until the far set is on screen, so on a slow line
  // they never share the bandwidth the first frame is waiting for. Anything drawn since now counts.
  const drawn = renderer.info.render.frame;
  const shown = () => renderer.info.render.frame > drawn;
  const settles: Promise<unknown>[] = [];
  if (baked && half) {
    const page = upgradeDayPage(baked, () => loadBakedPage(baked.manifest, baked.tier, "buildings", "day", ktx2), { renderer, tier, shown });
    group.userData.dayPage = page;
    settles.push(page.settled);
  }
  if (detail === "full") {
    group.userData.detail = upgradeToFull(group, () => loadGltf(url, ktx2), { renderer, tier, shown });
    settles.push(detailOf(group)!.settled);
  }
  // The transcoder's workers end once nothing more is coming through this loader.
  void Promise.all(settles).finally(() => ktx2.dispose());
  return group;
}

// ------------------------------------------------------------------ the full lightmap page (T36)

export type DayPageUpgrade = {
  readonly state: DetailState;
  /** Resolves once the full page is in, or the half page was left (a failure, or the model was freed). */
  readonly settled: Promise<DetailState>;
  cancel: () => void;
};

/** The day-page upgrade a compound carries, or null (the low tier, the 7 ha compound, or already full). */
export function dayPageOf(model: Object3D | null): DayPageUpgrade | null {
  return (model?.userData.dayPage as DayPageUpgrade | undefined) ?? null;
}

/**
 * Replaces the half-size buildings page with the full page once the first frame is on screen and the
 * poster hold is over, as `upgradeToFull` does for the geometry: the texture is uploaded on its own
 * frame, then every lit material takes it on the next (bakedLight.ts `setBakedDayPage`; same slot,
 * same shader). A failure is reported and leaves the half page in place: the scene stays lit.
 */
export function upgradeDayPage(light: BakedLight, loadFull: () => Promise<Texture>, options: UpgradeOptions): DayPageUpgrade {
  const { renderer, tier, frame = browserFrame, redraw = () => invalidate(), shown = () => true, holdFrames = DETAIL_HOLD_FRAMES } = options;
  let state: DetailState = "far";
  const nextFrame = () => new Promise<void>((resolve) => frame(resolve));
  const settled = (async (): Promise<DetailState> => {
    let full: Texture | null = null;
    try {
      while (state === "far" && !shown()) await nextFrame();
      if (state !== "far") return state;
      const hold = (async () => {
        for (let i = 0; i < holdFrames && state === "far"; i++) await nextFrame();
      })();
      [full] = await Promise.all([loadFull(), hold]);
      if (holdFrames > 0) await nextFrame();
      if (state !== "far") {
        full.dispose();
        return state;
      }
      renderer.initTexture(full);
      if (holdFrames > 0) await nextFrame();
      if ((state as DetailState) !== "far") {
        full.dispose();
        return state;
      }
      setBakedDayPage(light, "buildings", full).dispose();
      state = "full";
      redraw();
      return state;
    } catch (error) {
      full?.dispose();
      if ((state as DetailState) === "cancelled") return "cancelled";
      reportError("sawad-scene", error, { stage: "baked-light-full", tier });
      state = "failed";
      return state;
    }
  })();
  return {
    get state() {
      return state;
    },
    settled,
    cancel() {
      if (state === "far") state = "cancelled";
    },
  };
}

// ------------------------------------------------------------------ the far set's full detail

/** Frames the far set stays on screen before the full detail may replace it: the 2 s poster hold, and a margin (counted from its first frame). */
export const DETAIL_HOLD_FRAMES = 150;

export type DetailState = "far" | "full" | "failed" | "cancelled";
export type CompoundDetail = {
  readonly state: DetailState;
  /** Resolves once the far set has been replaced, or left in place (a failure, or the model was freed). */
  readonly settled: Promise<DetailState>;
  cancel: () => void;
};

/** The full-detail upgrade a far set carries, or null (the full file, or a 7 ha compound). */
export function detailOf(model: Object3D | null): CompoundDetail | null {
  return (model?.userData.detail as CompoundDetail | undefined) ?? null;
}

type Frame = (run: () => void) => void;
type UpgradeOptions = {
  renderer: Pick<WebGLRenderer, "initTexture">;
  tier: QualityTier;
  /** Runs one step of the swap per animation frame (requestAnimationFrame; replaceable in tests). */
  frame?: Frame;
  /** Asks the canvas for a new frame after each step (React Three Fiber's `invalidate`). */
  redraw?: () => void;
  /** True once the far set has been drawn: the full file is fetched, and the hold counted, from then. */
  shown?: () => boolean;
  holdFrames?: number;
  onSettled?: () => void;
};

const browserFrame: Frame = (run) => requestAnimationFrame(() => run());

/** A far mesh and the full mesh that stands in the same place. */
type Pair = { far: Mesh; full: Mesh };

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};

const sameBox = (a: BufferGeometry, b: BufferGeometry): boolean => {
  a.computeBoundingBox();
  b.computeBoundingBox();
  const eps = 1e-5;
  return a.boundingBox!.min.distanceTo(b.boundingBox!.min) < eps && a.boundingBox!.max.distanceTo(b.boundingBox!.max) < eps;
};

/**
 * Pairs every far mesh with its full mesh, or says why it cannot: the far set must have the same
 * meshes in the same order, with the same copies, materials and texture slots, and each geometry
 * must have the same bounds (the same quantization frame, so the copies' transforms fit both).
 */
export function pairDetail(far: Object3D, full: Object3D): Pair[] {
  const a = meshesOf(far);
  const b = meshesOf(full);
  if (a.length !== b.length) throw new Error(`far set has ${a.length} meshes, the full model ${b.length}`);
  return a.map((f, i) => {
    const g = b[i];
    const at = `${g.name || i}`;
    if (f.name !== g.name) throw new Error(`mesh ${i}: far set has ${f.name}, the full model ${g.name}`);
    const copies = (m: Mesh) => ((m as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh ? (m as unknown as { instanceMatrix: BufferAttribute }).instanceMatrix.count : 1);
    if (copies(f) !== copies(g)) throw new Error(`${at}: ${copies(f)} copies in the far set, ${copies(g)} in the full model`);
    const fm = materialsOf(f);
    const gm = materialsOf(g);
    if (fm.length !== gm.length || fm.some((m, k) => m.name !== gm[k].name)) throw new Error(`${at}: materials differ`);
    for (let k = 0; k < fm.length; k++) {
      for (const slot of MODEL_SLOTS) {
        if (!(fm[k] as MaterialWithMaps)[slot] !== !(gm[k] as MaterialWithMaps)[slot]) throw new Error(`${at}: ${fm[k].name}.${slot} is not in both files`);
      }
    }
    if (!sameBox(f.geometry, g.geometry)) throw new Error(`${at}: bounds differ (another quantization frame)`);
    return { far: f, full: g };
  });
}

/**
 * Gives a full geometry what the far one gained when it was lit: the per-copy attributes (lightmap
 * tile, tint), the same attribute objects so the culling keeps writing to what is drawn; and a single
 * copy's lightmap UVs moved onto its tile, as bakedLight.ts did to the far geometry.
 */
function carryOver(pair: Pair, farRoot: Object3D, light: BakedLight | null, shared: boolean): BufferGeometry {
  const from = pair.far.geometry;
  // Copies that share one full geometry each get their own before a tile moves it, as in bakedLight.ts.
  const to = shared && from.userData.bakedTile ? pair.full.geometry.clone() : pair.full.geometry;
  if (to !== pair.full.geometry) to.userData = { ...to.userData };
  for (const [name, attr] of Object.entries(from.attributes)) {
    if ((attr as InstancedBufferAttribute).isInstancedBufferAttribute) to.setAttribute(name, attr);
  }
  if (from.userData.bakedTile && light) {
    const copy = copyNamed(light.manifest, light.tier, pair.far, farRoot);
    const uv2 = to.getAttribute("uv2") as BufferAttribute | undefined;
    if (copy && uv2) {
      const [sx, sy, ox, oy] = copy.scaleOffset;
      for (let i = 0; i < uv2.count; i++) uv2.setXY(i, uv2.getX(i) * sx + ox, uv2.getY(i) * sy + oy);
      uv2.needsUpdate = true;
      to.userData = { ...to.userData, bakedTile: true };
    }
  }
  // The culling recorded each copy's sphere from the far geometry; the bounds are the same.
  to.boundingBox = from.boundingBox;
  to.boundingSphere = from.boundingSphere;
  return to;
}

/**
 * The far set's materials take the full textures, slot for slot. The materials themselves stay (the
 * lit copies, the reflections set on them), and so do their shaders: the same slots, the same program.
 * Returns the far textures that were replaced.
 */
function adoptTextures(far: Material[], full: Material[], done: Set<Material>): Texture[] {
  const replaced: Texture[] = [];
  far.forEach((m, k) => {
    if (done.has(m)) return;
    done.add(m);
    for (const slot of MODEL_SLOTS) {
      const next = (full[k] as MaterialWithMaps)[slot];
      const prev = (m as MaterialWithMaps)[slot];
      if (!next || !prev || next === prev) continue;
      (m as MaterialWithMaps)[slot] = next;
      replaced.push(prev);
    }
  });
  return replaced;
}

/** Every texture the tree's materials still use. */
function texturesIn(root: Object3D): Set<Texture> {
  const out = new Set<Texture>();
  for (const mesh of meshesOf(root)) for (const m of materialsOf(mesh)) for (const slot of TEXTURE_SLOTS) {
    const t = (m as MaterialWithMaps)[slot];
    if (t) out.add(t);
  }
  return out;
}

/**
 * Replaces a far set with the full model. Once the far set is on screen it fetches the full file,
 * and swaps it in when both the file and the poster hold are done.
 * The work is spread over animation frames so no frame carries it all: first each full texture is
 * uploaded on its own frame, then one mesh is swapped per frame (its geometry, and the full textures
 * into its materials). The far set's objects stay, so everything holding them (the culling, the
 * baked light, the reflections, the caller's reference to the group) keeps working. A failed full
 * file, or one that does not match the far set, is reported and leaves the far set on screen.
 */
export function upgradeToFull(farRoot: Group, loadFull: () => Promise<GLTF>, options: UpgradeOptions): CompoundDetail {
  const { renderer, tier, frame = browserFrame, redraw = () => invalidate(), shown = () => true, holdFrames = DETAIL_HOLD_FRAMES, onSettled } = options;
  let state: DetailState = "far";
  let fullScene: Group | null = null;
  // Far pieces already swapped out: freed at the end, or at once if the swap stops half way.
  const oldGeometries: BufferGeometry[] = [];
  const replaced = new Set<Texture>();
  const nextFrame = () => new Promise<void>((resolve) => frame(resolve));

  // Frees the full file's objects, except those the far set already took (it frees those itself).
  const freeFull = () => {
    if (fullScene) {
      const taken = new Set<unknown>([...texturesIn(farRoot), ...meshesOf(farRoot).map((m) => m.geometry)]);
      const textures = new Set<Texture>();
      for (const mesh of meshesOf(fullScene)) {
        if (!taken.has(mesh.geometry)) mesh.geometry.dispose();
        for (const m of materialsOf(mesh)) {
          for (const slot of TEXTURE_SLOTS) {
            const t = (m as MaterialWithMaps)[slot];
            if (t && !taken.has(t)) textures.add(t);
          }
          m.dispose();
        }
      }
      for (const t of textures) t.dispose();
    }
    fullScene = null;
    for (const g of oldGeometries.splice(0)) g.dispose();
    for (const t of replaced) t.dispose();
    replaced.clear();
  };

  const settled = (async (): Promise<DetailState> => {
    try {
      while (state === "far" && !shown()) await nextFrame();
      if (state !== "far") return state;
      const hold = (async () => {
        for (let i = 0; i < holdFrames && state === "far"; i++) await nextFrame();
      })();
      const [gltf] = await Promise.all([loadFull(), hold]);
      fullScene = gltf.scene;
      if (state !== "far") {
        freeFull();
        return state;
      }
      prepareCompound(fullScene);
      const pairs = pairDetail(farRoot, fullScene);

      // Uploads first, one texture per frame.
      const uploads = texturesIn(fullScene);
      for (const t of uploads) {
        await nextFrame();
        if (state !== "far") {
          freeFull();
          return state;
        }
        renderer.initTexture(t);
      }

      // Then one mesh per frame.
      const light = bakedLightOf(farRoot);
      const done = new Set<Material>();
      const users = new Map<BufferGeometry, number>();
      for (const p of pairs) users.set(p.full.geometry, (users.get(p.full.geometry) ?? 0) + 1);
      for (const pair of pairs) {
        await nextFrame();
        if (state !== "far") {
          freeFull();
          return state;
        }
        const geometry = carryOver(pair, farRoot, light, (users.get(pair.full.geometry) ?? 0) > 1);
        oldGeometries.push(pair.far.geometry);
        pair.far.geometry = geometry;
        for (const t of adoptTextures(materialsOf(pair.far), materialsOf(pair.full), done)) replaced.add(t);
        redraw();
      }

      // What the far set no longer draws, and what the full file brought but is not drawn.
      for (const g of oldGeometries.splice(0)) g.dispose();
      const inUse = texturesIn(farRoot);
      for (const t of [...replaced, ...uploads]) if (!inUse.has(t)) t.dispose();
      replaced.clear();
      const drawn = new Set(meshesOf(farRoot).map((m) => m.geometry));
      for (const mesh of meshesOf(fullScene)) {
        if (!drawn.has(mesh.geometry)) mesh.geometry.dispose(); // a shared original that each copy cloned
        for (const m of materialsOf(mesh)) m.dispose();
      }
      fullScene = null;
      state = "full";
      redraw();
      return state;
    } catch (error) {
      // `cancel` may have run meanwhile (TypeScript cannot see that across the awaits).
      if ((state as DetailState) === "cancelled") {
        freeFull();
        return "cancelled";
      }
      reportError("sawad-scene", error, { stage: "compound-detail", tier });
      freeFull();
      state = "failed";
      return state;
    } finally {
      onSettled?.();
    }
  })();

  return {
    get state() {
      return state;
    },
    settled,
    cancel() {
      if (state === "far") state = "cancelled";
    },
  };
}

/** Loads an instanced library (plants, or people, cars and birds). Rejects after reporting, like `loadCompound`. */
export async function loadLibrary(kind: LibraryKind, tier: QualityTier, renderer: WebGLRenderer): Promise<GltfLibrary> {
  const url = LIBRARY_URL[kind][tier];
  try {
    const gltf = await withKtx2(renderer, (ktx2) => loadGltf(url, ktx2));
    return { scene: gltf.scene, animations: gltf.animations };
  } catch (error) {
    reportError("sawad-scene", error, { stage: kind, tier, url });
    throw error;
  }
}
