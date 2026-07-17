# Cecomunica — Cómo funciona el sistema (top-down)

> **Fecha:** 2026-07-17 · **Alcance:** arquitectura + flujos de trabajo + huecos verificados + roadmap QuickBooks.
> Complementa a `ARQUITECTURA_CECOMUNICA.md` (congelado en mayo 2026, pre-QBO/pool/SIMs/visitas). Este documento refleja el estado actual del código.
> Seguridad fuera de alcance por decisión explícita; aquí solo arquitectura y flujos.

---

## 1. Vista de 10,000 pies

**Cecomunica Service Orders** es la plataforma operativa de un negocio de radiocomunicación en Panamá: alquila y vende radios (Motorola/Kenwood/PoC), los repara en taller, hace visitas técnicas en campo, y factura mensualidades. El sistema cubre el ciclo completo:

```
Cliente → Cotización → Contrato → Seriales → Entrega → Facturación (QBO, en construcción)
                ↘ Orden de servicio (taller / visita técnica) ↗
                        Pool de equipos por serial (kardex transversal)
```

Tres piezas de infraestructura (proyecto Firebase `cecomunica-service-orders`, prod en `app.cecomunica.net`):

| Pieza | Qué es |
|---|---|
| **Hosting** | Sitio multipágina estático en `public/` — HTML + JS vanilla, sin build step. Firebase compat SDK 10.10.0 por CDN. |
| **Cloud Functions v2** | Node 22, `functions/src/` modular. **44 funciones**: 4 HTTP, 16 callables, 20 triggers Firestore, 4 crons. |
| **Firestore + Storage** | ~40 colecciones. Reglas en `firestore.rules` / `storage.rules`, versionadas en el repo. |

**Principio arquitectónico central:** el frontend cambia estado en Firestore; las Cloud Functions **reaccionan** a esas escrituras (triggers) para hacer todo lo que requiere privilegio o efectos secundarios: correos, PDFs, sincronización del pool, caches, candados. El correo nunca se envía desde el front: se encola en `mail_queue` y `onMailQueued` lo despacha por SMTP (reintentable desde `admin/salud.html`).

---

## 2. Arquitectura técnica

### 2.1 Frontend

Cada área de negocio es una subcarpeta de `public/` con sus páginas: `ordenes/`, `contratos/`, `cotizaciones/`, `clientes/`, `inventario/`, `facturacion/`, `POC/`, `admin/`, más `verify/` (mini-app pública vía rewrite `/c/**`). El home (`index.html`) es el "Command Center" con señales y rail lateral.

Capas de JS (orden de carga: Firebase SDK con `defer` → `firebase-init.js` → core síncrono → services/domain con `defer` → módulos de página con `defer`):

| Capa | Contenido |
|---|---|
| `js/core/` | `roles.js` (enum `ROLES` + mapa `_PERMISOS` — fuente única de "quién puede qué"), `modulos.js` (visibilidad por rol + "Ver como"), `layout.js` (topbar/rail), `auth.js`, `formatting.js` (`FMT`: dinero, fechas, ITBMS, `esc()`) |
| `js/services/` | ~23 servicios, uno por colección/área. Las páginas no llaman `db.collection()` directo. Destacan: `ordenesService`, `contratosService`, `cotizacionesService`, `equiposPoolService`, `simCardsService`, `mailService` (escritor de `mail_queue`), `senalesService` (badges del home) |
| `js/domain/` | Lógica pura sin DOM/Firestore: `totales.js`, `cotizacionesTotales.js` (política de umbrales), `equipoNormalize.js`, `kpiDerived.js`, `adminMetrics.js` |
| `js/ui/` | `Toast`, `Modal`, `searchPalette` (Cmd+K), `verComoPicker` |
| `js/pages/` | Scripts de página; las grandes se trocean por responsabilidad (ej. órdenes: `ordenes-state/-data/-render/-flujo/-equipos/-visita/-events/...`) |

### 2.2 Backend — las 44 funciones

**HTTP** (`onRequest`): `quickbooksOAuth` (sirve `/api/quickbooks/connect|callback|disconnect` vía rewrites), `quickbooksWebhook` (valida HMAC, persiste evento crudo en `qbo_webhook_events` — procesamiento pendiente), `sendMail` y `sendContractPdf` (protegidos por `x-api-key`, sin callers en la SPA — canal manual/externo).

