# App UI Kit — Mobile (CeComunica)

Touch-first surface kit for the **service-orders / repair workflow** app on
phones (≤ 480px). Companion to `ui_kits/app/` (desktop) and `ui_kits/website/`
(marketing). **Starts with the Órdenes de Servicio screens.**

Built on `../../colors_and_type.css` (tokens) and `../app/app.css` (shared
components — buttons, chips, forms, modals, toasts). This kit only adds the
**mobile shell + touch patterns** on top.

---

## Structure

```
ui_kits/app-mobile/
├── index.html   ← phone-frame demo (2 full screens + component gallery)
├── mobile.css   ← mobile shell styles (.m-* namespace)
└── README.md    ← this file
```

---

## Usage

```html
<link rel="stylesheet" href="../../colors_and_type.css">
<link rel="stylesheet" href="../app/app.css">   <!-- btn, chip-estado, forms, modal -->
<link rel="stylesheet" href="mobile.css">
```

The demo wraps each screen in a `.m-frame` (a phone bezel) so it is viewable on
a desktop monitor. **`.m-frame*` is demo chrome only** — in the real app the
screen fills the device viewport. Below 480px the frame collapses to full-bleed
and fixed chrome (`.m-bottomnav`, `.m-fab`, `.m-actionbar`, sheets) anchors to
the viewport.

```html
<lucide>  <!-- same CDN as the other kits -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
<script>lucide.createIcons();</script>
```

---

## Touch rules baked in

| Rule | How |
|------|-----|
| ≥ 44×44px hit targets | `--m-tap: 44px` applied to every interactive control |
| No iOS input auto-zoom | text inputs use 16px font |
| iOS safe areas | `env(safe-area-inset-bottom)` on bottom nav / FAB / sheet / action bar |
| Edge-to-edge scroll lists | `.m-chiprow` scrolls horizontally, scrollbar hidden |

---

## Components included

| Component | Section in demo | Key classes |
|-----------|-----------------|-------------|
| **Phone frame** (demo only) | — | `.m-frame`, `.m-screen`, `.m-content` |
| **Top app bar + search** | `#appbar` | `.m-appbar`, `.m-appbar-title`, `.m-appbar-btn`, `.m-appbar-back`, `.m-appbar-search` |
| **Estado filter bar** — the single state filter | `#filterbar` | `.m-filterbar`, `.m-chiprow`, `.m-chip`, `.m-chip-count` |
| **Order card** — primary list item | `#order-card` | `.m-order-card` (+ `__top/__client/__meta/__date/__actions`, `.m-cta`, `.m-more`) |
| **Intervención progress** — n/m per order | `#order-card` | `.m-work`, `.m-work--progress`, `.m-work--done` |
| **Equipo card** — per-equipo row | `#pantalla-equipos` | `.m-equipo` (+ `--ok/--pending/--na`, `__head/__serial/__model/__status/__work/__actions`) |
| **Intervención editor** — per-equipo form | `#pantalla-equipos` | `.m-sheet` + `.form-textarea` + `.form-check` |
| **FAB** — nueva orden | `#nav` | `.m-fab`, `.m-fab--round` |
| **Bottom nav** — 3 destinations | `#nav` | `.m-bottomnav`, `.m-bottomnav__item`, `--primary` |
| **Bottom sheet** — filters / actions | `#sheet` | `.m-sheet`, `.m-sheet-backdrop`, `__handle/__head/__body/__footer` |
| **Action menu** — card `···` overflow | `#sheet` | `.m-menu`, `.m-menu-item`, `.m-menu-divider` |
| **Segmented control** | `#segment` | `.m-segment`, `.m-segment__btn` |
| **Sticky action bar** — detail CTA | `#segment` | `.m-actionbar` |
| **Empty / skeleton** | `#states` | `.m-empty`, `.m-order-card.is-skeleton` |

---

## Order state → chip map (production-accurate)

The mobile kit uses the **real four states** of the service-orders app
(`estado_reparacion`), mapped to the shared `.chip-estado` classes from
`app.css` exactly as `getEstadoClass()` does in production:

| Estado (`estado_reparacion`) | Chip class | Accent rail color |
|------------------------------|------------|-------------------|
| `POR ASIGNAR` | `.chip-estado.chip-recibida` | `#EF4444` (red) |
| `ASIGNADO` | `.chip-estado.chip-reparacion` | `#F59E0B` (amber) |
| `COMPLETADO (EN OFICINA)` | `.chip-estado.chip-lista` | `var(--accent)` (cyan) |
| `ENTREGADO AL CLIENTE` | `.chip-estado.chip-entregada` | `#22C55E` (green) |

Set the full state string on `data-estado` on `.m-order-card` to drive the left
accent rail automatically.

---

## Technician actions — the two card buttons (`Intervención` + `Flujo`)

On mobile the people using the app are mostly **technicians**, and their two main
jobs are **logging the repair work** and **advancing the order**. So the order
card surfaces exactly those two as the primary buttons; everything else goes to
the `···` overflow sheet.

