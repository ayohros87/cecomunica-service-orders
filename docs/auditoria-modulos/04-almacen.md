# 04 · Almacén e inventario (pool de equipos por serial) — auditoría de módulo

> Auditoría de módulos 2026-09-30. Recorrido hecho en el emulador con los 60,436 documentos
> exportados hoy (7,834 fichas del pool), como bodega (José Solís), admin, gerencia, recepción,
> técnico, ventas y contabilidad, en escritorio (1280×800) y teléfono (390×844). Nada se tocó en
> producción; los datos creados llevan el prefijo `PRUEBA-AUDIT-almacen` y quedaron como al
> sembrar. Capturas: `capturas/almacen/` (81, fuera del git). Scripts: `scripts/almacen/00…08`
> (los del auditor anterior, vueltos a correr, más `00c`, `00d`, `07` y `08`). Maqueta:
> `maquetas/almacen-existencias-y-telefono.html` (4 antes/después con el CSS real).

---

## ROTO HOY

Lo que está produciendo dato falso o acción indebida en este momento, en orden de gravedad.

| # | Qué pasa | Evidencia | A quién le pega |
|---|---|---|---|
| R1 | **Recepción y ventas pueden vender un radio de bodega desde Almacén.** La página rechaza a los roles sin módulo solo en el cuerpo ("Esta área es de administración e inventario"), pero la topbar pinta "Importar hoja · Recibir equipos · Conteo físico · Registrar venta" para todos y los botones funcionan. Como `firestore.rules` deja hacer `update` en `equipos_pool` a recepción y vendedor (`puedeGestionarSeriales`), la venta **se completa**: "1 equipo(s) registrados como vendidos". El técnico sí queda bloqueado por las rules, pero ve un toast crudo: `Error al recibir: PERMISSION_DENIED: evaluation error at L847:24…`. | Script 08: recepción vendió `AUDALM0005` y vendedor `AUDALM0001` (capturas 70-recepcion/vendedor-…-venta-resultado); técnico: 70-tecnico-…-recibir-resultado. Código: gate solo del cuerpo `almacen-hoy.js:569-575`; topbar sin rol `almacen/index.html:242-262`; `firestore.rules:61, 848`. | Cualquier venta registrada por recepción o ventas saca el radio de bodega "de forma permanente" (`vendido`, propiedad del cliente) sin que bodega lo sepa. Hoy no consta ninguna en el kardex (las 31 ventas del mes son de José), pero la puerta está abierta. |
| R2 | **Los indicadores de Existencias le dicen a bodega que tiene 151 radios por inspeccionar y 34 modelos descuadrados, y ninguna de las dos cosas es trabajo suyo.** "Devuelto · por inspeccionar: 151 — esperan inspección de bodega": 147 están dentro de una orden de ENTRADA abierta en el taller (la pestaña Hoy lo dice bien y le pone 4-5 a José). "Modelos con diferencia: 34" sale en ámbar con "meta: 0", pero los 34 son conteos de hace más de 30 días (julio) que Hoy excluye a propósito. Dos pestañas, mismo número, dos verdades. | Capturas 01 (Hoy) y 02-…-existencias; Admin SDK: `devuelto_revision` = 151, **147 con `orden_actual_id`**; `almacen-existencias.js:302-319` suma `devuelto_revision` sin mirar `orden_actual_id`; `almacen-hoy.js:347, 414-420` sí filtra. | Bodega y quien use Existencias como tablero (gerencia, admin). |
| R3 | **"Recibir equipos" no se cierra después de recibir.** Tras el toast "2 equipos recibidos en bodega", la hoja sigue abierta con los mismos seriales en el textarea; en el recorrido quedó detrás de Conteo y de Venta en escritorio y en teléfono. Causa: `_cerrar()` sale temprano porque `this._busy` sigue en `true` cuando se llama desde la propia recepción. Pulsar "Recibir" otra vez no duplica (dice "ya estaban"), pero la persona no sabe si ya recibió. | Logs 02 escritorio y teléfono ("modal tras recibir: Recibir equipos en bodega / … 3 serial(es) en la tanda"); capturas 08/09/10 (la hoja de Recibir al fondo). `asistente-recibir.js:238` llama a `_cerrar()`, y `:462-465` devuelve si `_busy`. | José: 215 recepciones en 30 días, la acción más frecuente de bodega. |
| R4 | **En teléfono, el Conteo físico no muestra la columna de cantidad.** La tabla no cabe en 390 px y la casilla "Cantidad contada" queda fuera de pantalla sin pista de scroll: no se puede contar. | Captura 08-inventario-telefono-conteo; `asistente-conteo.js:58-62` (tabla `app-table compact` sin columnas esenciales ni scroll visible). | Solo si alguien cuenta desde el teléfono (José trabaja desde computadora, según la memoria del proyecto; conviene confirmarlo). |

---

