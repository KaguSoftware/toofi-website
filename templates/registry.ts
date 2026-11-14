import { contactTemplate } from "./contact";
import { genericTemplate } from "./generic";
import { homeTemplate } from "./home";
import type { TemplateDefinition } from "./types";

/**
 * Template registry. To add a page type:
 *  1. create templates/<name>.tsx exporting a TemplateDefinition
 *  2. add it here
 * Admins can then create pages from it in /admin/pages.
 */
export const templates: Record<string, TemplateDefinition> = Object.fromEntries(
  [homeTemplate, genericTemplate, contactTemplate].map((t) => [t.id, t]),
);

export const FALLBACK_TEMPLATE_ID = "generic";

/** Own-property check, so ids like "constructor" or "__proto__" are never treated as templates. */
export function hasTemplate(id: string): boolean {
  return Object.hasOwn(templates, id);
}

export function getTemplate(id: string): TemplateDefinition {
  return hasTemplate(id) ? templates[id] : templates[FALLBACK_TEMPLATE_ID];
}

export function listTemplates() {
  return Object.values(templates).map(({ id, name, description }) => ({ id, name, description }));
}