**Callables** (`onCall`): `manageUser` (portal usuarios), `rebuildContractCache`, `runBackfill` (migraciones one-shot desde admin), `previewEmail`, `getIdentificacionUrl` / `getClienteDocUrl` (URLs firmadas de PII), `kpiReportSnapshot` (PDF junta), `purgePIIRetention` (manual), `migrarIdentificacionPII`, **QBO read-only:** `listQBOCustomers` / `listQBOItems` / `listQBOEquipos` / `listQBOPiezas`, **facturación:** `gestionarFacturacion` (máquina de estados de activación) y `calcularFacturaContrato` (preview, no escribe a QBO).

**Triggers Firestore** — organizados por cadena de reacción:

| Cadena | Triggers |
|---|---|
| Contratos | `onContratoActivado` (firma/verificación), `onContratoAprobadoSolicitaSeriales`, `onSerialesAsignadasSendPdf` (PDF+correo a activaciones), `onContratoAnuladoNotify`, `onCancelacionWrite` (enmiendas/bajas), `onContratoActivadoSendPdf` (**deshabilitada**, exportada como no-op) |
| Seriales/pool | `onSerialWrite` (count + sync pool), `onSerialCambio`, `onMapeoWrite` (linaje de transición), `onEntregaPool`, `onOrdenWritePool`, `onPocDeviceWritePool` |
| Órdenes | `onOrdenCompletada` (stats técnico + correo), `onOrdenEntregada` (señal `entrega_confirmada` al contrato), `onOrdenWriteSearchTokens`, `onContratoOrdenWrite` / `onOrdenWriteSyncContratoCache` / `onOrdenHardDelete` (caches) |
| Cotizaciones | `onCotizacionEstadoChange` (candado de materiales), `onCotizacionOpened` (aviso de apertura) |
| Mail | `onMailQueued` (SMTP idempotente + retry) |

**Crons** (America/Panama): `markCotizacionesVencidas` (06:00), `recordatorioSeriales` (07:00), `facturacionDiaria` (07:00 — auto-activación opcional + alertas, **no emite facturas**), `recordatorioTransiciones` (lunes 07:30).

**Infra notable:** PDFs con Puppeteer+Chromium (`onSerialesAsignadasSendPdf` 2GiB/180s, `sendContractPdf`, `kpiReportSnapshot`); email nodemailer con saneo de adjuntos y plantillas en `emailRenderer.js`; PII en Storage con `read:false` + URLs firmadas; búsqueda de órdenes por `searchTokens` (normalización duplicada front/functions — mantener sincronizada).

### 2.3 Modelo de datos (colecciones por dominio)

| Dominio | Colecciones |
|---|---|
| Comercial | `cotizaciones`, `cotizacion_verificaciones` (mirror público), `cotizacion_opens` |
| Contratos | `contratos` + subcolecciones `ordenes` (cache), `seriales`, `seriales_estado`, `seriales_historial`, `seriales_cambios`, `mapeos` (transiciones); `verificaciones` (pública) |
| Operación | `clientes` (+`documentos`), `ordenes_de_servicio` (+`consumos`, `equipos_meta`, `borradores_cotizacion`), `poc_devices`, `poc_logs`, `sim_cards` |
| Inventario | `equipos_pool` (+`movimientos` kardex append-only), `modelos` (catálogo + mapeo QBO), `inventario_actual`, `ultimo_inventario`, `inventario_piezas`, `analytics_piezas_modelo` |
| Facturación | `cargos` (catálogo), `solicitudes_cancelacion`, `kpi_reports` |
| Sistema | `usuarios`, `usuarios_audit`, `empresa` (config), `mail_queue`, `tecnico_stats` (+`eventos`), `reset_requests` |
| QBO (solo CF) | `integraciones/quickbooks` (tokens), `integraciones_qbo_oauth_states`, `qbo_webhook_events` |

---

## 3. Flujos de trabajo

### 3.1 Órdenes de servicio

Colección `ordenes_de_servicio`, campo `estado_reparacion`. Estados canónicos en `ordenes-state.js` (`CONFIG.ESTADOS`). **No hay tabla de transiciones**: la máquina de estados es implícita — la define qué botón renderiza `botonesFlujo()` en `ordenes-render.js` según (rol, estado, esVisita). Todo el flujo transaccional ocurre en modales sobre `ordenes/index.html`.

