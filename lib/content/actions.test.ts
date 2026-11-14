import { beforeEach, describe, expect, it, vi } from "vitest";

// ── mocks (hoisted) ──
const m = vi.hoisted(() => {
  class AuthError extends Error {
    constructor(public readonly code: "UNAUTHENTICATED" | "FORBIDDEN", message?: string) {
      super(message ?? code);
    }
  }
  return {
    AuthError,
    user: { id: "u1", email: "e@x", name: "Ed", role: "editor" } as const,
    deny: null as null | "UNAUTHENTICATED" | "FORBIDDEN",
    updateTag: vi.fn(),
    disable: vi.fn(),
    redirect: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
    data: {
      getPageById: vi.fn(),
      saveDrafts: vi.fn(),
      publish: vi.fn(),
      updatePage: vi.fn(),
      discardDrafts: vi.fn(),
      listRevisions: vi.fn(),
      restoreRevision: vi.fn(),
      uploadMedia: vi.fn(),
    },
  };
});

vi.mock("next/cache", () => ({ updateTag: m.updateTag }));
vi.mock("next/headers", () => ({ draftMode: async () => ({ disable: m.disable }) }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/data", () => ({ getData: () => m.data }));
vi.mock("@/lib/auth/guards", () => ({
  AuthError: m.AuthError,
  requirePermission: vi.fn(async () => {
    if (m.deny) throw new m.AuthError(m.deny, m.deny === "FORBIDDEN" ? "Missing permission" : "Sign in");
    return m.user;
  }),
}));

import {
  discardDrafts,
  exitEditMode,
  listBlockRevisions,
  publishContent,
  saveDrafts,
  uploadMedia,
} from "./actions";

const PAGE = "6ab793c3-2491-4693-bcea-081c2150c674";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

beforeEach(() => {
  vi.clearAllMocks();
  m.deny = null;
  m.data.getPageById.mockImplementation(async (id: string) => (id === PAGE ? { id, status: "draft" } : null));
  m.data.publish.mockResolvedValue(2);
  m.data.uploadMedia.mockImplementation(async (file: { name: string; type: string }, alt: string) => ({
    id: "m1",
    url: "/api/media/x.png",
    filename: file.name,
    contentType: file.type,
    alt,
  }));
});

describe("saveDrafts", () => {
  const change = { scope: PAGE, key: "hero.title", type: "text", value: { text: "Hi" } };

  it("saves valid changes", async () => {
    const res = await saveDrafts([change, { ...change, scope: "global", key: "footer.note" }]);
    expect(res).toEqual({ ok: true, saved: 2 });
    expect(m.data.saveDrafts).toHaveBeenCalledWith(expect.any(Array), "u1");
  });

  it("dedupes keys (last wins)", async () => {
    await saveDrafts([change, { ...change, value: { text: "Second" } }]);
    expect(m.data.saveDrafts.mock.calls[0][0]).toEqual([{ ...change, value: { text: "Second" } }]);
  });

  it("rejects invalid payloads without touching data", async () => {
    for (const bad of [
      "nope",
      [{ ...change, type: "image", value: { src: "javascript:alert(1)", alt: "" } }],
      [{ ...change, key: "../x" }],
      [{ ...change, type: "link", value: { text: "x", href: "javascript:alert(1)" } }],
      Array.from({ length: 501 }, () => change),
    ]) {
      const res = await saveDrafts(bad);
      expect(res).toMatchObject({ ok: false, code: "INVALID" });
    }
    expect(m.data.saveDrafts).not.toHaveBeenCalled();
  });

  it("rejects unknown page scopes", async () => {
    const res = await saveDrafts([{ ...change, scope: "11111111-1111-4111-8111-111111111111" }]);
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("maps auth errors", async () => {
    m.deny = "UNAUTHENTICATED";
    expect(await saveDrafts([change])).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    m.deny = "FORBIDDEN";
    expect(await saveDrafts([change])).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("never leaks internal errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.data.saveDrafts.mockRejectedValueOnce(new Error("db password is hunter2"));
    const res = await saveDrafts([change]);
    expect(res).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    spy.mockRestore();
  });
});

describe("publishContent", () => {
  it("publishes and updates content tags", async () => {
    const res = await publishContent({ scopes: [PAGE, "global"] });
    expect(res).toEqual({ ok: true, published: 2, pagePublished: false });
    expect(m.updateTag).toHaveBeenCalledWith(`content:${PAGE}`);
    expect(m.updateTag).toHaveBeenCalledWith("content:global");
    expect(m.updateTag).not.toHaveBeenCalledWith("pages");
  });

  it("can publish the page itself", async () => {
    const res = await publishContent({ scopes: [PAGE], publishPageId: PAGE });
    expect(res).toMatchObject({ ok: true, pagePublished: true });
    expect(m.data.updatePage).toHaveBeenCalledWith(PAGE, { status: "published" }, "u1");
    expect(m.updateTag).toHaveBeenCalledWith("pages");
    expect(m.updateTag).toHaveBeenCalledWith(`page:${PAGE}`);
  });

  it("requires publish permission", async () => {
    m.deny = "FORBIDDEN";
    expect(await publishContent({ scopes: [PAGE] })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(m.data.publish).not.toHaveBeenCalled();
  });

  it("validates scopes", async () => {
    expect(await publishContent({ scopes: [] })).toMatchObject({ ok: false, code: "INVALID" });
    expect(await publishContent({ scopes: ["pages"] })).toMatchObject({ ok: false, code: "INVALID" });
  });
});

describe("discardDrafts / listBlockRevisions", () => {
  it("discards validated scopes", async () => {
    expect(await discardDrafts([PAGE, "global", PAGE])).toEqual({ ok: true });
    expect(m.data.discardDrafts).toHaveBeenCalledWith([PAGE, "global"]);
  });
  it("validates revision lookups", async () => {
    m.data.listRevisions.mockResolvedValue([]);
    expect(await listBlockRevisions(PAGE, "hero.title")).toEqual({ ok: true, revisions: [] });
    expect(await listBlockRevisions(PAGE, "bad key!")).toMatchObject({ ok: false, code: "INVALID" });
  });
});

describe("uploadMedia", () => {
  const form = (bytes: Uint8Array, name: string, type: string, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.set("file", new File([bytes as BlobPart], name, { type }));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };

  it("stores sniffed type and sanitized name", async () => {
    const res = await uploadMedia(form(PNG, "../My Pic.svg", "image/svg+xml", { alt: "A cat", width: "10", height: "20" }));
    expect(res.ok).toBe(true);
    const [file, alt] = m.data.uploadMedia.mock.calls[0];
    expect(file).toMatchObject({ name: "My-Pic.png", type: "image/png", width: 10, height: 20 });
    expect(alt).toBe("A cat");
    expect(m.updateTag).toHaveBeenCalledWith("media");
  });

  it("rejects svg disguised as png", async () => {
    const svg = new TextEncoder().encode("<svg onload=alert(1)></svg>");
    expect(await uploadMedia(form(svg, "x.png", "image/png"))).toMatchObject({ ok: false, code: "INVALID" });
    expect(m.data.uploadMedia).not.toHaveBeenCalled();
  });

  it("rejects bad dimensions and missing files", async () => {
    expect(await uploadMedia(form(PNG, "x.png", "image/png", { width: "-5" }))).toMatchObject({ ok: false });
    expect(await uploadMedia(new FormData())).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("requires media permission", async () => {
    m.deny = "FORBIDDEN";
    expect(await uploadMedia(form(PNG, "x.png", "image/png"))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("exitEditMode", () => {
  it("disables draft mode and redirects to a safe path", async () => {
    await expect(exitEditMode("/about")).rejects.toThrow("NEXT_REDIRECT");
    expect(m.disable).toHaveBeenCalled();
    expect(m.redirect).toHaveBeenCalledWith("/about");
  });
  it("never redirects off-site", async () => {
    await expect(exitEditMode("//evil.com")).rejects.toThrow("NEXT_REDIRECT");
    expect(m.redirect).toHaveBeenCalledWith("/");
  });
});
