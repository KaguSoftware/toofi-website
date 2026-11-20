// @vitest-environment jsdom
import { useEffect } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { useThree, type RootState } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { describe, expect, it, vi } from "vitest";
import { CLICK_TOLERANCE_PX } from "../scene/flight";
import type { SceneMarker } from "../scene/types";
import { unitBox } from "./units";
import { UnitTargets, type UnitTargetsProps } from "./UnitTargets";

const markers: SceneMarker[] = [
  { id: "v1", kind: "villa", slot: 0, status: "available", label: "V1" },
  { id: "v2", kind: "villa", slot: 1, status: "reserved", label: "V2" },
  { id: "a1", kind: "apartment", slot: 3, status: "sold", label: "A1" },
];

let root: RootState;
function Probe() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    root = get();
  }, [get]);
  return null;
}

async function mount(props: UnitTargetsProps) {
  const tree = (p: UnitTargetsProps) => (
    <>
      <Probe />
      <UnitTargets {...p} />
    </>
  );
  const renderer = await ReactThreeTestRenderer.create(tree(props));
  const group = () => renderer.scene.findByProps({ name: "units" });
  const box = (id: string) => renderer.scene.findByProps({ name: `unit:${id}` }).instance as Mesh;
  /** The homes under the pointer, nearest first, as the event system reports them. */
  const hits = (ids: string[]) => ids.map((id, i) => ({ object: box(id), distance: 10 + i }));
  const veil = (name: "unit-selected" | "unit-hover") => renderer.scene.findAll((n) => n.props.name === name);
  return {
    renderer,
    box,
    veil,
    canvas: root.gl.domElement,
    update: (next: UnitTargetsProps) => renderer.update(tree(next)),
    click: async (ids: string[], delta = 0) => {
      const stopPropagation = vi.fn();
      await renderer.fireEvent(group(), "click", { delta, intersections: hits(ids), stopPropagation });
      return stopPropagation;
    },
    hover: (ids: string[]) => renderer.fireEvent(group(), "pointerMove", { intersections: hits(ids), stopPropagation: vi.fn() }),
    leave: () => renderer.fireEvent(group(), "pointerOut"),
  };
}

describe("UnitTargets", () => {
  it("puts one unseen box around each home, carrying its id", async () => {
    const m = await mount({ markers });
    for (const marker of markers) {
      const mesh = m.box(marker.id);
      const expected = unitBox(marker);
      expect(mesh.isMesh).toBe(true);
      expect(mesh.visible).toBe(false);
      expect(mesh.userData.unit).toBe(marker.id);
      expect(mesh.position.toArray()).toEqual(expected.center);
      expect(mesh.scale.toArray()).toEqual(expected.size);
    }
    expect(m.veil("unit-selected")).toHaveLength(0);
    expect(m.veil("unit-hover")).toHaveLength(0);
    // The list follows the filters.
    await m.update({ markers: [markers[0]] });
    expect(m.renderer.scene.findAll((n) => typeof n.props.name === "string" && n.props.name.startsWith("unit:"))).toHaveLength(1);
    await m.renderer.unmount();
  });

  it("selects the nearest home on a click, but not at the end of a drag", async () => {
    const onSelect = vi.fn();
    const m = await mount({ markers, onSelect });
    const stop = await m.click(["v2", "v1"]);
    expect(stop).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("v2");
    await m.click(["v1"], CLICK_TOLERANCE_PX);
    expect(onSelect).toHaveBeenCalledOnce();
    // Nothing that is a home under the pointer: nothing selected.
    await m.click([]);
    expect(onSelect).toHaveBeenCalledOnce();
    await m.renderer.unmount();
  });

  it("clicks safely without a selection handler", async () => {
    const m = await mount({ markers });
    await expect(m.click(["v1"])).resolves.toBeDefined();
    await m.renderer.unmount();
  });

  it("outlines the selected home and ignores an unknown selection", async () => {
    const m = await mount({ markers, selectedId: "a1" });
    const [selected] = m.veil("unit-selected");
    const box = unitBox(markers[2]);
    expect((selected.instance as Group).position.toArray()).toEqual(box.center);
    expect((selected.instance as Group).scale.toArray()).toEqual(box.size);
    expect(selected.findAllByType("LineSegments")).toHaveLength(1);
    expect(selected.findAllByType("Mesh")).toHaveLength(1);
    await m.update({ markers, selectedId: "missing" });
    expect(m.veil("unit-selected")).toHaveLength(0);
    await m.renderer.unmount();
  });

  it("veils the home under the pointer with a pointer cursor, and clears both on leaving", async () => {
    const m = await mount({ markers, selectedId: "v1" });
    await m.hover(["v2"]);
    expect(m.canvas.style.cursor).toBe("pointer");
    const [hover] = m.veil("unit-hover");
    expect((hover.instance as Group).position.toArray()).toEqual(unitBox(markers[1]).center);
    expect(hover.findAllByType("LineSegments")).toHaveLength(0); // a veil, no outline
    // Hovering the selected home adds no second veil.
    await m.hover(["v1"]);
    expect(m.veil("unit-hover")).toHaveLength(0);
    expect(m.veil("unit-selected")).toHaveLength(1);
    await m.hover(["a1"]);
    await m.leave();
    expect(m.veil("unit-hover")).toHaveLength(0);
    expect(m.canvas.style.cursor).toBe("");
    await m.renderer.unmount();
  });

  it("puts the cursor back when it goes away mid-hover", async () => {
    const m = await mount({ markers });
    await m.hover(["v1"]);
    const canvas = m.canvas;
    expect(canvas.style.cursor).toBe("pointer");
    await m.renderer.unmount();
    expect(canvas.style.cursor).toBe("");
  });
});
