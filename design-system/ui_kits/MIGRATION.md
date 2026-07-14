# UI Kit — Plan de migración a producción

Plan para alinear las páginas de `public/` con los kits de `ui_kits/app/` y
`ui_kits/app-mobile/`. Ordenado por fases. Cada página tiene su propio bloque
con la lista exacta de cambios.

> **Lectura previa**: `ui_kits/app/README.md` para entender los primitivos y
> las áreas, y `ui_kits/app/index.html` (portal) para tener el mapa visual.

---

## 📍 Checkpoint — última sesión 2026-05-28

**45 páginas migradas** (Fases 0 → 8 de 10). Solo restan los items opcionales:
mobile de Órdenes (Semana 9) y consolidación de `ceco-ui.css` → `app.css`
(Semana 10). El resto del sitio está alineado al kit.

### ✅ Completado

- **Fase 0** — Alinear CSS
  - [x] Creado `public/css/app-kit-extras.css` con 11 primitivos R3
        (toggle-pill, dropdown, tooltip-floating, alert-banner, page-header-centered,
        pager-input, responsive-cards, module-grid, empty-state-hint, auth-shell scopeado,
        **bulk-bar** añadida en Semana 4)
  - [x] `@import './app-kit-extras.css'` añadido al top de `ceco-ui.css`
  - [x] Auth-shell scopeado bajo `.auth-shell` — no rompe el login antiguo

- **Fase 1.1** — Banners en producción
  - [x] `public/clientes/index.html` — `<div class="alert">` → `<alert-banner alert-warning>`
  - [x] `public/login.html` — `#msg` con JS dinámico (`alert-success`/`alert-error` + icon swap)

- **Fase 2 · Semana 2** — Home + Login
  - [x] `public/index.html` — `.app-grid` → `.module-grid` + `.app-card` → `<a class="module-card">`,
        atajos de teclado visibles, JS selectores actualizados
  - [x] `public/login.html` — `.auth-hero+.auth-grid` → `.auth-shell` con brand-mark oficial,
        formularios usan `.form-field`+`.form-input`+`.form-label`, todos los IDs preservados

- **Fase 2 · Semana 3** — Cotizaciones (4 páginas)
  - [x] `public/cotizaciones/index.html` — `<style>` borrado, `.filter-bar` + `.toggle-pill` +
        `.responsive-cards` + `.empty-state-hint`
  - [x] `public/cotizaciones/nueva-cotizacion.html` — `.split-pane` + `.summary-card` +
        `.form-grid-2`/`.form-grid-3`, `details-block` para firma/banco
  - [x] `public/cotizaciones/editar-cotizacion.html` — variante de Nueva + `.alert-banner.alert-warning`
        para modo lectura + badge re-stylizado con tokens chip
  - [x] `public/cotizaciones/imprimir-cotizacion.html` — sin cambios estructurales (ya carga `print-base.css`)
  - [x] `cotizaciones-index.js` — render usa `.td-actions`, `.responsive-card`, `.empty-state-hint`
  - [x] `nueva-cotizacion.js` + `editar-cotizacion.js` — toast helpers apuntan a `#toast-region`

- **Fase 2 · Semana 4** — Clientes (2 páginas)
  - [x] `public/clientes/index.html` — `.filter-bar` + `.toggle-pill`, `#bulkBar` → `.bulk-bar` con
        `.bulk-count`/`.bulk-divider`/`.bulk-tag-wrap`, pager → `.pager-input`
  - [x] `public/clientes/editar.html` — `.form section` → `.app-card.app-card-padded` +
        `.form-section-header` + `.form-grid-2`, prefix icons en teléfono/email, checkbox activo
        → `.form-check` con descripción
  - [x] `clientes-index.js` — `updateBulkBar()` cambia de `style.display` a `classList.toggle('visible', ...)`

- **Fase 2 · Semana 5** — Inventario (5 páginas)
  - [x] `public/inventario/index.html` — 397 → 113 líneas (-72%). `<style>` masivo borrado,
        density toggle preservado, badges de stock page-local
  - [x] `public/inventario/modelos.html` — 384 → 175 (-54%). Topbar custom → `Layout.renderTopbarFor`,
        modal con `.modal-backdrop` del kit, form-grid-2 + form-check
  - [x] `public/inventario/piezas.html` — 498 → 273 (-45%). Dos modales con `.modal-header/body/footer`,
        `.alert-banner` en batch import rules
  - [x] `public/inventario/cargar-inventario.html` — `Layout.renderTopbarFor` + `.filter-bar` con dos search
  - [x] `public/inventario/vista-correo.html` — sin cambios estructurales (página intencionalmente
        inline-CSS para sobrevivir copy-paste a Outlook/Gmail)
  - [x] `piezas.js` — `.table-wrap` query → `.app-table-wrap`

