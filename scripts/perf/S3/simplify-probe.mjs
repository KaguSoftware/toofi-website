#!/usr/bin/env node
/**
 * How many triangles each mesh of a GLB carries that a simplifier could remove at a given error in
 * metres, keeping UV, lightmap UV, colour and normal seams (meshopt simplifyWithAttributes). A probe for
 * S3: it estimates geometry that is invisible at any distance (flat surfaces sampled finely along the
 * ground), not a replacement for F2A/F2B's distance levels. Writes nothing back.
 *
 *   node scripts/perf/S3/simplify-probe.mjs public/sawad/models/compound-zaitun-high.glb [--errors 0.002,0.01,0.05] [--mesh site]
 */
import { pathToFileURL } from "node:url";

/** Metres per unit of the mesh's stored positions, from the first node that draws it (quantization scale). */
export function nodeScale(node) {
  const m = node.getWorldMatrix();
  return Math.cbrt(Math.abs(m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])));
}

/** Float copies of an accessor's elements (denormalized), `size` components each, padded with zeros. */
export function floats(accessor, size) {
  const n = accessor.getCount();
  const out = new Float32Array(n * size);
  const el = [];
  for (let i = 0; i < n; i++) {
    accessor.getElement(i, el);
    for (let k = 0; k < size; k++) out[i * size + k] = el[k] ?? 0;
  }
  return out;
}

async function main() {
  const { NodeIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
  const { MeshoptDecoder, MeshoptSimplifier } = await import("meshoptimizer");
  await MeshoptDecoder.ready;
  await MeshoptSimplifier.ready;
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : def;
  };
  const errors = opt("--errors", "0.002,0.01,0.05").split(",").map(Number);
  const only = opt("--mesh", null);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  for (const file of args) {
    const doc = await io.read(file);
    const nodes = doc.getRoot().listNodes();
    const rows = [];
    for (const mesh of doc.getRoot().listMeshes()) {
      if (only && mesh.getName() !== only) continue;
      const node = nodes.find((n) => n.getMesh() === mesh);
      const scale = node ? nodeScale(node) : 1;
      const row = { mesh: mesh.getName(), triangles: 0, kept: Object.fromEntries(errors.map((e) => [e, 0])) };
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        const idx = prim.getIndices();
        if (!pos || !idx) continue;
        const positions = floats(pos, 3).map((v) => v * scale); // metres
        const parts = [
          ["NORMAL", 3, 0.5],
          ["TEXCOORD_0", 2, 1],
          ["TEXCOORD_2", 2, 1],
          ["COLOR_0", 3, 0.5],
        ].filter(([s]) => prim.getAttribute(s));
        const stride = parts.reduce((a, [, n]) => a + n, 0);
        const attrs = new Float32Array(pos.getCount() * stride);
        let off = 0;
        const weights = [];
        for (const [s, n, w] of parts) {
          const f = floats(prim.getAttribute(s), n);
          for (let i = 0; i < pos.getCount(); i++) for (let k = 0; k < n; k++) attrs[i * stride + off + k] = f[i * n + k];
          for (let k = 0; k < n; k++) weights.push(w);
          off += n;
        }
        const indices = new Uint32Array(idx.getArray());
        row.triangles += indices.length / 3;
        for (const e of errors) {
          const [res] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, stride, weights, null, 0, e, ["ErrorAbsolute"]);
          row.kept[e] += res.length / 3;
        }
      }
      rows.push(row);
    }
    rows.sort((a, b) => b.triangles - a.triangles);
    console.log(`### ${file}\n`);
    console.log(`| Mesh | Triangles | ${errors.map((e) => `kept at ${e * 100} cm`).join(" | ")} |`);
    console.log(`|---|---|${errors.map(() => "---").join("|")}|`);
    for (const r of rows) console.log(`| ${r.mesh} | ${r.triangles} | ${errors.map((e) => `${r.kept[e]} (${Math.round((100 * r.kept[e]) / r.triangles)}%)`).join(" | ")} |`);
    console.log("");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
