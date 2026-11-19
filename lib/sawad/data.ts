/**
 * Sawad Holding sample content: compounds, residence types and the 148 phase-one homes.
 * Everything here is demo data for a fictional developer (see docs/SAWAD.md).
 * Generation is deterministic (seeded), so server and client always agree.
 */

export type Locale = "en" | "ar";
export type L10n = Record<Locale, string>;

export type CompoundId = "bustan-dijla" | "zaitun-hills" | "shatt-gardens";
export type SceneVariant = "dijla" | "zaitun" | "shatt";
export type CompoundStatus = "selling" | "coming-soon";
export type ResidenceKind = "villa" | "apartment";
export type ResidenceStatus = "available" | "reserved" | "sold";
export type ResidenceTypeId = "cv5" | "gv4" | "gv3" | "ra4" | "ta3" | "ta2";
export type Outlook = "river" | "garden" | "boulevard";

/** Still renders of the 3D scene, one per compound and viewpoint (public/sawad). */
export function sceneImage(variant: SceneVariant, view: "flight" | "street" | "terrace" | "aerial"): string {
  return `/sawad/scene-${variant}-${view}.jpg`;
}

export type Compound = {
  id: CompoundId;
  code: string;
  variant: SceneVariant;
  name: L10n;
  city: L10n;
  location: L10n;
  siteHa: number;
  landscapePct: number;
  phaseOne: { villas: number; apartments: number };
  status: CompoundStatus;
  handover: L10n;
  summary: L10n;
  /** Image rendered from the 3D scene (public/sawad). */
  image: { src: string; alt: L10n };
};

export type ResidenceType = {
  id: ResidenceTypeId;
  kind: ResidenceKind;
  name: L10n;
  bedrooms: number;
  builtM2: number;
  landM2: number | null;
  /** Sample guide price in USD for Bustan Dijla; other compounds apply a factor. */
  basePriceUsd: number;
};

export type Residence = {
  id: string; // e.g. "BD-V07"
  compound: CompoundId;
  type: ResidenceTypeId;
  kind: ResidenceKind;
  /**
   * Index into the compound's masterplan (components/sawad/scene/layout.ts).
   * Zaitun Hills is on the 28 ha plan: villa 0..59 (`planVillas()`), apartment 0..23
   * (block = floor(slot / 4), floor = slot % 4). Bustan Dijla and Shatt Gardens are still on the
   * 7 ha layout: villa 0..23, apartment 0..11.
   */
  slot: number;
  /** Apartments only: 0 = ground floor. */
  floor: number | null;
  bedrooms: number;
  builtM2: number;
  landM2: number | null;
  status: ResidenceStatus;
  outlook: Outlook;
  priceUsd: number;
};

export const RESIDENCE_TYPES: Record<ResidenceTypeId, ResidenceType> = {
  cv5: { id: "cv5", kind: "villa", name: { en: "Courtyard villa", ar: "فيلا بفناء داخلي" }, bedrooms: 5, builtM2: 520, landM2: 780, basePriceUsd: 980_000 },
  gv4: { id: "gv4", kind: "villa", name: { en: "Garden villa", ar: "فيلا بحديقة" }, bedrooms: 4, builtM2: 380, landM2: 560, basePriceUsd: 690_000 },
  gv3: { id: "gv3", kind: "villa", name: { en: "Garden villa", ar: "فيلا بحديقة" }, bedrooms: 3, builtM2: 290, landM2: 420, basePriceUsd: 520_000 },
  ra4: { id: "ra4", kind: "apartment", name: { en: "River apartment", ar: "شقة مطلة على النهر" }, bedrooms: 4, builtM2: 280, landM2: null, basePriceUsd: 430_000 },
  ta3: { id: "ta3", kind: "apartment", name: { en: "Terrace apartment", ar: "شقة بشرفة" }, bedrooms: 3, builtM2: 210, landM2: null, basePriceUsd: 315_000 },
  ta2: { id: "ta2", kind: "apartment", name: { en: "Terrace apartment", ar: "شقة بشرفة" }, bedrooms: 2, builtM2: 145, landM2: null, basePriceUsd: 225_000 },
};

export const TYPE_ORDER: ResidenceTypeId[] = ["cv5", "gv4", "gv3", "ra4", "ta3", "ta2"];

