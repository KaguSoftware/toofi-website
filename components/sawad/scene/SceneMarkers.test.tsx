import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import type { LineSegments, Sprite } from "three";
import { describe, expect, it, vi } from "vitest";
import { CLICK_TOLERANCE_PX } from "./flight";
import { planVillaSlot, villaSlot } from "./layout";
import { SELECTED_SCALE_FACTOR } from "./markers";
import { SceneMarkers, type SceneMarkersProps } from "./SceneMarkers";
import type { SceneMarker } from "./types";

const markers: SceneMarker[] = [
  { id: "v1", kind: "villa", slot: 0, status: "available", label: "V1" },
  { id: "v2", kind: "villa", slot: 1, status: "reserved", label: "V2" },
  { id: "a1", kind: "apartment", slot: 0, status: "sold", label: "A1" },
];

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

type MountProps = Omit<SceneMarkersProps, "variant"> & { variant?: SceneMarkersProps["variant"] };

async function mount(props: MountProps) {
  const tree = (p: MountProps) => (
    <>
      <Probe />
      <SceneMarkers variant="dijla" {...p} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(tree(props));
  const group = () => renderer.scene.findByProps({ name: "markers" });
  return {
    renderer,
    group,
    update: (next: MountProps) => renderer.update(tree(next)),
    sprites: () => renderer.scene.findAllByType("Sprite").map((s) => s.instance as Sprite),
    sprite: (id: string) => renderer.scene.findByProps({ name: `marker:${id}` }).instance as Sprite,
    /** Clicks with these sprites under the pointer, nearest first, as the event system reports them. */
    click: (ids: string[], delta = 0) => {
      const intersections = ids.map((id, i) => ({ object: renderer.scene.findByProps({ name: `marker:${id}` }).instance as Sprite, distance: 10 + i }));
      const stopPropagation = vi.fn();
      return renderer.fireEvent(group(), "click", { delta, intersections, stopPropagation }).then(() => stopPropagation);
    },
  };
}

describe("SceneMarkers", () => {
  it("stands each marker on its own compound's plan", async () => {
    const m = await mount({ markers, variant: "zaitun" });
    const slot = planVillaSlot(0);
    expect(m.sprite("v1").position.toArray()).toEqual([slot.x, slot.y, slot.z]);
    await m.update({ markers, variant: "dijla" });
    const old = villaSlot(0);
    expect(m.sprite("v1").position.toArray()).toEqual([old.x, old.y, old.z]);
    await m.renderer.unmount();
  });

  it("places one sprite per home above its plot, joined to it by a stem", async () => {
    const m = await mount({ markers });
    expect(m.sprites().map((s) => s.userData.id)).toEqual(["v1", "v2", "a1"]);
    const slot = villaSlot(0);
    expect(m.sprite("v1").position.toArray()).toEqual([slot.x, slot.y, slot.z]);
    const stems = m.renderer.scene.findByType("LineSegments").instance as LineSegments;
    expect(stems.geometry.getAttribute("position").count).toBe(markers.length * 2);
    // The list changes with the filters: the sprites and stems follow.
    await m.update({ markers: [markers[0]] });
    expect(m.sprites().map((s) => s.userData.id)).toEqual(["v1"]);
    expect((m.renderer.scene.findByType("LineSegments").instance as LineSegments).geometry.getAttribute("position").count).toBe(2);
    await m.renderer.unmount();
  });

  it("scales the selected marker up, on top, and ignores an unknown selection", async () => {
    const m = await mount({ markers });
    const before = m.sprite("v2").scale.x;
    const plain = m.sprite("v2").material;
    await m.update({ markers, selectedId: "v2" });
    expect(m.sprite("v2").scale.x).toBeCloseTo(before * SELECTED_SCALE_FACTOR);
    expect(m.sprite("v2").material).not.toBe(plain); // the ringed variant
    expect(m.sprite("v2").renderOrder).toBeGreaterThan(m.sprite("v1").renderOrder);
    await m.update({ markers, selectedId: "ghost" });
    expect(m.sprite("v2").scale.x).toBeCloseTo(before);
    expect(m.sprite("v2").material).toBe(plain);
    await m.renderer.unmount();
  });

  it("selects the clicked home once, preferring the most prominent of overlapping markers", async () => {
    const onSelect = vi.fn();
    const m = await mount({ markers, onSelect, selectedId: "v2" });
    const stop = await m.click(["v1"]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("v1");
    expect(stop).toHaveBeenCalled(); // the sprites behind do not answer too
    onSelect.mockClear();
    // A sold home in front of the selected one: the selection is what the visitor sees.
    await m.click(["a1", "v2"]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("v2");
    await m.renderer.unmount();
  });

  it("treats a drag as a drag, not a click", async () => {
    const onSelect = vi.fn();
    const m = await mount({ markers, onSelect });
    await m.click(["v1"], CLICK_TOLERANCE_PX + 34);
    expect(onSelect).not.toHaveBeenCalled();
    await m.click(["v1"], CLICK_TOLERANCE_PX - 1);
    expect(onSelect).toHaveBeenCalledWith("v1");
    await m.renderer.unmount();
  });

  it("shows a pointer over a home and never raycasts the stems", async () => {
    const m = await mount({ markers });
    const canvas = root.gl.domElement;
    await m.renderer.fireEvent(m.group(), "pointerOver");
    expect(canvas.style.cursor).toBe("pointer");
    await m.renderer.fireEvent(m.group(), "pointerOut");
    expect(canvas.style.cursor).toBe("");
    const stems = m.renderer.scene.findByType("LineSegments").instance as LineSegments;
    const hits: unknown[] = [];
    stems.raycast({} as never, hits as never);
    expect(hits).toHaveLength(0);
    // Leaving the explorer mid-hover does not leave the pointer behind.
    await m.renderer.fireEvent(m.group(), "pointerOver");
    await m.renderer.unmount();
    expect(canvas.style.cursor).toBe("");
  });

  it("frees its materials when it unmounts", async () => {
    const m = await mount({ markers });
    const spy = vi.spyOn(m.sprite("v1").material, "dispose");
    await m.renderer.unmount();
    expect(spy).toHaveBeenCalled();
  });
});
