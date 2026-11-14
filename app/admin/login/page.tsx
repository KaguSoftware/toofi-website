import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/LoginForm";
import { getCurrentUser } from "@/lib/auth/session";
import { backendMode } from "@/lib/env";
import { safeNext } from "@/lib/admin/safe-next";

export const metadata: Metadata = { title: "Sign in" };

async function LoginContent({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await getCurrentUser()) redirect("/admin");

  return (
    <>
      <LoginForm next={next} />
      {backendMode === "local" && process.env.NODE_ENV !== "production" && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Local demo mode</p>
          <p className="mt-1">Password for all accounts: <code>password</code></p>
          <ul className="mt-1 space-y-0.5 font-mono">
            <li>admin@toofi.local</li>
            <li>editor@toofi.local</li>
            <li>viewer@toofi.local</li>
          </ul>
        </div>
      )}
    </>
  );
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-5 mt-1 text-sm text-neutral-600">Manage pages, media and content.</p>
        <Suspense fallback={<div className="h-48 animate-pulse rounded-lg bg-neutral-100" aria-hidden />}>
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
