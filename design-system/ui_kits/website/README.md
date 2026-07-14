# Cecomunica · Marketing website UI kit

A click-through recreation of how the Cecomunica marketing site should look, built from the brand assets and visual foundations in `../../colors_and_type.css`.

## Files

```
ui_kits/website/
├── README.md
├── index.html                  ← clickable demo (Inicio / Productos / Contacto)
└── components/
    ├── Header.jsx              ← sticky top nav with logo + product menu
    ├── Hero.jsx                ← dark navy hero with product photography
    ├── ProductCard.jsx         ← Hytera radio product card
    ├── VerticalCard.jsx        ← industry/vertical solution card
    ├── CTABand.jsx             ← full-bleed dark CTA band
    ├── Footer.jsx              ← navy footer with brand band
    └── ContactForm.jsx         ← lead-capture form with validation states
```

## Source caveat

> **No production codebase or Figma was provided** for the Cecomunica website. This kit is a **first-principles recreation** built from the brand collateral — the logo, two product banners, and a business card. Component visual treatments are derived from the design tokens.
>
> When the real site code or Figma is available, treat this kit as a starting point and overwrite component-by-component to match what's actually shipped.

## Conventions

- All components are JSX, loaded with Babel for live preview. Real production code would convert these to your stack of choice.
- Copy is in **Spanish** (the brand's canonical language).
- Components compose into the `Demo` shell in `index.html` — that shell mocks routing between three views: Inicio, Productos, Contacto.
- Imagery is pulled from `../../assets/`. Where assets are missing (e.g. inverse logo, individual product cutouts) we use the existing collateral and labeled placeholders.
