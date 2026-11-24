// @vitest-environment jsdom
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROBE_KEY, playsReel, readCapabilityEnv, render3D, resetWebGL2Probe } from "../scene/capability";
import { BASIS_TRANSCODER_PATH, PLAN_FAR_MODEL_URL } from "../scene/compoundModel";
import { DECODER_URLS, EARLY_ATTR, EARLY_FUNCTION, FIRST_MODEL_URL, LIVE_DOWNLOAD_MB, OPENING_VIDEO_SELECTOR, earlyScript, firstAssets, preloadFirstAssets } from "./early";
import { REEL_CODECS, REEL_TYPE, reelShape, reelSources } from "./reel";
import StoryReel from "./StoryReel";

type Device = {
  width: number;
  /** The window's height: taller than wide gets the tall file. */
  height: number;
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

const desktop: Device = { width: 1440, height: 900, screen: [1440, 900], memory: 8, threads: 8, gpu: M3 };
const phone: Device = { width: 412, height: 915, screen: [412, 915], coarse: true, memory: 8, threads: 8, gpu: "Adreno (TM) 730" };
const sideways = { width: 915, height: 412, screen: [915, 412] as [number, number] };

const define = (target: object, key: string, value: unknown) => Object.defineProperty(target, key, { value, configurable: true, writable: true });
let contexts = 0;

function become(d: Device): void {
  define(window, "innerWidth", d.width);
  define(window, "innerHeight", d.height);
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

/** The opening's two files, as the page hands them to the script. */
const FILES = { wide: "/reel/opening-wide.mp4", tall: "/reel/opening-tall.mp4" };
const AV1 = { wide: "/reel/opening-wide-av1.mp4", tall: "/reel/opening-tall-av1.mp4" };
/** As `earlyScript` hands them over: [type, address] pairs, best codec first (jsdom plays none but the last, which is not asked about). */
const PAIRS = { wide: [[REEL_TYPE.av1, AV1.wide], ["", FILES.wide]], tall: [[REEL_TYPE.av1, AV1.tall], ["", FILES.tall]] };

const early = new Function("root", "files", `return (${EARLY_FUNCTION})(root,files)`) as (root: Element | null, files: typeof PAIRS) => void;

let play: ReturnType<typeof vi.fn>;

/** The experience as the server writes it, as far as the script looks: a root with the reel's two videos. */
function page(): { root: HTMLElement; opening: HTMLVideoElement; tour: HTMLVideoElement } {
  const root = document.createElement("section");
  root.className = "xp";
  root.innerHTML = '<div class="xp__stage"><div class="xp__reel"><video data-reel="opening" preload="none"></video><video data-reel="tour" preload="none"></video></div></div>';
  document.body.appendChild(root);
  return { root, opening: root.querySelector<HTMLVideoElement>('video[data-reel="opening"]')!, tour: root.querySelector<HTMLVideoElement>('video[data-reel="tour"]')! };
}

/** Runs the early script the way the page does and says what it decided. */
function runEarly(): { story: boolean; file: string | null; played: number; preloads: string[]; opening: HTMLVideoElement; tour: HTMLVideoElement } {
  const { root, opening, tour } = page();
  early(root, PAIRS);
  const preloads = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]'), (l) => l.getAttribute("href")!);
  return { story: root.getAttribute(EARLY_ATTR) === "story", file: opening.getAttribute("src"), played: play.mock.calls.length, preloads, opening, tour };
}

beforeEach(() => {
  contexts = 0;
  // jsdom plays nothing; the script only has to ask.
  play = vi.fn(() => Promise.resolve());
  define(HTMLMediaElement.prototype, "play", play);
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
  it("is safe to put inside a script tag, for every start view", () => {
    for (const view of ["flight", "street", "terrace", "aerial"] as const) {
      const script = earlyScript(view);
      expect(script).not.toMatch(/<\/script|<!--/i);
      expect(script).toContain("document.currentScript");
      expect(script).toContain('closest(".xp")');
      // The view's own opening, in both shapes, at the addresses the page fetches from.
      for (const shape of ["wide", "tall"] as const) expect(script).toContain(JSON.stringify(REEL_CODECS.map((c) => [REEL_TYPE[c], reelSources(view, shape, c).opening])));
      expect(() => new Function(script)).not.toThrow();
    }
    expect(earlyScript("street")).not.toBe(earlyScript("flight"));
  });

  it("finds its experience from where it sits and starts that view's opening", () => {
    become(desktop);
    const { root, opening } = page();
    // The script tag sits after the reel's elements, inside the experience.
    const tag = document.createElement("script");
    root.querySelector(".xp__stage")!.appendChild(tag);
    define(document, "currentScript", tag);
    try {
      new Function(earlyScript("terrace"))();
    } finally {
      define(document, "currentScript", null);
    }
    expect(root.getAttribute(EARLY_ATTR)).toBe("story");
    expect(opening.getAttribute("src")).toBe(reelSources("terrace", "wide").opening);
    expect(play).toHaveBeenCalledOnce();
  });

  it("does nothing, and does not throw, where no script tag is running", () => {
    become(desktop);
    const { root, opening } = page();
    expect(() => new Function(earlyScript("flight"))()).not.toThrow();
    expect(root.getAttribute(EARLY_ATTR)).toBeNull();
    expect(opening.getAttribute("src")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("looks for the element the reel really renders", () => {
    const holder = document.createElement("div");
    holder.innerHTML = renderToString(createElement(StoryReel, { view: "flight", playing: true, scroll: { current: { progress: 0 } }, rig: { current: null as never } }));
    const video = holder.querySelector(OPENING_VIDEO_SELECTOR);
    expect(video?.tagName).toBe("VIDEO");
    // The server names no file: only the script, or the page's code, knows who plays it.
    expect(video?.getAttribute("src")).toBeNull();
    expect(holder.querySelectorAll("video")).toHaveLength(2);
  });

  it("marks the story and starts the wide opening on a desktop: muted, inline, and asked to play", () => {
    become(desktop);
    const { story, file, played, opening, tour } = runEarly();
    expect(story).toBe(true);
    expect(file).toBe(FILES.wide);
    expect(played).toBe(1);
    // Muted and inline is what lets a browser play it unasked; React writes neither into the markup.
    expect(opening.muted).toBe(true);
    expect(opening.defaultMuted).toBe(true);
    expect(opening.hasAttribute("playsinline")).toBe(true);
    expect(opening.preload).toBe("auto");
    // The tour waits for the page's code.
    expect(tour.getAttribute("src")).toBeNull();
    expect(tour.preload).toBe("none");
  });

  it("gives a browser that is sure it plays AV1 the AV1 file, and one that says maybe the H.264 one", () => {
    const answer = vi.spyOn(HTMLMediaElement.prototype, "canPlayType");
    answer.mockImplementation((type) => (type === REEL_TYPE.av1 ? "probably" : ""));
    become(desktop);
    expect(runEarly().file).toBe(AV1.wide);
    answer.mockImplementation(() => "maybe");
    expect(runEarly().file).toBe(FILES.wide);
    answer.mockRestore();
  });

  it("gives a phone held upright the tall opening, and the wide one held sideways", () => {
    become(phone);
    expect(runEarly().file).toBe(FILES.tall);
    become({ ...phone, ...sideways });
    expect(runEarly().file).toBe(FILES.wide);
  });

  it("asks for no WebGL context and no model: the 3D waits for a visitor who wants to explore", () => {
    for (const device of [phone, desktop]) {
      become(device);
      const { story, preloads } = runEarly();
      expect(story).toBe(true);
      expect(preloads).toEqual([]);
    }
    expect(contexts).toBe(0);
    expect((window as unknown as Record<string, unknown>)[PROBE_KEY]).toBeUndefined();
    expect(document.head.querySelectorAll("link")).toHaveLength(0);
  });

  it("runs without a root element", () => {
    become(phone);
    expect(() => early(null, PAIRS)).not.toThrow();
    expect(play).not.toHaveBeenCalled();
  });

  it("marks the story even where the reel's element is missing, so the stills are still held back", () => {
    become(phone);
    const root = document.createElement("section");
    document.body.appendChild(root);
    expect(() => early(root, PAIRS)).not.toThrow();
    expect(root.getAttribute(EARLY_ATTR)).toBe("story");
    expect(play).not.toHaveBeenCalled();
  });

  it("keeps quiet when the browser will not play unasked", async () => {
    become(phone);
    const refused = Promise.reject(Object.assign(new Error("not allowed"), { name: "NotAllowedError" }));
    play.mockReturnValueOnce(refused);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { story, file } = runEarly();
      // The poster stays; StoryReel starts the video at the visitor's first touch.
      expect(story).toBe(true);
      expect(file).toBe(FILES.tall);
      await refused.catch(() => {});
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("survives a browser whose play throws or returns nothing", () => {
    become(desktop);
    play.mockImplementationOnce(() => {
      throw new Error("not supported");
    });
    expect(() => runEarly()).not.toThrow();
    play.mockReturnValueOnce(undefined);
    expect(() => runEarly()).not.toThrow();
  });

  // Every device the two decisions must agree on.
  const devices: Array<[string, Device]> = [
    ["a desktop with a strong GPU", desktop],
    ["a desktop whose browser masks the GPU", { ...desktop, gpu: "Apple GPU" }],
    ["an office laptop with Intel UHD graphics", { ...desktop, width: 1536, height: 864, screen: [1536, 864], gpu: UHD }],
    ["a virtual machine on a software renderer", { ...desktop, gpu: SWIFT }],
    ["a desktop without WebGL2", { ...desktop, gpu: null }],
    ["a desktop with reduced motion", { ...desktop, reduced: true }],
    ["a desktop on Save-Data", { ...desktop, saveData: true }],
    ["a desktop on a link reported as 3g", { ...desktop, effectiveType: "3g" }],
    ["a desktop on a 2g link", { ...desktop, effectiveType: "2g" }],
    ["a desktop on a slow 2g link", { ...desktop, effectiveType: "slow-2g" }],
    ["a desktop on 4g", { ...desktop, effectiveType: "4g", saveData: false }],
    ["a narrow window on a desktop", { ...desktop, width: 600 }],
    ["a laptop with 4 threads", { ...desktop, threads: 4 }],
    ["a laptop with 4 GB", { ...desktop, memory: 4 }],
    ["a machine with 2 threads", { ...desktop, threads: 2 }],
    ["a machine with 2 GB", { ...desktop, memory: 2 }],
    ["a browser that reports neither memory nor threads", { ...desktop, memory: undefined, threads: undefined }],
    ["a screen that reports no size", { ...desktop, screen: [0, 0] }],
    ["a square window", { ...desktop, width: 900, height: 900 }],
    ["a phone upright", phone],
    ["a phone held sideways", { ...phone, ...sideways }],
    ["a phone sideways whose pointer reads as fine", { ...phone, ...sideways, coarse: false }],
    ["a tablet", { ...phone, width: 1180, height: 820, screen: [1180, 820] }],
    ["a tablet upright", { ...phone, width: 820, height: 1180, screen: [820, 1180] }],
    ["a phone with reduced motion", { ...phone, reduced: true }],
    ["a phone on a link reported as 3g", { ...phone, effectiveType: "3g" }],
    ["a phone on a 2g link", { ...phone, effectiveType: "2g" }],
    ["a phone on Save-Data", { ...phone, saveData: true }],
    ["a phone with 2 GB", { ...phone, memory: 2 }],
    ["a phone with 4 GB", { ...phone, memory: 4 }],
    ["a phone without WebGL2", { ...phone, gpu: null }],
  ];

  it.each(devices)("decides as capability.ts and reel.ts do for %s", (_, device) => {
    become(device);
    const decided = runEarly();
    // The script itself never asks the GPU, whatever the device.
    expect(contexts).toBe(0);
    const reel = playsReel(readCapabilityEnv("explorer"));
    expect(decided.story).toBe(reel);
    expect(decided.file).toBe(reel ? FILES[reelShape(window.innerWidth, window.innerHeight)] : null);
    expect(decided.played).toBe(reel ? 1 : 0);
    expect(decided.preloads).toEqual([]);
    // The page asks once, when it wants to know whether to offer the explorer.
    expect(contexts).toBeLessThanOrEqual(1);
  });

  it.each<[string, Device]>([
    ["no WebGL2", { ...desktop, gpu: null }],
    ["a software renderer", { ...desktop, gpu: SWIFT }],
    ["little memory", { ...phone, memory: 2 }],
  ])("plays the reel on a device with %s, which the live scene refused or held back", (_, device) => {
    become(device);
    expect(runEarly()).toMatchObject({ story: true, played: 1 });
    // The 3D is another matter: capability.ts decides it when the page's code runs.
    expect(render3D(readCapabilityEnv("explorer"))).not.toBe("yes");
  });
});
