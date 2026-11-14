"use client";

import { useEffect, useRef, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import type { Scope } from "@/lib/content/schemas";
import { useEditorApi } from "./context";

/** Read the user-visible text of a plaintext contentEditable element. */
export function readPlainText(el: HTMLElement, multiline: boolean): string {
  if (!multiline) return (el.textContent ?? "").replace(/[\r\n]+/g, " ");
  let text = el.innerText.replace(/\r\n?/g, "\n");
  // Browsers keep a trailing <br> so the caret can sit on an empty last line.
  if (el.lastChild?.nodeName === "BR") text = text.replace(/\n$/, "");
  return text;
}

function insertPlainText(text: string) {
  // execCommand keeps the native undo stack; deprecated but universally supported.
  if (document.execCommand?.("insertText", false, text)) return;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  node.parentElement?.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

type Options = {
  scope: Scope;
  blockKey: string;
  /** Server value; re-applied to the DOM only when this block has no pending change. */
  initial: string;
  multiline?: boolean;
  maxLength: number;
  onText: (text: string) => void;
};

/**
 * Shared behaviour for plaintext contentEditable elements (EditableText, EditableLink).
 * The element is UNCONTROLLED after mount: React renders the initial text once and never
 * touches it again, so re-renders (incl. router.refresh) can't move the caret or wipe edits.
 */
export function usePlainText<T extends HTMLElement>({ scope, blockKey, initial, multiline = false, maxLength, onText }: Options) {
  const api = useEditorApi();
  const ref = useRef<T>(null);
  const { isDirty, resetVersion } = api;

  // Server value changed (refresh after restore/discard): adopt it unless the user has unsaved edits.
  useEffect(() => {
    const el = ref.current;
    if (!el || isDirty(scope, blockKey)) return;
    if (readPlainText(el, multiline) !== initial) el.textContent = initial;
    el.removeAttribute("aria-invalid");
  }, [initial, resetVersion, isDirty, scope, blockKey, multiline]);

  const onInput = (e: FormEvent<T>) => {
    const el = e.currentTarget;
    const text = readPlainText(el, multiline);
    // Leave the element truly empty so the :empty placeholder shows.
    if (text === "" && el.childNodes.length > 0) el.textContent = "";
    if (text.length > maxLength) {
      el.setAttribute("aria-invalid", "true");
      el.title = `Too long — maximum ${maxLength} characters`;
      return;
    }
    el.removeAttribute("aria-invalid");
    el.removeAttribute("title");
    onText(text);
  };

  const onKeyDown = (e: KeyboardEvent<T>) => {
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
  };

  const onPaste = (e: ClipboardEvent<T>) => {
    e.preventDefault();
    let text = e.clipboardData.getData("text/plain");
    if (!multiline) text = text.replace(/\s*[\r\n]+\s*/g, " ");
    if (text) insertPlainText(text);
  };

  const onDrop = (e: DragEvent<T>) => {
    // Dropped HTML would bypass the paste filter.
    e.preventDefault();
  };

  return { ref, handlers: { onInput, onKeyDown, onPaste, onDrop } };
}
