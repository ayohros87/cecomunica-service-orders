# Changelog

## [Rediseño Command Center — F3: detalle de orden con stepper + rail en "Ver como"] — 2026-07-14

> Driver: `PLAN_REDISENO_COMMAND_CENTER.md` (F3). Misma estrategia híbrida que F2.

- **`ordenes/editar-orden.html`** — rail Command Center (wrapper `.cc-app` +
  `ceco-rail.css`) y **stepper del ciclo de vida** bajo el encabezado: los 5
  estados canónicos con done/current según `estado_reparacion`; un estado
  legacy/extendido (DIAGNÓSTICO, EN ESPERA, …) deja el stepper oculto en vez
  de pintarlo mal. `window.OrdenStepper` definido inline (presentación pura).
- **`js/pages/editar-orden.js`** — hook de 1 línea: `OrdenStepper.update()` al
  pintar la orden. Nada más cambió en la lógica.
- **`css/ceco-rail.css`** — estilos `.os-flow*` del stepper (sin colisiones).
- **Rail respeta "Ver como"**: `renderRail` recibe `MODULOS.rolEfectivo(rol)`
  en la bandeja y el detalle (aplica si la URL lleva `?as=ROL` y el rol real
  es admin; solo visual, igual que en el home).

### QA targets
- Abrir una orden ASIGNADO: stepper con Recibido/Por asignar en verde y
  Asignado en azul; guardar cambios funciona igual.
- Abrir una orden con estado legacy (p.ej. DIAGNÓSTICO): sin stepper, página normal.
- `ordenes/index.html?as=tecnico` como admin: rail muestra solo Órdenes + PoC.

## [Rediseño Command Center — F2: bandeja de órdenes con rail y KPIs de señal] — 2026-07-14

> Driver: `PLAN_REDISENO_COMMAND_CENTER.md` (F2). Integración HÍBRIDA de mínimo
> riesgo: la página conserva ceco-ui.css/ordenes-index.css y toda su lógica
> (`ordenes-*.js` sin cambios); solo suma shell y cabecera de señales.

- **`css/ceco-rail.css`** — rail Command Center para páginas híbridas, sin
  colisiones con ceco-ui (solo define `.cc-app`, `.cc-work`, `.rail*`,
  `.os-kpi*`). Desktop-only: ≤1024px el rail y los KPIs se ocultan y la página
  queda exactamente como antes (la nav móvil propia — bottom nav + drawer —
  sigue intacta). La marca del topbar se oculta solo cuando el rail es visible.
- **`js/core/layout.js`** — `renderRail()` extraído de `renderShell` (que ahora
  delega): pinta solo el rail con los módulos del rol vía `MODULOS`; wirea el
  drawer móvil únicamente si la página trae `#ccRailToggle`.
- **`ordenes/index.html`** — wrapper `.cc-app` (rail + `.cc-work` con todo lo
  existente), fila de 4 KPIs de señal (Por asignar en rojo / Asignadas /
  Completadas / Entregadas) y script de rail al autenticar. Los KPIs no traen
  JS nuevo: el contenedor lleva `.estado-chips-bar` para que
  `actualizarResumen()` llene los `[data-count]`, y cada tile dispara el mismo
  handler delegado de los chips (`data-action="filtrar-estado-chip"`).
- Colores de chips de estado y badges de tabla se conservan tal cual (la
  unificación cromática con el sistema `sig--*` queda para una pasada de polish
  con feedback de uso).

### QA targets
- Desktop (>1024px): rail con módulos del rol (Órdenes activa), KPIs con los
  conteos del dataset cargado; clic en un KPI aplica el filtro de estado (los
  chips reflejan el activo); todo el flujo existente (asignar, entregar,
  intervención, presets, scan) intacto.
- Tablet/móvil (≤1024px): sin rail ni KPIs; página idéntica a antes del F2,
  con su chip bar y bottom nav.

## [Contratos — renovación sin equipo no pide seriales a inventario] — 2026-07-14

> Reporte de operaciones: en una renovación sin equipo, bodega recibía la
> "Solicitud de seriales" (confusión: no hay equipo físico que asignar) y, como
> nadie asignaba, el contrato quedaba trabado y ACTIVACIONES nunca recibía el
> correo del contrato aprobado (caso Silverking ALQ20260713-04).

- **`functions/src/triggers/contratos/onApproval.js`** —
  `onContratoAprobadoSolicitaSeriales`: si `accion === 'Renovación'` y
  `renovacion_sin_equipo`, se salta la solicitud a inventario (las líneas de
  equipos son renglones de alquiler, no entregas) y auto-completa la señal de
  seriales, igual que los contratos sin unidades. Con eso
  `onSerialesAsignadasSendPdf` envía de inmediato a activaciones el correo
  "Contrato APROBADO" con el banner de modalidad de renovación + PDF.
- **`js/pages/contratos-list.js`** — `serialesBtn`: renovación sin equipo ya no
  muestra el CTA ámbar "Seriales pendientes" (no aplica).
- **`functions/fix-renov-sin-equipo-atascados.js`** — one-off para destrabar
  contratos sin-equipo ya atascados en `seriales_estado: 'pendiente'`: escribe
  la señal `asignados` (dispara el correo a activaciones, idempotente) y limpia
  contadores de recordatorio. Dry-run por defecto; `--apply` / `--id=<docId>`.
- Sin cambios en el recordatorio diario a inventario: filtra por
  `seriales_estado == 'pendiente'`, que estos contratos ya no alcanzan.

### Deploy
- `firebase deploy --only functions:onContratoAprobadoSolicitaSeriales` + hosting.
- Tras el deploy: `node functions/fix-renov-sin-equipo-atascados.js --apply`
  para que a activaciones le llegue la renovación de Silverking.

## [Rediseño Command Center — F0 fundaciones + F1 home con señales por rol] — 2026-07-13

> Driver: `PLAN_REDISENO_COMMAND_CENTER.md` (F0+F1). Dirección aprobada sobre las
> maquetas de `Cecomunica Design System/rediseño pagina cecomunica command center/propuesta/`.
> Commits `3c2f801` (docs) + `0531689` (feat). DESPLEGADO (hosting) 2026-07-14.

- **`css/ceco-command.css`** — sistema del rediseño (tokens de marca + shell rail
  navy/workspace claro + señales `sig--*`, chips, KPIs con shimmer, stepper `flow`,
  launcher del home). Convive con `ceco-ui.css`; las páginas migran una a una.
  Inputs como `.cc-input` para no colisionar con `.input` del kit viejo.
- **`js/core/modulos.js`** — `window.MODULOS`: mapa rol→módulos extraído del home
  (fuente única para tarjetas, rail y señales) + `rolEfectivo()` ("Ver como").
  Se añade `gerente` al mapa (ausente del literal histórico del home).
- **`js/core/layout.js`** — nuevo `Layout.renderShell({active, rol, userName, title,
  back, actions})`: rail navy con grupos filtrados por `MODULOS` + topbar claro +
  drawer móvil + `setRailBadge()`. `renderTopbar` intacto (lo siguen usando las
  páginas no migradas).
- **`js/services/senalesService.js`** — conteos con agregados `count()` (compat
  ≥9.16; `aggregatesDisponibles()` degrada en silencio). Piso de permisos
  documentado contra firestore.rules (sin cambios de rules). Limitación v1
  aceptada: los conteos de órdenes incluyen soft-deleted (raros).
- **`js/pages/home-signals.js`** — fila de señales del home. Gating doble: lista
  por rol (`POR_ROL`) **y** gate de módulo (`MODULOS.puedeVer`) sobre el rol
  efectivo; una consulta que falle quita su tarjeta sin romper el home. Cache
  sessionStorage TTL 5 min por (uid, rol). Matriz: admin/gerente/jefe_taller
  S1·S3·S4·S6; recepción S1·S2·S4·S8 (sin cotizaciones); vendedor S7·S8·S1·S4;
  técnicos S5·S4P (solo lo suyo vía `tecnico_uid`); inventario S9; vista S1·S3·S4;
  contabilidad sin fila.
- **`index.html`** — home rediseñado en claro: franja navy compacta (saludo por
  hora + rol + fecha, botones perfil/admin/salir), señales, buscador con atajos
  visibles, módulos agrupados por área (Operación/Comercial/Almacén y
  finanzas/Personal, grupos vacíos se ocultan). Conserva: visibilidad por rol,
  skeletons, buscador, atajos O/P/I/C/V/Q/X/F, banner "Ver como" (ahora vía
  `MODULOS.rolEfectivo`). Nuevas tarjetas Mi Perfil (todos) y Panel de
  Administración (solo admin, oculto al impersonar).

### QA targets
- Login recepción: señales Por asignar / Mostrador / Completadas / Contratos por
  activar; sin tarjeta ni señal de cotizaciones/inventario/facturación.
- Login técnico: solo "Mis órdenes asignadas" y "Mis completadas" (conteos propios).
- Login contabilidad: sin fila de señales; solo Facturación + Personal.
- Admin con `?as=tecnico`: banner "modo visual", señales y tarjetas del técnico
  (los conteos "míos" del admin serán 0 — correcto, es su uid real).
