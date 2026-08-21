# Equipos que el cliente no devuelve — cobro documentado

**Estado:** implementado 2026-08-20.
**Origen:** finiquito de TIL PANAMA (devoluciones `2026081102` y `2026081104`).
El cliente debía 29 equipos, el mensajero trajo 25. Los 4 que faltan hoy no
existen como registro en ninguna parte del sistema: viven en una frase dentro
del campo `observaciones` y en un contador (`cierre_pendientes: 1` por orden).
Nadie los va a cobrar porque nadie los va a volver a ver.

---

## 1. Por qué se traspapela hoy

El sistema ya sabe marcar una unidad como **"No se devuelve"** al resolver una
devolución, con cuatro motivos (`parcial`, `vendido`, `perdido`, `otro`), y uno
de ellos dice literalmente *"Perdido — pendiente de cobro"*. Eso estampa
`devolucion_excepcion` en la ficha del pool y deja un movimiento en el kardex.

Tres huecos lo vuelven inútil:

1. **El dato se escribe y nadie lo lee.** `devolucion_excepcion` no tiene una
   sola referencia en todo el frontend. Cae en un campo que ningún humano
   vuelve a ver.
2. **La unidad se queda en `en_cliente`.** `no_devuelve` no cambia el estado, así
   que un radio que hay que facturar se ve idéntico a un radio sano en un
   contrato vivo. No hay forma de distinguirlos en el inventario.
3. **Sin lista previa no hay ni renglón que marcar.** En devoluciones
   `sin_contrato` (contrato de papel) no existe lista de esperados, así que lo
   que no llegó no tiene fila. Es exactamente el caso de TIL.

---

## 2. Reglas de negocio (definidas con el usuario, 2026-08-20)

| Regla | Decisión |
|---|---|
| Facturación | **NO se factura desde esta plataforma todavía.** La plataforma produce el documento de cobro; la factura se emite en QuickBooks y su número se teclea de vuelta. |
| Precio | El **precio de venta del catálogo** (`modelos.precio_venta`), si existe, se prellena como sugerencia **modificable**. |
| Depreciación | **No aplica.** El equipo no se deprecia; la antigüedad no entra en el monto. |
| Descuentos | Se otorgan a veces. Hasta **15%** los aplica quien registra; por encima exige aprobación. |
| Condonaciones | Descuento total. **Solo un administrador** puede aprobarlas. |
| Escalado | A los **10 días** sin resolver, el renglón pasa a cobranza. |

El 15% no es arbitrario: es el mismo umbral que ya usa el auto-envío de
cotizaciones, así que el equipo ya conoce el número.

---

## 3. Arquitectura

### 3.1 `cobros_equipos` — el renglón cobrable

Colección nueva. Es **el** registro que impide el traspapeleo: un doc por
renglón, que sobrevive aunque la orden se cierre y aunque el equipo nunca haya
tenido ficha.

Existe separada del pool por una razón concreta: **un faltante puede no tener
serial.** El pool está indexado por serial (el doc ID *es* el serial), así que
los 4 radios de TIL —que nadie llegó a registrar— no caben ahí. El renglón de
cobro sí: lleva `modelo + cantidad` cuando no hay serial, y apunta a la ficha
del pool (`pool_doc_id`) cuando sí lo hay.

```
cobros_equipos/{id}
  cliente_id, cliente_nombre
  orden_devolucion_id
  serial, serial_norm, pool_doc_id     // null en un faltante sin serial
  modelo_id, modelo_label
  cantidad                             // 1 cuando hay serial
  motivo_codigo, motivo_detalle
  monto_catalogo_unit                  // precio_venta al momento de abrirlo
  monto_unit, descuento_pct, monto_total
  etapa       pendiente | en_cobranza | facturado | condonado | recuperado
  requiere_aprobacion, aprobado_por_email, aprobado_at
  factura_ref, facturado_at, facturado_por_email
  cerrado_motivo
  desde, escalado_at
  historial[]                          // append-only: quién, cuándo, qué
```

### 3.2 `pendiente_cobro` — estado nuevo del pool

Saca la unidad de `en_cliente` y la pone en un limbo **visible**: no cuenta
como disponible, no se confunde con un contrato sano, y solo sale por una de
las cuatro puertas de abajo.

No se agregó un segundo estado para el escalado: la etapa de cobranza vive en
`cobro.etapa` del renglón, no en el pool. El pool responde *dónde está el
equipo*; el renglón responde *cómo va el cobro*. Mezclarlos habría obligado a
tocar chips, reglas y conciliación por un dato que no es de ubicación.

### 3.3 Las cuatro salidas

