import { describe, expect, it } from "vitest";
import { freePort, workDir } from "./rig.mjs";

describe("rig", () => {
  it("keeps one snapshot folder per checkout", () => {
    const a = workDir("/repos/toofi-website");
    expect(a).toMatch(/work\/toofi-website-[0-9a-f]{8}$/);
    expect(workDir("/repos/toofi-website")).toBe(a);
    expect(workDir("/repos/.claude/worktrees/toofi-website")).not.toBe(a);
  });

  it("finds a free local port", async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });
});
