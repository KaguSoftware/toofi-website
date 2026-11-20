// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SceneViewportProps } from "../scene/types";

const m = vi.hoisted(() => ({
  params: new URLSearchParams(),
  desktop: true,
  scene: null as null | SceneViewportProps,
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => m.params, usePathname: () => "/residences" }));
vi.mock("../scene/SceneViewport", () => ({
  SceneViewport: (p: SceneViewportProps) => {
    m.scene = p;
    return <div data-testid="scene" data-autoload={String(p.autoLoad)} />;
  },
}));

const { Finder } = await import("./Finder");

beforeEach(() => {
  m.params = new URLSearchParams();
  m.desktop = true;
  m.scene = null;
  window.matchMedia = ((q: string) => ({
    matches: m.desktop,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/residences");
});

const head = <h1>Find a residence</h1>;

describe("Finder", () => {
  it("opens on Zaitun Hills, the showcase, with available and reserved homes, and feeds the scene", () => {
    render(<Finder locale="en" showScene head={head} />);
    expect((screen.getByLabelText("Zaitun Hills") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/^\d+ homes$/);
    expect(m.scene?.mode).toBe("explorer");
    expect(m.scene?.variant).toBe("zaitun");
    expect(m.scene?.autoLoad).toBe(true);
    expect(m.scene?.markers?.every((x) => x.status !== "sold")).toBe(true);
  });

  it("applies the home search query and mirrors changes into the URL", () => {
    // A compound other than the default, so it has to appear in the URL.
    m.params = new URLSearchParams("compound=bustan-dijla&type=villa&beds=4");
    render(<Finder locale="en" showScene head={head} />);
    expect(m.scene?.variant).toBe("dijla");
    expect(m.scene?.markers?.every((x) => x.kind === "villa")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Street" }));
    expect(m.scene?.view).toBe("street");
    expect(window.location.search).toContain("view=street");
    expect(window.location.search).toContain("compound=bustan-dijla");
  });

  it("selecting a marker in the scene opens that home in the list and announces it", () => {
    render(<Finder locale="en" showScene head={head} />);
    const id = m.scene!.markers![0].id;
    act(() => m.scene!.onSelect!(id));
    expect(screen.getByRole("region", { name: new RegExp(`^${id},`) })).toBeDefined();
    expect(m.scene?.selectedId).toBe(id);
    expect(document.querySelector("[aria-live=polite]")!.textContent).toContain(id);
    expect(window.location.search).toContain(`home=${id}`);
  });

  it("shows an empty state with a way out, and clears filters", () => {
    m.params = new URLSearchParams("type=apartment&beds=5");
    render(<Finder locale="en" showScene head={head} />);
    expect(screen.getAllByText("No homes match these filters.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("status").textContent).toMatch(/homes$/);
  });

  it("explains coming-soon compounds and hides the sold/reserved legend", () => {
    render(<Finder locale="en" showScene head={head} />);
    fireEvent.click(screen.getByLabelText("Shatt Gardens"));
    expect(screen.getByText(/opens for reservations in 2027/)).toBeDefined();
    expect(screen.queryByRole("list", { name: "Marker key" })).toBeNull();
  });

  it("does not autoload 3D on small screens, and shows a still when the owner turned the explorer off", () => {
    m.desktop = false;
    const { unmount } = render(<Finder locale="en" showScene head={head} />);
    expect(screen.getByTestId("scene").dataset.autoload).toBe("false");
    unmount();
    m.scene = null;
    render(<Finder locale="ar" showScene={false} head={head} />);
    expect(m.scene).toBeNull();
    expect(screen.getByRole("img").getAttribute("alt")).toContain("تلال الزيتون");
    const legend = screen.getByRole("list", { name: "دليل العلامات" });
    expect(within(legend).getByText("محجوز")).toBeDefined();
  });

  it("adds homes to compare from the details", () => {
    render(<Finder locale="en" showScene head={head} />);
    const first = screen.getAllByRole("button", { expanded: false })[0];
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByRole("region", { name: "Compare" })).toBeDefined();
    expect(window.location.search).toContain("compare=");
  });
});