export const COMPOUNDS: Compound[] = [
  {
    id: "bustan-dijla",
    code: "BD",
    variant: "dijla",
    name: { en: "Bustan Dijla", ar: "بستان دجلة" },
    city: { en: "Baghdad", ar: "بغداد" },
    location: { en: "Tigris riverbank, south Baghdad", ar: "ضفة دجلة، جنوب بغداد" },
    siteHa: 42,
    landscapePct: 62,
    phaseOne: { villas: 20, apartments: 12 },
    status: "selling",
    handover: { en: "Late 2027", ar: "أواخر ٢٠٢٧" },
    summary: {
      en: "Our first compound sits on a restored date orchard where the Tigris bends south of the city. Villas face shaded boulevards; the apartments look straight across the water.",
      ar: "أول مجمّعاتنا، يقوم على بستان نخيل أعدنا إحياءه عند منعطف دجلة جنوب المدينة. تطل الفلل على شوارع مظللة، وتنفتح الشقق مباشرة على النهر.",
    },
    image: {
      src: sceneImage("dijla", "flight"),
      alt: {
        en: "Bustan Dijla from above at sunset: cream houses among date palms on a bend of the Tigris",
        ar: "بستان دجلة من الأعلى عند الغروب: بيوت بلون الكريم بين النخيل على منعطف دجلة",
      },
    },
  },
  {
    id: "zaitun-hills",
    code: "ZH",
    variant: "zaitun",
    name: { en: "Zaitun Hills", ar: "تلال الزيتون" },
    city: { en: "Erbil", ar: "أربيل" },
    location: { en: "Northern foothills, Erbil", ar: "السفوح الشمالية، أربيل" },
    siteHa: 28,
    landscapePct: 58,
    phaseOne: { villas: 60, apartments: 24 },
    status: "selling",
    handover: { en: "Mid 2028", ar: "منتصف ٢٠٢٨" },
    summary: {
      en: "Terraced into the foothills north of Erbil, with olive groves between the streets and a cooler evening breeze off the slopes. More villas here, and wider views.",
      ar: "مدرّج على السفوح شمال أربيل، تتخلل بساتين الزيتون شوارعه ويهبّ عليه نسيم المساء من المنحدرات. عدد الفلل فيه أكبر، والإطلالات أوسع.",
    },
    image: {
      src: sceneImage("zaitun", "flight"),
      alt: {
        en: "Zaitun Hills at golden hour: villas terraced into olive-covered foothills",
        ar: "تلال الزيتون في الساعة الذهبية: فلل مدرّجة على سفوح يكسوها الزيتون",
      },
    },
  },
  {
    id: "shatt-gardens",
    code: "SG",
    variant: "shatt",
    name: { en: "Shatt Gardens", ar: "حدائق الشط" },
    city: { en: "Basra", ar: "البصرة" },
    location: { en: "Shatt al-Arab, Basra", ar: "شط العرب، البصرة" },
    siteHa: 35,
    landscapePct: 65,
    phaseOne: { villas: 20, apartments: 12 },
    status: "coming-soon",
    handover: { en: "2029", ar: "٢٠٢٩" },
    summary: {
      en: "On the wide water of the Shatt al-Arab, among the palm groves Basra is known for. The greenest of the three: nearly two thirds of the site is garden.",
      ar: "على مياه شط العرب الواسعة، بين بساتين النخيل التي تشتهر بها البصرة. أكثر المجمّعات الثلاثة خضرةً، إذ تشغل الحدائق قرابة ثلثي الموقع.",
    },
    image: {
      src: sceneImage("shatt", "terrace"),
      alt: {
        en: "Shatt Gardens on the Shatt al-Arab in evening light, palm groves along the wide river",
        ar: "حدائق الشط على شط العرب في ضوء المساء، وبساتين النخيل على امتداد النهر الواسع",
      },
    },
  },
];

