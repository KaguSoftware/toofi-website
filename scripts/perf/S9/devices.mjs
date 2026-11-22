#!/usr/bin/env node
/**
 * Track S9: what tier and quality range each kind of device lands in.
 *
 *   node scripts/perf/S9/devices.mjs
 *
 * Runs the shipped decision functions (scene/capability.ts, experience/quality.ts) on a matrix
 * of device archetypes. The inputs per archetype are what each browser reports (navigator.
 * deviceMemory is capped at 8 and absent in Safari and Firefox; hardwareConcurrency counts
 * logical threads; navigator.connection is Chromium only). They are written from vendor
 * specifications, not read off hardware: confirm any row that matters on the real device.
 * No timing, so it does not take the rig's lock.
 */
import { pathToFileURL } from "node:url";
import { canRender3D, qualityTier } from "../../../components/sawad/scene/capability.ts";
import { QUALITY_RANGE, fpsBounds, startQuality } from "../../../components/sawad/experience/quality.ts";
import { mdTable } from "../lib.mjs";

/** Model download sizes (F2A): first frame waits for the far set, the full file follows. */
export const MODEL_MB = { high: { far: 4.69, full: 10.26 }, low: { far: 2.69, full: 4.97 } };

const base = { webgl2: true, reducedMotion: false, mode: "explorer" };
const net4g = { effectiveType: "4g", saveData: false };

/** Device archetypes. `gpu` is a rough class, only used to read the table. */
export const DEVICES = [
  { name: "iPhone 15 Pro, Safari, portrait", gpu: "strong", width: 393, dpr: 3, hardwareConcurrency: 6 },
  { name: "iPhone 15 Pro, Safari, landscape", gpu: "strong", width: 852, dpr: 3, hardwareConcurrency: 6 },
  { name: "Pixel 7, Chrome, portrait", gpu: "mid", width: 412, dpr: 2.625, deviceMemory: 8, hardwareConcurrency: 8, ...net4g },
  { name: "Pixel 7, Chrome, landscape", gpu: "mid", width: 915, dpr: 2.625, deviceMemory: 8, hardwareConcurrency: 8, ...net4g },
  { name: "Galaxy A15 (4 GB), Chrome, portrait", gpu: "weak", width: 412, dpr: 2.6, deviceMemory: 4, hardwareConcurrency: 8, ...net4g },
  { name: "Galaxy A15 (4 GB), Chrome, landscape", gpu: "weak", width: 915, dpr: 2.6, deviceMemory: 4, hardwareConcurrency: 8, ...net4g },
  { name: "Budget Android (2 GB), Chrome", gpu: "weak", width: 360, dpr: 2, deviceMemory: 2, hardwareConcurrency: 8, ...net4g },
  { name: "Android 10-inch tablet (4 GB)", gpu: "weak", width: 800, dpr: 2, deviceMemory: 4, hardwareConcurrency: 8, ...net4g },
  { name: "iPad Air (M2), Safari", gpu: "strong", width: 820, dpr: 2, hardwareConcurrency: 8 },
  { name: "MacBook Air M1, Chrome", gpu: "strong", width: 1440, dpr: 2, deviceMemory: 8, hardwareConcurrency: 8, ...net4g },
  { name: "MacBook Air M1, Safari", gpu: "strong", width: 1440, dpr: 2, hardwareConcurrency: 8 },
  { name: "MacBook Pro M3 Pro, Chrome (the rig)", gpu: "reference", width: 1440, dpr: 2, deviceMemory: 8, hardwareConcurrency: 12, ...net4g },
  { name: "Windows office laptop, 4 cores / 8 threads, Intel UHD, 8 GB", gpu: "weak", width: 1536, dpr: 1.25, deviceMemory: 8, hardwareConcurrency: 8, ...net4g },
  { name: "Windows laptop, 2 cores / 4 threads, Intel UHD, 8 GB", gpu: "weak", width: 1366, dpr: 1, deviceMemory: 8, hardwareConcurrency: 4, ...net4g },
  { name: "Desktop, 8 cores, iGPU, 4K monitor at 100%", gpu: "weak", width: 3840, dpr: 1, deviceMemory: 8, hardwareConcurrency: 8, ...net4g },
  { name: "Firefox with fingerprint protection (2 threads)", gpu: "any", width: 1440, dpr: 2, hardwareConcurrency: 2 },
  { name: "Chrome with Data Saver on, otherwise a MacBook", gpu: "strong", width: 1440, dpr: 2, deviceMemory: 8, hardwareConcurrency: 8, effectiveType: "4g", saveData: true },
  { name: "Pixel 7 on a slow cellular link (effectiveType 3g)", gpu: "mid", width: 412, dpr: 2.625, deviceMemory: 8, hardwareConcurrency: 8, effectiveType: "3g", saveData: false },
];

/** What the shipped code decides for one device. */
export function decide(device) {
  const env = { ...base, ...device };
  if (!canRender3D(env)) return { renders: false };
  const tier = qualityTier(env);
  const range = QUALITY_RANGE[tier];
  const [lower, upper] = fpsBounds(tier, 60);
  return { renders: true, tier, start: startQuality(tier), min: range.min, max: range.max, lower, upper, mb: MODEL_MB[tier] };
}

export function matrix(devices = DEVICES) {
  return devices.map((d) => ({ device: d, ...decide(d) }));
}

export function matrixTable(rows) {
  return mdTable(rows, [
    ["Device", (r) => r.device.name],
    ["GPU class", (r) => r.device.gpu],
    ["Memory / threads", (r) => `${r.device.deviceMemory ?? "n/a"} / ${r.device.hardwareConcurrency}`],
    ["Screen (CSS px)", (r) => `${r.device.width} @${r.device.dpr}×`],
    ["3D?", (r) => (r.renders ? "yes" : "poster only")],
    ["Tier", (r) => r.tier ?? ""],
    ["Levels (start)", (r) => (r.renders ? `${r.min}–${r.max} (${r.start})` : "")],
    ["Model MB (far, full)", (r) => (r.renders ? `${r.mb.far}, ${r.mb.full}` : "")],
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(matrixTable(matrix()));
}
