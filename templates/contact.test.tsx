// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/components/sawad/ContactForm", () => ({ ContactForm: ({ locale }: { locale: string }) => <form aria-label={`form-${locale}`} /> }));

const { makePage, pageEditables } = await import("@/test/sawad-helpers");
const { contactTemplate } = await import("./contact");

const renderPage = (slug: string) =>
  render(<>{contactTemplate.component({ page: makePage(slug, "contact"), c: pageEditables() }) as React.ReactNode}</>);

describe("contact template", () => {
  it("pairs the enquiry form with the three galleries", () => {
    renderPage("/contact");
    expect(screen.getByRole("form", { name: "form-en" })).toBeDefined();
    const galleries = screen.getByRole("region", { name: "Sales galleries" });
    expect(galleries.id).toBe("galleries");
    expect(within(galleries).getAllByRole("listitem")).toHaveLength(3);
    expect(within(galleries).getAllByText("Number to be added before launch")).toHaveLength(3);
  });

  it("renders the Arabic page", () => {
    renderPage("/ar/contact");
    expect(screen.getByRole("form", { name: "form-ar" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "تواصل معنا" })).toBeDefined();
  });
});
