// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "probe.js"), "utf8");

type Rig = {
  started: boolean;
  frame: number;
  frames: Array<Record<string, unknown>>;
  events: Array<{ type: string }>;
  captures: Record<string, unknown>;
  renderers: unknown[];
  snapshot: () => { frames: Array<Record<string, number>>; errors: string[] };
  renderCount: () => number;
};
type W = Window & { __rig?: Rig; __RIG_CONFIG__?: unknown; __THREE_DEVTOOLS__?: EventTarget };

const originals = {
  now: performance.now,
  dateNow: Date.now,
  getContext: HTMLCanvasElement.prototype.getContext,
  raf: window.requestAnimationFrame,
};

/** Installs the probe with a hand-driven requestAnimationFrame. */
function install(config: Record<string, unknown>) {
  const queue: FrameRequestCallback[] = [];
  window.requestAnimationFrame = (cb) => queue.push(cb);
  (window as W).__RIG_CONFIG__ = config;
  new Function(SOURCE)();
  const flush = (ts: number) => queue.splice(0).forEach((cb) => cb(ts));
  return { rig: (window as W).__rig!, flush };
}

function stage() {
  const host = document.createElement("div");
  host.className = "xp__canvas";
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  document.body.appendChild(host);
  return canvas;
}

const CAMERA = { isPerspectiveCamera: true };

/** A stand-in for a three.js WebGLRenderer: each render() draws `calls` calls of 100 triangles. */
function fakeRenderer(canvas: HTMLCanvasElement) {
  const info = { autoReset: true, render: { calls: 0, triangles: 0, points: 0, lines: 0 }, memory: { geometries: 1, textures: 2 }, programs: [] };
  let next = 1;
  let target: unknown = null;
  return {
    isWebGLRenderer: true,
    info,
    domElement: canvas,
    shadowMap: { render() {} },
    getContext: () => ({}),
    getRenderTarget: () => target,
    setTarget: (t: unknown) => (target = t),
    getPixelRatio: () => 1.5,
    willDraw: (n: number) => (next = n),
    render(...args: unknown[]) {
      void args;
      info.render.calls = next;
      info.render.triangles = next * 100;
    },
  };
}

beforeEach(() => {
  delete (window as W).__rig;
  document.body.innerHTML = "";
});

afterEach(() => {
  performance.now = originals.now;
  Date.now = originals.dateNow;
  HTMLCanvasElement.prototype.getContext = originals.getContext;
  window.requestAnimationFrame = originals.raf;
  delete (Navigator.prototype as unknown as Record<string, unknown>).deviceMemory;
});

describe("the probe", () => {
  it("forces the device tier through navigator.deviceMemory and hardwareConcurrency", () => {
    install({ deviceMemory: 4, hardwareConcurrency: 6 });
    expect((navigator as Navigator & { deviceMemory?: number }).deviceMemory).toBe(4);
    expect(navigator.hardwareConcurrency).toBe(6);
  });

  it("starts on the first draw to the screen, not on set-up renders into targets", () => {
    const { rig, flush } = install({});
    const r = fakeRenderer(stage());
    (window as W).__THREE_DEVTOOLS__!.dispatchEvent(new CustomEvent("observe", { detail: r }));
    window.requestAnimationFrame(() => {
      r.setTarget({ width: 256, height: 256 });
      r.render({}, CAMERA);
    });
    flush(10);
    expect(rig.started).toBe(false);
    window.requestAnimationFrame(() => {
      r.setTarget(null);
      r.render({}, CAMERA);
    });
    flush(26);
    expect(rig.started).toBe(true);
    expect(rig.events.map((e) => e.type)).toContain("first-frame");
  });

  it("sums every pass of a frame and records frames only inside the window", () => {
    const { rig, flush } = install({ plan: [{ frame: 1, do: "record", on: true }, { frame: 3, do: "record", on: false }] });
    const r = fakeRenderer(stage());
    (window as W).__THREE_DEVTOOLS__!.dispatchEvent(new CustomEvent("observe", { detail: r }));
    const frame = (ts: number) => {
      window.requestAnimationFrame(() => {
        r.willDraw(2);
        r.render({}, CAMERA);
        r.willDraw(5); // a later pass that draws more than the first must count in full
        r.render({}, CAMERA);
      });
      flush(ts);
    };
    for (const ts of [0, 16, 32, 48, 64]) frame(ts);
    const snap = rig.snapshot();
    expect(snap.frames.map((f) => f.frame)).toEqual([1, 2]);
    expect(snap.frames[0]).toMatchObject({ calls: 7, triangles: 700, passes: 2, dpr: 1.5, interval: 16, sceneCalls: 2, sceneTriangles: 200, shadowTriangles: 0 });
    expect(rig.renderCount()).toBe(10);
  });

  it("holds time still until the first frame, then advances exactly 1/60 s per frame", () => {
    const { flush } = install({ virtualTime: true });
    const before = performance.now();
    flush(500);
    expect(performance.now()).toBe(before);
    const r = fakeRenderer(stage());
    (window as W).__THREE_DEVTOOLS__!.dispatchEvent(new CustomEvent("observe", { detail: r }));
    const seen: number[] = [];
    const frame = (ts: number) => {
      window.requestAnimationFrame((t) => {
        seen.push(t);
        r.render({}, CAMERA);
      });
      flush(ts);
    };
    frame(1000);
    frame(1003); // real frames arrive unevenly; virtual time does not care
    frame(1050);
    expect(seen[1] - seen[0]).toBeCloseTo(1000 / 60);
    expect(seen[2] - seen[1]).toBeCloseTo(1000 / 60);
    expect(performance.now()).toBeCloseTo(seen[2]);
  });

  it("runs plan steps on their frame: scrolling to a tour stop and clicking", () => {
    const beat = document.createElement("li");
    beat.dataset.beat = "entrance";
    document.body.appendChild(beat);
    const button = document.createElement("button");
    button.className = "xp__explore";
    let clicks = 0;
    button.onclick = () => clicks++;
    document.body.appendChild(button);
    const scrolls: unknown[] = [];
    window.scrollTo = ((opts: unknown) => scrolls.push(opts)) as typeof window.scrollTo;
    const { flush } = install({ plan: [{ frame: 1, do: "scrollToBeat", beat: 1 }, { frame: 2, do: "click", selector: ".xp__explore" }] });
    const r = fakeRenderer(stage());
    (window as W).__THREE_DEVTOOLS__!.dispatchEvent(new CustomEvent("observe", { detail: r }));
    for (const ts of [0, 16, 32]) {
      window.requestAnimationFrame(() => r.render({}, CAMERA));
      flush(ts);
    }
    expect(scrolls).toEqual([{ top: 0, behavior: "instant" }]);
    expect(clicks).toBe(1);
  });
});
