import { Suspense } from "react";
import { AdminSidebarContent } from "@/components/admin/AdminSidebarContent";

/** Panel chrome. No session reads here; the session-dependent sidebar is inside Suspense. */
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-neutral-200 bg-neutral-100 p-4 md:w-60 md:border-r md:border-b-0">
        <p className="mb-4 px-3 text-sm font-semibold tracking-tight">Toofi Admin</p>
        <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-neutral-200 md:flex-1" aria-hidden />}>
          <AdminSidebarContent />
        </Suspense>
      </aside>
      <main className="min-w-0 flex-1 p-4 sm:p-8">{children}</main>
    </div>
  );
}
