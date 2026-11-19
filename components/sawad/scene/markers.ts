import { CanvasTexture, SRGBColorSpace, SpriteMaterial, type Intersection } from "three";
import { siteFor } from "./site";
import type { MarkerStatus, SceneMarker, SceneVariant } from "./types";

/** Status is encoded by shape AND colour. Selection is an ink ring, never brass. */
export const MARKER_COLORS: Record<MarkerStatus, string> = {
  available: "#3f9a5f",
  reserved: "#d9822b",
  sold: "#8f8a82",
};
/** Marker outline and stem colour. */
export const CREAM = "#f6f2ea";
const INK = "#1b1a18";
const BASE_SCALE = 0.032;
export const SELECTED_SCALE_FACTOR = 1.6;

/** Draws one marker into a 2D context of size `px`. Exported for tests. */
export function drawMarker(ctx: CanvasRenderingContext2D, status: MarkerStatus, selected: boolean, px: number): void {
  const c = px / 2;
  ctx.clearRect(0, 0, px, px);
  const r = px * (selected ? 0.3 : 0.36);
  if (selected) {
    ctx.beginPath();
    ctx.arc(c, c, px * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.lineWidth = px * 0.07;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  const color = MARKER_COLORS[status];
  // Cream outline for legibility over the scene.
  ctx.beginPath();
  ctx.arc(c, c, r + px * 0.05, 0, Math.PI * 2);
  ctx.fillStyle = CREAM;
  ctx.fill();
  if (status === "available") {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } else if (status === "reserved") {
    ctx.beginPath();
    ctx.arc(c, c, r - px * 0.04, 0, Math.PI * 2);
    ctx.lineWidth = px * 0.08;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c, c - r);
    ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  } else {
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(c, c, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    const k = r * 0.45;
    ctx.moveTo(c - k, c - k);
    ctx.lineTo(c + k, c + k);
    ctx.moveTo(c + k, c - k);
    ctx.lineTo(c - k, c + k);
    ctx.lineWidth = px * 0.07;
    ctx.lineCap = "round";
    ctx.strokeStyle = CREAM;
    ctx.stroke();
  }
}

function makeTexture(status: MarkerStatus, selected: boolean): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const px = 128;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawMarker(ctx, status, selected, px);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const STATUSES: MarkerStatus[] = ["available", "reserved", "sold"];

export type MarkerMaterials = {
  get: (status: MarkerStatus, selected: boolean) => SpriteMaterial;
  dispose: () => void;
};

/** The six sprite materials (three statuses, plain and selected), shared by every marker. */
export function createMarkerMaterials(): MarkerMaterials {
  const materials = new Map<string, SpriteMaterial>();
  for (const status of STATUSES) {
    for (const selected of [false, true]) {
      const map = makeTexture(status, selected);
      materials.set(
        `${status}:${selected}`,
        new SpriteMaterial({
          map,
          color: map ? 0xffffff : MARKER_COLORS[status],
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
          transparent: true,
        }),
      );
    }
  }
  return {
    get: (status, selected) => materials.get(`${status}:${selected}`)!,
    dispose() {
      for (const m of materials.values()) {
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

/** Screen-space size: the selected marker grows, sold ones recede. */
export function markerScale(status: MarkerStatus, selected: boolean): number {
  return BASE_SCALE * (selected ? SELECTED_SCALE_FACTOR : status === "sold" ? 0.8 : 1);
}

/** Draw order, which is also the picking priority: selected, then open homes, then sold. */
export function markerRenderOrder(status: MarkerStatus, selected: boolean): number {
  return selected ? 12 : status === "sold" ? 10 : 11;
}

/** Stem segments from each home up to just under its marker, as xyz pairs, on the variant's plots. */
export function markerStems(markers: SceneMarker[], variant: SceneVariant): Float32Array {
  const site = siteFor(variant);
  const seg = new Float32Array(markers.length * 6);
  markers.forEach((m, i) => {
    const p = site.markerPosition(m);
    const b = site.markerBase(m);
    seg.set([b.x, b.y, b.z, p.x, p.y - 1.2, p.z], i * 6);
  });
  return seg;
}

/**
 * The marker a pointer ray should select: the most prominent one (selected, then open homes)
 * when sprites overlap, then the nearest. Hits on anything that is not a marker are ignored.
 */
export function pickMarker(hits: ReadonlyArray<Pick<Intersection, "object" | "distance">>): string | null {
  const markers = hits.filter((h) => typeof h.object.userData.id === "string");
  if (!markers.length) return null;
  const best = [...markers].sort((a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance)[0];
  return best.object.userData.id as string;
}