## 1. Para quién es y qué hacen ahí

El espacio Almacén (`/almacen/`, 8 pestañas: Hoy, Asignar, Existencias, Avanzado, Piezas,
Descartados, Con condición, No devueltos) es donde **bodega** (José Solís, rol `inventario`)
recibe radios, los asigna a contratos y gestiones, registra ventas, bajas e inspecciones y
corrige la deuda de la migración. Admin y contabilidad mantienen el catálogo de modelos, piezas
y cargos desde Finanzas. Uso real: **534 acciones/mes** (4.º del app), casi todas de una sola
persona.

**Lo que bodega hace de verdad (kardex `equipos_pool/*/movimientos`, 30 días, script 05):**

| Movimiento | Total | Por José | Por el sistema / scripts |
|---|---|---|---|
| Recibir en bodega (`ingreso_bodega`) | 215 | **215** | — |
| Sacar de "por clasificar" (`correccion_migracion`) | 84 | **84** | — |
| Venta | 31 | **31** | — |
| Liberación (inspección OK → bodega) | 23 | 19 | 4 |
| Fusión de duplicados / baja / corrección de venta / conflicto / corrección de serial | 14 / 9 / 5 / 4 / 2 | 34 | 2 |
| Ingreso y salida de taller, cierre de ENTRADA, devolución, asignación a contrato/gestión, reasignación, reemplazo, entrega | 1,100+ | — | triggers |
| Correcciones por script (saneos del 9-sep y familias) | 314 | — | scripts |

1,970 movimientos en 30 días; **383 los hizo José a mano** en 21 días hábiles (unos 18 por
día). El "mover 243 / editar ficha 236" del brief sale de los audit logs, que no vienen en el
export; el kardex muestra que "mover" es **recibir** (215) y **sacar de por clasificar** (84),
no mover entre estados a voluntad: esa acción no existe (`equipo-ficha.js:222-256` solo
ofrece transiciones fijas por estado).

**El pool hoy (Admin SDK contra el emulador):**

| Medida | Valor |
|---|---|
| Fichas | **7,834**: en bodega 3,021 · en cliente 2,995 · en taller 349 · devuelto/por inspeccionar 151 · por clasificar 1,223 · asignado a contrato 23 · vendido 31 · baja 38 · no retirado 2 |
| Sin `modelo_id` | **1,316** (1,028 de ellas "por clasificar") |
| "Por clasificar" por origen | 1,184 de la migración PoC · 39 de órdenes |
| En bodega: sin `ingreso_bodega_at` / `verificado=false` / propiedad del cliente / nota DAÑADA | 1,992 (migración) / 66 / 76 / 6 |
| Devueltos por inspeccionar | 151 · mediana 14 días · 9 llevan más de 30 · **147 con orden de ENTRADA** |
| Serial compartido (2 fichas con el mismo serial) / `id ≠ serial_norm` | 70 / 54 |
| Modelos en catálogo / grupos en pool / docs de `agregados_pool` | 123 / 115 / 115 · 97 modelos activos sin precio de venta |
| Piezas | 16 (8 sin stock, 8 con precio, 0 mapeadas a QBO) |

**¿Los números que se muestran son verdad?** Sí para todo lo real: `agregados_pool` coincide
celda por celda con el conteo directo del pool en 9 de 10 estados (script 01). Las 3 celdas
que difieren (±1 en PNC360S-R, BD506U-R y NX-420-R) son 3 radios que otro auditor movió hoy a
las 21:26 al contrato de prueba `SERV20260930-01` dentro del emulador, donde el trigger
`onPoolAgregado` no corre. En producción el trigger corre en cada escritura y la reconciliación
diaria (`agregadoPoolDiario`, 05:30) recalcula todo. Lo que sí es falso está en R2: no el
número, sino **lo que la etiqueta dice que significa**.

`uso_diario` solo tiene hoy: 1 vista de `almacen/index#serial`. No sirve todavía.

---

## 2. Recorrido real

Todos los tiempos son del emulador en esta máquina (primer viaje a Firestore ~350 ms, igual que
producción). Interacciones = clics + campos + confirmaciones en el camino feliz.

### 2.1 Bodega · escritorio (script 02)