```
[crear] POR ASIGNAR ──Recibir (firma mostrador)──▶ RECIBIDO EN MOSTRADOR
            │ (atajo "saltar recepción")                 │ Asignar técnico
            └────────────────────────────▶ ASIGNADO ◀────┘
                                              │ Completar
                                              ▼
                                   COMPLETADO (EN OFICINA)
                                              │ Entregar (firma + cédula + correos nota_entrega)
                                              ▼
                                   ENTREGADO AL CLIENTE  (terminal)
```

- Creación siempre en `POR ASIGNAR` (`nueva-orden.js`); edición solo en ese estado.
- Cada transición es un método de `OrdenesService` (`receiveAtCounter`, `assignTechnician`, `completeOrder`, `confirmarEntrega` vía `mergeOrder`). `reassignTechnician` cambia técnico sin tocar estado.
- Backend reacciona: `onOrdenCompletada` (stats + correo), `onOrdenEntregada` (señal al contrato), `onOrdenWritePool` (equipo → `en_taller` / `en_cliente`).
- Roles: admin/recepción/jefe_taller/técnico llevan el flujo completo; `tecnico_operativo` solo ve sus órdenes y solo Completar/Entregar; `vendedor` solo ve las suyas y solo Entregar.
- Conexiones: "Cotizar" → `cotizar-orden.html`; consumos de piezas en subcolección; fotos en `fotos-taller.html`; la tabla decora cada serial con su estado en el pool y avisa si figura con otro cliente.

**Visita técnica** (`tipo_de_servicio` contiene "visita" — `esOrdenVisita()`; flujo en `ordenes-visita.js`): trabajo de campo, sin recepción ni entrega.

```
[crear VISITA] POR ASIGNAR ──Asignar──▶ ASIGNADO ──(requiere informe)──▶ Cerrar visita ──▶ CERRADA (VISITA)
```

- Informe estructurado en `informe_visita` (motivo, trabajo, hallazgos, `elementos[]` con serial opcional — fuera de `equipos[]` para no contaminar el pool).
- Cierre en sitio con firma del personal visitado, o motivo obligatorio sin firma. Estampa también `fecha_completado` para que stats/timeline sigan funcionando.
- `onComplete` trata CERRADA (VISITA) igual que COMPLETADO.

### 3.2 Cotizaciones

Colección `cotizaciones`. Estados: `borrador → enviada → aprobada → rechazada / vencida → convertida`. Solo `borrador` es editable; lo demás es registro inmutable (se usa "Duplicar"). Dos tipos con aprobador distinto:

| Tipo | Origen | Aprueba |
|---|---|---|
| Comercial | `cot-editor.js` (módulo ventas) | `gerente` (o admin) — correo a `empresa/config.cotizacion_aprobacion_to` |
| Servicio | `cotizar-orden-formal.js` desde una orden (`origen='orden'`) | `jefe_taller` (o admin) |

```
borrador ──(dentro de política: desc ≤15% y total ≤$5,000)──▶ el vendedor envía él mismo
    │
    └─(fuera de política)──▶ correo al aprobador ──▶ aprobada ──▶ enviada al cliente
                                                        (link público /verify/cotizacion.html + PDF)
enviada ──▶ convertida (venta) | rechazada | vencida (cron 06:00)
```

- Política en `cotizacionesTotales.js` (`POLICY_DEFAULT` 15% / $5,000; configurable en `empresa/config`).
- Al aprobar: `confirmarAprobacion()` crea mirror en `cotizacion_verificaciones`, encola correo al cliente (BCC supervisión `mail_bcc_cotizacion`), marca `enviada`.
- Apertura del link público → `cotizacion_opens` → `onCotizacionOpened` avisa al vendedor (throttle 6h).
- **Candado de materiales**: `onCotizacionEstadoChange` — cotización de servicio `enviada`/`aprobada` escribe `cotizacion_emitida:true` en la orden (bloquea consumos); `rechazada`/`vencida` lo revierte.
- Supervisión: `verTodasCot()` (admin+jefe_taller+gerente) + allowlist `cotizaciones_supervisores` (solo lectura, enforced en rules).
- No hay aceptación del cliente en línea: el vendedor cierra manualmente como `convertida`/`rechazada`.

### 3.3 Contratos, seriales y entrega

