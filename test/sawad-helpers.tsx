/**
 * Shared test helpers for Sawad templates and site chrome.
 * Callers must `vi.mock("server-only", () => ({}))` before importing editables.
 */
import type { ReactNode } from "react";
import { EditorContext, type EditorApi } from "@/components/editable/context";
import { ChangeStore } from "@/components/editable/store";
import { createEditables } from "@/lib/content/editables";
import type { ContentMap } from "@/lib/content/schemas";
import type { PageRecord } from "@/lib/data/types";

export const PAGE_ID = "6ab793c3-2491-4693-bcea-081c2150c674";

export function makePage(slug: string, template: string, title = "Page"): PageRecord {
  return {
    id: PAGE_ID,
    slug,
    title,
    template,
    status: "published",
    seo: {},
    createdAt: "2026-11-19T00:00:00.000Z",
    updatedAt: "2026-11-19T00:00:00.000Z",
    publishedAt: "2026-11-19T00:00:00.000Z",
  } as PageRecord;
}

export function pageEditables(content: ContentMap = {}, editing = false) {
  return createEditables({ scope: PAGE_ID, content, editing });
}

export function globalEditables(text: Record<string, string> = {}, editing = false) {
  const content: ContentMap = Object.fromEntries(
    Object.entries(text).map(([k, v]) => [k, { type: "text", value: { text: v } }]),
  ) as ContentMap;
  return createEditables({ scope: "global", content, editing });
}

/** Minimal editor context so edit-mode islands can render in tests. */
export function EditorHarness({ children }: { children: ReactNode }) {
  const api = {
    store: new ChangeStore(),
    setChange: () => {},
    isDirty: () => false,
    flush: async () => true,
    focusBlock: () => {},
    resetVersion: 0,
    portal: null,
    refresh: () => {},
  } as unknown as EditorApi;
  return <EditorContext.Provider value={api}>{children}</EditorContext.Provider>;
}
