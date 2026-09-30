# Velocidad de pintado — recorrido de las 79 pantallas (2026-09-29)

> **Meta:** que el app se sienta como un programa local: el dato aparece sin espera perceptible.
> **Base medida (oficina, Chrome contra producción):** primer viaje a Firestore por página ~400 ms (abre el canal; ya sin autodetección de long polling), cada viaje en serie después 130-220 ms, leer de la caché local 50 ms, archivos de la página 100 ms con caché. El rol, la config de empresa, el doc del usuario y los técnicos ya salen de `Sesion.memo` (sessionStorage) desde la segunda página.
> **Estado (2026-09-30): COMPLETO.** Las cinco olas en producción con CI en verde: A 13571fb, B d9d91de, C 5e01589, D e77ca35, E 2bc2790. Lo que se dejó a propósito está en §5.
> **Ya hecho antes de este plan (6b3bb96, d32b7ae):** memo de sesión, órdenes con precargas en paralelo, Centro con ficha en paralelo y directorio desde caché, Existencias desde caché, sin autodetección de long polling.

## 1. Los siete patrones que se repiten

Casi todo lo lento cae en uno de estos. Arreglar el patrón donde aparece es más barato que pensar cada pantalla desde cero.

| # | Patrón | Costo típico | Arreglo | Dónde aparece |
|---|---|---|---|---|
| P1 | **Lecturas independientes en serie** (`await` uno tras otro cuando solo necesitan el mismo id) | 150 ms por viaje extra | `Promise.all` | cotizar-orden (6-7 viajes), editar-orden (4-5), contratos-transicion (5), contratos-documento (4-5), contratos-seriales (3-4), POC-nuevo-batch (5-6), almacén Asignar (5-7), cot-detalle, cot-editor, clientes-ficha, clientes-index, admin-auditoria, imprimir-contrato, imprimir-equipos, inventario-modelos, sim-cards |
| P2 | **La lista principal espera al servidor** aunque la caché local ya la tiene | 300-400 ms percibidos en visitas repetidas | `get({source:'cache'})` → pintar → `get()` → repintar | cotizaciones-index, facturacion-activacion/bandeja/comisiones, cartera del vendedor y filtro de regularización en el Centro, clientes-regularizacion, clientes-index, admin-usuarios, inventario-modelos, piezas-tarifas, sim-cards, almacén Hoy |
| P3 | **Catálogos releídos en cada página** (modelos 123 docs, vendedores, usuarios por rol, operadores, facturacion_config, IPs) | 150-200 ms | `Sesion.memo` 30 min, `{fresh:true}` donde se editan | `ModelosService.getModelos/catalogo`, `UsuariosService.getUsuariosByRol/getVendedores`, `EmpresaService.getOperadores`, `facturacion_config` en modelos y activación, `senalesService._config` |
| P4 | **Clientes completos del servidor** (`listClientes({limit:2000})`) cuando `loadClientes()` ya lee de caché y revalida cada 5 min | 300-400 ms | usar `ClientesService.loadClientes()` / `getAllClientes` | nueva-orden, admin-equipos-cliente, POC-nuevo-batch, POC-nueva-consola |
| P5 | **Esperar a QuickBooks antes de pintar** (callable de 1-3 s) | 1-3 s | pintar la tabla y enriquecer con QBO al llegar (patrón de inventario-modelos) | inventario-cargos, facturacion-clientes-qbo (memo 10 min + "Recargar QBO") |
| P6 | **Render sin tope y barridos de iconos globales** (`lucide.createIcons()` sobre todo el documento, o `{nodes:[…]}`, opción que no existe y recorre todo) | 50 ms a 3 s de congelamiento | pintar 200 filas + "mostrar más"; menú ⋯ al abrirlo; `Icons.pintar(root)` | POC búsqueda y "Mostrar todo", inventario Serial/Avanzado (miles de filas, dos renders), piezas (`{nodes}` ×3), facturacion-bandeja (`{nodes}`), nuevo-batch (`createIcons` por fila), cotizar-orden (4 barridos + uno por tecla), piezas-tarifas (opciones QBO por fila) |
| P7 | **Barridos de colecciones completas** donde basta `count()` o una ventana | 1-3 s y miles de lecturas | `.count()`, `where` por fecha, compartir un solo `listAll` | admin-index (9,300 docs por carga), admin-operacion (11,000), admin-integridad (12,700, órdenes dos veces), admin-grupos (poc completo con `fresh:true`), admin-refs-huerfanas, admin-salud, admin-financiero (mismas consultas dos veces) |

Dos hallazgos que no son patrón sino error:

- **`contratos/editar-contrato.html:44`**: `setTimeout(…, 1500)` antes de redirigir al Centro en el camino de éxito. 1.5 s regalados en cada edición.
- **`home-signals.js` `_recontar`**: recepción recuenta las señales 108 veces por hora al volver a la pestaña (freno de 60 s y `invalidarListas()` en cada recuento). Subir el freno a 5 min y no invalidar listas si no es forzado.