```
[nuevo-contrato] pendiente_aprobacion ──Aprobar (admin)──▶ aprobado ──▶ activo
                                                              │
   ┌──────────────────────────────────────────────────────────┘
   ▼ onContratoAprobadoSolicitaSeriales
   ¿unidades serializables > 0?
   ├─ NO ──▶ seriales_estado='asignados' (auto) ──▶ correo a activaciones
   └─ SÍ ──▶ seriales_estado='pendiente' ──▶ correo a INVENTARIO (recordatorio diario 07:00)
                 │ inventario registra seriales en contratos/seriales.html
                 │ (teclear / pegar columna / jalar de pool, POC u órdenes)
                 ▼
             'asignados' ──▶ onSerialesAsignadasSendPdf: PDF (Puppeteer) + correo a activaciones@
                 │            página queda SOLO-LECTURA (candado; editores extra por allowlist)
                 ▼
             entrega_confirmada (orden ENTREGADA o acción manual) ──▶ pool: asignado_contrato → en_cliente
```

- Anulación (solo admin, con motivo): `onAnnulment` mueve los seriales del contrato a `devuelto_revision` (cuarentena), crea **orden de ENTRADA** para inspección y notifica.
- Transición/renovación (`contratos/transicion.html`): mapeos salientes↔entrantes append-only en `contratos/{id}/mapeos`; `onMapeoWrite` aplica linaje al pool (`reemplaza_a`, `pendiente_devolucion`). Recordatorio semanal a vendedores.
- Cambio de serial post-asignación: solicitud en `seriales_cambios` → inventario corrige (candado parcial: solo los seriales solicitados) → correo de corrección a activaciones. "Equipo defectuoso" manda el serial anterior a cuarentena.
- **Legacy**: ~310 contratos viejos con `seriales_estado='legacy'` (backfill `marcarSerialesLegacy`): fuera del flujo automático de seriales/activaciones; pueden registrar seriales como histórico (solo Guardar; el correo a activaciones queda bloqueado por backstop).
- Enmiendas/bajas/terminaciones: `solicitudes_cancelacion` + `onCancelacionWrite` (deriva estados `baja_estado`, `terminacion_total` y mueve equipos a cuarentena al cierre).

### 3.4 Pool de equipos, inventario, SIMs y POC

**`equipos_pool`** — un doc por unidad física, ID = serial normalizado (failsafe de colisión `serial__modeloKey` para Kenwood). Kardex en `movimientos`. Es la **columna vertebral transversal**: contratos, órdenes y POC lo alimentan por triggers ("migración por contacto").

```
                    recibir (inventario-equipos)      vender (factura QBO manual)
                              │                                ▲
  orden con equipo ──▶ en_taller ◀──┐             en_bodega ──┴──▶ vendido (no terminal)
                              │     │                 ▲  │
  entrega orden ──────▶ en_cliente ─┤    inspección OK│  │ asignación de seriales
  serial de contrato ─▶ asignado_contrato ──entrega──▶│  ▼
  POC device ─────────▶ en_poc      │             devuelto_revision ──darDeBaja──▶ baja (TERMINAL)
  anulación/defectuoso/enmienda ────┴────────────────▶ (cuarentena, salida manual por unidad)
```

- `vendido` (commit 7fa3722, fase 0 QBO): venta directa sin contrato desde Inventario · Equipos; solo desde `en_bodega` (evita doble venta); guarda nº de factura QBO ya emitida a mano. Con "trampa de seriales ajenos": excluye seriales que no están en el pool o no están en bodega.
- Conciliación (`abrirConciliacion`): compara pool `en_bodega` vs conteo manual `inventario_actual` por modelo — herramienta de auditoría, no auto-corrige.
- **SIMs** (`sim_cards`, ID=ICCID): `disponible`/`asignado`; asignación en lote a equipos POC (transaccional), liberación al desactivar el equipo.
- **POC** (`poc_devices`): parque instalado de radios en campo (cliente, serial, IP, unit_id, grupos, SIM). Reflejado al pool como `en_poc`. En el plan QBO v5 está previsto como la unidad facturable (aún no implementado — ver §5).
- Inventario: `modelos` (catálogo + tarifas + mapeo QBO), `inventario_actual` (conteos), `inventario_piezas` (repuestos).

