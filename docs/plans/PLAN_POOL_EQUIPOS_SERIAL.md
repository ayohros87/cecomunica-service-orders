# Plan: Pool de equipos por serial (trazabilidad bodega → cliente → taller)

> **Fecha:** 2026-07-14 · **Estado:** propuesta
> **Objetivo:** dar seguimiento a cada equipo físico por su número de serial desde que
> ingresa a la bodega: entradas, asignación a contratos desde el pool, entregas,
> paso por taller (órdenes de servicio), devoluciones y bajas.
> **Restricción clave:** hoy no hay ningún serial en el pool — la migración debe ser
> paulatina, sin big-bang y sin romper los flujos vivos (seriales de contrato,
> órdenes, POC, facturación).

---

## 1. Diagnóstico — qué hay hoy y qué falta

### 1.1 Lo que ya existe (y se debe reutilizar)

| Pieza | Qué hace | Relevancia |
|---|---|---|
| `sim_cards` (doc ID = ICCID) | Pool por identificador único con estados `disponible`/`asignado`, alta manual + import Excel con dedup natural, asignación transaccional anti-doble-asignación, liberación | **Precedente directo del patrón pool**; el diseño de `equipos_pool` lo replica |
| `contratos/{id}/seriales/{autoId}` | Registro contractual durable de qué serial se entregó a qué cliente; `seriales_historial` audita entradas/salidas; señal `seriales_estado/current` dispara el correo a activaciones | El punto de asignación serial↔contrato ya existe; el pool se engancha aquí, no lo reemplaza |
| `onSerialWrite` (CF) | Trigger sobre `contratos/{cid}/seriales/{sid}` que espeja `seriales_count` al contrato | Punto de extensión natural para sincronizar el pool |
| `onOrdenEntregada` (CF) | Marca `entrega_confirmada` en el contrato al entregar la orden | Señal existente de "el equipo salió a cliente" |
| `ordenes_de_servicio.equipos[].serial` | El equipo que entra a taller ya se identifica por serial (texto libre); `searchTokens` ya indexa seriales | Fuente de eventos "en taller" y búsqueda por serial gratis |
| `modelos` (catálogo) + `modelo_id`/`modelo_label` | FK canónica de modelo, con backfill `linkModeloIdPoc` y normalización probada | El pool referencia modelos igual que POC |
| `runBackfill` (callable con dryRun) | Runner de migraciones one-shot desde `admin/backfills.html` | Vehículo para las cargas iniciales del pool |
| `inventario_actual` / `ultimo_inventario` | Conteo físico semanal agregado por modelo | Se mantiene durante la transición como mecanismo de conciliación |

### 1.2 Los huecos que este plan cierra

1. **No existe una entidad "equipo físico" durable.** El mismo radio se re-registra
   por separado en POC, contrato y orden; el serial es el único hilo y es texto
   libre sin unicidad garantizada.
2. **El inventario de radios es un conteo agregado por modelo** — no sabe *cuáles*
   unidades hay en bodega, solo *cuántas*.
3. **No hay kardex/movimientos**: no se registra cuándo entró un equipo a bodega,
   cuándo salió a qué cliente, ni cuándo volvió.
4. **La asignación de seriales a contrato es de memoria/papel**: inventario teclea
   o "jala" seriales, pero nada valida que esas unidades existan ni descuenta un pool.
5. **Las devoluciones (cancelaciones) no regresan nada al inventario** — se cierra
   "equipos recibidos" con texto libre y el serial queda huérfano.

---

## 2. Modelo de datos propuesto

### 2.1 Colección `equipos_pool` — un doc por unidad física

**Doc ID = `serial_norm`** (serial normalizado: trim → uppercase → quitar todo lo
no `[A-Z0-9]`), mismo criterio que `sim_cards` (doc ID = ICCID): dedup natural al
importar, existencia O(1), transacciones anti-doble-asignación. Se guarda también
el serial "crudo" tal como está impreso en la etiqueta.

