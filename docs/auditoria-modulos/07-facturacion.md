# Auditoría de módulos 2026-09-30 · 07 · Facturación y Finanzas

> Recorrido hecho en el emulador con los 60,436 documentos de producción del 30-sep, con sesión real de Zuleika (gerencia, rol administrador), Brenda (recepción), Cheila (contabilidad) y Alberto (admin), en escritorio 1280×800, tablet 1024×768 y teléfono 390×844. **52 capturas** en `docs/auditoria-modulos/capturas/facturacion/` (fuera del git). Scripts reproducibles en `docs/auditoria-modulos/scripts/facturacion/` (`00`–`04` son censos de solo lectura; `10`–`16` son recorridos con puppeteer; `_lib.mjs` bloquea las callables de Cloud Functions para que nada salga a producción). Maqueta: `maquetas/facturacion-qbo-lote-y-error.html`. Datos de prueba con prefijo `PRUEBA-AUDIT-facturacion` (5 avisos sembrados por `02-seed-prueba.js`).
>
> Dos avisos de método. (1) **Las callables de QuickBooks no corren en el emulador** (no hay emulador de functions): `listQBOCustomers`, `listQBOItems`, `gestionarFacturacion` y `calcularFacturaContrato` fallan con `functions/internal`; documento qué ve la persona cuando fallan y si la pantalla lo explica. (2) **La información financiera es need-to-know**: describo pantallas y flujos, no copio montos ni listados de clientes con saldos. Los conteos de `uso_diario` de hoy están contaminados por los propios recorridos de los auditores (28 vistas de la bandeja son nuestras), así que no los uso; los registros de auditoría de escrituras del brief (171 acciones / 144 vínculos QBO) no están en la exportación, y lo que digo del uso real sale de las marcas que quedaron en los documentos (`por_email`, `at`, `qbo_vinculado_at`).

---

## ROTO HOY

**R1. El Panorama le falla a contabilidad con un error de reglas.** La pestaña "Panorama" se le muestra a Cheila (`finanzas-nav.js:27`), pero `admin-financiero.js:70` lista `cotizaciones` y `firestore.rules:219` (`allow list: if puedeCotizar() || esTecnicoTaller() || esSupervisorCot()`) no incluye a `contabilidad`. Resultado: los cuatro KPI quedan en "—", la tabla vacía y un toast que dice `Error: evaluation error at L219:22 for 'list' @ L219` (captura 93; log del recorrido 13). Es la única pestaña del espacio que a contabilidad le revienta. Arreglo: o se agrega `contabilidad` al `allow list` de cotizaciones (y a `verTodasCot` para el `get`), o se le esconde la pestaña. 30 min.

**R2. "Ver hechos y no aplica" miente después de cerrar un aviso en la misma sesión.** `facturacion-bandeja.js:573` solo consulta el servidor si `cerrados` está vacío (`if (verCerrados && !cerrados.length)`), pero al marcar el último paso de un aviso la fila se mete en `cerrados` localmente (`:510`). Reproducido: Brenda marca una cotización de taller como facturada, prende la casilla y ve **"Hechos y no aplica (1)"** cuando en producción hay 45 (recorrido 11: `sep HECHOS Y NO APLICA (1)`; recorrido 15 D lo repite; el recorrido 16 en carga limpia sí trae la lista completa, captura 88). Justo el momento en que uno quiere comprobar "¿ya cerré esto?" es cuando la lista está mal. Arreglo: consultar siempre al prender la casilla (o guardar una bandera `cerradosDelServidor`). 15 min.

**R3. Un aviso "en espera" de un contrato DEMO que ya venció, con el correo en error desde el 7-sep.** Nada cierra un aviso cuando su contrato se anula o vence: los únicos que escriben `facturacion_avisos` son los que lo crean, `onMailQueued` y `onFacturacionAvisoWrite`. Hoy el chip "En espera 4" trae uno de un contrato `DEMO…` que está `vencido` (nunca va a entregarse) y otro `PROP…` cuyo correo a activaciones@ también quedó en `error` el 17-sep y nadie reenvió (la fila lo acusa con "El correo no salió", pero solo si alguien abre el chip "En espera"). Arreglo: en el trigger de anulación/vencimiento, descartar los avisos abiertos del contrato con motivo automático; y que el chip "En espera" lleve un punto rojo si alguno tiene el correo en error. 1-2 h.

---

## 1. Para quién es y qué hacen ahí

El espacio Finanzas son siete pestañas (`finanzas-nav.js`): **Bandeja** · **Comisiones** · **Catálogo** (Modelos, Piezas, Cargos) · **QuickBooks** · **Facturará la app** · **Emisión desde la app** · **Panorama**. Solo administrador y contabilidad ven la barra; recepción entra a la Bandeja por su propio módulo "Facturación pendiente" y no ve nada más (`modulos.js:51`, `facturacionAvisosService.ROLES`). Las reglas de Firestore respaldan eso exactamente: `facturacion_avisos` lo leen admin/recepción/contabilidad y nadie más; `comision` solo lo tocan admin/contabilidad (`firestore.rules:935-977`).

