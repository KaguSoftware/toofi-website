import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { setErrorSink, type ErrorReport } from "@/lib/monitoring";
import {
  LOD_DISTANCES,
  MATERIAL_KINDS,
  applyWind,
  applyWindToScene,
  bakeNodeTransforms,
  createWind,
  flapWeights,
  lodFor,
  type FoliageKind,
} from "./wind";

function compile(material: MeshStandardMaterial) {
  const shader = {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: {},
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

afterEach(() => setErrorSink(null));

describe("createWind", () => {
  it("defaults to a gentle breeze from the slopes toward the stream (+z)", () => {
    const wind = createWind();
    expect(wind.uniforms.uWindDir.value.x).toBeCloseTo(0);
    expect(wind.uniforms.uWindDir.value.y).toBeCloseTo(1);
    expect(wind.uniforms.uWindStrength.value).toBeGreaterThan(0);
    expect(wind.uniforms.uWindStrength.value).toBeLessThan(0.5);
  });

  it("advances time and turns the wind", () => {
    const wind = createWind({ strength: 0.3 });
    wind.update(12.5);
    expect(wind.uniforms.uWindTime.value).toBe(12.5);
    wind.setDirection(0);
    expect(wind.uniforms.uWindDir.value.x).toBeCloseTo(1);
    expect(wind.uniforms.uWindDir.value.y).toBeCloseTo(0);
    expect(wind.uniforms.uWindStrength.value).toBe(0.3);
  });
});

describe("applyWind", () => {
  it("adds the wind attribute, shares the uniforms and replaces the projection", () => {
    const wind = createWind();
    const m = new MeshStandardMaterial();
    applyWind(m, wind, "palm");
    const shader = compile(m);
    expect(shader.vertexShader).toContain("attribute vec4 _wind;");
    expect(shader.vertexShader).toContain("sawadWind(");
    expect(shader.vertexShader).not.toContain("#include <project_vertex>");
    expect(shader.vertexShader).toContain("gl_Position = projectionMatrix * mvPosition;");
    // The same uniform objects, so one update moves every patched material.
    expect(shader.uniforms.uWindTime).toBe(wind.uniforms.uWindTime);
    wind.update(3);
    expect(shader.uniforms.uWindTime.value).toBe(3);
  });

  it("keeps foliage normals unflipped but leaves bark alone", () => {
    const wind = createWind();
    const leaf = new MeshStandardMaterial();
    applyWind(leaf, wind, "citrus");
    expect(compile(leaf).fragmentShader).not.toContain("normal *= faceDirection;");
    const bark = new MeshStandardMaterial();
    applyWind(bark, wind, "bark");
    expect(compile(bark).fragmentShader).toContain("#include <normal_fragment_begin>");
  });

  it("keeps leaf alpha coverage at distance on foliage, not on bark", () => {
    // Regression: far palms lost their thin frond tips and stalks to mipmapped alpha.
    const wind = createWind();
    const palm = new MeshStandardMaterial();
    applyWind(palm, wind, "palm");
    const frag = compile(palm).fragmentShader;
    expect(frag).toContain("diffuseColor.a *= 1.0 + sawadLod");
    expect(frag.indexOf("sawadLod")).toBeLessThan(frag.indexOf("#include <alphatest_fragment>"));
    expect(frag).toContain("sawadLod * 0.30");
    // Dense olive crowns get a lighter touch, so they stay airy and silver.
    const olive = new MeshStandardMaterial();
    applyWind(olive, wind, "olive");
    expect(compile(olive).fragmentShader).toContain("sawadLod * 0.10");
    const bark = new MeshStandardMaterial();
    applyWind(bark, wind, "bark");
    expect(compile(bark).fragmentShader).not.toContain("sawadLod");
  });

  it("gives olives silver undersides and only olives", () => {
    const wind = createWind();
    const olive = new MeshStandardMaterial();
    applyWind(olive, wind, "olive");
    expect(compile(olive).fragmentShader).toContain("uUnderside, gl_FrontFacing");
    const palm = new MeshStandardMaterial();
    applyWind(palm, wind, "palm");
    expect(compile(palm).fragmentShader).not.toContain("uUnderside, gl_FrontFacing");
  });

  it("billboards only distance cards", () => {
    const wind = createWind();
    const card = new MeshStandardMaterial();
    applyWind(card, wind, "card");
    expect(compile(card).vertexShader).toContain("cameraPosition - sawadOrigin");
    const grass = new MeshStandardMaterial();
    applyWind(grass, wind, "grass");
    expect(compile(grass).vertexShader).not.toContain("cameraPosition - sawadOrigin");
  });

  it("caches one program per kind and chains an existing onBeforeCompile", () => {
    const wind = createWind();
    const m = new MeshStandardMaterial();
    const earlier = vi.fn();
    m.onBeforeCompile = earlier;
    applyWind(m, wind, "hedge");
    compile(m);
    expect(earlier).toHaveBeenCalledOnce();
    expect(m.customProgramCacheKey()).toBe("sawad-wind-hedge");
    const kinds: FoliageKind[] = ["olive", "palm", "citrus", "hedge", "grass", "card", "bark"];
    const keys = kinds.map((k) => {
      const x = new MeshStandardMaterial();
      applyWind(x, wind, k);
      return x.customProgramCacheKey();
    });
    expect(new Set(keys).size).toBe(kinds.length);
  });

  it("reports and leaves the shader alone when three.js chunks change", () => {
    const reports: ErrorReport[] = [];
    setErrorSink((r) => reports.push(r));
    const m = new MeshStandardMaterial({ name: "veg-olive" });
    applyWind(m, createWind(), "olive");
    const shader = { vertexShader: "void main() {}", fragmentShader: "void main() {}", uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.vertexShader).toBe("void main() {}");
    expect(reports).toHaveLength(1);
    expect(reports[0].component).toBe("sawad-wind");
    expect(reports[0].context).toMatchObject({ kind: "olive", material: "veg-olive" });
  });
});

describe("applyWindToScene", () => {
  it("patches each vegetation material once, by name, and skips others", () => {
    const olive = new MeshStandardMaterial({ name: "veg-olive" });
    const bark = new MeshStandardMaterial({ name: "veg-opaque" });
    const other = new MeshStandardMaterial({ name: "plaster" });
    const g = new Group();
    const geo = new PlaneGeometry();
    g.add(new Mesh(geo, [bark, olive]), new Mesh(geo, olive), new Mesh(geo, other));
    expect(applyWindToScene(g, createWind())).toBe(2);
    expect(olive.customProgramCacheKey()).toBe("sawad-wind-olive");
    expect(bark.customProgramCacheKey()).toBe("sawad-wind-bark");
    expect(other.customProgramCacheKey()).not.toContain("sawad");
  });

  it("knows every material the vegetation build writes", () => {
    expect(Object.keys(MATERIAL_KINDS).sort()).toEqual(["veg-card", "veg-citrus", "veg-grass", "veg-hedge", "veg-olive", "veg-opaque", "veg-palm"]);
  });
});

describe("bakeNodeTransforms", () => {
  it("turns quantized positions under a dequantizing node matrix into float metres at the origin", () => {
    // A 4 m tall card stored as normalized Int16 in -1..1, with scale 2 and offset +2 in y on the node
    // (what meshopt writes): the baked mesh must run from y = 0 to y = 4 with an identity transform.
    const g = new BufferGeometry();
    const q = new Int16Array([-32767, -32767, 0, 32767, -32767, 0, 32767, 32767, 0, -32767, 32767, 0]);
    g.setAttribute("position", new BufferAttribute(q, 3, true));
    g.setAttribute("normal", new BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true));
    const mesh = new Mesh(g, new MeshStandardMaterial());
    mesh.scale.set(2, 2, 2);
    mesh.position.set(0, 2, 0);
    const root = new Group();
    root.position.set(50, 0, 50); // the GLB root may itself be placed anywhere
    root.add(mesh);
    expect(bakeNodeTransforms(root)).toBe(1);
    const pos = g.getAttribute("position");
    expect(pos.array).toBeInstanceOf(Float32Array);
    expect(pos.normalized).toBe(false);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 3);
    expect(g.boundingBox!.max.y).toBeCloseTo(4, 3);
    expect(g.boundingBox!.max.x).toBeCloseTo(2, 3);
    expect(g.getAttribute("normal").getZ(0)).toBeCloseTo(1, 2);
    expect(mesh.matrix.equals(new Matrix4())).toBe(true);
  });

  it("leaves skinned meshes to three.js", () => {
    const root = new Group();
    const skinned = Object.assign(new Mesh(new PlaneGeometry(), new MeshStandardMaterial()), { isSkinnedMesh: true });
    skinned.scale.set(3, 3, 3);
    root.add(skinned);
    expect(bakeNodeTransforms(root)).toBe(0);
    expect(skinned.scale.x).toBe(3);
  });
});

