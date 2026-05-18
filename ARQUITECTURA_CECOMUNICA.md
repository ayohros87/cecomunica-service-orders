# Arquitectura del Sistema Cecomunica

> **Estado:** post-refactor Phases 0–5f y modularización del backend (verificado 2026-05-14).
> Para el plan de refactoring ver `REFACTOR_STRATEGY.md`.
> Para el historial de cambios ver `CHANGELOG.md`.

---

## 1. Descripción General

**Cecomunica Service Orders** es una plataforma web para gestión de servicios de comunicación por radio. Administra órdenes de servicio, inventario, contratos, equipos PoC (Push-to-Talk over Cellular), clientes y cotizaciones.

---

## 2. Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5 + CSS3 + JavaScript vanilla (sin build step) |
| SDK cliente | Firebase SDK 10.10.0 (compat mode, cargado desde `gstatic.com`) |
| Iconografía | Lucide (UMD desde unpkg) |
| Hosting | Firebase Hosting (archivos estáticos desde `public/`) |
| Base de datos | Cloud Firestore (modo compat) |
| Almacenamiento | Firebase Storage |
| Backend | Firebase Cloud Functions (Node.js 22, estructura modular en `functions/src/`) |
| PDF | Puppeteer Core 24.17.0 |
| Email | Nodemailer + SendGrid (vía Google Secret Manager) |
| Excel | SheetJS 0.18.5 |
| Secretos | Google Secret Manager (`FIRMA_SECRET`, `SENDGRID_API_KEY`) |

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
    core/                      ← módulos compartidos (auth, roles, formatting, layout)
    services/                  ← capa de servicios (Firestore I/O)
    domain/                    ← reglas de negocio puras (totales, scoring, normalización)
    ui/                        ← primitivas UI compartidas (Toast, Modal)
    pages/                     ← scripts extraídos de páginas grandes
  css/
    ceco-ui.css                ← design system compartido
    print-base.css             ← base para páginas imprimibles
    ordenes-index.css          ← estilos de la página de órdenes
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
| `layout.js` | `window.Layout` | `renderTopbar()`, `renderTopbarFor()`, menú de overflow compartido |

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

Páginas grandes con script extraído a archivo externo (cargado con `defer`).

**Páginas con namespace dedicado** (Phase 5e — un coordinador + módulos por responsabilidad):

| Coordinador | HTML de origen | Módulos |
|---|---|---|
| `contratos-index.js` | `contratos/index.html` | `contratos-state.js`, `contratos-approval.js`, `contratos-upload.js`, `contratos-equipos.js`, `contratos-list.js` |
| `nuevo-contrato.js` | `contratos/nuevo-contrato.html` | `nc-state.js`, `nc-form.js`, `nc-combo.js`, `nc-preview.js`, `nc-guardar.js` |
| `trabajar-orden.js` | `ordenes/trabajar-orden.html` | `to-state.js`, `to-cotizacion.js`, `to-servicio.js`, `to-equipos.js`, `to-pieza.js` |
| `poc-index.js` | `POC/index.html` | `poc-state.js`, `poc-list.js`, `poc-bulk.js`, `poc-edit.js`, `poc-sim.js` |
| `vendedores-batch.js` | `POC/vendedores-batch.html` | `window.VB` (namespace único) |
| `ordenes-index.js` | `ordenes/index.html` | `ordenes-state.js`, `ordenes-data.js`, `ordenes-render.js`, `ordenes-filters.js`, `ordenes-flujo.js`, `ordenes-equipos.js`, `ordenes-notas.js`, `ordenes-ui.js`, `ordenes-events.js` *(Phase 5f, 2026-05-14)* |

El coordinador es delgado (≤ 110 líneas); cada módulo expone sus funciones públicas en `window.*` y las dependencias cruzadas se resuelven por el orden de `<script>` en el HTML.

**Páginas con script extraído pero global plano** (sin namespace dedicado):

| Archivo JS | HTML de origen | Notas |
|---|---|---|
| `piezas.js` | `inventario/piezas.html` | Candidato a `window.Piezas` (Phase 5g, opcional) |
| `clientes-index.js` | `clientes/index.html` | Candidato a namespace (Phase 5g) |
| `fotos-taller.js` | `ordenes/fotos-taller.html` | Candidato a namespace (Phase 5g) |
| `editar-orden.js` | `ordenes/editar-orden.html` | Candidato a namespace (Phase 5g) |
| Otros menores | varios | Ver `REFACTOR_STRATEGY.md` §5a–5g para inventario completo |

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

### 5.4 Audit log de órdenes — `os_logs`

`ordenes_de_servicio/{id}.os_logs` es un array de auditoría escrito con `firebase.firestore.FieldValue.arrayUnion({ action, by })` cada vez que la orden cambia de estado.

- **Quién escribe:** el frontend. `OrdenesService.assignTechnician`, `completeOrder` y la entrega (`ordenes-flujo.js` + `firmar-entrega.js`) anexan entradas para `ASIGNAR`, `COMPLETAR` y `ENTREGAR` respectivamente.
- **Quién lee:** la línea de tiempo en la fila expandida (`ORDENES_INDEX_IMPROVEMENTS.md` §5.7). El timestamp se toma de los campos `fecha_*` dedicados ya que `arrayUnion` no admite `serverTimestamp()`; el `by` del array da el `uid` del autor.
- **Forma:** `{ action: 'ENTREGAR' | 'ASIGNAR' | 'COMPLETAR' | …, by: <uid> }` — sin `ts` porque Firestore no permite `serverTimestamp()` dentro de `arrayUnion`. Si se requiere timestamp por entrada, migrar a una subcolección `ordenes_de_servicio/{id}/os_audit/{autoId}`.
- **Límite:** Firestore tiene un cap de 1 MiB por documento. A ~50 bytes por entrada el techo práctico es ~20 000 acciones por orden — suficiente para el ciclo de vida típico pero a vigilar si en el futuro cada modificación de equipos se loguea aquí.

