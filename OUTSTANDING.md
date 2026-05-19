# Outstanding Work

> **Purpose:** the single roadmap of work that's still TODO. Consolidates the live items from `ORDENES_INDEX_IMPROVEMENTS.md` + `REFACTOR_LOOK_FEEL.md` + `REFACTOR_STRATEGY.md` (all retired 2026-05-19). Shipped work lives in `CHANGELOG.md`; architecture-as-is lives in `ARQUITECTURA_CECOMUNICA.md`.
>
> **How to read this:** every item below is open. If you see it here, it has not shipped. Items are grouped by area, ranked within each section by impact × cost. Effort estimates assume one person working uninterrupted.
>
> **Last refreshed:** 2026-05-19.

---

## 1. Backend correctness — fix first

### 1.1 `onContratoOrdenWrite` is registered as `onDocumentUpdated` but branches on CREATE / DELETE
The CREATE and DELETE branches are unreachable because `onDocumentUpdated` only fires on updates. Consequence: `os_count` and `equipos_total` drift on the parent contract until a soft-delete or cross-contract move forces `recalcularCacheContrato`. The existence of `os_dirty`, `backfill-contract-summaries.js`, and `rebuild-all-contratos-cache.js` is the workaround for this single bug.

**Hotfix (1 line):** change `onDocumentUpdated` → `onDocumentWritten` in `functions/src/triggers/ordenes/onWriteCacheSync.js`. Then run `rebuild-all-contratos-cache.js` once to clear accumulated drift.

**Real fix (3–5 days):** replace the four overlapping cache-write paths with one `onOrdenWritten` trigger that calls a single idempotent `rebuildContractCache(contratoId)`. Delete `onContratoOrdenWrite`, fold `recalcularCacheContrato` into the rebuild, lock down the cache subcollection in rules.

### 1.2 Frontend cache writer still alive
`syncContratoCacheFromOrden` in `public/ordenes/nueva-orden.html:414` writes the same cache subdoc the CF writes. `CONFIG.enableContratoFallbackSync = false` exists in `ordenes-state.js:55` but is **never checked**. Two writers, undefined write order. Delete the frontend writer; the CF is canonical.

### 1.3 `total` vs `total_con_itbms` on contracts
Contracts store both. `nuevo-contrato.html:1533` writes `total: tot.subtotal` (so `total` and `subtotal` are the same number) while `total_con_itbms` is the real total. Consumers reading `total` get the wrong value. ITBMS rate `0.07` is hard-coded in 10 places. Single canonical totals helper needed.

### 1.4 Equipment field naming chaos
Writers use `serial`, `SERIAL`, `numero_de_serie` interchangeably; ditto `modelo` / `MODEL` / `modelo_nombre`; ditto `descripcion` / `nombre` / `observaciones`. The CF normalizes on **read** via `extractCacheData` — the writers do not normalize on write. Move normalization to the write path inside the service layer so reads can trust the data.

---

## 2. Frontend architecture

### 2.1 Service layer is half-built
`ordenesService.js` and `clientesService.js` exist and are used by `ordenes/index.html` only. **188 raw `db.collection(...)` calls across 40 files** bypass them. There is no contract service, inventario service, piezas service, PoC service, cotizaciones service, mailService write-path, or usuarios service used everywhere it should be.

Order of priority based on traffic and write-risk:
1. `contratosService.js` — biggest single win, touches the cache pipeline
2. `mailService.js` write wrapper around `mail_queue.add(...)` — five callsites today, each composing HTML by string concat
3. `cotizacionesService.js`
4. `inventarioService.js` + `piezasService.js`
5. `pocService.js`
6. Read paths fold in as pages migrate

After this lands, no HTML file or page script contains `db.collection("contratos"|"mail_queue"|...)`.

### 2.2 Role enum is not centralized
At least eight role names in active use (`administrador`, `vendedor`, `tecnico`, `tecnico_operativo`, `recepcion`, `vista`, `inventario`, `jefe_taller`) and possibly more (`readonly`, `gerente` referenced in security rules). The `ROLES` enum in `ordenes-state.js` is the most complete attempt but is used only inside the orders module. `OrdenesService` distinguishes `tecnico` vs `tecnico_operativo`; most other pages don't. Build one `js/core/roles.js` with a canonical enum + `can(action, role)` predicate, then migrate consumers.

### 2.3 Compat → modular Firebase SDK
~900 KB of Firebase compat shipped today. Modular SDK + tree-shaking + a Vite/esbuild build would cut to ~250 KB. Real refactor (every `firebase.X()` call changes), but the service layer is the natural seam. **Do this only when a build step is being added for another reason.** Don't introduce a build step just for this.

### 2.4 Service worker / `enablePersistence` verification
Firestore SDK's `enablePersistence()` is wired in `firebase-init.js`. Verify it actually applies in Safari (it fails silently there with ITP-style storage restrictions). A real service worker caching the last 100 orders + static assets would let field techs keep working out of coverage — separate, larger project from `enablePersistence`.

### 2.5 Public verification page uses authenticated init
`verify/index.html` is supposed to work without login (the whole reason `verificaciones` has `allow read: if true`). But it loads `firebase-init.js` which calls `setPersistence(LOCAL)` and `enablePersistence`. It doesn't call the auth check, so it won't redirect — but unrelated browser-storage failures (Safari ITP, third-party cookie blocks) still affect a public page that has no need for auth. Fix: extract a minimal `firebase-public.js` for the verify page that initializes only Firestore.

### 2.6 Duplicate `verify/firebase-init.js`
`public/verify/firebase-init.js` is a byte-for-byte clone of `public/js/firebase-init.js`, but `verify/index.html` loads the absolute path `/js/firebase-init.js`. The duplicate is dead — delete it.

