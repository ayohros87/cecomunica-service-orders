# Auditoría UX/UI del sistema — 2026-08-13

> **Alcance:** las 78 páginas de app en `public/` (86 HTML totales), con foco en las de
> mayor uso diario: Órdenes (taller/recepción), Cotizaciones (ventas), Contratos y
> Clientes, Almacén/Inventario (bodega), POC, Facturación, y el shell de navegación
> (home + rail + componentes transversales). Método: lectura de código por 6 auditores
> en paralelo, conteo de interacciones de los flujos principales (1 interacción = 1
> click, 1 campo tecleado, 1 confirm o 1 gesto), y verificación puntual de los bugs
> más graves contra el código. Ningún archivo fue modificado.
>
> **Convención de prioridad:** P0 = roto hoy (bug, dato falso o botón muerto) ·
> P1 = quick win (horas, ahorro diario) · P2 = proyecto (días, requiere diseño).

---

## Veredicto general

El sistema está **mucho mejor que el promedio de apps internas** en sus flujos
centrales: la bandeja de órdenes, la página de seriales de contrato, la cascada
JSON→batch de POC, el importador de la hoja de bodega y el modal de envío de
cotizaciones son trabajo de calidad, con skeletons, deep-links, candados reales y
textos que explican consecuencias. **La fricción no está en el corazón sino en la
periferia**: páginas satélite que no alcanzaron el estándar del núcleo
(`nueva-orden`, `clientes/index`, `editar-batch`, `importar-poc`), datos en pantalla
que mienten (conteos sobre lo paginado), flujos caros sin atajo (renovar contrato
~22 clicks, intervenciones equipo por equipo), y una migración de shell detenida a
mitad de camino que deja **el móvil sin navegación en 56 de 57 páginas**.

Se encontraron **12 defectos P0** (cosas rotas hoy, no opiniones de diseño),
~30 quick wins P1 y ~15 proyectos P2. Con solo los P0+P1 se recortan del orden de
**8–12 interacciones en los 3 flujos más repetidos** (crear orden con equipos,
trabajar la orden, renovar contrato) y se eliminan los caminos de pérdida de datos.

---

## 1. P0 — Roto hoy (arreglar antes que cualquier mejora)

