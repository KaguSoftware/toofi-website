#!/usr/bin/env node
/**
 * Bundle report (optimization track P0). On the rig's production build: every page's
 * first-render JavaScript and CSS (from the build's client reference manifests), each chunk's
 * real size on disk (raw, gzip -9, brotli -11), and the chunks no page loads at first render
 * (loaded on demand: the 3D engine, the tour, admin editors). Package composition comes from
 * Next's own analyzer (`next analyze --output`, Turbopack) as shares only: the analyzer builds
 * in memory with its own chunk names and attributes unminified bytes, so its sizes are not
 * production sizes.
 *
 *   node scripts/perf/bundles.mjs [--no-analyze]
 *
 * This is build evidence, not an observed request: the load trace (trace.mjs) has what a
 * browser actually fetched.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { fmtBytes, mdTable, parseArgs, saveResult } from "./lib.mjs";

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

/** Admin-only packages that should never reach a public route. */
export const ADMIN_PACKAGES = ["@tiptap/react", "@tiptap/pm", "@tiptap/starter-kit", "@tiptap/extension-link", "@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities", "prosemirror-model", "prosemirror-view"];

async function exportGraph(src, snapshot) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "analyze", "export", "--snapshot", snapshot], { cwd: src, stdio: ["ignore", "pipe", "pipe"] });
  const records = { outputs: [], parts: [], groups: [], routes: [] };
  const rl = createInterface({ input: child.stdout });
  for await (const line of rl) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (r.type === "output") records.outputs.push(r);
    else if (r.type === "part") records.parts.push(r);
    else if (r.type === "group") records.groups.push(r);
    else if (r.type === "route") records.routes.push(r.route);
  }
  const code = await new Promise((ok) => child.on("exit", ok));
  if (code !== 0) throw new Error(`next analyze export exited ${code}`);
  return records;
}

/** Real sizes of a file in the build: raw, gzip -9 and brotli -11 (what a host would serve). */
function measure(path) {
  const buf = readFileSync(path);
  return { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
}

/** Each App Router page's first-render JS and CSS, from the build's client reference manifests. */
function routeManifests(next) {
  const build = JSON.parse(readFileSync(join(next, "build-manifest.json"), "utf8"));
  const root = build.rootMainFiles ?? [];
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page_client-reference-manifest.js") {
        const sandbox = { globalThis: { __RSC_MANIFEST: {} } };
        new Function("globalThis", readFileSync(full, "utf8"))(sandbox.globalThis);
        for (const [page, m] of Object.entries(sandbox.globalThis.__RSC_MANIFEST)) {
          const key = Object.keys(m.entryJSFiles ?? {}).find((k) => k.endsWith(page.replace(/\/page$/, "") + "/page") || k.endsWith(page));
          const js = [...new Set([...root, ...(m.entryJSFiles?.[key] ?? [])])];
          const css = [...new Set((m.entryCSSFiles?.[key] ?? []).map((c) => (typeof c === "string" ? c : c.path)))];
          out.push({ route: page.replace(/\/page$/, "") || "/", js, css });
        }
      }
    }
  };
  walk(join(next, "server/app"));
  return { routes: out, root };
}

/** Package shares per route and per group kind from Next's analyzer (attributed, relative only). */
async function composition(src, buildId) {
  const snapshot = `rig-${buildId}`;
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  for (const k of Object.keys(env)) if (/SUPABASE/.test(k)) delete env[k];
  execFileSync(process.execPath, ["node_modules/next/dist/bin/next", "analyze", "--output", "--snapshot", snapshot], { cwd: src, env, stdio: "ignore" });
  const g = await exportGraph(src, snapshot);
  const bytesByFile = new Map();
  for (const p of g.parts) {
    if (!p.filename.startsWith("[client-fs]/") || !p.filename.endsWith(".js")) continue;
    const m = bytesByFile.get(p.filename) ?? new Map();
    const pkg = packageOf(p.source_path);
    m.set(pkg, (m.get(pkg) ?? 0) + (p.size ?? 0));
    bytesByFile.set(p.filename, m);
  }
  const out = {};
  for (const route of g.routes) {
    const groups = g.groups.filter((x) => x.route === route);
    const files = (kinds) => new Set(groups.filter((x) => kinds.includes(x.kind)).flatMap((x) => x.outputs).filter((f) => bytesByFile.has(f)));
    const first = files(["bootstrap", "render_dependent"]);
    const later = [...files(["async", "worker"])].filter((f) => !first.has(f));
    const shares = (list) => {
      const t = new Map();
      for (const f of list) for (const [k, v] of bytesByFile.get(f)) t.set(k, (t.get(k) ?? 0) + v);
      const total = [...t.values()].reduce((a, b) => a + b, 0);
      return [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, v]) => ({ name, share: total ? v / total : 0 }));
    };
    if (!first.size) continue;
    out[route] = { firstRender: shares([...first]), later: shares(later), adminAtFirstRender: [...new Set([...first].flatMap((f) => [...bytesByFile.get(f).keys()]).filter((n) => ADMIN_PACKAGES.includes(n)))] };
  }
  return { snapshot, routes: out };
}

