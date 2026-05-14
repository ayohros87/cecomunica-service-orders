# Changelog

## [Refactor — Phase 5f: ordenes-index.js decomposition] — 2026-05-14

### Restructured
- Split the 3,271-line monolithic `public/js/ordenes-index.js` into 10 single-responsibility files under `public/js/pages/`:
  - `ordenes-state.js` (227) — `APP`/`CONFIG`/utils + pure formatters (`formatFecha`, `normTxt`, `escapeHtml`, `nombreClienteDe`, `getEstadoClass`, `tipoChip`, `estadoCompacto`)
  - `ordenes-data.js` (166) — Firestore reads (`cargarClientes`, `cargarOrdenesYEquipos`, `ordenarOrdenes`, etc.)
  - `ordenes-render.js` (649) — row + equipo-table renderers, `botonesFlujo`, `botonesGestion`, `actualizarResumen`, `mostrarFeedbackEquipo`
  - `ordenes-filters.js` (433) — filter logic + UI bindings (`getActiveFilters`, `aplicarFiltrosCombinados`, `filtrarOrdenes`, `filtrarRapido`, `filtrarPorEstado`, `cambiarOrden`, `aplicarRestriccionesPorRol`, etc.)
  - `ordenes-flujo.js` (227) — order lifecycle (`abrirModalAsignarTecnico`, `completarOrden`, `entregarOrden`, `eliminarOrden`, `agregarEquipo`, `generar*NotaEntrega`, `copiarSeriales`)
  - `ordenes-equipos.js` (585) — equipment CRUD + trabajo modal (`editarCampoEquipo`, `eliminarEquipo`, `guardarAccesoriosLote`, `abrirTrabajoEquipoModal`, `setEquipoNoDisponible`, etc.)
  - `ordenes-notas.js` (155) — `gestionarNotasTecnicas` modal
  - `ordenes-ui.js` (438) — `mostrarToast`, mobile drawer helpers, menu togglers, text/alert modals
  - `ordenes-events.js` (353) — `initEventDelegation` IIFE + `ACTION_HANDLERS` map (~40 entries)
  - `ordenes-index.js` (109) — thin coordinator: DOM listeners, auth + initial load, keyboard shortcuts, `pageshow` reload
- Renamed `public/js/ordenes.state.js` → `public/js/pages/ordenes-state.js` and moved the coordinator from `public/js/ordenes-index.js` to `public/js/pages/ordenes-index.js`, matching the convention used by every other namespace split (contratos, trabajar-orden, nuevo-contrato).

### Fixed
- `obtenerIconoLapiz` is now a top-level function in `ordenes-render.js` instead of being declared inside the `DOMContentLoaded` callback. The original placement only worked because `renderEquiposTabla` happened to be reachable while the DOMContentLoaded closure was on the call stack; refactoring would have broken the lookup.

### Notes
- Pre-existing latent bugs preserved (out of scope for this refactor): `EmpresaService` is used in `cargarTiposDeServicioFiltros` but not loaded by `ordenes/index.html` (silently falls back to the hardcoded options list); `cambiarOrden` reads `document.getElementById("APP.state.sortField")` which can never resolve.
- Script load order in `public/ordenes/index.html`: state → data → render → filters → flujo → equipos → notas → ui → events → coordinator.
- Two `console.log` markers retained per-file (`[ordenes-state.js] State management initialized`, etc.) for load-order diagnostics.

## [Look & Feel — Phase 7: Unified topbar right-zone + Print page standardization] — 2026-05-13

### Added
- `public/css/print-base.css` — shared foundation for all `imprimir-*.html` pages: `.print-toolbar` (right-aligned, hidden on print), `.print-page` wrapper (white card on screen, flat on print), `.print-brand-header` (logo + company info + doc-type label), `.print-mono` utility class; canonical `@media print` block with `@page { size: letter; margin: 0.4in }`, `print-color-adjust`, and page-break rules
- Overflow menu component in `ceco-ui.css` (`.overflow-menu`, `.overflow-menu-dropdown`, `.overflow-menu-item`, `.overflow-menu-divider`) using `.open` toggle class

### Refactored (print pages)
- `ordenes/imprimir-orden.html` — replaced text-only brand header with logo + `.print-brand-header`; replaced `.toolbar` with `.print-toolbar`; removed inline `@media print` and body/wrapper CSS now covered by `print-base.css`
- `cotizaciones/imprimir-cotizacion.html` — replaced old `.topbar.no-print` (emoji buttons, `btn-top` class) with `.print-toolbar`; migrated buttons to `.btn.ghost` / `.btn.secondary` with Lucide icons; added Lucide CDN and `createIcons()` call; linked `print-base.css`
- `contratos/imprimir-contrato.html` — added missing `ceco-ui.css` link; added `print-base.css`; replaced bare `<button>` with `.print-toolbar.no-print`; removed three duplicate `@media print` blocks; added `@page { size: A4 }` override (contracts use A4); updated `.mono` class to use `var(--font-mono)` token

