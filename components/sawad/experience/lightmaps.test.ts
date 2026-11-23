import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D, SRGBColorSpace, Texture, type WebGLProgramParametersWithUniforms } from "three";
import { describe, expect, it, vi } from "vitest";
import { assetUrl } from "../scene/assetUrl";
import { shippedPath } from "../../../scripts/blender/version-assets.mjs";
import {
  applyGroundLight,
  createGroundLight,
  groundPage,
  LIGHTMAP_BASE,
  loadLightmapManifest,
  loadLightmapTexture,
  patchGroundLight,
  setGroundBlend,
  setGroundPage,
  type LightmapManifest,
} from "./lightmaps";

const manifest = JSON.parse(readFileSync(shippedPath("/sawad/lightmaps/zaitun/lightmaps.json"), "utf8")) as LightmapManifest;

const fakeShader = () =>
  ({ uniforms: {}, vertexShader: "#include <common>\n#include <project_vertex>", fragmentShader: "#include <common>\n#include <lights_fragment_maps>" }) as unknown as WebGLProgramParametersWithUniforms;
const compile = (m: MeshStandardMaterial) => {
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  return shader;
};
const meshOf = (name: string) => new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name }));

describe("loadLightmapManifest", () => {
  it("fetches lightmaps.json and returns it", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => manifest }) as Response);
    await expect(loadLightmapManifest(fetcher as unknown as typeof fetch)).resolves.toBe(manifest);
    expect(fetcher).toHaveBeenCalledWith(assetUrl(`${LIGHTMAP_BASE}lightmaps.json`));
  });

  it("throws on a non-ok response", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    await expect(loadLightmapManifest(fetcher as unknown as typeof fetch)).rejects.toThrow("HTTP 404");
  });
});

describe("groundPage", () => {
  it("reads the real manifest for both tiers and states", () => {
    for (const tier of ["low", "high"] as const) {
      for (const state of ["day", "dusk"] as const) {
        const page = groundPage(manifest, tier, state);
        expect(page.url).toBe(assetUrl(`${LIGHTMAP_BASE}${state}-ground-${tier}.png`));
        // Only dusk blends the ground page in, so only the dusk PNGs ship (the masters live in scripts/blender/lightmaps/).
        if (state === "dusk") expect(existsSync(join(process.cwd(), "public", page.url)), page.url).toBe(true);
        expect(page.bounds).toEqual({ minX: -490, maxX: 490, minZ: -320, maxZ: 128 });
        expect(page.intensity).toBe(manifest.states[state].intensity);
      }
    }
    expect(groundPage(manifest, "high", "dusk").intensity).toBeGreaterThan(groundPage(manifest, "high", "day").intensity);
  });
});

describe("loadLightmapTexture", () => {
  it("loads sRGB and unflipped", async () => {
    const texture = new Texture() as Texture<HTMLImageElement>;
    const loadAsync = vi.fn(async () => texture);
    const out = await loadLightmapTexture("/x.png", { loadAsync });
    expect(loadAsync).toHaveBeenCalledWith("/x.png");
    expect(out).toBe(texture);
    expect(out.colorSpace).toBe(SRGBColorSpace);
    expect(out.flipY).toBe(false);
    expect(out.version).toBeGreaterThan(0);
  });
});

describe("ground light", () => {
  it("starts dark: strength 0 and a 1x1 black texel", () => {
    const light = createGroundLight();
    expect(light.uniforms.uGroundLmStrength.value).toBe(0);
    const image = light.uniforms.uGroundLm.value.image as { width: number; height: number; data: Uint8Array };
    expect([image.width, image.height]).toEqual([1, 1]);
    expect(Array.from(image.data)).toEqual([0, 0, 0, 255]);
  });

  it("maps a page's bounds to uv scale and keeps the strength", () => {
    const light = createGroundLight();
    const tex = new Texture();
    setGroundPage(light, tex, { bounds: { minX: -100, maxX: 100, minZ: -50, maxZ: 150 }, intensity: 4 });
    expect(light.uniforms.uGroundLm.value).toBe(tex);
    expect(light.uniforms.uGroundLmBounds.value.toArray()).toEqual([-100, -50, 1 / 200, 1 / 200]);
    expect(light.intensity).toBe(4);
    expect(light.uniforms.uGroundLmStrength.value).toBe(0);
  });

  it("blends by intensity and clamps the blend", () => {
    const light = createGroundLight();
    light.intensity = 4;
    setGroundBlend(light, 0.5);
    expect(light.uniforms.uGroundLmStrength.value).toBe(2);
    setGroundBlend(light, 3);
    expect(light.uniforms.uGroundLmStrength.value).toBe(4);
    setGroundBlend(light, -1);
    expect(light.uniforms.uGroundLmStrength.value).toBe(0);
  });

  it("disposes the empty texture and a loaded page", () => {
    const light = createGroundLight();
    const empty = light.uniforms.uGroundLm.value;
    const page = new Texture();
    const spyEmpty = vi.spyOn(empty, "dispose");
    const spyPage = vi.spyOn(page, "dispose");
    setGroundPage(light, page, { bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, intensity: 1 });
    light.dispose();
    expect(spyEmpty).toHaveBeenCalled();
    expect(spyPage).toHaveBeenCalled();
  });
});

