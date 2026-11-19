// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canRender3D, qualityTier, readCapabilityEnv, type CapabilityEnv } from "./capability";

const ok: CapabilityEnv = { webgl2: true, reducedMotion: false, mode: "explorer", deviceMemory: 8, hardwareConcurrency: 8 };

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
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

describe("qualityTier", () => {
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

  it("reports no WebGL2 when the context is unavailable", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(readCapabilityEnv("explorer").webgl2).toBe(false);
  });
});
