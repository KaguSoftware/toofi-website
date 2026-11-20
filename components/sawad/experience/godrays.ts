import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Vector3 } from "three";
import { PLAN_STREET, planAmenities, planBoulevardZ, planVilla } from "../scene/layout";
import type { Vec3 } from "../scene/types";
import { HERO_VILLA_SLOT } from "./story";

/**
 * Fake light shafts: soft additive planes lying along the sun's rays where they come through
 * gaps in the palms (the allée, the promenade by the hero villa, the garden walk). Each plane
 * turns about its ray to face the camera and shows only when the camera looks toward the sun.
 * A few dozen triangles, against real volumetric light.
 */
export type Shaft = {
  /** The middle of the shaft: a point on the ray, in a gap between two palms. */
  through: Vec3;
  /** Metres of ray before and after that point, and the shaft's width. */
  length: number;
  width: number;
};

/** `mid` is the height of a shaft halfway along: the light comes in over the crowns and lands at about head height. */
const SHAFT = { length: 64, width: 3.4, mid: 6.2 } as const;

/** Where the shafts stand: between the palms of the story's shots. */
export function shaftAnchors(): Shaft[] {
  const out: Shaft[] = [];
  const verge = PLAN_STREET.carriageway / 2 + PLAN_STREET.verge / 2;
  // Boulevard A, both verges, in the gaps of the 13 m palm rhythm along the dolly and beyond it.
  for (let x = -338.5; x <= -182; x += 13) {
    for (const side of [-1, 1]) out.push({ through: [x, SHAFT.mid, planBoulevardZ("a", x) + side * verge], length: SHAFT.length, width: SHAFT.width });
  }
  // The promenade palms in front of the hero villa.
  const hero = planVilla(HERO_VILLA_SLOT);
  for (let i = -2; i <= 2; i++) out.push({ through: [hero.x + i * 9.5 + 4, SHAFT.mid + 0.6, hero.z + 19], length: 52, width: 3 });
  // The palms either side of the garden walk.
  const pool = planAmenities().find((a) => a.id === "pool")!;
  for (const x of [-13.5, 13.5]) for (const z of [2, pool.z + 30]) out.push({ through: [x, SHAFT.mid, z], length: 56, width: 3.2 });
  return out;
}

const VERT = /* glsl */ `
attribute vec3 aThrough;
attribute vec3 aShape; // along the ray (-1 to 1), across it (-1 to 1), phase
attribute vec2 aSize;  // half length, half width
uniform vec3 uSunDir;
varying vec2 vShape;
varying float vPhase;
varying vec3 vWorld;
void main() {
  vec3 centre = aThrough + uSunDir * (aShape.x * aSize.x);
  vec3 side = normalize(cross(uSunDir, cameraPosition - centre));
  vWorld = centre + side * (aShape.y * aSize.y);
  vShape = aShape.xy;
  vPhase = aShape.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uFogDensity;
varying vec2 vShape;
varying float vPhase;
varying vec3 vWorld;
void main() {
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  float across = 1.0 - abs(vShape.y);
  across = across * across * (3.0 - 2.0 * across);
  // Fades in from the ground end and out toward the sun.
  float along = smoothstep(-1.0, -0.72, vShape.x) * (1.0 - smoothstep(0.35, 1.0, vShape.x));
  // Only into the light: nothing when the sun is behind the camera.
  float facing = pow(max(dot(toFrag / dist, uSunDir), 0.0), 3.0);
  float dust = 0.78 + 0.22 * sin(vShape.x * 9.0 + uTime * 0.35 + vPhase * 6.2832);
  // No hard edge when the camera passes through a shaft, and haze takes the far ones.
  float near = smoothstep(1.5, 12.0, dist);
  float haze = exp(-uFogDensity * uFogDensity * dist * dist);
  float a = across * along * facing * dust * near * haze * uStrength;
  gl_FragColor = vec4(uColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export type GodRays = { mesh: Mesh; material: ShaderMaterial; dispose: () => void };

/** The strength the shafts have in full daylight. */
export const SHAFT_STRENGTH = 0.2;

/** Builds every shaft as one mesh (two triangles each). `sunDir` points from the ground toward the sun. */
export function buildGodRays(sunDir: Vector3, fogDensity: number, shafts: Shaft[] = shaftAnchors()): GodRays {
  const n = shafts.length;
  const position = new Float32Array(n * 4 * 3);
  const through = new Float32Array(n * 4 * 3);
  const shape = new Float32Array(n * 4 * 3);
  const size = new Float32Array(n * 4 * 2);
  const index = new Uint16Array(n * 6);
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  shafts.forEach((s, i) => {
    corners.forEach(([along, across], c) => {
      const v = i * 4 + c;
      through.set(s.through, v * 3);
      // Bounds only; the shader places the vertex.
      position.set(s.through, v * 3);
      shape.set([along, across, (i * 0.618) % 1], v * 3);
      size.set([s.length / 2, s.width / 2], v * 2);
    });
    index.set([0, 1, 2, 0, 2, 3].map((k) => i * 4 + k), i * 6);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setAttribute("aThrough", new BufferAttribute(through, 3));
  geometry.setAttribute("aShape", new BufferAttribute(shape, 3));
  geometry.setAttribute("aSize", new BufferAttribute(size, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  const material = new ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDir.clone().normalize() },
      uColor: { value: new Color(1.0, 0.66, 0.36).multiplyScalar(1.5) },
      uStrength: { value: SHAFT_STRENGTH },
      uTime: { value: 0 },
      uFogDensity: { value: fogDensity },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "god-rays";
  // The vertices are placed in the shader, far from the bounds the geometry knows about.
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return {
    mesh,
    material,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Daylight left in the shafts (1 at day, 0 at dusk). */
export function setShaftStrength(rays: GodRays, daylight: number): void {
  rays.material.uniforms.uStrength.value = SHAFT_STRENGTH * Math.min(1, Math.max(0, daylight));
  rays.mesh.visible = daylight > 0.01;
}
