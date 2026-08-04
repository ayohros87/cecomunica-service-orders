# Auditoría de UI — sistema de equipos por serial

**Fecha:** 2026-08-04
**Alcance:** todo lo que el operador toca del pool `equipos_pool`: captura de seriales,
chips de estado, ficha del equipo, y la página Inventario · Equipos por serial.
**Motivo:** "hay muchos botoncitos, es muy difícil entender para qué sirve cada cosa
y cómo se supone que se usa el sistema".

Esta auditoría es de **comprensibilidad**, no de corrección: el backend y las reglas
no se cuestionan aquí. Lo que sigue son hallazgos verificados en código, con archivo
y línea, ordenados por impacto sobre la persona que usa el sistema.

---

## 0. Mapa: qué es "el sistema de seriales" hoy

Una unidad física = un doc en `equipos_pool` (ID = serial normalizado, o
`serial__modeloKey` si hay colisión entre modelos).

**9 estados** (`equiposPoolService.js:21-48`):
`en_bodega` · `asignado_contrato` · `en_cliente` · `en_taller` ·
`devuelto_revision` · `por_clasificar` · `vendido` · `baja` · (`en_poc`, histórico).

**10 puntos donde un humano escribe o pega un serial:**

| # | Superficie | Archivo | ¿Avisa el pool? |
|---|---|---|---|
| 1 | Asignar seriales del contrato | `contratos/seriales.html` | ✅ SerialField |
| 2 | Agregar equipo a orden | `ordenes/agregar-equipo.html` | ✅ SerialField |
| 3 | Nuevo batch de órdenes | `ordenes/nuevo-batch.html` | ✅ SerialField |
| 4 | Editar device POC | `POC/index.html` (`poc-edit.js`) | ✅ SerialField |
| 5 | Devolución · captura libre | `ordenes-devolucion.js:441` | ⚠️ SerialField sin contexto |
| 6 | Devolución · check-in por modelo | `ordenes-devolucion.js:486` | ❌ |
| 7 | **Editar Serie en la tabla de órdenes** | `ordenes-render.js:541` | ❌ |
| 8 | Transición de equipos | `contratos/transicion.html` | n/a — no se teclea serial |
| 9 | Nuevo batch POC / Importar POC | `POC/nuevo-batch.html`, `importar-poc.html` | ❌ |
| 10 | Recibir / Importar Excel / Registrar venta | `inventario/equipos.html` | ❌ (textareas) |

> **Corrección tras implementar (§E):** la fila 8 estaba mal clasificada. La
> página de transición **no captura seriales**: mapea unidades que ya existen en
> el pool, con checkboxes (`contrato-transicion-page.js:173,369`). No hay campo
> que decorar, así que no es un hueco.

Ese cuadro es, por sí solo, la raíz de la queja: **el mismo acto (teclear un serial)
se comporta de cinco maneras distintas según en qué pantalla estés.**

---

## A. Hallazgos estructurales

### A1 · Nueve estados, tres vocabularios visuales, ninguno completo — `por_clasificar` sale invisible

Hay tres tablas de colores para el mismo estado:

- `ESTADO_LABELS` — 9 estados (`equiposPoolService.js:38-48`)
- `.eqpool-chip-*` — **7** (`css/ceco-ui.css:2236-2243`): falta `por_clasificar` y `en_poc`
- `.eq-badge-*` — **8**, local de la página (`inventario/equipos.html:25-34`): falta `en_poc`

`chipEstadoHtml` (`equiposPoolService.js:232-237`) y SerialField
(`serial-field.js:128`) sólo aplican la clase si el estado está en `ESTADO_LABELS`
— y `por_clasificar` sí está. Resultado: emiten `eqpool-chip-por_clasificar`,
**clase que no existe en el CSS**. La unidad se pinta sin fondo ni color.

Dónde se nota: ficha del equipo (`equipo-ficha.js:119`), tabla de órdenes
(`ordenes-render.js:666`), panel de equipos del contrato (`contratos-equipos.js:167`),
ficha de cliente (`nuevo-cliente.js:207`), transición (`contrato-transicion-page.js:176`),
y el chip junto a cada input decorado.

