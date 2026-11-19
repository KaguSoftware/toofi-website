import type { L10n } from "./data";

/** Long-form sample content shared by the What we do, Our story and Home templates. */

export type Item = { id: string; title: L10n; body: L10n };

export const OPERATIONS: Item[] = [
  {
    id: "development",
    title: { en: "Development", ar: "التطوير" },
    body: {
      en: "We buy the land, plan each compound around its water and trees, and carry the permits through.",
      ar: "نشتري الأرض، ونخطط كل مجمّع حول مائه وأشجاره، ونتابع التراخيص حتى نهايتها.",
    },
  },
  {
    id: "construction",
    title: { en: "Construction", ar: "البناء" },
    body: {
      en: "Our own site teams build the structure and the finishes, so one company answers for every wall.",
      ar: "تبني فرقنا الميدانية الهيكل والتشطيبات، فتكون شركة واحدة مسؤولة عن كل جدار.",
    },
  },
  {
    id: "landscape",
    title: { en: "Landscape", ar: "تنسيق الحدائق" },
    body: {
      en: "Palms and olives come from our nursery in Babil and go into the ground before the first foundations.",
      ar: "يأتي النخيل والزيتون من مشتلنا في بابل، ويُغرس في الأرض قبل صبّ الأساسات الأولى.",
    },
  },
  {
    id: "sales",
    title: { en: "Sales and ownership", ar: "البيع والتملك" },
    body: {
      en: "One adviser stays with you from the first viewing until you hold the keys.",
      ar: "يرافقك مستشار واحد من أول معاينة حتى تستلم المفاتيح.",
    },
  },
  {
    id: "community",
    title: { en: "Community management", ar: "إدارة المجتمع السكني" },
    body: {
      en: "After handover we run security, maintenance, utilities and the shared gardens.",
      ar: "بعد التسليم نتولى الأمن والصيانة والخدمات والحدائق المشتركة.",
    },
  },
];

export const PROCESS: Item[] = [
  {
    id: "choose",
    title: { en: "Choose", ar: "اختر" },
    body: {
      en: "Shortlist homes online or with an adviser. Compare plots, outlooks and guide prices.",
      ar: "اختر منازلك المفضلة عبر الموقع أو مع مستشار، وقارن بين القطع والإطلالات والأسعار الاسترشادية.",
    },
  },
  {
    id: "visit",
    title: { en: "Visit", ar: "زُر" },
    body: {
      en: "Walk the show home and the plot itself at the gallery by the compound gate.",
      ar: "تجوّل في المنزل النموذجي وفي القطعة نفسها انطلاقًا من صالة العرض عند بوابة المجمّع.",
    },
  },
  {
    id: "reserve",
    title: { en: "Reserve", ar: "احجز" },
    body: {
      en: "A refundable deposit holds the home for 30 days while you decide.",
      ar: "تدفع عربونًا مستردًّا يحجز لك المنزل ٣٠ يومًا ريثما تتخذ قرارك.",
    },
  },
  {
    id: "sign",
    title: { en: "Sign", ar: "وقّع" },
    body: {
      en: "Sign the sale contract and agree a payment plan tied to construction stages.",
      ar: "وقّع عقد البيع واتفق على خطة دفع مرتبطة بمراحل البناء.",
    },
  },
  {
    id: "move-in",
    title: { en: "Move in", ar: "انتقل" },
    body: {
      en: "Inspect the finished home with your adviser, receive the keys, and meet the community team.",
      ar: "عاين منزلك المكتمل مع مستشارك، واستلم المفاتيح، وتعرّف إلى فريق إدارة المجتمع.",
    },
  },
];

export const PARTNERS: (Item & { interest: "landowner" | "investor" | "supplier"; cta: L10n })[] = [
  {
    id: "landowners",
    interest: "landowner",
    title: { en: "Landowners", ar: "ملّاك الأراضي" },
    body: {
      en: "Orchard or riverside land of 20 hectares or more near Baghdad, Erbil, Basra, Najaf or Karbala. We buy outright or develop in partnership.",
      ar: "بساتين أو أراضٍ على الأنهار بمساحة ٢٠ هكتارًا فأكثر قرب بغداد أو أربيل أو البصرة أو النجف أو كربلاء. نشتري الأرض أو نطوّرها بالشراكة.",
    },
    cta: { en: "Offer land", ar: "اعرض أرضك" },
  },
  {
    id: "investors",
    interest: "investor",
    title: { en: "Investors", ar: "المستثمرون" },
    body: {
      en: "Co-invest in a single compound phase, with returns tied to sales and a seat on the project board.",
      ar: "شارك في الاستثمار في مرحلة واحدة من مجمّع، بعوائد مرتبطة بالمبيعات ومقعد في مجلس المشروع.",
    },
    cta: { en: "Talk to the investment team", ar: "تحدّث إلى فريق الاستثمار" },
  },
  {
    id: "suppliers",
    interest: "supplier",
    title: { en: "Suppliers", ar: "الموردون" },
    body: {
      en: "Stone, joinery, glazing, irrigation and solar. We prefer Iraqi makers and sign multi-compound agreements.",
      ar: "الحجر والنجارة والزجاج والري والطاقة الشمسية. نفضّل الصنّاع العراقيين، ونبرم اتفاقات تشمل أكثر من مجمّع.",
    },
    cta: { en: "Register as a supplier", ar: "سجّل بصفتك موردًا" },
  },
];

