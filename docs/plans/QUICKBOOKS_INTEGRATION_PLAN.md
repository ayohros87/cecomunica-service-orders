# Plan de integración QuickBooks Online + Módulo de Facturación

> v5 · 2026-07-02 · rama `feat/cliente-id-link`
> Versión no técnica para el equipo: `PLAN_QUICKBOOKS_EQUIPO.md`

> **CAMBIO v4 (2026-07-01) — Sin sub-clientes.** La cobranza es **por cliente**
> (un solo estado de cuenta por cliente); el sustento son los **equipos bajo los
> contratos** de ese cliente. Se **elimina el sub-cliente (Job)** por contrato: la
> factura se emite **al Customer (cliente)**, con las líneas **agrupadas por
> contrato** (número de contrato en la línea + `Class = contrato` para reporte). El
> detalle por serial va como **anexo desde la app**, no en QBO. Motivo: contabilidad
> cobra y concilia por cliente; el sub-cliente por contrato agregaba entidades (y
> proliferaba con cada renovación) sin aportar al cobro. **El contrato sigue siendo
> la fuente de verdad** de qué se factura; el equipo es el sustento bajo el contrato.

> **CAMBIO v5 (2026-07-02) — La unidad facturable es la fuente de la factura.** El
> equipo facturable es una **entidad por serial** que vive en **`poc_devices`** (un
> solo registro, sin duplicar): un **núcleo de facturación PROTEGIDO** (serial, modelo,
> contrato, tarifa, fechas, estado) que el módulo POC **no** puede editar, + una **capa
> operativa** libre (grupos, SIM, programación). La **factura** = unidades activas +
> **líneas de cargo** del contrato. El **contrato** sigue mandando (autoriza y tarifa
> las unidades; alerta si el real difiere de lo acordado). El flag **`facturable`**
> deja fuera al legacy (solo se factura lo nuevo). Ver §3, §5, §8. Además: **una sola
> factura por cliente** (consolidada, agrupada por contrato) — decisión confirmada.

## 1. Arquitectura en una imagen

Dos capas con responsabilidades claras:

```
APP (motor de facturación, fuente de verdad)        QUICKBOOKS (cobranza)
  cliente ───────────────────────────────crea/actualiza──▶ Customer  (entidad de cobro)
  unidades (poc_devices) + cargos · c/u con fechas ─(agrupan)─┐
  facturador programado (CF, 1.º de mes) ───crea factura─▶ Invoice al Customer
                                                          (líneas por contrato→modelo,
                                                           bundle, ITBMS, Class=contrato)
  módulo de facturación (panel visual)                     AR · pagos · estados de cuenta
  webhooks ◀──────────────estado de pago──────────────────  (cobranza, como hoy)
```

- **La app produce facturas exactas** (entregas, prorrateos, bajas, desglose).
- **QuickBooks cobra**: cuentas por cobrar, pagos, estados de cuenta **por cliente**.
  El contrato queda como **detalle** en la factura (descripción + `Class`), no como
  entidad. La cobranza se sigue trabajando en QBO.
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
- **Sub-clientes (Jobs)** ya en uso con `BillWithParent` (dato del descubrimiento;
  **NO los usaremos — v4/v5**, se factura al Customer). **RUC** en `PrimaryTaxIdentifier`
  (~84% de clientes). Custom field "ORDEN DE COMPRA" usado (1/3), libre "CONTRATO". Clases ON.
- **VALIDADO en sandbox (2026-06-16):** la API **sí** respeta montos de componentes
  sobrescritos en un `GroupLineDetail` (enviado 10/7 → leído 10/7).
  **Restricción:** la API **no crea** items Group → los bundles deben pre-existir en QBO;
  modelo nuevo = crear su bundle en la UI de QBO antes de facturarlo.

## 3. Modelo de datos (v5: la unidad facturable es la fuente de la factura)

La factura se calcula de **líneas facturables con ciclo de vida**, de dos familias:
**unidades de equipo** (una por serial) y **cargos** (por concepto). El **contrato**
define el ACUERDO (qué se vendió y a qué tarifa) y **autoriza** las unidades; la factura
sale de las **unidades reales**. Si el conteo real difiere del acordado → alerta.

