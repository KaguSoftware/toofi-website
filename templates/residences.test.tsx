// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FinderProps } from "@/components/sawad/finder/Finder";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ props: null as null | FinderProps }));
vi.mock("@/components/sawad/finder/Finder", () => ({
  Finder: (p: FinderProps) => {
    m.props = p;
    return <div data-testid="finder">{p.head}</div>;
  },
}));

const { globalEditables, makePage, pageEditables } = await import("@/test/sawad-helpers");
const { residencesTemplate } = await import("./residences");

const renderPage = (slug: string, tweaks: Record<string, string> = {}) =>
  render(<>{residencesTemplate.component({ page: makePage(slug, "residences"), c: pageEditables(), g: globalEditables(tweaks) }) as React.ReactNode}</>);

describe("residences template", () => {
  it("hands the finder the locale, an editable head and the scene setting", () => {
    renderPage("/residences");
    expect(m.props?.locale).toBe("en");
    expect(m.props?.showScene).toBe(true);
    expect(screen.getByRole("heading", { level: 1, name: "Find a residence" })).toBeDefined();
  });

  it("turns the scene off when the owner chose film only", () => {
    renderPage("/ar/residences", { "tweaks.experience": "film" });
    expect(m.props?.showScene).toBe(false);
    expect(m.props?.locale).toBe("ar");
    expect(screen.getByRole("heading", { level: 1, name: "ابحث عن منزل" })).toBeDefined();
  });
});
