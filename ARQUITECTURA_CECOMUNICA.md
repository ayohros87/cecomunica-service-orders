# Arquitectura del Sistema Cecomunica

> **Estado (2026-09-28):** frontend servido desde `dist/` (Vite MPA, un entry por página) · auditoría UX 2026-09-28 ejecutada y desplegada (P0, P1 y P2: ver `docs/AUDITORIA_UX_2026-09-28.md` y `CHANGELOG.md`).
> Para el plan de trabajo pendiente ver `OUTSTANDING.md`.
> Para el historial de cambios ver `CHANGELOG.md`.
> Para el plan y estado de la migración al UI Kit ver `design-system/ui_kits/MIGRATION.md`.

---

## 1. Descripción General

**Cecomunica Service Orders** es una plataforma web para gestión de servicios de comunicación por radio. Administra órdenes de servicio, inventario, contratos, equipos PoC (Push-to-Talk over Cellular), clientes y cotizaciones.

---

## 2. Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5 + CSS3 + JavaScript vanilla, empaquetado con **Vite 8 (multipágina)** desde 2026-09-28: producción sirve `dist/` |
| SDK cliente | Firebase 12 desde npm (compat para la app + modular solo para agregados `count()`), caché persistente multi-pestaña |
| Iconografía | Lucide 1.23 en vendor a medida (`js/vendor/lucide.min.js`, regenerable con `tools/build-lucide-vendor.mjs`) |
| Hosting | Firebase Hosting (predeploy `npm run build` → `dist/`) |
| Base de datos | Cloud Firestore |
| Almacenamiento | Firebase Storage |
| Backend | Firebase Cloud Functions v2 (Node.js 22, estructura modular en `functions/src/`) |
| PDF | Puppeteer Core |
| Email | Nodemailer + SendGrid (vía Google Secret Manager) |
| Excel | SheetJS |
| Secretos | Google Secret Manager (`FIRMA_SECRET`, `SENDGRID_API_KEY`) |

---

## 3. Arquitectura del Frontend

### 3.1 Topología real (al 2026-09-28)

No es un SPA. Cada `.html` es una página autónoma que carga **un entry** de
`public/js/entry/<carpeta>-<pagina>.js` con `<script type="module">`; el entry
importa en orden los scripts clásicos (`core/`, `services/`, `domain/`, `ui/`,
`pages/`), que siguen publicando sus globales en `window`. Vite empaqueta cada
entry con hash y copia el resto de `public/` verbatim (menos `tools/` y
`dev-diag-*`). Las páginas marcadas *(stub)* son redirecciones que se
conservan mientras caduquen los enlaces de correos viejos.

```
public/
  index.html                   ← home (Command Center): señales por rol, tarjetas desde MODULOS.CATALOGO, rail
  login.html · perfil.html · firma-correo.html
  verificar-contrato.html (stub → verify/)
  admin/                       ← panel (solo ROLES.ADMIN): index, operacion, financiero, kpi-reportes,
                                 kpi-reporte-print, usuarios, auditoria, config, alertas, pii,
                                 clientes-duplicados, refs-huerfanas, grupos, salud, integridad,
                                 backfills, email-preview
  almacen/index.html           ← espacio de bodega: pestañas Hoy · Asignar · Existencias · Piezas ·
                                 Descartados · Con condición · No devueltos · Avanzado (lista por serial)
  inventario/                  ← modelos, piezas-tarifas, cargos (Finanzas) · piezas, descartados,
                                 condiciones, no-devueltos (pestañas de Almacén) ·
                                 equipos, index, pendientes, cargar-inventario, vista-correo (stubs → Almacén)
  clientes/                    ← centro.html (Centro de gestión: ficha 360 + todas las gestiones;
                                 js en centro-core.js + 16 centro-*.js) · ficha.html (alta/edición
                                 con documentos) · index.html (edición masiva avanzada) ·
                                 regularizacion.html · anexo-aumento.html · editar.html (stub)
  contratos/                   ← index.html (archivo de consulta) · documento.html · imprimir-contrato.html ·
                                 transicion.html · nuevo-contrato, editar-contrato, cancelaciones,
                                 nuevo-cliente, seriales (stubs → Centro / ficha / Almacén)
  cotizaciones/                ← index, nueva-cotizacion, editar-cotizacion, detalle-cotizacion,
                                 imprimir-cotizacion
  ordenes/                     ← index (bandeja) · nueva-orden · nuevo-batch (única captura de equipos) ·
                                 editar-orden · cotizar-orden · imprimir-orden · nota-entrega-intervenciones ·
                                 progreso-tecnicos · reporte-pendientes · importar-exportar ·
                                 admin-equipos-cliente · agregar-equipo, config, estado_reparacion,
                                 modelo-de-radio, tecnicos (stubs)
  POC/                         ← index (Base PoC) · nuevo-batch (lote; cola de lotes preparados por ventas) ·
                                 vendedores-batch (Preparar lote) · nueva-consola · sim-cards ·
                                 importar-poc · imprimir-equipos · editar-batch (stub)
  facturacion/                 ← bandeja (portada de Finanzas) · comisiones · clientes-qbo · activacion ·
                                 emision (honesta: no emite) · index (stub → bandeja)
  firmar/                      ← index (firma remota del cliente) · tablet (kiosco de acuses)
  verify/                      ← index (verificación pública del contrato) · cotizacion (respuesta pública)
  js/
    entry/                     ← 75 entries (uno por página)
    firebase-init.js           ← único init de Firebase + guard de sesión
    core/                      ← auth, roles, modulos (catálogo + ROL_LABELS), layout (topbar, rail,
                                 drawer, Ctrl+K), formatting (FMT, fechas de Panamá), serial, icons
    services/                  ← 33 servicios (única ruta de I/O a Firestore)
    domain/                    ← 36 módulos puros (UMD: window + module.exports; varios duplicados a
                                 propósito en functions/src/domain con test de sincronía)
    ui/                        ← 25 primitivas: modal, toast, busy (withBusy), bandeja, entity-combo
                                 (núcleo de picker/filtered-select), asistentes de bodega, firmaPad…
    pages/                     ← 114 scripts de página
  css/                         ← ceco-ui.css (canon de botón + alias), ceco-rail, ceco-command (home),
                                 bandeja, form-kit, search-palette, ordenes-index, cotizaciones-kit…
```

El Design System vive separado del runtime en `design-system/`:

```
design-system/
  colors_and_type.css                       ← tokens base (colores, tipografía, spacing)
  ui_kits/
    app/                                    ← kit desktop con portal de 7 áreas
      index.html, foundations.html,
      ordenes.html, poc.html, contratos.html,
      cotizaciones.html, clientes.html, inventario.html
      app.css                               ← kit completo (3,133 líneas)
      app-demo.js                           ← demo behaviors (toast, accordion, sheets…)
      print-demo*.html
    app-mobile/                             ← kit touch (≤480 px) — solo Órdenes hoy
      index.html, foundations.html, ordenes.html
      mobile.css                            ← namespace .m-*
    MIGRATION.md                            ← plan + checkpoint de migración a producción
```

La página `index.html` de cada kit es un portal con tarjetas a las áreas; cada
área tiene una nav superior con anclas a las secciones aplicadas.

### 3.2 Orden de carga de scripts (por página)

Cada página tiene un entry en `js/entry/` que importa, en este orden, lo que la
página necesita: `firebase-init.js` → `core/*` (roles, formatting, modulos,
layout) → `ui/*` (toast, modal, busy…) → `services/*` → `domain/*` →
`pages/*` → `vendor/lucide.min.js` + `core/icons.js`. El orden importa igual
que con las etiquetas `<script>` viejas porque cada archivo publica globales en
`window`. Algunas páginas conservan además etiquetas `<script src>` clásicas en
el `<head>` para lo que debe correr durante el parse (por ejemplo `modulos.js`
en el home). Los tests que verifican qué carga una página leen el entry con
`functions/test/_helpers/entryScripts.js`.

### 3.3 Módulos core (`js/core/`)

