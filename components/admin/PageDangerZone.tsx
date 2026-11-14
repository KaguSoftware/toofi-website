"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePage, setPageStatus } from "@/lib/admin/actions";
import { Spinner, btnDanger, btnPrimary, btnSecondary } from "./ui";

export function PageStatusButton({ pageId, status }: { pageId: string; status: "draft" | "published" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const next = status === "published" ? "draft" : "published";
  return (
    <button
      type="button"
      disabled={pending}
      className={status === "published" ? btnSecondary : btnPrimary}
      onClick={() =>
        start(async () => {
          const res = await setPageStatus(pageId, next);
          if (res.ok) {
            toast.success(res.message ?? "Updated");
            router.refresh();
          } else toast.error(res.error);
        })
      }
    >
      {pending && <Spinner />}
      {status === "published" ? "Unpublish page" : "Publish page"}
    </button>
  );
}

export function DeletePageButton({ pageId, title, disabledReason }: { pageId: string; title: string; disabledReason?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div>
      <button
        type="button"
        disabled={pending || !!disabledReason}
        className={btnDanger}
        onClick={() => {
          if (!window.confirm(`Delete "${title}" and all of its content? This cannot be undone.`)) return;
          start(async () => {
            const res = await deletePage(pageId);
            if (res.ok) {
              toast.success(res.message ?? "Deleted");
              router.push("/admin/pages");
              router.refresh();
            } else toast.error(res.error);
          });
        }}
      >
        {pending && <Spinner />}
        Delete page
      </button>
      {disabledReason && <p className="mt-1.5 text-xs text-neutral-500">{disabledReason}</p>}
    </div>
  );
}