Es decir: **el único estado que significa "hay que ir a buscar físicamente este radio"
es el que menos se ve** — salvo en Inventario · Equipos, la única página que tiene su
propia paleta con rosa `#ffe4e6` y un comentario explicando por qué debe destacar
(`equipos.html:30-32`).

### A2 · "Entrada" nombra tres cosas distintas

- Estado del pool `devuelto_revision` → etiqueta **"Entrada (por inspeccionar)"** (`equiposPoolService.js:44`), pestaña **"Entradas"** (`equipos.html:213`).
- **ENTRADA** es además un *tipo de orden* del taller.
- **DEVOLUCIÓN** es el tiquete previo, otra cosa más.

El operador ve tres palabras vecinas para tres conceptos que en su cabeza son "el
radio volvió". Además el dato crudo (`devuelto_revision`) no se parece a ninguna de
las tres, lo que rompe la búsqueda y la lectura de exportaciones.

### A3 · "Condición" dicha de tres formas, y un campo `estado` que no es el estado

- DB: `condicion: 'nuevo' | 'reuso'`
- UI: **"Nuevo" / "Refurbished"** (`equipos.html:298-300`, `inventario-equipos.js:181`)
- Fuga: el confirm de Inspección OK dice *"regresa a bodega como disponible
  (condición: **reuso**)"* (`inventario-equipos.js:667`) — vocabulario interno en
  pantalla, justo en el punto donde el usuario decide.
- Encima, el catálogo de modelos usa un campo llamado `estado` con valores `N`/`R`
  (`inventario-equipos.js:160-166`) que **no tiene nada que ver** con el `estado` del
  pool. Dos campos homónimos y ortogonales.

### A4 · Una sola condición ("este serial está en 2+ fichas"), cuatro nombres

| Dónde | Texto |
|---|---|
| Fila de inventario | **2+ MODELOS** (`equipos.html:530`) |
| Ficha del equipo | **2+ MODELOS** (`equipo-ficha.js:122`) |
| Chip junto al input | **⚠ N fichas con este serial — elegir** (`serial-field.js:115`) |
| Revisión al guardar seriales | **modelo distinto en el pool** (`contrato-seriales-page.js:898`) |
| Pestaña de inventario | **Conflictos** (`equipos.html:216`) |
| Filtro toggle | **2+ modelos** (`equipos.html:237`) |

Nada le dice al usuario que las seis se refieren al mismo `serial_compartido`.

---

## B. Hallazgos de botones (la queja directa)

### B1 · Inventario · Equipos: hasta 7 botones sólo-icono por fila, y el juego cambia en cada fila

`inventario-equipos.js:533-542`. Por fila pueden aparecer:

| Icono | Acción | Visible cuando |
|---|---|---|
| `history` | Historia (kardex) | siempre |
| `badge-check` | Marcar verificado | `verificado === false` |
| `pencil` | Editar ficha | escritura |
| `check-circle-2` | Inspección OK → bodega | `devuelto_revision` |
| `banknote` | Registrar venta | `en_bodega` |
| `archive-x` | Dar de baja | no baja/vendido |
| `archive-restore` | Revivir | `baja` |
| `pencil-ruler` | Corregir estado de migración | origen migración + 3 estados |

Tres problemas encadenados:

1. **Cero texto.** Todo el significado vive en `title=`, que en escritorio tarda ~1 s
   en aparecer y en táctil no aparece nunca.
2. **Iconos casi gemelos con semántica opuesta:** `pencil` vs `pencil-ruler`
   (editar ficha vs. mover a bodega), `archive-x` vs `archive-restore` (baja vs.
   revivir). A 16 px son el mismo garabato.
3. **La columna no es escaneable.** Como el conjunto depende del estado, el botón
   en la 3ª posición significa algo distinto en cada fila. El usuario no puede
   aprender una posición, así que **lee ocho iconos en cada fila, siempre**.