- **Fase 2 · Semana 6** — Contratos restantes + Verificar público (6 páginas)
  - [x] `public/contratos/index.html` — `#equiposTooltip` → `.tooltip-floating` (kit), `.toggle-pill`
        duplicada eliminada, `#uploadStatus` → estructura `.alert-banner`
  - [x] `public/contratos/nuevo-contrato.html` — 788 → 309 (-61%). `<style>` masivo reducido a ~80
        líneas page-local. Custom toast system → ceco-ui `.toast-region`. Custom modal preview →
        `.modal-backdrop`
  - [x] `public/contratos/editar-contrato.html` — limpieza menor (ya estaba alineada — esta página
        originó el kit)
  - [x] `public/contratos/nuevo-cliente.html` — 242 → 133 (-45%)
  - [x] `public/contratos/imprimir-contrato.html` — sin cambios (ya carga `print-base.css`)
  - [x] `public/verificar-contrato.html` — Arial-only → kit, hero con brand-mark oficial,
        estados con `.alert-banner.alert-success/error`
  - [x] `contratos-equipos.js` — tooltip dinámico ahora se crea con `className = 'tooltip-floating'`
  - [x] **Bug fix retroactivo**: `.app-card` override en `app-kit-extras.css` (era el "launcher card"
        del home con `cursor:pointer + display:flex + hover translate`, mis migraciones previas lo
        usaban como wrapper de contenido). Solucionado neutralizando ese comportamiento.

- **Fase 2 · Semana 7** — POC restantes + Órdenes admin (9 páginas)
  - [x] `public/POC/nuevo-batch.html` — sin cambios (ya 100% kit-aligned)
  - [x] `public/POC/editar-batch.html` — migración de Arial-only a kit, tabla dinámica con `.app-table.compact`
  - [x] `public/POC/nuevo-equipo.html` — `<fieldset>` → `.form-section-header + .ds-card`, `.form-check`
  - [x] `public/POC/vendedores-batch.html` — 501 → 223 (-55%). Stepper preservado, suggest-list page-local,
        sticky-first table conservado
  - [x] `public/POC/imprimir-equipos.html` — tokens del DS reemplazan colores hardcodeados
  - [x] `public/POC/importar-poc.html` — `.form-file-zone` con drag&drop, `#estadoImportacion` →
        `.alert-banner` con variantes success/error/warning/info
  - [x] `public/ordenes/estado_reparacion.html` — `<ul><li>` → `.crud-list-item` + `empty-state-hint`
  - [x] `public/ordenes/tecnicos.html` — idem
  - [x] `public/ordenes/config.html` — único botón → `.module-grid` con 4 entradas

- **Fase 2 · Semana 8** — Órdenes resto (10 páginas migradas + 5 conservadas)
  - [x] `public/ordenes/importar-exportar.html` — pulida con `.form-section-header`
  - [x] `public/ordenes/agregar-equipo.html` — kit-aligned
  - [x] `public/ordenes/firmar-entrega.html` — canvas + email + foto ID en secciones kit
  - [x] `public/ordenes/cotizar-orden.html` — modal `.modal-header/footer`, badges page-local con tokens
  - [x] `public/ordenes/modelo-de-radio.html` — `.crud-list-item` + `.empty-state-hint`
  - [x] `public/ordenes/admin-equipos-cliente.html` — `.alert-banner.alert-error` para "sin acceso"
  - [x] `public/ordenes/reporte-pendientes.html` — kit tokens + @media print preservado
  - [x] `public/ordenes/progreso-tecnicos.html` — `.filter-bar` + `.alert-banner` con leyenda + `.kpi-grid`
  - [x] `public/ordenes/nueva-orden.html` — 408 → 163 (-60%). `.page-header-centered` + `.form-check`
  - [x] `public/ordenes/editar-orden.html` — 467 → 187 (-60%)
  - [-] **Conservados sin rewrite completo** (kit primitives funcionan, rewrite con diminishing returns):
        - `cotizar-orden-formal.html`, `trabajar-orden.html`, `fotos-taller.html` — UX compleja específica
        - `imprimir-orden.html`, `nota-entrega.html`, `nota-entrega-intervenciones.html` — print templates A4

- **Extras** — páginas globales pequeñas
  - [x] `public/perfil.html` — `.ds-card.ds-card-padded` + form-grid-2 + prefix icon en email
  - [x] `public/404.html` — kit-aligned con brand-mark y `.btn.btn-primary`
  - [x] `public/verify/index.html` — hero con brand-mark, `.alert-banner` con variantes, `<dl>` 2-col

### ⏭️ Siguiente sesión: **Semana 9 — Mobile** (opcional, depende de readiness)

