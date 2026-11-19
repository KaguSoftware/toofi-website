// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SceneViewportProps } from "@/components/sawad/scene/types";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ scene: null as null | SceneViewportProps }));
vi.mock("@/components/sawad/scene/SceneViewport", () => ({
  SceneViewport: (p: SceneViewportProps) => {
    m.scene = p;
    return <div data-testid="scene" />;
  },
}));

const { globalEditables, makePage, pageEditables } = await import("@/test/sawad-helpers");
const { homeTemplate } = await import("./home");

function renderHome(slug = "/", tweaks: Record<string, string> = {}) {
  m.scene = null;
  const Home = homeTemplate.component;
  return render(<>{Home({ page: makePage(slug, "home"), c: pageEditables(), g: globalEditables(tweaks) }) as React.ReactNode}</>);
}

describe("home template", () => {
  it("opens with one film viewpoint, the headline and the search", () => {
    renderHome();
    expect(m.scene).toMatchObject({ mode: "film", view: "flight", variant: "dijla" });
    expect(screen.getByRole("heading", { level: 1, name: "A home in the green land between the rivers" })).toBeDefined();
    expect(screen.getByRole("search")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Street" })).toBeNull();
  });

  it("follows the owner's tweaks", () => {
    renderHome("/", { "tweaks.startView": "terrace" });
    expect(m.scene?.view).toBe("terrace");
    renderHome("/", { "tweaks.experience": "explorer" });
    expect(m.scene).toBeNull();
    expect(screen.getAllByRole("img", { name: "Bustan Dijla at golden hour. Illustrative render." }).length).toBeGreaterThan(0);
  });

  it("presents all three compounds with the right call to action", () => {
    renderHome();
    expect(screen.getByRole("heading", { level: 3, name: "Bustan Dijla" })).toBeDefined();
    expect(screen.getByRole("link", { name: "See the residences: Zaitun Hills" }).getAttribute("href")).toBe("/residences?compound=zaitun-hills");
    expect(screen.getByRole("link", { name: "Register interest: Shatt Gardens" })).toBeDefined();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(8);
  });

  it("renders in Arabic on /ar", () => {
    renderHome("/ar");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("بيتٌ في الأرض الخضراء بين النهرين");
    expect(screen.getByRole("link", { name: "كيف نعمل" }).getAttribute("href")).toBe("/ar/what-we-do");
    expect(screen.getByText("٠١")).toBeDefined();
  });
});
