# Plan de integración QuickBooks Online ↔ Cecomunica Service Orders

> Borrador v2 · 2026-06-15 · rama `feat/cliente-id-link`
> Sincronización bidireccional de contratos → facturas, con desglose por contrato.
> **Versión no técnica para el equipo:** ver `PLAN_QUICKBOOKS_EQUIPO.md`.

## 0. Hallazgos del descubrimiento (cuenta real, 2026-06-15)

Conexión OAuth establecida y descubrimiento de solo-lectura ejecutado contra la
cuenta de producción **CE COMUNICA** (`realmId 9130356242376366`). Hechos que
fijan el mapeo (antes eran supuestos):

- **Entorno:** Panamá, **USD** (sin multimoneda), **QuickBooks Online Plus**
  (soporta sub-customers y clases). 509 clientes, 1099 items.
- **Facturación mensual YA existe como items `Group` (bundles):**
  `Mensualidad - <modelo>` (ej. `Mensualidad - PD78X` id 22, `Mensualidad - AP516`
  id 49). Un Group se expande en sus componentes en la factura. La integración
  **selecciona el bundle existente** que corresponde al equipo del contrato.
  - Renta: `Alquiler - <modelo>` (Service) → cuenta de ingreso **"Alquiler de
    Equipo"**. Servicios: Mantenimiento (id 18), Frecuencia (id 7), Consola
    (id 26), GPS (id 56).
- **ITBMS:** `TaxCode 14 = "ITBMS 7%"` (activo) en líneas gravadas; `TaxRate 19 =
  "ITBMS 7% (Sales)"`, 7%. Sales tax automatizado ON. (Resuelve la pregunta abierta.)
- **Sub-customers ya en uso:** ~5 de la muestra son Jobs con `BillWithParent=true`
  + `ParentRef`. El modelo Customer=cliente / Sub-customer=contrato es **nativo y
  ya parcialmente adoptado**.
- **Identidad fiscal:** ~168/200 clientes muestreados tienen `PrimaryTaxIdentifier`
  (RUC). Es el campo que el módulo fiscal necesita.
- **Custom fields (legacy de ventas):** usado "ORDEN DE COMPRA" (1 de 3). Queda
  espacio para "CONTRATO" → estampar `contrato_id` en la factura.
- **Clases:** activadas (solo "BLACK LINE"). Disponible para P&L por `tipo_contrato`.

**Nuevo requisito que reveló el descubrimiento:** mapa **modelo de equipo →
item `Mensualidad - <modelo>`**. Hay que confirmar que el modelo guardado en el
contrato/equipo (Firestore) coincide con el nombre del item en QBO; si difiere,
tabla de equivalencias.

## 0.5 Lógica de facturación confirmada (2026-06-16)

Reglas validadas con el usuario y contra facturas reales.

**Desglose de la mensualidad.** El vendedor solo captura la **mensualidad
negociada por equipo**. El sistema reparte ese monto en hasta 3 conceptos:
```
alquiler      = valor FIJO por modelo            (configurable en panel admin)
frecuencia    = valor FIJO por modelo (0 si N/A) (configurable en panel admin)
mantenimiento = mensualidad − alquiler − frecuencia   (el resto)
```
Validado: POC (sin frecuencia) mant = mensual − alq; troncales (frec=5) mant =
mensual − alq − 5. Confirmado contra factura real 9829 (PD60X: 12+5+3=20).

**Panel administrativo de modelos** (solo administrador): por modelo define
`precio_alquiler`, `precio_frecuencia` y el **item QBO de alquiler** correspondiente
(los nombres difieren). Se siembra de la tabla interna POC/Troncales. El alquiler
de frecuencia/mantenimiento usa items globales QBO: Frecuencia=7, Mantenimiento=18.

**Visibilidad:** el desglose NO lo ve el vendedor; sí admin y recepción. Se calcula
y **se guarda en el contrato** (snapshot auditable).

