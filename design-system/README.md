# Cecomunica — Design System

> Mission‑critical communications, from Panama. Two‑way radios, TETRA, Push‑to‑Talk over Cellular, telecom infrastructure and enterprise communication for ports, logistics, industrial operations and critical infrastructure.

> **Estado (2026-07):** este design system está **implementado y vigente** — no es
> una propuesta. El branding oficial vive en `public/brand/` (monograma, lockups,
> app-icons) y el look de la app está portado a `public/css/` (`ceco-ui.css`,
> `ceco-command.css`, etc.), que son la fuente de verdad en producción. Las
> exploraciones y entregas ya cerradas están en [`archivo/`](archivo/README.md)
> y **no** representan trabajo pendiente.

---

## 1 · Company context

**Cecomunica** (legally branded **C Comunica**, tagline **"Soluciones en Comunicaciones"**) is a Panama‑based mission‑critical communications integrator. They are an in‑country distributor and systems partner — most prominently for **Hytera** professional radio gear — selling into:

- **Enterprise & industrial** — manufacturing, logistics, mining
- **Ports & maritime** — container terminals, port authorities
- **Government & public safety** — agencies needing TETRA / DMR networks
- **Critical infrastructure** — utilities, energy, transport
- **Procurement / technical buyers** inside any of the above

Surfaces represented in this design system:

| # | Surface              | Status              |
|---|----------------------|---------------------|
| 1 | Marketing website    | UI kit included     |
| 2 | Product spec pages   | Covered by website kit |
| 3 | Sales / corporate collateral (cards, banners) | Tokens + brand assets |

> The company sits in the **enterprise / industrial telecom** category — *not* consumer tech, *not* startup. The whole system is tuned for that read: corporate, dependable, technical, slightly serious. No playful gradients, no rounded‑pill marketing‑land, no emoji.

### Sources used

All materials were uploaded directly to this project. No Figma file or codebase was provided.

| Source | Original path |
|--------|---------------|
| Primary logo (square, full lockup) | `uploads/logoCecomunica.png` → `assets/logo-primary.png` |
| Compact logo (banner crop) | `uploads/logo_cecomunica.png` → `assets/logo-compact.png` |
| Hero banner — product family A | `uploads/HeroBannerImage.1.png` → `assets/hero-products-1.png` |
| Hero banner — product family B | `uploads/HeroBannerImage.2.png` → `assets/hero-products-2.png` |
| Business card (front) | `uploads/WhatsApp Image 2026-05-07 at 8.46.50 AM.jpeg` → `assets/business-card-front.jpg` |
| Business card (back) | `uploads/28a83f56-d9c0-4b64-8439-be9d5cb82354.jpeg` → `assets/business-card-back.jpg` |

Public site (referenced on collateral): **www.cecomunica.com** · social: `@cecomunica`.

---

## 2 · Index of this design system

```
.
├── README.md                  ← you are here
├── SKILL.md                   ← Claude Code / Skills entry point
├── colors_and_type.css        ← all design tokens (CSS variables)
├── assets/                    ← logos, hero imagery, business cards
├── preview/                   ← cards rendered in the Design System tab
├── ui_kits/
│   ├── MIGRATION.md           ← how the kit maps to the shipped app CSS
│   ├── app/                   ← service-orders app UI kit (source of ceco-ui)
│   ├── app-mobile/            ← mobile variants
│   └── website/               ← marketing-website UI kit
│       ├── README.md
│       ├── index.html         ← clickable demo
│       └── components/        ← Header, Hero, ProductCard, Footer, …
└── archivo/                   ← closed proposals & deliveries (see its README;
                                  everything there is shipped or discarded)
```

To use a token in any HTML file:
```html
<link rel="stylesheet" href="../colors_and_type.css">
<h1 class="cc-display-l">Critical communications, end to end.</h1>
```

---

## 3 · Content fundamentals

Cecomunica writes in **Spanish first** — this is a Panamanian B2B brand. English appears only in product‑name passthroughs ("Push‑to‑Talk over Cellular", "TETRA", "Body Camera").

