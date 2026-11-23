// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { EditorHarness, globalEditables } = await import("@/test/sawad-helpers");
const { TweaksPanel } = await import("./TweaksPanel");

describe("TweaksPanel", () => {
  it("is invisible to visitors", () => {
    const { container } = render(<TweaksPanel g={globalEditables()} locale="en" />);
    expect(container.innerHTML).toBe("");
    expect(render(<TweaksPanel locale="en" />).container.innerHTML).toBe("");
  });

  it("shows both settings with their allowed values in edit mode", async () => {
    render(
      <EditorHarness>
        <TweaksPanel g={globalEditables({ "tweaks.startView": "terrace" }, true)} locale="en" />
      </EditorHarness>,
    );
    expect(screen.getByRole("complementary", { name: "Site settings" })).toBeDefined();
    expect(screen.getByText(/both, film or explorer/)).toBeDefined();
    expect(screen.getByText(/flight, street, terrace or aerial/)).toBeDefined();
    // The edit-mode fields are loaded on demand (components/editable/lazy.tsx), so they arrive a moment later.
    expect((await screen.findByText("terrace")).getAttribute("contenteditable")).toBe("plaintext-only");
  });
});