**Caso excepcional (sin piso duro):** si mensualidad < alquiler + frecuencia, el
vendedor recibe advertencia ("el monto parece un error · ¿solicitar aprobación de
$X para equipo Y?" Cancelar/Proceder). Si procede → **alquiler se sobrescribe =
mensualidad** (frecuencia y mantenimiento = 0) para ese equipo; el administrador
decide si aprueba.

**Factura — una sola línea para el cliente + 3 cuentas internas.** Se usa el item
**Group `Mensualidad - <modelo>`** con *componentes ocultos al imprimir*: el cliente
ve una línea, pero internamente los 3 componentes pueblan Alquiler de Equipo /
Ingresos por Servicio de Frecuencia / Servicio de Mantenimiento.
✅ **VALIDADO EN SANDBOX (2026-06-16):** la API SÍ respeta montos de componentes
sobrescritos en un `GroupLineDetail` de la factura (enviado 10/7 → leído 10/7).
⚠️ **Restricción:** la API **no crea** items Group ("GROUP is not supported"). Los
bundles `Mensualidad - <modelo>` deben **pre-existir en QBO** (ya existen); todo
modelo nuevo requiere crear su bundle en la interfaz de QBO antes de poder facturarlo.

**ITBMS por cliente:** leer `cliente.itbms_exento`. Paga → TaxCode **14** (ITBMS 7%);
exento → TaxCode **13** (Exento). `itbms_motivo_exencion` → nota en QBO.

**Prorrateo:** tarifa diaria = **mensualidad ÷ 30** × días (denominador fijo 30).
Primera factura parcial = de la fecha de entrega al último día del mes.

**Ciclo:** emisión el **1.º de cada mes**, período hasta el último día del mes;
el biller mensual corre el día 1.

## 1. Objetivo y dolor que resuelve

Hoy en QuickBooks Online (QBO) un cliente con varios contratos se ve aplanado: no
hay forma de desglosar saldo, historial ni facturas **por contrato**. El plan resuelve
esto con el modelo nativo de **sub-clientes (sub-customers / "jobs")** de QBO.

```
Customer        =  cliente            (Firestore `clientes`, key = cliente_id)
  └─ Sub-customer  =  contrato         (CT-YYYY-NNN, "Bill with parent" = ON)
       └─ Invoice(s) con líneas desglosadas:
            · Mensualidad / servicio        (precio)
            · Prorrateo (cuando aplica)     (línea aparte)
            · Equipos PoC por serial        (desde cache os_serials_preview)
            · ITBMS 7%                      (TaxCode existente)
       └─ Custom field: contrato_id = CT-YYYY-NNN
```

Resultado: en QBO ves balance e historial **por contrato** (sub-customer) y a la vez el
rollup consolidado **por cliente** (customer padre). Las `Classes` por `tipo_contrato`
quedan como opción para P&L segmentado (fase 2).

## 2. Reglas de negocio confirmadas

| Regla | Implicación de diseño |
|---|---|
| Contratos de **mensualidad** | Facturación recurrente generada por un **scheduled function** mensual (no por QBO Recurring Templates — la API de QBO no los crea bien). |
| **Prorrateo** cuando la factura no nace cerca del día 1 | Primera factura prorrateada por días; meses siguientes completos. Línea de prorrateo separada. |
| Contrato aprobado/activo **≠** facturación | El gatillo de facturación **NO** es la aprobación. |
| Facturación arranca al **entregar equipos** | Gatillo = orden vinculada al contrato pasa a `estado_reparacion = "ENTREGADO AL CLIENTE"` (`fecha_entrega_real`). Eso "activa" el contrato para facturación. |
| **ITBMS 7%** ya configurado en QBO | Reusar el `TaxCode` existente; no crear impuesto nuevo. |
| **Módulo fiscal** aguas abajo, manual | QBO es la fuente; el módulo fiscal lee de QBO. El Customer de QBO **debe** cargar la identidad fiscal (RUC / DV / cédula) para que el módulo fiscal la tome. La generación de la factura fiscal la hace el usuario manualmente (OK confirmado). |
| Traer de vuelta datos de cliente creado en QBO | Webhook entrante actualiza Firestore con `qbo_customer_id`, y cambios de datos del Customer hechos en QBO. |

## 3. Disparadores (saliente: Firestore → QBO)

1. **Upsert de Customer** — al crear/editar `clientes` (o lazy, la primera vez que se
   necesita). Mapea identidad fiscal:
   - `DisplayName` ← nombre/razón social
   - `PrimaryTaxIdentifier` ← `ruc` (+ `dv`) o `cedula`
   - email, teléfono, dirección
2. **Upsert de Sub-customer** — al activarse la facturación del contrato (primera entrega
   de equipos). `Job: true`, `BillWithParent: true`, `ParentRef` = customer del cliente.
   Custom field `contrato_id`.
3. **Facturación inicial (con prorrateo)** — al detectar primera entrega de equipos de una
   orden del contrato → crea Invoice prorrateada por días restantes del mes.
4. **Facturación recurrente mensual** — scheduled function el día 1 (o N) de cada mes →
   recorre contratos `facturacion_activa = true` y emite Invoice mensual completa.

Idempotencia: cada Invoice/Customer creado guarda su id de QBO en Firestore; reintentos
nunca duplican (clave: `contratos/{id}.qbo_invoice_ids[periodo]`).

## 4. Disparadores (entrante: QBO → Firestore) vía webhooks

Nuevo endpoint HTTP en `functions/src/http/quickbooksWebhook.js`. QBO firma cada evento
(verificar `intuit-signature`). Eventos suscritos:

- `Customer` create/update → escribe `qbo_customer_id` y refresca datos en `clientes`.
- `Invoice` update → `estado_factura`, `numero_factura_qbo`, `saldo`.
- `Payment` → `estado_pago`, `monto_pagado`, `fecha_pago` en el contrato → alimenta el
  panel `financiero.html` existente.

## 5. Autenticación y tokens (lo más delicado)

- App en **Intuit Developer** (sandbox primero, luego producción). Scope
  `com.intuit.quickbooks.accounting`.
- `clientId` / `clientSecret` → **Secret Manager** (ya en uso para PII).
- `realmId` + access/refresh token → doc `integraciones/quickbooks` (acceso solo CF).
- **Scheduled function** que refresca el token antes de expirar (refresh token ~100 días
  sin uso; rotarlo en cada refresh). Sigue el patrón de `functions/src/triggers/scheduled/`.

## 6. Modelo de datos nuevo (Firestore)

```
integraciones/quickbooks            { realmId, access_token, refresh_token, expires_at, ... }
clientes/{id}.qbo_customer_id       string
contratos/{id}.qbo_subcustomer_id   string
contratos/{id}.facturacion_activa   bool      ← true tras primera entrega
contratos/{id}.facturacion_inicio   timestamp ← fecha de entrega que activó
contratos/{id}.qbo_invoice_ids      map<periodo, invoiceId>  ← idempotencia
contratos/{id}.estado_pago          string    ← desde webhook
contratos/{id}.saldo                number     ← desde webhook
```

## 7. Archivos a crear (sin tocar lo existente)

```
functions/src/
  lib/quickbooks/
    client.js          ← wrapper REST QBO (refresh automático, retry)
    auth.js            ← OAuth2: authorize, callback, refresh, store en Secret Manager
    mapping.js         ← cliente→Customer, contrato→Sub-customer, factura→Invoice (ITBMS, prorrateo)
  http/
    quickbooksOAuth.js     ← endpoints connect/callback (setup inicial)
    quickbooksWebhook.js   ← entrante (Customer/Invoice/Payment)
  triggers/
    contratos/onFacturacionActiva.js  ← detecta primera entrega → sub-customer + invoice inicial
    scheduled/facturacionMensual.js   ← biller recurrente mensual con prorrateo
```

Enganche con lo existente: la detección de "primera entrega" se apoya en la transición ya
emitida por `ordenesService.completeOrder`/entrega (`ENTREGADO AL CLIENTE`) y el vínculo
orden↔contrato (`contratos/{id}/ordenes/{ordenId}`).

## 8. Fases y estado

1. **Fase 0 — Auth + lectura. ✅ HECHO.** App Intuit (producción), OAuth, tokens en
   Firestore, secrets en Secret Manager, descubrimiento ejecutado (ver §0). Endpoints
   `quickbooksOAuth` + `quickbooksWebhook` desplegados y verificados.
2. **Fase 1 — Customers.** Upsert cliente→Customer (RUC→`PrimaryTaxIdentifier`, email,
   tel, dirección) + traer `qbo_customer_id` de vuelta.
3. **Fase 2 — Sub-customers + factura inicial con prorrateo** disparada por entrega
   (`ENTREGADO AL CLIENTE`). Línea(s) = item Group `Mensualidad - <modelo>`.
4. **Fase 3 — Biller mensual recurrente** (scheduled, día de corte por definir).
5. **Fase 4 — Webhooks entrantes** (Invoice/Payment/Customer) → panel financiero.

## 9. Preguntas abiertas

Resueltas en el descubrimiento (§0): **ITBMS** (TaxCode 14), **versión QBO** (Plus),
**catálogo de items** (`Mensualidad - <modelo>` Group + `Alquiler -` + servicios),
**identidad fiscal** (RUC en `PrimaryTaxIdentifier`).

Resueltas con el usuario (ver §0.5): **prorrateo** (÷30), **día de corte** (1.º,
hasta fin de mes), **desglose** (alquiler/frecuencia fijos + mantenimiento resto),
**exentos** (`itbms_exento` → TaxCode 14/13), **una línea al cliente** (bundle con
componentes ocultos), **caso excepcional** (advertencia + override de alquiler).

Pendientes:
1. ✅ **RESUELTO — bundle por API:** validado en sandbox (2026-06-16), la API respeta
   montos de componentes sobrescritos. Restricción: los bundles deben pre-existir en
   QBO (la API no los crea) → modelo nuevo = crear bundle en la UI de QBO primero.
2. **Mapa modelo→item QBO:** emparejar cada modelo (Firestore) con su item
   `Alquiler - <modelo>`; sembrar el panel admin desde la tabla interna.
3. **`contrato_id` en factura:** ¿solo DisplayName del sub-customer, o además custom
   field "CONTRATO" (SalesCustomName2)?
4. **Módulo fiscal:** confirmar que toma el RUC de `PrimaryTaxIdentifier`.
5. **Pagos de vuelta:** ¿solo estado pagado/pendiente, o también número de factura + saldo?
```
