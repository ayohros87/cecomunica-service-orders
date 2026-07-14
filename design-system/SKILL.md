---
name: cecomunica-design
description: Use this skill to generate well-branded interfaces and assets for Cecomunica (CeComunica), a Panama-based mission-critical communications integrator (two-way radios, TETRA, Push-to-Talk over Cellular, telecom infrastructure for ports, government, and industry). Use for landing pages, product pages, sales collateral, decks, and prototypes — production or throwaway. Contains the brand color system, type scale, fonts, logos, hero imagery, content/voice rules, and a marketing-website UI kit.
user-invocable: true
---

# Cecomunica Design System — Skill

This skill packages the Cecomunica visual + content system so any agent can produce on-brand artifacts without having to rediscover the rules.

## Start here
1. Read `README.md` — full content fundamentals, visual foundations, iconography rules, caveats.
2. Read `colors_and_type.css` — every color, type, spacing, radius, shadow, and motion token. Import it into any HTML file you produce.
3. Browse `assets/` — logos (primary + compact), hero product banners, business cards. Use these directly; **do not redraw the logo or invent imagery.**
4. Browse `preview/` — small reference cards showing each token group rendered.
5. Browse `ui_kits/website/` — JSX components and `index.html` demo showing the marketing-website pattern.

## When producing artifacts

**Always:**
- `<link rel="stylesheet" href="colors_and_type.css">` (adjust path) and use the `cc-*` utility classes or the CSS custom properties.
- Write Spanish copy by default — this is a Panamanian B2B brand. Use *usted*, sentence case, no emoji, no exclamation marks.
- Use real photographic imagery or copy from `assets/`. If an asset is missing, use a labeled placeholder rather than inventing.
- Use Lucide icons (`<script src="https://unpkg.com/lucide@latest"></script>`) — match the line-style of the collateral.
- Keep motion quiet: 120–200 ms fades, ease-out entrances, no bounces.

**Never:**
- Use emoji in UI or copy.
- Use bluish-purple gradients, colored left-border accent cards, or "playful" rounded everything.
- Title-case Spanish headlines.
- Hand-draw the logo or invent a new wordmark.

## If invoked with no specific task
Ask the user what they want to build. Good clarifying questions:
- What surface? (landing page · product page · pitch deck · sales one-pager · email · ad · prototype)
- What product or vertical? (radios · TETRA · PoC · ports · government · industrial)
- Spanish or English? (default Spanish)
- Static HTML deliverable, or production code?
- How many variations would you like?

Then act as an expert designer for this brand and produce HTML artifacts (or production code, depending on need) that strictly follow the rules in `README.md`.

## Brand snapshot (cheat sheet)

- **Primary blue:** `#0091D7` (`--blue-500`) · **Accent cyan:** `#1FA0E1` · **Hero navy:** `#0A2540`
- **Display font:** Barlow · **Body:** IBM Plex Sans · **Mono:** IBM Plex Mono *(all substitutes — see README)*
- **Tagline:** *Soluciones en Comunicaciones*
- **Voice:** serious, declarative, technical, vendor-grade Spanish for procurement buyers
- **Imagery:** real product photography on dark navy with a subtle dot-grid signal field
