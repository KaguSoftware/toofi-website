"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteMedia } from "@/lib/admin/actions";
import { Spinner, btnDanger, btnSecondary, btnSmall } from "./ui";

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaCard({
  id,
  url,
  filename,
  alt,
  size,
  canManage,
}: {
  id: string;
  url: string;
  filename: string;
  alt: string;
  size: number;
  canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString());
      setCopied(true);
      toast.success("URL copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the URL manually.");
    }
  }

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex aspect-[4/3] items-center justify-center bg-neutral-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} loading="lazy" className="max-h-full max-w-full object-contain" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-neutral-900" title={filename}>
            {filename}
          </p>
          <p className="text-xs text-neutral-500">{formatSize(size)}</p>
          <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{alt ? `Alt: ${alt}` : <em>No alt text</em>}</p>
        </div>
        <div className="mt-auto flex gap-2">
          <button type="button" onClick={copy} className={`${btnSecondary} ${btnSmall}`}>
            {copied ? "Copied" : "Copy URL"}
          </button>
          {canManage && (
            <button
              type="button"
              disabled={pending}
              className={`${btnDanger} ${btnSmall}`}
              onClick={() => {
                if (!window.confirm(`Delete ${filename}? Pages using it will show a broken image.`)) return;
                start(async () => {
                  const res = await deleteMedia(id);
                  if (res.ok) {
                    toast.success(res.message ?? "Deleted");
                    router.refresh();
                  } else toast.error(res.error);
                });
              }}
            >
              {pending && <Spinner />}
              Delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
