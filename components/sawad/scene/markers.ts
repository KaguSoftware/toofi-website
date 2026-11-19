import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LineBasicMaterial,
  LineSegments,
  Raycaster,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { markerBase, markerPosition } from "./layout";
import type { MarkerStatus, SceneMarker } from "./types";

/** Status is encoded by shape AND colour. Selection is an ink ring, never brass. */
export const MARKER_COLORS: Record<MarkerStatus, string> = {
  available: "#3f9a5f",
  reserved: "#d9822b",
  sold: "#8f8a82",
};
const CREAM = "#f6f2ea";
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

export type MarkerLayer = {
  group: Group;
  setMarkers: (markers: SceneMarker[]) => void;
  setSelected: (id: string | null) => void;
  pick: (raycaster: Raycaster) => string | null;
  positionOf: (id: string) => Vector3 | null;
  ids: () => string[];
  dispose: () => void;
};

export function createMarkerLayer(): MarkerLayer {
  const group = new Group();
  group.name = "markers";
  const materials = new Map<string, SpriteMaterial>();
  const sprites = new Map<string, Sprite>();
  const data = new Map<string, SceneMarker>();
  let selected: string | null = null;

  const lineGeo = new BufferGeometry();
  const lineMat = new LineBasicMaterial({ color: CREAM, transparent: true, opacity: 0.75, depthTest: false });
  const lines = new LineSegments(lineGeo, lineMat);
  lines.renderOrder = 9;
  lines.frustumCulled = false;
  group.add(lines);

  const material = (status: MarkerStatus, isSelected: boolean) => {
    const key = `${status}:${isSelected}`;
    let m = materials.get(key);
    if (!m) {
      const map = makeTexture(status, isSelected);
      m = new SpriteMaterial({
        map,
        color: map ? 0xffffff : MARKER_COLORS[status],
        sizeAttenuation: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      });
      materials.set(key, m);
    }
    return m;
  };

  const apply = (id: string) => {
    const s = sprites.get(id);
    const d = data.get(id);
    if (!s || !d) return;
    const isSel = id === selected;
    s.material = material(d.status, isSel);
    s.scale.setScalar(BASE_SCALE * (isSel ? SELECTED_SCALE_FACTOR : d.status === "sold" ? 0.8 : 1));
    s.renderOrder = isSel ? 12 : d.status === "sold" ? 10 : 11;
  };

  function setMarkers(markers: SceneMarker[]) {
    for (const s of sprites.values()) group.remove(s);
    sprites.clear();
    data.clear();
    const seg: number[] = [];
    for (const m of markers) {
      const p = markerPosition(m);
      const b = markerBase(m);
      const sprite = new Sprite(material(m.status, false));
      sprite.position.set(p.x, p.y, p.z);
      sprite.center.set(0.5, 0.5);
      sprite.userData.id = m.id;
      sprite.name = `marker:${m.id}`;
      sprites.set(m.id, sprite);
      data.set(m.id, m);
      group.add(sprite);
      seg.push(b.x, b.y, b.z, p.x, p.y - 1.2, p.z);
      apply(m.id);
    }
    lineGeo.setAttribute("position", new BufferAttribute(new Float32Array(seg), 3));
    lineGeo.computeBoundingSphere();
    if (selected && !sprites.has(selected)) selected = null;
  }

  function setSelected(id: string | null) {
    const prev = selected;
    selected = id && sprites.has(id) ? id : null;
    if (prev) apply(prev);
    if (selected) apply(selected);
  }

  function pick(raycaster: Raycaster): string | null {
    group.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects([...sprites.values()], false);
    if (!hits.length) return null;
    // Prefer the most prominent (selected, then available) when sprites overlap.
    hits.sort((a, b) => b.object.renderOrder - a.object.renderOrder || a.distance - b.distance);
    return (hits[0].object.userData.id as string) ?? null;
  }

  function positionOf(id: string): Vector3 | null {
    const s = sprites.get(id);
    return s ? s.position.clone() : null;
  }

  function dispose() {
    for (const m of materials.values()) {
      m.map?.dispose();
      m.dispose();
    }
    materials.clear();
    lineGeo.dispose();
    lineMat.dispose();
    group.clear();
    sprites.clear();
    data.clear();
  }

  return { group, setMarkers, setSelected, pick, positionOf, ids: () => [...sprites.keys()], dispose };
}
