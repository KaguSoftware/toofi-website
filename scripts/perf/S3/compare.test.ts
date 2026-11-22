import { describe, expect, it } from "vitest";
import { bandMeans, blockAverage, decodePng, strip } from "./compare.mjs";
import { floats, nodeScale } from "./simplify-probe.mjs";

const img = (w: number, h: number, fill: (x: number, y: number) => number) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    data.fill(fill(x, y), o, o + 3);
    data[o + 3] = 255;
  }
  return { width: w, height: h, data };
};

describe("compare", () => {
  it("averages blocks, which cancels per-pixel grain but keeps a real change", () => {
    const grainA = img(8, 8, (x, y) => ((x + y) % 2 ? 110 : 90));
    const grainB = img(8, 8, (x, y) => ((x + y) % 2 ? 90 : 110));
    const a = blockAverage(grainA, 2);
    const b = blockAverage(grainB, 2);
    expect([a.width, a.height]).toEqual([4, 4]);
    expect(a.data.equals(b.data)).toBe(true);
    expect(blockAverage(grainA, 1)).toBe(grainA);
  });

  it("reports the difference per horizontal band", () => {
    const a = img(4, 4, () => 0);
    const b = img(4, 4, (_, y) => (y < 2 ? 12 : 0));
    expect(bandMeans(a, b, 2)).toEqual([12, 0]);
  });

  it("writes three frames side by side", () => {
    const a = img(2, 1, () => 10);
    const out = decodePng(strip(a, img(2, 1, () => 20), img(2, 1, () => 30)));
    expect([out.width, out.height]).toEqual([6, 1]);
    expect([out.data[0], out.data[8], out.data[16]]).toEqual([10, 20, 30]);
  });
});

describe("simplify-probe helpers", () => {
  it("reads metres per stored unit from the node's matrix", () => {
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 6, 7, 1];
    expect(nodeScale({ getWorldMatrix: () => m })).toBeCloseTo(2);
  });

  it("copies an accessor's elements as floats, padding missing components", () => {
    const rows = [
      [1, 2],
      [3, 4],
    ];
    const accessor = { getCount: () => 2, getElement: (i: number, out: number[]) => (out.splice(0, out.length, ...rows[i]), out) };
    expect([...floats(accessor, 3)]).toEqual([1, 2, 0, 3, 4, 0]);
  });
});
