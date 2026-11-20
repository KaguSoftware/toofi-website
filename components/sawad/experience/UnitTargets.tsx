import { useEffect, useMemo, useState } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { BoxGeometry, EdgesGeometry } from "three";
import { CLICK_TOLERANCE_PX } from "../scene/flight";
import type { SceneMarker } from "../scene/types";
import { pickUnit, unitBoxes, type UnitBox } from "./units";

export type UnitTargetsProps = {
  markers: SceneMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

/** Selection is ink on cream, like the markers: brass is never a status or a selection. */
export const HIGHLIGHT = { fill: "#f6f2ea", line: "#1b1a18" } as const;

function setCursor(canvas: HTMLCanvasElement, cursor: "pointer" | ""): void {
  canvas.style.cursor = cursor;
}

/**
 * The homes themselves as click targets: an unseen box around each villa and each apartment
 * floor. The home under the pointer gets a faint veil; the selected one a veil and an ink outline.
 */
export function UnitTargets({ markers, selectedId = null, onSelect }: UnitTargetsProps) {
  const canvas = useThree((s) => s.gl.domElement);
  const boxes = useMemo(() => unitBoxes(markers), [markers]);
  const geometry = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1);
    return { box, edges: new EdgesGeometry(box) };
  }, []);
  useEffect(
    () => () => {
      geometry.box.dispose();
      geometry.edges.dispose();
    },
    [geometry],
  );
  useEffect(() => () => setCursor(canvas, ""), [canvas]);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const hover = hovered && hovered !== selectedId ? byId.get(hovered) : undefined;

  const select = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta >= CLICK_TOLERANCE_PX) return; // a drag, not a click
    const id = pickUnit(e.intersections);
    if (id) onSelect?.(id);
  };
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(pickUnit(e.intersections));
    setCursor(canvas, "pointer");
  };
  const out = () => {
    setHovered(null);
    setCursor(canvas, "");
  };

  return (
    <>
      <group name="units" onClick={select} onPointerMove={over} onPointerOut={out}>
        {boxes.map((b) => (
          <mesh key={b.id} name={`unit:${b.id}`} userData={{ unit: b.id }} geometry={geometry.box} position={b.center} scale={b.size} visible={false} />
        ))}
      </group>
      {hover ? <Veil box={hover} geometry={geometry} opacity={0.06} outlined={false} /> : null}
      {selected ? <Veil box={selected} geometry={geometry} opacity={0.1} outlined /> : null}
    </>
  );
}

const ignoreRaycast = () => {};

function Veil({ box, geometry, opacity, outlined }: { box: UnitBox; geometry: { box: BoxGeometry; edges: EdgesGeometry }; opacity: number; outlined: boolean }) {
  return (
    <group name={outlined ? "unit-selected" : "unit-hover"} position={box.center} scale={box.size}>
      <mesh geometry={geometry.box} raycast={ignoreRaycast} renderOrder={6}>
        <meshBasicMaterial color={HIGHLIGHT.fill} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
      </mesh>
      {outlined ? (
        <lineSegments geometry={geometry.edges} raycast={ignoreRaycast} renderOrder={7}>
          <lineBasicMaterial color={HIGHLIGHT.line} toneMapped={false} />
        </lineSegments>
      ) : null}
    </group>
  );
}