### Refactored (topbar — Phase 7a)
- `layout.js` — added `menu: []` parameter; `menuItemHtml()` generates `.overflow-menu-item` elements; overflow menu wrapper with IDs `__layout-menu-*`; `_wireMenuToggle()` click-outside close; exports `wireMenuToggle` for pages with custom topbars
- Unified three-zone right-side topbar (`[+ Primary CTA] [⋮ Más] [🏠 Menú principal] [🚪 Cerrar sesión]`) across all 9 main index pages: `index.html`, `ordenes/index.html`, `contratos/index.html`, `cotizaciones/index.html`, `clientes/index.html`, `POC/index.html`, `POC/vendedores-batch.html`, `inventario/index.html`, `inventario/piezas.html`

## [Look & Feel — Phase 6: Nav standardization, container width tiers] — 2026-05-13

### Added
- `ceco-ui.css`: `.app-wrap--narrow` (720 px), `.app-wrap--default` (1100 px), `.app-wrap--wide` (1400 px), `.app-wrap--full` (100%) modifier classes for content width tiers; `@media` breakpoints for `.app-wrap` padding at 1024 px and 760 px; `.table-wrap--compact` alias for `.table-wrap.compact`
- `layout.js`: `Layout.renderTopbarFor(mode, opts)` shortcut — four modes: `'index'`, `'edit'`, `'child'`, `'home'`; homeBtn and logoutBtn now render with Lucide icons; backBtn defaults to icon + "Volver" when caller omits `back.label`

### Refactored
- Container widths: replaced all inline `max-width` overrides with tier modifier classes across `cotizaciones/*`, `contratos/index.html`, `POC/index.html`, `clientes/index.html`, `inventario/*`
- Topbar migration — the following pages now use `Layout.renderTopbar()` replacing custom navbars or no nav at all:
  - `ordenes/config.html`, `ordenes/estado_reparacion.html`, `ordenes/tecnicos.html`, `ordenes/modelo-de-radio.html`, `ordenes/importar-exportar.html`
  - `ordenes/editar-orden.html`, `ordenes/nueva-orden.html`, `ordenes/agregar-equipo.html`, `ordenes/admin-equipos-cliente.html`
- `estado_reparacion.html`, `tecnicos.html`, `modelo-de-radio.html`, `importar-exportar.html`: migrated from old Arial-font layout to `ceco-ui.css` + proper auth + topbar
- `admin-equipos-cliente.js`: `btnVolver` ref now optional-chained (element removed from HTML)

## [Look & Feel — Phase 5: Iconography migration] — 2026-05-12

### Replaced
- Every emoji character across all HTML pages and dynamic JS template strings → `<i data-lucide="name">` elements
- Boolean data cells (`activo`, GPS) → plain text ("Sí"/"No") where icon use would be semantically incorrect
- Files updated: `ordenes/` (13 pages), `POC/` (7 pages), `inventario/` (5 pages), `clientes/index.html`, `contratos/` (5 pages), `cotizaciones/` (3 pages), `index.html`

### Updated JS
- `ordenes-index.js`, `agregar-equipo.js`, `clientes-index.js`, `contratos-list.js`, `cotizaciones-index.js`, `cotizar-orden.js`, `inventario-index.js`, `poc-edit.js`, `poc-list.js` — all dynamic DOM template strings updated to use `<i data-lucide>` + `lucide.createIcons()` call after each insertion

### Added
- Lucide CDN script tag to pages that were missing it; `lucide.createIcons()` added after every dynamic DOM insertion
- `ceco-ui.css`: SVG sizing and stroke-width normalization rules for Lucide icons so they render at a consistent 16 px inline

## [Look & Feel — Phase 4: Dialog & toast primitives] — 2026-05-12

### Extended
- `public/js/ui/modal.js` — added `Modal.confirm({ title, message, danger, confirmLabel, cancelLabel })` returning `Promise<boolean>`; supports click-outside, Escape, and Enter keyboard shortcuts

### Replaced across ~25 JS files
- All native `confirm()` calls → `await Modal.confirm()` (non-blocking, styled)
- All `alert()` calls → `Toast.show(msg, type)` or `TO.showToast(msg)` as appropriate
- Files updated: `ordenes-index.js`, `cotizar-orden.js`, `to-cotizacion.js`, `to-equipos.js`, `to-servicio.js`, `trabajar-orden.js`, `contratos-list.js`, `contratos-upload.js`, `contratos-imprimir.js`, `contratos-approval.js`, `contratos-equipos.js`, `cotizaciones-index.js`, `contratos-index.js`, `editar-contrato.js`, `editar-cotizacion.js`, `editar-orden.js`, `firmar-entrega.js`, `cargar-inventario.js`, `inventario-index.js`, `inventario-modelos.js`, `piezas.js`, `clientes-index.js`, `fotos-taller.js`, `importar-exportar.js`, `nueva-orden.js`, `poc-list.js`, `poc-bulk.js`, `poc-sim.js`, `poc-edit.js`, `poc-index.js`, `poc-list.js`, `vendedores-batch.js`, `nuevo-batch.js`

