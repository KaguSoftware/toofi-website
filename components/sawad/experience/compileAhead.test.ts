import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Scene, type Camera, type Material, type Object3D, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPILE_TIMEOUT_MS, WARM_BATCH, compileAhead, createWarmUp, warmUp } from "./compileAhead";

type Call = { scene: Object3D; camera: Camera; target: string | null; drawn: string[] };

/** A stand-in renderer: `render` records what a real one would draw (visible, on the camera's layers). */
function fakeRenderer(target: string | null = "buffer") {
  const state = { target };
  const draws: Call[] = [];
  const compiles: Call[] = [];
  const pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
  const visible = (scene: Object3D, camera: Camera) => {
    const names: string[] = [];
    scene.traverseVisible((o) => {
      if ((o as Mesh).isMesh && o.layers.test(camera.layers)) names.push(o.name);
    });
    return names;
  };
  const gl = {
    render: vi.fn((scene: Object3D, camera: Camera) => {
      draws.push({ scene, camera, target: state.target, drawn: visible(scene, camera) });
    }),
    getRenderTarget: () => state.target,
    compileAsync: vi.fn((scene: Object3D, camera: Camera) => {
      compiles.push({ scene, camera, target: state.target, drawn: [] });
      return new Promise<Object3D>((resolve, reject) => pending.push({ resolve: () => resolve(scene), reject }));
    }),
  };
  return { gl: gl as unknown as WebGLRenderer, render: gl.render, state, draws, compiles, pending };
}

const geometry = new BoxGeometry();
const mesh = (name: string, material: Material | Material[]) => {
  const m = new Mesh(geometry, material);
  m.name = name;
  return m;
};

