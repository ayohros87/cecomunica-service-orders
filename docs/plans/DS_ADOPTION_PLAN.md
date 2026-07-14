# Design System Adoption Plan — cecomunica-service-orders

> **Scope:** Fully align `public/css/ceco-ui.css` and the HTML pages with the canonical
> **Cecomunica Design System** defined in `design-system/colors_and_type.css`
> and the App UI Kit in `design-system/ui_kits/app/`.
>
> **Current state:** Token bridge partially shipped (colors, fonts, spacing, shadows,
> focus rings). Class naming and component patterns diverge from the DS App UI Kit.
> Pages have organic topbar/shell HTML that pre-dates the kit's `.app-topbar` pattern.
>
> **Related docs:** `CSS_IMPROVEMENTS.md` (stylesheet debt), `OUTSTANDING.md` (full roadmap),
> `CHANGELOG.md` (shipped work).

---

## Gap summary

| Concern | `ceco-ui.css` today | DS App UI Kit target |
|---|---|---|
| Surface tokens | `--bg`, `--bg-page`, `--card` | `--surface-page`, `--surface-card`, `--surface-sunken` |
| Type scale | No `--fs-*`, `--lh-*`, `--tr-*` tokens | Full scale from `colors_and_type.css` |
| Button variants | `.btn.primary`, `.btn.ghost`, `.btn.danger` | `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.btn-accent` |
| Status chips | Generic `.chip`, `.badge` | `.chip-estado`, `.chip-prioridad` with 9 order states |
| App shell | Ad-hoc topbar HTML per page | `.app-topbar`, `.app-body`, `.app-page-header` |
| Data table | `.table-wrap`, `table` | `.app-table-wrap`, `table.app-table`, `.filter-bar`, `.app-table-footer` |
| Forms | `.form-field` + inline selectors | `.form-input`, `.form-select`, `.form-textarea`, `.form-file-zone` |
| Modal | `#overlay` / `.overlay` + `.modal` | `.modal-backdrop` + `.modal` |
| Toasts | `.toast` (partial) | `.toast-region`, `.toast` with 4 variants |
| Empty / loading | Ad-hoc empty states | `.app-empty-state`, `.skeleton` |
| Planned kit items | — | Tabs, stepper, photo grid, signature pad |

---

## Strategy

**Additive shim approach** — the DS App UI Kit classes are added alongside the existing
ones. Existing pages keep working while new-kit classes are back-filled page by page.
Once all pages use the new names, the old aliases are removed.

This avoids a big-bang rewrite and lets each phase ship independently with no regressions.

---

## Phases

### Phase 1 — Complete the token bridge in `ceco-ui.css` · ~1 hour

**Goal:** eliminate all remaining flat hex values and add the missing semantic token layer.

`ceco-ui.css` already has `--fg-*`, `--border-*`, `--sp-*`, `--radius-*`, `--shadow-*`,
`--accent`, `--navy`. What is missing:

**1a. Surface tokens** — add DS semantic surface layer:
```css
/* In :root */
--surface-page:    var(--bg-page);   /* #F7F9FB — already exists as alias */
--surface-card:    var(--card);      /* #ffffff */
--surface-sunken:  #EEF2F6;         /* --gray-100 */
--surface-inverse: #061829;         /* --navy-900 */
--surface-inverse-2: var(--navy);   /* --navy-800 */
```

**1b. Type scale tokens** — copy from `colors_and_type.css` (pixel-based, matching the DS file exactly):
```css
--fs-display-xl: 72px;  --lh-display-xl: 1.05;  --tr-display-xl: -0.02em;
--fs-display-l:  56px;  --lh-display-l:  1.08;  --tr-display-l:  -0.02em;
--fs-display-m:  44px;  --lh-display-m:  1.12;  --tr-display-m:  -0.015em;
--fs-h1:         36px;  --lh-h1:         1.18;  --tr-h1:         -0.01em;
--fs-h2:         28px;  --lh-h2:         1.22;  --tr-h2:         -0.005em;
--fs-h3:         22px;  --lh-h3:         1.30;  --tr-h3:          0;
--fs-h4:         18px;  --lh-h4:         1.35;  --tr-h4:          0;
--fs-body-l:     17px;  --lh-body-l:     1.55;
--fs-body:       15px;  --lh-body:       1.55;
--fs-body-s:     13px;  --lh-body-s:     1.50;
--fs-caption:    12px;  --lh-caption:    1.40;
--fs-eyebrow:    12px;  --lh-eyebrow:    1.30;  --tr-eyebrow:    0.14em;
--fs-label:      12px;
--fs-mono:       13px;  --lh-mono:       1.50;
```

**1c. Harden hardcoded breakpoints** — `CSS_IMPROVEMENTS.md §1.3` noted 760 px vs 768 px.
Goal: normalize all responsive breakpoints to `768px`. Note that a `--bp-mobile` token does
not actually help here since CSS custom properties cannot be referenced inside `@media`
queries — the practical fix is direct replacement of `760px` → `768px` in all 6 occurrences.

**Affected file:** `public/css/ceco-ui.css` only.