### Registro de equipos = unidad facturable (`poc_devices`, un solo registro)

`poc_devices` deja de ser solo operativo: **extiende** el device con el núcleo de
facturación. Un solo documento por serial, en dos zonas:

```
poc_devices/{id}   (uno por serial)
  ── NÚCLEO DE FACTURACIÓN (protegido — el módulo POC NO lo escribe) ──
     serial, modelo_id, condicion (nuevo | refurbished), cliente_id, contrato_id
     facturable (bool)     ← true SOLO en equipos de contratos nuevos (facturacion_qbo)
     tarifa { mensualidad_unit, desglose{ alquiler, frecuencia, mantenimiento, ...addons } }
     fecha_inicio (= entrega, dispara el cobro)
     fecha_fin    (= baja; null = activo)
     estado_equipo (activo | en_reemplazo | pendiente_devolucion | devuelto | baja)
     origen { tipo: nuevo|reemplazo|renovacion|adicion, reemplaza_a, orden_id }
  ── CAPA OPERATIVA (libre desde el módulo POC) ──
     grupos, sim_number, linea, nombre, programación, notas, deleted, activo
```

- **Protección del núcleo (CONDICIONAL a `facturable`):** reglas a nivel de campo (patrón
  `touchesCFOwnedFields`) **rechazan** cualquier escritura del cliente que toque el núcleo
  **cuando `facturable == true`**; solo lo mueven flujos controlados (asignación por bodega
  E2, activación, baja, cambio de serial). `serial` y `modelo` del núcleo → cambiar serial =
  flujo de cambio de serial; cambiar modelo = enmienda de contrato (no un clic en POC).
  - **Legacy / no facturable (`facturable != true`):** el módulo POC **conserva edición
    libre de serial/modelo** — no hay factura que proteger y permite regularizar datos
    viejos. La protección se "arma" cuando el equipo entra a un contrato facturable.
  - Hoy POC permite editar serial/modelo libremente para TODO → hay que **limitar esa
    edición solo para los `facturable=true`** (cambio a implementar en el módulo POC + reglas).
- **Unidad sin serial:** placeholder con motivo (no bloquea el cobro; marcada para completar).
- **Legacy:** vive solo con la capa operativa (`facturable:false`) → el motor lo ignora.

> **Decisión (2026-07-03) — Condición nuevo/refurbished (el sufijo "R").** Hoy hay
> "dos modelos" por equipo (ej. `PD78X` y `PD78X R`) porque en QBO el ítem refurbished
> lleva **costo contable 0** (su costo landed ya se absorbió en su primera vida) y el
> nuevo lleva su **costo landed**. Esa dualidad es correcta **en QBO** (el costo es un
> atributo del ítem) y **se conserva**. Pero **en la app el modelo es UNO** y la
> condición es un **atributo de la unidad** (`condicion` en el núcleo): un serial
> reacondicionado sigue siendo el mismo modelo con el mismo historial — solo cambia su
> condición. El puente es el mapeo **`(modelo_id, condicion) → item/bundle QBO`** en el
> panel de tarifas. Si la tarifa refurb difiere, se resuelve en la tabla de tarifas
> (valor por condición), **no** con modelos duplicados en el catálogo de la app.
> **Implementación: patrón variante, SIN backfill** — los dos docs del catálogo se
> conservan (inventario necesita stock separado por condición); el doc "R" gana
> `variante_de: <id base>` y la resolución a `modelo_id` base + `condicion` ocurre
> **al crear la unidad facturable** (solo datos nuevos). Los históricos no se tocan.
> Plan completo: `docs/mejoras-solicitadas/07_modelos_variante_refurbished.md`.

### Contrato (acuerdo comercial — sigue siendo la autoridad)

