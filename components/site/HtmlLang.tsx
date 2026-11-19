"use client";

import { useEffect } from "react";

/**
 * The root layout is shared and static, so it renders <html lang="en">. Arabic pages
 * already carry lang/dir on their .site wrapper (what assistive tech reads); this
 * also syncs <html> so browser translation and UA features see the right language.
 */
export function HtmlLang({ lang, dir }: { lang: string; dir: "ltr" | "rtl" }) {
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = dir;
  }, [lang, dir]);
  return null;
}