export const TIMELINE: { year: number; title: L10n; body: L10n }[] = [
  {
    year: 2009,
    title: { en: "An orchard first", ar: "البستان أولًا" },
    body: {
      en: "The founding family restores a neglected date orchard south of Baghdad and builds its first homes among the trees.",
      ar: "تعيد العائلة المؤسسة الحياة إلى بستان نخيل مهمل جنوب بغداد، وتبني بيوتها الأولى بين أشجاره.",
    },
  },
  {
    year: 2014,
    title: { en: "Al-Nakhla Court", ar: "مجمّع النخلة" },
    body: {
      en: "48 families move into Al-Nakhla Court. Sawad still manages it today.",
      ar: "تنتقل ٤٨ عائلة إلى مجمّع النخلة، وما زالت السواد تديره حتى اليوم.",
    },
  },
  {
    year: 2018,
    title: { en: "One holding", ar: "شركة قابضة واحدة" },
    body: {
      en: "Development, construction and community management come together under Sawad Holding.",
      ar: "يجتمع التطوير والبناء وإدارة المجتمعات السكنية تحت مظلة السواد القابضة.",
    },
  },
  {
    year: 2021,
    title: { en: "The nursery", ar: "المشتل" },
    body: {
      en: "Sawad Nursery opens in Babil to grow the palms and olives for every future compound.",
      ar: "يُفتتح مشتل السواد في بابل لإكثار النخيل والزيتون لكل المجمّعات القادمة.",
    },
  },
  {
    year: 2024,
    title: { en: "Bustan Dijla", ar: "بستان دجلة" },
    body: {
      en: "Bustan Dijla opens on the Tigris in Baghdad, followed by plans for Erbil and Basra.",
      ar: "يُفتتح بستان دجلة على ضفة دجلة في بغداد، وتتبعه خطط أربيل والبصرة.",
    },
  },
];

export const PRINCIPLES: Item[] = [
  {
    id: "plant-first",
    title: { en: "Plant before we pour", ar: "نزرع قبل أن نصبّ" },
    body: {
      en: "Trees go in first, so a compound has shade on the day families arrive, not ten years later.",
      ar: "نغرس الأشجار أولًا، فيجد السكان الظل يوم وصولهم، لا بعد عشر سنوات.",
    },
  },
  {
    id: "build-for-heat",
    title: { en: "Build for the heat", ar: "نبني لمواجهة الحر" },
    body: {
      en: "Courtyards, deep shade, thick walls and cross breezes, the way houses here were built for centuries.",
      ar: "أفنية وظلال عميقة وجدران سميكة وتيارات هواء متقاطعة، كما بُنيت البيوت هنا قرونًا.",
    },
  },
  {
    id: "one-adviser",
    title: { en: "One adviser, one answer", ar: "مستشار واحد وجواب واحد" },
    body: {
      en: "The person who shows you the plot is the person who hands you the keys.",
      ar: "الشخص الذي يريك القطعة هو نفسه من يسلّمك المفاتيح.",
    },
  },
  {
    id: "stay",
    title: { en: "Stay after the keys", ar: "نبقى بعد التسليم" },
    body: {
      en: "We manage every compound we build. Our oldest, Al-Nakhla Court, is in its twelfth year.",
      ar: "ندير كل مجمّع نبنيه. أقدمها، مجمّع النخلة، يدخل عامه الثاني عشر.",
    },
  },
];

export const LEADERSHIP: { id: string; role: L10n; remit: L10n }[] = [
  { id: "chair", role: { en: "Chair", ar: "رئيس مجلس الإدارة" }, remit: { en: "Founding family, since 2009", ar: "من العائلة المؤسسة، منذ ٢٠٠٩" } },
  { id: "md", role: { en: "Managing director", ar: "المدير التنفيذي" }, remit: { en: "Runs the holding day to day", ar: "يدير الشركة القابضة يوميًا" } },
  { id: "development", role: { en: "Director of development", ar: "مدير التطوير" }, remit: { en: "Land, planning and permits", ar: "الأراضي والتخطيط والتراخيص" } },
  { id: "construction", role: { en: "Director of construction", ar: "مدير البناء" }, remit: { en: "Site teams across three cities", ar: "الفرق الميدانية في ثلاث مدن" } },
  { id: "landscape", role: { en: "Head of landscape", ar: "رئيس قسم تنسيق الحدائق" }, remit: { en: "The nursery and every garden", ar: "المشتل وكل الحدائق" } },
  { id: "community", role: { en: "Head of community", ar: "رئيس إدارة المجتمعات" }, remit: { en: "Life after handover", ar: "الحياة بعد التسليم" } },
];