---

### Phase 2 — Button class migration · ~2 hours

**Goal:** add DS modifier-class aliases alongside existing compound selectors, then
migrate all pages to use the new names.

The DS App UI Kit uses `btn-primary` (BEM-style) instead of `btn primary` (compound).

**2a. Add aliases in `ceco-ui.css`** (additive, backward-compatible):
```css
/* Aliases — add alongside existing rules */
.btn-primary  { /* same rules as .btn.primary  */ }
.btn-secondary{ /* same rules as .btn.secondary */ }
.btn-ghost    { /* same rules as .btn.ghost     */ }
.btn-danger   { /* same rules as .btn.danger    */ }
.btn-accent   { background: var(--accent); color: var(--fg-on-brand); /* new variant */ }
.btn-sm       { padding: var(--sp-1) var(--sp-3); font-size: var(--fs-body-s); }
.btn-lg       { padding: var(--sp-3) var(--sp-6); font-size: 1rem; }
```

**2b. Global find-and-replace across `public/`:**

| Old | New |
|---|---|
| `class="btn primary"` | `class="btn btn-primary"` |
| `class="btn secondary"` | `class="btn btn-secondary"` |
| `class="btn ghost"` | `class="btn btn-ghost"` |
| `class="btn danger"` | `class="btn btn-danger"` |
| `class="btn ok"` | `class="btn btn-accent"` |

Scope: all `.html` files under `public/`. Estimated ~80–120 occurrences.

**2c. Deprecation** — once all pages are migrated, remove the old compound selectors
(`.btn.primary`, `.btn.ghost`, etc.) from `ceco-ui.css`.

**Affected files:** `public/css/ceco-ui.css` + all `.html` files.

---

### Phase 3 — Status chip system · ~1.5 hours

**Goal:** replace generic `.chip` / `.badge` with the DS order-state chip system.

The DS App UI Kit defines a full `.chip-estado` + `.chip-prioridad` system with 9 order states:
`chip-recibida`, `chip-diagnostico`, `chip-cotizada`, `chip-aprobada`, `chip-reparacion`,
`chip-lista`, `chip-entregada`, `chip-cancelada`, `chip-espera`.

**3a. Add the chip system to `ceco-ui.css`** from `ui_kits/app/app.css`:
```css
.chip-estado { display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: var(--radius-pill); font-size: var(--fs-label);
  font-weight: 600; line-height: 1.4; }
/* Per-state color rules (copy from app.css) */
.chip-recibida   { background: var(--surface-sunken); color: var(--fg-2); }
.chip-diagnostico{ background: #FDF4E1; color: #92400E; }
.chip-cotizada   { background: var(--accent-soft); color: var(--navy); }
/* … etc. — copy full set from ui_kits/app/app.css */
```

**3b. Migrate pages** — find all `<span class="badge ...">` and `<span class="chip ...">` in
order-facing pages (`ordenes/`, `contratos/`) and replace with `.chip-estado.chip-{state}`.

**3c. Retire** — remove `.badge` + generic `.chip` color hacks from `ceco-ui.css` after migration.

**Affected files:** `public/css/ceco-ui.css` + `ordenes/*.html` + `contratos/*.html`.

---

### Phase 4 — App shell standardization · ~2 hours

**Goal:** align all page topbars and layout wrappers with `.app-topbar`, `.app-body`,
`.app-page-header` from the DS App UI Kit.

The layout module (`public/js/core/layout.js`) already injects the topbar via
`Layout.renderTopbar()` into 24 pages. The injected HTML should use kit class names.

**4a. Update `layout.js` `renderTopbar()` output:**
- Wrapper: `<header class="app-topbar">` (currently ad-hoc)
- Logo section: `<a class="app-topbar-logo" href="/">…</a>`
- Spacer: `<span class="app-topbar-spacer"></span>`
- Actions: `<div class="app-topbar-actions">…</div>`

**4b. Update `ceco-ui.css`** — add `.app-topbar` rules from `ui_kits/app/app.css` (56 px sticky,
2px brand-color bottom border, shadow-sm, flex layout). Keep existing legacy topbar classes
as no-op aliases until confirmed unused.

**4c. Page body wrappers** — the main content container on each page should become
`<main class="app-body">`. Estimate: 30+ pages, best done with a find-and-replace pass
on common patterns like `<div class="main-content">` or `<div class="container">`.

**4d. Page headers** — pages that have a title + action-button row should use:
```html
<div class="app-page-header">
  <div>
    <h1>Órdenes de Servicio</h1>
    <p>Gestión de reparaciones y mantenimiento.</p>
  </div>
  <div class="app-page-header-actions">
    <button class="btn btn-primary">…</button>
  </div>
</div>
```

**Affected files:** `public/js/core/layout.js` + all `.html` pages.

---

### Phase 5 — Data table and filter bar · ~2 hours

**Goal:** align table markup with the DS `.app-table-wrap` / `.app-table` / `.filter-bar` pattern.

