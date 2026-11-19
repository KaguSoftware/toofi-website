import { describe, expect, it } from "vitest";
import { parseExperience, parseView, showsExplorer, showsFilm } from "./tweaks";

describe("owner tweaks", () => {
  it("accepts known values, case and space insensitive", () => {
    expect(parseExperience(" Film ")).toBe("film");
    expect(parseExperience("explorer")).toBe("explorer");
    expect(parseView("TERRACE")).toBe("terrace");
  });

  it("falls back on typos so the page never breaks", () => {
    expect(parseExperience("flim")).toBe("both");
    expect(parseExperience(undefined)).toBe("both");
    expect(parseView("roof")).toBe("flight");
    expect(parseView(null, "aerial")).toBe("aerial");
  });

  it("maps experiences to what is shown", () => {
    expect([showsFilm("both"), showsExplorer("both")]).toEqual([true, true]);
    expect([showsFilm("film"), showsExplorer("film")]).toEqual([true, false]);
    expect([showsFilm("explorer"), showsExplorer("explorer")]).toEqual([false, true]);
  });
});
