# 03 · Base PoC (radios con SIM celular) — auditoría de módulo

> Auditoría de módulos 2026-09-30. Recorrido hecho en el emulador con los 60,436 documentos
> exportados hoy (6,510 fichas PoC), como recepción, ventas, admin, jefe de taller, técnico,
> bodega y contabilidad, en escritorio, tablet y teléfono. Nada se tocó en producción; los
> datos creados llevan el prefijo `PRUEBA-AUDIT-poc`. Capturas: `capturas/poc/` (34, fuera
> del git). Scripts: `scripts/poc/00…05`. Maqueta: `maquetas/poc-sim-en-linea-y-duplicados.html`.

---

## ROTO HOY

Tres cosas que están produciendo dato falso o trabajo perdido en este momento.

| # | Qué pasa | Evidencia | A quién le pega |
|---|---|---|---|
| R1 | **"Preparar lote (Ventas)" le muestra a la vendedora una lista parcial de clientes y la guarda 6 horas.** Karla entra por el home y en el combo de cliente ve **8 de 421** clientes (lo que tenía la caché local del navegador). Si el cliente no está, el lote sale **sin `cliente_id`** con un toast que ella no tiene por qué entender ("el archivo saldrá sin ID de cliente"), y en recepción el lote **no autocompleta el cliente**: "El archivo es del cliente X, que no está en la lista". El botón de refrescar (icono al lado del campo) lo arregla, pero nadie sabe que hay que pulsarlo. | Recorrido V02: `{enCombo: 8, servidor: 421, enLocalStorage: 8, expiraEn_h: 6}`; V03b tras pulsar refrescar: 421. Causa: `vendedores-batch.js:73-83` llama `ClientesService.getAllClientes()` sin `fresh`, y `clientesService.js:445` solo cae al servidor cuando la caché está **vacía** (`if (!fresh && snap.empty)`), no cuando está incompleta; después lo guarda en `localStorage` por 6 h (`lsSet`). Un cliente creado hoy no aparece hasta que expire. | Ventas (4 vendedoras). El único lote real enviado por el app (C COMUNICA, hoy 8:35) sí llevó `cliente_id` porque estaba en su caché; el próximo cliente nuevo no lo va a llevar. |
| R2 | **El app deja guardar un SIM que ya está activo en otro radio, sin decir nada.** En el cajón puse en la ficha 001 el SIM de la ficha 002 (mismo cliente, ambas activas): "Cambios guardados". Ni el cajón, ni la edición masiva, ni "Asignar del pool" miran las demás fichas. Es la acción más frecuente del módulo (293 cambios de SIM de recepción en 30 días). | Recorrido E08 (captura 05) + Admin SDK: las dos fichas quedaron con `8950799900000000002`. En la base hoy: **444 SIMs viven en más de una ficha viva; 41 en más de una ficha ACTIVA** (ej. `8950701000002367075` está activo en ASAMBLEA NACIONAL, COMPAÑÍA GOLY, CEMENTO BAYANO y R. SMITH a la vez). Código: `poc-edit.js:245-246` escribe `sim_number` directo; `poc-bulk.js:185`; `simCardsService.asignar` solo revisa el doc del pool. | Recepción (que luego pide activaciones con ese dato) y facturación de airtime. |
| R3 | **La base dice que un mismo radio está con dos o tres clientes a la vez.** 566 seriales tienen más de una ficha viva (1,453 fichas); 25 tienen dos fichas **activas**; 9 se repiten dentro del mismo cliente. El cierre masivo del 9 de septiembre (1,098 fichas, commit 532abc1) bajó el número, pero la herramienta "Duplicados → Seriales duplicados" vuelca las 1,453 filas sueltas y al cerrar una vuelve a la página 1 (se pierde el trabajo). | `scripts/poc/00-base-poc.js`; captura 11; `poc-list.js:988` (`cerrarFicha` → `this.cargar(true)`). Ejemplo: `24813A0641` vivo en SEGURIDAD IDEAL (activa), SOCIEDAD ISRAELITA (inactiva) y CENTRAL AZUCARERA (inactiva). | Recepción (lotes trancados por fichas viejas), reemplazos (el lote jala la config "del saliente" y hay 25 casos ambiguos), airtime. |