## 2. Ranking por ganancia × uso

Orden en el que conviene atacarlo. "Uso" sale del audit log (recepción y vendedores viven en órdenes, Centro, POC y home).

| # | Pantalla · cambio | Ganancia | Esfuerzo | Archivo · función |
|---|---|---|---|---|
| 1 | **cotizar-orden**: consumos, catálogos, piezas, jefes y borrador en paralelo con `getOrder`; piezas desde caché; `Icons.pintar(panel)` | −600 a −800 ms | bajo-medio | `cotizar-orden.js` callback de `verificarAccesoYAplicarVisibilidad` (:992-1139) |
| 2 | **editar-orden**: tras `getOrder`, `Promise.all` de cliente, vendedores, técnicos (memo), tipos, estados y contratos; nombre desde `cliente_nombre` | −450 a −600 ms | bajo | `editar-orden.js` `cargarOrden` (:205-316) |
| 3 | **editar-contrato**: redirigir de inmediato en el camino de éxito | −1,500 ms | 1 línea | `contratos/editar-contrato.html` `alCentro` (:44) |
| 4 | **POC búsqueda**: el salto desde Ctrl+K lee el doc por id en vez de abrir la suscripción a 4,600 fichas; resultado provisional desde caché; tope de 200 filas | de 0.6-3 s a 0.05-0.2 s por salto | medio | `poc-list.js` `_tomarFocusDeUrl` (:367), `_escuchar` (:124), `filtrar` (:657), `mostrarTodo` (:826) |
| 5 | **Catálogos con memo** (P3): modelos, vendedores/usuarios por rol, operadores, facturacion_config | −150 a −200 ms en ~12 pantallas | bajo | `modelosService.js`, `usuariosService.js:11-22`, `empresaService.js:47`, `senalesService.js:432` |
| 6 | **Clientes desde caché** (P4) en nueva-orden, admin-equipos-cliente, POC-nuevo-batch, POC-nueva-consola | −300 a −400 ms c/u | 1 línea c/u | `nueva-orden.js:327`, `admin-equipos-cliente.js:62`, `nuevo-batch.js:1118`, `poc-nueva-consola.js:107` |
| 7 | **inventario-cargos**: pintar sin esperar a QBO | −1 a −3 s | 3 líneas | `cargos.js` (:28-30) |
| 8 | **Home en frío**: `_config` con memo y deduplicado; agregados de `_count` en paralelo; pintar los últimos números conocidos desde localStorage; freno de recuento a 5 min | −400 a −800 ms en pestaña nueva; −90% recuentos | bajo-medio | `senalesService.js` `_config` (:432), `_count` (:54); `home-signals.js` `_recontar` (:967), `_writeLayout` (:458) |
| 9 | **contratos-transicion / documento / seriales**: `Promise.all` de lo que solo necesita `contratoDocId`; mostrar la hoja antes del Anexo A | −300 a −450 ms c/u | bajo | `contrato-transicion-page.js` `cargarDatos` (:59), `contrato-documento.js` `cargar` (:144), `contrato-seriales-page.js` `init` (:66) |
| 10 | **Centro**: cartera del vendedor y filtro de regularización desde caché; ficha desde caché; `catalogo` con memo; gestiones sin lectura doble | −300 ms c/u | bajo | `centro-directorio.js` `_cargarCartera` (:83), `_cargarPorRegularizar` (:43); `centro-ficha.js` `abrir`; `centro-gestiones.js:73` |
| 11 | **POC-nuevo-batch**: 6 lecturas en `Promise.all`; `getRecent` sale de la misma consulta | −600 a −750 ms | bajo | `nuevo-batch.js` (:1118-1134) |
| 12 | **Almacén Asignar**: tres lecturas del contrato en paralelo; `enBodega()` como prefetch; con `?contrato=` no esperar la cola | −600 a −750 ms | bajo | `almacen-asignar.js` `abrirContrato` (:301), `activar` (:59) |
| 13 | **Almacén Hoy**: pintar cada grupo según llega; último `ctx.datos` en sessionStorage como provisional; `Icons.pintar` | −400 a −600 ms percibidos | medio | `almacen-hoy.js` `cargar` (:218) |
| 14 | **Inventario Serial/Avanzado**: `cargarModelos` en paralelo; tope de 200 filas; menú ⋯ al abrir; un solo render; tandas en paralelo | −0.5 a −2 s | medio | `inventario-equipos.js` `render` (:728), `cargar` (:100), `_arrancar` (:1524), `:305` |
| 15 | **Cotizaciones**: detalle y editor con documento y catálogos en paralelo; índice desde caché; sin `modelos` en detalle/impresión | −150 a −400 ms c/u | bajo | `cot-detalle.js:719`, `cot-editor.js:969`, `cotizaciones-index.js:53`, `cot-editor-state.js:450` |
| 16 | **Facturación**: activación pinta antes de la config; bandeja/comisiones desde caché; `{nodes}` → `Icons.pintar` | −130 a −300 ms c/u | bajo | `facturacion-activacion.js:24`, `facturacion-bandeja.js:412` |
| 17 | **Iconos** (P6): `{nodes:[…]}` en piezas ×3 y bandeja; `createIcons` por fila en nuevo-batch; barridos por tecla en cotizar-orden | −50 a −300 ms por render | trivial | `piezas.js:558,579,663`, `ordenes-nuevo-batch.js:237`, `cotizar-orden.js:466,655` |
| 18 | **Admin** (P7): KPIs con `count()`, un solo `listAll` en integridad, `fresh:false` en grupos, ventanas en operación | −1.5 a −3 s y ~9,000 lecturas menos por visita | medio | `admin-index.js:82-148`, `admin-integridad.js:261`, `admin-grupos.js:71`, `admin-operacion.js:58` |
| 19 | **Pequeños** (−150 c/u): perfil con `Sesion.miPerfil`; clientes-ficha e index en paralelo; imprimir-contrato dos usuarios en paralelo; reporte-pendientes trozos en paralelo; imprimir-equipos; inventario-modelos; sim-cards; progreso-tecnicos | −150 ms c/u | trivial | ver reportes por módulo |

