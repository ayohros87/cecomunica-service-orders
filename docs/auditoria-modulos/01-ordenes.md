# Auditoría de módulos 2026-09-30 · 01 · Órdenes de servicio

> Recorrido hecho en el emulador con los 60,436 documentos de producción del 30-sep (2,029 órdenes), con sesión real de Brenda (recepción, escritorio y tablet), Solangel (jefa de taller), Marcos y Ovidio (técnicos, teléfono) y Alberto (admin). Un primer auditor dejó 19 scripts y 75 capturas antes de cortarse; este informe retoma su trabajo, volvió a correr los recorridos sobre órdenes nuevas (`PRUEBA-AUDIT-ordenes`: 2026093009 A, 2026093010 B, 2026093012 devolución, 2026093013 C) y agregó ocho scripts (00c, 00d, 07c, 08c, 11, 12, 13, 13b). **88 capturas** en `docs/auditoria-modulos/capturas/ordenes/` (fuera del git). Scripts en `docs/auditoria-modulos/scripts/ordenes/`. Maqueta: `maquetas/ordenes-bandeja-y-entrega.html`.
>
> Ojo con el emulador: no corren Functions ni Storage. Por eso las órdenes creadas hoy no se encuentran con el buscador (los `searchTokens` los escribe `onWriteSearchTokens`), los correos quedan en `mail_queue` sin salir, y la firma se "sube" a un stub. Nada de eso es un defecto del app y no lo cuento como tal.

---

## ROTO HOY

**R1. "Ver entrega" dice "Recibido por —" en todas las entregas con firma en papel.** La rama de papel guarda `entrega_persona_interna` y `no_recibido_motivo` (`public/js/pages/ordenes-flujo.js:1771-1775`), pero el modal de "Ver entrega" solo lee `receptor_nombre` (`public/js/pages/ordenes-events.js:751`) y no pinta ni el motivo ni la foto de la nota firmada (`nota_firmada_url`). Lo reproduje con B (2026093010): entregué con "firmó en papel", "Mensajero de MACELLO", motivo escrito, y "Ver entrega" muestra la fase "Entrega al cliente" con **Recibido por —** (captura `08-recepcion-tablet-ver-entrega-papel.png`; el documento sí tiene los campos, `00d-doc-entrega-papel.js`). En producción hay **39 entregas así, 38 en los últimos 30 días** (`no_recibido == true`, todas con `entrega_persona_interna`): es la forma en que salieron la mayoría de las entregas de septiembre, y para todas ellas el app no sabe decir quién se llevó los radios. Arreglo: en `ordenes-events.js` pintar `entrega_persona_interna` cuando `no_recibido`, el motivo, y un enlace a la nota firmada o un aviso "falta subir la nota". **30 min.**

**R2. Las señales del home mandan a una lista que muestra una fracción de lo que anuncian.** "En taller (asignadas) 19" enlaza a `ordenes/index.html?estado=ASIGNADO` (`public/js/pages/home-signals.js:91`) y la bandeja abre con el chip "Asignado 19" marcado y **"Total: 6 · ASIGNADO", 6 filas y "Cargar más"**; "Completadas (en oficina) 84" → `?estado=COMPLETADO (EN OFICINA)` → **4 filas**; para Marcos, `?mias=1&estado=ASIGNADO` → 3 y `…COMPLETADO` → 7; `?estado=por_asignar` → 6 de 42 (scripts `13`, `13b`; captura `13b-jefe-escritorio-asignado-por-url.png`). La causa: al arrancar, `ordenes-filters.js:760-767` solo copia el parámetro al control y filtra **en el navegador las 40 órdenes más recientes**, mientras que tocar el chip consulta al servidor (`filterByStatus`, 42/42, 18/18). Peor: si la persona toca el chip ya marcado para "refrescar", lo desmarca y vuelve a "Todas". Todo el que entra desde el home (la ruta principal: recepción abre el home 12 veces al día) ve una cola falsa. Arreglo: que `?estado=` dispare la misma consulta que el chip (`filtrarPorEstado`) en vez de rellenar el select. **1-2 h.**

**R3. La fecha de las órdenes sale en UTC: una orden creada después de las 7 p. m. aparece con la fecha del día siguiente.** `formatFecha` hace `toISOString().slice(0,10)` (`public/js/pages/ordenes-state.js:246`) y lo mismo `imprimir-orden.js:205-206`. Las órdenes A, B y C, creadas el 30-sep a las 9:54 p. m. hora de Panamá, se ven como **2026-10-01** en la bandeja, en la tarjeta del técnico y en la orden impresa, mientras el reporte de pendientes (que formatea con `es-PA`) dice 09/30/2026 (capturas `01-recepcion-escritorio-bandeja.png` de la corrida 2 vs `10-admin-escritorio-reporte-pendientes.png`). En los datos de producción son pocas las creadas de noche (4 de 475 en 90 días, `00c-fechas-utc.js`), pero la **fecha de entrega** sale corrida en **158 de 529** y el histórico importado (385 de 2,029) tampoco cuadra con la numeración. Arreglo: `Intl.DateTimeFormat('es-PA', { timeZone: 'America/Panama' })` en los dos sitios. **1 h.**

