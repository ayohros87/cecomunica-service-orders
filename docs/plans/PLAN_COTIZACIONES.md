# Plan — Módulo de Cotizaciones (basado en UI Kit `design-system/archivo/cotizacion/`)

> Migración del prototipo React (Babel-standalone) del Design System a JS vanilla, integrando los servicios, CSS y helpers ya existentes en producción. Se reemplaza el módulo de cotizaciones actual (`public/cotizaciones/`) por una versión más completa: list con stats + filtros por estado, editor con catálogo, vista de detalle con historial, y print branded.

---

## 1. Verificación del UI Kit

Carpeta: `design-system/archivo/cotizacion/cotizaciones/`

| Archivo | Rol | Notas para migración |
|---|---|---|
| `index.html` | Bootstrap React/Babel + lucide | Solo referencia visual; no se trasplanta |
| `data.jsx` | Seed: `EMISOR`, `EJECUTIVOS`, `CATALOGO`, `CLIENTES`, `CONDICIONES_DEFAULT`, `PLANTILLAS_COND`, `ESTADOS`, `ESTADO_ORDEN` | `EMISOR` → `EmpresaService` · `EJECUTIVOS` → `UsuariosService.getVendedores()` · `CATALOGO` → `ModelosService.getModelos()` · `CLIENTES` → `ClientesService.loadClientes()` · `CONDICIONES_DEFAULT` y `PLANTILLAS_COND` → constantes locales en `cot-state.js` · `ESTADOS` / `ESTADO_ORDEN` → constante exportada |
| `components.jsx` | Helpers `money`, `fmtFecha`, `addDays`, `lineTotal`, `calcTotales`, `cuenta` + `Logo`, `Icon`, `EstadoChip`, `TopBar`, `StatCard`, `ConfirmModal`, `ToastRegion`, `useToasts` | `money` ↔ `FMT.money` (ya hay) · `fmtFecha` ↔ `FMT.date` (verificar formato corto "12 May 2025") · `lineTotal`/`calcTotales`/`cuenta` → `js/domain/cotizacionesTotales.js` (nuevo) · `Icon` → `<i data-lucide>` + `lucide.createIcons()` · `EstadoChip` → función pura que devuelve `<span class="chip-estado chip-…">` · `TopBar` → `Layout.renderTopbar(...)` · `ConfirmModal` → `Modal.confirm({...})` · `ToastRegion`/`useToasts` → `Toast.show(...)` |
| `ListView.jsx` | Stats + segmentos por estado + tabla ordenable + acciones por fila | Mapear 1:1 a `public/cotizaciones/index.html` + `js/pages/cotizaciones-index.js` |
| `EditorView.jsx` | Cliente+meta · Renglones con autocompletar catálogo + drag-reorder · Condiciones con plantillas · Sidebar Resumen sticky | Mapear a `nueva-cotizacion.html` y `editar-cotizacion.html` (mismo `cotizacion-editor.js`) |
| `DetailView.jsx` | Lectura: cliente + renglones + condiciones + sidebar totales + timeline derivado del estado | Nueva página `detalle-cotizacion.html` |
| `PrintView.jsx` (+ `PRINT_CSS` embebido) | Print 816×1056, header navy con dot-pattern, tabla `cq-*`, totales y firmas | Reemplaza `imprimir-cotizacion.html` actual; portar `PRINT_CSS` a `css/print-cotizacion.css` |
| `app.jsx` | Router en memoria · acciones `saveDraft`/`duplicate`/`askDelete` · `nuevaCotizacion()` factory | Equivalente: navegación entre páginas HTML + acciones contra `CotizacionesService` |
| `app.css` + `colors_and_type.css` + `cotiz.css` | Tokens (ya cubiertos por `ceco-ui.css`) + clases `cc-*` específicas del módulo | Solo portar las clases que **no existen** en `ceco-ui.css` (ver §4) |

**Modelo de datos del prototipo** (cada cotización):
```js
{
  id, estado,                           // string: borrador|enviada|aprobada|rechazada|vencida|convertida
  clienteId, ejecutivoId,
  fecha,                                // ISO YYYY-MM-DD
  validezDias, moneda,                  // 'USD'|'PAB'
  descuentoPct, itbmsPct,
  intro,                                // texto introductorio
  items: [{ id, modelo, nombre, spec, cant, precio, desc }],
  condiciones: [{ k, v }],
}
```

