import versions from "./assetVersions.json";

/**
 * The address to fetch a scene asset from. Every model, lightmap page and the Basis transcoder ship
 * with a hash of their content in their names (scripts/blender/version-assets.mjs, ledger T32), so
 * they may be cached for a year; this turns the stable path the code names
 * (`/sawad/models/compound-zaitun-far-low.glb`) into the versioned one. The map is bundled with this
 * script, so it costs no request and changes whenever a file does. A path the map does not know is
 * returned as it is (a file outside the versioned set).
 */
export function assetUrl(path: string): string {
  return (versions as Record<string, string>)[path] ?? path;
}