### Added `toast.js` + `modal.js` to pages that were missing them
- `ordenes/index.html`, `ordenes/fotos-taller.html`, `ordenes/firmar-entrega.html`, `ordenes/nueva-orden.html`, `ordenes/importar-exportar.html`, `contratos/editar-contrato.html`, `contratos/imprimir-contrato.html`, `inventario/cargar-inventario.html`, `POC/index.html`, `POC/nuevo-batch.html`

### Deferred
- `agregar-equipo.js`: 3 alerts tied to `prompt()` text-input flow — requires form modal (Phase 5+)
- `inventario-index.js:verHistorico`: `alert(resumen)` displays multi-line data report — needs proper dialog component (Phase 5+)

## [Look & Feel — Phase 3: Typography hierarchy] — 2026-05-12

### Style (`public/css/ceco-ui.css`)
- Added `--font-display`, `--font-body`, `--font-mono` CSS variables to `:root`
- `body { font-family }` now references `var(--font-body)` instead of a hardcoded string
- Applied Barlow (`var(--font-display)`) to `.topbar-title`, `.topbar h1`, `.sheet-title`, and `.app-card .meta .t` — the three main structural heading sites
- Updated `.mono` utility class to use `var(--font-mono)` (IBM Plex Mono) instead of `ui-monospace` fallback chain
- Added `cc-*` typography utility classes: `cc-display-xl/l/m`, `cc-h1`–`cc-h4`, `cc-body-l/body/body-s`, `cc-caption`, `cc-eyebrow`, `cc-mono` — matches design system token names; purely additive, for new components going forward

## [Look & Feel — Phase 2: Shared topbar component] — 2026-05-11

### Added
- `public/js/core/layout.js` — `Layout.renderTopbar({ title, actions, back, showHome, homeHref, showLogout })` factory; writes canonical topbar HTML into a `<div id="topbar-mount">` placeholder, loaded synchronously so it runs before page scripts

### Refactor
- Migrated 7 pages to use `Layout.renderTopbar()` (replaced hand-written topbar HTML):
  - `public/index.html`, `contratos/index.html`, `cotizaciones/index.html`, `cotizaciones/nueva-cotizacion.html`, `cotizaciones/editar-cotizacion.html`, `POC/index.html`, `clientes/index.html`
- Removed duplicate inline `.topbar {}` CSS blocks from 4 complex-topbar pages that still manage their own topbar HTML (`inventario/index.html`, `inventario/piezas.html`, `POC/vendedores-batch.html`; `ordenes/index.html` had none)
- All pages now inherit the canonical sticky topbar from `ceco-ui.css` — no page overrides the `.topbar` selector anymore

## [Look & Feel — Phase 1a: Token enforcement, priority pages] — 2026-05-11

### Style
- Replaced all hardcoded generic-blue values with Cecomunica design tokens across 15 HTML pages (contratos/, cotizaciones/, ordenes/, inventario/):
  - `#3b82f6 / #2563eb / #1d4ed8` → `var(--brand) / var(--brand-hover) / var(--brand-2)` (Cecomunica signal blue)
  - `#1e3a8a` → `var(--navy)`
  - `#64748b` → `var(--muted)` · `#e2e8f0` → `var(--line)` · `#0f172a` → `var(--text)`
  - `#f59e0b / #ef4444` → `var(--warn) / var(--bad)`
  - All `rgba(59, 130, 246, …)` focus rings → `rgba(0, 145, 215, …)` (brand blue hue)
- `ordenes/fotos-taller.html`: remapped entire local `:root { --ft-* }` block to reference global tokens, so the page inherits the correct brand palette automatically
- `inventario/index.html`: removed hardcoded fallback from `var(--warn, #f59e0b)` → `var(--warn)`
- Files touched: `contratos/nuevo-contrato.html` (24 hits), `nuevo-cliente.html` (10), `editar-contrato.html` (3), `contratos/index.html` (4), `cotizaciones/index.html` (2), `editar-cotizacion.html` (1), `nueva-cotizacion.html` (1), `imprimir-cotizacion.html` (2), `ordenes/fotos-taller.html` (8), `trabajar-orden.html` (2), `editar-orden.html` (2), `nueva-orden.html` (1), `progreso-tecnicos.html` (1), `inventario/index.html` (3), `piezas.html` (1)
- `POC/index.html`, `imprimir-equipos.html`, `nuevo-batch.html`, `vendedores-batch.html`: same token sweep applied
- `tools/` directory intentionally skipped (not in scope)
- **Phase 1 complete** — zero remaining generic-blue hardcodes outside `tools/`

### Added
- `REFACTOR_LOOK_FEEL.md` — seven-phase standardization plan
- `public/css/ceco-ui.css` aligned to Cecomunica Design System: brand blue `#0091D7`, Barlow + IBM Plex Sans fonts, naval-tint shadows, corporate radii (6/10/16 px), auth page navy gradient

## [Phase 6] — 2026-05-11

