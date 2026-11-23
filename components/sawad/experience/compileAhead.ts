import type { Camera, Material, Object3D, WebGLRenderer } from "three";

/**
 * Shader programs made ready before the frame that needs them (T13).
 *
 * three.js builds a program the first time a material is drawn, and its first use waits on the
 * main thread until the GPU has compiled and linked it. Left alone, every program of the scene
 * and of the effect chain lands in the first frame: 0.3 s when the system has the shaders
 * cached, over 4 s on a first-ever visit (S1-1).
 *
 * Both helpers take a `draw` function that draws one frame the way the page will (the effect
 * composer, or a plain render). They never look inside it, so they work for any list of passes:
 * a later change to the chain (F3) calls them with the new chain's `draw`.
 */

/** How long to wait for the background compile before going on without it. */
export const COMPILE_TIMEOUT_MS = 4000;
/** How many materials are drawn for the first time in one warm-up frame. */
export const WARM_BATCH = 4;
/** The most warm-up frames to spend; whatever is left after them is first used in the real frame. */
export const WARM_FRAMES_MAX = 60;

type Render = WebGLRenderer["render"];

/** Runs `draw` with the renderer's `render` replaced, and puts the real one back whatever happens. */
function withRender(gl: WebGLRenderer, stand: Render, draw: () => void): void {
  const real = gl.render;
  gl.render = stand;
  try {
    draw();
  } finally {
    gl.render = real;
  }
}

/**
 * Compiles every program one frame needs, in the background. `draw` is run once as a dry frame:
 * each render call inside it is handed to `compileAsync` instead of being drawn, with the render
 * target it was about to draw into still bound, so the programs are the ones the real frame will
 * ask for (a program depends on its target's colour space). The browser compiles them side by
 * side off the main thread; this resolves when they are ready, or after `timeoutMs`.
 *
 * Programs that are already built cost nothing, so it can be called again whenever something
 * new is in the scene. Resolves true when everything compiled in time.
 */
export async function compileAhead(gl: WebGLRenderer, draw: () => void, timeoutMs = COMPILE_TIMEOUT_MS): Promise<boolean> {
  const jobs: Promise<unknown>[] = [];
  withRender(
    gl,
    (scene: Object3D, camera: Camera) => {
      jobs.push(gl.compileAsync(scene, camera));
    },
    draw,
  );
  if (!jobs.length) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([Promise.all(jobs).then(() => true as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

type Drawable = Object3D & { material?: Material | Material[]; isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
const DRAWN = ["isMesh", "isPoints", "isLine", "isSprite"] as const;
const isDrawable = (o: Object3D): o is Drawable => DRAWN.some((flag) => (o as unknown as Record<string, unknown>)[flag] === true) && !!(o as Drawable).material;

/** What decides an object's program, as far as this file can tell: its materials, how it is drawn, and a scene-wide override. */
function programKey(o: Drawable, override: Material | null): string {
  const materials = override ? [override] : Array.isArray(o.material) ? o.material : [o.material!];
  return `${materials.map((m) => m.uuid).join("+")}${o.isInstancedMesh ? ":instanced" : ""}${o.isSkinnedMesh ? ":skinned" : ""}`;
}

export type WarmUp = {
  /**
   * Draws one warm-up frame: `draw` runs with every render call cut down to a few materials
   * that have not been drawn yet. Returns true while some are still left.
   */
  frame: () => boolean;
};

/**
 * Spreads the first use of each program over several frames. Even a program that compiled ahead
 * costs time on its first draw (about 23 ms each on a first-ever visit, S1), so the frames drawn
 * here, behind the poster, each take a few and the first frame the visitor sees takes none.
 *
 * In a warm-up frame, a render call draws only the objects whose materials are next in line
 * (the rest are taken off the camera's layers for that call, which also keeps them out of the
 * shadow pass), and a call with nothing new to draw is skipped. Only draws into render targets
 * are let through, so nothing reaches the screen: what the buffers hold meanwhile is not a
 * picture.
 */
export function createWarmUp(gl: WebGLRenderer, draw: () => void, batch = WARM_BATCH): WarmUp {
  const drawn = new Set<string>();
  return {
    frame() {
      let budget = batch;
      let more = false;
      const real = gl.render;
      withRender(
        gl,
        (scene: Object3D, camera: Camera) => {
          // Never to the screen: the canvas shows nothing until the first real frame, and "the
          // first draw to the screen" stays what it means to the page and to the measuring rig.
          // The one program this leaves cold is the last pass's.
          if (gl.getRenderTarget() === null) return;
          const override = (scene as Object3D & { overrideMaterial?: Material | null }).overrideMaterial ?? null;
          const fresh = new Map<string, Drawable[]>();
          const stale: Drawable[] = [];
          scene.traverseVisible((o) => {
            if (!isDrawable(o) || !o.layers.test(camera.layers)) return;
            const key = programKey(o, override);
            if (drawn.has(key)) stale.push(o);
            else fresh.set(key, [...(fresh.get(key) ?? []), o]);
          });
          const keys = [...fresh.keys()];
          const take = keys.slice(0, Math.max(0, budget));
          if (keys.length > take.length) more = true;
          if (!take.length) return;
          budget -= take.length;
          // Everything not in this batch sits the call out.
          const out = [...stale, ...keys.slice(take.length).flatMap((k) => fresh.get(k)!)];
          const masks = out.map((o) => o.layers.mask);
          for (const o of out) o.layers.mask = 0;
          try {
            real.call(gl, scene, camera);
          } finally {
            out.forEach((o, i) => {
              o.layers.mask = masks[i];
            });
          }
          for (const key of take) drawn.add(key);
        },
        draw,
      );
      return more;
    },
  };
}

export type WarmUpOptions = {
  batch?: number;
  maxFrames?: number;
  /** Waits for the next animation frame (tests pass their own). */
  nextFrame?: () => Promise<void>;
  /** True ends the warm-up early (the scene was torn down). */
  cancelled?: () => boolean;
};

const animationFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Runs warm-up frames, one per animation frame, until every material has been drawn once. Resolves with the number of frames. */
export async function warmUp(gl: WebGLRenderer, draw: () => void, { batch = WARM_BATCH, maxFrames = WARM_FRAMES_MAX, nextFrame = animationFrame, cancelled }: WarmUpOptions = {}): Promise<number> {
  const warm = createWarmUp(gl, draw, batch);
  let frames = 0;
  while (frames < maxFrames) {
    await nextFrame();
    if (cancelled?.()) break;
    frames += 1;
    if (!warm.frame()) break;
  }
  return frames;
}