> **Failsafe de colisión entre modelos.** Hay casos reales de seriales repetidos
> entre modelos distintos (p. ej. un Kenwood NX420 y un NX920 con el mismo
> serial). El serial sigue siendo el ID, pero el alta detecta la colisión y la
> resuelve así:
>
> 1. Al dar de alta (manual, import o migración) se lee el doc `serial_norm`:
>    - **No existe** → se crea con ID = `serial_norm` (camino normal, ~99%).
>    - **Existe con el mismo modelo** → duplicado real: error `serial-existe`
>      (alta manual) o cuenta como `existente` (import), igual que en SIMs.
>    - **Existe con OTRO modelo** → colisión legítima: el nuevo doc se crea con
>      ID sufijado **`{serial_norm}__{modelo_key}`** (`modelo_key` = `modelo_id`
>      del catálogo, fallback label normalizado) y **ambos** docs se marcan
>      `serial_compartido: true` en la misma transacción.
> 2. Todos los docs (con ID limpio o sufijado) llevan el campo `serial_norm`, así
>    que la búsqueda canónica por serial es la query
>    `where('serial_norm','==', x)` (`findBySerial`) — devuelve 1 doc en el caso
>    normal y N en colisión; la UI desambigua mostrando el modelo. El get directo
>    por doc-ID queda como fast-path.
> 3. `serial_compartido: true` hace que la UI muestre siempre el modelo junto al
>    serial (picker, historia, listados) y que las validaciones comparen
>    serial+modelo en vez de serial solo para esos casos.
> 4. Si más tarde se corrige el modelo de uno de los docs y quedan dos docs del
>    mismo serial+modelo, es un duplicado real → se resuelve manualmente
>    (fusionar/dar de baja con movimiento `correccion_serial`).
>
> El orden de llegada decide quién se queda con el ID limpio; es irrelevante
> operativamente porque ningún flujo asume el ID — todos resuelven vía
> `findBySerial` + modelo.

> Nombre `equipos_pool` (no `equipos`) para no chocar con los arrays embebidos
> `equipos[]` de contratos y órdenes en búsquedas y en la cabeza de todos.

```
serial: string                  // como está en la etiqueta (raw, trim)
serial_norm: string             // búsqueda canónica por serial; igual al doc ID
                                // salvo docs sufijados por colisión (failsafe)
serial_compartido: bool         // true si este serial existe en más de un modelo
modelo_id: string | null        // FK a catálogo modelos
modelo_label: string            // snapshot "Marca Modelo"
condicion: "nuevo" | "reuso"    // espejo del N/R del catálogo
estado: string                  // máquina de estados — ver 2.2
asignacion: {                   // asignación VIGENTE (null si en bodega)
  contrato_doc_id, contrato_id,
  cliente_id, cliente_nombre
} | null
poc_device_id: string | null    // link al doc poc_devices si aplica
orden_actual_id: string | null  // orden de servicio abierta que lo tiene en taller
origen: "bodega" | "import_excel" | "migracion_contrato"
       | "migracion_poc" | "migracion_orden" | "toma_fisica"
verificado: bool                // false en docs creados por migración automática
                                // hasta que un humano los confirme
ingreso_bodega_at: Timestamp | null
proveedor: string | null        // opcional: factura/proveedor de compra
notas: string
baja_motivo: string | null      // "dañado" | "perdido" | "vendido" | ...
created_at / creado_por_uid / creado_por_email
updated_at / updated_by / updated_by_email
```

### 2.2 Máquina de estados

```
                     ┌────────────────────────────────────────────┐
                     ▼                                            │
 alta/import ──► en_bodega ──asignar──► asignado_contrato ──entrega──► en_cliente
                     ▲   ▲                    │ (liberar/cambio serial)      │
                     │   └────────────────────┘                              │
                     │                                        orden de servicio
                     │                                                       ▼
              devuelto_revision ◄──cancelación cerrada──── en_cliente    en_taller
                     │                                                       │
                     │              (ENTREGADO AL CLIENTE en la orden) ◄─────┘
                     └──inspección OK──► en_bodega
                     └──inspección mala──► baja

 en_poc: préstamo/demo (entra desde en_bodega, regresa a en_bodega o convierte
         a asignado_contrato cuando el POC se vuelve contrato)
 baja:   terminal (dañado / perdido / vendido) — solo admin
```

