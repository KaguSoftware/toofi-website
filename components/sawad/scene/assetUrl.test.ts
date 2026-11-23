import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetUrl } from "./assetUrl";
import versions from "./assetVersions.json";

describe("assetUrl", () => {
  it("turns a stable asset path into its versioned one", () => {
    expect(assetUrl("/sawad/models/compound-zaitun-far-low.glb")).toMatch(/^\/sawad\/models\/compound-zaitun-far-low\.[0-9a-f]{10}\.glb$/);
    expect(assetUrl("/sawad/lightmaps/zaitun/lightmaps.json")).toMatch(/^\/sawad\/lightmaps\/zaitun\/lightmaps\.[0-9a-f]{10}\.json$/);
    expect(assetUrl("/sawad/basis/")).toMatch(/^\/sawad\/basis\/[0-9a-f]{10}\/$/);
  });

  it("leaves a path outside the versioned set as it is", () => {
    expect(assetUrl("/sawad/scene-zaitun-aerial.jpg")).toBe("/sawad/scene-zaitun-aerial.jpg");
  });

  it("points only at files that exist in public/", () => {
    for (const target of Object.values(versions as Record<string, string>)) expect(existsSync(join(process.cwd(), "public", target)), target).toBe(true);
  });
});
