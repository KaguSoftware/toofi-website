"use client";

import { btnPrimary } from "@/components/admin/ui";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-md space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-neutral-600">The admin page failed to load. Try again, and check the server logs if it keeps happening.</p>
      <button type="button" onClick={reset} className={btnPrimary}>
        Try again
      </button>
    </div>
  );
}
