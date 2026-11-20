import { AdditiveBlending, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { PLAN_SITE } from "../scene/layout";
import { siteFor } from "../scene/site";
import { buildGodRays, SHAFT_STRENGTH, setShaftStrength, shaftAnchors, type Shaft } from "./godrays";

const shafts: Shaft[] = [
  { through: [0, 6, 0], length: 60, width: 3 },
  { through: [10, 6, 5], length: 40, width: 2 },
  { through: [20, 6, 9], length: 50, width: 4 },
];
const sun = new Vector3(2, 1, 0);

describe("shaftAnchors", () => {
  const anchors = shaftAnchors();

  it("has shafts, each standing inside the site and above the ground", () => {
    const site = siteFor("zaitun");
    expect(anchors.length).toBeGreaterThan(20);
    for (const a of anchors) {
      const [x, y, z] = a.through;
      expect(x).toBeGreaterThan(PLAN_SITE.minX);
      expect(x).toBeLessThan(PLAN_SITE.maxX);
      expect(z).toBeGreaterThan(PLAN_SITE.minZ);
      expect(z).toBeLessThan(PLAN_SITE.maxZ);
      expect(y).toBeGreaterThan(site.ground(x, z));
      expect(a.length).toBeGreaterThan(a.width);
    }
  });
});

describe("buildGodRays", () => {
  it("builds one quad per shaft: 4 vertices and 2 triangles", () => {
    const { mesh } = buildGodRays(sun, 0.002, shafts);
    expect(mesh.geometry.getAttribute("position").count).toBe(12);
    expect(mesh.geometry.getIndex()!.count).toBe(18);
    expect(Math.max(...Array.from(mesh.geometry.getIndex()!.array))).toBe(11);
  });

  it("stores each shaft's size on its four vertices", () => {
    const { mesh } = buildGodRays(sun, 0.002, shafts);
    const size = mesh.geometry.getAttribute("aSize");
    for (let v = 4; v < 8; v++) expect([size.getX(v), size.getY(v)]).toEqual([20, 1]);
    const through = mesh.geometry.getAttribute("aThrough");
    expect([through.getX(9), through.getY(9), through.getZ(9)]).toEqual([20, 6, 9]);
  });

  it("is additive, writes no depth and is never frustum culled", () => {
    const { mesh, material } = buildGodRays(sun, 0.002, shafts);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(mesh.frustumCulled).toBe(false);
  });

  it("normalises a copy of the sun direction and carries the fog density", () => {
    const { material } = buildGodRays(sun, 0.004, shafts);
    expect(material.uniforms.uSunDir.value.length()).toBeCloseTo(1, 9);
    expect(material.uniforms.uSunDir.value).not.toBe(sun);
    expect(sun.length()).toBeGreaterThan(2);
    expect(material.uniforms.uFogDensity.value).toBe(0.004);
    expect(material.uniforms.uStrength.value).toBe(SHAFT_STRENGTH);
  });

  it("builds the default shafts from the plan", () => {
    const { mesh } = buildGodRays(sun, 0.002);
    expect(mesh.geometry.getAttribute("position").count).toBe(shaftAnchors().length * 4);
  });

  it("frees geometry and material on dispose", () => {
    const rays = buildGodRays(sun, 0.002, shafts);
    const g = vi.spyOn(rays.mesh.geometry, "dispose");
    const m = vi.spyOn(rays.material, "dispose");
    rays.dispose();
    expect(g).toHaveBeenCalledTimes(1);
    expect(m).toHaveBeenCalledTimes(1);
  });
});

describe("setShaftStrength", () => {
  it("scales the strength with the daylight left", () => {
    const rays = buildGodRays(sun, 0.002, shafts);
    setShaftStrength(rays, 0.5);
    expect(rays.material.uniforms.uStrength.value).toBeCloseTo(SHAFT_STRENGTH / 2, 9);
    expect(rays.mesh.visible).toBe(true);
    setShaftStrength(rays, 5);
    expect(rays.material.uniforms.uStrength.value).toBe(SHAFT_STRENGTH);
  });

  it("hides the shafts at dusk", () => {
    const rays = buildGodRays(sun, 0.002, shafts);
    setShaftStrength(rays, 0);
    expect(rays.material.uniforms.uStrength.value).toBe(0);
    expect(rays.mesh.visible).toBe(false);
    setShaftStrength(rays, 1);
    expect(rays.mesh.visible).toBe(true);
  });
});
