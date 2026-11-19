/**
 * Owner settings ("Tweaks"), stored as global text blocks so they are edited inline
 * in edit mode like any other content:
 *   tweaks.experience  both | film | explorer
 *   tweaks.startView   flight | street | terrace | aerial
 * Anything else falls back to the default, so a typo never breaks the page.
 */

export const VIEW_IDS = ["flight", "street", "terrace", "aerial"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export const EXPERIENCES = ["both", "film", "explorer"] as const;
export type Experience = (typeof EXPERIENCES)[number];

export const TWEAK_KEYS = { experience: "tweaks.experience", startView: "tweaks.startView" } as const;

export function parseExperience(raw: string | null | undefined): Experience {
  const v = (raw ?? "").trim().toLowerCase();
  return (EXPERIENCES as readonly string[]).includes(v) ? (v as Experience) : "both";
}

export function parseView(raw: string | null | undefined, fallback: ViewId = "flight"): ViewId {
  const v = (raw ?? "").trim().toLowerCase();
  return (VIEW_IDS as readonly string[]).includes(v) ? (v as ViewId) : fallback;
}

/** Film = the moving hero on Home. Explorer = the interactive scene in the finder. */
export function showsFilm(e: Experience): boolean {
  return e !== "explorer";
}
export function showsExplorer(e: Experience): boolean {
  return e !== "film";
}
