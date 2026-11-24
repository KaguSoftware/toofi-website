// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceCanvasProps } from "./ExperienceCanvas";
import type { StoryReelProps } from "./StoryReel";
import type { StoryScrollProps } from "./StoryScroll";
import type { BeatContent, ExperienceLabels, ZaitunExperienceProps } from "./types";

vi.mock("next/image", () => ({
  default: ({ src, alt, className, preload, fetchPriority }: { src: string; alt: string; className?: string; preload?: boolean; fetchPriority?: "high" | "low" | "auto" }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} data-preload={preload ? "true" : undefined} fetchPriority={fetchPriority} />
  ),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// `ok`, `offer`: what the 3D's verdict is. The rest is what the browser reports; `playsReel` is the real one.
const cap = { ok: true, offer: false, reducedMotion: false, tier: "high" as "low" | "high", saveData: false, effectiveType: undefined as string | undefined };
vi.mock("../scene/capability", async (original) => ({
  ...(await original<typeof import("../scene/capability")>()),
  render3D: () => (!cap.ok ? "no" : cap.offer ? "offer" : "yes"),
  readCapabilityEnv: () => ({ webgl2: cap.ok, reducedMotion: cap.reducedMotion, saveData: cap.saveData, effectiveType: cap.effectiveType, mode: "explorer" }),
  qualityTier: () => cap.tier,
}));
// The canvas chunk asks for three.js first; the stub below needs none of it.
vi.mock("three", () => ({}));

const mon = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ reportError: mon.reportError }));

const amb = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  setDusk: vi.fn(),
  setPlace: vi.fn(),
  dispose: vi.fn(),
  create: vi.fn(),
  supported: true,
  running: false,
}));
vi.mock("./audio", () => ({
  audioSupported: () => amb.supported,
  MUSIC_BED: { src: "/sawad/audio/bed.mp3", url: "https://music.example" },
  createAmbience: (...args: unknown[]) => {
    amb.create(...args);
    return {
      start: amb.start,
      stop: amb.stop,
      setDusk: amb.setDusk,
      setPlace: amb.setPlace,
      dispose: amb.dispose,
      get running() {
        return amb.running;
      },
    };
  },
}));

const canvas = vi.hoisted(() => ({
  props: [] as unknown[],
  mounts: 0,
  unmounts: 0,
  fail: false,
  api: { zoom: vi.fn(), reset: vi.fn(), wake: vi.fn() },
  control: { pause: vi.fn(), resume: vi.fn() },
}));
vi.mock("./ExperienceCanvas", async () => {
  const { useEffect } = await import("react");
  function CanvasStub(props: ExperienceCanvasProps) {
    if (canvas.fail) throw new Error("no gl");
    canvas.props.push(props);
    const { apiRef, controlRef } = props;
    useEffect(() => {
      canvas.mounts++;
      if (apiRef) apiRef.current = canvas.api;
      if (controlRef) controlRef.current = canvas.control;
      return () => {
        canvas.unmounts++;
      };
    }, [apiRef, controlRef]);
    return <div data-testid="experience-canvas" />;
  }
  return { default: CanvasStub };
});

// jsdom plays no video: the reel is a stand-in that keeps its props and renders the two elements the early script looks for.
const reel = vi.hoisted(() => ({ props: [] as unknown[], mounts: 0, unmounts: 0, fail: false }));
vi.mock("./StoryReel", async () => {
  const { useEffect } = await import("react");
  function ReelStub(props: StoryReelProps) {
    if (reel.fail) throw new Error("no video");
    reel.props.push(props);
    useEffect(() => {
      reel.mounts++;
      return () => {
        reel.unmounts++;
      };
    }, []);
    return (
      <div data-testid="story-reel" aria-hidden="true">
        <video data-reel="opening" />
        <video data-reel="tour" />
      </div>
    );
  }
  return { default: ReelStub };
});

const story = vi.hoisted(() => ({ props: [] as unknown[], mounts: 0 }));
vi.mock("./StoryScroll", async () => {
  const { useEffect } = await import("react");
  function StoryStub(props: StoryScrollProps) {
    story.props.push(props);
    useEffect(() => {
      story.mounts++;
    }, []);
    return <div data-testid="story-scroll" />;
  }
  return { default: StoryStub };
});

import { ZaitunExperience, captureAt, resetDeviceCache } from "./ZaitunExperience";
import { assetUrl } from "../scene/assetUrl";
import { reelSources } from "./reel";

const labels: ExperienceLabels = {
  region: "A tour of Zaitun Hills",
  loading: "Loading the 3D view",
  stills: "Motion is reduced, so the tour is shown as stills.",
  load3d: "Explore in 3D",
  heldBack: "The 3D tour is a larger download, so it is shown as stills here.",
  load3dSized: { low: "Load the 3D tour (about 3.6 MB)", high: "Load the 3D tour (about 6.1 MB)" },
  lost: "The browser closed the 3D view.",
  pause: "Pause",
  play: "Play",
  skipIntro: "Skip the intro",
  scrollHint: "Scroll to begin the tour",
  explore: "Explore the compound",
  backToStory: "Back to the tour",
  orbit: "Orbit",
  walk: "Walk",
  exploreMode: "Way of exploring",
  toDusk: "Show dusk",
  toDay: "Show day",
  soundOn: "Sound on",
  soundOff: "Sound off",
  musicCredit: "Music: the piece, by its composer",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  reset: "Reset view",
  orbitHint: "Drag to orbit",
  walkHint: "Use the arrow keys",
  joystick: "Walking stick",
  panelTitle: "Selected home",
  close: "Close",
  inFinder: "See it in the finder",
  beatsLabel: "The tour, stop by stop",
};
const beats: BeatContent[] = [
  {
    id: "entrance",
    eyebrow: "01 · Arrival",
    title: <h2>Through the brass gate</h2>,
    body: <p>Twin pavilions.</p>,
    figures: [
      { label: "Site", value: "28 ha" },
      { label: "Landscaped", value: "60%" },
    ],
    still: { src: "/still-entrance.jpg", alt: "The gate" },
  },
  {
    id: "villa",
    eyebrow: "03 · Villa",
    title: <h2>Rooms around a courtyard</h2>,
    body: <p>Five bedrooms.</p>,
    figures: [],
    still: { src: "/still-villa.jpg", alt: "The villa" },
    link: { href: "/residences?compound=zaitun-hills&home=ZH-V05", label: "See this home" },
  },
];
const base: ZaitunExperienceProps = {
  locale: "en",
  view: "flight",
  live: true,
  poster: { src: "/poster.jpg", alt: "Zaitun at golden hour" },
  hero: <h1>A home in the green land</h1>,
  after: <div role="search" />,
  beats,
  labels,
};

