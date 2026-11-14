import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/guards";
import { listTemplates } from "@/templates/registry";
import { PageForm } from "@/components/admin/PageForm";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New page" };

async function Content() {
  await requirePagePermission("pages:manage", "/admin/pages/new");
  return <PageForm mode="create" templates={listTemplates()} />;
}

export default function NewPage() {
  return (
    <>
      <PageHeader title="New page" description="Create the page, then fill in its content with the inline editor." />
      <Suspense fallback={<div className="h-64 max-w-2xl animate-pulse rounded-xl bg-neutral-200" aria-hidden />}>
        <Content />
      </Suspense>
    </>
  );
}