```
contratos/{id}
  cliente_id, contrato_id (CT-YYYY-NNN), tipo_contrato, moneda, estado
  facturacion_qbo    (bool)  ← true SOLO nuevos; el motor ignora los demás
  facturacion_activa (bool)  ← true tras primera entrega
                               (cobro al CLIENTE: clientes/{id}.qbo_customer_id; sin sub-cliente)
  equipos: [ { modelo_id, cantidad, mensualidad_unit,           ← `cantidad` = la ACORDADA
               desglose{alquiler,frecuencia,mantenimiento} } ]   ← lo VENDIDO; se reconcilia
             contra las unidades reales de poc_devices (alerta si difiere)
  cargos:  [ { concepto, qbo_item_id, monto, recurrente(bool),
               fecha_inicio, fecha_fin, estado } ]   ← LÍNEAS DE CARGO con ciclo de vida
             · recurrente=true  → cargo mensual plano (prorratea/para como una unidad)
             · recurrente=false → cargo único (se factura una vez, primer período)
             (cargo mensual POR equipo → va en tarifa.desglose de la UNIDAD, no aquí)
```

### Otras colecciones (igual que v4)

```
clientes/{id}   ...itbms_exento, itbms_motivo_exencion (ya existen)
                qbo_customer_id            ← entidad de cobro (sin sub-cliente)
modelos/{id}    precio_alquiler, precio_frecuencia, qbo_item_alquiler_id, qbo_bundle_id
                (tarifas y qbo_* admiten valor POR CONDICIÓN — nuevo | refurbished;
                 ej. qbo_bundle_id_refurb → "Mensualidad - <modelo> R")
facturacion_periodos/{id}  contrato_id, periodo (YYYY-MM), qbo_invoice_id (compartido por
                cliente en el período), monto, itbms, estado_pago,
                lineas_facturadas:[{ref, modelo|concepto, cantidad, dias, prorrateado, montos}]
ajustes_facturacion/{id}   ajuste puntual del período (descuento/cargo único; ver §7)
solicitudes_cancelacion/{id}  bajas (ver §8)
integraciones/quickbooks   tokens (ya existe, CF-only)
```

Constantes (backend): ITBMS TaxCode 14, Exento 13, item Frecuencia 7, item Mantenimiento 18.

> **Nota v5:** el ciclo de vida (fecha_inicio/fecha_fin) que antes vivía en
> `contrato.lineas[]` ahora vive **por unidad** en `poc_devices` (equipo) y **por cargo**
> en `contrato.cargos[]`. Ya no hace falta "partir líneas" en bajas: cada unidad tiene su
> propia `fecha_fin`. `contrato.equipos[]` queda como **acuerdo** (lo vendido), no como
> fuente del cobro.

## 4. Reglas de negocio confirmadas

**Desglose de la mensualidad** (calculado, oculto al vendedor; visible admin/recepción):
```
alquiler      = precio_alquiler            (fijo del panel, por modelo)
frecuencia    = precio_frecuencia          (fijo del panel; 0 si N/A)
mantenimiento = mensualidad_unit − alquiler − frecuencia   (el resto)
```
Validado contra tablas internas y factura real 9829 (PD60X: 12+5+3=20).

> **Dónde vive (v5):** este desglose se define en la línea del contrato (el acuerdo,
> `contrato.equipos[]`) y se **copia como snapshot a cada unidad** (`poc_devices.tarifa`)
> al asignar el serial (bodega). La **unidad es la autoritativa para el cobro**; el
> contrato es el acuerdo/plantilla. Así, cambiar la tarifa del contrato no re-tarifica
> retroactivamente lo ya asignado salvo que un flujo controlado re-aplique el snapshot.

