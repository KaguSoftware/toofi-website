import { Object3D, PerspectiveCamera, Raycaster, SRGBColorSpace, Sprite, Vector2 } from "three";
import { describe, expect, it, vi } from "vitest";
import { markerBase, markerPosition, planMarkerBase, planMarkerPosition } from "./layout";
import {
  CREAM,
  MARKER_COLORS,
  SELECTED_SCALE_FACTOR,
  createMarkerMaterials,
  drawMarker,
  markerRenderOrder,
  markerScale,
  markerStems,
  pickMarker,
} from "./markers";
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
    expect(CREAM.toLowerCase()).not.toBe("#b8963f");
  });
});

describe("createMarkerMaterials (no DOM)", () => {
  it("makes one screen-space material per status and selection, shared by every marker", () => {
    const materials = createMarkerMaterials();
    const all = new Set((["available", "reserved", "sold"] as const).flatMap((s) => [materials.get(s, false), materials.get(s, true)]));
    expect(all.size).toBe(6);
    expect(materials.get("sold", false)).toBe(materials.get("sold", false));
    for (const m of all) {
      expect(m.sizeAttenuation).toBe(false); // a constant size on screen
      expect(m.depthTest).toBe(false); // never hidden behind a building
    }
    // Without a canvas to draw on, the status colour still tells them apart.
    expect(materials.get("available", false).map).toBeNull();
    expect(`#${materials.get("available", false).color.getHexString()}`).toBe(MARKER_COLORS.available);
    materials.dispose();
  });

  it("disposes every material", () => {
    const materials = createMarkerMaterials();
    const spies = (["available", "reserved", "sold"] as const).map((s) => vi.spyOn(materials.get(s, true), "dispose"));
    materials.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});

describe("createMarkerMaterials (with a canvas)", () => {
  it("draws every status shape onto its own sRGB texture", () => {
    const drawn: string[][] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const { ctx, calls } = fakeCtx();
        drawn.push(calls);
        return { width: 0, height: 0, getContext: () => ctx };
      },
    });
    try {
      const materials = createMarkerMaterials();
      expect(drawn).toHaveLength(6);
      for (const calls of drawn) expect(calls).toContain("arc");
      const available = materials.get("available", false);
      expect(available.map).not.toBeNull();
      expect(available.map?.colorSpace).toBe(SRGBColorSpace);
      expect(available.color.getHexString()).toBe("ffffff"); // the texture carries the colour
      expect(materials.get("available", true).map).not.toBe(available.map);
      const texture = vi.spyOn(available.map!, "dispose");
      materials.dispose();
      expect(texture).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to plain colours when the canvas has no 2D context", () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    try {
      const materials = createMarkerMaterials();
      expect(materials.get("reserved", false).map).toBeNull();
      expect(`#${materials.get("reserved", false).color.getHexString()}`).toBe(MARKER_COLORS.reserved);
      materials.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("marker prominence", () => {
  it("scales the selected marker up and lets sold homes recede", () => {
    const plain = markerScale("available", false);
    expect(markerScale("reserved", false)).toBe(plain);
    expect(markerScale("available", true)).toBeCloseTo(plain * SELECTED_SCALE_FACTOR);
    expect(markerScale("sold", true)).toBeCloseTo(plain * SELECTED_SCALE_FACTOR);
    expect(markerScale("sold", false)).toBeLessThan(plain);
  });

  it("draws the selected marker on top, then open homes, then sold ones", () => {
    expect(markerRenderOrder("sold", true)).toBeGreaterThan(markerRenderOrder("available", false));
    expect(markerRenderOrder("available", false)).toBe(markerRenderOrder("reserved", false));
    expect(markerRenderOrder("reserved", false)).toBeGreaterThan(markerRenderOrder("sold", false));
  });
});

describe("markerStems", () => {
  it("runs one segment from each home up to just under its marker", () => {
    const stems = markerStems(markers, "dijla");
    expect(stems).toHaveLength(markers.length * 6);
    const base = markerBase(markers[1]);
    const top = markerPosition(markers[1]);
    expect(Array.from(stems.slice(6, 12))).toEqual([base.x, base.y, base.z, top.x, top.y - 1.2, top.z].map(Math.fround));
    expect(markerStems([], "dijla")).toHaveLength(0);
  });

  it("stands Zaitun Hills' stems on its 28 ha plots, including slots past the 7 ha layout's 24 villas", () => {
    const zaitun: SceneMarker[] = [
      { id: "ZH-V60", kind: "villa", slot: 59, status: "available", label: "ZH-V60" },
      { id: "ZH-A24", kind: "apartment", slot: 23, status: "sold", label: "ZH-A24" },
    ];
    const stems = markerStems(zaitun, "zaitun");
    zaitun.forEach((m, i) => {
      const base = planMarkerBase(m);
      const top = planMarkerPosition(m);
      expect(Array.from(stems.slice(i * 6, i * 6 + 6))).toEqual([base.x, base.y, base.z, top.x, top.y - 1.2, top.z].map(Math.fround));
    });
  });
});

function sprite(marker: SceneMarker, selected = false): Sprite {
  const s = new Sprite(createMarkerMaterials().get(marker.status, selected));
  const p = markerPosition(marker);
  s.position.set(p.x, p.y, p.z);
  s.scale.setScalar(markerScale(marker.status, selected));
  s.renderOrder = markerRenderOrder(marker.status, selected);
  s.userData.id = marker.id;
  s.updateMatrixWorld();
  return s;
}

describe("pickMarker", () => {
  it("picks the marker under the pointer", () => {
    const sprites = markers.map((m) => sprite(m));
    const target = sprites[0].position;
    const camera = new PerspectiveCamera(45, 16 / 9, 0.5, 5000);
    camera.position.set(target.x, target.y + 40, target.z + 60);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(0, 0), camera);
    expect(pickMarker(ray.intersectObjects(sprites, false))).toBe("v1");
    ray.setFromCamera(new Vector2(0.95, 0.95), camera);
    expect(pickMarker(ray.intersectObjects(sprites, false))).toBeNull();
  });

  it("prefers the most prominent marker when sprites overlap, then the nearest", () => {
    const hit = (id: string | undefined, renderOrder: number, distance: number) => {
      const object = new Object3D();
      if (id) object.userData.id = id;
      object.renderOrder = renderOrder;
      return { object, distance };
    };
    // A sold home in front of the selected one: the selection wins.
    expect(pickMarker([hit("sold", 10, 5), hit("selected", 12, 9), hit("open", 11, 7)])).toBe("selected");
    // Equal prominence: the nearer one.
    expect(pickMarker([hit("far", 11, 30), hit("near", 11, 12)])).toBe("near");
    // Stems and anything else without an id are not homes.
    expect(pickMarker([hit(undefined, 99, 1)])).toBeNull();
    expect(pickMarker([hit(undefined, 99, 1), hit("home", 10, 40)])).toBe("home");
    expect(pickMarker([])).toBeNull();
  });
});
