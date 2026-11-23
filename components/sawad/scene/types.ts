export type ViewId = "flight" | "street" | "terrace" | "aerial";
export type SceneVariant = "dijla" | "zaitun" | "shatt";
export type MarkerStatus = "available" | "reserved" | "sold";
export type SceneMarker = { id: string; kind: "villa" | "apartment"; slot: number; status: MarkerStatus; label: string };
// villa slot 0..23 ; apartment slot 0..11 → building = Math.floor(slot / 4), floor = slot % 4
export type SceneLabels = {
  loading: string;
  unavailable: string;
  load3d: string;
  pause: string;
  play: string;
  zoomIn: string;
  zoomOut: string;
  reset: string;
  dragHint: string;
  sceneLabel: string;
};
export type SceneViewportProps = {
  mode: "film" | "explorer";
  variant: SceneVariant;
  view: ViewId; // controlled; changing it moves the camera
  poster: { src: string; alt: string };
  markers?: SceneMarker[]; // explorer only
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  labels: SceneLabels;
  autoLoad?: boolean; // default true. false → poster + a "load3d" button; 3D only loads on click
  /** The poster's `sizes` hint, for stages narrower than the viewport. Default `100vw`. */
  posterSizes?: string;
  className?: string;
};

/** The actions behind the explorer's on-screen buttons. */
export type SceneApi = { zoom: (dir: 1 | -1) => void; reset: () => void };

export type QualityTier = "high" | "low";
export type Vec3 = [number, number, number];