**Interventions are per equipo.** An order holds several equipos (radios), and the
technician records an intervención on *each* one. So the card does **not** carry a
single "Intervención" button — instead **Equipos** opens the equipos sheet, and
the intervención is logged per equipo from there.

| Card button | What it does | Production |
|-------------|--------------|------------|
| **Equipos** (`.m-cta`) | Open the equipos sheet → log intervención per equipo | `abrir-equipos-mobile` → `#modalEquiposMobile` |
| **Flujo** (`.m-cta`) | Advance state: Asignar → Completar → Entregar | `botonesFlujo` |
| **`···`** (`.m-more`) | Fotos, notas técnicas, imprimir, nota de entrega, editar, eliminar | `botonesGestion` menu |

### Inside the equipos sheet
Each `.m-equipo` row shows serial + modelo, its own intervención state, and an
**Intervención** button that opens the per-equipo editor (textarea + "no
disponible"). Mirrors `ordenes-equipos.js` / `#modalTrabajoEquipo`.

| Equipo state | Class | Status / button |
|--------------|-------|-----------------|
| Intervención hecha (`trabajo_tecnico`) | `.m-equipo--ok` | ✓ Hecha · "Ver intervención" |
| Pendiente | `.m-equipo--pending` | Pendiente · "Intervención" (primary) |
| No disponible (`intervencion_no_disponible`) | `.m-equipo--na` | No disponible + motivo |

The card's **intervención progress** (`.m-work` "Intervenciones n/m") aggregates how
many equipos are done — grey 0/m, amber partial, green m/m. The button pair adapts
to state: `POR ASIGNAR` shows only **Asignar**; `ASIGNADO`/`COMPLETADO` show
**Equipos** + the flujo step; terminal `ENTREGADO` shows **Equipos** + `···`.

---

## Mapping to the live app (`public/`)

The live `ordenes/index.html` already ships hand-rolled mobile markup. This kit
is the cleaned-up reference for it; the equivalences are:

| Kit class (`.m-*`) | Production class (`public/`) |
|--------------------|------------------------------|
| `.m-appbar` / `.m-appbar-title` | `#mobileHeader` / `.mh-top` / `.mh-title` |
| `.m-appbar-search` | `#filtroRapido` (`.input-compact`) — relocated into the app bar |
| `.m-filterbar` / `.m-chiprow` / `.m-chip` | `.estado-chips-bar` / `.mchip` |
| `.m-order-card` (+ tiers) | `.card-contrato` (+ `__tier1/__heading/__id/__cliente/__tier2/__tier3`) |
| `.m-equipo` (+ states) | `.equipo-card` (`ordenes-equipos.js`, `#modalEquiposMobile`) |
| Intervención editor (`.m-sheet`) | `#modalTrabajoEquipo` (textarea + `intervencion_no_disponible`) |
| `.m-bottomnav` / `.m-bottomnav__item` | `#mobileBottomNav` / `.mnav-item` / `.mnav-primary` |
| `.m-sheet` / `.m-sheet-backdrop` | `.mdrawer` / `.mbackdrop` |

Migrating the live page onto this kit is optional and out of scope here — the
kit stands as the design reference first.

> **Design note (v2).** The first draft had *two* estado filters (a big count
> cluster **and** a chip row) plus a permanent full-width search row. That was
> redundant and ate vertical space. The kit now uses **one** estado filter — the
> sticky chip row, which carries the counts — and moves search into an
> expanding app-bar field. The bottom sheet is reserved for *advanced* filters
> only (tipo, técnico, mis órdenes, orden), so no control is duplicated.
>
> **Design note (v3).** Card hierarchy is client-first: client is the anchor and
> the estado chip aligns to it; `#orden · tipo · técnico` drop to one muted line.
>
> **Design note (v4).** Card actions reflect what technicians actually do on
> mobile — the two primary buttons are the day-to-day work + the flujo step;
> secondary actions move to the `···` sheet.
>
> **Design note (v5).** Interventions are **per equipo**, not per order. So the
> card's primary action is **Equipos** (the gateway), the intervención is logged
> per equipo inside the equipos sheet, and the card shows aggregate progress
> ("Intervenciones n/m") instead of a single state.
>
> **Design note (v6).** The card date is **Inicio** (`fecha_creacion`), not the
> delivery date: the delivery date isn't known until the tech delivers the
> equipment, and by then they no longer open the order — so it was never useful
> on the list. The start date is known from creation and helps prioritise.

---

## Planned next screens (next iteration)

- [x] **Equipos + intervención (por equipo)** — equipos sheet + per-equipo editor ✓ (`#pantalla-equipos`)
- [ ] **Detalle de orden** — app bar (back) + tabs (Equipo, Cliente, Intervenciones, Fotos) + sticky action bar
- [ ] **Nueva orden** — step-by-step mobile form (combobox cliente, tipo de servicio)
- [ ] **Fotos taller** — mobile photo grid + camera capture tile
- [ ] **Firmar entrega** — full-width signature pad