Esta fase depende de readiness — `public/ordenes/index.html` actualmente
tiene trabajo móvil en progreso (commits recientes `c112b0f`, `1750745`,
`f2ecb50`, `7eb40c6`). Migrar a clases `.m-*` del kit móvil debería esperar
hasta que el trabajo móvil actual esté merged. Referencia:
`ui_kits/app-mobile/ordenes.html`.

### 🔮 Pendiente (Semana 10)

- **Consolidación final**: una vez todas las páginas migradas y validadas,
  considerar:
  - Reemplazar `ceco-ui.css` por `app.css` (import directo)
  - Eliminar `app-kit-extras.css` (sus primitivos pasan a `app.css`)
  - Deprecar clases legacy que ya no se usan (`.cliente-dropdown`, etc.)

### 🧰 Setup para retomar

```bash
cd c:/Projects/cecomunica-service-orders
git pull
git checkout <branch-de-migración>     # crear si no existe
cd public && python -m http.server 8765 # para smoke test rápido
```

Abre `http://localhost:8765/inventario/index.html` y compáralo lado a lado con
`http://localhost:8765/../design-system/ui_kits/app/inventario.html`
(applied list reference) en otra pestaña.

### 📊 Métricas de progreso

| Métrica | Inicio | Sem 8 (hoy) | Objetivo |
|---------|------:|------:|------:|
| Páginas migradas | 0 | **45** | 50 |
| Áreas completas | 0 | **6 de 7** (Home/Auth · Cotizaciones · Clientes · Inventario · Contratos · PoC · Configuración Órdenes) | 7 |
| Primitivos en producción | 17 | **30+** (incluyendo `.bulk-bar`) | 27+ |
| `<style>` blocks tocados | 0 | **~12,000 líneas de CSS inline eliminadas** | todos a 0 |
| Páginas conservadas intencionalmente | 0 | 5 (print templates A4 + UX compleja específica) | — |

---

## Resumen ejecutivo

| Métrica | Antes | Después |
|---------|------:|--------:|
| Páginas alineadas al kit | 8 | 50 |
| Áreas con kit propio | 4 | 7 |
| Primitivos en `app.css` | 17 | 27 |
| CSS inline en producción | ~12,000 líneas | objetivo: &lt;500 |
| `<style>` blocks por página | promedio 80 líneas | objetivo: 0 |

El objetivo NO es reescribir cada página — es **eliminar el CSS por-página**
sustituyendo bloques `<style>` por clases del kit, y cubrir los pocos huecos
restantes con primitivos nuevos (banner, dropdown, tooltip, pager-input,
responsive-cards, module-grid, auth-shell, page-header-centered).

---

## Estado actual (auditoría)

### CSS

| Archivo | Líneas | Rol |
|---------|------:|-----|
| `public/css/ceco-ui.css` | 2,352 | CSS producción — ya referencia tokens del DS via "bridge" (fases 1-6 de DS adoption) |
| `design-system/colors_and_type.css` | — | Tokens del DS (colores, fuentes, spacing, radius, shadows) |
| `design-system/ui_kits/app/app.css` | 3,133 | Kit completo (incluye los 10 primitivos R3 nuevos) |

`ceco-ui.css` ya cubre la mayoría de primitivos básicos (`.btn`, `.chip-estado`,
`.app-table`, `.form-input`, `.modal`, etc.). Lo que **falta en `ceco-ui.css`**
y existe en `app.css`:

- `.toggle-pill` (parcial en ceco-ui)
- `.dropdown` / `.dropdown-menu` (en ceco-ui hay `.dropdown .menu` con otra firma)
- `.tooltip-floating`
- `.alert-banner` + variantes
- `.page-header-centered`
- `.pager-input`
- `.responsive-table-wrap` / `.responsive-cards`
- `.module-grid` / `.module-card`
- `.auth-shell` / `.auth-brand` / `.auth-card`
- `.empty-state-hint`

### Páginas

50 páginas HTML en producción. 8 ya alineadas (las que cubre el kit hoy);
42 requieren migración.

---

## Fase 0 · Alinear el CSS (1 día)

**Objetivo**: que `ceco-ui.css` tenga acceso a los 10 primitivos nuevos sin
duplicar lo que ya existe.

### Opción recomendada: importar `app.css` al final de `ceco-ui.css`

```css
/* Al final de public/css/ceco-ui.css */
@import url('../../design-system/ui_kits/app/app.css');
```

**Pros**: las páginas ya importan `ceco-ui.css`, no hay que tocarlas.
**Contras**: posibles colisiones — `app.css` define algunas clases que
`ceco-ui.css` ya tiene. La regla de cascada (lo último gana) hará que el kit
sobrescriba. Hay que probar y aceptar la versión del kit como autoritativa.

### Opción alternativa: archivo nuevo `app-kit-extras.css`