/** A world of `n` materials, one mesh each, and an effect chain of two full-screen passes. */
function frame(n: number) {
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const materials = Array.from({ length: n }, () => new MeshBasicMaterial());
  materials.forEach((m, i) => scene.add(mesh(`m${i}`, m)));
  const passA = new Scene().add(mesh("passA", new MeshBasicMaterial()));
  const passB = new Scene().add(mesh("passB", new MeshBasicMaterial()));
  const flat = new OrthographicCamera();
  return { scene, camera, materials, passA, passB, flat };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("compileAhead", () => {
  it("hands every render call of a dry frame to compileAsync, with its render target still bound, and draws nothing", async () => {
    const r = fakeRenderer();
    const f = frame(3);
    const draw = () => {
      r.state.target = "input";
      r.gl.render(f.scene, f.camera);
      r.state.target = "buffer";
      r.gl.render(f.passA, f.flat);
      r.state.target = null;
      r.gl.render(f.passB, f.flat);
    };
    const done = compileAhead(r.gl, draw);
    expect(r.draws).toEqual([]);
    expect(r.compiles.map((c) => [c.scene, c.target])).toEqual([
      [f.scene, "input"],
      [f.passA, "buffer"],
      [f.passB, null],
    ]);
    // The real render is back as soon as the dry frame has run.
    expect(r.gl.render).toBe(r.render);
    r.pending.forEach((p) => p.resolve());
    await expect(done).resolves.toBe(true);
  });

  it("waits for every program, not just the first", async () => {
    const r = fakeRenderer();
    const f = frame(1);
    let settled = false;
    const done = compileAhead(r.gl, () => {
      r.gl.render(f.scene, f.camera);
      r.gl.render(f.passA, f.flat);
    }).then((ok) => {
      settled = true;
      return ok;
    });
    r.pending[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    r.pending[1].resolve();
    await expect(done).resolves.toBe(true);
  });

  it("goes on after the timeout when the compile hangs", async () => {
    vi.useFakeTimers();
    const r = fakeRenderer();
    const f = frame(1);
    const done = compileAhead(r.gl, () => r.gl.render(f.scene, f.camera));
    await vi.advanceTimersByTimeAsync(COMPILE_TIMEOUT_MS);
    await expect(done).resolves.toBe(false);
  });

  it("resolves at once for a frame that draws nothing", async () => {
    const r = fakeRenderer();
    await expect(compileAhead(r.gl, () => {})).resolves.toBe(true);
    expect(r.compiles).toEqual([]);
  });

  it("puts the real render back and rejects when the frame throws, or a compile fails", async () => {
    const r = fakeRenderer();
    const f = frame(1);
    await expect(
      compileAhead(r.gl, () => {
        throw new Error("lost");
      }),
    ).rejects.toThrow("lost");
    expect(r.gl.render).toBe(r.render);

    const failing = compileAhead(r.gl, () => r.gl.render(f.scene, f.camera));
    r.pending[0].reject(new Error("link failed"));
    await expect(failing).rejects.toThrow("link failed");
    expect(r.gl.render).toBe(r.render);
  });
});

describe("createWarmUp", () => {
  it("draws a few new materials per frame until each has been drawn once", () => {
    const r = fakeRenderer();
    const f = frame(10);
    const warm = createWarmUp(r.gl, () => r.gl.render(f.scene, f.camera));
    const perFrame: string[][] = [];
    let more = true;
    while (more) {
      const before = r.draws.length;
      more = warm.frame();
      perFrame.push(r.draws.slice(before).flatMap((d) => d.drawn));
    }
    expect(perFrame).toEqual([
      ["m0", "m1", "m2", "m3"],
      ["m4", "m5", "m6", "m7"],
      ["m8", "m9"],
    ]);
    expect(perFrame.every((names) => names.length <= WARM_BATCH)).toBe(true);
    // Every object is back on its layers, and the real render is back.
    expect(f.scene.children.every((o) => o.layers.mask === 1)).toBe(true);
    expect(r.gl.render).toBe(r.render);
  });

  it("shares one frame's budget between the scene and the passes, and skips calls with nothing new", () => {
    const r = fakeRenderer();
    const f = frame(3);
    const draw = () => {
      r.gl.render(f.scene, f.camera);
      r.gl.render(f.passA, f.flat);
      r.gl.render(f.passB, f.flat);
    };
    const warm = createWarmUp(r.gl, draw, 4);
    expect(warm.frame()).toBe(true);
    expect(r.draws.map((d) => d.drawn)).toEqual([["m0", "m1", "m2"], ["passA"]]);
    r.draws.length = 0;
    expect(warm.frame()).toBe(false);
    // The scene has nothing new: its call is skipped, only the last pass is drawn.
    expect(r.draws.map((d) => d.drawn)).toEqual([["passB"]]);
    r.draws.length = 0;
    expect(warm.frame()).toBe(false);
    expect(r.draws).toEqual([]);
  });

  it("counts an instanced copy, a material list and a scene-wide override as programs of their own", () => {
    const r = fakeRenderer();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const shared = new MeshBasicMaterial();
    const other = new MeshBasicMaterial();
    scene.add(mesh("plain", shared), mesh("twin", shared), mesh("pair", [shared, other]));
    const many = new InstancedMesh(geometry, shared, 2);
    many.name = "instanced";
    scene.add(many);
    const warm = createWarmUp(r.gl, () => r.gl.render(scene, camera), 1);
    const frames: string[][] = [];
    for (let i = 0; i < 3; i++) {
      r.draws.length = 0;
      warm.frame();
      frames.push(r.draws.flatMap((d) => d.drawn));
    }
    // Two meshes with one material are one program; the list and the instanced mesh are others.
    expect(frames).toEqual([["plain", "twin"], ["pair"], ["instanced"]]);

    // A depth or normal pass draws the same objects with one override material: new programs again.
    scene.overrideMaterial = new MeshBasicMaterial();
    r.draws.length = 0;
    expect(warm.frame()).toBe(true);
    expect(r.draws.flatMap((d) => d.drawn)).toEqual(["plain", "twin", "pair"]);
  });

  it("never draws to the screen: only the passes into buffers are warmed", () => {
    const r = fakeRenderer();
    const f = frame(2);
    const draw = () => {
      r.state.target = "input";
      r.gl.render(f.scene, f.camera);
      r.state.target = null;
      r.gl.render(f.passA, f.flat);
    };
    const warm = createWarmUp(r.gl, draw);
    expect(warm.frame()).toBe(false);
    expect(r.draws.map((d) => [d.target, d.drawn])).toEqual([["input", ["m0", "m1"]]]);
    // The pass to the screen is left for the first real frame, however many frames are warmed.
    r.draws.length = 0;
    expect(warm.frame()).toBe(false);
    expect(r.draws).toEqual([]);
  });

  it("leaves hidden objects and other layers alone", () => {
    const r = fakeRenderer();
    const f = frame(2);
    f.scene.children[0].visible = false;
    f.scene.children[1].layers.set(3);
    const warm = createWarmUp(r.gl, () => r.gl.render(f.scene, f.camera));
    expect(warm.frame()).toBe(false);
    expect(r.draws).toEqual([]);
    expect(f.scene.children[1].layers.mask).toBe(8);
  });

  it("restores the layers and the render when a draw throws", () => {
    const r = fakeRenderer();
    const f = frame(6);
    r.render.mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    const warm = createWarmUp(r.gl, () => r.gl.render(f.scene, f.camera));
    expect(() => warm.frame()).toThrow("draw failed");
    expect(f.scene.children.every((o) => o.layers.mask === 1)).toBe(true);
    expect(r.gl.render).toBe(r.render);
  });
});

describe("warmUp", () => {
  const instantly = () => Promise.resolve();

  it("runs one warm-up frame per animation frame and reports how many it took", async () => {
    const r = fakeRenderer();
    const f = frame(9);
    const nextFrame = vi.fn(instantly);
    await expect(warmUp(r.gl, () => r.gl.render(f.scene, f.camera), { nextFrame })).resolves.toBe(3);
    expect(nextFrame).toHaveBeenCalledTimes(3);
    expect(r.draws.flatMap((d) => d.drawn)).toHaveLength(9);
  });

  it("stops at the frame limit, leaving the rest to the real frame", async () => {
    const r = fakeRenderer();
    const f = frame(9);
    await expect(warmUp(r.gl, () => r.gl.render(f.scene, f.camera), { nextFrame: instantly, batch: 1, maxFrames: 4 })).resolves.toBe(4);
    expect(r.draws.flatMap((d) => d.drawn)).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("stops when the scene is torn down", async () => {
    const r = fakeRenderer();
    const f = frame(9);
    let frames = 0;
    await expect(warmUp(r.gl, () => r.gl.render(f.scene, f.camera), { nextFrame: instantly, cancelled: () => ++frames > 1 })).resolves.toBe(1);
    expect(r.draws).toHaveLength(1);
  });

  it("waits on the browser's animation frame by default", async () => {
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    try {
      const r = fakeRenderer();
      const f = frame(1);
      await expect(warmUp(r.gl, () => r.gl.render(f.scene, f.camera))).resolves.toBe(1);
      expect(raf).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
