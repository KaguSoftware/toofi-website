// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultFinderState } from "@/lib/sawad/finder";
import { FinderFilters } from "./FinderFilters";

describe("FinderFilters", () => {
  it("reports changes for kind, bedrooms and budget", () => {
    const onChange = vi.fn();
    render(<FinderFilters state={defaultFinderState()} locale="en" onChange={onChange} comingSoon={false} />);
    fireEvent.click(screen.getByLabelText("Villas"));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "villa" });
    fireEvent.click(screen.getByLabelText("4"));
    expect(onChange).toHaveBeenLastCalledWith({ beds: 4 });
    fireEvent.click(screen.getByLabelText("$300k to $600k"));
    expect(onChange).toHaveBeenLastCalledWith({ budget: "300-600" });
  });

  it("toggles statuses in a stable order and never allows zero", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FinderFilters state={defaultFinderState()} locale="en" onChange={onChange} comingSoon={false} />);
    fireEvent.click(screen.getByLabelText("Sold"));
    expect(onChange).toHaveBeenLastCalledWith({ statuses: ["available", "reserved", "sold"] });
    rerender(<FinderFilters state={{ ...defaultFinderState(), statuses: ["reserved"] }} locale="en" onChange={onChange} comingSoon={false} />);
    expect((screen.getByLabelText("Reserved") as HTMLInputElement).disabled).toBe(true);
  });

  it("hides the status filter while a compound is not yet selling", () => {
    render(<FinderFilters state={defaultFinderState()} locale="ar" onChange={() => {}} comingSoon />);
    expect(screen.queryByText("مُباع")).toBeNull();
    expect(screen.getByText("أقل من ٣٠٠ ألف دولار")).toBeDefined();
  });
});
