import { PLAN_LEVELS, PLAN_STREET, planAmenities, planBoulevardZ, planGates, planVilla } from "../scene/layout";
import type { Vec3, ViewId } from "../scene/types";
import { VIEW_IDS, viewpoints } from "../scene/viewpoints";
import { BEATS, INTRO_SECONDS, STORY_END } from "./beats";

/**
 * The story's camera, as keyframes placed from layout.ts (never from guessed coordinates):
 * four openings, one per owner start view, that each end outside the main gate, and one
 * scroll-driven path from there: entrance, boulevard, hero villa, amenities, aerial.
 * storySheet.ts turns these into the Theatre.js sheet the camera plays from.
 */
export type StoryKey = {
  /** Sequence position, in seconds. */
  at: number;
  position: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Depth of field: distance to the subject in metres, and how strong the blur is (0 to 1). */
  focus: number;
  blur: number;
  /** "rest": the camera settles on this frame. "through": it passes without slowing. */
  ease: "rest" | "through";
};

/** The waterfront courtyard villa the story stops at (plot 4, home ZH-V05). */
export const HERO_VILLA_SLOT = 4;
export const HERO_HOME_ID = "ZH-V05";

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function key(at: number, position: Vec3, target: Vec3, fov: number, opts: { focus?: number; blur?: number; ease?: StoryKey["ease"] } = {}): StoryKey {
  return { at, position, target, fov, focus: opts.focus ?? distance(position, target), blur: opts.blur ?? 0, ease: opts.ease ?? "rest" };
}

const valley = PLAN_LEVELS.valley;
const boulevard = (x: number) => planBoulevardZ("a", x);
/** The inland sidewalk of boulevard A: clear of the cars, with the palm verge alongside. */
const SIDEWALK = -(PLAN_STREET.carriageway / 2 + PLAN_STREET.verge + PLAN_STREET.sidewalk / 2);

/** Outside the main gate at eye level, looking through it down the boulevard: where every opening ends. */
function gateShot(at: number): StoryKey {
  const gate = planGates()[0];
  return key(at, [gate.x - 28, valley + 1.8, gate.z + 1.2], [gate.x + 40, valley + 5.2, gate.z], 40, { blur: 0.25, focus: 28 });
}

/**
 * The opening for a start view: its poster frame, a reveal of the valley, then down to the gate.
 * The default (flight) lifts off the stream; aerial descends like the film's first shot;
 * street and terrace pull back and up out of the compound.
 */
export function introKeys(view: ViewId): StoryKey[] {
  const open = viewpoints("zaitun")[view];
  const first = key(0, open.position, open.target, open.fov);
  // The way down to the gate from the west: between the palms that stand either side of the road.
  const approach = (z: number) => key(11, [-538, 28, z], [-420, 4, 3], 41, { ease: "through" });
  const through: Record<ViewId, StoryKey[]> = {
    flight: [key(6, [-610, 62, 44], [-190, 0, -40], 42, { ease: "through" }), approach(10)],
    // Coming from the south, the turn onto the road swings wide: start it nearer the far verge.
    aerial: [key(6.5, [-600, 120, -170], [-220, 0, -20], 40, { ease: "through" }), approach(-2)],
    // Up over the front gardens, clear of the palm crowns, then back over the gate.
    street: [key(2.5, [-327, 12, -12], [-284, 2, boulevard(-284) - 4], 52, { ease: "through" }), key(7.5, [-436, 34, 3], [-300, 2, boulevard(-300)], 44, { ease: "through" })],
    terrace: [key(7, [-350, 52, 54], [-210, 0, 8], 44, { ease: "through" })],
  };
  return [first, ...through[view], gateShot(INTRO_SECONDS)];
}