| Flujo | Interacciones | Tiempo | Qué pasó |
|---|---|---|---|
| Abrir el espacio (Hoy) | 1 | 2,172 ms (1.ª Firestore 364 ms, 17 peticiones, 7 fuentes en paralelo) | 15 ítems en 4 secciones; bodega sabe qué hacer: cada fila tiene un solo botón ("Asignar seriales", "Revisar", "Resolver") y la deuda de migración va aparte, en gris |
| Cambiar a Asignar / Existencias / Avanzado | 1 | **3,195 / 1,479 / 2,784 ms** | Avanzado pinta 13,177 px de alto (642 objetivos) al abrir: la bodega completa por tandas |
| Buscar un serial (Existencias, tipear + Enter) | 2 | 1,199 ms | Abre la ficha; mientras tecleas dice "Ningún modelo coincide… Pulsa Enter para buscar el serial" (bien) |
| Corregir serial desde la ficha | 5 (botón, serial, Revisar, confirmar, cerrar) | 6,319 ms | Dos confirmaciones; queda en el kardex. Era 8 saliendo a `equipos.html` (28-sep) |
| Dar de baja / Reactivar | 3 / 3 | 2,127 / 3,873 ms | Motivo obligatorio |
| Por clasificar → Corregir a bodega | 3 | 2,248 ms | "→ en bodega (verificado)" |
| Devuelto sin tiquete → Inspección OK | 3 | 4,389 ms | Confirm + toast |
| Recibir 3 seriales con lector (1 repetido) | 1 + 1 campo + 3 escaneos + 1 | 4,758 ms al guardar | Nombra el repetido y lo recibe una vez (bien). **La hoja no se cierra (R3).** Al tipear "PNC360S-R" en el filtro de modelo, el foco salta al textarea en cuanto hay una sola coincidencia ("PNC360S-") y la **"R" cae en el cuadro de seriales** |
| Conteo físico (filtrar, Enter, cantidad, Enter) | 4 | 538 ms + 2,289 ms revisar | Enter va a la cantidad y luego al siguiente modelo (T12 resuelto). 113 modelos en la lista |
| Venta desde la ficha | 6 (botón, cliente, factura, Registrar, 2 confirmaciones) | 7,703 ms | 3 diálogos seguidos; el 2.º resume bien ("Salen de bodega de forma permanente: …") |
| Avanzado: buscar un serial | 1 campo | **5,113 ms** | `EquiposPoolService.listar` **baja el pool completo (7,834 docs)** para filtrar en el navegador |
| Avanzado: ⋯ → Editar ficha → Guardar | 4 | 2,991 ms | Menú con Editar ficha, Corregir serial, Registrar venta, Dar de baja. En escritorio el menú ⋯ de la última fila **se abre recortado** por el contenedor (captura 11-…-avanzado-menu) |

### 2.2 Bodega · teléfono (script 02, viewport 390×844)

Los tiempos son iguales (2,167 ms Hoy; Asignar 1,756; Existencias 1,464; Avanzado 2,734). Lo
que cambia es la pantalla:

| Qué | Dato | Captura |
|---|---|---|
| La cabecera ocupa **410 px** antes de la primera pestaña: 4 botones + ⋮ + "Menú principal" + "Cerrar sesión". La bandeja Hoy empieza a mitad de pantalla | geometría: 1,555 px de alto; 7 objetivos < 36 px | 01-inventario-telefono-hoy |
| Las pestañas se recorren con scroll horizontal: en Existencias ya no se ve Hoy; en Avanzado no se ve Asignar | — | 02-inventario-telefono-existencias / -serial |
| Existencias en teléfono muestra 4 columnas (Modelo, Bodega, Devueltos, Conteo, Dif.) — bien (T7 resuelto); la fila expandida pinta chips de serial de 237 objetivos < 36 px | 265 objetivos, 237 chicos | 13-inventario-telefono-existencias-fila-abierta |
| Los asistentes (Recibir, Venta, ficha) salen como hoja inferior y se usan bien | — | 07, 10, 03 (teléfono) |
| **Conteo: la columna de cantidad queda fuera de pantalla (R4)** | — | 08-inventario-telefono-conteo |
| Asignar un contrato de 50: la página mide **4,849 px**; el formulario empieza a 1,089 px (después de la lista de contratos y el picklist); el pie con "Listo para programar" no se ve sin hacer scroll; los 5 escaneos sí avanzan de casilla (1,852 ms) | script 07 f | 68-inventario-telefono-asignar-50, 69-…-5-escaneados |

### 2.3 Asignar seriales a un contrato (scripts 03 y 07, escritorio)

Tres caminos para el mismo contrato de prueba de 25 y de 50 × PNC360S-R (356 disponibles en
bodega, 1 dañada excluida).

