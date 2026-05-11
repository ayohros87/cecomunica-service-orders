# Refactor: Look & Feel Standardization

Objective: make `ceco-ui.css` the single source of truth and apply the Cecomunica Design System tokens consistently across all 42 HTML pages.

## Current state audit

| Issue | Scope |
|---|---|
| Inline `<style>` blocks redeclaring global rules | 42 of 42 pages |
| Hardcoded generic blue (`#3b82f6`, `#2563eb`, etc.) bypassing tokens | 14 files |
| Off-spec border-radius (12 / 16 / 20 px) in page-level CSS | 23 files |
| Topbar copy-pasted with subtle variations | 13 pages |
| Emoji as icon system (in HTML and in JS `textContent`) | all pages |
| Container max-width varies (1100 / 1280 / none) | multiple pages |
| Barlow and IBM Plex Sans imported but not applied | all pages |

---

## Phase 1 — Token enforcement

**Goal:** make the design tokens authoritative. Every page-level override that contradicts a global token gets replaced or deleted.

**What changes:**
- Replace all hardcoded color values with CSS variables:
  - `#3b82f6 / #2563eb / #1d4ed8` → `var(--brand) / var(--brand-hover) / var(--brand-2)`
  - `#1e3a8a` → `var(--navy)`
  - `#0f172a` → `var(--text)`
  - `#64748b` → `var(--muted)`
  - `#e2e8f0` → `var(--line)`
- Correct off-spec radii in inline styles:
  - Buttons / inputs: → `6px`
  - Cards / table-wrap: → `10px`
  - Modals / hero panels: → `16px`
- Delete inline `<style>` blocks that only redeclare rules already in `ceco-ui.css` (`.topbar`, `.btn`, `.card`, `.table-wrap`, etc.)
- Fold any page-unique rules that are genuinely needed into `ceco-ui.css` or a page-specific CSS file

**Execution order:** one PR per directory — `cotizaciones/`, `contratos/`, `ordenes/`, `inventario/`, `clientes/`, `POC/`, root pages.

**Risk:** cosmetic only. No layout or functional change.

---

## Phase 2 — Shared layout components

**Goal:** stop copy-pasting the topbar across 13 pages. A single change to the topbar should propagate everywhere.

**What changes:**
- Create `public/js/core/layout.js` exporting `Layout.renderTopbar({ title, actions, showHome })`
  - Injects standard topbar HTML into `<div id="topbar-mount">`
  - Accepts: page title string, optional right-side action buttons, optional "back to home" link
- Replace every hand-written `<div class="topbar">…</div>` block with a mount div + `Layout.renderTopbar()` call
- Add to `ceco-ui.css`: canonical `.topbar` rule (position sticky, height, brand bottom border) — remove duplicates from pages
- Apply same pattern to:
  - Empty-state (`No hay elementos para mostrar`)
  - Skeleton-row loader
  - "Cargar más" pagination footer

**Execution order:** high-traffic pages first — `ordenes/index.html`, `contratos/index.html`, `cotizaciones/index.html`, then remaining.

**Risk:** low — one page at a time, each migration is independent.

**Payoff:** future header redesign (logo, nav, user menu) becomes a one-file change.

---

## Phase 3 — Typography hierarchy

**Goal:** use the fonts that were imported in Phase 0 but no page is applying yet.

**What changes:**
- Apply `font-family: var(--font-display)` (Barlow 700) to:
  - Topbar `h1`
  - Section headers
  - Modal / sheet titles
  - App-card `.t` labels on the home screen
- Apply `font-family: var(--font-mono)` (IBM Plex Mono) to:
  - SKUs, order IDs, contract IDs (e.g. `COT-20240515-001`)
  - Money values rendered in tables
  - Technical spec strings (frequencies, model numbers)
- Add `cc-*` utility classes to `ceco-ui.css` matching design system names (`cc-h1`, `cc-h2`, `cc-body`, `cc-eyebrow`, `cc-mono`) — referenced in components going forward
- Add eyebrow treatment (`text-transform: uppercase; letter-spacing: 0.14em`) to section sub-labels

**Risk:** minimal — purely additive.

---

## Phase 4 — Shared dialog / toast / modal primitives

**Goal:** eliminate `confirm()` / `alert()` calls and inconsistent modal markup.

