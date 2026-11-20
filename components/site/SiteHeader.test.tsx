// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { EditorHarness, globalEditables } = await import("@/test/sawad-helpers");
const { SiteHeader } = await import("./SiteHeader");

describe("SiteHeader", () => {
  it("links the brand home and marks the current page", () => {
    render(<SiteHeader g={globalEditables()} locale="en" path="/compounds" />);
    expect(screen.getByRole("link", { name: "Sawad Holding, home" }).getAttribute("href")).toBe("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Compounds" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Contact" }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps the brand's visible words inside its accessible name", () => {
    render(<SiteHeader g={globalEditables()} locale="en" path="/" />);
    const brand = screen.getByRole("link", { name: "Sawad Holding, home" });
    // "Sawad" and "Holding" are separate elements: without a space between them the visible text reads "SawadHolding".
    expect(brand.textContent).toBe("Sawad Holding");
    expect("sawad holding, home").toContain(brand.textContent!.toLowerCase());
  });

  it("makes Find a residence the one primary action", () => {
    render(<SiteHeader g={globalEditables()} locale="en" path="/residences" />);
    const cta = screen.getByRole("link", { name: "Find a residence" });
    expect(cta.className).toContain("btn-primary");
    expect(cta.getAttribute("aria-current")).toBe("page");
  });

  it("switches language to the same page", () => {
    render(<SiteHeader g={globalEditables()} locale="ar" path="/ar/our-story" />);
    const lang = screen.getByRole("link", { name: "Read this page in English" });
    expect(lang.getAttribute("href")).toBe("/our-story");
    expect(lang.getAttribute("lang")).toBe("en");
    expect(screen.getByRole("link", { name: "قصتنا" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "السواد القابضة، الصفحة الرئيسية" }).getAttribute("href")).toBe("/ar");
  });

  it("uses the per-locale saved site name, and never wraps the editable brand in a link", () => {
    render(<SiteHeader g={globalEditables({ "ar.site.name": "سواد" })} locale="ar" path="/ar" />);
    expect(screen.getByText("سواد")).toBeDefined();
    render(
      <EditorHarness>
        <SiteHeader g={globalEditables({}, true)} locale="en" path="/" />
      </EditorHarness>,
    );
    const editable = screen.getAllByText("Sawad").find((el) => el.getAttribute("contenteditable"));
    expect(editable?.closest("a")).toBeNull();
  });
});
