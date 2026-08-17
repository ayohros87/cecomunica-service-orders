# Plan — El asistente de bodega pregunta QUÉ se está haciendo

Estado: **IMPLEMENTADO** 2026-08-17, sin desplegar. Las seis intenciones están en
`public/js/ui/asistente-importar.js`; el movimiento de conteo en
`InventarioService.moverConteo` y `EquiposPoolService.mandarAPorClasificar`.
Pruebas: `functions/test/asistenteIntenciones.test.js` (24) y
`functions/test/inventarioMoverConteo.test.js` (9).

Queda vivo el §8 (lo que este plan NO resuelve).

## 1. El problema, con el caso que lo destapó

El 2026-08-14 bodega tenía que pasar 32 seriales de `VM686` a `PD686`. Abrió el
asistente, cargó la hoja, y el asistente le dijo que los 32 eran **colisiones de
serial** — "ya registrado como HYTERA VM686, marca solo si de verdad es otro
equipo que comparte numeración". La única casilla en pantalla creaba 32 fichas
duplicadas.

No las marcó. Cerró el asistente y editó las 32 fichas a mano, una por una,
entre las 20:53 y las 21:27. Después escribió preguntando si había quedado bien.

Había quedado bien a medias:

- Las 32 fichas quedaron correctas, pero por `actualizar`, que **no escribe
  kardex**: su historia decía "Toma física inicial" y nada más. Reconstruido el
  2026-08-17 con `backfill-kardex-modelo-editado.js`.
- El **conteo físico de VM686 siguió en 32** con una sola ficha viva: una
  diferencia fantasma de −31 que nadie podía cerrar desde la UI. Corregido a
  mano el 2026-08-17 con `ajusta-conteo-inventario.js`.

Ninguno de los dos desperfectos es un bug del asistente. Son la consecuencia de
que el asistente **no tiene forma de que le digan qué se está intentando hacer**.

## 2. Por qué no se resuelve adivinando

La tentación es que el asistente deduzca la intención. Se descartó, y vale la
pena dejar por escrito por qué:

**Los dos casos son idénticos en los datos.** "El serial X existe bajo otro
modelo" significa o bien *el mismo radio con el código mal puesto* (VM686→PD686)
o bien *dos radios físicos distintos que comparten numeración* (el caso Kenwood
NX-420 / NX-920, que es la razón de que exista el failsafe de colisión). En
Firestore se ven exactamente igual. Lo único que los distingue es alguien con el
radio en la mano leyendo la etiqueta.

**Y una regla por mayoría empeora el caso parcial.** Se consideró usar la forma
del lote como señal (32 de 32 apuntaban al mismo modelo de origen: señal
fortísima). Se descartó: lo normal es que solo *parte* de un lote esté mal
codificada, y una regla de mayoría acertaría en el caso fácil y fallaría con
confianza en el difícil. Equivocarse callado es peor que no opinar.

Con la intención declarada, el caso parcial se expresa solo: si son 12 de 32,
bodega manda un archivo con 12 seriales. No hace falta ninguna regla.

## 3. Lo que la gente hace de verdad — evidencia

De los 78 scripts en `functions/scripts/`, éstos toman *una lista de seriales de
bodega* y hacen una cosa. Cada uno existe porque la UI no llegaba:

| Operación | Script | Hoy en el asistente |
|---|---|---|
| Ingresar lo contado en bodega | `ingresa-bodega-lista` | ✅ |
| Alta respetando el failsafe de colisión | `alta-bases-por-conteo` | ✅ |
| Alta como equipo distinto que comparte serial | `alta-colision-lista`, `marca-radios-distintos` | ⚠️ casilla dentro de otro flujo |
| **Cambiar de código (modelo)** | `repunta-modelo-lista`, `fix-seriales-pnc360s-reuso` | ❌ inalcanzable entre familias |
| **Mover el conteo de una fila a otra** | `mueve-conteo-inventario` | ❌ |
| Corregir propiedad | `corrige-propiedad-lista` | ⚠️ fija, siempre → cecomunica |
| Anotar con texto libre | `anota-lista` | ⚠️ solo la cadena "DAÑADA" |
| Traer a bodega desde otra ubicación | `fix-seriales-pnc360s-a-bodega` | ✅ |
| Mandar a `por_clasificar` | `mueve-a-por-clasificar-lista` | ❌ |
| Marcar verificado | `marca-verificado-lista` | ⚠️ implícito |
| Corregir seriales mal tecleados | `fix-serial-truncado` | ⚠️ detecta, no aplica en lote |
| **Solo verificar, sin escribir** | `verifica-seriales-lista` | ❌ |

