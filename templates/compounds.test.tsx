// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { makePage, pageEditables } = await import("@/test/sawad-helpers");
const { compoundsTemplate } = await import("./compounds");

const renderPage = (slug: string) =>
  render(<>{compoundsTemplate.component({ page: makePage(slug, "compounds"), c: pageEditables() }) as React.ReactNode}</>);

describe("compounds template", () => {
  it("shows the portfolio with all five holdings and the phase-one total", () => {
    renderPage("/compounds");
    const tables = screen.getAllByRole("table");
    const portfolio = tables[0];
    expect(within(portfolio).getAllByRole("row")).toHaveLength(1 + 5 + 1);
    expect(within(portfolio).getByRole("rowheader", { name: "Al-Nakhla Court" })).toBeDefined();
    expect(within(portfolio).getByText("96")).toBeDefined();
  });

  it("gives each compound a profile with its residence types and guide prices", () => {
    renderPage("/compounds");
    const profile = screen.getByRole("region", { name: "Zaitun Hills" });
    expect(profile.getAttribute("data-variant")).toBe("zaitun");
    expect(within(profile).getByRole("link", { name: "See the residences: Zaitun Hills" }).getAttribute("href")).toBe("/residences?compound=zaitun-hills");
    expect(within(profile).getAllByRole("rowheader").map((r) => r.textContent)).toContain("River apartment");
    const shatt = screen.getByRole("region", { name: "Shatt Gardens" });
    expect(within(shatt).getByRole("link", { name: /Register interest/ })).toBeDefined();
  });

  it("makes wide tables keyboard-scrollable regions", () => {
    renderPage("/compounds");
    expect(screen.getByRole("region", { name: "Sawad portfolio" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("region", { name: "Residence types: Shatt Gardens" })).toBeDefined();
  });

  it("renders Arabic digits on Arabic pages", () => {
    renderPage("/ar/compounds");
    expect(screen.getByRole("heading", { level: 1, name: "المجمّعات" })).toBeDefined();
    expect(screen.getAllByText("٩٦").length).toBeGreaterThan(0);
  });
});
