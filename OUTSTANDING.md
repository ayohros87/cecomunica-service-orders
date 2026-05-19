# Outstanding Work

> **Purpose:** the single roadmap of work that's still TODO. Consolidates the live items from `ORDENES_INDEX_IMPROVEMENTS.md` + `REFACTOR_LOOK_FEEL.md` + `REFACTOR_STRATEGY.md` (all retired 2026-05-19). Shipped work lives in `CHANGELOG.md`; architecture-as-is lives in `ARQUITECTURA_CECOMUNICA.md`.
>
> **How to read this:** every item below is open. If you see it here, it has not shipped. Items are grouped by area, ranked within each section by impact × cost. Effort estimates assume one person working uninterrupted.
>
> **Last refreshed:** 2026-05-19 · §4.1–4.4 shipped · §2 audited · §3.1 colors+radii shipped · §3.3 mono IDs shipped · §3.4 button icons shipped · §3.8 shipped.

---

## 1. Backend correctness

Audited 2026-05-19, then §1.2–§1.5 shipped in commit `4a12b27`. Only one optional item remains.

### 1.1 Optional cache-pipeline consolidation *(quality-of-life, not a bug)*
The original cache trigger CREATE/UPDATE/DELETE bug is **fixed** — `functions/src/triggers/ordenes/onWriteCacheSync.js:6` uses `onDocumentWritten` and the branches at lines 24/28/32 are all reachable. `os_count` and `equipos_total` no longer drift.

What's still worth doing eventually: collapse the **two surviving cache-write paths** (`onContratoOrdenWrite` delta + `recalcularCacheContrato` full recompute) into one idempotent `rebuildContractCache(contratoId)`. Both write the same fields with no per-doc lock; concurrent firings can race. Today the delta path is correct in steady state, so this is hygiene, not a fix. 3–5 days when the next deeper backend touch happens anyway.

---

## 2. Frontend architecture

### ~~2.1 Service layer is half-built~~ ✅ shipped 2026-05-19
All 11 services exist and are wired in: `contratosService`, `mailService`, `cotizacionesService`, `inventarioService`, `piezasService`, `pocService`, `usuariosService`, `ordenesService`, `clientesService`, `empresaService`, `modelosService`. Raw `db.collection()` calls in page scripts and HTML are now zero — only the service files themselves and `firebase-init.js` (auth init) use them directly. The two remaining raw reads in `verify/index.html` and `verificar-contrato.html` are single `verificaciones` reads on a public collection; they are tracked under §2.5.

### ~~2.2 Role enum is not centralized~~ ✅ shipped 2026-05-19
`public/js/core/roles.js` exists with the canonical `window.ROLES` enum (all 9 roles) and `window.canRole(rol, accion)` predicate backed by a full `_PERMISOS` map. Pages load it via `<script src="/js/core/roles.js">` before their module scripts.

### 2.3 Compat → modular Firebase SDK
~900 KB of Firebase compat shipped today. Modular SDK + tree-shaking + a Vite/esbuild build would cut to ~250 KB. Real refactor (every `firebase.X()` call changes), but the service layer is the natural seam. **Do this only when a build step is being added for another reason.** Don't introduce a build step just for this.

### 2.4 Service worker / `enablePersistence` verification
Firestore SDK's `enablePersistence()` is wired in `firebase-init.js`. Verify it actually applies in Safari (it fails silently there with ITP-style storage restrictions). A real service worker caching the last 100 orders + static assets would let field techs keep working out of coverage — separate, larger project from `enablePersistence`.

### 2.5 Public verification page uses authenticated init
`verify/index.html` is supposed to work without login (the whole reason `verificaciones` has `allow read: if true`). But it loads `firebase-init.js` which calls `setPersistence(LOCAL)` and `enablePersistence`. It doesn't call the auth check, so it won't redirect — but unrelated browser-storage failures (Safari ITP, third-party cookie blocks) still affect a public page that has no need for auth. Fix: extract a minimal `firebase-public.js` for the verify page that initializes only Firestore.