**Caso excepcional (sin piso duro):** si `mensualidad_unit < alquiler + frecuencia`,
advertencia al vendedor ("el monto parece un error · ¿solicitar aprobación de $X para
equipo Y?" Cancelar/Proceder). Si procede → `alquiler = mensualidad_unit`, frecuencia
y mantenimiento = 0; el administrador decide si aprueba.

**ITBMS por cliente:** `cliente.itbms_exento` → TaxCode 14 (paga) / 13 (exento).
`itbms_motivo_exencion` → nota en QBO.

**Prorrateo (÷30, denominador fijo) — por unidad/cargo:**
- *Entrada:* unidad (o cargo) con `fecha_inicio` a mitad de mes → primer mes = `monto ÷ 30 ×
  días desde fecha_inicio hasta fin de mes`.
- *Salida:* unidad (o cargo) con `fecha_fin` a mitad de mes → último mes = `monto ÷ 30 × días
  desde el 1.º hasta fecha_fin`. Sin nota de crédito (se factura hacia adelante).

**Ciclo:** emisión el **1.º de cada mes**, período hasta el último día del mes.

## 5. Motor de facturación (app-side)

**Disparadores (setean fechas en la unidad/cargo):**
- *Entrega de equipos:* la orden vinculada al contrato pasa a `ENTREGADO AL CLIENTE`
  → se setea `fecha_inicio` en las **unidades** entregadas (poc_devices) y
  `facturacion_activa=true`. Genera la **primera factura prorrateada** (entrega → fin de mes).
- *Baja:* solicitud aprobada → se setea `fecha_fin` en las **unidades** dadas de baja
  (y/o en el **cargo** que cese) con el término aplicado. **Sin partir líneas.**
- *Ampliación / reemplazo / renovación:* nuevas **unidades** con su `fecha_inicio`.

**Facturador mensual (Cloud Function programada, día 1, `America/Panama`):**
1. Recorre **clientes** con al menos un contrato `facturacion_activa = true`.
2. Junta, de **todos los contratos facturables** del cliente:
   · **unidades activas** en el período (poc_devices, `facturable=true`, `fecha_inicio ≤ fin
     de mes` y (`fecha_fin` null o `≥ inicio de mes`)), agrupadas por contrato→modelo;
   · **cargos activos** (contrato.cargos: recurrentes en el período + únicos no facturados).
3. Calcula por unidad/cargo: meses completos vs. parcial (prorrateo entrada/salida ÷30).
4. Arma **una factura del cliente**, agrupada por contrato; por cada modelo un bundle con
   montos de componentes sobrescritos (× unidades activas, prorrateados) y `Class = contrato`;
   cada cargo como su línea (su item QBO).
5. Aplica TaxCode (14/13 según cliente).
6. Crea la factura vía API y registra `facturacion_periodos` **por contrato** (idempotencia:
   nunca dos veces el mismo contrato+período; una factura de cliente puede compartir
   `qbo_invoice_id` entre varios contratos del período).
7. **Reconciliación:** si las unidades activas por modelo ≠ `contrato.equipos[].cantidad`
   (la acordada) → **alerta** (no bloquea; el contrato es la autoridad y el registro debe cuadrar).

**Salvaguardas:** idempotencia por contrato+período · reintentos + alerta si falla ·
botón manual "Correr facturación" · modo borrador/vista previa.

## 6. Representación en QuickBooks

- **cliente → Customer:** DisplayName, `PrimaryTaxIdentifier`=RUC, email, teléfono,
  dirección; `qbo_customer_id` de vuelta al doc. **Es la única entidad** (no hay sub-cliente).
- **contrato → detalle en la factura (no crea entidad):** cada línea lleva el número de
  contrato en la descripción + **`Class = contrato`** (reporte por contrato), y las líneas
  del mismo contrato van **agrupadas/subtotalizadas**.
- **factura mensual:** **una por cliente**, agrupada por contrato. Por cada modelo de cada
  contrato, una línea **Group `Mensualidad - <modelo>`** con *componentes ocultos al
  imprimir* (cliente ve una línea) y montos de componentes sobrescritos → poblan las 3
  cuentas de ingreso. TaxCode 14/13. Mes parcial (entrada/salida) = bundle prorrateado.
- **detalle por serial:** va como **anexo generado por la app** (PDF/adjunto), no como
  entidad ni línea por serial en QBO.
- **Restricción operativa:** la API no crea bundles; modelo nuevo requiere crear su
  `Mensualidad - <modelo>` en la UI de QBO antes de mapearlo en el panel.

## 7. Módulo de Facturación (panel visual, independiente)

Para la persona encargada de facturación. **Modelo de operación: emisión automática
el 1.º + gestión por excepción.** El sistema factura solo; el módulo da los controles
para intervenir cuando algo lo amerita, sin aprobar factura por factura. Página propia
(rol admin/facturación).

**Emisión por cliente, control por contrato (v5):** el módulo se **gestiona por contrato**
(revisar, poner en espera, alertas), pero la **factura se emite consolidada por cliente**
(una por cliente por ciclo, agrupada por contrato). Consecuencias: poner "en espera" un
contrato **excluye sus líneas** de la factura de ese cliente (el resto sí sale); y las
**excepciones** (contrato liberado, entrega a mitad de mes, reintento) generan **facturas
adicionales al mismo cliente** — "una por cliente" es **por ciclo**, no un tope absoluto.

**La palanca central:** "Poner en espera" un contrato lo **excluye del ciclo automático**
sin apagar la automatización (disputa, cambio pendiente, caso especial). Se libera y
entra al siguiente ciclo o se factura puntual.

**Guarda de anomalías (automática):** si el monto calculado de un contrato se desvía
**±50%** vs. el período anterior **y** la diferencia supera **$100** (piso absoluto), se
**retiene automáticamente** y va a revisión en lugar de emitirse a ciegas. Se **omite**
cuando hay un cambio esperado que lo explica (baja/ampliación aprobada, o mes parcial de
inicio/fin). Umbral y piso **configurables** en el panel admin. **La retención es por
contrato:** se excluyen solo las líneas de ese contrato de la factura del cliente; el
resto del cliente se factura normal (el contrato retenido se factura puntual al liberarse).

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
- **Aprobación** (admin): al aprobar, se setea `fecha_fin` en las **unidades** dadas de
  baja (poc_devices); las demás siguen activas. **Sin partir líneas** — cada unidad ya es
  su propia línea. El facturador aplica el prorrateo de salida por unidad.
- **Control/historial:** en el contrato (sección "Historial de bajas": original→vigente,
  con adjuntos), en la cola global, y en `auditoria.html` (eventos solicitada/aprobada/
  rechazada). Las unidades no se borran (se cierran con `fecha_fin`) → historial por diseño.
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
  mapping.js           ← cliente→Customer; unidades+cargos de TODOS sus contratos→Invoice
                          (bundle por modelo), agrupados por contrato (Class). Sin sub-customer.
  billing.js           ← cálculo de UNIDADES activas (poc_devices) + CARGOS + prorrateo
http/
  runFacturacion.js    ← endpoint manual "correr facturación" (admin)
triggers/
  ordenes/onEntrega.js          ← entrega → fecha_inicio EN LAS UNIDADES + activar + 1ra factura
  contratos/onBajaAprobada.js   ← baja aprobada → fecha_fin EN LAS UNIDADES
  scheduled/facturacionMensual.js ← día 1: emite el ciclo (por cliente)
callable/
  previewFacturacion.js   ← simulación "próximo a facturar" para el módulo
```

**Frontend (`public/`)**:
```
facturacion/index.html + js   ← módulo de facturación (próximo/facturado/alertas)
contratos/  → solicitud de baja (modal) + sección "Historial de bajas"
            → cola "Cancelaciones pendientes" en el índice
admin/      → panel de tarifas/items por modelo (precio_alquiler, frecuencia, qbo_*)
contratos/nuevo + editar → equipos (acuerdo) + cargos con ciclo de vida; las UNIDADES
            (poc_devices) las asigna bodega. Reglas: NÚCLEO de poc_devices protegido del
            módulo POC (patrón touchesCFOwnedFields); el POC solo edita la capa operativa.
```

## 11. Fases de implementación

| Fase | Entrega | Depende de |
|---|---|---|
| 0 · Auth + descubrimiento | ✅ hecho | — |
| 1 · Registro de unidad facturable (`poc_devices` núcleo protegido) + cargos con ciclo de vida + panel de tarifas/items (solo contratos nuevos) | base de todo | 0 |
| 2 · Sync clientes → Customer (RUC, exento) — matching cliente↔QBO | clientes en QBO | 1 |
| 3 · Activación por entrega + 1ra factura prorrateada (al Customer, agrupada por contrato) | facturación arranca | 2 |
| 4 · Facturador mensual app-side (unidades activas + cargos, prorrateo, bundle, por cliente) | emisión automática | 3 |
| 5 · **Módulo de facturación** (próximo/facturado/alertas/controles) | control visual | 4 |
| 6 · Bajas (solicitud, cola, aprobación → `fecha_fin` en unidades) | cambios a término | 4 |
| 7 · Webhooks entrantes (pagos/estado) → app/módulo | estado de cobro | 4 |

Cada fase se prueba antes de pasar a la siguiente (sandbox para escrituras nuevas).

## 12. Alcance: SOLO contratos nuevos (sin migración por ahora)

**Decisión (2026-06-16):** el sistema aplica **únicamente a contratos nuevos**. Los
contratos viejos **no se migran** por ahora.

**Coexistencia durante la transición:**
- Contratos **nuevos** (con unidades facturables en poc_devices, marca `facturacion_qbo = true`)
  → facturación automática vía la app + módulo de facturación.
- Contratos **viejos** (sin unidades facturables / `facturable != true`) → se siguen facturando **como hoy**
  (proceso manual en QuickBooks). El facturador automático **los ignora** (solo procesa
  contratos marcados para automatización).
- El módulo de facturación muestra solo los contratos del nuevo sistema.

**Migración futura (opcional, no en este alcance):** cuando se decida, un backfill
convertiría cada `equipo` de un contrato viejo en una **unidad** (`poc_devices` con núcleo:
`fecha_inicio` = activación/entrega, `fecha_fin = null`, `facturable=true`), calcularía el
`desglose` con el panel de tarifas y **vincularía el cliente a su Customer** (sin sub-cliente
— v4). Patrón de los `migrate-*.js` existentes, con dry-run y reporte.

## 13. Decisiones / pendientes

Resueltas: **alcance** (solo contratos nuevos, sin migración — §12), **modo de emisión**
(automática el 1.º + gestión por excepción — §7), **guarda de anomalías** (±50% / piso
$100, omite cambios esperados, configurable), **ajuste puntual del período** (en alcance
inicial — §7), **sin sub-cliente / cobro por cliente** (v4), **una sola factura por cliente**
(consolidada, agrupada por contrato — v5), **unidad facturable = `poc_devices` con núcleo
protegido** como fuente de la factura (v5), **cargos** como líneas con ciclo de vida (por
equipo → tarifa; plano → línea de contrato — v5), **`facturable`** deja fuera al legacy (v5),
**condición nuevo/refurbished como atributo de la unidad** (modelo único en la app; QBO
conserva sus dos ítems por costo contable landed vs. 0; puente = mapeo
`(modelo, condición) → item/bundle` — 2026-07-03).

Pendientes:
- **Mapa modelo → item/bundle QBO:** sembrar el panel desde la tabla interna POC/Troncales
  (los nombres difieren). Incluye la dimensión **condición**: identificar los ítems "R"
  (refurbished) de QBO y mapearlos como `(modelo, refurbished)`, no como modelos aparte.
  Validar con administración.
- **`contrato_id` en factura:** número de contrato en la descripción de la línea + `Class = contrato`.
- **Módulo fiscal:** confirmar que factura al **Customer** con su RUC (sin sub-cliente).
- **Pagos de vuelta:** ¿solo pagado/pendiente, o también número de factura + saldo?
- **Reportes por contrato** (`Class` de QBO): confirmar uso (reemplaza la vista que daba el sub-cliente).
- **Reconciliación acordado vs. real:** definir el umbral/acción de la alerta cuando las
  unidades reales (poc_devices) no cuadran con `contrato.equipos[].cantidad` (la acordada).

## 14. Estado actual

- ✅ Conexión OAuth (producción) + webhook desplegados y verificados.
- ✅ Estrategia de factura (bundle, una línea, 3 cuentas) validada en sandbox.
- ✅ Reglas de negocio completas y confirmadas.
- 🔜 Construcción Fase 1+ (registro de unidades facturables → ... → módulo de facturación).