Lo importante: **este proyecto ya resolvió esto en otro módulo.**
`contratos-list.js:87-231` implementa *una CTA primaria contextual + menú `⋯` con
icono **y** texto*, con precedencia documentada (`contratos-list.js:127-156`). La
tabla de equipos es el caso donde más falta hace y es el único que no lo usa.

### B2 · La misma acción en dos sitios, con dos comportamientos y el mismo nombre

"Registrar venta" está en el menú del topbar sin argumento —abre el modal con textarea
multi-serial— (`equipos.html:154`) **y** como icono de fila con el serial precargado
(`inventario-equipos.js:538` → `abrirVenta(id)`, `inventario-equipos.js:790`).
Misma etiqueta, dos modos, ninguna pista de que uno es el otro con un serial ya puesto.

Igual pasa con **Recargar**: botón en la barra de filtros (`equipos.html:242`) además
del ciclo de recarga automático tras cada acción (`cargar()` al final de cada handler).

### B3 · Estados vacíos que enseñan acciones que el lector no puede ejecutar

Los textos de pestaña vacía (`inventario-equipos.js:493-501`) son excelentes — explican
qué cae en cada pestaña y qué la alimenta. Pero se muestran igual al rol `gerente`,
que tiene lectura y **no** escritura (`inventario-equipos.js:1342-1353`): le dicen
"entran con *Recibir equipos* / *Importar Excel*", botones que la propia página le
acaba de borrar del topbar.

### B4 · Asignar seriales: seis maneras de llenar el mismo campo, todas del mismo peso visual

En `contratos/seriales.html` conviven:

1. Teclear
2. Pegar sobre la primera casilla (reparte en cascada — `contrato-seriales-page.js:397-404`);
   **sólo se explica en el párrafo de intro**, `seriales.html:83-86`
3. **Pegar columna** por grupo de modelo (`contrato-seriales-page.js:182`)
4. **Tomar del pool (bodega)** (`:207`)
5. **Jalar desde POC** (`:208`)
6. **Jalar desde órdenes** (`:209`)

Las tres últimas son `btn btn-ghost btn-sm` idénticos, en fila, sin jerarquía. Pero
**"Tomar del pool" es la correcta en el flujo normal** (reserva unidades reales de
bodega); "Jalar desde POC/órdenes" son rutas de recuperación y de registro histórico
(legacy). Nada en la pantalla lo dice.

Y el pie puede mostrar hasta **cuatro** botones —*Guardar reemplazo*, *Editar seriales*,
*Guardar*, *Confirmar y enviar a activaciones*— (`seriales.html:99-102`) gobernados por
tres modos × permisos en `aplicarCandado` (`contrato-seriales-page.js:239-285`). La
lógica es correcta y está bien comentada; el problema es que **el usuario tiene que
inferir en qué modo está** a partir de qué botones sobrevivieron.

### B5 · El único paso irreversible sigue siendo un `window.confirm` pelado

`contrato-seriales-page.js:627`:

```js
if (!window.confirm('¿Confirmar los seriales y enviar a activaciones? ...')) return;
```

Después de todo el trabajo de la auditoría 2026-07-24 —que reemplazó el confirm de
texto plano por el panel operable "Revisión antes de guardar" (`:919-960`)— **la acción
que sí dispara correo a activaciones y cierra el ciclo** se confirma con un diálogo del
navegador que no muestra ni cuántos seriales van, ni a quién, ni qué se envía.

### B6 · El aviso del pool cubre 5 de 10 puntos de captura

Ver tabla del §0. Los tres huecos que más cuestan:

- **Editar Serie en la tabla de órdenes** (`ordenes-render.js:541`, lápiz inline) — es
  la edición de serial más frecuente de la app y no tiene ninguna validación contra el
  pool. El chip de estado que se ve ahí (`ordenes-render.js:665-676`) es **decoración
  de lectura**, no valida lo que escribes.
- **Check-in por modelo en devoluciones** (`ordenes-devolucion.js:486`): se recibe
  físicamente un radio sin el aviso "este serial figura con otro cliente".
