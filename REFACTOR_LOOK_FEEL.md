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

## Phase 6 — Navigation, Container & Spacing Standardization

**Goal:** end the per-page improvisation over navigation, container width, and spacing. Define a small set of canonical patterns and assign every page to one of them. Pages with wide tables, dense dashboards, narrow forms, and standard lists each get a fit-for-purpose container without inventing CSS at the page level.

---

### 6A — Navigation pattern catalog

Today some pages show a back button, some show "Menú principal", some both, some neither. The choice is ad-hoc. Define four modes by page role and assign every page to exactly one.

| Mode | Example pages | Topbar config |
|---|---|---|
| **Module index** | `ordenes/index.html`, `contratos/index.html`, `cotizaciones/index.html`, `POC/index.html` | `showHome: true`, `showLogout: true`, optional primary `actions: [{ Nuevo X }]`. **No back**. |
| **Detail / Edit** | `editar-orden.html`, `editar-cotizacion.html`, `editar-contrato.html`, `nueva-orden.html` | `back: { 'Volver', href: 'index.html' }`, `showLogout: true`, `showHome: false`. Back is the user's primary exit. |
| **Workflow child** | `cotizar-orden.html`, `firmar-entrega.html`, `fotos-taller.html`, `agregar-equipo.html` | `back: { 'Volver a la orden', href: 'trabajar-orden.html?id=X' }`, `showLogout: true`. Back returns to the parent task, not the module index. |
| **Print / utility** | `imprimir-orden.html`, `nota-entrega.html`, `vista-correo.html`, `cotizar-orden-formal.html` | No `Layout.renderTopbar`. Standalone right-aligned toolbar with `[Imprimir]` + `[Cerrar]`. Opens in new tab. |

**Implementation:**
- Add `Layout.renderTopbarFor(mode, options)` shortcut in `layout.js` — `mode` is one of `'index' / 'edit' / 'child' / 'print'`
- Audit every page; assign each to exactly one mode; commit the audit table to a comment in `layout.js`
- Console-warn at runtime when `back` + `showHome: true` is combined outside `'child'` mode (catches drift)

### 6B — Breadcrumbs for depth ≥ 2

Pages two or more clicks from the home screen get a breadcrumb strip below the topbar:

```
Inicio  ›  Órdenes  ›  ORD-2026-0042  ›  Cotizar
```

- Render via `Layout.renderBreadcrumb([{ label, href }, ...])` into `<div id="breadcrumb-mount">`
- Pages that need it: `cotizar-orden.html`, `firmar-entrega.html`, `fotos-taller.html`, `agregar-equipo.html`, `editar-orden.html`, `nota-entrega.html`, `imprimir-orden.html`
- Optional: defer to Phase 6.2 if mode-B/C back buttons cover the navigation need adequately

### 6C — Container width tiers (content-density aware)

Pages currently override `.app-wrap` width inline (1100 / 1280 / `none`) with no rationale. Replace with four explicit tiers, chosen by class. **No inline `max-width` allowed**.

```css
.app-wrap          { width: 100%; margin: 0 auto; padding: 16px 24px 48px; box-sizing: border-box; }
.app-wrap--narrow  { max-width:  720px; }  /* single-column reading flow      */
.app-wrap--default { max-width: 1100px; }  /* most forms, lists ≤ 7 columns   */
.app-wrap--wide    { max-width: 1400px; }  /* dense tables, 8+ columns        */
.app-wrap--full    { max-width: 100%; padding: 16px 16px 48px; } /* full-bleed admin/dashboard */
```

**Assignment guide:**

| Tier | Use for | Examples |
|---|---|---|
| `--narrow` | One column, vertical reading flow | `firmar-entrega.html`, `vista-correo.html`, login, simple confirmations |
| `--default` | Standard index pages, all edit/detail forms | `contratos/index.html`, `cotizaciones/index.html`, `editar-orden.html`, `nueva-cotizacion.html` |
| `--wide` | Many-column lists with horizontal density | `POC/index.html`, `ordenes/index.html`, `inventario/modelos.html` |
| `--full` | Full-bleed admin / monitoring views | `progreso-tecnicos.html`, `inventario/index.html`, `admin-equipos-cliente.html` |

The tier is a declaration of intent — adding a column to a `--default` list eventually triggers a tier bump rather than a one-off inline override.

### 6D — Spacing roles (assign existing tokens)

