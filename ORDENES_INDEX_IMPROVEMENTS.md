# Ordenes Index — Improvement Strategy

> **Scope:** the `public/ordenes/index.html` page and its supporting modules (`public/js/pages/ordenes-*.js`, `public/css/ordenes-index.css`) plus the services they depend on (`ordenesService.js`, `clientesService.js`).
>
> **Status:** strategy document, no work shipped from this list yet.
>
> **Last refreshed:** 2026-05-14 (after Phase 5f decomposition).

---

## Executive verdict

For a daily-use B2B tool, this page works but reads like it accreted over time without an architect ever pushing back. The worst problem is **not UI** — it is that every search and every page load triggers full-collection scans on `clientes` and `ordenes_de_servicio`. That is a Firestore bill timebomb, not just a perf issue. The UI shows its age: spinner with no skeleton, manual "Cargar más", native `prompt()` dialogs for editing equipment, two parallel DOMs (table + mobile cards) shipped on every render, and `lucide.createIcons()` called over the entire document three times per page load.

The Phase 5f split was the right call but it surfaced rather than created the debt — you can now see it.

The rest of this document is direct and critical by design. References use the post–Phase 5f file layout.

---

## 1. Critical (P0) — fix before anything else

### 1.1 `searchOrders` reads the entire `ordenes_de_servicio` collection

`OrdenesService.searchOrders` at [services/ordenesService.js:256](public/js/services/ordenesService.js) does `db.collection("ordenes_de_servicio").get()` then filters client-side. Every quick-search (after Enter) costs N reads where N = total orders.

**Cost projection:**
At 10k orders × 30 searches/day × 8 users = **2.4M reads/day** in searches alone. Firestore is $0.06 per 100k reads → **~$45/month just for search**. At 50k orders the search itself will take 5+ seconds even before the cost issue.

**Fix (1–2 days):** add a `searchTokens: string[]` field on each order, populated on create/update via Cloud Function or `OrdenesService.upsert`. Tokens include order ID prefixes, normalized client-name tokens, and each equipo serial. Replace the full scan with:

```js
db.collection("ordenes_de_servicio")
  .where("searchTokens", "array-contains", normalizedToken)
  .limit(50);
```

One read pattern, indexed lookup, **constant cost regardless of collection size**. The existing `failed-precondition` fallback in `filterByStatus:332` is the precedent.

Migration: one-shot backfill script reads existing orders and writes their tokens. Same pattern as `backfill-contract-summaries.js`.

### 1.2 `cargarClientes` loads the entire `clientes` collection on every page load

[clientesService.js:12-28](public/js/services/clientesService.js) has no `.limit()`. Every staff member who opens the page pays N reads where N = total clientes.

**Cost projection:**
3k clientes × 30 page loads/user/day × 8 users = **720k reads/day** purely to populate a name lookup. **~$13/month** for what should be a denormalized field.

**Fix (4 hours):**
- **Option A (recommended):** denormalize. Store `cliente_nombre` on the order at write time. Already partially in place — `orden.cliente_nombre` exists as a fallback in [nombreClienteDe](public/js/pages/ordenes-state.js). Make it the source of truth, delete `cargarClientes` entirely.
- **Option B:** cache `clientesMap` in `localStorage` with TTL, invalidate via a `clientes/_meta.lastModifiedAt` doc updated by a CF on any cliente write.

Option A is cleaner. The `clientesMap` global is a 2018-era hack.

### 1.3 Mobile cards rendered in parallel with desktop table

[ordenes-render.js:228-278](public/js/pages/ordenes-render.js) builds **both** a desktop `<tr>` and a `.card-contrato` for every order. Both stay in the DOM. At 50 orders/page that is 100 row-equivalents in memory, half invisible. On a mid-range Android tablet this is noticeable.

**Fix (3 hours):** branch on `window.matchMedia('(max-width: 760px)').matches` and render only the active layout. Re-render on breakpoint change (debounce 150 ms).

### 1.4 `lucide.createIcons()` traverses entire document, called 3+ times per render

Called in [ordenes-data.js:156](public/js/pages/ordenes-data.js), [ordenes-render.js:330](public/js/pages/ordenes-render.js), [ordenes-render.js:481](public/js/pages/ordenes-render.js), plus on body init. Each call walks every node looking for `[data-lucide]`. This is the source of the visible icon flicker on each render.

