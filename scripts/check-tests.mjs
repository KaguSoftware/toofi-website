#!/usr/bin/env node
/**
 * Test-presence gate. Every source file in app/, components/, lib/, templates/
 * (plus instrumentation.ts) must have a sibling test: Foo.tsx -> Foo.test.tsx|ts.
 *
 * Files that predate the rule are listed in scripts/untested-baseline.json.
 * The list may only shrink: a new untested file fails, and a baseline entry
 * that now has a test (or no longer exists) fails until it is removed.
 *
 *   node scripts/check-tests.mjs           check
 *   node scripts/check-tests.mjs --update  rewrite the baseline (only to remove entries)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = join(root, "scripts/untested-baseline.json");
const DIRS = ["app", "components", "lib", "templates"];
const EXEMPT = /(\.test\.[tj]sx?|\.d\.ts|\.css)$|(^|\/)(types|index)\.ts$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(root, full).split("\\").join("/"));
  }
  return out;
}

export function findUntested() {
  const files = [...DIRS.flatMap((d) => walk(join(root, d))), ...(existsSync(join(root, "instrumentation.ts")) ? ["instrumentation.ts"] : [])];
  return files
    .filter((f) => !EXEMPT.test(f))
    .filter((f) => {
      const base = f.replace(/\.(ts|tsx)$/, "");
      return !existsSync(join(root, base + ".test.ts")) && !existsSync(join(root, base + ".test.tsx"));
    })
    .sort();
}

const untested = findUntested();
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : [];

if (process.argv.includes("--update")) {
  const next = baseline.filter((f) => untested.includes(f));
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`Baseline updated: ${next.length} untested files remain.`);
  process.exit(0);
}

const missing = untested.filter((f) => !baseline.includes(f));
const stale = baseline.filter((f) => !untested.includes(f));

if (missing.length) {
  console.error("\nThese files have no test. Add a sibling Foo.test.ts(x):\n" + missing.map((f) => "  - " + f).join("\n"));
}
if (stale.length) {
  console.error("\nThese are in the baseline but now tested or deleted. Run: node scripts/check-tests.mjs --update\n" + stale.map((f) => "  - " + f).join("\n"));
}
if (missing.length || stale.length) process.exit(1);
console.log(`Test gate OK. ${baseline.length} legacy untested files remain in the baseline (goal: 0).`);
