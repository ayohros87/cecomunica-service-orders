# Plan — Ver el pendiente de devolución desde la lista de contratos

**Fecha:** 2026-08-07 · **Estado:** IMPLEMENTADO en `feature/devolucion-en-contratos`, **sin desplegar**
(Fases 0–2 completas; Fase 3 sigue diferida a propósito. Ver §8 para lo que cambió respecto al plan.)
**Pedido del equipo:** en contratos que fueron renovación o reemplazo —y en los cancelados/anulados— poder saber **desde `contratos/index.html`** si hay equipos pendientes de devolución o si ya se devolvieron todos.

Relaciona con [PLAN_CICLO_VIDA_EQUIPOS.md](PLAN_CICLO_VIDA_EQUIPOS.md) (fase B, C.5) y [PLAN_POOL_EQUIPOS_SERIAL.md](PLAN_POOL_EQUIPOS_SERIAL.md).

---

## 1. Situación

El dato **ya existe y es correcto**: la orden de DEVOLUCIÓN lo mantiene por serial, y
`pendientesDevolucion()` ([functions/src/lib/devolucion.js:23-35](../../functions/src/lib/devolucion.js#L23-L35))
es la fórmula única que ya alimentan el trigger, el digest diario y el chip "Faltan N"
del listado de órdenes ([ordenes-render.js:762-770](../../public/js/pages/ordenes-render.js#L762-L770)).

Lo que falta es llevarlo hasta la fila del contrato. Hoy no se puede por dos razones:

**(a) El puntero está en tres sitios distintos.**

| Origen | Puntero | Archivo |
|---|---|---|
| Renovación / reemplazo | `orden_devolucion_id` en el contrato **nuevo** | [onEntregaTransicion.js:122](../../functions/src/triggers/contratos/onEntregaTransicion.js#L122) |
| Anulación | `orden_devolucion_id` en el contrato anulado | [onAnnulment.js:141-142](../../functions/src/triggers/contratos/onAnnulment.js#L141-L142) |
| Baja / terminación | `orden_devolucion_id` en `solicitudes_cancelacion` — **el contrato no lo ve** | [onCancelacionWrite.js:246](../../functions/src/triggers/cancelaciones/onCancelacionWrite.js#L246) |

Y aun teniendo el puntero, el conteo vive dentro de `devolucion.esperados[]` de la orden:
una lectura extra **por fila**. Inviable en una lista paginada.

**(b) En renovaciones el tiquete casi nunca se crea.** Diagnóstico contra producción
registrado en [colaInventarioService.js:25-35](../../public/js/services/colaInventarioService.js#L25-L35):

- **5 de 232** contratos transicionables tienen `contrato_origen_ids`.
- `onEntregaTransicion` **exige** ese vínculo para disparar ([línea 47](../../functions/src/triggers/contratos/onEntregaTransicion.js#L47)).
- Sin vínculo → sin mapeos → sin orden de DEVOLUCIÓN → sin flag `pendiente_devolucion` en el pool.
- 42 contratos con transición pendiente; la pantalla se usó 1 vez en 232.

**Consecuencia que manda el diseño:** un chip alimentado solo por el tiquete saldría en
blanco justo en renovaciones, que es donde el equipo lo pidió. Por eso el plan tiene un
estado explícito **"sin registro"** — y ese estado es la mitad del valor, no un detalle.

**Además:** el contrato **viejo** (el que tiene los equipos afuera) no sabe que fue
renovado. `contrato_origen_ids` vive en el contrato nuevo apuntando hacia atrás; no hay
back-pointer. Quien abre el contrato viejo del cliente no vería nada. Lo arregla la Fase 0.

---

## 2. Decisión de diseño

**Espejo denormalizado en el contrato, mantenido por trigger.** Es el patrón que ya usa
toda esta página: `serialesBtn` lee `seriales_count`/`seriales_estado`
([contratos-list.js:36-52](../../public/js/pages/contratos-list.js#L36-L52)), `bajaPill` lee
`baja_estado`/`baja_cancelado_total` ([:61-73](../../public/js/pages/contratos-list.js#L61-L73)).
El chip de devolución es un tercer hermano: **cero lecturas extra** y filtrable en Firestore.

**Descartado:** join en el cliente (query de órdenes DEVOLUCIÓN al cargar el index).
Se despliega más rápido pero solo contesta "hay pendientes"; no contesta "ya se devolvió
todo" de forma confiable, ni cubre el contrato viejo, ni permite filtrar server-side.

**Descartado por ahora:** conteo derivado del pool en vivo. Requiere un trigger nuevo sobre
`equipos_pool/{id}` (hoy **no existe** ninguno — el pool solo se escribe desde el módulo de
dominio `equiposPool.js`). Queda como Fase 3 opcional.

---

## 3. Modelo de datos

### 3.1 En el contrato (`contratos/{cid}`) — campos nuevos

```js
// Mapa de contribuciones POR tiquete. Clave = id de la orden DEVOLUCIÓN.
// Un contrato puede ser reclamado por más de un tiquete (multi-origen, o
// baja + renovación). El merge por clave hace la escritura idempotente sin
// necesidad de consultar todas las órdenes.
devolucion_tiquetes: {
  "20260806-01": {
    pendientes: 3,
    esperado:   8,
    abierta:    true,              // false = CERRADA (DEVOLUCION)
    rol:        "titular",         // "titular" | "origen"
    at:         <timestamp>,
  }
}

// Derivados planos (para el chip y para filtrar/ordenar en Firestore).
devolucion_pendientes:    3          // suma de los tiquetes del mapa
devolucion_esperado:      8
devolucion_estado:        "pendiente"
//   "pendiente"             → algún tiquete abierto con pendientes > 0
//   "completa"              → todos cerrados, 0 pendientes
//   "cerrada_con_faltantes" → cerrado con pendientes > 0
//   "no_aplica"             → contrato Propio (devolucion_no_aplica)
devolucion_actualizado_at: <timestamp>
```

`devolucion_estado` **no** incluye `"sin_registro"`: ese lo deriva el front por ausencia
(§5.2). Un contrato sin tiquete no debe tener el campo.

### 3.2 En el contrato — back-pointer de linaje (Fase 0)

```js
renovado_por_ids: ["<docId del contrato nuevo>", ...]   // en el contrato ORIGEN
```

### 3.3 En la orden — lista de contratos afectados

`crearOrdenDevolucion` recibe hoy un solo `contratoDocId`
([ordenDevolucion.js:72](../../functions/src/lib/ordenDevolucion.js#L72)). Se le agrega
`contratoOrigenIds` y el doc estampa:

```js
contrato: {
  aplica: true,
  contrato_doc_id: "<titular>",
  contrato_id:     "ALQ20260806-01",
  contrato_origen_ids: ["<origen1>", ...],   // NUEVO
  motivo_no_aplica: null,
}
```

Así el trigger sabe a qué contratos escribir sin ninguna consulta inversa.

### 3.4 Reglas

Los campos nuevos van a `touchesCFOwnedFields`
([firestore.rules:82-87](../../firestore.rules#L82-L87)) — solo el Admin SDK los escribe:

```
"devolucion_tiquetes", "devolucion_pendientes", "devolucion_esperado",
"devolucion_estado", "devolucion_actualizado_at", "renovado_por_ids"
```

---

## 4. Fases

### Fase 0 — Back-pointer de linaje · pequeña, habilita el chip en el contrato viejo

**Por qué primero:** sin esto el chip solo aparece en el contrato de renovación, y los
equipos pendientes son del anterior.

1. Trigger nuevo `functions/src/triggers/contratos/onLinajeWrite.js`
   (`onDocumentWritten contratos/{cid}`): si `contrato_origen_ids` cambió, agrega/quita
   `cid` de `renovado_por_ids` en cada origen (`arrayUnion`/`arrayRemove`). Idempotente,
   best-effort, sin lanzar.
2. Registrar en `functions/index.js`.
3. Backfill `functions/scripts/backfill-linaje-back-pointer.js` — recorre contratos con
   `contrato_origen_ids` no vacío (hoy 5) y estampa el back-pointer. Con `--dry` por defecto.

**Riesgo:** bajo. Campo nuevo, nadie lo lee todavía.

---

### Fase 1 — Espejo del tiquete · el corazón

1. **`functions/src/lib/devolucion.js`** — función pura nueva, testeable:
   ```js
   resumenDevolucion(orden) // → { pendientes, esperado, abierta }
   ```
   Reusa `pendientesDevolucion(orden.devolucion)`; `esperado` = `esperados.length` +
   `Σ esperados_por_modelo[].cantidad`, o `total_esperado` en modo `sin_contrato`.
   Y la que consolida el mapa:
   ```js
   derivarEstadoDevolucion(tiquetes) // → { pendientes, esperado, estado }
   ```

2. **`functions/src/lib/ordenDevolucion.js:72`** — aceptar `contratoOrigenIds` y estamparlo
   en `contrato.contrato_origen_ids` ([:118-123](../../functions/src/lib/ordenDevolucion.js#L118-L123)).

3. **Los tres creadores** pasan los orígenes:
   - [onEntregaTransicion.js:106-120](../../functions/src/triggers/contratos/onEntregaTransicion.js#L106-L120) — ya tiene `origenIds` en mano ([:44-46](../../functions/src/triggers/contratos/onEntregaTransicion.js#L44-L46)).
   - `onAnnulment.js:85-147` y `onCancelacionWrite.js:177-275` — leen `contrato_origen_ids` del contrato (normalmente vacío; el titular basta).

4. **`onOrdenDevolucionWrite.js`** — al final del handler (después del bloque de cierre,
   [línea 373](../../functions/src/triggers/ordenes/onOrdenDevolucionWrite.js#L373)), **siempre**,
   no solo cuando hubo resoluciones:
   ```js
   await estamparEspejo(ordenId, after);
   ```
   Para cada contrato afectado (`contrato_doc_id` con `rol:'titular'` + cada
   `contrato_origen_ids[]` con `rol:'origen'`), en **transacción**: leer el contrato,
   fijar `devolucion_tiquetes[ordenId]`, recalcular los derivados, escribir.
   Transacción y no `merge` a secas porque dos check-ins de tiquetes distintos sobre el
   mismo contrato pueden solaparse.
   Best-effort con `try/catch` + `logger.warn`, como el resto del trigger: un fallo del
   espejo **no** puede tumbar la aplicación al pool.

5. **`no_aplica`** — donde `onCancelacionWrite` estampa `devolucion_no_aplica:'propio'`
   ([:219-220](../../functions/src/triggers/cancelaciones/onCancelacionWrite.js#L219-L220)),
   escribir también `devolucion_estado:'no_aplica'` en el contrato.

6. **`firestore.rules`** — §3.4.

7. **Backfill** `functions/scripts/backfill-devolucion-espejo.js`: recorre
   `ordenes_de_servicio where tipo_de_servicio == 'DEVOLUCION'` y estampa el espejo con la
   misma función del trigger. `--dry` por defecto, resumen por contrato al final.

**Riesgo:** medio. Toca el trigger más caliente del circuito de devoluciones. Mitigación:
el espejo va **al final** y envuelto en try/catch; no altera ninguna ruta existente.

---

### Fase 2 — El chip en la lista · lo que el equipo ve

1. **`public/js/domain/devolucionContrato.js`** (nuevo, mismo patrón que
   [transicionPendiente.js](../../public/js/domain/transicionPendiente.js)) — predicado único:
   ```js
   window.DevolucionContrato = {
     // ¿Este contrato debería estar devolviendo equipos?
     enModoDevolucion(d) {
       return d.estado === 'anulado'
           || d.baja_estado === 'aprobada'
           || !!d.terminacion_total
           || (Array.isArray(d.renovado_por_ids) && d.renovado_por_ids.length > 0);
     },
     // 'pendiente' | 'completa' | 'cerrada_con_faltantes' | 'no_aplica'
     //            | 'sin_registro' | null
     estado(d) {
       if (d.devolucion_estado) return d.devolucion_estado;
       return this.enModoDevolucion(d) ? 'sin_registro' : null;
     },
   };
   ```

2. **`contratos-list.js`** — helper `devolucionPill(data)` junto a `bajaPill`
   ([:61-73](../../public/js/pages/contratos-list.js#L61-L73)), inyectado en la celda Estado
   ([:278-284](../../public/js/pages/contratos-list.js#L278-L284)) y en la card móvil
   ([:326-330](../../public/js/pages/contratos-list.js#L326-L330)):

   | Estado | Chip | Texto |
   |---|---|---|
   | `pendiente` | ámbar | `Devolución · faltan 3 de 8` |
   | `completa` | verde | `Devuelto (8)` |
   | `cerrada_con_faltantes` | rojo | `Cerrada · 2 sin devolver` |
   | `no_aplica` | gris | `Devolución N/A` (equipos del cliente) |
   | `sin_registro` | gris punteado | `Devolución sin registro` |
   | `null` | — | sin chip |

   Con `title=` explicando el porqué en cada caso, y clickeable a la orden cuando hay
   `devolucion_tiquetes` (un solo tiquete → link directo).

3. **Filtro** — chip nuevo en [index.html:155-162](../../public/contratos/index.html#L155-L162)
   ("Devolución pendiente") + wiring en `:249-285`, y filtro local en
   `contratos-list.js:342` (`filtrarLocal`).

4. **Cargar el script** en `public/contratos/index.html` (defer, junto a los otros
   `js/domain/*`) — respetando la arquitectura de carga.

5. **Cache-bust** de los archivos tocados.

**Riesgo:** bajo. Render puro sobre campos que ya vienen en el doc.

---

### Fase 3 — Opcional: contar sin tiquete

Convierte el gris `sin_registro` en un número real ("3 sin devolver, sin tiquete").
Requiere trigger nuevo sobre `equipos_pool/{id}` que mantenga `equipos_colgando_count` en
el contrato cuando cambian `estado` o `asignacion.contrato_doc_id`. Criterio: estado en
`ESTADOS_COLGANDO` ([devolucion.js:41](../../functions/src/lib/devolucion.js#L41)) y
`propiedad != 'cliente'` — el mismo que usa `unidadesRecuperablesDeBaja`.

**No arrancarla hasta ver si el gris solo ya basta.** Es un trigger sobre la colección más
escrita del sistema (5,787 docs) y su valor marginal depende de cuántos `sin_registro`
sobrevivan al trabajo de vinculación.

---

## 5. Pruebas

- `functions/test/devolucionEspejo.test.js` — `resumenDevolucion` y
  `derivarEstadoDevolucion` como funciones puras: los 3 modos (`recuperacion`,
  `confirmacion`, `sin_contrato`), tiquete con `esperados_por_modelo`, dos tiquetes sobre
  el mismo contrato, cierre con faltantes.
- Extender `functions/test/devolucionPendientes.test.js` — que el espejo use exactamente
  `pendientesDevolucion()` y no una copia.
- Front: `DevolucionContrato.estado()` en jsdom, incluyendo `sin_registro`.
- Revisión visual del chip en las 6 variantes (Chrome headless).

## 6. Despliegue

`firestore.rules` + `functions` (onLinajeWrite, onOrdenDevolucionWrite, ordenDevolucion,
los 3 creadores) + `hosting`. Backfills **después** del deploy de functions, con `--dry`
primero. Sin índices nuevos: el mapa evita la consulta inversa.

## 7. Lo que este plan NO resuelve

- **No crea los vínculos que faltan.** Los 227 contratos renovados sin `contrato_origen_ids`
  van a mostrar `sin_registro`, que es la verdad: el sistema no sabe si el cliente devolvió.
  Cerrarlo es trabajo de la cola de transiciones (`COLA_TRANSICIONES_ACTIVA`, hoy en
  `false`) y de vincular a mano los 42 pendientes. El chip los hace visibles y contables —
  eso es lo que compra.
- **No decide qué pasa con el contrato viejo.** Sigue `activo` aunque haya sido renovado
  (C.5 del plan de ciclo de vida, diferido).
- **Contratos legacy** (`seriales_estado === 'legacy'`) caen en `sin_registro` por
  definición. Si eso ensucia demasiado la lista, el criterio de `enModoDevolucion` los
  excluye con una línea — pero conviene verlos primero antes de esconderlos.

---

## 8. Lo que cambió al implementarlo

Tres decisiones que el plan no anticipaba:

**El filtro NO puede ser server-side.** `sin_registro` es la AUSENCIA de
`devolucion_estado`, y Firestore no consulta por un campo que no existe — justo el estado
que cubre la mayoría de los casos. El toggle "Devolución pendiente" filtra sobre los
contratos ya cargados, y el resumen del pie lo dice ("de N cargado(s)") para que la bandeja
no se lea como "estos son todos". El filtro además ignora "Mostrar inactivos": esconder los
anulados vaciaría la bandeja justo de los casos más caros.

**`derivarEstadoDevolucion` necesitó un cuarto caso.** Un tiquete abierto con todo ya
resuelto (falta cerrarlo administrativamente) se reporta como `completa`, no `pendiente`:
el cliente no debe nada y perseguirlo sería ruido. Y cuando conviven un tiquete limpio y
otro con faltantes, gana `cerrada_con_faltantes` — que uno haya cerrado bien no borra que
otro dejó equipos afuera.

**Columna propia (opción B), sin sacrificar "Creado por".** La tabla pasó de 10 a 11
columnas y el `.app-table-wrap` ya desplaza en horizontal. Si en pantallas chicas queda
apretado, sacar "Creado por" de la vista por defecto es un cambio de una línea — pero no se
hizo de entrada porque destruye información que hoy alguien puede estar usando.

### Verificación corrida

- `npm test` en functions: **136/136** (22 nuevos en `devolucionEspejo.test.js`).
- `npm run lint`: 0 errores (27 warnings preexistentes, ninguno en archivos nuevos).
- `node -e "require('./functions/index.js')"`: OK.
- `node --check` sobre todo `public/js`: OK.
- Reglas contra el emulador (`test-emulator/rules.js`): **54 grupos verdes**.
- Render real de `contratos-list.js` en jsdom + captura en Chrome headless: 7 filas, los 6
  estados del chip, 11 celdas alineadas con 11 encabezados.

### Lo que enseñó producción (2026-08-07, tras el backfill)

El chip gris salía **86 veces**, y **80 eran contratos anulados** — no
renovaciones, como asumía el plan. Al segmentarlos por evidencia de que el
equipo hubiera salido:

| anulados sin tiquete | total |
|---|---|
| NO entregado + sin seriales | **73** ← nada salió |
| NO entregado + con seriales | 5 |
| entregado + con seriales | 1 |
| entregado + sin seriales | 1 |

El patrón normal de la anulación es "se capturó mal y se rehizo el mismo día".
Por eso `sin_registro` exige ahora `huboEquipo()` — `seriales_count > 0` o
`entrega_confirmada` — y las líneas de equipo cotizadas NO cuentan: que el
contrato liste 5 radios no prueba que salieran. **86 → 12 grises.**

Eso además respondió la pregunta abierta §7 sobre los legacy: excluirlos solo
quitaba 9 de 86, no era la palanca. La palanca era la evidencia de entrega, y
los legacy con entrega confirmada SÍ deben verse.

**Estado en producción:** 16 filas con chip de 497 contratos — 3 pendiente,
1 completa, 12 sin registro (7 anulados + 5 renovaciones).

### Desplegado

**2026-08-07**: `firestore.rules` + 5 functions (`onLinajeWrite` creada;
`onOrdenDevolucionWrite`, `onEntregaTransicion`, `onContratoAnuladoNotify`,
`onCancelacionWrite` actualizadas) + hosting ×2. Backfills corridos con `--dry`
previo: 7 contratos origen con back-pointer, 4 contratos con espejo.

### Pendiente

1. **Push a `origin/main`** — commiteado y desplegado, sin subir.
2. Vincular a mano los 42 contratos con transición pendiente; cada vínculo
   convierte un gris en un ámbar o un verde real.
3. Revisar los 12 grises uno por uno: son pocos y ahora todos tienen evidencia.