### 3.5 Facturación (estado actual, pre-QBO)

Hoy el sistema **no emite ningún documento de cobro**. Lo que existe es la maquinaria de preparación:

1. **Catálogo `cargos`** (contabilidad): concepto, `qbo_item_id`, monto, recurrente/único.
2. **Contrato** toma cargos del catálogo (`nc-cargos.js`) + equipos con tarifas del catálogo `modelos`.
3. **Activación de facturación** (`facturacion/activacion.html`, admin/contabilidad): readiness por contrato — requeridos: contrato vigente + mapeo QBO completo de todos los modelos; recomendados: entrega, seriales, firmado. Acciones vía callable `gestionarFacturacion` (activar / en_espera / no_facturable / confirmar_entrega), auditadas.
4. **Preview de factura** (`calcularFacturaContrato`): prorrateo ÷30, desglose alquiler/frecuencia/mantenimiento, cargos recurrentes, ITBMS. Solo lectura — "No se ha emitido ninguna factura en QuickBooks".
5. **`facturacionDiaria`** (cron 07:00): auto-activación opcional (config `empresa/facturacion_config.auto_activar`) + alertas de "fuga de ingresos" (listo sin activar >7 días) y "falso arranque" (activo sin entrega ni serial).
6. **Match de clientes** (`facturacion/clientes-qbo.html`): empareja cliente↔Customer QBO por RUC/nombre, guarda `qbo_customer_id`. Manual, asistido, con detección de duplicados QBO.

La tarjeta "Emisión de facturas" del hub está deshabilitada ("Próximamente") — ver §5.

---

## 4. Huecos verificados por flujo

Marcados por severidad: 🔴 afecta operación/datos · 🟡 inconsistencia funcional · ⚪ deuda/limpieza.

### Órdenes / visitas
1. 🔴 **Sin validación de transiciones en backend**: cualquier escritura directa puede fijar cualquier estado; el gating es solo qué botones pinta la UI.
2. 🟡 **Vendedor puede sacar una VISITA por el flujo equivocado**: la rama visita de `botonesFlujo` excluye a vendedor; si ve una visita en COMPLETADO le aparece "Entregar" → termina en `ENTREGADO AL CLIENTE` en vez de `CERRADA (VISITA)`.
3. 🟡 **Imprimir orden y Cotizar ignoran `informe_visita`**: una visita imprime con tabla de equipos vacía; el informe solo se ve en el modal "Ver cierre".
4. 🟡 **Sin reversa ni reapertura**: no hay camino de COMPLETADO→ASIGNADO ni reabrir ENTREGADO/CERRADA; corregir errores requiere tocar Firestore a mano.
5. 🟡 **Correo de creación hardcodeado** a `tecnico@cecomunica.com` (`nueva-orden.js`), patrón legacy sin plantilla ni config.
6. ⚪ **Código muerto**: `firmar-entrega.html/.js` (segunda implementación completa de entrega, huérfana), `OrdenesService.deliverOrder()` (nunca llamado, campos inconsistentes), `trabajo_estado='EN_PROGRESO'` (se lee, nunca se escribe).
7. 🟡 **Sin recordatorio de órdenes estancadas** (hay crons para contratos y seriales, ninguno para órdenes en POR ASIGNAR/ASIGNADO).

### Cotizaciones
8. 🔴 **Umbral 15%/$5,000 solo en UI**: las reglas permiten al dueño mover su cotización a `enviada` sin importar monto (solo la *aprobación* está enforced server-side).
9. 🟡 **`cotizacion_validez_dias` configurable pero ignorado**: `CotState` hardcodea 15 días; la config es letra muerta.
10. 🟡 **"Marcar Enviada" manual no envía nada** (ni correo, ni link, ni `enviada_en`) — riesgo de marcar enviado lo que el cliente nunca recibió.
11. 🟡 **Panel genérico de cambio de estado no estampa timestamps/uid** (`cambiarEstado` vs `cerrarCotizacion`): trazabilidad incompleta; y revertir a borrador deja `fecha_rechazo`/`fecha_vencimiento` colgados en el timeline.
12. 🟡 **Historial hardcodea "por administrador"** aunque apruebe jefe_taller/gerente.
13. 🟡 **Cargos únicos ("primer pago") no se cobran**: `calcularFacturaContrato` solo suma recurrentes; el campo se guarda pero nadie lo consume.
14. ⚪ **Dos generadores de cotización de orden coexisten**: `cotizar-orden.js` (viejo, solo cachea resumen) y `cotizar-orden-formal.js` (el real).
15. 🟡 **Cotización `aprobada` sin `dirigido_email` queda durmiente** (no editable, recuperación torcida vía Reenviar/Duplicar).