**Fix (1 hour):** always pass a scoped `nodes` array — `lucide.createIcons({ nodes: [container] })` where `container` is the freshly-built fragment. Already done correctly once for `contradiccionBadge` at render.js:330; generalize that pattern.

---

## 2. Quick wins — high ROI, ≤ 1 day each

| # | Change | File | Effort | Impact |
|---|---|---|---:|---|
| QW1 | Replace `mostrarToast` with shared `Toast.show` everywhere | ordenes-ui.js + ~4 consumers | 30 min | Removes duplicate API |
| QW2 | Replace `showTextModal`/`showAlertModal` with shared `Modal.*` | ordenes-ui.js + ~6 consumers | 1 hr | Same |
| QW3 | Replace `prompt()` in `editarCampoEquipo` with `Modal.prompt` | ordenes-equipos.js | 30 min | `prompt()` is 1995-era UX |
| QW4 | Per-row click listener → table-level event delegation | ordenes-render.js:201 | 1 hr | −50 listeners/page |
| QW5 | Add `role="dialog" aria-modal="true" aria-labelledby` to `#modalAsignar` + focus trap | ordenes/index.html + small JS | 1 hr | A11y compliance |
| QW6 | Add `<th scope="col">` to orders table headers | ordenes/index.html | 5 min | Screen-reader correctness |
| QW7 | Add `aria-live="polite"` to `#resumenOrdenes` and `#mobileResumen` | render.js + html | 10 min | Announce filter changes |
| QW8 | Keyboard handler for row expansion (Enter/Space) | ordenes-render.js | 20 min | Keyboard-only users |
| QW9 | Move 17 inline `style="..."` attributes to CSS classes | ordenes/index.html | 1 hr | Maintainability |
| QW10 | Replace status-pill light backgrounds (`#fde2e2`, `#f9f2d0`) with WCAG-AA-passing pairs | ordenes-index.css | 30 min | Contrast |
| QW11 | Single skeleton-row component shown during initial load | new partial + JS | 2 hr | Perceived perf |
| QW12 | Remove `console.log` markers (`[ordenes-state.js] …`) from production | 10 files | 5 min | Cleanliness |
| QW13 | Use `APP.state.userId` instead of `firebase.auth().currentUser?.uid` | filters.js:83 | 1 min | Consistency |
| QW14 | Intersection observer auto-load near bottom; keep button as fallback | new file | 2 hr | Modern UX |
| QW15 | Empty-state UI: icon + "No hay órdenes con este filtro" + "Limpiar filtros" CTA | render.js | 30 min | UX polish |

QW1–QW4 together remove ~400 lines of legacy code and visibly speed up the page.

---

## 3. Architecture — medium refactors (1–3 days each)

### 3.1 Real-time updates via `onSnapshot`

The page re-fetches on every state change (assign, complete, deliver) with `setTimeout(... 1000); cargarOrdenesYEquipos(true)`. The timeout is a code smell — it is waiting for the Cloud Function to settle. Replace the initial load with `onSnapshot` and the UI reflects writes immediately; two staff members editing the same orden see each other's changes; the 1 s `setTimeout` disappears.

Cost: snapshot listeners count as 1 read + 1 per change. For active sessions net is roughly equal to current polling; for idle sessions it is lower. The UX win is significant.

### 3.2 Compat → modular Firebase SDK

You ship ~900 KB of Firebase compat. Modular SDK + tree-shaking + a Vite/esbuild build cuts to ~250 KB. This is a real refactor (every `firebase.X()` call site changes) but `firebase-init.js` plus the service layer are the natural seams. **Do this when you add a build step for anything else.** Do not introduce a build step just for this.

### 3.3 Service worker + offline-first reads

Telecom field techs lose connectivity. A service worker caching the last 100 orders + static assets means the app keeps working out of coverage. Firestore SDK has `enablePersistence()` already — verify it is actually called and not failing silently in Safari (it does fail there).

### 3.4 Pagination strategy: cursor + page size from role

Currently 50 fixed. Admin browses sequentially; técnico opens to their assigned 5 orders. Page-size by role is already in the contratos pattern (`PAGE_LIMIT_BY_ROLE` in [contratos-state.js:16](public/js/pages/contratos-state.js)). Apply the same pattern here. **30 min.**

