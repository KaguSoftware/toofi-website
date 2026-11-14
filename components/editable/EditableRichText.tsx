"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { RichTextView } from "@/lib/content/render-rich";
import { RICH_MARK_TYPES, RICH_NODE_TYPES, hrefSchema, richTextValueSchema } from "@/lib/content/schemas";
import { useEditorApi } from "./context";
import type { EditableRichTextClientProps } from "./types";

/**
 * Only the nodes/marks whitelisted in schemas.ts. StarterKit (v3) bundles exactly
 * these plus codeBlock (disabled) and a few behaviour-only extensions (history,
 * drop/gap cursor, list keymap) that add no node or mark types.
 */
const extensions = [
  StarterKit.configure({
    codeBlock: false,
    trailingNode: false,
    heading: { levels: [2, 3, 4] },
    link: {
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: "https",
      HTMLAttributes: { target: null, rel: "noopener noreferrer" },
      isAllowedUri: (url) => url !== "" && hrefSchema.safeParse(url).success,
    },
  }),
];

const allowedNodes = new Set<string>(RICH_NODE_TYPES);
const allowedMarks = new Set<string>(RICH_MARK_TYPES);

function assertWhitelist(editor: Editor) {
  const badNodes = Object.keys(editor.schema.nodes).filter((n) => !allowedNodes.has(n));
  const badMarks = Object.keys(editor.schema.marks).filter((m) => !allowedMarks.has(m));
  if (badNodes.length || badMarks.length) {
    console.warn("[editor] Rich text schema exceeds whitelist:", { badNodes, badMarks });
  }
}

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

export function EditableRichTextClient({ scope, blockKey, initial, className, placeholder }: EditableRichTextClientProps) {
  const api = useEditorApi();
  const { setChange, focusBlock } = api;
  const [invalid, setInvalid] = useState(false);
  const latest = useRef({ scope, blockKey, setChange, focusBlock });
  useEffect(() => {
    latest.current = { scope, blockKey, setChange, focusBlock };
  });

  const editor = useEditor({
    extensions,
    // Stored JSON is whitelisted by richTextValueSchema, a subset of Tiptap's JSONContent.
    content: (initial?.doc as JSONContent | undefined) ?? EMPTY_DOC,
    immediatelyRender: false, // SSR: render RichTextView until the editor mounts
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: ["toofi-rich", className].filter(Boolean).join(" "),
        "data-toofi-editable": "richtext",
        "data-placeholder": placeholder || "Write something…",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": placeholder || "Rich text",
      },
    },
    onCreate: ({ editor }) => {
      assertWhitelist(editor);
      editor.view.dom.toggleAttribute("data-empty", editor.isEmpty);
    },
    onFocus: () => {
      const { scope, blockKey, focusBlock } = latest.current;
      focusBlock({ scope, key: blockKey, type: "richtext" });
    },
    onUpdate: ({ editor }) => {
      editor.view.dom.toggleAttribute("data-empty", editor.isEmpty);
      const parsed = richTextValueSchema.safeParse({ doc: editor.getJSON() });
      setInvalid(!parsed.success);
      if (!parsed.success) return;
      const { scope, blockKey, setChange } = latest.current;
      setChange({ scope, key: blockKey, type: "richtext", value: parsed.data });
    },
  });

  // Adopt new server values (after discard/restore) unless there are unsaved edits.
  const { isDirty, resetVersion } = api;
  useEffect(() => {
    if (!editor || editor.isDestroyed || isDirty(scope, blockKey)) return;
    const next = (initial?.doc as JSONContent | undefined) ?? EMPTY_DOC;
    if (JSON.stringify(editor.getJSON()) === JSON.stringify(next)) return;
    editor.commands.setContent(next, { emitUpdate: false });
    editor.view.dom.toggleAttribute("data-empty", editor.isEmpty);
  }, [editor, initial, resetVersion, isDirty, scope, blockKey]);

  if (!editor) return <RichTextView value={initial} className={className} />;

  return (
    <>
      <EditorContent editor={editor} className="toofi-rich-host" data-invalid={invalid || undefined} />
      <RichBubbleMenu editor={editor} portal={api.portal} />
    </>
  );
}

function RichBubbleMenu({ editor, portal }: { editor: Editor; portal: HTMLElement | null }) {
  const [linkMode, setLinkMode] = useState(false);
  const [href, setHref] = useState("");
  const [error, setError] = useState<string | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      link: e.isActive("link"),
      linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
    }),
  });

  const openLink = () => {
    setHref(state.linkHref);
    setError(null);
    setLinkMode(true);
  };

  const applyLink = () => {
    const value = href.trim();
    if (value === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkMode(false);
      return;
    }
    const parsed = hrefSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid link");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: parsed.data }).run();
    setLinkMode(false);
  };

  type Btn = { label: string; text: string; active: boolean; run: () => void };
  const buttons: Btn[] = [
    { label: "Bold", text: "B", active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", text: "I", active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Link", text: "Link", active: state.link, run: openLink },
    { label: "Heading 2", text: "H2", active: state.h2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Heading 3", text: "H3", active: state.h3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Bulleted list", text: "• List", active: state.bullet, run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", text: "1. List", active: state.ordered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Quote", text: "“ ”", active: state.quote, run: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  return (
    <BubbleMenu
      editor={editor}
      appendTo={() => portal ?? document.body}
      className="toofi-bubble"
      options={{ placement: "top", offset: 8 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setLinkMode(false);
          editor.commands.focus();
        }
      }}
    >
      {linkMode ? (
        <div className="toofi-bubble-link">
          <input
            autoFocus
            type="text"
            inputMode="url"
            aria-label="Link URL"
            placeholder="/page or https://…"
            value={href}
            aria-invalid={error ? true : undefined}
            title={error ?? undefined}
            onChange={(e) => {
              setHref(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            spellCheck={false}
          />
          <button type="button" className="toofi-bubble-btn" onClick={applyLink}>
            Apply
          </button>
          {state.link && (
            <button
              type="button"
              className="toofi-bubble-btn"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkMode(false);
              }}
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <div role="toolbar" aria-label="Text formatting" className="toofi-bubble-row">
          {buttons.map((b) => (
            <button
              key={b.label}
              type="button"
              className="toofi-bubble-btn"
              aria-label={b.label}
              title={b.label}
              aria-pressed={b.active}
              // Keep the text selection while clicking.
              onMouseDown={(e) => e.preventDefault()}
              onClick={b.run}
            >
              {b.text}
            </button>
          ))}
        </div>
      )}
    </BubbleMenu>
  );
}
