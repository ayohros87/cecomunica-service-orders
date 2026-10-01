# 08 · Home, rail, navegación y panel de administración

> Auditoría de módulos 2026-09-30. Todo lo de aquí se vio funcionando en el emulador con los 60,436 documentos exportados de producción ese día, con la sesión de cada rol (`USUARIOS` de `tools/emulador-almacen/emu-lib.mjs`). Scripts en `docs/auditoria-modulos/scripts/home-nav/` (00 a 10); 86 capturas en `docs/auditoria-modulos/capturas/home-nav/` (fuera del git). Los conteos se contrastaron con Admin SDK contra el emulador (`02-verdad-senales.js`). Nada se escribió en producción ni se tocó código del app.
>
> Ojo con el emulador compartido: otros auditores crearon datos `PRUEBA-AUDIT-*` durante mis corridas (dos órdenes en mostrador, un lote PoC, un contrato). Donde un número cambió entre corridas lo digo; ninguno resultó ser un bug del app.

---

## ROTO HOY

| # | Qué | Evidencia | Efecto en quien lo usa |
|---|---|---|---|
| R1 | **La portada del panel admin dice "Contratos pendientes: 49". Son 0.** Los 49 en `pendiente_aprobacion` están borrados (`deleted: true`); el KPI cuenta con `count()` sin filtrar `deleted` (`admin-index.js:117-119`: `contar(C.where('estado','==',e))`). El home, que sí filtra (`AprobacionesService`), dice 0 en "Pendientes por aprobar". Los "205 aprobados" también traen 2 borrados (204 reales). | `capturas/home-nav/60-admin-escritorio-index.png`; `02-verdad-senales.js` → `pendiente_aprobacion: 49` con deleted vs `0` sin deleted | El dueño abre el panel y ve 49 contratos esperando su firma que no existen. Es el número más grande de la portada. |
| R2 | **"Abrir orden" desde "Órdenes sin movimiento" termina en una lista vacía.** El CTA lleva a `editar-orden.html`, que para toda orden que no esté en POR ASIGNAR muestra el toast "La orden está en ASIGNADO — la cabecera solo se edita en POR ASIGNAR" y a los 1.8 s rebota a `index.html?orden=<id>` (`editar-orden.js:238-241`). Ese `?orden=` solo filtra la primera página de la bandeja (las 50 más recientes; `ordenes-index.js:423` lo usa solo con `recibir=1`), así que la orden no aparece: "No se encontraron coincidencias". **Las 13 estancadas están fuera de las 50 recientes** (por definición: llevan ≥10 días paradas); 4 son ASIGNADO y caen en este hueco. El mismo destino usa el resultado de **orden** del buscador Ctrl+K (`busquedaGlobalService.js:129`): una orden de hace más de ~7 días (la 50.ª más reciente es 2026092302) se encuentra en el buscador y aterriza en una lista vacía. | `35-recepcion-escritorio-deeplink-orden-2026081113.png` (vacía), `35-…-2026093002.png` (reciente, sí aparece), `40-recepcion-escritorio-editar-orden-enlaces.png` (toast + "Cargando…"), `38-tecnico-telefono-editar-orden-fab.png` | Tres pantallas y un toast de error para no llegar a la orden. Afecta a jefe de taller y admin (señal EST), a S4Q cuando tenga cola, y a cualquiera que busque una orden vieja con Ctrl+K. |

Lo demás de la auditoría anterior que estaba "roto hoy" en este módulo se corrigió (ver §6).

---

## 1. Para quién es y qué hacen ahí

- **Home** (`index.html`): lo abren todos. Es la pantalla más vista del día: 41 vistas por 11 usuarios el 30-sep (`uso_diario`, único día con datos, leído en `admin/uso.html`), por delante de órdenes (36) y Centro (35). Recepción entra 12 veces al día, el dueño 8.
- **Rail y topbar** (`layout.js`, `ceco-rail.css`): en las 61 páginas con shell. Es la única forma de cambiar de módulo sin pasar por el home.
- **Ctrl+K** (`searchPalette.js` + `busquedaGlobalService.js`): disponible en todas las páginas con sesión. No hay contador de uso (no escribe audit log), así que no sé cuánto se usa. Nadie lo pidió en `docs/mejoras-solicitadas/`; lo que Brenda y Solangel pidieron ahí son cosas de órdenes y cotizaciones, no de navegación.
- **Login, perfil, firma de correo**: entrada y trámites personales. Perfil: 3 vistas ese día.
- **Panel admin** (`admin/*`, 17 páginas): solo Alberto (y Zuleika, que también es `administrador`). El día medido: `admin/index` 4 vistas, `admin/uso` 3, `admin/usuarios` 1.