**Lo que de verdad se usa, con los datos de producción:**

| Pantalla | Quién la ha tocado (marcas en los documentos) | Estado real |
|---|---|---|
| Bandeja "Facturación pendiente" | **Solo cecrecep (Brenda)**: 15 marcas QBO y 12 Plataforma PoC, concentradas en **dos días** (4-sep: 14, 14-sep: 11) más una el 28 y una el 29. | 62 avisos desde que nació la colección el 4-sep: 45 hechos (31 de ellos sembrados como histórico, `fuente: 'siembra'`), 13 pendientes, 4 en espera. **De los 13 pendientes, 8 llevan más de 7 días** (26, 21, 19, 15, 15, 15, 13, 12 días). |
| Comisiones | **Nadie.** Cero pagos confirmados y cero cierres hechos por una persona desde que se desplegó el 10-sep (`historial` sin ninguna acción `comision_*`). Las 9 "pagadas" son el backfill del botón viejo (`fuente: 'marca_modulo_anterior'`, jul/ago). | 45 abiertas, todas "esperando"; 37 solo esperan el primer pago. 8 "no aplica". 0 sin vendedor. |
| Clientes ↔ QuickBooks | **Zuleika, el 25-sep**: 147 vínculos. Mediana de **1.5 segundos entre un vínculo y el siguiente**; 145 de 147 con menos de 60 s entre sí; todo cabe en un bloque de ~5 minutos. Alberto hizo 1 de prueba el 11-sep. | 148 clientes vinculados de 421 vivos. 145 de los 148 son nombre **idéntico** al Customer (los que la pantalla ya ponía en "Sugeridos" con un solo clic). **78 clientes con contrato vivo siguen sin vínculo** (77 tienen RUC). 1 Customer está vinculado a dos clientes. |
| Facturará la app (Activación) | **Nunca.** 0 de 315 contratos vivos tienen `facturacion_estado`; 0 `facturable: false`. | 100 "listos", 213 "pendientes" y **213 "sin mapeo QBO"**. Auto-activación apagada; alertas por correo apagadas (`alertas_off: true`). |
| Emisión desde la app | — | Página informativa: "La app todavía NO emite facturas". |
| Panorama | — | Dashboard comercial (cotizaciones aprobadas + contratos aprobados), no de facturas. Roto para contabilidad (R1). |
| Catálogo · Cargos | — | 7 cargos, todos con ítem QBO. |

**La "semana de Zuleika" del brief no aparece en los datos.** Los 147 vínculos tienen `qbo_vinculado_at` del 25-sep en un bloque de minutos. Si la semana existió, se fue en otra cosa (limpiar QuickBooks, buscar RUC) que el app no registra; en el app el trabajo fue un clic por cliente sobre una lista que ya venía sugerida. Lo que sí está pendiente son los **78 con contrato vivo sin Customer**, que por construcción son los que la pantalla **no** pudo sugerir (sin match por RUC ni por nombre exacto): ahí no hay lote que valga; hay que buscar o crear el Customer.

**Contabilidad (Cheila) no ha dejado una sola marca en el módulo.** Su home tiene dos tarjetas y cero señales (captura 90). Zuleika, con rol administrador, es quien hace el trabajo de "contabilidad" que los planes describen.

**Qué entra a la bandeja y cómo nace cada fila** (`functions/src/lib/facturacionAvisos.js:22-39`; la crea solo el servidor en el mismo embudo que encola el correo a activaciones@ con CC al vendedor asignado, `lib/gestiones.js:631-650`):

| Tipo | Lo dispara | Efecto | Pasos | Septiembre |
|---|---|---|---|---|
| `contrato_activo` | el contrato queda activo (`onApproval`); nace "en espera" si lleva equipo por entregar | arranca | QBO + Plataforma PoC | 33 |
| `renovacion_activa` | renovación activa | arranca | QBO + PoC | 18 |
| `contrato_entregado` | se entrega un contrato que no tenía aviso (`onEntregaFacturacion`; si lo tenía, lo **promueve** de "espera" a pendiente) | arranca | QBO + PoC | 1 |
| `cotizacion_servicio` | la orden con cotización de taller **se entrega** (`facturacionCotizacion.js:103`) | arranca (cobro único) | solo QBO, sin "facturar desde" | 6 |
| `aumento_entregado` / `regularizacion` / `ajuste_tarifa` | gestiones (`onGestionWrite`, `onOrdenWriteGestion`) | cambia | QBO (+PoC) | 2 + 2 |
| `baja_aprobada` / `terminacion_completada` | gestión de baja | termina | QBO | 0 |
| `venta_propio` | declarado, **nunca se emite** | — | — | 0 |

