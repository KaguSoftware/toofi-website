import { describe, expect, it } from "vitest";
import { asyncBoundaries, bytesByPackage, duplicates, importChains, indexRecords, packageOf, report, splitOutputs, versionOf } from "./graph.mjs";

const mod = (ident: string, sync: string[] = []) => ({ type: "module", ident, path: ident, dependencies: { sync, async: [] } });
const part = (filename: string, source_path: string, compressed_size: number) => ({ type: "part", filename, source_path, size: compressed_size * 3, compressed_size });
const group = (kind: string, outputs: string[], trigger = "[project]/x.tsx [app-client] (ecmascript)") => ({ type: "group", kind, outputs, trigger_module_ident: trigger });

const A = "[client-fs]/_next/static/chunks/a.js";
const B = "[client-fs]/_next/static/chunks/b.js";
const C = "[client-fs]/_next/static/chunks/c.js";
const records = [
  { type: "route", route: "/", entries: [{ module_ident: "[project]/entry.tsx" }] },
  mod("[project]/entry.tsx", ["[project]/components/editable/Rich.tsx"]),
  mod("[project]/components/editable/Rich.tsx", ["[project]/node_modules/.pnpm/@tiptap+react@3.0.0_x/node_modules/@tiptap/react/index.js"]),
  mod("[project]/node_modules/.pnpm/@tiptap+react@3.0.0_x/node_modules/@tiptap/react/index.js"),
  group("bootstrap", [A]),
  group("render_dependent", [B]),
  group("async", [B, C], "[project]/components/sawad/scene/SceneCanvas.tsx [app-client] (ecmascript, next/dynamic entry)"),
  part(A, "[project]/node_modules/.pnpm/next@16.0.0_x/node_modules/next/dist/client/a.js", 100),
  part(B, "[project]/node_modules/.pnpm/@tiptap+react@3.0.0_x/node_modules/@tiptap/react/index.js", 40),
  part(B, "[project]/node_modules/.pnpm/@tiptap+react@2.0.0_y/node_modules/@tiptap/react/old.js", 5),
  part(C, "[project]/node_modules/.pnpm/three@0.187.0/node_modules/three/build/three.core.js", 200),
  part(C, "[project]/components/sawad/scene/Scene.tsx", 10),
];

describe("packageOf and versionOf", () => {
  it("names packages, scoped packages, app folders and the runtime", () => {
    expect(packageOf("[project]/node_modules/.pnpm/@tiptap+react@3.0.0_x/node_modules/@tiptap/react/index.js")).toBe("@tiptap/react");
    expect(packageOf("[project]/components/sawad/scene/Scene.tsx")).toBe("app: components/sawad");
    expect(packageOf("[turbopack]/shared/runtime/x.ts")).toBe("(turbopack runtime)");
  });
  it("reads the version out of a pnpm store path", () => {
    expect(versionOf("[project]/node_modules/.pnpm/three@0.187.0/node_modules/three/x.js")).toEqual({ name: "three", version: "0.187.0" });
    expect(versionOf("[project]/node_modules/.pnpm/@tiptap+react@3.0.0_x/node_modules/@tiptap/react/x.js")).toEqual({ name: "@tiptap/react", version: "3.0.0" });
    expect(versionOf("[project]/components/a.tsx")).toBeNull();
  });
});

describe("outputs and bytes", () => {
  const idx = indexRecords(records);
  it("splits first-render files from on-demand ones, and a file in both counts as first render", () => {
    const { first, async } = splitOutputs(idx);
    expect([...first].sort()).toEqual([A, B]);
    expect([...async]).toEqual([C]);
  });
  it("sums compressed bytes per package, largest first", () => {
    const pk = bytesByPackage(idx, new Set([A, B]));
    expect(pk[0]).toMatchObject({ name: "next", compressed: 100 });
    expect(pk.find((p) => p.name === "@tiptap/react")?.compressed).toBe(45);
  });
  it("finds a package present in two versions", () => {
    expect(duplicates(idx, new Set([B]))).toEqual([{ name: "@tiptap/react", versions: { "3.0.0": 40, "2.0.0": 5 } }]);
  });
  it("reports what each next/dynamic boundary pulls in", () => {
    const [b] = asyncBoundaries(idx);
    expect(b.trigger).toBe("components/sawad/scene/SceneCanvas.tsx");
    expect(b.top[0].name).toBe("three");
  });
});

describe("importChains", () => {
  it("returns the shortest synchronous chain from an entry to a package", () => {
    const chains: string[][] = importChains(indexRecords(records), (p: string) => p.includes("@tiptap"));
    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual(["entry.tsx", "components/editable/Rich.tsx", "nm/@tiptap/react/index.js"]);
  });
  it("returns nothing when the package is unreachable", () => {
    expect(importChains(indexRecords(records), (p: string) => p.includes("zod"))).toEqual([]);
  });
});

describe("report", () => {
  it("combines first render, async, boundaries, duplicates and chains", () => {
    const r = report(records, { pkgs: ["@tiptap"] });
    expect(r.firstRender.files).toBe(2);
    expect(r.firstRender.compressed).toBe(145);
    expect(r.firstRender.packages[0].share).toBeCloseTo(100 / 145);
    expect(r.asyncOnly.packages[0].name).toBe("three");
    expect(r.chains).toHaveLength(1);
  });
  it("skips chains when no package is asked for", () => {
    expect(report(records).chains).toEqual([]);
  });
});