**R4. En el teléfono, mientras el toast "Intervención guardada" está en pantalla (≈4 s después de "Guardar y siguiente"), tocar "Guardar" en el siguiente equipo cierra el modal sin guardar y el texto se pierde en silencio.** Reproducido en A, C y tres veces más en el script `12`: toque inmediato → el modal se cierra en 890 ms, sin toast ni escritura, y el equipo queda "SIN intervención registrada" en el QC; el mismo toque 5 s después guarda (2.3 s, toast, texto persistido); un `click()` por JS guarda de inmediato. O sea, no es el guardado: es que el toast se pinta **abajo, encima de Cancelar/Guardar** (capturas `06b-tecnico-telefono-intervencion-con-pieza.png`, `12-tecnico-telefono-inmediato-mouse-antes-de-guardar.png`) y el toque no llega al botón. La ventana es corta, pero el técnico que escribe "ok" y toca Guardar cae en ella, y nadie se entera hasta el QC. Dos arreglos de media hora: toast arriba en teléfono, y que el modal nunca se cierre con texto cambiado sin haber escrito (hoy la X y Cancelar descartan directo, `ordenes-equipos.js:600-603`, y el cierre por toque fuera solo pregunta si "está sucio").

---

## 1. Para quién es y qué hacen ahí

El módulo más usado del app: **1,515 acciones en 30 días**, 36 vistas el único día medido en `uso_diario` (30-sep). Lo trabajan cuatro personas con cuatro trabajos distintos sobre la misma pantalla (`ordenes/index.html`):

| Quién | Qué hace en Órdenes (acciones/mes) | Dónde |
|---|---|---|
| Brenda (recepción, 1,408 acciones en todo el app) | Crea órdenes, **edita equipos (631)**, hace check-in de devoluciones (202), entrega con firma en tablet (203) o en papel | Escritorio y tablet del mostrador |
| Solangel (jefa de taller, 1,248) | Asigna técnico (144), QC (91), cotiza desde la orden, edita equipos | Escritorio |
| Marcos, Ovidio, Jesús (técnicos, 76-255 c/u) | Intervención y piezas por equipo, completar (116) | Teléfono, de pie |
| Alberto, Zuleika | Miran la cola, casos viejos, progreso, reportes | Escritorio |

Cuatro circuitos conviven en la bandeja con un solo juego de chips: **REPARACIÓN / PROGRAMACIÓN** (recibir → asignar → completar → QC → entregar), **ENTRADA** (devolución de un contrato del sistema: recibir → revisar por equipo → cerrar), **DEVOLUCIÓN** (tiquete de contrato de papel: check-in por serial con acuse) y **VISITA TÉCNICA** (asignar → cerrar en sitio → cotizar). Satélites: `nueva-orden`, `nuevo-batch` (equipos en tabla), `editar-orden` (cabecera, solo en POR ASIGNAR), `cotizar-orden`, `imprimir-orden`, `progreso-tecnicos`, `reporte-pendientes`, `config` (+ importar/exportar, estados, modelos), `admin-equipos-cliente`, y `firmar/tablet.html` (la tablet del mostrador) y `firmar/index.html` (firma por enlace).

**Estado real de la cola el 30-sep:** Por recibir 2 · Por asignar 42 · Asignado 18 · Listos 84 (COMPLETADO EN OFICINA, de los cuales la mayoría "LISTO PARA ENTREGAR" con QC aprobado) · QC pendiente 0 · Cerradas 1,857 (Entregado 1,240 · Entrada cerrada 509 · Devolución cerrada 63 · Visita cerrada 42 · Sin retirar 2 · Anulada 1). **84 órdenes terminadas esperando que el cliente venga** es el número que más dice del negocio: "Casos viejos" lista reparaciones completas de 35 a 48 días (captura `10-admin-escritorio-casos-viejos.png`).

## 2. Recorrido real

Interacciones = clics + campos tecleados + confirmaciones + gestos (§3 del método), camino feliz con el app abierto. Tiempos medidos con la página quieta (DOM sin mutar 800 ms); en producción los viajes a Firestore son algo más cortos que contra el emulador local, pero las proporciones se mantienen.

### 2.1 Recepción (Brenda) · escritorio 1280×800 · crear REPARACIÓN con 2 equipos y recibirla en mostrador (`02`)

| Paso | Inter. | Tiempo | Qué vi |
|---|---|---|---|
| Bandeja | — | 2.7 s (primer viaje a Firestore a 500 ms; 8 `count()` para los chips) | Captura `01-recepcion-escritorio-bandeja`. Ver §3.2 V1: el número se monta sobre el cliente y los chips de TIPO/ESTADO salen cortados. |
| Crear nueva orden → cliente, tipo, observación, guardar | 5 | 1.9 s la página; 3.8 s hasta aterrizar en el lote | El vendedor se autollena desde la ficha del cliente ("Zuleika Diaz"). "Observaciones" sigue siendo el único campo para la falla reportada. Captura `02-…-nueva-orden-llena`. |
| Lote: serial 1 + modelo, "Agregar fila", serial 2 + modelo | 6 | — | **Enter en el serial no agrega fila ni mueve el foco** (filas 1→1, foco se queda en el mismo campo): un lector de barras deja el cursor donde estaba. Tab sí pasa al modelo. Los seriales inventados muestran "sin registro en el pool". Captura `02-…-lote-2-equipos`. |
| "Guardar y recibir" | 1 | 4.1 s | Aterriza en `index.html?orden=…&recibir=1` con el modal de recepción **ya abierto**: el #13 del 28-sep está hecho. |
| Acuse: nombre, firma en el recuadro, confirmar | 3 | 2.7 s | Toast "Recepción registrada". La fila pasa a "POR ASIGNAR". Captura `02-…-modal-recepcion`, `02-…-tras-recibir`. |
| **Total** | **15** | ~12.5 s de espera + tecleo | El 28-sep estimó ~19 → ~15; ya está en 15. Sin firma (mensajero): +1 casilla +1 motivo = 16 (B). |

