// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComparePanel } from "./ComparePanel";

describe("ComparePanel", () => {
  it("renders nothing without homes (and ignores unknown ids)", () => {
    const { container } = render(<ComparePanel ids={["XX-V99"]} locale="en" onRemove={() => {}} onClear={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("compares homes across compounds side by side", () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(<ComparePanel ids={["BD-V01", "ZH-A01"]} locale="en" onRemove={onRemove} onClear={onClear} />);
    expect(screen.getByRole("region", { name: "Compare" })).toBeDefined();
    expect(screen.getByText("Compare (2/3)")).toBeDefined();
    // Collapsed by default so the sticky bar never covers the list.
    expect(screen.queryByRole("table")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show comparison" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getByRole("row", { name: /Holding Bustan Dijla Zaitun Hills/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove from compare: ZH-A01" }));
    expect(onRemove).toHaveBeenCalledWith("ZH-A01");
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("uses Arabic digits in the count", () => {
    render(<ComparePanel ids={["BD-V01"]} locale="ar" onRemove={() => {}} onClear={() => {}} />);
    expect(screen.getByText("المقارنة (١/٣)")).toBeDefined();
  });
});
