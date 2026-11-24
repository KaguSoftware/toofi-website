#!/usr/bin/env node
/**
 * Versioned asset names (optimization track F2B, ledger T32). Every file the 3D scene fetches from
 * `public/sawad/` carries a hash of its content in its name, so a browser or a CDN may keep it for a
 * year: a changed file is a new name, never a stale copy. F5 sets the long lifetimes, for these names
 * only (`VERSIONED_PATTERN`), once this is merged.
 *
 *   node scripts/blender/version-assets.mjs           version what the pipelines wrote, rewrite the map
 *   node scripts/blender/version-assets.mjs --check   exit 1 if a file is unversioned or the map is stale
 *
 * The pipelines (export-final.sh, export-far.sh, diet.mjs, build.sh, bake-lightmaps.sh, and
 * scripts/render-story-reel.mjs for the reel's video files) keep writing
 * stable names (`compound-zaitun-far-low.glb`); this script, their last step, renames each to
 * `compound-zaitun-far-low.<hash>.glb`, removes the version it replaces, and writes the map from
 * stable public paths to versioned ones (`components/sawad/scene/assetVersions.json`), which the
 * scene reads through `assetUrl()` and so ships inside its own (hashed) script. The Basis transcoder,
 * which KTX2Loader fetches by fixed file names, moves into a folder named by its hash instead.
 *
 * Scripts that read a shipped file use `shippedPath()`: a fresh stable-named output if there is one
 * (a pipeline wrote it and versioning has not run yet), otherwise the versioned file the map names.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const ROOT = here("../../");
export const PUBLIC_DIR = join(ROOT, "public");
export const MAP_PATH = join(ROOT, "components/sawad/scene/assetVersions.json");

/**
 * What is versioned: every file the scene fetches. The model folder's JSON files are build reports,
 * never fetched, and keep their names. In the lightmap folder the PNGs left are the ones the scene
 * fetches (the dusk ground pages); the masters live in scripts/blender/lightmaps/ (ledger T49).
 * The reel is the story as video (scripts/render-story-reel.mjs writes it, experience/reel.ts names it).
 */
export const SCOPE = [
  { dir: "sawad/models", match: /\.glb$/ },
  { dir: "sawad/lightmaps/zaitun", match: /\.(ktx2|json|png)$/ },
  { dir: "sawad/reel", match: /\.mp4$/ },
];
/** KTX2Loader fetches these two by name from its transcoder path: the folder carries the version. */
export const BASIS = { dir: "sawad/basis", files: ["basis_transcoder.js", "basis_transcoder.wasm"] };

export const HASH_LENGTH = 10;
const HASHED = new RegExp(`^(.+)\\.([0-9a-f]{${HASH_LENGTH}})(\\.[A-Za-z0-9]+)$`);
/** Public paths that carry a version: safe to cache for a year (`Cache-Control: public, max-age=31536000, immutable`). */
export const VERSIONED_PATTERN = new RegExp(`^/sawad/(models/[^/]+\\.[0-9a-f]{${HASH_LENGTH}}\\.glb|lightmaps/[^/]+/[^/]+\\.[0-9a-f]{${HASH_LENGTH}}\\.(ktx2|json|png)|reel/[^/]+\\.[0-9a-f]{${HASH_LENGTH}}\\.mp4|basis/[0-9a-f]{${HASH_LENGTH}}/basis_transcoder\\.(js|wasm))$`);

/** The first HASH_LENGTH hex digits of the SHA-256 of some bytes. */
export function hashOf(...buffers) {
  const h = createHash("sha256");
  for (const b of buffers) h.update(b);
  return h.digest("hex").slice(0, HASH_LENGTH);
}

/** `day-buildings-high.half.ktx2` + hash → `day-buildings-high.half.<hash>.ktx2` (the hash goes before the last extension). */
export function versionedName(name, hash) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) throw new Error(`${name} has no extension`);
  return `${name.slice(0, dot)}.${hash}${name.slice(dot)}`;
}

/** The stable name of a versioned one (`a.<hash>.glb` → `a.glb`), or null for a name without a version. */
export function stableName(name) {
  const m = HASHED.exec(name);
  return m ? m[1] + m[3] : null;
}

/**
 * Versions one folder. A stable-named file is a new output: it is renamed with its hash and any older
 * version of it removed. A versioned file without a stable sibling is kept. Returns the folder's
 * entries, stable name → versioned name, and what it did.
 */
export function versionFolder(dir, match) {
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => match.test(n)) : [];
  const entries = {};
  const done = [];
  const fresh = new Set(names.filter((n) => !stableName(n)));
  for (const name of fresh) {
    const target = versionedName(name, hashOf(readFileSync(join(dir, name))));
    for (const old of names) if (stableName(old) === name && old !== target) {
      rmSync(join(dir, old));
      done.push({ removed: old });
    }
    renameSync(join(dir, name), join(dir, target));
    entries[name] = target;
    done.push({ versioned: name, as: target });
  }
  for (const name of names) {
    const stable = stableName(name);
    if (!stable || fresh.has(stable)) continue;
    if (entries[stable] && entries[stable] !== name) throw new Error(`${dir}: two versions of ${stable} (${entries[stable]}, ${name})`);
    entries[stable] = name;
  }
  return { entries, done };
}