### 2.2 Recepción · editar los equipos de una orden (la acción más frecuente del sistema, 631/mes) (`03`)

| Acción | Inter. | Tiempo | Qué vi |
|---|---|---|---|
| **Corregir un serial** | 4 (expandir fila, lápiz, teclear, Enter) | 0.9 s expandir + 0.8 s abrir + **2.9 s guardar** | El lápiz mide **16×20 px y está a `opacity: 0` hasta pasar el mouse** (`ordenes-index.css:988-990`): en la tablet no existe hasta que tocas por fe. 8 de los 12 controles del detalle miden menos de 36 px. El prompt trae el SerialField con su chip del pool y Enter guarda. Capturas `03-…-fila-expandida`, `03-…-editar-serial-prompt`, `03-recepcion-tablet-fila-expandida`. |
| **Agregar un equipo** | 5 + **2 cargas de página** | 1.6 s ir + 5.4 s volver | El "+" manda a `nuevo-batch.html` con una fila vacía y sin mostrar los equipos que ya tiene la orden; al guardar vuelve a la bandeja filtrada. Siete segundos de pantalla en blanco para un serial. |
| **Quitar un equipo** | 3 (expandir, basurero, confirmar) | 2.7 s | Confirm genérico "¿Eliminar este equipo de la orden?" sin decir cuál. Es borrado blando (`eliminado: true` en memoria) pero **no hay deshacer** en pantalla. Captura `03-…-eliminar-equipo-confirm`. |

Con 631 ediciones al mes, cada segundo de espera en el guardado del serial son ~10 minutos/mes; las dos cargas de página de "agregar" son el costo grande.

### 2.3 Recepción · DEVOLUCIÓN sin contrato en el sistema + check-in de 1 de 2 radios con acuse (`04`)

| Paso | Inter. | Tiempo | Qué vi |
|---|---|---|---|
| Más → "Devolución sin contrato en el sistema" → cliente, referencia, cuántos, observación, crear | 7 | 5.5 s | El modal explica bien para qué sirve. Captura `04-…-nueva-devolucion`. El check-in se abre solo al crear. |
| Check-in: serial, modelo, **Enter** (= escáner, funciona: `ordenes-devolucion.js:1184`), "Todos" los accesorios, Confirmar recibido | 5 | 0.8 s + 3.1 s | Mini-checklist por unidad clara. El bloque del acuse aparece arriba (top 138 px) sin buscarlo. Capturas `04-…-checkin-vacio`, `04-…-checkin-minichecklist`. |
| Acuse: nombre, firma, guardar | 3 | 3.1 s | "Acuse 2026093012-A1 guardado" con Ver/Imprimir y "Enviar al cliente". Fila: `DEVOLUCION · POR RECIBIR · Faltan 1 · Registrar equipos`. Captura `04-…-acuse-guardado`, `04-…-fila-devolucion-parcial`. |
| **Total check-in de 1 radio con acuse** | **8** | ~7 s | Bien resuelto. Lo único: la fecha del acuse sale "09/30/2026, 16:22:04" mientras la fila dice "2026-09-30" y la línea de tiempo "30-sept 16:15" (§3.2 C3). |

### 2.4 Recepción · entregar (`08`, `08b`, `08c`)

