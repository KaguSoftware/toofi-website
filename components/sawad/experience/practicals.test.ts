import { BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Texture, type WebGLProgramParametersWithUniforms } from "three";
import { describe, expect, it, vi } from "vitest";
import { findPracticals, LAMP_MATERIAL, LIT_WINDOWS, patchWindowRooms, WINDOW_MATERIAL } from "./practicals";

const std = (name: string, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) => new MeshStandardMaterial({ name, metalness: 0, roughness: 0.8, ...extra });
const mesh = (m: MeshStandardMaterial | MeshStandardMaterial[]) => new Mesh(new BoxGeometry(), m);
const modelOf = (...meshes: Mesh[]) => new Object3D().add(...meshes);

const compile = (m: MeshStandardMaterial) => {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: "#include <common>\n#include <emissivemap_fragment>",
  } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, null as never);
  return shader;
};

describe("findPracticals", () => {
  it("returns empty lists for no model", () => {
    expect(findPracticals(null)).toEqual({ windows: [], lamps: [], mirrors: [] });
  });

  it("classifies by material name", () => {
    const glass = std(WINDOW_MATERIAL);
    const lamp = std(LAMP_MATERIAL);
    const wall = std("plaster");
    const found = findPracticals(modelOf(mesh(glass), mesh(lamp), mesh(wall)));
    expect(found.windows).toEqual([glass]);
    expect(found.lamps).toEqual([lamp]);
    expect(found.mirrors).toEqual([]);
  });

  it("finds mirrors by metalness or low roughness, unless a map drives them", () => {
    const metal = std("steel", { metalness: 0.9 });
    const polished = std("lacquer", { roughness: 0.05 });
    const mappedMetal = std("worn", { metalness: 1, metalnessMap: new Texture() });
    const mappedRough = std("scuffed", { roughness: 0, roughnessMap: new Texture() });
    const found = findPracticals(modelOf(mesh(metal), mesh(polished), mesh(mappedMetal), mesh(mappedRough)));
    expect(found.mirrors).toEqual([metal, polished]);
  });

  it("dedupes shared materials and walks material arrays, skipping non-standard ones", () => {
    const glass = std(WINDOW_MATERIAL);
    const basic = new MeshBasicMaterial({ name: WINDOW_MATERIAL }) as unknown as MeshStandardMaterial;
    const found = findPracticals(modelOf(mesh(glass), mesh([glass, basic])));
    expect(found.windows).toEqual([glass]);
  });

  it("counts a glass mirror as both window and mirror", () => {
    const glass = std(WINDOW_MATERIAL, { roughness: 0.05 });
    const found = findPracticals(modelOf(mesh(glass)));
    expect(found.windows).toEqual([glass]);
    expect(found.mirrors).toEqual([glass]);
  });

  it("patches windows (and only windows) to glow room by room", () => {
    const glass = std(WINDOW_MATERIAL);
    const lamp = std(LAMP_MATERIAL);
    findPracticals(modelOf(mesh(glass), mesh(lamp)));
    expect(glass.userData.windowRooms).toBe(true);
    expect(lamp.userData.windowRooms).toBeUndefined();
  });
});

describe("patchWindowRooms", () => {
  it("injects the room hash after the emissive map", () => {
    const m = std(WINDOW_MATERIAL);
    patchWindowRooms(m);
    const shader = compile(m);
    expect(shader.vertexShader).toContain("vWindowWorld = ");
    expect(shader.fragmentShader.indexOf("totalEmissiveRadiance *=")).toBeGreaterThan(shader.fragmentShader.indexOf("#include <emissivemap_fragment>"));
    expect(shader.fragmentShader).toContain(`step(${(1 - LIT_WINDOWS).toFixed(2)}, windowHash(room))`);
  });

  it("is idempotent, chains an earlier hook and changes the cache key", () => {
    const m = std(WINDOW_MATERIAL);
    const before = vi.fn();
    m.onBeforeCompile = before;
    const key = m.customProgramCacheKey();
    patchWindowRooms(m);
    const hook = m.onBeforeCompile;
    patchWindowRooms(m);
    expect(m.onBeforeCompile).toBe(hook);
    compile(m);
    expect(before).toHaveBeenCalledTimes(1);
    expect(m.customProgramCacheKey()).not.toBe(key);
    expect(m.customProgramCacheKey().endsWith("|window-rooms")).toBe(true);
  });
});
