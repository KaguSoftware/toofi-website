import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getData } from "@/lib/data";
import type { PageRecord } from "@/lib/data/types";
import { can } from "@/lib/auth/roles";
import { createEditables } from "@/lib/content/editables";
import { getPublishedContent, getPublishedPageBySlug, listPublishedPages } from "@/lib/content/get";
import { getEditor } from "@/lib/content/render-context";
import { GLOBAL_SCOPE, slugSchema, type ContentMap } from "@/lib/content/schemas";
import { EditorRoot } from "@/components/editable/client";
import { SiteShell } from "@/components/site/SiteShell";
import { PageSkeleton } from "@/components/site/PageSkeleton";
import { getTemplate } from "@/templates/registry";

/**
 * One route renders every CMS page. slug → page record → template (templates/registry.ts).
 *   visitors: published content from the cache, plain HTML
 *   editors in edit mode: drafts, uncached, wrapped in the inline editor
 */

type Props = PageProps<"/[[...slug]]">;

function toPath(slug: string[] | undefined): string {
  return "/" + (slug ?? []).join("/");
}

export async function generateStaticParams() {
  const pages = await listPublishedPages();
  return pages.map((p) => ({ slug: p.slug === "/" ? [] : p.slug.slice(1).split("/") }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getPublishedPageBySlug(toPath((await params).slug));
  if (!page) return {};
  return {
    title: page.title,
    description: page.seo.description,
    openGraph: page.seo.ogImage ? { images: [page.seo.ogImage] } : undefined,
    robots: page.seo.noindex ? { index: false, follow: false } : undefined,
  };
}

export default function Page({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PageRenderer params={params} />
    </Suspense>
  );
}

async function PageRenderer({ params }: Pick<Props, "params">) {
  const path = toPath((await params).slug);
  // Malformed paths (uppercase, dots, weird chars) can never be pages: 404 before any lookup.
  if (!slugSchema.safeParse(path).success) notFound();
  const editor = await getEditor();
  return editor ? <EditablePage path={path} editor={editor} /> : <PublishedPage path={path} />;
}

async function PublishedPage({ path }: { path: string }) {
  const page = await getPublishedPageBySlug(path);
  if (!page) notFound();
  const [content, global] = await Promise.all([getPublishedContent(page.id), getPublishedContent(GLOBAL_SCOPE)]);
  return <RenderedPage page={page} content={content} global={global} editing={false} />;
}

async function EditablePage({
  path,
  editor,
}: {
  path: string;
  editor: NonNullable<Awaited<ReturnType<typeof getEditor>>>;
}) {
  const data = getData();
  // Editors can see draft (unpublished) pages too.
  const page = await data.getPageBySlug(path);
  if (!page) notFound();
  const [content, global, pageDirty, globalDirty] = await Promise.all([
    data.getContent(page.id, "draft"),
    data.getContent(GLOBAL_SCOPE, "draft"),
    data.hasUnpublishedChanges(page.id),
    data.hasUnpublishedChanges(GLOBAL_SCOPE),
  ]);
  return (
    <EditorRoot
      scopes={[page.id, GLOBAL_SCOPE]}
      pageId={page.id}
      pageSlug={page.slug}
      pageStatus={page.status}
      hasUnpublishedChanges={pageDirty || globalDirty}
      user={{ name: editor.name, role: editor.role, canPublish: can(editor.role, "content:publish") }}
    >
      <RenderedPage page={page} content={content} global={global} editing />
    </EditorRoot>
  );
}

function RenderedPage({
  page,
  content,
  global,
  editing,
}: {
  page: PageRecord;
  content: ContentMap;
  global: ContentMap;
  editing: boolean;
}) {
  const Template = getTemplate(page.template).component;
  const c = createEditables({ scope: page.id, content, editing });
  const g = createEditables({ scope: GLOBAL_SCOPE, content: global, editing });
  return (
    <SiteShell g={g}>
      <Template page={page} c={c} />
    </SiteShell>
  );
}
