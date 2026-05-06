# Changelog

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
