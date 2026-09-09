# Entrega parcial de órdenes de REPARACIÓN + válvula de casos viejos

**Pedido:** 2026-09-09. "Quieren agregar una opción para entrega parcial de
órdenes de reparación. No estorbes el flujo actual, esto es una subrutina, no
lo principal." Después: "y sí, crea la válvula de decisión de inventario, para
órdenes que llevan más de 30 días, inclusive que no tengan entrega parcial —
tenemos que ir cerrando los casos."

**Alcance decidido:** solo `REPARACION`. Los mismos roles que ya entregan
(admin, recepción, vendedor, técnico, técnico_operativo, jefe_taller).

---

## 1. El problema

Hoy la entrega es **todo o nada**. El botón *Entregar* aparece en
`COMPLETADO (EN OFICINA)` y `confirmarEntrega` estampa
`estado_reparacion: 'ENTREGADO AL CLIENTE'` de una vez. De esa transición
cuelgan cuatro consumidores:

| Consumidor | Qué hace |
|---|---|
| `onOrdenWritePool.js:425` | manda **todas** las unidades `en_taller → en_cliente` |
| `onOrdenEntregada.js` | avisa al contrato (señal de facturación) |
| `firestore.rules:457` | exige QC aprobado + contrato firmado + anexo firmado + factura de venta |
| `pendientes.js` / KPIs / integridad | señales, conteos, "entregadas sin firma" |

Si el cliente se lleva 6 de 10, hoy no hay forma de registrarlo: o se entrega
todo (mentira: 4 radios siguen en el estante) o no se entrega nada (mentira:
6 radios ya están donde el cliente).

## 2. La forma elegida: tandas, espejo del acuse de devolución

El repo **ya resolvió este problema al revés**. La devolución se recibe por
tandas, cada una con su acuse numerado, firmado, imprimible y con copia al
cliente (`devolucion.esperados[]` + `devolucion.acuses[]`, ver
`ordenes-devolucion.js`), y desde 2026-09-09 la orden se cierra sola al
resolverse la última unidad. La entrega parcial es ese mismo patrón espejado.

### Regla de oro: no se inventa un estado de orden

Nada de `ENTREGADO PARCIAL`. Ese string obligaría a ~15 consumidores de
`estado_reparacion` a aprender un estado más. La orden **sigue en
`COMPLETADO (EN OFICINA)`** mientras quede algo por entregar.

**La última tanda no es una tanda: es la entrega normal de siempre.** La hoja
de entrega parcial solo deja marcar un subconjunto *estricto*; si marcas todo
lo pendiente, te dice que eso es la entrega completa y abre el modal de
siempre. Así `confirmarEntrega` sigue siendo el **único** camino de cierre y
`registrarTandaEntrega` **nunca toca `estado_reparacion`**.

### Dónde vive

En el menú ⋯ de la fila: **"Entregar solo algunos equipos"**. El botón
*Entregar* no se mueve ni cambia. Quien no use la subrutina no se entera de
que existe.

### Dato nuevo (aditivo, un solo campo)

```js
entrega: {
  tandas: [{
    n: 1,
    numero: '2026090812-E1',
    fecha, por_uid, por_email,
    receptor_nombre, receptor_cedula, firma_url,
    sin_id, sin_id_motivo, notas,
    equipos: [{ id, serial, modelo }]
  }]
}
```

`entregados = union(tandas[].equipos[].id)`. Pendientes = equipos activos que
no están en esa unión.

### Los candados no se relajan

La subrutina reusa la misma cadena de `entregarOrden`
(`ordenes-flujo.js:456`): QC aprobado, contrato firmado, anexo firmado,
factura de venta. Se extrae a un `puedeEntregar(orden)` que llaman los dos
caminos, para que no se puedan separar nunca.

### Cambios de fondo — dos, ambos calcados de algo que ya existe

1. **`onOrdenWritePool.js`** — rama de "tandas nuevas" (igual que la de
   `acuses` nuevos en `onOrdenDevolucionWrite`) que manda a `en_cliente`
   **solo los seriales de esa tanda**.
   *La rama de `entregadaAhora` no se toca*: sus `soloDesde: [EN_TALLER]` +
   `condicion: orden_actual_id === ordenId` hacen que las unidades ya
   entregadas en una tanda simplemente no se muevan dos veces. Lo mismo
   protege la rama de "equipos removidos".