const last = () => canvas.props.at(-1) as ExperienceCanvasProps;
const film = () => reel.props.at(-1) as StoryReelProps;
const state = (c: HTMLElement) => c.querySelector(".xp")!.getAttribute("data-state");
const loaded = () => vi.waitFor(() => expect(canvas.mounts).toBeGreaterThan(0));
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const preloads = () => Array.from(document.head.querySelectorAll("link[rel=preload]"), (l) => l.getAttribute("href"));
const FIRST_FILES = (tier: "low" | "high") => [assetUrl(`/sawad/models/compound-zaitun-far-${tier}.glb`), assetUrl("/sawad/basis/") + "basis_transcoder.js", assetUrl("/sawad/basis/") + "basis_transcoder.wasm"];

/** The page as a visitor gets it: the reel where it plays, the stills elsewhere. No 3D yet. */
async function mount(over: Partial<ZaitunExperienceProps> = {}) {
  const view = render(<ZaitunExperience {...base} {...over} />);
  await act(async () => {});
  return view;
}
/** Explore was asked for and the 3D code has arrived; its first frame has not been drawn. */
async function asked(over: Partial<ZaitunExperienceProps> = {}, button: string | RegExp = "Explore the compound") {
  const view = await mount(over);
  click(button);
  await loaded();
  return view;
}
/** The explorer is on screen. */
async function exploring(over: Partial<ZaitunExperienceProps> = {}, button: string | RegExp = "Explore the compound") {
  const view = await asked(over, button);
  await act(async () => last().onFirstFrame?.());
  return view;
}
/** A development capture: the live story, mounted by itself. */
async function capturing(url: string) {
  window.history.replaceState({}, "", url);
  const view = render(<ZaitunExperience {...base} />);
  await loaded();
  return view;
}

