// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COMPOUNDS } from "@/lib/sawad/data";
import { CompoundFacts } from "./CompoundFacts";

describe("CompoundFacts", () => {
  it("lists site, landscape, phase-one mix and handover", () => {
    render(<CompoundFacts compound={COMPOUNDS[0]} locale="en" />);
    // Number and unit are joined by a non-breaking space so they never wrap apart.
    expect(screen.getByText((_, el) => el?.tagName === "DD" && el.textContent === "42\u00a0ha")).toBeDefined();
    expect(screen.getByText("62%")).toBeDefined();
    expect(screen.getByText("20 villas, 12 apartments")).toBeDefined();
    expect(screen.getByText("Late 2027")).toBeDefined();
  });

  it("uses Arabic counting and the و conjunction", () => {
    render(<CompoundFacts compound={COMPOUNDS[1]} locale="ar" />);
    expect(screen.getByText("٢٨ هكتارًا")).toBeDefined();
    expect(screen.getByText("٢٤ فيلا و٨ شقق")).toBeDefined();
  });
});
