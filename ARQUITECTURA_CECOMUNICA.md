# Arquitectura del Sistema Cecomunica

> **Nota:** Este documento describe el estado actual del sistema (post-refactor Phases 0–5, mayo 2026).
> Para el plan de refactoring en curso ver `REFACTOR_STRATEGY.md`.
> Para el historial de cambios ver `CHANGELOG.md`.

---

## 1. Descripción General

**Cecomunica Service Orders** es una plataforma web para gestión de servicios de comunicación por radio. Administra órdenes de servicio, inventario, contratos, equipos PoC (Push-to-Talk over Cellular), clientes y cotizaciones.

---

## 2. Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5 + CSS3 + JavaScript Vanilla (sin build step) |
| SDK cliente | Firebase SDK 10.10.0 (compat mode, desde `gstatic.com`) |
| Hosting | Firebase Hosting (archivos estáticos desde `public/`) |
| Base de datos | Cloud Firestore (modo compat) |
| Almacenamiento | Firebase Storage |
| Backend | Firebase Cloud Functions (Node.js 22) |
| PDF | Puppeteer Core 24.17.0 |
| Email | Nodemailer + SendGrid |
| Excel | SheetJS 0.18.5 |

---

## 3. Arquitectura del Frontend

### 3.1 Topología real

No es un SPA en sentido estricto. Cada `.html` es una página autónoma que carga sus propias dependencias. No hay bundler ni compilación.

```
public/
  index.html                   ← dashboard principal
  login.html
  perfil.html
  contratos/
    index.html, nuevo-contrato.html, editar-contrato.html,
    imprimir-contrato.html, nuevo-cliente.html
  ordenes/
    index.html, nueva-orden.html, editar-orden.html,
    trabajar-orden.html, agregar-equipo.html,
    firmar-entrega.html, imprimir-orden.html,
    cotizar-orden.html, cotizar-orden-formal.html,
    estado_reparacion.html, tecnicos.html, modelo-de-radio.html,
    progreso-tecnicos.html, reporte-pendientes.html,
    importar-exportar.html, admin-equipos-cliente.html,
    fotos-taller.html
  clientes/
    index.html, editar.html
  inventario/
    index.html, modelos.html, piezas.html,
    cargar-inventario.html, vista-correo.html
  POC/
    index.html, nuevo-equipo.html, nuevo-batch.html,
    editar-batch.html, imprimir-equipos.html,
    importar-poc.html, vendedores-batch.html
  cotizaciones/
    index.html, nueva-cotizacion.html, editar-cotizacion.html,
    imprimir-cotizacion.html
  verify/
    index.html                 ← verificación pública de contratos
  js/
    firebase-init.js           ← único init de Firebase
    core/                      ← módulos compartidos
    services/                  ← capa de servicios (Firestore)
    pages/                     ← scripts extraídos de páginas grandes
  css/
    ceco-ui.css                ← design system compartido
```

### 3.2 Orden de carga de scripts (por página)

Cada página carga scripts en este orden en el `<head>`:

1. Firebase SDK compat (app, auth, firestore, storage)
2. `js/firebase-init.js` — `app`, `db`, `auth` globales + `verificarAccesoYAplicarVisibilidad()`
3. `js/core/roles.js` — enum `ROLES`
4. `js/core/formatting.js` — `FMT` (ITBMS, money, dates)
5. `js/core/auth.js` — `AUTH` (role helpers)
6. `js/services/<nombre>.js` — uno o más, según lo que use la página
7. `js/pages/<nombre>.js` (con `defer`) — lógica de la página (páginas grandes)
   — o un `<script>` inline (páginas pequeñas aún no migradas)

### 3.3 Módulos core (`js/core/`)

| Archivo | Global expuesto | Contenido |
|---|---|---|
| `roles.js` | `window.ROLES` | Enum canónico de todos los roles del sistema |
| `formatting.js` | `window.FMT` | `ITBMS_RATE`, `money()`, `round2()`, `date()`, `datetime()`, `calcITBMS()` |
| `auth.js` | `window.AUTH` | `is()`, `isAny()`, `getRole()`, `getUser()`, `requireAccess()` |

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

### 3.5 Excepciones documentadas: llamadas inline a Firestore

Las siguientes llamadas a `db.collection()` fuera de los servicios están intencionalmente fuera de la capa de servicios por complejidad o por ser patrones heredados en proceso de migración:

