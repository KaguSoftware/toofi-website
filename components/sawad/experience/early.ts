import { REFUSED_NETWORKS } from "../scene/capability";
import { assetUrl } from "../scene/assetUrl";
import type { QualityTier, ViewId } from "../scene/types";
import { REEL_CODECS, REEL_TYPE, reelSources, type ReelShape } from "./reel";

/**
 * What the page does before its JavaScript arrives (T1, T8).
 *
 * The server cannot know the device, so it renders the stills and two empty video elements, and
 * the page's code decides the rest about two seconds into a phone's load. Two things cannot wait
 * that long:
 *
 * - The reel's opening (reel.ts). Started by the page's code it would begin after hydration; the
 *   inline script gives the video its file and plays it while the document is still being parsed,
 *   so the story moves about as soon as the poster has painted.
 * - The story stills. Lazy images load as soon as they are near the screen, which is before
 *   React can hide them, so one or two were downloaded and never shown (S3-6).
 *
 * The script makes the same decision capability.ts `playsReel` makes, from the same constants;
 * early.test.ts holds the two to each other. It asks for no WebGL context and no model: the 3D
 * loads only when a visitor opens the explorer (`preloadFirstAssets`, called then).
 */

/** Set on the experience's root by the early script when the reel is coming (experience.css hides the stills on it). */
export const EARLY_ATTR = "data-early";

/**
 * The first file the scene waits for, per tier. These are `PLAN_FAR_MODEL_URL` of
 * scene/compoundModel.ts, repeated here because that module pulls in three.js and cannot be
 * read from the server or from the first-render code; early.test.ts fails if they drift.
 */
export const FIRST_MODEL_URL: Record<QualityTier, string> = {
  high: assetUrl("/sawad/models/compound-zaitun-far-high.glb"),
  low: assetUrl("/sawad/models/compound-zaitun-far-low.glb"),
};
/** The texture decoder (`BASIS_TRANSCODER_PATH` of scene/compoundModel.ts): every model needs it. */
export const DECODER_URLS: readonly string[] = ["basis_transcoder.js", "basis_transcoder.wasm"].map((f) => assetUrl("/sawad/basis/") + f);

/** What the first frame cannot start without, for a tier. */
export const firstAssets = (tier: QualityTier): string[] => [FIRST_MODEL_URL[tier], ...DECODER_URLS];

/**
 * What a visitor downloads before the live scene, in megabytes on the wire, for the label of the
 * button that opens the explorer on a slow link or a small device (T37). From the rig after F2A
 * (perf/FINDINGS.md, section 1): 3.60 MB on the phone profile, 6.11 MB on desktop. Update them
 * when RS has measured the fixed site.
 */
export const LIVE_DOWNLOAD_MB: Record<QualityTier, number> = { low: 3.6, high: 6.1 };

/**
 * Adds preload hints for a tier's first files, unless they are there already. The request is
 * made the way three's loaders will make it (a CORS fetch without credentials), so the loader
 * takes the preloaded response instead of asking again.
 */
export function preloadFirstAssets(tier: QualityTier, doc: Document = document): void {
  const have = new Set(Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]'), (l) => l.getAttribute("href")));
  for (const url of firstAssets(tier)) {
    if (have.has(url)) continue;
    const link = doc.createElement("link");
    link.rel = "preload";
    link.setAttribute("as", "fetch");
    link.crossOrigin = "anonymous";
    link.href = url;
    doc.head.appendChild(link);
  }
}

const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

/** How the early script finds the opening's video element inside the experience's root (StoryReel.tsx renders it). */
export const OPENING_VIDEO_SELECTOR = 'video[data-reel="opening"]';

/**
 * The early decision as source text: a function of the experience's root element and the
 * opening's files for each shape, best codec first, as [type, address] pairs. It mirrors
 * `playsReel` of capability.ts and `reelShape` and `playableCodecs` of reel.ts. Where the reel plays, it marks the root (experience.css then keeps the stills from
 * loading) and starts the opening: muted and inline, which is what lets a browser play it unasked.
 * A browser that still refuses (iOS in Low Power Mode) keeps the poster; StoryReel.tsx starts the
 * video at the visitor's first touch.
 */
export const EARLY_FUNCTION = `function(root,files){
var n=navigator,c=n.connection||{},w=window;
var mm=function(q){return typeof w.matchMedia==="function"&&w.matchMedia(q).matches};
if(!root)return;
if(c.saveData)return;
if(c.effectiveType&&${json([...REFUSED_NETWORKS])}.indexOf(c.effectiveType)>=0)return;
if(mm("(prefers-reduced-motion: reduce)"))return;
root.setAttribute(${json(EARLY_ATTR)},"story");
var v=root.querySelector(${json(OPENING_VIDEO_SELECTOR)});
if(!v)return;
v.muted=true;v.defaultMuted=true;v.playsInline=true;v.setAttribute("playsinline","");v.preload="auto";
var f=files[w.innerHeight>w.innerWidth?"tall":"wide"];
for(var i=0;i<f.length;i++)if(!f[i][0]||v.canPlayType(f[i][0])==="probably"){v.src=f[i][1];break}
try{var p=v.play();if(p&&p.catch)p.catch(function(){})}catch(e){}
}`;

/**
 * The inline script for a start view: the early decision, run on the experience the script tag
 * sits in. It goes after the reel's video elements and before the stills.
 */
export function earlyScript(view: ViewId): string {
  const pairs = (shape: ReelShape) => REEL_CODECS.map((codec) => [REEL_TYPE[codec], reelSources(view, shape, codec).opening]);
  const files = { wide: pairs("wide"), tall: pairs("tall") };
  return `(${EARLY_FUNCTION})(document.currentScript&&document.currentScript.closest&&document.currentScript.closest(".xp"),${json(files)})`;
}