/** Versions the Basis transcoder: fresh copies at the folder's top move into `<hash>/`, older hash folders go. */
export function versionBasis(dir) {
  const fresh = BASIS.files.every((f) => existsSync(join(dir, f)));
  const hashDirs = existsSync(dir) ? readdirSync(dir).filter((n) => new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`).test(n)) : [];
  if (!fresh) {
    if (hashDirs.length > 1) throw new Error(`${dir}: ${hashDirs.length} transcoder versions`);
    return { version: hashDirs[0] ?? null, done: [] };
  }
  const hash = hashOf(...BASIS.files.map((f) => readFileSync(join(dir, f))));
  const done = [];
  for (const old of hashDirs) if (old !== hash) {
    rmSync(join(dir, old), { recursive: true });
    done.push({ removed: old });
  }
  mkdirSync(join(dir, hash), { recursive: true });
  for (const f of BASIS.files) renameSync(join(dir, f), join(dir, hash, f));
  done.push({ versioned: "basis", as: hash });
  return { version: hash, done };
}

/** Versions everything in scope under `publicDir` and returns the map (stable public path → versioned public path). */
export function versionAll(publicDir = PUBLIC_DIR) {
  const map = {};
  const done = [];
  for (const { dir, match } of SCOPE) {
    const r = versionFolder(join(publicDir, dir), match);
    for (const [stable, versioned] of Object.entries(r.entries)) map[`/${dir}/${stable}`] = `/${dir}/${versioned}`;
    done.push(...r.done.map((d) => ({ dir, ...d })));
  }
  const basis = versionBasis(join(publicDir, BASIS.dir));
  if (basis.version) map[`/${BASIS.dir}/`] = `/${BASIS.dir}/${basis.version}/`;
  done.push(...basis.done.map((d) => ({ dir: BASIS.dir, ...d })));
  return { map: Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b))), done };
}

/** Problems with the files and the map as they stand: unversioned files in scope, map entries that point nowhere or are missing. */
export function checkVersions(publicDir = PUBLIC_DIR, map = readMap()) {
  const problems = [];
  const seen = {};
  for (const { dir, match } of SCOPE) {
    const folder = join(publicDir, dir);
    for (const name of existsSync(folder) ? readdirSync(folder).filter((n) => match.test(n)) : []) {
      const stable = stableName(name);
      if (!stable) problems.push(`/${dir}/${name} has no version: run node scripts/blender/version-assets.mjs`);
      else seen[`/${dir}/${stable}`] = `/${dir}/${name}`;
    }
  }
  const basisDir = join(publicDir, BASIS.dir);
  for (const f of BASIS.files) if (existsSync(join(basisDir, f))) problems.push(`/${BASIS.dir}/${f} has no version`);
  const hashDirs = existsSync(basisDir) ? readdirSync(basisDir).filter((n) => /^[0-9a-f]+$/.test(n)) : [];
  if (hashDirs.length === 1) seen[`/${BASIS.dir}/`] = `/${BASIS.dir}/${hashDirs[0]}/`;
  for (const [stable, versioned] of Object.entries(seen)) if (map[stable] !== versioned) problems.push(`the map says ${stable} → ${map[stable] ?? "nothing"}, the folder has ${versioned}`);
  for (const stable of Object.keys(map)) if (!seen[stable]) problems.push(`the map names ${stable}, which is not in public/`);
  return problems;
}

export function readMap(path = MAP_PATH) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/**
 * The file on disk for a public path (`/sawad/models/compound-zaitun-high.glb`): a fresh stable-named
 * output when one exists, otherwise the versioned file the map names. Throws when there is neither.
 */
export function shippedPath(publicPath, { publicDir = PUBLIC_DIR, map = readMap() } = {}) {
  const stable = join(publicDir, publicPath);
  if (existsSync(stable)) return stable;
  const versioned = map[publicPath];
  if (versioned && existsSync(join(publicDir, versioned))) return join(publicDir, versioned);
  throw new Error(`${publicPath}: no such file in public/ (stable or versioned)`);
}

function main() {
  if (process.argv.includes("--check")) {
    const problems = checkVersions();
    if (problems.length) {
      console.error(problems.map((p) => "  - " + p).join("\n"));
      process.exit(1);
    }
    console.log(`asset versions OK: ${Object.keys(readMap()).length} files`);
    return;
  }
  const { map, done } = versionAll();
  writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + "\n");
  for (const d of done) console.log(d.removed ? `removed ${d.dir}/${d.removed}` : `${d.dir}/${d.versioned} → ${d.as}`);
  console.log(`${Object.keys(map).length} versioned files; map: ${relative(ROOT, MAP_PATH)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