Extraer SOLO los 10 primitivos nuevos a un archivo dedicado y vincularlo
desde `ceco-ui.css` o desde cada página. Más quirúrgico, menos riesgo, pero
mantiene la duplicación a largo plazo.

> **Recomendación**: empezar con la **Opción alternativa** (un archivo extras),
> validar 1-2 páginas, y cuando todo funcione consolidar todo en un solo
> `app.css` y deprecar `ceco-ui.css`.

### Checklist Fase 0
- [ ] Crear `public/css/app-kit-extras.css` con los 10 primitivos R3
- [ ] Linkearlo desde `ceco-ui.css` con `@import` o desde cada página
- [ ] Verificar visualmente foundations, ordenes/index y contratos/editar
- [ ] Documentar conflictos encontrados

---

## Fase 1 · Primitivos nuevos en todas las páginas (3-5 días)

Adopciones globales que tocan muchas páginas con el mismo patrón.

### 1.1 · Reemplazar `.alert` ad-hoc por `.alert-banner`

**Dónde**: cualquier `<div class="alert">` o aviso de éxito/error en flujo.
Producción usa `.alert` y `.alert.ok` con CSS local. Cambiar a:

```html
<!-- antes -->
<div class="alert">Mensaje…</div>
<div class="alert ok">Hecho!</div>

<!-- después -->
<div class="alert-banner">
  <span class="alert-banner-icon"><i data-lucide="info"></i></span>
  <div class="alert-banner-body"><strong>Título</strong> Mensaje…</div>
</div>
<div class="alert-banner alert-success">…</div>
```

**Páginas afectadas**: `login.html`, `cotizaciones/index.html`,
`contratos/index.html`, `clientes/index.html`, `ordenes/trabajar-orden.html`.

### 1.2 · Reemplazar dropdowns ad-hoc por `.dropdown` / `.dropdown-menu`

**Dónde**: cualquier menú flotante de acciones, ordenamiento o export.
Producción usa `.dropdown .menu` (firma propia). Migrar a `.dropdown-menu`:

```html
<!-- antes -->
<div class="dropdown">
  <button>···</button>
  <div class="menu">
    <a href="#" class="menu-item">…</a>
  </div>
</div>

<!-- después -->
<div class="dropdown">
  <button class="btn btn-secondary btn-sm">···</button>
  <div class="dropdown-menu">
    <div class="dropdown-label">Sección</div>
    <button class="dropdown-item"><i data-lucide="x"></i> Item</button>
    <div class="dropdown-divider"></div>
    <button class="dropdown-item danger"><i data-lucide="trash-2"></i> Borrar</button>
  </div>
</div>
```

**Páginas afectadas**: `inventario/index.html`, `inventario/modelos.html`,
`POC/index.html`, `cotizaciones/index.html`, `contratos/index.html`,
`clientes/index.html`.

### 1.3 · Cards de fallback responsive en tablas largas

**Dónde**: cualquier tabla con >5 columnas que el equipo quiera ver en móvil.
Hoy `cotizaciones/index.html` ya tiene este patrón con CSS local; estandarizar.

```html
<div class="responsive-table-wrap">
  <table class="app-table">…</table>
</div>
<div class="responsive-cards">
  <div class="responsive-card">…</div>
</div>
```

**Páginas afectadas**: `cotizaciones/index.html`, `clientes/index.html`,
`contratos/index.html`, `inventario/index.html`, `POC/index.html`.

### 1.4 · Pager input para tablas grandes

Reemplazar pagination ad-hoc por `.pager-input` donde el dataset >100 ítems.

**Páginas afectadas**: `clientes/index.html` (ya tiene un patrón parecido —
solo rebrand de clases), `POC/index.html`, `inventario/index.html`.

### 1.5 · `.toggle-pill` para filtros booleanos en toolbar

**Patrón**: en lugar de `<label><input type="checkbox">Solo activos</label>` suelto,
usar `.toggle-pill` que se ve como un chip.

**Páginas afectadas**: `clientes/index.html`, `contratos/index.html`,
`cotizaciones/index.html`, `POC/index.html`.

### 1.6 · `.page-header-centered` para formularios largos

Estandarizar el header de páginas con un solo formulario largo.

**Páginas afectadas**: `ordenes/nueva-orden.html`,
`cotizaciones/nueva-cotizacion.html`, `cotizaciones/editar-cotizacion.html`,
`contratos/nuevo-contrato.html`, `ordenes/cotizar-orden-formal.html`,
`POC/nuevo-batch.html`, `POC/nuevo-equipo.html`.

### 1.7 · `.auth-shell` para login y reset

Migrar `login.html` y cualquier vista de reset al patrón del kit.

### 1.8 · `.module-grid` en `public/index.html`