describe("lodFor", () => {
  it("steps through the levels with distance on the high tier", () => {
    const [a, b, c] = LOD_DISTANCES.high;
    expect(lodFor(0, "high")).toBe("LOD0");
    expect(lodFor(a, "high")).toBe("LOD1");
    expect(lodFor(b, "high")).toBe("LOD2");
    expect(lodFor(c, "high")).toBe("card");
  });

  it("never asks the low tier for LOD0 (it ships none) and reaches cards sooner", () => {
    for (const d of [0, 1, 10, 30]) expect(lodFor(d, "low")).not.toBe("LOD0");
    expect(LOD_DISTANCES.low[2]).toBeLessThan(LOD_DISTANCES.high[2]);
  });
});

describe("flapWeights", () => {
  it("stays in 0..1 and never raises and lowers the wings at once", () => {
    for (let t = 0; t < 6; t += 0.037) {
      const [up, down] = flapWeights(t, 0.3);
      expect(up).toBeGreaterThanOrEqual(0);
      expect(up).toBeLessThanOrEqual(1);
      expect(down).toBeGreaterThanOrEqual(0);
      expect(down).toBeLessThanOrEqual(1);
      expect(up * down).toBe(0);
    }
  });

  it("glides with the wings held slightly up after a few beats, and repeats", () => {
    expect(flapWeights(2.0)).toEqual([0.25, 0]);
    expect(flapWeights(0.3)).toEqual(flapWeights(0.3 + 2.6));
    expect(flapWeights(-1)).toEqual(flapWeights(1.6));
  });

  it("puts flock members out of step", () => {
    expect(flapWeights(0.2, 0)).not.toEqual(flapWeights(0.2, 0.5));
  });
});