### 5.5 Storage — paths y reglas

Las reglas viven en `storage.rules` (en raíz, deployadas via `firebase deploy --only storage`). Todas las rutas requieren sesión autenticada; no hay reads públicos. Los Cloud Functions usan admin SDK y bypasean estas reglas — son el único camino para purgas server-side de PII.

| Path | Contenido | Content-type | Tamaño máx | Delete frontend |
|---|---|---|---:|:---:|
| `ordenes_firmas/{file}` | Firma del receptor (entrega) | `image/png` | 1 MiB | No |
| `ordenes_identificacion/{file}` | Foto ID del receptor (entrega — ruta nueva) | `image/*` | 6 MiB | No |
| `entregas_identificacion/{file}` | Foto ID del receptor (entrega — ruta legacy de `firmar-entrega.html`) | `image/*` | 6 MiB | No |
| `ordenes/{ordenId}/{equipoId}/{file}` | Adjuntos por equipo (trabajar-orden) | `image/*` o `application/pdf` | 10 MiB | Sí |
| `ordenes_taller_fotos/{ordenId}/{file}` | Fotos de equipo en taller | `image/*` | 8 MiB | Sí |
| `contratos_firmados/{file}` | PDFs de contratos firmados | `application/pdf` | 10 MiB | No |

Rutas PII (`ordenes_firmas`, `ordenes_identificacion`, `entregas_identificacion`) deshabilitan delete y update desde el frontend. La política de retención corre server-side:

| Path | Retención | Purga |
|---|---|---|
| `ordenes_firmas/` | Indefinida | No se purga — evidencia legal de entrega |
| `ordenes_identificacion/` | **90 días** desde upload | `purgePIIRetention` CF (ver §6.3) |
| `entregas_identificacion/` (legacy) | **90 días** desde upload | `purgePIIRetention` CF (ver §6.3) |

Al purgar una foto de ID, el CF también limpia `identificacion_url: null` en el doc de la orden y estampa `identificacion_purged_at: serverTimestamp()` + `identificacion_retention_days: 90` para que el audit trail registre la purga.

### 5.6 Búsqueda indexada de órdenes — `searchTokens`

`ordenes_de_servicio/{id}.searchTokens` es un array de strings normalizados que habilita búsquedas via `where('searchTokens', 'array-contains-any', [...])` en lugar de un scan completo de la colección. Resuelve el problema de costo descrito en `ORDENES_INDEX_IMPROVEMENTS.md` §1.1.

- **Quién escribe:** el Cloud Function `onOrdenWriteSearchTokens` (idempotente — compara tokens computados vs almacenados antes de escribir, evitando loop recursivo). Existing orders se siembran una sola vez via `functions/backfill-search-tokens.js`.
- **Lógica de tokens:** ver `functions/src/lib/searchTokens.js` — orden ID + sus partes, palabras del cliente (≥2 chars), palabras del técnico (≥2 chars), palabras del tipo de servicio (≥3 chars), y serials de cada equipo más sus sufijos de 4–8 caracteres (para soportar "últimos 4 dígitos" típicos de techs). Cap de 200 tokens por documento.
- **Quién lee:** `OrdenesService.searchOrders` en el frontend. Query indexada primero; si falla por índice ausente, o devuelve cero resultados (caso de transición pre-backfill), cae al scan completo como fallback.
- **Normalización idéntica entre server y cliente:** lowercase → NFD → strip diacritics → no-alfanuméricos a espacios → trim. Cualquier divergencia entre la lib en `functions/` y el normalizador embebido en `ordenesService.js` produce falsos negativos — son dos implementaciones del mismo algoritmo, mantener sincronizadas.

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
    triggers/
      contratos/
        onApproval.js                       ← onContratoActivado, onContratoActivadoSendPdf
        onAnnulment.js                      ← onContratoAnuladoNotify
      ordenes/
        onComplete.js                       ← onOrdenCompletada
        onWriteCacheSync.js                 ← onContratoOrdenWrite, onOrdenWriteSyncContratoCache, onOrdenHardDelete
        onWriteSearchTokens.js              ← onOrdenWriteSearchTokens
      mail/
        onMailQueued.js                     ← onMailQueued
      scheduled/
        purgePIIRetention.js                ← purgePIIRetention
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
| `onMailQueued` | `onDocumentCreated("mail_queue/{id}")` | Lee el documento encolado y envía el email vía SendGrid | `SENDGRID_API_KEY` |
| `purgePIIRetention` | `onSchedule("every day 03:00", TZ=America/Panama)` | Borra fotos de ID en `ordenes_identificacion/` y `entregas_identificacion/` con > 90 días desde upload. Limpia `identificacion_url`, estampa `identificacion_purged_at` en el doc de la orden — ver §5.5 | — |

Total: **2 endpoints HTTP + 10 triggers (9 onDocument + 1 scheduled) = 12 funciones** exportadas desde `functions/index.js`.

### 6.4 Pipeline de email

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
