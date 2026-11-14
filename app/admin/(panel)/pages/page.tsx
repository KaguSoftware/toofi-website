import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/roles";
import { getData } from "@/lib/data";
import { Badge, PageHeader, ReadOnlyNote, btnPrimary, btnSecondary, btnSmall } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Pages" };

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

async function Content() {
  const user = await requirePagePermission("admin:access", "/admin/pages");
  const canManage = can(user.role, "pages:manage");
  const canEdit = can(user.role, "content:edit");
  const pages = (await getData().listPages()).sort((a, b) => a.slug.localeCompare(b.slug));

  return (
    <>
      <PageHeader
        title="Pages"
        actions={
          canManage && (
            <Link href="/admin/pages/new" className={btnPrimary}>
              New page
            </Link>
          )
        }
      />
      {!canManage && <ReadOnlyNote />}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Title</th>
              <th scope="col" className="px-4 py-3 font-medium">Slug</th>
              <th scope="col" className="px-4 py-3 font-medium">Template</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Updated (UTC)</th>
              <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {pages.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 font-medium">{p.title}</td>
                <td className="px-4 py-3 font-mono text-xs text-neutral-600">{p.slug}</td>
                <td className="px-4 py-3 text-neutral-600">{p.template}</td>
                <td className="px-4 py-3">
                  <Badge tone={p.status === "published" ? "green" : "amber"}>{p.status}</Badge>
                </td>
                <td className="px-4 py-3 text-neutral-600">{fmt.format(new Date(p.updatedAt))}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {canEdit && (
                      <a href={`/api/edit/enable?path=${encodeURIComponent(p.slug)}`} className={`${btnPrimary} ${btnSmall}`}>
                        Edit content
                      </a>
                    )}
                    <Link href={`/admin/pages/${p.id}`} className={`${btnSecondary} ${btnSmall}`}>
                      Settings
                    </Link>
                    <a href={p.slug} className={`${btnSecondary} ${btnSmall}`}>
                      View
                    </a>
                  </div>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                  No pages yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PagesPage() {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-48 animate-pulse rounded-xl bg-neutral-200" />}>
      <Content  />
    </Suspense>
  );
}