| Salida | Estado final del equipo | Quién |
|---|---|---|
| **Facturado** | `vendido` + `venta.motivo: 'no_devuelto'` + nº de factura | quien cobra |
| **Facturado con descuento > 15%** | `vendido` | exige aprobación (gerente o admin) |
| **Condonado** | `baja` con `baja_motivo` | **solo administrador** |
| **Recuperado** | `en_bodega` — el radio apareció | recepción / inventario |

Un equipo no devuelto que se factura **es una venta**: el cliente se quedó con
el radio y lo pagó. Por eso el estado final es `vendido`, que ya existe, ya
significa eso y ya sale del stock disponible sin ser terminal como una baja.
No hizo falta inventar semántica nueva para el final del camino.

### 3.4 Ciclo

```
   devolución: "No se devuelve"          cierre con faltantes sin lista
   (perdido / otro / vendido)                (contrato de papel)
              │                                      │
              └──────────────┬───────────────────────┘
                             ▼
                    cobros_equipos (etapa: pendiente)
                    ficha del pool → pendiente_cobro
                             │
                    10 días sin resolver
                             ▼
                      etapa: en_cobranza
                             │
        ┌────────────────────┼────────────────────┬──────────────┐
        ▼                    ▼                    ▼              ▼
    facturado            condonado            recuperado     (sigue abierto,
    → vendido            → baja               → en_bodega     sale en el
                         (solo admin)                         correo diario)
```

---

## 4. Lo que se construyó

| Pieza | Archivo |
|---|---|
| Estado `pendiente_cobro` | `functions/src/domain/equiposPool.js`, `public/js/services/equiposPoolService.js`, chip en `public/css/ceco-ui.css` |
| Renglón de cobro (servicio) | `public/js/services/cobrosEquiposService.js` |
| Reglas de acceso | `firestore.rules` → `match /cobros_equipos` |
| `no_devuelve` abre el renglón | `functions/src/triggers/ordenes/onOrdenDevolucionWrite.js` |
| Itemizar faltantes al cerrar | `public/js/pages/ordenes-devolucion.js` |
| Bandeja | `public/inventario/no-devueltos.html`, `public/js/pages/inventario-no-devueltos.js` |
| Escalado + correo diario | `functions/src/triggers/scheduled/recordatorioOperativo.js` (sección F) |
| Caso TIL | `functions/scripts/abre-cobro-til-finiquito.js` |

---

## 5. Lo que NO hace (a propósito)

- **No emite facturas.** No hay integración de emisión todavía. La plataforma
  produce el estado de cuenta; QuickBooks emite. El día que se facture desde
  aquí, el renglón ya trae todo lo que necesita un invoice (cliente, modelo,
  cantidad, monto, descuento, aprobación).
- **No cobra automáticamente al vencer.** A los 10 días escala y avisa; la
  decisión de facturar sigue siendo de una persona.
- **No cierra renglones solo.** De la bandeja únicamente se sale por una acción
  explícita con su rastro. Nada se vacía por vencimiento ni por olvido: ese es
  el punto entero del módulo.

---

## 6. Decisiones tomadas después de la primera ola

- **El acuse firmado NO se va a exigir para cerrar una devolución**
  (decisión del usuario, 2026-08-21). Las dos órdenes de TIL cerraron con cero
  acuses, así que si el cliente discute no hay papel de lo que sí entregó — pero
  ese riesgo se maneja **administrativamente**, fuera del sistema, o en una fase
  posterior. No implementar el bloqueo ni el aviso: obligarlo ahora frenaría
  cierres legítimos por un papel que hoy se resuelve por otro canal.
- **NX-420-R = $375** de precio de venta (usuario, 2026-08-21). Estampado en el
  catálogo con `scripts/precio-nx420r-y-cobro-til.js`, que además reprecia los
  renglones abiertos de ese modelo que nacieron sin monto. El renglón de TIL
  quedó en 4 × $375 = **$1,500**.

## 7. Pendientes

- **Configurar `empresa/config.email_cobranza`.** Sin esa clave, el aviso de
  escalado cae en recepción. Es un campo del panel de configuración.
- **Precios de venta faltantes.** El monto se prellena solo si el modelo tiene
  `precio_venta`. `scripts/exporta-modelos-sin-precio.js` lista los que faltan.
  Los modelos refurbished (`-R`) son los más propensos a no tenerlo — el
  NX-420-R no lo tenía y por eso el primer renglón nació en 0.
- **Los 4 equipos de TIL** quedan abiertos como un renglón sin serial. Si
  aparecen los seriales, se dividen en renglones individuales.
