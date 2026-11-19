// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { makePage, pageEditables } = await import("@/test/sawad-helpers");
const { whatWeDoTemplate } = await import("./what-we-do");

const renderPage = (slug: string) =>
  render(<>{whatWeDoTemplate.component({ page: makePage(slug, "what-we-do"), c: pageEditables() }) as React.ReactNode}</>);

describe("what-we-do template", () => {
  it("lists five operations and the five buying steps in order", () => {
    renderPage("/what-we-do");
    const lists = screen.getAllByRole("list");
    expect(lists[0].querySelectorAll("li")).toHaveLength(5);
    expect([...lists[1].querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Choose", "Visit", "Reserve", "Sign", "Move in"]);
  });

  it("routes each partner to the contact form with their interest preselected", () => {
    renderPage("/what-we-do");
    expect(screen.getByRole("link", { name: "Offer land" }).getAttribute("href")).toBe("/contact?interest=landowner");
    expect(screen.getByRole("link", { name: "Register as a supplier" }).getAttribute("href")).toBe("/contact?interest=supplier");
  });

  it("works in Arabic", () => {
    renderPage("/ar/what-we-do");
    expect(screen.getByRole("link", { name: "اعرض أرضك" }).getAttribute("href")).toBe("/ar/contact?interest=landowner");
  });
});
