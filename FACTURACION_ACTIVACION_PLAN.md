# Plan: Activación de Facturación (robusta, por excepción)

> Estado: propuesta aprobada (2026-06-22). Decisiones del usuario incorporadas.
> Relaciona con `QUICKBOOKS_INTEGRATION_PLAN.md` (el facturador y el sync a QBO son
> fases posteriores que se enganchan aquí).

## Principio

El inicio de facturación es un **estado comercial explícito, fechado y auditable
por línea**, propuesto por una **lista de señales corroboradas** y confirmado
(activación **asistida**), **nunca inferido de un solo evento operativo** (como una
orden marcada "ENTREGADO AL CLIENTE").

Razón: apoyarse solo en la entrega de la orden es frágil —
1. es un evento de taller, no comercial (una entrega puede ser la devolución de una
   reparación, no el inicio de un alquiler);
2. punto único de falla → fuga de ingresos silenciosa si nadie la marca;
3. entregas parciales/múltiples por contrato;
4. **hay contratos que no llevan entrega de equipo** (renovaciones, contratos de
   servicio) → la entrega NO puede ser requisito;
5. **hay contratos que no facturan** (demo) → deben quedar fuera del ciclo.

---

## 1. Modelo de datos

### Gate de facturabilidad (contrato)
- `facturable` (bool, default `true`). Los contratos **demo / no-facturables** se
  marcan `false` y quedan **fuera de la activación y de las alertas**.
  - Se puede fijar en creación/edición del contrato y como acción rápida en el módulo.
  - A futuro: autodefault `false` si `tipo_contrato` indica demo (verificar valores).

### Por línea (cada entrada de `contrato.equipos[]` gana campos — aditivo)
- `fecha_inicio_facturacion` (Timestamp | null) — arranque de esa línea (= entrega o
  fecha confirmada; **editable**).
- `facturacion_estado` ('pendiente' | 'activa' | 'en_espera' | 'terminada').
- `fecha_fin_facturacion` (Timestamp | null) — la usa baja/terminación; se unifica aquí.

### Resumen a nivel contrato (escrito por trigger/callable con **admin SDK**, para
esquivar el guard `touchesCFOwnedFields`)
- `facturacion_estado` ('no_aplica' | 'pendiente' | 'listo' | 'activa' | 'en_espera' | 'terminada').
- `facturacion_fecha_inicio` (la más temprana de las líneas activas).
- `facturacion_activada_por` / `facturacion_activada_at` (auditoría).
- `entrega_confirmada` (bool) + `fecha_entrega_ultima` (propagado de órdenes, §3) +
  `entrega_confirmada_manual` (bool, respaldo cuando no hubo orden).

---

## 2. Señales de readiness (lista de verificación)

| Señal | Cómo se calcula | Nivel |
|---|---|---|
| **Contrato vigente** | `estado ∈ {activo, aprobado}` | **Requerido** |
| **Mapeo QBO completo** | cada modelo del contrato tiene `precio_alquiler` + `qbo_item_alquiler_id` + `qbo_bundle_id` | **Requerido** |
| Entrega confirmada | orden vinculada `ENTREGADO AL CLIENTE` **o** `entrega_confirmada_manual` | Advertencia |
| Seriales asignados | `seriales_count ≥ activos` | Advertencia |
| Contrato firmado | `firmado_url` presente | Advertencia |

- **Requeridos** bloquean la activación. **Advertencias** se muestran en amarillo
  pero **no** bloquean (decisión: hay contratos sin entrega de equipo —renovaciones,
  servicio— que igual facturan).
- Lo "requerido vs advertencia" vive en un doc `facturacion_config` (editable por
  admin) para no hardcodearlo.

---

## 3. Propagación de entrega (trigger)

**`onOrdenEntregada`** — cuando una orden pasa a `ENTREGADO AL CLIENTE`, busca el
contrato vinculado y estampa (admin SDK): `entrega_confirmada: true`,
`fecha_entrega_ultima`, y una sugerencia de `fecha_inicio_facturacion` por modelo
entregado.
- **No activa facturación** — solo registra la señal en el contrato para que el
  readiness sea calculable barato (sin leer subcolecciones desde el módulo).