Un aviso sale de la bandeja cuando todos los pasos que aplican están marcados (`hecho`, lo deriva también el servidor) o con "No aplica…" + motivo de lista. El número de factura **no es obligatorio** al marcar QBO (decisión 2026-09-14: no trancar a recepción); si falta, la pastilla queda con "?" y se anota después. Hoy **39 de los 46 pasos QBO hechos no tienen número**: 30 son la siembra histórica (no se acusan) y **9 los marcó Brenda** (9 de sus 15 marcas QBO).

## 2. Recorrido real

### 2.1 Recepción (Brenda, escritorio): trabajar la bandeja

La bandeja carga en **1.6–2.4 s con 7–9 viajes** a Firestore; en tablet 2.0–3.1 s, en teléfono 1.7–3.0 s. Se pinta ordenada por antigüedad (lo más viejo arriba), con el efecto como única voz de color, el monto por fila y la edad en días (ámbar >3, rojo >7). Captura 71.

| Flujo | Interacciones | Tiempo | Qué vi |
|---|---|---|---|
| A. Cotización de taller (cobro único) | **3**: pastilla QBO → teclear N.° de factura → "Marcar facturada" | 0.8 s el guardado, 1.8 s total | El popover no pregunta "facturar desde" (correcto para un cobro único) y dice quién recibe el aviso: "solangel.hosang recibe el aviso de que ya quedó facturada". Toast "…: listo. Sale de la bandeja." Captura 72. |
| B. Contrato activo | **5**: pastilla QBO → N.° → "Marcar hecho" → pastilla PoC → "Marcar hecho" | 0.23 s + 0.85 s; 3.0 s total | "Facturar desde" viene prellenado con la fecha efectiva y ofrece la del contrato como alternativa. La auditoría del 28-sep contó 6; son 5 porque la fecha ya viene puesta. **Pero**: con la fila cerca del borde inferior el popover queda cortado por el viewport y el botón "Marcar hecho" cae justo donde aparece el toast (captura 73); hay que hacer scroll. |
| C. "No aplica…" | **4**: abrir fila → "No aplica…" → motivo (lista de 4) → "Marcar no aplica" | 0.8 s | El formulario sale en el pie del detalle; "Otro" exige nota. Captura 76. |
| D. Anotar el número en un QBO ya marcado sin número ("?") | **3**: pastilla con "?" → teclear → "Anotar" | 0.8 s | Era lo que el auditor anterior no logró ver escribir: **sí escribe** (`pasos.qbo.factura`, historial `qbo_factura`, toast "Factura 11004 anotada", el "?" desaparece; recorrido 16, captura 88). El fallo del recorrido 15 era del script (medía antes de que `listCerrados` pintara), no del app. |
| E. Deep-link `?aviso=<id>` desde el correo | 0 | 2.0 s | Abre la fila expandida; si el aviso está hecho prende "Ver hechos"; si está en espera cambia al chip "En espera". Funciona. |
| F. Ver hechos y no aplica | 1 | 0.2–0.6 s | En carga limpia trae los 45 (captura 88). Tras cerrar algo en la sesión muestra solo lo cerrado en la sesión (R2, captura 77/87). |
| G. Entrar a lo demás del espacio | — | — | `comisiones`, `activacion`, `clientes-qbo`, `emision`, `cargos`: un `<h3>` rojo "Acceso restringido" sin rail ni enlace de regreso (callejón sin salida, aunque Brenda no tiene cómo llegar ahí salvo por URL). `admin/financiero` rebota al home. |

**Tablet (1024×768):** popover cabe (x=554, ancho 300), fila expandida legible (captura 83-tablet). 39 de 45 objetivos táctiles miden menos de 36 px (las pastillas QBO/PoC son de 30 px). **Teléfono (390×844):** el popover sale **cortado por la izquierda** (x=−78: se pierden las etiquetas y el inicio de los campos, captura 82-telefono) y la barra superior ocupa 300 px con cuatro enlaces apilados (captura 81). Brenda trabaja en escritorio; esto importa solo si alguien factura desde el celular.

### 2.2 Gerencia (Zuleika, escritorio): Comisiones

Carga en 1.5–2.0 s, 7–8 viajes (lee la colección entera, 62 docs). Agrupa por vendedor, "sin vendedor" primero; cada fila dice el estado, qué requisito falta y por qué. Captura 12.

| Flujo | Interacciones | Tiempo | Qué vi |
|---|---|---|---|
| Confirmar el primer pago + cerrar el período, una por una | **7**: abrir fila → "Confirmar el primer pago" → N.° factura → Guardar → (la lista se recarga; abrir de nuevo) → "Cerrar el período" → Cerrar | 0.8 s + 0.8 s | El formulario de pago exige factura y fecha (prellenada en hora de Panamá); el saldo pendiente no libera. Toast "Pago confirmado — la comisión queda LISTA". Capturas 14, 15. |
| Cierre en lote | **4**: chip "Listas para pago" → "Seleccionar sus N" (por vendedor) → "Cerrar seleccionadas" → confirmar | 1.2 s para 2 | La confirmación dice cuántas, de cuántos vendedores, base total y período. P2 #8 del 28-sep **resuelto**. Capturas 16, 17, 18. |
| Reabrir | 2 | 0.4 s | Confirm con el período; queda en el rastro. |
| CSV | 1 | — | Exporta lo visible con BOM para Excel. |

