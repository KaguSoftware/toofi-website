/**
 * Lets plain Node (24+, which strips TypeScript types itself) import the scene's TypeScript
 * modules the way the app's bundler does: extensionless relative imports (`./layout`) and the
 * `@/` alias for the repo root. Used by the film's data export:
 *
 *   node --import ./scripts/blender/film/ts-register.mjs scripts/blender/film/scene.mjs
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT_URL = new URL("../../../", import.meta.url);

const HAS_EXTENSION = /\.[cm]?[jt]sx?$|\.json$/;

/** The file URL a specifier names, if it is one this hook should complete, else null. */
export function candidate(specifier, parentURL) {
  let url;
  if (specifier.startsWith("@/")) url = new URL(specifier.slice(2), ROOT_URL);
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && parentURL?.startsWith("file:")) url = new URL(specifier, parentURL);
  else return null;
  if (HAS_EXTENSION.test(url.pathname) && !specifier.startsWith("@/")) return null;
  for (const ext of HAS_EXTENSION.test(url.pathname) ? [""] : [".ts", ".tsx", "/index.ts"]) {
    const path = fileURLToPath(url) + ext;
    if (existsSync(path)) return pathToFileURL(path).href;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  const url = candidate(specifier, context.parentURL);
  return url ? next(url, context) : next(specifier, context);
}
