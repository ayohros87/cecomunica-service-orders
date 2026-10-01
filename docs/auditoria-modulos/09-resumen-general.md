# Auditoría de módulos 2026-09-30 · Resumen general

> **Qué es esto.** El cierre de la investigación pedida en `docs/plans/BRIEF_AGENTE_MEJORA_MODULOS.md`.
> Ocho auditores (agentes de IA) recorrieron el app **funcionando**, con sesión real de cada rol, contra
> los emuladores de Firebase sembrados con una copia de solo lectura de producción tomada el 30 de
> septiembre (60,436 documentos). Hicieron los flujos, contaron interacciones, midieron tiempos, tomaron
> 522 capturas (escritorio, tablet y teléfono) y cruzaron lo visto con el código, los audit logs y las
> auditorías anteriores. Nada se escribió en producción y no se tocó código del app.
>
> **Informes por módulo** (cada uno con recorrido, hallazgos, propuestas, métricas, Top 5 y preguntas):
> [01 Órdenes](01-ordenes.md) · [02 Cotizaciones](02-cotizaciones.md) · [03 PoC](03-poc.md) ·
> [04 Almacén](04-almacen.md) · [05 Centro y Clientes](05-centro-clientes.md) · [06 Contratos](06-contratos.md) ·
> [07 Facturación](07-facturacion.md) · [08 Home, navegación y admin](08-home-navegacion-admin.md).
> Método y harness: [00-metodo.md](00-metodo.md). Maquetas en `maquetas/`, scripts reproducibles en
> `scripts/`, capturas en `capturas/` (fuera de git: llevan datos de clientes).

---

## A. ROTO HOY: atender antes que cualquier mejora

Lo que está produciendo **dato falso, acción indebida o trabajo perdido** en este momento. Cada punto está
reproducido en el emulador y tiene su evidencia (`archivo:línea`, captura, conteo) en el informe del módulo.
Ordenado por gravedad; el costo de arreglo es estimado.

