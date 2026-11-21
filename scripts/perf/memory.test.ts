import { describe, expect, it } from "vitest";
import { memoryTable } from "./memory.mjs";

describe("memoryTable", () => {
  it("shows each reading, and the renders per second only where the scene was left", () => {
    const row = { label: "route closed 1", url: "/compounds", heapUsed: 20_600_000, nodes: 1372, listeners: 457, liveContexts: 1, gpuBytes: 214_670_000, renderers: [{}], rendersPerSecond: 60 };
    const t = memoryTable([row, { ...row, label: "explorer open 1", url: "/", rendersPerSecond: undefined }]);
    expect(t).toContain("| route closed 1 | /compounds | 20.60 MB | 1372 | 457 | 1 | 214.67 MB | 1 | 60 |");
    expect(t).toContain("| explorer open 1 | / | 20.60 MB | 1372 | 457 | 1 | 214.67 MB | 1 |  |");
  });
});