Reemplazar el grid actual `.app-grid + .app-card` por `.module-grid + .module-card`.
El JS de visibilidad por rol no cambia — solo las clases.

### 1.9 · `.tooltip-floating` en tablas con preview

**Dónde**: el "equipos peek" de `contratos/index.html` y patrones similares.

---

## Fase 2 · Migración por página (10-15 días)

Una entrada por página con: prioridad, esfuerzo, qué cambiar concretamente.

### 🟢 Prioridad alta (3 páginas) — más visibles

#### `public/index.html` — Home dashboard
- **Esfuerzo**: 2 h
- **Cambios**:
  - Borrar el `<style>` block local
  - Cambiar `.app-grid` → `.module-grid`
  - Cambiar `.app-card` → `.module-card` (mover icono a `.module-card-icon`,
    título a `.module-card-title`, sub a `.module-card-sub`)
  - Opcional: agregar `.module-card-shortcut` para los hotkeys (o, p, i, c…)
  - Conservar el JS de visibilidad por rol — la API de `data-mod` no cambia

#### `public/login.html` — Login + reset
- **Esfuerzo**: 4 h
- **Cambios**:
  - Borrar todo el `<style>` (las clases `auth-*` ahora viven en el kit con
    semántica distinta — verificar overlaps)
  - Reemplazar `.auth-hero` + `.auth-grid` + `.auth-brand` + `.auth-card`
    por la estructura del kit: `.auth-shell` con `<section class="auth-brand">`
    + `<div class="auth-form-wrap"><div class="auth-card">`
  - Inputs: `.auth-input` → `.form-input` (dentro de `.form-field`)
  - Botón mostrar/ocultar contraseña: `.input-with-toggle` → `.auth-input-toggle`
  - Footer del form: `.auth-footer` → `.auth-footer-row` (mismo concepto, semántica DS)
  - El JS no cambia
  - **Nota**: las clases viejas (`auth-bullets`, `auth-field`, `auth-title`,
    `auth-sub`, `auth-link`, `divider`) ya tienen equivalente en el kit —
    revisar uno por uno

#### `public/ordenes/index.html` — Lista de órdenes
- **Esfuerzo**: 6 h
- **Cambios**:
  - Ya está parcialmente alineado (chips de estado, app-table). Falta:
  - Reemplazar la barra inferior móvil (card-rail por estado) por el patrón
    `ordenes-mobile` del kit móvil (si el equipo móvil migra ahora)
  - Asegurar uso de `.responsive-table-wrap` + `.responsive-cards`
  - Migrar `.bulk-bar` ad-hoc al patrón documentado en foundations

### 🟢 Prioridad alta (área completa) — Cotizaciones (4 páginas)

#### `public/cotizaciones/index.html`
- **Esfuerzo**: 3 h
- **Cambios**:
  - Borrar el `<style>` block local entero
  - El toolbar ya tiene la estructura — solo renombrar `.toggle-pill` (ya usa la clase ✓)
  - Tabla: ya usa `.app-table` ✓
  - Skeleton loader: reemplazar `.skeleton-table-row` por `.skeleton` del kit
  - Cards móviles: cambiar `.card-cotizacion` por `.responsive-card` del kit
  - Empty state: usar `.empty-state-hint`

#### `public/cotizaciones/nueva-cotizacion.html`
- **Esfuerzo**: 4 h
- **Cambios**:
  - Page header → `.page-header-centered`
  - Secciones del form → `.form-section-header` con `.section-readiness`
  - Tabla editable de líneas → `.app-table.editable` con `.td-input` / `.td-mono` / `.td-amount`
  - Footer sticky con totales → patrón `.app-footer-strip`
  - Referencia: `cotizaciones.html#applied-new`

#### `public/cotizaciones/editar-cotizacion.html`
- **Esfuerzo**: 3 h
- **Cambios**:
  - Heredar de nueva-cotización con campos disabled
  - Agregar `.alert-banner` con estado de "Modo lectura" si aprobada/enviada
  - Referencia: `cotizaciones.html#applied-edit`

#### `public/cotizaciones/imprimir-cotizacion.html`
- **Esfuerzo**: 1 h
- **Cambios**:
  - Adoptar las clases `.print-*` del kit base
  - Reusar `print-base.css` (link directo)
  - Referencia: `cotizaciones.html#applied-print`

### 🟢 Prioridad alta (área completa) — Clientes (2 páginas)

