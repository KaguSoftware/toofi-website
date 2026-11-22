import { describe, expect, it } from "vitest";
import { bytesByKind, COMPOUND_IDS, switchTable } from "./switch.mjs";

describe("bytesByKind", () => {
  it("adds up bytes per file kind", () => {
    expect(bytesByKind([{ kind: "model", bytes: 5 }, { kind: "js", bytes: 2 }, { kind: "model", bytes: 7 }])).toEqual({ model: 12, js: 2 });
  });
});

describe("switchTable", () => {
  it("prints a row per profile and starting compound", () => {
    const t = switchTable([{ profile: "phone", from: COMPOUND_IDS[0], to: COMPOUND_IDS[1], median: { readyMs: 3000, model: 1000, switchMs: 2000, switchModel: 500 } }]);
    expect(t).toContain("zaitun-hills");
  });
});