- Segunda visita al home en la misma sesión: señales instantáneas (cache 5 min).

## [KPIs Junta — fase 4: snapshot PDF server-side + respaldos] — 2026-07-13

> Driver: `PLAN_KPI_REPORT.md` F4. DESPLEGADO (functions + storage + hosting).

- **Callable `kpiReportSnapshot`** (admin-only, 1GiB/120s): `generate` recibe el HTML ya renderizado de la página del reporte (única fuente de verdad del render), lo convierte a PDF con Puppeteer (carta, `preferCSSPageSize`) y lo archiva en `kpi_reports/{mes}/…pdf` estampando `pdf_path`/`pdf_generated_at`/`_by`; `url` firma una URL v4 de 10 min; `archiveSource` respalda el xlsx fuente en `kpi_reports_fuentes/` (valida magic PK + tamaño).
- **storage.rules**: `kpi_reports/**` y `kpi_reports_fuentes/**` con `read, write: if false` — los bytes solo se alcanzan por las URLs firmadas del callable (mismo criterio que los paths PII).
- **Flujo publicar**: al publicar un mes desde el archivo se navega a `kpi-reporte-print.html?mes=X&archivar=1`, que genera el snapshot automáticamente tras el render. La página del reporte gana botón "Archivar PDF" + indicador "PDF archivado el … · ver"; el archivo muestra botón PDF en las filas con snapshot. El snapshot de un mes en borrador conserva la marca de agua.
- **Respaldo del Excel fuente**: tras un import exitoso se sube el workbook original vía `archiveSource` (best-effort, no bloquea).
- **Exportar histórico**: botón en el archivo que genera `Historico KPIs Junta AAAA-MM-DD.xlsx` (formato plantilla re-importable + columnas estado/comentarios, que el import ignora).
- **Fix de datos vs reporte viejo**: el Excel era internamente inconsistente en activaciones brutas YTD 2025 (388 no cuadra con bajas 240 + netas +242); la serie mensual derivada (Mar-2025 = 94, consistente con la base de suscriptores 4016→4070) da 482, que es lo que muestra el módulo.
- Snapshot E2E validado localmente (Chrome local + Storage real): `kpi_reports/2026-06/…pdf` generado — 3 páginas, marca BORRADOR, gráficas y tipografía correctas.

## [Módulo Reporte KPIs Junta — archivo mensual + reporte ejecutivo] — 2026-07-13

> Driver: `PLAN_KPI_REPORT.md`. Convierte el reporte mensual a la junta (Excel a mano + rediseño HTML one-off) en un módulo del panel admin. Commit `5e791d5`. DESPLEGADO (rules + hosting) y backfilleado.

- **Colección `kpi_reports`** — un doc por mes (ID `YYYY-MM`) con métricas del Financial Report (recurrente Kenwood/Hytera, ventas, otros, ajustes, total, subs, brutas/bajas, churn) + `comentarios{ingresos,recurrente,suscriptores}` + `estado` borrador/publicado + `concilia`. Reglas: read/write solo admin (data financiera de junta — protección real, no solo UI).
- **`admin/kpi-reportes.html`** — archivo del módulo: lista de meses, importación del xlsx con preview/diff (nuevo/cambiado/igual; conserva comentarios y estado; idempotente), captura/edición manual con validación de conciliación en vivo, publicar/despublicar.
- **`admin/kpi-reporte-print.html`** — el reporte ejecutivo con el rediseño (`?mes=YYYY-MM`): port vanilla de las 4 gráficas SVG (sin React), YTD/comparativos vs año anterior calculados, marca de agua BORRADOR, descarga = imprimir a PDF (letter portrait). CSS autónomo como los demás print templates.
- **Dominio**: `kpiDerived.js` (YTD, variaciones, series 12m, ARPU, netas — puro) y `kpiImport.js` (parser del workbook, compartido frontend/backfill). Hallazgos de la fuente codificados: la fila que alimenta el total es "Otros" (no "Otros Ingresos", vacía); Mar-2025 sin brutas → derivada de netas+bajas; solo 2022+ es confiable.
- **Backfill ejecutado**: `functions/backfill-kpi-reports.js` (patrón `backfill-*.js`, ADC) — 54 meses 2022-01→2026-06, todos concilian, re-run = 0 cambios. Históricos `publicado`; 2026-06 `borrador` con los comentarios del rediseño (placeholders `[detallar…]` pendientes de gerencia).
- **Seguridad**: `public/brand/kpi report/` (xlsx confidencial) excluida del deploy de hosting (`firebase.json`) y de git (`.gitignore`); verificado 404 en producción.
- **Plantilla de carga** (follow-up mismo día): botón "Plantilla" en kpi-reportes descarga `Plantilla KPIs Junta.xlsx` (hoja KPIs: una fila por mes con headers claros y los últimos 2 meses archivados como ejemplo + hoja Instrucciones). `KpiImport` ahora auto-detecta formato: PLANTILLA (tabular) o Financial Report legacy. En la plantilla el total es opcional (se calcula de los componentes); mes acepta `AAAA-MM`, `jul-26` o celda fecha; pre-2022 se omite con aviso.

### QA targets
- Como admin: Panel → "Reporte KPIs Junta" → tabla con 54 meses; "Ver" en Junio 2026 → reporte con cifras del rediseño ($1,038,045 YTD, −1.0%, 3,957 subs) y marca BORRADOR; Imprimir → PDF carta.
- Editar Junio 2026 → completar placeholders de comentarios → Publicar → la marca desaparece.
- Re-importar el mismo xlsx → preview muestra "54 sin cambios", botón deshabilitado.
- Como no-admin: /admin/kpi-reportes.html redirige; lectura de `kpi_reports` denegada por rules.

## [Mejoras a "Cotizar desde orden" — feedback de taller (Solangel)] — 2026-07-06

> Driver: `PROMPT_FIX_COTIZAR_ORDEN_SOLANGEL.md` (correo de Solangel Ho Sang 2026-07-03, 6 hallazgos). Rama `feat/cotizar-orden-solangel`, un commit por tarea. NO desplegado — pendiente de revisión.

- **Tarea 4 — Autosave de cotización** (`5f9e68c`): borrador por usuario en `ordenes_de_servicio/{id}/borradores_cotizacion/{uid}` con debounce 600ms + flush en `pagehide`; al reabrir ofrece restaurar (borradores >7 días se descartan); se borra al generar. Nuevos métodos `get/set/deleteBorradorCotizacion` en `OrdenesService`.
- **Tarea 6 — Selección de materiales en la intervención** (`6b03403`): sección "Materiales / piezas" en el modal de trabajo técnico (`ordenes/index.html` + `ordenes-equipos.js`) con modal de búsqueda (`PiezaSearch`), qty, tipo cobro/garantía y precio editable; guarda en la subcolección `consumos` (esquema legacy), descuenta stock (`ajustarDelta`) y reactiva el escritor de `analytics_piezas_modelo` (`incrementarUsoAnalytics`, huérfano desde que se eliminó trabajar-orden en `b4cefac`). `cotizar-orden.js` precarga los consumos de cobro como líneas al abrir (skip si se restauró borrador).
- **Tarea 1 — Jefe de taller** (`8675dbb`): nueva clave `empresa/config.email_taller` (`tallerEmailTo()` en `mailRecipients.js`) sumada a los correos de orden COMPLETADA (`onComplete.js`) y nota de entrega (`confirmarEntrega`), configurable desde admin/config.html como user-picker ("Taller — Notificaciones"); `fotos-taller.js` permite eliminar a admin/jefe_taller/uploader; el menú ⋯ de la orden gana rama `jefe_taller` con "Imprimir / documentos" + notas técnicas.
- **Tarea 5 — Correos estructurados** (`c9087eb`): la nota de entrega adjunta los consumos por equipo (snapshot mínimo) y `emailRenderer` renderiza una sub-tabla "Repuestos / accesorios utilizados — modelo · serie" por radio; precio/tipo solo en correos internos (`data.interno` por destinatario). El correo de aprobación de cotización agrupa renglones por `it.spec` (contexto de equipo).
- **Tareas 2–3 — Catálogo** (`a2361c1`): nombres del drawer legibles en iPad (line-clamp 2 + `title`, panel ≤1024px); campo opcional `categoria` en `inventario_piezas` editable en piezas-tarifas; el drawer agrupa por categoría (colapsable, "Sin categoría" al final) con sección "Sugeridas para {modelo}" vía `getTopByModelo`.

### QA targets
- Cotizar una orden, llenar líneas, cerrar pestaña, reabrir → ofrece restaurar borrador; generar → el borrador desaparece.
- Como técnico: modal de intervención → "Seleccionar materiales" → registrar 2 piezas de cobro → abrir "Cotizar orden" → las 2 líneas aparecen precargadas con SKU/precio; `analytics_piezas_modelo.usos_cobro` incrementa.
- Como jefe_taller: configurar `empresa/config.email_taller`, completar una orden → recibe el correo; ve "Eliminar" en fotos de taller; menú ⋯ muestra "Imprimir / documentos".
- Nota de entrega: correo interno muestra tabla de repuestos con precio; el del cliente sin precio.
- Drawer de catálogo en iPad (≤1024px): nombres en máx. 2 líneas; sin búsqueda se ve "Sugeridas para {modelo}" + grupos por categoría.