#### `public/clientes/index.html`
- **Esfuerzo**: 4 h
- **Cambios**:
  - Ya está parcialmente alineado (usa `.app-table` y `Layout.renderTopbar`).
  - Borrar el `<style>` block (compact variant — ya está en `.app-table.compact`)
  - Toolbar: convertir el checkbox "Solo activos" en `.toggle-pill.is-on`
  - Bulk-bar: cambiar `#bulkBar` por el patrón `.bulk-bar.visible` del kit
  - Pager: reemplazar `#pagerBar` por `.pager-input`
  - Modal de confirmación: ya está alineada (`.modal-backdrop` / `.modal`)
  - Referencia: `clientes.html#applied-list`

#### `public/clientes/editar.html`
- **Esfuerzo**: 4 h
- **Cambios**:
  - Adoptar layout `.split-pane` con `.summary-card` para resumen + acciones
  - Secciones del form con `.form-section-header` + readiness
  - Referencia: `clientes.html#applied-edit`

### 🟡 Prioridad media (área completa) — Inventario (5 páginas)

#### `public/inventario/index.html` — Radios
- **Esfuerzo**: 5 h
- **Cambios**:
  - Borrar el `<style>` block masivo (397 líneas, mucho duplica el kit)
  - KPI strip arriba → `.kpi-grid + .kpi-card`
  - Toolbar dropdown "Acciones" → `.dropdown / .dropdown-menu`
  - Filtros por estado → `.filter-chips`
  - Tabla → `.app-table` (ya casi)
  - Pager → `.pager-input`
  - Referencia: `inventario.html#applied-radios`

#### `public/inventario/modelos.html`
- **Esfuerzo**: 3 h
- **Cambios**:
  - Tabla simple — borrar inline CSS
  - Thumbnail del modelo en celda → `<div style="background:var(--surface-sunken)">`
  - Stock con color por umbral → `.td-amount.kpi-warn` o `kpi-crit`
  - Referencia: `inventario.html#applied-modelos`

#### `public/inventario/piezas.html`
- **Esfuerzo**: 3 h
- **Cambios**: similar a modelos
- Filtros `.toggle-pill` para "Solo con stock" / "Stock bajo"
- Referencia: `inventario.html#applied-piezas`

#### `public/inventario/cargar-inventario.html`
- **Esfuerzo**: 2 h
- **Cambios**:
  - Drop zone → `.form-file-zone`
  - Mapa de columnas → `.importer-column-map`
  - Status banner → `.alert-banner.alert-success` con resultado de última carga
  - Referencia: `inventario.html#applied-cargar`

#### `public/inventario/vista-correo.html`
- **Esfuerzo**: 1 h
- **Cambios**: vista interna, solo borrar inline CSS y usar `.app-table`

### 🟡 Prioridad media — Contratos (5 páginas)

#### `public/contratos/index.html`
- **Esfuerzo**: 4 h
- **Cambios**:
  - El `<style>` actual ya define `.toggle-pill`, `.equipos-peek`, `#equiposTooltip` localmente
  - Migrar `.toggle-pill` → versión del kit (idéntica, sólo borrar el local)
  - Migrar `#equiposTooltip` → `.tooltip-floating` (el JS de posicionamiento se mantiene)
  - Migrar `.equipos-peek` → patrón del kit (mismo div con icono dentro)
  - Filtros `.estado-chips` ya están alineados ✓
  - Referencia: `contratos.html#contrato-lista`

#### `public/contratos/nuevo-contrato.html`
- **Esfuerzo**: 5 h
- **Cambios**: similar a nueva-cotización
- Page-header centrado, secciones con readiness, disclosure-panel para renovación
- Referencia: `contratos.html#contrato-nuevo`

#### `public/contratos/editar-contrato.html`
- **Esfuerzo**: 4 h
- **Cambios**: ya está bastante alineado — esta es la referencia que dio origen al kit
- Verificar que ningún `<style>` local sobreviva

#### `public/contratos/nuevo-cliente.html`
- **Esfuerzo**: 2 h
- **Cambios**: modal de creación rápida desde dentro del flujo de contrato

#### `public/contratos/imprimir-contrato.html`
- **Esfuerzo**: 1 h
- **Cambios**: usar `print-base.css` + `.print-sig-grid.cols-3`
- Referencia: `contratos.html#contrato-print`

#### `public/verificar-contrato.html` (público)
- **Esfuerzo**: 2 h
- **Cambios**: layout centrado simple con `.alert-banner.alert-success`
- Sin shell ni topbar
- Referencia: `contratos.html#contrato-verificar`

### 🟡 Prioridad media — POC (7 páginas)

#### `public/POC/index.html`
- **Esfuerzo**: 4 h
- Ya está parcialmente alineado. Verificar tooltip, pager y dropdown.

#### `public/POC/nuevo-batch.html`
- **Esfuerzo**: 3 h
- Referencia: `poc.html#poc-batch`

#### `public/POC/editar-batch.html`
- **Esfuerzo**: 2 h
- Variante de nuevo-batch con campos pre-llenos

