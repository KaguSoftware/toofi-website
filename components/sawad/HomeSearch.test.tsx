// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeSearch } from "./HomeSearch";

describe("HomeSearch", () => {
  it("is a plain GET form to the finder that works without JavaScript", () => {
    render(<HomeSearch locale="en" />);
    const form = screen.getByRole("search", { name: "Search residences" });
    expect(form.getAttribute("action")).toBe("/residences");
    expect(form.getAttribute("method")).toBe("get");
    expect(screen.getByLabelText("Compound")).toHaveProperty("name", "compound");
    expect(screen.getByLabelText("Home")).toHaveProperty("name", "type");
    expect(screen.getByLabelText("Bedrooms")).toHaveProperty("name", "beds");
    expect(screen.getByRole("button", { name: "Find a residence" })).toHaveProperty("type", "submit");
  });

  it("targets the Arabic finder with Arabic labels and digits", () => {
    render(<HomeSearch locale="ar" />);
    expect(screen.getByRole("search").getAttribute("action")).toBe("/ar/residences");
    expect(screen.getByRole("option", { name: "٤" })).toBeDefined();
    expect(screen.getByRole("option", { name: "بستان دجلة، بغداد" })).toBeDefined();
  });
});