`ceco-ui.css` defines `--sp-1` through `--sp-10` but doesn't say where each one belongs. Pages improvise margins. Assign roles:

| Role | Token | px | Applied via |
|---|---|---|---|
| Between major page sections | `--sp-8` | 32 | `.section` margin-bottom |
| Card internal padding | `--sp-5` | 20 | `.card` padding |
| Form-row vertical gap | `--sp-4` | 16 | `.row` margin-bottom |
| Inline button/chip group gap | `--sp-3` | 12 | `.actions-group { gap }` |
| Compact (table cells, chips) | `--sp-2` | 8 | `.table-wrap td`, `.chip` |

Add a `.section` wrapper class so pages declare structure, not numbers:

```css
.section        { margin-bottom: var(--sp-8); }
.section--lead  { margin-bottom: var(--sp-10); }  /* hero / first block         */
.section--tight { margin-bottom: var(--sp-5); }   /* dense groups of related UI */
```

Forbid raw `margin-bottom: 24px` / `32px` / `40px` in page CSS — use the class.

### 6E — Responsive table strategy (varying column counts)

Tables range from 2 columns (signature pages) to 10+ (POC index). One CSS rule can't serve all. Layer stackable modifiers on `.table-wrap`:

```css
.table-wrap          { overflow-x: auto; }                /* default: horizontal scroll */
.table-wrap--sticky  { /* sticky thead for tall lists */ }
.table-wrap--compact { /* tighter cell padding via --sp-2 */ }
.table-wrap--cards   { /* below 760px, render rows as cards */ }
```

**Per-page assignment:**

| Page | Modifiers | Reason |
|---|---|---|
| `POC/index.html` | `--sticky` | 10+ cols, long list, scrollable |
| `ordenes/index.html` | `--sticky` | Long list, frequent scrolling |
| `contratos/index.html`, `cotizaciones/index.html` | default | Moderate density |
| `inventario/modelos.html`, `inventario/piezas.html` | `--compact` | Many rows of short data |
| Mobile views (future) | `--cards` | Optional — defer until mobile traffic justifies the work |

### 6F — Breakpoint harmonization

Pages currently break at 760px, 900px, or never. Standardize globally in `ceco-ui.css`:

- `@media (max-width: 760px)` — single-column form fallback, collapse secondary actions into an overflow menu, switch `.table-wrap--cards` rows to card mode
- `@media (max-width: 1024px)` — tablet: reduce horizontal padding, drop low-priority table columns marked with `.col-optional`

Delete per-page `@media` overrides except for one-off needs (e.g. `firmar-entrega.html` signature pad).

---

### Execution order for Phase 6

1. **Audit + assignment table** — for every page record (a) navigation mode, (b) container tier, (c) responsive table needs. Output as a markdown table in the PR description.
2. **Add CSS classes** to `ceco-ui.css` (`.app-wrap--*`, `.section--*`, `.table-wrap--*`) — purely additive, zero risk.
3. **Apply container tier class** to each page in one PR per directory; delete inline width overrides as you go.
4. **Refactor `layout.js`** to add `renderTopbarFor(mode)` and (optional) `renderBreadcrumb()`.
5. **Migrate pages to navigation modes** in directory PRs (cotizaciones first — smallest blast radius, then contratos, ordenes, POC, inventario).
6. **Apply `.section` and table modifier classes** in the same pass.
7. **Mobile breakpoint cleanup** as the final PR — remove redundant page-level `@media` rules.

**Risk:** medium. Container width changes are visually obvious but trivially reversible. Navigation changes touch users' mental model — coordinate with whoever writes release notes.

**Payoff:** any future content type (a 12-column report, a 1-column wizard) has a pre-decided home. Adding a page becomes "pick a navigation mode + a container tier" instead of inventing CSS.

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
Phase 1  →  Phase 2  →  Phase 3  →  Phase 4  →  Phase 5  →  Phase 6      →  Phase 7
tokens       topbar       fonts       dialogs     icons        nav+layout      print
```

Phase 1 is the prerequisite — without it, every subsequent phase fights uphill against page-level overrides.
Phase 2 delivers the biggest visible consistency gain for the lowest risk.
Phase 6 depends on Phase 2 (`layout.js` exists) but can otherwise run independently — its CSS additions (6C–6F) are fully additive and could land alongside Phase 5.

One PR per directory per phase. Each commit shippable on its own.
