import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium text-neutral-500">403</p>
      <h1 className="text-2xl font-semibold tracking-tight">You don&apos;t have access to this page</h1>
      <p className="max-w-md text-sm text-neutral-600">
        Your account doesn&apos;t have the permission required here. If you think this is a mistake, ask an admin to update your role.
      </p>
      <div className="mt-2 flex gap-3 text-sm">
        <Link href="/admin" className="rounded-lg bg-neutral-900 px-3.5 py-2 font-medium text-white hover:bg-neutral-700">
          Back to admin
        </Link>
        <Link href="/" className="rounded-lg border border-neutral-300 px-3.5 py-2 font-medium hover:bg-neutral-100">
          View site
        </Link>
      </div>
    </main>
  );
}
