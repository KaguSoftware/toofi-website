import { describe, expect, it } from "vitest";
import { VARIANTS, isSoftwareRenderer, probeInPage } from "./software-gl.mjs";

describe("isSoftwareRenderer", () => {
  it("recognises the software rasterizers browsers fall back to", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
  });

  it("leaves real GPUs alone, and a missing string", () => {
    expect(isSoftwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)")).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
  });
});

describe("probeInPage", () => {
  it("reports no context, without throwing, where the browser gives none", () => {
    const canvas = { getContext: () => null };
    const doc = globalThis as unknown as { document?: unknown; navigator?: unknown };
    const saved = { document: doc.document, navigator: doc.navigator };
    doc.document = { createElement: () => canvas };
    Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 4 }, configurable: true });
    try {
      expect(probeInPage()).toMatchObject({ plain: { context: false }, strict: { context: false }, concurrency: 4, memory: null });
    } finally {
      doc.document = saved.document;
      Object.defineProperty(globalThis, "navigator", { value: saved.navigator, configurable: true });
    }
  });

  it("covers a GPU and a software variant", () => {
    expect(VARIANTS.map((v: { name: string }) => v.name)).toEqual(["GPU", "software (SwiftShader)"]);
  });
});