Quién concentra el uso del app (audit log 30 días, §3 del brief): recepción 1,408 acciones, taller 1,248, bodega 580. Para ellos el home es el punto de partida del turno y el rail lo que usan para saltar entre Órdenes, PoC, Centro y Almacén.

---

## 2. Recorrido real

### 2.1 El home con cada rol (escritorio 1280×800, camino frío: perfil de Chrome nuevo, sin caché de señales)

| Rol (cuenta) | Señales del día (tarjetas) | Seguimiento | "Al día" (en cero) | Tarjetas de módulo | Peticiones a Firestore | Hasta quieto* | Captura |
|---|---|---|---|---|---|---|---|
| admin (Alberto) | Por asignar **20** · Sin movimiento **13** · Mis cotizaciones **4** · Mis contratos por firmar **1** | Mis cuentas por regularizar 2 · Cuentas por regularizar 128 | Por aprobar · Órdenes por crear · Esperando QC · Cotizaciones por aprobar · Lotes PoC | 8 + Firma, Perfil, Admin | 24 | ~1.9 s | 01 |
| gerencia (Zuleika, rol administrador) | igual que admin, con Mis cotizaciones **13** · Mis contratos por firmar **3** | 39 · 128 | idem | idem | 26 | ~1.8 s | 02 |
| recepción (Brenda) | Por asignar **20** · Listas para entregar **46** | — | Órdenes por crear · Recibidas en mostrador · Lotes PoC | 6 + Firma, Perfil | 17 | ~1.0 s | 03 |
| cobros (Andrea, rol recepción) | idem recepción | — | idem | idem | 18 | ~1.3 s | 04 |
| jefe_taller (Solangel) | Por asignar **20** · Sin movimiento **13** | — | Esperando QC · Cotizaciones por aprobar | Órdenes, PoC, Cotizaciones | 13 | ~1.0 s | 05 |
| técnico (Marcos) | Mis órdenes asignadas **3** | — | — | Órdenes, PoC | 11 | ~0.5 s | 06 |
| técnico_operativo (Ovidio) | Mis órdenes asignadas **4** | — | — | Órdenes | 11 | ~0.6 s | 07 |
| inventario (José) | Seriales por asignar **4** · Piezas sin stock **8** | Devueltos por inspeccionar 152 · Por clasificar 1223 | — | Almacén | 17 | ~0.5 s | 08 |
| vendedor (Karla) | Mis cotizaciones **3** | Mis cuentas por regularizar 1 | Mis contratos por firmar | Órdenes, Preparar lote, Centro, Cotizaciones, Contratos | 12 | ~0.6 s | 09 |
| contabilidad (Cheila) | **ninguna** | — | — | Contratos, Finanzas | 7 | ~0.4 s | 10 |

\* Última mutación del DOM desde el arranque de la página, emulador local. En producción súmale ~150-250 ms por viaje en serie. Tras la primera carga, los números salen de la caché de sesión (5 min) y de "últimos conocidos" (localStorage, 12 h): el home pinta al instante.

Tablet (1024×768) y teléfono (390×844) con recepción, técnico y bodega: mismas señales y tarjetas, sin scroll horizontal (capturas 11 a 15). En teléfono la fila de señales pasa a una tarjeta por línea con el número a la derecha (12); el botón flotante del menú se monta encima de la tarjeta "Centro de gestión" (12, se ve el ícono tapado).

**¿Los conteos son verdad?** Sí. Contrastados con Admin SDK sobre las 2,107 órdenes, 540 contratos, 7,824 unidades del pool y 457 clientes del emulador:

| Señal | Home | Verdad (Admin SDK) | Nota |
|---|---|---|---|
| S1 Por asignar | 20 | 20 (44 de taller: 20 con ≤30 días + 24 "por depurar" de hasta 236 días; 25 DEVOLUCION excluidas) | El panel muestra las 44 con el grupo "Más de 30 días — por depurar 24" (captura 36). Bien. |
| ENT Listas para entregar | 46 | 46 (79 cumplen el predicado; 33 pasan de 30 días) | La consulta topa en 150 docs COMPLETADO; hay 92. Margen corto: a 150 el número mentiría en silencio. |
| EST Sin movimiento | 13 | 13 (9 POR ASIGNAR, 4 ASIGNADO) | Consulta con `limit(150)` sin orderBy sobre 152 abiertas: las 13 caen dentro por casualidad de ids. Mismo riesgo que ENT. |
| S4Q Esperando QC | 0 | 0 (76 con `qc_requerido`, ninguna en cola operativa) | Bien. |
| FIR / FIRV Contratos por firmar | 13 (Alberto 1, Zuleika 3) | 13 (Elvia 5, Salomón 4, Zuleika 3, Alberto 1); 6 con orden | Bien. Ninguno de los 13 es de Karla (su FIRV = 0, correcto). |
| APR Pendientes por aprobar | 0 | 0 contratos vivos + 0 gestiones en espera | Bien (los 49 borrados no cuentan aquí; sí en el admin, R1). |
| S15 Seriales por asignar | 4 | 5 (el 5.º es `PRUEBA-AUDIT-almacen-01`, creado por otro auditor después) | Bien. |
| S13 / S14 | 152 / 1223 | 152 / 1224 (1 de prueba) | Bien. 1,199 de las 1,224 "por clasificar" pasan de 30 días. |
| S9 Piezas sin stock | 8 | 8 de 16 | Bien. |
| REGG / REGV | 128 / 39 (Zuleika) | 128 / 39 | Bien. La consulta topa en 400 clientes con puntos; hay 249. |
| S5 Mis órdenes (Marcos / Ovidio) | 3 / 4 | 3 / 4 (Ovidio: 3 de las 4 pasan de 30 días) | Bien, pero ver §3 "confuso". |
| S2 / LPC | 0 / 0 en la primera corrida, 2 / 1 después | 2 / 1 | Deriva del emulador (otros auditores); no es bug. |

