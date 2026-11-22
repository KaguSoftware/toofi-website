/**
 * V8 heap snapshots, reduced to counts and bytes per constructor, and the difference between
 * two of them: what a leak leaves behind. Pure functions over the snapshot's JSON (tested in
 * heapsnap.test.ts); leaks.mjs takes the snapshots.
 */

/** Count and self size per `type:name` (for example `object:Vector3`, `closure:step`), plus detached DOM. */
export function aggregate(snapshot) {
  const meta = snapshot.snapshot.meta;
  const fields = meta.node_fields;
  const stride = fields.length;
  const typeAt = fields.indexOf("type");
  const nameAt = fields.indexOf("name");
  const sizeAt = fields.indexOf("self_size");
  const detachedAt = fields.indexOf("detachedness");
  const types = meta.node_types[typeAt];
  const { nodes, strings } = snapshot;
  const groups = new Map();
  let total = 0;
  let detached = 0;
  for (let i = 0; i < nodes.length; i += stride) {
    const type = types[nodes[i + typeAt]];
    const name = strings[nodes[i + nameAt]];
    const size = nodes[i + sizeAt];
    total += size;
    if (detachedAt >= 0 && nodes[i + detachedAt] === 2) detached += 1;
    // Strings, numbers and code are grouped by type only; their names are their contents.
    const key = type === "object" || type === "closure" || type === "native" || type === "array" ? `${type}:${name}` : type;
    const g = groups.get(key);
    if (g) {
      g.count += 1;
      g.bytes += size;
    } else groups.set(key, { key, count: 1, bytes: size });
  }
  return { total, nodes: nodes.length / stride, detached, groups };
}

/** What grew from `a` to `b`, largest byte growth first. */
export function diff(a, b, { top = 25, minCount = 1 } = {}) {
  const out = [];
  for (const [key, gb] of b.groups) {
    const ga = a.groups.get(key) ?? { count: 0, bytes: 0 };
    const dc = gb.count - ga.count;
    const db = gb.bytes - ga.bytes;
    if (dc >= minCount || db > 0) out.push({ key, count: gb.count, dCount: dc, bytes: gb.bytes, dBytes: db });
  }
  return {
    dTotal: b.total - a.total,
    dNodes: b.nodes - a.nodes,
    dDetached: b.detached - a.detached,
    grew: out.sort((x, y) => y.dBytes - x.dBytes).slice(0, top),
    grewByCount: [...out].sort((x, y) => y.dCount - x.dCount).slice(0, top),
  };
}
