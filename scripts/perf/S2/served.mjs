#!/usr/bin/env node
/**
 * What a public page really tells the browser to fetch (search track S2). Serves the rig's
 * production build, fetches a page's HTML and lists every script chunk it references (script
 * tags, preloads, and the chunk names inside the RSC payload), with real gzip size, and flags
 * the chunks that contain the admin editor (ProseMirror, tiptap, dnd-kit). It loads no page in
 * a browser and times nothing, so it is build/HTML evidence; trace.mjs has observed requests.
 *
 *   node scripts/perf/S2/served.mjs [--routes /,/ar,/compounds]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { fmtBytes, mdTable, parseArgs, saveResult } from "../lib.mjs";

/** Strings only the admin editor's packages contain. */
export const EDITOR_MARKERS = ["ProseMirror", "prosemirror", "@tiptap", "tiptap", "dnd-kit", "DndContext", "useSortable"];

/** Every `_next/static/...js` URL the HTML mentions, in first-seen order. */
export function chunkUrls(html) {
  const seen = new Set();
  for (const m of html.matchAll(/(?:\/_next\/)?static\/chunks\/[A-Za-z0-9_.~-]+\.js/g)) seen.add(m[0].replace(/^\/_next\//, ""));
  return [...seen];
}

/** How many editor markers a chunk's text contains. */
export function editorMarkers(text) {
  return EDITOR_MARKERS.filter((m) => text.includes(m));
}

export async function run({ baseUrl, build, outDir, args = {} }) {
  const routes = String(args.routes ?? "/,/ar,/compounds").split(",");
  const next = join(build.src, ".next");
  const rows = [];
  for (const route of routes) {
    const res = await fetch(new URL(route, baseUrl));
    const html = await res.text();
    const tags = [...html.matchAll(/<script([^>]*)\ssrc="([^"]+)"([^>]*)>/g)].map((m) => ({ url: m[2].replace(/^\/_next\//, "").replace(/\?.*$/, ""), noModule: /\snoModule\b/i.test(m[1] + m[3]) }));
    const tagged = new Set(tags.map((t) => t.url));
    const noModule = new Set(tags.filter((t) => t.noModule).map((t) => t.url));
    const urls = chunkUrls(html);
    const chunks = urls.map((u) => {
      const buf = readFileSync(join(next, u));
      return { file: u.replace("static/chunks/", ""), gzip: gzipSync(buf, { level: 9 }).length, scriptTag: tagged.has(u), noModule: noModule.has(u), editor: editorMarkers(buf.toString("utf8")) };
    });
    rows.push({ route, status: res.status, htmlBytes: Buffer.byteLength(html), chunks });
  }
  const file = saveResult("served", { takenAt: new Date().toISOString(), rows }, outDir);
  for (const r of rows) {
    const total = r.chunks.reduce((a, c) => a + c.gzip, 0);
    const ed = r.chunks.filter((c) => c.editor.length);
    console.log(`\n${r.route} (HTTP ${r.status}, html ${fmtBytes(r.htmlBytes)}): ${r.chunks.length} chunks named, ${fmtBytes(total)} gzip; with editor code: ${ed.length ? ed.map((c) => `${c.file} ${fmtBytes(c.gzip)} [${c.editor.join(",")}]`).join("; ") : "none"}`);
    console.log(mdTable(r.chunks, [["Chunk", (c) => c.file], ["gzip", (c) => fmtBytes(c.gzip)], ["script tag", (c) => (c.scriptTag ? (c.noModule ? "nomodule" : "yes") : "no")], ["editor markers", (c) => c.editor.join(", ") || "-"]]));
  }
  console.log(`[served] ${file}`);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { withRig, outDirFor } = await import("../rig.mjs");
  const out = outDirFor("S2-served");
  await withRig("S2-served", (ctx) => run({ ...ctx, outDir: out, args }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
