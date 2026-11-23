// @vitest-environment jsdom
import { Activity } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperienceCanvasProps } from "./ExperienceCanvas";
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

const cap = { ok: true, offer: false, reducedMotion: false, tier: "high" as "low" | "high" };
vi.mock("../scene/capability", async (original) => ({
  ...(await original<typeof import("../scene/capability")>()),
  render3D: () => (!cap.ok ? "no" : cap.offer ? "offer" : "yes"),
  readCapabilityEnv: () => ({ webgl2: cap.ok, reducedMotion: cap.reducedMotion, mode: "explorer" }),
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
const state = (c: HTMLElement) => c.querySelector(".xp")!.getAttribute("data-state");
const loaded = () => vi.waitFor(() => expect(canvas.mounts).toBeGreaterThan(0));
async function mount(over: Partial<ZaitunExperienceProps> = {}) {
  const view = render(<ZaitunExperience {...base} {...over} />);
  await loaded();
  return view;
}
async function running(over: Partial<ZaitunExperienceProps> = {}) {
  const view = await mount(over);
  await act(async () => last().onFirstFrame?.());
  return view;
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  cap.ok = true;
  cap.offer = false;
  cap.reducedMotion = false;
  cap.tier = "high";
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

  it("shows poster, hero, search and one captioned item per beat on an incapable device", async () => {
    cap.ok = false;
    const { container } = render(<ZaitunExperience {...base} />);
    await act(async () => {});
    expect(state(container)).toBe("stills");
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
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps the stills on a capable device when live is false", async () => {
    const { container } = render(<ZaitunExperience {...base} live={false} />);
    await act(async () => {});
    expect(state(container)).toBe("stills");
    expect(canvas.mounts).toBe(0);
    expect(story.mounts).toBe(0);
  });
});

describe("ZaitunExperience story", () => {
  it("mounts the canvas in story mode with the view and the tier, and the scroll driver", async () => {
    cap.tier = "low";
    const { container } = await mount({ view: "terrace" });
    expect(state(container)).toBe("story");
    expect(last()).toMatchObject({ mode: "story", view: "terrace", tier: "low", daylight: "day", holdAt: null, reducedMotion: false });
    expect(last().markers).toBeUndefined();
    await vi.waitFor(() => expect(story.mounts).toBe(1));
    expect((story.props[0] as StoryScrollProps).root.current).toBe(container.querySelector(".xp"));
    expect(screen.queryByTestId("experience-canvas")?.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe("true");
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

  it("shows the controls only after the first frame, and the prompt through its stages", async () => {
    const { container } = await mount();
    const root = container.querySelector(".xp")!;
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(root.getAttribute("data-running")).toBeNull();
    await act(async () => last().onFirstFrame?.());
    expect(root.getAttribute("data-running")).toBe("true");
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip the intro" })).toBeTruthy();

    await act(async () => last().onIntroEnd?.());
    expect(screen.getByRole("button", { name: "Scroll to begin the tour" })).toBeTruthy();

    await vi.waitFor(() => expect(story.mounts).toBe(1));
    const progress = (story.props.at(-1) as StoryScrollProps).onProgress!;
    act(() => progress(0.001));
    expect(screen.getByRole("button", { name: "Scroll to begin the tour" })).toBeTruthy();
    act(() => progress(0.01));
    expect(screen.queryByRole("button", { name: "Scroll to begin the tour" })).toBeNull();
    expect(canvas.api.wake).toHaveBeenCalled();
    expect(root.getAttribute("data-letterbox")).toBe("open");
  });

  it("scrolls to the first beat from the prompt", async () => {
    await running();
    click("Skip the intro");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("flips day and dusk", async () => {
    await running();
    click("Show dusk");
    expect(last().daylight).toBe("dusk");
    click("Show day");
    expect(last().daylight).toBe("day");
  });

  it("pausing stops what moves and the frames, but exploring keeps the frames going", async () => {
    await running();
    expect(last()).toMatchObject({ playing: true, moving: true });
    click("Pause");
    expect(last()).toMatchObject({ playing: false, moving: false });
    click("Play");
    expect(last()).toMatchObject({ playing: true, moving: true });
    click("Pause");
    click("Explore the compound");
    expect(last()).toMatchObject({ mode: "orbit", playing: true, moving: false });
  });

  it("stops drawing frames while off screen", async () => {
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
      await running();
      act(() => observer([{ isIntersecting: false }]));
      expect(last().playing).toBe(false);
      act(() => observer([{ isIntersecting: true }]));
      expect(last().playing).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ZaitunExperience explore", () => {
  it("hands over to orbit with all 84 homes as markers, and locks the page", async () => {
    const { container } = await running();
    click("Explore the compound");
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

  it("switches to walk with the joystick, and back to orbit", async () => {
    const { container } = await running();
    click("Explore the compound");
    expect(screen.queryByRole("application", { name: "Walking stick" })).toBeNull();
    click("Walk");
    expect(last().mode).toBe("walk");
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("walk");
    expect(screen.getByRole("application", { name: "Walking stick" })).toBeTruthy();
    click("Orbit");
    expect(last().mode).toBe("orbit");
    expect(screen.queryByRole("application", { name: "Walking stick" })).toBeNull();
  });

  it("shows the panel for a selected home and Escape closes it first, then leaves explore", async () => {
    const { container } = await running();
    click("Explore the compound");
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
    expect(last().mode).toBe("story");
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("story");
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("closes the panel from its own button", async () => {
    await running();
    click("Explore the compound");
    act(() => last().onSelect?.("ZH-V05"));
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("returns to the story from the back button and gives back the scroll", async () => {
    await running();
    click("Explore the compound");
    click("Back to the tour");
    expect(last().mode).toBe("story");
    expect(last().markers).toBeUndefined();
    expect(document.documentElement.style.overflow).toBe("");
    expect(screen.getByRole("button", { name: "Explore the compound" })).toBeTruthy();
  });

  it("shows the hint for a few seconds", async () => {
    await running();
    click("Explore the compound");
    expect(screen.getByText("Drag to orbit")).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("experience-canvas").parentElement!);
    expect(screen.queryByText("Drag to orbit")).toBeNull();
  });
});

describe("ZaitunExperience sound", () => {
  it("creates the ambience once, starts it, stops it and feeds it the camera", async () => {
    await running();
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
    await running();
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

  it("reports a failing start and turns the button back off", async () => {
    const err = new Error("blocked");
    amb.start.mockRejectedValue(err);
    await running();
    click("Sound on");
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Sound on" })).toBeTruthy());
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", err, { stage: "audio" });
  });

  it("leaves the button out where sound is unsupported, and disposes on unmount", async () => {
    amb.supported = false;
    const { unmount } = await running();
    expect(screen.queryByRole("button", { name: /Sound/ })).toBeNull();
    unmount();
    cleanup();
    amb.supported = true;
    resetDeviceCache();
    const again = await running();
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

  it("shows stills with a note and an explore button, and no canvas until asked", async () => {
    const { container } = render(<ZaitunExperience {...base} />);
    await act(async () => {});
    expect(state(container)).toBe("stills");
    expect(screen.getByText(labels.stills)).toBeTruthy();
    expect(canvas.mounts).toBe(0);
    expect(story.mounts).toBe(0);
    expect(container.querySelector(".xp")!.getAttribute("data-letterbox")).toBe("open");
  });

  it("opens the explorer on request and leaves it again", async () => {
    const { container } = render(<ZaitunExperience {...base} />);
    click("Explore in 3D");
    expect(screen.getByRole("status").textContent).toBe(labels.loading);
    expect(screen.queryByRole("button", { name: "Explore in 3D" })).toBeNull();
    await loaded();
    expect(last()).toMatchObject({ mode: "orbit", reducedMotion: true });
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
});

describe("ZaitunExperience failures", () => {
  it("reports a canvas error and falls back to the stills", async () => {
    const { container } = await running();
    expect(state(container)).toBe("story");
    const err = new Error("context lost");
    await act(async () => last().onError?.(err));
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", err, { view: "flight" });
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("falls back to the stills when the canvas throws while rendering", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    canvas.fail = true;
    const { container } = render(<ZaitunExperience {...base} />);
    await vi.waitFor(() => expect(state(container)).toBe("stills"));
    expect(mon.reportError).toHaveBeenCalledWith("ZaitunExperience", expect.any(Error), expect.anything());
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
  });
});

describe("ZaitunExperience capture mode", () => {
  it("holds the story at a position, renders at dusk with no controls, and is ready after 30 frames", async () => {
    window.history.replaceState({}, "", "/?story=32&dusk=1");
    cap.tier = "low";
    const { container } = await mount();
    const root = container.querySelector(".xp")!;
    expect(last()).toMatchObject({ holdAt: 32, tier: "high", daylight: "dusk" });
    expect(root.getAttribute("data-capture")).toBe("true");
    expect(root.getAttribute("data-letterbox")).toBe("open");
    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByRole("button", { name: /Pause|Explore/ })).toBeNull();
    expect(root.getAttribute("data-scene-ready")).toBeNull();
    act(() => last().onFrame?.(29));
    expect(root.getAttribute("data-scene-ready")).toBeNull();
    act(() => last().onFrame?.(30));
    expect(root.getAttribute("data-scene-ready")).toBe("true");
  });

  it("plays another start view over its own poster, to check each handover", async () => {
    window.history.replaceState({}, "", "/?story=0&view=street");
    const { container } = await mount();
    expect(last()).toMatchObject({ holdAt: 0, view: "street" });
    expect(container.querySelector(".xp__poster img")!.getAttribute("src")).toBe("/sawad/scene-zaitun-street.jpg");
    expect(captureAt()).toEqual({ at: 0, dusk: false, view: "street" });
  });

  it("ignores a view it does not know, and a view without a held story", async () => {
    window.history.replaceState({}, "", "/?story=0&view=moon");
    expect(captureAt()?.view).toBeNull();
    window.history.replaceState({}, "", "/?view=street");
    expect(captureAt()).toBeNull();
  });

  it("is ignored in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    window.history.replaceState({}, "", "/?story=32&dusk=1");
    cap.tier = "low";
    const { container } = await mount();
    expect(last()).toMatchObject({ holdAt: null, tier: "low", daylight: "day" });
    expect(last().onFrame).toBeUndefined();
    expect(container.querySelector(".xp")!.getAttribute("data-capture")).toBeNull();
  });
});

describe("ZaitunExperience before its code arrives", () => {
  const html = (over: Partial<ZaitunExperienceProps> = {}) => renderToString(<ZaitunExperience {...base} {...over} />);

  it("puts the early script first in the server's HTML, so it runs before the stills are reached", () => {
    const page = html();
    const section = page.indexOf("<section");
    const script = page.indexOf("<script>");
    expect(script).toBeGreaterThan(section);
    expect(script).toBeLessThan(page.indexOf("xp__stage"));
    expect(page).toContain("document.currentScript");
    expect(page).toContain(assetUrl("/sawad/models/compound-zaitun-far-low.glb"));
  });

  it("leaves the script out where the owner has switched the live scene off", () => {
    expect(html({ live: false })).not.toContain("<script");
  });

  it("never renders the script in the browser: React does not run scripts it creates", async () => {
    const { container } = await mount();
    expect(container.querySelector("script")).toBeNull();
  });

  it("takes over from the script's mark once the device is known", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html();
    const root = container.querySelector(".xp")!;
    // What the early script does on a capable device.
    root.setAttribute("data-early", "story");
    render(<ZaitunExperience {...base} />, { container, hydrate: true });
    await loaded();
    expect(root.getAttribute("data-early")).toBeNull();
    expect(root.getAttribute("data-state")).toBe("story");
    expect(container.querySelector("script")).toBeNull();
  });

  it("clears the mark too where the page decides on the stills after all", async () => {
    cap.ok = false;
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html();
    const root = container.querySelector(".xp")!;
    root.setAttribute("data-early", "story");
    render(<ZaitunExperience {...base} />, { container, hydrate: true });
    await vi.waitFor(() => expect(root.getAttribute("data-early")).toBeNull());
    expect(root.getAttribute("data-state")).toBe("stills");
  });

  it("fetches the poster first: preloaded from the head, at high priority", async () => {
    const { container } = await mount();
    const poster = container.querySelector(".xp__poster img")!;
    expect(poster.getAttribute("data-preload")).toBe("true");
    expect(poster.getAttribute("fetchpriority")).toBe("high");
    // The stills are ordinary lazy images.
    expect(container.querySelector(".xp__still")!.getAttribute("fetchpriority")).toBeNull();
  });

  it("asks for the tier's first model and the decoder as soon as the scene is wanted", async () => {
    cap.tier = "low";
    await mount();
    const hints = Array.from(document.head.querySelectorAll("link[rel=preload]"), (l) => l.getAttribute("href"));
    expect(hints).toEqual([assetUrl("/sawad/models/compound-zaitun-far-low.glb"), assetUrl("/sawad/basis/") + "basis_transcoder.js", assetUrl("/sawad/basis/") + "basis_transcoder.wasm"]);
  });

  it("asks for nothing where the scene is not coming", async () => {
    cap.ok = false;
    render(<ZaitunExperience {...base} />);
    await act(async () => {});
    expect(document.head.querySelectorAll("link[rel=preload]")).toHaveLength(0);
  });
});

describe("ZaitunExperience held back until asked", () => {
  beforeEach(() => {
    cap.offer = true;
  });

  it("shows the stills with an offer that names the download for the device's tier", async () => {
    const { container } = render(<ZaitunExperience {...base} />);
    await act(async () => {});
    expect(state(container)).toBe("stills");
    expect(screen.getByText("The 3D tour is a larger download, so it is shown as stills here.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load the 3D tour (about 6.1 MB)" })).toBeTruthy();
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.queryByTestId("story-scroll")).toBeNull();
    expect(document.head.querySelectorAll("link[rel=preload]")).toHaveLength(0);
  });

  it("names the smaller download on the low tier", async () => {
    cap.tier = "low";
    render(<ZaitunExperience {...base} />);
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Load the 3D tour (about 3.6 MB)" })).toBeTruthy();
  });

  it("starts the live story when asked, saying so until the first frame", async () => {
    const { container } = render(<ZaitunExperience {...base} />);
    await act(async () => {});
    click("Load the 3D tour (about 6.1 MB)");
    await loaded();
    expect(state(container)).toBe("story");
    expect(last()).toMatchObject({ mode: "story", tier: "high" });
    expect(screen.getByRole("status").textContent).toBe("Loading the 3D view");
    expect(screen.queryByRole("button", { name: /Load the 3D tour/ })).toBeNull();
    expect(screen.getByTestId("story-scroll")).toBeTruthy();
    await act(async () => last().onFirstFrame?.());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Explore the compound" })).toBeTruthy();
  });

  it("opens the explorer instead where motion is reduced, with the same offer", async () => {
    cap.reducedMotion = true;
    render(<ZaitunExperience {...base} />);
    await act(async () => {});
    expect(screen.getByText("The 3D tour is a larger download, so it is shown as stills here.")).toBeTruthy();
    click("Load the 3D tour (about 6.1 MB)");
    await loaded();
    expect(last().mode).toBe("orbit");
    expect(screen.queryByTestId("story-scroll")).toBeNull();
  });
});

describe("ZaitunExperience when the browser takes the 3D view away", () => {
  it("goes back to the stills, reports it as a warning, and offers the scene again", async () => {
    const { container } = await running();
    await act(async () => last().onContextLost?.());
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(mon.reportError).toHaveBeenCalledExactlyOnceWith("ZaitunExperience", expect.objectContaining({ message: "WebGL context lost" }), {
      view: "flight",
      severity: "warning",
      recoverable: true,
    });
    expect(screen.getByText("The browser closed the 3D view.")).toBeTruthy();

    const mounts = canvas.mounts;
    click("Explore in 3D");
    await vi.waitFor(() => expect(canvas.mounts).toBe(mounts + 1));
    expect(state(container)).toBe("story");
    expect(screen.getByRole("status").textContent).toBe("Loading the 3D view");
    await act(async () => last().onFirstFrame?.());
    expect(container.querySelector(".xp")!.getAttribute("data-running")).toBe("true");
    expect(screen.queryByText("The browser closed the 3D view.")).toBeNull();
  });

  it("leaves the explorer and gives the page its scroll back", async () => {
    const { container } = await running();
    click("Explore the compound");
    act(() => last().onSelect?.("ZH-V05"));
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(async () => last().onContextLost?.());
    expect(document.documentElement.style.overflow).toBe("");
    expect(container.querySelector(".xp")!.getAttribute("data-mode")).toBe("story");
    // Asked for again, it opens on the story, not in the explorer it was lost in.
    click("Explore in 3D");
    await vi.waitFor(() => expect(last().mode).toBe("story"));
    expect(last().selectedId).toBeNull();
  });

  it("offers the explorer again where motion is reduced", async () => {
    cap.reducedMotion = true;
    render(<ZaitunExperience {...base} />);
    await act(async () => {});
    click("Explore in 3D");
    await loaded();
    await act(async () => last().onFirstFrame?.());
    await act(async () => last().onContextLost?.());
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.getByText("The browser closed the 3D view.")).toBeTruthy();
    click("Explore in 3D");
    await vi.waitFor(() => expect(screen.getByTestId("experience-canvas")).toBeTruthy());
    expect(last().mode).toBe("orbit");
  });
});

describe("ZaitunExperience on a device too slow for the scene", () => {
  it("gives way to the stills, with a warning and no offer to try again", async () => {
    const { container } = await running();
    await act(async () => last().onStarved?.());
    expect(state(container)).toBe("stills");
    expect(screen.queryByTestId("experience-canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: /3D/ })).toBeNull();
    expect(mon.reportError).toHaveBeenCalledExactlyOnceWith("ZaitunExperience", expect.objectContaining({ message: expect.stringContaining("frame rate stayed too low") }), {
      view: "flight",
      severity: "warning",
      stage: "starved",
    });
  });
});

describe("ZaitunExperience on a page Next keeps hidden", () => {
  // Next hides the page it navigates away from in React Activity and shows it again on the way back.
  const page = (mode: "visible" | "hidden") => (
    <Activity mode={mode}>
      <ZaitunExperience {...base} />
    </Activity>
  );
  async function shown() {
    const view = render(page("visible"));
    await loaded();
    await act(async () => last().onFirstFrame?.());
    canvas.control.pause.mockClear();
    canvas.control.resume.mockClear();
    return { ...view, hide: () => view.rerender(page("hidden")), show: () => view.rerender(page("visible")) };
  }

  it("stops the scene's drawing while hidden and starts it again when shown", async () => {
    const view = await shown();
    view.hide();
    expect(canvas.control.pause).toHaveBeenCalledOnce();
    expect(canvas.control.resume).not.toHaveBeenCalled();
    view.show();
    expect(canvas.control.resume).toHaveBeenCalledOnce();
    expect(canvas.control.pause).toHaveBeenCalledOnce();
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

  it("works before the scene has given its handle", async () => {
    const view = render(page("visible"));
    expect(() => view.rerender(page("hidden"))).not.toThrow();
    expect(() => view.rerender(page("visible"))).not.toThrow();
  });
});
