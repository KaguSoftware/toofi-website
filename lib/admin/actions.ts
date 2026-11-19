"use server";

import { cookies, draftMode, headers } from "next/headers";
import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/auth/guards";
import { can, ROLES } from "@/lib/auth/roles";
import { getData } from "@/lib/data";
import { pageInputSchema, PAGE_STATUSES } from "@/lib/content/schemas";
import { tags } from "@/lib/content/tags";
import { hasTemplate } from "@/templates/registry";
import { fail, toFailure, type ActionResult } from "./result";
import { safeNext } from "./safe-next";
import { beginLoginAttempt, loginSucceeded } from "./rate-limit";
import { MAX_UPLOAD_BYTES, validateImageUpload } from "@/lib/media/validate";

const CAN_EDIT_COOKIE = "sawad_can_edit";
const CAN_EDIT_MAX_AGE = 60 * 60 * 24 * 7;
const HOME_SLUG = "/";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

// ───────────────────────── auth ─────────────────────────

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email").max(320),
  password: z.string().min(1, "Enter your password").max(1000),
});

export async function login(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const next = safeNext(str(formData, "next"));
  let dest: string | null = null;
  try {
    const parsed = loginSchema.safeParse({ email: str(formData, "email"), password: str(formData, "password") });
    if (!parsed.success) return fail("Enter your email and password.", z.flattenError(parsed.error).fieldErrors);
    const { email, password } = parsed.data;

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    const wait = beginLoginAttempt(email, ip);
    if (wait > 0) return fail(`Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);

    const res = await getAuth().signInWithPassword(email, password);
    if (!res.ok) return fail("Invalid email or password.");
    loginSucceeded(email);

    const jar = await cookies();
    if (can(res.user.role, "content:edit")) {
      jar.set(CAN_EDIT_COOKIE, "1", {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: CAN_EDIT_MAX_AGE,
      });
    } else {
      jar.delete(CAN_EDIT_COOKIE);
    }
    dest = next;
  } catch (err) {
    return toFailure(err);
  }
  redirect(dest);
}

export async function logout(): Promise<void> {
  await getAuth().signOut();
  (await cookies()).delete(CAN_EDIT_COOKIE);
  (await draftMode()).disable();
  redirect("/admin/login");
}

// ───────────────────────── pages ─────────────────────────

const seoFromForm = (fd: FormData) => {
  const description = str(fd, "description").trim();
  const ogImage = str(fd, "ogImage").trim();
  return {
    ...(description ? { description } : {}),
    ...(ogImage ? { ogImage } : {}),
    ...(fd.get("noindex") === "on" ? { noindex: true } : {}),
  };
};

const ogImageCheck = z
  .string()
  .refine((v) => !v || /^(\/(?!\/)|https:\/\/)/.test(v), "Use a relative path or https URL");

function parsePageForm(fd: FormData) {
  const parsed = pageInputSchema.safeParse({
    title: str(fd, "title").trim(),
    slug: str(fd, "slug").trim(),
    template: str(fd, "template"),
    seo: seoFromForm(fd),
  });
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path[0] === "seo" ? String(issue.path[1] ?? "description") : String(issue.path[0] ?? "title");
      (fieldErrors[name] ??= []).push(issue.message);
    }
  }
  const og = ogImageCheck.safeParse(str(fd, "ogImage").trim());
  if (!og.success) (fieldErrors.ogImage ??= []).push(og.error.issues[0].message);
  if (parsed.success && !hasTemplate(parsed.data.template)) (fieldErrors.template ??= []).push("Unknown template");
  if (!parsed.success || Object.keys(fieldErrors).length > 0) return { ok: false as const, fieldErrors };
  return { ok: true as const, data: parsed.data };
}

export async function createPage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const user = await requirePermission("pages:manage");
    const p = parsePageForm(formData);
    if (!p.ok) return fail("Please fix the highlighted fields.", p.fieldErrors);
    const data = getData();
    if ((await data.listPages()).some((x) => x.slug === p.data.slug)) {
      return fail("Please fix the highlighted fields.", { slug: ["A page with this URL already exists"] });
    }
    const page = await data.createPage(p.data, user.id);
    id = page.id;
    updateTag(tags.pages);
    updateTag(tags.page(page.id));
  } catch (err) {
    return toFailure(err);
  }
  redirect(`/admin/pages/${id}?created=1`);
}

export async function updatePage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission("pages:manage");
    const id = z.uuid().safeParse(str(formData, "id"));
    if (!id.success) return fail("Invalid page.");
    const p = parsePageForm(formData);
    if (!p.ok) return fail("Please fix the highlighted fields.", p.fieldErrors);
    const data = getData();
    const pages = await data.listPages();
    const existing = pages.find((x) => x.id === id.data);
    if (!existing) return fail("Page not found.");
    if (existing.slug === HOME_SLUG && p.data.slug !== HOME_SLUG) {
      return fail("Please fix the highlighted fields.", { slug: ["The home page URL can't be changed"] });
    }
    if (pages.some((x) => x.id !== id.data && x.slug === p.data.slug)) {
      return fail("Please fix the highlighted fields.", { slug: ["A page with this URL already exists"] });
    }
    await data.updatePage(id.data, p.data, user.id);
    updateTag(tags.pages);
    updateTag(tags.page(id.data));
    return { ok: true, message: "Page settings saved" };
  } catch (err) {
    return toFailure(err);
  }
}

export async function setPageStatus(pageId: string, status: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("pages:manage");
    await requirePermission("content:publish");
    const id = z.uuid().safeParse(pageId);
    const st = z.enum(PAGE_STATUSES).safeParse(status);
    if (!id.success || !st.success) return fail("Invalid request.");
    const data = getData();
    if (!(await data.getPageById(id.data))) return fail("Page not found.");
    await data.updatePage(id.data, { status: st.data }, user.id);
    updateTag(tags.pages);
    updateTag(tags.page(id.data));
    return { ok: true, message: st.data === "published" ? "Page published" : "Page unpublished" };
  } catch (err) {
    return toFailure(err);
  }
}

export async function deletePage(pageId: string): Promise<ActionResult> {
  try {
    await requirePermission("pages:manage");
    const id = z.uuid().safeParse(pageId);
    if (!id.success) return fail("Invalid page.");
    const data = getData();
    const page = await data.getPageById(id.data);
    if (!page) return fail("Page not found.");
    if (page.slug === HOME_SLUG) return fail("The home page can't be deleted.");
    await data.deletePage(id.data);
    updateTag(tags.pages);
    updateTag(tags.page(id.data));
    updateTag(tags.content(id.data));
    return { ok: true, message: "Page deleted" };
  } catch (err) {
    return toFailure(err);
  }
}

// ───────────────────────── media ─────────────────────────

export async function uploadMedia(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requirePermission("media:manage");
    const file = formData.get("file");
    if (!(file instanceof File)) return fail("Choose a file to upload.", { file: ["Choose a file"] });
    const alt = z.string().max(500).safeParse(str(formData, "alt").trim());
    if (!alt.success) return fail("Alt text is too long.", { alt: ["Max 500 characters"] });
    if (file.size > MAX_UPLOAD_BYTES) return fail("Images must be 8 MB or smaller.", { file: ["Max 8 MB"] });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const v = validateImageUpload({ name: file.name, size: file.size, bytes });
    if (!v.ok) return fail(v.error, { file: [v.error] });
    await getData().uploadMedia({ name: v.filename, type: v.mime, bytes }, alt.data, user.id);
    updateTag(tags.media);
    return { ok: true, message: "Uploaded" };
  } catch (err) {
    return toFailure(err);
  }
}

export async function deleteMedia(mediaId: string): Promise<ActionResult> {
  try {
    await requirePermission("media:manage");
    const id = z.string().min(1).max(200).safeParse(mediaId);
    if (!id.success) return fail("Invalid media.");
    await getData().deleteMedia(id.data);
    updateTag(tags.media);
    return { ok: true, message: "Media deleted" };
  } catch (err) {
    return toFailure(err);
  }
}

// ───────────────────────── users ─────────────────────────

export async function setUserRole(userId: string, role: string): Promise<ActionResult> {
  try {
    const me = await requirePermission("users:manage");
    const r = z.enum(ROLES).safeParse(role);
    const id = z.string().min(1).max(200).safeParse(userId);
    if (!r.success || !id.success) return fail("Invalid request.");
    if (id.data === me.id) return fail("You can't change your own role.");
    const data = getData();
    const users = await data.listUsers();
    const target = users.find((u) => u.id === id.data);
    if (!target) return fail("User not found.");
    if (target.role === "admin" && r.data !== "admin" && users.filter((u) => u.role === "admin").length <= 1) {
      return fail("You can't demote the last remaining admin.");
    }
    await data.setUserRole(id.data, r.data);
    return { ok: true, message: `${target.email} is now ${r.data}` };
  } catch (err) {
    return toFailure(err);
  }
}