---

## 1. Para quién es y qué hacen ahí

La Base PoC es el registro de **qué radio con SIM está con qué cliente y cómo está programado**
(cliente, serial, IP/servidor, Unit ID, nombre, grupos, SIM, teléfono, operador, GPS). Es la
fuente para pedir activaciones/desconexiones de airtime y para programar radios nuevos y
reemplazos. Uso real (audit logs de septiembre): **591 acciones/mes**, la tercera del app.

| Quién | Qué hace en PoC | Cuánto (30 días, `poc_logs`) |
|---|---|---|
| **Recepción (Brenda)** | Cambia SIM/teléfono/operador, activa/desactiva, corrige grupos, carga lotes, cierra fichas de devoluciones | 716 escrituras a mano: **293 son de SIM** (113 liberar al pool, 96 cajón/masiva, 86 asignar del pool), 242 son cambiar solo `activo` |
| **Sistema (devoluciones)** | Cierra la ficha cuando el radio vuelve (`pocCierre.js`) | 1,202 cierres, 1,107 el 9-sep (saneo) |
| **Ventas (Karla y 3 más)** | Prepara el lote (nombres, modelo, grupos, GPS) y lo envía a recepción | 1 lote real por el app (desde el 28-sep); antes JSON por WhatsApp |
| **Bodega (José)** | No entra a PoC (lo rebota al home); toca fichas desde Almacén | 13 |
| **Admin/gerencia** | Grupos por cliente, pool de SIM, consolas, importar | 4 (cobros) |
| Jefe de taller, técnicos | Consulta (solo lectura) | 0 |

`uso_diario` solo tiene hoy: 1 vista de `POC/index` y 1 de `POC/vendedores-batch`; no sirve
todavía para decir qué pantallas se abren.

**La base hoy (Admin SDK contra el emulador, `00-base-poc.js`):**

| Medida | Valor |
|---|---|
| Fichas | **6,510**: 4,590 vivas (3,204 activas · 1,386 inactivas) · 1,920 cerradas |
| Vivas sin `modelo_id` | **3,242 (71 %)** — 3,243 sin modelo de ningún tipo |
| Vivas sin contrato vinculado | **3,534 (77 %)** |
| Inactivas que conservan SIM | **1,277** (el SIM no volvió al pool) |
| Activas sin SIM | 70 · sin operador 247 · sin IP 151 · sin grupos 64 · sin `cliente_id` 71 |
| "Incompletas" según la lista | 569 (pero **47 de las 50 más nuevas**: los lotes nacen sin SIM) |
| Seriales con >1 ficha viva | **566** (1,453 fichas); 25 con >1 activa; 9 dentro del mismo cliente |
| SIMs en >1 ficha viva / activa | **444 / 41** |
| Unit ID repetido en el mismo cliente | 11 pares |
| Pool `sim_cards` | 518 (148 disponibles · 370 asignados); **2,759 radios activos llevan un SIM que no está en el pool** (el pool cubre ~12 %); 24 "disponibles" están puestos en un radio vivo; 16 "asignados" apuntan a otro radio |
| Consolas (serial `CONSOLA`) | 61 |
| Fichas creadas por mes | may 418 · jun 291 · jul 330 · ago 149 · sep 152 |
| Clientes con fichas vivas | 325 de 457; el mayor: AGENCIA DE SEGURIDAD UNIDA, 289 |

---

## 2. Recorrido real

Conteo con el app ya abierto en la Base PoC; 1 clic, 1 campo tecleado, 1 confirmación = 1.
Tiempos medidos en el emulador local (producción suma ~150-300 ms de red por viaje).

### 2.1 Recepción · escritorio 1280×800