| Variante | Inter. | Tiempo | Qué vi |
|---|---|---|---|
| **Firma en la tablet del mostrador** (recepción en escritorio, cliente en `firmar/tablet.html`) | 4 en recepción (Entregar, nombre, "Firmar en la tablet", Confirmar) + 4 del cliente (nombre, cédula, firma, confirmar) | 0.8 s + 1.0 s en la tablet + **3.5 s** confirmar | La solicitud aparece sola en la tablet con los equipos; el nombre que recepción tecleó **ya viene prellenado** (la tablet solo reclama "Falta la cédula y la firma"; `js/ui/firmaTablet.js:75-76` escribe `nombre` y `cedula` aunque un comentario viejo en `ordenes-flujo.js:1466-1470` diga lo contrario): el #16 del 28-sep está resuelto en lo que se puede (la cédula no se conoce de antemano). La firma llega "sola" con nombre y cédula ("Cliente que recibe · Céd. 8-123-4567"). Al confirmar, la tablet lanza un `Cannot read properties of null (reading 'data')` en consola (no se ve, pero está). Capturas `08b-…`. |
| **Recepción en la tablet misma** (1024×768) | — | — | Aquí no aparece "Firmar en la tablet" (correcto: `FirmaTablet.disponible()` es falso con `pointer: coarse`, `js/ui/firmaTablet.js:41`) y el cliente firma en el recuadro. Pero el modal mide **1,188 px en una pantalla de 768**: el recuadro de firma empieza a 733 px y "Confirmar entrega" a 1,164: dos scrolls dentro del modal con el cliente esperando. Captura `08-recepcion-tablet-modal-entrega`. |
| **Firma en papel** | 5 (Entregar, casilla, motivo, quién recibió, Confirmar) | 3.1 s | La casilla ya está **arriba** del bloque de firma (#11 del 28-sep resuelto). La foto de la nota es opcional "se puede subir después". Y después "Ver entrega" muestra "Recibido por —" (R1). Capturas `08-…-modal-entrega-papel`, `08-…-ver-entrega-papel`. |

Correos: una entrega encola **cinco** "Nota de Entrega — Orden …": a la jefa, a recepción, al técnico, al vendedor y al cliente (`00b-mail-queue.js`). Pregunta para Alberto (§8).

### 2.5 Jefa de taller (Solangel) · escritorio (`05`, `07b`, `07c`)

| Flujo | Inter. | Tiempo | Qué vi |
|---|---|---|---|
| Encontrar lo que le toca: chip "Por asignar" | 1 | 1.1 s (42 filas) | Entra directo con `?estado=por_asignar`. Captura `05-…-por-asignar`. |
| **Asignar técnico** | 3 (Asignar, elegir, confirmar) | 0.8 s + **3.0 s** | El select viene **preseleccionado con ella misma** ("Solangel Ho Sang — supervisor"): rápido si se la queda, un error de un clic si no. Candado `withBusy` puesto (#4 resuelto). "El técnico recibirá una notificación por email" (en el emulador no queda en `mail_queue`: ese correo lo manda un trigger). Captura `05-…-modal-asignar`. |
| Menú ⋯ de una ASIGNADA | — | — | Ver recepción · Fotos de taller · Imprimir · Nota de entrega · Notas técnicas · **Cambiar técnico** (B3 de `mejoras-solicitadas/01` hecho) · Cotizar. Captura `05-…-menu-fila-asignada`. |
| **Control de calidad**, camino corto | 3 (QC, "Aprobar todos", "Aprobar QC") | 1.0 s + 2.1 s | El modal ya muestra **equipos e intervenciones** y marca en rojo "SIN intervención registrada" (P1.11 de agosto hecho). Ítem por ítem: 4 ítems × 2 equipos = 10 interacciones. Rechazar exige motivo. "Ver QC" después deja ver el resultado y "Repetir QC". Capturas `07-…-modal-qc`, `07b-…-qc-aprobar-todos`, `07b-…-ver-qc`. |
| **Cotizar desde la orden** (hasta abrir el editor) | 2 (⋯, Cotizar) | 2.1 s | El editor carga 421 clientes + 123 modelos + 16 piezas + 6 vendedores de una vez; trae los equipos con "Intervención: sin intervención registrada" y "Agregar pieza" por serial. Si ya existe cotización, el menú cambia a "Ver cotización COT-…" (`ordenes-render.js:1499-1506`; #4 del 28-sep resuelto). Captura `07-…-cotizar-orden`. |

### 2.6 Técnico en teléfono 390×844 (Marcos `06`, `11`, `12`; Ovidio `07b-tecnico-operativo`)

| Flujo | Inter. | Tiempo | Qué vi |
|---|---|---|---|
| Encontrar su orden | 0 | 2.4 s | Aterriza en `?mias=1` con "Ver solo mis órdenes" marcado: 15 tarjetas, la suya en la posición 2. Tarjetas de ~420 px: tres por pantalla. Captura `06-tecnico-telefono-bandeja`. |
| Intervención de 2 equipos con 1 pieza + completar | **12** | abrir Equipos 0.9 s · abrir intervención 0.8 s · materiales 0.9 s · agregar 0.9 s · **"Guardar y siguiente" 2.1 s** · completar 0.8 + 1.9 s | El buscador de piezas abre con **"Más usadas en este modelo"** (P1.6 de agosto hecho) y "Aplicar también a otros equipos". "Guardar y siguiente" existe (#5 del 28-sep hecho). Completar avisa "1 de 2 equipos sin intervención — el QC puede rechazarla" y deja pasar (soft, intencional). **El "Guardar" del último equipo no guardó (R2).** Capturas `06-…-equipos`, `06b-…-materiales-busqueda`, `06b-…-intervencion-con-pieza`, `06-…-completar-confirm`. |
| Ovidio en una VISITA de 21 equipos | — | 0.8 s por modal | "Equipo 1 de 21" con Anterior/Siguiente y "aplicar a los otros 20 — solo el texto". Botones de 62-98 px de alto: sí se trabaja de pie. Capturas `07b-tecop-…`. |
| Ir a otro módulo | 3 + scroll | — | Barra inferior Órdenes / Nueva / Filtros; "Menú principal" está en el drawer de Filtros **a 959 px en una pantalla de 844** (debajo de "Pendientes" y "Progreso"). **P0 #4 del 28-sep sigue vigente en teléfono**; a 900 px ya hay topbar con "Menú principal" (pero el título "Órdenes de Servicio" se monta sobre "Buscar", captura `10-tecnico-900px-bandeja-nav`). Captura `07b-tecop-telefono-drawer-filtros`. |

Los toasts en el teléfono salen **abajo, encima de Cancelar/Guardar** (capturas `06b-…-intervencion-con-pieza`, `06-…-tras-completar`): justo donde el técnico va a tocar después.

### 2.7 Bandeja: chips, búsqueda, presets, vistas (`09`, `09b`, `13`)

- **Chips**: de 12 a 7 (commit `0a32d99`): Todas · Por recibir · Por asignar · Asignado · Listos · QC · Cerradas (menú con los 6 cierres). Los conteos salen del servidor (`countChipBandeja`, 8 `count()` por carga) y "Todas" ya no lleva número. Tocar un chip tarda ~1.05 s y carga hasta 84 filas sin "Cargar más". **El chip ya se combina con la búsqueda** ("COLON" + Asignado = 4): el "chip borra la búsqueda" del 28-sep está resuelto. Lo que no cuadra es entrar por URL (R2) y tocar el chip activo (R7).
- **Búsqueda rápida**: 1.1-2.1 s. Encuentra por prefijo de número ("20260810" → 6), por cliente parcial ("MUNICIPIO" → 13), por serial ("25512A1843" → 4) y por técnico ("Marcos" → 99). Rareza: "COLON" devuelve "Total: 146" pero pinta 107 filas; "2026081004" devuelve 101 (el número exacto trae también las que comparten prefijo). La página en blanco durante la búsqueda ya no pasa.
- **Presets**: "Sin presets guardados" en la cuenta de la jefa. **Avanzado**: Orden / Cliente / Serial / Desde / Hasta en `mm/dd/aaaa`. **Vista de tarjetas** en escritorio: tarjetas de 180 px con tres líneas de aire; nadie la va a preferir a la tabla. Capturas `09-…`.
- **Densidad**: 194 objetivos clicables en la bandeja de escritorio, 143 (74 %) miden menos de 36 px; en tablet 133 de 195. Las acciones de fila ya van al 100 % de opacidad (#12 resuelto).

### 2.8 Satélites y verificación de los P0 del 28-sep (`10`)

| P0 / cambio del 28-sep | Estado hoy | Evidencia |
|---|---|---|
| #4 Órdenes móvil sin salida | **Vigente en teléfono**, resuelto entre 769-1024 px | §2.6 |
| #6 Reporte de pendientes vacío | **Resuelto**: 63 filas con fecha y vendedor, incluye "Por recibir" | `10-admin-escritorio-reporte-pendientes` |
| #7 Importador corrompe datos | **Resuelto en código** (guard `admin-equipos` y filas de equipo por `orden_id`, `importar-exportar.js:26-78`); no lo probé con un archivo contra el emulador compartido | `10-admin-escritorio-config` |
| #8 Correo de nueva orden con UID | **Resuelto**: "Vendedor: Zuleika Diaz" + "Abrir la orden en la plataforma" con `?orden=` | `00b-mail-queue.js` |
| #5 Guardar y siguiente / marcar todos | **Hecho**, pero con R2 | §2.6 |
| #6 Chips coherentes | **Hecho** | §2.7 |
| #7 Nombres de estado en pantalla | **Hecho en la bandeja**, no en los mensajes (§3.2 C1) | `10-admin-escritorio-editar-orden-recibida` |
| #10 "Eliminar" al final del ⋯ | **Hecho**; en ENTREGADO y CERRADA ya no aparece (hueco de agosto cerrado) | `10` |
| #11 "Firmó en papel" arriba de la firma | **Hecho** | §2.4 |
| #12 Acciones al 100 % | **Hecho** | §2.7 |
| #13 "Guardar y recibir" | **Hecho** (falta "Falla reportada") | §2.1 |
| #16 Prellenar nombre y cédula en la tablet | **Resuelto** (nombre; la cédula no se sabe antes) | §2.4 |
| Deep-links `?estado=` desde el home | **Roto** (R2): muestran una fracción | `13`, `13b` |
| editar-orden por URL en cualquier estado (agosto) | **Cerrado**: valida el estado y avisa | `10-admin-escritorio-editar-orden-recibida` |

`progreso-tecnicos` (ranking + QC por técnico), `casos viejos` (válvula de 30 días con "Ya se entregó / No vino") e `imprimir-orden` funcionan. `admin-equipos-cliente` sigue filtrando sin RECIBIDO ni cerradas.

## 3. Hallazgos

### 3.1 Roto

- **R1 a R4** arriba.
- **R5. Enter en el serial del lote no hace nada** (`ordenes-nuevo-batch.js` no tiene ningún `keydown`; `addRow` solo se llama desde el botón "Agregar fila", `:479`). El escáner que sí funciona en el check-in de devolución y en bodega, aquí deja el cursor en la casilla. Medido en `02`: filas 1→1, foco en `.serie`.
- **R6. Error en consola en la tablet al confirmar la firma** (`Cannot read properties of null (reading 'data')`, `08b`): la firma llega bien, pero el listener sigue vivo sobre un doc que ya no está. Dos líneas.
- **R7. El chip activo se desmarca al tocarlo de nuevo** (`13`: con "Por asignar" marcado por URL, tocar el chip devuelve "Total: 40 · Todos"). Quien toca el chip para "refrescar" pierde el filtro.

### 3.2 Confuso

- **C1. Dos vocabularios de estado.** La bandeja habla en "Por recibir / Por asignar / Listo (falta QC) / Listo para entregar" (`ordenes-state.js:335-358`), pero los mensajes hablan en crudo: `editar-orden` dice **"La orden está en RECIBIDO EN MOSTRADOR — la cabecera solo se edita en POR ASIGNAR"** sobre una orden cuya fila dice "POR ASIGNAR" (captura `10-admin-escritorio-editar-orden-recibida`). Para el usuario es una contradicción literal. Lo mismo en el "Total: 84 · COMPLETADO (EN OFICINA)" del resumen cuando el chip dice "Listos".
- **C2. La columna de estado se corta justo donde importa.** A 1280 px con el rail abierto (lo normal en el escritorio de recepción) el `<colgroup>` da 11 % al número (`ordenes/index.html:400`) = 97 px para un número monoespaciado que mide 121 px, con `overflow: visible` (`ordenes-index.css:1174-1178`): el número se monta sobre el cliente ("2026093006BEVERLY HILLS"). TIPO y ESTADO quedan "DEVOLUCIO", "VISITA TECN", "PROGRAMACI", "POR ASIGNAI", "LISTO PARA E"; la fecha "2026-09-…". En 12 filas, 8 celdas con texto cortado (`09`). La "calma visual" (estado = única voz de color) se pierde porque el estado no se lee. Capturas `01-recepcion-escritorio-bandeja`, `01-recepcion-tablet-bandeja`. Maqueta.
- **C3. Cinco formatos de fecha en el mismo módulo:** `2026-10-01` (tabla, impreso; en UTC), `30-sept 16:15` (línea de tiempo), `09/30/2026, 16:22:04` (acuses, QC), `30 de septiembre de 2026 a las 04:16 p. m.` (Ver entrega), `09/30/26, 9:56 p. m.` (progreso). CLDR da a `es-PA` el orden mes/día/año, así que "09/30/2026" es "correcto" y a la vez el que más se confunde con "30/09".
- **C4. "A quién le toca" no está en la fila.** El estado dice dónde está la orden, no quién la mueve: "Listo para entregar" es de recepción, "Listo (falta QC)" de Solangel, "Por asignar" de Solangel, "Por recibir" de Brenda, "Asignado" del técnico de la columna. Hoy se sabe por costumbre. Un técnico nuevo o un reemplazo de Brenda no lo deduce. Maqueta.
- **C5. "Recibido por (Cecomunica): cecrecep@cecomunica.com"**: la fase de recepción muestra el correo, no el nombre (`ordenes-events.js:731`). Y el acuse impreso igual (`:1118`).
- **C6. Preseleccionar a la jefa en "Asignar técnico".** Útil cuando ella se la asigna, pero es la opción por defecto para las 144 asignaciones del mes; el error es un clic y se corrige con "Cambiar técnico" + un correo de más.
- **C7. El confirm de eliminar equipo no dice cuál** y no se puede deshacer, en la acción más repetida del sistema.
- **C8. Cuatro circuitos, una sola barra de chips.** DEVOLUCIÓN y ENTRADA se distinguen por el chip de TIPO (cuando no está cortado) y por el botón de la fila ("Registrar equipos", "Ver recepción"). "Por recibir 2" mezcla una REPARACIÓN que el cliente aún no trae con una DEVOLUCIÓN a la que le faltan radios. Funciona para quien ya sabe; el filtro "Tipo (todos)" está a dos clics y nadie lo usa como vista.
- **C9. Vista de tarjetas en escritorio y "Avanzado"** duplican lo que ya hacen la tabla y la búsqueda rápida; la "Fecha entrega" vive en "Más → Mostrar fecha entrega".

### 3.3 Lento

- **L1. Cada guardado de la orden cuesta 2.7-3.5 s** (recepción 2.7, asignar 3.0, confirmar recibido 3.1, guardar acuse 3.1, QC 2.1, entregar 3.5, serial 2.9): es `mergeOrder` + re-lectura + repintado de la lista y los `count()` de los chips. Sumado al mes: 631 ediciones × 2.9 s ≈ 30 min solo esperando el toast del serial.
- **L2. Agregar un equipo = dos cargas de página (7 s)** para teclear un serial (§2.2).
- **L3. La bandeja hace 8 `count()` + la página + técnicos + perfil en cada carga** (2.2-2.7 s; 85-105 peticiones al emulador). Ya no encadena lecturas (el memo de sesión funciona), pero cada navegación recarga todo; con los deep-links `?orden=` desde correos y señales, la gente abre la bandeja muchas veces al día (recepción 12 vistas/día de home + 36 de órdenes el 30-sep).
- **L4. Cotizar carga 421 clientes y 123 modelos** para una cotización que ya sabe el cliente (2.1 s).

### 3.4 Pruebas dirigidas (`11`, `12`, `13`, `13b`)

| Prueba | Resultado |
|---|---|
| `11`: orden C, eq1 "Guardar y siguiente" → eq2 texto → "Guardar" | 847 ms, modal cerrado, **eq2 vacío** tras recargar. Reabrir eq2 directo → "Guardar" = 2.3 s, guardado. |
| `12` toque inmediato (toast en pantalla) | 890 ms, **no guarda**. |
| `12` toque 5 s después | 7.3 s (5 de espera + 2.3), **guarda**. |
| `12` `click()` por JS inmediato | 2.5 s, **guarda** → la función está bien; el toque no llega al botón. |
| `13` `?estado=por_asignar` por URL | chip 42 · Total 6 · 6 filas · "Cargar más". Tocar el chip activo → "Total: 40 · Todos". Desde Todas → chip: 42/42. |
| `13b` `?estado=ASIGNADO` (señal S3 del home) | chip 19 · **Total 6**. `?estado=COMPLETADO (EN OFICINA)` (S4): chip 84 · **Total 4**. Marcos `?mias=1&estado=ASIGNADO`: 3; `…COMPLETADO`: 7. `?qc=1`: consulta al servidor, correcto. |

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| P1 | "Ver entrega" pinta `entrega_persona_interna`, el motivo y la nota firmada (o "falta subir la nota") cuando `no_recibido` | R1 | 38 entregas/mes dejan de decir "—"; recepción deja de abrir el correo para saber quién recibió | 30 min | nulo |
| P2 | `formatFecha`/`imprimir-orden` con `timeZone: 'America/Panama'`; un solo formato corto (`30 sep 2026`) y uno largo (`30 sep 2026, 4:16 p. m.`) en todo el módulo | R3, C3 | cero fechas corridas; una sola forma de leer la fecha | 1-2 h | revisar `admin-equipos-cliente` y correos que usan el mismo helper |
| P2b | `?estado=` (y `?mias=1&estado=`) al arrancar llama a `filtrarPorEstado` como el chip; el chip activo no se desmarca al tocarlo | R2, R7 | las señales del home dejan de mentir | 1-2 h | bajo |
| P3 | Intervención: toast arriba en teléfono (`.toast-region` con `top` bajo `pointer: coarse`); no cerrar con texto cambiado sin escribir (X/Cancelar preguntan como ya pregunta el toque fuera) | R4 | cero intervenciones perdidas en silencio | 1-2 h | bajo |
| P4 | Columna NÚMERO con `min-width: 120px` en el `<colgroup>`, estado y tipo con ancho mínimo y nombres cortos ("Devolución", "Visita", "Programación"), cliente con `text-overflow` real; en tablet, ocultar la columna Técnico detrás del avatar | C2 | se lee el estado de cada fila a 1280 y 1024 | 2 h | bajo (CSS) |
| P5 | Lote: Enter en el serial = agregar fila y foco en el serial nuevo (y, si el serial está en el pool, modelo autollenado) | R5 | con escáner, 2 equipos pasan de 6 a 2 interacciones; 20 equipos de 60 a 20 | 2 h | bajo |
| P6 | Lápiz de serial siempre visible (`opacity: .6`, 32×32 táctil); confirm de eliminar con el serial y "Deshacer" 5 s | C7, §2.2 | la acción más frecuente deja de ser un botón invisible | 1-2 h | bajo |
| P7 | Mensajes con los nombres de pantalla: `editar-orden` ("La orden ya se recibió; la cabecera solo se edita antes de recibirla") y el resumen "Total: 84 · Listos" | C1 | menos "¿pero si dice POR ASIGNAR?" | 2 h | bajo |
| P8 | Barra inferior del teléfono: Órdenes · Nueva · **Menú** · Filtros; "Menú principal" y "Salir" arriba del drawer | P0 #4 | cambiar de módulo: de 3 + scroll a 1 | 2 h | bajo |
| P9 | "Asignar técnico" sin preselección (o con el último técnico asignado a ese cliente); la jefa se la queda con un botón "Asignármela" | C6 | menos reasignaciones (30 de 316 en 90 días, agosto) | 1 h | ninguno |
| P10 | Agregar equipo **sin salir de la bandeja**: fila nueva inline en el detalle (serial + modelo, mismo SerialField del lápiz) y `nuevo-batch` solo para lotes | L2 | 7 s y 2 cargas → 1 campo y 1 clic | 1 d | medio: el detalle ya es la pantalla más densa |
| P11 | Tablet: prellenar nombre y cédula desde la solicitud; modal de entrega en dos pasos en tablet (datos → firma) para que el recuadro y "Confirmar" quepan sin scroll | #16, §2.4 | 2 interacciones del cliente; cero scroll con el cliente esperando | 3-4 h | bajo |
| P12 | **"Le toca a"** en la fila y en la tarjeta (Recepción / Solangel / Marcos / QC) derivado de estado + tipo + técnico, y la bandeja de cada rol abre en **su** cola (recepción: Por recibir + Listos para entregar; jefa: Por asignar + Falta QC; técnico: mías) con el resto detrás de "Todas" | C4, C8 | se entiende sin explicación; menos clics de chip al día | 2-3 d | medio: tocar `ordenes-state.js` y los filtros iniciales por rol |
| P13 | Un solo `mergeOrder` con repintado de **la fila** (no la lista) y los `count()` diferidos 2 s | L1, L3 | ~1.5 s por guardado × ~1,000 guardados/mes ≈ 25 min/mes de espera | 2-3 d | medio: el snapshot ya re-pinta por `docChanges` en parte |
| P14 | PROGRAMACIÓN: intervención por orden (un texto para N radios) como camino por defecto | agosto §5.20: 46 % de equipos sin intervención | el técnico deja de pasar 10 veces por el mismo modal | 2-3 d | decisión de negocio (§8) |
| P15 | **Ficha de orden** (`?orden=` abre un panel o página con cabecera, línea de tiempo, equipos editables inline, acciones y documentos) en vez de la fila expandible dentro de una tabla de 50 | C2, L2, tablet | la tabla queda para la cola; el trabajo por orden se hace en una pantalla hecha para eso | 1-2 sem | alto: es el rediseño del módulo; conviene después de P4-P13 |

**Maqueta** (`docs/auditoria-modulos/maquetas/ordenes-bandeja-y-entrega.html`, con el CSS real): fila de la bandeja antes/después (P4 + P12) y bloque "Ver entrega" en papel antes/después (P1).

## 5. Cómo saber si funcionó

| Qué | Antes (30-sep) | Cómo medir después |
|---|---|---|
| Entregas en papel con "Recibido por —" | 38/38 del mes | `ordenes_de_servicio` con `no_recibido == true` y `receptor` visible en Ver entrega: 0 |
| Intervenciones perdidas | QC con "SIN intervención" en equipos que el técnico dice haber trabajado | audit logs `updateTrabajoTecnico` por equipo vs. equipos de órdenes completadas; meta: 0 equipos con texto vacío en REPARACIÓN entregada |
| Fechas corridas | 4/475 creadas (90 d), 158/529 entregadas | `00c-fechas-utc.js` → 0 |
| Interacciones por flujo | crear+recibir 15 · corregir serial 4 · agregar equipo 5+2 cargas · check-in 8 · entrega tablet 4+4 · papel 5 · asignar 3 · QC 3 · técnico 2 eq 12 | mismos scripts (`02`…`08`) tras cada cambio |
| Tiempo por guardado | 2.7-3.5 s | `medir()` en los scripts; meta < 1.5 s |
| Chips/filtros | 0 presets en la jefa; `uso_diario` solo tiene un día | contar en audit logs los `filterByStatus` por usuario/día; si P12 funciona, bajan |
| Salida del módulo en teléfono | "Menú principal" a 959 px | `uso_diario`: vistas de otros módulos desde cuentas de técnico |

## 6. Top 5 impacto/esfuerzo del módulo

1. **P1 + P2b Ver entrega en papel y deep-links del home** — 38 entregas/mes dejan de decir "—" y las señales del home dejan de mostrar 6 de 19 · 2-3 h.
2. **P3 Intervención que no se pierde** — toast fuera del botón y modal que no descarta texto · 1-2 h.
3. **P5 Enter = fila nueva en el lote** — recepción escanea en vez de teclear; −4 interacciones por orden de 2 radios · 2 h.
4. **P4 + P6 Bandeja legible y lápiz visible** — estado y número legibles a 1280/1024; la acción más frecuente deja de estar escondida · 3-4 h.
5. **P12 "Le toca a" + cola por rol** — la bandeja contesta "¿qué hago ahora?" sin que nadie explique el ciclo · 2-3 d.

## 7. Preguntas para Alberto

1. **Entrega en papel.** 38 de las entregas del último mes salieron "firmó en papel" y la foto de la nota es opcional. ¿Es política aceptable (y entonces P1 + exigir la foto antes de cerrar la orden) o hay que empujar la tablet (y entonces P11 y medir por qué no se usa: ¿cola en el mostrador, tablet apagada, cliente que no quiere)?
2. **PROGRAMACIÓN sin intervención por equipo.** Desde agosto se sabe que el 46 % de los radios de PROGRAMACIÓN salen sin intervención. Opciones: (a) un solo texto por orden que se estampa a todos (P14); (b) dejarlo como está y que el QC no lo marque en rojo para PROGRAMACIÓN; (c) exigirlo. Cada una cambia lo que el técnico hace de pie con 20 radios.
3. **Cinco correos por entrega** (jefa, recepción, técnico, vendedor, cliente). ¿Quién los lee? Si solo el cliente y el vendedor, son 3 correos menos por cada una de las ~120 entregas del mes.
4. **¿Quién debe salir preseleccionado al asignar?** Hoy la jefa (ella hace 144 asignaciones/mes). Opciones: nadie; ella; el último técnico de ese cliente.
5. **Fecha oficial de la orden.** La numeración y la fecha del documento deben coincidir con lo que firma el cliente. ¿Hora de Panamá en todo (P2) aunque el número ya se haya generado en UTC en algún caso?
6. **Ficha de orden (P15).** ¿Vale la pena el rediseño este trimestre o se exprime la bandeja con P4-P13 y se decide con los números de `uso_diario` en un mes?
