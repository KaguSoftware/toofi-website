// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(join(__dirname, "probe.js"), "utf8");

type Node = { name: string; type: string; visible: boolean; renderOrder: number; children: Node[]; material?: unknown; isMesh?: boolean; castShadow?: boolean; traverse: (fn: (o: Node) => void) => void; getObjectByName: (n: string) => Node | undefined } & Record<string, unknown>;

function node(name: string, children: Node[] = [], extra: Record<string, unknown> = {}): Node {
  const n = {
    name,
    type: "Object3D",
    visible: true,
    renderOrder: 0,
    children,
    ...extra,
    traverse(fn: (o: Node) => void) {
      fn(n as Node);
      for (const c of children) c.traverse(fn);
    },
    getObjectByName(target: string): Node | undefined {
      let hit: Node | undefined;
      (n as Node).traverse((o) => {
        if (!hit && o.name === target) hit = o;
      });
      return hit;
    },
  };
  return n as Node;
}

type S4 = {
  frames: Array<{ frame: number; ms: number | null; jsMs: number }>;
  passes: Record<string, { n: number; ms: number; skipped: number }>;
  passOrder: string[];
  done: Array<{ do: string; result: Record<string, unknown> }>;
  errors: string[];
  skipped: number;
  labelOf: (r: unknown, scene: unknown, camera: unknown) => string;
  snapshot: () => Record<string, unknown>;
  describe: () => { children: Array<{ name: string }>; materials: Array<{ name: string; users: number }> } | null;
};
type W = Window & { __s4?: S4; __rig?: unknown; __S4_CONFIG__?: unknown };

const realRaf = window.requestAnimationFrame;
let flushAll: () => void = () => {};

/** The page as the rig's probe leaves it: a stage canvas, one renderer, the main scene, a hand-driven frame loop. */
function install(config: Record<string, unknown>, { withRig = true } = {}) {
  const queue: FrameRequestCallback[] = [];
  window.requestAnimationFrame = (cb) => queue.push(cb);
  document.body.innerHTML = '<div class="xp__canvas"><canvas></canvas></div>';
  const canvas = document.querySelector("canvas")!;
  const gl = { readPixels: vi.fn(), getParameter: vi.fn(() => 2), RGBA: 1, UNSIGNED_BYTE: 2, FLOAT: 3, UNSIGNED_INT: 4, IMPLEMENTATION_COLOR_READ_FORMAT: 5, IMPLEMENTATION_COLOR_READ_TYPE: 6 };
  let target: unknown = null;
  let renders = 0;
  const sun = node("sun", [], { castShadow: true, shadow: { mapSize: { x: 4096, set(x: number) { this.x = x; } }, map: { dispose: vi.fn() }, radius: 3 } });
  const plaster = { id: 7, name: "plaster", type: "MeshStandardMaterial", userData: {} };
  const scene = node("", [node("sky", [], { isMesh: true, material: { id: 1, name: "", type: "ShaderMaterial" } }), sun, node("terrain", [], { isMesh: true, material: { id: 2, name: "", type: "MeshStandardMaterial" } }), node("vegetation"), node("architecture-model", [node("villa", [], { isMesh: true, material: plaster, castShadow: true }), node("gym", [], { isMesh: true, material: plaster })])], {
    isScene: true,
    environment: { isTexture: true },
    fog: { density: 0.0007 },
  });
  const renderer = {
    domElement: canvas,
    getContext: () => gl,
    getRenderTarget: () => target,
    getPixelRatio: () => 1.75,
    shadowMap: { render() {}, autoUpdate: true, type: 1, enabled: true },
    toneMapping: 0,
    info: { programs: [], memory: { textures: 0, geometries: 0 } },
    render: vi.fn<(scene?: unknown, camera?: unknown) => void>(() => {
      renders++;
    }),
  };
  const inner = renderer.render;
  const rig = { renderers: [renderer], scenes: [node("pass-scene"), scene], started: true, frame: 0, recording: false, renderCount: () => renders };
  if (withRig) (window as W).__rig = rig;
  (window as W).__S4_CONFIG__ = config;
  new Function(SOURCE)();
  const camera = { isPerspectiveCamera: true };
  const ortho = { isOrthographicCamera: true };
  const fullscreen = (name: string) => ({ isScene: true, children: [{ material: { name, type: "ShaderMaterial", fragmentShader: "" } }] });
  /** One frame: the page's loop draws the given passes. */
  const frame = (passes: Array<[unknown, unknown, unknown]>) => {
    rig.frame += 1;
    window.requestAnimationFrame(() => {
      for (const [s, c, t] of passes) {
        target = t;
        renderer.render(s as never, c as never);
      }
      target = null;
    });
    queue.splice(0).forEach((cb) => cb(0));
  };
  flushAll = () => queue.splice(0).forEach((cb) => cb(0));
  return { s4: (window as W).__s4!, rig, renderer, inner, gl, scene, sun, camera, ortho, fullscreen, frame, setTarget: (t: unknown) => (target = t) };
}