- **Captura libre de devolución** sí adjunta SerialField, pero con opciones vacías:
  `SerialField.adjuntar(inpLibre, {})` (`ordenes-devolucion.js:691`). Sin `clienteId`
  ni `modelo`, los chips "⚠ otro cliente" y "modelo distinto" **no pueden dispararse
  nunca** — justo en el flujo que el comentario de arriba (`:686-688`) describe como
  "clave cuando llegan radios revueltos de varios clientes".

### B7 · La persona cuyo trabajo es asignar seriales no puede navegar a la página

- `gestionar-seriales` = admin, recepcion, vendedor, gerente, **inventario** (`roles.js:34`)
- Módulos visibles del rol `inventario` = `[inventario, equipos, piezas, firma]` — **sin `contratos`** (`modulos.js:22`)
- Pero la página vive en `/contratos/seriales.html`, su botón Volver apunta a
  `contratos/index.html` (`seriales.html:54`), el breadcrumb dice *Contratos*
  (`seriales.html:66`) y el rail se inicializa como `Layout.initRail('contratos')`
  (`seriales.html:112`).

Resultado: llega **sólo por link de correo**, y las tres salidas visibles de la pantalla
apuntan a un módulo que no tiene. En espejo, `recepcion` y `vendedor` pueden asignar
seriales pero no pueden abrir Inventario · Equipos para ver el pool
(`inventario-equipos.js:1342`).

---

## C. Lo que ya está bien — no tocar

- **SerialField** como decorador único con chip persistente (`ui/serial-field.js`): la
  idea correcta; el problema es cobertura, no diseño.
- **EquipoFicha** legible por cualquier rol autenticado (`ui/equipo-ficha.js:1-17`):
  resuelve el callejón sin salida que tenían técnicos/recepción.
- **Tira del ciclo** en `equipos.html:193-204`: enseña el flujo completo en una línea
  con el mismo lenguaje de chips.
- **Estados vacíos que explican la pestaña** (`inventario-equipos.js:493-501`).
- **Barra "Viendo: …"** con chips de filtro activo y "Limpiar todo" (`:425-446`).
- **`contratos-list.js`** — el patrón CTA + `⋯` que el resto debería copiar.

---

## D. Recomendaciones, por relación beneficio/riesgo

| # | Cambio | Dónde | Riesgo |
|---|---|---|---|
| **R1** ✅ | Reemplazar los 7 iconos por **1 CTA contextual + menú `⋯` con icono y texto**, copiando `contratos-list.js:87-231`. Precedencia sugerida: Inspección OK → Corregir estado → Verificar → Registrar venta → (resto al menú). | `inventario-equipos.js:533-542` | bajo |
| **R2** ✅ | **Un solo vocabulario de chips**: borrar `.eq-badge-*` de `equipos.html`, usar `.eqpool-chip` en la tabla, y agregar `por_clasificar` y `en_poc` a `ceco-ui.css:2236`. | `ceco-ui.css`, `equipos.html:19-34` | bajo, arregla A1 |
| **R3** ✅ | Adjuntar SerialField en los 5 puntos que faltan y pasarle `clienteId`/`modelo` en devoluciones. | `ordenes-render.js:541`, `ordenes-devolucion.js:486,691`, transición, batches POC | medio |
| **R4** ✅ | Jerarquizar el llenado en Asignar seriales: **"Tomar del pool" primario**, POC/órdenes bajo "Otras fuentes ▾", y subir el truco de pegar-en-cascada del párrafo al propio campo. | `contrato-seriales-page.js:203-211` | bajo |
| **R5** ✅ | Sustituir el `window.confirm` de "enviar a activaciones" por una hoja de resumen (N seriales, cliente, contrato, qué correo sale). | `contrato-seriales-page.js:627` | bajo |
| **R6** ✅ | Glosario de una palabra por concepto y aplicarlo: Entrada/Devolución/ENTRADA (A2), reuso→Refurbished (A3, fuga en `:667`), un solo nombre para `serial_compartido` (A4). | transversal | bajo |
| **R7** ✅ | Arreglar la navegación del rol `inventario`: que Volver/breadcrumb/rail de `seriales.html` lleven a un módulo que sí tenga. | `modulos.js:22` o `seriales.html:54,66,112` | bajo |