- Normaliza el estado: el valor real escrito es `ENTREGADO AL CLIENTE` (hay reportes
  que chequean `ENTREGADA` — emparejar el valor real).
- **Confirmación manual**: cuando no hubo orden formal, recepción/contabilidad puede
  marcar `entrega_confirmada_manual` desde el módulo (mismo efecto de señal).

---

## 4. Activación (callable, no inferida)

**`activarFacturacion(contratoId, { lineas: [{idx, fecha_inicio}] })`** — callable
server-side, rol admin/contabilidad:
- Valida `facturable === true` y que las señales **requeridas** estén en verde.
- Escribe `facturacion_estado='activa'` + `fecha_inicio_facturacion` por línea +
  resumen + auditoría.
- Hermanos para gestión por excepción: `ponerEnEspera`, `reactivar`,
  `marcarNoFacturable` / `marcarFacturable`.

**Fase A = activación MANUAL** (contabilidad confirma). La auto-activación queda para
Fase B.

---

## 5. UI — pestaña "Activación" en el módulo de facturación

Segmento de sub-vistas:
- **Pendientes de activar** — algún requerido en rojo; muestra los chips de la
  checklist (✓/⚠/✗ por señal) para ver qué falta.
- **Listos para facturar** — requeridos en verde; fila con `fecha_inicio` **editable**
  por línea (default = fecha de entrega/confirmación) + botón **"Activar facturación"**.
- **Activos** — facturando (con su fecha de inicio).
- **En espera** — excluidos del ciclo a propósito.
- **No facturables** — `facturable=false` (demo, etc.), con acción para revertir.

Cada fila: contrato · cliente · activos/contratados · chips de checklist · fecha
sugerida · acciones.

---

## 6. Alertas (redes de seguridad)

**`alertasFacturacion`** (scheduled diario), solo sobre `facturable === true`:
- **Fuga de ingresos:** contrato vigente + requeridos en verde + **sin** facturación
  activa por **> 7 días**. El reloj arranca en `fecha_entrega_ultima` si existe; si no
  (renovación/servicio), en `fecha_aprobacion`/activación del contrato. → lista +
  correo a contabilidad.
- **Falso arranque:** facturación activa **sin** entrega ni serial registrado → lista
  + correo (revisión).

Se ven también en la pestaña Activación.

---

## 7. Fases

- **Fase A — Fundación (sin emitir aún):**
  1. trigger `onOrdenEntregada` (propaga entrega al contrato);
  2. campos de línea + `facturable` + cálculo de readiness;
  3. pestaña **Activación** con **activación manual asistida** (callable
     `activarFacturacion` + en espera + no facturable + confirmación manual de entrega).
  *Esto ya hace el sistema confiable y demostrable, sin emitir facturas.*
- **Fase B — Redes + automatización:** alertas (fuga / falso arranque) por correo +
  opción de **auto-activar** cuando los requeridos están verdes (configurable).
- **Fase C — Facturador:** lee líneas activas + fechas → crea facturas en QBO (primero
  en **borrador**, validando el desglose alquiler/frecuencia/mantenimiento vía bundle).
  *(Vive en `QUICKBOOKS_INTEGRATION_PLAN.md`; engancha aquí.)*

---

## 8. Decisiones tomadas (2026-06-22)

- **Entrega de equipo = ADVERTENCIA**, no requisito (hay renovaciones / contratos de
  servicio sin entrega).
- **Contratos no facturables (demo, etc.) = gate `facturable`**, fuera de activación y
  alertas.
- **Seriales = advertencia.**
- **Activación MANUAL al inicio** (Fase A); auto-activar en Fase B.
- **Alerta de fuga: 7 días** desde la entrega (o desde aprobación si no hubo entrega).
- **Confirmación manual de entrega: permitida** (respaldo cuando no hubo orden).

### Requeridos vs advertencia (resumen)
- Requeridos: **contrato vigente** + **mapeo QBO completo**.
- Advertencias: entrega confirmada · seriales asignados · contrato firmado.
