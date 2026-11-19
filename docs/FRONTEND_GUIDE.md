# Frontend guide

> The public site is now the Sawad Holding design (see [SAWAD.md](SAWAD.md)): cream, ink and one brass accent in OKLCH,
> Young Serif + Manrope (Amiri + IBM Plex Sans Arabic on Arabic pages), square corners, a solid header, and logical
> CSS properties throughout so Arabic pages mirror. The token names below are unchanged; their values and the
> type scale live in `app/globals.css`. The principles about restraint, motion and accessibility still apply.

A minimal, principled shell to build on. Restraint over decoration: neutral palette, one accent, strong type, generous space. Everything visual lives in a few tokens and a few classes, so restyling is cheap.

## 1. Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

No env vars needed: with no Supabase config the app runs in **local mode** (data from `data/seed/*.json`, writes to `.data/store.json`). After editing seed JSON, delete `.data/` (and restart the dev server — published content is cached) so it re-seeds.

Demo logins at `/admin/login` (password `password` for all):

| user | role |
| --- | --- |
| admin@sawad.local | admin |
| editor@sawad.local | editor |
| viewer@sawad.local | viewer |

**Edit mode:** sign in as admin or editor, then open the page you want to edit and enter edit mode (the launcher calls `/api/edit/enable?path=<page path>`, which sets the edit cookie and redirects back). In edit mode every `c.*` / `g.*` editable renders as a client island over the *draft* content; visitors always get plain server HTML of the *published* content. `/contact` is seeded as a draft, so visitors get a 404 until it is published.

Checks: `npx tsc --noEmit`, `npx eslint app components templates`, `npm test`.

## 2. Design principles (apple-design)

1. **Restraint.** Neutral surfaces + one accent (`--accent`). If an element does not earn its place, remove it.
2. **Typography is a set.** Size, weight, leading and tracking move together: large text gets tight leading and *negative* tracking; small text gets looser leading and slightly *positive* tracking. Never a single `letter-spacing`. System font first (SF Pro on Apple, Inter elsewhere). Spacing in `rem`, so layout scales with the user's text size.
3. **Spatial consistency.** One 4px-based spacing scale, one radius family. The mobile menu enters and leaves along the same path, anchored to its toggle (`transform-origin: top right`).
4. **Materials.** The header and menu are translucent (`backdrop-filter`, hairline edge, bright top edge); content scrolls beneath. Never stack a translucent surface on another translucent surface.
5. **Response and interruptibility.** Press feedback starts on pointer-down (`:active`, 100ms). Motion is CSS transitions on `transform`/`opacity`, which retarget from the current value if interrupted. Springs are expressed as `linear()` easings.
6. **Springs, not scripts.** Default spring is critically damped (no overshoot). Use `--ease-spring-bouncy` (damping ≈ 0.8) only for physical, momentum-driven interactions.
7. **Accessibility is a motion/material feature.** `prefers-reduced-motion` → cross-fades only; `prefers-reduced-transparency` → solid surfaces; `prefers-contrast: more` → defined borders and full-strength ink.
8. **Performance.** Server components by default. The only client JS on public pages is the mobile menu (`components/site/NavDisclosure.tsx`). No animation libraries.

## 3. Tokens (`app/globals.css`)

All tokens are CSS custom properties on `:root`, with dark values under `prefers-color-scheme: dark`, and mapped into Tailwind v4 via `@theme inline` (`bg-bg`, `bg-bg-subtle`, `bg-surface`, `text-fg`, `text-muted`, `border-line`, `bg-accent`, `text-accent-ink`, `rounded-card`, `rounded-panel`, `font-sans`).

| group | tokens |
| --- | --- |
| colour | `--bg --bg-subtle --surface --fg --fg-muted --line --accent --accent-hover --accent-ink --on-accent` |
| material | `--material --material-edge --material-blur` |
| spacing | `--space-1…24` (0.25rem steps), `--section-y`, `--gutter`, `--container` (72rem), `--container-narrow` (44rem), `--header-h` |
| radius / shadow | `--radius-sm --radius --radius-lg --radius-pill`, `--shadow-sm/md/lg` |
| motion | `--ease-spring`, `--ease-spring-bouncy`, `--ease-out`, `--dur-press` 100ms, `--dur-fast` 200ms, `--dur-spring` 500ms |

`--accent` fills buttons (white text, 4.6:1); `--accent-ink` is the text/link colour (adjusted per scheme for contrast).

**Type scale** (classes; also exported as `type.*` from `components/ui`):

| class | use | size | weight | leading | tracking |
| --- | --- | --- | --- | --- | --- |
| `.t-display` | h1 | 44–88px | 700 | 1.04 | -0.03em |
| `.t-title` | section h2 | 32–52px | 650 | 1.1 | -0.025em |
| `.t-headline` | card titles | 20–24px | 600 | 1.25 | -0.015em |
| `.t-lead` | intro copy | 19–24px | 400 | 1.4 | -0.01em |
| `.t-body` | body | 17px | 400 | 1.5 | 0 |
| `.t-small` | meta | 14px | 400 | 1.45 | +0.005em |
| `.t-eyebrow` | label | 13px | 600 | 1.3 | +0.04em, uppercase |

**Rich text:** `RichTextView` output is styled by `.prose` — `<c.RichText className="prose" />`. Combine with `t-lead` for intro copy.

## 4. UI primitives (`components/ui`)

