# Plan — Panel Administrativo de Monitoreo

> Panel central, **solo para `ROLES.ADMIN`**, para observar lo que está ocurriendo en los módulos (Órdenes, Contratos, Cotizaciones, Clientes, PoC, Inventario) y en la salud de la app (mail queue, Cloud Functions, Storage, retención PII, auditoría de roles). Reusa la capa de servicios existente; no introduce backend nuevo en la fase inicial.
>
> Stack idéntico al resto del proyecto: HTML + JS vanilla + Firebase compat + UI Kit (`ceco-ui.css` / `app-kit-extras.css`). Sin build step.

---

## 1. Objetivos

1. Dar al administrador una **vista única** del estado operativo del negocio (KPIs por módulo) sin tener que abrir cada página.
2. Exponer **señales de salud técnica** del sistema (mail queue atascada, fotos PII vencidas, errores recientes, usuarios sin rol).
3. Centralizar **acciones de mantenimiento** que hoy están dispersas (purgar PII, recomputar caches, ver auditoría de órdenes, exportar reportes).
4. **No** duplicar funcionalidad de los módulos: el panel enlaza a las páginas existentes filtradas con querystring; no es un editor.

### No-objetivos (fuera de alcance v1)

- Telemetría de errores del frontend (Sentry/etc.) — anotado en §10 como futuro.
- Métricas en tiempo real con listeners Firestore — v1 usa `get()` puntual con refresh manual + auto-refresh suave de 60 s.
- Dashboards configurables por el usuario — layout fijo en v1.
- Edición de roles / alta de usuarios desde el panel — se hace via Admin SDK (consola).

---

## 2. Acceso y Seguridad

### 2.1 Restricción en el frontend

Cada página del panel arranca con:

```js
verificarAccesoYAplicarVisibilidad((user, rol) => {
  AUTH.requireAccess([ROLES.ADMIN]);  // redirige a /index.html si no es admin
  inicializar();
});
```

`AUTH.requireAccess` ya existe en `js/core/auth.js` (ver `ARQUITECTURA_CECOMUNICA.md` §4.1). Si el rol no califica, muestra toast y redirige al home.

### 2.2 Tarjeta en el home

En `public/index.html` se añade una **tarjeta de módulo** visible solo cuando `rol === ROLES.ADMIN`:

```html
<a class="module-card" data-keywords="admin panel monitoreo salud sistema"
   data-mod="admin" data-visible="false"
   href="admin/index.html">
  <span class="module-card-icon"><i data-lucide="shield"></i></span>
  <span class="module-card-meta">
    <span class="module-card-title">Panel de Administración</span>
    <span class="module-card-sub">Monitoreo de módulos y salud del sistema</span>
  </span>
  <span class="module-card-shortcut">A</span>
</a>
```

El `data-mod="admin"` se agrega **únicamente** en el array `visiblesPorRol[ROLES.ADMIN]` (no en los otros roles, a diferencia de `firma` y `perfil` que son universales — ver `ARQUITECTURA_CECOMUNICA.md` §4.3).

### 2.3 Defensa en profundidad

Las reglas de Firestore (`firestore.rules`) **ya** restringen las lecturas/escrituras sensibles:

- `usuarios/{uid}.rol` — `write: if false` (solo Admin SDK)
- Campos `firma_*` / `os_*` en contratos — bloqueados via `touchesCFOwnedFields()`
- `purgePIIRetention` — callable con check explícito de `rol === 'administrador'` server-side

El panel **no necesita** reglas nuevas en v1; todas las queries que hace son `get()` autenticados de colecciones a las que cualquier usuario autenticado ya tiene `read`. La restricción del panel es **de UX**, no de seguridad de datos (los datos ya están protegidos por capas inferiores).

> **Decisión:** si en v2 se quieren ocultar colecciones (p. ej. `tecnico_stats` o agregados sensibles) solo a admins, se endurecerán las reglas en ese momento.

---

## 3. Estructura de páginas

Carpeta nueva: `public/admin/`

```
public/admin/
  index.html              ← landing del panel (KPIs + accesos a sub-páginas)
  operacion.html          ← detalle operativo (órdenes por estado, técnicos, contratos)
  salud.html              ← salud del sistema (mail queue, PII, usuarios sin rol)
  auditoria.html          ← actividad reciente (os_logs, transiciones de contrato)
  pii.html                ← gestión y purga de PII (preview + ejecución)
```

Cada página:
- Usa `Layout.renderTopbarFor('child', { title: 'Admin · …', back: 'admin/index.html' })`
- Carga el bloque estándar de scripts Firebase + servicios necesarios
- Llama a `AUTH.requireAccess([ROLES.ADMIN])` antes de cualquier render

### 3.1 Topología visual (`admin/index.html`)

