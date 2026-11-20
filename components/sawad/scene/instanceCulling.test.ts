import { BoxGeometry, Color, Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { cameraFrustum, cullInstances, prepareInstanceCulling, restoreInstances } from "./instanceCulling";

/** Five copies in a row along x, 40 m apart, each with a tile and a tint. */
function row() {
  const mesh = new InstancedMesh(new BoxGeometry(10, 6, 10), new MeshStandardMaterial(), 5);
  const tiles = new Float32Array(5 * 4);
  for (let i = 0; i < 5; i++) {
    mesh.setMatrixAt(i, new Matrix4().makeTranslation(i * 40, 3, 0));
    mesh.setColorAt(i, new Color(i / 4, 0, 0));
    tiles.set([i, i, i, i], i * 4);
  }
  mesh.geometry.setAttribute("lightmapTile", new InstancedBufferAttribute(tiles, 4));
  const root = new Group();
  root.add(mesh);
  return { root, mesh };
}

/** A camera at x looking down -z at the row, 30 degrees wide. */
function cameraAt(x: number) {
  const camera = new PerspectiveCamera(30, 1, 1, 1000);
  camera.position.set(x, 3, 60);
  camera.lookAt(x, 3, 0);
  return camera;
}

const xs = (mesh: InstancedMesh) =>
  Array.from({ length: mesh.count }, (_, i) => {
    const m = new Matrix4();
    mesh.getMatrixAt(i, m);
    return new Vector3().setFromMatrixPosition(m).x;
  });

describe("per-copy culling", () => {
  it("records a sphere per copy, for meshes with two copies or more", () => {
    const { root, mesh } = row();
    const single = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 1);
    root.add(single);
    const culled = prepareInstanceCulling(root);
    expect(culled).toHaveLength(1);
    expect(culled[0].mesh).toBe(mesh);
    expect(culled[0].total).toBe(5);
    expect(Array.from(culled[0].spheres.subarray(8, 11))).toEqual([80, 3, 0]);
    expect(culled[0].spheres[3]).toBeCloseTo(Math.hypot(5, 3, 5));
  });

  it("draws only the copies in view, with their own tiles and tints", () => {
    const { root, mesh } = row();
    const culled = prepareInstanceCulling(root);
    const drawn = cullInstances(culled, cameraFrustum(cameraAt(80)), 0);
    expect(drawn).toBe(1);
    expect(mesh.count).toBe(1);
    expect(xs(mesh)).toEqual([80]);
    const tiles = mesh.geometry.getAttribute("lightmapTile") as InstancedBufferAttribute;
    expect(Array.from(tiles.array.slice(0, 4))).toEqual([2, 2, 2, 2]);
    const tint = new Color();
    mesh.getColorAt(0, tint);
    expect(tint.r).toBeCloseTo(0.5);
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0);
  });

  it("keeps copies just outside the view within the margin (their shadows reach in)", () => {
    const { root, mesh } = row();
    const culled = prepareInstanceCulling(root);
    cullInstances(culled, cameraFrustum(cameraAt(80)), 30);
    expect(xs(mesh)).toEqual([40, 80, 120]);
  });

  it("moves with the camera, never leaving a stale copy in a slot", () => {
    const { root, mesh } = row();
    const culled = prepareInstanceCulling(root);
    cullInstances(culled, cameraFrustum(cameraAt(80)), 30);
    cullInstances(culled, cameraFrustum(cameraAt(0)), 0);
    expect(xs(mesh)).toEqual([0]);
    cullInstances(culled, cameraFrustum(cameraAt(160)), 30);
    expect(xs(mesh)).toEqual([120, 160]);
    const tiles = mesh.geometry.getAttribute("lightmapTile") as InstancedBufferAttribute;
    expect(Array.from(tiles.array.slice(0, 8))).toEqual([3, 3, 3, 3, 4, 4, 4, 4]);
  });

  it("leaves the buffers alone while the set of copies stays the same", () => {
    const { root, mesh } = row();
    const culled = prepareInstanceCulling(root);
    const frustum = cameraFrustum(cameraAt(80));
    cullInstances(culled, frustum, 0);
    const version = mesh.instanceMatrix.version;
    cullInstances(culled, frustum, 0);
    expect(mesh.instanceMatrix.version).toBe(version);
  });

  it("draws nothing when no copy is in view, and everything once restored", () => {
    const { root, mesh } = row();
    const culled = prepareInstanceCulling(root);
    const away = new PerspectiveCamera(30, 1, 1, 1000);
    away.position.set(0, 3, 60);
    away.lookAt(0, 3, 200);
    expect(cullInstances(culled, cameraFrustum(away), 0)).toBe(0);
    expect(mesh.count).toBe(0);
    restoreInstances(culled);
    expect(mesh.count).toBe(5);
    expect(xs(mesh)).toEqual([0, 40, 80, 120, 160]);
  });

  it("builds the frustum from the camera's latest matrices", () => {
    const camera = cameraAt(0);
    camera.position.x = 500;
    camera.lookAt(500, 3, 0);
    const f = cameraFrustum(camera, new Frustum());
    expect(f.containsPoint(new Vector3(500, 3, 0))).toBe(true);
    expect(f.containsPoint(new Vector3(0, 3, 0))).toBe(false);
  });
});