| Archivo | Global expuesto | Contenido |
|---|---|---|
| `roles.js` | `window.ROLES` | Enum canónico de todos los roles del sistema |
| `formatting.js` | `window.FMT` | `ITBMS_RATE`, `money()`, `round2()`, `date()`, `datetime()`, `calcITBMS()` |
| `auth.js` | `window.AUTH` | `is()`, `isAny()`, `getRole()`, `getUser()`, `requireAccess()` |
| `layout.js` | `window.Layout` | `renderTopbar(opts)` (configuración total) + `renderTopbarFor(mode, opts)` shortcut con defaults por modo de navegación (`'index'` / `'edit'` / `'child'` / `'home'`, ver §3.5 nav modes); menú de overflow compartido auto-wired |

### 3.3a Módulos UI compartidos (`js/ui/`)

| Archivo | API | Reemplaza |
|---|---|---|
| `toast.js` | `Toast.show(message, type)` — tipos `'ok' \| 'bad' \| 'warn' \| ''` | `mostrarToast()` y `showToast()` locales (la página de órdenes ya está migrada; otras páginas mantienen su `mostrarToast` local hasta que se migren) |
| `modal.js` | `Modal.open(id)`, `Modal.close(id)`, `Modal.confirm({ message, danger })` → `Promise<boolean>`, `Modal.prompt({ title, message, defaultValue, multiline })` → `Promise<string\|null>` | Patrones inline de open/close + Escape handler; reemplaza `window.prompt()` para edición inline de campos de equipo y similares |

### 3.3b Módulos de dominio (`js/domain/`)

Reglas de negocio puras (sin DOM, sin Firestore). Extraídas en Phase 5d.

| Archivo | API | Origen |
|---|---|---|
| `totales.js` | `ContractTotals.calculate(equipos, itbmsRate)` | Cálculo de subtotal/ITBMS/total |
| `scoring.js` | `scorePieza()`, `filtrarPiezas()` | Ranking de piezas para recomendación |
| `equipoNormalize.js` | Normalización de campos de equipo (serial, modelo) | Compartido entre frontend y CFs |

### 3.4 Capa de servicios (`js/services/`)

Cada servicio encapsula todo el I/O de Firestore para su colección. Las páginas no llaman `db.collection()` directamente (salvo excepciones documentadas en §3.5).

| Servicio | Colección principal | Funciones clave |
|---|---|---|
| `contratosService.js` | `contratos` | `getContrato`, `addContrato`, `updateContrato`, `listContratos`, `listContratosFallback`, `getByContratoId`, `contarPorTipoYFecha`, `getContratosActivosPorCliente`, `getContratosActivosAprobados`, `getOrdenesDeContrato`, `linkOrden`, `unlinkOrden` |
| `ordenesService.js` | `ordenes_de_servicio` | `getOrder`, `addOrder`, `updateOrder`, `mergeOrder`, `setOrder`, `listAll`, `filterByStatuses`, `getConsumos`, `addConsumo`, `updateConsumo`, `deleteConsumo` |
| `clientesService.js` | `clientes` | `getCliente`, `createCliente`, `updateCliente`, `deleteCliente`, `listClientes`, `searchByToken`, `batchUpdate` |
| `modelosService.js` | `modelos` | `getModelos`, `getModelo`, `addModelo`, `updateModelo`, `setActivo`, `deleteModelo` |
| `inventarioService.js` | `inventario` | `getInventarioActual`, `getHistorialModelo`, `guardarInventario` |
| `piezasService.js` | `piezas` | `getPiezas`, `getPieza`, `addPieza`, `updatePieza`, `deletePieza`, `ajustarCantidad`, `ajustarDelta`, `importarPiezas` |
| `pocService.js` | `poc_devices` | `getPocDevices`, `getPocDevice`, `addPocDevice`, `updatePocDevice`, `softDeletePocDevice`, `restorePocDevice`, `addLog`, `findByField`, `getRecent` |
| `cotizacionesService.js` | `cotizaciones` | `getCotizacion`, `addCotizacion`, `updateCotizacion`, `listCotizaciones`, `getCotizacionesPorFecha`, `contarPorFecha` |
| `mailService.js` | `mail_queue` | `enqueue(payload)` — estampa `createdAt: serverTimestamp()` automáticamente |
| `usuariosService.js` | `usuarios` | `getUsuario`, `getUsuariosByRol`, `getVendedores` |
| `empresaService.js` | `empresa` | `getOperadores`, `getDoc`, `setDoc` |
| `kpiReportsService.js` | `kpi_reports` | `getMes`, `listAll`, `upsertMes`, `upsertBatch`, `setEstado`, `updateComentarios` — solo admin (rules) |

### 3.5 Llamadas directas a Firestore — estado consolidado (2026-05-19)

La migración de páginas a la capa de servicios está completa. `db.collection()` ya **no aparece** en ningún script de `public/js/pages/` ni en bloques inline de los `*.html` desplegados. Las únicas referencias que quedan en el repo son intencionales:

| Ubicación | Motivo |
|---|---|
| `public/js/services/*.js` (11 archivos) | Implementación de los servicios — único lugar legítimo |
| `public/js/firebase-init.js` | Bootstrap de la app (auth + persistencia) |
| `public/verify/index.html` | Lectura pública (sin auth) de `verificaciones/{id}` — ver §7.3 |
| `public/verificar-contrato.html` | Misma lectura pública, página alternativa heredada |
| `public/tools/*.html` | Migradores one-off; excluidos del deploy vía `firebase.json` → `hosting.ignore: ["tools/**"]` |

Las dos páginas de verificación pública leen `verificaciones` directamente porque cargan en contexto anónimo (sin Firestore listeners ni servicios); su única operación es un `.doc(id).get()`. Una extracción a `firebase-public.js` está pendiente en `OUTSTANDING.md §2.5` (motivo: ITP de Safari afecta `setPersistence(LOCAL)` y `enablePersistence` que hoy se cargan sin necesidad en estas páginas).

### 3.6 Scripts de página (`js/pages/`)

Páginas grandes con script extraído a archivo externo (cargado con `defer`).

**Páginas con namespace dedicado** (Phase 5e — un coordinador + módulos por responsabilidad):

| Coordinador | HTML de origen | Módulos |
|---|---|---|
| `contratos-index.js` | `contratos/index.html` | `contratos-state.js`, `contratos-approval.js`, `contratos-upload.js`, `contratos-equipos.js`, `contratos-list.js` |
| `poc-index.js` | `POC/index.html` | `poc-state.js`, `poc-list.js`, `poc-bulk.js`, `poc-edit.js`, `poc-sim.js` |
| `vendedores-batch.js` | `POC/vendedores-batch.html` | `window.VB` (namespace único) |
| `ordenes-index.js` | `ordenes/index.html` | `ordenes-state.js`, `ordenes-data.js`, `ordenes-render.js`, `ordenes-filters.js`, `ordenes-flujo.js`, `ordenes-equipos.js`, `ordenes-notas.js`, `ordenes-ui.js`, `ordenes-events.js` *(Phase 5f, 2026-05-14)* |
| `centro-core.js` | `clientes/centro.html` | `centro-directorio.js`, `centro-ficha.js`, `centro-regularizacion.js`, `centro-ficha-bloques.js`, `centro-firma.js`, `centro-gestiones.js`, `centro-acciones.js`, `centro-menu-gestion.js`, `centro-wiz-*.js`, `centro-cambio-serial.js`, `centro-plan-seriales-renovacion.js`, `centro-editor-contrato.js`, `centro-aprobaciones.js` *(partido 2026-09-28)* |

El coordinador es delgado (≤ 110 líneas); cada módulo expone sus funciones públicas en `window.*` y las dependencias cruzadas se resuelven por el orden de `<script>` en el HTML.

**Páginas con script extraído pero global plano** (sin namespace dedicado):

| Archivo JS | HTML de origen | Notas |
|---|---|---|
| `piezas.js` | `inventario/piezas.html` | Candidato a `window.Piezas` (Phase 5g, opcional) |
| `clientes-index.js` | `clientes/index.html` | Candidato a namespace (Phase 5g) |
| `editar-orden.js` | `ordenes/editar-orden.html` | Candidato a namespace (Phase 5g) |
| Otros menores | varios | Ver `OUTSTANDING.md` §2.8 (Phase 5g) para inventario pendiente |