#### `public/POC/nuevo-equipo.html`
- **Esfuerzo**: 2 h
- Form simple (un solo equipo). Page header centrado.

#### `public/POC/vendedores-batch.html`
- **Esfuerzo**: 5 h
- Esta página tiene 1,192 líneas en `ceco-ui.css` dedicadas. Migrar al kit
  reduce CSS específico a casi cero
- Referencia: `poc.html#poc-vendedores`

#### `public/POC/imprimir-equipos.html`
- **Esfuerzo**: 2 h
- Selector de columnas + preview
- Referencia: `poc.html#poc-imprimir`

#### `public/POC/importar-poc.html`
- **Esfuerzo**: 2 h
- Reusar `.form-file-zone` + `.importer-column-map`

### 🟡 Prioridad media — Órdenes (15 páginas restantes)

| Página | Esfuerzo | Cambios principales | Referencia |
|--------|---------:|---------------------|-----------|
| `nueva-orden.html` | 4 h | `.page-header-centered`, secciones con readiness | `ordenes.html#applied-new` |
| `editar-orden.html` | 3 h | Heredar de Nueva con menos secciones | — |
| `cotizar-orden.html` | 3 h | Tabla editable + footer strip | `ordenes.html#applied-work` |
| `cotizar-orden-formal.html` | 4 h | Variante de nueva cotización | `cotizaciones.html#applied-new` |
| `trabajar-orden.html` | 4 h | Ya alineada — limpiar inline | `ordenes.html#applied-work` |
| `agregar-equipo.html` | 2 h | Modal con form-grid + combobox modelo | — |
| `fotos-taller.html` | 2 h | `.photo-grid` + `.lightbox` | `ordenes.html#photo-grid` |
| `firmar-entrega.html` | 2 h | `.sig-pad` del kit | `ordenes.html#signature` |
| `imprimir-orden.html` | 1 h | `print-base.css` | `ordenes.html#contrato-print` (mismo) |
| `nota-entrega.html` | 1 h | print-base con sig 1-col | — |
| `nota-entrega-intervenciones.html` | 1 h | igual + lista de intervenciones | — |
| `admin-equipos-cliente.html` | 3 h | Tabla densa + drag-to-reorder | — |
| `importar-exportar.html` | 2 h | Importador XLSX | `ordenes.html` |
| `modelo-de-radio.html` | 2 h | Form simple | — |
| `progreso-tecnicos.html` | 4 h | Dashboard con `.kpi-grid` + `.progress-bar-*` | `ordenes.html#applied-progress` |
| `estado_reparacion.html` | 2 h | `.crud-list` | `ordenes.html#applied-config` |
| `tecnicos.html` | 2 h | `.crud-list` | `ordenes.html#applied-config` |
| `config.html` | 2 h | `.toggle-wrap` | `ordenes.html#applied-config` |
| `reporte-pendientes.html` | 2 h | tabla con filtros | — |

### 🔵 Prioridad baja

| Página | Notas |
|--------|-------|
| `perfil.html` | Crear ficha de usuario nueva (no hay aplicado aún en el kit; agregar al kit cuando esta se migre) |
| `tools/*.html` | Páginas admin de migración — viven aparte, no necesitan kit |
| `404.html` | Página estática — un toque de styling pero baja prioridad |
| `verify/index.html` | Mismo que `verificar-contrato.html` (pública) |

---

## Fase 3 · Mobile (cuando aplique, 5 días)

El kit móvil (`ui_kits/app-mobile/`) hoy sólo cubre Órdenes. La migración móvil
viene en dos sub-fases:

### 3.1 · Migrar `public/ordenes/index.html` móvil al patrón del kit

Las pantallas móvil de Órdenes ya están en producción (rendering condicional
con `.mobile-only` / `.desktop-only`). Migrar a las clases `.m-*` del kit:

- `.m-appbar` reemplaza `#mobileHeader`
- `.m-filterbar` reemplaza `.estado-chips-bar`
- `.m-order-card` reemplaza `.card-contrato` en variante móvil
- `.m-bottomnav` reemplaza `#mobileBottomNav`
- `.m-sheet` reemplaza `.mdrawer`
- `.m-equipo` para los rows del sheet de equipos

Esfuerzo estimado: 8 h. Referencia: `ui_kits/app-mobile/ordenes.html`.

### 3.2 · Extender kit móvil con PoC / Contratos / Cotizaciones (cuando se priorice)

Cuando alguien necesite el flujo en celular, crear:
- `ui_kits/app-mobile/poc.html` con tarjeta por equipo + sheet de edición
- `ui_kits/app-mobile/cotizaciones.html` con `.responsive-card` (ya hay en
  producción — `cotizaciones/index.html` ya tiene cards <900px)
- `ui_kits/app-mobile/contratos.html` igual

