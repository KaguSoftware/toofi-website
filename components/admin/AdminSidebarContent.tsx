import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { logout } from "@/lib/admin/actions";
import { AdminNav, type NavItem } from "./AdminNav";
import { Badge, btnSecondary, btnSmall } from "./ui";

/** Session-dependent sidebar content. Must render inside <Suspense>. */
export async function AdminSidebarContent() {
  const user = await getCurrentUser();
  const items: NavItem[] = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/pages", label: "Pages" },
    { href: "/admin/media", label: "Media" },
    ...(can(user?.role, "users:manage") ? [{ href: "/admin/users", label: "Users" }] : []),
  ];
  return (
    <>
      <AdminNav items={items} />
      <div className="mt-4 space-y-3 border-t border-neutral-200 pt-4 md:mt-auto">
        {user && (
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium text-neutral-900">{user.name}</p>
            <p className="truncate text-xs text-neutral-500">{user.email}</p>
            <div className="mt-1.5">
              <Badge tone={user.role === "admin" ? "blue" : user.role === "editor" ? "green" : "neutral"}>{user.role}</Badge>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/" className={`${btnSecondary} ${btnSmall}`}>
            View site
          </Link>
          <form action={logout}>
            <button type="submit" className={`${btnSecondary} ${btnSmall}`}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
