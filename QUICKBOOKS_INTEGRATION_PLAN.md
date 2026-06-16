# Plan de integración QuickBooks Online + Módulo de Facturación

> v3 · 2026-06-16 · rama `feat/cliente-id-link`
> Versión no técnica para el equipo: `PLAN_QUICKBOOKS_EQUIPO.md`

## 1. Arquitectura en una imagen

Dos capas con responsabilidades claras:

```
APP (motor de facturación, fuente de verdad)        QUICKBOOKS (cobranza)
  cliente ───────────────────────────────crea/actualiza──▶ Customer
  contrato → LÍNEAS con fechas ──────────────crea sub────▶ Sub-cliente (Job)
  facturador programado (CF, 1.º de mes) ───crea factura─▶ Invoice (bundle, ITBMS)
  módulo de facturación (panel visual)                     AR · pagos · estados de cuenta
  webhooks ◀──────────────estado de pago──────────────────  (cobranza, como hoy)
```

- **La app produce facturas exactas** (entregas, prorrateos, bajas, desglose).
- **QuickBooks cobra**: cuentas por cobrar, pagos, estados de cuenta por contrato
  (sub-cliente). La cobranza se sigue trabajando en QBO.
- **No** se usa el recurrente nativo de QBO (no soporta montos variables, prorrateo,
  disparo por entrega ni cambios a mitad de término; su API es de solo-lectura).

> **Alcance:** aplica **solo a contratos nuevos**. Los viejos no se migran por ahora y
> se siguen facturando como hoy; conviven (ver §12). Migración futura: opcional.

## 2. Hallazgos del descubrimiento (cuenta real CE COMUNICA)

`realmId 9130356242376366`, Panamá, USD (sin multimoneda), QBO **Plus**. 509 clientes,
1099 items. Conexión OAuth establecida (producción).

- **Mensualidad ya existe como items `Group`** `Mensualidad - <modelo>` que se expanden
  en: `Alquiler - <modelo>` (cuenta *Alquiler de Equipo*) + **Servicio de Frecuencia**
  (item 7, *Ingresos por Servicio de Frecuencia*) + **Servicio de Mantenimiento**
  (item 18, *Servicio de Mantenimiento*). Precios por defecto $0 (se llenan al facturar).
- **ITBMS:** TaxCode **14** "ITBMS 7%" (gravado) / TaxCode **13** "Exento".
- **Sub-clientes (Jobs)** ya en uso con `BillWithParent`. **RUC** en `PrimaryTaxIdentifier`
  (~84% de clientes). Custom field "ORDEN DE COMPRA" usado (1/3), libre "CONTRATO". Clases ON.
- **VALIDADO en sandbox (2026-06-16):** la API **sí** respeta montos de componentes
  sobrescritos en un `GroupLineDetail` (enviado 10/7 → leído 10/7).
  **Restricción:** la API **no crea** items Group → los bundles deben pre-existir en QBO;
  modelo nuevo = crear su bundle en la UI de QBO antes de facturarlo.

## 3. Modelo de datos (la decisión central: líneas con fechas)

El contrato deja de guardar una "cantidad plana" y pasa a guardar **líneas de
facturación con ciclo de vida**. Todo evento (entrega, baja, ampliación) es una
operación sobre líneas.

