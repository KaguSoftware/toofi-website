import { describe, expect, it } from "vitest";
import { excerpt, findAll, parsePosition } from "./where.mjs";

const SOURCE = "const a=1;\nfunction link(p){return gl.getProgramParameter(p,35714)}\nlet z=0;";

describe("excerpt", () => {
  it("shows the code around a zero-based line and column, with the position marked", () => {
    expect(excerpt(SOURCE, 1, 9, 6)).toBe("ction ⟦⟧link(p");
  });

  it("clips at the ends of the file", () => {
    expect(excerpt(SOURCE, 0, 0, 5)).toBe("⟦⟧const");
    expect(excerpt(SOURCE, 2, 8, 4)).toBe("z=0;⟦⟧");
  });

  it("is null for a position outside the file", () => {
    expect(excerpt(SOURCE, 9, 0)).toBeNull();
    expect(excerpt(SOURCE, 2, 500)).toBeNull();
  });
});

describe("findAll", () => {
  it("returns every occurrence as a zero-based line and column", () => {
    expect(findAll(SOURCE, "getProgramParameter")).toEqual([{ line: 1, column: 27 }]);
    expect(findAll("ab\nab ab", "ab")).toEqual([
      { line: 0, column: 0 },
      { line: 1, column: 0 },
      { line: 1, column: 3 },
    ]);
  });

  it("stops at the limit and finds nothing for a missing text", () => {
    expect(findAll("aaaa", "a", 2)).toHaveLength(2);
    expect(findAll(SOURCE, "nope")).toEqual([]);
  });
});

describe("parsePosition", () => {
  it("splits chunk, line and column", () => {
    expect(parsePosition("24_3bl72memt3.js:0:512345")).toEqual({ file: "24_3bl72memt3.js", line: 0, column: 512345 });
    expect(parsePosition("abc.js")).toEqual({ file: "abc.js", line: null, column: null });
    expect(parsePosition("abc.mjs:3")).toEqual({ file: "abc.mjs", line: 3, column: null });
  });

  it("rejects anything that is not a script position", () => {
    expect(parsePosition("")).toBeNull();
    expect(parsePosition("styles.css:1:2")).toBeNull();
  });
});
