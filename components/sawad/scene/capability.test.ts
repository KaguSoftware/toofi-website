// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROBE_KEY, canRender3D, isSoftwareRenderer, isWeakGpu, playsReel, probeGpu, qualityTier, readCapabilityEnv, render3D, resetWebGL2Probe, type CapabilityEnv } from "./capability";

const ok: CapabilityEnv = { webgl2: true, reducedMotion: false, mode: "explorer", deviceMemory: 8, hardwareConcurrency: 8 };

afterEach(() => {
  resetWebGL2Probe();
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("playsReel", () => {
  it("plays the story as video wherever it was not declined, GPU or not", () => {
    expect(playsReel(ok)).toBe(true);
    // No WebGL2, little memory, few threads and a "3g" report still play video.
    expect(playsReel({ ...ok, webgl2: false, deviceMemory: 1, hardwareConcurrency: 2, effectiveType: "3g" } as CapabilityEnv)).toBe(true);
    expect(playsReel({ reducedMotion: false })).toBe(true);
  });

  it.each<[string, Partial<CapabilityEnv>]>([
    ["Save-Data", { saveData: true }],
    ["a 2g link", { effectiveType: "2g" }],
    ["a slow 2g link", { effectiveType: "slow-2g" }],
    ["reduced motion", { reducedMotion: true }],
  ])("keeps the stills with %s", (_, patch) => {
    expect(playsReel({ ...ok, ...patch })).toBe(false);
  });
});

describe("canRender3D", () => {
  it("allows a capable device", () => {
    expect(canRender3D(ok)).toBe(true);
  });

  it.each<[string, Partial<CapabilityEnv>]>([
    ["no WebGL2", { webgl2: false }],
    ["Save-Data", { saveData: true }],
    ["3G", { effectiveType: "3g" }],
    ["2G", { effectiveType: "2g" }],
    ["little memory", { deviceMemory: 2 }],
    ["few cores", { hardwareConcurrency: 2 }],
  ])("rejects %s", (_, patch) => {
    expect(canRender3D({ ...ok, ...patch })).toBe(false);
  });

  it("rejects the film under reduced motion but keeps the explorer", () => {
    expect(canRender3D({ ...ok, reducedMotion: true, mode: "film" })).toBe(false);
    expect(canRender3D({ ...ok, reducedMotion: true, mode: "explorer" })).toBe(true);
  });

  it("treats unknown memory and cores as fine", () => {
    expect(canRender3D({ webgl2: true, reducedMotion: false, mode: "film" })).toBe(true);
  });
});

describe("render3D", () => {
  it("starts by itself on a capable device", () => {
    expect(render3D(ok)).toBe("yes");
  });

  it.each<[string, Partial<CapabilityEnv>]>([
    ["no WebGL2", { webgl2: false }],
    ["a software renderer", { renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)" }],
    ["Save-Data", { saveData: true }],
    ["a 2g link", { effectiveType: "2g" }],
    ["a slow 2g link", { effectiveType: "slow-2g" }],
  ])("refuses %s outright", (_, patch) => {
    expect(render3D({ ...ok, ...patch })).toBe("no");
  });

  it.each<[string, Partial<CapabilityEnv>]>([
    ["a link reported as 3g", { effectiveType: "3g" }],
    ["little memory", { deviceMemory: 2 }],
    ["few threads", { hardwareConcurrency: 2 }],
  ])("offers the 3D on %s instead of starting it", (_, patch) => {
    expect(render3D({ ...ok, ...patch })).toBe("offer");
  });

  it("lets a refusal win over an offer", () => {
    expect(render3D({ ...ok, effectiveType: "3g", saveData: true })).toBe("no");
    expect(render3D({ ...ok, deviceMemory: 2, webgl2: false })).toBe("no");
  });

  it("takes a real GPU's name, and no name at all, as fine", () => {
    expect(render3D({ ...ok, renderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)" })).toBe("yes");
    expect(render3D({ ...ok, renderer: undefined })).toBe("yes");
  });
});

describe("renderer names", () => {
  it.each([
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)",
    "llvmpipe (LLVM 15.0.7, 256 bits)",
    "softpipe",
    "Microsoft Basic Render Driver",
    "Apple Software Renderer",
  ])("knows %s as a software renderer", (name) => {
    expect(isSoftwareRenderer(name)).toBe(true);
  });

  it.each([
    "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
    "Mali-G78",
    "Adreno (TM) 650",
    "PowerVR Rogue GE8320",
  ])("knows %s as a weak GPU", (name) => {
    expect(isWeakGpu(name)).toBe(true);
    expect(isSoftwareRenderer(name)).toBe(false);
  });

  it.each([
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Apple GPU",
  ])("leaves %s alone", (name) => {
    expect(isWeakGpu(name)).toBe(false);
    expect(isSoftwareRenderer(name)).toBe(false);
  });

  it("takes a missing name as neither", () => {
    expect(isWeakGpu(undefined)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
  });
});

describe("qualityTier", () => {
  it("is low on a phone held sideways: the screen's short side decides, not the window's width", () => {
    // A Pixel 7 in landscape: 915 px wide, 8 GB, 8 threads.
    expect(qualityTier({ ...ok, width: 915, dpr: 2.6, shortSide: 412 })).toBe("low");
    expect(qualityTier({ ...ok, width: 1440, dpr: 2, shortSide: 900 })).toBe("high");
  });
  it("is low where the main pointer is a finger (phones and tablets)", () => {
    expect(qualityTier({ ...ok, width: 1180, dpr: 2, shortSide: 820, coarsePointer: true })).toBe("low");
    expect(qualityTier({ ...ok, width: 1180, dpr: 2, shortSide: 820, coarsePointer: false })).toBe("high");
  });
  it("is low on a weak GPU whatever the memory and threads say", () => {
    expect(qualityTier({ ...ok, width: 1536, dpr: 1.25, renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)" })).toBe("low");
    expect(qualityTier({ ...ok, width: 1536, dpr: 1.25, renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" })).toBe("high");
  });
  it("is high on a big, strong machine", () => {
    expect(qualityTier({ ...ok, width: 1440, dpr: 2 })).toBe("high");
  });
  it("is low on phones and modest hardware", () => {
    expect(qualityTier({ ...ok, width: 390, dpr: 3 })).toBe("low");
    expect(qualityTier({ ...ok, width: 1440, dpr: 1, deviceMemory: 4 })).toBe("low");
    expect(qualityTier({ ...ok, width: 1440, dpr: 1, hardwareConcurrency: 4 })).toBe("low");
  });
});

describe("readCapabilityEnv", () => {
  it("reads reduced motion and the WebGL2 probe from the browser", () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as RenderingContext);
    const env = readCapabilityEnv("film");
    expect(env).toMatchObject({ webgl2: true, reducedMotion: true, mode: "film" });
  });

  it("makes the WebGL2 probe once, however often the environment is read, and releases it", () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension } as unknown as RenderingContext);
    expect(readCapabilityEnv("explorer").webgl2).toBe(true);
    expect(readCapabilityEnv("explorer").webgl2).toBe(true);
    expect(readCapabilityEnv("film").webgl2).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("remembers a failed probe too, and treats a throwing context as no WebGL2", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readCapabilityEnv("explorer").webgl2).toBe(false);
    expect(readCapabilityEnv("explorer").webgl2).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("reports no WebGL2 when the context is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(readCapabilityEnv("explorer").webgl2).toBe(false);
  });

  it("reads the GPU's name with the probe, from the debug extension where there is one", () => {
    const getExtension = vi.fn((name: string) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null));
    const getParameter = vi.fn((id: number) => (id === 0x9246 ? "Mali-G78" : "masked"));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension, getParameter, RENDERER: 0x1f01 } as unknown as RenderingContext);
    expect(readCapabilityEnv("explorer")).toMatchObject({ webgl2: true, renderer: "Mali-G78" });
  });

  it("falls back to the plain renderer name without the extension, and to none when the browser gives nothing", () => {
    const getParameter = vi.fn((id: number) => (id === 0x1f01 ? "Intel(R) HD Graphics 400, or similar" : null));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ getExtension: () => null, getParameter, RENDERER: 0x1f01 } as unknown as RenderingContext);
    expect(probeGpu()).toEqual({ webgl2: true, renderer: "Intel(R) HD Graphics 400, or similar" });
    resetWebGL2Probe();
    getContext.mockReturnValue({ getExtension: () => null, getParameter: () => "" } as unknown as RenderingContext);
    expect(probeGpu()).toEqual({ webgl2: true, renderer: undefined });
  });

  it("takes the early script's probe instead of making a second context", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext");
    (window as unknown as Record<string, unknown>)[PROBE_KEY] = { webgl2: true, renderer: "Adreno (TM) 650" };
    expect(readCapabilityEnv("explorer")).toMatchObject({ webgl2: true, renderer: "Adreno (TM) 650" });
    expect(getContext).not.toHaveBeenCalled();
    resetWebGL2Probe();
    (window as unknown as Record<string, unknown>)[PROBE_KEY] = { webgl2: "yes" };
    getContext.mockReturnValue(null);
    expect(readCapabilityEnv("explorer").webgl2).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("reads the screen's short side and the pointer", () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes("coarse") }) as MediaQueryList) as typeof window.matchMedia;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(window.screen, "width", "get").mockReturnValue(915);
    vi.spyOn(window.screen, "height", "get").mockReturnValue(412);
    expect(readCapabilityEnv("explorer")).toMatchObject({ shortSide: 412, coarsePointer: true, reducedMotion: false });
  });

  it("leaves the short side unknown when the screen reports no size", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.spyOn(window.screen, "width", "get").mockReturnValue(0);
    vi.spyOn(window.screen, "height", "get").mockReturnValue(0);
    const env = readCapabilityEnv("explorer");
    expect(env.shortSide).toBeUndefined();
    expect(env.coarsePointer).toBe(false);
  });
});
