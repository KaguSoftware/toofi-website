/**
 * Props contract between the server-side `createEditables()` (lib/content/editables.tsx)
 * and the client-side edit-mode islands in this folder. Server decides WHAT to render;
 * these client components only exist on the page when an editor is in edit mode.
 */
import type { ReactNode } from "react";
import type { ImageValue, LinkValue, RichTextValue, Scope } from "@/lib/content/schemas";

export type TextTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div" | "li" | "small" | "strong" | "em" | "figcaption" | "blockquote" | "label";

type Base = {
  scope: Scope;
  /** Full block key (already prefixed for list items). */
  blockKey: string;
  className?: string;
};

export type EditableTextClientProps = Base & {
  initial: string;
  as: TextTag;
  placeholder?: string;
  /** Allow line breaks (stored as \n, rendered with white-space: pre-line). */
  multiline?: boolean;
};

export type EditableRichTextClientProps = Base & {
  initial: RichTextValue | null;
  placeholder?: string;
};

export type EditableImageClientProps = Base & {
  initial: ImageValue;
  sizes?: string;
  priority?: boolean;
};

export type EditableLinkClientProps = Base & {
  initial: LinkValue;
};

export type EditableListClientProps = Base & {
  itemIds: string[];
  /** Server-rendered item content, same order as itemIds. */
  items: ReactNode[];
  as: "div" | "ul" | "ol" | "section";
  itemAs: "div" | "li" | "article";
  itemClassName?: string;
  /** Label shown on the add button, e.g. "Add team member". */
  addLabel?: string;
  max?: number;
};

export type EditorRootProps = {
  /** Scopes that this page edits (page id + "global"). */
  scopes: Scope[];
  pageId: string;
  pageSlug: string;
  pageStatus: "draft" | "published";
  hasUnpublishedChanges: boolean;
  user: { name: string; role: string; canPublish: boolean };
  children: ReactNode;
};