**What changes:**
- Audit and count all `confirm(...)` and `alert(...)` calls across the codebase
- Route them through the existing `core/modal.js` and `core/toast.js` (built in Phase 5c)
- Standardize the "danger confirm" pattern (anular, eliminar, archivar) into one reusable component: `Modal.confirm({ message, danger: true, onConfirm })`
- Ensure all overlay/modal markup uses the canonical `.overlay > .modal` structure from `ceco-ui.css`

**Risk:** medium — changes async flow control. Execute per-page with manual testing of each confirm path.

---

## Phase 5 — Iconography migration

**Goal:** replace emoji with Lucide icons, per the design system iconography spec. No emoji in UI.

**Setup:**
```html
<!-- Add once, in a future shared <head> partial -->
<script src="https://unpkg.com/lucide@latest"></script>
```
Call `lucide.createIcons()` after any dynamic render that adds icon elements.

**Mapping (standard vocabulary):**

| Emoji | Lucide icon | Usage |
|---|---|---|
| ✏️ | `pencil` | Editar |
| 🗑️ | `trash-2` | Eliminar |
| 🖨️ | `printer` | Imprimir |
| ➕ | `plus` | Nuevo / Agregar |
| 🔍 | `search` | Buscar / Filtrar |
| ⬇️ | `chevron-down` | Cargar más |
| 🏠 | `home` | Menú principal |
| 🚪 | `log-out` | Salir |
| 🔧 | `wrench` | Servicio / Técnico |
| 🧩 | `puzzle` | Pieza |
| 🧾 | `copy` | Duplicar |
| ⛔ | `ban` | Anular |
| 📎 | `paperclip` | Adjunto |
| 💾 | `save` | Guardar |
| 📡 | `radio-tower` | PoC / Radio |
| 🛠️ | `settings-2` | Órdenes de Servicio |

**Notes:**
- Buttons in JS (`btnEditar.textContent = "✏️ Editar"`) must switch to `innerHTML = '<i data-lucide="pencil"></i> Editar'`
- After dynamic renders, call `lucide.createIcons()` (or scope it with `lucide.createIcons({ nodes: [element] })`)
- Status dots (`🟢`, `🟡`, `🔴`) → use `<span class="dot green">` etc. (already defined in `ceco-ui.css`)

**Execution order:** highest-traffic pages first. This phase is the most time-intensive — budget 1–2 hours per major section.

**Risk:** low visually. Test that icon render calls happen after DOM insertion.

---

## Phase 6 — Layout / container harmonization

**Goal:** pages stop fighting over container width and spacing rhythm.

**What changes:**
- Canonical rule in `ceco-ui.css`:
  ```css
  .app-wrap { max-width: 1280px; margin: 0 auto; padding: 0 24px 48px; box-sizing: border-box; }
  ```
- Remove per-page overrides of `.app-wrap` (currently varies: 1100 / 1280 / none)
- Standardize section spacing: `margin-bottom: 32px` (sp-8) between major page sections
- Harmonize mobile breakpoint to `760px` across all pages (a few outliers use `900px`)
- Add `.page-header` pattern: eyebrow + title + optional subtitle, consistent across all list/index pages

---

## Phase 7 — Print pages

**Goal:** make `imprimir-*` pages consistent and properly branded.

**Pages:**
- `ordenes/imprimir-orden.html`
- `cotizaciones/imprimir-cotizacion.html`
- `contratos/imprimir-contrato.html`

**What changes:**
- Extract a shared `public/css/print-base.css` with: page margins, header/footer layout, brand band (navy + signal blue gradient), font import
- Apply Barlow to document headings, IBM Plex Mono to all technical identifiers and amounts
- Use real logo asset (`assets/logo-compact.png`) in the print header instead of text
- Ensure `@media print` hides all interactive controls

**Risk:** low — print-only pages are not part of the main UX flow.

---

## Recommended execution order

```
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5  →  Phase 6  →  Phase 7
tokens       topbar       fonts       dialogs     icons        layout      print
```

Phase 1 is the prerequisite — without it, every subsequent phase fights uphill against page-level overrides.
Phase 2 delivers the biggest visible consistency gain for the lowest risk.
Phases 5 and 6 can run in parallel once Phase 2 is complete.

One PR per directory per phase. Each commit shippable on its own.