Verificados contra el código (los 5 primeros, re-confirmados a mano):

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 1 | **`clientes/index.html` no carga `ui/toast.js` ni `ui/modal.js`**, pero `clientes-index.js` los usa 16 veces | `clientes/index.html:28-38,224-230` vs `clientes-index.js:174,192,245,272,289,319,334,505,606` | "Mostrar todo", TODA la bulk-bar (activar/desactivar/vendedor/ITBMS) y el guard de acceso mueren en `ReferenceError` sin feedback. 2 líneas de fix. |
| 2 | **Edición inline de clientes pierde cambios**: un solo `debounce(700)` global compartido por todas las filas/campos; editar otra celda en <700 ms descarta el guardado anterior con sus argumentos | `clientes-index.js:475-507` | Pérdida silenciosa de datos; el dot queda en "saving" ámbar para siempre. Probable con Enter fila-abajo. Fix: debounce por fila+campo o flush del pendiente. |
| 3 | **"Limpiar selección" en nuevo contrato deja Guardar muerto**: `btnGuardar.disabled = true` y nada lo re-habilita al elegir otro cliente | `nc-combo.js:232-233` (no hay re-enable en el archivo) | Hay que recargar la página y re-llenar el formulario. |
| 4 | **Editar RUC/DV inline no recalcula `ruc_norm`/`rucdv_norm`/`dv_norm`** (solo deriva para nombre/representante/dirección) | `clientes-index.js:482-499` | La detección de duplicados y las búsquedas normalizadas mienten a partir de ese momento y se degradan con el tiempo. |
| 5 | **`window.cargarOrdenes` no existe** — la global es `cargarOrdenesYEquipos`; el guard `typeof` lo silencia | `ordenes-devolucion.js:114` vs `ordenes-data.js:236` | El badge "Faltan N" de devolución queda desactualizado tras el check-in en órdenes fuera de la primera página. |
| 6 | **Filtro del asistente de Conteo inusable**: cada tecla destruye y recrea el overlay entero — pierde el foco Y el texto tecleado | `asistente-conteo.js:29-58,124-148` | Filtrar "NX-410" exige 1 click + 1 letra por ciclo. Fix: repintar solo el `<tbody>` conservando `value` y foco. |
| 7 | **`importar-poc.html` escribe directo a Firestore sin preview, sin dedup y sin candado de doble click** | `importar-poc.html:69,91-164` | Re-importar el archivo (o doble click) **duplica la base entera de dispositivos**. El patrón correcto ya existe en `sim-cards.js:230-301`. Además la página no valida auth/rol por URL directa. |
| 8 | **`editar-batch.html` sin guarda de auth ni rol, sin confirmación, sin manejo de errores**, y además huérfana (nadie la enlaza) | grep sin `onAuthStateChanged`; `editar-batch.html:78,124-217` | Puerta trasera de edición sin auditoría de UI. Decidir: retirarla (existe "Editar en masa" con roles y tope) o blindarla. |
| 9 | **El gerente está bloqueado de Contratos** aunque `roles.js` le da `ver/aprobar/anular-contrato` y el rail/home le muestran el módulo | `contratos-index.js:9-14` (solo ADMIN/VENDEDOR/RECEPCION) vs `roles.js:17-23` y `modulos.js:29` | El gerente clickea la tarjeta que el propio sistema le muestra y recibe "No autorizado". Solo puede aprobar bajas entrando a `cancelaciones.html` por URL directa. |
| 10 | **Los conteos de chips/KPIs de órdenes mienten tras filtrar**: se calculan sobre `APP.state.orders` (lo cargado) y al clickear un chip de estado los demás caen a 0 | `ordenes-render.js:1062-1100`, `ordenes-filters.js:596-624` | Un jefe que ve "Por asignar: 0" tras filtrar por ASIGNADO recibe un dato falso. Mismo mal en KPIs de cotizaciones (`cotizaciones-index.js:110-131`: la "tasa de cierre" cambia según cuántas páginas cargaste). |
| 11 | **Dos páginas de configuración trampa**: `tecnicos.html` edita `empresa/tecnicos` que **nadie lee** (la asignación usa `usuarios` por rol); `estado_reparacion.html` permite borrar/renombrar los estados canónicos hardcodeados en chips/botones/rules con un `confirm()` de una línea | `ordenesService.js:564-582` (grep confirma cero lectores); `estado_reparacion.html:94-101` | Un admin "agrega un técnico" y el técnico jamás aparece; borrar "COMPLETADO (EN OFICINA)" rompe el flujo en silencio. Retirar la primera de `config.html`, candar la segunda. |
| 12 | **Duración "Otro" sin número pasa la validación** y se guarda `" meses"` (contrato + plantilla de impresión) | `nc-guardar.js:177-179`, `editar-contrato.js:182-186` | Contratos con duración vacía en el documento legal impreso. |

Menores en la misma categoría (arreglar de paso): doble-submit posible en
`nueva-orden` (doble orden + doble email — `nueva-orden.js:359-548`), `editar-orden`
(`editar-orden.js:299`), `cot-editor` guardar/duplicar (dos docs con el **mismo
número COT** — `cot-editor.js:655-699`), acciones de facturación
(`facturacion-activacion.js:174-222`) y lotes de Existencias sin candado ni progreso
(`almacen-existencias.js:368-393`). El patrón correcto ya existe en
`agregar-equipo.js:99-111` (guard con historia de incidente documentada).

---

## 2. Mejoras de arquitectura (transversales)

### A1. Terminar la migración del shell empezando por el topbar — el móvil sale gratis
Estado real: **57/57 páginas de trabajo ya tienen rail** en desktop (híbridas:
`renderTopbar` legacy + `initRail`), pero `renderShell` (el modo final) lo usan **0
páginas** y `ceco-command.css` solo el home. La consecuencia grave no es estética:
`renderRail` solo cablea el **drawer móvil** si existe `#ccRailToggle`, que solo lo
emite `renderShell` → **bajo 1024px el rail se oculta en el 100% de las páginas** y
navegar entre módulos en móvil vuelve a ser "→ home → tarjeta" (+2 clicks siempre).
Ruta pragmática: (1) migrar `ordenes/index.html` (único topbar hardcodeado,
`ordenes/index.html:83-113`, que además duplica el SVG del monograma con IDs de
gradiente repetidos); (2) las páginas índice de cada módulo; (3) las hojas al final.
`layout.js:306-318` ya tiene el drawer cableado esperando el botón.

