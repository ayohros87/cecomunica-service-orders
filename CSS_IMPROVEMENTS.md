# CSS Improvements — `ceco-ui.css` + `ordenes-index.css`

> **Scope:** the app-wide design-system stylesheet and the orders-page stylesheet.
>
> **Status (2026-05-15):** P0 + quick-wins + half-day batch + most of the one-day refactor shipped (commits `212f3af` through `10009fa`). What remains is in §13.
>
> **Sibling docs:** `ORDENES_INDEX_IMPROVEMENTS.md` covers the UX/architecture of the orders page (and includes the "Week 0 token bridge" that lands `--fg-*`, `--border-*`, `--sp-*`, `--radius-*`, `--ring-*` tokens — the bridge itself shipped here under commit `212f3af`). This doc is about the **CSS itself** — duplication, dead rules, hardcoded values, specificity, and structure.

---

## Verdicts

**`ceco-ui.css` (1,056 lines):** strong fundamentals — section organization is clean, semantic naming, `--brand` and shadow tokens are reused. Undermined by hardcoded focus-ring rgba (5 places), three near-identical focus blocks (`.form-field`, `.table-wrap`, `.app-search`), six separate `760 px` mobile breakpoints that could consolidate, and zero a11y hooks (`:focus-visible`, `prefers-reduced-motion`). **Recoverable in ~1 day.**

**`ordenes-index.css` (3,549 lines):** grew organically through 7 phases. 80+ hardcoded hex colors, 263 hardcoded pixel values, sections labeled by feature-branch letters (J–Y) instead of semantic names, a fragile `top: 128px` sticky offset, z-index values up to 10,001, 14 keyframes with 3 likely dead, no motion-preference handling, and a mobile/desktop breakpoint gap (760 px vs 768 px). **2–3 day cleanup. Not in crisis.**

---

## 1. Critical (P0) — fix before anything else

### 1.1 Sticky thead offset is a magic constant

