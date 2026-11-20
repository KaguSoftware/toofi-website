import { describe, expect, it } from "vitest";
import { planApartmentBlocks, planVilla } from "../scene/layout";
import type { SceneMarker } from "../scene/types";
import { pickUnit, unitBox, unitBoxes } from "./units";

const marker = (kind: SceneMarker["kind"], slot: number) => ({ id: `${kind}-${slot}`, kind, slot });

describe("unitBox", () => {
  it("wraps a villa's whole volume with a skin", () => {
    const v = planVilla(4);
    const box = unitBox(marker("villa", 4));
    expect(box.id).toBe("villa-4");
    expect(box.center).toEqual([v.x, v.y + v.height / 2, v.z]);
    expect(box.size[0]).toBeCloseTo(v.width + 0.35, 9);
    expect(box.size[1]).toBeCloseTo(v.height + 0.35, 9);
    expect(box.size[2]).toBeCloseTo(v.depth + 0.35, 9);
  });

  it("makes an apartment one floor of its block, with the floor's stepped depth", () => {
    const blocks = planApartmentBlocks();
    const floors = blocks[0].floors;
    const slot = 1 * floors + 2; // block 1, third floor
    const b = blocks[1];
    const box = unitBox(marker("apartment", slot));
    expect(box.center[0]).toBe(b.x);
    expect(box.center[1]).toBeCloseTo(b.y + 2.5 * b.floorHeight, 9);
    expect(box.center[2]).toBeCloseTo(b.backZ + b.floorDepths[2] / 2, 9);
    expect(box.size[1]).toBe(b.floorHeight);
    expect(box.size[2]).toBeCloseTo(b.floorDepths[2] + 0.35, 9);
    expect(box.size[0]).toBeCloseTo(b.width + 0.35, 9);
  });

  it("wraps apartment slots around, including negative ones", () => {
    const blocks = planApartmentBlocks();
    const count = blocks.length * blocks[0].floors;
    expect(unitBox(marker("apartment", count + 3)).center).toEqual(unitBox(marker("apartment", 3)).center);
    expect(unitBox(marker("apartment", -1)).center).toEqual(unitBox(marker("apartment", count - 1)).center);
  });

  it("maps a list of markers one to one", () => {
    const boxes = unitBoxes([marker("villa", 0), marker("apartment", 0)]);
    expect(boxes.map((b) => b.id)).toEqual(["villa-0", "apartment-0"]);
  });
});

describe("pickUnit", () => {
  const hit = (distance: number, userData: Record<string, unknown>) => ({ distance, object: { userData } });

  it("picks the nearest hit that carries a unit id", () => {
    expect(pickUnit([hit(9, { unit: "far" }), hit(2, { unit: "near" }), hit(5, { unit: "mid" })])).toBe("near");
  });

  it("ignores hits without a string unit, even if nearer", () => {
    expect(pickUnit([hit(1, {}), hit(1.5, { unit: 7 }), hit(4, { unit: "villa-2" })])).toBe("villa-2");
  });

  it("is null when nothing is a home", () => {
    expect(pickUnit([])).toBeNull();
    expect(pickUnit([hit(1, { other: true })])).toBeNull();
  });
});
