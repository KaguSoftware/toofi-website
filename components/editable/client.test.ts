import { describe, expect, it, vi } from "vitest";

// The islands themselves are heavy (tiptap, dnd-kit) and are not what this file is about.
const loaded = vi.hoisted(() => [] as string[]);
for (const file of ["./EditableText", "./EditableRichText", "./EditableImage", "./EditableLink", "./EditableList", "./EditorRoot"]) {
  vi.doMock(file, () => {
    loaded.push(file);
    return {};
  });
}

describe("the edit-mode barrel", () => {
  it("hands out the lazy islands, so importing it pulls no editor code into a visitor's page", async () => {
    const client = await import("./client");
    const lazy = await import("./lazy");
    expect(Object.keys(client).sort()).toEqual(["EditableImageClient", "EditableLinkClient", "EditableListClient", "EditableRichTextClient", "EditableTextClient", "EditorRoot"]);
    for (const name of Object.keys(client) as Array<keyof typeof client>) expect(client[name]).toBe(lazy[name]);
    expect(loaded).toEqual([]);
  });
});