| Archivo | Motivo |
|---|---|
| `js/pages/nuevo-contrato.js` | Fallback `startAt/endAt` para búsqueda de clientes (patrón legacy) |
| `js/pages/contratos-index.js` | 4 llamadas a `usuarios` (cargarUsuarios, auth, aprobarContrato) |
| `js/pages/poc-index.js` | 4 llamadas: fallback operadores + queries compuestas con `!=` |
| `js/pages/trabajar-orden.js` | 8 llamadas: `onSnapshot`, subcol `equipos_meta`, transacciones de stock, query paginada con `!=` |
| `js/pages/vendedores-batch.js` | 8 llamadas: queries cache-first con índices compuestos |
| `js/pages/piezas.js` | 1 llamada: loop de import masivo con batch API crudo |
| `contratos/nuevo-cliente.html` | 3 llamadas: queries de unicidad (duplicate-check WHERE) |
| `ordenes/nueva-orden.html` | 2 llamadas: numeración de orden + duplicate-check WHERE |
| `clientes/index.html` | 7 llamadas: query builders que retornan objetos Firestore crudos |

### 3.6 Scripts de página (`js/pages/`)

Páginas grandes con script extraído a archivo externo (cargado con `defer`):

| Archivo JS | HTML de origen | Líneas aprox. |
|---|---|---|
| `contratos-index.js` | `contratos/index.html` | 1 690 |
| `nuevo-contrato.js` | `contratos/nuevo-contrato.html` | 1 161 |
| `poc-index.js` | `POC/index.html` | 1 600 |
| `trabajar-orden.js` | `ordenes/trabajar-orden.html` | 1 174 |
| `vendedores-batch.js` | `POC/vendedores-batch.html` | 890 |
| `piezas.js` | `inventario/piezas.html` | 751 |

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
| `mail_queue` | Cola de emails salientes | `mailService` |
| `verificaciones` | Registros de verificación pública de contratos | Solo escribe CF |

### 5.2 Campos críticos — no renombrar

- `usuarios/{uid}.rol` — leído por todas las páginas
- `contratos/{id}.firma_hash`, `.firma_codigo`, `.firma_url` — calculados por CF; vinculados a PDFs ya emitidos
- `contratos/{id}.contrato_id` (`CT-YYYY-NNN`) — identificador de usuario
- `ordenes_de_servicio/{id}.numero_orden` — identificador de usuario
- `mail_queue/{id}` — schema aditivo; el CF lector no acepta campos eliminados

### 5.3 Campos de caché en contratos

Los campos `os_count`, `equipos_total`, `os_linked`, `os_serials_preview`, `os_has_equipos`, `tiene_os`, `os_last_orden_id`, `os_equipos_count_last` son escritos **exclusivamente por Cloud Functions** (ver §6.2). Las reglas de Firestore bloquean escrituras del frontend a estos campos.

---

## 6. Backend — Cloud Functions

### 6.1 Funciones HTTP (sin callers frontend)

| Función | Ruta | Estado |
|---|---|---|
| `sendMail` | `/api/sendMail` | Sin callers frontend activos |
| `sendContractPdf` | protegida con `x-api-key` | Sin callers frontend activos |

El canal de email activo es la colección `mail_queue` (ver §6.3).

### 6.2 Triggers de Firestore

| Función | Trigger | Responsabilidad |
|---|---|---|
| `onContratoActivado` | `onDocumentUpdated("contratos/{id}")` | Cuando `estado` pasa a `aprobado` o `activo`: genera `firma_codigo`, `firma_hash`, `firma_url`; sincroniza `verificaciones/{id}` |
| `onContratoActivadoSendPdf` | `onDocumentUpdated("contratos/{id}")` | Mismo evento: genera PDF con Puppeteer y lo envía por email |
| `onContratoAnuladoNotify` | `onDocumentUpdated("contratos/{id}")` | Cuando `estado` pasa a `anulado`: encola notificación en `mail_queue` |
| `onContratoOrdenWrite` | `onDocumentWritten("contratos/{id}/ordenes/{oId}")` | Aplica deltas a `os_count` y `equipos_total` cuando cambia la subcol caché |
| `onOrdenWriteSyncContratoCache` | `onDocumentWritten("ordenes_de_servicio/{id}")` | Sincroniza `os_linked`, `os_serials_preview`, `os_has_equipos`, `os_last_orden_id` en el contrato vinculado |
| `onOrdenCompletada` | `onDocumentUpdated("ordenes_de_servicio/{id}")` | Cuando orden se completa: actualiza estadísticas de técnico; encola email de cierre |
| `onOrdenHardDelete` | `onDocumentDeleted("ordenes_de_servicio/{id}")` | Hard-delete: elimina subcol caché y recalcula totales del contrato vinculado |
| `onMailQueued` | `onDocumentCreated("mail_queue/{id}")` | Lee el documento encolado y envía el email vía SendGrid |

### 6.3 Pipeline de email

El único canal activo desde el frontend:

```
página → mailService.enqueue(payload) → mail_queue/{docId} → onMailQueued → SendGrid
```

`MailService.enqueue()` estampa `createdAt: serverTimestamp()` automáticamente. Los triggers del backend (`onContratoActivadoSendPdf`, `onOrdenCompletada`, `onContratoAnuladoNotify`) también escriben directamente en `mail_queue`.

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
