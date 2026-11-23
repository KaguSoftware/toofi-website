"use client";

import dynamic from "next/dynamic";

/**
 * The edit-mode islands, each loaded only when one is rendered, which is in edit mode alone.
 *
 * A server component that imports a client component puts it in the page's first-render
 * scripts whether it is rendered or not. Imported directly, the editor (tiptap, ProseMirror,
 * dnd-kit) was one 165 KB gzip chunk named in the HTML of every public page (S2-1). Going
 * through `next/dynamic` inside a client module is what keeps it out: visitors download none
 * of it, and an editor's page still renders the islands on the server.
 */
export const EditableTextClient = dynamic(() => import("./EditableText").then((m) => m.EditableTextClient));
export const EditableRichTextClient = dynamic(() => import("./EditableRichText").then((m) => m.EditableRichTextClient));
export const EditableImageClient = dynamic(() => import("./EditableImage").then((m) => m.EditableImageClient));
export const EditableLinkClient = dynamic(() => import("./EditableLink").then((m) => m.EditableLinkClient));
export const EditableListClient = dynamic(() => import("./EditableList").then((m) => m.EditableListClient));
export const EditorRoot = dynamic(() => import("./EditorRoot").then((m) => m.EditorRoot));
