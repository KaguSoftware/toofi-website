"use client";

import "./editor.css";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { discardDrafts, exitEditMode, publishContent, saveDrafts } from "@/lib/content/actions";
import type { BlockChange, Scope } from "@/lib/content/schemas";
import { EditorContext, type EditorApi, type FocusedBlock } from "./context";
import { HistoryPanel } from "./HistoryPanel";
import { EDITING_HTML_ATTR } from "./paths";
import { Popover } from "./Popover";
import { ChangeStore } from "./store";
import type { EditorRootProps } from "./types";

const SAVE_BATCH = 500; // saveDrafts() limit per call

export function EditorRoot({
  scopes,
  pageId,
  pageSlug,
  pageStatus,
  hasUnpublishedChanges,
  user,
  children,
}: EditorRootProps) {
  const router = useRouter();
  const [store] = useState(() => new ChangeStore());
  const dirtyCount = useSyncExternalStore(store.subscribe, store.getSize, () => 0);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | "publish" | "discard" | "exit">(null);
  const [focused, setFocused] = useState<FocusedBlock | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [, startTransition] = useTransition();
  const historyBtn = useRef<HTMLButtonElement>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  // Saved-but-unpublished drafts exist. Server prop wins whenever it changes (after refresh).
  const [hasDrafts, setHasDrafts] = useState(hasUnpublishedChanges);
  const [seenProp, setSeenProp] = useState(hasUnpublishedChanges);
  if (seenProp !== hasUnpublishedChanges) {
    setSeenProp(hasUnpublishedChanges);
    setHasDrafts(hasUnpublishedChanges);
  }

  const setChange = useCallback((change: BlockChange) => store.set(change), [store]);
  const isDirty = useCallback((scope: Scope, key: string) => store.has(scope, key), [store]);
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  const focusBlock = useCallback(
    (block: FocusedBlock) =>
      setFocused((prev) => (prev?.scope === block.scope && prev.key === block.key ? prev : block)),
    [],
  );

  /** Serialized: one saveDrafts() at a time, each sending everything pending at that moment. */
  const flush = useCallback(
    (extra: BlockChange[] = []): Promise<boolean> => {
      const run = saveQueue.current.then(async () => {
        const pending = store.snapshot();
        const all = [...pending.map(([, c]) => c), ...extra];
        if (all.length === 0) return true;
        setSaving(true);
        try {
          for (let i = 0; i < all.length; i += SAVE_BATCH) {
            const res = await saveDrafts(all.slice(i, i + SAVE_BATCH));
            if (!res.ok) {
              toast.error(res.code === "UNAUTHENTICATED" ? "Your session expired — sign in again in another tab, then save." : res.error);
              return false;
            }
          }
          store.settle(pending);
          setHasDrafts(true);
          return true;
        } catch {
          toast.error("Could not save — check your connection and try again.");
          return false;
        } finally {
          setSaving(false);
        }
      });
      saveQueue.current = run.catch(() => undefined);
      return run;
    },
    [store],
  );

  const api = useMemo<EditorApi>(
    () => ({ store, setChange, isDirty, flush, focusBlock, resetVersion, portal, refresh }),
    [store, setChange, isDirty, flush, focusBlock, resetVersion, portal, refresh],
  );

  // ── actions ──

  const save = useCallback(async () => {
    if (store.getSize() === 0) {
      toast.message("No unsaved changes.");
      return;
    }
    if (await flush()) toast.success("Draft saved. Visitors won't see it until you publish.");
  }, [flush, store]);

  const publish = async () => {
    setBusy("publish");
    try {
      if (!(await flush())) return;
      const res = await publishContent({ scopes, publishPageId: pageStatus === "draft" ? pageId : undefined });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setHasDrafts(false);
      toast.success(res.pagePublished ? "Page published — it's live." : "Published — your changes are live.");
      refresh();
    } catch {
      toast.error("Could not publish — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    const msg =
      "Discard all unpublished changes on this page and in the shared header/footer?\n\nThe live version stays as it is. This can't be undone.";
    if (!window.confirm(msg)) return;
    setBusy("discard");
    try {
      const res = await discardDrafts(scopes);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      store.clear();
      setHasDrafts(false);
      setResetVersion((v) => v + 1);
      toast.success("Drafts discarded.");
      refresh();
    } catch {
      toast.error("Could not discard drafts — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const exit = async () => {
    setBusy("exit");
    try {
      if (store.getSize() > 0 && !(await flush())) {
        if (!window.confirm("Your latest changes could not be saved. Leave edit mode anyway?")) return;
        store.clear();
      }
      // A draft page isn't public yet; go back to the admin instead of a 404.
      const res = await exitEditMode(pageStatus === "draft" ? "/admin" : pageSlug);
      if (res && !res.ok) toast.error(res.error);
    } catch {
      toast.error("Could not leave edit mode — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const onRestored = () => {
    if (focused) store.delete(focused.scope, focused.key);
    setHasDrafts(true);
    setHistoryOpen(false);
    setResetVersion((v) => v + 1);
    refresh();
  };

  // ── page-level effects ──

  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute(EDITING_HTML_ATTR, "");
    return () => html.removeAttribute(EDITING_HTML_ATTR);
  }, []);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // legacy browsers
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyCount]);

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Clicking editable content that sits inside a link (e.g. a card link) must not navigate.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-toofi-editable], .toofi-item-controls") && t.closest("a[href]")) e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // ── toolbar ──

  const statusState = saving ? "saving" : dirtyCount > 0 ? "unsaved" : hasDrafts ? "draft" : "live";
  const statusText = {
    saving: "Saving…",
    unsaved: "Unsaved changes",
    draft: "Draft saved · not published",
    live: pageStatus === "draft" ? "Saved" : "Up to date",
  }[statusState];
  const working = busy !== null || saving;
  const nothingToPublish = dirtyCount === 0 && !hasDrafts && pageStatus === "published";

  return (
    <EditorContext.Provider value={api}>
      <div className="toofi-editor-root">
        {children}
        <div ref={setPortal} className="toofi-chrome">
          <div role="toolbar" aria-label="Page editor" className="toofi-toolbar">
            {pageStatus === "draft" && (
              <span className="toofi-pill" title="This page is not published yet. Only editors can see it.">
                Draft page
              </span>
            )}
            <span className="toofi-status" data-state={statusState} role="status" aria-live="polite">
              <span className="toofi-dot" aria-hidden="true" />
              {statusText}
            </span>
            <span className="toofi-sep" aria-hidden="true" />
            <button
              type="button"
              className="toofi-btn"
              onClick={() => void save()}
              disabled={working || dirtyCount === 0}
              aria-keyshortcuts="Control+S Meta+S"
              title="Save draft (Ctrl/⌘+S)"
            >
              Save draft
            </button>
            {user.canPublish && (
              <button
                type="button"
                className="toofi-btn toofi-btn-primary"
                onClick={() => void publish()}
                disabled={working || nothingToPublish}
                aria-busy={busy === "publish" || undefined}
              >
                {busy === "publish" ? "Publishing…" : pageStatus === "draft" ? "Publish page" : "Publish"}
              </button>
            )}
            <button
              type="button"
              className="toofi-btn"
              onClick={() => void discard()}
              disabled={working || (dirtyCount === 0 && !hasDrafts)}
            >
              Discard
            </button>
            <button
              ref={historyBtn}
              type="button"
              className="toofi-btn"
              onClick={() => setHistoryOpen((o) => !o)}
              disabled={!focused}
              aria-haspopup="dialog"
              aria-expanded={historyOpen && !!focused}
              title={focused ? `History of ${focused.key}` : "Click a block to see its history"}
            >
              History
            </button>
            <span className="toofi-sep" aria-hidden="true" />
            <button
              type="button"
              className="toofi-btn toofi-btn-ghost"
              onClick={() => void exit()}
              disabled={busy !== null}
              title={`Signed in as ${user.name} (${user.role})`}
            >
              {busy === "exit" ? "Leaving…" : "Exit"}
            </button>
          </div>
          {focused && (
            <Popover
              anchorRef={historyBtn}
              open={historyOpen}
              onClose={() => setHistoryOpen(false)}
              label="Block history"
              placement="above"
              autoFocus={false}
            >
              <HistoryPanel key={`${focused.scope}:${focused.key}`} block={focused} onRestored={onRestored} />
            </Popover>
          )}
          <Toaster position="top-center" closeButton richColors />
        </div>
      </div>
    </EditorContext.Provider>
  );
}
