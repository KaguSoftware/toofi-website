"use client";

import Image from "next/image";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { uploadMedia } from "@/lib/content/actions";
import { imageValueSchema, type ImageValue } from "@/lib/content/schemas";
import { IMAGE_ACCEPT, MAX_UPLOAD_BYTES } from "@/lib/media/validate";
import { useEditorApi } from "./context";
import { Popover } from "./Popover";
import type { EditableImageClientProps } from "./types";

/** Read natural dimensions in the browser (the server stores what we send, after range checks). */
async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      const dims = { width: bmp.width, height: bmp.height };
      bmp.close();
      return dims;
    } catch {
      // fall through (e.g. AVIF unsupported by createImageBitmap in some browsers)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function EditableImageClient({ scope, blockKey, initial, className, sizes, priority }: EditableImageClientProps) {
  const api = useEditorApi();
  const [value, setValue] = useState<ImageValue>(initial);
  const [open, setOpen] = useState(false);
  const [uploading, startUpload] = useTransition();
  const anchorRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ids = useId();

  // Adopt new server values (after discard/restore) unless there are unsaved edits.
  const syncToken = `${api.resetVersion}|${JSON.stringify(initial)}`;
  const [seenToken, setSeenToken] = useState(syncToken);
  if (seenToken !== syncToken) {
    setSeenToken(syncToken);
    if (!api.isDirty(scope, blockKey)) setValue(initial);
  }

  const update = (next: ImageValue) => {
    setValue(next);
    const parsed = imageValueSchema.safeParse(next);
    if (parsed.success) api.setChange({ scope, key: blockKey, type: "image", value: parsed.data });
  };

  const toggle = () => {
    api.focusBlock({ scope, key: blockKey, type: "image" });
    setOpen((o) => !o);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Images must be 8 MB or smaller.");
      return;
    }
    const toastId = toast.loading("Uploading image…");
    startUpload(async () => {
      const dims = await readDimensions(file);
      const fd = new FormData();
      fd.set("file", file);
      fd.set("alt", value.alt);
      if (dims) {
        fd.set("width", String(dims.width));
        fd.set("height", String(dims.height));
      }
      let res: Awaited<ReturnType<typeof uploadMedia>>;
      try {
        res = await uploadMedia(fd);
      } catch {
        res = { ok: false, error: "Upload failed — check your connection and try again." };
      }
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }
      update({
        src: res.media.url,
        alt: value.alt,
        width: res.media.width ?? dims?.width,
        height: res.media.height ?? dims?.height,
      });
      toast.success("Image replaced — save or publish to keep it.", { id: toastId });
    });
  };

  return (
    <>
      {/* No wrapper element: the <img> itself is the trigger so layout is identical to view mode. */}
      <Image
        ref={anchorRef}
        src={value.src}
        alt={value.alt}
        width={value.width ?? 1600}
        height={value.height ?? 900}
        sizes={sizes ?? "100vw"}
        priority={priority}
        className={className}
        role="button"
        tabIndex={0}
        data-sawad-editable="image"
        data-busy={uploading || undefined}
        aria-label={`Edit image${value.alt ? `: ${value.alt}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={uploading || undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      />
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Image settings">
        <div className="sawad-form">
          <div className="sawad-row">
            <button
              type="button"
              className="sawad-btn sawad-btn-primary"
              disabled={uploading}
              aria-busy={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Replace image"}
            </button>
            <span className="sawad-hint">JPEG, PNG, WebP, GIF or AVIF · max 8 MB</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <label className="sawad-field" htmlFor={`${ids}-alt`}>
            <span>Alt text</span>
          </label>
          <textarea
            id={`${ids}-alt`}
            rows={2}
            maxLength={500}
            value={value.alt}
            placeholder="Describe the image for screen readers (leave empty if decorative)"
            onChange={(e) => update({ ...value, alt: e.target.value })}
          />
        </div>
      </Popover>
    </>
  );
}
