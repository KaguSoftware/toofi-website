import { describe, expect, it } from "vitest";
import { COMPOUNDS, RESIDENCES } from "./data";
import {
  SHOWCASE_COMPOUND,
  budgetLabel,
  defaultFinderState,
  filterResidences,
  finderStateToQuery,
  isFiltered,
  matchesBudget,
  mergeFinderQuery,
  parseFinderState,
  showcaseFirst,
  toggleCompare,
} from "./finder";

const q = (s: string) => new URLSearchParams(s);

describe("finder URL state", () => {
  it("defaults to Zaitun Hills (the showcase), available + reserved, aerial view", () => {
    const s = parseFinderState(q(""));
    expect(s).toEqual(defaultFinderState());
    expect(s.compound).toBe("zaitun-hills");
    expect(s.compound).toBe(SHOWCASE_COMPOUND);
    expect(s.statuses).toEqual(["available", "reserved"]);
    expect(finderStateToQuery(s)).toBe("");
  });

  it("reads the home search form (empty values mean any)", () => {
    const s = parseFinderState(q("compound=&type=&beds="));
    expect([s.compound, s.kind, s.beds]).toEqual(["zaitun-hills", "all", null]);
    const s2 = parseFinderState(q("compound=bustan-dijla&type=villa&beds=4"));
    expect([s2.compound, s2.kind, s2.beds]).toEqual(["bustan-dijla", "villa", 4]);
    expect(finderStateToQuery(s2)).toContain("compound=bustan-dijla");
  });

  it("ignores junk and round-trips", () => {
    const s = parseFinderState(q("compound=x&type=castle&beds=9&status=sold,lost&budget=free&view=moon&compare=bd-v01,bd-v02,bd-v03,bd-v04&home=bd-a03"));
    expect(s.compound).toBe("zaitun-hills");
    expect(s.kind).toBe("all");
    expect(s.beds).toBeNull();
    expect(s.statuses).toEqual(["sold"]);
    expect(s.budget).toBeNull();
    expect(s.view).toBe("aerial");
    expect(s.compare).toEqual(["BD-V01", "BD-V02", "BD-V03"]);
    expect(s.home).toBe("BD-A03");
    expect(parseFinderState(q(finderStateToQuery(s).slice(1)))).toEqual(s);
  });

  it("falls back to defaults when no status survives parsing", () => {
    expect(parseFinderState(q("status=lost")).statuses).toEqual(["available", "reserved"]);
  });
});

describe("the showcase", () => {
  it("puts Zaitun Hills first and keeps the others in order", () => {
    const ordered = showcaseFirst(COMPOUNDS).map((c) => c.id);
    expect(ordered[0]).toBe("zaitun-hills");
    expect(ordered.slice(1)).toEqual(COMPOUNDS.map((c) => c.id).filter((id) => id !== "zaitun-hills"));
    expect(ordered).toHaveLength(COMPOUNDS.length);
  });

  it("leaves a list without the showcase as it is", () => {
    const others = COMPOUNDS.filter((c) => c.id !== SHOWCASE_COMPOUND);
    expect(showcaseFirst(others)).toEqual(others);
  });
});

describe("URL merging", () => {
  it("keeps parameters the finder does not own", () => {
    expect(mergeFinderQuery("?utm_source=x&type=villa&capture=1", "?beds=4")).toBe("?utm_source=x&capture=1&beds=4");
    expect(mergeFinderQuery("?type=villa", "")).toBe("");
  });
});

describe("filtering", () => {
  it("filters by compound, kind, bedrooms, status and budget", () => {
    const s = { ...defaultFinderState(), compound: "zaitun-hills" as const, kind: "villa" as const, beds: 4, statuses: ["available" as const, "reserved" as const, "sold" as const] };
    const out = filterResidences(RESIDENCES, s);
    expect(out.length).toBe(30); // Zaitun Hills has two rows of 15 four-bed garden villas
    expect(out.every((r) => r.compound === "zaitun-hills" && r.kind === "villa" && r.bedrooms === 4)).toBe(true);
    const cheap = filterResidences(RESIDENCES, { ...s, kind: "all", beds: null, budget: "under-300" });
    expect(cheap.every((r) => r.priceUsd < 300000)).toBe(true);
  });

  it("knows when filters are active", () => {
    expect(isFiltered(defaultFinderState())).toBe(false);
    expect(isFiltered({ ...defaultFinderState(), beds: 3 })).toBe(true);
    expect(isFiltered({ ...defaultFinderState(), statuses: ["available"] })).toBe(true);
  });

  it("matches budget bands at their edges", () => {
    expect(matchesBudget(300000, "300-600")).toBe(true);
    expect(matchesBudget(300000, "under-300")).toBe(false);
    expect(matchesBudget(5_000_000, "over-900")).toBe(true);
    expect(matchesBudget(1, null)).toBe(true);
  });
});

describe("compare and labels", () => {
  it("caps compare at three and toggles", () => {
    expect(toggleCompare(["A"], "A")).toEqual([]);
    expect(toggleCompare(["A", "B", "C"], "D")).toEqual(["A", "B", "C"]);
    expect(toggleCompare(["A"], "B")).toEqual(["A", "B"]);
  });

  it("labels budget bands in both languages", () => {
    expect(budgetLabel("under-300", "en")).toBe("Under $300k");
    expect(budgetLabel("300-600", "en")).toBe("$300k to $600k");
    expect(budgetLabel("over-900", "en")).toBe("$900k and above");
    expect(budgetLabel("under-300", "ar")).toBe("أقل من ٣٠٠ ألف دولار");
    expect(budgetLabel("600-900", "ar")).toBe("من ٦٠٠ إلى ٩٠٠ ألف دولار");
    expect(budgetLabel("over-900", "ar")).toBe("٩٠٠ ألف دولار فأكثر");
  });
});