| Camino | Contrato | Interacciones | Tiempo de máquina | Detalle |
|---|---|---|---|---|
| **Lector** (serial + Enter en cada casilla) | 25 | 1 + 25 escaneos + 1 "Listo" + **25 escaneos de verificación** + 1 + 1 = **54** | escaneo 3,936 ms (151 ms/serial, 3 consultas por serial = 75) · Listo → hoja 1,910 · 2.º escaneo 4,496 · confirmar 2,277 | Enter avanza a la siguiente casilla vacía (T12 resuelto); cada casilla muestra chip "En bodega · HYTERA PNC360S-R" |
| **Lector** | 50 | **104** | 7,502 ms (148 ms/serial, 150 consultas) · 2,707 · 8,836 · 2,115 | Igual: lineal y sin sorpresas |
| **Tomar del estante** (picker FIFO, "la vía normal") | 50 | 1 + 1 + 1 "Selección automática" + 1 "Asignar" + 1 "Listo" + **50 escaneos de verificación** + 1 + 1 = **57** | picker 2,056 ms (355 unidades) · auto 216 · llenar 1,668 · Listo → hoja 3,413 · 2.º escaneo 8,957 | El picker excluye dañadas, condición y descartados ("No disponibles (1)") y avisa de 2 radios sin modelo; "Imprimir lista" sale por serial |
| **Pegar columna** (50 seriales de Excel) | 50 | 1 + 1 + 1 pegar + 1 "Aplicar" + 1 "Listo" + 50 + 1 + 1 = **57** | llena al instante; **0 chips y 0 consultas** hasta "Listo" | A diferencia del escaneo, el pegado no valida casilla por casilla: los errores salen todos juntos al final |
| Serial que está en cliente (casilla 25) | 25 | +2 (Volver a editar, corregir) | panel de bloqueo en 1,236 ms | "no está en bodega · Está En cliente con SHEBANDOWAN… Si volvió, regístralo por devolución o ENTRADA antes de asignarlo" — claro y accionable |

Lo que esto dice: **la hoja "Verificar la lista" es obligatoria en los tres caminos** ("Lista
verificada" queda deshabilitado hasta que falte 0; la única salida por fila es "No está…" con
motivo y sustituto). Tiene sentido cuando los seriales los eligió el sistema (picker) y hay
que ir a buscarlos al estante; cuando bodega acaba de escanear los 50 uno por uno, la obliga a
escanearlos **otra vez**. Y según la memoria del proyecto (2026-09-04) "bodega casi no usa
lector de barras": sin lector, verificar 50 es teclear 50 seriales de 10 caracteres (unas 500
teclas) después de haberlos tecleado o pegado.

### 2.4 Satélites del espacio (script 04 y 06, bodega en escritorio)