### Refactor
- Split `functions/index.js` (1 807 lines) into 12 focused modules under `functions/src/`:
  - **`lib/admin.js`** — firebase-admin singleton + `db` reference
  - **`lib/mail.js`** — `sendEmail()` wrapper over nodemailer + html-to-text
  - **`domain/emailRenderer.js`** — `buildEmailFromBase()`, `buildBodyOrdenCompletada()`
  - **`domain/pdfRenderer.js`** — `attachVerificationFromMirror()`, `buildContractHtmlForPdf()` (T&C text included)
  - **`domain/contractCache.js`** — `getISOWeekKey()`, `recalcularCacheContrato()`
  - **`http/sendMail.js`** — `sendMail` onRequest handler
  - **`http/sendContractPdf.js`** — `sendContractPdf` onRequest handler (Puppeteer/Chromium PDF)
  - **`triggers/contratos/onApproval.js`** — `onContratoActivado`, `onContratoActivadoSendPdf`
  - **`triggers/contratos/onAnnulment.js`** — `onContratoAnuladoNotify`
  - **`triggers/mail/onMailQueued.js`** — `onMailQueued`
  - **`triggers/ordenes/onComplete.js`** — `onOrdenCompletada`
  - **`triggers/ordenes/onWriteCacheSync.js`** — `onContratoOrdenWrite`, `onOrdenWriteSyncContratoCache`, `onOrdenHardDelete`
- `functions/index.js` rewritten as a 16-line thin re-exporter; `admin.initializeApp()` runs before any `require('./src/...')` to preserve singleton ordering
- All 10 Cloud Function export names unchanged (no trigger detachment on next deploy)
- Template paths adjusted from `__dirname/templates/` → `__dirname/../../templates/` to account for new module depth

## [Phase 4b] — 2026-05-11

### Refactor
- Completed migration of all remaining raw `db.collection()` calls from page scripts to the service layer (17 calls across 13 files + 1 in `ordenes-index.js`):
  - `to-pieza.js`: `piezaRef` transaction → `PiezasService.ajustarDelta()`; `_cargarMasCatalogo()` → `PiezasService.listCatalogPage()`
  - `fotos-taller.js`: order reads/writes → `OrdenesService.updateOrder()` / `.getOrder()`; user role read → `UsuariosService.getUsuario()`
  - `trabajar-orden.js`: equipos_meta write → `OrdenesService.setEquipoMeta()`
  - `progreso-tecnicos.js`: tecnico_stats reads → `UsuariosService.getTecnicoStats()`
  - `poc-state.js`: unique operadores fallback → `PocService.getUniqueOperadores()`
  - `contratos-state.js`: single + batch usuarios reads → `UsuariosService.getUsuario()` / `.getUsuariosByIds()`
  - `contratos-index.js` and `contratos-approval.js`: single usuarios reads → `UsuariosService.getUsuario()`
  - `nueva-orden.js`: order list for number generation → `OrdenesService.listAll()`; client name check → `ClientesService.existsByNorm()`
  - `nuevo-batch.js`: client name check → `ClientesService.existsByNorm()`
  - `nc-combo.js`: prefix search fallback → `ClientesService.searchByPrefix()`
  - `piezas.js`: batch auto-ID ref → `PiezasService.newDocRef()`
  - `importar-exportar.js`: Firestore UUID trick → `crypto.randomUUID()`
  - `ordenes-index.js`: empresa service-type list → `EmpresaService.getDoc()`
- New service methods added:
  - `OrdenesService.setEquipoMeta(ordenId, equipoId, data, opts)`
  - `PiezasService.listCatalogPage({ marca, lastDoc, pageSize })`
  - `PiezasService.newDocRef()`
  - `PocService.getUniqueOperadores(limit)`
  - `ClientesService.searchByPrefix(text, limit)`
  - `UsuariosService.getUsuariosByIds(ids)`
  - `UsuariosService.getTecnicoStats(uid, { periodo, periodoKey })`

## [Phase 5e] — 2026-05-08

### Refactor
- Split `contratos-index.js` into 5 focused namespace modules + thin coordinator:
  - `contratos-state.js` — `window.CS` shared state, `esc()`, `maxRows()`
  - `contratos-approval.js` — `window.ContratosAprobacion` (approve, commission, duplicate)
  - `contratos-upload.js` — `window.ContratosFirmado` (signed-PDF upload flow)
  - `contratos-equipos.js` — `window.ContratosEquipos` (equipment preview panel)
  - `contratos-list.js` — `window.ContratosLista` (table/card render, filter, sort, CRUD actions)
  - `contratos-index.js` rewritten as ~50-line auth coordinator
- Split `poc-index.js` into 5 namespace modules + thin coordinator:
  - `poc-state.js` — `window.PocState` (roles, model/operator lists, helpers)
  - `poc-list.js` — `window.PocList` (table render, search, filter, sort, export)
  - `poc-bulk.js` — `window.PocBulk` (mass inline edit with save/cancel)
  - `poc-edit.js` — `window.PocEdit` (side-drawer single-device edit)
  - `poc-sim.js` — `window.PocSim` (SIM bulk-update modal)
  - `poc-index.js` rewritten as ~46-line auth coordinator
