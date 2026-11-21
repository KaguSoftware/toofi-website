import { describe, expect, it } from "vitest";
import { ROUTES, lighthouseTable, medianRun } from "./lighthouse.mjs";

describe("lighthouse", () => {
  it("runs the five pages the plan names", () => {
    expect(ROUTES).toEqual(["/", "/ar", "/compounds", "/residences", "/contact"]);
  });

  it("picks the run with the median performance score", () => {
    const runs = [70, 58, 91, 62, 66].map((score, i) => ({ score, i }));
    expect(medianRun(runs)).toEqual({ score: 66, i: 4 });
    expect(medianRun([{ score: 50 }, { score: 60 }])).toEqual({ score: 50 });
  });

  it("shows every run's score next to the median", () => {
    const row = { form: "mobile", route: "/", scores: [58, 60, 57], median: { score: 58, fcpMs: 1570, lcpMs: 4350, tbtMs: 1340, cls: 0, siMs: 3610, accessibility: 100, bestPractices: 100, seo: 85 } };
    expect(lighthouseTable([row])).toContain("| mobile | / | 58 (58, 60, 57) | 1.57 s | 4.35 s | 1.34 s | 0.000 | 3.61 s | 100 / 100 / 85 |");
  });
});