### 3.7 Design System y UI Kit (Phase R3 — 2026-05-27/28)

El Design System vive en `design-system/` (ver árbol en §3.1) y es la
**fuente de verdad de diseño**. Los kits HTML (`ui_kits/app/*.html`,
`ui_kits/app-mobile/*.html`) son demos navegables que muestran cada primitivo
en uso real y sirven como referencia 1:1 para las páginas de `public/`.

#### 3.7.1 Capas de CSS

```
1. colors_and_type.css      ← tokens base (DS) — colores, tipografía, spacing,
                              radius, shadows. Cargado por todos los kits.
2. ceco-ui.css              ← CSS de producción. Bridge con tokens del DS
                              (Fases 1-6 de DS adoption). Importa app-kit-extras.css.
3. app-kit-extras.css       ← primitivos R3 del UI Kit que aún no están
                              consolidados en ceco-ui.css. Bridge temporal.
4. <inline page>            ← solo CSS genuinamente page-local
                              (badges específicos, density toggles, print overrides).
```

`ceco-ui.css` hace `@import url('./app-kit-extras.css')` al inicio, así que
todas las páginas de `public/` heredan los primitivos del kit sin tocar sus
`<link>`. Cuando se consolide la migración (Phase R4, futura) se reemplazará
`ceco-ui.css` por el `app.css` del Design System directamente.

#### 3.7.2 Primitivos R3 nuevos (vs versión pre-migración)

Documentados en `design-system/ui_kits/app/foundations.html` y
disponibles globalmente vía `app-kit-extras.css`:

| Primitivo | Clase | Uso |
|---|---|---|
| Toggle pill | `.toggle-pill` (+ `.is-on`) | Filtro booleano compacto inline (clientes, contratos, POC) |
| Dropdown menu | `.dropdown` / `.dropdown-menu` / `.dropdown-item` | Overflow desktop con secciones, dividers, item.danger |
| Floating tooltip | `.tooltip-floating` | Preview rica al hover (equipos en lista de contratos) |
| Alert banner | `.alert-banner` (+ `.alert-success` / `.alert-warning` / `.alert-error`) | Aviso permanente en flujo (no auto-dismiss como toast) |
| Page header centrado | `.page-header-centered` + `.page-header-icon` | Formularios largos (nueva-orden, nueva-cotización, nuevo-contrato) |
| Pager input | `.pager-input` | "Página N / total" para tablas grandes |
| Responsive cards | `.responsive-table-wrap` + `.responsive-cards` + `.responsive-card` | Tabla desktop → stack de tarjetas debajo de 900 px |
| Module grid | `.module-grid` + `.module-card` | Launcher del home con visibilidad por rol |
| Auth shell | `.auth-shell` + `.auth-brand` + `.auth-card` (scopeados) | Login + reset password |
| Empty state hint | `.empty-state-hint` | "Sin resultados / Prueba con menos filtros" |
| Bulk action bar | `.bulk-bar` (+ `.visible`) + `.bulk-count` + `.bulk-divider` + `.bulk-tag-wrap` | Acciones masivas contextuales con selección |

#### 3.7.3 Estado de migración (2026-05-28)

**45 páginas migradas** de las ~50 páginas en `public/`. 6 de 7 áreas
completamente alineadas (Home/Auth, Cotizaciones, Clientes, Inventario,
Contratos, PoC, Configuración Órdenes).

Páginas conservadas intencionalmente sin rewrite completo (kit primitives
funcionan; rewrite con diminishing returns):

- `ordenes/imprimir-orden.html`, `ordenes/nota-entrega.html`,
  `ordenes/nota-entrega-intervenciones.html`, `ordenes/cotizar-orden-formal.html`
  — print templates A4 con estilos inline intencionales para fidelidad de
  impresión
- `inventario/vista-correo.html` — vista intencionalmente inline-CSS para
  sobrevivir copy-paste a Outlook/Gmail

**Pendiente** (opcional):

- **Mobile móvil de Órdenes** — migrar `public/ordenes/index.html` (móvil) al
  patrón `.m-*` del kit `ui_kits/app-mobile/ordenes.html`. Recomendado esperar
  a que el trabajo móvil en curso (commits recientes `feat(ordenes/mobile)`)
  esté merged.
- **Consolidación final (Phase R4)** — reemplazar `ceco-ui.css` por
  `app.css` directo, eliminar `app-kit-extras.css`, deprecar clases legacy.

#### 3.7.4 Coupling JS ↔ kit

El kit es CSS-only en su mayor parte. Algunos primitivos esperan estructura
HTML específica y por eso el JS de páginas relacionadas se actualizó:

- `clientes-index.js` — `updateBulkBar()` usa `classList.toggle('visible', n>0)`
  en vez de `style.display` (la `.bulk-bar` del kit se controla por clase)
- `cotizaciones-index.js` — `renderRow()` construye estructura
  `.responsive-card` con `__top` / `__title` / `__sub` / `__meta` / `__actions`
- `nueva-cotizacion.js`, `editar-cotizacion.js` — `mostrarToast()` apende a
  `#toast-region` en vez de `document.body`
- `contratos-equipos.js` — tooltip dinámico crea div con
  `className = 'tooltip-floating'`
- `piezas.js` — query `.app-table-wrap` en vez de `.table-wrap`

#### 3.7.5 Bug fix retroactivo: `.app-card`

`ceco-ui.css` define `.app-card` como el "launcher card" del home (con
`cursor:pointer`, `display:flex` horizontal y hover `translateY`). Cuando se
migró el home a `.module-card` (Semana 2), las migraciones posteriores usaron
`.app-card` como wrapper de contenido — esto rompía el layout porque el flex
horizontal afectaba a las celdas internas. El fix vive en
`app-kit-extras.css` y neutraliza `display`, `cursor`, `transform` y `hover`
para `.app-card`, manteniendo el comportamiento de launcher en `.module-card`.

---

## 4. Autenticación y Roles

### 4.1 Flujo de autenticación

`firebase-init.js` expone `verificarAccesoYAplicarVisibilidad(callback)`. Cada página llama esto en `onAuthStateChanged`; si el usuario no está autenticado, redirige a `/login.html`. El callback recibe `(user, rol)`.

`AUTH.requireAccess([ROLES.ADMIN, ROLES.RECEPCION])` es el helper moderno (post-Phase-2) que centraliza la verificación.

### 4.2 Roles del sistema

Definidos canónicamente en `js/core/roles.js` como `window.ROLES`:

| Constante | Valor string | Acceso |
|---|---|---|
| `ROLES.ADMIN` | `"administrador"` | Acceso completo |
| `ROLES.RECEPCION` | `"recepcion"` | Gestión operativa |
| `ROLES.VENDEDOR` | `"vendedor"` | Clientes, cotizaciones, contratos |
| `ROLES.TECNICO` | `"tecnico"` | Órdenes (lectura/trabajo), PoC solo lectura |
| `ROLES.TECNICO_OPERATIVO` | `"tecnico_operativo"` | Subconjunto de técnico |
| `ROLES.INVENTARIO` | `"inventario"` | Módulo inventario |
| `ROLES.JEFE_TALLER` | `"jefe_taller"` | Supervisión taller |
| `ROLES.VISTA` | `"vista"` | Solo lectura general |

El campo `usuarios/{uid}.rol` almacena el valor string.

### 4.3 Páginas visibles para todo el personal

Algunas páginas son herramientas personales y se muestran a cualquier usuario autenticado, independientemente del rol. Su tarjeta se agrega en `public/index.html` a **todos** los arreglos de `visiblesPorRol`:

| Página | Módulo (`data-mod`) | Atajo | Descripción |
|---|---|---|---|
| `perfil.html` | — (link del menú overflow del topbar) | — | Lectura del propio perfil (nombre, correo, rol) |
| `firma-correo.html` | `firma` | `F` | Generador personal de firma HTML para correo. Pre-rellena nombre/correo/cargo desde `usuarios/{uid}` y permite copiar la firma (HTML + texto plano) al portapapeles. Usa `UsuariosService.getUsuario`, primitivos `.ds-card` / `.form-input` y `Layout.renderTopbarFor('edit')`. Los estilos inline en la plantilla de firma son intencionales: deben sobrevivir al cliente de correo. |