**Estados nuevos vs producción actual**:

| Producción hoy | Prototipo (target) | Acción |
|---|---|---|
| borrador | borrador | OK |
| emitida | (no existe) | conservar como sinónimo o reemplazar por `enviada` |
| enviada | enviada | OK |
| anulada | rechazada | renombrar |
| — | aprobada, vencida, convertida | añadir (con sus chips) |

---

## 2. Reuso de servicios, helpers y CSS existentes

### 2.1 Servicios (cero código nuevo de Firestore donde sea posible)

| Origen prototipo | Servicio existente | Cambios mínimos |
|---|---|---|
| `CLIENTES` seed | `ClientesService.loadClientes()` | Adaptador `mapClienteToUI(c)` → `{ id, razon, atencion, ruc, tel, email }` (no requiere nuevo método) |
| `CATALOGO` seed (productos/servicios) | `ModelosService.getModelos()` | Adaptador `mapModeloToCatItem(m)` → `{ modelo, nombre, spec, precio, cat }` |
| `EJECUTIVOS` seed (firmantes) | `UsuariosService.getVendedores()` | Adaptador `mapVendedorToEjec(u)` → `{ id, nombre, rol, email, tel }` |
| `EMISOR` seed | `EmpresaService.getDoc('emisor')` | Si el doc no existe, crear seed una sola vez con los campos del prototipo |
| Persistencia cotización | `CotizacionesService.{get,add,update,list,getPorFecha,contarPorFecha}` | **Extender** con: `softDelete(id)`, `duplicate(id)` (opcional, también puede vivir en la UI), `enviarPorCorreo(id)` → encola en `mailService` |
| Envío al cliente | `MailService.enqueue({ to, subject, html, attachments })` | Reutilizar tal cual; render del HTML de cotización desde una plantilla mínima |

### 2.2 Core y UI primitives

| Pieza prototipo | Reemplazo |
|---|---|
| `money()` | `FMT.money(n)` (`js/core/formatting.js`) |
| `fmtFecha()` | `FMT.date(iso, { short: true })` — verificar que produzca `"12 May 2025"`; si no, añadir variante `FMT.dateShort` |
| `addDays()` | helper local en `js/domain/cotizacionesTotales.js` (puro, no merece su propio módulo) |
| `lineTotal`, `calcTotales`, `cuenta` | `js/domain/cotizacionesTotales.js` (nuevo, análogo a `domain/totales.js` de contratos) |
| `Icon` | `<i data-lucide="…"></i>` + un solo `lucide.createIcons()` post-render |
| `EstadoChip` | Helper inline en `cot-state.js` que devuelve `<span class="chip-estado ${ESTADOS[e].chip}">${label}</span>` |
| `TopBar` | `Layout.renderTopbar({ title: '<i data-lucide="receipt"></i> Cotizaciones', actions: [...], showHome: true })` |
| `ConfirmModal` | `await Modal.confirm({ message, danger: true })` (`js/ui/modal.js`) |
| `ToastRegion` + `useToasts` | `Toast.show(message, 'ok'\|'bad'\|'warn')` (`js/ui/toast.js`) |
| `AUTH` | `AUTH.is(ROLES.VENTAS)` / `AUTH.requireAccess([...])` para ocultar acciones |

### 2.3 CSS existente que ya cubre el kit

`public/css/ceco-ui.css` ya provee:
- `.app-topbar`, `.app-body`, `.app-wrap`, `.app-page-header`, `.app-breadcrumbs`
- `.app-card`, `.app-table-wrap`, `.app-table` (sortable headers vía `.sortable`)
- `.btn` + variantes (`btn-primary/secondary/ghost/danger/icon/sm`)
- `.form-field`, `.form-label`, `.form-input`, `.form-select`, `.form-textarea`
- `.chip-estado` con variantes (`chip-recibida/cotizada/aprobada/cancelada/reparacion/espera`)
- `.modal*`, `.toast*`, `.filter-bar`, `.filter-search`, `.responsive-cards`, `.toggle-pill`, `.alert-banner`
- `.skeleton-table-row`, `.app-empty-state`, `.app-pagination`

⇒ **No hace falta tocar `ceco-ui.css` para componentes base.** Solo se añade lo específico del módulo.

---