### ~~2.6 Duplicate `verify/firebase-init.js`~~ ✅ shipped 2026-05-19
`public/verify/firebase-init.js` deleted. `verify/index.html` correctly loads `/js/firebase-init.js`.

### ~~2.7 Migration tools live in `public/`~~ ✅ shipped 2026-05-19
All migration tools are in `public/tools/` and `firebase.json` `hosting.ignore` already includes `"tools/**"`. They are excluded from the deployed bundle.

### 2.8 Phase 5g — finish script decomposition
Page scripts that haven't been split into namespace files yet (lower priority since they're already <800 lines):

| File | Lines | Notes |
|---|---:|---|
| `piezas.js` | 740 | Good candidate for `window.Piezas` |
| `clientes-index.js` | 552 | Still global functions |
| `fotos-taller.js` | 526 | Still global functions |
| `editar-orden.js` | 424 | Still global functions |

Plus HTML pages still carrying >300 lines of inline script (Tier 1 from Phase 5a): `clientes/index.html`, `ordenes/editar-orden.html`, `cotizaciones/editar-cotizacion.html`, `contratos/imprimir-contrato.html`, `ordenes/nueva-orden.html`, `ordenes/agregar-equipo.html`, `inventario/index.html`, `cotizaciones/nueva-cotizacion.html`, `inventario/modelos.html`.

### 2.9 Manual script-tag coordination is fragile
The bug class hit four times so far: page-local code calls a service whose `<script src>` isn't in that page's HTML. Most recent: `fotos-taller.html` missing `ordenesService.js` + `usuariosService.js` (fixed 2026-05-19). Earlier: `EmpresaService`, `MailService`, `firebase.storage()` in the entrega flow. A build step would catch this at build time via the import graph — until then, every new service call needs a matching script-tag audit.

### 2.10 Entrega flow split (deferred)
`public/js/pages/ordenes-flujo.js` is currently ~560 lines (was 227 post-Phase 5f). The entrega flow drove most of the growth. Defer the split until the next entrega feature lands; then move it to `ordenes-entrega.js` and have `ordenes-flujo.js` become a thin coordinator (`OrdenesEntrega.abrir(ordenId)`).

---

## 3. CSS / design system

### 3.1 Token enforcement across pages (Phase 1) — *mostly shipped 2026-05-19*

Hardcoded colors + off-spec radii — **shipped** in commits `2bb2de8`, `12393ab`, `61b1782`:
- **Colors:** 14 Tailwind-blue / cool-gray hex codes replaced with semantic tokens across 19 files. New token family added to `ceco-ui.css`: `--accent` / `--accent-hover` / `--accent-press` / `--accent-soft` / `--accent-soft-hov` / `--accent-soft-strong` / `--accent-line` / `--navy-hover` / `--navy-deep`. The Tailwind-violet-blue family was the original anchor — the migration intentionally shifts those surfaces to CeComunica cyan (`#0091D7`) so the app matches the design system.
- **`--brand` semantics flipped (Phase C):** `--brand` now resolves to corporate navy `#0B2A47` and `--accent` carries the interactive cyan, matching the design-system tokens file. Backward-compat aliases (`--brand-hover`, `--brand-2`) remain pointing to navy. Visual diff at flip time was zero because every production callsite was already on `var(--accent)`.
- **Radii:** 50+ hand-written values snapped to the token scale. Cards now use `--radius-lg` (10px), modals `--radius-xl` (16px), badges/pills `--radius-pill`.

**Still open:** delete inline `<style>` blocks that simply redeclare base rules. Audit revealed 18 files extend `.btn.primary` / `.btn.secondary` / `.badge` etc. — but they're not pure redeclarations, they're *page-specific overrides* (custom gradients, secondary palettes, badge variants). Removing them safely requires a design call: should the "gradient primary button" become canonical in `ceco-ui.css`, or stay per-page? Defer to a focused pass when the topbar/layout work (§3.2) lands and the canonical button styles get revisited anyway.

### 3.2 Shared topbar/layout (Phase 2)
Topbar is copy-pasted with subtle variations across 13 pages. Plan: `public/js/core/layout.js` exporting `Layout.renderTopbar({ title, actions, showHome })`. Replace every hand-written `<div class="topbar">…</div>` with a mount div + `Layout.renderTopbar()` call. Apply the same pattern to empty-state, skeleton-row, and "Cargar más" footer.

