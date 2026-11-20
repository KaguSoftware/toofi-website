import { Frustum, Matrix4, Sphere, Vector3, type BufferAttribute, type Camera, type InstancedBufferAttribute, type InstancedMesh, type Object3D } from "three";

/**
 * Per-copy culling for the baked compound. three tests an InstancedMesh as one thing (one sphere
 * around every copy), so all 30 garden villas are drawn, and cast shadows, as soon as one of
 * them is on screen. Each frame this packs the copies that are in view to the front of the
 * instance buffers (with their per-copy attributes: lightmap tile, tint) and draws only those.
 *
 * Copies just outside the view are kept within `margin` metres: a low sun throws a villa's
 * shadow 50 m and more, into the frame, from a villa that is not in it.
 */

type Packed = { attr: BufferAttribute; itemSize: number; data: Float32Array | Uint8Array | Uint16Array | Int16Array };

export type CulledMesh = {
  mesh: InstancedMesh;
  total: number;
  /** World-space sphere per copy: x, y, z, radius. */
  spheres: Float32Array;
  /** The instance matrices and per-copy attributes in their original order. */
  packed: Packed[];
  /** Which copies were drawn last time (1) or not (0), to skip unchanged frames. */
  shown: Uint8Array;
};

const m4 = new Matrix4();
const v3 = new Vector3();
const s3 = new Vector3();

function perCopyAttributes(mesh: InstancedMesh): Packed[] {
  const attrs: BufferAttribute[] = [mesh.instanceMatrix];
  if (mesh.instanceColor) attrs.push(mesh.instanceColor);
  for (const a of Object.values(mesh.geometry.attributes)) if ((a as InstancedBufferAttribute).isInstancedBufferAttribute) attrs.push(a as BufferAttribute);
  return attrs.map((attr) => ({ attr, itemSize: attr.itemSize, data: (attr.array as Packed["data"]).slice() }));
}

/** Finds the instanced meshes worth culling (two copies or more) and records each copy's bounds. */
export function prepareInstanceCulling(root: Object3D): CulledMesh[] {
  const out: CulledMesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.count < 2) return;
    const g = mesh.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const local = g.boundingSphere;
    if (!local) return;
    const total = mesh.count;
    const spheres = new Float32Array(total * 4);
    for (let i = 0; i < total; i++) {
      mesh.getMatrixAt(i, m4);
      m4.premultiply(mesh.matrixWorld);
      v3.copy(local.center).applyMatrix4(m4);
      s3.setFromMatrixScale(m4);
      spheres.set([v3.x, v3.y, v3.z, local.radius * Math.max(s3.x, s3.y, s3.z)], i * 4);
    }
    out.push({ mesh, total, spheres, packed: perCopyAttributes(mesh), shown: new Uint8Array(total).fill(1) });
  });
  return out;
}

const sphere = new Sphere();

/**
 * Draws only the copies inside the frustum (spheres grown by `margin`). Returns how many copies
 * are drawn in all. Buffers are rewritten only when the set of copies changes.
 */
export function cullInstances(meshes: readonly CulledMesh[], frustum: Frustum, margin: number): number {
  let drawn = 0;
  for (const c of meshes) {
    let changed = false;
    let n = 0;
    for (let i = 0; i < c.total; i++) {
      sphere.center.set(c.spheres[i * 4], c.spheres[i * 4 + 1], c.spheres[i * 4 + 2]);
      sphere.radius = c.spheres[i * 4 + 3] + margin;
      const show = frustum.intersectsSphere(sphere) ? 1 : 0;
      if (show !== c.shown[i]) changed = true;
      c.shown[i] = show;
      n += show;
    }
    drawn += n;
    if (!changed) continue;
    for (const p of c.packed) {
      const dst = p.attr.array as Packed["data"];
      let slot = 0;
      for (let i = 0; i < c.total; i++) {
        if (!c.shown[i]) continue;
        // Always from the original: a slot may hold another copy since an earlier frame.
        dst.set(p.data.subarray(i * p.itemSize, (i + 1) * p.itemSize), slot * p.itemSize);
        slot += 1;
      }
      p.attr.needsUpdate = true;
    }
    c.mesh.count = n;
  }
  return drawn;
}

/** Puts every copy back, in its original order (when the culling stops). */
export function restoreInstances(meshes: readonly CulledMesh[]): void {
  for (const c of meshes) {
    for (const p of c.packed) {
      (p.attr.array as Packed["data"]).set(p.data);
      p.attr.needsUpdate = true;
    }
    c.mesh.count = c.total;
    c.shown.fill(1);
  }
}

const viewProjection = new Matrix4();

/** The camera's frustum in world space, as of its latest matrices. */
export function cameraFrustum(camera: Camera, out = new Frustum()): Frustum {
  camera.updateMatrixWorld();
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return out.setFromProjectionMatrix(viewProjection);
}
