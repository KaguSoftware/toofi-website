// Barrel for edit-mode client islands. Imported by lib/content/editables.tsx and the page route.
// The islands come through lazy.tsx, so their code is sent to the browser only when one of them
// is rendered (edit mode): visitors never download the editor.
export { EditableTextClient, EditableRichTextClient, EditableImageClient, EditableLinkClient, EditableListClient, EditorRoot } from "./lazy";