## 3. Estructura de archivos a producir

### 3.1 HTML (en `public/cotizaciones/`)
- `index.html` ← refactor del actual: añade stats, segmented filter por estado, columnas de la tabla del kit.
- `nueva-cotizacion.html` ← refactor: layout de 2 columnas (editor + sidebar resumen sticky), panel renglones con autocompletar y drag.
- `editar-cotizacion.html` ← idéntico a `nueva-cotizacion.html` salvo el bootstrap (`docId` desde query). Comparte JS.
- `detalle-cotizacion.html` ← **nuevo**: vista de lectura con timeline.
- `imprimir-cotizacion.html` ← reescrito al layout `cq-*` del kit.

### 3.2 JS (en `public/js/`)

| Archivo | Tipo | Responsabilidad |
|---|---|---|
| `domain/cotizacionesTotales.js` | nuevo | `lineTotal(it)`, `calcTotales(cot)`, `cuenta(items)`, `addDays(iso, d)`, `validezVence(cot)` (todo puro, sin DOM/Firestore) |
| `services/cotizacionesService.js` | extender | `softDelete(id)`, opcional `duplicate(srcId, nextId)`, `enviarPorCorreo(id, payload)` |
| `pages/cotizaciones-index.js` | reescribir | Carga `CotizacionesService.listCotizaciones`, calcula stats, renderiza tabla + cards responsive, segmented filter, sort, búsqueda, acciones (ver/editar/duplicar/imprimir/eliminar) |
| `pages/cot-editor.js` | nuevo (compartido por nueva + editar) | Estado local de `draft`, bind UI de cliente/meta/renglones/condiciones/resumen; usa `domain/cotizacionesTotales.js`. Maneja autocompletar catálogo (filtrado en cliente sobre `modelos` ya cargados), drag-reorder con `draggable`, plantillas de condiciones |
| `pages/cot-editor-state.js` | nuevo | Catálogos cacheados (`EJECUTIVOS`, `CATALOGO`, `CLIENTES`, `EMISOR`) + `CONDICIONES_DEFAULT` + `PLANTILLAS_COND` + `ESTADOS`/`ESTADO_ORDEN` |
| `pages/cot-detail.js` | nuevo | Carga cotización, render lectura + timeline derivado del estado |
| `pages/imprimir-cotizacion.js` | reescribir | Render del layout `cq-*` |

> Las páginas grandes ya siguen el patrón coordinator + módulos (Phase 5e/5f). Mantener consistencia: `cot-editor.js` puede partirse en `cot-editor-items.js`, `cot-editor-cond.js`, `cot-editor-summary.js` si crece > ~300 líneas.

### 3.3 CSS

- **Añadir** `public/css/cotizaciones-kit.css` con las clases `cc-*` del kit que no existen en `ceco-ui.css`:
  - `cc-stats`, `cc-stat`, `cc-stat--{accent,green,amber}`, `cc-stat-icon`, `cc-stat-value`, `cc-stat-label`, `cc-stat-sub`
  - `cc-segments`, `cc-seg`, `cc-seg-count`
  - `cc-cell-cliente`, `cc-cell-num`, `cc-cell-total`, `cc-row-actions`, `cc-aten`
  - `cc-editor-grid`, `cc-panel`, `cc-panel-head`, `cc-panel-body`, `cc-summary`
  - `cc-dp`, `cc-dp-card`, `cc-dp-lbl`, `cc-dp-co`, `cc-dp-ln`, `cc-meta-grid`
  - `cc-items`, `cc-items-head`, `cc-item-row`, `cc-item-handle`, `cc-item-desc`, `cc-item-spec`, `cc-item-total`, `cc-item-del`, `cc-add-row`, `cc-dragging`, `cc-drag-over`
  - `cc-cat-pop`, `cc-cat-item`, `cc-cat-name`, `cc-cat-meta`, `cc-cat-model`, `cc-cat-price`
  - `cc-cond-row`
  - `cc-sum-controls`, `cc-sum-row`, `cc-sum-row.disc`, `cc-sum-total`
  - `cc-detail-grid`, `cc-kv`, `cc-timeline`, `cc-tl-act`, `cc-tl-meta`