### 3.5 The `EmpresaService` bug

`cargarTiposDeServicioFiltros` references `EmpresaService.getDoc("tipo_de_servicio")` but `empresaService.js` is **not loaded by `ordenes/index.html`**. The function silently falls through to the hardcoded fallback `["PROGRAMACIÓN", "VISITA TÉCNICA", "ENTRADA", "OTRO"]`. Users have probably been seeing static options for months. Either load the script or delete the dead branch.

### 3.6 The `cambiarOrden` bug

`document.getElementById("APP.state.sortField")` — literal-string ID lookup that can never match. The function throws on any call. Either it is never called (delete it) or someone is silently catching the error. Check for a sort-field `<select>` in the HTML; if none, delete.

---

## 4. UI / UX / Look & Feel

### 4.1 What looks outdated

- **"Cargar más" button** is a 2014 pattern. Modern apps auto-load on scroll with a small "X órdenes cargadas" footer.
- **`prompt()` dialog** in equipment field edits is genuinely embarrassing for a B2B product. Browser-native, unstyled, no validation, no Cancel-as-Escape on mobile.
- **Advanced-filters accordion** (`#filtrosAvanzados` chevron) hides the search-by-serial input behind an extra click. Real telecom workflow: tech scans a serial → searches. That should be the primary input, not hidden.
- **Estado pill** is now squared (good) but the colors are very light pastels on white. They read as "decorative" rather than "informative." Modern equivalents either use a colored left bar + bold text (no fill) or solid filled chips with high-contrast text.
- **First cell** crams 4 visual elements (chevron + dot + order ID + fotos badge) into ~10% column width. Hard to scan.
- **No empty state.** A blank table with a "No se encontraron coincidencias" text row is jarring.
- **No skeleton.** Spinner-only loading pre-dates 2018.
- **Tooltips on hover** with no mobile equivalent. Long-press should at minimum show the tooltip on touch.
- **No keyboard shortcut palette.** Ctrl+K focuses search; add `?` to open a full cheatsheet. Power users (admin, recepción) will love it.

### 4.2 Visual hierarchy — proposed row redesign

Right now everything has equal weight. The table is dense, no rhythm, no anchor point. A staff member glancing at the page cannot immediately see "5 orders need attention."

Three visual tiers per row instead of an 8-column flat table:

```
┌─────────────────────────────────────────────────────────────────┐
│ ORD-0421  Acme Telecom                              POR ASIGNAR │ ← Tier 1: ID + Cliente + Estado (bold)
│ Reparación · Juan Pérez · Entrega: 15 May                       │ ← Tier 2: Tipo + Técnico + Entrega (muted)
│                                          [Asignar]  [⋯]         │ ← Tier 3: Action (right-aligned, only when applicable)
└─────────────────────────────────────────────────────────────────┘
```

Two-row card-style. Less density per row, much faster visual scan. Tested pattern in Linear, Plain, Height, and most modern queue-management tools.

Keep the table as an opt-in for power users via a `Table | Cards` toggle in the topbar.

### 4.3 Filter UX — chip filters

Replace the dual desktop-form + mobile-drawer with **chip filters** at the top:

```
[All 152]  [Por asignar 14]  [Asignado 23]  [Completado 8]  [Entregado 107]
                                                              ↑
                                              (the badge counts you already compute)

[Mis órdenes ●]  [Tipo ▾]  [Técnico ▾]  [Limpiar]      🔍 Buscar...
```

- Estado is a chip row, not a `<select>`. Click = filter. Active chip is filled.
- "Mis órdenes" becomes a chip, not a hidden checkbox.
- Tipo and Técnico stay as dropdowns.
- Search stays as a single input combining serial/orden/cliente.
- The "Filtros avanzados" accordion goes away.

This collapses the ~250 px filter card to a ~50 px chip bar. Identical on mobile.

### 4.4 Typography

System font stack is fine. You do not need a custom font. But:
- Order ID, client name, estado → **semibold, slightly larger**
- Tipo, técnico, fecha → muted (`#6b7280`)
- Right now everything is the same weight.

### 4.5 Color contrast

