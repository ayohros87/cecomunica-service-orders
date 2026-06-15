# Plan de integración QuickBooks Online ↔ Cecomunica Service Orders

> Borrador v1 · 2026-06-12 · rama `feat/cliente-id-link`
> Sincronización bidireccional de contratos → facturas, con desglose por contrato.

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

## 8. Fases sugeridas

1. **Fase 0 — Auth + lectura.** App Intuit, OAuth, guardar tokens, leer Customers/Items/
   TaxCodes de QBO. (Desbloquea ver la cuenta real.)
2. **Fase 1 — Customers.** Upsert cliente→Customer con identidad fiscal + traer `qbo_customer_id` de vuelta.
3. **Fase 2 — Sub-customers + factura inicial con prorrateo** disparada por entrega.
4. **Fase 3 — Biller mensual recurrente.**
5. **Fase 4 — Webhooks entrantes** (Invoice/Payment/Customer) → panel financiero.

## 9. Preguntas abiertas (bloquean detalle fino)

1. **Módulo fiscal:** ¿cuál es y cómo lee de QBO? ¿Requiere campos/custom fields
   específicos en el Customer o en la Invoice (p.ej. RUC en `PrimaryTaxIdentifier` vs.
   custom field)? Esto fija el mapeo exacto.
2. **Base del prorrateo:** ¿tarifa diaria = mensualidad ÷ 30 × días restantes? ¿O ÷ días
   reales del mes?
3. **Día de corte** del biller mensual: ¿día 1? ¿otro?
4. **Catálogo de Items en QBO:** ¿ya existen Items para "Servicio mensual" y "Equipo PoC",
   o los creamos? (Necesario para las líneas de la Invoice.)
```
