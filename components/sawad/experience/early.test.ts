// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROBE_KEY, qualityTier, readCapabilityEnv, render3D, resetWebGL2Probe } from "../scene/capability";
import { BASIS_TRANSCODER_PATH, PLAN_FAR_MODEL_URL } from "../scene/compoundModel";
import { DECODER_URLS, EARLY_ATTR, EARLY_FUNCTION, EARLY_SCRIPT, FIRST_MODEL_URL, LIVE_DOWNLOAD_MB, firstAssets, preloadFirstAssets } from "./early";

type Device = {
  width: number;
  screen: [number, number];
  coarse?: boolean;
  reduced?: boolean;
  memory?: number;
  threads?: number;
  saveData?: boolean;
  effectiveType?: string;
  /** The GPU's name; null for a browser without WebGL2. */
  gpu?: string | null;
};

const M3 = "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)";
const UHD = "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)";
const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

const desktop: Device = { width: 1440, screen: [1440, 900], memory: 8, threads: 8, gpu: M3 };
const phone: Device = { width: 412, screen: [412, 915], coarse: true, memory: 8, threads: 8, gpu: "Adreno (TM) 730" };

const define = (target: object, key: string, value: unknown) => Object.defineProperty(target, key, { value, configurable: true, writable: true });
let contexts = 0;

function become(d: Device): void {
  define(window, "innerWidth", d.width);
  define(window.screen, "width", d.screen[0]);
  define(window.screen, "height", d.screen[1]);
  define(navigator, "deviceMemory", d.memory);
  define(navigator, "hardwareConcurrency", d.threads);
  define(navigator, "connection", d.saveData === undefined && d.effectiveType === undefined ? undefined : { saveData: d.saveData, effectiveType: d.effectiveType });
  window.matchMedia = ((q: string) => ({ matches: q.includes("coarse") ? !!d.coarse : q.includes("reduce") ? !!d.reduced : false }) as MediaQueryList) as typeof window.matchMedia;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
    contexts += 1;
    if (d.gpu === null) return null;
    return {
      RENDERER: 0x1f01,
      getExtension: (name: string) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : name === "WEBGL_lose_context" ? { loseContext: () => {} } : null),
      getParameter: (id: number) => (id === 0x9246 ? (d.gpu ?? M3) : "masked"),
    };
  }) as unknown as HTMLCanvasElement["getContext"]);
}

const early = new Function("root", `return (${EARLY_FUNCTION})(root)`) as (root: Element | null) => void;

/** Runs the early script the way the page does and says what it decided. */
function runEarly(): { story: boolean; preloads: string[] } {
  const root = document.createElement("section");
  document.body.appendChild(root);
  early(root);
  const preloads = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]'), (l) => l.getAttribute("href")!);
  return { story: root.getAttribute(EARLY_ATTR) === "story", preloads };
}

