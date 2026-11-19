import type { Editables } from "@/lib/content/editables";
import type { Locale } from "@/lib/sawad/data";
import { t } from "@/lib/sawad/i18n";
import { TWEAK_KEYS } from "@/lib/sawad/tweaks";

/**
 * Owner settings, visible only in edit mode (visitors never see it). The values
 * are global text blocks, so they save and publish with the rest of the page.
 */
export function TweaksPanel({ g, locale }: { g?: Editables; locale: Locale }) {
  if (!g?.editing) return null;
  const d = t(locale).tweaks;
  return (
    <aside className="tweaks container" aria-label={d.title}>
      <strong>{d.title}</strong>
      <div className="tweaks__row">
        <span className="t-small">{d.experience}</span>
        <g.Text k={TWEAK_KEYS.experience} fallback="both" />
      </div>
      <div className="tweaks__row">
        <span className="t-small">{d.startView}</span>
        <g.Text k={TWEAK_KEYS.startView} fallback="flight" />
      </div>
    </aside>
  );
}