- Split `trabajar-orden.js` into 5 namespace modules + thin coordinator:
  - `to-state.js` — `window.TO` shared state (orden data, user, inventory cache)
  - `to-cotizacion.js` — `window.TOCotizacion` (render totals, complete, unlock, export)
  - `to-servicio.js` — `window.TOServicio` (labor line modal)
  - `to-equipos.js` — `window.TOEquipos` (equipment accordion, consumo table, adjuntos)
  - `to-pieza.js` — `window.TOPieza` (part search + catalog modal, stock decrement)
  - `trabajar-orden.js` rewritten as ~89-line auth coordinator
- Split `nuevo-contrato.js` (1 075 lines) into 5 namespace modules + thin coordinator:
  - `nc-state.js` — `window.NC` shared state + `escapeHtml()`
  - `nc-form.js` — `window.NCForm` (badges, equipment table rows, totals, renewal UI)
  - `nc-combo.js` — `window.NCCombo` (client autocomplete, recents, keyboard nav)
  - `nc-preview.js` — `window.NCPreview` (draft preview modal, confirm flow)
  - `nc-guardar.js` — `window.NCGuardar` (data loading, prefill from duplicate, save + mail)
  - `nuevo-contrato.js` rewritten as ~32-line auth coordinator
- Refactored `vendedores-batch.js` (872 lines) into `window.VB` single namespace; merged dual `onAuthStateChanged` into one coordinator; all state variables moved from `window.*` globals into `VB.*`; updated 12 HTML inline handlers and all dynamic template-literal onclick strings to `VB.*`
- Removed local `Toast.show` duplicate from `vendedores-batch.js` (leftover from Phase 5c)

### Bug Fixes
- POC search `oninput` still called stale global `filtrarDispositivos()` — migrated to `PocList.filtrar()`
- POC bulk edit read `.expandir-btn` instead of `.expand-btn` — grupos were always truncated before saving, corrupting arrays with `"..."` entries
- `PocEdit.guardar()` had two bugs: (1) `addLog` failure inside the same try-block blocked the success toast and left the drawer open; fixed to fire-and-forget; (2) unrecognized `operador` value not injected into select options, causing it to save as `""`

## [Phase 5d] — 2026-05-07

### Refactor
- Created `public/js/domain/totales.js` — `ContractTotals.compute(subtotal, itbmsAplica)` and `ContractTotals.fromDoc(data)`; canonical contract totals replacing `resolverTotalesContrato()` in `contratos-index.js` and `recalcularTotalesContrato()` in `nuevo-contrato.js`
- Created `public/js/domain/scoring.js` — `PiezaSearch.search(piezas, query, opts)`; extracted pure parts-search/ranking logic from `trabajar-orden.js`; no DOM dependency
- Updated `contratos-index.js` and `nuevo-contrato.js` to use `ContractTotals`; updated `trabajar-orden.js` to use `PiezaSearch`
- Completed Phase 5c for missed files: wired `Toast.show()` and `Modal.open/close()` in files that had been skipped in the initial 5c pass

## [Phase 5c] — 2026-05-07

### Refactor
- Created `public/js/ui/toast.js` — `Toast.show(msg, type?, durationMs?)` and `Toast.persist(msg, type?)` → element; types `'ok' | 'bad' | 'warn' | ''`; auto-creates `.toast-wrap` container, re-uses `#toasts` if present
- Created `public/js/ui/modal.js` — `Modal.open(id, opts?)` / `Modal.close(id)`; handles `display:flex/none`, body scroll lock, and Escape-key cleanup
- Added `.toast.warn` CSS rule to `public/css/ceco-ui.css`
- Removed local toast/showToast implementations from 6 page scripts and replaced all call sites with `Toast.show()` / `Toast.persist()`:
  - `piezas.js` (21 calls), `inventario-modelos.js` (14 calls), `vendedores-batch.js` (11 calls), `nuevo-contrato.js` (7 calls, with type mapping `success→ok`, `error→bad`, `warning→warn`), `inventario-index.js` (3 calls), `nuevo-cliente.js` (1 call)
- Replaced inline open/close modal wrappers with `Modal.open()` / `Modal.close()` in: `cotizar-orden.js`, `nuevo-contrato.js`, `trabajar-orden.js` (modalPieza + modalServicio), `piezas.js` (overlay + overlayBatch)

## [Phase 5b] — 2026-05-06

### Refactor
- Added `FMT.normalize(s)` to `public/js/core/formatting.js` — canonical diacritic-stripping + lowercase normalizer for text search
- `contratos-index.js` — removed `getCurrentRole()` (2 call sites → `AUTH.getRole()`); removed local `fmt()` (5 call sites → `FMT.money()`)
- `nuevo-contrato.js` — removed `round2()`, `fmt()`, `norm()`, `ITBMS_PORCENTAJE` (14 call sites → `FMT.round2`, `FMT.money`, `FMT.normalize`, `FMT.ITBMS_RATE`)
- `vendedores-batch.js` — removed `normalizar()` (5 call sites → `FMT.normalize()`); added `core/formatting.js` + `core/auth.js` to `vendedores-batch.html`

## [Phase 5] — 2026-05-06

