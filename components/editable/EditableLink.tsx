"use client";

import { useId, useState } from "react";
import { hrefSchema, linkValueSchema, type LinkValue } from "@/lib/content/schemas";
import { useEditorApi } from "./context";
import { Popover } from "./Popover";
import type { EditableLinkClientProps } from "./types";
import { readPlainText, usePlainText } from "./usePlainText";

const MAX_LINK_TEXT = 500; // linkValueSchema

export function EditableLinkClient({ scope, blockKey, initial, className }: EditableLinkClientProps) {
  const api = useEditorApi();
  const [mountText] = useState(initial.text);
  const [href, setHref] = useState(initial.href);
  const [newTab, setNewTab] = useState(Boolean(initial.newTab));
  const [hrefError, setHrefError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** Last valid href (what gets saved); `href` is the raw input. */
  const [validHref, setValidHref] = useState(initial.href);
  const ids = useId();

  // Adopt new server values (after discard/restore) when this block has no pending change.
  const syncToken = `${api.resetVersion}|${initial.href}|${initial.newTab ? 1 : 0}`;
  const [seenToken, setSeenToken] = useState(syncToken);
  if (seenToken !== syncToken) {
    setSeenToken(syncToken);
    if (!api.isDirty(scope, blockKey)) {
      setHref(initial.href);
      setNewTab(Boolean(initial.newTab));
      setHrefError(null);
      setValidHref(initial.href);
    }
  }

  const commit = (patch: Partial<LinkValue>) => {
    const value = linkValueSchema.safeParse({
      text: ref.current ? readPlainText(ref.current, false) : initial.text,
      href: validHref,
      newTab: newTab || undefined,
      ...patch,
    });
    if (value.success) api.setChange({ scope, key: blockKey, type: "link", value: value.data });
  };

  const { ref, handlers } = usePlainText<HTMLAnchorElement>({
    scope,
    blockKey,
    initial: initial.text,
    maxLength: MAX_LINK_TEXT,
    onText: (text) => commit({ text }),
  });

  const onHrefChange = (next: string) => {
    setHref(next);
    const parsed = hrefSchema.safeParse(next.trim());
    if (!parsed.success) {
      setHrefError(parsed.error.issues[0]?.message ?? "Invalid link");
      return;
    }
    setHrefError(null);
    setValidHref(parsed.data);
    commit({ href: parsed.data });
  };

  const external = /^https?:\/\//i.test(href);
  return (
    <>
      <a
        ref={ref}
        href={validHref || undefined}
        className={className}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
        aria-label={`Link text${mountText ? "" : " (empty)"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-sawad-editable="link"
        data-placeholder="Link text"
        {...((newTab || external) && { target: "_blank", rel: "noopener noreferrer" })}
        onClick={(e) => {
          // Never navigate while editing.
          e.preventDefault();
          setOpen(true);
        }}
        onFocus={() => {
          api.focusBlock({ scope, key: blockKey, type: "link" });
          setOpen(true);
        }}
        {...handlers}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.preventDefault();
          handlers.onKeyDown(e);
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (!next) return;
          // Keep the popover when focus moves into it; close otherwise.
          if (!document.querySelector(`[data-popover-for="${CSS.escape(ids)}"]`)?.contains(next)) setOpen(false);
        }}
      >
        {mountText}
      </a>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} label="Link settings" autoFocus={false}>
        <div data-popover-for={ids} className="sawad-form">
          <label className="sawad-field">
            <span>Link URL</span>
            <input
              type="text"
              inputMode="url"
              value={href}
              placeholder="/contact or https://…"
              aria-invalid={hrefError ? true : undefined}
              aria-describedby={hrefError ? `${ids}-err` : undefined}
              onChange={(e) => onHrefChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setOpen(false);
                  ref.current?.focus();
                }
              }}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {hrefError && (
            <p id={`${ids}-err`} className="sawad-error" role="alert">
              {hrefError}
            </p>
          )}
          <label className="sawad-check">
            <input
              type="checkbox"
              checked={newTab}
              onChange={(e) => {
                setNewTab(e.target.checked);
                commit({ newTab: e.target.checked || undefined });
              }}
            />
            <span>Open in new tab</span>
          </label>
        </div>
      </Popover>
    </>
  );
}