**Orden sugerido:** R2 → R1 → R5 → R4 → R7 → R6 → R3.
R2 primero porque es CSS y arregla un estado invisible en seis páginas; R1 es el que
responde literalmente a "muchos botoncitos"; R3 se deja al final porque toca la tabla
de órdenes, que es la superficie más caliente del sistema.

---

## E. Implementación — 2026-08-04

Las siete recomendaciones quedaron implementadas el mismo día. Qué cambió, por punto:

**R2 · Un solo vocabulario de chips.**
`ceco-ui.css` completa los 9 estados (agrega `por_clasificar` en rosa y `en_poc`),
suma `.eqpool-chip-lg` para tablas y sube `.eqpool-compartido` / `.eqpool-prop-*` al
kit. La paleta local `.eq-badge-*` / `.eq-prop-*` / `.eq-noverif` desapareció de
`equipos.html`, que ahora usa `chipEstadoHtml` como el resto.
→ `por_clasificar` ya no sale sin fondo en ninguna página.

**R1 · Acciones de fila.**
`EquiposPool._accionesHtml(eq, puede)` construye **una CTA con etiqueta** + menú `⋯`
con icono y texto, reutilizando `.overflow-menu*` del kit. Precedencia de la CTA:
Inspección OK → Corregir estado → Verificar → Revivir → Historia. Cierre del menú por
click-fuera/ESC igual que en contratos. La columna pasó a 210 px y las CTA llevan
`white-space:nowrap`.
→ De 7 iconos mudos por fila a 1 botón que dice el siguiente paso.

**R5 · Envío a activaciones.**
`hojaConfirmarEnvio()` sustituye el `window.confirm`: muestra contrato, cliente,
conteo por modelo, unidades sin serial, y advierte que se dispara el correo y se echa
el candado. El `window.confirm` desapareció de la página.

**R4 · Llenado de seriales.**
"Tomar del pool (bodega)" es ahora **primario**; "Jalar desde POC" y "Jalar desde
órdenes" viven en un desplegable **"Otras fuentes ▾"**. El truco de pegar en cascada
se dice junto a los botones, no enterrado en el párrafo de intro.

**R7 · Salidas de la página de seriales.**
Volver, breadcrumb y rail se resuelven por rol: para `inventario` los tres apuntan a
Inventario · Equipos en vez de a la lista de Contratos, que no puede abrir.

**R6 · Una palabra por concepto.**
`devuelto_revision` pasa de "Entrada (por inspeccionar)" a **"Devuelto · por
inspeccionar"** (pestaña "Por inspeccionar", señal del home y asunto del correo de
cuarentena incluidos) — "ENTRADA" queda reservado para el tipo de orden, y hay un
glosario desplegable en la página que separa las tres palabras. `reuso` ya no se
filtra a pantalla ("Refurbished" en todas partes). `serial_compartido` se llama
**"2+ modelos"** en la fila, en la ficha y junto al input.

**R3 · Señal del pool donde faltaba.**
- `Modal.prompt` acepta `onMount(input)`, y el lápiz de Serie de la tabla de órdenes
  lo usa para adjuntar SerialField con cliente y modelo — el punto de captura más
  usado de la app dejó de ser el único sin validación.
- Devoluciones: el input libre ya recibe `clienteId`/`modelo` (antes se adjuntaba con
  `{}`, así que "otro cliente" **no podía dispararse**), y los campos de check-in por
  modelo se decoran también.
- Batch POC: el preview avisa qué seriales del lote **figuran con otro cliente**, con
  link a la ficha. Es el equivalente masivo de SerialField; el modelo lo sigue
  mandando el contrato.

**Guardias.** `functions/test/poolChipsYAcciones.test.js` (6 tests, en `npm test`)
congela los dos invariantes que se rompen solos: que todo estado de `ESTADO_LABELS`
tenga su color en `ceco-ui.css`, y que la columna de acciones no vuelva a ser un muro
de iconos sin etiqueta. Verificado que fallan al reintroducir cada defecto.
