# Ordenes Index — Improvement Strategy

> **Scope:** the `public/ordenes/index.html` page and its supporting modules (`public/js/pages/ordenes-*.js`, `public/css/ordenes-index.css`) plus the services they depend on (`ordenesService.js`, `clientesService.js`).
>
> **Status (2026-05-18):**
> - **Tier 1 P0 (§1.1, §1.2, §1.3, §3a.2) — shipped.** See `CHANGELOG.md` commits `2700b61`, `8d71a93`, `07cdae7`, `8b0ade6`. Search cost dropped from O(collection) to O(matches); `cargarClientes` removed; mobile/desktop layouts no longer both render; `storage.rules` in the repo.
> - **Tier 2 quick wins (QW1–QW16) — shipped.** All sixteen items either landed or noted as already-resolved. Commits `69d685a` (QW1–8 + 12–13 + 16 batches), `95c933a` (QW10, QW15), `76b9b00` (QW9), `51c7071` (QW4, QW5), `a65ae7d` (QW11), `d0ed77f` (QW14).
> - **§3a entrega-flow** — partially shipped: §3a.4 (email XSS), §3a.5 (retina canvas), §3a.6 (ID compression), §3a.9 (`os_logs` docs), §3a.10 (dup timestamps) all in `69d685a` / `2700b61`. Outstanding: §3a.3 (PII retention CF), §3a.7 (SVG signature, optional), §3a.8 (entrega split — defer until next feature), §3a.11 (entrega → `Modal.open`), §3a.12 (server-side email render).
> - **Tier 3 architecture** — open: §3.1 (`onSnapshot` live updates), §3.2 (modular Firebase SDK, gated on build step), §3.3 (`enablePersistence` verify), §3.5 already done in commit `8a4de2b`. §3.4 (page-size by role) shipped in `69d685a`. §3.6 (`cambiarOrden` bug) shipped in `69d685a`.
> - **Tier 4 UX overhaul (§4.x, §5.x)** — not started.
>
> **Earlier CSS-only work:** the `212f3af` token-bridge commit and follow-ups documented in `CSS_IMPROVEMENTS.md` §10.
>
> **Last refreshed:** 2026-05-18.

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
| QW10 | Replace status-pill light backgrounds with the design-system AA pairs (see §4.5) | ordenes-index.css | 30 min | Contrast |
| QW11 | Single skeleton-row component shown during initial load | new partial + JS | 2 hr | Perceived perf |
| QW12 | Remove `console.log` markers (`[ordenes-state.js] …`) from production | 10 files | 5 min | Cleanliness |
| QW13 | Use `APP.state.userId` instead of `firebase.auth().currentUser?.uid` | filters.js:83 | 1 min | Consistency |
| QW14 | Intersection observer auto-load near bottom; keep button as fallback | new file | 2 hr | Modern UX |
| QW15 | Empty-state UI: icon + "No hay órdenes con este filtro" + "Limpiar filtros" CTA | render.js | 30 min | UX polish |
| QW16 | Adopt `--ring-focus` / `--ring-error` tokens; apply `:focus-visible { box-shadow: var(--ring-focus) }` globally | ceco-ui.css | 15 min | Visible focus for keyboard users |

QW1–QW4 together remove ~400 lines of legacy code and visibly speed up the page.

> **Prerequisite for QW10, §4.2, §4.3, §4.5, QW16:** the **Week 0 token bridge** in §6 lands `--sp-*`, `--radius-*`, `--fg-*`, `--ring-*` from the Cecomunica Design System into `ceco-ui.css` first. Otherwise these tickets reinvent values that the design system already publishes.

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

### 3.7 `ordenes-index.css` is 3,534 lines — bigger than typical, smaller than catastrophic

**Bytes are fine, lines aren't.** Current state:

| File | Lines | Raw | Gzipped (est.) |
|---|---:|---:|---:|
| `ordenes-index.css` | 3,534 | 67 KB | ~9–11 KB |
| `ceco-ui.css` (shared) | 1,137 | 41 KB | ~6–7 KB |
| **Total CSS per ordenes hit** | | **~108 KB** | **~16–18 KB** |

For comparison: Bootstrap 5 ~25 KB gzipped, GitHub per-route ~50 KB gzipped, a Tailwind-built page ~20–30 KB gzipped. Over-the-wire size is **normal-to-low**. CSS parse time at this volume is single-digit milliseconds. The browser is fine.

The problem is the **maintenance cost**. One page has 3× more CSS than the entire shared design system. The other page-CSS files are all small:

```
admin-equipos-cliente.css  →     91 lines
print-base.css             →    136 lines
ceco-ui.css                →  1,137 lines  (shared by every page)
ordenes-index.css          →  3,534 lines  (one page)
```

Realistic target after a focused pass: **1,800–2,400 lines**. What's recoverable, in rough categories:

| Source of bloat | Lines reclaimable |
|---|---:|
| Modal CSS that should live in `ceco-ui.css` (notas, text, alert, overflow menu) | ~400 |
| 80+ hardcoded hex values that would collapse under the `--status-*` / `--brand-*` / tipo-chip tokens | ~150 |
| 263 hardcoded `px` values vs. a `--sp-*` spacing scale (token bridge already in place) | ~150–200 |
| Verbose formatting (one declaration per line on rules with 2 declarations) | ~200 |
| Feature-letter labeled mini-rules (J–Y) that never got consolidated | ~300 |
| Mobile-only CSS that could share with desktop via different selectors | ~150 |

Total recoverable: **~1,200–1,400 lines without losing a single feature**.

**When to do this:** *not* as a standalone refactor. The natural moment is **during the UX overhaul** (Week 3–4 below — chip filters, card-row hierarchy, status-pill palette). That work will:
- Delete the legacy `.estado-pill` styles in favor of the design-system palette
- Replace the filter card with a chip bar (smaller CSS)
- Replace the table row layout with cards (different CSS, comparable size)
- Touch many of the same selectors the cleanup would touch

Doing token migration + structural cleanup *at the same time* as the redesign is much cheaper than doing them separately. As a standalone task it would be ~2 days; folded into the redesign it's ~half a day of incremental cleanup.

**Anti-pattern check:** the file is hand-written. No build step, no PostCSS, no CSS-in-JS. Every line is a deliberate choice. None of it is generated boilerplate. The size is purely a function of history.

---

## 3a. Entrega signature flow (added 2026-05-15)