```
┌─────────────────────────────────────────────────────────────────┐
│  TOPBAR navy · "Cecomunica · Admin · Panel"                     │
├─────────────────────────────────────────────────────────────────┤
│  [Refrescar] [Auto 60s ●]   última actualización: 14:32:18      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STAT GRID (4 cols desktop / 2 móvil)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Órdenes  │ │ Contratos│ │ Cotizac. │ │ PoC      │            │
│  │ abiertas │ │ pendient.│ │ vencen…  │ │ activos  │            │
│  │   42     │ │    7     │ │    3     │ │   128    │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                                                 │
│  ALERTAS DE SALUD (alert-banner)                                │
│  • 2 emails en mail_queue con > 1 h sin procesar                │
│  • 5 fotos de ID en ordenes_identificacion con > 90 días        │
│  • 1 usuario sin campo `rol`                                    │
│                                                                 │
│  MÓDULO CARDS (4 secciones — cada una linkea a sub-página)      │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │ Operación    │ │ Salud        │                              │
│  │ → operacion  │ │ → salud      │                              │
│  └──────────────┘ └──────────────┘                              │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │ Auditoría    │ │ PII          │                              │
│  │ → auditoria  │ │ → pii        │                              │
│  └──────────────┘ └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Métricas — qué se monitorea

### 4.1 Operación (`admin/operacion.html`)

| KPI | Fuente Firestore | Servicio / query |
|---|---|---|
| Órdenes por estado (pendiente / en_taller / completada / entregada / cerrada) | `ordenes_de_servicio` | `OrdenesService.filterByStatuses` agrupado por estado |
| Órdenes asignadas por técnico (top 10) | `ordenes_de_servicio` + `usuarios` | agregado client-side desde `OrdenesService.listAll` |
| Órdenes con > N días sin actualizar | `ordenes_de_servicio.updatedAt` | filtro client-side, badge "stale" |
| Contratos por estado (pendiente / aprobado / activo / anulado) | `contratos` | `ContratosService.listContratos` agrupado |
| Contratos sin orden vinculada en > 7 días | `contratos.tiene_os` + `contratos.fecha_creacion` | filtro client-side |
| Cotizaciones por estado | `cotizaciones` | `CotizacionesService.listCotizaciones` agrupado |
| Cotizaciones que vencen esta semana | `cotizaciones.fecha + validezDias` | calc en `js/domain/cotizacionesTotales.js` (helper nuevo `daysUntilExpiry`) |
| Clientes creados en los últimos 30 días | `clientes.fecha_creacion` | `ClientesService.listClientes` + filtro |
| PoC: total activos / con SIM / sin asignar | `poc_devices` | `PocService.getPocDevices` agrupado |
| Inventario: piezas con stock < umbral | `piezas` | `PiezasService.getPiezas` + filtro `cantidad < min_stock` |

**Refresh:** botón manual + auto-refresh cada 60 s (configurable via toggle pill). Toda la página hace ~10 lecturas paralelas; el costo es comparable a abrir `ordenes/index.html` una vez.

### 4.2 Salud del sistema (`admin/salud.html`)

| Señal | Fuente | Acción cuando hay problema |
|---|---|---|
| Emails en `mail_queue` con `createdAt > 1h` y sin `sent_at` | `mail_queue` | listar con `template`, `to`, `createdAt`; link al doc en consola |
| Documentos con error de envío (`error` field set) | `mail_queue` | listar últimos 50 con error |
| Fotos PII con > 90 días pendientes de purga | preview de `purgePIIRetention({ dryRun: true })` | banner con CTA → `admin/pii.html` |
| Usuarios sin campo `rol` o con valor no canónico | `usuarios` cruzado con `ROLES.*` | listar para que admin corrija via consola |
| Órdenes sin `searchTokens` (rezagadas del backfill) | `ordenes_de_servicio` sin el campo | conteo + link al script `functions/backfill-search-tokens.js` |
| Tamaño de `os_logs` por orden (top 10 con más entries) | `ordenes_de_servicio.os_logs.length` | aviso si alguna supera 1000 entradas (cap práctico 20k — ver `ARQUITECTURA_CECOMUNICA.md` §5.4) |
| Contratos con cache de órdenes inconsistente (`os_count` vs subcol) | `contratos` + spot-check de `contratos/{id}/ordenes` | botón "Recomputar" → invoca `rebuildContractCache` (callable nuevo, ver §7) |

### 4.3 Auditoría (`admin/auditoria.html`)

Timeline cronológico unificado de los últimos 200 eventos:

- Transiciones de orden (`os_logs[]` de `ordenes_de_servicio`) — `ASIGNAR`, `COMPLETAR`, `ENTREGAR`
- Transiciones de contrato (lectura del `estado` actual + `fecha_aprobacion` / `fecha_anulacion`)
- Cotizaciones convertidas a orden / contrato
- Purgas PII (campos `identificacion_purged_at`, `identificacion_purged_by`)

Cada entry muestra: hora · acción · doc afectado (link) · usuario (resuelto via `UsuariosService.getUsuariosByIds`).

Filtros: por tipo de evento (chips), por usuario, por rango de fecha. Búsqueda libre por id de orden / contrato.

### 4.4 PII (`admin/pii.html`)

Operación de retención de fotos de identificación (`ordenes_identificacion/`, `entregas_identificacion/`). Hoy es completamente manual via consola; el panel le da una UI:

1. **Preview** — botón "Buscar candidatos" → `firebase.functions().httpsCallable('purgePIIRetention')({ dryRun: true })`. Renderiza tabla con `sample[]`: ordenId, upload date, antigüedad en días.
2. **Confirmación** — modal `Modal.confirm({ message: 'Se borrarán N fotos. Esta acción es irreversible.', danger: true })`.
3. **Ejecución** — `purgePIIRetention({ dryRun: false })` → toast con conteo + recarga de preview.

Parámetro opcional `retentionDays` (default 90) editable solo si admin escribe `>=30` (guarda contra purga accidental).

---

## 5. Reuso de servicios — qué cambia y qué no

### 5.1 Servicios que se usan tal cual

| Servicio | Funciones usadas |
|---|---|
| `ContratosService` | `listContratos`, `contarPorTipoYFecha` |
| `OrdenesService` | `listAll`, `filterByStatuses`, `searchOrders` |
| `CotizacionesService` | `listCotizaciones`, `contarPorFecha` |
| `ClientesService` | `listClientes` |
| `PocService` | `getPocDevices`, `getRecent` |
| `PiezasService` | `getPiezas` |
| `UsuariosService` | `getUsuariosByRol`, `getUsuariosByIds` |

### 5.2 Funciones nuevas a añadir

| Servicio | Función nueva | Motivación |
|---|---|---|
| `mailQueueService.js` (**nuevo**) | `listStuck({ olderThanMs })`, `listFailed({ limit })` | Hoy `mailService` solo expone `enqueue`; el panel necesita listar. Operaciones puramente de lectura. |
| `OrdenesService` | `listStale({ daysWithoutUpdate })` | Filtro reutilizable también desde `reporte-pendientes.html` |
| `OrdenesService` | `listWithLargeAuditLog({ minLength })` | Diagnóstico del cap de `os_logs` |
| `CotizacionesService` | `listExpiringSoon({ days })` | Necesita `validezDias` — calcular en domain helper |
| `auditoriaService.js` (**nuevo**) | `getTimelineEvents({ since, limit })` | Coordina lectura de `os_logs` + transiciones de contratos. Evita que la página de panel haga las queries directamente. |

> **Regla mantenida** (ver `ARQUITECTURA_CECOMUNICA.md` §3.5): el HTML del panel **no llama** `db.collection()` directamente. Toda I/O pasa por servicios.

### 5.3 Helpers de dominio nuevos

`js/domain/adminMetrics.js`:

- `groupByStatus(items, getStatusFn)` → `{ [estado]: count }`
- `daysUntilExpiry(fecha, validezDias)` → number
- `bucketByAge(items, getDateFn, buckets = [1, 7, 30])` → buckets para "última semana / mes / etc."

Sin DOM, sin Firestore — pura aritmética y agrupación. Cubierto por tests unitarios si en algún momento se añade harness (hoy no hay).

---

## 6. UI / componentes

Reusa el UI Kit R3 (`ARQUITECTURA_CECOMUNICA.md` §3.7.2):

| Elemento del panel | Primitivo del kit |
|---|---|
| Tarjetas de KPI | `.module-card` con número grande + sub-label |
| Banners de alerta | `.alert-banner` (variantes `.alert-warning`, `.alert-error`) |
| Toggle "auto-refresh" | `.toggle-pill` |
| Lista de eventos de auditoría | `.responsive-table-wrap` + `.responsive-cards` (degrada a tarjetas en móvil) |
| Confirmación de purga PII | `Modal.confirm({ danger: true })` |
| Filtros (chips por tipo) | clases existentes en `app-kit-extras.css` (`.chip` / `.chip.is-active`) |
| Topbar | `Layout.renderTopbarFor('child', …)` |

**CSS específico del panel:** `public/css/admin-panel.css` — solo lo que no esté ya en el kit (probable: layout de "stat grid" denso, sticky de filtros de auditoría, tabla compacta de mail queue). Mantener < 200 líneas; si crece, evaluar promover primitivos al kit.

---

## 7. Cloud Functions — qué se añade

v1 **no** requiere CF nuevas obligatorias. Solo se aprovecha lo existente:

- `purgePIIRetention` (callable, ya existe) — usado por `admin/pii.html`

**Opcional / recomendado en v1.5:**

- `rebuildContractCache` como **callable HTTPS** admin-only — hoy existe la lógica en `functions/src/domain/contractCache.js` pero solo se invoca desde otros triggers. Exponer un callable permite "Recomputar este contrato" desde el panel ante inconsistencias.
- `getAdminMetricsSnapshot` (callable, **opcional v2**) — agregaría conteos server-side para evitar leer ~10 colecciones desde el cliente. Solo justifica si la carga de `admin/index.html` se vuelve costosa o lenta.

Patrón a respetar (igual que `purgePIIRetention`):

```js
exports.rebuildContractCache = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '');
  const user = await admin.firestore().doc(`usuarios/${uid}`).get();
  if (user.data()?.rol !== 'administrador') {
    throw new HttpsError('permission-denied', 'Solo administradores');
  }
  // … lógica …
});
```

---

## 8. Costos y rendimiento

Estimación de la carga de `admin/index.html` con base de datos típica:

| Colección | Lecturas por carga | Notas |
|---|---:|---|
| `ordenes_de_servicio` | ~200–500 | Listado para conteos por estado. Mismo costo que abrir `ordenes/index.html` |
| `contratos` | ~50–200 | |
| `cotizaciones` | ~50–200 | |
| `clientes` | ~30 últimos | con `orderBy('fecha_creacion').limit(30)` |
| `poc_devices` | ~100–500 | filtros por activo/sim |
| `piezas` | ~50 | filtro `cantidad < min_stock` requiere índice o scan filtrado client-side |
| `mail_queue` | ~50 | últimos 50 + filtro por antigüedad |
| `usuarios` | ~20 | conteo total |
| **Total** | **~600–1500 reads/carga** | Comparable a una sesión de uso normal |

Con auto-refresh de 60 s sostenido: ~600–1500 reads/min ≈ 1M reads/día por admin con panel siempre abierto. **Aceptable** para el plan Spark/Blaze que ya se usa, pero hay que:

1. **Throttling:** auto-refresh se pausa si la pestaña pierde foco (`document.hidden`).
2. **Caché local:** los conteos no críticos se cachean 30 s con `Map` en memoria para evitar re-fetch en navegación interna entre sub-páginas del panel.
3. **Métrica de seguimiento:** si más adelante aparecen ≥3 admins con panel abierto simultáneamente, mover los KPIs a un doc agregado escrito por un trigger (`onWrite` de cada colección → `agregados/dashboard`).

---

## 9. Implementación por fases

### Fase 1 — Esqueleto y KPIs principales (1–2 días)

- [ ] Crear `public/admin/index.html` con `AUTH.requireAccess([ROLES.ADMIN])`
- [ ] Añadir tarjeta `data-mod="admin"` en `public/index.html` solo para admins
- [ ] Crear `js/domain/adminMetrics.js` (helpers puros)
- [ ] Crear `js/pages/admin-index.js` con stat grid (4 KPIs: órdenes abiertas, contratos pendientes, cotizaciones que vencen, PoC activos)
- [ ] Botón refrescar manual (sin auto-refresh todavía)
- [ ] CSS `public/css/admin-panel.css`

### Fase 2 — Operación detallada (1 día)

- [ ] `public/admin/operacion.html` con tabla de órdenes por estado + por técnico
- [ ] Cotizaciones que vencen — añadir helper `daysUntilExpiry` en `cotizacionesTotales.js`
- [ ] Inventario crítico (piezas con stock bajo)

### Fase 3 — Salud del sistema (1–2 días)

- [ ] Crear `js/services/mailQueueService.js` con `listStuck`, `listFailed`
- [ ] `public/admin/salud.html` con banners de mail queue + usuarios sin rol + órdenes sin `searchTokens`
- [ ] Toggle de auto-refresh (60 s, pausa con `document.hidden`)

### Fase 4 — Auditoría (2 días)

- [ ] Crear `js/services/auditoriaService.js`
- [ ] `public/admin/auditoria.html` con timeline + filtros + resolución de usuario (cache `Map<uid, nombre>`)

### Fase 5 — PII (1 día)

- [ ] `public/admin/pii.html` con preview/ejecución de `purgePIIRetention`
- [ ] Modal de confirmación con conteo destacado
- [ ] Toast + recarga de preview tras ejecutar

### Fase 6 — Hardening (0.5 día)

- [ ] Cache local de KPIs (30 s) para navegación interna
- [ ] Skeleton loaders mientras cargan los conteos (reusar `.skeleton-card` que ya existe en `index.html`)
- [ ] QA con cuenta admin y cuenta no-admin (verificar redirección)
- [ ] Actualizar `ARQUITECTURA_CECOMUNICA.md` con la nueva carpeta `admin/` y los servicios nuevos

---

## 10. Futuro (fuera de v1)

- **Métricas server-side agregadas** en doc `agregados/dashboard` actualizado por triggers, para escalar a muchos admins concurrentes.
- **Telemetría de errores frontend** — integrar Sentry o un logger propio que escriba a `logs_frontend/` (con sampling) y exponer "errores últimas 24 h" en el panel.
- **Alertas push / email** cuando se cruza un umbral (ej. mail queue atascada > 30 min).
- **Comparativas históricas** — guardar snapshots diarios de KPIs en `agregados/historico/{yyyy-mm-dd}` para gráficos de tendencia.
- **Exportar reportes** (Excel via SheetJS, ya disponible) con un selector de rango de fechas.
- **Permisos granulares** — separar "admin de negocio" (solo KPIs) de "admin técnico" (PII, recomputes). Requiere nuevos valores en `ROLES`.

---

## 11. Checklist antes de mergear v1

- [ ] Páginas redirigen a `/index.html` con toast si entra un no-admin
- [ ] Tarjeta de admin **no** aparece en el home para roles no-admin (verificar con cuenta de cada rol)
- [ ] `mailQueueService` no expone funciones de escritura — solo lectura
- [ ] Ninguna página del panel llama `db.collection()` directo (regla §3.5 de arquitectura)
- [ ] Auto-refresh se pausa con pestaña oculta — verificar en DevTools
- [ ] Botón de purga PII pide confirmación con `Modal.confirm({ danger: true })`
- [ ] Estilos del panel viven en `admin-panel.css` o en el kit — sin `<style>` inline > 30 líneas
- [ ] `ARQUITECTURA_CECOMUNICA.md` actualizado con la nueva carpeta y los servicios nuevos
- [ ] Commit hecho **antes** de cada fase grande (memoria: ver `feedback_commit_before_risky_edits`)

---

## 12. Configuraciones gestionables

Página nueva: `public/admin/config.html`. Centraliza parámetros que hoy son hardcoded en código o requieren editar Firestore desde la consola. Permite cambiarlos sin redeploy.

### 12.1 Mecánica común

**Single source of truth:** documento `empresa/config` (Firestore). El `EmpresaService` ya expone `getDoc(name)` / `setDoc(name, data)` — solo se agrega `getConfig()` / `setConfig(patch)` como conveniencias tipadas.

```js
// js/services/empresaService.js — añadidos
async getConfig() {
  const d = await this.getDoc('config');
  return { ...DEFAULT_CONFIG, ...(d || {}) };  // merge sobre defaults
},
async setConfig(patch) {
  await firebase.firestore().doc('empresa/config')
    .set({ ...patch, updated_at: firebase.firestore.FieldValue.serverTimestamp(),
           updated_by: firebase.auth().currentUser.uid }, { merge: true });
}
```

**Pattern de consumo en el código existente** (fallback siempre presente):

```js
// formatting.js — antes
const ITBMS_RATE = 0.07;