| Estado | Significado | Quién lo pone |
|---|---|---|
| `en_bodega` | Disponible para asignar | Alta manual / import / devolución inspeccionada |
| `asignado_contrato` | Reservado a un contrato aprobado (aún físicamente en bodega o en preparación) | Flujo de seriales de contrato (trigger) |
| `en_cliente` | Entregado; en campo | Trigger de entrega (`entrega_confirmada` / orden ENTREGADO) |
| `en_taller` | En orden de servicio abierta | Trigger de órdenes |
| `en_poc` | Prestado como demo/POC | Alta batch POC / manual |
| `devuelto_revision` | Regresó de cancelación/devolución, pendiente de inspección | Cierre de cancelación |
| `baja` | Fuera del sistema (motivo obligatorio) | Solo admin |

Los docs con `verificado: false` (creados por migración automática) conservan el
estado inferido pero se listan en un tab "Por verificar" hasta que inventario los
confirme o corrija.

### 2.3 Subcolección `equipos_pool/{id}/movimientos/{autoId}` — kardex append-only

Cada transición escribe un movimiento. Nunca se edita ni borra (auditoría).

```
at: Timestamp,  por: uid | "system"
tipo: "ingreso_bodega" | "asignacion_contrato" | "liberacion" | "entrega"
    | "ingreso_taller" | "salida_taller" | "prestamo_poc" | "devolucion"
    | "inspeccion" | "baja" | "correccion_serial" | "migracion"
de_estado / a_estado: string
ref: { tipo: "contrato"|"orden"|"cancelacion"|"poc"|"manual", id, label } | null
notas: string
```

Con `collectionGroup('movimientos')` se puede armar un kardex global por fechas si
algún día hace falta; el caso principal (timeline de UN serial) es la subcolección
directa.

### 2.4 Lo que NO cambia

- `contratos/{id}/seriales` sigue siendo el registro **contractual** (qué serial
  ampara qué contrato). El pool es el registro **físico/logístico**. Se sincronizan
  por trigger, no se fusionan — así el flujo de activaciones, PDF y candado queda intacto.
- `sim_cards` sigue aparte (las SIM viajan entre equipos).
- `poc_devices` sigue siendo el inventario operativo POC (IP, grupos, unit_id,
  radio_name); el pool solo guarda el link `poc_device_id`.
- El frontend sigue sin escribir el doc de contrato (patrón subcolecciones + CF).
- `inventario_actual` / conteo semanal siguen vivos durante toda la transición
  (ver §4, conciliación).

---

## 3. Integración con los flujos existentes (hooks, no rewrites)

Principio: **el pool se alimenta de eventos que ya existen**. Los cruces entre
dominios se hacen server-side (Admin SDK) para no abrir reglas al frontend.

### 3.1 Ingreso a bodega (nuevo — único flujo realmente nuevo)

Página nueva `inventario/equipos.html` (patrón `POC/sim-cards.html`):

- **Recibir equipos**: seleccionar modelo (catálogo) + pegar/escanear lista de
  seriales (un input que acepta lector de código de barras — teclado wedge — o
  pegado multilínea, igual que el alta batch de POC) + condición N/R + proveedor
  opcional. Crea docs `en_bodega` + movimiento `ingreso_bodega`. Duplicado del
  mismo modelo → error `serial-existe` (como en SIMs); serial ya existente en OTRO
  modelo → aplica el failsafe de colisión (§2.1) y se crea con ID sufijado.
- **Import Excel**: mismo patrón que `simCardsService.importar` (dedup en archivo +
  chunks con `documentId() in`, retorna `{nuevos, existentes, invalidos}`).
- Tabs por estado + KPIs (En bodega por modelo, Asignados, En cliente, En taller,
  Por verificar) + búsqueda por serial + drawer "Historia" (movimientos).

### 3.2 Asignación a contrato (extender `seriales.html` + `onSerialWrite`)

- **UI — "Tomar del pool"**: en `contratos/seriales.html`, junto a "Jalar desde
  POC/órdenes", un picker por modelo que lista `equipos_pool` con
  `estado == 'en_bodega'` y `modelo_id` del renglón. Seleccionar llena la casilla.
  La reserva real ocurre al Guardar/Confirmar (transacción estilo
  `simCardsService.asignar`: re-verifica `en_bodega`, si otro usuario lo tomó →
  error claro).
