import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Runs the 28 ha placement tests of scripts/blender/build_compound.py (test_placement.py) in
 * headless Blender: polyline helpers, terrain grid, garden steps, villa plots, and the in-place
 * site and garden assets against layout.json. Skipped where Blender is not installed (set BLENDER=/path).
 */
const BLENDER = [process.env.BLENDER, "/Applications/Blender.app/Contents/MacOS/Blender", "/opt/homebrew/bin/blender", "/usr/bin/blender"].find(
  (p): p is string => !!p && existsSync(p),
);
const script = fileURLToPath(new URL("./test_placement.py", import.meta.url));

describe.skipIf(!BLENDER)("build_compound.py 28 ha placement (headless Blender)", () => {
  it("passes test_placement.py", () => {
    const run = spawnSync(BLENDER!, ["-b", "--factory-startup", "--python-exit-code", "1", "-P", script], { encoding: "utf8", timeout: 120_000 });
    const output = `${run.stdout}\n${run.stderr}`;
    expect(run.status, output).toBe(0);
    expect(output).toMatch(/^OK$/m);
  }, 150_000);
});
