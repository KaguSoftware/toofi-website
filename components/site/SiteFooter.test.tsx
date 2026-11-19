// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { globalEditables } = await import("@/test/sawad-helpers");
const { SiteFooter } = await import("./SiteFooter");

describe("SiteFooter", () => {
  it("lists every page and the three galleries, and says the content is a sample", () => {
    render(<SiteFooter g={globalEditables()} locale="en" />);
    for (const name of ["Find a residence", "Compounds", "What we do", "Our story", "Contact"]) {
      expect(screen.getByRole("link", { name })).toBeDefined();
    }
    expect(screen.getByText("Baghdad gallery")).toBeDefined();
    expect(screen.getByText("Basra gallery")).toBeDefined();
    expect(screen.getByText(/sample content/)).toBeDefined();
  });

  it("reads Arabic global keys on Arabic pages", () => {
    render(<SiteFooter g={globalEditables({ "ar.footer.tagline": "نص محفوظ" })} locale="ar" />);
    expect(screen.getByText("نص محفوظ")).toBeDefined();
    expect(screen.getByRole("link", { name: "ابحث عن منزل" }).getAttribute("href")).toBe("/ar/residences");
  });
});
