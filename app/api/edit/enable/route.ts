import { draftMode } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { AuthError, requirePermission } from "@/lib/auth/guards";
import { getData } from "@/lib/data";
import { slugSchema } from "@/lib/content/schemas";
import { editEnableUrl, safeRelativePath } from "@/components/editable/paths";

/**
 * GET /api/edit/enable?path=/about — turn on edit mode (Draft Mode) for a page.
 *
 * Auth is checked here; the Draft Mode cookie alone never grants editing
 * (lib/content/render-context.ts re-checks the session on every render).
 * We always redirect to the slug stored in the DB, never the raw param.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("path") ?? "/";
  const path = safeRelativePath(raw);
  const slug = path ? slugSchema.safeParse(path.length > 1 ? path.replace(/\/+$/, "") : path) : null;
  if (!slug?.success) return new Response("Invalid page path", { status: 400 });

  let authState: "ok" | "login" | "forbidden" = "ok";
  try {
    await requirePermission("content:edit");
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    authState = err.code === "UNAUTHENTICATED" ? "login" : "forbidden";
  }
  if (authState === "login") {
    redirect(`/admin/login?next=${encodeURIComponent(editEnableUrl(slug.data))}`);
  }
  if (authState === "forbidden") {
    return new Response("You don't have permission to edit content.", { status: 403 });
  }

  // Editors may open draft (unpublished) pages too.
  const page = await getData().getPageBySlug(slug.data);
  if (!page) return new Response("Page not found", { status: 404 });

  (await draftMode()).enable();
  redirect(page.slug);
}