### 4.4 Panel de Administración (solo admin)

Acceso vía botón **"Panel de Administración"** en el menú overflow ("Más") del topbar del home, oculto por defecto y revelado solo cuando `verificarAccesoYAplicarVisibilidad` reporta `rol === 'administrador'`. No es una tarjeta del grid de módulos: queda fuera del flujo operativo diario.

Páginas (todas en `public/admin/`):

| Página | Responsabilidad | Servicios usados |
|---|---|---|
| `index.html` | Landing del panel: 4 stat cards (órdenes abiertas, contratos pendientes, cotizaciones por vencer, PoC activos) + banners de alerta + lanzadores a sub-páginas + búsqueda global Cmd+K (ver §4.4.1). Auto-refresh opcional (60 s, se pausa con `document.hidden`). | `OrdenesService`, `ContratosService`, `CotizacionesService`, `PocService`, `BusquedaGlobalService` |
| `operacion.html` | Tablas detalladas: órdenes por estado y por técnico, contratos por estado, cotizaciones por estado + las que vencen pronto, inventario crítico (stock ≤ mínimo). | `OrdenesService`, `ContratosService`, `CotizacionesService`, `PiezasService` |
| `salud.html` | Diagnóstico técnico: `mail_queue` atascados (>1h) y con error, resumen 24h; usuarios sin rol o con rol fuera del enum `ROLES`; órdenes sin `searchTokens`; top 10 órdenes por tamaño de `os_logs`. **Acciones**: re-envío single-row y bulk de mails fallidos (re-arma el doc para que `onMailQueued` lo procese — ver §6.3). | `MailQueueService`, `UsuariosService`, `OrdenesService` |
| `auditoria.html` | Timeline unificado de eventos recientes: transiciones de orden (ASIGNAR/COMPLETAR/ENTREGAR desde `os_logs`), transiciones de contrato (APROBAR/ANULAR desde `fecha_*`), purgas PII (`identificacion_purged_at`), eventos de usuarios (CREATE/UPDATE_ROL/DEACTIVATE/REACTIVATE/RESET_PASSWORD desde `usuarios_audit`). Resuelve UIDs a nombres en batch. Filtros por tipo (chips) y texto libre. | `AuditoriaService`, `UsuariosService` |
| `pii.html` | UI para `purgePIIRetention` callable: preview en seco con sample de 50 archivos, luego ejecución con `Modal.confirm` destructivo. Configura `retentionDays` (default 90, min 30). | callable `purgePIIRetention` |
| `usuarios.html` | CRUD completo de usuarios: alta con email + nombre + rol, cambio inline de rol (dropdown + confirmación), desactivar/reactivar (Auth `disabled` + flag `activo`), generar link de reset de password (modal con copy al portapapeles). Safety: no auto-desactivación, no auto-democión, no dejar sistema sin admins activos. | `UsuariosAdminService` → callable `manageUser` |
| `integridad.html` | Ejecuta 6 checks en serie y reporta hallazgos sin auto-corregir (botón "Abrir" por fila al doc del módulo): órdenes con `contrato_id` huérfano, clientes sin email ni teléfono, equipos PoC sin serial, órdenes entregadas sin firma, contratos activos vencidos, cotizaciones aprobadas hace >30 días sin vincular. Además incluye herramienta manual "Reparar cache de contrato" que invoca el callable `rebuildContractCache` con un solo ID o batch hasta 50. | `OrdenesService`, `ContratosService`, `CotizacionesService`, `ClientesService`, `PocService`, callable `rebuildContractCache` |
| `financiero.html` | Selector de mes (últimos 12) + 4 KPIs (Facturado, ITBMS recaudado, Pipeline, Ticket promedio) con delta % vs mes anterior + tabla resumen diario + top 10 clientes + botón "Exportar ITBMS (XLSX)" que genera workbook de 3 hojas (Resumen / Detalle / Por cliente) listo para contador. | `CotizacionesService`, `ContratosService`, `CotizacionTotales`, SheetJS |
| `config.html` | Editor de `empresa/config` (ver §5.7). Form con validación inline; modal de confirmación al guardar; rastro de `updated_at` + `updated_by`. Botón "Snapshot JSON" exporta un archivo `cecomunica_empresa_config_YYYY-MM-DD.json` con `{defaults, config, operadores, exported_at, exported_by}` para backup o transferencia entre environments. | `EmpresaService.getConfig` / `setConfig` / `getDoc('operadores')` |
| `alertas.html` | Editor del array `empresa/config.alertas[]`. Tabla inline con tipo (dropdown), umbral, severidad, mensaje opcional y toggle "activa" por fila. "Agregar" / "Eliminar" / "Guardar todo". Botón "Probar contra métricas actuales" carga los KPIs reales y muestra qué reglas dispararían sin guardar. | `EmpresaService`, KPIs services, `AdminMetrics.evaluateAlertas` |
| `backfills.html` | UI runner para migraciones one-shot. Cada tarjeta tiene descripción + botones "Dry-run" + "Ejecutar" que llaman al callable `runBackfill({action, dryRun})`. Resultado inline con contadores (escaneados/skip/escritos/errores). Primer backfill expuesto: `searchTokens` en órdenes. | callable `runBackfill` |
| `kpi-reportes.html` | Archivo mensual del **reporte ejecutivo de KPIs a la junta** (colección `kpi_reports`, un doc por mes): importación del Financial Report xlsx con preview/diff idempotente, captura/edición manual con validación de conciliación, comentarios de gerencia por sección, publicar/despublicar. | `KpiReportsService`, `KpiImport`, `KpiDerived`, SheetJS |
| `kpi-reporte-print.html` | El reporte ejecutivo con el rediseño de junta (`?mes=YYYY-MM`): render desde `kpi_reports`, gráficas SVG vanilla, YTD/comparativos vs año anterior (`KpiDerived`), marca de agua BORRADOR, descarga = imprimir a PDF (letter). CSS autónomo (print template). Botón "Archivar PDF" (+ auto vía `&archivar=1` desde el flujo publicar): arma el HTML standalone (CSS `#report-css` + logo en data URI) y llama al callable `kpiReportSnapshot` que lo congela como PDF en Storage. | `KpiReportsService`, `KpiDerived`, callable `kpiReportSnapshot` |
| `email-preview.html` | Renderiza templates con datos dummy en iframe sandbox — útil para validar cambios al renderer sin enviar correos. Select de template + dropdown de variantes (ej. nota_entrega normal vs noRecibido) + JSON textarea editable con sample pre-cargado + botón "Renderizar" → iframe muestra el HTML. | callable `previewEmail` |

Servicios nuevos vinculados al panel:

| Servicio | Colección | Operaciones |
|---|---|---|
| `mailQueueService.js` | `mail_queue` | `listStuck`, `listFailed`, `countRecent`, `retry`, `retryMany`. Solo lectura excepto `retry*`, que borra `error`/`sent_at` y estampa `retried_at`/`retried_by` para que el trigger (ahora `onDocumentWritten`) re-procese. `MailService` sigue siendo el escritor canónico para nuevos envíos. |
| `auditoriaService.js` | (cross — ordenes + contratos + usuarios_audit) | `getTimelineEvents({ limitPerSource })` lee `os_logs[]`, `fecha_aprobacion`, `fecha_anulacion`, `identificacion_purged_at` y `usuarios_audit` y agrupa en un array unificado descendente. |
| `busquedaGlobalService.js` | (cross — clientes/ordenes/contratos/cotizaciones/poc_devices) | `searchAll(query)` corre 5 búsquedas en paralelo (órdenes vía `searchTokens` indexado; resto vía scan de los 500 más recientes + filtro client-side). Cap 5 hits por colección. Cubre el 95% de búsquedas reales sin destruir quota. |
| `usuariosAdminService.js` | `usuarios` + Auth | Wrapper del callable `manageUser` con métodos `create`/`updateRol`/`deactivate`/`reactivate`/`resetPassword` + `listAll` (read directo). Toda escritura es server-side. |

Helpers de dominio nuevos (`js/domain/adminMetrics.js`): `groupByStatus`, `countWhere`, `daysUntilExpiry`, `bucketByAge`, `ageInDays`, `toDate`, `daysBetween`. Sin DOM, sin Firestore.