2. **`firestore.rules`** — `entregaTandasOk()`, en la línea de
   `devolucionAppendOnly()`: las tandas solo crecen, y sumar una exige los
   mismos candados que entregar del todo (COMPLETADO + QC + contrato firmado +
   anexo + factura).

### Lo que NO se toca

La máquina de estados, el QC (el array `equipos` nunca cambia, así que
`qcCubreLosEquipos()` sigue cuadrando), `onOrdenEntregada`, facturación, el
modal de entrega actual, el correo de nota de entrega.

### Por qué no se reusó `dividirOrden`

Sacar los equipos listos a una orden hermana parece gratis, pero mutar el
array `equipos` de una orden viva:

- **caduca el QC** (`qc.equipos_n` deja de cuadrar) y re-estampar `qc` exige
  jefe de taller o admin — justo quien no está en el mostrador;
- hace que el pool **devuelva los equipos al origen** con movimiento de kardex
  (`onOrdenWritePool.js:451`) antes de que la hija los vuelva a jalar: dos
  movimientos falsos por radio y una carrera entre triggers. Hoy no pasa
  porque solo se dividen ENTRADAs, que salen temprano del trigger;
- obliga a mover la subcolección `consumos` a mano;
- le deja al cliente tres números de orden para un solo trabajo.

---

## 3. La válvula: cerrar casos viejos

### El malentendido que hay que evitar

Las **67 órdenes acumuladas** que motivaron la señal "lista para entregar"
(`pendientes.js:88`) **no** son casos de "el cliente no vino". El comentario
dice que quedan así porque *nadie las marcó*. Una válvula que asuma "el radio
sigue en el estante" y lo mande a inventario metería una mentira grande:
radios que están donde el cliente, marcados como en nuestra repisa.

**La válvula pregunta, no asume.** Cada caso viejo tiene dos puertas, y una
de las dos ya existe.

### Bandeja "Casos viejos"

Órdenes de `REPARACION` en `COMPLETADO (EN OFICINA)`, no eliminadas, con
`fecha_completado` de hace **≥ 30 días**. Incluye las que nunca tuvieron
entrega parcial. Cada fila ofrece:

**Puerta A — "Ya se entregó, no se marcó"** → entrega retroactiva. Es el
camino que **ya existe**: `no_recibido` (firma en papel, `ordenes-flujo.js:1553`),
que pide motivo y quién recibió. La orden cierra `ENTREGADO AL CLIENTE` y el
pool manda las unidades a `en_cliente`, que es la verdad.

**Puerta B — "Sigue aquí, el cliente no vino"** → cierre por no retiro:

- la orden pasa a **`CERRADA (SIN RETIRAR)`** (terminal nuevo de la familia
  `CERRADA (…)` que ya existe: VISITA, DEVOLUCION, ENTRADA — 19 referencias
  en 8 archivos fue el costo del último), con
  `sin_retirar: { fecha, por_uid, por_email, motivo, contactos, equipos[] }`;
  motivo obligatorio;
- las unidades pendientes pasan a **`no_retirado`** en el pool, con
  `orden_actual_id: null` y movimiento de kardex con ref a la orden.

### Por qué un estado de pool nuevo y no `en_taller`

Un radio `en_taller` sin orden viva es **invisible** — es exactamente el error
que ya los quemó. El propio repo dejó escrito el criterio al crear
`pendiente_cobro`:

> "Es una ubicación real —está con el cliente— pero NO puede seguir viéndose
> como `en_cliente`: ahí se confunde con un radio sano de un contrato vivo y
> nadie lo vuelve a mirar. Así se perdieron los 4 radios del finiquito de TIL
> PANAMA."

`no_retirado` es la misma figura: ubicación real (nuestro estante), custodia
nuestra, **propiedad del cliente** — por eso no puede ser `en_bodega`, que
diría que es nuestro y disponible. Costo medido: `pendiente_cobro` vive en 4
archivos con 8 referencias.

Puertas de salida explícitas, como `pendiente_cobro`:

| Puerta | Destino | Quién |
|---|---|---|
| El cliente lo retiró | `en_cliente` | inventario / admin |
| Era flota nuestra, vuelve a bodega | `en_bodega` (`verificado: false`) | inventario / admin |
| Abandonado | `baja` | solo admin |

Las tres viven en la barra de acciones en lote de **Inventario · Equipos por
serial** (cola nueva "Sin retirar") y **las tres exigen motivo**: si sacar algo
de aquí fuera un clic sin explicación, esto se volvería otra gaveta donde
"limpiar la lista", que es justo lo que la válvula viene a evitar.

