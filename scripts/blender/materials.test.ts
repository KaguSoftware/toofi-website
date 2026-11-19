import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Runs the material tests of scripts/blender/build_compound.py (test_materials.py) in headless
 * Blender: atlas layout and texel density, tint and noise maths, procedural tiles, dust colours
 * and the glTF export of COLOR_0. Skipped where Blender is not installed (set BLENDER=/path).
 */
const BLENDER = [process.env.BLENDER, "/Applications/Blender.app/Contents/MacOS/Blender", "/opt/homebrew/bin/blender", "/usr/bin/blender"].find(
  (p): p is string => !!p && existsSync(p),
);
const script = fileURLToPath(new URL("./test_materials.py", import.meta.url));

describe.skipIf(!BLENDER)("build_compound.py materials (headless Blender)", () => {
  it("passes test_materials.py", () => {
    const run = spawnSync(BLENDER!, ["-b", "--factory-startup", "--python-exit-code", "1", "-P", script], { encoding: "utf8", timeout: 120_000 });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, output).toBe(0);
    expect(output).toMatch(/^OK$/m);
  }, 150_000);
});