### 2.7 Migration tools live in `public/`
`public/contratos/migrar-contratos.html`, `migrar-cliente-nombre-lower.html`, `public/ordenes/migrar-fechas.html`, `public/clientes/fix-deleted-clientes.html` are deployed alongside the production app. Anyone with a session and the URL can run them. They perform bulk writes. Move to `tools/` outside `public/` (add to `firebase.json` `hosting.ignore`) so they still run locally for admins who need them.

### 2.8 Phase 5g — finish script decomposition
Page scripts that haven't been split into namespace files yet (lower priority since they're already <800 lines):

| File | Lines | Notes |
|---|---:|---|
| `piezas.js` | ~747 | Good candidate for `window.Piezas` |
| `clientes-index.js` | ~628 | Still global functions |
| `fotos-taller.js` | ~535 | Still global functions |
| `editar-orden.js` | ~471 | Still global functions |

Plus HTML pages still carrying >300 lines of inline script (Tier 1 from Phase 5a): `clientes/index.html`, `ordenes/editar-orden.html`, `cotizaciones/editar-cotizacion.html`, `contratos/imprimir-contrato.html`, `ordenes/nueva-orden.html`, `ordenes/agregar-equipo.html`, `inventario/index.html`, `cotizaciones/nueva-cotizacion.html`, `inventario/modelos.html`.

### 2.9 Manual script-tag coordination is fragile
The bug class hit four times so far: page-local code calls a service whose `<script src>` isn't in that page's HTML. Most recent: `fotos-taller.html` missing `ordenesService.js` + `usuariosService.js` (fixed 2026-05-19). Earlier: `EmpresaService`, `MailService`, `firebase.storage()` in the entrega flow. A build step would catch this at build time via the import graph — until then, every new service call needs a matching script-tag audit.

### 2.10 Entrega flow split (deferred)
`public/js/pages/ordenes-flujo.js` is currently ~560 lines (was 227 post-Phase 5f). The entrega flow drove most of the growth. Defer the split until the next entrega feature lands; then move it to `ordenes-entrega.js` and have `ordenes-flujo.js` become a thin coordinator (`OrdenesEntrega.abrir(ordenId)`).

---

## 3. CSS / design system

### 3.1 Token enforcement across pages (Phase 1)
Inline `<style>` blocks in 42 of 42 pages redeclare global rules. 14 files use hard-coded blues (`#3b82f6`, `#2563eb`) instead of `var(--brand)`. 23 files use off-spec border-radius (12/16/20 px). Plan:
- Replace hardcoded color values: `#3b82f6` → `var(--brand)`, `#1e3a8a` → `var(--navy)`, `#0f172a` → `var(--text)`, `#64748b` → `var(--muted)`, `#e2e8f0` → `var(--line)`.
- Correct radii inline: buttons/inputs → 6px, cards → 10px, modals → 16px.
- Delete inline `<style>` blocks that just redeclare `ceco-ui.css` rules.
- One PR per directory.

### 3.2 Shared topbar/layout (Phase 2)
Topbar is copy-pasted with subtle variations across 13 pages. Plan: `public/js/core/layout.js` exporting `Layout.renderTopbar({ title, actions, showHome })`. Replace every hand-written `<div class="topbar">…</div>` with a mount div + `Layout.renderTopbar()` call. Apply the same pattern to empty-state, skeleton-row, and "Cargar más" footer.

### 3.3 Typography hierarchy (Phase 3)
Barlow and IBM Plex Sans are imported by `ceco-ui.css` but no page applies them. Apply:
- `--font-display` (Barlow 700) to topbar `h1`, section headers, modal titles, app-card labels
- `--font-mono` (IBM Plex Mono) to SKUs, order IDs, contract IDs, money values, technical spec strings
- Add `cc-*` utility classes (`cc-h1`, `cc-h2`, `cc-body`, `cc-eyebrow`, `cc-mono`) to `ceco-ui.css`

### 3.4 Iconography migration (Phase 5)
Emoji-as-icon is used across the codebase. Replace with Lucide icons per the mapping below. Most time-intensive phase (1–2 hours per major section), low visual risk.

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

`textContent = "✏️ Editar"` → `innerHTML = '<i data-lucide="pencil"></i> Editar'`, then call `lucide.createIcons({ nodes: [element] })`.

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

### 3.8 Email template branding mismatch
`functions/templates/email-base.html` uses teal `#0ea5a3` brand color throughout (header background, button color, footer link color) while the rest of the app uses Cecomunica blue `#0091D7` (`--brand`). Worth aligning if brand consistency in emails matters.

---

## 4. UX polish

### 4.1 Mobile tooltip equivalent
Tooltips work on hover only. Long-press should show the tooltip on touch. Small effort.

### 4.2 Keyboard shortcut palette
Ctrl+K focuses search; `?` opens a cheatsheet (filters, navigation, common actions). Power-user feature — admins and recepción will use it daily.

### 4.3 Live counters in the topbar (`§5.3`)
Replace "Resumen: 152 · Todos" button text with a small live badge cluster (POR ASIGNAR / ASIGNADO / COMPLETADO / ENTREGADO with counts). Counts are already live in the chip bar after the §4.3 redesign; topbar version is a 30-min wiring exercise.

### 4.4 Serial-first scan workflow (`§5.6`)
Most common workflow: tech scans a serial. Add:
- Auto-focus the search input on page load when no filter is active.
- "Scan" button next to search that opens the device camera (BarcodeDetector API, Chrome on Android). Reads the serial straight into the search field. Minimal effort, big value for techs.

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
