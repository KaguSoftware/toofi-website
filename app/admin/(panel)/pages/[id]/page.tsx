import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/roles";
import { getData } from "@/lib/data";
import { listTemplates } from "@/templates/registry";
import { PageForm } from "@/components/admin/PageForm";
import { DeletePageButton, PageStatusButton } from "@/components/admin/PageDangerZone";
import { Badge, Card, PageHeader, ReadOnlyNote, btnPrimary, btnSecondary } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Page settings" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePagePermission("admin:access", `/admin/pages/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = getData();
  const page = await data.getPageById(id);
  if (!page) notFound();

  const canManage = can(user.role, "pages:manage");
  const canPublish = can(user.role, "content:publish");
  const canEdit = can(user.role, "content:edit");
  const isHome = page.slug === "/";
  const unpublished = await data.hasUnpublishedChanges(page.id);

  return (
    <>
      <PageHeader
        title={page.title}
        description={page.slug}
        actions={
          <>
            <Badge tone={page.status === "published" ? "green" : "amber"}>{page.status}</Badge>
            {unpublished && <Badge tone="blue">unpublished content changes</Badge>}
            {canEdit && (
              <a href={`/api/edit/enable?path=${encodeURIComponent(page.slug)}`} className={btnPrimary}>
                Edit content
              </a>
            )}
            <a href={page.slug} className={btnSecondary}>
              View
            </a>
          </>
        }
      />
      {!canManage && <ReadOnlyNote />}
      <PageForm
        mode="edit"
        readOnly={!canManage}
        templates={listTemplates()}
        page={{
          id: page.id,
          title: page.title,
          slug: page.slug,
          template: page.template,
          description: page.seo.description ?? "",
          ogImage: page.seo.ogImage ?? "",
          noindex: page.seo.noindex ?? false,
        }}
      />
      {canManage && (
        <Card className="mt-10 max-w-2xl space-y-6">
          {canPublish && (
            <div>
              <h2 className="text-base font-semibold">Visibility</h2>
              <p className="mb-3 mt-1 text-sm text-neutral-600">
                {page.status === "published" ? "This page is live on the site." : "This page is a draft and not visible to visitors."}
              </p>
              <PageStatusButton pageId={page.id} status={page.status} />
            </div>
          )}
          <div>
            <h2 className="text-base font-semibold text-red-700">Delete page</h2>
            <p className="mb-3 mt-1 text-sm text-neutral-600">Permanently removes the page and all its content.</p>
            <DeletePageButton pageId={page.id} title={page.title} disabledReason={isHome ? "The home page can't be deleted." : undefined} />
          </div>
        </Card>
      )}
    </>
  );
}

export default function PageSettings({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-48 animate-pulse rounded-xl bg-neutral-200" />}>
      <Content params={params} />
    </Suspense>
  );
}
