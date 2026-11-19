// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { pageEditables } = await import("@/test/sawad-helpers");
const { PageHead } = await import("./PageHead");

describe("PageHead", () => {
  it("renders fallbacks until an editor saves a value", () => {
    render(<PageHead c={pageEditables()} title="Compounds" lead="Three compounds." />);
    expect(screen.getByRole("heading", { level: 1, name: "Compounds" })).toBeDefined();
    expect(screen.getByText("Three compounds.")).toBeDefined();
  });

  it("prefers saved content", () => {
    const c = pageEditables({ "head.title": { type: "text", value: { text: "Our compounds" } } });
    render(<PageHead c={c} title="Compounds" lead="Lead" />);
    expect(screen.getByRole("heading", { level: 1, name: "Our compounds" })).toBeDefined();
  });
});