/** The scroll-driven path, from the gate to the aerial. */
export function storyKeys(): StoryKey[] {
  const gate = planGates()[0];
  const hero = planVilla(HERO_VILLA_SLOT);
  const pool = planAmenities().find((a) => a.id === "pool")!;
  const [entrance, street, villa, amenities] = BEATS;
  // The dolly runs along the sidewalk between two palms of the allée; it is reached through a
  // driveway gap in the verge.
  const streetFrom = -331;
  const streetTo = -313;
  const onSidewalk = (x: number, y: number): Vec3 => [x, valley + y, boulevard(x) + SIDEWALK];
  const ahead = (x: number, y: number): Vec3 => [x + 52, valley + y, boulevard(x + 52) + SIDEWALK + 1.5];
  // The middle of the hero villa's entrance front (it faces the boulevard).
  const front: Vec3 = [hero.x + 2, hero.y + 4.2, hero.z + (hero.facing * hero.depth) / 2];
  return [
    gateShot(entrance.from),
    // Crane up over the pavilions and the brass lintel: the boulevard opens out below.
    key(entrance.at + 1, [gate.x - 22, valley + 22, gate.z + 2], [-300, valley, boulevard(-300)], 40),
    // Down the middle of the carriageway, above the cars.
    key(street.from, [-395, valley + 7, boulevard(-395)], [-320, valley + 2.5, boulevard(-320) - 4], 38, { ease: "through" }),
    key(street.from + 1.6, [-346, valley + 2.6, boulevard(-346)], [-290, valley + 3, boulevard(-290) - 6], 37, { ease: "through" }),
    key(street.from + 3, onSidewalk(streetFrom, 1.75), ahead(streetFrom, 2.6), 36, { blur: 0.5, focus: 30 }),
    // A walking-pace dolly along the palm allée.
    key(street.at + 4, onSidewalk(streetTo, 1.65), ahead(streetTo, 2.5), 36, { blur: 0.5, focus: 30 }),
    // On along the sidewalk, turning to the courtyard villa across the boulevard: its entrance front,
    // brass canopy and timber screens, lit from the side.
    key(villa.from + 4, onSidewalk(hero.x - 12, 1.75), front, 32, { blur: 0.7 }),
    // A slow truck along the sidewalk, easing toward the villa, the verge palms sliding past in front.
    key(villa.at + 3, [hero.x - 1.5, valley + 1.85, boulevard(hero.x - 1.5) + SIDEWALK + 1], front, 31, { blur: 0.7 }),
    // Out between two verge palms and up along the middle of the boulevard, where no crown reaches, then over the roofs to the water
    // and east above the promenade palms to the garden axis.
    key(villa.at + 5.2, [hero.x + 2.5, valley + 5, boulevard(hero.x + 2.5)], [hero.x + 30, valley + 5, hero.z + 2], 34, { ease: "through" }),
    key(amenities.from - 0.6, [hero.x + 34, valley + 19, boulevard(hero.x + 34)], [hero.x + 120, valley + 5, hero.z - 20], 38, { ease: "through" }),
    key(amenities.from + 2.2, [-125, valley + 21, 64], [-40, valley + 3, 0], 38, { ease: "through" }),
    // Turn in over the stream plaza, above its palms.
    key(amenities.from + 4, [-30, valley + 19, 66], [-6, valley + 2, 0], 39, { ease: "through" }),
    key(amenities.from + 6, [0, valley + 14.5, 50], [-4, valley + 2, pool.z + 20], 40),
    // Down the garden walk between the palms: the pool ahead, courts and gym to one side, the playground to the other.
    key(amenities.at, [2, valley + 4.8, -6], [-8, valley + 1.4, pool.z], 40, { ease: "through", blur: 0.3, focus: 60 }),
    // Low across the reflecting pool toward the courts and the gym.
    key(amenities.at + 4, [4.5, valley + 1.6, pool.z + 26], [-30, valley + 4.2, pool.z + 12], 40, { blur: 0.45, focus: 36 }),
    // Straight up from the pool rim, then back over the stream: the whole valley, olive terraces behind.
    key(amenities.to, [4, valley + 22, pool.z + 36], [-22, valley + 2, pool.z - 6], 42, { ease: "through" }),
    key(amenities.to + 5, [0, 46, 120], [0, 6, -60], 44),
    key(STORY_END, [30, 118, 300], [0, 18, -110], 42),
  ];
}

/** Every key list by its Theatre.js object name: the four openings and the story camera. */
export function storyTracks(): Record<string, StoryKey[]> {
  const tracks: Record<string, StoryKey[]> = { [STORY_CAMERA]: storyKeys() };
  for (const view of VIEW_IDS) tracks[introObject(view)] = introKeys(view);
  return tracks;
}

export const STORY_CAMERA = "Story camera";
export const introObject = (view: ViewId): string => `Intro ${view}`;