### Refactor
- Extracted inline `<script>` blocks from 5 large HTML pages into separate `public/js/pages/<name>.js` files, each referenced with `<script src defer>`
  - `contratos/index.html` (~1690 lines) → `contratos-index.js`
  - `contratos/nuevo-contrato.html` (~1161 lines) → `nuevo-contrato.js`
  - `POC/index.html` (~1600 lines across 3 blocks) → `poc-index.js`
  - `ordenes/trabajar-orden.html` (~1174 lines) → `trabajar-orden.js`
  - `POC/vendedores-batch.html` (~890 lines across 2 blocks) → `vendedores-batch.js`
  - `inventario/piezas.html` (~751 lines) → `piezas.js`

## [Phase 4c] — 2026-05-06

### Refactor
- Migrated `ordenes/admin-equipos-cliente.html` + `js/admin-equipos-cliente.js` — role check + clientes map + empresa tipo_de_servicio → `UsuariosService.getUsuario`, `ClientesService.listClientes`, `EmpresaService.getDoc`; paginated server-scan loop left inline
- Removed dead duplicate `getOrder` in `ordenesService.js` (second definition at line 459 had no `eliminado` filter and silently overrode the correct first definition)

### Infrastructure
- Added `analytics_piezas_modelo` composite index to `firestore.indexes.json` (`modelo_norm ASC, usos_cobro DESC`) — needed by the recommendations query in `trabajar-orden.html`

## [Phase 4b] — 2026-05-06

### Refactor
- Expanded `public/js/services/ordenesService.js` — added `getConsumos`, `getConsumo`, `addConsumo`, `updateConsumo`, `deleteConsumo`, `updateOrder`, `mergeOrder`, `setOrder`, `listAll`, `filterByStatuses`
- Expanded `public/js/services/piezasService.js` — added `getPieza(id)`
- Migrated `contratos/imprimir-contrato.html` — `usuarios` get for `creado_por_uid` and `aprobado_por_uid` → `UsuariosService.getUsuario`
- Migrated `contratos/editar-contrato.html` — `modelos` list → `ModelosService.getModelos`
- Migrated `contratos/nuevo-contrato.html` — `clientes` list/get/search + `modelos` list → `ClientesService.listClientes`, `getCliente`, `searchByToken`; `ModelosService.getModelos`; legacy `startAt/endAt` fallback left inline
- Migrated `contratos/nuevo-cliente.html` — `clientes` get/add/update → `ClientesService.getCliente`, `createCliente`, `updateCliente`; duplicate-check WHERE queries left inline
- Migrated `ordenes/estado_reparacion.html` — `empresa` doc read/write → `EmpresaService.getDoc`, `setDoc`
- Migrated `ordenes/tecnicos.html` — `empresa` doc read/write → `EmpresaService.getDoc`, `setDoc`
- Migrated `ordenes/modelo-de-radio.html` — role check + modelos CRUD → `UsuariosService.getUsuario`; `ModelosService.getModelos`, `getModelo`, `updateModelo`, `deleteModelo`
- Migrated `ordenes/imprimir-orden.html` — orden get + clientes get → `OrdenesService.getOrder`, `ClientesService.getCliente`
- Migrated `ordenes/reporte-pendientes.html` — `WHERE estado_reparacion IN [...]` → `OrdenesService.filterByStatuses`
- Migrated `ordenes/importar-exportar.html` — orden set + full collection export → `OrdenesService.setOrder`, `listAll`
- Migrated `ordenes/agregar-equipo.html` — modelos list + orden get/update + clientes get → `ModelosService`, `OrdenesService`, `ClientesService`
- Migrated `ordenes/firmar-entrega.html` — orden get/merge + usuarios get + clientes get → `OrdenesService.getOrder`, `mergeOrder`; `UsuariosService.getUsuario`; `ClientesService.getCliente`
- Migrated `ordenes/cotizar-orden-formal.html` — empresa docs + orden + clientes + consumos → `EmpresaService`, `OrdenesService`, `ClientesService`
- Migrated `ordenes/editar-orden.html` — role check + orden get/merge + clientes + vendedores + técnicos + empresa docs → all service calls; `getVendedores`, `getUsuariosByRol`, `EmpresaService.getDoc`
- Migrated `ordenes/progreso-tecnicos.html` — role check + `WHERE rol IN [...]` → `UsuariosService.getUsuario`, `getUsuariosByRol`; `tecnico_stats` subcollection left inline
- Migrated `ordenes/cotizar-orden.html` — orden + clientes + inventario + consumos CRUD → `OrdenesService`, `ClientesService`, `PiezasService`
- Migrated `ordenes/nueva-orden.html` — clientes list/get/add + vendedores + empresa tipo_de_servicio + orden set → `ClientesService`, `UsuariosService`, `EmpresaService`, `OrdenesService`; order-numbering get and duplicate-check WHERE left inline
- Migrated `ordenes/trabajar-orden.html` — role check + empresa parametros + orden get/merge + clientes get + inventario + consumos CRUD × 6 locations + completar/desbloquear cotización → all service calls; `onSnapshot` listener, `equipos_meta` subcollection, `analytics_piezas_modelo` transaction, paginated `!=` catalog query, and stock-decrement transactions left inline