### Voice
- **Serious, declarative, technical.** Statements of capability rather than promise. *"Soluciones en Comunicaciones"* — "Communication Solutions" — is the master tagline. Note the bare noun: *solutions*, not *better solutions*, not *smarter solutions*.
- **Vendor‑grade, not personal.** No "we believe", no "let's build together". The brand speaks like a system integrator — the sentences are about the network, the gear, the SLA, the deployment.
- **Capability‑forward.** Lead with what the system *does* and *who it's for*: *"Radios digitales DMR para operaciones portuarias 24/7."*
- **No emoji, no exclamation marks, no winks.** This is procurement‑facing copy. Buyers are technical engineers and operations managers, not consumers.
- **Spanish formality:** use **"usted"** in customer‑facing copy (corporate register), never **"tú"**. Sales / RFP collateral may go full third‑person institutional ("La empresa", "El cliente").
- **Mix Spanish body + English technical terms.** Example: *"Compatible con IP67, IP68 y MIL‑STD‑810G"*. Don't translate standards, model numbers, or protocol names.

### Casing
- **Brand:** "**CeComunica**" — internal capital, written as one word. Never "Ce Comunica" or "Cecomunica" in display contexts (URLs and code can flatten it).
- **Headlines:** Sentence case. Avoid Title Case in Spanish (it isn't conventional).
- **Product line callouts:** Title Case is OK for product family names — *"Hytera DMR Tier III"*, *"Body Camera VM780"* — because they are proper product names.
- **Acronyms:** Always uppercase. *DMR, TETRA, PoC, IP67, MIL‑STD, RAN, SLA*.

### Examples (written in‑voice for this brand)

> **Hero:** Comunicaciones críticas, sin interrupciones.
> Diseñamos, desplegamos y mantenemos redes de radio para puertos, gobierno e industria en Panamá y Centroamérica.

> **Product card:** Hytera HP78X · Radio portátil DMR Tier II · IP67 · Bluetooth · GPS

> **CTA primario:** Solicitar cotización
> **CTA secundario:** Hablar con un ingeniero

> **Section eyebrow:** SOLUCIONES VERTICALES

> **About copy:** Cecomunica diseña, despliega y mantiene redes de radiocomunicación profesional. Operamos desde Punta Paitilla, Panamá, con cobertura nacional en despliegue, mantenimiento y soporte 24/7.

### Anti‑patterns (don't do this)
- ❌ "Welcome to the future of communication 🚀"
- ❌ "Discover how we can help you connect"
- ❌ "Let's revolutionize your radio network"
- ❌ Title‑Casing Every Spanish Heading Like This
- ❌ Decorative use of "ICONIC", "GAME CHANGING", etc.

---

## 4 · Visual foundations

The brand is built around **three visual ideas** — every layout should be doing at least one of them:

1. **Layered translucency** — the logo's stacked, semi‑transparent rectangular cubes signal *layers of a network stack*. Use translucent panels and stacked card depth to reinforce this.
2. **The dot grid / signal field** — the cascading dots beneath the logo cube are the brand's *signal* motif. They appear in the hero banner background as a fine grid + scattered points. Use sparingly, as decoration in dark surfaces.
3. **Hard, corporate geometry** — sharp diagonal wedges (business‑card paper pattern), crisp rectangles, modest radii. Nothing organic, nothing hand‑drawn.

### Color
- **Primary brand blue** `--blue-500 #0091D7` — the wordmark cyan‑blue. Use for primary buttons, links, the brand band, key icons.
- **Cyan accent** `--cyan-500 #1FA0E1` — slightly lighter; used in the footer band of the business card, in highlights and hover halos.
- **Navy** `--navy-800 / 900` — exclusively for the *hero / dark surface* role. Behind product photography, in CTA bands, in the website footer.
- **White + cool grays** `--gray-50 → --gray-900` — corporate, no warmth. The grays are deliberately steel‑cool (a touch of blue) so they sit next to the brand blue without clashing.
- **Status reds/greens/ambers are RESTRAINED.** They appear only as small dots / pills on radios‑online / signal indicators — never as headline colors.
- **Color rule:** A page should be **either** white‑on‑white with a single brand‑blue accent **or** navy‑with‑bright‑blue. Don't mix three accent colors on one screen.

### Typography
- **Display: Barlow** (700/800) — semi‑condensed, industrial. *Substitution flag — see "Font substitutions" below.*
- **Body: IBM Plex Sans** — corporate technical serif‑less; chosen for its IBM‑era industrial heritage that matches mission‑critical telecom.
- **Mono: IBM Plex Mono** — for spec sheets, frequencies (`136–174 MHz`), model numbers (`HP78X‑U1`), and any callsign / channel readout.
- **Tight tracking** on display sizes (`-0.02em`); zero or slightly positive tracking on body. Eyebrows are **all‑caps with `+0.14em`** tracking.
- **Hierarchy is enforced by size + weight, not color.** Body copy is `--fg-2` (gray‑700), captions are `--fg-3`. Don't tint headlines blue — keep them near‑black.

### Font substitutions

The CeComunica wordmark itself appears to be set in a **proprietary or modified humanist sans** (similar to Avenir / FF Mark). We did not receive font files. Substitutions made:

| Role     | Substitute        | Rationale                              | Action needed |
|----------|-------------------|----------------------------------------|---------------|
| Display  | **Barlow**        | Semi‑condensed industrial Google Font  | Provide brand TTF/OTF if one exists |
| Body     | **IBM Plex Sans** | Best technical/enterprise pairing      | Confirm or swap |
| Mono     | **IBM Plex Mono** | Pairs with Plex Sans                   | Confirm |

**Please provide the official Cecomunica typeface(s)** if they exist, and we'll drop them into `fonts/` and rebind `--font-display` / `--font-body`.

### Spacing
- **4 px base** (`--sp-1`). The whole system snaps to multiples of 4.
- Common rhythms: card padding `--sp-6 (24)`, section padding `--sp-16 (64)` to `--sp-24 (96)`, hero padding `--sp-20 (80)` vertically.
- **Density is enterprise‑normal** — *not* airy startup, *not* dense data‑grid. Forms breathe; tables are compact.

### Backgrounds & imagery
- **Real product photography on dark navy** is the signature shot — cutout product photos on `--gradient-hero`, with the wordmark top‑left and a partner logo (e.g. "Hytera") top‑right. *See `assets/hero-products-*.png`.*
- The dark hero background carries a **subtle grid + scattered dot pattern** (the "signal field"). Always *subtle* — readable text takes priority.
- **Light surfaces** use the **diagonal corporate paper pattern** (`--pattern-corporate-diagonals`) — wide off‑white wedges. Used on collateral / cards / about page hero.
- **No hand‑drawn illustrations. No 3D blobs. No abstract gradients.** Imagery is photographic (radios, towers, port operations) or schematic (network diagrams, coverage maps).
- **Color of imagery:** cool, slightly desaturated. Industrial environments shot with a cool blue cast match the brand. Avoid warm orange sunsets, B&W, or heavy grain.

### Animation & easing
- **Quiet by default.** This is mission‑critical software's marketing site, not a fashion brand. Most movement is **120–200 ms fades + 4–8 px translates** on hover/scroll.
- `--ease-out` for entrances, `--ease-in-out` for state changes. **No bounces, no spring overshoots.**
- The only place to be expressive is **signal / connectivity visualizations** — pulsing radio dots, tower waves, network diagrams. Even there, keep it slow and deliberate (1.5–2 s loops).
- Reduced motion: respect `prefers-reduced-motion: reduce` everywhere.

### Hover & press states
- **Buttons (primary):** hover → `--brand-hover` (one step darker). Press → `--brand-press` (two steps darker) + `transform: translateY(1px)`. **No scale changes.**
- **Buttons (secondary / ghost):** hover → background `--brand-soft` (very pale blue tint). Press → `--brand-soft-hov`.
- **Cards:** hover → `--shadow-md` → `--shadow-lg` and a 1 px border lift to `--border-default`. **No translation, no scale.** Cards are stationary; they just gain depth.
- **Links:** hover → underline + `--brand-hover`. **Never** rely on color change alone.
- **Focus:** always `--ring-focus` (3 px brand‑blue glow). Never remove the focus ring.

### Borders & shadows
- **Borders are 1 px**, drawn in `--border-subtle` for resting state, `--border-default` for emphasis.
- **Inputs and cards both have borders** — this is an enterprise look; we don't rely on shadow alone the way consumer apps do.
- **Shadows are crisp and tight** (low spread, dark cool color `rgba(6,24,41,…)`). No fluffy glows.
- **Never use a colored left‑border accent on a card** — that's a banned pattern.

### Use of transparency & blur
- **Translucency is a brand idea**, but use it carefully. The logo shows it; in UI it appears as:
  - The hero scrim on dark photography (`rgba(6,24,41,0.55)`)
  - Signal field overlays
  - Modal backdrops
- **Backdrop blur** is acceptable on sticky headers over photo banners (`backdrop-filter: blur(12px)`), nowhere else.

### Radii
- **Default 6 px** for buttons / inputs / chips.
- **10 px** for cards.
- **16 px** only for hero panels / large feature cards.
- **Pills (999 px)** only for status chips and filter chips, never for buttons.
- **Sharp 0 px corners** are valid for full‑bleed bands and large editorial sections — embrace the corporate hard edge.

### Cards
A Cecomunica card has: 1 px `--border-subtle` border · `--radius-lg` (10 px) · `--shadow-xs` resting / `--shadow-md` on hover · `--surface-card` background · `--sp-6` padding. No colored accent borders. Optional small icon top‑left in `--brand-soft` with `--brand` glyph.

### Layout rules
- **Container:** `--container-max` 1280 px, `--container-pad` 24 px.
- **Sticky header** at top of marketing pages — 72 px tall, white with bottom `--border-subtle`, backdrop‑blurs over hero.
- **Footer** is dark navy with the brand band along the bottom 4 px.
- **Section headers** use an eyebrow (small caps) + display heading + 1‑sentence intro pattern.
- **Grids** are 12‑column on desktop, 4 on tablet, 1 on mobile.

---

## 5 · Iconography

See [`ICONOGRAPHY`](#iconography-section) below.

### <a id="iconography-section"></a>Approach

Cecomunica's collateral uses **monochrome, line‑style glyphs** at small sizes (phone, envelope, location pin, social media on the business card). They're set in the brand blue or navy on light surfaces, in white on dark surfaces. There is **no** custom icon font in any provided material.

**This system uses [Lucide](https://lucide.dev) icons** (loaded from CDN) as a substitute — chosen because Lucide's stroke weight (`1.5px–2px`), rounded line caps, and minimal/technical character match the existing collateral icons closely.

```html
<!-- Add once per page -->
<script src="https://unpkg.com/lucide@latest"></script>
<script>lucide.createIcons();</script>

<!-- Use anywhere -->
<i data-lucide="radio-tower"></i>
<i data-lucide="shield-check"></i>
<i data-lucide="map-pin"></i>
```

### Recommended icon vocabulary

| Concept                  | Lucide icon          |
|--------------------------|----------------------|
| Radio / two‑way radio    | `radio`              |
| Tower / cell site        | `radio-tower`        |
| Network / coverage       | `signal`, `wifi`     |
| Phone / contact          | `phone`              |
| Email                    | `mail`               |
| Location                 | `map-pin`            |
| Security / encryption    | `shield-check`, `lock` |
| 24/7 support             | `headphones`, `life-buoy` |
| Industrial / port        | `ship`, `truck`, `factory` |
| Spec / data sheet        | `file-text`          |
| Channel / frequency      | `waves`, `activity`  |

### Substitution flag
> **If Cecomunica has an internal icon set, please share it** and we'll replace the Lucide CDN reference. Until then, every icon in this system uses Lucide.

### Emoji & unicode
- **No emoji** in product UI or marketing copy. Ever.
- Unicode glyphs are acceptable only for typographic punctuation (em‑dashes —, middle dots ·, arrows →, multiplication × in spec strings).

### Logos
- **`assets/logo-primary.png`** — full square lockup with the dotted signal field. Use on light backgrounds, ≥120 px tall.
- **`assets/logo-compact.png`** — horizontal banner crop. Use in headers, footers, business cards.
- **Keep clear space** of at least the height of the "C" around the wordmark.
- **On dark backgrounds**, the wordmark "Comunica" needs to be redrawn in white — no provided variant exists. *Substitution flag: please supply a white/inverse logo.*

---

## 6 · UI kits

| Kit | Path | Surfaces covered |
|-----|------|------------------|
| Marketing website | `ui_kits/website/` | Header · Hero (dark) · Product card · Vertical/industry card · CTA band · Footer · Contact form |

Each kit's `index.html` runs as a click‑through demo; component JSX files live alongside.

---

## 7 · Caveats & open questions

- **Fonts are substitutes.** Barlow / IBM Plex Sans / IBM Plex Mono stand in until brand TTFs arrive.
- **No inverse / white logo provided.** Some dark‑surface use cases (header on hero, footer logo) need it.
- **No Figma or codebase was provided** — visual foundations were inferred from the logo, two product banners, and a business card. Iteration on real screens will sharpen this further.
- **No icon set was provided** — Lucide stands in as a substitute matching the line/weight character on the business card.
- **Spanish is the canonical content language.** All sample UI copy is in Spanish.
