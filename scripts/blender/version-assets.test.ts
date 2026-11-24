import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASIS, HASH_LENGTH, MAP_PATH, PUBLIC_DIR, VERSIONED_PATTERN, checkVersions, hashOf, readMap, shippedPath, stableName, versionAll, versionedName } from "./version-assets.mjs";

/** A public folder with the scene's three asset folders. */
function publicDir(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "public-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe("names", () => {
  it("puts the hash before the last extension and reads it back off", () => {
    const h = hashOf(Buffer.from("x"));
    expect(h).toMatch(new RegExp(`^[0-9a-f]{${HASH_LENGTH}}$`));
    expect(versionedName("day-buildings-high.half.ktx2", h)).toBe(`day-buildings-high.half.${h}.ktx2`);
    expect(stableName(`day-buildings-high.half.${h}.ktx2`)).toBe("day-buildings-high.half.ktx2");
    expect(stableName("compound-zaitun-high.glb")).toBeNull();
    expect(() => versionedName("noext", h)).toThrow(/extension/);
  });

  it("marks only versioned paths as safe to cache for a year", () => {
    const h = "0123456789";
    expect(VERSIONED_PATTERN.test(`/sawad/models/compound-zaitun-far-low.${h}.glb`)).toBe(true);
    expect(VERSIONED_PATTERN.test(`/sawad/lightmaps/zaitun/lightmaps.${h}.json`)).toBe(true);
    expect(VERSIONED_PATTERN.test(`/sawad/basis/${h}/basis_transcoder.wasm`)).toBe(true);
    expect(VERSIONED_PATTERN.test(`/sawad/reel/zaitun-tour-wide.${h}.mp4`)).toBe(true);
    expect(VERSIONED_PATTERN.test("/sawad/reel/zaitun-tour-wide.mp4")).toBe(false);
    expect(VERSIONED_PATTERN.test("/sawad/models/compound-zaitun-far-low.glb")).toBe(false);
    expect(VERSIONED_PATTERN.test("/sawad/models/compound-zaitun.manifest.json")).toBe(false);
    expect(VERSIONED_PATTERN.test("/sawad/scene-zaitun-aerial.jpg")).toBe(false);
  });
});

describe("versionAll", () => {
  it("renames each fresh output with its hash, versions the transcoder folder, and maps stable to versioned paths", () => {
    const dir = publicDir({
      "sawad/models/far-low.glb": "far",
      "sawad/models/compound-zaitun.manifest.json": "{}",
      "sawad/lightmaps/zaitun/lightmaps.json": "{}",
      "sawad/lightmaps/zaitun/day-site-high.ktx2": "ktx",
      "sawad/reel/zaitun-tour-wide.mp4": "tour",
      "sawad/reel/notes.txt": "not fetched",
      "sawad/basis/basis_transcoder.js": "js",
      "sawad/basis/basis_transcoder.wasm": "wasm",
    });
    const { map } = versionAll(dir);
    const far = `far-low.${hashOf(Buffer.from("far"))}.glb`;
    const basis = hashOf(Buffer.from("js"), Buffer.from("wasm"));
    expect(map).toEqual({
      "/sawad/basis/": `/sawad/basis/${basis}/`,
      "/sawad/lightmaps/zaitun/day-site-high.ktx2": `/sawad/lightmaps/zaitun/day-site-high.${hashOf(Buffer.from("ktx"))}.ktx2`,
      "/sawad/lightmaps/zaitun/lightmaps.json": `/sawad/lightmaps/zaitun/lightmaps.${hashOf(Buffer.from("{}"))}.json`,
      "/sawad/models/far-low.glb": `/sawad/models/${far}`,
      "/sawad/reel/zaitun-tour-wide.mp4": `/sawad/reel/zaitun-tour-wide.${hashOf(Buffer.from("tour"))}.mp4`,
    });
    expect(readdirSync(join(dir, "sawad/models")).sort()).toEqual(["compound-zaitun.manifest.json", far]);
    expect(readdirSync(join(dir, "sawad/reel")).sort()).toEqual(["notes.txt", `zaitun-tour-wide.${hashOf(Buffer.from("tour"))}.mp4`]);
    for (const f of BASIS.files) expect(existsSync(join(dir, "sawad/basis", basis, f))).toBe(true);
    expect(checkVersions(dir, map)).toEqual([]);
  });

  it("replaces the old version of a file when the pipeline writes it again, and is stable when nothing changed", () => {
    const dir = publicDir({ "sawad/models/far-low.glb": "v1", "sawad/basis/basis_transcoder.js": "a", "sawad/basis/basis_transcoder.wasm": "b" });
    const first = versionAll(dir).map;
    expect(versionAll(dir).map).toEqual(first);
    writeFileSync(join(dir, "sawad/models/far-low.glb"), "v2");
    writeFileSync(join(dir, "sawad/basis/basis_transcoder.js"), "c");
    writeFileSync(join(dir, "sawad/basis/basis_transcoder.wasm"), "d");
    const second = versionAll(dir).map;
    expect(second["/sawad/models/far-low.glb"]).toBe(`/sawad/models/far-low.${hashOf(Buffer.from("v2"))}.glb`);
    expect(readdirSync(join(dir, "sawad/models"))).toEqual([`far-low.${hashOf(Buffer.from("v2"))}.glb`]);
    expect(readdirSync(join(dir, "sawad/basis"))).toEqual([hashOf(Buffer.from("c"), Buffer.from("d"))]);
  });

  it("checkVersions names an unversioned file and a stale or dangling map entry", () => {
    const dir = publicDir({ "sawad/models/new.glb": "n" });
    expect(checkVersions(dir, { "/sawad/models/gone.glb": "/sawad/models/gone.0123456789.glb" })).toEqual([
      "/sawad/models/new.glb has no version: run node scripts/blender/version-assets.mjs",
      "the map names /sawad/models/gone.glb, which is not in public/",
    ]);
  });
});

describe("shippedPath", () => {
  it("prefers a fresh stable-named output, then the versioned file the map names", () => {
    const dir = publicDir({ "sawad/models/a.glb": "fresh", "sawad/models/b.0123456789.glb": "kept" });
    const map = { "/sawad/models/b.glb": "/sawad/models/b.0123456789.glb" };
    expect(readFileSync(shippedPath("/sawad/models/a.glb", { publicDir: dir, map }), "utf8")).toBe("fresh");
    expect(readFileSync(shippedPath("/sawad/models/b.glb", { publicDir: dir, map }), "utf8")).toBe("kept");
    expect(() => shippedPath("/sawad/models/c.glb", { publicDir: dir, map })).toThrow(/no such file/);
  });
});

describe("the shipped files", () => {
  it("are all versioned, and the map the scene reads matches them", () => {
    expect(checkVersions(PUBLIC_DIR, readMap(MAP_PATH))).toEqual([]);
  });
});