| Flujo | Interacciones | Tiempo | Qué se ve | Captura |
|---|---|---|---|---|
| Abrir la Base PoC | — | **2.1-2.4 s** hasta quieto; primer viaje a Firestore 370-410 ms; 11 peticiones; pinta 50 fichas desde caché y repinta | 12 columnas, "50 equipos ✅50 ⚠️47" (es la página, no la base) | 01 |
| Buscar un serial | 2 (campo "Serial" + teclear) | **1ª búsqueda 2.3 s** (abre la suscripción a las 4,590 vivas); las siguientes **0.35-0.4 s** | 1 fila | 02 |
| Buscar cliente grande (289 fichas) | 2 | 0.36 s; pinta 200 y "Mostrar 89 más" | contador dice 289 · 271 activos | 03 |
| Buscar "se" (peor caso) | 2 | 0.35 s; 1,548 coincidencias, 200 pintadas | — | — |
| Buscar con "Incluir cerradas" | +1 | +1.4 s la primera vez (1,920 cerradas) | chip "Cerrada · fecha" | 10 |
| **Cambiar la SIM por el cajón** (la acción más frecuente) | **7** (buscar 2 · lápiz 1 · SIM 1 · teléfono 1 · operador 1 · Guardar 1) | ~0.5 s el guardado | cajón de 14 campos; **no valida que el SIM esté en otro radio** (R2) | 04, 05 |
| **Asignar SIM del pool** | **7** (buscar 2 · casilla 1 · "Asignar del pool" 1 · auto-seleccionar 1 · Asignar 1 · Confirmar 1) | ~1 s | operador viene del SIM; **la fila sigue mostrando la SIM vieja hasta la próxima búsqueda** (el refresco repinta con la memoria anterior al snapshot; Admin SDK confirmó que sí se guardó) | 06, 06b |
| Editar Unit ID / grupos / IP | 5-6 | — | grupos como chips del catálogo (bien); Unit ID repetido sí se valida | 04 |
| Edición masiva (4 fichas) | 6 + celdas (buscar 2 · marcar todos 1 · Editar en masa 1 · Guardar 1 · Confirmar 1) | — | 7 inputs por fila en línea; tope 25; sin validar SIM | 07 |
| Cerrar una ficha con SIM | 5 (buscar 2 · archivo 1 · confirmar 1 · decidir SIM 1) | — | dos modales bien explicados; el SIM vuelve al pool | 08, 09 |
| Duplicados → Seriales | 2 | 0.12 s, pero **1,453 filas sin tope ni agrupación** | tabla plana; texto del buscador queda de la búsqueda anterior | 11 |
| Deep-link desde Ctrl+K (`?focus=&id=`) | — | 1.5 s, 7 peticiones, fila resaltada | **P0 #5 resuelto** | 12 |
| "Mostrar todo" | 1 | 2.3 s pinta **4,592 filas** (333,000 px de alto) | inservible; nadie lo necesita así | — |

### 2.2 Recepción · tablet 1024×768 y teléfono 390×844