describe("patchGroundLight", () => {
  it("injects the uniforms and the GLSL on compile", () => {
    const light = createGroundLight();
    const m = new MeshStandardMaterial();
    patchGroundLight(m, light);
    const shader = compile(m);
    expect(shader.uniforms.uGroundLm).toBe(light.uniforms.uGroundLm);
    expect(shader.uniforms.uGroundLmStrength).toBe(light.uniforms.uGroundLmStrength);
    expect(shader.vertexShader).toContain("vGroundLmUv = ");
    expect(shader.vertexShader.indexOf("uniform vec4 uGroundLmBounds")).toBeGreaterThan(shader.vertexShader.indexOf("#include <common>"));
    expect(shader.fragmentShader).toContain("irradiance += texture2D(uGroundLm");
    expect(shader.fragmentShader).toContain("mix(0.45, 1.0, groundLmUp)");
  });

  it("is idempotent", () => {
    const light = createGroundLight();
    const m = new MeshStandardMaterial();
    patchGroundLight(m, light);
    const hook = m.onBeforeCompile;
    patchGroundLight(m, light, 0.1);
    expect(m.onBeforeCompile).toBe(hook);
    expect(compile(m).fragmentShader).not.toContain("mix(0.10");
  });

  it("chains a pre-existing onBeforeCompile and changes the program cache key", () => {
    const m = new MeshStandardMaterial();
    const before = vi.fn();
    m.onBeforeCompile = before;
    const keyBefore = m.customProgramCacheKey();
    patchGroundLight(m, createGroundLight(), 0.2);
    compile(m);
    expect(before).toHaveBeenCalledTimes(1);
    expect(m.customProgramCacheKey()).not.toBe(keyBefore);
    expect(m.customProgramCacheKey()).toContain("ground-light:0.2");
  });
});

describe("applyGroundLight", () => {
  it("patches every terrain material and only the atlas materials of the model", () => {
    const light = createGroundLight();
    const terrain = new Object3D().add(meshOf("grass"), meshOf("rock"));
    const model = new Object3D().add(meshOf("site-atlas"), meshOf("garden-atlas"), meshOf("glass"), meshOf("villa-atlas"));
    expect(applyGroundLight(light, terrain, model)).toBe(4);
    const patched = (o: Object3D) => o.children.map((c) => Boolean(((c as Mesh).material as MeshStandardMaterial).userData.groundLight));
    expect(patched(terrain)).toEqual([true, true]);
    expect(patched(model)).toEqual([true, true, false, false]);
  });

  it("leaves surfaces lit by the model's own baked site page alone", () => {
    const light = createGroundLight();
    const baked = meshOf("site-atlas");
    ((baked.material as MeshStandardMaterial).userData.baked = "site");
    const model = new Object3D().add(baked, meshOf("garden-atlas"));
    expect(applyGroundLight(light, null, model)).toBe(1);
    expect((baked.material as MeshStandardMaterial).userData.groundLight).toBeUndefined();
  });

  it("does not count a material twice and copes with null roots", () => {
    const light = createGroundLight();
    const shared = new MeshStandardMaterial({ name: "site-atlas" });
    const model = new Object3D().add(new Mesh(new BoxGeometry(), shared), new Mesh(new BoxGeometry(), shared));
    expect(applyGroundLight(light, null, model)).toBe(1);
    expect(applyGroundLight(light, null, model)).toBe(0);
    expect(applyGroundLight(light, null, null)).toBe(0);
  });
});
