import {
  COMPOUND_CENTER,
  PLAN_CENTER,
  PLAN_SITE,
  SITE,
  isRiver,
  markerBase,
  markerPosition,
  planIsRiver,
  planMarkerBase,
  planMarkerPosition,
  planRiverCenterZ,
  planTerrainHeight,
  riverCenterZ,
  riverGeometryParams,
  terrainHeight,
  type Point3,
  type Rect,
  type RiverParams,
} from "./layout";
import type { SceneMarker, SceneVariant } from "./types";

/**
 * The ground plan a compound's scene is drawn on. Zaitun Hills is on the 28 ha masterplan (the
 * `plan...` half of layout.ts); Bustan Dijla and Shatt Gardens stay on the 7 ha layout until
 * they inherit the new one. Everything in the scene that asks "where" goes through here, so the
 * switch is one place and the other two compounds keep drawing exactly what they drew before.
 */
export type Site = {
  variant: SceneVariant;
  /** True on the 28 ha masterplan. */
  plan: boolean;
  /** Inside the boundary wall. */
  bounds: Rect;
  /** What an orbiting camera looks at by default. */
  center: Point3;
  river: RiverParams;
  /** Ground height; the water surface is y = 0. */
  ground: (x: number, z: number) => number;
  isWater: (x: number, z: number) => boolean;
  riverCenterZ: (x: number) => number;
  /** Where a home's status marker floats, and where its stem meets the building. */
  markerPosition: (marker: Pick<SceneMarker, "kind" | "slot">) => Point3;
  markerBase: (marker: Pick<SceneMarker, "kind" | "slot">) => Point3;
};

/** The variants drawn on the 28 ha masterplan. */
export const PLAN_VARIANTS: ReadonlySet<SceneVariant> = new Set(["zaitun"]);

export const usesPlan = (variant: SceneVariant): boolean => PLAN_VARIANTS.has(variant);

const cache = new Map<SceneVariant, Site>();

export function siteFor(variant: SceneVariant): Site {
  const hit = cache.get(variant);
  if (hit) return hit;
  const site: Site = usesPlan(variant)
    ? {
        variant,
        plan: true,
        bounds: PLAN_SITE,
        center: PLAN_CENTER,
        river: riverGeometryParams(variant),
        ground: planTerrainHeight,
        isWater: planIsRiver,
        riverCenterZ: planRiverCenterZ,
        markerPosition: planMarkerPosition,
        markerBase: planMarkerBase,
      }
    : {
        variant,
        plan: false,
        bounds: SITE,
        center: COMPOUND_CENTER,
        river: riverGeometryParams(variant),
        ground: (x, z) => terrainHeight(variant, x, z),
        isWater: (x, z) => isRiver(variant, x, z),
        riverCenterZ: (x) => riverCenterZ(variant, x),
        markerPosition,
        markerBase,
      };
  cache.set(variant, site);
  return site;
}
