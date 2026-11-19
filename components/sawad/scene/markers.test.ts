import { PerspectiveCamera, Raycaster, Sprite, Vector2 } from "three";
import { describe, expect, it, vi } from "vitest";
import { MARKER_COLORS, SELECTED_SCALE_FACTOR, createMarkerLayer, drawMarker } from "./markers";
import { villaSlot } from "./layout";
import type { SceneMarker } from "./types";

const markers: SceneMarker[] = [
  { id: "v1", kind: "villa", slot: 0, status: "available", label: "V1" },
  { id: "v2", kind: "villa", slot: 1, status: "reserved", label: "V2" },
  { id: "a1", kind: "apartment", slot: 0, status: "sold", label: "A1" },
];

function fakeCtx() {
  const calls: string[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (t, k) => {
      if (k in t) return t[k as string];
      return () => calls.push(String(k));
    },
    set: (t, k, v) => {
      t[k as string] = v;
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D, calls };
}

describe("drawMarker", () => {
  it("draws a different shape per status (never colour alone)", () => {
    const shapes = (["available", "reserved", "sold"] as const).map((s) => {
      const { ctx, calls } = fakeCtx();
      drawMarker(ctx, s, false, 64);
      return calls.join(",");
    });
    expect(new Set(shapes).size).toBe(3);
    const { ctx, calls } = fakeCtx();
    drawMarker(ctx, "sold", false, 64);
    expect(calls).toContain("lineTo"); // the cross
  });

  it("adds an ink selection ring when selected", () => {
    const plain = fakeCtx();
    const sel = fakeCtx();
    drawMarker(plain.ctx, "available", false, 64);
    drawMarker(sel.ctx, "available", true, 64);
    expect(sel.calls.length).toBeGreaterThan(plain.calls.length);
    expect((sel.ctx as unknown as { strokeStyle: string }).strokeStyle).not.toBe("#b8963f");
  });

  it("keeps reserved amber clearly apart from the brass accent", () => {
    expect(MARKER_COLORS.reserved.toLowerCase()).not.toBe("#b8963f");
  });
});

describe("createMarkerLayer (no DOM)", () => {
  it("creates one sprite per marker and tracks positions", () => {
    const layer = createMarkerLayer();
    layer.setMarkers(markers);
    expect(layer.ids()).toEqual(["v1", "v2", "a1"]);
    const p = layer.positionOf("v1")!;
    expect(p.y).toBeCloseTo(villaSlot(0).y);
    expect(layer.positionOf("nope")).toBeNull();
    layer.setMarkers([markers[0]]);
    expect(layer.ids()).toEqual(["v1"]);
    layer.dispose();
  });

  it("scales the selected marker up and ignores unknown ids", () => {
    const layer = createMarkerLayer();
    layer.setMarkers(markers);
    const sprite = layer.group.getObjectByName("marker:v2") as Sprite;
    const before = sprite.scale.x;
    layer.setSelected("v2");
    expect(sprite.scale.x).toBeCloseTo(before * SELECTED_SCALE_FACTOR);
    layer.setSelected("ghost");
    expect(sprite.scale.x).toBeCloseTo(before);
    layer.dispose();
  });

  it("picks the marker under the pointer", () => {
    const layer = createMarkerLayer();
    layer.setMarkers(markers);
    const target = layer.positionOf("v1")!;
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 5000);
    camera.position.set(target.x, target.y + 40, target.z + 60);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), camera);
    expect(layer.pick(ray)).toBe("v1");
    ray.setFromCamera(new Vector2(0.95, 0.95), camera);
    expect(layer.pick(ray)).toBeNull();
    layer.dispose();
  });

  it("disposes materials", () => {
    const layer = createMarkerLayer();
    layer.setMarkers(markers);
    const sprite = layer.group.getObjectByName("marker:v1") as Sprite;
    const spy = vi.spyOn(sprite.material, "dispose");
    layer.dispose();
    expect(spy).toHaveBeenCalled();
  });
});