- **Añadir** `public/css/print-cotizacion.css` con el bloque `PRINT_CSS` de `PrintView.jsx` (todas las clases `.cq-*`). Cargar solo en `imprimir-cotizacion.html`.
- **Verificar** en `ceco-ui.css` que existan chips para los nuevos estados; si falta alguno, añadir variantes a `app-kit-extras.css`:
  - `chip-aprobada` → ya existe
  - `chip-vencida` (naranja) → revisar y añadir si falta
  - `chip-convertida` (ámbar) → revisar y añadir si falta
  - `chip-rechazada` → puede mapear a `chip-cancelada` (ya existe)

---

## 4. Modelo Firestore — migración compatible

El doc actual usa: `cotizacion_id`, `cliente_id`, `cliente_nombre`, `fecha_creacion`, `estado`, `items[]`, `deleted`.

Nuevos campos a soportar (default si faltan):
```
ejecutivoId      → user.uid o primer vendedor
validezDias      → 15
moneda           → 'USD'
descuentoPct     → 0
itbmsPct         → FMT.ITBMS_RATE * 100  (7)
intro            → string fijo del prototipo
condiciones      → CONDICIONES_DEFAULT
```

Los renglones del prototipo (`{modelo, nombre, spec, cant, precio, desc}`) deben mapearse a la forma actual de `items` (revisar `nueva-cotizacion.js:74-` para shape exacto). Si difieren, normalizar en lectura/escritura dentro del editor; **no** hace falta backfill en Firestore — los campos faltantes se asumen con defaults.

**Estado migration**: añadir helper en `cot-editor-state.js`:
```js
const ESTADO_LEGACY = { emitida: 'enviada', anulada: 'rechazada' };
function normalizaEstado(e) { return ESTADO_LEGACY[e] || e || 'borrador'; }
```

---

## 5. Plan por fases

### Fase 1 — Cimientos (sin UI visible)
1. Crear `js/domain/cotizacionesTotales.js` portando `lineTotal`, `calcTotales`, `cuenta`, `addDays`.
2. Extender `CotizacionesService` con `softDelete` y `enviarPorCorreo` (este último encola en `mailService`).
3. Crear `js/pages/cot-editor-state.js` con `ESTADOS`, `ESTADO_ORDEN`, `CONDICIONES_DEFAULT`, `PLANTILLAS_COND`, `normalizaEstado()` y un cargador `bootstrapCatalogos()` que llene `EJECUTIVOS`, `CATALOGO`, `CLIENTES`, `EMISOR` desde los servicios existentes.
4. Crear `css/cotizaciones-kit.css` y `css/print-cotizacion.css`.

**Commit checkpoint** (regla [[feedback_commit_before_risky_edits]]): después de Fase 1, antes de reescribir páginas.

### Fase 2 — Lista (`cotizaciones/index.html`)
1. Reemplazar `pages/cotizaciones-index.js` con la lógica del `ListView`:
   - Sustituir el filtro-bar simple por `cc-segments` (Todas + 6 estados) + búsqueda existente.
   - Añadir `cc-stats` (Total emitidas / Enviadas pendientes / Monto aprobado / Tasa de cierre).
   - Sort por columna (id, cliente, fecha, total) — añadir `class="sortable"` + `<SortIcon>` HTML.
   - Acciones por fila (ver/editar/duplicar/imprimir/eliminar). Eliminar usa `Modal.confirm` + `softDelete`.
   - Mantener `responsive-cards` y `btnCargarMas` para paginación.
2. Editar `cotizaciones/index.html` para cargar `cotizaciones-kit.css` y los nuevos servicios.

### Fase 3 — Editor (`nueva-cotizacion.html` + `editar-cotizacion.html`)
1. Crear `pages/cot-editor.js` con secciones:
   - **Cliente y meta** (cliente, fecha, validez, moneda, ejecutivo, estado, vence, intro)
   - **Renglones** con `ItemRow` (autocompletar sobre `CATALOGO`, drag/drop, edición inline). El autocompletar es búsqueda en memoria — no requiere Firestore por keystroke.
   - **Condiciones** con plantillas (`PLANTILLAS_COND`).
   - **Sidebar Resumen** sticky con descuento global, ITBMS, totales, botón guardar/preview.