### 2.2 El rail

Escritorio, admin, 18 páginas (script 03): el rail está en todas, con el módulo activo bien marcado en 15. Sin activo en `perfil.html`, `firma-correo.html` y `clientes/index.html` (esta última es la edición masiva "avanzada": correcto que no sea módulo, pero queda sin ancla). `inventario/modelos.html` y `facturacion/activacion.html` marcan **Finanzas** aunque la tarjeta del home diga "Finanzas · Catálogo · QuickBooks · Emisión" y el `<title>` diga "Modelos y Tarifas": la persona que entra por "Finanzas" cae en "Modelos y Tarifas" con el botón "Finanzas" de vuelta apuntando a la misma página. `inventario/pendientes.html` y `piezas.html` marcan Almacén (bien). El rótulo del rail y el título de la página coinciden en Órdenes, Base PoC, Centro, Cotizaciones, Almacén; difieren en "Contratos" (título: "Archivo de contratos y gestiones"), "Preparar lote (Ventas)" ("Preparar lote de equipos PoC"), "Finanzas" ("Facturación pendiente" / "Modelos y Tarifas") y "Panel admin" ("Panel de Administración"). Ninguna diferencia desorienta salvo Finanzas.

Contraído: un clic, persiste entre páginas (`data-cc-rail=mini` se lee en el parse; captura 21). Bien.

**Tablet 1024×768** (la de recepción para firmar): el rail **no existe** — `ceco-rail.css:170` oculta a `max-width:1024px`, y 1024 es exactamente el ancho del iPad en horizontal. Queda el botón flotante abajo a la izquierda (captura 22): 2 toques para cambiar de módulo. En la bandeja de órdenes a ese ancho el número de orden se monta sobre el nombre del cliente ("2026093006MACELLO"): es de órdenes, lo anoto para ese informe.

**Teléfono**: en Centro, PoC, Almacén y el detalle de orden hay botón flotante → cajón → módulo: **2 toques**. En **la bandeja de órdenes ≤768 px no hay botón flotante** (la barra inferior lo esconde a propósito, `layout.js:560-571`) y la barra solo trae Órdenes / Nueva / Filtros: la salida es Filtros → desplazar 173-225 px dentro del cajón → "Menú principal" → home → módulo: **3 toques más un desplazamiento** (captura 23). Los enlaces del cajón del rail miden **34 px de alto** (`ceco-rail.css:76`, `padding:8px 12px`), por debajo de los 44 px táctiles; en el home en teléfono 11 de 27 objetivos están por debajo de 36 px.

El P0 #4 de la auditoría anterior quedó **parcial**: entre 769 y 1024 px ya hay botón flotante (verificado en tablet); en teléfono la bandeja de órdenes sigue siendo la peor pantalla para salir.

### 2.3 Buscador Ctrl+K (script 04; admin desde Órdenes, recepción desde el Centro, bodega desde Almacén)

Abre en 40-50 ms (carga bajo demanda). Con la caja vacía muestra "Recientes" si los hay. Tiempos medidos hasta pintar resultados, emulador local:

| Qué busqué | Texto | ms | Encuentra |
|---|---|---|---|
| Cliente por nombre | `C COMUNICA` | 1,076 | sí: 3 clientes, 5 órdenes, 5 contratos |
| Palabra a medias | `hospi` | 884 | sí (prefijos del índice) |
| RUC completo / parcial | `32977-27-249966` / `32977` | 1,003 / 1,293 | sí / sí |
| RUC con letras | `8-NT-1-12501` | 1,427 | sí |
| Orden reciente | `2026093002` | 1,824 | sí |
| Orden de hace 50 días | `2026081113` | 1,808 | sí, **pero Enter aterriza en lista vacía** (R2) |
| Orden por número corto | `093002` | 1,389 | **no** ("Sin resultados") |
| Serial en orden y PoC | `23706A0608` | 1,709 | sí: la orden y la ficha PoC |
| Serial PoC de hace 2,000 fichas | `21N18A0318` | 1,655 | **no la ficha PoC** (solo escanea las 500 más recientes, `SCAN_LIMIT`); sí 5 órdenes viejas |
| Serial que solo está en el pool | `014290000053877` | 1,696 | **no**: el pool (7,824 unidades) no se busca |
| unit_id PoC | `275643` | 1,140 | sí |
| Cotización / número corto | `COT-2026-0138` / `0138` | 1,180 / 1,138 | sí / sí (y 4 órdenes con ese trozo) |
| Con y sin acento | `compañía goly` / `compania goly` | 982 / 1,324 | sí / sí |

Como bodega (José), `COT-2026-0138` da "Sin resultados": las reglas no le dejan listar cotizaciones y el buscador se lo traga sin decirlo. Como bodega, lo que él más necesita (un serial del pool) tampoco está.

