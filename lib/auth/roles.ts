/**
 * Roles & permissions — the single source of truth for authorization in app code.
 * Mirrored in SQL by public.has_permission() (supabase/migrations). Keep them in sync.
 *
 * Safe to import from client components (no secrets).
 */
/** "member" = signed up but granted nothing (default for new Supabase sign-ups). */
export const ROLES = ["member", "viewer", "editor", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "admin:access", // open /admin (read-only dashboards)
  "content:edit", // enter edit mode, save drafts
  "content:publish", // publish drafts to the live site
  "pages:manage", // create / rename / delete pages
  "media:manage", // upload / delete media
  "users:manage", // change roles, invite users
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  member: [],
  viewer: ["admin:access"],
  editor: ["admin:access", "content:edit", "content:publish", "pages:manage", "media:manage"],
  admin: [...PERMISSIONS],
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** The narrow user shape that app code (and the client) is allowed to see. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};