```
contratos/{id}
  cliente_id, contrato_id (CT-YYYY-NNN), tipo_contrato, moneda, estado
  facturacion_qbo     (bool)    ← true SOLO en contratos nuevos del sistema (los viejos
                                  no se migran; el facturador automático los ignora)
  qbo_subcustomer_id            ← se llena al activar facturación
  facturacion_activa  (bool)    ← true tras primera entrega
  lineas: [
    {
      id, modelo_id, cantidad,
      mensualidad_unit,                       ← negociada por el vendedor
      desglose: { alquiler, frecuencia, mantenimiento },  ← calculado, oculto al vendedor
      fecha_inicio,    ← = entrega del equipo (dispara facturación de esa línea)
      fecha_fin,       ← null = activa; fecha = baja con término aplicado
      origen: 'inicial' | 'ampliacion',
      motivo_fin, baja_solicitud_id,
    }, ...
  ]

clientes/{id}
  ...campos actuales..., itbms_exento, itbms_motivo_exencion (YA existen)
  qbo_customer_id               ← se llena al sincronizar

modelos/{id}   (panel administrativo)
  modelo (nombre)
  precio_alquiler               ← valor fijo de alquiler por unidad
  precio_frecuencia             ← 0 si no aplica
  qbo_item_alquiler_id          ← item "Alquiler - <modelo>" en QBO (nombres difieren)
  qbo_bundle_id                 ← item Group "Mensualidad - <modelo>" en QBO

solicitudes_cancelacion/{id}    (bajas — ver §8)
  contrato_id, items:[{modelo_id, cantidad}], termino, fecha_fin_facturacion,
  fecha_nota_cliente, adjuntos:[urls], motivo, estado, solicitado_por,
  fecha_solicitud, aprobado_por, fecha_aprobacion

facturacion_periodos/{id}       (registro de lo facturado — idempotencia + módulo)
  contrato_id, periodo (YYYY-MM), qbo_invoice_id, monto, itbms, estado_pago,
  lineas_facturadas:[{linea_id, modelo, cantidad, dias, prorrateado, montos}],
  created_at, qbo_doc_number, en_espera (bool), retenido_por_anomalia (bool)

ajustes_facturacion/{id}        (ajuste puntual del período — descuento/cargo único)
  contrato_id, periodo (YYYY-MM), tipo: 'descuento'|'cargo', monto, concepto,
  motivo, creado_por, fecha_creacion   ← el facturador lo aplica como línea extra una vez

integraciones/quickbooks         (tokens — ya existe, CF-only)
```

Constantes (backend): ITBMS TaxCode 14, Exento 13, item Frecuencia 7, item Mantenimiento 18.

## 4. Reglas de negocio confirmadas

**Desglose de la mensualidad** (calculado, oculto al vendedor; visible admin/recepción):
```
alquiler      = precio_alquiler            (fijo del panel, por modelo)
frecuencia    = precio_frecuencia          (fijo del panel; 0 si N/A)
mantenimiento = mensualidad_unit − alquiler − frecuencia   (el resto)
```
Validado contra tablas internas y factura real 9829 (PD60X: 12+5+3=20).

