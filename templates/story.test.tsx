// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { makePage, pageEditables } = await import("@/test/sawad-helpers");
const { storyTemplate } = await import("./story");

const renderPage = (slug: string) =>
  render(<>{storyTemplate.component({ page: makePage(slug, "story"), c: pageEditables() }) as React.ReactNode}</>);

describe("story template", () => {
  it("tells the timeline oldest first", () => {
    renderPage("/our-story");
    const years = [...document.querySelectorAll(".timeline__year")].map((y) => y.textContent);
    expect(years).toEqual(["2009", "2014", "2018", "2021", "2024"]);
  });

  it("is honest that leadership names are not published yet", () => {
    renderPage("/our-story");
    expect(screen.getByText("Names will be published before launch.")).toBeDefined();
    expect(screen.getByText("Managing director")).toBeDefined();
  });

  it("writes years in Arabic digits without a thousands separator", () => {
    renderPage("/ar/our-story");
    const years = [...document.querySelectorAll(".timeline__year")].map((y) => y.textContent);
    expect(years[0]).toBe("٢٠٠٩");
  });
});