El kardex de producción confirma que no son hipótesis. Movimientos por origen:

```
reclasificacion       1643   100% script,  0% UI
correccion_modelo      299    243 script, 54 UI
alta_manual            832    570 script, 257 UI
conteo_fisico          539    415 script, 108 UI
```

Donde el asistente llega, bodega se atiende sola. Donde no llega, escala.

Hay además **146 ediciones de ficha hechas por personas sin dejar kardex** (por
`actualizar`), en tandas pequeñas entre julio y agosto de 2026. Ésa es la medida
del hueco: cada una es alguien resolviendo a mano algo que el asistente no
ofrecía.

## 4. La intención como paso 0

El asistente pasa de *un* flujo con casillas por fila a *seis* flujos, elegidos
antes de cargar el archivo. La intención decide tres cosas que hoy están fijas:
cómo se clasifica cada serial, qué acciones se ofrecen, y **qué efectos
colaterales arrastra la operación**.

Ese tercer punto es el argumento de fondo, y es independiente del problema de
adivinar. "Reclasificar esta ficha" es un hecho de una fila. "Y por lo tanto el
conteo de la fila que acabas de vaciar quedó mal" es un hecho de la *operación
completa*. Una casilla por fila no puede saberlo; una intención sí. Es
exactamente lo que se escapó el 14 de agosto.

### Las seis intenciones

**1 · "Conté este estante"** — el flujo de hoy, sin cambios.
Un modelo + la lista de todo lo que hay físicamente. Da de alta, trae a bodega,
completa el modelo, corrige propiedad, fija el conteo.

**2 · "Estos están con el código equivocado"** — el caso VM686.
Pregunta el modelo **destino** (obligatorio) y el de **origen** (opcional, para
acotar). Un serial encontrado bajo otro modelo es *confirmación*, no colisión.
Efecto colateral incluido: mueve el conteo, destino `+n` y origen `−n`.
Escribe por `reclasificarModelo` (kardex `correccion_modelo`).

**3 · "Estos son otros equipos que comparten numeración"** — el caso Kenwood.
Lo que hoy es una casilla se vuelve una intención declarada, porque afirmarlo es
serio: crea fichas nuevas con id sufijado. Escribe por `recibir` con
`confirmarColisiones`.

**4 · "Estos los tengo yo"** — custodia y ubicación.
Trae a bodega desde `REUBICABLES_DESDE`, o manda a `por_clasificar`. Sin tocar
modelo ni propiedad.

**5 · "Anota esto en estos equipos"** — nota de texto libre.
Hoy solo existe la cadena fija "DAÑADA". Escribe por `anotar`.

**6 · "Solo quiero revisar"** — corre el paso 2 y para.
No escribe nada, nunca. Es `verifica-seriales-lista` con cara de pantalla, y
sirve para que bodega compruebe una hoja antes de comprometerla.

Las intenciones 2 y 3 son precisamente las dos lecturas que hoy colapsan en
`clase: 'colision'`, ahora separadas porque bodega dice cuál es. No queda
inferencia en ninguna parte.

## 5. Qué se toca en el código

El asistente son 693 líneas y la mayor parte se conserva. El corte limpio está
en la clasificación.