## [Phase 4] — 2026-05-05

### Refactor
- Created `public/js/services/cotizacionesService.js` — `getCotizacion`, `addCotizacion`, `updateCotizacion`, `getCotizacionesPorFecha`, `contarPorFecha`, `listCotizaciones`
- Created `public/js/services/modelosService.js` — `getModelos`, `getModelo`, `addModelo`, `updateModelo`, `setActivo`, `deleteModelo`
- Created `public/js/services/inventarioService.js` — `getInventarioActual`, `getHistorialModelo`, `guardarInventario`
- Created `public/js/services/piezasService.js` — `getPiezas`, `addPieza`, `updatePieza`, `deletePieza`, `ajustarCantidad`, `ajustarDelta`, `importarPiezas`
- Created `public/js/services/pocService.js` — `getPocDevices`, `getPocDevice`, `addPocDevice`, `updatePocDevice`, `softDeletePocDevice`, `restorePocDevice`, `addLog`, `findByField`, `getRecent`
- Created `public/js/services/usuariosService.js` — `getUsuario`, `getUsuariosByRol`, `getVendedores`
- Created `public/js/services/empresaService.js` — `getOperadores`, `getDoc`, `setDoc`
- Expanded `public/js/services/clientesService.js` — added `updateCliente`, `deleteCliente`, `listClientes`, `searchByToken`, `batchUpdate`; fixed timestamp field names (`updatedAt`)
- Migrated `cotizaciones/index.html` — list + ID-generation + get/add/update → `CotizacionesService`
- Migrated `cotizaciones/imprimir-cotizacion.html` — get → `CotizacionesService.getCotizacion`
- Migrated `cotizaciones/nueva-cotizacion.html` — clients/modelos/users/ID-gen/add → all service calls
- Migrated `cotizaciones/editar-cotizacion.html` — same as nueva + update
- Migrated `inventario/index.html` — usuarios/modelos/inventario calls → service calls
- Migrated `inventario/modelos.html` — full CRUD → `ModelosService`
- Migrated `inventario/cargar-inventario.html` — `guardarSemana` rewrites to `InventarioService.guardarInventario`
- Migrated `inventario/piezas.html` — all CRUD → `PiezasService`; bulk import loop left inline (raw batch API)
- Migrated `inventario/vista-correo.html` — modelos + inventario reads → service calls
- Migrated `clientes/index.html` — role check, batchUpdate call sites, inline edit, vendor assign, delete → service calls; query builders left inline (return raw Firestore query objects)
- Migrated `clientes/editar.html` — get/vendedores/update/add → service calls
- Migrated `POC/editar-batch.html` — empresa doc read + search-by-field + update → `EmpresaService` / `PocService`
- Migrated `POC/importar-poc.html` — import loop `.add()` + export `.get()` → `PocService`
- Migrated `POC/nuevo-equipo.html` — empresa doc reads/writes + uniqueness checks + add → service calls
- Migrated `POC/imprimir-equipos.html` — clientes/modelos/poc_devices gets → service calls
- Migrated `POC/nuevo-batch.html` — empresa doc reads/writes + recent query + clients list + add → service calls
- Migrated `POC/vendedores-batch.html` — role check → `UsuariosService.getUsuario`; cache-first queries left inline
- Migrated `POC/index.html` — modelos map, clientes map, empresa/operadores, role check, drawer edit, SIM bulk update, export, delete/restore (×6 locations), duplicates scan, mass-edit save → service calls; complex `!=` compound queries left inline

## [Phase 3] — 2026-05-05

### Refactor
- Created `public/js/services/contratosService.js` — service layer for the `contratos` collection; all Firestore I/O for contracts goes through `ContratosService`; mirrors the pattern of `ordenesService.js`; exports `getContrato`, `getByContratoId`, `updateContrato`, `addContrato`, `contarPorTipoYFecha`, `listContratos`, `listContratosFallback`, `getContratosActivosPorCliente`, `getContratosActivosAprobados`, `getOrdenesDeContrato`, `getOrdenesDeContratoCompleto`, `linkOrden`, `unlinkOrden`
- Created `public/js/services/mailService.js` — service layer for the `mail_queue` collection; wraps `.add()` and automatically stamps `createdAt: serverTimestamp()`; callers no longer include `createdAt`
- Migrated `contratos/imprimir-contrato.html` — `db.collection("contratos").where(...)` → `ContratosService.getByContratoId()`
- Migrated `contratos/editar-contrato.html` — all get/update calls → `ContratosService.getContrato()` / `updateContrato()`; removed `contratoRef` intermediate variable
- Migrated `contratos/nuevo-contrato.html` — count query, `.add()`, and `mail_queue` → `ContratosService.contarPorTipoYFecha()`, `addContrato()`, `MailService.enqueue()`
- Migrated `ordenes/agregar-equipo.html` — subcollection set → `ContratosService.linkOrden({ merge: true })`
- Migrated `ordenes/nueva-orden.html` — client contracts query + forEach + get + `mail_queue` → `ContratosService.getContratosActivosPorCliente()`, `getContrato()`, `MailService.enqueue()`; rewrote snapshot shim to iterate array directly
- Migrated `ordenes/editar-orden.html` — dropdown query + subcollection link/unlink + get → service calls; same direct-array rewrite pattern
- Migrated `ordenes/trabajar-orden.html` — `mail_queue` → `MailService.enqueue()`
- Migrated `ordenes/firmar-entrega.html` — both `mail_queue` calls → `MailService.enqueue()`
- Migrated `contratos/index.html` — all 22+ Firestore callsites replaced: `borrarContrato`, `marcarParaComision`, `quitarMarcaComision`, `cargarContratos` (paginated list + JS-side fallback loop), `subirFirmado` (background validation), `handleFileFirmado` (get + update in upload callback), `fetchEquiposPreviewHTML` (subcollection + ordenes_de_servicio lookup), `abrirModalEquiposContrato`, `abrirPanelTrabajoContrato`, `backfillContratoEquipos` (subcollection + per-order lookup + subcollection set), `iniciarBackfillTodosContratos`