### 3.3 Typography hierarchy (Phase 3) — *partly shipped 2026-05-19*

**Shipped:**
- The `cc-*` utility classes are present in `ceco-ui.css` (`cc-display-xl`/`l`/`m`, `cc-h1`–`cc-h4`, `cc-body-l`/`body`/`s`, `cc-caption`, `cc-eyebrow`, `cc-mono`).
- Topbar `h1` / `.topbar-title` already uses `var(--font-display)` (Barlow). Confirmed in `ceco-ui.css:443`.
- `.mono` utility now also enables `font-feature-settings: "tnum" 1` so numerical IDs align in columns.
- A site-wide CSS rule (no per-page edits) applies the mono treatment to canonical identifier elements: `input[readonly]#orden_id` / `#contrato_id` / `#numero_de_serie`, `.numero-orden`, `.orden-id`, `.contrato-id`, `.contrato-numero`, `.serial-number`, and `[data-campo="numero_de_serie"] .valor-primario`.
- `.orden-numero` in `ordenes-index.css` now also carries `var(--font-mono)`.

**Still open:** apply `cc-eyebrow` + `cc-h1`/`cc-h2` to section/modal headers across pages (the "eyebrow + display heading + 1-sentence intro" pattern from the design system). This is per-page design work, not mechanical CSS — defer to the §3.2 topbar/layout pass where headers get redesigned anyway.

### 3.4 Iconography migration (Phase 5) — *partly shipped 2026-05-19*

**Shipped:** the emoji-as-button-icon callsites — what the design system explicitly bans. `login.html` (5: 📡 🛠️ 📦 📝 👁️ → `radio-tower`/`settings-2`/`package`/`file-text`/`eye`), `perfil.html` (2: 👤 🚪 → `user`/`log-out`), `piezas.js` (6 button icons in the inventory table), `to-equipos.js` (5 in the work-order panel), `contratos-equipos.js` (3 including the package-count badge). Each affected file also gained `lucide.createIcons({ nodes: [container] })` after the relevant render so dynamically-inserted icons hydrate.

**Intentionally left:** emoji in toast messages (`Toast.show("✅ Saved")`), `console.log`/`console.error`, and the in-page "🎯 ¡Orden completada!" celebration notification. These are transient feedback, not persistent UI; ✅/❌/⚠️ as status markers in console + toast contexts is universally legible and not what the design system targets. The two ✅/❌ checkmark columns in `imprimir-orden.js`'s printable accessory table are also kept — printed-document context, not screen UI.

Reference mapping (used elsewhere in the codebase already):

| Emoji | Lucide | Usage |
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
| 🟢🟡🔴 | `.dot.green/yellow/red` | Status dots (already in `ceco-ui.css`) |

Pattern: `textContent = "✏️ Editar"` → `innerHTML = '<i data-lucide="pencil"></i> Editar'`, then call `lucide.createIcons({ nodes: [element] })`.

### 3.5 Navigation modes + container tiers (Phase 6)
Today some pages show a back button, some "Menú principal", some both, some neither — ad-hoc. Container width varies (1100 / 1280 / none) by page improvisation. Four canonical patterns:

| Mode | Pages | Topbar |
|---|---|---|
| **Module index** | `ordenes/index`, `contratos/index`, etc. | `showHome: true`, `showLogout: true`, primary action. **No back.** |
| **Detail / Edit** | `editar-orden`, `editar-cotizacion`, etc. | `back: 'Volver'`, `showHome: false` |
| **Workflow child** | `cotizar-orden`, `firmar-entrega`, `fotos-taller` | `back: 'Volver a la orden'` |
| **Print / utility** | `imprimir-orden`, `nota-entrega` | No `Layout.renderTopbar`. Standalone toolbar. |

Container tiers — declared by class, no inline `max-width`:
- `.app-wrap--narrow` 720px (forms, signatures)
- `.app-wrap--default` 1100px (most pages)
- `.app-wrap--wide` 1400px (`ordenes/index`, `POC/index`)
- `.app-wrap--full` 100% (dashboards)