| Página | Tiempo | Qué se ve |
|---|---|---|
| Piezas | 1,741 ms | 16 piezas, KPIs clicables, ±N con motivo y kardex (P1 resuelto); precio y costo en lectura ("se editan solo en Finanzas") — **bodega sigue viendo costo y margen** (petición G3 de contabilidad) |
| Descartados | 1,620 ms | 17 vigentes; botón "Registrar descarte" (P0 #23 resuelto); aviso claro |
| Con condición | 1,562 ms | 2 vigentes; "Levantar" |
| No devueltos | 1,593 ms | 1 renglón (TIL PANAMÁ, 4 × NX-420-R, $1,500, 40 días) con Monto / Facturar / Apareció |
| Modelos (`inventario/modelos.html`) | 1,396 ms | **"Acceso restringido"** en rojo sobre página en blanco, sin rail ni enlace de vuelta |
| `equipos.html`, `pendientes.html` | 2,512 / 2,153 ms | Redirigen a Almacén (Existencias / Hoy) |
| Importar hoja | — | Primero pregunta la intención (6 opciones) y luego archivo o pegado, con el modelo propuesto desde la hoja (P1 #9 resuelto) |
| Ctrl+K con un serial | — | **No busca en el pool**: `AUDALM0001` → "Sin resultados"; `22610A3919` aparece solo porque una orden lo contiene |

### 2.5 Admin y otros roles (script 04)

| Rol · página | Tiempo | Qué se ve |
|---|---|---|
| Admin · Modelos y Tarifas | 1,911 ms | 123 modelos, "Salud del catálogo" con 6 puntos (10 refurbished sin ítem QBO, 15 sin precio de alquiler, 21 fichas con condición contradictoria…), chips `R → base`; 97 activos sin precio de venta |
| Admin · Piezas y tarifas / Cargos | 1,539 / 2,785 ms | Precio, costo, margen, ítem QBO en línea (QBO da 401 en el emulador, esperado) |
| Admin · Almacén Hoy | 3,852 ms | Igual que bodega + nota técnica "Cola de transiciones apagada… se enciende en colaInventarioService.js" (texto para desarrollador en pantalla de usuario) |
| Contabilidad | — | Ve Modelos (bien); Almacén la rechaza (bien) |
| Gerencia | 4,076 ms | Entra a Almacén completo, lectura |
| Recepción / ventas | 2,068 / 2,088 ms | Llegan por deep-link `?g=GA…`; ven las 8 pestañas; en Asignar: "Solo administración e inventario asignan seriales de gestiones" (casillas deshabilitadas) **pero la topbar les deja vender (R1)** |
| Técnico | 1,490 ms | "Esta área es de administración e inventario" + topbar activa |

---

## 3. Hallazgos

### 3.1 Roto (además de R1-R4)

| # | Hallazgo | Evidencia |
|---|---|---|
| B1 | El filtro de modelo de Recibir roba el foco a media palabra: con una sola coincidencia salta al textarea y las teclas que faltan ("R" de "PNC360S-R") caen en el cuadro de seriales. Con lector no pasa; tecleando, sí | Logs 02: `foco al terminar de tipear: asrSeriales · textarea="R"`; `asistente-recibir.js:396-420` |
| B2 | El menú ⋯ de Avanzado se abre recortado en la última fila visible (escritorio) | Captura 11-inventario-escritorio-avanzado-menu |
| B3 | Toasts de permiso crudos para quien no debe estar ahí (`PERMISSION_DENIED: evaluation error at L847:24…`) | Script 08, técnico |
| B4 | "Dar de baja" y "Corregir a bodega" no comprueban el estado esperado (`esperado`) en la transacción: dos pestañas abiertas pueden pisarse en silencio | `equiposPoolService.js:1020-1026, 1050-1057` (código; no reproducido) |
| B5 | "Marcar verificado" no deja kardex; `reclasificacion`, `correccion_venta`, `factura_venta` y `nota` salen en la Historia con el nombre crudo | `equiposPoolService.js:1268-1272`; `equipo-ficha.js:27-56, 182` |

### 3.2 Confuso

| # | Hallazgo | Evidencia |
|---|---|---|
| C1 | Existencias abre con **dos filas "(sin modelo)"**: una vacía y otra con 2 en bodega, 284 en cliente y 1,030 en "otros". 1,316 fichas sin modelo no suman en ningún modelo y la fila no dice qué hacer | Captura 02-…-existencias; maqueta §2 |
| C2 | "En bodega 3,015" y "Con clientes 3,015" una al lado de la otra: coincidencia hoy, pero la etiqueta "En bodega" no es "disponibles" (Asignar excluye dañadas, condición, descartados; aquí no) | `almacen-existencias.js:302-319`; `equiposPoolService.js:497-518` |
| C3 | Ocho pestañas con cuatro niveles de uso distintos: Hoy/Asignar (trabajo diario), Existencias/Avanzado (consulta), Piezas (otro inventario), Descartados/Con condición (listas del taller), No devueltos (cobros). Contabilidad "no encuentra" No devueltos porque vive en Almacén | `almacen-nav.js:19-39`; auditoría 28-sep `:779-780` |
| C4 | "Tipo: Refurbished" en la ficha, "Cond.: Refurbished" en Avanzado, "reuso" en el kardex ("Reclasificado a HYTERA PNC360S-R (reuso)"), "Refurbished: el modelo lleva sufijo -R" en Recibir. Tres palabras para lo mismo | Capturas 03, 11, 62 |
| C5 | La pestaña Hoy (admin) muestra una nota de desarrollador: "Cola de transiciones apagada (atraso histórico sin triar) — se enciende en colaInventarioService.js" | Captura 44 |
| C6 | El "Acceso restringido" de Modelos es una página en blanco sin rail ni botón de volver; bodega no puede ni consultar el catálogo que decide el tipo (Nuevo/Refurbished) de lo que recibe | Captura 34; `inventario-modelos.js:32` |
| C7 | La fila de Existencias dice "Bodega 342" (agregado) y al expandirla "EN BODEGA · 350" (pool directo). Son dos fuentes y nada dice "resumen actualizado hace X"; `agregados_meta.deriva` nunca se lee en el frontend | Captura 63; `almacen-existencias.js:443-468`; mapa de código §G |
| C8 | La venta pide "Cliente (de la factura)" como texto libre con combo; si no existe, dos confirmaciones más ("Cliente no registrado" + resumen). El 3.er diálogo ("Crear orden de programación") no aparece para inventario porque no tiene `crear-orden` | Logs 02; `asistente-venta.js:158-165, 263-282` |
| C9 | "Pegar columna" llena 50 casillas sin ningún chip ni consulta; el escaneo sí valida cada una. La persona no sabe que el pegado "no revisó nada" hasta "Listo" | Script 07 b |

### 3.3 Lento

| # | Hallazgo | Dato |
|---|---|---|
| L1 | Buscar un serial en Avanzado baja **el pool completo** (7,834 docs) y filtra en el navegador | 5,113 ms escritorio / 4,904 teléfono; `inventario-equipos.js:122-126, 172, 541-546`. En producción son ~7,800 lecturas por búsqueda si la caché no está caliente (el tripwire de lecturas los contaría) |
| L2 | Expandir un modelo en Existencias lee todas sus fichas (PNC360S-R: 1,291 docs) para pintar 40 chips por estado | `listarPorModeloKey` 12,222→12,736 ms en el log 06; `equiposPoolService.js:376-385` |
| L3 | Cada escaneo en Asignar dispara 3 consultas (pool, descartados, condiciones): 150 viajes para 50 radios. No bloquea (151 ms por serial), pero `findBySeriales` por lotes `in` de 10 ya existe para "Listo" | Logs 03: "consultas durante el escaneo: 150 de 176" |
| L4 | Cambiar a la pestaña Asignar cuesta 3.2 s en escritorio: carga la cola (4 lecturas) y el contrato seleccionado con su picklist | Log 02 |
| L5 | La hoja de verificación duplica el tiempo de la asignación: 25 radios = 3.9 s + 4.5 s; 50 = 7.5 s + 8.8 s. En interacciones, duplica los escaneos | §2.3 |

### 3.4 Estado de los P0/P1/P2 de Almacén de la auditoría del 28-sep (verificado en el navegador o en el código)

| Ítem | Estado |
|---|---|
| P0 #21 `no_retirado` fuera de Existencias | **Resuelto** (`almacen-existencias.js:54`, en OTROS) |
| P0 #22 `banner('aviso')` sin estilo | **Resuelto** (no queda ninguna llamada) |
| P0 #23 callejones: "Registrar descarte" y "cambio de serial" | **Resuelto**: el botón existe (captura 31); el texto de "Listo para programar" ahora le dice a bodega que se lo pida a recepción o ventas |
| T12 lector: Enter avanza / Conteo / Recibir / repetido nombrado / descartados en los 4 puntos | **Resuelto** en los 5 puntos (§2.1, §2.3). Efecto colateral B1 |
| P1 #7 "Corregir serial" en la ficha; "Revisar" de Hoy abre la ficha | **Resuelto** (5 interacciones; Revisar → ficha en 806 ms) |
| P1 #9 importador archivo primero | **Resuelto** (captura 60) |
| P1 #11 piezas ±N con motivo, KPIs clicables, "Sin stock" | **Resuelto** (captura 64) |
| P1 #6 "Inspección OK" en lote no toca lo que tiene ENTRADA | **Resuelto** en código (`almacen-existencias.js:407, 589-590`) |
| P1 #10 terminología: "pool" fuera, "Devuelto · por inspeccionar" único | **Parcial**: "pool" ya no sale; sigue "Tipo/Cond./reuso" (C4) y el KPI "esperan inspección de bodega" (R2) |
| P2 #13 pick & confirm | **Hecho**, y es el origen de L5 (verificación obligatoria aun escaneando a mano) |
| P2 #14 absorber `equipos.html` en Almacén (lotes con Detener y reporte) | **Hecho** (pestaña Avanzado; `AsistenteLote`) |
| P2 #15 pool en Ctrl+K · "disponible" ≠ "en bodega" · Existencias en tablet | Ctrl+K **vigente** (no busca el pool); "disponible" **parcial** (Asignar sí, Existencias no, C2); tablet **resuelto** |
| Rol inventario sin catálogo de modelos (auditoría agosto `:389` y septiembre `:671`) | **Vigente** (C6) |
| Contabilidad G3: inventario y técnicos no deben ver costo | **Vigente** para inventario (Piezas muestra costo y margen) |

Lo que el brief o la memoria dicen y resultó distinto: el "mover 243" no es mover; la memoria
del 2026-09-04 dice que bodega casi no usa lector y que el escáner/picklist "NO se hace", y el
28-sep se construyó justo eso, con verificación por escaneo **obligatoria**. Hay que decidir
cuál de las dos es verdad (pregunta 1).

---

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| P1 | Recibir cierra y limpia tras recibir: `_cerrar()` → `_cerrarForzado()` en el camino de éxito, o bajar `_busy` antes | R3 | 1 clic y una duda en cada una de las 215 recepciones/mes | 30 min | Ninguno |
| P2 | Topbar de Almacén por rol: solo admin e inventario ven Importar/Recibir/Conteo/Venta; recepción y ventas ven solo "Asignar (gestiones)"; y un toast legible cuando las rules niegan ("No tienes permiso para recibir equipos") | R1, B3 | Cierra la puerta a ventas por recepción/ventas | 2 h | Ninguno. Si Alberto quiere que recepción venda, es una decisión (pregunta 2), no un hueco |
| P3 | El filtro de modelo de Recibir no cambia el foco hasta Enter o clic en la opción (hoy salta con la primera coincidencia única) | B1 | Evita la "R" perdida y el modelo mal elegido | 1 h | Ninguno |
| P4 | KPIs de Existencias honestos (maqueta §1): "Disponibles 2,934 de 3,015 en bodega", "Por inspeccionar en bodega 4 (+147 en taller)", "Diferencias recientes 0 (34 sin recontar desde julio)". Y una sola fila "Sin modelo · 1,316 · Clasificar por lotes" al final (maqueta §2) | R2, C1, C2 | Bodega deja de ver 151 y 34 falsos cada vez que abre Existencias | ½ día | Ninguno: los datos ya están (`orden_actual_id`, descartados, DAÑADA, condición) |
| P5 | Avanzado busca por consulta directa: `findBySerial` exacto + `where('serial_norm','>=',q)` por prefijo, y solo si no hay resultado cae a la lista en memoria | L1 | 5.1 s → < 1 s; −7,800 lecturas por búsqueda | ½ día | Pierde la búsqueda por "contiene" en notas/cliente, que puede quedar como botón "Buscar en todo" |
| P6 | Ctrl+K busca el pool (serial exacto normalizado y por prefijo) | §2.4, T6 | Buscar un radio desde cualquier pantalla: 2 interacciones | 2-3 h | Ninguno |
| P7 | Verificación inteligente en Asignar (maqueta §4): las unidades escaneadas o tecleadas a mano ya están verificadas; la hoja solo pide escanear las que vinieron del picker o de "Pegar columna". Si todo salió del picker, se queda igual que hoy | L5, pregunta 1 | −25 escaneos por contrato de 25, −50 por uno de 50, cuando se escanea a mano; sin lector, −500 teclas | 1 día | Bajo: `jalarItems(items, origen)` ya distingue el origen; `picklist_verificada_n` se sigue escribiendo |
| P8 | "Pegar columna" valida al pegar con `findBySeriales` (lotes de 10) y pinta los chips igual que el escaneo | C9 | Los errores aparecen en la casilla, no al final | 2 h | Ninguno |
| P9 | Cada escaneo usa el mismo lote `in` de 10 (cola de 300 ms) en vez de 3 consultas por serial | L3 | 150 → ~15 viajes por 50 radios | ½ día | Ninguno |
| P10 | Teléfono (maqueta §3): título + pestañas de trabajo arriba, un "+" que abre la hoja con las 4 acciones, "Menú principal/Cerrar sesión" solo en ☰; Conteo con dos columnas (modelo, cantidad) y marca visible; en Asignar el pie "Listo para programar" pegajoso y el formulario antes de la lista de contratos | R4, §2.2 | La bandeja empieza a 100 px en vez de 410; el conteo se puede hacer; −1 scroll largo por contrato | 1-2 días | Bajo. Solo vale si bodega usa el teléfono (pregunta 5) |
| P11 | Catálogo de modelos en solo lectura para inventario (marca, modelo, familia, tipo, `variante_de`), con la pestaña de precios oculta; y la página "Acceso restringido" con rail y "Volver" | C6 | Bodega entiende qué tipo le va a poner Recibir a cada modelo | ½ día | Ninguno si precios y QBO quedan fuera |
| P12 | Piezas: ocultar costo y margen al rol inventario (no solo bloquear la edición) | G3 de contabilidad | Cumple el pedido de Cheila del 30-jun | 1 h (+ ½ día si se quiere no enviar el campo desde el servidor) | Ninguno |
| P13 | Sello "resumen al HH:MM" en Existencias leyendo `actualizado_en` y aviso si `agregados_meta.deriva` | C7 | Si el trigger falla, se ve; hoy nadie lo sabría hasta las 05:30 | 2 h | Ninguno |
| P14 | Fila expandida de Existencias por tandas (primeros 40 por estado con `limit`, "+N más" sigue a Avanzado) | L2 | PNC360S-R: 1,291 → ~200 lecturas por expansión | ½ día | Ninguno |
| P15 | `esperado` en `darDeBaja` y `corregirABodega`; kardex en `verificar`; etiquetas para los 4 movimientos sin nombre | B4, B5 | Transacciones que no se pisan y una Historia legible | 2 h | Ninguno |
| P16 | Conteo cíclico: Hoy propone "esta semana cuenta estos 5 modelos" (los más viejos sin conteo o con diferencia) y Existencias muestra "último conteo" como semáforo | 34 modelos sin recontar desde julio; `inventario_actual` 95 docs | Diferencias < 30 días en vez de acumuladas | 2 días | Ninguno; es organización del trabajo |
| P17 | Saneo masivo de la deuda de migración por script, con reglas que decida Alberto (pregunta 3): 1,184 "por clasificar" de la migración PoC sin movimientos desde julio → cierre por lote con kardex; 1,316 sin modelo → modelo por la ficha PoC o familia; 4,408 sin verificar → verificado por regla | 84 correcciones a mano al mes = 15 meses para 1,223 | José deja de pagar la deuda de a uno | 2-3 días + decisión | Medio: hay que elegir bien la regla; se hace en el emulador primero (ya está montado) |
| P18 | Rediseño del espacio en tres zonas en vez de 8 pestañas iguales: **Trabajo** (Hoy + Asignar), **Inventario** (Existencias con Avanzado como modo "lista" del mismo buscador), **Listas** (Piezas, Descartados, Con condición) y mover **No devueltos** a Finanzas con enlace cruzado | C3 | Menos pestañas que leer; cada rol entra a su zona | 1 semana | Medio: reentrenar a José (la memoria dice: correos cortos, cambios pocos) |

---

## 5. Cómo saber si funcionó

| Qué medir | Antes (hoy) | Después (meta) | Dónde |
|---|---|---|---|
| Ventas registradas por un rol distinto de inventario/admin | 0 en el kardex, pero posible | Imposible desde la UI; 0 en rules | Kardex `tipo=venta` por `por_email` (script 05) |
| Recepciones "ya estaban" por doble clic | no medido | 0 | `recibir()` → `res.existentes` en el toast; audit logs |
| Escaneos por contrato asignado | 2 × N | N (a mano) · N (picker) | `picklist_verificada_n` vs. casillas con `origen='manual'`; tiempo entre primera casilla y `picklist_verificada_at` |
| Lecturas Firestore por búsqueda en Avanzado | ~7,834 | < 20 | Tripwire de lecturas (ya existe) + `s.consultas()` del harness |
| Tiempo de "buscar serial" en Avanzado | 5.1 s | < 1 s | Script 02, paso "Avanzado: buscar" |
| KPIs de Existencias que coinciden con Hoy | 151 vs 4; 34 vs 0 | iguales | Capturas 01 y 02 tras el cambio |
| Modelos con conteo de más de 30 días | 34 | < 5 | `inventario_actual` vs. hoy (ya lo calcula Hoy) |
| "Por clasificar" / sin modelo / sin verificar | 1,223 / 1,316 / 4,408 | tendencia a 0 tras P17 | Script 01 y Admin SDK |
| Páginas vistas de Almacén por pestaña y por usuario | 1 (hoy) | la base real de uso | `uso_diario` en 2-3 semanas |
| Alto de la cabecera en teléfono antes de la primera pestaña | 410 px | ≤ 110 px | `s.geometria()` + captura |

---

## Top 5 impacto/esfuerzo del módulo

1. **Topbar por rol + toast legible (P2)** — cierra la venta por recepción/ventas (R1); 2 h.
2. **Recibir se cierra al recibir (P1)** — 215 veces al mes deja de quedar la hoja abierta con los mismos seriales (R3); 30 min.
3. **Verificación solo de lo que no se escaneó a mano (P7)** — −25/−50 escaneos por contrato (o −500 teclas sin lector); 1 día.
4. **KPIs honestos y fila "sin modelo" única (P4)** — bodega deja de ver 151 y 34 falsos (R2, C1); ½ día.
5. **Buscar serial sin bajar el pool, en Avanzado y en Ctrl+K (P5+P6)** — 5 s → < 1 s y −7,800 lecturas por búsqueda; 1 día.

---

## Preguntas para Alberto

1. **¿José usa lector de código de barras o teclea?** La memoria del 2026-09-04 dice que casi no lo usa y que el escáner no se haría; el 28-sep se construyó pick & confirm con verificación por escaneo obligatoria. (a) Si teclea: P7 es urgente (hoy teclea cada serial dos veces) y conviene comprar un lector USB (US$30-60; el app ya está listo para Enter como sufijo). (b) Si escanea: P7 sigue valiendo para los contratos que escanea a mano, y la verificación se queda solo para el picker.
2. **¿Recepción y ventas deben poder recibir o vender radios desde Almacén?** (a) No (lo que yo creo): P2 les deja solo Asignar de gestiones. (b) Sí, para algún caso: hay que decir cuál, porque hoy lo pueden hacer sin que bodega lo sepa y las rules lo permiten.
3. **La deuda de migración (1,223 por clasificar, 1,316 sin modelo, 4,408 sin verificar): ¿se sanea por script o se sigue de a uno?** De a uno son 84 al mes (15 meses). Opciones para el script: (a) "por clasificar" de la migración PoC sin movimiento desde julio → `baja` con motivo "paradero desconocido (migración)"; (b) → se quedan, pero fuera de todos los contadores y pestañas de trabajo; (c) cruzar con la Base PoC para ponerles modelo y cliente antes de decidir. Cada opción cambia lo que Existencias dice que tiene la empresa.
4. **¿Bodega puede ver el catálogo de modelos (sin precios)?** Hoy "Acceso restringido". (a) Sí, solo lectura (P11). (b) No: entonces hay que explicar en Recibir de dónde sale el "Tipo" que no puede cambiar.
5. **¿Bodega trabaja alguna vez desde el teléfono?** Si no, P10 (teléfono) se pospone y R4 baja de prioridad; si sí (por ejemplo contando en el estante), R4 es lo primero.
6. **Los 34 modelos con diferencia desde julio: ¿quién decide cuándo se recuentan?** (a) Conteo cíclico propuesto por el app (P16: 5 modelos por semana). (b) Un conteo general con fecha. (c) Se aceptan las diferencias viejas como "explicadas" y se cierran, para que "meta: 0" vuelva a significar algo.
7. **¿Piezas debe ocultarle el costo a bodega?** Contabilidad lo pidió el 30-jun (G3). (a) Sí (P12). (b) No, José lo necesita para algo que no está escrito.
