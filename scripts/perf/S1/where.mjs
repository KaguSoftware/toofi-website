#!/usr/bin/env node
/**
 * Shows the built code at a position the CPU profile names (search track S1). The production
 * build has no source maps, so a frame reads `fn chunk.js:line:column`; this prints the
 * minified code around it, which is enough to recognise the source function.
 *
 *   node scripts/perf/S1/where.mjs 24_3bl72memt3.js:0:512345 [--radius 300]
 *   node scripts/perf/S1/where.mjs 24_3bl72memt3.js --find "getProgramInfoLog"
 *
 * Reads the chunks of the rig's current build of this checkout; no timing, no lock.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "../lib.mjs";

/** The text around a zero-based line and column, with the position marked by `⟦⟧`. */
export function excerpt(source, line, column, radius = 240) {
  const lines = source.split("\n");
  if (line < 0 || line >= lines.length) return null;
  let offset = column;
  for (let i = 0; i < line; i++) offset += lines[i].length + 1;
  if (offset > source.length) return null;
  const from = Math.max(0, offset - radius);
  const to = Math.min(source.length, offset + radius);
  return `${source.slice(from, offset)}⟦⟧${source.slice(offset, to)}`;
}

/** Zero-based { line, column } of every occurrence of `needle` (at most `limit`). */
export function findAll(source, needle, limit = 20) {
  const out = [];
  for (let at = source.indexOf(needle); at !== -1 && out.length < limit; at = source.indexOf(needle, at + 1)) {
    const before = source.slice(0, at);
    const line = before.split("\n").length - 1;
    out.push({ line, column: at - (before.lastIndexOf("\n") + 1) });
  }
  return out;
}

/** `chunk.js:line:column` to its parts; line and column are optional. */
export function parsePosition(text) {
  const m = /^(.+?\.m?js)(?::(\d+))?(?::(\d+))?$/.exec(text);
  if (!m) return null;
  return { file: m[1], line: m[2] === undefined ? null : Number(m[2]), column: m[3] === undefined ? null : Number(m[3]) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pos = parsePosition(String(args._[0] ?? ""));
  if (!pos) {
    console.error("usage: where.mjs <chunk.js>:<line>:<column> [--radius N] | <chunk.js> --find <text>");
    process.exit(2);
  }
  const { workDir } = await import("../rig.mjs");
  const file = join(workDir(), "src/.next/static/chunks", pos.file);
  if (!existsSync(file)) {
    console.error(`no such chunk in the rig's build: ${file}`);
    process.exit(1);
  }
  const source = readFileSync(file, "utf8");
  const radius = Number(args.radius ?? 240);
  if (typeof args.find === "string") {
    for (const hit of findAll(source, args.find)) console.log(`${pos.file}:${hit.line}:${hit.column}\n${excerpt(source, hit.line, hit.column, radius)}\n`);
    return;
  }
  console.log(excerpt(source, pos.line ?? 0, pos.column ?? 0, radius) ?? "position is outside the file");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