**Se conserva tal cual:** el parseo de CSV/XLSX con BOM y `;`
([:152](../../public/js/ui/asistente-importar.js#L152)), la detección de columnas
por seriales distintos ([:229](../../public/js/ui/asistente-importar.js#L229)),
la deduplicación, `SerialPatron`, el bucle de aplicación con su barra de
progreso, y la regla de la casa: nada se escribe desde el paso 1.

**Paso 0 nuevo.** Elegir intención antes que modelo. Es lo único que se agrega
de pantalla.

**Paso 1 se vuelve dependiente de la intención.** Hoy pregunta "Modelo de la
hoja", que hace dos trabajos a la vez: la identidad con la que se archivan las
unidades y la fila de conteo que se corrige. En la intención 2 se separan en
origen y destino.

> Al implementar: se temía que `esNombreDeModelo` hubiera que enseñarle a
> filtrar los DOS nombres de modelo. No hizo falta — ya cotejaba contra el
> catálogo entero, no contra el modelo elegido. Queda anotado en el código para
> que nadie lo "arregle" al revés.

**`clasificar` se vuelve una estrategia por intención**
([:344](../../public/js/ui/asistente-importar.js#L344)). Mismas entradas (ficha
propia, otras fichas, contrato), distintas clases y acciones. `CLASES`
([:391](../../public/js/ui/asistente-importar.js#L391)) pasa de mapa plano a
mapa por intención, porque las palabras importan: en la intención 2 la fila que
hoy dice "Otro modelo · marca solo si de verdad es otro equipo" tiene que decir
"Está como VM686 · se reclasifica a PD686".

**El conteo deja de ser una casilla de un solo modelo.** Hoy es
`guardarInventario([{ modeloId: ctx.modeloId, cantidad }])`
([:610](../../public/js/ui/asistente-importar.js#L610)). En la intención 2 es un
movimiento entre dos filas. Sin esto, cada reclasificación deja el fantasma que
dejó VM686.

**Las escrituras no cambian.** `reclasificarModelo`, `corregirPropiedad`,
`anotar`, `recibir`, `corregirABodega` ya existen y ya escriben kardex en la
misma tanda. Ninguna ruta de escritura nueva.

## 6. Candados

Se mantienen los que ya hay y se agregan dos, ambos heredados de la contraparte
en script:

- **Cambio entre familias marcado como decisión manual** en el kardex, igual
  que `repunta-modelo-lista --forzar`. No es lo mismo corregir `PD686` →
  `PD686-R` (variante) que `VM686` → `PD686` (otra familia); lo segundo tiene que
  quedar escrito como que lo decidió una persona.
- **Bloqueo de reclasificación con contrato vivo.** Si la unidad está
  `en_cliente` bajo un contrato vigente, cambiar qué *es* el radio cambia lo que
  se le factura al cliente. Primero se corrige el contrato. El asistente ya sabe
  distinguir contrato vigente de contrato muerto — es el trabajo que le costó el
  caso B8310025 — así que la evidencia ya está en pantalla.

Y el de siempre: la condición (`nuevo` / `reuso`) nunca se elige, la impone la
fila del catálogo.

## 7. Orden sugerido

1. Paso 0 + intención 1 replicando el comportamiento actual, sin cambio de
   conducta. Es refactor puro y deja el andamio.
2. Intención 2 con el movimiento de conteo y los dos candados. Es la que costó
   el incidente.
3. Intención 6, que es casi gratis: el paso 2 sin botón de aplicar.
4. Intenciones 3, 4 y 5.

## 8. Lo que este plan NO resuelve

- Los seriales con espacio adentro (`26611A 3685`, vistos en producción) siguen
  dependiendo de `normalizarSerial`; no es asunto del asistente.
- La corrección de seriales mal tecleados sigue siendo de a uno
  ([:508](../../public/js/ui/asistente-importar.js#L508)); no se propone
  aplicarla en lote todavía.
- `PD686-R` tiene el conteo en 0 desde 2025-11-24 con 74 unidades en bodega. Es
  anterior a todo esto y se arregla aparte.