[ordenes-index.css:76-79](public/css/ordenes-index.css#L76)
```css
table thead {
  position: sticky;
  top: 128px;   /* approx. collapsed filter-card height */
  z-index: 10;
}
```

The comment admits it is an estimate. Any change to filter-card height (e.g., adding a chip bar per `ORDENES_INDEX_IMPROVEMENTS.md` §4.3) breaks this. Two fixes possible:

- **A:** measure the filter card on resize, set `--filter-card-h` as a CSS custom property on `body`, and reference `top: var(--filter-card-h)`. ~20 min JS.
- **B:** restructure so the filter card is `position: sticky` *outside* the table's scroll container and the thead is `top: 0` inside it. Requires HTML change.

A is cheaper and reversible.

### 1.2 Z-index `4000` on `.acciones-wrap`

[ordenes-index.css:1055-1063](public/css/ordenes-index.css#L1055)
```css
.acciones-wrap {
  ...
  z-index: 4000;
}
```

Nothing else in the file uses 4000. Adjacent layers go from 100 (filter card) → 998 (mobile equipment header) → 9000 (popovers) → 10000 (modals). 4000 was almost certainly a "make it work" number during a stacking bug. Audit what it actually needs to outrank — probably the sticky thead (z-index 10). Drop to `15` or document the actual requirement.

### 1.3 Breakpoint gap: 760 px vs 768 px

`ceco-ui.css` uses `760 px` as the mobile breakpoint (6 occurrences: lines 425, 677, 686, 735, 777, 808). `ordenes-index.css` uses `768 px` (lines 1195, 3117) — and one `min-width: 769 px` (line 1998). Devices at viewport widths 761–767 px fall into a dead zone where the two stylesheets disagree. Pick one (768 is the standard) and update both files.

### 1.4 Three identical focus-ring blocks in `ceco-ui.css`

[ceco-ui.css:243-249](public/css/ceco-ui.css#L243), [296-303](public/css/ceco-ui.css#L296), [439-443](public/css/ceco-ui.css#L439)

Same rule, three times:
```css
outline: none;
border-color: var(--brand);
box-shadow: 0 0 0 3px rgba(0, 145, 215, 0.14);
```

The rgba value is the brand color (`#0091D7` = `rgb(0,145,215)`) with 14% alpha — but it is hardcoded, not derived from `--brand`. Replace with a single token `--ring-focus` (already proposed in the Week-0 token bridge) and apply on `:focus-visible` rather than `:focus`. This single change handles a11y + DRY in one step.

### 1.5 No `prefers-reduced-motion` handling

Combined files declare **31 keyframe animations and ~25 transitions**, none of them respect user motion preferences. Add to `ceco-ui.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Standard "kill switch" pattern. 5 minutes.

---

## 2. Dead code — delete

| Item | Location | Notes |
|---|---|---|
| `@keyframes pulse-opacity` | ordenes-index.css:941 | No references in CSS or JS |
| `@keyframes modalSlideIn` | ordenes-index.css:1171 | No references found |
| `@keyframes highlight-success` | ordenes-index.css:3080 | No references found |
| `@keyframes highlight-update` | ordenes-index.css:3094 | No references found |
| `.equipment-bar` block | ordenes-index.css:2240 | Comment in code says "Ya no se usa" |
| `--mobile-bottom-nav-height: 0px` | ordenes-index.css:11 | Used in one `calc()` but is always 0 — drop and inline |
| Commented-out block | ordenes-index.css:1047 | "NO convertir th/td en flex" — outdated docs |

Confirm `pulse`, `fadeOut`, `slideInRight` keyframes (lines 1158–1175) are not triggered by JS — they are duplicated from `ceco-ui.css` and likely unused locally.

---

## 3. Duplication between the two files

`ordenes-index.css` redeclares things `ceco-ui.css` already provides. Delete from the page file, use the base.

| Pattern | ceco-ui.css | ordenes-index.css | Action |
|---|---|---|---|
| `.btn` base | 65–106 | 119–227 (variations override base) | Keep base, override only state-specific styles |
| Table base | 148–158 | 48–80 | Page file should override only `.orders-table` specifics |
| `@keyframes spin` | 945 | 1158 | Keep ceco-ui only |
| `@keyframes fadeOut` | exists | 1162 | Keep ceco-ui only |
| `@keyframes slideInRight` | 607 | 1166 | Keep ceco-ui only |
| `@keyframes slideDown` | — | 1716 *and* 2605 (same definition, twice) | Promote to ceco-ui, delete both copies |
| Focus-ring rgba | 248, 302, 442, 531, 945 | — | Single `--ring-focus` token |

Estimated saving: ~150 lines from `ordenes-index.css`, ~30 lines from `ceco-ui.css`.

---

## 4. Hardcoded values that should be tokens

`ORDENES_INDEX_IMPROVEMENTS.md` "Week 0" already proposes the token bridge (`--fg-*`, `--border-*`, `--sp-*`, `--radius-*`, `--ring-*`, `--brand-soft/press`, `--status-*`). That ticket plus this section gives the full picture.

**Hex colors in `ordenes-index.css` to migrate** (~80 instances total):

| Pattern | Lines | Replacement |
|---|---|---|
| `#ef4444` (red border accent) | 716 | `var(--status-critical)` (Week-0 token) |
| `#f59e0b` (amber border) | 717 | `var(--status-warning)` |
| `#3b82f6` (blue accent) | 718, 755, 1546, 3546, 2174 | `var(--brand)` or `var(--blue-500)` |
| `#22c55e` (green border) | 719 | `var(--status-online)` |
| `#1d4ed8` / `#93c5fd` (asignar button) | 1082 | brand scale once added |
| `rgba(59, 130, 246, *)` | 755, 1546, 2174, 3546 | derived from `--brand` via `color-mix()` |
| Tipo-chip palette | 704–710, 733–736 | `--tipo-chip-{reparacion,programacion,mantenimiento,venta}` |

**Hex colors in `ceco-ui.css` to migrate** (~15 instances):

- Lines 322, 406, 407: `.badge` color pairs (already mostly tokenized; finish the job)
- Lines 248, 302, 442, 531, 945: brand-rgba focus rings (→ `--ring-focus`)

**Pixel values:** 263 hardcoded `px` in `ordenes-index.css`. Once Week-0 lands `--sp-1` through `--sp-12`, convert in batches — but only when touching adjacent code. Don't do a 263-edit PR.

---

## 5. Specificity & cascade

### 5.1 `!important` overrides — currently 17 in `ordenes-index.css`, 5 in `ceco-ui.css`

The honest ones are unavoidable (`.btn:disabled` needs `transform: none !important`). The fightable ones:

- `.estado-aprobado-chip { background: #e6ffea !important; color: #2e7d32 !important; border-color: #bbf7d0 !important }` ([ceco-ui.css:118](public/css/ceco-ui.css#L118)) — 3× `!important` because `.estado-pill.*` rules on the same element have higher specificity. Fix by aligning specificity (both single-class), not by escalating.
- `.confirm-btn` and `.delete-btn` ([ordenes-index.css:897-921](public/css/ordenes-index.css#L897)) — 7× `!important` each. These should be `.btn.primary.lg` and `.btn.danger.lg` from the base system, no overrides needed.
- `.tr.activo { background: #f0f9ff !important }` ([ordenes-index.css:2173](public/css/ordenes-index.css#L2173)) — fights the zebra-stripe `tr:nth-child(4n+3)` rule. Solution: move the `.activo` rule below the nth-child rules (CSS cascade), drop `!important`.

### 5.2 ID selectors used as styling hooks

| Selector | Lines | Better |
|---|---|---|
| `#iconoAvanzados`, `#iconoAvanzados.open` | 963–968 | `.icon-advanced` |
| `#ordersTable th:nth-child(N)` × 6 | 998–1006 | `.orders-table th.col-name` or use `<col>` |
| `#desktopTopbar`, `#desktopFiltersCard` (with `!important`) | 1419–1420 | `.topbar--desktop`, `.filters-card--desktop` |

### 5.3 Selectors fighting inline styles

[ordenes-index.css:2596-2602](public/css/ordenes-index.css#L2596):
```css
.accesorios-popover[style*="display: none"] { ... }
```

This is the page CSS fighting inline styles set by JS. Fix at the source: have the JS toggle a `.is-hidden` class, not `style.display`. Then the attribute-selector hack disappears.

---

## 6. Performance smells

### 6.1 `transition: all`

`ceco-ui.css` declares `--transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1)` ([line 37](public/css/ceco-ui.css#L37)) and applies it to 20+ selectors. `transition: all` transitions every animatable property — including expensive ones (layout/paint) — which causes hover jitter on complex elements. Replace with explicit `transition: background-color 120ms, border-color 120ms, box-shadow 120ms, transform 120ms` (once `--dur-fast` from the Week-0 token bridge exists).

### 6.2 Ripple effect on width/height

[ceco-ui.css:73-88](public/css/ceco-ui.css#L73) `.btn::before` ripple animates `width` and `height` from 0 → 300px on `:active`. Both trigger layout. Replace with `transform: scale()` + `opacity` for compositor-only animation. Same visual effect, no layout thrash.

### 6.3 Universal selector with property reset

[ceco-ui.css:40](public/css/ceco-ui.css#L40) `*{box-sizing:border-box}` — standard, harmless. Mentioned only for completeness; no action needed.

---

## 7. Responsiveness

### 7.1 Six `@media (max-width: 760px)` blocks in `ceco-ui.css`

Lines 425, 677, 686, 735, 777, 808 — all the same breakpoint, scattered. Consolidate into one trailing `@media` block at the bottom of the file (one cohesive section per breakpoint). Alternative: keep them next to their parent component for proximity, but at least standardize the breakpoint value.

### 7.2 Pick one mobile breakpoint

Choose `768 px` (matches `ordenes-index.css` and Bootstrap convention). Update all 6 occurrences in `ceco-ui.css`. Validate nothing breaks at 760–767 px viewports.

### 7.3 Define breakpoint tokens

```css
:root {
  --bp-mobile:  768px;
  --bp-tablet: 1024px;
  --bp-wide:   1280px;
}
```

CSS doesn't allow `var()` in `@media` queries — so this is documentation, not enforcement. But it gives JS a single source of truth (`getComputedStyle(document.documentElement).getPropertyValue('--bp-mobile')`) for the `matchMedia` checks in the rendering layer.

---

## 8. Accessibility

Covered in `ORDENES_INDEX_IMPROVEMENTS.md` QW5–QW8 and QW16. CSS-specific additions:

- Add `:focus-visible` styling globally:
  ```css
  :focus-visible {
    outline: none;
    box-shadow: var(--ring-focus);
  }
  ```
- Audit color contrast on `.badge` variants in `ceco-ui.css:312-322` and `.tipo-chip--*` in `ordenes-index.css:704-736`. The amber-on-cream and indigo-on-lavender pairs are the suspect ones.

---

## 9. Structure & section organization

### 9.1 `ceco-ui.css` is well-sectioned — finish the job

Add section headers for the three blocks that lack them:

- Line 190 area (utilities/helpers)
- Line 472 area (Auth helpers — currently grouped with "Auth 2.0" but starts earlier)
- Line 556 area (Alerts/toasts)

### 9.2 `ordenes-index.css` needs a structural pass

1150 lines (48–1195) with no internal headers. Suggested sections (no value judgment, just organization):

```css
/* ====== Page surface & filter card ====== */
/* ====== Orders table — layout & cells ====== */
/* ====== Estado pill + tipo chip ====== */
/* ====== Action buttons (flujo + gestion) ====== */
/* ====== Row expansion (desktop) ====== */
/* ====== Equipos table inside expanded row ====== */
/* ====== Acciones — sticky bottom bar ====== */
/* ====== Resumen + filter badges ====== */
/* ====== Modals (asignar, notas, text, alert) ====== */
/* ====== Toasts ====== */
/* ====== Animations & keyframes ====== */
/* ====== Mobile @media block ====== */
```

The current feature-letter labels (J, K, L, M, O, P, U, V, X, Y) — comments like `/* J) Wrapper para Acciones */` and `/* Y) Resumen operativo */` — refer to a branch-tracking system that nobody reading the code today understands. Strip them.

### 9.3 Promote generic patterns to `ceco-ui.css`

| Pattern | Lives at | Move to ceco-ui.css because |
|---|---|---|
| Toggle slider (rocker switch) | ordenes-index.css:198–230 | Generic UI; used or wanted elsewhere |
| Filter card (collapsible) | ordenes-index.css scattered | Pattern needed on other index pages (contratos, cotizaciones, POC) |
| Loading skeleton | none yet (planned) | Cross-cutting concern |

### 9.4 Inconsistent naming

`ordenes-index.css` mixes kebab-case (`.filter-select`) with camelCase (`.cellSelectInput`, `#iconoAvanzados`, `#ordersTable`). Pick kebab-case (matches `ceco-ui.css`) and rename. This requires coordinated HTML/JS edits — schedule it as a discrete commit so a future grep on the old names finds nothing.

---

## 10. Prioritized roadmap

**Quick wins (≤ 2 hr total)**
1. ✅ Add `prefers-reduced-motion` block to `ceco-ui.css` — `cbe1a21`
2. ✅ Delete dead/duplicate rules and the "Ya no se usa" block — `fb92b64`
3. ✅ Consolidate breakpoint to `768 px` — `fb92b64`
4. ✅ Drop z-index `4000` to `1100` with documented constraint — `fb92b64`
5. ✅ Add `:focus-visible` global rule — `b9ef6c8`

**Half-day batch**
6. ✅ Replace three duplicate focus-ring blocks with `--ring-focus` (became four after counting `.auth-input`) — `b9ef6c8`
7. ✅ Delete `@keyframes` duplicated between the two files (spin, slideDown) — `fb92b64`
8. ✅ Convert `transition: all 0.2s` to explicit property lists via redefined `--transition` — `0087f6d`
9. ✅ Compositor-only ripple (transform/opacity) — `36cd1f4`
10. ✅ Strip `!important` from dead `.btn-agregar-equipo` / `.boton-eliminar-equipo` and from `.estado-aprobado-chip` — `5216121`

**One-day refactor**
11. ✅ Add section headers to the unsectioned middle of `ordenes-index.css` — `8936213`
12. ✅ Replace ID-as-style-hook selectors with classes — `93ede01`
13. ⏳ Migrate hardcoded brand-blue rgba to derived tokens (§4) — pending, see §13

**Two-day refactor**
14. ✅ Sticky thead offset → CSS custom property via ResizeObserver — `10009fa`
15. ⏳ Promote toggle slider + filter-card patterns from page CSS to `ceco-ui.css` (§9.3) — pending, see §13
16. ⏳ Normalize naming convention to kebab-case — deferred to Phase-5g (see §13)

---

## 11. What was deleted outright

Shipped:

- `.header-col-centro { display: none; /* Ya no se usa */ }` block (commit `fb92b64`)
- `.btn-agregar-equipo` + `.boton-eliminar-equipo` blocks — 7× `!important` each, no element ever uses these classes (commit `5216121`)
- Duplicate `@keyframes spin` (identical to ceco-ui's)
- Duplicate `@keyframes slideDown` at line 2605 (identical to ceco-ui's)
- Four near-identical focus-ring blocks in ceco-ui.css → consolidated to `var(--ring-focus)` (commit `b9ef6c8`)

**Not deleted — audit was wrong:**

| Item | Audit claim | Reality |
|---|---|---|
| `@keyframes pulse-opacity` | "No references" | Used at line 938 (`.warn-icon`) |
| `@keyframes modalSlideIn` | "No references" | Used at lines 560 and 1815 |
| `@keyframes highlight-success` / `highlight-update` | "No references" | Used at lines 3108 / 3112 (triggered by JS via `.feedback-*` classes) |
| `@keyframes slideInRight` (page-local) | "Identical to ceco-ui" | Different — `translateX(12px)` vs `100px`, end opacity 1.0 vs 0.98. Page version is more refined. |
| `@keyframes slideDown` at line 1716 | "Identical to ceco-ui" | Different — `translateY(-8px)` vs `-10px`. Subtle. |
| `--mobile-bottom-nav-height: 0px` | "Always zero" | Overridden inside `@media (max-width: 768px)` to 64px; actively used in `calc()` expressions |

Lesson: the original audit's `grep` was too narrow. Whenever it claimed something was unreferenced, the reality was that JS or a `@media` block was using it.

---

## 12. Honest bottom line

`ceco-ui.css` is in good shape for a non-architected app — section headers exist, brand tokens are reused, button/badge systems are coherent. The cleanup was mostly polish.

`ordenes-index.css` was **fixable but neglected**. It absorbed every feature-branch's "just add a class" CSS for two years and the section labeling (J, K, L, M…) tells the story. The 2026-05-15 cleanup did not delete the feature-letter comments — that requires a coordinated pass that also touches JS class names — but the file gained proper section headers and dropped most of the duplicates, `!important` battles, and ID-as-styling-hook patterns.

Neither file blocks any of the work in `ORDENES_INDEX_IMPROVEMENTS.md`.

---

## 13. What remains for a future pass

Out of the original roadmap, the following are **not yet done**:

- **Hardcoded brand-blue rgba migration** (§4) — ~5 instances of `rgba(59, 130, 246, *)` in `ordenes-index.css` that should derive from `--brand` via `color-mix()`. Touches: `.tipo-chip--*`, `.btn-flujo--asignar` colors. ~1 hr.
- **Tipo-chip palette tokens** (§4) — `--tipo-chip-{reparacion,programacion,mantenimiento,venta}` not yet defined. The Cecomunica Design System publishes the values; needs a one-shot token addition + replacement.
- **`transition: all 0.3s`** still appears in 4 places (different duration from `var(--transition)`). Not strictly wrong but inconsistent.
- **Feature-letter comments** in `ordenes-index.css` (J, K, L, M, O, P, U, V, X, Y) — not stripped. Mostly cosmetic; doing it cleanly means touching the JS `feedback-*` class names too. Defer to the Phase-5g "kebab-case rename" pass referenced in `REFACTOR_STRATEGY.md`.
- **Promoting toggle slider + filter-card patterns to `ceco-ui.css`** (§9.3) — generic enough to share across `contratos/`, `cotizaciones/`, etc. but no immediate need.
- **Imprimir-contrato.html chip overrides** still use `!important` to fight `#chipEstado` (an ID-as-styling-hook). Same pattern as Bundle E2 — separate page, deferred.
- **Loader-border rgba** at `ceco-ui.css:1001` still hardcoded — different semantic (soft spinner ring) so kept; could derive from `--brand` later.

None of these blocks any redesign work. They're the kind of polish that gets folded into other tickets when nearby code is touched.