**La puerta "el cliente lo retiró" NO captura firma.** La orden que amparaba
esos equipos ya está cerrada, así que el rastro es el motivo (quién retiró y
cuándo) más la autoría y el kardex. Pedir firma aquí obligaría a reconstruir el
modal de entrega dentro de Inventario. Si en un caso concreto hace falta papel
firmado, lo correcto es no usar esta puerta y abrir una entrega.

### Lo que la válvula NO hace

No decide sola. No hay job que cierre casos automáticamente: una persona mira
el caso y elige la puerta. El cron solo *lista*.

---

## 4. Fases

**F1 — Entrega parcial funcionando** ✅ hecha 2026-09-09
- `public/js/pages/ordenes-entrega-parcial.js` (módulo diferido, registrado en
  `core/carga-diferida.js` junto a `dividir`)
- `OrdenesService.registrarTandaEntrega`
- `puedeEntregar(orden)` extraído en `ordenes-flujo.js`, usado por los dos caminos
- rama de tandas en `onOrdenWritePool.js`
- `entregaTandasAppendOnly()` en `firestore.rules`
- contador "6 de 10 entregados" en la fila y en "Ver entrega"

**F2 — El papel de la tanda**
- nota de entrega parcial numerada `{ordenId}-E{n}`, imprimible y con copia al
  cliente, y firma en tablet — reusando la maquinaria de acuses de devolución
  (`firmas_tablet`, cola de correo, `emailRenderer`)

**F3 — Válvula y bandeja de casos viejos** ✅ hecha 2026-09-09
- estado de pool `no_retirado` (label, chip violeta, cola propia en Inventario)
  y sus tres puertas de salida en lote
- terminal `CERRADA (SIN RETIRAR)` en rules, estados, conciliación y filtros
- hoja "Casos viejos" (≥30 días) en el ⋯ de Órdenes, con las dos puertas
- `EquiposPoolService.retiradoPorCliente` / `noRetiradoABodega`;
  `OrdenesService.cerrarSinRetirar`

Pendiente de F3: la señal "lista para entregar" (`pendientes.js`) sigue
contando los casos viejos como cola de entrega. No estorba —los casos se
cierran desde la hoja y desaparecen solos— pero mientras queden abiertos siguen
sonando en el recordatorio diario. Separarlos exige tocar `pendientes.js`, que
está DUPLICADO front/functions con un test de paridad; se deja para cuando haya
números reales de cuántos casos quedan de verdad.

---

## 5. Hallazgo: el tope de evaluación de las reglas

Midiendo las reglas nuevas contra el emulador apareció algo **previo a este
trabajo** y que conviene tener anotado:

> El match de `ordenes_de_servicio` llega al tope de Firestore —
> `maximum of 1000 expressions to evaluate` — en los caminos de **denegación**.
> Pasa incluso con una transición ilegal que falla en el PRIMER guard
> (`ordenTransicionLegal`), sin tocar nada de la entrega parcial.

Qué significa y qué no:

- **No rompe nada hoy.** Falla cerrado: la escritura se deniega igual. Y las
  escrituras legítimas sí completan la evaluación — se comprobó con órdenes de
  3 y de 30 equipos, con y sin tandas.
- **Sí invalida los `assertFails` contra el ruleset completo.** Una denegación
  que llega al tope se habría producido igual sin el candado, así que no prueba
  el candado. Por eso las reglas de la entrega parcial se prueban aparte, con
  el `allow update` recortado, en
  `functions/test-emulator/rules-entrega-parcial.js` (9 grupos). Los casos de
  `rules.js` quedan como smoke test, con la advertencia escrita al lado.
- **Es deuda que va a cobrar.** El presupuesto se gasta más rápido conforme
  crece la cadena de guards. Antes de sumar el siguiente candado a este match
  conviene abaratar lo que ya está (`ordenTransicionLegal` es la parte cara).

Por eso `entregaTandasOk()` es **una** función con `let` y no dos: partirla
volvía a leer los mismos arrays cuatro veces.

## 6. Decisiones tomadas

| Decisión | Valor |
|---|---|
| Tipos | solo `REPARACION` |
| Roles | los mismos que ya entregan |
| Estado de orden para parcial | **ninguno nuevo** — sigue `COMPLETADO` |
| Camino de cierre | uno solo: `confirmarEntrega` |
| Umbral de caso viejo | 30 días desde `fecha_completado` |
| Cierre automático | **no** — la válvula la acciona una persona |
