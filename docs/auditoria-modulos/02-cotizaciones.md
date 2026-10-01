# Auditoría de módulos 2026-09-30 · 02 · Cotizaciones

> Recorrido hecho en el emulador con los 60,436 documentos de producción del 30-sep, con sesión real de Elvia (vendedora), Karla (vendedora + supervisora), Solangel (jefa de taller), Alberto (admin) y un cliente sin sesión. 55 capturas en `docs/auditoria-modulos/capturas/cotizaciones/` (fuera del git). Scripts reproducibles en `docs/auditoria-modulos/scripts/cotizaciones/` (`analisis-datos.mjs`, `recorrido-vendedor.mjs`, `recorrido-taller.mjs`, `recorrido-admin.mjs`, `recorrido-publico.mjs`). Maqueta: `maquetas/cotizaciones-seguimiento.html`. Datos de prueba con prefijo `PRUEBA-AUDIT-cotizaciones` (COT-2026-0139 a 0141 en el emulador).

---

## ROTO HOY

**R1. Eliminar una cotización enviada deja el enlace del cliente vivo y "Vigente".** `CotizacionesService.softDelete` (`public/js/services/cotizacionesService.js:158-164`) solo marca `deleted:true`; el espejo público `cotizacion_verificaciones/{id}` no se entera, y `verify-cotizacion.js:609-621` calcula la situación por `estado` del espejo + fecha. Lo reproduje: Elvia envía COT-2026-0139, la elimina desde la lista, y un cliente sin sesión abre el enlace y ve **"Vigente hasta el 15 Oct 2026" con el panel "¿Aceptas esta cotización?"** (captura `16-cliente-sin-sesion-enlace-de-cotizacion-eliminada.png`). En producción hay tres así: COT-2026-0086, 0090 y 0092 (enviadas y eliminadas en septiembre, espejo sin estado). Si el cliente acepta, el callable responde "no disponible" (`responderCotizacionPublica.js:95`), o sea que el cliente ve un documento vigente que la empresa ya botó y su respuesta se pierde. Arreglo: al eliminar, escribir `estado:'descartada'` (o `deleted:true`) en el espejo y que la vista lo lea como "cerrada". 30 min.

**R2. El detalle de la cotización miente sobre quién la rechazó, por qué se descartó y quién la aprobó.** `CotState.toUi` (`public/js/pages/cot-editor-state.js:173-265`) no copia `rechazo_origen`, `rechazo_motivo`, `rechazado_por_email`, `cierre_motivo`, `fecha_descarte`, `aprobado_por_email` ni `respuesta_cliente`, y `cot-detalle.js:74-163` los lee de ese objeto. Resultado medido: Alberto rechaza COT-2026-0140 con motivo → la **lista** dice "Rechazada · aprobador" (correcto, captura 44) pero el **detalle** dice "Rechazada · el cliente declinó" sin motivo (captura 45; el documento crudo sí tiene `rechazo_origen:'aprobador'` y el motivo). Lo mismo con "Descartada —" sin fecha ni el motivo que la vendedora acaba de escribir (captura 13) y "Aprobada internamente" sin quién (capturas 29 y 46). El P0 #17 de la auditoría del 28-sep quedó resuelto en la lista y en los datos, **no en la pantalla que abre el correo de rechazo**. Arreglo: mapear esos siete campos en `toUi`. 20 min.

---

## 1. Para quién es y qué hacen ahí

Dos mundos sobre la misma colección `cotizaciones` (150 documentos en total; el módulo es chico):