afterEach(() => {
  window.requestAnimationFrame = realRaf;
  delete (window as W).__s4;
  delete (window as W).__rig;
  delete (window as W).__S4_CONFIG__;
  document.body.innerHTML = "";
});

const HALF = { width: 1260, height: 728, texture: { type: 1016 } };
const FULL = { width: 2520, height: 1456, texture: { type: 1009 } };

describe("S4 probe", () => {
  it("says so when the rig's probe is missing", () => {
    const { s4 } = install({}, { withRig: false });
    expect(s4.errors).toEqual(["the rig's probe is not installed"]);
  });

  it("labels a pass by what it draws and where to", () => {
    const { s4, renderer, scene, camera, ortho, fullscreen, setTarget } = install({});
    expect(s4.labelOf(renderer, scene, camera)).toBe("scene@screen");
    setTarget(HALF);
    expect(s4.labelOf(renderer, fullscreen("LuminanceMaterial"), ortho)).toBe("LuminanceMaterial@1260x728:f16");
    setTarget(FULL);
    expect(s4.labelOf(renderer, { isMesh: true, material: { name: "", type: "ShaderMaterial", fragmentShader: "abcd" } }, ortho)).toBe("ShaderMaterial#4@2520x1456:u8");
  });

  it("times each drawn frame to the point the GPU has finished, while the rig records", () => {
    const { s4, rig, gl, scene, camera, frame } = install({ sync: true });
    frame([[scene, camera, null]]);
    expect(s4.frames).toHaveLength(0); // not recording yet
    rig.recording = true;
    frame([[scene, camera, null]]);
    frame([]); // a callback that draws nothing is not a frame
    expect(s4.frames).toHaveLength(1);
    expect(s4.frames[0].frame).toBe(2);
    expect(s4.frames[0].ms).toBeGreaterThanOrEqual(s4.frames[0].jsMs);
    expect(gl.readPixels).toHaveBeenCalledTimes(2);
  });

  it("keeps the pass chain of a recorded frame, in draw order", () => {
    const { s4, rig, scene, camera, ortho, fullscreen, frame } = install({});
    rig.recording = true;
    const chain: Array<[unknown, unknown, unknown]> = [
      [scene, camera, FULL],
      [fullscreen("LuminanceMaterial"), ortho, HALF],
      [fullscreen("EffectMaterial"), ortho, null],
    ];
    frame(chain);
    frame(chain);
    expect(s4.passOrder).toEqual(["scene@2520x1456:u8", "LuminanceMaterial@1260x728:f16", "EffectMaterial@screen"]);
    expect(s4.passes["01 LuminanceMaterial@1260x728:f16"]).toMatchObject({ n: 2, skipped: 0 });
  });

  it("waits for the GPU after every pass when asked to split the frame", () => {
    const { s4, rig, gl, scene, camera, ortho, fullscreen, frame } = install({ syncPass: true });
    rig.recording = true;
    frame([
      [scene, camera, FULL],
      [fullscreen("EffectMaterial"), ortho, null],
    ]);
    // One read-back for the scene's target, one for the screen.
    expect(gl.readPixels).toHaveBeenCalledTimes(2);
    expect(s4.passes["00 scene@2520x1456:u8"].ms).toBeGreaterThanOrEqual(0);
  });

  it("draws several frames in one tick while recording, and lets only one of them ask for the next tick", () => {
    const { s4, rig, inner, scene, camera, frame } = install({ sync: true, repeat: 4 });
    frame([[scene, camera, null]]);
    expect(inner).toHaveBeenCalledTimes(1); // not recording: one frame per tick
    rig.recording = true;
    const asked: unknown[] = [];
    rig.frame += 1;
    const loop = () => {
      asked.push(window.requestAnimationFrame(() => {}));
      (rig.renderers[0] as { render: (s: unknown, c: unknown) => void }).render(scene, camera);
    };
    const raf = window.requestAnimationFrame;
    raf(loop);
    flushAll();
    expect(inner).toHaveBeenCalledTimes(5); // four more
    expect(asked.filter((id) => id === 0)).toHaveLength(3); // three of the four requests were muted
    expect(window.requestAnimationFrame).toBe(raf); // and the real one is back
    expect(s4.frames).toHaveLength(1);
    expect(s4.frames[0]).toMatchObject({ drawn: 4 });
  });

  it("applies each change on its frame, once", () => {
    const { s4, rig, scene, sun, renderer, camera, frame } = install({
      mutations: [
        { frame: 2, do: "hide", match: "^vegetation$" },
        { frame: 2, do: "renderOrder", match: "^sky$", value: 10 },
        { frame: 3, do: "shadow", freeze: true, size: 2048 },
        { frame: 3, do: "environment", on: false },
        { frame: 4, do: "shadow", cast: false },
        { frame: 4, do: "environment", on: true },
      ],
    });
    frame([[scene, camera, null]]);
    expect(scene.getObjectByName("vegetation")!.visible).toBe(true);
    frame([[scene, camera, null]]);
    expect(scene.getObjectByName("vegetation")!.visible).toBe(false);
    expect(scene.getObjectByName("sky")!.renderOrder).toBe(10);
    expect(scene.environment).toBeTruthy();
    frame([[scene, camera, null]]);
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect((sun.shadow as { mapSize: { x: number }; map: unknown }).mapSize.x).toBe(2048);
    expect((sun.shadow as { map: unknown }).map).toBeNull();
    expect(scene.environment).toBeNull();
    frame([[scene, camera, null]]);
    expect(sun.castShadow).toBe(false);
    expect(scene.environment).toBeTruthy();
    expect(s4.done.map((d) => d.do)).toEqual(["hide", "renderOrder", "shadow", "environment", "shadow", "environment"]);
    expect(s4.done[0].result).toEqual({ hidden: 1 });
    expect(rig.frame).toBe(4);
    expect(s4.errors).toEqual([]);
  });

  it("does not draw the passes it is told to skip, but never the one to the screen", () => {
    const { s4, rig, inner, scene, camera, ortho, fullscreen, frame } = install({ mutations: [{ frame: 1, do: "skip", match: "Luminance|EffectMaterial" }] });
    rig.recording = true;
    frame([
      [scene, camera, FULL],
      [fullscreen("LuminanceMaterial"), ortho, HALF],
      [fullscreen("EffectMaterial"), ortho, null],
    ]);
    expect(inner).toHaveBeenCalledTimes(2); // the scene and the screen pass
    expect(s4.skipped).toBe(1);
    expect(s4.passes["01 LuminanceMaterial@1260x728:f16"].skipped).toBe(1);
  });

  it("reports a change it cannot make instead of failing the frame", () => {
    const { s4, scene, camera, frame } = install({ mutations: [{ frame: 1, do: "dpr", value: 1.5 }, { frame: 1, do: "nope" }] });
    frame([[scene, camera, null]]);
    expect(s4.done[0].result).toEqual({ error: "dpr hook not where expected" });
    expect(s4.errors[0]).toMatch(/^nope@1/);
  });

  it("describes the scene: its top-level objects and materials with how many meshes use each", () => {
    const { s4, scene, camera, frame } = install({ describe: true });
    frame([[scene, camera, null]]);
    const d = s4.describe()!;
    expect(d.children.map((c) => c.name)).toEqual(["sky", "sun", "terrain", "vegetation", "architecture-model"]);
    expect(d.materials.find((m) => m.name === "plaster")).toMatchObject({ users: 2, cast: 1 });
    expect(s4.snapshot()).toMatchObject({ skipped: 0, memory: null });
  });
});