```tsx
import { Container, Section, Button, buttonClass, Eyebrow, Heading, type } from "@/components/ui";

<Section tone="subtle">                 {/* vertical rhythm; tone="subtle" alternates bg */}
  <Container size="narrow">             {/* gutters + max width; narrow = reading width */}
    <Eyebrow>Label</Eyebrow>
    <Heading as="h2" level="title">Heading</Heading>
    <Button variant="secondary" size="sm">Click</Button>
  </Container>
</Section>

{/* Anything that must look like a button, e.g. a CMS link: */}
<c.Link k="cta" className={buttonClass({ variant: "primary" })} fallback={{ text: "Go", href: "/" }} />
```

Button variants: `primary | secondary | ghost | inverse`; sizes `md | sm`. Hover is gated by `(hover: hover)`; pressed state scales to 0.97.

## 5. Editable components API

Templates receive `{ page, c }`. `c` is bound to the page's scope; the shell's `g` is bound to the `global` scope. Keys are dot-separated (`hero.title`).

```tsx
<c.Text k="hero.title" as="h1" className="t-display" fallback="Welcome" multiline? />
<c.RichText k="hero.body" className="prose" fallback="Plain string or Tiptap JSON" />
<c.Image k="hero.image" priority sizes="100vw"
  fallback={{ src: "/placeholders/hero.png", alt: "", width: 1280, height: 720 }} />
<c.Link k="hero.cta" className={buttonClass()} fallback={{ text: "Go", href: "/contact" }} />
<c.List k="features" as="ul" itemAs="li" className="grid-cards" itemClassName="card"
  fallbackItems={["a", "b", "c"]} addLabel="Add feature" max={9}
  render={(item) => (
    <>
      <item.Text k="title" as="h2" fallback="Feature" />
      <item.Text k="body" as="p" fallback="…" multiline />
    </>
  )} />
c.text("hero.title", "fallback")   // raw string, for aria-labels etc.
c.editing                           // boolean
```

- **fallback** shows until an editor saves a value, so new pages render nicely immediately. Always provide one. `c.Image` fallbacks must be raster (PNG/JPG/WebP) and include `width`/`height`; `/public/placeholders/*` has examples (regenerate with `node scripts/gen-placeholders.mjs`).
- **Lists** store `{ items: ["id1", …] }`; each item's fields are separate blocks `features.<id>.title`. `render` receives `item`, an Editables object scoped to that item — use `item.Text k="title"`, never the full key. `fallbackItems` are the ids rendered before anything is saved.
- `as` / `itemAs` choose the wrapper elements (`ul`/`li`, `div`, `section`, …).
- Text blocks are plain strings. Use `multiline` for line breaks. Use `RichText` for formatted content (nodes: paragraph, heading 2–4, lists, blockquote, hr; marks: bold, italic, strike, code, underline, link).

## 6. Creating a template

1. Create `templates/pricing.tsx`:

   ```tsx
   import { Container, Section, buttonClass } from "@/components/ui";
   import type { TemplateDefinition } from "./types";

   /** Pricing — keys: title (text) · plans (list) → name, price (text) · cta (link) */
   export const pricingTemplate: TemplateDefinition = {
     id: "pricing",              // stable forever once pages use it
     name: "Pricing",
     description: "Plans grid with a call to action.",
     component: ({ c }) => (
       <main id="main">
         <Section>
           <Container>
             <c.Text k="title" as="h1" className="t-display" fallback="Pricing" />
             <c.List k="plans" as="ul" itemAs="li" className="grid-cards" itemClassName="card"
               fallbackItems={["free", "pro"]}
               render={(item) => (
                 <>
                   <item.Text k="name" as="h2" className="t-headline" fallback="Plan" />
                   <item.Text k="price" as="p" className="t-title" fallback="$0" />
                 </>
               )} />
             <c.Link k="cta" className={buttonClass()} fallback={{ text: "Start", href: "/contact" }} />
           </Container>
         </Section>
       </main>
     ),
   };
   ```

2. Register it in `templates/registry.ts` (add to the array).
3. Create a page in `/admin/pages` with that template. Done — the route, shell, metadata and editing all come for free.

Always render a single `<main id="main">` (the skip link targets it) and one `<h1>`.

## 7. Global content (header / footer)

`SiteShell` receives `g`. Existing global keys: `site.name`, `nav` (list, item field `link`), `footer.tagline`, `social` (list, item field `link`), `footer.note`. Add more by using `g.Text`/`g.Link`/… in `components/site/*` and adding seed entries to `data/seed/blocks.json` with `"scope": "global"`.

## 8. Rules

- **Never rename keys or template ids** that live pages use — the stored blocks would be orphaned. Add new keys instead.
- **Keep editables as direct, unwrapped nodes.** In edit mode they become client islands; don't nest them inside `<a>`, `<button>` or elements with click handlers (they would swallow clicks/focus). See how `SiteHeader` only wraps the brand in a link when `!g.editing`.
- **Server components by default.** Add `"use client"` only for real interaction; pass editables as `children` into client components (see `NavDisclosure`).
- **Use tokens, not literals.** No raw hex or ad-hoc px spacing; use `var(--space-*)`, `var(--radius*)`, type classes.
- **Motion:** `transform`/`opacity`/`filter` only; always provide a reduced-motion path (see the block at the end of `globals.css`). Keep every animation interruptible (CSS transitions, not fire-and-forget keyframes, for anything interactive).
- Seed JSON must validate: run `npm test` (see `data/seed/seed.test.ts`).

## 9. Layout of the shell

```
app/layout.tsx            fonts, metadata (title template), viewport/themeColor
app/globals.css           tokens, type scale, primitives, chrome, prose, a11y media queries
app/not-found.tsx
components/site/          SiteShell, SiteHeader, SiteFooter, NavDisclosure (client), PageSkeleton
components/ui/            Container, Section, Button, buttonClass, Eyebrow/Heading/type
templates/                home, generic, contact (+ registry.ts)
public/placeholders/      raster placeholders used as editable fallbacks
```