## [Ordenes index improvements — batch 21: §3.7 ordenes-index.css cleanup] — 2026-05-19

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §3.7 — the 4,362-line file was the maintenance hotspot. Cleanup ran in 7 ordered buckets with one commit per bucket so any regression bisects cleanly.

### Result
- `public/css/ordenes-index.css`: **4,362 → 3,315 lines (–1,047, –24%)**
- `public/css/ceco-ui.css`: 1,139 → 1,350 lines (+211 from the modal extraction in bucket 1)

### Per-bucket summary
| Bucket | Commit | Lines | Highlights |
|---|---|---:|---|
| 5 — formatting collapse | `ce20349` | –542 | 135 single-decl + 91 two-decl rules onto one line. |
| 2 — dead CSS sweep | `46ec4cb` | –184 | `.toast--*`, `.btn-wrap`, `.alert-modal-*`, `.resumen-chips`, `.card-contrato .t1/.t2/.estado`, duplicate `@keyframes fadeIn`. |
| 1 — modal extraction | `335d1b0` | –312 | `.notas-modal`, `.text-modal-*`, `.overflow-menu-*` promoted to `ceco-ui.css`. |
| 6 — mobile/desktop dedupe | `0b63a9a` | –3 | Standalone 5-line `@media` blocks merged into their siblings. |
| 3 — letter consolidation | `591ef89` | –6 | 4 dead-cascade duplicates removed; 22 letter-prefix labels stripped. |
| 4 — token fallback drop | `1a15a08` | 0 (–303 B) | 43 `var(--token, #hex)` → `var(--token)`. `px → --sp-*` deferred. |

### Bugs incidentally fixed
- **Toast visibility** — the deleted `.toast { opacity: 0 }` page-local rule was clobbering `ceco-ui.css`'s `.toast` animation final state. Toasts now use the canonical `.toast.ok` / `.toast.bad` styling.

### Decisions documented in §3.7
- Cross-cascade `@media` merge skipped (too risky for marginal gain).
- `px → --sp-*` migration deferred — 340+ values, no line payoff, easier in a focused pass.
- Letter-coded section headers stripped (`/* J) ... */` → `/* ... */`).
- All `var(--token, #hex)` defensive fallbacks dropped — tokens are reliable now.

### QA targets
- Open `/ordenes/` — cards view, table view, both should render identically to pre-cleanup
- Open *Notas técnicas* modal — same styling (extracted to `ceco-ui.css`)
- Trigger a toast (e.g. asignar técnico) — visible, slides in via `ceco-ui.css` animation
- Open the *Equipos / Copiar seriales* text modal — same styling
- Open overflow menus (row `⋯`, topbar) — both `.open` and `.show` toggle classes supported now

## [Ordenes index improvements — batch 20: UX redesign §4.2 + §4.3 + §4.4] — 2026-05-18

> Driver: Tier-4 UX overhaul from `ORDENES_INDEX_IMPROVEMENTS.md`. Three intertwined changes shipped together because they share selectors and styles — splitting would have meant double-touching the same CSS region. View toggle defaults to cards; users can revert to the legacy table via topbar (preference persisted in `localStorage`).

### Added — §4.2 Card-style row
- **Topbar view toggle** (`[grid][table]`) in [public/ordenes/index.html](public/ordenes/index.html). Action handlers `set-view-cards` / `set-view-table` in [public/js/pages/ordenes-events.js](public/js/pages/ordenes-events.js).
- **`getOrdersView()` + `setOrdersView(mode)`** in [public/js/pages/ordenes-ui.js](public/js/pages/ordenes-ui.js) — reads/writes `ordenes:view-mode` (values: `cards` (default) | `table`) in localStorage and toggles `body.orders-view--cards` / `body.orders-view--table`. An IIFE at script-load applies the saved preference before first paint.
- **CSS card layout** in [public/css/ordenes-index.css](public/css/ordenes-index.css) — gated by `@media (min-width: 769px)` so mobile keeps its own `#ordersCards` grid. The `<table>` markup is untouched; CSS flips each `tr[data-orden-row]` into a 3-col × 3-row grid: Row 1 = ID + Cliente + Estado pill, Row 2 = Tipo (muted, full-width), Row 3 = Técnico + Entrega (muted). Actions cell spans all 3 rows in col 3. Fecha creación hidden in cards (still visible in table). Expanded `tr.filaDetalle` becomes a panel flush under the active card via negative `margin-top`.

### Added — §4.3 Chip filter bar
- **`#estadoChipsBar`** in [public/ordenes/index.html](public/ordenes/index.html) — five chips (Todas + 4 estados) above the existing toolbar. Each chip shows a live count (`<span data-count="...">`). `role="tablist"` + `aria-selected` + ARIA tabs semantics. Mobile hides this bar (mobile already has `#mobileEstadoChips` in the drawer).
- **`filtrarPorChipEstado(el)` + `syncEstadoChipsFromSelect()`** in [public/js/pages/ordenes-filters.js](public/js/pages/ordenes-filters.js). The chip handler mirrors the chosen estado into the now-hidden `<select id="filtroEstado">` and delegates to `filtrarPorEstado` — keeps `getActiveFilters()`, URL serializer, and presets working unchanged. `_applyURLToFilters` now also syncs chip state on URL/preset apply and `popstate`.
- **Per-estado palette** on active chips matches the row `.estado-pill` palette (POR ASIGNAR critical-red, ASIGNADO warning-amber, COMPLETADO brand-blue, ENTREGADO online-green) so the active filter visually echoes the rows it surfaces.
- **`actualizarResumen` rewritten** in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) — counts now come from the unfiltered `APP.state.orders` so chip counts reflect the dataset, not the current filter view. Filled into `[data-count="..."]` on the chip bar.

### Added — §4.4 Typography hierarchy
- **Desktop table tier system** in `ordenes-index.css` — `tbody td:nth-child(1)` (ID) and `(2)` (cliente) bold + `--fg-1` + 14 px; `(3)` técnico, `(4)` tipo, `(6)` fecha-creación, `(7)` fecha-entrega muted + `--fg-3` + 13 px. `thead th` uppercase-tracked + smaller. tabular-nums on the ID column and date columns.
- **Mobile card BEM extraction** in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) — replaced 5+ inline `style=` attributes with `card-contrato__tier1` / `tier2` / `tier3` / `id` / `cliente` / `tipo` / `tecnico` classes. The mobile card now also surfaces the `estado-pill` (with dot) in the top-right of tier 1, matching the desktop card-view's pill placement.

### Changed
- Estado dropdown (`<select id="filtroEstado">`) is now visually hidden (`.filter-field--hidden`) but kept in the DOM as the canonical state holder.
- Mobile cards no longer use the ad-hoc `<span class="estado">` with inline-style background; they use the shared `.estado-pill` palette like the desktop rows.

### Files touched
- HTML: `public/ordenes/index.html` (chip bar + view toggle + filtroEstado hide hook)
- CSS: `public/css/ordenes-index.css` (~330 new lines; §4.2 + §4.3 + §4.4 blocks)
- JS: `public/js/pages/ordenes-render.js` (mobile card markup + actualizarResumen)
- JS: `public/js/pages/ordenes-filters.js` (chip handler + URL/popstate sync + limpiarFiltros chip reset)
- JS: `public/js/pages/ordenes-events.js` (3 new action handlers)
- JS: `public/js/pages/ordenes-ui.js` (`setOrdersView` + persistence + init)
- Docs: `ORDENES_INDEX_IMPROVEMENTS.md` — §4.2 + §4.3 + §4.4 marked shipped; status block updated.

### UX
- Default first-load view is **cards** — denser visual scan, three-tier rhythm per row. Power users (admin/recepción doing bulk triage) can switch to **table** via the topbar toggle and the preference persists.
- Chip bar makes estado the primary filter affordance — one click vs. open-dropdown-then-pick. Counts are visible at all times.

## [Ordenes index improvements — batch 19: server-side email render] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §3a.12 — single source of truth for entrega email branding/i18n; eliminates the duplicate inline 70-line template literal that lived in the frontend.

### Added
- **`buildBodyNotaEntrega({ orden, ordenId, opts })`** in [functions/src/domain/emailRenderer.js](functions/src/domain/emailRenderer.js). Renders the entrega email body server-side; two branches (normal delivery vs `noRecibido`) match the frontend behavior. Every interpolation goes through a new module-level `escapeHtml`. `fechaISO` from the caller is honored so the rendered date matches the moment the entrega was confirmed (not the moment the queue worker fires).
- **`renderByTemplate(data)` dispatcher** in the same file. `onMailQueued` consults it first; returns `null` for unknown templates so legacy `html` / `bodyContent` paths still work. `nota_entrega` is the first registered template. Adding a new template = add a `buildBody*` + a case in the switch.

