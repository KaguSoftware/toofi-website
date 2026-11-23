import {
  HIGH_TIER_MEMORY_GB,
  HIGH_TIER_THREADS,
  MIN_MEMORY_GB,
  MIN_THREADS,
  OFFERED_NETWORKS,
  PHONE_SHORT_SIDE,
  PROBE_KEY,
  REFUSED_NETWORKS,
  SOFTWARE_RENDERER,
  WEAK_GPU,
} from "../scene/capability";
import type { QualityTier } from "../scene/types";

/**
 * What the page does before its JavaScript arrives (T1, T8).
 *
 * The server cannot know the device, so it renders the stills, and the 3D code decides the rest
 * about two seconds into a phone's load. Two things cannot wait that long:
 *
 * - The first model file. Asked for by the 3D code it starts 2.6 s in; a preload hint starts it
 *   with the document (live scene 5.43 → 5.18 s on the phone profile, S6-1). The tier is the
 *   browser's choice, so the hint cannot come from the server.
 * - The story stills. Lazy images load as soon as they are near the screen, which is before
 *   React can hide them, so one or two were downloaded on the live path and never shown (S3-6).
 *
 * A small inline script at the top of the experience makes the same decision capability.ts
 * makes, from the same constants; early.test.ts holds the two to each other.
 */

/** Set on the experience's root by the early script when the live story is coming (experience.css hides the stills on it). */
export const EARLY_ATTR = "data-early";

/**
 * The first file the scene waits for, per tier. These are `PLAN_FAR_MODEL_URL` of
 * scene/compoundModel.ts, repeated here because that module pulls in three.js and cannot be
 * read from the server or from the first-render code; early.test.ts fails if they drift.
 */
export const FIRST_MODEL_URL: Record<QualityTier, string> = {
  high: "/sawad/models/compound-zaitun-far-high.glb",
  low: "/sawad/models/compound-zaitun-far-low.glb",
};
/** The texture decoder (`BASIS_TRANSCODER_PATH` of scene/compoundModel.ts): every model needs it. */
export const DECODER_URLS: readonly string[] = ["/sawad/basis/basis_transcoder.js", "/sawad/basis/basis_transcoder.wasm"];

/** What the first frame cannot start without, for a tier. */
export const firstAssets = (tier: QualityTier): string[] => [FIRST_MODEL_URL[tier], ...DECODER_URLS];

/**
 * What a visitor downloads before the live scene, in megabytes on the wire, for the offer's
 * label (T37). From the rig after F2A (perf/FINDINGS.md, section 1): 3.60 MB on the phone
 * profile, 6.11 MB on desktop. Update them when RS has measured the fixed site.
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

/**
 * The early decision as source text: a function of the experience's root element. It mirrors
 * `render3D` and `qualityTier` of capability.ts with one shortcut: a phone-class device is not
 * asked for a WebGL context here (that costs it about 60 ms before first paint), so a phone
 * without WebGL2 gets a preload it will not use and its stills a moment late. A desktop-class
 * device is asked, because the GPU's name decides its tier; the answer is left on `window` for
 * capability.ts, so the context is still made only once.
 */
export const EARLY_FUNCTION = `function(root){
var n=navigator,c=n.connection||{},w=window;
var mm=function(q){return typeof w.matchMedia==="function"&&w.matchMedia(q).matches};
if(c.saveData)return;
if(c.effectiveType&&${json([...REFUSED_NETWORKS, ...OFFERED_NETWORKS])}.indexOf(c.effectiveType)>=0)return;
if(n.deviceMemory<${MIN_MEMORY_GB}||n.hardwareConcurrency<${MIN_THREADS})return;
if(mm("(prefers-reduced-motion: reduce)"))return;
var s=w.screen,side=s&&s.width>0&&s.height>0?Math.min(s.width,s.height):undefined;
var tier="high";
if(w.innerWidth<${PHONE_SHORT_SIDE}||side<${PHONE_SHORT_SIDE}||mm("(pointer: coarse)")||n.deviceMemory<${HIGH_TIER_MEMORY_GB}||n.hardwareConcurrency<${HIGH_TIER_THREADS})tier="low";
else{
var p={webgl2:false};
try{
var gl=document.createElement("canvas").getContext("webgl2");
if(gl){
var x=gl.getExtension&&gl.getExtension("WEBGL_debug_renderer_info");
var r=gl.getParameter&&gl.getParameter(x?x.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
p={webgl2:true,renderer:typeof r==="string"&&r?r:undefined};
var l=gl.getExtension&&gl.getExtension("WEBGL_lose_context");
if(l)l.loseContext();
}
}catch(e){p={webgl2:false}}
w[${json(PROBE_KEY)}]=p;
if(!p.webgl2||${String(SOFTWARE_RENDERER)}.test(p.renderer||""))return;
if(${String(WEAK_GPU)}.test(p.renderer||""))tier="low";
}
if(root)root.setAttribute(${json(EARLY_ATTR)},"story");
var have={},links=document.head.querySelectorAll('link[rel="preload"]');
for(var i=0;i<links.length;i++)have[links[i].getAttribute("href")]=1;
(${json({ high: firstAssets("high"), low: firstAssets("low") })})[tier].forEach(function(u){
if(have[u])return;
var k=document.createElement("link");k.rel="preload";k.setAttribute("as","fetch");k.crossOrigin="anonymous";k.href=u;document.head.appendChild(k);
});
}`;

/** The inline script: the early decision, run on the element the script tag sits in. */
export const EARLY_SCRIPT = `(${EARLY_FUNCTION})(document.currentScript&&document.currentScript.parentElement)`;