/** Older holdings shown in the portfolio table only. */
export const OTHER_HOLDINGS: { id: string; name: L10n; location: L10n; homes: number | null; status: L10n; note: L10n }[] = [
  {
    id: "al-nakhla-court",
    name: { en: "Al-Nakhla Court", ar: "مجمّع النخلة" },
    location: { en: "Baghdad", ar: "بغداد" },
    homes: 48,
    status: { en: "Delivered 2014", ar: "سُلّم عام ٢٠١٤" },
    note: { en: "Our first homes, still managed by Sawad", ar: "بيوتنا الأولى، وما زالت السواد تديرها" },
  },
  {
    id: "sawad-nursery",
    name: { en: "Sawad Nursery", ar: "مشتل السواد" },
    location: { en: "Babil", ar: "بابل" },
    homes: null,
    status: { en: "Growing since 2021", ar: "يعمل منذ ٢٠٢١" },
    note: { en: "Palm and olive stock for every compound", ar: "شتلات النخيل والزيتون لكل المجمّعات" },
  },
];

const COMPOUND_PRICE_FACTOR: Record<CompoundId, number> = {
  "bustan-dijla": 1,
  "zaitun-hills": 0.86,
  "shatt-gardens": 0.8,
};

/**
 * Villa type mix per compound, in slot order. Zaitun Hills follows its masterplan plot for plot:
 * the 15 waterfront plots are courtyard villas, the two rows of 15 behind them 4-bed garden
 * villas, and the row on the hill side of the upper boulevard 3-bed garden villas.
 */
const VILLA_MIX: Record<CompoundId, ResidenceTypeId[]> = {
  "bustan-dijla": [...rep("cv5", 6), ...rep("gv4", 8), ...rep("gv3", 6)],
  "zaitun-hills": [...rep("cv5", 15), ...rep("gv4", 30), ...rep("gv3", 15)],
  "shatt-gardens": [...rep("cv5", 6), ...rep("gv4", 8), ...rep("gv3", 6)],
};

/** What each Zaitun Hills villa looks onto, by masterplan row (15 villas per row, in slot order). */
const ZAITUN_ROW_OUTLOOK: Outlook[] = [
  "river", // waterfront
  "boulevard", // inland side of the lower boulevard
  "garden", // on the terrace, gardens over the olive bank
  "boulevard", // hill side of the upper boulevard
];
const ZAITUN_ROW_LENGTH = 15;

/** Ground floors are one garden duplex per building, by building index (Zaitun has six blocks, the others three). */
const GROUND_FLOOR_TYPES: ResidenceTypeId[] = ["ra4", "ta3", "ta2", "ta2", "ta3", "ra4"];
/** Floors one to three, the same in every building. Top floors are the river apartments. */
const UPPER_FLOOR_TYPES: ResidenceTypeId[] = ["ta2", "ta3", "ra4"];
const APARTMENT_FLOORS = 1 + UPPER_FLOOR_TYPES.length;

function apartmentType(floor: number, building: number): ResidenceTypeId {
  return floor === 0 ? GROUND_FLOOR_TYPES[building] : UPPER_FLOOR_TYPES[floor - 1];
}

function rep(v: ResidenceTypeId, n: number): ResidenceTypeId[] {
  return Array.from({ length: n }, () => v);
}

/** Small deterministic PRNG (mulberry32). */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function roundTo(n: number, step: number) {
  return Math.round(n / step) * step;
}

function pickStatus(r: number, compound: Compound): ResidenceStatus {
  if (compound.status === "coming-soon") return "available";
  const sold = compound.id === "bustan-dijla" ? 0.22 : 0.14;
  const reserved = sold + 0.24;
  return r < sold ? "sold" : r < reserved ? "reserved" : "available";
}