## [Phase 2] — 2026-05-05

### Refactor
- Created `public/js/core/roles.js` — canonical `ROLES` enum and `canRole(rol, accion)` predicate; single source of truth for all role names
- Created `public/js/core/formatting.js` — `FMT` global with `ITBMS_RATE`, `money()`, `round2()`, `date()`, `datetime()`, `calcITBMS()`
- Created `public/js/core/auth.js` — `AUTH` global with `is()`, `isAny()`, `getRole()`, `getUser()`, `requireAccess()`
- Migrated `contratos/index.html` to core modules: loads all three core scripts, replaced `function round2()` with `FMT.round2`, replaced `0.07` ITBMS fallback with `FMT.ITBMS_RATE`, replaced all `window.userRole ===` and role string literals with `AUTH.is()` and `ROLES.*`
- Migrated `ordenes/index.html` + `ordenes-index.js` to core modules: loads all three core scripts, removed `CONFIG.ROLES` from `ordenes.state.js` (superseded by `window.ROLES`), replaced all role string literals in `ordenes-index.js` with `ROLES.*`
- Migrated `clientes/index.html` to core modules: loads all three core scripts, replaced `'administrador'`, `'recepcion'`, `'vendedor'`, `'vista'` literals with `ROLES.*`; legacy `'admin'` and `'editor'` values left intact (undocumented roles live in Firestore)
- Migrated `POC/index.html` to core modules: loads all three core scripts, replaced all role literals with `ROLES.*`

## [Phase 1] — 2026-05-05

### Bug Fixes
- Fixed `onContratoOrdenWrite` using wrong trigger type (`onDocumentUpdated` → `onDocumentWritten`) — CREATE and DELETE branches were unreachable, causing `os_count` and `equipos_total` to never update when an order was first linked or deleted from a contract (root cause of phantom 📦 icon bug)
- Removed `syncContratoCacheFromOrden` from `nueva-orden.html` — duplicate frontend cache writer that raced with the Cloud Function doing the same write
- Ran `rebuild-all-contratos-cache.js` post-deploy to repair drift in 63 contracts / 67 orders accumulated before the fix
- Added `--dry-run` CLI flag to `rebuild-all-contratos-cache.js` (was previously a hardcoded constant)

### Security
- Tightened Firestore rules: extracted `touchesCFOwnedFields()` helper blocking frontend writes to `firma_*`, `os_*`, `equipos_total`, and `tiene_os` fields on contracts
- Added `contratos/{id}/ordenes/{ordenId}` read-only rule — cache subcollection is now exclusively writable by Cloud Functions via admin SDK

## [Phase 0] — 2026-05-05

### Security
- Deleted `firebase config firma secret.txt` and `api- sendgrid.txt` (plaintext credentials were untracked but on disk)
- Added `.gitignore` rules to permanently exclude secret files, credential files, and backup archives

### Infrastructure
- Initialized git repository and pushed to GitHub (private, `ayohros87/cecomunica-service-orders`)
- Added `pre-refactor-2026-05` tag as a clean rollback point
- Added `.gitattributes` to normalize all line endings to LF
- Added `firestore.rules` to version control (previously only existed in the live Firebase project)
- Added `firestore.indexes.json` to version control (pulled from live project via CLI)
- Wired `firestore` section in `firebase.json` so rules and indexes deploy from the repo via `firebase deploy`

### Cleanup
- Moved migration and dev-only pages out of the deployed hosting root into `public/tools/`:
  - `contratos/migrar-contratos.html`
  - `contratos/migrar-cliente-nombre-lower.html`
  - `ordenes/migrar-fechas.html`
  - `clientes/fix-deleted-clientes.html`
  - `before-after.html`
  - `demo-improvements.html`
- Added `tools/**` to `firebase.json` `hosting.ignore` so these pages are never deployed
- Deleted `public/verify/firebase-init.js` (byte-for-byte duplicate of `public/js/firebase-init.js`; `verify/index.html` already loaded the canonical path)
