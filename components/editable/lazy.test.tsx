// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each island's module says when it was first loaded: the point of lazy.tsx is that this
// happens when an island is rendered, not when the page's code is.
const loaded = vi.hoisted(() => [] as string[]);
const island = (name: string) => {
  loaded.push(name);
  return { [name]: (props: Record<string, unknown>) => <div data-testid={name} data-props={Object.keys(props).sort().join(",")} /> };
};
vi.mock("./EditableText", () => island("EditableTextClient"));
vi.mock("./EditableRichText", () => island("EditableRichTextClient"));
vi.mock("./EditableImage", () => island("EditableImageClient"));
vi.mock("./EditableLink", () => island("EditableLinkClient"));
vi.mock("./EditableList", () => island("EditableListClient"));
vi.mock("./EditorRoot", () => island("EditorRoot"));

const lazy = await import("./lazy");

afterEach(cleanup);

describe("the lazy edit-mode islands", () => {
  it("loads no editor code when the module itself is loaded (a visitor's page)", () => {
    expect(loaded).toEqual([]);
  });

  it.each(["EditableTextClient", "EditableRichTextClient", "EditableImageClient", "EditableLinkClient", "EditableListClient", "EditorRoot"] as const)(
    "loads %s when it is rendered, and passes its props through",
    async (name) => {
      const Island = lazy[name] as React.ComponentType<Record<string, unknown>>;
      expect(loaded).not.toContain(name);
      render(<Island scope="page" blockKey="hero.title" />);
      const el = await screen.findByTestId(name);
      expect(loaded).toContain(name);
      expect(el.getAttribute("data-props")).toBe("blockKey,scope");
    },
  );

  it("loads each island by itself: rendering one does not load the others", async () => {
    // By now every island has been rendered once, each on its own.
    expect([...loaded].sort()).toEqual(["EditableImageClient", "EditableLinkClient", "EditableListClient", "EditableRichTextClient", "EditableTextClient", "EditorRoot"]);
    expect(new Set(loaded).size).toBe(6);
  });
});