### Contratos / seriales / pool
16. 🟡 **Criterio de "seriales completos" inconsistente**: la lista de contratos suma `seriales_omitidos_count`; `facturacion-activacion.readiness()` no — un contrato con omisiones legítimas se ve verde en la lista pero "faltan seriales" en activación.
17. 🔴 **Normalización de seriales duplicada front/functions** (`equiposPool.js` vs `equiposPoolService.js`): una divergencia produce docs duplicados del mismo equipo físico. Señalado en los propios comentarios.
18. 🟡 **Anulación no toca la facturación**: `onAnnulment` no limpia `facturacion_estado`. Hoy sin daño (`facturacionDiaria` filtra por estado aprobado/activo — verificado), pero es trampa latente para el futuro facturador mensual.
19. 🟡 **Cuarentena sin recordatorio**: `devuelto_revision` solo sale por inspección manual unidad por unidad; nada avisa de entradas pendientes.
20. ⚪ **`pendiente_devolucion` nunca se limpia** en el doc (solo se oculta por condición computada).
21. ⚪ **`onContratoActivadoSendPdf` deshabilitada pero desplegada** (no-op exportado, borrado pendiente).
22. 🟡 **Diff sin commitear en `contratos-approval.js`**: corrige un bug real (el selector `.btn-accent` devolvía `null` — el botón Aprobar nunca se deshabilitaba ni mostraba progreso) y mejora el refresco. Pendiente de probar y commitear; ojo: duplica en el front el criterio "sin seriales" del trigger.

---

## 5. QuickBooks: qué hay y qué falta para facturar

### 5.1 Diseño (docs/plans, v5)

- **La app es el motor de facturación** (fuente de verdad de qué/cuánto); QBO solo cobra: cuentas por cobrar, pagos, estados de cuenta. No se usa el recurrente nativo de QBO.
- **⚠️ Cambio de diseño clave (v4, 2026-07-01): sub-clientes ELIMINADOS.** La factura se emite al **Customer (cliente)** con **una sola factura consolidada por cliente por ciclo**, líneas agrupadas por contrato (nº de contrato en descripción + `Class=contrato` para reporte). `docs/FACTURACION_COMO_FUNCIONA.md` (2026-06-24) todavía describe el modelo viejo con sub-cliente — **desactualizado, corregir**.
- La facturación de un equipo arranca al **ENTREGAR** (primera factura prorrateada ÷30), pero la activación es decisión explícita y auditada (`gestionarFacturacion`), no automática por un solo evento.
- Cada modelo se factura con un item **Group "Mensualidad - <modelo>"** que expande Alquiler + Frecuencia + Mantenimiento (montos sobrescribibles — validado en sandbox 2026-06-16). **La API no crea Groups**: los bundles se pre-crean a mano en QBO. ITBMS: TaxCode 14 (7%) / 13 (exento).
- Venta directa (fase 0, ya implementada): factura manual en QBO + descuento de bodega en la app. Fase 1 prevista: bandeja alimentada por webhook `Invoice:Create` para reconciliar ventas hechas directo en QBO.

### 5.2 Qué está construido ✅

| Pieza | Estado |
|---|---|
| OAuth 2.0 completo (`lib/quickbooks/`: config, auth, tokenStore con CAS transaccional del refresh token, client) | ✅ código listo; rewrites en `firebase.json` |
| Webhook receiver (HMAC + persistencia en `qbo_webhook_events`) | ✅ recepción; ❌ procesamiento (stub declarado) |
| Callables read-only de discovery (`listQBOCustomers/Items/Equipos/Piezas`) | ✅ |
| Match manual cliente↔Customer (RUC/nombre, duplicados) | ✅ UI completa |
| Mapeo modelo→item/bundle QBO en catálogo `modelos` | ✅ UI completa |
| Activación de facturación + preview (`gestionarFacturacion`, `calcularFacturaContrato`) + `facturacionDiaria` | ✅ |
| Venta directa `vendido` (fase 0) | ✅ commit 7fa3722 — **pendiente deploy** |

