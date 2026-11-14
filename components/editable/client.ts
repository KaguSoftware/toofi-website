// Barrel for edit-mode client islands. Imported by lib/content/editables.tsx.
// Client chunks are only sent to the browser when one of these is actually rendered
// (i.e. edit mode), so visitors never download editor code.
export { EditableTextClient } from "./EditableText";
export { EditableRichTextClient } from "./EditableRichText";
export { EditableImageClient } from "./EditableImage";
export { EditableLinkClient } from "./EditableLink";
export { EditableListClient } from "./EditableList";
export { EditorRoot } from "./EditorRoot";