- **Tecleo manual sigue permitido** (fase de transición). Al guardar, el serial se
  resuelve con `findBySerial` + el modelo del renglón (así las colisiones entre
  modelos caen en el doc correcto):
  - serial existe en pool `en_bodega` (mismo modelo) → se asigna normal (auto-link);
  - serial existe pero en otro estado → warning con el estado actual (posible
    doble asignación o typo);
  - serial existe solo en OTRO modelo → warning "¿es el NX420 o el NX920?" y, si
    se confirma que es otra unidad, alta por failsafe de colisión (§2.1);
  - serial NO existe → se acepta y **el trigger lo crea** con
    `origen: 'migracion_contrato'`, `verificado: false` (ver §4.2).
- **Backend — extender `onSerialWrite`** (ya escucha `contratos/{cid}/seriales/{sid}`):
  - alta de serial → upsert en pool: `en_bodega → asignado_contrato` + movimiento
    con ref al contrato; si no existe, crear-por-migración.
  - borrado de serial (reemplazo/corrección) → liberar: `asignado_contrato →
    en_bodega` + movimiento `liberacion` (si el motivo del cambio fue "Equipo
    defectuoso", → `devuelto_revision`).
  - El trigger es idempotente y tolera contratos `legacy` (sus seriales también
    entran al pool como `en_cliente` — son equipos que están en campo).

### 3.3 Entrega al cliente

Extender `onOrdenEntregada` (o un trigger hermano sobre el mismo evento): cuando el
contrato recibe `entrega_confirmada`, los seriales de `contratos/{id}/seriales` en
estado `asignado_contrato` pasan a `en_cliente` + movimiento `entrega`. La
confirmación manual (`gestionarFacturacion: confirmar_entrega`) dispara lo mismo
(es un update al contrato → mismo trigger o uno sobre `entrega_confirmada`).

### 3.4 Órdenes de servicio (taller)

Nuevo trigger `onOrdenWritePool` sobre `ordenes_de_servicio/{id}` (conviviendo con
los triggers de cache existentes):

- Equipo agregado a una orden con serial que existe en el pool → movimiento
  `ingreso_taller` (estado `en_taller`, `orden_actual_id` set). Serial desconocido →
  crear-por-migración (`origen: 'migracion_orden'`, cliente de la orden).
- Orden pasa a "ENTREGADO AL CLIENTE" → sus seriales `en_taller` regresan a
  `en_cliente` + movimiento `salida_taller`.
- Mejora de captura (fase posterior): `agregar-equipo.html` autocompleta
  modelo/cliente al teclear un serial que ya está en el pool, reduciendo typos.

### 3.5 Devoluciones / cancelaciones

Hoy la cancelación es por `{modelo, cantidad}` sin seriales. Extensión al paso
**"Cerrar (equipos recibidos)"** de `cancelaciones.html`: mostrar los seriales del
contrato (pool `en_cliente` de ese contrato) con checkboxes "¿cuáles regresaron?" +
condición por unidad. Los marcados pasan a `devuelto_revision`; tras inspección en
la página del pool → `en_bodega` (reingresa como `condicion: 'reuso'`) o `baja`.

### 3.6 POC

Alta batch POC (`nuevo-batch.js`) hace upsert al pool: serial nuevo → `en_poc` con
`poc_device_id`; serial que estaba `en_bodega` → transición `prestamo_poc`.
"Jalar desde POC" en seriales de contrato ya cubre la conversión POC→contrato (el
trigger de §3.2 hace la transición `en_poc → asignado_contrato`).

---

## 4. Estrategia de migración paulatina (el corazón del plan)

Como hoy el pool está vacío, se puebla por **tres vías simultáneas** y se declara
completo cuando la conciliación cierra. Nunca se bloquea un flujo por un serial que
falte — se registra y se marca `verificado: false`.

### 4.1 Vía 1 — Hacia adelante (desde el día 1 de la Fase 1)

Todo equipo **nuevo** que entra a bodega se registra en el pool al recibirlo
(§3.1). Desde ese momento las compras nuevas nacen con trazabilidad completa.

### 4.2 Vía 2 — Migración por contacto (automática, Fase 2)

Cada vez que un serial **toca** el sistema por los flujos existentes, los triggers
lo dan de alta solos con el estado inferido:

| Evento | Estado inferido | Origen |
|---|---|---|
| Guardar seriales de contrato (incl. legacy) | `asignado_contrato` / `en_cliente` según entrega | `migracion_contrato` |
| Equipo en orden de servicio | `en_taller` (cliente de la orden) | `migracion_orden` |
| Alta/edición POC con serial | `en_poc` | `migracion_poc` |

Así el pool se llena **orgánicamente con los equipos que están vivos en la
operación**, que son los que importan — sin detener a nadie ni exigir captura doble.
Los docs quedan `verificado: false` y aparecen en el tab "Por verificar" para que
inventario los confirme cuando tenga el equipo a la vista (p. ej. cuando pasa por
taller).

### 4.3 Vía 3 — Carga dirigida (Fase 3)

1. **Backfills** (nuevas acciones de `runBackfill`, con dry-run, desde
   `admin/backfills.html`):
   - `seedPoolDesdeContratos`: `collectionGroup('seriales')` → upsert `en_cliente`
     (contratos activos/aprobados). Cubre de golpe todo lo entregado con registro.
   - `seedPoolDesdePoc`: `poc_devices` con serial y `deleted != true` → `en_poc`
     (o `en_cliente` si `activo`), con `poc_device_id`.
   - `seedPoolDesdeOrdenes`: órdenes abiertas → `en_taller`.
   - Precedencia en conflicto (mismo serial **y mismo modelo** en varias fuentes):
     **contrato > POC > orden**. Mismo serial en modelos DISTINTOS no es conflicto:
     es el caso Kenwood → alta de ambos por el failsafe de colisión (§2.1),
     reportado como informativo. El backfill reporta además "sospechosos" (mismo
     `serial_norm` con grafía distinta entre dominios) sin auto-resolver.
2. **Toma física de bodega** (evento operativo, no código): con la página de
   recepción en modo "toma inicial", bodega escanea/pega todos los seriales en
   estantes → `en_bodega`, `origen: 'toma_fisica'`, `verificado: true`. Este es el
   momento en que el stock físico real entra al sistema. Se puede hacer por modelo,
   en varios días — cada guardado es incremental e idempotente (doc-ID = serial).

### 4.4 Conciliación y criterio de corte

Página `inventario/conciliacion.html` (o sección en el index de inventario):

| Modelo | Conteo manual (`inventario_actual`) | Pool `en_bodega` | Diferencia |
|---|---|---|---|

- El conteo semanal manual **sigue corriendo** durante la transición; la tabla de
  diferencias es la métrica de avance de la migración.
- Métricas adicionales: % de contratos activos con todos sus seriales en pool;
  # docs "Por verificar"; # conflictos/sospechosos abiertos.
- **Criterio de corte:** cuando la diferencia por modelo sea 0 (o explicada) durante
  3–4 semanas seguidas, el conteo manual deja de ser la fuente y pasa a ser
  **auditoría física periódica** (mensual/trimestral) que se concilia contra el pool.
  El KPI "Unidades totales" del index de inventario pasa a derivarse del pool.

### 4.5 Endurecimiento gradual (Fase 5)

Solo cuando la conciliación cierra:

1. `seriales.html`: teclear un serial que no está `en_bodega` pasa de *warning* a
   *bloqueo* para contratos nuevos (los legacy siguen en modo registro).
2. La recepción de órdenes valida el serial contra el pool (autocompleta, avisa si
   es desconocido — no bloquea: equipos de clientes que nunca pasaron por nosotros
   existen).
3. Reglas de Firestore endurecen las transiciones (ver §5).

---

## 5. Reglas de seguridad y roles

Siguiendo el patrón existente (piso de rol en rules, candado fino en UI, cruces
entre dominios vía CF/Admin SDK):

```
equipos_pool/{id}
  read:   isSignedIn()
  create: rol in ["administrador","inventario"]            // alta en bodega / import
  update: puedeGestionarSeriales()                          // asignar desde seriales.html
          (transiciones cross-flujo las hace CF con Admin SDK — no requieren regla)
  delete: false                                             // nunca se borra; se da de baja

equipos_pool/{id}/movimientos/{mid}
  read:   isSignedIn()
  create: puedeGestionarSeriales()                          // append-only
  update, delete: false
```

- `baja` y edición de docs `verificado:false` ajenos: candado UI a
  admin/inventario (mismo patrón que el candado de seriales).
- Visibilidad de módulo: `inventario/equipos.html` para
  `administrador`, `inventario`, `gerente` (lectura), reutilizando `modulos.js` y
  el rail ("Almacén · finanzas").

---

## 6. Fases de implementación

| Fase | Contenido | Tamaño | Dependencias |
|---|---|---|---|
| **F1 — Fundación** | Colección `equipos_pool` + `EquiposPoolService` (calcado de `simCardsService`: normalizar, alta, import, asignar/liberar transaccional) + reglas + página `inventario/equipos.html` (tabs, KPIs, recibir, import, drawer Historia) | M | — |
| **F2 — Migración por contacto** | Extender `onSerialWrite` (upsert/liberar pool) + trigger entrega (`en_cliente`) + trigger órdenes (`en_taller`/`salida_taller`) + upsert desde alta POC. Todo idempotente, `verificado:false` | M | F1 |
| **F3 — Carga inicial** | Backfills `seedPoolDesde{Contratos,Poc,Ordenes}` con dry-run + reporte de conflictos/sospechosos + modo "toma inicial" en recepción + página/sección de conciliación | M | F2 |
| **F4 — Asignar desde pool** | Picker "Tomar del pool" en `seriales.html` (reserva transaccional) + selección de seriales devueltos al cerrar cancelación + inspección `devuelto_revision → en_bodega/baja` + autocompletar serial en `agregar-equipo.html` | M | F2 |
| **F5 — Endurecimiento** | Validación bloqueante en contratos nuevos + KPI de inventario derivado del pool + conteo manual → auditoría periódica + reglas endurecidas | S | conciliación en 0 (§4.4) |

F2 y F4 pueden solaparse; F5 no tiene fecha — la dispara la métrica de conciliación,
no el calendario.

## 7. Decisiones tomadas (con alternativa descartada)

1. **Doc ID = serial normalizado** (como `sim_cards`) y no auto-ID + campo único:
   dedup natural, transacciones simples. Costo: corregir un serial = borrar+crear
   (movimiento `correccion_serial` en ambos docs); el flujo `seriales_cambios`
   existente ya modela ese caso. Los seriales repetidos entre modelos distintos
   (caso Kenwood NX420/NX920) se cubren con el failsafe de colisión (§2.1): ID
   sufijado `{serial}__{modelo}` solo para el segundo doc + flag
   `serial_compartido` en ambos + búsqueda canónica vía campo `serial_norm`.
2. **Colección nueva, no extender `poc_devices`**: `poc_devices` modela la
   operación POC (IP, grupos, SIM), no el ciclo logístico; mezclar estados de
   bodega ahí contaminaría un módulo estable.
3. **El pool NO reemplaza `contratos/{id}/seriales`**: el registro contractual
   (PDF a activaciones, candado, historial) queda intacto; el pool es la capa
   física sincronizada por trigger. Cero riesgo para el flujo de activaciones.
4. **Cruces entre dominios server-side** (triggers Admin SDK): evita abrir reglas
   del pool a técnicos, y la consistencia eventual se vigila con la página de
   conciliación.
5. **Nunca bloquear por serial faltante durante la transición**: registrar +
   `verificado:false` > detener la operación. El endurecimiento llega al final.

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Seriales con grafías distintas entre dominios (espacios, guiones, mayúsculas) | `serial_norm` unifica; reporte de "sospechosos" en backfill; corrección con movimiento auditado |
| Seriales repetidos entre modelos (Kenwood NX420 vs NX920 con el mismo serial) | Failsafe de colisión (§2.1): segundo doc con ID sufijado, flag `serial_compartido`, lookups por campo `serial_norm` + modelo; validación de duplicados de la página de seriales debe comparar serial+modelo (hoy compara serial solo) |
| Doble asignación concurrente desde el picker | Transacción re-verifica `en_bodega` (patrón `sim-no-disponible` probado) |
| Triggers desincronizan pool vs contrato | Idempotencia + página de conciliación + acción `rebuildPool` futura en `runBackfill` si hiciera falta |
| Fatiga de captura en bodega | Input compatible con lector de código de barras; import Excel; alta por pegado multilínea |
| Equipos de clientes que jamás pasaron por bodega (taller externo) | Órdenes nunca bloquean; el doc queda `origen: migracion_orden` y no cuenta como stock |
| Cap de 1 MiB por doc | Movimientos en subcolección (no array embebido), sin límite práctico |