The light pastel `estado-pill` backgrounds (`#fde2e2`, `#f9f2d0`) with text colors `#92400e` / `#7a5b11` — verify with the WebAIM contrast checker. The amber-on-pink combinations are at the edge of AA.

---

## 5. Workflow — operational improvements

Drawn from the action-handlers inventory and the daily-use workflow.

### 5.1 Bulk operations

Right now everything is per-order. Add a checkbox column + bulk-actions toolbar:
- Bulk re-assign to técnico
- Bulk print
- Bulk export CSV
- Bulk archive

A recepción staff member assigning the day's incoming orders should not click "Asignar" 20 times.

### 5.2 Saved filter presets

"Pendientes de hoy", "Mis vencidas", "Sin contrato" — give admins the ability to save a filter combination as a named preset. Easy once filter state is in the URL (see 5.4).

### 5.3 Live counters in the topbar

Replace the resumen-button text "Resumen: 152 · Todos" with a small live badge cluster. Combined with `onSnapshot` it becomes a live ops dashboard.

### 5.4 URL state

Filters are not in the URL. Refresh = filter loss. Copy-paste-link to a colleague = does not work. Encode `?estado=POR_ASIGNAR&tecnico=juan` in the URL. **2 hours, large UX dividend.**

### 5.5 Quick actions on hover

Action buttons are currently always visible in every row. Modern table UX: actions appear on row hover, reducing visual clutter. The Asignar button being permanently visible contributes to noise.

### 5.6 Serial-first search workflow

The most common workflow is "tech scans a serial." Surface it:
- Auto-focus the search input on page load when no filter is active
- Add a "Scan" button next to search that opens the device camera (BarcodeDetector API, supported in Chrome on Android — minimal effort, huge value for techs)

### 5.7 Audit log in expanded row

When you expand an order, the current view shows equipment. Add a third tab/section: timeline of state changes (asignado → completado → entregado, with timestamp + user). Staff often need this to answer "when did this orden last move?"

---

## 6. Prioritized roadmap

**Week 1 — Stop the bleeding (P0)**
1. Add `searchTokens` to order writes + migrate search to indexed query *(1 day + backfill)*
2. Denormalize `cliente_nombre` on order; delete `cargarClientes` *(half day)*
3. Scoped `lucide.createIcons` *(1 hour)*
4. Stop rendering mobile cards on desktop and vice versa *(3 hours)*

**Week 2 — Quick wins batch**
- QW1–QW15 from §2 (1 day total)
- Fix `EmpresaService` and `cambiarOrden` bugs (§3.5–§3.6)

**Week 3–4 — UX overhaul**
- Chip filter bar (§4.3)
- Card-style row redesign (§4.2)
- Empty + loading skeleton states
- Keyboard shortcut palette
- URL filter state (§5.4)

**Month 2 — Architecture**
- `onSnapshot` live updates (§3.1)
- Bulk operations toolbar (§5.1)
- Saved filter presets (§5.2)
- Service worker for offline reads (§3.3)
- Serial scanner via BarcodeDetector (§5.6)

**Quarter — Larger investments**
- Compat → modular Firebase SDK (§3.2) — only if adding a build step anyway
- Algolia or Typesense if `searchTokens` proves insufficient at scale
- Real-time collaboration indicators ("Juan is editing this orden")

---

## 7. What to cut from the current implementation

- `mostrarToast` function (use `Toast.show`)
- All three local modal functions (`showTextModal`, `showAlertModal`, `createTextModal`)
- The `// END OF PART 1/3` marker comments (dead reference to the old monolith structure)
- The "Avanzado" filter accordion
- The "Cargar más" button (replace with infinite scroll)
- The mobile-cards layout (replace with a responsive single layout)
- The `clientesMap` global
- `cargarClientes` itself

Each of these is a thing you currently maintain that has a better replacement already in your codebase or a 1-day path to remove.

---

## 8. Honest bottom line

The page works. It is not embarrassing. But it is a typical Firebase-compat-from-CDN app that grew organically and never had a designer or a senior FE engineer push back. The one thing that would lose me sleep if this were my company:

**The Firestore bill curve.** At your current data shape (small) it is fine. At 5× your current orders you have a real problem. The search and clientes-load patterns scale linearly with collection size.

Everything else is polish-and-iterate. Start with §1 + §2.
