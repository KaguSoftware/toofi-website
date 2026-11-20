// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ZaitunExperienceProps } from "@/components/sawad/experience/types";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ exp: null as null | ZaitunExperienceProps }));
vi.mock("@/components/sawad/experience/ZaitunExperience", () => ({
  ZaitunExperience: (p: ZaitunExperienceProps) => {
    m.exp = p;
    return (
      <div data-testid="experience">
        {p.hero}
        {p.after}
        {p.beats.map((b) => (
          <div key={b.id} data-beat={b.id}>
            {b.title}
            {b.body}
          </div>
        ))}
      </div>
    );
  },
}));

const { EditorHarness, globalEditables, makePage, pageEditables } = await import("@/test/sawad-helpers");
const { homeTemplate } = await import("./home");

function renderHome(slug = "/", tweaks: Record<string, string> = {}, editing = false) {
  m.exp = null;
  const Home = homeTemplate.component;
  return render(
    <EditorHarness>{Home({ page: makePage(slug, "home"), c: pageEditables({}, editing), g: globalEditables(tweaks) }) as React.ReactNode}</EditorHarness>,
  );
}
const beat = (id: string) => m.exp!.beats.find((b) => b.id === id)!;
const figures = (id: string) => Object.fromEntries(beat(id).figures.map((f) => [f.label, f.value]));

describe("home template", () => {
  it("opens on Zaitun Hills with the headline and the search inside the experience", () => {
    renderHome();
    expect(m.exp).toMatchObject({ locale: "en", view: "flight", live: true });
    const experience = screen.getByTestId("experience");
    expect(within(experience).getByRole("heading", { level: 1, name: "A home in the green land between the rivers" })).toBeDefined();
    expect(within(experience).getByRole("search")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Street" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("uses the Zaitun poster for the start view, with the Zaitun caption", () => {
    renderHome();
    expect(m.exp!.poster).toEqual({ src: "/sawad/scene-zaitun-flight.jpg", alt: "Zaitun Hills at golden hour. Illustrative render." });
    renderHome("/", { "tweaks.startView": "terrace" });
    expect(m.exp!.poster.src).toBe("/sawad/scene-zaitun-terrace.jpg");
  });

  it("follows the owner's tweaks", () => {
    renderHome("/", { "tweaks.startView": "terrace" });
    expect(m.exp!.view).toBe("terrace");
    expect(m.exp!.live).toBe(true);
    renderHome("/", { "tweaks.experience": "explorer" });
    expect(m.exp!.live).toBe(false);
    expect(m.exp!.view).toBe("flight");
  });

  it("is always stills in edit mode", () => {
    // jsdom has no innerText, which the editable text reads when it mounts.
    Object.defineProperty(HTMLElement.prototype, "innerText", { configurable: true, get: () => "", set: () => {} });
    renderHome("/", {}, true);
    expect(m.exp!.live).toBe(false);
  });

  it("tells five beats in order, each with its still", () => {
    renderHome();
    expect(m.exp!.beats.map((b) => b.id)).toEqual(["entrance", "boulevard", "villa", "amenities", "aerial"]);
    for (const b of m.exp!.beats) {
      expect(b.still.src).toBe(`/sawad/story/zaitun-${b.id}.jpg`);
      expect(b.still.alt.length).toBeGreaterThan(10);
    }
    expect(screen.getByRole("heading", { level: 2, name: "Through the brass gate" })).toBeDefined();
    expect(screen.getByText(/Twenty-eight hectares/)).toBeDefined();
  });

  it("draws the figures from the data", () => {
    renderHome();
    expect(figures("entrance")).toMatchObject({ Site: expect.stringContaining("28") });
    expect(Object.keys(figures("boulevard"))).toEqual(["Villas", "Apartments"]);
    const villa = Object.values(figures("villa")).map((v) => v.replace(/[  ]/g, " "));
    expect(villa).toEqual(expect.arrayContaining(["5", "520 m²", "780 m²"]));
    expect(villa.some((v) => v.startsWith("$"))).toBe(true);
    expect(figures("amenities")["Padel and tennis courts"]).toMatch(/^\d+$/);
    expect(figures("aerial")).toMatchObject({ Homes: "84" });
  });

  it("links the villa beat to its home and the aerial beat to the compound", () => {
    renderHome();
    expect(beat("villa").link).toEqual({ href: "/residences?compound=zaitun-hills&home=ZH-V05", label: "See this home" });
    expect(beat("aerial").link).toEqual({ href: "/residences?compound=zaitun-hills", label: "Find a residence" });
    expect(beat("entrance").link).toBeUndefined();
    expect(beat("boulevard").link).toBeUndefined();
    expect(beat("amenities").link).toBeUndefined();
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
    expect(m.exp!.locale).toBe("ar");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("بيتٌ في الأرض الخضراء بين النهرين");
    expect(screen.getByRole("link", { name: "كيف نعمل" }).getAttribute("href")).toBe("/ar/what-we-do");
    expect(screen.getByText("٠١")).toBeDefined();
    expect(m.exp!.poster.alt).toBe("تلال الزيتون في الساعة الذهبية. صورة توضيحية.");
    expect(beat("villa").link?.href).toBe("/ar/residences?compound=zaitun-hills&home=ZH-V05");
    expect(beat("aerial").link?.href).toBe("/ar/residences?compound=zaitun-hills");
    expect(figures("aerial")).toMatchObject({ المنازل: "٨٤" });
    expect(beat("villa").figures.map((f) => f.value).join(" ")).toMatch(/٥٢٠/);
    expect(beat("villa").figures.some((f) => /[0-9]/.test(f.value))).toBe(false);
  });
});
