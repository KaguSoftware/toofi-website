import type { ReactNode } from "react";
import type { Editables } from "@/lib/content/editables";
import type { PageRecord } from "@/lib/data/types";

export type TemplateProps = {
  page: PageRecord;
  /** Editable content helpers bound to this page's scope. */
  c: Editables;
  /** Editables bound to the global scope (site settings such as the Tweaks). */
  g?: Editables;
};

export type TemplateDefinition = {
  /** Stable id stored in pages.template — never rename once pages use it. */
  id: string;
  name: string;
  description: string;
  component: (props: TemplateProps) => ReactNode | Promise<ReactNode>;
};
