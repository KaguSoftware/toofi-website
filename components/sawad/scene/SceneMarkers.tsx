import { useEffect, useMemo } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { CLICK_TOLERANCE_PX } from "./flight";
import { CREAM, createMarkerMaterials, markerRenderOrder, markerScale, markerStems, pickMarker } from "./markers";
import { siteFor } from "./site";
import type { SceneMarker, SceneVariant } from "./types";

export type SceneMarkersProps = {
  /** Whose plots the markers stand on. */
  variant: SceneVariant;
  markers: SceneMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
};

/** Stems are decoration: a click or hover on one is not a click on a home. */
const ignoreRaycast = () => {};

/** A pointer over a home says it can be clicked. */
function setCursor(canvas: HTMLCanvasElement, cursor: "pointer" | ""): void {
  canvas.style.cursor = cursor;
}

/**
 * One status marker per home, floating above it on a thin stem. Status is a shape as well as
 * a colour (see markers.ts); the selected marker grows and gains an ink ring.
 */
export function SceneMarkers({ variant, markers, selectedId = null, onSelect }: SceneMarkersProps) {
  const canvas = useThree((s) => s.gl.domElement);
  const materials = useMemo(() => createMarkerMaterials(), []);
  useEffect(() => () => materials.dispose(), [materials]);
  // Hovering stops when the markers go away.
  useEffect(() => () => setCursor(canvas, ""), [canvas]);

  const site = siteFor(variant);
  const stems = useMemo(() => markerStems(markers, variant), [markers, variant]);
  const selected = selectedId && markers.some((m) => m.id === selectedId) ? selectedId : null;

  const select = (e: ThreeEvent<MouseEvent>) => {
    // Every sprite under the pointer bubbles here; answer once, for the best of them.
    e.stopPropagation();
    if (e.delta >= CLICK_TOLERANCE_PX) return; // a drag, not a click
    const id = pickMarker(e.intersections);
    if (id) onSelect?.(id);
  };

  return (
    <group
      name="markers"
      onClick={select}
      onPointerOver={() => setCursor(canvas, "pointer")}
      onPointerOut={() => setCursor(canvas, "")}
    >
      <lineSegments renderOrder={9} frustumCulled={false} raycast={ignoreRaycast}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stems, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={CREAM} transparent opacity={0.75} depthTest={false} />
      </lineSegments>
      {markers.map((m) => {
        const p = site.markerPosition(m);
        const isSelected = m.id === selected;
        return (
          <sprite
            key={m.id}
            name={`marker:${m.id}`}
            userData={{ id: m.id }}
            position={[p.x, p.y, p.z]}
            scale={markerScale(m.status, isSelected)}
            renderOrder={markerRenderOrder(m.status, isSelected)}
            material={materials.get(m.status, isSelected)}
          />
        );
      })}
    </group>
  );
}
