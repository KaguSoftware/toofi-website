#!/usr/bin/env node
/**
 * Bundle graph analysis for search track S2 (JavaScript bundles).
 *
 * Reads Next's analyzer graph (`next analyze export`, JSON lines) for one route and answers:
 *   - which packages and app folders make up the route's first-render JavaScript, in compressed
 *     bytes the analyzer attributes per source file ("part");
 *   - which packages are only reachable asynchronously (the 3D chunks) and what each async
 *     boundary pulls in;
 *   - the shortest synchronous import chain from a client entry to each module of a package
 *     (used to find who drags the admin editor into public pages);
 *   - which packages ship in more than one version.
 *
 *   node scripts/perf/S2/graph.mjs <graph.jsonl> [--pkgs tiptap,dnd-kit]
 *
 * Plain data in, plain data out: the functions take the parsed records, so they are unit tested.
 * The analyzer attributes unminified source bytes with its own compressed estimate; read the
 * numbers as shares and ranks, not as production transfer (bundles.mjs has the real files).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The package a source path belongs to, or the app folder it lives in. */
export function packageOf(sourcePath) {
  const p = sourcePath.replace(/^\[project\]\//, "");
  const nm = p.lastIndexOf("node_modules/");
  if (nm >= 0) {
    const rest = p.slice(nm + "node_modules/".length).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  if (p.startsWith("[turbopack]")) return "(turbopack runtime)";
  const top = p.split("/");
  return `app: ${top.slice(0, top[0] === "components" || top[0] === "lib" ? 2 : 1).join("/")}`;
}

/** The version pnpm put in a store path (`.pnpm/three@0.187.0/...`), or null. */
export function versionOf(sourcePath) {
  const m = /\.pnpm\/((?:@[^+/]+\+)?[^@/]+)@([^_/]+)[_/]/.exec(sourcePath);
  return m ? { name: m[1].replace("+", "/"), version: m[2] } : null;
}

/** Group the parsed records by kind. */
export function indexRecords(records) {
  const idx = { modules: new Map(), outputs: new Map(), parts: [], groups: [], entries: [] };
  for (const r of records) {
    if (r.type === "module") idx.modules.set(r.ident, r);
    else if (r.type === "output") idx.outputs.set(r.filename, r);
    else if (r.type === "part") idx.parts.push(r);
    else if (r.type === "group") idx.groups.push(r);
    else if (r.type === "route") idx.entries.push(...(r.entries ?? []));
  }
  return idx;
}

const isClientJs = (f) => f.startsWith("[client-fs]/") && f.endsWith(".js");

/** Output files of a route that load at first render, and those only loaded on demand. */
export function splitOutputs(idx) {
  const first = new Set();
  const async = new Set();
  for (const g of idx.groups) {
    const into = g.kind === "bootstrap" || g.kind === "render_dependent" ? first : g.kind === "async" || g.kind === "worker" ? async : null;
    if (!into) continue;
    for (const f of g.outputs ?? []) if (isClientJs(f)) into.add(f);
  }
  for (const f of first) async.delete(f);
  return { first, async };
}

/** Compressed bytes per package for a set of output files. */
export function bytesByPackage(idx, files) {
  const out = new Map();
  for (const p of idx.parts) {
    if (!files.has(p.filename)) continue;
    const k = packageOf(p.source_path);
    const cur = out.get(k) ?? { compressed: 0, raw: 0 };
    cur.compressed += p.compressed_size ?? 0;
    cur.raw += p.size ?? 0;
    out.set(k, cur);
  }
  return [...out.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.compressed - a.compressed);
}

/** Packages that appear in more than one version in the client output. */
export function duplicates(idx, files) {
  const versions = new Map();
  for (const p of idx.parts) {
    if (!files.has(p.filename)) continue;
    const v = versionOf(p.source_path);
    if (!v) continue;
    const s = versions.get(v.name) ?? new Map();
    s.set(v.version, (s.get(v.version) ?? 0) + (p.compressed_size ?? 0));
    versions.set(v.name, s);
  }
  return [...versions.entries()].filter(([, s]) => s.size > 1).map(([name, s]) => ({ name, versions: Object.fromEntries(s) }));
}

/** Shortest synchronous chain from any client entry to a module whose package matches. */
export function importChains(idx, matches, { max = 8 } = {}) {
  const starts = idx.entries.map((e) => e.module_ident).filter((m) => idx.modules.has(m));
  const prev = new Map(starts.map((s) => [s, null]));
  const queue = [...starts];
  const hits = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const mod = idx.modules.get(id);
    if (matches(mod.path ?? id)) {
      hits.push(id);
      if (hits.length >= max) break;
    }
    for (const dep of mod.dependencies?.sync ?? []) {
      if (prev.has(dep) || !idx.modules.has(dep)) continue;
      prev.set(dep, id);
      queue.push(dep);
    }
  }
  return hits.map((h) => {
    const chain = [];
    for (let c = h; c; c = prev.get(c)) chain.unshift(c);
    return chain.map((c) => (idx.modules.get(c)?.path ?? c).replace(/^\[project\]\//, "").replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//, "nm/"));
  });
}

/** What each async boundary (next/dynamic entry) pulls in, by package. */
export function asyncBoundaries(idx) {
  return idx.groups
    .filter((g) => g.kind === "async")
    .map((g) => {
      const files = new Set((g.outputs ?? []).filter(isClientJs));
      const pk = bytesByPackage(idx, files);
      const total = pk.reduce((a, p) => a + p.compressed, 0);
      return { trigger: g.trigger_module_ident.replace(/^\[project\]\//, "").replace(/ \[app-client\].*$/, ""), files: files.size, compressed: total, top: pk.slice(0, 6) };
    });
}

export function report(records, { pkgs = /** @type {string[]} */ ([]) } = {}) {
  const idx = indexRecords(records);
  const { first, async } = splitOutputs(idx);
  const firstPk = bytesByPackage(idx, first);
  const total = firstPk.reduce((a, p) => a + p.compressed, 0);
  const wanted = (path) => pkgs.some((p) => path.includes(`node_modules/${p}`) || path.includes(`/${p}/`));
  return {
    firstRender: { files: first.size, compressed: total, packages: firstPk.map((p) => ({ ...p, share: total ? p.compressed / total : 0 })) },
    asyncOnly: { files: async.size, packages: bytesByPackage(idx, async).slice(0, 12) },
    boundaries: asyncBoundaries(idx),
    duplicates: duplicates(idx, new Set([...first, ...async])),
    chains: pkgs.length ? importChains(idx, wanted) : [],
  };
}

function main() {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) throw new Error("usage: graph.mjs <graph.jsonl> [--pkgs a,b]");
  const pk = rest.indexOf("--pkgs");
  const pkgs = pk >= 0 ? rest[pk + 1].split(",") : [];
  const records = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  console.log(JSON.stringify(report(records, { pkgs }), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
