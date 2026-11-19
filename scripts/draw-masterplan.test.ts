import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planAmenities, planApartmentBlocks, planLandUseAt, planParking, planTreeZones, planVillas } from "../components/sawad/scene/layout";
import { PLAN_FRAME, SHEET, SVG_PATH, TYPE_STYLE, indicativeTrees, masterplanSvg, planSchedule } from "./draw-masterplan.mjs";

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Checks every tag is closed in order, and returns the tag names seen. */
function wellFormed(svg: string): string[] {
  const open: string[] = [];
  const seen: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (closing) expect(open.pop(), `closing </${name}>`).toBe(name);
    else {
      seen.push(name);
      if (!selfClosing) open.push(name);
    }
  }
  expect(open).toEqual([]);
  return seen;
}

/** The markup of the group with this id, up to its matching close tag. */
function group(svg: string, id: string): string {
  const start = svg.indexOf(`<g id="${id}"`);
  expect(start, `group ${id}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (const m of svg.slice(start).matchAll(/<g[\s>]|<\/g>/g)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return svg.slice(start, start + m.index! + 4);
  }
  throw new Error(`group ${id} is not closed`);
}

const textsIn = (markup: string) => [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => decode(m[1]));

describe("draw-masterplan", () => {
  const svg = masterplanSvg();
  const texts = textsIn(svg);

  it("is well-formed, described for screen readers, and the same every time", () => {
    const tags = wellFormed(svg);
    expect(tags[0]).toBe("svg");
    expect(svg).toContain(`viewBox="0 0 ${SHEET.width} ${SHEET.height}"`);
    expect(svg).toContain(`<title id="mp-title">Zaitun Hills: 28 ha masterplan</title>`);
    expect(svg).toMatch(/<desc id="mp-desc">[^<]*60 numbered villa plots[^<]*6 apartment blocks/);
    expect(masterplanSvg()).toBe(svg);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("numbers every villa plot and every apartment block", () => {
    const villas = planVillas();
    for (const v of villas) {
      const g = group(svg, `villa-${String(v.index).padStart(2, "0")}`);
      expect(textsIn(g)).toEqual([`V${String(v.index + 1).padStart(2, "0")}`]);
      // The roof carries the type's colour.
      expect(g).toContain(`fill="${TYPE_STYLE[v.type].fill}"`);
    }
    expect(svg.match(/<g id="villa-\d\d">/g)).toHaveLength(villas.length);
    const blocks = planApartmentBlocks();
    expect(blocks.map((b) => textsIn(group(svg, `apartment-${b.index}`))[0])).toEqual(["A01–04", "A05–08", "A09–12", "A13–16", "A17–20", "A21–24"]);
    // Each block shows its four floors stepping toward the stream.
    for (const b of blocks) expect(group(svg, `apartment-${b.index}`).match(/<rect /g)).toHaveLength(b.floors);
  });

  it("colour-codes the home types with distinct colours and names them in the legend", () => {
    const fills = Object.values(TYPE_STYLE).map((t) => t.fill);
    expect(new Set(fills).size).toBe(4);
    const legend = textsIn(group(svg, "legend"));
    expect(legend).toEqual(expect.arrayContaining(["Courtyard villa, 5 bed  × 15", "Garden villa, 4 bed  × 30", "Garden villa, 3 bed  × 15", "Apartment block, 4 homes  × 6 (24 homes)"]));
    expect(legend).toEqual(expect.arrayContaining(["Date palm", "Olive", "Citrus", "Phase two reserve", "Contour, every 2 m", "Boundary wall, 2.8 m"]));
  });

  it("labels the amenities, streets, gates and parking", () => {
    for (const label of [
      "Mosque",
      "Sales gallery (show villa)",
      "Gym, terrace to the courts",
      "Padel courts",
      "Tennis court",
      "Playground under shade sails",
      "Reflecting pool, 72 × 12 m",
      "Lawn",
      "Garden steps, +6 m",
      "Belvedere",
      "Stream plaza",
      "MAIN GATE",
      "EAST GATE",
      "BOULEVARD A",
      "BOULEVARD B",
      "WEST LINK",
      "EAST LINK",
      "RIVERSIDE PROMENADE",
      "Visitor parking, 20",
      "Gym parking, 16",
      "Apartment parking, 4 courts of 16",
      "Service parking, 12",
      "OLIVE BANK",
      "PHASE TWO RESERVE",
    ]) {
      expect(texts, label).toContain(label);
    }
    // Every amenity and parking court on the plan is named above.
    expect(planAmenities()).toHaveLength(13);
    expect(svg.match(/<g id="parking-[\w-]+">/g)).toHaveLength(planParking().length);
    // Levels of the valley floor and the terrace.
    expect(texts).toEqual(expect.arrayContaining(["+1.2", "+7.2"]));
  });

  it("shows the sun, the scale, the flow of the stream and what is still open", () => {
    expect(texts).toEqual(expect.arrayContaining(["Golden-hour sun", "4.2° above the horizon, light falls this way", "North: not confirmed yet", "downstream", "200 m"]));
    expect(texts.some((t) => t.includes("turns to face Mecca once north is known"))).toBe(true);
    expect(PLAN_FRAME.pixelsPerMetre).toBeGreaterThan(1);
    expect(PLAN_FRAME.width).toBeCloseTo((PLAN_FRAME.view.maxX - PLAN_FRAME.view.minX) * PLAN_FRAME.pixelsPerMetre, 6);
  });

  it("gives a land schedule that adds up, with 58% landscape", () => {
    const s = planSchedule();
    expect(s.siteHa).toBeCloseTo(28.04, 1);
    expect(s.rows.reduce((n: number, r: { pct: number }) => n + r.pct, 0)).toBeCloseTo(100, 6);
    expect(s.rows.reduce((n: number, r: { ha: number }) => n + r.ha, 0)).toBeCloseTo(s.siteHa, 6);
    expect(Math.round(s.landscapePct)).toBe(58);
    expect(s.villas).toEqual({ courtyard: 15, "garden-4": 30, "garden-3": 15, total: 60 });
    expect([s.blocks, s.apartments]).toEqual([6, 24]);
    expect(s.parking).toEqual({ shared: 112, carports: 120 });
    expect(texts).toEqual(expect.arrayContaining(["Landscape 58% once phase two is built", "Site inside the wall", "120 carport spaces (two per villa) and 112 in shared courts"]));
  });

  it("draws indicative trees of every species, clear of streets, buildings, courts and water", () => {
    const trees = indicativeTrees();
    expect(Object.keys(trees).sort()).toEqual([...new Set(planTreeZones().map((z) => z.species))].sort());
    expect(trees["date-palm"].length).toBeGreaterThan(400);
    expect(trees.olive.length).toBeGreaterThan(1500);
    expect(trees.citrus).toHaveLength(planVillas().length * 2);
    for (const [x, z] of [...trees["date-palm"], ...trees.olive]) {
      expect(["road", "parking", "building", "court", "play", "water", "paving", "plot"]).not.toContain(planLandUseAt(x, z));
    }
    // Citrus stands in the villas' back gardens.
    for (const [x, z] of trees.citrus) expect(planLandUseAt(x, z)).toBe("plot");
  });

  it("keeps the committed drawing current", () => {
    // docs/zaitun/masterplan.svg is the drawing people open; a stale copy would show an old plan.
    expect(readFileSync(SVG_PATH, "utf8")).toBe(svg);
  });
});