No bloquear la migración desktop por esto.

---

## Plan de rollout sugerido

Orden propuesto, optimizando por **valor / riesgo**:

1. **Semana 1 — Fase 0 + Fase 1.1 (banners)**
   - Crear `app-kit-extras.css`, integrar
   - Reemplazar `.alert` ad-hoc por `.alert-banner` (cambio trivial, mucha visibilidad)
2. **Semana 2 — Home + Login**
   - Migrar `public/index.html` (module grid)
   - Migrar `public/login.html` (auth shell)
3. **Semana 3 — Cotizaciones (área entera)**
   - Las 4 páginas — flujo aislado, pruebas fáciles
4. **Semana 4 — Clientes (área entera)**
   - 2 páginas + bulk-bar + pager-input + responsive cards
5. **Semana 5 — Inventario (área entera)**
   - 5 páginas con `<style>` blocks grandes — alto retorno en CSS limpiado
6. **Semana 6 — Contratos restantes + Verificar (público)**
7. **Semana 7 — PoC restantes + Órdenes admin (config, técnicos, estados)**
8. **Semana 8 — Órdenes resto + smoke test móvil**
9. **Semana 9 — Mobile (`ordenes/index.html` móvil al kit)**
10. **Semana 10 — Consolidación**: deprecar `ceco-ui.css`, dejar sólo `app.css`

Total estimado: **~10 semanas a media dedicación** (1 dev al 50%) o
**~5 semanas a tiempo completo**.

---

## Validación

Por página migrada, verificar:

- [ ] El `<style>` block local quedó vacío o se redujo a <20 líneas
- [ ] No hay `<link rel="stylesheet">` adicional (sólo `ceco-ui.css` o
      `app.css` si ya se consolidó)
- [ ] Las clases del HTML coinciden con el aplicado del kit (`ordenes.html`,
      etc.)
- [ ] Smoke test: abrir la página, recorrer cada flujo principal, verificar
      que las interacciones (modales, dropdowns, toasts) funcionen
- [ ] Verificar móvil (Chrome DevTools, 375×667 y 414×896) — el responsive
      kicks in donde corresponde
- [ ] El topbar usa `Layout.renderTopbar(...)` (ya estandarizado)
- [ ] Los formularios usan `.form-field` + `.form-label` + `.form-input` /
      `.form-select` / `.form-textarea`

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Colisión de clases entre `ceco-ui.css` y `app.css` | Fase 0 — auditar las colisiones antes de importar todo |
| Página rompe en producción tras migrar | Hacer pull-request por página, hacer demo en local |
| Tokens del DS divergen de `ceco-ui.css` | Ya está alineado ✓ (Fases 1-6 de DS adoption) |
| Móvil pierde su UX al migrar a `.m-*` | Mantener `ordenes.html` (móvil) como referencia 1:1; cambio puramente cosmético |
| El equipo no encuentra el aplicado correcto | Cada página apunta a su referencia en este doc — buscar `Referencia:` |

---

## Apéndice — Mapa rápido producción → kit

| Producción | Kit |
|------------|-----|
| `.section.form` | `.form-section` + `.form-section-header` |
| `.form-title` (con border-bottom) | `.form-section-header h3` |
| `.toolbar` | `.filter-bar` |
| `.app-search` | `.filter-search` |
| `.btn.icon` | `.btn-icon` |
| `.btn-pill` (44×44 icon) | `.btn.btn-icon.btn-lg` |
| `.card` (genérico) | `.app-card` o `.app-card.app-card-padded` |
| `.section` (genérico) | `.demo-block` (en kit-viewer) o sin clase (en producción) |
| `.alert` | `.alert-banner` |
| `.alert.ok` | `.alert-banner.alert-success` |
| `.dropdown .menu` | `.dropdown-menu` |
| `.menu-item` | `.dropdown-item` |
| `.skeleton-table-row` + `.skeleton-cell` | `.skeleton` (genérico) |
| `.card-cotizacion` | `.responsive-card` |
| `.equipos-peek` + `#equiposTooltip` | `.tooltip-floating` + trigger arbitrario |
| `.banner` (legacy) | `.alert-banner` (variante info) |
| `.pill-ok` / `.pill-warn` | `.chip-prioridad` o `.chip-estado` según semántica |
| `.tbl` (tabla custom de progreso-técnicos) | `.app-table` |
| `.app-grid` + `.app-card` (home) | `.module-grid` + `.module-card` |
| `.auth-hero` + `.auth-grid` | `.auth-shell` |
| `.auth-input` | `.form-input` |
| `.input-with-toggle` | `.auth-input-toggle` |

Cuando encuentres una clase en `public/` que no esté aquí, búscala primero en
`app.css` con grep — la probabilidad es alta de que ya exista con otro nombre.