beforeEach(() => {
  contexts = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  resetWebGL2Probe();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("the first files", () => {
  it("are the far set and the decoder the scene loads first", () => {
    // compoundModel.ts pulls in three.js, so its table is repeated in early.ts: keep them equal.
    expect(FIRST_MODEL_URL).toEqual(PLAN_FAR_MODEL_URL);
    expect(DECODER_URLS).toEqual([`${BASIS_TRANSCODER_PATH}basis_transcoder.js`, `${BASIS_TRANSCODER_PATH}basis_transcoder.wasm`]);
    expect(firstAssets("low")).toEqual([PLAN_FAR_MODEL_URL.low, ...DECODER_URLS]);
  });

  it("have a download size to name in the offer, larger on the high tier", () => {
    expect(LIVE_DOWNLOAD_MB.low).toBeGreaterThan(0);
    expect(LIVE_DOWNLOAD_MB.high).toBeGreaterThan(LIVE_DOWNLOAD_MB.low);
  });
});

describe("preloadFirstAssets", () => {
  it("adds one fetch preload per file, in the mode three's loaders fetch in", () => {
    preloadFirstAssets("low");
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(firstAssets("low"));
    for (const l of links) {
      expect(l.rel).toBe("preload");
      expect(l.getAttribute("as")).toBe("fetch");
      expect(l.crossOrigin).toBe("anonymous");
    }
  });

  it("does not repeat a hint that is already there", () => {
    preloadFirstAssets("high");
    preloadFirstAssets("high");
    expect(document.head.querySelectorAll("link")).toHaveLength(3);
    // Another tier shares the decoder and adds only its model.
    preloadFirstAssets("low");
    expect(document.head.querySelectorAll("link")).toHaveLength(4);
  });
});

describe("the early script", () => {
  it("is safe to put inside a script tag", () => {
    expect(EARLY_SCRIPT).not.toMatch(/<\/script|<!--/i);
    expect(EARLY_SCRIPT).toContain("document.currentScript");
    expect(() => new Function(EARLY_SCRIPT)).not.toThrow();
  });

  it("marks the live story and preloads the low tier's files on a phone, without making a WebGL context", () => {
    become(phone);
    expect(runEarly()).toEqual({ story: true, preloads: firstAssets("low") });
    expect(contexts).toBe(0);
    expect((window as unknown as Record<string, unknown>)[PROBE_KEY]).toBeUndefined();
  });

  it("asks a desktop for its GPU once and leaves the answer for capability.ts", () => {
    become(desktop);
    expect(runEarly()).toEqual({ story: true, preloads: firstAssets("high") });
    expect(contexts).toBe(1);
    expect(readCapabilityEnv("explorer")).toMatchObject({ webgl2: true, renderer: M3 });
    expect(contexts).toBe(1);
  });

  it("does not repeat a hint the document already carries", () => {
    become(phone);
    preloadFirstAssets("low");
    runEarly();
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.rel === "preload" && l.getAttribute("as") === "fetch" && l.crossOrigin === "anonymous")).toBe(true);
  });

  it("writes its hints the way preloadFirstAssets does", () => {
    become(phone);
    runEarly();
    const links = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link"));
    expect(links.map((l) => [l.rel, l.getAttribute("as"), l.crossOrigin])).toEqual(Array(3).fill(["preload", "fetch", "anonymous"]));
  });

  it("runs without a root element", () => {
    become(phone);
    expect(() => early(null)).not.toThrow();
    expect(document.head.querySelectorAll("link")).toHaveLength(3);
  });

  it("takes a context that throws as no WebGL2", () => {
    become(desktop);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(runEarly()).toEqual({ story: false, preloads: [] });
    expect((window as unknown as Record<string, unknown>)[PROBE_KEY]).toEqual({ webgl2: false });
  });

  // Every device the two decisions must agree on.
  const devices: Array<[string, Device]> = [
    ["a desktop with a strong GPU", desktop],
    ["a desktop whose browser masks the GPU", { ...desktop, gpu: "Apple GPU" }],
    ["an office laptop with Intel UHD graphics", { ...desktop, width: 1536, screen: [1536, 864], gpu: UHD }],
    ["a virtual machine on a software renderer", { ...desktop, gpu: SWIFT }],
    ["a desktop without WebGL2", { ...desktop, gpu: null }],
    ["a desktop with reduced motion", { ...desktop, reduced: true }],
    ["a desktop on Save-Data", { ...desktop, saveData: true }],
    ["a desktop on a link reported as 3g", { ...desktop, effectiveType: "3g" }],
    ["a desktop on a 2g link", { ...desktop, effectiveType: "2g" }],
    ["a desktop on 4g", { ...desktop, effectiveType: "4g", saveData: false }],
    ["a narrow window on a desktop", { ...desktop, width: 600 }],
    ["a laptop with 4 threads", { ...desktop, threads: 4 }],
    ["a laptop with 4 GB", { ...desktop, memory: 4 }],
    ["a machine with 2 threads", { ...desktop, threads: 2 }],
    ["a machine with 2 GB", { ...desktop, memory: 2 }],
    ["a browser that reports neither memory nor threads", { ...desktop, memory: undefined, threads: undefined }],
    ["a screen that reports no size", { ...desktop, screen: [0, 0] }],
    ["a phone upright", phone],
    ["a phone held sideways", { ...phone, width: 915, screen: [915, 412] }],
    ["a phone sideways whose pointer reads as fine", { ...phone, width: 915, screen: [915, 412], coarse: false }],
    ["a tablet", { ...phone, width: 1180, screen: [1180, 820] }],
    ["a phone with reduced motion", { ...phone, reduced: true }],
    ["a phone on a link reported as 3g", { ...phone, effectiveType: "3g" }],
    ["a phone on Save-Data", { ...phone, saveData: true }],
    ["a phone with 2 GB", { ...phone, memory: 2 }],
    ["a phone with 4 GB", { ...phone, memory: 4 }],
  ];

  it.each(devices)("decides as capability.ts does for %s", (_, device) => {
    become(device);
    const decided = runEarly();
    const env = readCapabilityEnv("explorer");
    const story = render3D(env) === "yes" && !env.reducedMotion;
    expect(decided.story).toBe(story);
    expect(decided.preloads).toEqual(story ? firstAssets(qualityTier({ ...env, width: window.innerWidth, dpr: 1 })) : []);
    // One context per page at most, whoever asked first.
    expect(contexts).toBeLessThanOrEqual(1);
  });

  it.each<[string, Device]>([
    ["no WebGL2", { ...phone, gpu: null }],
    ["a software renderer", { ...phone, gpu: SWIFT }],
  ])("is corrected by the page on a phone-class device with %s: it is not asked for a context early", (_, device) => {
    become(device);
    // The script expects the story; capability.ts, which does ask, says no, and the page shows the stills.
    expect(runEarly()).toEqual({ story: true, preloads: firstAssets("low") });
    expect(contexts).toBe(0);
    expect(render3D(readCapabilityEnv("explorer"))).toBe("no");
  });
});