**Ya están bien y no se tocan:** bandeja de órdenes, config, estado_reparacion, nota-entrega, importar-exportar (arranque), contratos-index, Existencias, condiciones, descartados, no-devueltos, vendedores-batch, importar-poc, carga inicial de POC (50 filas), emisión, firmar, verify, admin-config, backfills, kpi, pii, email-preview.

## 3. Olas de trabajo

| Ola | Contenido | Esfuerzo | Riesgo |
|---|---|---|---|
| **A · Bases + errores** | P3 memos de catálogos; P4 clientes desde caché; editar-contrato sin espera; iconos `{nodes}`; freno del home | 1 día | bajo: cambios en servicios compartidos, cubiertos por memo + `fresh` |
| **B · Órdenes y Centro** | cotizar-orden, editar-orden, nuevo-batch (paralelo + iconos), Centro cartera/regularización/ficha desde caché, catálogo con memo | 1-2 días | bajo-medio |
| **C · POC y Almacén** | POC salto por id, provisional desde caché, tope de filas; Almacén Asignar y Hoy; Inventario Serial | 2 días | medio: son las pantallas con más DOM |
| **D · Contratos, cotizaciones, facturación, inventario** | P1/P2 en transicion, documento, seriales, cot-detalle, cot-editor, índices desde caché, cargos sin QBO, modelos, piezas-tarifas, sim-cards | 1-2 días | bajo |
| **E · Home en frío y admin** | últimos números conocidos, `_config`/`_count`; admin con `count()` y un solo `listAll` | 1-2 días | bajo; admin lo usa solo el dueño |

Verificación por ola: sintaxis, radiografía estricta, build, smoke de las 90 páginas, y para las pantallas con sesión el recorrido a ojo de quien las usa. Después de cada ola, el audit log debe mostrar menos operaciones por página y el consumo diario debe bajar (las lecturas de catálogos y clientes desaparecen).

## 4. Lo que este plan no resuelve

El primer viaje de cada página (~400 ms) sigue ahí mientras cada navegación recargue la página. Con las olas A-E, en visitas repetidas el dato aparece desde la caché local antes de que ese viaje termine, así que deja de percibirse. Quitarlo de verdad exige un cascarón sin recarga (SPA), que es otro proyecto.

## 5. Cierre (2026-09-30)

Todo lo del ranking quedó hecho salvo esto, que se dejó a propósito:

| Qué | Por qué no |
|---|---|
| Lectura doble de gestiones en la ficha del Centro | 52 docs; el listener sostiene el repintado en vivo del expediente |
| Pintado provisional de Almacén · Hoy | Su render usa Timestamps que no sobreviven a sessionStorage: antigüedad y orden saldrían mal por un instante |
|  de POC | Cuenta sobre las filas del DOM; exige reescribirlo y se usa poco |
|  con caché primero | Lee POC del servidor a propósito: la caché parcial dejaba grupos fuera |
| "Con SIM" en el KPI de POC del admin | Es un O entre dos campos; contarlo pide un índice compuesto nuevo. Se quitó del subtítulo |
| admin-operacion, admin-salud, admin-refs-huerfanas, admin-financiero | Solo las usa el dueño; quedan como candidatas si vuelven a salir picos de lecturas |
| Pestaña Serial de inventario | Ya pintaba por tandas de 200 (otra sesión, mismo día) |

Verificación de cada ola: sintaxis, radiografía estricta, build, 1,132 tests de functions, smoke de las 90 páginas contra la ola anterior y CI. Los KPIs del admin se compararon contra producción antes del cambio (mismos números).