| Viewport | Qué pasa | Captura |
|---|---|---|
| Tablet | Igual que escritorio; la tabla mide 1,300 px en un contenedor de 998: Grupos, SIM y Acciones quedan detrás de un scroll horizontal dentro de la tarjeta. El cajón (500 px) sí cabe. 85 objetivos táctiles < 36 px (casillas y botones `btn-sm`). | 13, 14 |
| Teléfono | Carga en 2.1-3.4 s. Solo se ven 3 columnas (cliente, operador, activo); el lápiz está 1,000 px a la derecha. La barra de herramientas ocupa 3 filas antes de la búsqueda. **Cambiar una SIM de pie no es viable.** (P2 #10 de la auditoría anterior sigue vigente.) | 15, 16 |

### 2.3 Ventas → recepción (lote)

Confirmado: desde el **28-sep (commit 6001797) el traspaso viaja dentro del app**, no por
WhatsApp. El brief y la auditoría anterior quedaron desactualizados en esto.

| Paso | Quién | Interacciones | Qué se vio | Captura |
|---|---|---|---|---|
| Preparar el lote | Karla | **6-8**: cliente 1 (+1 refrescar, ver R1) · modelo 1 · nombres 1 · Generar tabla 1 · grupo "a todas" 1 · Enviar 1 (+1 "Enviar de todos modos" si faltan grupos) | La página abre en 1.8-2.0 s. La barra "aplicar a las marcadas" resuelve modelo y grupos en lote. Karla no puede abrir la Base PoC (rebota al home, sin aviso). | 20, 21, 22 |
| Correo a recepción | app | 0 | Se encola a **`tecnico@cecomunica.com`** (`mail_orden_creada_to` está vacío y ese es el respaldo), no a `email_recepcion`. | — |
| Señal en el home | Brenda | 0 | "Lotes PoC por cargar · 2 · preparados por ventas" | 23 |
| Cargar el lote | Brenda | **2 con contrato** (Cargar · Crear) / **4 sin contrato** (+ abrir "Editar seriales" y pegar seriales) | Cliente, IP, Unit ID inicial y grupos se llenan solos; **0 modales** en el camino feliz (antes hasta 6). Con contrato, los seriales se jalan del contrato. Descartar pide motivo y la vendedora lo ve. | 24, 25, 26, 28 |

Detalles que salieron al hacerlo: (a) la caja "Jalar nombre, grupos y GPS de **0** radio(s)
saliente(s)" se muestra en un lote normal; (b) el "Unit ID inicial propuesto" es el máximo de
las 100 fichas más nuevas (`nuevo-batch.js:1038-1050`): mis fichas de prueba con 990001-990004
movieron la propuesta de todo el mundo a 990005; una consola o un import con números altos
haría lo mismo en producción; (c) los tres equipos se crearon con modelo, grupos y sin SIM
(la SIM llega después: por eso "47 de 50 incompletas" al abrir la lista).

### 2.4 Admin · SIM cards, consola, grupos, importar, imprimir

| Pantalla | Carga | Qué se vio | Captura |
|---|---|---|---|
| `sim-cards.html` | **3.5 s** (521 SIMs de un golpe, sin paginar; página de 12,000 px) | Pestañas Disponibles 150 / Asignados 371 / Todos; alta manual, edición, import Excel con vista previa (bien). No dice que 2,759 radios activos tienen SIM fuera del pool. | 30, 31, 32 |
| `nueva-consola.html` | 1.9-2.8 s | **4 interacciones** (cliente · Unit ID · "Agregar los 2 grupos" · Crear); nombre e IP sugeridos; aviso de cuántas consolas contempla el contrato. Bien resuelta. | 33 |
| `admin/grupos.html` | **4.5-5.4 s**: `getClientesConGrupos` lee las **6,510 fichas** para saber qué clientes tienen grupos (3.1-4.2 s) | Catálogo por cliente, prefijo de 3 letras, fusionar, repetidos exactos/parecidos. Vive en Admin aunque lo opera recepción. | 34, 35 |
| `importar-poc.html` | 1.5 s | Revisar → importar, con dedup y candado (P0 #7 resuelto). | 36 |
| `imprimir-equipos.html` | 1.6 s | Carga en paralelo (arreglado). | 37 |

### 2.5 Otros roles

| Rol | Qué pasa |
|---|---|
| jefe_taller, técnico | Entran en solo lectura, pero la barra sigue mostrando **"Editar en masa"**, que al pulsar responde "Solo administradores o recepción" (`poc-state.js:216-230` quita 7 botones y se le olvida ese). | 38 |
| bodega (inventario), contabilidad | Rebotan al home **sin ningún aviso** (el toast se pierde con la redirección). José hace 13 ediciones/mes en fichas PoC desde Almacén y no puede mirar la ficha en PoC. |
| gerente | Ya entra (P0 #24 resuelto en código); no hay usuario con ese rol en producción. |
| vendedor | Solo "Preparar lote"; la Base PoC lo rebota. |

---

## 3. Hallazgos

### 3.1 Roto (además de R1-R3)

| # | Qué | Evidencia |
|---|---|---|
| B1 | Tras "Asignar del pool", la fila muestra el SIM viejo hasta la próxima búsqueda. `PocList.refresh()` → `filtrar()` repinta con `_escuchas.vivas.docs`, que todavía es el snapshot anterior a la transacción. El dato en Firestore sí es el nuevo. | E10; `poc-list.js:36-51, 79-85`; `poc-sim-pool.js:197` |
| B2 | Una ficha **cerrada** sigue con `activo:true` y la fila pinta "● Activo" al lado del chip "Cerrada". El cierre a mano no cambia `activo` (`pocService.softDeletePocDevice`). | E13, captura 10 |
| B3 | El pool de SIM no es fuente de verdad: 24 SIMs "disponibles" están en radios vivos, 16 "asignados" apuntan a otro radio, y 1,277 fichas inactivas retienen SIM. "Asignar del pool" ofrece SIMs que ya están en uso. | `00-base-poc.js` |
| B4 | 3,242 fichas vivas sin `modelo_id`: el cambio de serial, la config del saliente y el pool comparan por modelo y aquí no hay con qué. | `00-base-poc.js` |

### 3.2 Confuso

| # | Qué | Evidencia |
|---|---|---|
| C1 | La cabecera "50 equipos ✅50 ⚠️47" cuenta lo pintado, no la base ni el cliente. Recepción pidió "Total del cliente (activos/inactivos) y seleccionados" (`02_base_datos_poc_batch.md` C2); hoy solo se cumple a medias y solo al buscar. | capturas 01, 03 |
| C2 | "Incompleta" (⚠️) marca sin SIM/operador/IP/teléfono; como los lotes nacen sin SIM, **todo lote nuevo es "incompleto"** y el ícono deja de decir algo. | 47/50 al abrir |
| C3 | Nueve maneras de tocar la SIM sin una sola regla: cajón, masiva, pool, liberar al cerrar, liberar al desactivar, "SIM/Teléfono en lote" (oculto en el HTML), importar, lote nuevo (no la pone), cierre del sistema. Ninguna revisa las otras fichas. | `POC/index.html:207-209`; `poc-sim.js` |
| C4 | Duplicados = tabla plana de 1,453 filas; al cerrar una ficha se vuelve a la página 1; el buscador arriba conserva el texto anterior. | captura 11; `poc-list.js:988` |
| C5 | Toolbar con 5 botones que exigen selección ("Asignar del pool", "Imprimir", "Copiar seriales", "Editar en masa", "Exportar"), y la selección no persiste al buscar de nuevo. El flujo real es "buscar cliente → seleccionar todo → acción" y eso no se sugiere. | captura 01 |
| C6 | Tres nombres para el módulo en pantalla: "Base PoC" (rail), "Equipos PoC" (volver desde Grupos), "Base de Datos POC" (docs y correos); "SIM Cards" en inglés; "Admin · Grupos PoC" vive en el panel admin aunque lo usa recepción. | capturas 30, 34 |
| C7 | La caja "Jalar nombre, grupos y GPS de 0 radio(s) saliente(s)" aparece en un lote normal. | captura 25; `nuevo-batch.js:464-480` |
| C8 | Lectores sin aviso: bodega y contabilidad rebotan al home en silencio; el vendedor también. | 2.5 |
| C9 | La consola de despacho vive como "radio" con serial `CONSOLA`; en Almacén no existe; el batch dice "no entran aquí" y manda a otra pantalla. Está bien resuelto para hoy, pero es un parche visible. | `poc-nueva-consola.js:1-21` |

### 3.3 Lento

| # | Qué | Medida |
|---|---|---|
| L1 | La primera búsqueda de cada sesión baja las 4,590 fichas vivas (2.3 s en local; en producción con red es lo que Brenda vive cada vez que abre la página: cada navegación recarga). Las siguientes son instantáneas. | E02 vs E03 |
| L2 | `admin/grupos.html` lee la colección entera para listar clientes con grupos: 3-4 s. | A07 |
| L3 | `sim-cards.html` baja 521 SIMs y pinta 150 filas de 2 líneas: 3.5 s y 12,000 px. | A01 |
| L4 | "Mostrar todo": 4,592 filas, 2.3 s, sin uso conocido. | E17 |
| L5 | En teléfono, cambiar una SIM exige scroll horizontal de 1,000 px por fila. | 2.2 |

### 3.4 Estado de los P0/P2 de PoC de la auditoría del 28-sep (verificado en el navegador)

| Ítem | Estado |
|---|---|
| P0 #24 gerente rebotado | **Resuelto** (a498af3): `poc-index.js:19` incluye GERENTE, `esLectura` es lista blanca |
| P0 #5 `?focus=` de Ctrl+K sin efecto | **Resuelto**: la fila se resalta y se lee solo esa ficha (7 peticiones) |
| P0 #26 textos que mienten | **Resuelto**: "Preparar lote (Ventas)", "Nuevo lote", "Unit ID consecutivos", sin "+ Grupo" |
| 4.7 #3 guard de rol en lote y consola | **Resuelto** (ambas redirigen con aviso) |
| 4.7 #4 Unit ID repetido al editar | **Resuelto** (cajón, masiva y vista "Unit IDs duplicados") |
| 4.7 #5 masiva sin candado | **Resuelto** (`withBusy`, try/catch por fila) |
| 4.7 #6 "Eliminar" → "Cerrar ficha", segmento, leyenda | **Resuelto**; queda B2 (cerrada + "Activo") |
| 4.7 #7 nombre del archivo, imprimir | **Resuelto** |
| 4.7 #8 lote atómico + una hoja en vez de 6 modales | **Resuelto**: WriteBatch por tandas; 0 modales en el camino feliz |
| 4.7 #9 traspaso ventas → recepción dentro del app | **Resuelto** (6001797), con R1 como hueco nuevo |
| 4.7 #10 vista móvil de 12 columnas | **Vigente** |
| P2 "SIM/Teléfono" (pegar en lote) | Botón oculto en el HTML; el módulo `poc-sim.js` sigue cargado |

---

## 4. ¿Es un módulo o son varios pegados?

Son **cuatro cosas** con una sola puerta:

1. **El parque instalado** (fichas): qué radio está con qué cliente y cómo está programado. Lo
   usa recepción todos los días.
2. **El alta** (lote de ventas → lote de recepción → consola → importar): cuatro pantallas y
   tres caminos para crear fichas.
3. **El catálogo del cliente** (grupos, prefijo, IP/servidor): vive en `clientes/{id}` y se
   administra desde `admin/grupos.html`.
4. **El inventario de SIM** (`sim_cards`): otro inventario, con su propio ciclo, que hoy cubre el
   12 % de los SIMs en uso.

Y la Base PoC no sabe nada del **pool de equipos** (Almacén), que es quien sí sabe dónde está
físicamente cada serial: por eso hay 566 seriales con dos "verdades".

**Propuesta de organización** (ver §5, P6-P7): una sola pantalla "Radios PoC" con **tres
pestañas** — *Radios* (la lista de hoy, por cliente), *Por cargar* (la cola de lotes de ventas +
consolas pendientes + importar) y *SIMs* (el pool) —, y **Grupos** como pestaña dentro de la
ficha del cliente en el Centro (donde ya están los contratos y la flota), no en Admin. El
"lote" deja de ser una página y pasa a ser una tarea de la cola.

---

## 5. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| **P1** | `vendedores-batch.js:76` y `poc-nueva-consola`/`nuevo-batch`: leer clientes con `loadClientes()` (servidor si pasaron 5 min) y **no cachear la lista 6 h en localStorage**; en `clientesService.getAllClientes` tratar una caché parcial como miss (comparar con `count()` del servidor, que ya se usa en Almacén). | R1 | Un lote sin cliente por cada cliente nuevo; 2 pasos de recepción por lote | 2-3 h | Bajo |
| **P2** | **Validar la SIM en los cuatro caminos** (cajón, masiva, pool, importar) con una sola función `PocService.simEnOtroRadio(sim, docId)` (query `where('sim_number','==')` + `deleted != true`): si está en otra ficha activa, avisar con el radio y el cliente y ofrecer "moverlo aquí y liberarlo allá" (una transacción). Regla a fijar con Alberto (pregunta Q1). | R2 | 41 SIMs cruzados hoy; los que vengan | 1 día | Bajo (la query ya tiene índice por igualdad) |
| **P3** | Arreglos de un rato: repintar tras asignar del pool (esperar el snapshot o usar el retorno de `asignar` como en el cajón); cerrar ficha pone `activo:false`; quitar "Editar en masa" para lectores; aviso al rebotar a bodega/contabilidad; esconder la caja "0 salientes"; "SIM cards" → "SIMs"; "Equipos PoC" → "Base PoC". | B1, B2, C7, C8, 2.5 | Confusión diaria | 3 h | Nulo |
| **P4** | **Cabecera con contexto**: sin filtro, conteos de servidor (`count()`: vivas, activas, cerradas, sin SIM); con cliente, "289 radios · 271 activos · 13 seleccionados · 3 sin SIM". Y que "incompleta" signifique solo lo que sí es un pendiente (sin cliente, sin serial, sin Unit ID). | C1, C2, pedido C2 de recepción | Deja de imprimir para contar | 4 h | Nulo |
| **P5** | **SIM en la fila** (maqueta, sección 1): clic en la celda SIM abre un editor en sitio con ICCID + teléfono + operador, **lector de código de barras** (los SIM traen el ICCID en barras; la tablet tiene cámara), autocompletado desde el pool y la validación de P2. Enter guarda, Esc cancela. | 293 cambios/mes; 7 pasos → **4**; cajón de 14 campos para tocar 3 | ~3 pasos × 300/mes = 900 clics y ~10 s cada uno; evita teclear 19 dígitos | 2 días | Bajo: el cajón queda para lo demás |
| **P6** | **Duplicados agrupados** (maqueta, sección 3): un grupo por serial, la ficha "buena" es la que coincide con la custodia del pool (`equipos_pool.asignacion`), las demás se marcan para cerrar en lote (WriteBatch + `poc_logs` con `origen: duplicados`). 541 de los 566 grupos tienen una sola activa: se resuelven de una. Los 25 con dos activas los decide una persona. | R3 | Limpia 1,400 fichas en una tarde en vez de una por una | 2-3 días | Medio: definir qué es "la buena" (Q2) |
| **P7** | **Una sola pantalla con tres pestañas** (§4): Radios · Por cargar (lotes de ventas, consolas pendientes por contrato, importar) · SIMs. La cola de lotes y las consolas dejan de ser páginas sueltas; el home sigue apuntando a "Por cargar". Grupos pasa al Centro del cliente (pestaña "Grupos PoC") y se lee del catálogo del cliente, no de 6,510 fichas. | C5, C6, C9, L2 | Orientación: hoy 8 páginas para 4 tareas | 1-2 semanas | Medio: mover Grupos toca `admin-grupos.js` (1,155 líneas) |
| **P8** | **Que PoC y el pool sean uno**: la ficha PoC nace del serial del pool (el lote toma `equipos_pool` como fuente, no un textarea), `poc_devices.contrato_id` se llena desde la asignación del contrato (77 % hoy vacío), y una devolución cierra la ficha **y** libera la SIM en el mismo trigger. El modelo viene del pool (71 % de fichas sin modelo). | R3, B3, B4; es la decisión 1 de `05b_diseno_reemplazos_poc.md` ("fuente de verdad = el equipo") llevada a su consecuencia | Desaparece la clase entera de duplicados por serial | 3-4 semanas, por fases (backfill primero) | Alto: toca contratos, devoluciones y reemplazos; requiere el backfill de `cliente_id` (Fases 2-3 de `PLAN-cliente-id-ordenes-poc.md`) |

La maqueta `maquetas/poc-sim-en-linea-y-duplicados.html` muestra P4, P5 y P6 con el CSS real
del app y las capturas de "antes" al lado.

---

## 6. Cómo saber si funcionó

| Cambio | Medir antes | Medir después |
|---|---|---|
| P1 | Lotes en `poc_lotes_preparados` con `cliente_id == null` (hoy 1 de 3, el de prueba) | 0 en el mes |
| P2 | `00-base-poc.js`: SIMs en >1 ficha activa = **41** | 0 nuevos; los 41 viejos bajan con P6 |
| P5 | `poc_logs` con cambio de SIM por recepción: 293/mes en 7 pasos; tiempo por cambio (medirlo con `uso_diario` + timestamp del log) | Mismo volumen en 4 pasos; pasos de "cajón" con solo SIM cambiada → 0 |
| P4 | Impresiones de PoC (`imprimir-equipos` en `uso_diario`) usadas para contar | Bajan |
| P6 | Seriales con >1 ficha viva = **566** | < 30 (solo los 25 ambiguos hasta decidirlos) |
| P7 | Páginas PoC abiertas por día y por rol (`uso_diario`, ya existe) | Menos saltos entre páginas; "Por cargar" abierta desde la señal |
| P8 | Fichas vivas sin contrato 3,534 · sin modelo 3,242 | Tienden a 0 en fichas nuevas |

---

## Top 5 impacto/esfuerzo del módulo

1. **P2 Validar la SIM en los cuatro caminos** — corta el dato falso más frecuente (293 cambios/mes, 41 cruces hoy); 1 día.
2. **P1 Lista completa de clientes en Preparar lote** — cada cliente nuevo hoy produce un lote sin cliente; 2-3 h.
3. **P5 SIM en la fila con lector** — 7 → 4 pasos en la acción más repetida del módulo y sin teclear 19 dígitos; 2 días.
4. **P6 Duplicados agrupados con la verdad del pool** — 1,453 fichas sobrantes se cierran en una tarde; 2-3 días.
5. **P4 Cabecera con contexto + "incompleta" honesta** — recepción deja de imprimir para contar; 4 h.

## Preguntas para Alberto

| # | Pregunta | Opciones y qué implica |
|---|---|---|
| Q1 | **¿Un SIM puede estar activo en dos radios a la vez?** Hoy hay 41. | (a) Nunca → P2 bloquea y ofrece mover; (b) a veces (demos, radios de respaldo) → P2 solo avisa y pide motivo. Afecta también qué hacer con los 41. |
| Q2 | **Cuando un serial tiene dos fichas vivas, ¿cuál es la buena?** | (a) La que coincide con la custodia del pool (Almacén) → P6 se automatiza para 541 casos; (b) la más reciente; (c) siempre lo decide recepción → P6 solo agrupa y marca. |
| Q3 | **¿El pool de SIM se va a usar de verdad?** Cubre el 12 % (148 disponibles; 2,759 radios activos con SIM fuera del pool). | (a) Sí: importar los ~2,700 SIMs en uso como "asignados" (script de una tarde) y hacer que el pool sea la única puerta; (b) no: quitar "Asignar del pool" y SIM cards del menú, y dejar la SIM como texto validado (P2). Mantener las dos cosas a medias es lo que produce B3. |
| Q4 | **¿A quién debe llegar el aviso "Lote PoC por cargar"?** Hoy sale a `tecnico@cecomunica.com` porque `mail_orden_creada_to` está vacío; `email_recepcion` es `cecrecep@`. | (a) `email_recepcion`; (b) el buzón de activaciones; (c) nadie, basta la señal del home (recepción ya vive en el app). |
| Q5 | **¿Grupos se administra desde Admin o desde el cliente?** Lo opera recepción (todo el catálogo es por cliente) pero vive en el panel admin. | (a) Pestaña "Grupos PoC" en el Centro del cliente (P7); (b) sigue en Admin con acceso directo desde PoC. |
| Q6 | **¿Vale la pena que PoC nazca del pool (P8)?** Es la decisión de `05b_diseno_reemplazos_poc.md` llevada al alta: sin ella los duplicados por serial vuelven a crecer aunque se limpien. | (a) Sí, por fases después del backfill de `cliente_id`; (b) no ahora: P6 como limpieza periódica (cada mes vuelven ~50). |
