"use client";

import { useActionState, useState } from "react";
import { createPage, updatePage } from "@/lib/admin/actions";
import { slugSchema } from "@/lib/content/schemas";
import { Field, Spinner, btnPrimary, inputCls } from "./ui";
import { useResultToast } from "./use-result-toast";

export type TemplateOption = { id: string; name: string; description?: string };
export type PageFormValues = {
  id: string;
  title: string;
  slug: string;
  template: string;
  description: string;
  ogImage: string;
  noindex: boolean;
};

export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return "/" + s;
}

export function PageForm({
  mode,
  templates,
  page,
  readOnly = false,
}: {
  mode: "create" | "edit";
  templates: TemplateOption[];
  page?: PageFormValues;
  readOnly?: boolean;
}) {
  const [state, action, pending] = useActionState(mode === "create" ? createPage : updatePage, null);
  useResultToast(state);
  const fe = (state && !state.ok ? state.fieldErrors : undefined) ?? {};

  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const isHome = page?.slug === "/";
  const slugValid = slug === "" || slugSchema.safeParse(slug).success;
  const clientSlugError = !slugValid ? ["Use lowercase letters, numbers and dashes, e.g. /about-us"] : undefined;

  return (
    <form action={action} className="max-w-2xl space-y-5" noValidate>
      {page && <input type="hidden" name="id" value={page.id} />}
      <fieldset disabled={readOnly || pending} className="space-y-5">
        <Field label="Title" htmlFor="title" errors={fe.title}>
          <input
            id="title"
            name="title"
            required
            maxLength={200}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!slugTouched) setSlug(e.target.value ? slugify(e.target.value) : "");
            }}
            className={inputCls}
            aria-invalid={!!fe.title}
          />
        </Field>
        <Field
          label="URL path"
          htmlFor="slug"
          errors={fe.slug ?? clientSlugError}
          hint={isHome ? "The home page URL can't be changed." : "Generated from the title; you can edit it."}
        >
          <input
            id="slug"
            name="slug"
            required
            value={slug}
            readOnly={isHome}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            className={`${inputCls} font-mono`}
            aria-invalid={!!(fe.slug ?? clientSlugError)}
            spellCheck={false}
            autoCapitalize="none"
          />
        </Field>
        <Field label="Template" htmlFor="template" errors={fe.template}>
          <select id="template" name="template" defaultValue={page?.template ?? templates[0]?.id} className={inputCls}>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.description ? ` — ${t.description}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="SEO description" htmlFor="description" errors={fe.description} hint="Up to 300 characters. Shown in search results.">
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={300}
            defaultValue={page?.description ?? ""}
            className={inputCls}
            aria-invalid={!!fe.description}
          />
        </Field>
        {mode === "edit" && (
          <>
            <Field label="Social image (og:image)" htmlFor="ogImage" errors={fe.ogImage} hint="Relative path or https URL. Pick one from Media.">
              <input id="ogImage" name="ogImage" defaultValue={page?.ogImage ?? ""} className={inputCls} aria-invalid={!!fe.ogImage} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-neutral-800">
              <input
                type="checkbox"
                name="noindex"
                defaultChecked={page?.noindex}
                className="size-4 rounded border-neutral-300 focus-visible:outline-2 focus-visible:outline-[var(--color-accent,#0071e3)]"
              />
              Hide this page from search engines (noindex)
            </label>
          </>
        )}
      </fieldset>
      {state && !state.ok && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {!readOnly && (
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending && <Spinner />}
          {mode === "create" ? (pending ? "Creating…" : "Create page") : pending ? "Saving…" : "Save settings"}
        </button>
      )}
    </form>
  );
}