#### 4.4.1 Búsqueda global Cmd+K

`public/js/ui/searchPalette.js` monta un palette overlay con input grande, debounce 250 ms, resultados agrupados por colección con iconos, navegación con ↑/↓/Enter y cierre con Esc/click-fuera. API: `SearchPalette.init()` registra el atajo global; `open()`/`close()` para invocación programática.

Hoy está integrado solo en `admin/index.html` (Cmd+K + botón "Buscar"). Para extenderlo a otras páginas basta cargar `busquedaGlobalService.js` + `searchPalette.js` y llamar `SearchPalette.init()` — ~2 líneas por página.

#### 4.4.2 "Ver como otro rol" (impersonation visual)

`public/index.html` acepta el query param `?as=ROL`. Cuando el rol real del usuario es `administrador` y `ROL` está en el mapa `visiblesPorRol`, el efectivo se intercambia: la lista de tarjetas visibles se calcula con `ROL` y el botón "Panel de Administración" se oculta para simular fielmente la vista del rol. Un banner amarillo sticky en la parte superior del body indica el modo activo con link "Salir del modo visual" (regresa a la URL sin el param).

**Importante**: es **solo visibilidad** de tarjetas en el home. No cambia `userRole`, ni queries Firestore, ni reglas — sigue siendo el admin para todos los efectos backend. Útil para QA de cambios al mapa de roles sin tener que crear usuarios de prueba.

UI: `public/js/ui/verComoPicker.js` expone `AdminVerComo.open()` (modal con lista de roles que apuntan a `../index.html?as=<rol>`); invocado desde el launcher "Ver como otro rol" en `admin/index.html`.

Seguridad — defensa en profundidad:

- **Frontend:** cada página llama `verificarAccesoYAplicarVisibilidad` y redirige a `../index.html` con toast si `rol !== ROLES.ADMIN`.
- **Backend:** los datos sensibles ya están protegidos por reglas de Firestore (`usuarios.write: if false`, campos owned por CF en contratos, etc.); el panel no necesita reglas nuevas en v1. Los callables `purgePIIRetention` y `manageUser` validan `rol === 'administrador'` server-side.

> **Bug fix asociado:** `functions/src/triggers/scheduled/purgePIIRetention.js` comparaba con la string literal `"admin"`, pero el rol canónico es `"administrador"` — la función nunca habría aceptado a nadie. Corregido junto con la entrega del panel.

---

## 5. Base de Datos (Firestore)

### 5.1 Colecciones principales

| Colección | Descripción | Servicio |
|---|---|---|
| `usuarios` | Perfiles + roles de usuarios autenticados | `usuariosService` |
| `empresa` | Configuración global (parámetros, operadores, estados) | `empresaService` |
| `clientes` | Clientes registrados | `clientesService` |
| `contratos` | Contratos de servicio | `contratosService` |
| `contratos/{id}/ordenes` | Subcol cache: órdenes vinculadas al contrato | Solo escribe CF |
| `ordenes_de_servicio` | Órdenes de trabajo | `ordenesService` |
| `cotizaciones` | Cotizaciones formales | `cotizacionesService` |
| `inventario` | Semanas de inventario de modelos | `inventarioService` |
| `modelos` | Catálogo de modelos de radio | `modelosService` |
| `piezas` | Inventario de piezas/repuestos | `piezasService` |
| `poc_devices` | Equipos PoC (radios, SIM, IP, grupos) | `pocService` |
| `poc_logs` | Historial de cambios por equipo PoC | `pocService` |
| `mail_queue` | Cola de emails salientes | `mailService` (escritura) + `mailQueueService` (lectura/retry desde admin) |
| `verificaciones` | Registros de verificación pública de contratos | Solo escribe CF |
| `kpi_reports` | Reporte ejecutivo de KPIs a la junta — un doc por mes (`YYYY-MM`) con métricas del Financial Report + comentarios de gerencia; **read/write solo admin** | `kpiReportsService` |
| `usuarios_audit` | Audit trail de operaciones del portal de usuarios (CREATE / UPDATE_ROL / DEACTIVATE / REACTIVATE / RESET_PASSWORD) — un doc por mutación, lo escribe el callable `manageUser` | Solo escribe CF; `auditoriaService` lo lee para el timeline del panel admin |

### 5.2 Campos críticos — no renombrar

- `usuarios/{uid}.rol` — leído por todas las páginas
- `contratos/{id}.firma_hash`, `.firma_codigo`, `.firma_url` — calculados por CF; vinculados a PDFs ya emitidos
- `contratos/{id}.contrato_id` (`CT-YYYY-NNN`) — identificador de usuario
- `ordenes_de_servicio/{id}.numero_orden` — identificador de usuario
- `mail_queue/{id}` — schema aditivo; el CF lector no acepta campos eliminados

### 5.3 Campos de caché en contratos

Los campos `os_count`, `equipos_total`, `os_linked`, `os_serials_preview`, `os_has_equipos`, `tiene_os`, `os_last_orden_id`, `os_equipos_count_last` son escritos **exclusivamente por Cloud Functions** (ver §6.2). Las reglas de Firestore bloquean escrituras del frontend a estos campos.

### 5.4 Audit log de órdenes — `os_logs`

`ordenes_de_servicio/{id}.os_logs` es un array de auditoría escrito con `firebase.firestore.FieldValue.arrayUnion({ action, by })` cada vez que la orden cambia de estado.

- **Quién escribe:** el frontend. `OrdenesService.assignTechnician`, `completeOrder` y la entrega (`ordenes-flujo.js` + `ui/firmaTablet.js`) anexan entradas para `ASIGNAR`, `COMPLETAR` y `ENTREGAR` respectivamente.
- **Quién lee:** la línea de tiempo en la fila expandida (audit-log timeline shipped en `CHANGELOG.md` batch 16). El timestamp se toma de los campos `fecha_*` dedicados ya que `arrayUnion` no admite `serverTimestamp()`; el `by` del array da el `uid` del autor.
- **Forma:** `{ action: 'ENTREGAR' | 'ASIGNAR' | 'COMPLETAR' | …, by: <uid> }` — sin `ts` porque Firestore no permite `serverTimestamp()` dentro de `arrayUnion`. Si se requiere timestamp por entrada, migrar a una subcolección `ordenes_de_servicio/{id}/os_audit/{autoId}`.
- **Límite:** Firestore tiene un cap de 1 MiB por documento. A ~50 bytes por entrada el techo práctico es ~20 000 acciones por orden — suficiente para el ciclo de vida típico pero a vigilar si en el futuro cada modificación de equipos se loguea aquí.

### 5.5 Storage — paths y reglas

Las reglas viven en `storage.rules` (en raíz, deployadas via `firebase deploy --only storage`). Todas las rutas requieren sesión autenticada; no hay reads públicos. Los Cloud Functions usan admin SDK y bypasean estas reglas — son el único camino para purgas server-side de PII.

| Path | Contenido | Content-type | Tamaño máx | Delete frontend |
|---|---|---|---:|:---:|
| `ordenes_firmas/{file}` | Firma del receptor (entrega) | `image/png` | 1 MiB | No |
| `ordenes_identificacion/{file}` | Foto ID del receptor (entrega — ruta nueva) | `image/*` | 6 MiB | No |
| `entregas_identificacion/{file}` | Foto ID del receptor (entrega — ruta legacy de `firmar-entrega.html`) | `image/*` | 6 MiB | No |
| `ordenes/{ordenId}/{equipoId}/{file}` | Adjuntos por equipo (legacy — los subía trabajar-orden, eliminada; cotizar-orden-formal los lee) | `image/*` o `application/pdf` | 10 MiB | Sí |
| `ordenes_taller_fotos/{ordenId}/{file}` | Fotos de equipo en taller | `image/*` | 8 MiB | Sí |
| `contratos_firmados/{file}` | PDFs de contratos firmados | `application/pdf` | 10 MiB | No |

Rutas PII (`ordenes_firmas`, `ordenes_identificacion`, `entregas_identificacion`) deshabilitan delete y update desde el frontend. La política de retención corre server-side:

| Path | Retención | Purga |
|---|---|---|
| `ordenes_firmas/` | Indefinida | No se purga — evidencia legal de entrega |
| `ordenes_identificacion/` | **90 días** desde upload | `purgePIIRetention` CF — invocación **manual** (ver §6.3) |
| `entregas_identificacion/` (legacy) | **90 días** desde upload | `purgePIIRetention` CF — invocación **manual** (ver §6.3) |

Al purgar una foto de ID, el CF también limpia `identificacion_url: null` en el doc de la orden y estampa `identificacion_purged_at: serverTimestamp()` + `identificacion_purged_by: <uid>` + `identificacion_retention_days: 90` para que el audit trail registre la purga.

**Modo de invocación (2026-05-18):** la purga corre **bajo demanda**, no en cron. Un admin la dispara explícitamente vía `firebase.functions().httpsCallable('purgePIIRetention')({ dryRun: true })` para previsualizar, luego `{ dryRun: false }` para ejecutar. `dryRun` devuelve `candidates` + `sample[]` sin borrar nada. Sólo callers con `usuarios/{uid}.rol === 'admin'` pasan la verificación; cualquier otro caller recibe `permission-denied`.

### 5.6 Búsqueda indexada de órdenes — `searchTokens`

`ordenes_de_servicio/{id}.searchTokens` es un array de strings normalizados que habilita búsquedas via `where('searchTokens', 'array-contains-any', [...])` en lugar de un scan completo de la colección. Resuelve el problema de costo del scan client-side (ver `CHANGELOG.md` Tier 1 P0 §1.1).

- **Quién escribe:** el Cloud Function `onOrdenWriteSearchTokens` (idempotente — compara tokens computados vs almacenados antes de escribir, evitando loop recursivo). Existing orders se siembran una sola vez via `functions/backfill-search-tokens.js`.
- **Lógica de tokens:** ver `functions/src/lib/searchTokens.js` — orden ID + sus partes, palabras del cliente (≥2 chars), palabras del técnico (≥2 chars), palabras del tipo de servicio (≥3 chars), y serials de cada equipo más sus sufijos de 4–8 caracteres (para soportar "últimos 4 dígitos" típicos de techs). Cap de 200 tokens por documento.
- **Quién lee:** `OrdenesService.searchOrders` en el frontend. Query indexada primero; si falla por índice ausente, o devuelve cero resultados (caso de transición pre-backfill), cae al scan completo como fallback.
- **Normalización idéntica entre server y cliente:** lowercase → NFD → strip diacritics → no-alfanuméricos a espacios → trim. Cualquier divergencia entre la lib en `functions/` y el normalizador embebido en `ordenesService.js` produce falsos negativos — son dos implementaciones del mismo algoritmo, mantener sincronizadas.

### 5.7 Configuración admin-tuneable — `empresa/config`

Documento único que centraliza parámetros que cambian con decisiones de negocio o regulación y que no justifican un redeploy. Editor en `admin/config.html` (ver §4.4).

| Key | Tipo | Default | Consumidor |
|---|---|---|---|
| `itbms_rate` | number | `0.07` | `FMT.ITBMS_RATE` — reasignado en boot por `firebase-init.js` |
| `cotizacion_validez_dias` | int | `15` | Editor de cotizaciones nuevas (campo `validezDias` inicial) |
| `pii_retention_dias` | int | `90` | Default del input en `admin/pii.html` (callable acepta `retentionDays` por parámetro) |
| `pii_purge_enabled` | bool | `true` | Kill-switch global de la purga PII. **Server-side**: `purgePIIRetention` lee `empresa/config.pii_purge_enabled` antes de cualquier delete y rechaza con `failed-precondition` si está en `false`. Preview (`dryRun: true`) siempre se permite. Editable desde el toggle de `admin/pii.html` (UI directa) o el checkbox de `admin/config.html`. |
| `alertas` | array | `[]` | Reglas de alerta configurables. Cada item: `{id, kind, threshold, severity: 'info'\|'warning'\|'error', message?, enabled}`. `kind` es uno de los registrados en `AdminMetrics.ALERT_KINDS` (`ordenes_abiertas_gt`, `cotizaciones_vencen_gt`, etc.). El evaluador puro `evaluateAlertas(alertas, metrics)` corre en `admin/index.html` tras cargar los KPIs y renderiza un banner por cada regla disparada. Editable desde `admin/alertas.html` con tabla inline + botón "Probar contra métricas actuales". |
| `stock_minimo_default` | int | `5` | Placeholder al crear pieza nueva |
| `orden_stale_dias` | int | `10` | Umbral inferior del alert "estancada" en `admin/operacion.html` (sin movimiento ≥ N días) |
| `orden_stale_max_dias` | int | `30` | Tope superior del alert "estancada". Órdenes sin movimiento más allá se consideran legacy (olvidadas hace meses, no accionables) y se omiten para no enmascarar las recientes. La limpieza histórica es trabajo aparte. |
| `orden_sin_asignar_max_dias` | int | `30` | Tope superior del alert "sin técnico asignado" en `admin/operacion.html`. Órdenes con más antigüedad se consideran legacy noise (probablemente nunca se trabajaron — asignarlas hoy contamina métricas) y se omiten del alert para no enmascarar las accionables nuevas. La limpieza histórica es trabajo aparte. |
| `mail_cc_orden_completada` | string[] | `[]` | Pendiente de leer en `onOrdenCompletada` CF |
| `mail_cc_contrato_aprobado` | string[] | `[]` | Pendiente de leer en `onContratoActivadoSendPdf` CF |

**Mecánica:**

- `EmpresaService.CONFIG_DEFAULTS` (frozen object) — única fuente de defaults compartida entre el editor, el seeder y el fallback de `getConfig()`.
- `EmpresaService.getConfig()` — merge sobre defaults; **nunca lanza**: si Firestore falla o el doc no existe, devuelve los defaults puros. Garantiza que la app sobrevive un Firestore caído / ITP de Safari / doc borrado.
- `EmpresaService.setConfig(patch)` — patch-merge + estampa `updated_at` + `updated_by` (uid).
- `firebase-init.js → _applyEmpresaConfig()` — corre dentro de `verificarAccesoYAplicarVisibilidad`, antes del callback de la página. Aplica `cfg.itbms_rate → FMT.ITBMS_RATE` y deja `window.EMPRESA_CONFIG` disponible para consumidores ad-hoc. Feature-detected: páginas que no cargan `EmpresaService` simplemente no aplican overrides.

**Regla crítica:** todo consumidor mantiene **su propio default literal** en el código. La config es una capa de override, no una dependencia bloqueante. Ej: `admin-operacion.js` define `STALE_DAYS_DEFAULT = 10` y la función `staleDays()` lee `window.EMPRESA_CONFIG?.orden_stale_dias || STALE_DAYS_DEFAULT`.

**Seguridad:** ninguna regla nueva en Firestore en v1 — `empresa/{docId}` ya es read/write autenticado. Endurecimiento a admin-only pendiente cuando la lectura de la config esté generalizada (hoy el override se aplica una sola vez por sesión, en el contexto del admin que abrió el panel).

**Seed inicial:** `public/tools/seed-empresa-config.html` (excluido del deploy via `firebase.json → hosting.ignore: tools/**`) inicializa el doc con los defaults. Idempotente — si el doc ya existe, no escribe; botón "FORZADO" reescribe explícitamente.

---

## 6. Backend — Cloud Functions

### 6.1 Estructura modular

`functions/index.js` es un punto de entrada de 16 líneas que sólo re-exporta. La lógica vive en `functions/src/`:

```
functions/
  index.js                                  ← re-exports
  src/
    http/
      sendMail.js                           ← HTTP endpoint (sin callers frontend)
      sendContractPdf.js                    ← HTTP endpoint protegido por x-api-key
    callable/
      manageUser.js                         ← manageUser (admin-only, 5 acciones)
    triggers/
      contratos/
        onApproval.js                       ← onContratoActivado, onContratoActivadoSendPdf
        onAnnulment.js                      ← onContratoAnuladoNotify
      cotizaciones/
        onOpened.js                         ← onCotizacionOpened
      ordenes/
        onComplete.js                       ← onOrdenCompletada
        onWriteCacheSync.js                 ← onContratoOrdenWrite, onOrdenWriteSyncContratoCache, onOrdenHardDelete
        onWriteSearchTokens.js              ← onOrdenWriteSearchTokens
      mail/
        onMailQueued.js                     ← onMailQueued (onDocumentWritten — soporta retry)
      scheduled/
        purgePIIRetention.js                ← purgePIIRetention (callable manual, no cron)
        markCotizacionesVencidas.js         ← markCotizacionesVencidas (cron)
    domain/
      contractCache.js                      ← rebuildContractCache (idempotente)
      pdfRenderer.js                        ← renderizado de contratos con Puppeteer
      emailRenderer.js                      ← templates de body para mail_queue
    lib/
      admin.js                              ← admin.initializeApp() compartido
      mail.js                               ← cliente SendGrid configurado
      searchTokens.js                       ← buildOrderSearchTokens (puro)
```

### 6.2 Funciones HTTP

| Función | Ruta | Estado | Secretos requeridos |
|---|---|---|---|
| `sendMail` | `/api/sendMail` | Sin callers frontend activos (canal histórico) | `SENDGRID_API_KEY` |
| `sendContractPdf` | protegida con `x-api-key` | Sin callers frontend activos | `FIRMA_SECRET`, `SENDGRID_API_KEY` |

El canal de email activo desde el frontend es la colección `mail_queue` (ver §6.4).

### 6.3 Triggers de Firestore

| Función | Trigger | Responsabilidad | Secretos |
|---|---|---|---|
| `onContratoActivado` | `onDocumentUpdated("contratos/{id}")` | Cuando `estado` pasa a `aprobado` o `activo`: genera `firma_codigo`, `firma_hash`, `firma_url`; sincroniza `verificaciones/{id}` | `FIRMA_SECRET` |
| `onContratoActivadoSendPdf` | `onDocumentUpdated("contratos/{id}")` | Mismo evento: genera PDF con Puppeteer y lo envía por email | `FIRMA_SECRET`, `SENDGRID_API_KEY` |
| `onContratoAnuladoNotify` | `onDocumentUpdated("contratos/{id}")` | Cuando `estado` pasa a `anulado`: encola notificación en `mail_queue` | `SENDGRID_API_KEY` |
| `onContratoOrdenWrite` | `onDocumentWritten("contratos/{id}/ordenes/{oId}")` | Aplica deltas a `os_count` y `equipos_total` cuando cambia la subcol caché | — |
| `onOrdenWriteSyncContratoCache` | `onDocumentWritten("ordenes_de_servicio/{id}")` | Sincroniza `os_linked`, `os_serials_preview`, `os_has_equipos`, `os_last_orden_id` en el contrato vinculado | — |
| `onOrdenCompletada` | `onDocumentUpdated("ordenes_de_servicio/{id}")` | Cuando orden se completa: actualiza estadísticas de técnico; encola email de cierre | — |
| `onOrdenHardDelete` | `onDocumentDeleted("ordenes_de_servicio/{id}")` | Hard-delete: elimina subcol caché y recalcula totales del contrato vinculado | — |
| `onOrdenWriteSearchTokens` | `onDocumentWritten("ordenes_de_servicio/{id}")` | Mantiene el array `searchTokens` con tokens normalizados de orden ID, cliente, técnico, tipo de servicio y serials de equipos. Idempotente (compara tokens computados vs almacenados antes de escribir). Habilita la búsqueda indexada en `OrdenesService.searchOrders` — ver §5.6 | — |
| `onMailQueued` | `onDocumentWritten("mail_queue/{id}")` | Lee el documento y envía el email vía SendGrid. **Idempotente para retry**: condición de proceso es `after.sent_at == null && after.error == null`, lo que cubre tanto la creación inicial como el caso de retry (admin borra `error` + `sent_at` desde `admin/salud.html` via `MailQueueService.retry`). Las propias escrituras terminales (set `sent_at` ó `error`) hacen skip al re-trigger, evitando loops. | `SENDGRID_API_KEY` |
| `onCotizacionOpened` | `onDocumentUpdated("cotizaciones/{id}")` | Marca trazabilidad cuando la cotización pasa a estado `enviada` o se abre desde link público | — |
| `purgePIIRetention` | `onCall` (callable HTTPS, admin-only) | Borra fotos de ID en `ordenes_identificacion/` y `entregas_identificacion/` con > 90 días desde upload (parametrizable vía `retentionDays`). Soporta `dryRun: true` para previsualizar. Limpia `identificacion_url`, estampa `identificacion_purged_at` + `identificacion_purged_by` en el doc de la orden — ver §5.5 | — |
| `markCotizacionesVencidas` | `onSchedule` (cron diario) | Marca cotizaciones cuya `fecha + validezDias < hoy` como estado `vencida` | — |
| `manageUser` | `onCall` (callable HTTPS, admin-only) | Acción única con discriminador `action ∈ {create, updateRol, deactivate, reactivate, resetPassword}`. Llama Admin SDK de Auth (`createUser`, `updateUser{disabled}`, `generatePasswordResetLink`) y escribe `usuarios/{uid}`. Safety guards: rechaza auto-desactivación, auto-democión y operaciones que dejarían el sistema sin admins activos (cuenta antes de cada cambio). Cada mutación exitosa escribe un doc en `usuarios_audit` con `{actor_uid, target_uid, action, before, after, meta, ts}`. | — |
| `rebuildContractCache` | `onCall` (callable HTTPS, admin-only) | Recalcula manualmente los campos cache del contrato (`os_count`, `os_linked`, `os_serials_preview`, `os_has_equipos`, `os_equipos_count_last`, `tiene_os`) desde la subcolección actual. Acepta `{contratoId}` o `{contratoIds: [...]}` (batch hasta 50). Delegado a `domain/contractCache.recalcularCacheContrato` — la misma lógica que usa el trigger `onContratoOrdenWrite`. Expuesto desde `admin/integridad.html` como herramienta manual cuando el cache se desincroniza. | — |
| `runBackfill` | `onCall` (callable HTTPS, admin-only) | Dispatcher único de migraciones one-shot que antes eran scripts CLI en `functions/backfill-*.js`. Action discriminator: `{ action: 'searchTokens', dryRun? }`. Idempotente (compara estado actual vs deseado antes de escribir). Batches a 400 ops. Expuesto desde `admin/backfills.html` con preview (dry-run) y ejecución real. Diseñado para añadir más acciones según se necesiten futuros backfills. | — |
| `previewEmail` | `onCall` (callable HTTPS, admin-only) | Renderiza un template de email con datos dummy y devuelve el HTML — **no envía**. Usa el mismo `emailRenderer` server-side que `onMailQueued`, así que el output es idéntico al que recibirían los clientes. Templates expuestos: `nota_entrega` (via renderByTemplate) y `orden_completada` (via buildBodyOrdenCompletada + email-base wrapper). Para añadir uno nuevo: registrarlo en el HELPERS map del callable. Renderizado en iframe sandboxed en `admin/email-preview.html`. | — |

Total: **2 endpoints HTTP + 5 callables + 11 triggers Firestore (10 Firestore + 1 schedule) = 18 funciones** exportadas desde `functions/index.js`.

### 6.4 Pipeline de email

El único canal activo desde el frontend:

```
página → mailService.enqueue(payload) → mail_queue/{docId} → onMailQueued → SendGrid
```

`MailService.enqueue()` estampa `createdAt: serverTimestamp()` automáticamente. Los triggers del backend (`onContratoActivadoSendPdf`, `onOrdenCompletada`, `onContratoAnuladoNotify`) también escriben directamente en `mail_queue`.

**Retry de envíos fallidos:** `MailQueueService.retry(docId)` desde `admin/salud.html` borra `error` + `sent_at` + `status` y estampa `retried_at` + `retried_by`. Ese update vuelve a disparar `onMailQueued` (cuyo trigger es `onDocumentWritten` justamente para soportar este flujo) y el envío se re-intenta. Las propias escrituras terminales del CF (set `sent_at` o `error`) hacen skip al re-trigger, así que no hay loop. Hay también un bulk "Reintentar todos" que itera sobre los fallidos.