Plus: spacing roles (`--sp-2`/3/4/5/8 each assigned to a structural concept); responsive table modifiers (`--sticky`, `--compact`, `--cards`); breakpoint harmonization at 760 / 1024.

### 3.6 Print pages standardization (Phase 7)
`imprimir-orden.html`, `imprimir-cotizacion.html`, `imprimir-contrato.html` each have their own embedded styles. Extract a shared `public/css/print-base.css` (already exists, expand) with page margins, header/footer layout, brand band, font import. Apply Barlow to headings, IBM Plex Mono to technical IDs. Real logo asset in the print header.

### 3.7 `ordenes-index.css` follow-ups (from §3.7 cleanup)
The 2026-05-19 cleanup shipped 4,362 → 3,315 lines but left:
- **`@media (max-width:768px)` deep merge** — ~150–200 lines reclaimable from the two big blocks at lines ~1260 and ~2615. Needs a DevTools cascade audit at 760/770/1024 — not safe mechanically.
- **`px → --sp-*` migration** — ~340 values match the spacing scale exactly. No line-count payoff; do as a focused pass when adding new spacing tokens or theming.

### ~~3.8 Email template branding mismatch~~ ✅ shipped 2026-05-19
`functions/templates/email-base.html` updated in commit `859d67b` — header band, CTA button (HTML + VML), button-hover state, dark-mode header/button overrides, and footer link colour all swapped from teal `#0ea5a3` to CeComunica brand cyan `#0091D7`.

---

## 4. UX polish

~~### 4.1 Mobile tooltip equivalent~~
~~Tooltips work on hover only. Long-press should show the tooltip on touch. Small effort.~~
**Shipped 2026-05-19** — `_initTouchTooltips()` in `ordenes-index.js`. 500 ms hold on any `[title]` element shows a floating tooltip; dismissed on `touchend`/`touchmove`/`touchcancel`.

~~### 4.2 Keyboard shortcut palette~~
~~Ctrl+K focuses search; `?` opens a cheatsheet (filters, navigation, common actions). Power-user feature — admins and recepción will use it daily.~~
**Shipped 2026-05-19** — `?` key (non-input context) opens `_showShortcutsModal()` in `ordenes-index.js`. Modal lists Ctrl+K, ?, Esc, Enter shortcuts with `<kbd>` styling. Ctrl+K was already wired; Esc now checks for the shortcut modal before other overlays.

~~### 4.3 Live counters in the topbar (`§5.3`)~~
~~Replace "Resumen: 152 · Todos" button text with a small live badge cluster (POR ASIGNAR / ASIGNADO / COMPLETADO / ENTREGADO with counts). Counts are already live in the chip bar after the §4.3 redesign; topbar version is a 30-min wiring exercise.~~
**Shipped 2026-05-19** — `#topbarBadges` cluster added to `ordenes/index.html` topbar. `actualizarResumen` in `ordenes-render.js` now also updates `#tbPorAsignar` / `#tbAsignado` / `#tbCompletado` / `#tbEntregado`. Hidden at `≤900 px`. Clicking any badge triggers the existing `filtrar-badge` action.

~~### 4.4 Serial-first scan workflow (`§5.6`)~~
~~Most common workflow: tech scans a serial. Add auto-focus the search input on page load when no filter is active. "Scan" button next to search that opens the device camera (BarcodeDetector API, Chrome on Android). Reads the serial straight into the search field. Minimal effort, big value for techs.~~
**Shipped 2026-05-19** — `_autofocusSearchIfIdle()` focuses `#filtroRapido` 300 ms after initial data render when no URL filter params are present. `#btnScanSerial` (hidden by default) revealed when `'BarcodeDetector' in window`; `_scanSerial()` opens a fullscreen camera overlay, reads on first barcode hit, inserts into `#filtroRapido`, and calls `filtrarRapido()`.

### 4.5 Customer-facing PII retention notice
The `purgePIIRetention` CF is in place (manual-only) and clears `identificacion_url` after 90 days. Still missing: a customer-visible doc that ID photos are stored and may be deleted on request. Required if regulated-sector clients (ports, government) ever ask. Coordinate with whoever writes legal/customer comms.

