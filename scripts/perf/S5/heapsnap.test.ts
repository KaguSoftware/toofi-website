import { describe, expect, it } from "vitest";
import { aggregate, diff } from "./heapsnap.mjs";

/** A tiny snapshot in V8's format: nodes are flat [type, name, id, self_size, edge_count, trace, detachedness]. */
function snapshot(nodes: [string, string, number, number?][]) {
  const types = ["hidden", "array", "string", "object", "code", "closure", "regexp", "number", "native"];
  const strings: string[] = [];
  const str = (s: string) => {
    let i = strings.indexOf(s);
    if (i < 0) i = strings.push(s) - 1;
    return i;
  };
  const flat: number[] = [];
  nodes.forEach(([type, name, size, detached = 0], id) => flat.push(types.indexOf(type), str(name), id, size, 0, 0, detached));
  return {
    snapshot: { meta: { node_fields: ["type", "name", "id", "self_size", "edge_count", "trace_node_id", "detachedness"], node_types: [types] } },
    nodes: flat,
    strings,
  };
}

describe("aggregate", () => {
  it("groups objects and closures by constructor, and strings by type only", () => {
    const a = aggregate(
      snapshot([
        ["object", "Vector3", 40],
        ["object", "Vector3", 40],
        ["closure", "step", 32],
        ["string", "hello", 20],
        ["string", "world", 20],
        ["native", "HTMLDivElement", 100, 2],
      ]),
    );
    expect(a.total).toBe(252);
    expect(a.nodes).toBe(6);
    expect(a.detached).toBe(1);
    expect(a.groups.get("object:Vector3")).toEqual({ key: "object:Vector3", count: 2, bytes: 80 });
    expect(a.groups.get("string")).toEqual({ key: "string", count: 2, bytes: 40 });
  });
});

describe("diff", () => {
  it("lists what grew, by bytes and by count", () => {
    const a = aggregate(snapshot([["object", "Vector3", 40], ["object", "Map", 100]]));
    const b = aggregate(
      snapshot([
        ["object", "Vector3", 40],
        ["object", "Vector3", 40],
        ["object", "Vector3", 40],
        ["object", "Map", 100],
        ["array", "(object elements)", 500],
      ]),
    );
    const d = diff(a, b);
    expect(d.dTotal).toBe(580);
    expect(d.dNodes).toBe(3);
    expect(d.grew[0]).toMatchObject({ key: "array:(object elements)", dBytes: 500, dCount: 1 });
    expect(d.grewByCount[0]).toMatchObject({ key: "object:Vector3", dCount: 2 });
    expect(d.grew.find((g) => g.key === "object:Map")).toBeUndefined();
  });
});
