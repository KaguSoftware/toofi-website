import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/guards";
import { getData } from "@/lib/data";
import { backendMode } from "@/lib/env";
import { Badge, Card, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Dashboard" };

async function Content() {
  const user = await requirePagePermission("admin:access", "/admin");
  const data = getData();
  const [pages, media] = await Promise.all([data.listPages(), data.listMedia()]);
  const withChanges = (
    await Promise.all(pages.map(async (p) => ((await data.hasUnpublishedChanges(p.id)) ? p : null)))
  ).filter((p) => p !== null);
  const published = pages.filter((p) => p.status === "published").length;

  const stats = [
    { label: "Pages", value: pages.length },
    { label: "Published", value: published },
    { label: "Drafts", value: pages.length - published },
    { label: "Media files", value: media.length },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description={`Welcome back, ${user.name}.`} />
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <dt className="text-sm text-neutral-600">{s.label}</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{s.value}</dd>
          </Card>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-base font-semibold">Unpublished content changes</h2>
          {withChanges.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600">Everything is live. No pending drafts.</p>
          ) : (
            <ul className="mt-3 divide-y divide-neutral-100">
              {withChanges.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.title}</span> <span className="font-mono text-xs text-neutral-500">{p.slug}</span>
                  </span>
                  <Link href={`/admin/pages/${p.id}`} className="shrink-0 text-[var(--color-accent,#0071e3)] hover:underline">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="text-base font-semibold">Backend mode</h2>
          <p className="mt-2">
            <Badge tone={backendMode === "supabase" ? "green" : "amber"}>{backendMode}</Badge>
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            {backendMode === "local"
              ? "Using sample data stored on disk with seeded demo users. To switch to Supabase, set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (plus SUPABASE_SECRET_KEY) in .env.local and restart."
              : "Connected to Supabase. To go back to local sample data, remove the Supabase variables from .env.local and restart."}
          </p>
        </Card>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-48 animate-pulse rounded-xl bg-neutral-200" />}>
      <Content  />
    </Suspense>
  );
}
