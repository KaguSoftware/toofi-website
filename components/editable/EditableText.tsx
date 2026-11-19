"use client";

import { useState, type ElementType } from "react";
import { useEditorApi } from "./context";
import type { EditableTextClientProps } from "./types";
import { usePlainText } from "./usePlainText";

const MAX_TEXT = 5_000; // textValueSchema

export function EditableTextClient({
  scope,
  blockKey,
  initial,
  as,
  className,
  placeholder,
  multiline,
}: EditableTextClientProps) {
  const api = useEditorApi();
  // Rendered once; afterwards the DOM owns the text (see usePlainText).
  const [mountText] = useState(initial);
  const { ref, handlers } = usePlainText<HTMLElement>({
    scope,
    blockKey,
    initial,
    multiline,
    maxLength: MAX_TEXT,
    onText: (text) => api.setChange({ scope, key: blockKey, type: "text", value: { text } }),
  });

  // `as` is a union of intrinsic tags; all of them accept these props and an HTMLElement ref.
  const Tag = as as ElementType;
  return (
    <Tag
      ref={ref}
      className={className}
      style={multiline ? { whiteSpace: "pre-line" } : undefined}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline={multiline || undefined}
      aria-label={placeholder || "Text"}
      data-sawad-editable="text"
      data-placeholder={placeholder || "Type here…"}
      onFocus={() => api.focusBlock({ scope, key: blockKey, type: "text" })}
      {...handlers}
    >
      {mountText}
    </Tag>
  );
}