A dónde lleva cada resultado: cliente → `clientes/editar.html?id=` → redirección a `ficha.html?from=centro&id=` (dos cargas de página para llegar a una ficha de solo lectura, no al Centro); orden → `ordenes/index.html?orden=` (R2); contrato → `contratos/index.html?buscar=`; cotización → detalle (bien); PoC → `POC/index.html?focus=…&campo=serial&id=` (bien: aterriza con el filtro puesto y una fila; el P0 #5 anterior está resuelto).

Desde el home: teclear "beverly" abre el palette solo a los 450 ms con el texto ya dentro (captura 34). Bien.

### 2.4 Enlaces cruzados y el costo de un recorrido (recepción, escritorio, sesión caliente; script 05)

| # | Pantalla | Hasta quieto | Enlaces a otros módulos que se ven (sin contar el rail) |
|---|---|---|---|
| 1 | Home | 174 ms | señales y tarjetas |
| 2 | Detalle de orden 2026093002 (SKY CHEFS) | 331 ms | **ninguno**: ni al cliente, ni a la gestión GD20260925-01, ni a los seriales |
| 3 | Centro · ficha SKY CHEFS | 617 ms | 1 (a "por clasificar" en Almacén). La ficha dice "11 equipos en taller · le toca al taller" y no enlaza ninguna orden (captura 43) |
| 4 | Archivo de contratos con `?buscar=` | 905 ms | 2 ("Ir al Centro de gestión", sin `?id=`) |
| 5 | Almacén · Serial | 687 ms | 4, todos dentro de Almacén |

Suma de las 5 pantallas hasta quieto: **2.7 s** en local (≈ 540 ms por pantalla). En producción, con el primer viaje de ~400 ms, calculo 4-5 s por recorrido. **Eso no pesa.** Lo que pesa es que de la orden al cliente, del cliente a sus órdenes y de cualquier lado al serial **no hay enlace**: cada salto es Ctrl+K más teclear el nombre o el número (≈ 10-15 caracteres y 1-2 s de búsqueda). Ningún enlace cruzado abre en pestaña nueva; con "Mantener sesión" marcado por defecto (`login.html:71`), Ctrl+clic ya no pide login.

### 2.5 Sesión, "Ver como", perfil (script 06)

- Login: "Mantener sesión" viene **marcado**; clave mala → "Contraseña incorrecta." (el emulador devuelve `wrong-password`; `invalid-credential` está mapeado para producción); `?motivo=sesion` → "Tu sesión venció." Las redirecciones al login son absolutas (`firebase-init.js:389-429`). T5 resuelto. No pude probar la expiración real ni el rebote sin sesión: la lib del emulador inicia sesión sola.
- "Ver como" desde el admin: abre (el `modal.js` está importado, `entry/admin-index.js:8`), lista 9 roles incluida contabilidad. `?as=recepcion` pinta banner, señales, tarjetas y rail de recepción (captura 53). **Al hacer clic en cualquier módulo el modo se pierde**: en Órdenes el rail vuelve a ser el de admin y aparece "Crear nueva orden" (`MODULOS.rolEfectivo` lee `?as` de la URL actual). El banner dice "viendo el home como", así que no miente, pero para lo que Alberto quiere ("qué ve Brenda en órdenes") no sirve.
- Perfil: nombre, correo, rol legible, "Mi firma de correo" y "Cambiar contraseña" (captura 55). Firma de correo: nombre y cargo ("Gerente General") salen de `usuarios/{uid}`, teléfono y celular vacíos, sin datos inventados (captura 56). Resuelto.
- Atajos del home: Ctrl+F ya no navega; `g` abre el Centro. P0 #2 resuelto.

### 2.6 Panel admin (script 07; 17 páginas, escritorio, y 3 en tablet)

| Página | Hasta quieto | Qué baja | Qué vi |
|---|---|---|---|
| index | 0.8 s | 35 peticiones (agregados) | 4 KPIs: Órdenes abiertas 64 (verdad 64), **Contratos pendientes 49 (verdad 0, R1)**, Cotizaciones por vencer 11 / 11 vencidas (verdad), PoC activos 3,206 (verdad). Reorganizado por tarea (captura 60). |
| operación | **8.6 s** | 2,106 órdenes + 6,514 fichas PoC + contratos + cotizaciones + clientes + piezas | "Requiere atención": 5 sin técnico (bien), "COT-2026-0003 vencida hace 106 días (estado: aprobada)". Tablas por estado/técnico. |
| financiero | 1.2 s | contratos ×2 + cotizaciones | Aviso honesto: "NO son facturas emitidas". |
| kpi-reportes | 0.4 s | 56 meses | Publicar solo tras archivar el PDF (`admin-kpi-reportes.js:114-119`): resuelto. |
| uso | 1.2 s | 1 doc | "361 páginas vistas · 12 usuarios · 2026-09-01 a 2026-09-30". Solo hay un día. Rango 7 / 30 días. |
| usuarios | 0.4 s | 18 usuarios | Opción "— Sin rol —" y filtro `?filtro=sinrol`: resuelto. Dos cuentas con correo fuera del dominio (`dionisio.quintero@sin.email…`, `jminan13@hotmail.com`, ambas `tecnico_operativo`). |
| auditoría | 2.2 s | 300 + 300 + usuarios | Filtros de persona y fechas: resuelto. |
| config, alertas, pii, backfills, email-preview | 0.1-0.4 s | config | Alertas: "No hay alertas configuradas". PII: activar pide confirmación (`admin-pii.js:204`): resuelto. Backfills: los 8 "Ejecutar" deshabilitados hasta la vista previa: resuelto. |
| clientes-duplicados, refs-huérfanas | 0.1 s (no corren solas) | — | El texto "reversible" ya no está. |
| grupos | 2.0 s | 420 clientes + POC | |
| salud | 1.9 s | 2,106 órdenes | Todo en verde. |
| integridad | **3.7 s** | órdenes + clientes + POC + contratos + cotizaciones | 119 + 5 + 930 + 7 + 1 casos; muestra los primeros 50. |

Tablet: index, operación y usuarios sin scroll horizontal, con botón flotante (capturas 80-82).

---

## 3. Hallazgos

### Roto

- **R1 y R2** (arriba).
- **R3. El técnico llega al detalle de una orden y no puede hacer nada.** `editar-orden.html` es el editor de la **cabecera** (tipo de servicio, vendedor, observaciones); para una orden ASIGNADA muestra el toast de error, deja "Cargando…" en cliente y expediente, y rebota (captura 38 y 40). En teléfono el toast tapa el botón flotante del menú (`elementFromPoint` devuelve `DIV.toast error`; script 08). El trabajo de verdad del técnico está en la bandeja (fila expandida + modal). Ninguna señal ni resultado de búsqueda lleva ahí por id.
- **R4. Dos consultas del home con tope silencioso.** `listListasParaEntregar` (`senalesService.js:531-533`) y `listEstancadas` (`:557-563`) traen `limit(150)` sin `orderBy`. Hoy hay 92 COMPLETADO y 152 abiertas (incluidas borradas y DEVOLUCION): la segunda ya pasó el tope y las 13 estancadas cayeron dentro por el orden de ids. El día que una estancada quede fuera, el número baja sin aviso. `listOrdenesPorAsignar` sí pagina (`:165-180`); esas dos no.

### Confuso

- **C1. El home de admin trae 11 señales**; 5 en cero se listan como texto en "Al día" (captura 01). Funciona, pero "Al día: Pendientes por aprobar · Órdenes por crear · Esperando control de calidad · Cotizaciones por aprobar · Lotes PoC por cargar" ocupa dos líneas que nadie lee. El plan del Command Center pedía 4 tiles.
- **C2. Contabilidad abre un home vacío** (captura 10): sin señales, dos tarjetas. El plan lo dejó así "v1". Cheila entró 3 veces ese día: sabe que no hay nada que ver.
- **C3. "Mis órdenes asignadas" del técnico operativo cuenta 4, y 3 pasan de 30 días** (Ovidio; Admin SDK). Para el resto de señales las viejas se apartan como "por depurar"; aquí no. El número que ve el técnico al llegar es en su mayoría arrastre.
- **C4. "Ver como" solo aguanta en el home** (§2.5). Y el pie del rail dice "Alberto Yohros · Recepción", que sí confunde.
- **C5. Finanzas es una tarjeta que aterriza en "Modelos y Tarifas"**, con un botón "Finanzas" que no va a ningún espacio (§2.2). Para admin y contabilidad la portada del espacio es el catálogo de modelos por decisión del 2026-08-20; la tarjeta debería decirlo.
- **C6. El resultado de cliente en Ctrl+K va a la ficha de solo lectura por una redirección**, no al Centro, que es "la única entrada al mundo clientes" desde el 2026-09-03 (`modulos.js:27-32`). Dos cargas para llegar a una pantalla que no es la de trabajo.
- **C7. Bodega no encuentra un serial del pool con Ctrl+K**, y tampoco se le dice que las cotizaciones no las puede ver. Lo primero es lo que más le serviría a José (534 acciones al mes en Almacén). Está en `senalesService`/`busquedaGlobalService` como pendiente desde la auditoría anterior (T6).
- **C8. Panel admin "Requiere atención" mezcla ruido**: "COT-2026-0003 vencida hace 106 días (estado: aprobada)" sale primera entre las cotizaciones; una cotización aprobada y vencida hace tres meses no es una alerta, es limpieza.

### Lento

- **L1. `admin/operacion.html` 8.6 s e `integridad.html` 3.7 s** en local (bajan 2,106 órdenes y 6,514 fichas PoC cada vez). El plan de velocidad lo dejó a propósito ("solo las usa el dueño"). Está bien dejarlo si Alberto no las abre a diario; el `uso_diario` de un día no dice cuánto las usa.
- **L2. El home en frío de admin tarda ~1.9 s por `listOrdenesPorAsignar` (1.3 s: pagina de 100 en 100 los 69+ POR ASIGNAR) y `listCuentasPorRegularizar` (128 clientes)**. Después va de caché. Aceptable.
- **L3. Cada navegación recarga la página**: ~540 ms por pantalla en local, calculo ~0.9 s en producción. Un recorrido de 5 pantallas cuesta 4-5 s. No es lo que frena; lo que frena es teclear en Ctrl+K lo que un enlace daría gratis (§2.4).

---

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| P1 | **KPI de contratos del admin con `deleted` filtrado** (restar `deleted == true` como ya hace `vivas()` con `eliminado`, `admin-index.js:88-91`). | R1 | El número más grande de la portada deja de mentir. | 20 min | ninguno |
| P2 | **"Abrir orden" de las señales y del buscador → `ordenes/index.html?ids=<id>`** (el deep-link de `ordenes-filters.js:784` que ya usa "Abrir en su módulo" y los correos), y que `?orden=` sin `recibir` haga lo mismo que `?ids=`. | R2, R3 | 2 pantallas y un toast menos por clic; la orden aparece siempre, con su fila expandible y su menú de acciones. | 1-2 h | bajo: los deep-links existen |
| P3 | **Paginar `listListasParaEntregar` y `listEstancadas`** como `_leerOrdenesPorAsignar`, o al menos `orderBy(documentId(), 'desc')` con aviso "N+" al topar. | R4 | Que el número no baje en silencio cuando pasen de 150. | 1 h | bajo |
| P4 | **Botón "Menú" en la barra inferior de Órdenes** (o mostrar el botón flotante también con la barra) y `min-height: 44px` en `.rail__link` bajo `(pointer: coarse)`. | §2.2 teléfono | De 3 toques + scroll a 2 para salir de la pantalla más usada. | 2 h | bajo |
| P5 | **Resultado de cliente en Ctrl+K → `clientes/centro.html?id=`**; buscar también en `equipos_pool` (por `serial_norm`, doc ID = serial: una lectura directa, sin escaneo) y aterrizar en `almacen/index.html?tab=existencias&serial=`; decir "no puedes ver cotizaciones" en vez de nada. | C6, C7 | Bodega encuentra un radio en 1 s en vez de abrir Almacén y filtrar; el cliente llega a su pantalla de trabajo en una carga. | 3-4 h | bajo |
| P6 | **"Mis órdenes asignadas" con el corte de 30 días** (mismo `_vieja` de S1) y las viejas como "por depurar" en un panel con filas. | C3 | El técnico ve 1 en vez de 4, y las 3 viejas quedan a la vista de la jefa. | 2 h | bajo |
| P7 | **"Ver como" persistente** (guardar `?as` en `sessionStorage` y que `rolEfectivo` lo lea; pie del rail "Alberto · viendo como Recepción"; el botón "Salir" en todas las páginas). | C4 | Alberto puede recorrer un módulo como Brenda sin pedirle la clave. | 2-3 h | medio: hay que revisar que ningún guard de página use el rol efectivo para permisos |
| P8 | **Franja de contexto en todo detalle** (orden, contrato, gestión, serial): cliente → gestión/contrato → seriales → cotización, cada uno enlace a su módulo con el registro enfocado; y en la ficha del Centro, las órdenes abiertas del cliente enlazadas. Maqueta: `maquetas/home-nav-franja-contexto.html`. | §2.4 | Cada salto entre módulos pasa de Ctrl+K + 10-15 caracteres + 1.5 s a 1 clic. Recepción hace esto decenas de veces al día. | 2-3 días (la franja es un componente; cada página le pasa ids) | bajo |
| P9 | **Home de contabilidad con dos señales**: "Avisos por facturar" (`facturacion_avisos` pendientes) y "Contratos activados sin factura" (o lo que Cheila diga). | C2 | Deja de abrir una pantalla vacía. | 3 h (las consultas existen en la bandeja de facturación) | bajo |
| P10 | **Admin: tope de 4 tarjetas + "más" plegado**, y "Requiere atención" de operación con los mismos cortes del home (≤30 días; lo viejo aparte). | C1, C8 | Que la portada y operación digan lo mismo que el home. | 0.5 día | bajo |
| P11 | **Un solo cascarón sin recarga** (SPA ligera: el rail y la sesión se quedan, cambia el `main`). | L3 | Quita el primer viaje de ~400 ms por pantalla y el parpadeo; abre la puerta a "pestañas" dentro del app. | 3-4 semanas; el plan de velocidad ya lo llamó "otro proyecto" | alto: 103 páginas |

Mi recomendación: P1 a P6 esta semana (un día de trabajo en total, todos "roto" o "confuso" con evidencia). P8 es la que cambia cómo se siente el app, y no necesita P11. P11 no la haría ahora: con P8 los recorridos tienen menos pantallas, y 0.9 s por pantalla no es lo que la gente sufre.

---

## 5. Cómo saber si funcionó

- **R1**: `admin/index.html` "Contratos pendientes" = `AprobacionesService.contar('contratos')` del home. Hoy 49 vs 0.
- **R2/R3**: desde el panel "Órdenes sin movimiento", clic en "Abrir orden" → la orden se ve en la primera pantalla (hoy: 3 pantallas, 0 filas). Medir con el script 08 (`?orden=2026081113` → filas > 0).
- **P4**: toques desde la bandeja de órdenes en teléfono hasta el Centro: 3 + scroll → 2. Script 03.
- **P5**: Ctrl+K con `014290000053877` (solo pool) → 1 resultado; con `COT-…` como bodega → mensaje. Script 04.
- **P8**: en `uso_diario`, las vistas de `clientes/centro` y `almacen/index#existencias` por usuario de recepción deberían subir sin que suban las de `index` (menos vueltas al home); y las aperturas del palette (hoy no se cuentan: añadir un `paginas["ctrlk"]` al mismo contador cuesta 5 líneas).
- **General**: `uso_diario` con 30 días. Hoy hay un día y ya dice algo: el home es la pantalla más vista (41), lo que confirma que la gente vuelve al home para cambiar de módulo.

---

## 6. Estado de la auditoría del 2026-09-28 (lo verificado en el navegador)

§4.1: #1 verificación pública: fuera de mi recorrido (no la abrí). #2 atajos con Ctrl: **resuelto**. #3 login relativo: **resuelto**. #4 Órdenes móvil sin salida: **parcial** (tablet sí, teléfono no). #5 `?focus=` PoC: **resuelto**. #6 LOCAL por defecto, `invalid-credential`, motivo, contabilidad con Contratos: **resuelto**. #8 frescura de conteos ("Actualizado hace N min" + botón): **resuelto**. #9 deep-links (SAP `aprobar=1`, EST `?ids=`, S7 `activas`, REGV `filtro`): **resuelto**. #10 tarjetas desde `MODULOS.CATALOGO`: **resuelto**. #11 `user-scalable=no`: **resuelto** en home y órdenes. #12 firma-correo sin datos falsos, con rail: **resuelto**. #14 rail en el home: **resuelto**.

§4.9: #1 estados desde `AdminMetrics`: **resuelto** (los KPIs de órdenes cuadran con Admin SDK). #2 `modal.js` y contabilidad en Ver como: **resuelto**. #3 `public/tools/`: **borrado**. #4 aviso sin rol → `usuarios.html?filtro=sinrol` y opción "— Sin rol —": **resuelto**. #5 PII confirma al activar; KPI publica tras el PDF: **resuelto**. #6 auditoría con persona y fechas: **resuelto** (la colección `admin_audit` no la verifiqué). #7 "reversible" quitado: **resuelto** (el deshacer no lo probé: no fusioné nada). #8 backfills bloqueados hasta la vista previa: **resuelto**. #11 reorganizado por tareas: **resuelto**. Lo nuevo: R1.

T4 (guards): gerente/vista no tienen usuarios en producción; no los recorrí. T5: resuelto. T6: parcial (falta el pool, el número corto de orden y el destino de cliente). T7: parcial (tablet bien; teléfono en órdenes no; 34 px en el cajón).

§6 (quién ve qué): coincide con lo que vi. Contabilidad ya tiene Contratos. Vendedor sin "Nueva orden": confirmado (Karla no tiene el botón). Cobros y recepción ven exactamente lo mismo: `cobros` tiene rol `recepcion` y por eso ve "Órdenes por asignar 20" y "Listas para entregar 46" que no son suyas (Andrea hace asignar vendedor y facturación).

---

## 7. Opinión franca sobre la estructura

**Los módulos como están sirven para bodega y taller, y estorban para recepción y ventas.** José (bodega) vive en un solo módulo: su rail tiene una entrada y su home dos señales; para él la estructura es perfecta. Marcos y Ovidio igual: Órdenes y nada más. Solangel: Órdenes y Cotizaciones, y la cotización nace de la orden. Ahí la organización por módulo coincide con la persona.

Recepción y ventas cruzan módulos todo el tiempo, y el app lo sabe: por eso existen el Centro (la vista por cliente), las señales del home (la vista por tarea) y el buscador. Pero **las tres vistas están desconectadas del detalle**: desde una orden no se llega al cliente, desde el cliente no se llega a la orden, desde ninguno se llega al radio. Lo probé con la orden de SKY CHEFS: cero enlaces. El `uso_diario` de un día lo confirma: el home es la pantalla más vista, porque volver al home es la forma de cambiar de cosa.

No propondría reorganizar el rail "por tarea" ni "por rol": el rail ya se filtra por rol y las tareas ya están en las señales. Lo que falta es lo más barato: **que cada registro enlace a los registros con los que se relaciona** (P8), y que las señales lleven a la fila de trabajo y no al editor de cabecera (P2). Con eso el módulo deja de ser una caja de la que hay que salir; la persona entra por donde le toque (una señal, un cliente, un serial) y navega por la relación. Si después de eso el primer viaje de 400 ms sigue doliendo, entonces sí el cascarón sin recarga (P11).

Una cosa más: el panel admin ya está bien organizado por tarea; lo que le sobra son las páginas de diagnóstico que bajan 8,600 documentos para mostrar tablas que el home ya resume (operación repite "sin asignar" y "estancadas" con otros cortes). Si Alberto mira operación menos de una vez por semana, yo la dejaría; si la mira a diario, hay que hacerla con agregados como la portada.

---

## Top 5 impacto/esfuerzo del módulo

1. **P2 · Señales y buscador → `?ids=`**: fin del rebote a lista vacía para las 13 estancadas y toda orden vieja; 1-2 h.
2. **P1 · KPI de contratos sin borrados**: la portada del admin deja de decir 49 donde hay 0; 20 min.
3. **P8 · Franja de contexto con enlaces cruzados**: cada salto orden↔cliente↔serial pasa de teclear a un clic; 2-3 días.
4. **P5 · Ctrl+K con el pool y el cliente al Centro**: bodega encuentra un radio en 1 s; 3-4 h.
5. **P4 · Salida del teléfono en Órdenes + 44 px en el cajón**: 3 toques + scroll → 2; 2 h.

## Preguntas para Alberto

1. **Cobros (Andrea) tiene rol `recepcion`** y ve "Órdenes por asignar" y "Listas para entregar" que no son su trabajo (ella asigna vendedores y factura). ¿Le creamos un rol `cobros` con su propio home (avisos por facturar, cuentas sin vendedor) o la dejamos como recepción? Un rol nuevo cuesta ~medio día (modulos, roles, rules, señales).
2. **Contabilidad (Cheila) abre un home vacío.** ¿Qué debería ver al entrar: avisos por facturar en QuickBooks, contratos activados sin factura, comisiones listas para pago? Necesito que ella o tú lo digan; no lo deduzco.
3. **Dos cuentas con correo fuera del dominio** con rol `tecnico_operativo` (`jminan13@hotmail.com`, `dionisio.quintero@sin.email.cecomunica.com`). ¿Son personal activo? Si no, desactivarlas desde Usuarios.
4. **¿Con qué frecuencia abres `admin/operacion.html` e `integridad.html`?** Si es a diario, vale rehacerlas con agregados (medio día); si es esporádico, se dejan como están.
5. **"Ver como"**: ¿te basta con el home o quieres recorrer módulos enteros como otro rol (P7)? Lo segundo obliga a revisar que ningún guard use el rol visual para permitir acciones.
6. **Enlaces cruzados en pestaña nueva o en la misma**: hoy todo abre en la misma pestaña. Para recepción con dos cosas a la vez (una entrega en la tablet y una llamada), ¿prefieres que cliente/contrato/serial abran en pestaña nueva por defecto?