function buildResidences(): Residence[] {
  const out: Residence[] = [];
  for (const compound of COMPOUNDS) {
    const rand = seeded(hash(compound.id));
    const factor = COMPOUND_PRICE_FACTOR[compound.id];
    const make = (kind: ResidenceKind, slot: number, typeId: ResidenceTypeId, floor: number | null, outlook: Outlook) => {
      const t = RESIDENCE_TYPES[typeId];
      const n = String(slot + 1).padStart(2, "0");
      const id = `${compound.code}-${kind === "villa" ? "V" : "A"}${n}`;
      const variance = 0.95 + rand() * 0.1 + (floor ?? 0) * 0.015;
      out.push({
        id,
        compound: compound.id,
        type: typeId,
        kind,
        slot,
        floor,
        bedrooms: t.bedrooms,
        builtM2: t.builtM2,
        landM2: t.landM2,
        status: pickStatus(rand(), compound),
        outlook,
        priceUsd: roundTo(t.basePriceUsd * factor * variance, 5_000),
      });
    };
    VILLA_MIX[compound.id].slice(0, compound.phaseOne.villas).forEach((typeId, slot) => {
      // Courtyard villas take the river-side plots. Zaitun's other rows follow its masterplan;
      // elsewhere the rest alternate garden / boulevard.
      const byParity: Outlook = typeId === "cv5" ? "river" : slot % 2 ? "garden" : "boulevard";
      const outlook = compound.id === "zaitun-hills" ? ZAITUN_ROW_OUTLOOK[Math.floor(slot / ZAITUN_ROW_LENGTH)] : byParity;
      make("villa", slot, typeId, null, outlook);
    });
    for (let slot = 0; slot < compound.phaseOne.apartments; slot++) {
      const building = Math.floor(slot / APARTMENT_FLOORS);
      const floor = slot % APARTMENT_FLOORS;
      const typeId = apartmentType(floor, building);
      make("apartment", slot, typeId, floor, floor >= 2 || typeId === "ra4" ? "river" : "garden");
    }
  }
  return out;
}

export const RESIDENCES: Residence[] = buildResidences();

export function getCompound(id: string | null | undefined): Compound | undefined {
  return COMPOUNDS.find((c) => c.id === id);
}

export function residencesIn(compound: CompoundId): Residence[] {
  return RESIDENCES.filter((r) => r.compound === compound);
}

export function getResidence(id: string | null | undefined): Residence | undefined {
  if (!id) return undefined;
  return RESIDENCES.find((r) => r.id === id.toUpperCase());
}

/** Lowest guide price for a type in a compound (null if the compound has none). */
export function fromPrice(compound: CompoundId, type: ResidenceTypeId): number | null {
  const prices = RESIDENCES.filter((r) => r.compound === compound && r.type === type).map((r) => r.priceUsd);
  return prices.length ? Math.min(...prices) : null;
}

export function countByStatus(list: Residence[]): Record<ResidenceStatus, number> {
  const out: Record<ResidenceStatus, number> = { available: 0, reserved: 0, sold: 0 };
  for (const r of list) out[r.status]++;
  return out;
}

export const BUDGET_BANDS = [
  { id: "under-300", min: 0, max: 300_000 },
  { id: "300-600", min: 300_000, max: 600_000 },
  { id: "600-900", min: 600_000, max: 900_000 },
  { id: "over-900", min: 900_000, max: Infinity },
] as const;
export type BudgetBandId = (typeof BUDGET_BANDS)[number]["id"];

export const TOTALS = {
  residences: RESIDENCES.length,
  villas: RESIDENCES.filter((r) => r.kind === "villa").length,
  apartments: RESIDENCES.filter((r) => r.kind === "apartment").length,
};

export type Gallery = {
  id: CompoundId;
  name: L10n;
  address: L10n;
  hours: L10n;
};

export const GALLERIES: Gallery[] = [
  {
    id: "bustan-dijla",
    name: { en: "Baghdad gallery", ar: "صالة عرض بغداد" },
    address: { en: "At the Bustan Dijla gate, riverside road, south Baghdad", ar: "عند بوابة بستان دجلة، الطريق المحاذي للنهر، جنوب بغداد" },
    hours: { en: "Saturday to Thursday, 10:00 to 19:00", ar: "من السبت إلى الخميس، من ١٠:٠٠ حتى ١٩:٠٠" },
  },
  {
    id: "zaitun-hills",
    name: { en: "Erbil gallery", ar: "صالة عرض أربيل" },
    address: { en: "Zaitun Hills show village, northern foothills road, Erbil", ar: "القرية النموذجية في تلال الزيتون، طريق السفوح الشمالية، أربيل" },
    hours: { en: "Saturday to Thursday, 10:00 to 19:00", ar: "من السبت إلى الخميس، من ١٠:٠٠ حتى ١٩:٠٠" },
  },
  {
    id: "shatt-gardens",
    name: { en: "Basra gallery", ar: "صالة عرض البصرة" },
    address: { en: "Corniche office, Shatt al-Arab, Basra", ar: "مكتب الكورنيش، شط العرب، البصرة" },
    hours: { en: "Sunday to Thursday, 11:00 to 18:00", ar: "من الأحد إلى الخميس، من ١١:٠٠ حتى ١٨:٠٠" },
  },
];
