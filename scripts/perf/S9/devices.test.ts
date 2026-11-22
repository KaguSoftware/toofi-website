import { describe, expect, it } from "vitest";
import { DEVICES, decide, matrix, matrixTable } from "./devices.mjs";

const byName = (part: string) => {
  const d = DEVICES.find((x: { name: string }) => x.name.includes(part));
  if (!d) throw new Error(`no device ${part}`);
  return d;
};

describe("device matrix", () => {
  it("runs the shipped decision for every archetype", () => {
    const rows = matrix();
    expect(rows).toHaveLength(DEVICES.length);
    expect(rows.every((r: { renders: boolean }) => typeof r.renders === "boolean")).toBe(true);
  });

  it("keeps phones in portrait on the low tier", () => {
    expect(decide(byName("Pixel 7, Chrome, portrait"))).toMatchObject({ renders: true, tier: "low", start: 0 });
  });

  it("shows the gaps the findings rest on", () => {
    // A phone turned sideways is judged by its width and gets the 10 MB model.
    expect(decide(byName("Pixel 7, Chrome, landscape")).tier).toBe("high");
    // Thread count and memory say nothing about the GPU.
    expect(decide(byName("Intel UHD, 8 GB")).tier).toBe("high");
    expect(decide(byName("4K monitor")).tier).toBe("high");
  });

  it("sends the cases the capability check refuses to the poster", () => {
    expect(decide(byName("2 GB")).renders).toBe(false);
    expect(decide(byName("Data Saver")).renders).toBe(false);
    expect(decide(byName("effectiveType 3g")).renders).toBe(false);
    expect(decide(byName("fingerprint")).renders).toBe(false);
  });

  it("prints a row per device", () => {
    expect(matrixTable(matrix()).split("\n")).toHaveLength(DEVICES.length + 2);
  });
});