export async function run({ build, outDir, args = {} }) {
  const next = join(build.src, ".next");
  const { routes: pages, root } = routeManifests(next);
  const chunkDir = join(next, "static/chunks");
  const sizes = new Map();
  const size = (rel) => {
    const key = rel.replace(/^\/?_next\//, "").replace(/^\//, "");
    if (!sizes.has(key)) sizes.set(key, existsSync(join(next, key)) ? measure(join(next, key)) : null);
    return sizes.get(key);
  };
  const allJs = readdirSync(chunkDir).filter((f) => f.endsWith(".js")).map((f) => `static/chunks/${f}`);
  const firstAnywhere = new Set(pages.flatMap((p) => p.js));
  const sum = (files, k) => files.reduce((a, f) => a + (size(f)?.[k] ?? 0), 0);
  const routes = pages
    .map((p) => ({
      route: p.route,
      js: { files: p.js.length, raw: sum(p.js, "raw"), gzip: sum(p.js, "gzip"), brotli: sum(p.js, "brotli") },
      css: { files: p.css.length, gzip: sum(p.css, "gzip") },
      chunks: p.js.map((f) => ({ file: f.replace("static/chunks/", ""), shared: root.includes(f), ...size(f) })).sort((a, b) => b.gzip - a.gzip),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
  const lazy = allJs
    .filter((f) => !firstAnywhere.has(f))
    .map((f) => ({ file: f.replace("static/chunks/", ""), ...size(f) }))
    .sort((a, b) => b.gzip - a.gzip);
  let comp = null;
  if (!args["no-analyze"]) {
    console.log("[bundles] next analyze --output (package composition) …");
    comp = await composition(build.src, build.buildId);
  }
  const result = { takenAt: new Date().toISOString(), root: root.map((f) => ({ file: f, ...size(f) })), routes, lazy, composition: comp };
  const file = saveResult("bundles", result, outDir);
  console.log(bundlesTable(routes));
  console.log("\nLoaded on demand (no route's first render):\n" + lazyTable(lazy));
  if (comp) for (const [route, c] of Object.entries(comp.routes)) if (!route.startsWith("/admin")) console.log(`[bundles] ${route}: first render ${c.firstRender.slice(0, 6).map((x) => `${x.name} ${(x.share * 100).toFixed(0)}%`).join(", ")}${c.adminAtFirstRender.length ? `; admin packages: ${c.adminAtFirstRender.join(", ")}` : ""}`);
  console.log(`[bundles] ${file}`);
  return result;
}

export function bundlesTable(routes) {
  return mdTable(routes, [
    ["Route (page)", (r) => r.route],
    ["First-render JS gzip", (r) => fmtBytes(r.js.gzip)],
    ["brotli", (r) => fmtBytes(r.js.brotli)],
    ["raw", (r) => fmtBytes(r.js.raw)],
    ["Files", (r) => r.js.files],
    ["CSS gzip", (r) => fmtBytes(r.css.gzip)],
    ["Largest chunks (gzip)", (r) => r.chunks.slice(0, 3).map((c) => `${c.file} ${fmtBytes(c.gzip)}`).join(", ")],
  ]);
}

export function lazyTable(lazy) {
  return mdTable(lazy, [
    ["Chunk", (r) => r.file],
    ["gzip", (r) => fmtBytes(r.gzip)],
    ["brotli", (r) => fmtBytes(r.brotli)],
    ["raw", (r) => fmtBytes(r.raw)],
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("./rig.mjs");
  const out = outDirFor("bundles");
  await withRig("bundles", (ctx) => run({ ...ctx, outDir: out, args }), { server: false });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