**Caso excepcional (sin piso duro):** si `mensualidad_unit < alquiler + frecuencia`,
advertencia al vendedor ("el monto parece un error · ¿solicitar aprobación de $X para
equipo Y?" Cancelar/Proceder). Si procede → `alquiler = mensualidad_unit`, frecuencia
y mantenimiento = 0; el administrador decide si aprueba.

**ITBMS por cliente:** `cliente.itbms_exento` → TaxCode 14 (paga) / 13 (exento).
`itbms_motivo_exencion` → nota en QBO.

**Prorrateo (÷30, denominador fijo):**
- *Entrada:* línea con `fecha_inicio` a mitad de mes → primer mes = `mensualidad ÷ 30 ×
  días desde fecha_inicio hasta fin de mes`.
- *Salida:* línea con `fecha_fin` a mitad de mes → último mes = `mensualidad ÷ 30 × días
  desde el 1.º hasta fecha_fin`. Sin nota de crédito (se factura hacia adelante).

**Ciclo:** emisión el **1.º de cada mes**, período hasta el último día del mes.

## 5. Motor de facturación (app-side)

**Disparadores de líneas:**
- *Entrega de equipos:* la orden vinculada al contrato pasa a `ENTREGADO AL CLIENTE`
  → se setea `fecha_inicio` en la(s) línea(s) correspondientes y `facturacion_activa=true`.
  Genera la **primera factura prorrateada** (entrega → fin de mes).
- *Baja:* solicitud aprobada → la línea se **cierra o se parte** (ver §8) con `fecha_fin`.
- *Ampliación:* nueva línea con `fecha_inicio` posterior (mismo mecanismo de entrega).

**Facturador mensual (Cloud Function programada, día 1, `America/Panama`):**
1. Recorre contratos con `facturacion_activa = true`.
2. Para cada contrato, junta las **líneas activas en el período** (las que tienen
   `fecha_inicio ≤ fin de mes` y (`fecha_fin` null o `≥ inicio de mes`)).
3. Calcula por línea: meses completos vs. parcial (prorrateo entrada/salida ÷30).
4. Arma **una factura** bajo el sub-cliente, con el bundle por modelo y los montos de
   componentes sobrescritos (alquiler/frecuencia/mantenimiento × unidades, prorrateados).
5. Aplica TaxCode (14/13 según cliente).
6. Crea la factura vía API y registra `facturacion_periodos` (idempotencia: nunca dos
   veces el mismo contrato+período).

**Salvaguardas:** idempotencia por contrato+período · reintentos + alerta si falla ·
botón manual "Correr facturación" · modo borrador/vista previa.

## 6. Representación en QuickBooks

- **cliente → Customer:** DisplayName, `PrimaryTaxIdentifier`=RUC, email, teléfono,
  dirección; `qbo_customer_id` de vuelta al doc.
- **contrato → Sub-cliente (Job):** `ParentRef`=customer, `BillWithParent=true`,
  DisplayName `CT-YYYY-NNN`, custom field "CONTRATO"=contrato_id.
- **factura mensual:** una por contrato, bajo el sub-cliente. Por cada modelo, una línea
  **Group `Mensualidad - <modelo>`** con *componentes ocultos al imprimir* (cliente ve una
  línea) y montos de componentes sobrescritos → poblan las 3 cuentas de ingreso. TaxCode
  14/13. Un mes parcial (entrada/salida) = bundle con montos prorrateados.
- **Restricción operativa:** la API no crea bundles; modelo nuevo requiere crear su
  `Mensualidad - <modelo>` en la UI de QBO antes de mapearlo en el panel.

## 7. Módulo de Facturación (panel visual, independiente)

Para la persona encargada de facturación. **Modelo de operación: emisión automática
el 1.º + gestión por excepción.** El sistema factura solo; el módulo da los controles
para intervenir cuando algo lo amerita, sin aprobar factura por factura. Página propia
(rol admin/facturación).

**La palanca central:** "Poner en espera" un contrato lo **excluye del ciclo automático**
sin apagar la automatización (disputa, cambio pendiente, caso especial). Se libera y
entra al siguiente ciclo o se factura puntual.

**Guarda de anomalías (automática):** si el monto calculado de un contrato se desvía
**±50%** vs. el período anterior **y** la diferencia supera **$100** (piso absoluto), se
**retiene automáticamente** y va a revisión en lugar de emitirse a ciegas. Se **omite**
cuando hay un cambio esperado que lo explica (baja/ampliación aprobada, o mes parcial de
inicio/fin). Umbral y piso **configurables** en el panel admin.

**Ciclo de vida del ciclo:**
1. *Ventana de revisión previa* (desde unos días antes del corte): "Próximo a facturar"
   permite revisar, **poner en espera** y **acusar alertas**.
2. *Emisión automática el 1.º*: emite todo lo **no retenido**; lo retenido/fallido queda
   visible para gestión.
3. *Gestión post-emisión*: **reintentar fallidas** (error API, modelo sin bundle),
   **facturar puntual** un contrato (en espera, entrega de mitad de mes o fallido) —
   emisión manual **solo para excepciones**.

**Pestañas:**
- **Próximo a facturar** — simulación del próximo ciclo (montos, prorrateos, inicios,
  bajas), con acciones *En espera* / *Revisar* por fila.
- **Facturado** — emitidas (mes/histórico) con monto, **estado de pago** (webhooks),
  número y **enlace a QBO**; acciones *reintentar* / *facturar puntual* para excepciones.
- **En espera** — contratos retenidos (manual o por anomalía) con su motivo.
- **Alertas** — contrato activo **sin entrega**, **modelo sin bundle**, factura **fallida**,
  **baja pendiente** que afecta el ciclo, mensualidad bajo piso aprobada.

**Auditoría:** toda intervención (poner en espera, liberar, reintentar, facturar puntual)
queda registrada con autor, fecha y motivo.

```
┌ FACTURACIÓN ───────────────────────────────────────────────────────────┐
│ [ Próximo a facturar ] [ Facturado ] [ En espera ② ] [ Alertas ① ]      │
│ Próximo ciclo · Julio 2026 (emite 01/07 automático)  ⏳ en 6 días        │
│ A facturar: $42,350 + ITBMS · 68 contratos · 3 inician · 2 bajas         │
│ ─────────────────────────────────────────────────────────────────────── │
│ ⚠ CT-2026-077  Aceros Panamá  $9,900  ▲+5400% vs mes ant.   [Revisar]   │
│   → retenido automáticamente por anomalía                                │
│ ▸ CT-2026-018  Transporte XYZ $180.00  baja (−1)           [En espera]  │
│ ▸ CT-2026-031  Minera del Sur $ 92.00  parcial (13 días)               │
│ ...                                                                       │
│        [ Vista previa del ciclo ]              [ Exportar (XLSX) ]        │
└──────────────────────────────────────────────────────────────────────────┘
```

**Ajuste puntual del período (en alcance inicial):** la persona de facturación puede
aplicar a un contrato un **descuento o cargo único** sobre su próxima factura (concepto +
motivo + auditoría). Aparece como una línea extra en esa factura y **no recurre**. Se
captura en el módulo durante la ventana de revisión.

**Fuera de alcance del módulo (se hace en QuickBooks):** anulaciones y notas de crédito
de facturas ya emitidas — la cobranza vive en QBO. El módulo puede *marcar* "reemitir",
pero la corrección formal es en QBO.

**Opcional (fase posterior):** anular+reemitir desde la app.

## 8. Flujo de bajas (cancelación de equipos)

Contrato activo **no editable** en cantidades; el cambio pasa por solicitud formal.

- **Solicitud** (vendedor/recepción): equipos a cancelar, **término** (fin de mes /
  +30 días / +60 días / otro), `fecha_nota_cliente`, **adjunta la nota**, observaciones.
  El término calcula `fecha_fin_facturacion` (el último tramo se prorratea ÷30).
- **Cola "Cancelaciones pendientes"** (estado *Baja solicitada*), identificada en el
  índice y en el panel, análoga a "Pendientes de aprobación".
- **Aprobación** (admin): al aprobar, la línea se **cierra** (si se cancela toda) o se
  **parte** (9 siguen / 1 con `fecha_fin`). El facturador aplica el prorrateo de salida.
- **Control/historial:** en el contrato (sección "Historial de bajas": original→vigente,
  con adjuntos), en la cola global, y en `auditoria.html` (eventos solicitada/aprobada/
  rechazada). Las líneas no se borran → historial por diseño.
- Sin nota de crédito desde la app (manual si aplicara). Tasa de cancelación: aparte (manual).

## 9. Roles y acceso

| Rol | Puede |
|---|---|
| Vendedor | Crear contrato, capturar **mensualidad** (sin ver desglose), solicitar baja |
| Recepción | Solicitar baja, ver contratos/historial |
| Administrador / Facturación | Todo: panel de tarifas, aprobar bajas, módulo de facturación, correr emisión, exportar |

Reglas de Firestore: `integraciones/*` y tokens solo-CF (ya); desglose y `facturacion_periodos`
con lectura admin/recepción; el frontend nunca escribe campos de facturación calculados.

## 10. Archivos a crear

**Backend (`functions/src/`)** — sobre la plomería ya desplegada (`quickbooksOAuth`,
`quickbooksWebhook`, `lib/quickbooks/{config,auth,tokenStore}`):
```
lib/quickbooks/
  client.js            ← GET/POST autenticado con refresh automático + retry
  mapping.js           ← cliente→Customer, contrato→Sub-customer, líneas→Invoice(bundle)
  billing.js           ← cálculo de líneas activas + prorrateo (entrada/salida)
http/
  runFacturacion.js    ← endpoint manual "correr facturación" (admin)
triggers/
  ordenes/onEntrega.js          ← entrega → fecha_inicio + activar + 1ra factura
  contratos/onBajaAprobada.js   ← baja aprobada → cerrar/partir línea
  scheduled/facturacionMensual.js ← día 1: emite el ciclo
callable/
  previewFacturacion.js   ← simulación "próximo a facturar" para el módulo
```

**Frontend (`public/`)**:
```
facturacion/index.html + js   ← módulo de facturación (próximo/facturado/alertas)
contratos/  → solicitud de baja (modal) + sección "Historial de bajas"
            → cola "Cancelaciones pendientes" en el índice
admin/      → panel de tarifas/items por modelo (precio_alquiler, frecuencia, qbo_*)
contratos/nuevo + editar → líneas con fecha_inicio/fecha_fin; bloqueo de cantidad en activos
```

## 11. Fases de implementación

| Fase | Entrega | Depende de |
|---|---|---|
| 0 · Auth + descubrimiento | ✅ hecho | — |
| 1 · Modelo de líneas + panel de tarifas/items (solo contratos nuevos) | base de todo | 0 |
| 2 · Sync clientes → Customer (RUC, exento) | clientes en QBO | 1 |
| 3 · Sync contrato → Sub-cliente + activación por entrega + 1ra factura prorrateada | facturación arranca | 2 |
| 4 · Facturador mensual app-side (líneas activas, prorrateo, bundle) | emisión automática | 3 |
| 5 · **Módulo de facturación** (próximo/facturado/alertas/controles) | control visual | 4 |
| 6 · Bajas (solicitud, cola, aprobación, cierre/partición de líneas) | cambios a término | 4 |
| 7 · Webhooks entrantes (pagos/estado) → app/módulo | estado de cobro | 4 |

Cada fase se prueba antes de pasar a la siguiente (sandbox para escrituras nuevas).

## 12. Alcance: SOLO contratos nuevos (sin migración por ahora)

**Decisión (2026-06-16):** el sistema aplica **únicamente a contratos nuevos**. Los
contratos viejos **no se migran** por ahora.

**Coexistencia durante la transición:**
- Contratos **nuevos** (con modelo de líneas, marca `facturacion_qbo = true`) → facturación
  automática vía la app + módulo de facturación.
- Contratos **viejos** (cantidad plana, sin líneas) → se siguen facturando **como hoy**
  (proceso manual en QuickBooks). El facturador automático **los ignora** (solo procesa
  contratos marcados para automatización).
- El módulo de facturación muestra solo los contratos del nuevo sistema.

**Migración futura (opcional, no en este alcance):** cuando se decida, un backfill
convertiría cada `equipo` de un contrato viejo en una **línea** (`fecha_inicio` =
activación/entrega, `fecha_fin = null`), calcularía el `desglose` con el panel de tarifas
y crearía su sub-cliente. Patrón de los `migrate-*.js` existentes, con dry-run y reporte.

## 13. Decisiones / pendientes

Resueltas: **alcance** (solo contratos nuevos, sin migración — §12), **modo de emisión**
(automática el 1.º + gestión por excepción — §7), **guarda de anomalías** (±50% / piso
$100, omite cambios esperados, configurable), **ajuste puntual del período** (en alcance
inicial — §7).

Pendientes:
- **Mapa modelo → item/bundle QBO:** sembrar el panel desde la tabla interna POC/Troncales
  (los nombres difieren). Validar con administración.
- **`contrato_id` en factura:** DisplayName del sub-cliente + custom field "CONTRATO".
- **Módulo fiscal:** confirmar que maneja facturas a sub-cliente y toma el RUC del padre.
- **Pagos de vuelta:** ¿solo pagado/pendiente, o también número de factura + saldo?
- **Reportes por tipo de contrato** (clases QBO): ¿sí/no?

## 14. Estado actual

- ✅ Conexión OAuth (producción) + webhook desplegados y verificados.
- ✅ Estrategia de factura (bundle, una línea, 3 cuentas) validada en sandbox.
- ✅ Reglas de negocio completas y confirmadas.
- 🔜 Construcción Fase 1+ (modelo de líneas → ... → módulo de facturación).
