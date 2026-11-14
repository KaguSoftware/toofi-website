import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/roles";
import { getData } from "@/lib/data";
import { MediaCard } from "@/components/admin/MediaCard";
import { MediaUploadForm } from "@/components/admin/MediaUploadForm";
import { Card, PageHeader, ReadOnlyNote } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Media" };

async function Content() {
  const user = await requirePagePermission("admin:access", "/admin/media");
  const canManage = can(user.role, "media:manage");
  const media = await getData().listMedia();

  return (
    <>
      <PageHeader title="Media" description="Images available to your pages." />
      {canManage ? (
        <Card className="mb-6">
          <MediaUploadForm />
        </Card>
      ) : (
        <ReadOnlyNote />
      )}
      {media.length === 0 ? (
        <p className="text-sm text-neutral-600">No media uploaded yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {media.map((m) => (
            <MediaCard key={m.id} id={m.id} url={m.url} filename={m.filename} alt={m.alt} size={m.size} canManage={canManage} />
          ))}
        </ul>
      )}
    </>
  );
}

export default function MediaPage() {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-48 animate-pulse rounded-xl bg-neutral-200" />}>
      <Content  />
    </Suspense>
  );
}