| | Comercial (ventas) | De taller (servicio) |
|---|---|---|
| Quién la arma | Zuleika 27, Elvia 15, Karla 4, Salomón 4, Alondra 2 (últimos 30 días) | Solangel 19, Marcos 1 |
| Desde dónde | `cotizaciones/nueva-cotizacion.html` (o el Centro del cliente) | ⋯ → Cotizar en la bandeja de órdenes → `ordenes/cotizar-orden.html` |
| Quién aprueba fuera de política | `gerente` o admin. **No existe ningún usuario `gerente`**: solo Alberto y Zuleika | `jefe_taller` o admin: Solangel se la aprueba a sí misma (el correo ya no se manda a sí misma, §4.5 #9 resuelto) |
| Desenlace | Aceptada (venta/contrato), rechazada, descartada, vencida | Aceptada → fila en Facturación pendiente → facturada |

**Uso real.** 901 acciones en 30 días, de las cuales 679 son el autoguardado del borrador de taller; 72 cotizaciones creadas en el mes (52 comerciales, 20 de taller). `uso_diario` de hoy (un solo día): lista 19 vistas, detalle 15, imprimir 8, nueva 2, cotizar-orden 2. El enlace público lo han abierto 208 veces para 80 cotizaciones (17 % desde teléfono).

**El embudo real, todo el histórico (`analisis-datos.mjs`):** de 128 cotizaciones vivas, 87 se enviaron alguna vez; 10 se aceptaron, 2 se descartaron, 0 rechazadas, y **63 están "vencidas": 62 las marcó el cron de las 06:00 por silencio** (`markCotizacionesVencidas.js`). Solo 9 de 128 las cerró una persona. Hoy hay 33 enviadas esperando; 8 llevan más de 14 días y una 121. La "Tasa de cierre 8 %" que ve Elvia es eso: el desenlace por defecto de una cotización es que nadie la toque hasta que vence sola.

**La política de envío no es la del brief.** `empresa/config` dice `cotizacion_descuento_max_pct: 20` y `cotizacion_total_max: 15000` (el 15 %/$5,000 son los defaults del código). `cotizacion_aprobacion_to` está vacío, así que la solicitud de aprobación comercial sale a `ventas@cecomunica.com` (`cot-editor-state.js:1142`). Karla y cecrecep están en `cotizaciones_supervisores` (ven todo, solo lectura) y en `mail_bcc_cotizacion` (copia oculta de todo lo que sale al cliente).

## 2. Recorrido real

### 2.1 Vendedora (Elvia, escritorio 1280×800): comercial de 3 líneas, guardar, enviar

| Paso | Interacciones | Qué vi |
|---|---|---|
| Lista `cotizaciones/index.html` | — | 2.5 s hasta quieto, **36 viajes** a Firestore (7 `count()` × 2 bloques para los KPIs + página + caché). Aterriza en "Ventas" con solo las suyas (28 de 30 cargadas). 155 de 160 objetivos clicables miden < 36 px (los iconos de acción por fila). Captura 01. |
| Nueva | — | 2.0 s; carga 418 clientes + 123 modelos + 6 vendedores en paralelo. 28 campos editables. El subtítulo ya dice "Está dentro de tu límite de envío directo". Captura 02. |
| Cliente | 3 | Buscador: teclear "wong" → 1 coincidencia con RUC y representante → elegir. Rellena Dirigido a y Email. Captura 03. |
| 3 renglones | 3 + 3 + 4 + 2 ("Agregar renglón") | Autocompletar por nombre: `PDC550` trae USD 778.57; `AP32X` USD 100. **`NX-420` viene "sin precio"**: toast "no tiene precio de venta en el catálogo — escríbelo a mano". Solo 16 de 123 modelos tienen `precio_venta` y 12 `precio_alquiler`. Captura 04. |
| Guardar con el renglón en $0 | 2 | Confirm "Renglones en cero… ¿Guardar así?" (guardia correcta). Cancelar, poner 375. Captura 04b. |
| Guardar | 1 | 2.95 s → detalle con **el panel de envío ya abierto** (`?enviar=1`, §4.5 #6/#10 resuelto). El panel muestra destinatario, CC, asunto, casilla de carta y la vista previa del correo. Captura 05. |
| Enviar | 1 | Toast "Cotización enviada a info@wongtransport.net". Chip Enviada. Captura 06. |

**Total camino feliz: 16 interacciones** (la auditoría del 28-sep estimó ~15 → ~13 con `?enviar=1`; lo medido con la política ya "aterrizando" es 16 porque cada renglón son 3 gestos + el botón de agregar). Con un modelo sin precio son 19.

**¿Qué pasa después de enviar?** Captura 06: el encabezado cambia a Enviada y aparecen Reenviar y Cerrar; "Cambiar estado" dice "Estado final — sin transiciones disponibles" (para una cotización que acaba de empezar a vivir); el historial sigue diciendo solo "Cotización creada" hasta recargar (`cot-detalle.js:670` actualiza `cot.estado` pero no `cot.enviada_en`); "Sin aperturas registradas del cliente todavía". No hay fecha de vencimiento a la vista fuera del bloque de totales ni ningún "qué sigue".

### 2.2 Vendedora: duplicar, salir de política, pedir aprobación, eliminar, restaurar, cerrar

| Flujo | Interacciones | Qué vi |
|---|---|---|
| Duplicar → editor | 2 | Confirm que avisa que consume un número COT. Cae en `editar-cotizacion` con subtítulo "Editando · Borrador": **en edición no hay aviso de política en el encabezado** (solo en modo nueva, `cot-editor.js:84`); al poner 25 % en un renglón lo único que cambia es la letra chica del resumen. Captura 07. |
| Guardar → Solicitar aprobación | 1 + 2 | El detalle sí lo dice claro: "Hay renglones con 25 % de descuento — supera el máximo (20 %)" y el botón "Solicitar aprobación". El correo sale a ventas@. Nada marca que ya se pidió: el botón sigue igual y se puede pedir diez veces (vigente del 28-sep). Capturas 08, 08b. |
| Eliminar desde la lista | 2 | Se ofrece Eliminar en **cualquier** estado, también enviadas y aceptadas. Ver R1. Captura 09. |
| Mostrar eliminadas → Restaurar | 2 | Fila atenuada, chip "Eliminada", botón Restaurar. **P0 #18 resuelto.** Captura 10. |
| Cerrar (bandera) → Otro motivo → texto → cerrar | 4 | El prompt explica bien las cuatro salidas; exige motivo ≥ 5 letras. Chip "Descartada" con el motivo en tooltip. Capturas 11, 12. Pero el detalle no muestra ese motivo (R2, captura 13). |
| Buscar "wong" | 1 | 2 resultados, del servidor (tokens). |
| Recuperar respaldo + cliente nuevo (`?cliente_id=`) | 1 | Recupera 2 renglones **y** el cliente WONG. **P0 #19 resuelto.** Captura 48. |
| Karla (vendedora + supervisora) | — | Ve Taller 7 / Ventas 21 / Todas 28 y el toggle "Solo mis cotizaciones"; en filas ajenas solo Ver e Imprimir. Captura 14. En teléfono la tarjeta solo ofrece Ver / Editar / Imprimir: no se puede enviar ni cerrar sin entrar al detalle (`cotizaciones-index.js:438-465`). Captura 15. |

### 2.3 Jefa de taller (Solangel, escritorio): cotizar la orden 2026092905 (COMPLETADO, 1 equipo, 4 piezas del técnico)

| Paso | Interacciones | Qué vi |
|---|---|---|
| Llegar | 2 | Bandeja (2.9 s, 105 viajes; no es de este módulo) → ⋯ "Más acciones" → Cotizar. Captura 20. |
| `cotizar-orden.html` | — | 2.4 s, 8 viajes en paralelo. **Precarga sola las 4 piezas de cobro que registró Marcos** con SKU, nombre y precio, y avisa "Se precargaron 4 piezas — revisa y ajusta". 25 campos. Cliente, firmante (Solangel) y condiciones de reparación ya puestos. Captura 21. |
| Pieza que no está en catálogo | 5 | "Agregar pieza" → teclear "antena" → "Sin coincidencias en el catálogo — se escribirá a mano". El catálogo de piezas tiene **16 activas**; todo lo que no sea PNC360 se teclea (SKU, descripción, cantidad, precio). Captura 22. |
| Catálogo lateral | 3 | Abre a la derecha con "Sugeridas para PNC360S-R" arriba y grupos por categoría; + agrega. Captura 23. |
| Descuento global, vista previa | 1 + 2 | La vista previa (hoja del kit) muestra por equipo: serie, modelo, intervención, piezas. Captura 25. |
| Recargar la página | 1 | "Borrador encontrado (guardado el 09/30/2026, 4:22 p. m.) — Restaurar / Empezar de cero". Restaura las 6 líneas y el 5 %. Captura 26. |
| Preparar cotización | 1 | 3.7 s → detalle con la **franja de pasos del taller** ("Preparada · Enviada al cliente · Aceptada · en facturación · Facturada", "estás aquí"). Captura 27. |
| Aprobar y enviar | 2 | Panel con motivo, totales y renglones; "Al aprobar, la cotización sale al cliente de inmediato por correo a seguridad@pandeportes.gob.pa". Toast "Aprobada y enviada". Capturas 28, 29. |
| Respuesta del cliente | 5 | "El cliente aceptó — pasar a facturar / no aceptó / otro motivo" → ¿Cómo aceptó? (correo, verbal, otro) + detalle → "Pasar a facturar". Historial: "Aceptada por el cliente · pasó a facturación · Por correo — … · anotado por solangel". Capturas 30, 30b, 31. |
| Volver a cotizar la misma orden | — | "Esta orden ya tiene la cotización COT-2026-0141 (Aceptada) — Ver cotización / Preparar otra". **4.2 #4 resuelto.** Captura 32. |

**Total hasta el borrador: 13 interacciones** con 6 líneas (4 vinieron solas). Aprobar y enviar 2. Respuesta 5. **Camino completo de una reparación cotizada: 22 gestos y 3 pantallas.**

**Sobre los 679 autoguardados.** Medido: 10 ediciones → **4 escrituras** de `borradores_cotizacion` (debounce de 600 ms, `cotizar-orden.js:49`; cada escritura manda el borrador entero). En producción, las 20 cotizaciones de taller del mes suman 159 renglones (1 a 23 por cotización) = 636 campos tecleables; 679 / 20 = 34 guardados por cotización ≈ **uno por campo**: la persona hace una pausa de más de 600 ms entre campo y campo y cada pausa es una escritura. El número mide el largo del formulario, no que vuelvan varias veces: los 4 borradores vivos son de julio (viejos, se descartarían al abrir), o sea que las cotizaciones se terminan en una sentada y el borrador se borra al generar. No es un problema de flujo; es un contador inflado y una escritura del documento completo por cada pausa.

**Orden de 7 equipos (2025082901) en escritorio y tablet:** sin scroll horizontal, 9 campos antes de agregar líneas, catálogo legible en 1024 px (capturas 33-35). Los inputs de línea son angostos: "511600009194" y "Teclado P" se cortan en escritorio (captura 21).

### 2.4 Admin (Alberto): aprobación fuera de política

| Flujo | Interacciones | Qué vi |
|---|---|---|
| `?aprobar=1` desde la señal SAP | — | "Mostrando solo las cotizaciones que esperan tu aprobación" → 1 de 30. **P0 #20 resuelto.** Captura 40. |
| Rechazar desde la fila | 4 | Panel de aprobación (motivo "25 % supera el máximo 20 %", precio de lista, descuento por renglón, casilla de carta) → Rechazar → motivo obligatorio → toast "Se avisó al vendedor por correo". Lista: "Rechazada · aprobador". Capturas 42-44. Detalle: ver R2. |
| Marcar Borrador → Aprobar y enviar | 4 | El admin aprueba comerciales (no hay gerente). Captura 46. |
| Cerrar como Aceptada | 2 | "🏆 Aceptada por el cliente"; historial completo. Captura 47. |

Vista de todas: Taller 8 / Ventas 20 / Todas 28; "33 enviadas esperando"; monto cerrado USD 5,907.66 "aceptadas · alquiler a 12 meses". Captura 41.

### 2.5 Cliente sin sesión: `verify/cotizacion.html`

| Caso | Qué ve |
|---|---|
| Enviada vigente (COT-2026-0138, con carta) | Arriba "Vigente hasta el 4 Oct 2026" y el panel "¿Aceptas esta cotización?" con nombre obligatorio; **luego 2 páginas de carta de presentación y la cotización en la página 3**. Aceptar pide confirmación en el mismo bloque. Capturas 50, 51. |
| Aceptada desde el enlace (COT-2026-0137, hoy) | "Cotización aceptada · Aceptada a nombre de Claribel Pérez el 09/30/2026". Captura 52. **El §4.5 #12 (aceptar/rechazar en línea) ya está en producción desde el 28-sep y ya se usó una vez.** |
| Enviada antes del espejo de estado (COT-2026-0109) | "Cotización vencida el 21 Sep 2026" calculado por fecha; correcto. |
| De taller (COT-2026-0141) | Título "COTIZACIÓN DE SERVICIO TÉCNICO" con la orden, piezas agrupadas por equipo. Captura 53. |
| Teléfono 390 px | Sin scroll horizontal; el panel de aceptar arriba y el documento debajo a escala. Captura 54. |
| Karla (en BCC) abre el mismo enlace | "Vista interna (no cuenta como apertura del cliente)". Captura 55. |

### 2.6 Las 46 "eliminadas" del brief: qué dicen los datos

En la colección hay **22 cotizaciones con `deleted:true` en toda su historia y solo 6 borradas en los últimos 30 días**. Las 46 del registro de auditoría no son cotizaciones: casi seguro son los `delete` de `ordenes_de_servicio/{id}/borradores_cotizacion/{uid}` que hace `cotizar-orden.js:81-84` cada vez que se genera una cotización (20 en el mes), se elige "Empezar de cero" o el borrador tiene más de 7 días (`DRAFT_MAX_AGE_MS`). Es la contraparte de los 679 autoguardados, no un síntoma de errores al crear.

Las 22 reales, por si sirven: 16 sin cliente, 13 de un solo renglón, 3 con total 0 → pruebas de junio (Karla 9; tres con el mismo número COT-2026-0012, el choque del correlativo que ya se arregló con transacción). 5 son las `emitida` de febrero de Alberto. Y **8 ya estaban enviadas al cliente cuando se eliminaron**; las de septiembre: COT-2026-0090 (Solangel, 36 min después de crearla; la orden 2026090701 recibió después la 0091), 0086 y 0092 (Zuleika, 2 h y 52 min después). Es decir: en este equipo "eliminar" se usa como "la mandé mal, la rehago", que es exactamente lo que R1 deja al descubierto en el enlace del cliente. La salida correcta para eso ya existe ("Cerrar → Otro motivo → se rehace"), pero Eliminar está más a mano y no pide motivo.

## 3. Hallazgos

### Roto
- **R1, R2** arriba.
- **R3. La franja de estado dice "Estado final" al segundo de enviar** y el historial no registra el envío hasta recargar (`cot-detalle.js:670-672` y `:88`). Confunde más que rompe; va con la propuesta 3.

### Confuso
- **C1. Tarjetas y segmentos con números distintos en la misma pantalla.** Vista Taller de Solangel: tarjeta "12 Enviadas · esperando" y segmento "Enviada 5"; "4 por facturar" y segmento "Por facturar 2" (captura 36). Las tarjetas cuentan en el servidor todo el histórico (`cotizaciones-index.js:207-252`); los segmentos cuentan las 30 filas cargadas (`:151-189`). El P0 #20 se arregló poniendo "todo el histórico" en letra chica, y ahora los dos números se contradicen a 3 cm de distancia.
- **C2. Eliminar es más fácil que descartar y sirve para lo mismo.** Eliminar: 2 clics, cualquier estado, sin motivo, y "Podrás restaurarla" invita a usarlo como papelera. Descartar: 4 gestos y motivo obligatorio. 8 de 22 eliminadas estaban enviadas.
- **C3. El precio del catálogo casi nunca está.** 107 de 123 modelos sin `precio_venta`, 111 sin `precio_alquiler`. Cada renglón termina con un toast "escríbelo a mano" y, si se olvida, el confirm de "Renglones en cero". El autocompletar hoy sirve para el nombre, no para el precio. Es dato, no código (Zuleika/contabilidad, `inventario/modelos`).
- **C4. En taller, el catálogo de piezas son 16 SKU** (todo PNC360/PNC370): "antena", "batería", "clip" no existen y se teclean; `fuera_catalogo` marca 2 de 185 consumos. Las "Sugeridas para el modelo" funcionan, pero solo pueden sugerir lo que existe.
- **C5. Duplicar cae en el editor sin aviso de política**; el aviso "requiere aprobación" solo se pinta en modo nueva (`cot-editor.js:84`). Y "Solicitar aprobación" no deja huella (`aprobacion_solicitada_en` no existe): el botón sigue igual después de pedirla.
- **C6. El cliente ve primero "¿Aceptas?" y la carta; la cotización está en la página 3** (captura 50). En teléfono son 3,900 px de scroll para llegar al precio. La casilla "Incluir carta" viene marcada por defecto (73 de 107 comerciales la llevan).
- **C7. Quién aprueba las comerciales.** El código y `docs/SISTEMA_TOP_DOWN.md` §3.2 dicen "gerente"; en producción nadie tiene ese rol. Todo cae en Alberto y Zuleika, y el correo va a `ventas@` porque `cotizacion_aprobacion_to` está vacío. Quien no tiene rol de aprobar ni sabe a quién le llegó.
- **C8. "Vencida" es el desenlace de 62 de 128 cotizaciones y nadie lo decidió.** No hay recordatorio antes de los 15 días, ni columna de "días sin respuesta", ni forma de posponer la validez sin reabrir a borrador. La tarjeta "Enviadas · esperando · requieren seguimiento" no dice cuáles urgen.
- **C9. Anchos de columna.** La descripción del renglón muestra "HYTERA" de "HYTERA PDC550" (captura 04); en cotizar-orden el Nº de pieza y la descripción se cortan a 12 y 9 caracteres (captura 21) aunque sobra pantalla.
- **C10. Cotizar no mira el estado de la orden**: el ⋯ ofrece "Cotizar" en POR ASIGNAR y en ENTREGADO por igual (`ordenes-render.js:1503-1506`, `cotizar-orden.js:1000-1024`). No lo vi causar daño; es un candado que falta.
- **C11. Legado a la vista.** Quedan 7 `emitida` y 1 `anulada` (febrero): la lista no las cuenta en ningún segmento (solo `ESTADO_ORDEN`) y el chip cae a "Borrador" por el fallback de `estadoChip` (`cotizaciones-index.js:323`). Son 8 documentos: se migran a mano y se acabó.

### Lento
- **L1. La lista hace 36 viajes** por los `count()` (7 métricas × 2 bloques cuando el tipo es Taller o Ventas) más la página y la caché. Con 150 documentos, un solo `listPorEstados` y contar en memoria sería más barato y coherente con C1. 2.5 s en el emulador (sin latencia de red real).
- **L2. El autoguardado escribe el borrador entero en cada pausa** (34 por cotización). No cuesta plata, pero es la segunda acción más frecuente del sistema por puro ruido y contamina el ranking de uso.
- **L3. Nueva cotización carga los 418 clientes y 123 modelos en cada apertura** (2.0 s). Ya está en memoria por `Sesion.memo` en la misma pestaña; entre pestañas no. Aceptable hoy; crece con la base.

### Cruce con la auditoría UX del 28-sep (§4.5 y P0)

| # | Estado verificado en el navegador |
|---|---|
| P0 #17 rechazo del aprobador | **Parcial**: datos y lista bien; el detalle lo sigue mostrando como "el cliente declinó" (R2). |
| P0 #18 restaurar | Resuelto (captura 10). |
| P0 #19 respaldo pierde el cliente | Resuelto (captura 48). |
| P0 #20 KPIs sobre lo paginado / SAP | Resuelto en la tarjeta (server `count()`, `?aprobar=1` filtra); pero abrió C1. |
| §4.5 #1 rechazo con motivo y correo | Resuelto. |
| #3 respaldo | Resuelto. |
| #5 colores (T1) | Resuelto: Aceptada verde, Aprobada morado, Descartada gris. |
| #6 `?enviar=1` / spinner / "Aprobar y enviar" | Resuelto (captura 05; candado `withBusy`; el botón dice "Aprobar y enviar" y avisa también en taller). |
| #7 aprobar en sitio | Resuelto (hoja en la lista y en el detalle). |
| #8 gerente ve "Nueva" | No aplica: no hay gerentes. |
| #9 taller se pide aprobación a sí misma | Resuelto (Solangel: "Aprobar y enviar", ningún correo a sí misma). |
| #10 `await validar()`, "Editar", asunto "Solicitud" | Resuelto. |
| #12 aceptar en la vista pública / estado y vencimiento | Resuelto y ya usado (captura 52); **falta el caso eliminada (R1)** y los espejos anteriores al 28-sep no traen estado (calculan por fecha, correcto). |
| 4.2 #4 "Cotizar" sin revisar `cotizacion_doc_id` | Resuelto (captura 32). |
| SISTEMA_TOP_DOWN §4 #8 umbral solo en UI | Resuelto: `firestore.rules` `politicaEnvioOk` + `onPolitica.js` devuelve a borrador. #9 validez configurable: resuelto. #10 "Marcar Enviada" manual: sigue, con aviso explícito. #15 aprobada sin email: resuelto (prompt). |
| Brief: "46 eliminadas" | **Falso como síntoma**: son borrados de `borradores_cotizacion` (§2.6). |
| Brief: "679 autoguardados = flujo largo, vuelven varias veces" | **Falso**: es una escritura por campo tecleado (§2.3). |

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| 1 | `softDelete`/`restore` espejan `estado`/`deleted` en `cotizacion_verificaciones`; `verify` trata `deleted` como "cerrada". | R1 | Un cliente aceptando algo que no existe; 3 enlaces vivos hoy | 30 min | Nulo |
| 2 | `toUi` copia `rechazo_origen`, `rechazo_motivo`, `rechazado_por_email`, `cierre_motivo`, `fecha_descarte`, `aprobado_por_email`, `respuesta_cliente`. | R2 | Historial y chip verdaderos en el detalle | 20 min | Nulo |
| 3 | Tras enviar/cerrar en el detalle, `recargar()` en vez de parchar `cot` a mano; "Cambiar estado" en enviada dice "Esperando al cliente · vence el X" en vez de "Estado final". | R3 | El vendedor entiende qué pasó sin recargar | 30 min | Nulo |
| 4 | Un solo alcance para tarjetas y segmentos (maqueta 1): segmentos con los mismos `count()`; tocar un segmento trae esa lista completa del servidor (como `listPorEstados` ya hace con "activas"). De paso: una sola lectura `listPorEstados(activos)` para contar en memoria y bajar los 36 viajes. | C1, L1 | Cero contradicciones; −20 viajes por apertura (19 aperturas/día) | 3-4 h | Bajo: índices existentes |
| 5 | Eliminar solo en borrador; en enviada/aprobada la papelera se vuelve "Cerrar" (que ya pide motivo). Rehacer = Duplicar + descartar la vieja en un mismo gesto ("Rehacer esta cotización"). | C2, §2.6 | Deja de haber dos caminos; el motivo queda | 1-2 h | Bajo |
| 6 | Autoguardado: debounce 2.5 s + guardar en `blur` y `pagehide`; escribir solo `lineas`+`form` cuando cambian (ya se manda todo). Excluir `borradores_cotizacion` del ranking de "acciones". | L2 | −70 % escrituras (≈480/mes) y un ranking de uso limpio | 30 min | Nulo |
| 7 | Anchos: descripción del renglón `minmax(220px,1fr)`; en cotizar-orden Nº pieza 160 px y descripción flexible. | C9 | Leer lo que se tecleó sin abrir el campo | 1 h | Nulo |
| 8 | Cargar `precio_venta`/`precio_alquiler` a los modelos que se cotizan (tarea de datos para Zuleika con la pantalla de modelos; 107 fichas). Mientras, el autocompletar muestra "sin precio" en rojo antes de elegir (ya lo hace en gris). | C3 | −3 gestos y un toast por renglón; se acaba el "Renglones en cero" | 2-3 h de datos, 0 de código | Nulo |
| 9 | Catálogo de piezas de taller: cuando el técnico o Solangel escriben una pieza "fuera de catálogo", nace un pendiente "dar de alta" en Inventario · Piezas (la marca `fuera_catalogo` ya existe; falta la bandeja). | C4 | Que el catálogo crezca solo con lo que se usa | 1 día | Bajo |
| 10 | Vista pública: la cotización primero, la carta después (o como enlace "Conoce Cecomunica"); el panel de aceptar pegado al bloque de firma; `incluye_carta` por defecto apagada para clientes con contrato vigente. | C6 | El cliente ve el precio sin pasar 2 páginas | 2-3 h | Decisión de Alberto (pregunta 5) |
| 11 | Seguimiento de enviadas (maqueta 2): columna "Días sin respuesta" en la lista (semáforo a 7/12 días), bloque "Seguimiento" en el detalle (enviada, abierta, vence, qué sigue, Posponer 15 días), y recordatorio por correo al vendedor 5 días antes de vencer (el cron de vencidas ya recorre las enviadas; es una segunda pasada). | C8 | Que 62 "vencidas" dejen de ser el desenlace silencioso; el vendedor sabe a quién llamar hoy | 1-2 días | Bajo |
| 12 | Aprobación comercial con dueño: `cotizacion_aprobacion_to` con la persona (Zuleika), la señal SAP en su home (existe), y `aprobacion_solicitada_en`/`_por` estampados para que "Solicitar" diga "Pedida el X a Y · volver a avisar". Retirar el rol `gerente` de la documentación o crearlo. | C5, C7 | Nadie espera un correo que cayó en ventas@ | medio día + decisión | Decisión de Alberto (pregunta 1) |
| 13 | Candado suave al cotizar por estado de orden: en POR ASIGNAR/ASIGNADO avisar "el técnico no ha registrado intervención"; en ENTREGADO/CERRADA pedir confirmación. | C10 | Cotizaciones sin intervención | 1 h | Nulo |
| 14 | Migrar a mano las 8 `emitida`/`anulada` de febrero a `enviada`/`descartada`. | C11 | Sin filas fantasma | 15 min (script contra producción, con Alberto) | Nulo |
| 15 | Ambiciosa: cotizar-orden como hoja densa de piezas para las visitas técnicas (20-40 equipos, 23-76 renglones): una tabla única equipo × pieza con Enter para saltar de celda, cantidad por defecto 1, "aplicar la misma pieza a N equipos" y sugeridas en un clic. Hoy cada equipo es un bloque con su propia tabla y el formulario de 21 equipos mide 2,900 px. | §2.3 | En una visita de 21 equipos: de ~100 gestos a ~40 | 3-4 días | Medio: rediseño de la pantalla más usada por Solangel; probar con ella |

Las 1-3 y 6-7 caben en una mañana y son las que cambian lo que la gente ve hoy.

## 5. Cómo saber si funcionó

- **R1/R2:** `cotizacion_verificaciones` sin `estado` para docs con `deleted:true` = 0; abrir el enlace de una eliminada dice "cerrada". Detalle de una rechazada por aprobador muestra "Rechazada por <email>: <motivo>" (prueba: `functions/test` con un doc de fixture).
- **Conteos (4):** en la vista Taller, tarjeta "Enviadas" = segmento "Enviada" para cualquier usuario; `fsReqs` de la lista < 15 (hoy 36) en `recorrido-taller.mjs`.
- **Eliminar (5):** `deleted:true` con `estado in [enviada, aprobada, convertida]` = 0 documentos nuevos por mes (hoy 8 históricos, 3 en septiembre).
- **Autosave (6):** escrituras de `borradores_cotizacion` en los audit logs: de 679 a < 200 al mes con el mismo número de cotizaciones de taller (≈20).
- **Precio de catálogo (8):** modelos con `precio_venta` > 0: de 16 a > 80; toasts "no tiene precio" por cotización creada: de ~1 a 0 (se puede contar en `uso_diario` si se registra el toast).
- **Seguimiento (11):** proporción de cierres hechos por una persona (convertida + rechazada + descartada) sobre enviadas: hoy 9/87 = 10 %; meta > 50 % en 60 días; vencidas por cron por mes: de ~26 a < 10.
- **Pasos:** `recorrido-vendedor.mjs` y `recorrido-taller.mjs` imprimen el conteo (16 y 13 hoy); las propuestas 7-8 deben bajarlos a 13 y 10 sin tocar el resto.

---

## Top 5 impacto/esfuerzo del módulo

1. **Espejar la eliminación en el enlace público** (R1): 30 min; cierra hoy 3 enlaces "vigentes" de cotizaciones borradas y evita aceptaciones perdidas.
2. **`toUi` completo** (R2): 20 min; el detalle deja de decir "el cliente declinó" cuando fue el aprobador y muestra motivo y quién aprobó.
3. **Tarjetas y segmentos con un solo alcance + una lectura** (propuesta 4): 3-4 h; cero contradicciones y −20 viajes en la pantalla que se abre 19 veces al día.
4. **Autoguardado con debounce de 2.5 s y en blur** (propuesta 6): 30 min; −480 escrituras al mes y un ranking de uso que ya no mide pausas.
5. **Seguimiento de enviadas: días sin respuesta + recordatorio antes de vencer** (propuesta 11): 1-2 días; ataca el dato más feo del módulo, 62 de 128 cotizaciones "vencidas" por silencio.

## Preguntas para Alberto

1. **¿Quién aprueba las cotizaciones comerciales fuera de política?** El código dice `gerente`, no existe ninguno, y el correo va a `ventas@cecomunica.com` (config vacía). Opciones: (a) Zuleika como aprobadora nombrada en `cotizacion_aprobacion_to` y en su home la señal SAP; (b) crear el rol gerente para alguien; (c) subir el umbral (hoy 20 %/$15,000; solo 4 comerciales lo han cruzado) y que el vendedor envíe todo. (a) es config de 5 minutos; (c) elimina el paso pero también el control.
2. **¿"Vencida" a los 15 días por silencio es lo que quieren?** 62 de 128 terminaron así y nadie las cerró. Opciones: (a) dejarlo y sumar recordatorio a los 10 días + "Posponer" (propuesta 11); (b) que venza solo la validez del documento (lo que ve el cliente) pero la cotización quede "enviada · sin respuesta" hasta que el vendedor la cierre; (c) validez de 30 días. (b) hace honesta la tasa de cierre pero deja colas viejas.
3. **¿Se puede eliminar una cotización ya enviada?** Hoy sí, sin motivo, y en septiembre pasó 3 veces como "la mandé mal". Opciones: (a) Eliminar solo borradores y "Rehacer" (duplica + descarta) para las enviadas; (b) dejar Eliminar pero avisarle al cliente que ese enlace ya no vale. (a) es la propuesta 5.
4. **Política vigente:** el brief dice 15 %/$5,000, `empresa/config` dice 20 %/$15,000. ¿Cuál es la buena? Si es la del brief, es un cambio de config; si es la de config, hay que corregir la documentación.
5. **La carta de presentación en el enlace del cliente:** ¿antes de la cotización (hoy, 2 páginas antes del precio), después, o como enlace aparte? ¿Y por defecto marcada para clientes con contrato vigente?
6. **Karla en `cotizaciones_supervisores` y en `mail_bcc_cotizacion`:** ve todas las cotizaciones de todos y recibe copia oculta de cada envío. ¿Es intencional (supervisión comercial) o quedó de una prueba?
7. **Cotizar órdenes en cualquier estado:** ¿se limita a COMPLETADO / ENTREGADO / CERRADA (VISITA), o hay casos reales de cotizar antes de la intervención (presupuesto previo)? Si los hay, la pantalla debería decir "sin intervención registrada" con más fuerza.