2. Refactor de `nueva-cotizacion.html` y `editar-cotizacion.html` para que su body sea solo el grid del editor + `<script src="pages/cot-editor.js" defer>` (diferencia: bootstrap obtiene `docId` desde query string en modo edición).
3. Acciones: Guardar usa `addCotizacion`/`updateCotizacion`; vista previa abre `imprimir-cotizacion.html?draft=…` o navega tras guardar.
4. Mantener autoguardado/`alert-banner` de modo lectura cuando estado ∈ {aprobada, convertida}.

### Fase 4 — Detalle (`detalle-cotizacion.html`, nueva página)
1. Crear `pages/cot-detail.js` que carga la cotización, renderiza panel Cliente / Renglones / Condiciones / Sidebar Totales + Historial.
2. Historial = lista derivada del estado (igual que el prototipo). Si en algún futuro se loguean transiciones en Firestore (`historial[]`), aquí se sustituye la derivación por el array real.
3. Botones Editar / Duplicar / Imprimir / Volver.

### Fase 5 — Print (`imprimir-cotizacion.html`)
1. Reescribir el HTML para usar las clases `cq-*` y el grid del kit.
2. Cargar `print-cotizacion.css`.
3. Mantener `print-toolbar` + `window.print()`. Sin auth (ya lo está hoy).
4. Verificar `-webkit-print-color-adjust: exact` y que el header navy con dot-pattern se imprima.

### Fase 6 — Pulido
- Migrar el "Enviar al cliente" desde el detail/list a `enviarPorCorreo` (encola en `mailService`).
- Numeración correlativa al guardar nueva (`CotizacionesService.contarPorFecha` + `COT-YYYY-NNNN`).
- Smoke test manual de cada estado y de las cotizaciones legacy (`emitida`, `anulada`) bajo `normalizaEstado`.

---

## 6. Checklist de reutilización (resumen)

- [x] **CSS base** — `ceco-ui.css` cubre topbar, table, btn, form, chip, modal, toast, breadcrumbs, responsive-cards.
- [x] **CSS específico** — solo nuevo: `cotizaciones-kit.css` + `print-cotizacion.css`.
- [x] **Servicios** — `cotizacionesService`, `clientesService`, `modelosService`, `usuariosService`, `empresaService`, `mailService` ya existen. Solo se extiende `cotizacionesService` con `softDelete`+`enviarPorCorreo`.
- [x] **Core** — `FMT.money/date`, `Layout.renderTopbar`, `AUTH`, `Toast`, `Modal` ya en uso por otras páginas.
- [x] **Domain** — único módulo puro nuevo: `cotizacionesTotales.js` (espejo de `domain/totales.js`).

---

## 7. Riesgos / decisiones a confirmar

1. **Mapeo de estados legacy**: ¿`emitida` se elimina o queda como sinónimo de `enviada`? Sugerencia: tratar `emitida` y `enviada` como sinónimos en lectura y escribir siempre `enviada` desde el editor nuevo.
2. **Catálogo desde `modelos`**: el campo `spec` y `cat` del prototipo no son nativos del esquema actual de modelos. Validar qué campos de `modelos/{id}` se mapean (probable: `nombre` → `nombre`, `marca`/`categoria` → `cat`, `descripcion` → `spec`, `precio_venta` → `precio`).
3. **Ejecutivo (firmante)**: ¿se persiste el `uid` del usuario, o el `id` lógico del vendedor? Decisión: persistir `uid` y resolver display vía `UsuariosService.getUsuario(uid)`.
4. **Detalle como página vs panel**: el prototipo es página completa. Mantener como página (`detalle-cotizacion.html`) por coherencia con el resto del sistema.
5. **Drag-reorder en móvil**: el HTML5 drag-drop no funciona bien en touch. Para móvil, exponer botones ↑/↓ alternativos en `cc-item-row` o difer ir.

---

## 8. Entregables por commit (sugeridos)

1. `feat(cotizaciones/domain): totales + helpers puros` — Fase 1, archivos nuevos sin tocar HTML.
2. `feat(cotizaciones/list): stats + segmented filter + sort` — Fase 2 (`index.html` + `cotizaciones-index.js` + `cotizaciones-kit.css`).
3. `feat(cotizaciones/editor): catálogo + condiciones + resumen sidebar` — Fase 3.
4. `feat(cotizaciones/detail): vista de lectura + timeline` — Fase 4.
5. `feat(cotizaciones/print): layout branded cq-*` — Fase 5.
6. `feat(cotizaciones): envío por correo + numeración correlativa` — Fase 6.
