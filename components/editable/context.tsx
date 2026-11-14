"use client";

import { createContext, useContext } from "react";
import type { BlockChange, BlockType, Scope } from "@/lib/content/schemas";
import type { ChangeStore } from "./store";

export type FocusedBlock = { scope: Scope; key: string; type: BlockType };

export type EditorApi = {
  store: ChangeStore;
  /** Record a pending change (marks the page dirty). */
  setChange: (change: BlockChange) => void;
  isDirty: (scope: Scope, key: string) => boolean;
  /**
   * Save all pending changes (plus `extra`, e.g. a list structure change) in one
   * saveDrafts() call. Resolves false (after showing a toast) on failure.
   */
  flush: (extra?: BlockChange[]) => Promise<boolean>;
  /** Remember the block the editor last interacted with (for History). */
  focusBlock: (block: FocusedBlock) => void;
  /** Incremented when server values should replace non-dirty local values (discard/restore). */
  resetVersion: number;
  /** Element inside the editor root for popovers/menus (so scoped CSS applies). */
  portal: HTMLElement | null;
  /** router.refresh() in a transition. */
  refresh: () => void;
};

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditorApi(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error("Editable components must be rendered inside <EditorRoot>.");
  return api;
}