---

## 5. Ops, security, hygiene

### 5.1 No tests, no CI, no linting
`functions/package.json` declares `firebase-functions-test` but no test scripts. `jsconfig.json` exists but no type checking. No CI config. Minimum: GitHub Actions running `eslint`, `firebase deploy --only firestore:rules --dry-run`, `node -c` on `functions/index.js`. Beyond minimum: unit tests for services + `domain/totales.js` + `domain/contratoState.js`; integration tests for the contract approval cascade against the Firebase emulator (`firebase-functions-test` is already a dependency).

### 5.2 Observability
A small ops dashboard surfacing `mail_queue.status === "error"`, CF error rates, and `os_dirty` counts. Stops the "we noticed the contract didn't email" reports from being our error-detection mechanism.

### 5.3 Documentation hygiene
`ARQUITECTURA_CECOMUNICA.md` is the canonical architecture doc. `CHANGELOG.md` is the canonical activity log. `OUTSTANDING.md` (this file) is the canonical roadmap. The legacy docs were retired 2026-05-19:
- `ORDENES_INDEX_IMPROVEMENTS.md` — folded in (most items shipped; outstanding moved here)
- `REFACTOR_LOOK_FEEL.md` — folded in (none of the 7 phases have started; all here)
- `REFACTOR_STRATEGY.md` — folded in (Phase 0 partially done; Phase 1+ here)
- Plus historical: `CONTRACT_SUMMARIES_OPTIMIZATION.md`, `DEEP_IMPROVEMENTS_ALL_PAGES.md`, etc. — also candidates for retirement once their items are verified shipped or moved here.

---

## 6. Critical paths — touch only with care

Do **not** refactor these in early phases. Backward compatibility is non-negotiable.

1. **Contract verification flow** — `/c/{docId}?v={code}` and `verificaciones/{docId}`. Consumed by URLs already issued to customers and printed on PDFs that have left the building. Any change to docId, code generation, or HMAC payload **invalidates existing signed contracts**.
2. **`firma_hash` payload format** — `${contratoId}|${aprobadorUid}`. Same reasoning. Add new fields; never change the existing one.
3. **`mail_queue` document shape** — multiple writers, one reader. Add fields; never remove.
4. **`usuarios/{uid}.rol` field** — every page reads it. New role values added cautiously, only after every consumer accepts them.
5. **Order / contract document IDs** — used as verification IDs in some places. `contrato_id` (`CT-YYYY-NNN`) and `numero_orden` are user-facing in emails and PDFs.
6. **PDF template `functions/templates/imprimir-contrato.html`** — legal document. Additive edits only.
7. **Cloud Function names** — renaming triggers a CF rebuild with a brief gap between detach + attach. Hot triggers (`onMailQueued`, `onOrdenWriteSyncContratoCache`) rename only in low-traffic windows.

---

## 7. Decisions on file — not pursuing

| Item | Decision | Reason |
|---|---|---|
| `§5.1` Bulk operations on ordenes | Not pursuing (2026-05-18) | Orders managed one at a time today. Re-evaluate if sustained 10+/day batch flow appears. |
| `§3a.7` SVG signature on entrega | Not pursuing (2026-05-18) | PNG with DPR scaling (`§3a.5` shipped) is sufficient. Re-evaluate only if entrega becomes legally critical (notarized receipts, court-admissible delivery proof). |
| `§3a.3` Scheduled cron for PII retention | Converted to manual callable (2026-05-18) | Stakeholders want to review before any first run. Revert to `onSchedule` once retention policy is signed off + customer-visible doc exists. |

---

## Where to find shipped work

- **`CHANGELOG.md`** — every commit / batch annotated, newest at top. Search for §-numbers (e.g. `§4.2`) to find when an item landed.
- **`ARQUITECTURA_CECOMUNICA.md`** — current architecture, not aspirational. Updated whenever a shipped change altered the topology.
- **`CSS_IMPROVEMENTS.md`** — earlier token-bridge work (predates this consolidation; may also retire once verified).