beforeEach(() => {
  cap.ok = true;
  cap.offer = false;
  cap.reducedMotion = false;
  cap.tier = "high";
  cap.saveData = false;
  cap.effectiveType = undefined;
  reel.props.length = 0;
  reel.mounts = 0;
  reel.unmounts = 0;
  reel.fail = false;
  canvas.props.length = 0;
  canvas.mounts = 0;
  canvas.unmounts = 0;
  canvas.fail = false;
  story.props.length = 0;
  story.mounts = 0;
  amb.supported = true;
  amb.running = false;
  amb.start.mockReset().mockImplementation(async () => {
    amb.running = true;
  });
  amb.stop.mockReset().mockImplementation(() => {
    amb.running = false;
  });
  document.head.innerHTML = "";
  amb.create.mockClear();
  for (const f of [amb.setDusk, amb.setPlace, amb.dispose, mon.reportError, canvas.api.zoom, canvas.api.reset, canvas.api.wake, canvas.control.pause, canvas.control.resume]) f.mockClear();
  resetDeviceCache();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  document.documentElement.style.overflow = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("ZaitunExperience stills", () => {
  it("renders the stills on the server render, with no canvas and no scroll driver", () => {
    const html = renderToString(<ZaitunExperience {...base} />);
    expect(html).toContain('data-state="stills"');
    expect(html).toContain("/poster.jpg");
    expect(html).toContain("Through the brass gate");
    expect(html).not.toContain("experience-canvas");
    expect(html).not.toContain("story-scroll");
  });

  it("shows poster, hero, search and one captioned item per beat where the visitor asked to save data", async () => {
    // Save-Data: no reel, and the 3D is refused outright.
    cap.saveData = true;
    cap.ok = false;
    const { container } = await mount();
    expect(state(container)).toBe("stills");
    expect(container.querySelector(".xp")!.getAttribute("data-reel")).toBeNull();
    expect(screen.getByRole("region", { name: labels.region })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Zaitun at golden hour" }).getAttribute("src")).toBe("/poster.jpg");
    expect(screen.getByRole("heading", { level: 1, name: "A home in the green land" })).toBeTruthy();
    expect(screen.getByRole("search")).toBeTruthy();

    const list = screen.getByRole("list", { name: labels.beatsLabel });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole("img", { name: "The gate" }).getAttribute("src")).toBe("/still-entrance.jpg");
    expect(within(items[0]).getByText("01 · Arrival")).toBeTruthy();
    expect(within(items[0]).getByRole("heading", { name: "Through the brass gate" })).toBeTruthy();
    expect(within(items[0]).getByText("Twin pavilions.")).toBeTruthy();
    const terms = items[0].querySelectorAll("dt");
    const values = items[0].querySelectorAll("dd");
    expect(Array.from(terms).map((e) => e.textContent)).toEqual(["Site", "Landscaped"]);
    expect(Array.from(values).map((e) => e.textContent)).toEqual(["28 ha", "60%"]);
    expect(items[0].querySelector("a")).toBeNull();
    expect(items[1].querySelector("dl")).toBeNull();
    expect(within(items[1]).getByRole("link", { name: "See this home" }).getAttribute("href")).toBe("/residences?compound=zaitun-hills&home=ZH-V05");
    expect(canvas.mounts).toBe(0);
    expect(story.mounts).toBe(0);
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each(["2g", "slow-2g"])("keeps the stills, with nothing to load, on a %s link", async (effectiveType) => {
    cap.effectiveType = effectiveType;
    cap.ok = false;
    const { container } = await mount();
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".xp")!.getAttribute("data-letterbox")).toBe("open");
  });

  it("keeps the stills on a capable device when live is false", async () => {
    const { container } = await mount({ live: false });
    expect(state(container)).toBe("stills");
    expect(canvas.mounts).toBe(0);
    expect(story.mounts).toBe(0);
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ZaitunExperience story", () => {
  it("plays the reel with the owner's view and the scroll driver, and loads no 3D", async () => {
    cap.tier = "low";
    const { container } = await mount({ view: "terrace" });
    const root = container.querySelector(".xp")!;
    expect(state(container)).toBe("story");
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(root.getAttribute("data-mode")).toBe("story");
    expect(root.getAttribute("data-running")).toBeNull();
    expect(film()).toMatchObject({ view: "terrace", playing: true, active: true });
    expect(screen.getByTestId("story-reel").getAttribute("aria-hidden")).toBe("true");
    await vi.waitFor(() => expect(story.mounts).toBe(1));
    expect((story.props[0] as StoryScrollProps).root.current).toBe(root);
    // The reel reads the same scroll the driver writes.
    expect(film().scroll).toBe((story.props[0] as StoryScrollProps).scroll);
    // No canvas, no model, no decoder: those wait for a visitor who wants to explore.
    expect(canvas.mounts).toBe(0);
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(preloads()).toEqual([]);
  });

  it("plays the reel on a device that cannot draw the scene, without a way into the explorer", async () => {
    cap.ok = false;
    const { container } = await mount();
    expect(state(container)).toBe("story");
    expect(container.querySelector(".xp")!.getAttribute("data-reel")).toBe("true");
    expect(screen.getByTestId("story-reel")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Explore|3D/ })).toBeNull();
    expect(canvas.mounts).toBe(0);
  });

  it("plays the reel on a link reported as 3g", async () => {
    cap.effectiveType = "3g";
    cap.offer = true;
    const { container } = await mount();
    expect(container.querySelector(".xp")!.getAttribute("data-reel")).toBe("true");
    expect(screen.getByTestId("story-reel")).toBeTruthy();
  });

  it("keeps the letterbox closed until the first sign of the visitor", async () => {
    const { container } = await mount();
    const root = container.querySelector(".xp")!;
    expect(root.getAttribute("data-letterbox")).toBe("closed");
    fireEvent.keyDown(window, { key: "a" });
    expect(root.getAttribute("data-letterbox")).toBe("open");
  });

  it.each(["wheel", "pointerdown", "scroll"])("opens the letterbox on %s", async (type) => {
    const { container } = await mount();
    fireEvent(window, new Event(type));
    expect(container.querySelector(".xp")!.getAttribute("data-letterbox")).toBe("open");
  });

  it("shows the controls with the reel, and the prompt through its stages", async () => {
    const { container } = await mount();
    const root = container.querySelector(".xp")!;
    // No first frame of a scene to wait for: the controls come with the reel.
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explore the compound" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip the intro" })).toBeTruthy();

    await act(async () => film().onIntroEnd?.());
    expect(screen.getByRole("button", { name: "Scroll to begin the tour" })).toBeTruthy();

    await vi.waitFor(() => expect(story.mounts).toBe(1));
    const progress = (story.props.at(-1) as StoryScrollProps).onProgress!;
    act(() => progress(0.001));
    expect(screen.getByRole("button", { name: "Scroll to begin the tour" })).toBeTruthy();
    act(() => progress(0.01));
    expect(screen.queryByRole("button", { name: "Scroll to begin the tour" })).toBeNull();
    expect(root.getAttribute("data-letterbox")).toBe("open");
  });

  it("drops the pause button once the opening has ended: nothing moves by itself after it", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    await act(async () => film().onIntroEnd?.());
    expect(screen.queryByRole("button", { name: /Pause|Play/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Explore the compound" })).toBeTruthy();
  });

  it("has no day and dusk button over the reel, which is recorded by day", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: /Show (dusk|day)/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Sound on" })).toBeTruthy();
  });

  it("scrolls to the first beat from the prompt", async () => {
    await mount();
    click("Skip the intro");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("pauses and plays the opening", async () => {
    await mount();
    expect(film().playing).toBe(true);
    click("Pause");
    expect(film().playing).toBe(false);
    // Paused is not the same as held for the explorer: the scroll still moves the tour.
    expect(film().active).toBe(true);
    click("Play");
    expect(film().playing).toBe(true);
  });

  it("stops the opening while off screen, and the explorer's frames with it", async () => {
    let observer: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: typeof observer) {
          observer = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      await mount();
      act(() => observer([{ isIntersecting: false }]));
      expect(film().playing).toBe(false);
      act(() => observer([{ isIntersecting: true }]));
      expect(film().playing).toBe(true);

      click("Explore the compound");
      await loaded();
      await act(async () => last().onFirstFrame?.());
      expect(last().playing).toBe(true);
      act(() => observer([{ isIntersecting: false }]));
      expect(last().playing).toBe(false);
      act(() => observer([{ isIntersecting: true }]));
      expect(last().playing).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops the opening in a hidden tab", async () => {
    await mount();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(film().playing).toBe(false);
    visibility.mockReturnValue("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(film().playing).toBe(true);
  });
});

describe("ZaitunExperience explore", () => {
  it("asks for the 3D only when Explore is pressed: it says so, holds the reel, and opens on the shot the reel was showing", async () => {
    cap.tier = "low";
    const { container } = await mount({ view: "street" });
    const root = container.querySelector(".xp")!;
    // The reel has reached the boulevard.
    film().rig.current.head = 32;
    click("Explore the compound");
    expect(screen.getByRole("status").textContent).toBe(labels.loading);
    expect(film().active).toBe(false);
    await loaded();
    expect(last()).toMatchObject({ mode: "orbit", view: "street", tier: "low", startAt: 32, daylight: "day", holdAt: null, reel: false, reducedMotion: false });
    expect(last().markers).toBeUndefined();
    expect(last().onFrame).toBeUndefined();
    expect(screen.getByTestId("experience-canvas").closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
    // The tier's first model and the decoder are asked for at once, not when the 3D code has arrived.
    expect(preloads()).toEqual(FIRST_FILES("low"));
    // Until its first frame the reel's picture and the story's controls stay.
    expect(root.getAttribute("data-running")).toBeNull();
    expect(root.getAttribute("data-mode")).toBe("story");
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(document.documentElement.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Explore the compound" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to the tour" })).toBeNull();
    expect(container.querySelector(".xp__canvas")!.getAttribute("data-visible")).toBe("false");

    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByRole("status")).toBeNull();
    expect(root.getAttribute("data-running")).toBe("true");
    expect(container.querySelector(".xp__canvas")!.getAttribute("data-visible")).toBe("true");
    expect(screen.getByRole("button", { name: "Back to the tour" })).toBeTruthy();
  });

  it("opens the explorer on the opening shot when it is asked for before the reel has moved", async () => {
    await asked();
    expect(last().startAt).toBe(0);
  });

  it("asks once, however often Explore is pressed while the 3D loads", async () => {
    await asked();
    const mounts = canvas.mounts;
    click("Explore the compound");
    click("Explore the compound");
    await act(async () => {});
    expect(canvas.mounts).toBe(mounts);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("hands over to orbit with all 84 homes as markers, and locks the page", async () => {
    const { container } = await exploring();
    expect(last().mode).toBe("orbit");
    expect(last().markers).toHaveLength(84);
    expect(last().markers?.find((m) => m.id === "ZH-V05")).toMatchObject({ kind: "villa", label: "ZH-V05" });
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("orbit");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Orbit" }).getAttribute("aria-pressed")).toBe("true");
    click("Zoom in");
    expect(canvas.api.zoom).toHaveBeenCalledWith(1);
    click("Reset view");
    expect(canvas.api.reset).toHaveBeenCalled();
  });

  it("opens the letterbox when the explorer is asked for", async () => {
    const { container } = await mount();
    const root = container.querySelector(".xp")!;
    expect(root.getAttribute("data-letterbox")).toBe("closed");
    // A click is not one of the window events that open it: asking to explore is.
    fireEvent.click(screen.getByRole("button", { name: "Explore the compound" }));
    expect(root.getAttribute("data-letterbox")).toBe("open");
  });

  it("flips day and dusk in the explorer", async () => {
    await exploring();
    click("Show dusk");
    expect(last().daylight).toBe("dusk");
    click("Show day");
    expect(last().daylight).toBe("day");
  });

  it("keeps the explorer's frames going whatever the opening's pause button said", async () => {
    await mount();
    click("Pause");
    click("Explore the compound");
    await loaded();
    // Loading: nothing is on screen to keep going yet.
    expect(last()).toMatchObject({ playing: false, moving: false });
    await act(async () => last().onFirstFrame?.());
    expect(last()).toMatchObject({ mode: "orbit", playing: true, moving: false });
  });

  it("switches to walk with the joystick, and back to orbit", async () => {
    const { container } = await exploring();
    expect(screen.queryByRole("application", { name: "Walking stick" })).toBeNull();
    const mounts = canvas.mounts;
    click("Walk");
    expect(last().mode).toBe("walk");
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("walk");
    expect(screen.getByRole("application", { name: "Walking stick" })).toBeTruthy();
    click("Orbit");
    expect(last().mode).toBe("orbit");
    expect(screen.queryByRole("application", { name: "Walking stick" })).toBeNull();
    // The same scene throughout: changing the way of exploring asks for nothing again.
    expect(canvas.mounts).toBe(mounts);
    expect(canvas.unmounts).toBe(0);
  });

  it("shows the panel for a selected home and Escape closes it first, then leaves explore", async () => {
    const { container } = await exploring();
    act(() => last().onSelect?.("ZH-V05"));
    expect(last().selectedId).toBe("ZH-V05");
    const panel = screen.getByRole("complementary", { name: "Selected home" });
    expect(within(panel).getByText("ZH-V05")).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "See it in the finder" }).getAttribute("href")).toBe("/residences?compound=zaitun-hills&home=ZH-V05");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(last().mode).toBe("orbit");
    expect(document.documentElement.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("story");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("closes the panel from its own button", async () => {
    await exploring();
    act(() => last().onSelect?.("ZH-V05"));
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("lets the scene go from the back button, returns to the reel and gives back the scroll", async () => {
    const { container } = await exploring();
    const root = container.querySelector(".xp")!;
    expect(film().active).toBe(false);
    click("Back to the tour");
    expect(canvas.unmounts).toBe(1);
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(root.getAttribute("data-mode")).toBe("story");
    expect(root.getAttribute("data-running")).toBeNull();
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(state(container)).toBe("story");
    expect(film().active).toBe(true);
    expect(reel.unmounts).toBe(0);
    expect(document.documentElement.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Explore the compound" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens the explorer again on the shot the reel has moved to since", async () => {
    await exploring();
    click("Back to the tour");
    film().rig.current.head = 66;
    const mounts = canvas.mounts;
    click("Explore the compound");
    await vi.waitFor(() => expect(canvas.mounts).toBe(mounts + 1));
    expect(last()).toMatchObject({ mode: "orbit", startAt: 66 });
    expect(last().selectedId).toBeNull();
  });

  // Leaving the explorer puts its status back to "off": the next one is not "running" until it has drawn.
  it("says it is loading again when the explorer is opened a second time", async () => {
    const { container } = await exploring();
    click("Back to the tour");
    const mounts = canvas.mounts;
    click("Explore the compound");
    await vi.waitFor(() => expect(canvas.mounts).toBe(mounts + 1));
    expect(container.querySelector(".xp")!.getAttribute("data-running")).toBeNull();
    expect(container.querySelector(".xp__canvas")!.getAttribute("data-visible")).toBe("false");
    expect(screen.getByRole("status").textContent).toBe(labels.loading);
  });

  it("shows the hint for a few seconds", async () => {
    await exploring();
    expect(screen.getByText("Drag to orbit")).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("experience-canvas").parentElement!);
    expect(screen.queryByText("Drag to orbit")).toBeNull();
  });
});

describe("ZaitunExperience sound", () => {
  it("creates the ambience once, starts it, stops it and feeds it the camera", async () => {
    await mount();
    click("Sound on");
    expect(amb.create).toHaveBeenCalledTimes(1);
    expect(amb.start).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sound off" }).getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect(amb.setDusk).toHaveBeenCalled());
    expect(amb.setPlace).toHaveBeenCalledWith({ water: expect.any(Number), open: expect.any(Number) });
    click("Sound off");
    expect(amb.stop).toHaveBeenCalled();
    click("Sound on");
    expect(amb.create).toHaveBeenCalledTimes(1);
  });

  it("asks for the music bed, credits it, and reports a bed that fails without stopping the sound", async () => {
    await mount();
    expect(screen.queryByRole("link", { name: /Music/ })).toBeNull();
    click("Sound on");
    const [ctor, random, music] = amb.create.mock.calls[0] as [unknown, unknown, { src: string; onError: (err: unknown) => void }];
    expect(ctor).toBeUndefined();
    expect(random).toBeUndefined();
    expect(music.src).toBe("/sawad/audio/bed.mp3");
    expect(screen.getByRole("link", { name: "Music: the piece, by its composer" }).getAttribute("href")).toBe("https://music.example");
    const err = new Error("404");
    music.onError(err);
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", err, { stage: "music" });
    expect(screen.getByRole("button", { name: "Sound off" }).getAttribute("aria-pressed")).toBe("true");
    click("Sound off");
    expect(screen.queryByRole("link", { name: /Music/ })).toBeNull();
  });

  it("keeps the sound on from the reel into the explorer and back", async () => {
    await mount();
    click("Sound on");
    await vi.waitFor(() => expect(amb.running).toBe(true));
    amb.stop.mockClear();
    click("Explore the compound");
    await loaded();
    await act(async () => last().onFirstFrame?.());
    expect(screen.getByRole("button", { name: "Sound off" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("link", { name: "Music: the piece, by its composer" })).toBeTruthy();
    click("Back to the tour");
    expect(screen.getByRole("button", { name: "Sound off" }).getAttribute("aria-pressed")).toBe("true");
    expect(amb.stop).not.toHaveBeenCalled();
    expect(amb.create).toHaveBeenCalledOnce();
  });

  it("reports a failing start and turns the button back off", async () => {
    const err = new Error("blocked");
    amb.start.mockRejectedValue(err);
    await mount();
    click("Sound on");
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Sound on" })).toBeTruthy());
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", err, { stage: "audio" });
  });

  it("leaves the button out where sound is unsupported, and disposes on unmount", async () => {
    amb.supported = false;
    const { unmount } = await mount();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sound/ })).toBeNull();
    unmount();
    cleanup();
    amb.supported = true;
    resetDeviceCache();
    const again = await mount();
    // Earlier pages close their sound a moment after they leave; let those settle first.
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    amb.dispose.mockClear();
    click("Sound on");
    expect(amb.dispose).not.toHaveBeenCalled();
    again.unmount();
    // Closed once the page has really left the document, a moment after the cleanup.
    await vi.waitFor(() => expect(amb.dispose).toHaveBeenCalledOnce());
  });
});

describe("ZaitunExperience reduced motion", () => {
  beforeEach(() => {
    cap.reducedMotion = true;
  });

  it("shows stills with a note and an explore button, and no reel or canvas until asked", async () => {
    const { container } = await mount();
    expect(state(container)).toBe("stills");
    expect(container.querySelector(".xp")!.getAttribute("data-reel")).toBeNull();
    expect(screen.getByText(labels.stills)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explore in 3D" })).toBeTruthy();
    // Nothing moves unasked: no video, no controls for one, no scroll-driven picture.
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Explore the compound/ })).toBeNull();
    expect(canvas.mounts).toBe(0);
    expect(story.mounts).toBe(0);
    expect(preloads()).toEqual([]);
    expect(container.querySelector(".xp")!.getAttribute("data-letterbox")).toBe("open");
  });

  it("opens the explorer on request and leaves it again", async () => {
    const { container } = await mount();
    click("Explore in 3D");
    expect(screen.getByRole("status").textContent).toBe(labels.loading);
    expect(screen.queryByRole("button", { name: "Explore in 3D" })).toBeNull();
    await loaded();
    // From the stills there is no shot to open on: the explorer starts on its aerial.
    expect(last()).toMatchObject({ mode: "orbit", reducedMotion: true, startAt: null });
    expect(story.mounts).toBe(0);
    expect(state(container)).toBe("stills");

    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByText(labels.loading)).toBeNull();
    expect(screen.getByRole("button", { name: "Orbit" }).getAttribute("aria-pressed")).toBe("true");

    click("Back to the tour");
    expect(canvas.unmounts).toBe(1);
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.getByRole("button", { name: "Explore in 3D" })).toBeTruthy();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("has only the stills where the scene cannot be drawn either", async () => {
    cap.ok = false;
    const { container } = await mount();
    expect(state(container)).toBe("stills");
    expect(screen.queryByText(labels.stills)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ZaitunExperience when the reel cannot play", () => {
  it("goes back to the stills and offers the explorer from them", async () => {
    const { container } = await mount();
    expect(state(container)).toBe("story");
    await vi.waitFor(() => expect(story.mounts).toBe(1));
    await act(async () => film().onError?.(new Error("MEDIA_ERR_DECODE")));
    const root = container.querySelector(".xp")!;
    expect(state(container)).toBe("stills");
    expect(root.getAttribute("data-reel")).toBeNull();
    expect(root.getAttribute("data-letterbox")).toBe("open");
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.queryByTestId("story-scroll")).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause|Explore the compound/ })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // The stills carry the way into the 3D, without the note that belongs to reduced motion.
    expect(screen.queryByText(labels.stills)).toBeNull();
    click("Explore in 3D");
    await loaded();
    expect(last()).toMatchObject({ mode: "orbit", startAt: null });
  });

  it("offers nothing more than the stills where the scene cannot be drawn", async () => {
    cap.ok = false;
    const { container } = await mount();
    await act(async () => film().onError?.(new Error("MEDIA_ERR_SRC_NOT_SUPPORTED")));
    expect(state(container)).toBe("stills");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("falls back to the stills when the reel throws while rendering, and says where", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reel.fail = true;
    const { container } = render(<ZaitunExperience {...base} />);
    await vi.waitFor(() => expect(state(container)).toBe("stills"));
    expect(mon.reportError).toHaveBeenCalledWith("StoryReel", expect.any(Error), expect.anything());
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.getByRole("button", { name: "Explore in 3D" })).toBeTruthy();
  });
});

describe("ZaitunExperience failures", () => {
  it("reports a canvas error, lets the scene go and keeps the reel, with no way back into the 3D", async () => {
    const { container } = await exploring();
    const err = new Error("shader failed");
    await act(async () => last().onError?.(err));
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", err, { view: "flight" });
    const root = container.querySelector(".xp")!;
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(state(container)).toBe("story");
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(root.getAttribute("data-mode")).toBe("story");
    expect(root.getAttribute("data-running")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
    expect(screen.getByTestId("story-reel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Explore|Back to the tour|3D/ })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does the same when the canvas throws while rendering", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = await mount();
    canvas.fail = true;
    click("Explore the compound");
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Explore the compound" })).toBeNull());
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", expect.any(Error), expect.anything());
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(state(container)).toBe("story");
    expect(screen.getByTestId("story-reel")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("falls back to the plain stills when the explorer fails where motion is reduced", async () => {
    cap.reducedMotion = true;
    const { container } = await exploring({}, "Explore in 3D");
    await act(async () => last().onError?.(new Error("shader failed")));
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  // A failure closes the explorer for good, and the reel, held while it was open, is let go again.
  it("lets the reel move again once the explorer has failed", async () => {
    await exploring();
    await act(async () => last().onError?.(new Error("shader failed")));
    expect(film().active).toBe(true);
  });
});

describe("ZaitunExperience capture mode", () => {
  it("holds the live story at a position, renders at dusk with no controls, and is ready after 30 frames", async () => {
    cap.tier = "low";
    const { container } = await capturing("/?story=32&dusk=1");
    const root = container.querySelector(".xp")!;
    expect(last()).toMatchObject({ mode: "story", holdAt: 32, tier: "high", daylight: "dusk", reel: false, startAt: null });
    expect(state(container)).toBe("story");
    expect(root.getAttribute("data-capture")).toBe("true");
    expect(root.getAttribute("data-letterbox")).toBe("open");
    // The capture is of the live scene: no video in its place.
    expect(root.getAttribute("data-reel")).toBeNull();
    expect(screen.queryByTestId("story-reel")).toBeNull();
    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByRole("button", { name: /Pause|Explore/ })).toBeNull();
    expect(root.getAttribute("data-scene-ready")).toBeNull();
    act(() => last().onFrame?.(29));
    expect(root.getAttribute("data-scene-ready")).toBeNull();
    act(() => last().onFrame?.(30));
    expect(root.getAttribute("data-scene-ready")).toBe("true");
  });

  it("plays another start view over its own poster, to check each handover", async () => {
    const { container } = await capturing("/?story=0&view=street");
    expect(last()).toMatchObject({ holdAt: 0, view: "street" });
    expect(container.querySelector(".xp__poster img")!.getAttribute("src")).toBe("/sawad/scene-zaitun-street.jpg");
    expect(captureAt()).toEqual({ at: 0, dusk: false, view: "street", reel: false });
  });

  it("records the reel from the live story: drawn on request, ready when the capture's handle is", async () => {
    cap.tier = "low";
    const { container } = await capturing("/?reel=1&view=terrace");
    const root = container.querySelector(".xp")!;
    expect(captureAt()).toEqual({ at: null, dusk: false, view: "terrace", reel: true });
    // The story itself, from its opening, at the top tier whatever this machine is.
    expect(last()).toMatchObject({ mode: "story", reel: true, holdAt: null, view: "terrace", tier: "high", daylight: "day", startAt: null });
    // Frames are counted by the capture script, not here.
    expect(last().onFrame).toBeUndefined();
    expect(state(container)).toBe("story");
    expect(root.getAttribute("data-capture")).toBe("true");
    expect(root.getAttribute("data-letterbox")).toBe("open");
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(container.querySelector(".xp__poster img")!.getAttribute("src")).toBe("/sawad/scene-zaitun-terrace.jpg");
    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByRole("button", { name: /Pause|Explore/ })).toBeNull();
    expect(root.getAttribute("data-scene-ready")).toBeNull();
    await act(async () => last().onReelReady?.());
    expect(root.getAttribute("data-scene-ready")).toBe("true");
  });

  it("records the owner's view where the address names none, and a held position gives way to the reel switch", async () => {
    await capturing("/?reel=1&story=32");
    expect(captureAt()).toEqual({ at: null, dusk: false, view: null, reel: true });
    expect(last()).toMatchObject({ reel: true, holdAt: null, view: "flight" });
  });

  it("ignores a view it does not know, and a view without a held story", async () => {
    window.history.replaceState({}, "", "/?story=0&view=moon");
    expect(captureAt()?.view).toBeNull();
    window.history.replaceState({}, "", "/?view=street");
    expect(captureAt()).toBeNull();
    window.history.replaceState({}, "", "/?reel=0");
    expect(captureAt()).toBeNull();
  });

  it.each(["/?story=32&dusk=1", "/?reel=1&view=street"])("is ignored in production: %s gets the reel like any visitor", async (url) => {
    vi.stubEnv("NODE_ENV", "production");
    window.history.replaceState({}, "", url);
    cap.tier = "low";
    expect(captureAt()).toBeNull();
    const { container } = await mount();
    const root = container.querySelector(".xp")!;
    expect(root.getAttribute("data-capture")).toBeNull();
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(film().view).toBe("flight");
    expect(canvas.mounts).toBe(0);
    click("Explore the compound");
    await loaded();
    expect(last()).toMatchObject({ mode: "orbit", holdAt: null, reel: false, tier: "low", daylight: "day", view: "flight" });
    expect(last().onFrame).toBeUndefined();
    expect(root.getAttribute("data-capture")).toBeNull();
  });
});

describe("ZaitunExperience before its code arrives", () => {
  const html = (over: Partial<ZaitunExperienceProps> = {}) => renderToString(<ZaitunExperience {...base} {...over} />);

  it("puts the reel's elements in the server's HTML, then the early script, then the stills", () => {
    const page = html({ view: "street" });
    const stage = page.indexOf("xp__stage");
    const opening = page.indexOf('data-reel="opening"');
    const tour = page.indexOf('data-reel="tour"');
    const script = page.indexOf("<script>");
    const stills = page.indexOf("xp__still");
    // The script looks for the opening's video, so that has to be parsed first; and it has to
    // run before the stills are reached, or lazy loading asks for them.
    expect(opening).toBeGreaterThan(stage);
    expect(tour).toBeGreaterThan(opening);
    expect(script).toBeGreaterThan(tour);
    expect(stills).toBeGreaterThan(script);
    expect(page.match(/<script/g)).toHaveLength(1);
    expect(page).toContain("document.currentScript");
    // It starts the owner's opening, and names no model.
    expect(page).toContain(reelSources("street", "wide").opening);
    expect(page).toContain(reelSources("street", "tall").opening);
    expect(page).not.toContain(reelSources("flight", "wide").opening);
    expect(page).not.toContain(".glb");
  });

  it("leaves the reel and the script out where the owner has switched the live scene off", () => {
    const page = html({ live: false });
    expect(page).not.toContain("<script");
    expect(page).not.toContain("<video");
  });

  it("never renders the script in the browser: React does not run scripts it creates", async () => {
    const { container } = await mount();
    expect(container.querySelector("script")).toBeNull();
  });

  it("takes over from the script's mark once the device is known, keeping the reel's elements", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html();
    const root = container.querySelector(".xp")!;
    const opening = container.querySelector('video[data-reel="opening"]')!;
    // What the early script does where the reel plays.
    root.setAttribute("data-early", "story");
    opening.setAttribute("src", reelSources("flight", "wide").opening);
    render(<ZaitunExperience {...base} />, { container, hydrate: true });
    await vi.waitFor(() => expect(root.getAttribute("data-early")).toBeNull());
    expect(root.getAttribute("data-state")).toBe("story");
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(container.querySelector("script")).toBeNull();
    // The same element, with the file the script gave it: the opening is not started twice.
    expect(container.querySelector('video[data-reel="opening"]')).toBe(opening);
    expect(opening.getAttribute("src")).toBe(reelSources("flight", "wide").opening);
    expect(canvas.mounts).toBe(0);
  });

  it("clears the mark too where the page decides on the stills after all, and takes the reel away", async () => {
    cap.saveData = true;
    cap.ok = false;
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html();
    const root = container.querySelector(".xp")!;
    root.setAttribute("data-early", "story");
    render(<ZaitunExperience {...base} />, { container, hydrate: true });
    await vi.waitFor(() => expect(root.getAttribute("data-early")).toBeNull());
    expect(root.getAttribute("data-state")).toBe("stills");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("fetches the poster first: preloaded from the head, at high priority", async () => {
    const { container } = await mount();
    const poster = container.querySelector(".xp__poster img")!;
    expect(poster.getAttribute("data-preload")).toBe("true");
    expect(poster.getAttribute("fetchpriority")).toBe("high");
    // The stills are ordinary lazy images.
    expect(container.querySelector(".xp__still")!.getAttribute("fetchpriority")).toBeNull();
  });

  it("asks for no model while the reel plays, and for the tier's first model and the decoder as soon as the explorer is wanted", async () => {
    await mount();
    await vi.waitFor(() => expect(story.mounts).toBe(1));
    expect(preloads()).toEqual([]);
    click("Explore the compound");
    // At the click, before the 3D code has arrived.
    expect(preloads()).toEqual(FIRST_FILES("high"));
    await loaded();
    expect(preloads()).toEqual(FIRST_FILES("high"));
  });

  it("asks for nothing where the scene is not coming", async () => {
    cap.ok = false;
    await mount();
    expect(preloads()).toEqual([]);
    cap.saveData = true;
    cleanup();
    resetDeviceCache();
    await mount();
    expect(preloads()).toEqual([]);
  });
});

describe("ZaitunExperience on a slow link or a small device", () => {
  beforeEach(() => {
    cap.offer = true;
  });

  it("plays the reel, and names the download on the button that brings the 3D", async () => {
    const { container } = await mount();
    expect(state(container)).toBe("story");
    expect(container.querySelector(".xp")!.getAttribute("data-reel")).toBe("true");
    expect(screen.getByRole("button", { name: "Load the 3D tour (about 6.1 MB)" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explore the compound" })).toBeNull();
    // Nothing is held back in words while the reel plays: the note belongs to the stills.
    expect(screen.queryByText(labels.heldBack)).toBeNull();
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(preloads()).toEqual([]);
  });

  it("names the smaller download on the low tier", async () => {
    cap.tier = "low";
    await mount();
    expect(screen.getByRole("button", { name: "Load the 3D tour (about 3.6 MB)" })).toBeTruthy();
  });

  it("opens the explorer when asked, saying so until the first frame", async () => {
    const { container } = await asked({}, "Load the 3D tour (about 6.1 MB)");
    expect(state(container)).toBe("story");
    expect(last()).toMatchObject({ mode: "orbit", tier: "high" });
    expect(screen.getByRole("status").textContent).toBe("Loading the 3D view");
    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to the tour" })).toBeTruthy();
    click("Back to the tour");
    expect(screen.getByRole("button", { name: "Load the 3D tour (about 6.1 MB)" })).toBeTruthy();
  });

  it("shows the stills with the same offer where motion is reduced, and opens the explorer from them", async () => {
    cap.reducedMotion = true;
    const { container } = await mount();
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("story-reel")).toBeNull();
    expect(screen.getByText("The 3D tour is a larger download, so it is shown as stills here.")).toBeTruthy();
    expect(preloads()).toEqual([]);
    click("Load the 3D tour (about 6.1 MB)");
    expect(screen.queryByRole("button", { name: /Load the 3D tour/ })).toBeNull();
    await loaded();
    expect(last().mode).toBe("orbit");
    expect(screen.queryByTestId("story-scroll")).toBeNull();
  });
});

describe("ZaitunExperience when the browser takes the 3D view away", () => {
  it("goes back to the reel, reports it as a warning, says so, and opens the scene again from Explore", async () => {
    const { container } = await exploring();
    const root = container.querySelector(".xp")!;
    await act(async () => last().onContextLost?.());
    expect(state(container)).toBe("story");
    expect(root.getAttribute("data-reel")).toBe("true");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(film().active).toBe(true);
    expect(mon.reportError).toHaveBeenCalledExactlyOnceWith("ZaitunExperience", expect.objectContaining({ message: "WebGL context lost" }), {
      view: "flight",
      severity: "warning",
      recoverable: true,
    });
    expect(screen.getByText("The browser closed the 3D view.")).toBeTruthy();
    // Over the reel the way back in is the controls' own button, not a second one.
    expect(screen.queryByRole("button", { name: "Explore in 3D" })).toBeNull();

    const mounts = canvas.mounts;
    click("Explore the compound");
    await vi.waitFor(() => expect(canvas.mounts).toBe(mounts + 1));
    expect(screen.getByRole("status").textContent).toBe("Loading the 3D view");
    expect(root.getAttribute("data-running")).toBeNull();
    await act(async () => last().onFirstFrame?.());
    expect(root.getAttribute("data-running")).toBe("true");
    expect(screen.queryByText("The browser closed the 3D view.")).toBeNull();
  });

  it("leaves the explorer and gives the page its scroll back", async () => {
    const { container } = await exploring();
    act(() => last().onSelect?.("ZH-V05"));
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(async () => last().onContextLost?.());
    expect(document.documentElement.style.overflow).toBe("");
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("story");
    expect(screen.queryByRole("complementary")).toBeNull();
    // Asked for again, it opens without the home that was selected when it was lost.
    const mounts = canvas.mounts;
    click("Explore the compound");
    await vi.waitFor(() => expect(canvas.mounts).toBe(mounts + 1));
    expect(last().mode).toBe("orbit");
    expect(last().selectedId).toBeNull();
  });

  it("offers the explorer again from the stills where motion is reduced", async () => {
    cap.reducedMotion = true;
    await exploring({}, "Explore in 3D");
    await act(async () => last().onContextLost?.());
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.getByText("The browser closed the 3D view.")).toBeTruthy();
    click("Explore in 3D");
    await vi.waitFor(() => expect(screen.getByTestId("experience-canvas")).toBeTruthy());
    expect(last().mode).toBe("orbit");
  });
});

describe("ZaitunExperience on a device too slow for the scene", () => {
  it("gives the scene up for the reel, with a warning and no offer to try again", async () => {
    const { container } = await exploring();
    await act(async () => last().onStarved?.());
    expect(state(container)).toBe("story");
    expect(container.querySelector(".xp")!.getAttribute("data-reel")).toBe("true");
    expect(screen.getByTestId("story-reel")).toBeTruthy();
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
    expect(screen.queryByRole("button", { name: /3D|Explore/ })).toBeNull();
    expect(mon.reportError).toHaveBeenCalledExactlyOnceWith("ZaitunExperience", expect.objectContaining({ message: expect.stringContaining("frame rate stayed too low") }), {
      view: "flight",
      severity: "warning",
      stage: "starved",
    });
  });

  it("gives way to the stills where motion is reduced", async () => {
    cap.reducedMotion = true;
    const { container } = await exploring({}, "Explore in 3D");
    await act(async () => last().onStarved?.());
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: /3D/ })).toBeNull();
  });
});

describe("ZaitunExperience on a page Next keeps hidden", () => {
  // Next hides the page it navigates away from in React Activity and shows it again on the way back.
  const page = (mode: "visible" | "hidden") => (
    <Activity mode={mode}>
      <ZaitunExperience {...base} />
    </Activity>
  );
  /** Home on the reel. */
  async function shown() {
    const view = render(page("visible"));
    await act(async () => {});
    return { ...view, hide: () => view.rerender(page("hidden")), show: () => view.rerender(page("visible")) };
  }
  /** Home with the explorer open. */
  async function shownExploring() {
    const view = await shown();
    click("Explore the compound");
    await loaded();
    await act(async () => last().onFirstFrame?.());
    canvas.control.pause.mockClear();
    canvas.control.resume.mockClear();
    return view;
  }

  it("stops the scene's drawing while hidden and starts it again when shown", async () => {
    const view = await shownExploring();
    view.hide();
    expect(canvas.control.pause).toHaveBeenCalledOnce();
    expect(canvas.control.resume).not.toHaveBeenCalled();
    view.show();
    expect(canvas.control.resume).toHaveBeenCalledOnce();
    expect(canvas.control.pause).toHaveBeenCalledOnce();
  });

  it("keeps the reel through a hide: the same elements are there when the page is shown again", async () => {
    const view = await shown();
    const mounts = reel.mounts;
    view.hide();
    // Its effects are cleaned up (the reel pauses its video in one of them) and run again on the way back.
    expect(reel.unmounts).toBe(mounts);
    view.show();
    expect(reel.mounts).toBe(mounts + 1);
    expect(screen.getByTestId("story-reel")).toBeTruthy();
    expect(film()).toMatchObject({ playing: true, active: true });
    expect(canvas.mounts).toBe(0);
  });

  it("stops the sound without closing it, and picks it up again where it was", async () => {
    const view = await shown();
    click("Sound on");
    await vi.waitFor(() => expect(amb.running).toBe(true));
    amb.stop.mockClear();
    amb.start.mockClear();
    view.hide();
    expect(amb.stop).toHaveBeenCalledOnce();
    // Still in the document: nothing is closed, however long it stays hidden.
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(amb.dispose).not.toHaveBeenCalled();
    view.show();
    expect(amb.start).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(amb.running).toBe(true));
    // The button tells the truth: the sound is on.
    expect(screen.getByRole("button", { name: "Sound off" }).getAttribute("aria-pressed")).toBe("true");
    expect(amb.create).toHaveBeenCalledOnce();
  });

  it("leaves a sound that was off alone", async () => {
    const view = await shown();
    view.hide();
    view.show();
    expect(amb.stop).not.toHaveBeenCalled();
    expect(amb.start).not.toHaveBeenCalled();
  });

  it("turns the button off if the sound cannot start again", async () => {
    const view = await shown();
    click("Sound on");
    await vi.waitFor(() => expect(amb.running).toBe(true));
    view.hide();
    const err = new Error("not allowed");
    amb.start.mockRejectedValueOnce(err);
    view.show();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Sound on" })).toBeTruthy());
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", err, { stage: "audio" });
  });

  it("works before the scene has given its handle, and with no scene at all", async () => {
    const view = render(page("visible"));
    expect(() => view.rerender(page("hidden"))).not.toThrow();
    expect(() => view.rerender(page("visible"))).not.toThrow();
    expect(canvas.control.pause).not.toHaveBeenCalled();
  });
});