**5a. Add to `ceco-ui.css`:**
```css
.app-table-wrap { background: var(--surface-card); border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg); overflow: auto; box-shadow: var(--shadow); }
.app-table { width: 100%; border-collapse: collapse; }
.app-table th, .app-table td { padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border-subtle); text-align: left; }
.app-table thead th { position: sticky; top: 0; background: var(--surface-sunken);
  font-size: var(--fs-label); font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--fg-3); z-index: 1; }
.app-table tbody tr:hover { background: var(--brand-soft); }
.filter-bar { display: flex; gap: var(--sp-3); align-items: center;
  padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border-subtle); flex-wrap: wrap; }
.app-table-footer { display: flex; justify-content: space-between; align-items: center;
  padding: var(--sp-3) var(--sp-4); border-top: 1px solid var(--border-subtle); }
```

**5b. Migrate `ordenes/index.html`** and other list pages (contratos, inventario, POC, clientes,
cotizaciones) to use `.app-table-wrap` + `table.app-table`. The existing `.table-wrap` alias
remains during transition.

**5c. Also resolves:** the sticky `thead top: 128px` magic constant from `CSS_IMPROVEMENTS.md §1.1`
— the new structure puts `filter-bar` outside the scroll container so `thead` can use `top: 0`.

**Affected files:** `public/css/ceco-ui.css` + index pages for each section.

---

### Phase 6 — Form kit alignment · ~1.5 hours

**Goal:** bring form inputs and selects in line with DS `.form-input`, `.form-select`,
`.form-textarea`, `.form-file-zone` classes.

`ceco-ui.css` already has `.form-field` with correct focus/error states. Additions needed:

**6a. Explicit element classes** — the kit uses per-element classes for specificity control:
```css
.form-input   { /* rules already on .form-field input  — extract */ }
.form-select  { /* rules already on .form-field select — extract */ }
.form-textarea{ /* rules already on .form-field textarea — extract */ }
.form-file-zone { /* drag-drop upload zone — new */ }
```

**6b. Form section wrapper** from the kit:
```css
.form-section { padding: var(--sp-4) 0; border-top: 1px solid var(--border-subtle); }
.form-section-title { font-family: var(--font-display); font-weight: 600;
  font-size: var(--fs-body-s); color: var(--fg-3); text-transform: uppercase;
  letter-spacing: 0.06em; margin-bottom: var(--sp-3); }
```

**6c. Migrate form pages** — `nueva-orden.html`, `editar-orden.html`, `nuevo-contrato.html`,
`nueva-cotizacion.html`, `editar-cotizacion.html`, `nuevo-equipo.html` etc.

**Affected files:** `public/css/ceco-ui.css` + form pages.

---

### Phase 7 — Modal and toast normalization · ~1 hour

**Goal:** replace `#overlay` / `.overlay` IDs and ad-hoc modal HTML with `.modal-backdrop` + `.modal`.

**7a. Modal** — `ceco-ui.css` has `.modal` but pages still use `#overlay` (an ID) for the backdrop.
Rename `#overlay` → `.modal-backdrop` in CSS and update all pages that reference `id="overlay"`.

**7b. Toast** — `public/js/ui/Toast.js` manages toasts; verify it uses classes matching the kit's
`.toast-region` + `.toast.toast-success / .toast-error / .toast-warning / .toast-info`. Add
any missing variant classes to `ceco-ui.css`.

**Affected files:** `public/css/ceco-ui.css` + `public/js/ui/Toast.js` + modal pages.

---

### Phase 8 — Planned kit components · ~1 day

These are the items listed as "Planned additions" in `ui_kits/app/README.md`. They have no
equivalent in the current app and require both CSS and HTML work.

| Component | Target pages | Notes |
|---|---|---|
| **Tabs / accordion** | `trabajar-orden.html` — equipo / cliente / intervenciones / fotos / cotización sections | Replace current ad-hoc tab UI |
| **Stepper / timeline** | `estado_reparacion.html`, `trabajar-orden.html` | Visual repair progress |
| **Photo grid + lightbox** | `fotos-taller.html` | DS defines the grid; lightbox is already in `components/ProductLightbox.tsx` (web) — port pattern |
| **Signature pad** | `firmar-entrega.html` | Currently uses a canvas element; wrap in DS container pattern |
| **Print stylesheet kit** | `imprimir-orden.html`, `imprimir-contrato.html` | Extend `print-base.css` with kit tokens |

---

### Phase 9 — CSS cleanup · ~half day

Runs after all pages are migrated. Remove dead rules and consolidate.

- Remove compound button selectors (`.btn.primary`, `.btn.ghost`, etc.).
- Remove `.badge`, generic `.chip`, `.overlay`, `#overlay` rules.
- Remove `.table-wrap` alias (replaced by `.app-table-wrap`).
- Merge the 6 `760px` breakpoints into the single `768px` standard (`CSS_IMPROVEMENTS.md §1.3`).
- Merge the 3 duplicate focus-ring blocks (`CSS_IMPROVEMENTS.md §1.4`).
- Audit `ceco-ui.css` for any remaining hardcoded hex values not covered by a token.

**Affected files:** `public/css/ceco-ui.css`.

