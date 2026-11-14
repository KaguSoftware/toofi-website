import Link from "next/link";

export default function Unauthorized() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium text-neutral-500">401</p>
      <h1 className="text-2xl font-semibold tracking-tight">Please sign in</h1>
      <Link href="/admin/login" className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700">
        Sign in
      </Link>
    </main>
  );
}
