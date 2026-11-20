// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { residencesIn } from "@/lib/sawad/data";
import { UnitPanel } from "./UnitPanel";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const homes = residencesIn("zaitun-hills");
const villa = homes.find((r) => r.id === "ZH-V05")!;
const sold = homes.find((r) => r.status === "sold")!;
const apartment = homes.find((r) => r.kind === "apartment" && r.floor !== null)!;
const labels = { panelTitle: "Selected home", close: "Close", inFinder: "See it in the finder" };

afterEach(cleanup);

const fact = (term: string) => screen.getByText(term, { selector: "dt" }).parentElement!.querySelector("dd")!.textContent!.replace(/[  ]/g, " ");

describe("UnitPanel", () => {
  it("shows a villa's facts, price and both links", () => {
    render(<UnitPanel residence={villa} locale="en" labels={labels} onClose={() => {}} />);
    const panel = screen.getByRole("complementary", { name: labels.panelTitle });
    expect(within(panel).getByText("ZH-V05")).toBeTruthy();
    expect(within(panel).getByRole("heading", { level: 3 }).textContent).toBe("Courtyard villa");
    expect(within(panel).getByText("Available")).toBeTruthy();
    expect(fact("Bedrooms")).toBe("5 bedrooms");
    expect(fact("Built area")).toBe("520 m²");
    expect(fact("Land")).toBe("780 m²");
    expect(fact("Outlook")).toBe("River");
    expect(fact("Handover")).toBe("Mid 2028");
    expect(screen.queryByText("Floor", { selector: "dt" })).toBeNull();
    expect(within(panel).getByText("Guide price").parentElement?.textContent).toContain("$870,000");
    expect(screen.getByRole("link", { name: "Enquire about this home" }).getAttribute("href")).toBe("/contact?residence=ZH-V05&compound=zaitun-hills");
    expect(screen.getByRole("link", { name: labels.inFinder }).getAttribute("href")).toBe("/residences?compound=zaitun-hills&home=ZH-V05");
  });

  it("shows the floor and no land for an apartment", () => {
    render(<UnitPanel residence={apartment} locale="en" labels={labels} onClose={() => {}} />);
    expect(screen.getByText("Floor", { selector: "dt" })).toBeTruthy();
    expect(screen.queryByText("Land", { selector: "dt" })).toBeNull();
  });

  it("offers no enquiry for a sold home but still links to the finder", () => {
    render(<UnitPanel residence={sold} locale="en" labels={labels} onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: "Enquire about this home" })).toBeNull();
    expect(screen.getByText("Sold")).toBeTruthy();
    expect(screen.getByRole("link", { name: labels.inFinder }).getAttribute("href")).toContain(`home=${sold.id}`);
  });

  it("renders Arabic-Indic digits and an /ar/ finder link", () => {
    render(<UnitPanel residence={villa} locale="ar" labels={labels} onClose={() => {}} />);
    expect(screen.getByText("٥ غرف نوم")).toBeTruthy();
    expect(screen.getByText("٥٢٠ م²")).toBeTruthy();
    expect(screen.getByRole("link", { name: labels.inFinder }).getAttribute("href")).toBe("/ar/residences?compound=zaitun-hills&home=ZH-V05");
  });

  it("calls onClose from the close button", () => {
    const onClose = vi.fn();
    render(<UnitPanel residence={villa} locale="en" labels={labels} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