---

## Execution order

| Phase | Effort | Risk | Dependency |
|---|---|---|---|
| 1 — Token bridge completion | ~1 h | Low | None |
| 2 — Button classes | ~2 h | Low | Phase 1 |
| 3 — Status chips | ~1.5 h | Low | Phase 1 |
| 4 — App shell | ~2 h | Medium | Phase 2 |
| 5 — Data table + filter bar | ~2 h | Medium | Phase 4 |
| 6 — Form kit | ~1.5 h | Low | Phase 1 |
| 7 — Modal + toast | ~1 h | Low | None |
| 8 — Planned components | ~1 day | Medium | Phases 4–6 |
| 9 — CSS cleanup | ~0.5 h | Low | All prior phases |

**Total estimate: ~3–4 days of focused work.**

Phases 1, 2, 3, and 6 can be done independently and in parallel. Phases 4 and 5 touch
the most files and are best batched together. Phase 9 is a gate — run only after all
pages are confirmed working on the new class names.

---

## Tracking checklist

Legend: `[x]` done · `[~]` partial (details inline) · `[ ]` not started.
Last audited against the repo on 2026-05-20.

- [x] Phase 1 — Token bridge complete (surface, type scale, gray, chip tokens all in `:root`; `760px` breakpoints normalized to `768px`; the `--bp-mobile` token was skipped because CSS vars can't be referenced inside `@media`)
- [x] Phase 2 — Button classes (HTML ✅, JS ✅ as of R1 fix)
  - HTML files ✅ migrated (no `class="btn primary|ghost|danger|secondary|ok"` left in `.html`)
  - `.btn-primary/-secondary/-ghost/-danger/-accent/-sm/-lg` rules added in `ceco-ui.css:247-258`
  - JS renderers ✅ migrated by R1 (32 occurrences across 15 files: `modal.js`, `contratos-list.js`, `cotizaciones-index.js`, `agregar-equipo.js`, `cotizar-orden.js`, `editar/nueva-cotizacion.js`, `ordenes-render.js`, `ordenes-equipos.js`, `ordenes-notas.js`, `ordenes-index.js`, `piezas.js`, `poc-list.js`, `to-equipos.js`, `vendedores-batch.js`). Includes the dynamic interpolation in `modal.js:112` (`btn ${danger ? 'btn-danger' : 'btn-primary'}`).
- [x] Phase 3 — Status chips (state-display sites migrated by R2)
  - `.chip-estado` + 9 state classes ✅ in `ceco-ui.css:273-309`
  - State-render sites ✅ migrated by R2 (see below). Lossy app-state → DS-chip mapping applied per user decision.
  - Out of scope for this phase (and rightly so): count badges (`.badge.asignar/.asignado/.completo`), section-completion indicators (`.badge.pending` in nuevo-contrato/vendedores-batch), filter button chips (`.estado-chip--*` in ordenes/index.html), POC `<td>.estado-activo` cell-tints, print-stylesheet `.estado-*-chip` overrides. These use the legacy class names by design and are tracked separately under Phase 9 cleanup / Phase 8e print kit.
- [x] Phase 4 — App shell (CSS complete; HTML migration intentionally narrow)
  - `layout.js` topbar emits both legacy (`topbar`, `topbar-left`, `topbar-actions`) and new (`app-topbar`, `app-topbar-logo`, `app-topbar-spacer`, `app-topbar-actions`) classes ✅
  - `.app-topbar*` pass-through rules in `ceco-ui.css:823-835` ✅
  - `.app-body` and `.app-page-header` rules ✅ added in `ceco-ui.css` by R3 (with mobile breakpoint + `h1`/`h2`/`p`/`.app-page-header-actions` sub-rules).
  - **Discovery during R3:** the app already moved page title + primary CTA into the topbar via `Layout.renderTopbar({ title, actions })`. That means the DS's `.app-page-header` (title + action row pattern) has no natural home in most pages — the equivalent already lives in the topbar. `.app-body` is functionally equivalent to the existing `.app-wrap` (centered + padded), but `.app-wrap` has a more flexible width-modifier system (`--narrow|default|wide|full`). Wholesale rename would lose that flexibility.
  - Decision: keep `.app-wrap` as the layout primitive; `.app-body` is available for pages that want DS-spec 1440px sizing. `.app-page-header` is available for sub-section headers within complex pages. Pages get migrated piecemeal as they're touched for other reasons, not as a forced sweep.
  - 26 of ~44 HTML pages mount `topbar-mount` (use `Layout.renderTopbar`). Remaining 18 are mostly print pages, POC pages, `tools/*`, `login.html`, `404.html`, `verificar-contrato.html`, `cotizar-orden-formal.html` — most reasonably stay bespoke (print pages especially).
- [x] Phase 5 — Data table + filter bar (done as far as makes sense; see R7)
  - `.app-table-wrap` / `.app-table` / `.filter-bar` rules ✅ in `ceco-ui.css`
  - 13 HTML pages adopted (`contratos/index`, `contratos/nuevo-contrato`, `cotizaciones/*`, `POC/index`, `POC/vendedores-batch`, `ordenes/admin-equipos-cliente`, `ordenes/index`, `ordenes/progreso-tecnicos`, `inventario/cargar-inventario`, `inventario/index`, `clientes/index`)
  - **R7 finding:** `ordenes/index.html` wrap is migrated (line 213); the inner `<table class="orders-table">` is intentionally not — `.orders-table` carries substantial page-specific styling (sticky `acciones` column, z-index hierarchy for inline menus) that `table.app-table` (higher specificity) would silently override on dual-class. A full migration would mean re-implementing all those behaviors as `.app-table` extensions — a refactor beyond Phase 5's scope. `inventario/piezas.html` + `modelos.html` density tables use `[data-density="dense|roomy"]` attribute selectors on `.table-wrap`; renaming buys no real adoption (page-local would still win due to source order). Conclusion: leave these as-is until either page is refactored for unrelated reasons.
- [x] Phase 6 — Form kit (done by R6, scope clarified)
  - `.form-input/-select/-textarea/-section/-section-title` rules ✅ in `ceco-ui.css`
  - `.form-file-zone` + sub-rules (`-icon`, `:hover`, `.drag-over`, hidden `input[type="file"]`) ✅ added by R6
  - **R6 discovery:** the original audit count of "0 form-* classes" in remaining form pages was misleading. Those pages overwhelmingly use `<div class="form-field">` wrappers (`nueva-orden`: all wrapped; `editar-orden`: 9/10; `agregar-equipo`: 3/3; `cotizar-orden`: 3/3; `clientes/editar`: 10/10). The `.form-field input/select/textarea` cascade rules in `ceco-ui.css:582-595` style descendants without needing per-element classes. Forcing per-element `.form-input` would be redundant churn with no visual change. The wrapper pattern is functionally DS-conformant.
  - `firmar-entrega.html` fixed: 3 inputs that misused `.table-input` (table-cell styling) on standalone form fields migrated to `<div class="form-field"><input class="form-input">` pattern (commit by R6).
  - `importar-exportar.html` upgraded: XLSX file input wrapped in `.form-file-zone` drag-drop target (the natural fit; `fotos-taller`/`firmar-entrega` use mobile button-triggered capture which doesn't fit a visible drop zone).
- [~] Phase 7 — Modal + toast (toast done by R4; modal pending R5)
  - Toast: ✅ done by R4 — `Toast.js` now maps `ok|bad|warn|''` → `toast-success|toast-error|toast-warning|toast-info` and mounts into `.toast-region`. The two hardcoded `<div id="toasts" class="toast-wrap">` mounts in `contratos/nuevo-cliente.html` and `POC/vendedores-batch.html` were renamed to `toast-region`. Legacy `.toast-wrap` + `.toast.ok/.bad/.warn` CSS rules left in place for Phase 9 cleanup.
  - Modal: `.modal-backdrop` rules ✅ in CSS, but 4 files still reference `#overlay` / `id="overlay"`: `public/clientes/index.html`, `public/inventario/piezas.html`, `public/inventario/modelos.html`, `public/js/pages/contratos-approval.js`, plus the legacy `#overlay` CSS rule. R5 covers this.
- [N/A] Phase 8a — Tabs / accordion: no tabbed UI exists in `trabajar-orden.html` (single-page form with chip status, equipos list, modal). The plan envisioned Equipo/Cliente/Intervenciones/Fotos/Cotización tabs that don't exist. The DS App Kit's `app.css` doesn't ship a `.tabs` rule either. Adding tab CSS without a consumer is yagni.
- [x] Phase 8b — Stepper / timeline (`.stepper`, `.progress-bar-*`, `.kpi-card*` added)
- [x] Phase 8c — Photo grid + lightbox (`.photo-grid`, `.lightbox*` added)
- [N/A] Phase 8d — Signature pad wrapper: the DS App Kit has `.multi-sig*` for **printed** multi-party signature layouts on formal documents, not for an interactive `<canvas>` signature pad like `firmar-entrega.html` uses. Different pattern. The existing page-local `<canvas class="firma-canvas">` styling works fine.
- [x] Phase 8e — Print kit: `public/css/print-base.css` already exists (~146 lines, DS-token-aware with fallbacks, `@page letter` rules, brand-header / page-shell / print-mono primitives). Linked from `cotizaciones/imprimir-cotizacion`, `contratos/imprimir-contrato`, `ordenes/imprimir-orden`. Extending to the other 4 print pages (`cotizar-orden-formal`, `nota-entrega`, `nota-entrega-intervenciones`, `POC/imprimir-equipos`) is per-page work since each has its own inline print styling that may or may not be compatible — left as opportunistic future work.
- [x] Phase 9 — CSS cleanup (orphan rules from R1–R8 removed by R9)
  - `.estado-pill.*` + dot rules (~56 lines) removed from `ordenes-index.css` — orphan after R2 (per-order state badges now `.chip-estado.chip-*`).
  - `.card-contrato .estado-activo/-ok/-pendiente/-inactivo/-cancelado` rules removed from `ceco-ui.css` — orphan after R2 (contratos cards now use `.chip-estado.chip-*`).
  - `.toast-wrap` + `.toast.ok/.bad/.warn` rules removed from `ceco-ui.css` — orphan after R4 (Toast.js now emits `.toast.toast-success/-error/-warning/-info` into `.toast-region`).
  - Inline orphan rules removed from `contratos/index.html` (5 `.estado-*` badges), `cotizaciones/index.html` (4 `.estado-*` badges), `contratos/nuevo-cliente.html` (`.toast-wrap`, `.toast`, `.toast.ok/.bad`, `@keyframes slideInToast`, mobile `.toast-wrap` override), `inventario/modelos.html` (`.toast` + variants), `inventario/piezas.html` (`.toast` + variants), `inventario/index.html` (`.toast` + variants).
  - Intentionally kept: `.estado-activo/-aprobado/-pendiente/-anulado/-inactivo` bare rules in `ceco-ui.css:1249-1260` (still consumed by `poc-list.js:88,354` setting `tdEstado.className`); `.estado-*-chip` family (still used by `contratos-imprimir.js` print page); `#overlay` rule (still has JS handles via `getElementById('overlay')`); `.table-wrap` (still in use by inventario density tables — see R7); `.badge.X` count badges (KPI counters, not state chips); demo-page references in `tools/`.

---

## Remediation plan (what's left to truly finish DS adoption)

Ordered roughly by blast radius. Each item produces a self-contained PR.

### R1 — Restore button styling in JS renderers ✅ DONE (2026-05-20)
The `.btn primary/ghost/danger/secondary/ok` compound selectors were removed prematurely. Fixed by find-and-replacing **32 occurrences across 15 JS files** (final count higher than the initial audit's 19; missed cases were single-quoted strings, `className =` assignments, compound classes with extra suffixes like `card-contrato__editar`, and the dynamic interpolation in `modal.js`). Mapping: `btn primary` → `btn btn-primary`, `ghost` → `btn-ghost`, `danger` → `btn-danger`, `secondary` → `btn-secondary`, `ok` → `btn-accent`.

### R2 — Migrate state-display sites to `.chip-estado` ✅ DONE (2026-05-20)
Scope clarification: the audit said "every `.badge`/`.chip` use" but the actual codebase has many distinct chip-like patterns (count badges, section-completion indicators, filter buttons, POC td-cell tints, print-only `-chip` suffixes). Only true state-display sites were migrated; the other patterns stay legacy and roll into Phase 9 cleanup.

Lossy app-state → DS-chip mapping applied:

| Domain | App state | DS chip |
|---|---|---|
| Órdenes | POR ASIGNAR | chip-recibida |
| | ASIGNADO | chip-reparacion |
| | COMPLETADO (EN OFICINA) | chip-lista |
| | ENTREGADO AL CLIENTE | chip-entregada |
| Contratos | pendiente_aprobacion | chip-diagnostico |
| | activo | chip-reparacion |
| | aprobado | chip-aprobada |
| | anulado | chip-cancelada |
| | inactivo / default | chip-espera |
| Cotizaciones | borrador / default | chip-recibida |
| | emitida / enviada | chip-cotizada |
| | aprobada | chip-aprobada |
| | anulada | chip-cancelada |
| Trabajo interno | SIN INICIAR | chip-espera |
| | EN_PROGRESO | chip-reparacion |
| | COMPLETADO | chip-lista |

Sites migrated (8 files):
- `public/js/pages/ordenes-state.js:260-267` — `getEstadoClass()` now returns DS chip class names
- `public/js/pages/ordenes-render.js:112` — desktop row markup → `<span class="chip-estado ${cls}">` (inner `.dot` span removed; `chip-estado::before` provides the dot)
- `public/js/pages/ordenes-render.js:254-256` — mobile card markup, same shape
- `public/js/pages/contratos-list.js:36-41, 113-115` — desktop estadoClase map + table-cell markup
- `public/js/pages/contratos-list.js:138-143, 187` — mobile card map + markup
- `public/js/pages/cotizaciones-index.js:8-17` — `estadoBadge()` returns `<span class="chip-estado chip-{state}">`; added `aprobada` to the map (was missing)
- `public/js/pages/cotizar-orden-formal.js:33` — "Emitida" badge → `chip-estado chip-cotizada`
- `public/js/pages/to-state.js:41-49` — `pintarChipTrabajo()` writes `chip-estado chip-{espera|reparacion|lista}` instead of `chip estado-chip estado-{sin|prog|ok}`
- `public/ordenes/trabajar-orden.html:243` — initial chipTrabajo markup; also deleted the now-orphan inline `.estado-chip`/`.estado-sin/-prog/-ok` CSS at lines 26-29
- `public/css/ordenes-index.css:3011` — re-targeted `.card-contrato__tier1 .estado-pill` grid-positioning rule to `.chip-estado` to preserve mobile card layout

Now-orphan CSS (delete in R9 / Phase 9 cleanup, NOT now in case any non-migrated page still references them):
- `public/css/ordenes-index.css:854-905` — `.estado-pill` + 4 state modifiers
- `public/contratos/index.html:562-590` — `.estado-activo/--aprobado/--pendiente/--anulado/--inactivo/--vencido`
- `public/css/ceco-ui.css:344-348` — `.card-contrato .estado-*` legacy selectors
- The contratos print stylesheet's `.estado-*-chip` rules stay (Phase 8e print kit handles those).

### R3 — Finish Phase 4 app shell ✅ DONE (2026-05-20, scope revised)
Added `.app-body` and `.app-page-header` rules to `ceco-ui.css` (with mobile breakpoint, `h1`/`h2`/`p` sub-rules, and `.app-page-header-actions`).

The plan's original prescription ("wrap each page's main content in `<main class="app-body">` and convert title-row markup to `.app-page-header`") turned out to be ill-fitted to the current codebase: the app already integrated the title+CTA pattern into the topbar via `Layout.renderTopbar({ title, actions })`, leaving most pages with no natural "title + action row" element to host. And `.app-wrap` is functionally equivalent to `.app-body` but has a `--narrow|default|wide|full` modifier system that wholesale rename would lose. So:

- CSS rules ✅ available — pages can opt in.
- Wholesale HTML migration not done by design.
- Future page touches should adopt `.app-body` / `.app-page-header` opportunistically where they fit.

### R4 — Migrate Toast.js to the new region/variant classes ✅ DONE (2026-05-20)
`public/js/ui/toast.js` now mounts into `.toast-region` and maps the legacy `ok|bad|warn|''` type vocabulary to `toast-success|toast-error|toast-warning|toast-info` inside `_make()`. The 259 callers (`Toast.show(msg, 'ok'|'bad'|'warn')`) keep working — the API is unchanged, only the rendered class is. The two hardcoded `<div id="toasts" class="toast-wrap">` mounts in `contratos/nuevo-cliente.html` and `POC/vendedores-batch.html` were renamed to `toast-region`. Legacy `.toast-wrap` + `.toast.ok/.bad/.warn` CSS rules stay in `ceco-ui.css` for now (Phase 9 cleanup); they're shadowed by the new variant rules thanks to source order.

### R5 — Finish R1 side-effect cleanup ✅ DONE (2026-05-20, scope revised)
The original R5 ("rename `#overlay` → `.modal-backdrop`") was mostly moot on inspection: every element with `id="overlay"` already carries `class="modal-backdrop"` (the id is a JS handle, the class is the styling hook), and `inventario/modelos.html` uses a self-contained `.modelos-overlay` system that doesn't conform to the DS modal pattern (left for Phase 9 to decide).

The actually-broken thing was R1's downstream effect: page-local CSS rules and JS selectors targeting `.btn.{primary|ghost|danger|secondary|ok}` (compound) that no longer match anything since R1 migrated all element classes to `.btn-{variant}` (BEM).

Fixes applied (8 files, ~14 selector rewrites):
- `public/js/pages/contratos-approval.js:89, 121` — `.btn.ok` → `.btn-accent` (both query sites)
- `public/contratos/nuevo-contrato.html:105-140` — `.btn.secondary/ghost/danger` → BEM
- `public/contratos/nuevo-cliente.html:89-100` — `.btn.ghost` → BEM
- `public/contratos/index.html:528` — `.btn.danger` → BEM
- `public/inventario/modelos.html:60-63` — `.btn.primary/ok/danger` → BEM (`ok` → `accent`)
- `public/POC/vendedores-batch.html:237-307` — `.btn.ghost/secondary` → BEM
- `public/POC/imprimir-equipos.html:133-138` — `.btn.secondary` → BEM
- `public/ordenes/cotizar-orden-formal.html:43` — `.btn.primary` → BEM
- `public/css/ordenes-index.css:1283` — `.btn.primary:hover` animation → BEM

Without these, page-local button colors (e.g. the page-specific danger/ghost shades on `nuevo-contrato.html`, the green `.btn.ok` on `modelos.html`, the pulse animation on primary buttons in `ordenes-index.css`) silently stopped applying.

Modal CSS cleanup (delete `#overlay,` from `ceco-ui.css:511`) deferred to Phase 9 — verifying no element relies solely on `#overlay` styling first.

### R6 — Phase 6 form-kit completion ✅ DONE (2026-05-20, scope revised)
The plan's prescription "apply `.form-input` to remaining form pages" turned out to be misguided: remaining form pages (`nueva-orden`, `editar-orden`, `agregar-equipo`, `cotizar-orden`, `clientes/editar`) overwhelmingly use `<div class="form-field">` wrappers, and the `.form-field input/select/textarea` cascade in `ceco-ui.css:582-595` already styles them. Forcing per-element classes is redundant.

Actual R6 fixes:
- `.form-file-zone` CSS + sub-rules (`-icon`, `:hover`, `.drag-over`, hidden file input) added to `ceco-ui.css` from the DS App Kit.
- `public/ordenes/firmar-entrega.html` — 3 inputs migrated from misused `.table-input` (table-cell styling) to `<div class="form-field"><input class="form-input">`.
- `public/ordenes/importar-exportar.html` — XLSX file input wrapped in `<label class="form-file-zone">` with icon + drop-target text. The `fotos-taller`/`firmar-entrega` photo-capture UIs intentionally use mobile button-triggered capture (not drag-drop zones), so file-zone doesn't fit there.

### R7 — Phase 5 table completion ✅ DONE (2026-05-20, scope = "verify, accept reality")
On inspection there's no productive migration left in scope:
- `ordenes/index.html` wrap is already migrated (`.app-table-wrap` at line 213). The inner `<table class="orders-table">` carries page-specific custom styling (sticky `acciones` column, z-index hierarchy for inline menus) that the higher-specificity `table.app-table` rules would silently override on dual-class — genuine regression risk. Migrating cleanly would require re-implementing all of `.orders-table` as `.app-table` extensions: that's a substantial standalone refactor, not a Phase 5 mop-up.
- `inventario/piezas.html` + `modelos.html` use page-local `.table-wrap` rules with `[data-density="dense|roomy"]` attribute selectors. Renaming buys no real DS adoption (page-local rules would still win due to source order) and porting the density attribute selectors is pure churn.

Decision: leave these alone until either page is refactored for unrelated reasons. Update Phase 5 tracking line to reflect this is the honest end-state, not an outstanding item.

### R8 — Phase 8 missing components ✅ DONE (2026-05-20, mostly N/A)
On inspection the plan's three R8 tasks are largely based on UI patterns that don't exist in the codebase or aren't provided by the DS:
- **Tabs:** `trabajar-orden.html` has no tabbed UI to wire into. It's a single-page form with chip status, equipos list, and a "Agregar pieza" modal. The plan envisioned Equipo/Cliente/Intervenciones/Fotos/Cotización tabs that don't exist. The DS App Kit's `app.css` also doesn't actually ship a `.tabs` rule (grep confirms). YAGNI to add tab CSS without a consumer.
- **Signature pad:** The DS provides `.multi-sig*` rules for **printed** multi-party signature layouts on formal documents — not for an interactive `<canvas>` signature pad like `firmar-entrega.html` uses. Different pattern. Page-local canvas styling works fine.
- **Print kit:** `public/css/print-base.css` already exists, ~146 lines, DS-token-aware. Linked from 3 of 7 print pages. The remaining 4 (`cotizar-orden-formal`, `nota-entrega`, `nota-entrega-intervenciones`, `POC/imprimir-equipos`) have their own inline print styling; opt-in to `print-base.css` is per-page judgement and left as opportunistic future work.

R8's actionable scope reduces to verifying the existing state and documenting reality.

### R9 — Cleanup pass ✅ DONE (2026-05-20, scope = surgical, not wholesale)
The plan's bulk "delete all the old stuff" prescription was overstated — many of the listed classes are still in use by valid features (count badges, filter chips, POC td-tints, print-page chip variants, JS-handle ids). R9 took a surgical approach: delete only what's truly orphan after R1–R8, leave everything still referenced.

Deleted:
- `ordenes-index.css` — `.estado-pill.*` + dot rules (~56 lines)
- `ceco-ui.css` — `.card-contrato .estado-{activo|ok|pendiente|inactivo|cancelado}` rules
- `ceco-ui.css` — `.toast-wrap`, `.toast.ok/.bad/.warn`, and the `.toast-wrap .toast` pointer-events combinator
- `contratos/index.html` — `.estado-{activo|aprobado|pendiente|anulado|vencido|inactivo}` badge rules (~30 lines)
- `cotizaciones/index.html` — `.estado-{borrador|emitida|enviada|anulada}` badge rules
- `contratos/nuevo-cliente.html` — `.toast-wrap`, `.toast`, `.toast.ok/.bad`, `@keyframes slideInToast`, mobile `.toast-wrap` override (~50 lines)
- `inventario/modelos.html`, `inventario/piezas.html`, `inventario/index.html` — `.toast` + variant overrides
- `ordenes-index.css` — outdated toast comment

Kept (intentionally — still in active use):
- `ceco-ui.css` bare `.estado-{activo|aprobado|pendiente|anulado|inactivo}` rules (consumed by `poc-list.js`)
- `.estado-*-chip` family (used by `contratos-imprimir.js` print page)
- `#overlay,` rule (JS code still uses `getElementById('overlay')`)
- `.table-wrap` (inventario density tables — R7 conclusion)
- `.badge.X` count-badge variants (KPI counters across multiple pages)
- `tools/` demo pages (out of scope)

Net: ~165 lines of CSS removed across 7 files. No regressions because every deletion was preceded by verifying zero production-code references via grep.

---

## Doc-drift fixes applied with this update

- Phase 1b code block originally showed rem-based type scale values; replaced with the px-based values actually shipped in `ceco-ui.css:131-145` (matches `colors_and_type.css`).
- Phase 1c — clarified that `--bp-mobile` token was *not* added (CSS vars can't be used inside `@media`); the breakpoint consistency goal was achieved by direct replacement of `760px` → `768px`.