En producción el chip "Listas para pago" está en **0** desde que existe la pantalla (las 2 que vi eran mías). El cuello de botella es el requisito "pago": nadie lo confirma a mano y la verificación automática (F4 del plan) no existe todavía.

### 2.3 Gerencia: Facturará la app (Activación), QuickBooks, Emisión, Catálogo, Panorama

| Pantalla | Carga | Qué vi |
|---|---|---|
| Activación | 1.8 s; 7 viajes (313 contratos en 442 ms + 123 modelos) | KPI: **0 activos · 100 listos · 213 pendientes · 213 sin mapeo QBO** (captura 20). "Facturará la app" → confirm con nombre y fecha (captura 22) → `gestionarFacturacion` falla: toast **"Error: internal"** y nada más (captura 23): no dice qué hacer. "Confirmar entrega" ya es un modal con date picker (P0 #25 **resuelto**, captura 24). "No facturable" es un solo modal con motivo. El toggle de auto-activación confirma y revierte al cancelar (captura 25). Pendientes pinta las 213 filas de una (alto 6,836 px, 409 botones); el enlace "Mapeo" manda al catálogo sin decir cuál modelo falta. En "Listos" la "Fecha sugerida" es hoy para casi todos (no hay `fecha_entrega_ultima`). |
| Clientes ↔ QuickBooks | 1.8 s + callable | Con QuickBooks caído: "Cargando…", contadores en 0, "Consultando QuickBooks…" **para siempre** y un toast "Error al iniciar" que se va (captura 30). Los 148 vinculados viven en Firestore y no se muestran. "Recargar QBO" responde "No se pudo recargar". No hay reintento ni explicación. En código, lo del 28-sep está hecho: regla 1 a 1 con revalidación en Firestore, confirm con nombres lado a lado solo cuando hay riesgo, combo con búsqueda en "Sin match", rastro `qbo_vinculado_por/at`, apóstrofe arreglado (`clientes-qbo.js:140-297`). |
| Emisión | 1.3 s | Página honesta ("La app todavía NO emite facturas") con la hoja de ruta F1–F6 (captura 40). Ya no dice "pestaña Activación" (P0 #26, **resuelto**), pero sigue hablando de "qboPost", "idempotencia", "previewFacturacion", "cron" (4.8 #7 **vigente**). |
| Catálogo · Cargos | 1.9 s | Hoja editable con autoguardado por celda; con QBO caído dice "No se pudo cargar la lista de QuickBooks (se conserva el ID guardado)" y cada select muestra "ID 73 (QBO no disponible)": **honesto**. Defecto visual: el buscador de la página se dibuja encima del botón global "Buscar Ctrl K" en la barra superior (captura 50; igual en Modelos, captura 55). |
| Catálogo · Modelos | 1.8 s | "Salud del catálogo: 10 refurbished que se alquilan sin ítem de QuickBooks · 15 sin precio de alquiler · …". 12 de 123 modelos tienen tarifa y mapeo. Captura 55. |
| Panorama | 2.2 s; 11 viajes (contratos ×2, cotizaciones 1,000) | Banner que admite "NO son facturas emitidas"; aun así los KPI se llaman **"Facturado del mes"** e **"ITBMS recaudado"** (captura 60). El "ITBMS recaudado" sube "1384.9 % vs mes anterior" porque compara dos meses casi vacíos. |

### 2.4 Contabilidad (Cheila) y Admin (Alberto)

Cheila: home con dos tarjetas y cero señales (captura 90); entra a todas las pestañas de Finanzas y al archivo de contratos (captura 91, con las columnas de total); Centro de gestión le dice "Acceso restringido"; Panorama le revienta (R1). Alberto: "Ver como contabilidad" existe y funciona (captura 96; el 28-sep decía que faltaba: **resuelto**).

### 2.5 Estado de lo que dijo la auditoría del 28-sep (§4.8)

| # | Qué | Estado hoy |
|---|---|---|
| 1 | Date picker en "Confirmar entrega"; un solo modal en "No facturable"; confirmar "Activar" con nombre | **Resuelto** (capturas 22, 24) |
| 2 | Fechas en hora de Panamá | **Resuelto** (`FMT.hoyISOPanama` en activación y comisiones) |
| 3 | Portada de Finanzas = Bandeja | **Resuelto** (`index.html` redirige) |
| 4 | QBO: regla 1 a 1, apóstrofe, combo con búsqueda | **Resuelto en código**; no se pudo ejercitar sin la callable |
| 5 | `orderBy` en `listCerrados` | **Resuelto** (pagina por `updated_at`; los 45 cerrados lo tienen) |
| 6 | Terminología: "No aplica" único, "Plataforma PoC", "Deja de cobrarse el", un solo conteo | **Resuelto** |
| 7 | Emisión sin jerga | **Parcial**: el texto falso se corrigió; la jerga sigue |
| 8 | Cierre de comisiones en lote + CSV | **Resuelto** |
| 9 | "No devueltos" desde Finanzas; móvil de Activación/QBO; actualizar `FACTURACION_COMO_FUNCIONA.md` | **Vigente** (el doc ganó un §13 pero conserva el modelo viejo; ver §3.2) |
| P0 #25 | "Confirmar entrega" fallaba en silencio | **Resuelto** |
| P0 #26 | "pestaña Activación" que no existe | **Resuelto** |

## 3. Hallazgos

### 3.1 Roto

- **R1, R2, R3** (arriba).
- **"Error: internal" como único mensaje cuando una callable falla** (`facturacion-activacion.js:332`, `clientes-qbo.js:35`). En producción pasa cuando el token de Intuit expira (~100 días, nadie lo vigila: `SISTEMA_TOP_DOWN.md` §5.3) o la función se cae. La persona no sabe si reintentar, esperar o avisar. Capturas 23 y 30.
- **Los avisos no se enteran de que el contrato murió** (R3) ni de que el correo falló: `correo.status === 'error'` solo se ve en la línea 2 de la fila; el chip no lo cuenta. Hoy 2 de 62.
- **Popover cortado**: abajo en escritorio (captura 73) y a la izquierda en teléfono (captura 82-telefono). el popover se ancla a la pastilla sin mirar dónde queda respecto al viewport.

### 3.2 Confuso

- **Tres de siete pestañas son para un futuro que no ha llegado.** "Facturará la app" (0 activados en 3 meses, 213 sin mapeo), "Emisión desde la app" (placeholder) y "Panorama" (números comerciales con nombre de factura) ocupan el 43 % de la barra que ven Zuleika y Cheila todos los días. La pestaña que se usa, la Bandeja, y la que debería usarse, Comisiones, compiten con tres que hoy no hacen nada.
- **"213 sin mapeo QBO" es un dato de catálogo, no 213 problemas.** Las líneas de contratos vivos con modelo sin mapeo son, en orden: `PNC360S-R` 117, `PNC460-R` 36, "no aplica" 26, `PNC460` 17, `PNC370-R` 9, `PD606-R` 6, "consola" 5. Los modelos refurbished ("-R") no tienen tarifa ni ítem (el propio catálogo lo acusa: "10 refurbished que se alquilan sin ítem"). Con **cinco modelos** mapeados, la mayoría de los 213 pasa a "Listos". Y las 26 líneas "no aplica" + 5 "consola" + 2 "activacion" son cargos escritos como equipo en contratos viejos: nunca van a mapear.
- **El número de factura es opcional y el sistema depende de él.** La verificación automática del pago (F4), el correo al taller ("ya quedó facturada, factura N°…") y la trazabilidad contra QuickBooks necesitan el `DocNumber`. Hoy 9 de los 15 pasos QBO que marcó Brenda no lo traen y el "?" ámbar es el único recordatorio. En Comisiones, 37 filas esperan un pago que nadie confirma: sin número no hay con qué buscarlo cuando llegue la F4.
- **"Facturado del mes" no es facturado.** El banner del Panorama lo aclara, pero el KPI grande dice lo contrario; un contador que lo lea de reojo se lo cree. Y "ITBMS recaudado +1384.9 %" compara con un mes de dos cotizaciones.
- **Comisiones muestra a Alberto como vendedor de 2 eventos** (base de centavos) porque `vendedorDeComision` toma `creado_por_uid` del contrato; y un contrato DEMO con mensual $0 tiene fila de comisión "esperando". Son decisiones de datos, no bugs, pero ensucian la lista que Zuleika tendría que pagar.
- **Catálogo · Modelos y Cargos: dos buscadores encimados** en la barra superior (capturas 50, 55).
- **Acceso restringido = `<h3>` rojo sin salida** en cinco páginas. Recepción solo llega por URL, pero el patrón se repite en todo el espacio.

### 3.3 Lento

Nada del módulo es lento para quien lo usa: todas las páginas cargan en menos de 2.5 s con 6–11 viajes y pintan desde la sesión cacheada (`Sesion.miPerfil`, `Sesion.memo`). Lo lento es **el proceso**: 8 de 13 pendientes llevan más de una semana; una cotización de taller lleva 26 días sin factura mientras Solangel espera el correo que solo sale cuando Brenda marca el paso con número. Si Brenda factura en QuickBooks sin pasar por la bandeja, el "26 d" es falso y el correo al taller nunca sale; si no factura, hay dinero sin cobrar. Las dos opciones son malas y el app no distingue cuál es.

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| P1 | **Arreglos de R1 y R2**: `contabilidad` en `allow list` de cotizaciones (o esconderle Panorama); consultar siempre al prender "Ver hechos". | Dos pantallas que mienten o fallan. | Un error críptico menos; lista de cerrados correcta. | 45 min | Ninguno (R1 solo amplía lectura a un rol que ya ve totales en contratos). |
| P2 | **Cerrar avisos huérfanos y acusar correos en error**: al anular/vencer un contrato, descartar sus avisos abiertos (motivo automático "contrato anulado/vencido"); el chip "En espera" con punto rojo si hay correo en error; botón "Reenviar" visible sin abrir la fila. | R3: una cola que no se vacía sola deja de ser una cola. | Los 4 "en espera" pasan a 2 reales; nadie tiene que abrir cada fila para ver que el correo no salió. | 2 h | Bajo: `descartar` ya existe y deja rastro. |
| P3 | **Mapear los cinco modelos "-R"** (PNC360S-R, PNC460-R, PNC370-R, PD606-R, S200-R) con tarifa e ítem/bundle en Catálogo · Modelos. No es código: son datos. Y en Activación, que el enlace "Mapeo" lleve al modelo que falta (`modelos.html?q=PNC360S-R`). | "213 sin mapeo" es la señal más gorda de la pantalla y la causa está en 5 filas del catálogo. | "Listos" sube de 100 a ~200; la Activación empieza a decir algo verdadero. | 1 h de Zuleika/Cheila + 30 min de código | Hay que decidir si el refurbished cobra la misma tarifa que el nuevo (pregunta 5). |
| P4 | **Callables caídas con cara**: en QBO, Activación, Cargos y Modelos un bloque de estado "QuickBooks no respondió (motivo) · Última lectura buena · Reintentar", y en QBO mostrar siempre los Vinculados desde Firestore aunque la lista de Customers no llegue. Maqueta: `maquetas/facturacion-qbo-lote-y-error.html` §1 y §3. | "Error: internal" y "Consultando QuickBooks…" eterno no dicen qué hacer. El token de Intuit va a expirar algún día. | Cero llamadas a Alberto por "la pantalla está en blanco". | 3 h | Ninguno. |
| P5 | **El número de factura cierra el círculo**: (a) al marcar QBO, si el número va vacío, pedir confirmación "¿Marcar sin número? Se puede anotar después" en vez de dejarlo pasar en silencio; (b) chip "Sin número (N)" en la bandeja con filtro; (c) en Comisiones, que "Confirmar el primer pago" ofrezca el número que ya está en `pasos.qbo.factura` del mismo aviso en vez de pedirlo de nuevo. | 39 de 46 QBO hechos sin número (9 de 15 marcados por una persona); F4 depende de él; el correo al taller no sale sin él. | Los "?" dejan de acumularse; un campo menos al confirmar pagos. | 4 h | Ninguno: no se vuelve obligatorio (decisión del 14-sep), solo deja de ser invisible. |
| P6 | **Finanzas por lo que existe**: barra con Bandeja · Comisiones · Catálogo · QuickBooks; "Facturará la app", "Emisión" y "Panorama" bajo una pestaña "Próximamente" (o solo admin) hasta que exista F1–F3; Panorama renombra sus KPI ("Ventas aprobadas del mes", "ITBMS de lo aprobado") y quita el delta porcentual cuando el mes anterior tiene menos de 5 transacciones. | Lo que se usa compite con lo que no funciona. Un KPI que se llama "Facturado" sin facturas va a terminar en una decisión equivocada. | Cheila y Zuleika aterrizan siempre en algo que sirve. | 3 h | Alberto puede querer la Activación visible para ir mapeando (pregunta 2). |
| P7 | **Popover que se acomoda** (flip arriba si no cabe abajo; en teléfono, hoja inferior a ancho completo) y pastillas de 36 px en tablet. | Captura 73 y 82-telefono. | Sin scroll a ciegas; sin botón tapado por el toast. | 3 h | Ninguno. |
| P8 | **Señales en el home** para quien supervisa: "Facturación pendiente: N con más de 7 días" (admin, contabilidad, recepción) y "Comisiones listas para pago: N" (admin/contabilidad). Hoy contabilidad tiene cero señales y recepción ve la bandeja solo si entra. | La bandeja envejece porque nadie la ve envejecer. | Los "26 d" dejan de existir o se vuelven una decisión consciente. | 4 h (`home-signals.js` ya tiene el patrón) | Ninguno. |
| P9 | **Comisiones con dueño real**: decidir quién confirma el primer pago (pregunta 4). Si es Zuleika con el estado de cuenta de QBO, un formulario "pegar números de factura pagadas" que marque en lote (usa `pasos.qbo.factura` para parear). Si es automático, construir F4 (`select * from Invoice where DocNumber in (...)`, lectura, ya hay OAuth vivo). | 45 comisiones esperando, 0 movimientos en 20 días. La pantalla está bien hecha y no se usa porque el dato que la mueve no entra. | De 7 interacciones por comisión a un pegado por quincena; o cero. | 1 día (lote manual) / 1 semana (F4) | F4 depende de que los avisos traigan número (P5) y de que el Customer esté vinculado (148 sí, 78 no). |
| P10 | **Crear el Customer en QuickBooks desde el app** para los 78 clientes con contrato vivo sin vínculo (F3 del plan: `qboPost` + sync cliente→Customer con RUC). Hasta entonces, en la vista "Sin match" un botón "Copiar nombre + RUC" para pegarlo en QBO y "Recargar". | Los 78 son justo los que la pantalla no puede sugerir; hoy el camino es salir del app, crear la cuenta en QBO, volver, recargar, buscar en el combo. | De ~8 pasos y dos sistemas a 1 clic. | 1-2 semanas (es la primera escritura hacia QBO; arrastra F1) / 1 h el botón de copiar | Es la primera escritura a QBO: necesita idempotencia y sandbox primero. |
| P11 | **La ficha del cliente (Centro) sabe de facturación**: chip "QuickBooks: vinculado a X / sin vincular" y "N avisos de facturación abiertos" con enlace a la bandeja filtrada. Hoy `clientes-centro.js` no menciona ni `qbo_customer_id` ni `facturacion_avisos`. | Alberto vive en el Centro; la bandeja y el QBO viven en otro módulo. | Una pregunta frecuente ("¿este cliente ya está en QBO?") contestada sin cambiar de pantalla. | 1 día | Need-to-know: el chip no muestra montos, solo estado; para vendedor/recepción se puede esconder el nombre del Customer. |

**Qué no propongo:** vincular clientes "en lote" (la propuesta P2 de la maqueta del auditor anterior). Los datos dicen que los sugeridos ya se vincularon de un clic cada uno en cinco minutos; lo que queda son los difíciles. La maqueta sigue valiendo por sus secciones 1 (estado de error) y 3 (Customer repetido).

## 5. Cómo saber si funcionó

| Medida | Hoy | Meta | De dónde sale |
|---|---|---|---|
| Avisos pendientes con más de 7 días | 8 de 13 | 0–1 | `facturacion_avisos` (`fecha_efectiva`, `estado`) — censo `00-censo.js` / `04-censo-cerrados.js` |
| Días entre `fecha_efectiva` y la marca QBO (mediana) | no medible (marcas en 2 días) | < 3 | `pasos.qbo.at − fecha_efectiva` |
| Pasos QBO marcados por persona sin número | 9 de 15 | 0 | `pasos.qbo.factura` nulo con `fuente ≠ siembra` |
| Avisos abiertos con correo en error | 2 | 0 | `correo.status` |
| Comisiones con pago confirmado por una persona o por F4 | 0 | ≥ 80 % de las "listas" en el mes | `comision.requisitos.pago.fuente` |
| Clientes con contrato vivo sin Customer | 78 | < 10 | `03-pareo-qbo.js` |
| Contratos "sin mapeo QBO" en Activación | 213 | < 60 | KPI de `activacion.html` |
| Errores de reglas en Panorama para contabilidad | 1 por visita | 0 | consola / `s.errores` |
| Vistas por pantalla y usuario | contaminado hoy | Bandeja diaria por cecrecep; Comisiones quincenal | `uso_diario` (desde mañana, sin auditores) |

## 6. Contraste con `docs/FACTURACION_COMO_FUNCIONA.md`

El documento (2026-06-24 + §13 del 28-sep) describe bien la intención y mal la realidad. Qué corregir, en orden de daño:

1. **§8 y glosario: "sub-cliente para el contrato"** es el modelo v3. Desde el 2026-07-01 (plan v4/v5, `SISTEMA_TOP_DOWN.md` §5.1) es **una factura por cliente con líneas agrupadas por contrato** y `Class` para el reporte. Borrar "Sub-customer / Job … representa el contrato".
2. **§13 debería ir primero.** Es lo único que se usa. El orden actual (catálogos → match → activación → cálculo → emisión → …bandeja) cuenta la historia de un facturador que no existe antes que la del trabajo diario.
3. **§5 "La activación es manual (contabilidad confirma)"** → nunca se ha activado un contrato (0 de 315). Y "recepción/contabilidad puede confirmar la entrega a mano desde la misma página" es falso para recepción: no entra a `activacion.html`. La entrega la confirman las órdenes (`onOrdenEntregada`) y, a mano, admin/contabilidad.
4. **§4 "contabilidad confirma"** el match → lo hizo gerencia (Zuleika) en una sesión; quedan 78 con contrato vivo sin vínculo; la regla 1 a 1 se valida al vincular desde el 28-sep y hay un Customer repetido anterior a eso.
5. **§9 "Quién hace qué"**: recepción no "confirma entregas y captura seriales" en este módulo: **trabaja la bandeja** (QBO + Plataforma PoC) y anota números de factura. Contabilidad, en la práctica, no ha tocado el módulo.
6. **§11 tabla de estado**: agregar "Bandeja ✅ en uso (desde 4-sep)", "Comisiones ✅ construida, sin uso", "Activación ✅ construida, 0 activados", "Match ✅ 148 vinculados / 78 pendientes con contrato vivo", "Alertas ⏸ apagadas".
7. **§13**: "trae los 200 cerrados más recientes" vale solo en carga limpia (R2); falta decir que el número de factura se puede **anotar después** (desde el 14-sep), que una cotización de taller **no pide "facturar desde"** y que al marcarla con número **el taller recibe un correo** (`onCotizacionFacturada`).
8. **§3**: ya no hay "hub de Facturación"; es la pestaña Catálogo (Modelos · Piezas · Cargos). "Importar desde QuickBooks y proponer el mapeo automáticamente" no lo verifiqué en el navegador (la callable no corre aquí); el catálogo que vi se mapea a mano y acusa 10 refurbished sin ítem.
9. **§7**: las alertas siguen apagadas (`alertas_off: true`); decirlo con fecha.

## Top 5 impacto/esfuerzo del módulo

1. **P3 · Mapear los 5 modelos refurbished** — "sin mapeo" 213 → ~60 y Activación empieza a ser verdad; 1 h de datos + 30 min de código.
2. **P1 + P2 · Arreglar Panorama para contabilidad, "Ver hechos" y los avisos huérfanos/correos en error** — tres cosas rotas por menos de 3 h.
3. **P5 · El número de factura visible y reutilizado** (confirmar al marcar sin número, chip "Sin número", Comisiones lo toma del aviso) — destranca F4 y el correo al taller; 4 h.
4. **P8 · Señal en el home "N avisos con más de 7 días" y "N comisiones listas"** — la bandeja deja de envejecer sin que nadie lo vea; 4 h.
5. **P6 · Finanzas por lo que existe** (esconder Facturará la app / Emisión / Panorama, o "Próximamente"; renombrar KPI) — 3 h; quita tres pestañas que hoy confunden o fallan.

## Preguntas para Alberto

1. **¿Brenda factura en QuickBooks sin marcar la bandeja, o la factura de verdad sale tarde?** Las marcas se concentran en dos días (4 y 14-sep) y hoy hay 8 avisos con más de una semana, una cotización de taller con 26 días. (a) Si factura y no marca: la bandeja es un registro, no una cola; conviene que el "26 d" no se pinte en rojo, que Solangel reciba su correo de otra forma y que la F4 (leer QBO) sea la que marque el paso sola. (b) Si no factura hasta que mira la bandeja: hace falta la señal del home (P8) y una rutina diaria. Las dos requieren cosas distintas.
2. **¿Mantienes visibles "Facturará la app", "Emisión" y "Panorama" mientras no hay emisión?** (a) Esconderlas (o "Próximamente") para contabilidad y dejarlas a admin: la barra queda en lo que se usa. (b) Dejarlas, para que Zuleika vaya mapeando y confirmando entregas desde Activación: entonces hay que arreglar R1 y renombrar los KPI del Panorama.
3. **Los 78 clientes con contrato vivo sin Customer en QuickBooks: ¿quién los crea y dónde?** (a) A mano en QBO y luego vincular en el app (hoy: salir, crear, volver, recargar, buscar): cero código, 78 idas y vueltas. (b) Desde el app (F3: `qboPost` + sync con RUC): 1-2 semanas y la primera escritura hacia QBO, con sandbox antes.
4. **¿Quién confirma el "primer pago" de las comisiones?** 45 esperan, 0 confirmadas en 20 días. (a) Zuleika con el estado de cuenta, en lote (P9, 1 día). (b) Automático leyendo QBO por `DocNumber` (F4, 1 semana) — exige que los avisos traigan número (hoy falta en 39 de 46) y Customer vinculado. (c) Las dos: lote hoy, F4 después.
5. **¿El refurbished ("-R") cobra la misma mensualidad que el modelo nuevo y comparte el bundle "Mensualidad - <modelo>" en QBO?** Decide cómo se mapean PNC360S-R y compañía (P3). Si es la misma tarifa, es copiar 5 filas; si no, hay que crear bundles en QBO a mano.
6. **El Customer de QuickBooks que está vinculado a dos clientes del app: ¿son dos sedes del mismo cliente o un duplicado?** Si son sedes, hay que decidir si la factura consolidada va a una sola cuenta (modelo v5) o si se mantienen dos clientes en el app; si es duplicado, se consolida en el app.
7. **¿Un contrato DEMO o TEMP debe generar aviso de facturación y fila de comisión?** Hoy un DEMO (mensual $0) tiene fila "esperando" en Comisiones y su aviso sigue "en espera" aunque el contrato venció; hay 4 avisos de contratos TEMP. (a) No entran (filtro por tipo al crear el aviso). (b) Entran a la bandeja (hay que activar en la Plataforma PoC) pero no a comisiones (`aplica: false` con motivo).