| # | Qué pasa hoy | A quién le pega | Dónde | Costo |
|---|---|---|---|---|
| 1 | **El QR impreso de los contratos certifica "válido y vigente" contratos anulados y vencidos.** `verificaciones.estado` solo se actualiza al cambiar de estado y solo desde el 28-sep; 192 de 513 están desfasados (89 de 92 anulados). | Clientes y terceros que escanean el QR | [06 R1](06-contratos.md#roto-hoy-atender-primero) | 2-3 h (backfill + cuadre semanal) |
| 2 | **Recepción y ventas pueden registrar la venta de un radio de bodega desde Almacén.** El guard solo tapa el cuerpo; la topbar funciona y las rules lo permiten. Probado: "1 equipo(s) registrados como vendidos". | Bodega, inventario, contabilidad | [04 R1](04-almacen.md#roto-hoy) | 2 h |
| 3 | **El app deja poner un SIM que ya está activo en otro radio, sin avisar**, en la acción más frecuente del módulo PoC (293 cambios/mes). Hoy 41 SIMs están activos en más de un radio; 444 viven en más de una ficha. | Recepción, activaciones, airtime | [03 R2](03-poc.md#roto-hoy) | 1 d |
| 4 | **Las señales del home mandan a una bandeja que muestra una fracción de lo anunciado**: "En taller 19" abre 6; "Completadas 84" abre 4; "Por asignar 42" abre 6. El filtro de URL se aplica sobre las 40 órdenes más recientes. Y "Abrir orden" desde "Órdenes sin movimiento" (y el resultado de orden en Ctrl+K) rebota a una lista vacía para toda orden fuera de las 50 recientes. | Jefa de taller, admin, técnicos, recepción | [01 R2](01-ordenes.md#roto-hoy), [08 R2](08-home-navegacion-admin.md#roto-hoy) | 2-3 h |
| 5 | **La fecha de las órdenes sale en UTC**: una orden creada después de las 7 p. m. se ve con la fecha del día siguiente en la bandeja, la tarjeta del técnico y la orden impresa. 158 de 529 fechas de entrega corridas. | Todos; el documento que firma el cliente | [01 R3](01-ordenes.md#roto-hoy) | 1-2 h |
| 6 | **"Ver entrega" dice "Recibido por —" en toda entrega con firma en papel** (38 en 30 días): la rama de papel guarda en un campo y el modal lee otro. | Recepción, cualquiera que revise una entrega | [01 R1](01-ordenes.md#roto-hoy) | 1 h |
| 7 | **En el teléfono, el toast "Intervención guardada" tapa el botón Guardar ~4 s**; el toque siguiente cierra el modal **sin guardar** y el texto se pierde en silencio. Reproducido 5 veces. | Técnicos | [01 R4](01-ordenes.md#roto-hoy) | 1-2 h |
| 8 | **Eliminar una cotización enviada deja el enlace del cliente vivo y "Vigente"** con el panel "¿Aceptas?"; si acepta, la respuesta se pierde. Tres casos en producción. | Clientes, ventas | [02 R1](02-cotizaciones.md#roto-hoy) | 30 min |
| 9 | **"Preparar lote (Ventas)" muestra a la vendedora 8 de 421 clientes** (lo que había en caché) y la guarda 6 horas; si el cliente no está, el lote sale sin `cliente_id` y recepción no puede autocompletar. | Ventas, recepción | [03 R1](03-poc.md#roto-hoy) | 2-3 h |
| 10 | **"Regularizar con contrato nuevo" es el botón primario de la ficha para 249 de 457 clientes**, aunque la deuda sea de bodega (por clasificar). Abre la renovación consolidadora: en una cuenta de 16 contratos, un modal de 18,956 px con 273 filas. | Dueño, vendedoras | [05 R3](05-centro-clientes.md#roto-hoy-atender-primero) | 2-3 h + decisión |
| 11 | **Buscar un RUC con guiones (como está en el documento) no encuentra nada**, ni palabras con guion. La persona concluye "no existe" y lo crea de nuevo. | Cobros, recepción, ventas | [05 R1](05-centro-clientes.md#roto-hoy-atender-primero) | 2-3 h |
| 12 | **El panel admin dice "Contratos pendientes: 49". Son 0** (los 49 están borrados; el KPI no filtra `deleted`). | Dueño | [08 R1](08-home-navegacion-admin.md#roto-hoy) | 20 min |
| 13 | **La base PoC dice que un mismo radio está con dos o tres clientes a la vez**: 566 seriales con más de una ficha viva; la herramienta de duplicados vuelca 1,453 filas sueltas y al cerrar una vuelve a la página 1. | Recepción, reemplazos, airtime | [03 R3](03-poc.md#roto-hoy) | 2-3 d |
| 14 | **El detalle de la cotización miente sobre quién la rechazó, por qué se descartó y quién la aprobó** ("el cliente declinó" cuando fue el aprobador). Siete campos que no se copian a la vista. | Ventas, aprobadores | [02 R2](02-cotizaciones.md#roto-hoy) | 20 min |
| 15 | **"Recibir equipos" no se cierra tras recibir** (215 veces/mes): la hoja queda abierta con los mismos seriales. | Bodega | [04 R3](04-almacen.md#roto-hoy) | 30 min |
| 16 | **Los KPI de Existencias le dicen a bodega "151 por inspeccionar" (147 están en una ENTRADA del taller) y "34 modelos con diferencia" (todos de julio).** La pestaña Hoy dice otra cosa con el mismo dato. | Bodega | [04 R2](04-almacen.md#roto-hoy) | ½ d |
| 17 | **El "historial inmutable" de la ficha del cliente registra cambios que nadie hizo**: más de la mitad de las 803 entradas de 30 días son relleno de campos vacíos. | Quien audite una ficha | [05 R2](05-centro-clientes.md#roto-hoy-atender-primero) | 1-2 h |
| 18 | **El Panorama de Finanzas le falla a contabilidad** con un error crudo de reglas (`list` de cotizaciones no incluye el rol). | Contabilidad | [07 R1](07-facturacion.md#roto-hoy) | 30 min |
| 19 | **"Ver hechos y no aplica" muestra 1 en vez de 45** después de cerrar un aviso en la misma sesión. | Recepción | [07 R2](07-facturacion.md#roto-hoy) | 30 min |
| 20 | **Avisos de facturación huérfanos**: un DEMO vencido sigue "en espera" con correo en error desde el 7-sep; nada cierra un aviso cuando el contrato muere. | Facturación | [07 R3](07-facturacion.md#roto-hoy) | 1-2 h |
| 21 | **El archivo dice "Firmado en tablet" en contratos firmados por enlace** (no existe firma de contrato en tablet), y **"Devolución pendiente" muestra 1 cuando hay 14** (filtra sobre las 40 filas cargadas). | Admin, ventas | [06 R2, R3](06-contratos.md#roto-hoy-atender-primero) | 2 h |
| 22 | **En teléfono, el Conteo físico no muestra la columna de cantidad** (no se puede contar). | Bodega, si cuenta desde el teléfono | [04 R4](04-almacen.md#roto-hoy) | 2 h |

Todo lo de esta tabla junto cabe en **tres o cuatro días de trabajo**; los puntos 1, 2, 4, 5, 6, 8, 12, 14, 15, 18
y 19 son de menos de tres horas cada uno.

---

## B. Los 10 cambios con mejor relación impacto/esfuerzo de todo el app

Elegidos entre los Top 5 de los ocho informes, con dos criterios: cuánta gente y cuántas veces al mes lo
sufre, y cuánto cuesta hacerlo. Los primeros cinco se pagan solos la primera semana.

| # | Cambio | Qué ahorra | Costo | Riesgo | Informe |
|---|---|---|---|---|---|
| 1 | **Señales del home y buscador aterrizan en lo que anuncian** (consulta al servidor con los ids, no filtro local de las 40 recientes) | Fin de "19 → 6"; las 13 órdenes estancadas y toda orden vieja vuelven a abrirse; 3 pantallas y un toast menos por búsqueda | 2-3 h | Bajo | 01 P2b, 08 P2 |
| 2 | **Validar la SIM en los cuatro caminos** (cajón, masiva, pool, lote) y ofrecer "mover" | Corta el dato falso más frecuente del sistema: 293 cambios/mes, 41 cruces hoy | 1 d | Medio (decidir si un SIM puede vivir en dos radios: pregunta Q3-1) | 03 P2 |
| 3 | **Asignar seriales: verificar solo lo que no se escaneó a mano** | −25 escaneos por contrato de 25, −50 por uno de 50 (hoy cada serial se escanea dos veces; sin lector, ~500 teclas) | 1 d | Bajo | 04 P7 |
| 4 | **Editar equipos de la orden: Enter = fila nueva, lápiz visible, columnas que no corten el estado** | La acción más repetida del app (631/mes) deja de costar 2 cargas de página y de tener su botón con `opacity: 0`; el escáner sirve | 5-6 h | Bajo | 01 P4-P6 |
| 5 | **Backfill y cuadre de `verificaciones.estado`** | El QR deja de certificar 192 contratos muertos | 2-3 h | Bajo | 06 Top 1 |
| 6 | **Toast fuera de la zona de acción** (teléfono del técnico, Asignar de bodega) + "Ver entrega" en papel | Cero intervenciones perdidas; 4-5 s menos por asignación; 38 entregas/mes dejan de decir "—" | 3-4 h | Bajo | 01 P1, P3; 06 Top 4 |
| 7 | **Búsqueda de clientes tolerante** (RUC con guiones, palabras con guion, prefijos) | Menos duplicados de clientes; cobros deja de concluir "no existe" | 2-3 h | Bajo | 05 P1 |
| 8 | **Topbar de Almacén por rol + toasts de permiso legibles + Recibir se cierra** | Cierra la venta por recepción/ventas; 215 hojas/mes que ya no quedan abiertas | 2-3 h | Bajo | 04 P1, P2 |
| 9 | **Franja de contexto con enlaces cruzados** (orden ↔ cliente ↔ contrato ↔ serial) y el pool en Ctrl+K | Cada salto entre módulos pasa de "volver al home y teclear" a un clic; bodega encuentra un radio en 1 s | 2-3 d | Bajo | 08 P8, P5 |
| 10 | **Mapear los 5 modelos refurbished y mostrar/usar el número de factura en los avisos** | "213 sin mapeo" → ~60; destranca comisiones (39 de 46 pasos sin número) | 1 d | Bajo (decisión Q7-5) | 07 P3, P5 |

Fuera del top por costo pero con el mayor efecto de fondo: **selectores de seriales con buscador y
grupos** en los cuatro wizards del Centro (273 filas → 4 caracteres; 1-2 d, [05 P4](05-centro-clientes.md)),
**duplicados PoC agrupados con la verdad del pool** (1,453 fichas sobrantes cerradas en una tarde; 2-3 d,
[03 P6](03-poc.md)) y **"le toca a" en la fila de la bandeja de órdenes** (2-3 d, [01 P12](01-ordenes.md)).

---

## C. Problemas transversales (lo que se repite en varios módulos)

1. **Números que mienten porque se filtra en el navegador sobre lo que ya se cargó.** Señales del home →
   bandeja de 40 (Órdenes); "Devolución pendiente" 1 de 14 (Contratos); "Ver hechos" 1 de 45 (Facturación);
   "Contratos pendientes 49" con borrados (Admin); tarjetas y segmentos con cifras distintas en la misma
   pantalla (Cotizaciones); "0 inactivos" con 207 (Clientes); KPI de Existencias con lo que no es trabajo
   de bodega. Es la **misma falla** que la auditoría del 28-sep llamó "números que mienten", en otros lugares.
   **Regla propuesta:** todo conteo que se muestre sale del servidor (`count()`), y todo filtro que llegue por
   URL consulta, nunca recorta la primera página.
2. **Espejos y estados derivados que nadie cuadra.** `verificaciones.estado` (contratos), `cotizacion_verificaciones`
   al eliminar, `activo:true` en fichas PoC cerradas, avisos de facturación de contratos muertos, el pool de SIM
   con 24 "disponibles" en uso. **Regla:** cada campo derivado nace con un backfill y un job de cuadre
   (semanal basta), y el panel de Integridad lo reporta.
3. **El toast tapa el botón que sigue.** Reproducido en el teléfono del técnico (pierde la intervención) y en
   Asignar de bodega (4-5 s por asignación). El kit pinta el toast abajo, donde viven los botones primarios en
   móvil. **Regla:** toast arriba (o a la derecha en escritorio) y nunca sobre `.modal-footer`.
4. **Lector de barras a medias.** Enter no agrega fila en el lote de órdenes; Asignar exige escanear dos veces;
   cambiar un SIM es teclear 19 dígitos; "Pegar columna" no valida nada. T12 de la auditoría anterior se hizo
   en Almacén y quedó incompleto en Órdenes y PoC.
5. **Fechas.** UTC en la bandeja y la orden impresa; cinco formatos en Órdenes, tres en el Centro. T8 anterior
   sigue vigente. **Regla:** un solo `FMT.fecha()` en hora de Panamá, con un formato corto y uno largo.
6. **Guards solo en la interfaz.** Recepción vende desde Almacén; técnicos ven `PERMISSION_DENIED: evaluation
   error at L847`; contabilidad ve una pestaña que las rules le niegan. T4 anterior ("un solo guard por página")
   se aplicó al cuerpo y no a la topbar ni a la navegación secundaria.
7. **Listas que vuelcan toda la flota sin buscador.** Reemplazo 273 filas, renovación 18,956 px, SIM cards
   12,000 px, regularización 8,311 px, duplicados PoC 1,453 filas, lista de contratos en teléfono 9,164 px. El
   kit de pickers existe (`entity-picker.js`) y no se usa ahí.
8. **Pantallas para un futuro que no llegó.** Activación (0 contratos activados jamás), Emisión (placeholder),
   Panorama (llama "Facturado" a cotizaciones aprobadas), pool de SIM (cubre el 12 %), "Mostrar todo" en PoC,
   vista de tarjetas y "Avanzado" en Órdenes. Cada una confunde a quien no sabe que es futuro.
9. **Catálogo incompleto que se cobra en cada pantalla.** 107 de 123 modelos sin precio de venta; 5 refurbished
   sin tarifa ni ítem QBO (117 líneas de contrato "sin mapeo"); 1,316 fichas del pool y 3,242 fichas PoC sin
   modelo; 16 SKU de piezas para todo el taller; el primer modelo del catálogo es basura y sale preseleccionado
   en los wizards.
10. **Vocabulario.** Estados crudos en toasts ("ASIGNADO") y traducidos en chips ("En taller"); "Firmado en
    tablet" / "digital" / "electrónicamente" para la misma firma; "Tipo / Cond. / reuso" para refurbished; tres
    nombres para el módulo PoC; "Aprobado (sin firma)" para 153 contratos históricos sanos. T1 y T2 anteriores
    avanzaron pero no cerraron.
11. **Lo que el brief afirmaba y los datos no sostienen.** La "semana de Zuleika" vinculando QuickBooks fueron
    147 vínculos en un bloque de ~5 minutos el 25-sep; los "232 asignar vendedor" de cobros son en realidad
    165 activaciones/desactivaciones por tandas y 1 cambio de vendedor. El clasificador del ranking de acciones
    (audit logs) etiqueta mal esas dos; conviene corregirlo antes de usarlo para priorizar otra vez.

---

## D. Opinión franca sobre la estructura del app

**La organización en módulos sirve para bodega, taller y técnicos, y estorba para recepción y ventas.** José
vive en Almacén; Marcos y Ovidio en Órdenes; Solangel en Órdenes y la cotización nace de la orden. Para ellos
el rail con una o dos entradas es la estructura correcta y lo que les falta es velocidad de manos (lector,
Enter, botones visibles, toasts que no tapen). Recepción y ventas cruzan módulos todo el día, y el app ya tiene
tres respuestas a eso: el Centro (vista por cliente), las señales del home (vista por tarea) y Ctrl+K. Lo que no
tiene es **el enlace entre registros**: desde una orden no se llega al cliente, desde el cliente no se llega a
la orden, desde ninguno al radio. Por eso el home es la pantalla más vista: volver al home es la forma de
cambiar de cosa.

**No recomiendo replantear la estructura ni rehacer el frontend.** Ni reorganizar el rail por tarea o por rol
(ya se filtra por rol y las tareas ya están en las señales), ni convertirlo en SPA por los ~400 ms del primer
viaje: un recorrido de cinco pantallas cuesta 4-5 s, y lo que frena no es la recarga sino teclear en Ctrl+K lo
que un enlace daría gratis. La migración a Vite y la pasada de velocidad ya hicieron su parte. Lo que toca es
más barato y más útil, en este orden:

1. **Que los números digan la verdad** (sección A y transversal 1-2). Un sistema de mando con cifras falsas
   entrena a la gente a no mirarlo.
2. **Que cada registro enlace a los registros con los que se relaciona** (cambio B9) y que las señales
   aterricen en la fila de trabajo (B1).
3. **Manos rápidas en las tres pantallas del corazón del uso**: editar equipos de la orden, cambiar SIM,
   asignar/mover en bodega (B2, B3, B4).
4. **Cerrar o esconder lo que es futuro** (transversal 8) y completar el catálogo (transversal 9), que es
   trabajo de datos más que de código.

Si después de eso `uso_diario` muestra que recepción sigue pasando por el home veinte veces al día, entonces sí
vale discutir un cascarón sin recarga. Hoy no.

Dos rediseños sí se justifican, pero como proyectos con su propia decisión: la **ficha de orden** como pantalla
propia (hoy todo vive en modales sobre la bandeja; [01 P15](01-ordenes.md)) y **PoC naciendo del pool**
([03 P8](03-poc.md)), porque sin eso los duplicados por serial vuelven a crecer aunque se limpien.

---

## E. Preguntas para Alberto (decisiones que no se pueden deducir)

Las 51 preguntas completas, con opciones y lo que implica cada una, están al final de cada informe. Estas son
las que **destrancan más trabajo**:

**Operación diaria**
1. ¿José usa lector de código de barras o teclea? Cambia la urgencia de B3 y si vale comprar un lector USB
   (US$30-60; el app ya acepta Enter como sufijo). [04 Q1]
2. ¿Un SIM puede estar activo en dos radios a la vez (demos, respaldo)? Si nunca, B2 bloquea; si a veces, avisa
   y pide motivo. Y qué hacer con los 41 de hoy. [03 Q1]
3. Entrega con firma en papel (38 de las entregas del mes): ¿política aceptable (exigir la foto de la nota) o se
   empuja la tablet? [01 Q1]
4. Cinco correos por cada entrega (jefa, recepción, técnico, vendedor, cliente): ¿quién los lee? [01 Q3]
5. ¿Recepción y ventas deben poder recibir o vender radios desde Almacén, e iniciar reemplazos, bajas y
   terminaciones desde el Centro? Hoy pueden las dos cosas. [04 Q2, 05 Q1]

**Contratos y clientes**
6. ¿Una cuenta con contrato vigente puede tener otro contrato nuevo? Hoy la ficha solo ofrece anexo, temporal,
   demo o renovar. [06 Q1]
7. ¿Qué pasa con un contrato aprobado sin firmar a los 45 días (10 de 13 hoy)? Hoy desaparece del trámite y
   sigue en el home. ¿Y debe caducar el enlace de firma? [06 Q3, Q4]
8. "Por clasificar" (cola de bodega): ¿cuenta en el chip de la cuenta y dispara "Regularizar con contrato
   nuevo"? El plan dice que no; el botón dice que sí. [05 Q3]
9. La deuda de migración del pool (1,223 por clasificar, 1,316 sin modelo, 4,408 sin verificar): ¿script
   masivo o de a uno (84/mes = 15 meses)? [04 Q3]
10. Cuando un serial tiene dos fichas PoC vivas, ¿cuál es la buena: la que coincide con la custodia del pool, la
    más reciente, o lo decide recepción? Con la primera, 541 casos se cierran solos. [03 Q2]

**Dinero**
11. ¿Quién aprueba las cotizaciones comerciales fuera de política? El código dice `gerente`, no existe ninguno,
    y el correo va a `ventas@`. Y la política vigente: el brief dice 15 %/$5,000, la config 20 %/$15,000. [02 Q1, Q4]
12. "Vencida" a los 15 días por silencio es el desenlace de 62 de 128 cotizaciones: ¿recordatorio y posponer, o
    que venza solo el documento y la cotización siga "sin respuesta"? [02 Q2]
13. ¿Brenda factura en QuickBooks sin marcar la bandeja, o la factura sale tarde? Las marcas se concentran en
    dos días del mes y hay 8 avisos con más de una semana. [07 Q1]
14. ¿Esconder "Facturará la app", "Emisión" y "Panorama" hasta que exista la emisión? [07 Q2]
15. ¿El refurbished "-R" cobra la misma mensualidad y comparte bundle en QuickBooks que el modelo nuevo? Decide
    cómo se mapean los 5 modelos que hoy dejan 117 líneas "sin mapeo". [07 Q5]
16. ¿Quién confirma el primer pago de las 45 comisiones que esperan (0 confirmadas en 20 días): Zuleika en lote
    o lectura automática de QuickBooks? [07 Q4]

**Roles y acceso**
17. Cobros (Andrea) tiene rol `recepcion` y ve señales que no son su trabajo; contabilidad (Cheila) abre un home
    vacío. ¿Rol `cobros` propio? ¿Qué debe ver contabilidad al entrar? [08 Q1, Q2]
18. ¿Bodega puede ver el catálogo de modelos sin precios, y Piezas debe ocultarle el costo (pedido de
    contabilidad del 30-jun)? [04 Q4, Q7]

---

## F. Cómo saber si funcionó (medición transversal)

Cada informe trae sus métricas. Las que cubren todo el app:

| Qué medir | Hoy (30-sep) | Meta | Cómo |
|---|---|---|---|
| Señales del home: el conteo es verdad (sí, las 11 contrastadas) y **el destino muestra lo mismo** | Órdenes: 6 de 19, 4 de 84, 6 de 42 | el destino muestra lo que anuncia la señal, siempre | `scripts/home-nav/02-verdad-senales.js` + `scripts/ordenes/13b-*.mjs` |
| Interacciones por flujo (tabla del 28-sep, remedida hoy) | crear+recibir 15 · asignar 3 · entrega tablet 4+4 · papel 5 · técnico 2 equipos 12 · asignar 25 seriales 54 · cambiar SIM 7 · contrato de punta a punta 57 | asignar 25 seriales 29 · cambiar SIM 4 · técnico 9 | Scripts de recorrido de cada módulo, mismos datos |
| Dato falso visible (sección A) | 22 | 0 | Re-correr los scripts de cada ROTO HOY |
| SIMs activos en más de un radio · seriales PoC con dos fichas vivas | 41 · 566 | 0 · 0 | `scripts/poc/00-base-poc.js` |
| Contratos cuyo QR miente | 192 de 513 | 0 | `scripts/contratos/00-datos.js` |
| Páginas vistas del home por usuario y día (proxy de "tuve que volver al inicio") | solo un día de `uso_diario` | −30 % en recepción tras B9 | `admin/uso.html` |
| Autoguardados de cotización de taller por cotización | 34 | < 10 | audit logs |

---

## G. Lo que no se pudo verificar y cómo se hizo

- **Las Cloud Functions no corren en el emulador** (no hay emulador de functions ni de correo): los triggers de
  aprobación, seriales, PDF, correo y las callables de QuickBooks se simularon con scripts
  (`scripts/contratos/02-simular-trigger.js`) o se documentó qué ve la pantalla cuando fallan. Todo lo que diga
  "el correo salió" o "QuickBooks respondió" está inferido del código, no visto.
- **Tiempos**: medidos en local contra el emulador (sin red). Sirven para comparar pantallas entre sí y para
  contar viajes; en producción hay que sumar ~0.4-0.5 s por página de primer viaje.
- **`uso_diario` tiene un solo día** (se estrenó el 30-sep). Las cifras de uso vienen de los audit logs de
  escritura de 30 días que trae el brief, con la salvedad de la transversal 11.
- **No se observó a las personas reales.** Las preguntas de la sección E existen porque el código y los datos no
  alcanzan para contestarlas; media hora con Brenda, José y Solangel vale más que otra auditoría.
- **Cobertura:** 8 módulos, 10 roles, 3 tamaños de pantalla, 522 capturas, 106 scripts reproducibles. Los P0 de
  la auditoría del 28-sep se re-verificaron en el navegador uno por uno; el estado (resuelto / vigente / parcial)
  está en la sección 3 de cada informe. En resumen: de los 31 P0 de septiembre, la gran mayoría está resuelta;
  siguen vigentes la salida del teléfono en Órdenes, el archivo de contratos filtrado por creador y el pool fuera
  de Ctrl+K; y los 22 puntos de la sección A son **nuevos**, casi todos de la misma familia que los anteriores
  (números filtrados en el navegador, espejos sin cuadrar).