### 5.3 Qué falta — ordenado por dependencia

**Código (el bloqueador raíz es el nº 1 — hoy no existe NINGUNA escritura hacia QBO):**

1. **`qboPost` en `lib/quickbooks/client.js`** — POST autenticado con refresh + retry/backoff (401/429). Sin esto nada de lo demás puede existir.
2. **Sync cliente→Customer** — crear/actualizar Customers con RUC desde la app (hoy el match es solo lectura, manual).
3. **Decisión de fuente de la línea facturable** — lo implementado calcula desde `contrato.equipos[]`; el plan v5 quiere `poc_devices` (unidad por serial, núcleo protegido con `facturable`/`tarifa`/`fecha_inicio`/`fecha_fin`). **Decidir antes de escribir el facturador** — es el mayor riesgo de descuadre.
4. **`lib/quickbooks/mapping.js`** — armar el JSON de Invoice: bundles con `GroupLineDetail` sobrescrito, agrupación por contrato, `Class`, TaxCode, cargos.
5. **`lib/quickbooks/billing.js`** — cálculo consolidado por cliente (hoy `calcularFacturaContrato` es por contrato).
6. **Colección `facturacion_periodos`** — idempotencia contrato+período. **Crítico**: sin esto un reintento duplica facturas en QBO.
7. **`facturacionMensual`** (cron día 1) + `runFacturacion` (manual) + `previewFacturacion` — la emisión en sí, con salvaguardas (anomalías ±50%/$100, modo borrador).
8. **Procesador de `qbo_webhook_events`** — Invoice/Payment → estado de pago en la app + bandeja de ventas directas (fase 1 de 7fa3722). Idempotente por entidad+operación (Intuit reenvía duplicados).
9. **UI "Emisión de facturas"** (tarjeta hoy deshabilitada) + flujo de bajas (`onBajaAprobada` → `fecha_fin`).

**Configuración / entorno:**

10. Confirmar secretos en Secret Manager (`QBO_CLIENT_ID/SECRET`, `QBO_SETUP_KEY`, `QBO_WEBHOOK_VERIFIER` — están staged en `qbo-secrets.local.json`; borrar el archivo local tras subirlos y rotar `QBO_SETUP_KEY`).
11. **Cutover a producción**: los 3 archivos locales apuntan a sandbox; ejecutar `/api/quickbooks/connect?key=…&env=production` y verificar `integraciones/quickbooks.env='production'` + realmId correcto. Redirect URI y webhook registrados en la app de Intuit.
12. **Pre-crear bundles en QBO** — "Mensualidad - <modelo>" por cada modelo a facturar (incluye variantes "R" refurbished); sembrar el mapeo en `modelos`.
13. Deploy pendiente: commit 7fa3722 (venta directa) y functions de anulación→pool.

**Decisiones de negocio pendientes (plan §13):**

14. Confirmar reporte por contrato vía `Class` de QBO · alcance de pagos de vuelta (¿solo pagado/pendiente o nº factura+saldo?) · umbral de alerta acordado-vs-real (`contrato.equipos` vs `poc_devices`) · validar tabla de tarifas por modelo · actualizar `FACTURACION_COMO_FUNCIONA.md` (sub-cliente obsoleto).

**Riesgos a vigilar cuando se construya:**

- **Refresh token de Intuit expira ~100 días** y nadie monitorea `refresh_token_expires_at` → la integración puede morir en silencio. Añadir alerta.
- Matching de clientes frágil (509 cuentas QBO con RUCs duplicados/typos) → facturar al cliente equivocado. La limpieza se hace en QBO.
- Webhook responde 200 incluso ante payload malformado (por diseño); el dedup queda a cargo del procesador futuro.

### 5.4 Camino mínimo sugerido (orden de ejecución)

```
F1  qboPost + facturacion_periodos (idempotencia)          ← fundacional
F2  Decisión fuente facturable + billing.js + mapping.js   ← requiere decisión de negocio
F3  Sync cliente→Customer + bundles pre-creados + cutover a producción
F4  previewFacturacion + runFacturacion manual (facturar 2-3 clientes piloto en borrador)
F5  facturacionMensual (cron) + UI de emisión + alertas de refresh token
F6  Procesador de webhook (pagos + bandeja de ventas directas)
```
