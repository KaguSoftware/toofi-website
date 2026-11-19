import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filmShots } from "./shots.mjs";

/**
 * storyboard.py renders the boards in Blender; this checks what it wrote against the shot list,
 * so a changed camera can't ship with stale frames. Re-render with:
 *   blender -b --factory-startup -P scripts/blender/film/storyboard.py -- --boards
 */
const here = fileURLToPath(new URL(".", import.meta.url));
const boardsDir = join(here, "storyboard");
const index = JSON.parse(readFileSync(join(boardsDir, "frames.json"), "utf8")) as {
  width: number;
  boards: Array<{ shot: string; at: number; frame: number; file: string; light: number }>;
};
const shots = filmShots();
const script = readFileSync(join(here, "storyboard.py"), "utf8");

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(path: string): { width: number; height: number } {
  const b = readFileSync(path);
  expect(b[0] === 0xff && b[1] === 0xd8, `${path} is a JPEG`).toBe(true);
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const length = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  throw new Error(`no frame header in ${path}`);
}

describe("storyboard frames", () => {
  it("has a board for every planned frame of every shot, and nothing else", () => {
    const want = shots.flatMap((s) => s.boards.map((at) => `${s.id}@${at}`));
    expect(index.boards.map((b) => `${b.shot}@${b.at}`).sort()).toEqual(want.sort());
  });

  it("renders each board at the frame the shot list puts it on, in the right light", () => {
    for (const b of index.boards) {
      const shot = shots.find((s) => s.id === b.shot)!;
      expect(b.frame).toBe(shot.startFrame + Math.round(b.at * (shot.endFrame - shot.startFrame)));
      const light = shot.light === "day" ? 0 : shot.light === "dusk" ? 1 : (b.frame - shot.startFrame) / (shot.endFrame - shot.startFrame);
      expect(b.light).toBeCloseTo(light, 3);
    }
  });

  it("keeps every board as a 16:9 JPEG on disk", () => {
    for (const b of index.boards) {
      const path = join(boardsDir, b.file);
      expect(existsSync(path), b.file).toBe(true);
      const { width, height } = jpegSize(path);
      expect(width).toBe(index.width);
      expect(height).toBe(Math.round((index.width * 9) / 16));
    }
  });

  it("builds the greybox from the generated layout and shot list, on the same axes as the model", () => {
    expect(script).toMatch(/def to_b\(x, y, z\):\s+return Vector\(\(x, -z, y\)\)/);
    const build = readFileSync(join(here, "..", "build_compound.py"), "utf8");
    expect(build).toMatch(/return Vector\(\(x, -z, y\)\)/);
    expect(script).toContain('os.path.join(BLENDER_DIR, "layout.json")');
    expect(script).toContain('os.path.join(HERE, "shots.json")');
    // Nothing is placed by hand: every building comes from the masterplan section of the layout.
    for (const key of ['plan["villas"]', 'plan["apartments"]', 'plan["amenities"]', 'plan["gates"]', 'plan["roads"]', 'plan["walls"]', 'plan["lamps"]']) expect(script).toContain(key);
  });
});
