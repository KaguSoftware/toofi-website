// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { residencesIn } from "@/lib/sawad/data";
import { ResidenceList } from "./ResidenceList";

const homes = residencesIn("bustan-dijla").slice(0, 4);
const base = { residences: homes, locale: "en" as const, compare: [], onToggleCompare: () => {}, revealSelected: false };

describe("ResidenceList", () => {
  it("lists homes as disclosure buttons with status in the accessible name", () => {
    const onSelect = vi.fn();
    render(<ResidenceList {...base} selectedId={null} onSelect={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons[0].getAttribute("aria-expanded")).toBe("false");
    expect(buttons[0].textContent).toContain("BD-V01");
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith("BD-V01");
  });

  it("expands details inline for the selected home, and collapses on a second click", () => {
    const onSelect = vi.fn();
    render(<ResidenceList {...base} selectedId="BD-V01" onSelect={onSelect} />);
    const region = screen.getByRole("region", { name: "BD-V01, Courtyard villa" });
    expect(region.textContent).toContain("Guide price");
    expect(region.textContent).toContain("Sample guide price in US dollars");
    const toggle = screen.getAllByRole("button", { expanded: true })[0];
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    fireEvent.click(toggle);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("disables compare when three homes are already chosen", () => {
    render(<ResidenceList {...base} selectedId="BD-V01" compare={["BD-V02", "BD-V03", "BD-V04"]} onSelect={() => {}} />);
    const compare = screen.getByRole("button", { name: "Compare" }) as HTMLButtonElement;
    expect(compare.disabled).toBe(true);
    expect(screen.getByText("Compare up to 3 homes")).toBeDefined();
  });

  it("toggles compare and links the enquiry to the home", () => {
    const onToggleCompare = vi.fn();
    const available = residencesIn("bustan-dijla").find((r) => r.status === "available")!;
    render(<ResidenceList {...base} residences={[available]} selectedId={available.id} onSelect={() => {}} onToggleCompare={onToggleCompare} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(onToggleCompare).toHaveBeenCalledWith(available.id);
    expect(screen.getByRole("link", { name: "Enquire about this home" }).getAttribute("href")).toContain(`residence=${available.id}`);
  });
});