### A2. Buscador global Ctrl+K en toda la app (hoy solo admin)
`searchPalette.js` ya busca clientes, órdenes, contratos, cotizaciones y poc_devices
(serial/SIM/unit_id) con teclado completo — pero está montado en **1 de 78 páginas**
(`admin/index.html:83`) y su CSS vive atrapado en `admin-panel.css:407-438`. Mover el
CSS a `ceco-ui.css` (o propio) y montarlo vía `initRail` lo enciende en las 57
páginas de golpe. Es la mejora que más clicks ahorra por día: "buscar el contrato de
Fulano" desde órdenes deja de costar salir al home + entrar a contratos + buscar.
Después: añadirle "recientes" (últimos N docs abiertos, localStorage).

### A3. Señales del home con deep-link filtrado (la infraestructura ya existe)
Órdenes ya lee `?estado=`, `?mias=1`, `?qc=1` de la URL (`ordenes-filters.js:211-269`),
pero las señales S1–S5 aterrizan en `ordenes/index.html` **a secas** y S8/S10 en
contratos sin filtro: el usuario ve "7 por asignar", entra, y aplica el filtro a
mano. Cambiar los `href` del catálogo (`home-signals.js`) a
`?estado=POR%20ASIGNAR` etc. convierte 6 señales semi-informativas en accionables
sin tocar las páginas destino (solo contratos necesita aprender `?estado=`).

