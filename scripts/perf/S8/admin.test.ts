import { describe, expect, it } from "vitest";
import { adminTable, PANEL_ROUTES } from "./admin.mjs";

describe("adminTable", () => {
  it("prints a row per step", () => {
    const t = adminTable([{ profile: "desktop", step: PANEL_ROUTES[1], ms: 900, fcpMs: 300, lcpMs: 400, blockingMs: 10, longestMs: 60, bytes: 500000, js: 300000 }]);
    expect(t).toContain("/admin/pages");
    expect(t).toContain("desktop");
  });
});
