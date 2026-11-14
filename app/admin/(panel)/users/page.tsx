import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/guards";
import { getData } from "@/lib/data";
import { backendMode } from "@/lib/env";
import { UserRoleSelect } from "@/components/admin/UserRoleSelect";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Users" };

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

async function Content() {
  const me = await requirePagePermission("users:manage", "/admin/users");
  const users = await getData().listUsers();

  return (
    <>
      <PageHeader title="Users" description="Change who can view, edit and administer the site." />
      {backendMode === "supabase" && (
        <p className="mb-4 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-600">
          To invite new users, use the Supabase dashboard (Authentication → Users). They appear here after their first sign-in.
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Email</th>
              <th scope="col" className="px-4 py-3 font-medium">Role</th>
              <th scope="col" className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">
                  {u.name}
                  {u.id === me.id && <span className="ml-2 text-xs font-normal text-neutral-500">(you)</span>}
                </td>
                <td className="px-4 py-3 text-neutral-600">{u.email}</td>
                <td className="px-4 py-3">
                  <UserRoleSelect userId={u.id} role={u.role} disabled={u.id === me.id} label={`Role for ${u.email}`} />
                </td>
                <td className="px-4 py-3 text-neutral-600">{fmt.format(new Date(u.createdAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-48 animate-pulse rounded-xl bg-neutral-200" />}>
      <Content  />
    </Suspense>
  );
}