The order delivery flow was just expanded into a custom modal with canvas signature capture, optional ID photo upload, and a "no recibido" branch. Implementation lives in [pages/ordenes-flujo.js:215-563](public/js/pages/ordenes-flujo.js#L215). The HTML modal is in `ordenes/index.html:203+`. **It is a substantial new feature with new infrastructure dependencies — and it adds its own technical debt.**

### 3a.1 Missing script tags — *fixed 2026-05-15*

The new code calls `firebase.storage()`, `MailService.enqueue()`, and `UsuariosService.getUsuario()`. None of those were loaded in `ordenes/index.html` until commit `e011110`. Same bug class as the `EmpresaService` issue (§3.5). **Pattern worth noting:** every time a service is added to the page modules, the HTML script-tag list needs a matching addition. Manual coordination is fragile. Once a build step exists, an `import` graph would catch this at build time.

### 3a.2 Storage rules are not in the repo

`storage.rules` does not exist alongside `firestore.rules`. The new flow writes to `ordenes_firmas/{ordenId}_firma_*.png` and `ordenes_identificacion/{ordenId}_id_*.{ext}`. Storage rules need to allow these writes for authenticated users (and ideally restrict deletes/reads to staff). **Action:** add `storage.rules` to the repo, deploy from there, mirror the §3.11 storage of `firestore.rules`. Required *before* anyone signs a delivery in production.

### 3a.3 PII without retention policy

The ID-photo upload to `ordenes_identificacion/` is a **photograph of a customer ID** — a clear PII class. There is no:
- Retention policy (when do these get deleted?)
- Access control beyond "any signed-in staff member"
- Encryption-at-rest beyond Firebase Storage default
- Audit log of who has viewed the photo
- Notice to the customer that the image is being stored

Panama doesn't have a GDPR-equivalent law (yet), but the company's clients in regulated sectors (ports, government) may demand a policy. **Action:** at minimum, document in a customer-visible doc that ID photos are stored and may be deleted on request. Ideally, add a CF that purges `ordenes_identificacion/` after N days from delivery.

### 3a.4 Email body is built with unsanitized template literals

[ordenes-flujo.js:404-447](public/js/pages/ordenes-flujo.js#L404) builds the email HTML via template strings inserting `receptorNombre`, `motivo`, `sinIdMotivo`, `personaInterna` — all user-controlled inputs — directly into HTML. If a malicious user types `<script>` or `<img src=x onerror=...>` in the receptor name, that injection lands in the email. SendGrid will strip script tags, but the more interesting attack is `<a href="phishing-url">Click here</a>` — clients will see a plausible-looking link in a legitimate-looking email from cecomunica.com.

**Fix (30 min):** escape user inputs before insertion. Reuse the `escapeHtml` helper that already exists in `pages/ordenes-state.js`:

```js
const safe = v => escapeHtml(String(v || '—'));
// then use ${safe(opts.receptorNombre)} everywhere instead of ${f(...)}
```

### 3a.5 Canvas signature is blurry on retina screens

[ordenes-flujo.js:251-264](public/js/pages/ordenes-flujo.js#L251) — `_resizeCanvas` sets `canvas.width = canvas.clientWidth || 300` and `canvas.height = 200`, ignoring `window.devicePixelRatio`. On a retina screen with DPR 2, the canvas backing store is 300×200 but CSS-rendered at 600×400 → 2× blur. The PNG uploaded to Storage is also 300×200 — a low-resolution capture of the customer's signature.

**Fix (15 min):**
```js
const dpr = window.devicePixelRatio || 1;
canvas.width  = canvas.clientWidth * dpr;
canvas.height = 200 * dpr;
canvas.style.height = '200px';
_ctx.scale(dpr, dpr);
```
Captures and stores at 2×–3× the pixel density. Same canvas surface, sharper signature.

### 3a.6 No file size limit on ID photo upload

[ordenes-flujo.js:505-512](public/js/pages/ordenes-flujo.js#L505) — accepts whatever file the user selects. A modern phone camera produces 4–6 MB JPEGs. Over 4G/3G that's a 10–30 second upload, with no progress indicator. Worse, after 1,000 deliveries `ordenes_identificacion/` is sitting on 4–6 GB of customer ID photos.

**Fix (1 hr):** client-side resize before upload. Draw the image into a hidden canvas at max 1280×1280, export as `image/jpeg` quality 0.85. Cuts file size 10–20×. Pattern:

```js
async function compressImage(file, maxDim = 1280, quality = 0.85) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.convertToBlob({ type: 'image/jpeg', quality });
}
```

### 3a.7 SVG signature would be better than PNG

PNG signatures are 5–20 KB per file. An SVG path (`<path d="M 10 20 L 11 22 ...">` captured during draw) would be 1–3 KB, **and** vector-perfect for legal/print purposes. Adopt this if the entrega flow becomes legally critical. ~3 hr of work — record the points during `start`/`move`/`end` instead of (or in addition to) rasterizing to canvas. Optional.

### 3a.8 The flow is 350 lines in `ordenes-flujo.js`

What was a 227-line module post-Phase-5f is now ~560 lines. Same growth pattern that produced the original 3,271-line monolith. **Suggestion:** when the entrega flow next needs a non-trivial addition (e.g. SVG signature, multi-signature, witness signatures), split into `pages/ordenes-entrega.js` following the Phase-5e convention. Coordinator in `ordenes-flujo.js` becomes a thin wrapper around `OrdenesEntrega.abrir(ordenId)`.

### 3a.9 `os_logs` field added without schema documentation

`firestore.FieldValue.arrayUnion({ action: 'ENTREGAR', by: user.uid })` writes to a new `os_logs` array on the order. Good audit-trail addition. **But:**
- This field is not in `ARQUITECTURA_CECOMUNICA.md` §5
- No CF reads/uses it yet
- Other transitions (asignar, completar) don't write to it — only entrega does
- Long arrays in Firestore have a 1 MiB per-doc limit; 1,000 deliveries × 50 bytes = manageable, but worth knowing

**Action:** document `os_logs` in `ARQUITECTURA §5.2` and either (a) write it for every transition consistently, or (b) drop it and use a dedicated `os_audit` subcollection instead (no doc-size cap).

### 3a.10 Duplicate timestamp fields

The flow writes both `entrega_ts: serverTimestamp()` (always) and `fecha_entrega: serverTimestamp()` (normal branch only). Pick one. The order schema already has `fecha_entrega` used elsewhere (filter card "Mostrar fecha entrega" toggle), so prefer that; drop `entrega_ts` or rename for a different semantic. Easy 5-min cleanup.

### 3a.11 No use of shared `Modal` API

The flow opens its modal via `APP.utils.show(modal)` and registers a custom backdrop click handler. This bypasses the shared `Modal.open / Modal.close` API in `js/ui/modal.js`. The `Modal.confirm` flow shows that the integration exists — entrega just doesn't use it. **Consequence:** Escape-to-close isn't wired the same way as other modals; focus-trap logic (when added) won't apply uniformly. Promote to `Modal.open('modalEntrega', { onEscape })` after Modal gets a focus-trap feature.

### 3a.12 The HTML email body could share a renderer with the CF-side

`functions/src/domain/emailRenderer.js` exists (per `ARQUITECTURA §6.1`) and renders email bodies on the server. The frontend just built its own inline template literal in `_buildEmailHtml`. Two implementations of the same concept. The frontend version sits in 70+ lines of template literals; the CF version probably has shared formatting helpers.

**Long-term:** move all email-body composition to the CF. The frontend's `MailService.enqueue` should send *structured data* (`type: 'nota_entrega'`, `data: { ... }`) and let `onMailQueued` render the HTML on the server using `emailRenderer.js`. Single source of truth for branding and i18n.

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

**Component spec** — copied verbatim from `Cecomunica Design System/preview/components-badges.html`. Drop into `ceco-ui.css`:

```css
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 12px;
  border-radius: var(--radius-md);
  font: 500 12px/1 var(--font-body);
  background: #fff;
  border: 1px solid var(--border-default);
  color: var(--fg-1);
}
.chip.active {
  background: var(--brand-soft);
  border-color: var(--brand);
  color: var(--brand-press);
}
```

Requires the Week-0 token bridge (`--radius-md`, `--border-default`, `--brand-soft`, `--brand-press`, `--fg-1`).

### 4.4 Typography

System font stack is fine. You do not need a custom font. But:
- Order ID, client name, estado → **semibold, slightly larger**
- Tipo, técnico, fecha → muted (`#6b7280`)
- Right now everything is the same weight.

### 4.5 Color contrast

The current pastel `estado-pill` pairs (`#fde2e2` / `#92400e`, `#f9f2d0` / `#7a5b11`) sit at the edge of WCAG AA. The Cecomunica Design System already publishes an AA-safe replacement palette in [Cecomunica Design System/preview/components-badges.html](Cecomunica%20Design%20System/preview/components-badges.html). Adopt these exact pairs:

| Estado actual | Background | Text | Dot color |
|---|---|---|---|
| `POR ASIGNAR` | `#FAE3E3` | `#8A1F1F` | `var(--status-critical)` `#D24545` |
| `ASIGNADO` | `#FAF1DB` | `#7A5510` | `var(--status-warning)` `#E0A93A` |
| `COMPLETADO (EN OFICINA)` | `var(--brand-soft)` `#E6F4FB` | `var(--brand-press)` `#001D2B` | `var(--brand)` `#0091D7` |
| `ENTREGADO AL CLIENTE` | `#E6F4ED` | `#0F6E47` | `var(--status-online)` `#1FA56B` |

Each pill renders as `[dot] LABEL` — the 6 px colored dot is part of the spec. Update both `.estado-pill.{por-asignar,asignado,completado,entregado}` in `ordenes-index.css` and the markup in `ordenes-render.js` to prepend `<span class="dot"></span>`.

Verified AA: all four background/foreground pairs above pass WCAG AA at the 13 px / semibold weight used by the pill.

---

## 5. Workflow — operational improvements

Drawn from the action-handlers inventory and the daily-use workflow.

### 5.1 Bulk operations — *not pursuing (2026-05-18)*

> **Decision:** out of scope. Operationally these orders are handled one at a time — staff confirmed there's no current workflow where bulk re-assign / bulk print / bulk export would speed things up. Re-evaluate if a sustained 10+-orders/day batch flow ever appears.

~~Right now everything is per-order. Add a checkbox column + bulk-actions toolbar:~~
~~- Bulk re-assign to técnico~~
~~- Bulk print~~
~~- Bulk export CSV~~
~~- Bulk archive~~

~~A recepción staff member assigning the day's incoming orders should not click "Asignar" 20 times.~~

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

**Week 0 — Token bridge from the design system** *(half day)*

Before any visual or a11y work begins, land the missing design-system tokens in `public/css/ceco-ui.css`. The Cecomunica Design System ships a 124-token system in `Cecomunica Design System/colors_and_type.css`; the app currently uses a ~22-token flat subset. The redesign tickets (QW10, QW16, §4.2, §4.3, §4.4, §4.5) all reference layers the app doesn't have yet.

Add (or alias) to `:root` in `ceco-ui.css`:

```css
/* Foreground hierarchy (currently only --text and --muted exist) */
--fg-1: #0E1418;   /* primary text / headings */
--fg-2: #2F3942;   /* body */
--fg-3: #6B7884;   /* secondary, captions */
--fg-4: #9AA7B4;   /* placeholder, disabled */

/* Border scale (currently flat --line) */
--border-subtle:  #EEF2F6;
--border-default: #DDE4EB;
--border-strong:  #6B7884;
--border-brand:   var(--brand);

/* Surfaces */
--brand-soft:  #E6F4FB;
--brand-press: #001D2B;

/* Status palette (currently flat --ok/--warn/--bad) */
--status-online:   #1FA56B;
--status-warning:  #E0A93A;
--status-critical: #D24545;

/* Spacing scale on 4px base */
--sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:20px;
--sp-6:24px; --sp-8:32px; --sp-10:40px; --sp-12:48px; --sp-16:64px;

/* Radii */
--radius-xs:2px; --radius-sm:4px; --radius-md:6px;
--radius-lg:10px; --radius-xl:16px; --radius-pill:999px;

/* Focus rings */
--ring-focus: 0 0 0 3px rgba(0, 145, 215, 0.30);
--ring-error: 0 0 0 3px rgba(210, 69, 69, 0.28);

/* Motion */
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
--dur-fast:    120ms;
--dur-base:    200ms;
```

Keep existing flat tokens (`--text`, `--muted`, `--line`, `--ok`, `--warn`, `--bad`) as aliases for backward compatibility — every page already references them.

No visual change is shipped this week. Token-adoption refactors of `ordenes-index.css` happen as part of the relevant later tickets (QW10, §4.2, §4.3, §4.5).

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