// formatting.js — después
const ITBMS_RATE_DEFAULT = 0.07;
let _itbmsRate = ITBMS_RATE_DEFAULT;
FMT.getITBMSRate = () => _itbmsRate;
FMT.setITBMSRate = (n) => { _itbmsRate = Number(n) || ITBMS_RATE_DEFAULT; };

// firebase-init.js — al inicializar la sesión
EmpresaService.getConfig().then(cfg => {
  if (cfg.itbms_rate != null) FMT.setITBMSRate(cfg.itbms_rate);
  if (cfg.cotizacion_validez_dias) window.COT_VALIDEZ_DEFAULT = cfg.cotizacion_validez_dias;
  // …
});
```

**Regla crítica:** **todo consumidor mantiene un default literal en el código.** Si `empresa/config` no responde (Firestore caído, ITP de Safari bloqueando lectura, doc borrado por error), el sistema sigue funcionando con valores razonables. La configuración es una **capa de override**, no una dependencia bloqueante.

**Visibilidad:** solo `ROLES.ADMIN` puede leer/escribir `empresa/config` (regla nueva en `firestore.rules` — `read, write: if userRole() == 'administrador'`). El resto de la app **no lee** este doc; recibe los valores ya aplicados via los servicios/helpers.

### 12.2 Parámetros expuestos en v1

| Key en `empresa/config` | Tipo | Default | Consumidor | Validación UI |
|---|---|---|---|---|
| `itbms_rate` | number (0–1) | `0.07` | `FMT.getITBMSRate()` en cotizaciones, contratos, órdenes | rango 0–0.25, paso 0.001 |
| `cotizacion_validez_dias` | integer | `15` | `cot-state.js` al crear cotización nueva | rango 1–365 |
| `pii_retention_dias` | integer | `90` | `purgePIIRetention` CF (parámetro `retentionDays`) | rango 30–730; warning si < 60 |
| `stock_minimo_default` | integer | `5` | `piezas.js` al crear pieza nueva (placeholder de `min_stock`) | rango 0–1000 |
| `orden_stale_dias` | integer | `10` | umbral del propio panel para badge "stale" en `admin/operacion.html` | rango 3–60 |
| `mail_cc_orden_completada` | string[] (emails) | `[]` | `onOrdenCompletada` CF al armar el payload | regex email por entry, máx 10 |
| `mail_cc_contrato_aprobado` | string[] (emails) | `[]` | `onContratoActivadoSendPdf` CF | regex email por entry, máx 10 |

### 12.3 Operadores, tipos de servicio y estados (CRUD existente)

Estos ya viven en `empresa/` (subdocs) y `EmpresaService.getOperadores()` los lee. Hoy se editan **desde la consola de Firebase**. La página `admin/config.html` agrega editor inline:

| Sub-doc | Forma | UI |
|---|---|---|
| `empresa/operadores` | `{ items: [{ id, nombre, activo }] }` | Lista editable + toggle activo + drag-reorder |
| `empresa/tipos_servicio` | `{ items: [{ id, nombre, color, activo }] }` | Mismo patrón |
| `empresa/estados_reparacion` | `{ items: [{ id, nombre, color, orden }] }` | Mismo patrón |

Reusa el primitivo `.responsive-cards` para el listado y `Modal.confirm` para borrados (con check de "¿hay registros usando este valor?" antes de permitir delete).

### 12.4 Banner global de aviso (opcional, v1.5)

Doc `empresa/avisos`:

```js
{
  activo: true,
  mensaje: "Mantenimiento programado el viernes 8–9 PM",
  tipo: "warning",   // 'info' | 'warning' | 'error'
  desde: <Timestamp>,
  hasta: <Timestamp>
}
```

`Layout.renderTopbar(opts)` se extiende para leer este doc y pintar un `.alert-banner` sticky debajo del topbar cuando `activo && desde <= now <= hasta`. Editor en `admin/config.html` con preview en vivo.

### 12.5 Lo que NO se gestiona desde aquí

Para evitar feature creep y problemas de seguridad:

- **Reglas de Firestore / Storage** — versionadas en repo, deploy explícito
- **Secretos** (`FIRMA_SECRET`, `SENDGRID_API_KEY`) — viven en Secret Manager
- **Templates de email** — riesgo XSS si se exponen como WYSIWYG; cambios via PR en `emailRenderer.js`
- **Enum `ROLES.*`** — cambios requieren actualizar todos los consumidores
- **Visibilidad de módulos por rol** — postponed; sigue hardcoded en `index.html` hasta v2 (mover a `empresa/permisos` introduce tentación de usarlo como seguridad cuando no lo es)

### 12.6 Migración de los valores actuales

Antes de mergear: un script one-off en `public/tools/seed-empresa-config.html` (ignorado por hosting, ver `firebase.json`) que inicializa `empresa/config` con los defaults arriba. Sin esto, el primer admin que entre al panel verá el editor en blanco y tendrá que rellenarlo a mano — preferible sembrar.

### 12.7 Auditoría de cambios

Cada `setConfig()` estampa `updated_at` + `updated_by` (uid). Para historial completo, una subcolección `empresa/config/historial/{autoId}` con snapshot completo del antes/después — opcional v2; en v1 basta con el rastro de "último editor".

### 12.8 Fase de implementación

Encaja como **Fase 5.5** entre PII y Hardening:

- [ ] Crear `empresa/config` con defaults via tool de seed
- [ ] Endurecer regla de Firestore para `empresa/config` (admin-only)
- [ ] Añadir `getConfig` / `setConfig` a `EmpresaService`
- [ ] Hookear `firebase-init.js` para aplicar config al cargar la sesión
- [ ] Refactorizar consumidores hardcoded (ITBMS, validez cotización, defaults de pieza) con fallback literal
- [ ] Construir `public/admin/config.html` con formularios + validación
- [ ] Editor inline de operadores / tipos / estados
- [ ] Verificar que un admin sin internet (Firestore caído) sigue viendo la app con los defaults — test manual en DevTools con "Offline"

---

## 13. Utilidades adicionales para admin

Lo que sigue extiende el panel más allá de "monitorear + configurar" hacia "operar". Se prioriza en dos olas: **v1.5** (alto valor / bajo-medio esfuerzo, ataca dolores reales actuales) y **v2** (nice to have / mayor inversión).

### 13.1 v1.5 — Confirmado para la segunda iteración

#### 13.1.1 Búsqueda global cross-colección

Input estilo cmd-K en el topbar del panel (atajo `Ctrl+K` / `Cmd+K`) que busca simultáneamente en:

- `clientes` (por nombre, email, RUC, teléfono)
- `ordenes_de_servicio` (via `OrdenesService.searchOrders` — ya indexada con `searchTokens`)
- `contratos` (por `contrato_id`, nombre cliente)
- `cotizaciones` (por número, cliente)
- `poc_devices` (por serial, SIM, IP)

Resultados agrupados por colección con enlace directo a la página de detalle correspondiente. Debounce 250 ms. Máx 5 resultados por colección.

**Servicio nuevo:** `js/services/busquedaGlobalService.js` con `searchAll(query)` que orquesta las queries en paralelo.

**Optimización:** las colecciones sin `searchTokens` (contratos, cotizaciones, clientes, PoC) requieren scan parcial. Limitar a últimos 500 docs de cada una con `orderBy('updated_at', 'desc').limit(500)` — cubre el 95% de las búsquedas reales sin destruir el quota.

> **Futuro v2:** sembrar `searchTokens` en contratos / cotizaciones / clientes con el mismo patrón de `onOrdenWriteSearchTokens` para eliminar el scan.

#### 13.1.2 Re-envío de emails fallidos

Vista en `admin/salud.html` (sección "Mail Queue") lista los docs de `mail_queue` con `error` set. Cada row tiene botón "Reintentar":

```js
async function reintentarEmail(docId) {
  await firebase.firestore().doc(`mail_queue/${docId}`).update({
    error: firebase.firestore.FieldValue.delete(),
    sent_at: firebase.firestore.FieldValue.delete(),
    retried_at: firebase.firestore.FieldValue.serverTimestamp(),
    retried_by: firebase.auth().currentUser.uid
  });
}
```

Esto re-dispara `onMailQueued` (trigger `onDocumentCreated` no — solo updates; **necesita ajuste**). Dos opciones:

- **A (preferida):** `onMailQueued` se extiende a `onDocumentWritten` y solo procesa cuando `error == null && sent_at == null`. Idempotente.
- **B:** clone del doc (borrar viejo, crear nuevo con mismo payload). Más simple pero pierde el historial.

Botón "Reintentar todos" en bulk con confirmación.

#### 13.1.3 Gestión de usuarios

Página nueva `admin/usuarios.html`. CRUD basado en una callable nueva `manageUser`:

```js
exports.manageUser = onCall(async (req) => {
  const callerUid = req.auth?.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', '');
  const caller = await admin.firestore().doc(`usuarios/${callerUid}`).get();
  if (caller.data()?.rol !== 'administrador') {
    throw new HttpsError('permission-denied', 'Solo administradores');
  }

  const { action, uid, email, rol, nombre, activo } = req.data;
  switch (action) {
    case 'create':    // crea Auth user + doc usuarios/{uid}
    case 'updateRol': // valida rol contra enum, escribe usuarios/{uid}.rol
    case 'deactivate': // disable en Auth + flag activo=false
    case 'resetPassword': // genera link de reset via Auth
    default: throw new HttpsError('invalid-argument', '');
  }
});
```

**UI:** tabla con todos los usuarios + filtro por rol + columnas (nombre, email, rol, activo, último login). Acciones inline: cambiar rol (dropdown con `ROLES`), desactivar, generar link de reset.

**Safety:** no permitir que un admin se desactive a sí mismo ni se quite el rol admin. Si solo queda un admin activo, bloquear su desactivación con mensaje claro.

#### 13.1.4 Verificación de integridad

Sección en `admin/salud.html` o página nueva `admin/integridad.html`. Lista checks que corren on-demand:

| Check | Query | Severidad |
|---|---|---|
| Órdenes con `contrato_id` que no existe | join client-side contra `contratos` | Error |
| Contratos con `os_count` ≠ count real de subcol | comparar `contratos/{id}.os_count` vs `count(contratos/{id}/ordenes)` | Warning |
| Clientes sin teléfono **y** sin email | filtro Firestore | Warning |
| Equipos PoC sin serial | filtro Firestore | Error |
| Órdenes "entregadas" sin `firma_url` | filtro Firestore | Warning |
| Contratos activos vencidos (`fecha_vencimiento < hoy`) | filtro client-side | Info |
| Cotizaciones aprobadas sin orden/contrato vinculado en > 30 días | filtro client-side | Info |

Cada check muestra conteo + tabla de afectados + enlace directo al doc. **Solo diagnóstico** — la corrección se hace en cada página de módulo. Si en v2 vale la pena, agregar acción "Auto-corregir" para checks deterministas (recompute de `os_count`).

#### 13.1.5 Dashboard financiero + reporte ITBMS

Página nueva `admin/financiero.html`:

**KPIs financieros del mes actual:**

- Facturado (suma de totales de cotizaciones `convertida` + contratos `activo` del mes)
- Pipeline (suma de totales de cotizaciones `enviada` + `aprobada` no convertidas)
- ITBMS recaudado (calculado con `itbms_rate` actual sobre subtotales facturados)
- Ticket promedio
- Conversion rate cotización→orden (cotizaciones `convertida` / `enviada` del mes)

**Comparativa:** cada KPI con su delta vs mes anterior (flecha ↑/↓ + %).

**Reporte ITBMS XLSX para contador:**

Selector de mes/año → botón "Descargar" → SheetJS arma un workbook con:

- Hoja 1: resumen (totales por día)
- Hoja 2: detalle (una fila por cotización/contrato con cliente, fecha, subtotal, ITBMS, total)
- Hoja 3: agrupado por cliente

Nombre del archivo: `cecomunica_itbms_YYYY-MM.xlsx`. Reusa la integración SheetJS de `admin-equipos-cliente.html`.

### 13.2 v2 — Roadmap posterior (priorizar según feedback)

| Función | Notas de diseño cuando se aborde |
|---|---|
| **"Ver como" (impersonation visual)** | Toggle en topbar del panel; renderiza el home con `visiblesPorRol[ROLES.X]` para QA de roles. **Solo visual** — no afecta queries ni reglas. Marca claramente "MODO VISUAL — ROL: técnico" con banner amarillo. |
| **Quick actions / bulk en órdenes** | Bulk-bar para reasignar técnico, cambiar prioridad, mover de estado. Reusa primitivo `.bulk-bar` del kit (ya implementado en clientes). Requiere mover lógica de transición de estado a un helper compartido para evitar duplicar reglas. |
| **Detector + merge de duplicados** | Vista "posibles duplicados" con score de similitud (Levenshtein en nombre + match exacto en email/teléfono/RUC). Acción "fusionar A en B" reapunta refs (ordenes, contratos, cotizaciones) y elimina A. **Transaccional** — debe ser CF callable, no client-side. Alto riesgo: requiere preview detallado y confirmación con captcha textual ("escriba MERGE para confirmar"). |
| **Papelera unificada** | Solo viable después de extender soft-delete al resto de colecciones (hoy solo PoC lo tiene). Decisión: ¿vale la pena agregar `deleted_at` + `deleted_by` a todas las colecciones? Probablemente sí para `clientes` y `contratos`; no para `cotizaciones` y `ordenes` que ya son baratas de recrear. |
| **Preview de templates de email** | Página `admin/email-preview.html` con select de template + form de datos dummy + iframe con render. Llama a CF nueva `previewEmail({ template, data })` que devuelve HTML renderizado sin enviar. **No edita templates** — esos siguen en `emailRenderer.js`. |
| **Broadcast a clientes** | Riesgo alto de mal uso / marca como spam. Si se hace: throttling de 1 email/segundo via `mail_queue`, segmentos predefinidos (no SQL libre), preview obligatorio, captcha de confirmación, log permanente en `broadcasts/{id}` con lista exacta de recipients. Considerar SPF/DKIM/DMARC antes. |
| **Snapshot/export de configuración** | Botón "Descargar config actual" → JSON de `empresa/config` + sub-docs (operadores/tipos/estados). Útil para backup y para mover entre environments (dev/prod). Botón "Importar" requiere validación de schema y modo dry-run. |
| **Disparar backfills desde UI** | Convertir `functions/backfill-search-tokens.js` (y futuros) a callables admin-only. Botón "Ejecutar" con confirmación + progreso (count procesados / total). Reportar resumen al finalizar. |
| **Recompute de caches de contrato** | Promover de "opcional v1.5" (§7) a **v1.5 confirmado** — la inconsistencia entre `os_count` y la subcol pasa lo suficiente para justificarlo. Botón en `admin/integridad.html` al lado de cada warning de "cache desincronizado". |
| **Alertas configurables con umbrales** | "Si órdenes pendientes > 50 → banner warning". Definidas en `empresa/config.alertas[]`. Para v2.5 podría disparar email/push, pero v2 solo pinta banner en `admin/index.html`. |

### 13.3 Lo que conscientemente **no** entra en el roadmap

- **Editor WYSIWYG de templates de email** — riesgo XSS si se permite HTML libre, y los templates cambian rara vez. Mantener en código con PR review.
- **Edición de reglas de Firestore/Storage desde UI** — son código versionado por una razón.
- **Restore de Firestore puntual desde la UI** — requiere PITR habilitado y operación delicada; mejor desde GCloud directamente.
- **Sandbox / cliente "test" en prod** — si se necesita ambiente de prueba, montar `cecomunica-dev` aparte (proyecto Firebase separado). Mezclar test data con prod siempre se vuelve un problema.

### 13.4 Encaje en fases

Sobre el roadmap original de §9:

- **Fase 7 (nueva)** — Búsqueda global (13.1.1) y Re-envío de mails (13.1.2). Bajo esfuerzo, alto valor diario.
- **Fase 8 (nueva)** — Gestión de usuarios (13.1.3) y Verificación de integridad (13.1.4). Requiere 1 CF nueva.
- **Fase 9 (nueva)** — Dashboard financiero + reporte ITBMS (13.1.5). Cierra la propuesta de valor para el dueño del negocio.

Estimación combinada de las 3 fases: **~5–7 días**. Las funciones v2 entran en backlog y se priorizan según el feedback real de uso del panel v1+v1.5.