### Changed
- [functions/src/triggers/mail/onMailQueued.js](functions/src/triggers/mail/onMailQueued.js) — render precedence is now `template` → `html` → `bodyContent`. Error message updated.
- [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) `confirmarEntrega` — enqueues `{ template: 'nota_entrega', data: { ordenId, orden, opts } }` instead of pre-built HTML. New private `_ordenEmailSnapshot(orden)` distills the order doc to the four fields the email needs (cliente_nombre, tecnico_asignado, tipo_de_servicio, filtered equipos) so `mail_queue` docs don't leak the whole order.
- Deleted the local `_buildEmailHtml` (~90 lines of template literals) — single source of truth lives server-side now.

### Docs
- [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §6.4 documents the `template` → `html` → `bodyContent` precedence and the contract for adding new templates.
- [ORDENES_INDEX_IMPROVEMENTS.md](ORDENES_INDEX_IMPROVEMENTS.md) §3a.12 marked shipped; §3a entrega-flow status line updated.

### Security
- Server-side `escapeHtml` now owns all entrega-email escaping. The frontend was already escaping via `escapeHtml` from `ordenes-state.js`; moving to the CF removes the risk that a future caller bypasses the helper and ships raw user input into an email.

### Deploy
- `firebase deploy --only functions:onMailQueued` picks up the new renderer.
- Frontend ships immediately on hosting deploy; no migration needed (existing `mail_queue` docs in flight still render via the legacy `html` field).

## [Ordenes index improvements — batch 18: PII purge as manual callable + doc notes] — 2026-05-18

> Driver: stakeholder feedback after batch 17 — want to review what would be deleted before any first run, and prefer explicit triggering over a nightly cron until retention policy is formally documented for clients. Also closes the SVG decision in §3a.7 (not pursuing).

### Changed
- **`purgePIIRetention` is now a callable HTTPS function, not a scheduled cron.** [functions/src/triggers/scheduled/purgePIIRetention.js](functions/src/triggers/scheduled/purgePIIRetention.js) swapped the `onSchedule("every day 03:00", TZ=America/Panama)` wrapper for `onCall`. Inner purge logic is unchanged. Admin-only — checks `usuarios/{caller.uid}.rol === 'admin'`, otherwise throws `permission-denied`. Accepts `{ dryRun: true }` (returns `candidates` + a `sample[]` of up to 50 paths without deleting) and `{ retentionDays: <n> }` to override the 90-day default for one-off invocations. When purging for real, also stamps `identificacion_purged_by: <caller-uid>` on the order doc for audit attribution.
- Path remains under `triggers/scheduled/` to keep diff minimal; the file header explicitly documents both the callable wrapper and how to revert to a cron if needed. Trigger total recomputed as **2 HTTP + 1 callable + 9 Firestore triggers = 12 CFs**.

### Decisions
- **§3a.7 SVG signature — not pursuing.** Updated [ORDENES_INDEX_IMPROVEMENTS.md](ORDENES_INDEX_IMPROVEMENTS.md) §3a.7 with strikethrough + rationale: PNG capture with DPR scaling (§3a.5 shipped) is sufficient for current operational use. Re-evaluate only if entrega flow becomes legally critical.

### Docs
- [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §5.5 retention table now flags purga as **manual**; new paragraph documents the invocation contract (`dryRun`, `retentionDays`, admin gate, `permission-denied` for non-admins).
- §6.1 file-tree comment for `scheduled/purgePIIRetention.js` annotated as "callable manual, no cron".
- §6.3 trigger row updated: trigger type now `onCall (callable HTTPS, admin-only)`, responsibility describes `dryRun`/`retentionDays`/`identificacion_purged_by` audit field.

### How to invoke
```js
// dry run (preview without deleting)
firebase.functions().httpsCallable('purgePIIRetention')({ dryRun: true })
// real purge with default 90-day retention
firebase.functions().httpsCallable('purgePIIRetention')({ dryRun: false })
// override retention for one-off (e.g. compliance request)
firebase.functions().httpsCallable('purgePIIRetention')({ dryRun: false, retentionDays: 30 })
```

### Deploy
- `firebase deploy --only functions:purgePIIRetention` — replaces the previously-deployed scheduled version. Cloud Scheduler will drop its registration for the renamed trigger type automatically; verify via `firebase functions:list`.

## [Ordenes index improvements — batch 17: presets + hover actions + PII retention] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §5.5 + §5.2 + §3a.3. §5.1 (bulk operations) marked out-of-scope per stakeholder feedback — orders are managed one at a time today.

### Added
- **Saved filter presets** (`ORDENES_INDEX_IMPROVEMENTS.md` §5.2). New `OrdenesPresets` API in [public/js/pages/ordenes-presets.js](public/js/pages/ordenes-presets.js) stores up to 20 named presets in `localStorage` (key `ordenes:filter-presets:v1`). Each preset captures the URL search string from §5.4, so save+load round-trips the full filter state including sort + soloMias. Markup adds a "Presets" dropdown to the filter toolbar; first item is "Guardar filtros actuales…" (prompts via `Modal.prompt`), followed by saved presets each with a load button and an inline × delete. Saving with an existing name updates that preset in-place. Wired four new data-action handlers in `ordenes-events.js` (`toggle-presets-menu`, `guardar-preset`, `cargar-preset`, `eliminar-preset`).
- **PII retention Cloud Function** (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.3). New `purgePIIRetention` scheduled trigger in [functions/src/triggers/scheduled/purgePIIRetention.js](functions/src/triggers/scheduled/purgePIIRetention.js) runs daily at 03:00 America/Panama. Lists every object under `ordenes_identificacion/` + `entregas_identificacion/`; for any with `timeCreated > 90 days`, deletes the Storage object, parses the `ordenId` from the filename, and clears the order doc's `identificacion_url` while stamping `identificacion_purged_at: serverTimestamp()` + `identificacion_retention_days: 90` for audit. Signatures in `ordenes_firmas/` are deliberately not touched — legal-adjacent evidence of delivery. Registered in `functions/index.js`; total CF count 11 → 12 (2 HTTP + 10 triggers).

### Style
- **Hover-revealed quick actions** (`ORDENES_INDEX_IMPROVEMENTS.md` §5.5). `.acciones-wrap` inside `tr[data-orden-row]` now defaults to `opacity: 0.45` and jumps to `1` on `:hover`, `:focus-within`, or when the row is expanded (`.activo`). 120 ms transition. Touch devices (`@media (hover: none)`) keep full opacity since they have no hover state. Mobile cards layout is unaffected (different markup, no `.acciones-wrap` wrapper).

### Decisions
- **§5.1 bulk operations — not pursuing.** Updated [ORDENES_INDEX_IMPROVEMENTS.md](ORDENES_INDEX_IMPROVEMENTS.md) §5.1 to mark as out-of-scope. Operationally the team manages orders one at a time today; no current workflow benefits from bulk re-assign / print / export. Strikethrough preserved for context; re-evaluate if a sustained 10+/day batch flow appears.

### Docs
- [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §5.5 (Storage table) extended with a retention column; §6.1 file tree adds the new `scheduled/` directory; §6.3 trigger table adds `purgePIIRetention` row.

### Deploy
- `firebase deploy --only functions:purgePIIRetention` — the scheduled trigger registers itself with Cloud Scheduler on first deploy. No backfill needed; runs nightly going forward.

## [Ordenes index improvements — batch 16: audit-log timeline] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §5.7 + the `os_logs` asymmetry noted in §3a.9.

### Added
- **Audit-log timeline** in the expanded row in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js). New `_buildTimelineHTML(ordenData)` helper derives entries from the `fecha_*` timestamps the lifecycle handlers already write (`fecha_creacion`, `fecha_asignacion`, `fecha_completado`, `fecha_entrega`, `fecha_eliminacion`), sorts ascending, and renders a vertical timeline. Each entry shows the action, formatted date (`Mar 18 14:32`), and "by" line where available (`tecnico_asignado` for ASIGNAR, `completado_por_email` for COMPLETAR, `entrega_por_email` for ENTREGAR). Section title "Línea de tiempo" appears between the resumen-operativo block and the equipos table.
- `formatFechaHora(ts)` in [public/js/pages/ordenes-state.js](public/js/pages/ordenes-state.js) — compact `DD Mmm HH:MM` formatter using `es-PA` locale. Falls back to date-only `formatFecha` when the timestamp can't be `.toDate()`'d (uncommitted serverTimestamp).
- `.timeline-orden` block styles in [public/css/ordenes-index.css](public/css/ordenes-index.css). Vertical connector line with per-state dot colors that mirror the `.estado-pill` palette (warning amber for asignado/no-recibido, brand blue for completado, online green for entregado, critical red for eliminado).

### Changed
- **`os_logs` now covers all three transitions** (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.9 — was previously asymmetric, only ENTREGAR wrote). `OrdenesService.assignTechnician` and `completeOrder` in [public/js/services/ordenesService.js](public/js/services/ordenesService.js) now append `{ action: 'ASIGNAR'|'COMPLETAR', by: <uid> }` entries via `arrayUnion`.
- `completeOrder` additionally captures `completado_por_uid` and `completado_por_email` so the timeline can attribute the action — previously only the timestamp was recorded.
- Updated [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §5.4 to reflect the new symmetric audit coverage.

### UX impact
- Staff can now answer "when did this orden last move?" without leaving the page — the timeline lives inline in every expanded row.
- Combined with §3.1 live updates, the timeline updates in real time as another user advances the orden through its states.

## [Ordenes index improvements — batch 15: onSnapshot live updates] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §3.1 — biggest Tier-3 UX win.

### Added
- **Live first-page updates via `onSnapshot`.** New `OrdenesService.subscribeFirstPage({ userRole, userId, limit, onUpdate, onError })` in [public/js/services/ordenesService.js](public/js/services/ordenesService.js) returns an unsubscribe function. Shares the role-filtered + `orderBy fecha_creacion desc` + `limit(pageLimit)` query construction with `loadOrders` via a new private `_buildOrdersQuery()` helper.
- New `_iniciarSnapshotInicial()` / `_detenerSnapshotInicial()` pair in [public/js/pages/ordenes-data.js](public/js/pages/ordenes-data.js). Listener merges live results with previously-paginated entries (live wins on `ordenId` collision, older paginated orders past the first-page cursor are preserved). Calls `aplicarFiltrosCombinados()` on every snapshot fire so active filters still apply. Auto-stops on `pagehide`.

### Changed
- `cargarOrdenesYEquipos(true)` now delegates to `_iniciarSnapshotInicial()` — same public signature, but the initial load is now a live subscription instead of a one-shot read. `cargarOrdenesYEquipos(false)` (pagination via "Cargar más") remains a one-shot read past the cursor.
- The `pageshow` handler in [public/js/pages/ordenes-index.js](public/js/pages/ordenes-index.js) re-establishes the subscription instead of forcing a manual reload — safer on Safari BFCache where the underlying connection may have dropped.
- `renderOrdersList` in [public/js/pages/ordenes-filters.js](public/js/pages/ordenes-filters.js) now snapshots the set of currently-expanded `tr.activo` ordenIds before clearing and re-expands them after re-render. Without this, every snapshot fire would collapse any row the user had open mid-task.

### Removed
- Four `setTimeout(() => { APP.state.orders = []; APP.state.lastVisible = null; cargarOrdenesYEquipos(true); }, 1000)` blocks in [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) (after `assignTechnician`, `completeOrder`, `deleteOrder`, `confirmarEntrega`). The 1 s pause was code-smell waiting for CF triggers to settle — onSnapshot picks up the Firestore write within milliseconds, no manual reload needed.

### UX impact
- Lifecycle actions (asignar, completar, eliminar, entregar) reflect in the UI within milliseconds instead of after a 1 s pause.
- Two staff members editing in different tabs now see each other's changes in real time.
- No more stale-state-after-CF window where the user could click again before the reload finished.

### Known limitation
- `filtrarPorEstado` runs a bespoke one-shot query (`OrdenesService.filterByStatus`, limit 200) that can return more rows than the live first page. When the snapshot subsequently fires, the re-render falls back to `APP.state.orders` (first-page-sized) filtered client-side by `filtroEstado`. Users on this path may see fewer rows than the original badge-filter result. Fix is to either (a) make `filtrarPorEstado` write into `APP.state.orders` or (b) drop the bespoke path and rely on the first-page subscription + client filtering. Deferred — uncommon path in practice.

### Cost note
- Per the doc: snapshot listeners cost 1 read + 1 per change. Idle sessions are cheaper than the previous polling pattern; active sessions are roughly comparable. Net effect: roughly neutral or favorable in steady state.

## [Ordenes index improvements — batch 14: URL state + entrega modal a11y + persistence check] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` Tier 3. Closes §3.3, §3a.11, and §5.4.

### Added
- **URL filter state** (`ORDENES_INDEX_IMPROVEMENTS.md` §5.4). Filters now serialize to the URL via `history.replaceState` so refresh preserves them, copy-paste-link reproduces the view, and back/forward navigates filter history. Implementation in [public/js/pages/ordenes-filters.js](public/js/pages/ordenes-filters.js):
  - `_syncFiltersToURL()` encodes `#filtroOrden`, `#filtroCliente`, `#filtroSerial`, `#filtroTipo`, `#filtroEstado`, `#filtroTecnico`, `#toggleMisOrdenes`, plus `APP.state.sortField` and `sortAscending`. URL keys are full names (`orden`, `cliente`, `serial`, `tipo`, `estado`, `tecnico`, `mias`, `sort`, `asc`).
  - `_applyURLToFilters()` reads the params, populates the DOM inputs, mirrors to mobile drawer counterparts, and returns whether anything was applied.
  - Quick-search (`#filtroRapido`) intentionally NOT serialized — ephemeral by design.
  - `popstate` listener re-applies URL state then calls `aplicarFiltrosCombinados`.
- Hooked sync into `aplicarFiltrosCombinados`, `filtrarOrdenes`, `filtrarPorEstado`, `limpiarFiltros`, `cambiarOrden`, `cambiarDireccionOrden`. The page-load chain in [public/js/pages/ordenes-index.js](public/js/pages/ordenes-index.js) calls `_applyURLToFilters()` after the filter dropdowns are populated and before the initial data load, so sort + soloMias take effect on the first render.

### Refactor
- **Entrega modal now uses `Modal.open()`** (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.11). `abrirModalEntrega` / `cerrarModalEntrega` in [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) switched from `APP.utils.show/hide` to `Modal.open('modalEntrega')` / `Modal.close('modalEntrega')`. The focus-trap and Escape-to-close from QW5 now apply to the entrega flow too. ARIA attrs were already in place from batch 11. Backdrop-click handler is still wired separately since `Modal.open` doesn't cover that.

### Verified
- **`enablePersistence` is wired correctly** (`ORDENES_INDEX_IMPROVEMENTS.md` §3.3). [public/js/firebase-init.js:20](public/js/firebase-init.js#L20) calls `firebase.firestore().enablePersistence({ synchronizeTabs: true })` with a `.catch()` that logs `err.code`. Safari ITP and multi-tab failures surface to the console rather than failing silently. No code change needed.

## [Ordenes index improvements — Tier 1 + Tier 2 roll-up] — 2026-05-18

Summary of the 13 atomic commits below that closed Tier 1 (P0 cost/blockers) and Tier 2 (QW quick wins) of `ORDENES_INDEX_IMPROVEMENTS.md`. Roll-up is informational — individual batch sections retain the per-commit detail.

### Tier 1 — P0 cost & deploy-blockers (4 commits)
| Commit | Item | Headline impact |
|---|---|---|
| `2700b61` `infra(storage)` | §3a.2 storage.rules | Deploy-blocker resolved; per-path allowlists for 6 Storage paths |
| `8d71a93` `perf(ordenes)` | §1.2 `cliente_nombre` denorm | ~720k reads/day eliminated from `cargarClientes` |
| `07cdae7` `perf(ordenes)` | §1.3 responsive single-layout | Halved DOM size on every render (mobile cards XOR desktop table) |
| `8b0ade6` `perf(ordenes)` | §1.1 `searchTokens` indexed search | Search cost O(collection) → O(matches); ~2.4M → ~12k reads/day |

### Tier 2 — Quick wins (5 commits, 16 QW items)
| Commit | QW items |
|---|---|
| `69d685a` (earlier session, 4-batch wrapper) | QW1 toasts, QW2 modals, QW3 prompt→Modal.prompt, QW6 `<th scope>`, QW7 `aria-live`, QW8 keyboard row toggle, QW12 console.log markers, QW13 auth fallback, QW16 `:focus-visible` (verified shipped in `b9ef6c8`) |
| `95c933a` `style(ordenes)` | QW10 estado-pill AA palette, QW15 empty-state UI |
| `76b9b00` `refactor(ordenes)` | QW9 entrega-modal CSS extraction (50 → 15 inline styles) |
| `51c7071` `perf+a11y(ordenes)` | QW4 row event delegation, QW5 modal focus trap |
| `a65ae7d` `feat(ordenes)` | QW11 skeleton-row loader |
| `d0ed77f` `feat(ordenes)` | QW14 IntersectionObserver auto-load |

### Deploy order for Tier 1
The cost-curve fixes are mostly safe to deploy in any order (the searchTokens fallback covers the migration window), but for cleanest activation:
1. `firebase deploy --only storage` — needed before next entrega in prod
2. `firebase deploy --only functions:onOrdenWriteSearchTokens`
3. `cd functions && node backfill-search-tokens.js --dry-run`, then without `--dry-run`
4. `firebase deploy --only hosting`

### Still open
- §3a.3 (PII retention CF), §3a.11 (entrega → `Modal.open`), §3a.12 (server-side email render).
- Tier 3: §3.1 (`onSnapshot` live updates), §3.2 (modular Firebase SDK), §3.3 (`enablePersistence` verify), §5.4 (URL filter state — 2 h, high leverage).
- Tier 4: §4.x card-style redesign, chip filter bar; §5.x bulk ops, saved filters, BarcodeDetector.

---

## [Ordenes index improvements — batch 13: intersection-observer auto-load] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` QW14. Last item in the Tier-2 quick-win block.

### Added
- `#btnCargarMas` now triggers `cargarOrdenesYEquipos(false)` automatically when it scrolls within 200 px of the viewport (top or bottom). Implementation in [public/js/pages/ordenes-index.js](public/js/pages/ordenes-index.js) wraps the existing click handler with a single `triggerLoadMore()` function that gates on:
  - `_autoLoadInFlight` flag — prevents double-fires while a load is mid-flight (the `IntersectionObserver` can fire repeatedly during scroll)
  - `btnCargarMas.disabled` — respects the manual disable used when no more pages
  - `btnCargarMas.style.display === "none"` — respects the hide used after a filtered search returns < page-size results
- The button stays in the DOM as a manual fallback for environments without `IntersectionObserver` and for users who prefer explicit pagination. The IO is set up only when the API is available (it's universal in browsers from 2017+ but the guard is cheap).
- `rootMargin: "200px 0px 200px 0px"` so the prefetch starts a bit before the button is actually visible — keeps the load invisible during normal scrolling.

### Tier 2 closed
All seven Tier-2 quick wins now shipped: QW4, QW5, QW9, QW10, QW11, QW14, QW15 (plus §3.5 noted as already-resolved). Five commits in this Tier-2 run: `95c933a`, `76b9b00`, `51c7071`, `a65ae7d`, plus this one.

## [Ordenes index improvements — batch 12: skeleton loader] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` QW11.

### Added
- `renderSkeletonRows(count)` in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) writes content-shaped placeholder rows into both `#ordersTable` (8 `<tr>` with shimmering `<span class="skel">` cells) and `#ordersCards` (matching card divs). Replaces the spinner-only initial-load state. The real data load wipes `innerHTML` on both containers so no explicit "remove skeleton" step is needed.
- `.skel` + `.skeleton-row` / `.skeleton-card` styles in [public/css/ordenes-index.css](public/css/ordenes-index.css) — design-system-token-driven shimmer animation (`--border-subtle` → `--border-default`) at 1.4 s linear infinite. Respects `prefers-reduced-motion: reduce` by disabling the animation.
- Wired `renderSkeletonRows(8)` into the page-load chain in [public/js/pages/ordenes-index.js](public/js/pages/ordenes-index.js); dropped the now-unused `APP.utils.show("loader")` / `hide("loader")` calls. The `#loader` element in the HTML is still referenced by `filtrarPorEstado` so it stays for that path.

## [Ordenes index improvements — batch 11: event delegation + modal a11y] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` QW4 + QW5.

### Performance
- `renderizarOrdenYEquipos` in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) no longer registers per-row click + keydown listeners. With 50 orders that was 100 listeners; now there's a single delegated pair on `#ordersTable`. Rows carry `data-orden-row` as the selector marker; the handler resolves the orden via `data-orden-id` against `APP.state.orders` for the lazy-render of equipos. `_toggleOrdenRow(filaOrden)` extracted as a top-level function so the delegation IIFE can call it without re-creating per-row closures. ORDENES_INDEX_IMPROVEMENTS.md QW4.

### Accessibility
- `Modal.open` / `Modal.close` in [public/js/ui/modal.js](public/js/ui/modal.js) now implement a focus trap. On open: saves `document.activeElement`, focuses the first focusable inside the modal on the next frame; Tab/Shift+Tab wrap inside the modal so keyboard users can't tab out into the backdrop. On close: restores focus to the previously-focused element. Combined keydown handler also covers Escape (existing). ORDENES_INDEX_IMPROVEMENTS.md QW5.
- `#modalAsignar` and `#modalEntrega` in [public/ordenes/index.html](public/ordenes/index.html) now have `role="dialog" aria-modal="true" aria-labelledby="<titleId>"`, and their close `×` buttons carry `aria-label="Cerrar"`. Title elements got matching ids (`modalAsignarTitle`, `modalEntregaTitle`).
- `abrirModalAsignarTecnico` in [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) switched from `APP.utils.show(modal)` to `Modal.open("modalAsignar")` so the focus trap activates. `cerrarModalAsignar` mirrors with `Modal.close()`.

### Notes
- The entrega modal still uses `APP.utils.show()` for now — ORDENES_INDEX_IMPROVEMENTS.md §3a.11 calls out the migration to `Modal.open()` as a follow-up. ARIA attrs are in place so the migration is purely a JS swap when ready.

## [Ordenes index improvements — batch 10: entrega modal CSS extraction] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` QW9 — biggest cluster of accreted inline styles.

### Refactor
- Extracted the entrega-modal inline-style cluster from [public/ordenes/index.html](public/ordenes/index.html) into a dedicated `.modal-entrega*` block in [public/css/ordenes-index.css](public/css/ordenes-index.css). 30+ inline `style="..."` attributes collapsed into ~15 BEM-style class names (`.modal-entrega__header`, `.modal-entrega__alert`, `.modal-entrega__cb-row`, `.modal-entrega__cb-input--warn|--brand`, `.modal-entrega__label--warn|--muted`, `.modal-entrega__warn-input`, `.modal-entrega__canvas`, `.modal-entrega__field--tight|--med`, etc.). Also introduces `.req` / `.req--warn` for the asterisk markers on required fields.
- HTML now uses `class="hidden"` for the initially-hidden blocks (`entregaNoRecibidoBloque`, `entregaSinIdBloque`) instead of `style="display:none;"`. The JS toggle handlers (`_toggleEntregaNoRecibido`, `_toggleEntregaSinId`) continue to use `style.display = 'block'|'none'` which inline-overrides the class for subsequent show/hide.
- Inline-style count in `ordenes/index.html` dropped from ~50 to 15. The remaining 15 are legitimate (column widths in `<col>`, JS-toggled `display:none`, minor `.toolbar` layout).

## [Ordenes index improvements — batch 9: estado palette + empty state] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` Tier 2. Closes QW10, QW15, and confirms §3.5 already resolved.

### Style
- Repainted `.estado-pill` with the Cecomunica Design System AA-safe palette (`ORDENES_INDEX_IMPROVEMENTS.md` §4.5 / QW10). The four states now use verified WCAG-AA pairs at 13 px / semibold — POR ASIGNAR `#FAE3E3 / #8A1F1F`, ASIGNADO `#FAF1DB / #7A5510`, COMPLETADO `var(--brand-soft) / var(--brand-press)`, ENTREGADO `#E6F4ED / #0F6E47`. Pills now render as `[6px colored dot] LABEL`; the dot uses `var(--status-critical|warning|brand|status-online)` so a future token tweak propagates automatically. Pill markup in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) updated to prepend `<span class="dot" aria-hidden="true"></span>`.
- Adopted `var(--radius-sm)` for the pill corner instead of the literal `4px`.

### Added
- `renderEmptyState(message, { icon, sublabel })` helper in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) renders into both `#ordersTable` and `#ordersCards` so the empty state survives the responsive layout swap shipped in batch 7. The "Limpiar filtros" CTA is gated on `hasActiveFilters(getActiveFilters())` so it only appears when filters are non-default.
- `.empty-state` block styles in [public/css/ordenes-index.css](public/css/ordenes-index.css) using design-system tokens (`--sp-3/6/12`, `--fg-2/3/4`, `--border-subtle`). Includes an icon chip, headline, optional sublabel, and CTA slot.

### Refactor
- Replaced six inline `ordersTable.innerHTML = "<tr><td>...</td></tr>"` empty/error messages in [public/js/pages/ordenes-data.js](public/js/pages/ordenes-data.js) and [public/js/pages/ordenes-filters.js](public/js/pages/ordenes-filters.js) with `renderEmptyState()` calls. Mobile users now see the same message as desktop (previously the empty-state was rendered only into the hidden table).

### Notes
- `ORDENES_INDEX_IMPROVEMENTS.md` §3.5 (`EmpresaService` not loaded) was already fixed in commit `8a4de2b`; the dead-fallback branch in `cargarTiposDeServicioFiltros` is now a legitimate graceful-degradation path (returns hardcoded options when the `empresa/tipo_de_servicio` doc is missing or query fails) — kept intentionally.

## [Ordenes index improvements — batch 8: indexed search via searchTokens] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §1.1 — fourth and biggest Tier-1 item. Closes the remaining Firestore cost leak. Tier 1 is now complete.

### Added
- `functions/src/lib/searchTokens.js` — pure token computation. Builds the bag-of-tokens for an order from its ID + dash-separated parts, cliente_nombre words (≥ 2 chars), tecnico words, tipo_de_servicio words (≥ 3 chars), and each equipo serial plus its 4–8-char suffix tokens (for the common "last 4 digits" workflow). Normalization: lowercase → NFD → strip diacritics → non-alphanumerics to spaces → trim. Sorted output, capped at 200 tokens/doc.
- `functions/src/triggers/ordenes/onWriteSearchTokens.js` — `onDocumentWritten("ordenes_de_servicio/{id}")` trigger. Computes tokens from the after-state, compares against the doc's existing `searchTokens` for idempotence (skips no-op writes that would otherwise recurse forever), updates with `{ searchTokens: newTokens }`. Skips soft-deleted orders.
- `functions/backfill-search-tokens.js` — one-shot script to seed `searchTokens` on existing orders. Run with `--dry-run` to preview, no args to apply. Batches at 400 ops/commit. Idempotent (skips unchanged) so re-runs are safe.
- Registered the new trigger in [functions/index.js](functions/index.js).

### Changed
- `OrdenesService.searchOrders` in [public/js/services/ordenesService.js](public/js/services/ordenesService.js) rewritten with two paths:
  - **Primary:** `where('searchTokens', 'array-contains-any', queryTokens).limit(100)`. Capped at 10 query tokens (Firestore allows 30; conservative cap to bound read budget). Post-filter applies the same OR/AND semantics as the legacy scan, but matches against the doc's `searchTokens` set.
  - **Fallback:** legacy full-collection scan with substring `includes()` logic. Triggers on (a) indexed query throwing (`failed-precondition`, missing index) or (b) zero results — covers the transition window before backfill completes.
- Cost projection from the doc realized: 10k orders × 30 searches/day × 8 users ≈ 2.4M → ~12k reads/day once backfill is done. ~$45/mo → ~$0.20/mo for search alone.

### Docs
- [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §5.6 documents the `searchTokens` schema, who writes/reads, normalization rules, and the cross-file sync requirement between the server lib and the frontend's embedded normalizer.
- §6.1 file-tree updated to include `onWriteSearchTokens.js` and `lib/searchTokens.js`.
- §6.3 trigger table adds the new function; total goes from 8 triggers to 9 (11 total CFs).

### Deploy order
1. Deploy CF: `firebase deploy --only functions:onOrdenWriteSearchTokens`. New orders get tokens automatically.
2. Run backfill from `functions/` directory: `node backfill-search-tokens.js --dry-run` to preview, then `node backfill-search-tokens.js` to apply.
3. Deploy frontend. Indexed query path activates; until backfill finishes, the zero-result fallback covers gaps so users see no regression.

### Tier 1 closed
With this batch, `ORDENES_INDEX_IMPROVEMENTS.md` Tier 1 is fully done: §1.1 (this), §1.2 (batch 6), §1.3 (batch 7), §3a.2 (batch 5).

## [Ordenes index improvements — batch 7: responsive single-layout] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §1.3 — third Tier-1 item. Stops shipping both layouts simultaneously.

### Performance
- `renderizarOrdenYEquipos` in [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) used to build **both** a desktop `<tr>` (+ `<tr>` detail row) and a `.card-contrato` for every order, with CSS hiding the inactive layout at the 768px breakpoint. At 50 orders that's 100 row-equivalents in the DOM, half invisible — noticeable on mid-range Android tablets and a waste of layout/paint budget on every render.
- Branched on `APP.utils.isMobileLayout()` (new helper in [public/js/pages/ordenes-state.js](public/js/pages/ordenes-state.js) mirroring the `@media (max-width: 768px)` rule in `ordenes-index.css:1188`). Desktop branch builds only the table rows; mobile branch builds only the cards. Common pre-computation (`estado`, `fotosTallerCount`) hoisted above the branch.
- Added a debounced (150 ms) `mql.addEventListener('change')` listener at the bottom of `ordenes-render.js` that re-renders via `aplicarFiltrosCombinados()` when the user crosses the breakpoint, so resize-driven layout swaps stay correct. Legacy `addListener` fallback included for older Safari.
- Updated five `lucideRefresh` call sites in [public/js/pages/ordenes-data.js](public/js/pages/ordenes-data.js) and [public/js/pages/ordenes-filters.js](public/js/pages/ordenes-filters.js) to scope into both `ordersTable` and `ordersCards`, since icons now appear in only one of the two depending on layout.

### Notes
- Empty-state message (`<tr><td>No se encontraron coincidencias</td></tr>`) is still only written into `ordersTable`, which is hidden on mobile. Mobile users currently see an empty cards area instead of the message — pre-existing bug, addressed by QW15 (empty-state UI) in a future pass.

## [Ordenes index improvements — batch 6: cliente_nombre denorm] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §1.2 — second Tier-1 item. Closes one of the two Firestore cost leaks.

### Refactor
- Stopped reading the entire `clientes` collection on every page load. Every order now resolves its display name from the denormalized `orden.cliente_nombre` field (written by `nueva-orden.js` since the field landed) with `orden.cliente` as a legacy fallback. At 3k clientes × 30 page loads/day × 8 staff ≈ 720k reads/day eliminated.
- Removed `cargarClientes()` from [public/js/pages/ordenes-data.js](public/js/pages/ordenes-data.js).
- Removed `await cargarClientes()` from the page-load chain in [public/js/pages/ordenes-index.js](public/js/pages/ordenes-index.js).
- Removed `APP.state.clientesMap` from [public/js/pages/ordenes-state.js](public/js/pages/ordenes-state.js).
- Simplified `nombreClienteDe(orden)` from a 3-tier lookup (`clientesMap[id] || orden.cliente_nombre || orden.cliente || "—"`) to `orden.cliente_nombre || orden.cliente || "—"`.
- Dropped the `clientesMap` parameter from `OrdenesService.searchOrders` and the two `ordenes-filters.js` call sites that passed it.

### Notes
- Trade-off: orders no longer reflect cliente-name renames retroactively. If a customer renames "Acme Inc" to "Acme Telecom", existing orders keep the old name. Acceptable for an audit-trail-friendly system; a CF that propagates name changes can be added later if needed.
- Other pages (cotizaciones, POC, contratos) still use `ClientesService.loadClientes` and their own `clientesMap` patterns — out of scope for this change.

## [Ordenes index improvements — batch 5: storage.rules] — 2026-05-18

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md` §3a.2 — first Tier-1 deploy-blocker.

### Infrastructure
- Added [storage.rules](storage.rules) with per-path allowlists for the six Storage paths the app writes to: `ordenes_firmas/`, `ordenes_identificacion/`, `entregas_identificacion/` (legacy), `ordenes/{ordenId}/{equipoId}/`, `ordenes_taller_fotos/`, `contratos_firmados/`. All require an authenticated session; no public reads. Content-type checks and size caps per path. The three PII paths (signatures + ID photos) deny frontend `update` and `delete` — purges run server-side via admin SDK when a retention CF is added (§3a.3 still pending).
- Wired `storage.rules` into [firebase.json](firebase.json) so `firebase deploy --only storage` picks it up alongside the existing `firestore` block.

### Docs
- Documented Storage paths and rules in [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §5.5 (table with content-type, size cap, and frontend-delete column per path).

## [Ordenes index improvements — batch 4] — 2026-05-15

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md`. A11y polish (QW6–QW8) + role-based page size (§3.4). QW16 (`:focus-visible` global) was already shipped in commit `b9ef6c8`.

### Accessibility
- Added `scope="col"` to the eight orders-table `<th>` cells in [public/ordenes/index.html:161-168](public/ordenes/index.html#L161) (`ORDENES_INDEX_IMPROVEMENTS.md` QW6). Screen readers now associate each cell with its column header correctly.
- Wrapped `#resumenOrdenes` and `#mobileResumen` in [public/ordenes/index.html](public/ordenes/index.html) with `role="status" aria-live="polite" aria-atomic="true"` (`ORDENES_INDEX_IMPROVEMENTS.md` QW7). Filter changes that update the resumen counts ("12 órdenes — 4 por asignar") are now announced by screen readers without stealing focus.
- Made the order row a keyboard-operable disclosure widget (`ORDENES_INDEX_IMPROVEMENTS.md` QW8). [public/js/pages/ordenes-render.js](public/js/pages/ordenes-render.js) now sets `tabindex="0"`, `role="button"`, `aria-expanded`, and `aria-label="Detalles de la orden {id}"` on each `<tr>`, and registers a `keydown` listener that treats Enter and Space as a row-toggle (ignoring nested interactive elements). `aria-expanded` flips with the expand/collapse. Click handler refactored to share a `toggleExpand()` helper with the keyboard path.

### Performance / cost
- Page size for the orders list is now role-based (`ORDENES_INDEX_IMPROVEMENTS.md` §3.4). `CONFIG.PAGE_SIZE: 30` in [public/js/pages/ordenes-state.js](public/js/pages/ordenes-state.js) replaced with `PAGE_LIMIT_BY_ROLE` + `pageLimit(role)` helper, mirroring the `contratos-state.js` pattern. Limits: administrador/gerente/recepcion 50, jefe_taller 40, vendedor/inventario/vista 30, tecnico/tecnico_operativo 15. [public/js/pages/ordenes-data.js](public/js/pages/ordenes-data.js) now passes `CONFIG.pageLimit(APP.state.userRole)` instead of the hardcoded `50`. Técnicos (who see only their assigned orders) no longer pay for 50 reads to populate a list of 5; administrators continue to get the wide window they need for browsing.
- Same call site in `cargarOrdenesYEquipos` now prefers `APP.state.userId` over `firebase.auth().currentUser?.uid` (consistency with the same change in `esOrdenMia` from batch 3).

## [Ordenes index improvements — batch 3] — 2026-05-15

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md`. Closes §3.6 sort bug, QW12, QW13.

### Fixed
- Repaired `cambiarOrden` and `mobileSyncSortField` — both read `document.getElementById("APP.state.sortField")` (string literal of the variable name) instead of the actual `<select id="campoOrdenamiento">` (`ORDENES_INDEX_IMPROVEMENTS.md` §3.6). Three call sites in [public/js/pages/ordenes-filters.js](public/js/pages/ordenes-filters.js) and [public/js/pages/ordenes-ui.js](public/js/pages/ordenes-ui.js) corrected. Desktop sort (top-of-page dropdown) and mobile-filters drawer sort now actually change `APP.state.sortField` and trigger a re-load. Bug was present since Phase 5f and earlier — silent fail because `cambiarOrden` threw `TypeError: Cannot read property 'value' of null` and the data-action delegate swallowed it.

### Refactor
- Dropped the defensive `firebase.auth().currentUser?.uid` fallback in `esOrdenMia` ([public/js/pages/ordenes-filters.js:82-86](public/js/pages/ordenes-filters.js#L82-L86)) — `APP.state.userId` is always set by the auth callback in `ordenes-index.js:55` before any filter runs, so the fallback was dead defensive code (`ORDENES_INDEX_IMPROVEMENTS.md` QW13).
- Removed the eight per-file `console.log('[ordenes-*.js] … ready')` markers retained at the end of each ordenes-page module (`ORDENES_INDEX_IMPROVEMENTS.md` QW12). Markers were originally added during the Phase 5f decomposition to verify load order; that order is now stable and the markers were noise in the production console. Removed from `ordenes-state.js`, `ordenes-data.js`, `ordenes-render.js`, `ordenes-filters.js`, `ordenes-flujo.js`, `ordenes-equipos.js`, `ordenes-notas.js`, `ordenes-ui.js`.

## [Ordenes index improvements — batch 2] — 2026-05-15

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md`. Closes §3a.10, §3a.9, and quick wins QW1–QW3.

### Refactor
- Removed the page-local `mostrarToast()` from [public/js/pages/ordenes-ui.js](public/js/pages/ordenes-ui.js); the ordenes page now uses the shared `Toast.show()` from `public/js/ui/toast.js` exclusively (`ORDENES_INDEX_IMPROVEMENTS.md` QW1). All 40+ call sites across `ordenes-ui.js`, `ordenes-notas.js`, `ordenes-equipos.js`, `ordenes-events.js`, `ordenes-flujo.js` migrated. Legacy `'success'`/`'error'` types remapped to the shared API's `'ok'`/`'bad'` (the local `.toast--success` rule never existed in CSS, so previous `'success'` toasts rendered colorless — the migration also fixes that latent bug). Toast styling now matches the rest of the app (dark backgrounds per `ceco-ui.css`). The `.toast--*` CSS rules in `ordenes-index.css:512-550` are now dead; flagged for the next CSS cleanup pass.
- Removed `showAlertModal()` / `createAlertModal()` / `closeAlertModal()` and their module-level state from [public/js/pages/ordenes-ui.js](public/js/pages/ordenes-ui.js) (`ORDENES_INDEX_IMPROVEMENTS.md` QW2). All six call sites across `ordenes-equipos.js`, `ordenes-index.js`, `ordenes-notas.js`, `ordenes-flujo.js` migrated to `Toast.show(msg, 'bad'|'warn')` — every existing use was a notification ("Error al X", "Orden no encontrada", etc.), not a confirmation, so a toast is the right primitive. The `'close-alert-modal'` action handler in `ordenes-events.js:207` removed since the modal no longer exists. `showTextModal()` is intentionally retained: it's a specialized text-display modal with a Copy button and has no equivalent in the shared `Modal` API (would need a new `Modal.text()` method — deferred).
- Replaced the synchronous `window.prompt()` in `editarCampoEquipo` (number-of-serie / modelo / observaciones inline edit) with a new `Modal.prompt()` (`ORDENES_INDEX_IMPROVEMENTS.md` QW3). Added `Modal.prompt({ title, message, defaultValue, placeholder, confirmLabel, cancelLabel, multiline })` → `Promise<string|null>` to [public/js/ui/modal.js](public/js/ui/modal.js): Enter confirms on single-line inputs, Escape/backdrop/Cancel resolves null, multiline mode uses a `<textarea>` and lets Enter insert newlines. The observaciones field now uses multiline. Removes the unstyled native `prompt()` dialog (no validation, no mobile Cancel-as-Escape) flagged in §4.1.

### Fixed
- `entrega_ts` removed from order delivery writes (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.10). Both [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) (custom modal flow) and [public/js/pages/firmar-entrega.js](public/js/pages/firmar-entrega.js) (legacy signature page) were writing both `entrega_ts` and `fecha_entrega` with `serverTimestamp()` — the former unused, the latter consumed by the orders-page "Mostrar fecha entrega" filter. The no-recibido branch previously skipped `fecha_entrega` entirely (despite still marking the order as `ENTREGADO AL CLIENTE`), so those orders were invisible to the date filter — now they get `fecha_entrega` too.

### Docs
- Documented `os_logs` array schema in [ARQUITECTURA_CECOMUNICA.md](ARQUITECTURA_CECOMUNICA.md) §5.4 (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.9). Records who writes (frontend only, today only on `ENTREGAR`), who reads (nothing yet — reserved for the future timeline view in §5.7), wire format (`{ action, by }` — no timestamp because Firestore disallows `serverTimestamp()` inside `arrayUnion`), and the 1 MiB doc-size cap implication. Notes the asymmetry that other transitions (`ASIGNAR`, `COMPLETAR`) don't write to `os_logs`.

## [Ordenes index improvements — batch 1] — 2026-05-15

> Driver: `ORDENES_INDEX_IMPROVEMENTS.md`. Closes Week-0 token bridge cleanup, the §3a entrega-flow security items, and §1.4 lucide scoping.

### Security
- Fixed XSS in `_buildEmailHtml` in [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.4). The local `f()` helper now routes every user-controlled value (`receptorNombre`, `motivo`, `sinIdMotivo`, `personaInterna`, equipo names/models/serials/trabajo, `cliente_nombre`, `tecnico_asignado`, `tipo_de_servicio`) through `escapeHtml`. The `firmaUrl` is also escaped when interpolated into the `<img src>` attribute. Defends against a malicious receptor name producing an `<a href="phishing-url">` link rendered inside a legitimate-looking cecomunica.com email.

### Fixed
- Entrega signature canvas no longer renders blurry on retina screens (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.5). `_resizeCanvas` in [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) now multiplies the canvas backing store by `devicePixelRatio` while keeping CSS size at 100% × 200 px, and uses `setTransform(dpr,0,0,dpr,0,0)` so repeated resize calls stay idempotent. `_clearCanvas` saves/restores the transform to clear the full backing store. The signature PNG uploaded to Storage is now 2×–3× the previous pixel density.
- ID-photo uploads are now compressed client-side before hitting Storage (`ORDENES_INDEX_IMPROVEMENTS.md` §3a.6). New `_prepareIdUpload(file)` in [public/js/pages/ordenes-flujo.js](public/js/pages/ordenes-flujo.js) resizes to ≤ 1280 px on the longest edge and re-encodes as JPEG q=0.85 via `OffscreenCanvas` (with `<canvas>` fallback for older Safari). Skipped for files < 200 KB or non-image MIME (PDF). Fails open: on any compression error, the original is uploaded. Cuts typical 4–6 MB phone-camera JPEGs down ~10–20×.

### Performance
- `lucide.createIcons()` no longer walks the whole document on every render of the orders page (`ORDENES_INDEX_IMPROVEMENTS.md` §1.4). New `APP.utils.lucideRefresh(scope)` helper in [public/js/pages/ordenes-state.js](public/js/pages/ordenes-state.js) takes a single element or an array of elements as the `nodes` scope. Scoped 12 call sites across `ordenes-data.js`, `ordenes-render.js`, `ordenes-filters.js`, `ordenes-flujo.js`, `ordenes-equipos.js`, `ordenes-ui.js` (table re-renders pass `[ordersTable, btnCargarMas]` or `[ordersTable, cardsWrap]`; expanded-row equipment table passes `filaDetalle`; button state updates pass the button itself; modal builds pass the modal root). The single bootstrap call in `ordenes/index.html` is left unscoped since it's a one-time page-load sweep.

### Style
- Back-compat tokens in [public/css/ceco-ui.css](public/css/ceco-ui.css) (`--text`, `--muted`, `--line`, `--ok`, `--warn`, `--bad`, `--chip`) converted from literal duplicates to true `var()` aliases of the design-system bridge tokens (`--fg-1`, `--fg-3`, `--border-default`, `--status-online/warning/critical`, `--brand-soft`). Closes the unfinished half of `ORDENES_INDEX_IMPROVEMENTS.md` §6 Week-0: every consumer of the flat names continues to resolve to the same color, but a future tweak to a design-system token now propagates automatically. Zero visual change.

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