**Envíos directos sin `mail_queue` — visibilidad de fallos:** algunos CFs (notablemente `onContratoActivadoSendPdf`) llaman `sendEmail()` directo en vez de encolar — necesario porque el payload incluye un PDF de varios MB que no cabe cómodo en un doc de Firestore. Cuando esto falla, el helper `recordSendFailure(meta, err)` en `lib/mail.js` escribe un doc a `mail_queue` con `{status: 'error', failed_direct_send: true, source, to, cc, subject, error}` para que el fallo aparezca en `admin/salud`. Estos docs **no son retryables** desde la UI (no tienen el payload original) — la página muestra `—` en vez del botón Reintentar y el bulk los excluye. El admin que ve un direct-send fallido debe re-disparar la operación original (re-activar el contrato, etc.) o enviar el correo manualmente.

**Render precedence en `onMailQueued`** (de mayor a menor prioridad):

1. `data.template` (recomendado) → `emailRenderer.renderByTemplate(data)` despacha al builder server-side y envuelve con `email-base.html`. Single source of truth para branding e i18n. Templates registrados: `nota_entrega` (entrega de orden, dos ramas: normal con receptor/firma/foto-ID o `noRecibido` con motivo/persona-interna). Payload: `{ template: 'nota_entrega', data: { ordenId, orden, opts } }` donde `orden` es el snapshot mínimo necesario (cliente, técnico, tipo, equipos filtrados) y `opts` describe la rama.
2. `data.html` → caller-supplied (legacy callers como `onOrdenCompletada` que pre-renderiza).
3. `data.bodyContent` + `data.preheader` → fragmento de body envuelto por `buildEmailFromBase`.

Para añadir un nuevo template: añadir un `buildBody<Nombre>` en `functions/src/domain/emailRenderer.js` y registrarlo en el switch de `renderByTemplate`. El frontend enqueña `{ template: '<nombre>', data: {...} }`. Toda interpolación user-controlled DEBE pasar por `escapeHtml`.

---

## 7. Ciclo de vida de un Contrato

### 7.1 Máquina de estados

```
pendiente_aprobacion  →  aprobado  →  activo
                                 ↘
                              anulado  (desde cualquier estado)
```

- `pendiente_aprobacion`: creado por el frontend (`ContratosService.addContrato`)
- `aprobado`: admin hace clic en "Aprobar" en `contratos/index.html`; dispara `onContratoActivado` + `onContratoActivadoSendPdf`
- `activo`: usuario sube PDF firmado a Storage; `onContratoActivado` vuelve a disparar (idempotente)
- `anulado`: admin anula; dispara `onContratoAnuladoNotify`

### 7.2 Campos de firma (solo escribe CF)

| Campo | Contenido |
|---|---|
| `firma_codigo` | Código corto legible para el cliente |
| `firma_hash` | HMAC-SHA256 de `"${contratoId}\|${aprobadorUid}"` con `FIRMA_SECRET` |
| `firma_url` | URL pública de verificación (`/c/{docId}?v={code}`) |

### 7.3 Verificación pública

`/c/{docId}?v={code}` redirige (rewrite en `firebase.json`) a `verify/index.html`, que lee `verificaciones/{docId}` con acceso anónimo (`allow read: if true`).

---

## 8. Ciclo de vida de una Orden ↔ Contrato

Una orden puede vincularse a un contrato. Cuando esto ocurre, el contrato mantiene campos de caché (`os_count`, `equipos_total`, etc.) actualizados por Cloud Functions.

Paths de escritura de caché activos (consolidación planificada en fases futuras):

1. `onOrdenWriteSyncContratoCache` — actualiza `os_linked`, `os_serials_preview`, `os_has_equipos`
2. `onContratoOrdenWrite` — aplica deltas a `os_count` y `equipos_total` cuando cambia la subcol `contratos/{id}/ordenes`
3. `onOrdenHardDelete` — dispara recompute completo al eliminar una orden

---

## 9. Despliegue

```bash
firebase deploy                          # todo
firebase deploy --only hosting           # solo frontend
firebase deploy --only functions         # solo CF
firebase deploy --only firestore:rules   # solo reglas
firebase deploy --only firestore:indexes # solo índices
```

`firebase.json` configura:
- Hosting: `public/` como raíz; ignora `tools/**`, `*.md`, etc.
- Rewrite `/c/**` → `verify/index.html`
- Reglas: `firestore.rules` (versionado en el repo)
- Índices: `firestore.indexes.json` (versionado en el repo)

---

## 10. Restricciones críticas

Estos elementos **no deben modificarse** sin una migración cuidadosa:

1. **Schema de `verificaciones/{docId}`** — URLs ya emitidas en PDFs impresos; el schema es un contrato de compatibilidad
2. **Formato del payload de `firma_hash`** (`"${contratoId}|${aprobadorUid}"`) — cambiar invalida todas las firmas existentes
3. **`contrato_id` (`CT-YYYY-NNN`) y `numero_orden`** — identificadores de usuario visibles en emails y PDFs
4. **`usuarios/{uid}.rol`** — leído por todas las páginas; agregar valores nuevos requiere actualizar todos los consumidores
5. **Schema de `mail_queue`** — un lector (CF), múltiples escritores; cambios deben ser aditivos
6. **Nombres de Cloud Functions** — renombrar implica gap de trigger durante el deploy; coordinar en ventana de bajo tráfico
7. **Template PDF** (`functions/templates/imprimir-contrato.html`) — documento legal entregado a clientes

---

## 11. Gestión de secretos

Los secretos viven **exclusivamente en Google Secret Manager**, no en el repositorio.

| Secreto | Uso | Funciones que lo declaran |
|---|---|---|
| `FIRMA_SECRET` | Clave HMAC-SHA256 para firmar URLs de verificación de contrato | `onContratoActivado`, `onContratoActivadoSendPdf`, `sendContractPdf` |
| `SENDGRID_API_KEY` | Autenticación SendGrid para envío de emails | `onMailQueued`, `onContratoActivadoSendPdf`, `onContratoAnuladoNotify`, `sendMail`, `sendContractPdf` |

**Patrón en código:**

```js
// functions/src/triggers/contratos/onApproval.js
const HMAC_SECRET = process.env.FIRMA_SECRET || "MISSING_SECRET";

exports.onContratoActivado = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    secrets: ["FIRMA_SECRET"]   // ← inyectado en runtime por el SDK de CFs
  },
  async (event) => { /* … */ }
);
```

La cadena de fallback `"MISSING_SECRET"` está diseñada para fallar de forma ruidosa: si Secret Manager no inyecta el valor, el HMAC resultante no validará contra ninguna URL legítima en lugar de generar una firma con clave conocida.

**Rotación:** actualizar la versión del secreto en Secret Manager y volver a desplegar las funciones (`firebase deploy --only functions`). Las versiones anteriores siguen activas mientras las nuevas se aprovisionan, por lo que no hay ventana de fallo.

**Auditoría:** no hay archivos `.env`, `*.txt` con secretos, ni valores hardcodeados en el repositorio. `.gitignore` cubre logs y caches; no necesita reglas específicas de secretos porque ninguno es local.

---

## 12. Reglas de Firestore

Versionadas en `firestore.rules`. Resumen:

- **Base:** `allow read, write: if request.auth != null` — lectura/escritura autenticada por defecto
- **`usuarios/{uid}`:** `read` autenticado, `write: if false` (sólo Admin SDK puede modificar roles)
- **`contratos/{id}`:**
  - `update` autenticado, **excepto** si toca campos propiedad de CF (`firma_*`, `os_*`, `tiene_os`, `fecha_aprobacion`) → bloqueado para frontend vía helper `touchesCFOwnedFields()`
  - transición a `estado == "activo"` restringida a roles `administrador` / `gerente`
  - `delete` restringido a `administrador` / `gerente`
- **`contratos/{id}/ordenes/{ordenId}`:** subcol de caché; `read` autenticado, `write: if false` (sólo CF vía Admin SDK)
- **`verificaciones/{docId}`:** `read: if true` (verificación pública sin auth), `write: if false`

El Admin SDK usado por las Cloud Functions bypasea estas reglas, por eso `write: if false` no impide las escrituras del backend.