### A4. Estándar único de confirmación, aviso y "ocupado"
- **17 `confirm()` nativos en 11 archivos** y ~10 `prompt()` conviven con 65 usos de
  `Modal.confirm` — y justo en las operaciones más destructivas (anular contrato con
  `prompt()` de una línea en `contratos-list.js:748`, aprobar terminaciones en
  `cancelaciones.js:304-334`, lotes masivos en `almacen-existencias.js:380`,
  fecha de entrega tecleada "YYYY-MM-DD" en `facturacion-activacion.js:207`).
  Migrarlos a `Modal.confirm` con resumen de consecuencias (la "hoja de
  confirmación" de seriales, `contrato-seriales-page.js:691-752`, es la plantilla).
- **3 `alert()`** en página de flujo real (`editar-batch`) → Toast.
- Extraer **`withBusy(btn, asyncFn)`** (deshabilita + texto "Guardando…" + rehabilita
  en error): hoy hay 102 sitios con `.disabled = true` reimplementados a mano y ~10
  formularios importantes sin ninguno.
- Arreglar el Enter global de `Modal.confirm` (`modal.js:123-126`): confirma aunque
  el foco esté en "Cancelar".

### A5. Numeración de órdenes con contador atómico
`generarNumeroOrden()` escanea **toda la colección** para calcular el correlativo del
día (`nueva-orden.js:183-198`): lento, carrera real con dos usuarios simultáneos
(mismo número → `setOrder` pisa el doc), fecha local sin TZ fija y tope de 99/día.
El patrón correcto ya está probado en contratos (contador en transacción + TZ
America/Panama). Es la misma clase de bug que ya se corrigió allá.

### A6. Un solo combo buscable reutilizable (clientes y modelos)
El combo de cliente de cotizaciones (`cot-editor-state.js:420-585`) y el de contratos
(`nc-combo.js`) resolvieron el problema; pero `nueva-orden` sigue con un `<select>`
nativo de hasta **2,000 clientes** (`nueva-orden.html:111`) — el error de cliente ahí
contamina contratos, entrega y correo — y los asistentes de bodega (Recibir,
Importar) usan `<select>` nativo de cientos de modelos (`asistente-recibir.js:64-66`)
cuando `asistente-venta.js:102-144` ya tiene el patrón con typeahead. Extraer el
combo a `ui/` y reutilizarlo en los 3 puntos.

### A7. Autoguardado de borradores largos
`vendedores-batch.js:783-861` ya tiene el patrón completo (debounce + borrador por
usuario + TTL 3 días + restauración). Falta donde más duele: el editor de
cotizaciones (decisión explícita de no tener, `cot-editor.js:20-23` — cerrar la
pestaña pierde 20 minutos de renglones) y nuevo contrato (una renovación con plan de
80 unidades se pierde con un F5). Con autosave, además, "crear cliente a mitad de
cotización" deja de destruir el trabajo (`cot-editor.js:302-304`).

### A8. Búsquedas que no mientan ni cuesten la colección
- Contratos: match server-side **solo por prefijo** de `cliente_nombre_lower`
  (`contratos-list.js:431-436`) → "israelita" no encuentra "Sociedad Israelita" si
  no cae en las ~8 páginas del fallback; un vendedor concluye "no existe" y duplica.
  Pasar a tokens (patrón de clientes).
- Cotizaciones: búsqueda solo en las 30 cargadas + "Cargar más" a ciegas
  (`cotizaciones-index.js:33-60`) → atajo inmediato: si el término matchea
  `COT-\d{4}-\d+`, query directa por `cotizacion_id`; luego filtro server-side por
  vendedor (hoy descargan las de todos).
- Órdenes: si `searchTokens` no da resultado hay **fallback full-scan** de la
  colección (`ordenesService.js:699-713`) — la búsqueda sin resultados es la más cara.
- Conteos veraces: chips/KPIs con `count()` agregado del servidor (el home ya lo
  hace: `home-signals.js`) o congelar los conteos del dataset completo.

### A9. Una sola fuente del catálogo de navegación
`_RAIL_CATALOGO` (`layout.js:198-218`), las tarjetas del home (`index.html:104-215`)
y `GROUP_META` del palette (`searchPalette.js:24-30`) son **3 copias a mano** de los
mismos módulos/iconos/href. Unificar en `modulos.js` (que ya es la fuente de
visibilidad por rol).

### A10. Política de umbral de cotizaciones al backend + hueco del descuento por línea
`requiereAprobacion` mira solo `total` y `descuentoPct` global
(`cotizacionesTotales.js:61-73`): 40% de descuento **por línea** con total $4,900
sale sin aprobación (y además el gate es solo-UI — `roles.js:45` lo admite). Incluir
el descuento efectivo/máximo por línea y validar `estado→enviada` en rules o Function.

---

## 3. Patrones de referencia internos (copiar de aquí, no reinventar)

| Patrón | Dónde vive | Reutilizar en |
|---|---|---|
| Guard anti doble-submit con historia | `agregar-equipo.js:99-111` | nueva-orden, editar-orden, cot-editor, facturación |
| Hoja de confirmación con consecuencias | `contrato-seriales-page.js:691-752` | anular contrato, cancelaciones, lotes existencias |
| Combo buscable con teclado | `cot-editor-state.js:420-585`, `nc-combo.js` | nueva-orden (clientes), asistentes bodega (modelos) |
| Autosave + borrador TTL + restauración | `vendedores-batch.js:783-861` | cot-editor, nuevo-contrato |
| Import con preview/diff antes de escribir | `asistente-importar.js:286-496`, `sim-cards.js:230-301` | importar-poc |
| Runner de lotes (barra, Detener, errores por motivo) | `inventario-equipos.js:759-918` | almacen-existencias `loteAccion` |
| Estado vacío con causa + CTA | `ordenes-render.js:1175-1224` | resto de listas |
| Deep-links con limpieza de URL | `ordenes-filters.js:202-313`, `contratos-index.js:48-80` | señales home, cancelaciones→orden |
| Skeleton + watchdog 15s + Reintentar | `ordenes-data.js:116-225`, `poc-list.js:253-264` | listas que solo dicen "Cargando…" |
| Página honesta para función no construida | `facturacion/emision.html` | — (mantener el patrón) |

---

## 4. Módulo por módulo

### 4.1 Órdenes (la superficie más usada)

**Tabla de clicks (desde la bandeja):**

| Función | Hoy | Propuesto | Cambio |
|---|---|---|---|
| Crear orden + 1 equipo | **~15, 3 páginas** | ~9, 2 páginas | Redirect post-guardado a `agregar-equipo.html?orden_id=X` (hoy: index → buscar → expandir → "+") — `nueva-orden.js:543-544` |
| Técnico se asigna a sí mismo | 4–5 | 2 | Preseleccionar al usuario en el modal o botón "Asignármela" (`ordenes-flujo.js:16-79`) |
| Intervención en N equipos iguales | **~3N+1** | ~6 | Multiselección "aplicar también a estos seriales" en el modal (`ordenes-equipos.js:481-551`) |
| Abrir cola de QC | 2 (dropdown Resumen) | 1 | Chip "QC n" en la barra de chips (`ordenes-render.js:1113-1127`) — es la cola que frena entregas |
| Imprimir/documentos | 3 (modal intermedio) | 2 | Dos entradas directas en el menú ⋯ (`ordenes-events.js:488-519`) |
| Completar orden | 2 | 2 + aviso | Confirm que diga "X de N equipos sin intervención" (`ordenes-flujo.js:141-158`) — hoy el error aflora en QC con ~7 clicks de rechazo |
| Buscar/filtrar/recibir/entregar | 1–5 | igual | Ya óptimos (no tocar) |

**Además:** volver de editar-orden a `index.html?orden=<id>` en vez del index pelado
(el deep-link ya existe en la misma página, `editar-orden.js:291` vs `:386`); feedback
al clickear chips de accesorios fuera de modo lote (hoy click muerto,
`ordenes-equipos.js:221-268`); quitar `user-scalable=no` (`index.html:23` — técnicos
no pueden ampliar seriales en tablet); atenuar "Eliminar orden" en estados terminales
(`ordenes-render.js:988-989`); unificar los **dos sistemas de fotos** paralelos
(página fotos-taller vs fotos por equipo del modal — dos contadores, ningún lugar
que muestre todo; `ordenes-render.js:62-64` vs `536-539`); homologar el bloque de
contrato de ENTRADA en editar-orden (`editar-orden.js:27-29` vs `nueva-orden.js:39-41`);
reemplazar el `prompt()` de crear cliente (`nueva-orden.js:251-283`) por mini-form
con email (hace falta al entregar); escapar cliente/vendedor en
`reporte-pendientes.html:122-140` (único sitio del módulo sin escape).

### 4.2 Cotizaciones

**Tabla de clicks:**

| Función | Hoy | Propuesto | Cambio |
|---|---|---|---|
| Crear + enviar (1 línea, dentro de política) | 8 | 7 | Tras guardar dentro de política, aterrizar con el modal de envío abierto (`detalle?enviar=1`) |
| Cliente nuevo a mitad de cotización | ~15–20 **y pierde el borrador** | ~9–10 sin perder nada | Alta rápida en modal (razón, RUC, email) |
| Buscar cotización vieja | 1 + 10–20 "Cargar más" | 1–2 | Query directa por número COT + filtro de fechas |
| Ver si el cliente la abrió | **Imposible en la app** (ir a Gmail) | 0 | `opens_count`/`last_opened_at` ya existen en `cotizacion_verificaciones/{docId}` (`onOpened.js:102-106`) — mostrarlos en detalle y lista es 1 lectura |
| Aprobar desde el correo | 2 | 2 | Ya óptimo (deep-link `?aprobar=`) |
| Duplicar | 1 sin confirmación | 2 | El click extra es deseable: crea doc, consume correlativo y puede encolar correo al aprobador |

**Riesgos a cerrar:** descuentos sin clamp (un "150" produce totales negativos,
`cot-editor.js:379,602` + `cotizacionesTotales.js:5-22`); `validar()` deja enviar
renglones sin descripción o en $0 (`cot-editor.js:648-653`); el aviso de política no
se refresca al cambiar total/descuento (justo las 2 variables del umbral,
`cot-editor.js:25-52`) ni hay indicación del tope junto al input; el botón de
aprobar debería decir "Aprobar **y enviar**" — la advertencia "sale al cliente de
inmediato" solo se renderiza en cotizaciones comerciales, un jefe_taller puede
aprobar sin saber que acaba de enviar (`cotizaciones-index.js:209,464-472`); spinner
en "enviar" mientras corre `ensureLinkPublico` (hoy parece que el click no hizo
nada); unificar las **dos implementaciones de duplicar** (lista vs detalle — ya
divergieron una vez, COT-2026-0042); adjuntos huérfanos en Storage si no se guarda.

### 4.3 Contratos y Clientes

**Tabla de clicks:**

| Función | Hoy | Propuesto | Cambio |
|---|---|---|---|
| **Renovar contrato** | **~22 (se rehace desde cero)** | ~10 | CTA "Renovar" en la fila que precargue cliente + origen (el propio contrato) + equipos + plan "continúa" — la infra de prefill ya existe (Duplicar vía sessionStorage, `nc-guardar.js:19-84`) y elimina el error de elegir mal el origen |
| Crear contrato + imprimir | ~17 | ~13 | Fila de equipo inicial automática + CTA "Ver/Imprimir" post-guardado |
| Alta de cliente desde contrato | ~8 + **dos pestañas desincronizadas** | ~5 | `?redirect=true` se ignora (`nuevo-cliente.js:122-130`): la pestaña hija navega a un segundo Nuevo Contrato y el trabajo a medio llenar de la madre se rehace. Honrar el redirect (postMessage/cerrar hija) o alta en modal |
| Subir firmado y activar / seriales / transición | 3–6 | igual | **Ya óptimos** (patrón de referencia del sistema) |
| Anular contrato | 3 (`prompt()` de una línea) | 3 | Mismos clicks pero modal con consecuencias (equipos afuera → orden de DEVOLUCIÓN auto, firmado archivado) |
| Borrar cliente | 2 sin pre-check | 3 | Contar contratos no-anulados y unidades del pool antes; hoy es el mismo soft-delete ciego que ya dejó contratos colgantes (`clientesService.js:185-195`) — solo Admin·Duplicados lo hace bien |

**Además:** duplicados de cliente solo se detectan al **crear** y con match exacto
normalizado — nada en edición (renombrar al nombre de otro pasa sin aviso), nada
difuso, y el chequeo llega al final del submit en vez de on-blur del RUC
(`nuevo-cliente.js:96-110`); filtros de la lista de contratos no persisten (clientes
sí lo hace); acciones que terminan en `location.reload()` pierden búsqueda/scroll
(anular/borrar/comisión — la aprobación ya lo hace bien en sitio,
`contratos-approval.js:273`); N+1 secuencial en el modal de equipos
(`contratos-equipos.js:213-215`) y en `advertenciasPool` (80 seriales = 80
roundtrips, `contrato-seriales-page.js:1028-1060`) → `Promise.all`/chunks;
link de cancelaciones a la orden de devolución sin `?buscar=` (`cancelaciones.js:292`);
contrato **aprobado** editable por URL directa (`editar-contrato.js:38` solo bloquea
`activo`); self-hostear `qrcode.min.js` de imprimir (único CDN externo que queda).

### 4.4 Almacén e Inventario

**Tabla de clicks:**

| Función | Hoy | Propuesto | Cambio |
|---|---|---|---|
| Recibir N seriales | 5–7 | 4 | Combo de modelo con typeahead + foco directo |
| Conteo físico de un modelo | 6–9 reales (filtro roto) | 4 | Fix P0 #6 + Enter salta al siguiente modelo |
| Importar hoja de bodega | 6–8 | 4–5 | Soltar el archivo primero y **proponer el modelo detectado** (el código ya lo reconoce con `esNombreDeModelo`, `asistente-importar.js:218-224`) |
| Corregir serial mal transcrito ya guardado | **Sin camino en UI** (~8+ vía baja+alta, pierde kardex) | 3 | Acción "Corregir serial" con motivo + kardex — `EquiposPoolService.actualizar` ya acepta `serial` (`equiposPoolService.js:777-785`), falta exponerlo |
| Buscar serial / atender pendiente / conteo por hoja | 1–5 | igual | **Ya óptimos** |
| Ajustar stock de piezas ±10 | 10 clicks + 10 recargas | 2 | Input "±N" en vez de botones +1/−1 (`piezas.js:558-559,722-731`) |

**Contexto bodega (manos ocupadas, lector de barras):** contador en vivo bajo los
textareas de seriales ("14 seriales · 1 repetido") con el duplicado resaltado — hoy
`recibir()` **suma repetidos e inválidos en el mismo contador** y el toast confunde
(`equiposPoolService.js:460-464`); correr `SerialPatron` también en Recibir (hoy solo
el importador — justo el flujo donde nacieron los `16O13D0998`); validación de venta
por chunks `in` de 10 en vez de 1 query por serial (`asistente-venta.js:209`);
debounce en la búsqueda global de Equipos (repinta ~7k filas por tecla,
`equipos.html:219`); "Fijar el conteo físico" usa el total de la hoja **incluyendo
bloqueadas/colisiones no confirmadas** (`asistente-importar.js:604-607`) → Dif
artificial; la casilla "Propiedad → cecomunica" nace premarcada aun cuando la ficha
dice `cliente` con contrato vivo (`asistente-importar.js:364` — precedente PD606-R);
contador de referencias en el confirm de "Eliminar modelo" (`inventario-modelos.js:419-438`,
protege los pares N/R que no deben fusionarse).

### 4.5 POC y Facturación

**POC:** el flujo estrella (JSON del vendedor → todo autocompletado) es el mejor del
sistema — no tocar. Cerrar la periferia: P0 #7 y #8 (importar-poc, editar-batch);
crear el lote con `WriteBatch` en vez del loop `.add()` uno a uno (hoy un fallo en el
doc 17 de 30 deja lote parcial, `nuevo-batch.js:1055-1086`); validar colisión de
`unit_id` también al **editar** (drawer/masiva — hoy solo al crear) y añadir vista
"Unit IDs duplicados" al menú Duplicados (`poc-list.js:702-739`); consolidar los
hasta 4 `window.confirm` encadenados del guardado en un modal-resumen único;
paralelizar la carga de imprimir-equipos (80 docs en serie hoy).

**Facturación:** honesta y bien armada (buckets, checklist de readiness, tarjeta de
caducidad del token QBO). Cerrar: **"Vincular" a QBO es 1 click sin confirmación ni
rastro de auditoría** (`facturacion-clientes-qbo.js:133-137`) — con Customer=cliente,
un vínculo errado factura a otra empresa; confirm con nombres lado a lado cuando hay
badge "múltiples"/"verificar" + campo `qbo_vinculado_por/at`. La vista "Sin match" es
un callejón sin salida (sin buscador manual de Customer, sin botón "Recargar desde
QBO" — hay que salir a QBO y refrescar la página completa). Ninguna de las dos tablas
tiene buscador (inconsistente con toda la app). `prompt()` de fecha "YYYY-MM-DD" →
date-picker (el patrón ya está 3 líneas arriba, `facturacion-activacion.js:169,207`).

### 4.6 Home y transversales

Lo dicho en A1–A4, más: quitar `user-scalable=no` del home (`index.html:23`, WCAG
1.4.4); CTA "Nueva cotización" duplicado en la misma vista (topbar + header,
`cotizaciones/index.html:60,74`); login carga Roboto de Google Fonts cuando todo lo
demás es self-hosted (`login.html:15`); blanco sobre `--accent #0091D7` ≈ 3.6:1 —
los `btn-primary` de 14px quedan bajo AA estricto (subir peso/tamaño o oscurecer el
acento un paso); extender el bottom-nav + drawer de órdenes (único móvil de primera
clase) a POC y Almacén, las otras dos superficies que se usan de pie; congelar UNA
convención de clases de botón (`.btn-primary` vs `.btn--ghost` vs `.fo-btn`).

---

## 5. Plan de ejecución sugerido

**Semana 1 — P0 (todo es chico):** los 12 defectos de la sección 1 + los guards de
doble-submit. Nada de esto requiere diseño; casi todo son horas.

**Semanas 2–3 — Quick wins de clicks (P1):**
1. Señales del home con deep-link (A3) — una tarde, ganancia diaria para todos.
2. Ctrl+K global (A2) — el mayor ahorro de navegación por día.
3. Órdenes: redirect a agregar-equipo, "Asignármela", aviso de completar, chip QC,
   menú de documentos directo.
4. Cotizaciones: chip de aperturas, atajo COT-, clamp de descuentos, aviso de umbral
   vivo, confirmación en Duplicar.
5. Contratos: CTA Renovar con prefill, pre-check de borrar cliente, modal de
   anulación con consecuencias.
6. Almacén: combo de modelo, contador en vivo de seriales, "Corregir serial",
   runner de lotes en Existencias.
7. Facturación: buscador en tablas, confirm de vínculo QBO + auditoría, recarga
   "Sin match".

**Mes 1–2 — Proyectos (P2):** renderShell + móvil (A1), contador atómico de órdenes
(A5), combo de cliente en nueva-orden (A6), intervención en lote (el grueso del
trabajo del técnico), autoguardado (A7), búsqueda server-side + conteos `count()`
(A8), unificar fotos de taller, política de umbral al backend (A10), catálogo único
de módulos (A9).

---

## Nota de alineación

Este informe es consistente con `PLAN_REDISENO_COMMAND_CENTER.md` (F4 pendiente:
este documento sugiere empezarla por el **topbar**, no por el CSS, porque destraba
el móvil) y retoma puntos aún vivos de `docs/mejoras-solicitadas/` de junio 2026
(p.ej. B2 "copiar seriales del POC al crear OS" queda cubierto si el redirect
post-orden aterriza en agregar-equipo/nuevo-batch con "Jalar desde POC", que ya
existe). Los conteos de clicks son del camino feliz con la app ya abierta; el
detalle por página con evidencia `archivo:línea` está en las secciones 1–4.
