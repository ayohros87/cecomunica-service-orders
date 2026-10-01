# 05 · Centro de gestión de clientes y Clientes — auditoría 2026-09-30

> Recorrido hecho en el emulador con los datos de producción del día (457 clientes, 540 contratos, 7,824 unidades del pool,
> 52 gestiones), como admin, vendedora (Karla), cobros (Andrea) y en escritorio / tablet / teléfono. Scripts en
> `docs/auditoria-modulos/scripts/centro/` (00–13), 65 capturas en `docs/auditoria-modulos/capturas/centro/`, maqueta
> antes/después en `docs/auditoria-modulos/maquetas/centro-ficha-cabecera.html`. Datos de prueba creados: el cliente
> `PRUEBA-AUDIT-centro Empresa Uno` (id `JQqR7m305yYck8eL0mYq`), la demo `GD20260930-01` y el contrato `TEMP20260930-01`.
> Todo con prefijo; nada de producción se tocó.

---

## ROTO HOY (atender primero)

| # | Qué pasa | Evidencia | A quién le pega |
|---|---|---|---|
| R1 | **Buscar un RUC como está escrito en el documento (con guiones) no encuentra nada, ni en el Centro ni en la edición masiva.** `155799999-2-2026` → 0; `8-NT-1-21875` → 0; `155799999` (sin guiones, exacto) → 1. Cualquier palabra con guion tampoco: `PRUEBA-AUDIT` → 0, `PRUEBA` → 1. La causa: el término se parte por espacios (`clientesService.js:303`) pero los tokens guardados se parten por todo lo que no sea letra o número (`:17`), así que "prueba-audit" nunca es un token. Los tokens de RUC son el RUC entero, no prefijos (`:46-52`): un RUC parcial tampoco sirve. | script `11-buscar-cliente-nuevo.mjs`; captura `56-cobros-escritorio-grid-buscar-cliente-nuevo.png` | Cobros, recepción, vendedoras: cualquiera que copie el RUC de una factura o un correo. Concluyen "no existe" y lo crean de nuevo (duplicado). |
| R2 | **El "historial inmutable" de la ficha registra cambios que nadie hizo.** De 803 entradas en 30 días, 135 dicen "ITBMS: — → Paga" y 134 "Etiquetas: — → []" a nombre de cobros, 238 "Tipo de contribuyente: — → …" sin usuario, 66 "Vendedor: — → …" sin usuario. Son campos que faltaban en el doc y `buildClientePayload` rellena con el valor por defecto en cada guardado (`clientesService.js:86-89`); el historial los cuenta como cambio. Solo `activo` (165 por cobros) y `ruc` (41 por cobros, 135 del saneo) son cambios reales. | scripts `01-historial.js`, `13-historial-fantasma.js` | Quien lea "1 cambio en el historial" o "Historial de la ficha" para auditar: más de la mitad de las líneas son ruido y el número del chip miente. |
| R3 | **"Regularizar con contrato nuevo" es el botón primario de la ficha para CUALQUIER cuenta con `puntos > 0` (249 de 457 clientes), aunque la deuda sea de bodega.** AGENCIA DE SEGURIDAD UNIDA: 16 contratos vigentes, 52 puntos, 50 son radios *por clasificar* (D7 = cola de bodega, que el plan dice que no sube la escalera) y 2 son radios sin contrato. El botón azul abre la **renovación consolidadora de los 16 contratos**: un modal de 18,956 px con 273 filas y 282 selects. La fila de "Ahora" dice "le toca a **ti**". El camino liviano correcto ("Actualizar seriales del cliente", sin firma ni bodega) es un enlace de texto dentro de "Qué falta". | `centro-ficha-bloques.js:129-131` (`if (deuda)` con `deuda = puntos > 0`); capturas `03-…pliegue.png`, `16-…wiz-renovar.png`, `32-…que-falta.png` | El dueño y las vendedoras: la ficha empuja a la gestión más pesada y riesgosa (renueva 16 contratos) para pagar una deuda que en un 96 % no es del vendedor. |

R1 y R2 se arreglan en horas. R3 es una línea de código más una decisión (ver preguntas).

---

## 1. Para quién es y qué hacen ahí

- **`clientes/centro.html`** (directorio + ficha 360 + todos los wizards): admin, gerencia, vendedoras, recepción/cobros; bodega
  entra solo por deep-link para asignar seriales. Es la única entrada al mundo clientes desde el rail (`modulos.js:29`).
  Hoy (único día con `uso_diario`): 23 vistas de `clientes/centro` — 6 de Karla, 4 de recepción, el resto admin/gerencia — contra
  3 de `clientes/ficha`, 2 de `clientes/index` y 1 de `clientes/regularizacion`.
- **`clientes/ficha.html`**: el único formulario de cliente (alta y edición, documentos, historial). Vendedoras crean; cobros,
  gerencia y admin editan.
- **`clientes/index.html`** ("edición masiva avanzada"): grid tipo hoja de cálculo para admin y recepción/cobros. No está en el
  rail; se llega desde el pie del menú "Nueva gestión" del Centro o desde admin.
- **`clientes/regularizacion.html`**: bandeja de cuentas con deuda de registro (128 cuentas, 1,974 puntos), para admin, gerencia y cobros.
- **`contratos/index.html`** (archivo) y `archivo-gestiones.js`: consulta de contratos y gestiones; no opera nada.
- **`admin/clientes-duplicados.html`**: escaneo y fusión, solo admin.

**Uso real (audit + historial, 30 días).** El brief dice "276 acciones de Clientes, 232 son asignar vendedor desde cobros".
El historial de las fichas no lo respalda: `vendedor_asignado` cambió 74 veces en 30 días, **1 por cobros**, 66 sin usuario
(job/script de F0). Lo que cobros hizo de verdad fueron 218 entradas concentradas en 5 días (11, 14, 17, 18 y 25-sep): **165
activaciones/desactivaciones de clientes**, 41 correcciones de RUC y 46 vínculos con QuickBooks — una limpieza de la base por
tandas desde el grid, no una tarea diaria de asignar vendedor. Gestiones: 52 en total en el sistema (24 aumentos, 15 reemplazos,
10 demos, 3 bajas), 22 abiertas. Contratos pendientes de aprobación hoy: 0.

Implicación: el módulo lo usa a diario **una persona (Alberto) leyendo fichas** y **las vendedoras abriendo 1–2 gestiones por
semana**; cobros entra a limpiar en ráfagas. Optimizar la ficha para leerla y los wizards para no equivocarse vale más que un
flujo masivo de vendedores.

---

## 2. Recorrido real

Todos los tiempos son `msTotal` (hasta DOM quieto) en el emulador local; en producción hay que sumarle ~400 ms del primer viaje.

### 2.1 Admin en escritorio (1280×800)

| Flujo | Interacciones | Tiempo / consultas | Captura | Nota |
|---|---|---|---|---|
| Abrir el directorio | 1 | 2.0 s · 10 req · 2 consultas de página (caché + servidor) | 01 | 30 filas, "Pendientes por aprobar" arriba (0). 16 de 53 objetivos < 36 px. |
| Buscar "seprosa" | 1 tecleo | 2.5 s con debounce; 1 consulta | 70 | Encuentra por nombre, por RUC solo sin guiones (R1). Ctrl+K también encuentra clientes. |
| Abrir la ficha grande (AGENCIA, 273 radios, 20 contratos) | 1 | **2.2 s · 10 req**; `listarPorCliente` 273 docs en 500 ms, catálogo 123, gestiones, cliente, en paralelo | 03, 03b | Alto total **1,360 px** con Contratos abierto (antes de sep-08 medía 3,558). Arriba del pliegue: cabecera, "Ahora · 1", franja de números y el bloque Contratos con sus 3 primeras filas. Todo abierto: 2,300 px. **330 de 340 objetivos < 36 px** (enlaces de contrato y "⋯"). |
| Menú "Nueva gestión" | 1 | — | 07 | 10 entradas en 4 grupos + "Edición masiva de clientes" al pie (no es una gestión). |
| Aumento (anexo) hasta "Enviar a aprobación" | 6 (menú, Agregar equipos, modelo, precio, ¿de quién es?, enviar) | modal 1.3 s | 08 | Aviso correcto de "2 radios sin contrato van aparte". Ancla elegida sola (ALQ20260505-02). |
| Reemplazo hasta "Enviar solicitud" | 5 + **leer 273 filas** | 1.2 s | 09 | Tabla de 273 unidades **sin buscador**; las 50 "No disponible (por_clasificar)" salen PRIMERO. Ver §3.2. |
| Demo | 5 | 1.1 s | 10 | Bien. |
| Baja parcial | 5 + leer 221 filas | 1.0 s | 11 | Misma tabla sin filtro. |
| Terminación de la cuenta | 4 + carta | 1.1 s | 12 | 223 filas marcadas; "cancela los 16 contratos con una sola carta". |
| Cambio de serial | 4 + leer 223 filas | 1.1 s | 13 | Bien explicado ("no mueve equipo"). |
| Ajuste de tarifa | 5 | 1.0 s | 14 | Selector de contrato con 16 opciones sin pista de cuál. |
| Contrato temporal | 9 (ver §2.4) | 1.1 s | 15, 60, 60a | "Guardar contrato" sale **deshabilitado sin decir por qué**: hay que bajar 878 px dentro de un cuerpo de 565 px para encontrar el check "Validé con el cliente que … sigue siendo el representante". Clic en el botón gris = nada (sin toast, sin rojo). |
| **Renovar cuenta (consolidación)** | 4 + decidir 273 seriales | 1.3 s | 16 | **Cuerpo de 18,956 px, 273 filas, 282 selects, 20 checks.** "Todos continúan" ayuda, pero no hay agrupación por contrato ni búsqueda. |
| Actualizar seriales del cliente | 4 | 1.1 s | 17 | Bien: 2 filas, tres opciones claras por serial. |
| Aprobar un contrato (desde "Ahora") | **1 clic, sin confirmación** | 4.9 s hasta ver el siguiente paso | 65, 66 | La fila de Ahora ofrece "Ver contrato" y "Aprobar". Tras aprobar: "espera que bodega asigne los seriales · le toca a bodega", progreso 1/7 real. **"Enviar para firma" queda en gris con el motivo** (P0 #11 resuelto). |
| Ver contrato aprobado sin firma | 2 | 1.0 s | 33 | Líneas, seriales en campo, la OS de programación con su línea de tiempo y el pie de acciones. Bien. |
| Expediente de una gestión viva (SEPROSA GA20260924-02) | 2 | — | 35-seprosa | Línea de tiempo con "SIGUIENTE · Firma del cliente · le toca a el cliente · tú envías el enlace" y un cuadro azul que explica que bodega corre en paralelo. **Esto sí se entiende.** |
| Regularización (bandeja) | 1 | 2.2 s · 9 req; alto **8,311 px** | 30, 31 | 128 cuentas, chips Críticas 67 / Por regularizar 48 / Leves 13 / Sin vendedor 1 / Solo bodega 37 / Inactivas 84. |
| "Qué falta" | 1 | — | 32 | Lista los 50 seriales por clasificar y los 2 sin contrato; el botón azul es "Regularizar con contrato nuevo", el camino liviano es texto (R3). |
| Duplicados | 1 + "Escanear" | 1.9 s | 36 | Requiere clic manual para escanear; no lo probé a fondo (solo afecta al Centro por fusión). |
| Archivo · Gestiones | 2 | 2.3 s · 11 req | 37 | Filtros por tipo/estado, CSV. Solo consulta, bien señalizado. |
| Formulario de edición (ficha.html) del cliente grande | 1 | 1.6 s · 14 req; alto 2,402 px | 38 | Chips "Activo · 20 contratos · 1 cambio en el historial". Documentos: "No hay documentos cargados" (cliente con 20 contratos). |

### 2.2 Vendedora (Karla) en escritorio y teléfono

| Flujo | Interacciones | Tiempo | Captura | Nota |
|---|---|---|---|---|
| Directorio = "Mi cartera" (servidor) | 1 | 1.8 s · 8 req | 20 | "2 clientes activos en tu cartera". Sin toggle Todos, sin bandeja de aprobaciones. P0 #15 **resuelto**. |
| Alta de cliente con RUC por partes | **10** (nombre, tipo jurídica, tomo, folio, asiento, representante, cédula, teléfono, correo, Crear) | **5.0 s** desde clic hasta la ficha 360 del nuevo | 21, 22, 23 | DV se calcula solo ("DV 30 — DV calculado según la DGI"): #3 de Clientes **resuelto**. Vendedor preseleccionado = ella. **Dedup solo al guardar** y el toast "Ya existe otro cliente con ese RUC." **no enlaza al existente** (primer intento con un RUC repetido): sigue vigente. |
| Ficha nueva → menú | 1 | — | 24 | Puede: Nuevo contrato, Contrato temporal, Demo, "¿Contrato en papel? Anexo de aumento". |
| "⋯" | 1 | — | — | "Ver datos del cliente · **solo lectura — los cambios los hace cobros**": la vendedora que acaba de crear el cliente no puede corregirle el teléfono. |
| Demo con **triple clic** en "Enviar solicitud" | 5 | 10 s hasta el toast | 25, 26 | **1 sola gestión** (`GD20260930-01`); el botón queda "Enviando…" deshabilitado. P0 #10 **resuelto**. |
| Expediente de la demo | 1 | — | 27 | "SIGUIENTE · Asignación de seriales · le toca a bodega"; su "⋯" dice "Asignar seriales en Almacén — NO: los seriales los declara bodega". Fecha de la fila "09/30/2026" (gringa) y adentro "Salida: 2026-09-30" (ISO). |
| Teléfono: cartera y ficha | 1 | 1.6 s | 28, 29, 29b | Dock inferior con "Nueva gestión" y el primario. RUC en la cabecera: `15579999922026-30`. |

### 2.3 Cobros (Andrea, rol recepción)

| Flujo | Interacciones | Tiempo | Captura | Nota |
|---|---|---|---|---|
| Grid de edición masiva | 1 | 1.8 s · 12 req | 50 | 20 filas por página, 250 activos. RUC truncado a 8 caracteres ("32489-47", "15570307"), teléfono cortado. **"250 totales · 250 activos · 0 inactivos"** con "Solo activos" encendido: hay 207 inactivos (`clientes-index.js` `updateStats`, rama `onlyActive`). 236 de 241 objetivos < 36 px. |
| Asignar vendedor a UN cliente | **3** (teclear nombre, cambiar el select de la fila; guarda solo) | ~1 s | 51, 52 | No hay confirmación ni deshacer; el punto de estado de la fila es de 6 px. Buscar exige saber el nombre sin guiones (R1). |
| Asignar en masa | n checks + select + Asignar + confirmar | — | 53 | Existe (`bulkAsignarVend`, con candado y confirmación). Sirve por página (20). |
| Bandeja de regularización, chip "Sin vendedor" | 2 | 1.8 s | 54 | Queda **1** cuenta sin vendedor (SERVICEP): F0 del plan está hecha. Asignar al elegir en el select. |
| Centro como recepción | 1 | 1.6 s | 55 | Ve Todos/Mi cartera, "Cuentas por regularizar", "Nuevo cliente" y **el menú completo de gestiones (reemplazo, baja parcial, corregir serial, demo, temporal)**. |

### 2.4 Aprobaciones (admin) con el contrato de prueba

Creé `TEMP20260930-01` sobre el cliente de prueba: 9 interacciones (menú, Contrato temporal, modelo, cantidad, precio, ¿de quién
es?, duración, check del representante, Guardar), 4.8 s hasta el toast "creado — pendiente de aprobación". En el directorio la
bandeja pasó a "Pendientes por aprobar 1 · Contrato nuevo · PRUEBA-AUDIT… TEMP20260930-01 · 2 equipo(s) · $42.80/mes · hoy ·
Revisar" (captura 62). "Revisar" aterriza en la ficha con Gestiones abierto y la fila "Aprobar el contrato … le toca a ti" con
botones "Ver contrato" y "Aprobar" (63, 64). Un clic aprueba **sin resumen ni confirmación** (65 vacía). Después: "El contrato
espera que bodega asigne los seriales · le toca a bodega" y progreso 1/7 (66). En el "⋯" del contrato recién aprobado la primera
acción de "Avanzar" es **"Cerrar el contrato…"** (porque es temporal y no tiene equipo en campo): un contrato que todavía no
salió ofrece cerrarse antes que cualquier otra cosa.

**¿Se sabe qué falta y quién lo debe hacer?** Sí, y es lo mejor del módulo: cada expediente trae "SIGUIENTE", el rol y un botón; la
bandeja mezcla gestiones y contratos por antigüedad. Lo que falta es (a) la aprobación en un clic sin resumen, (b) la bandeja no
dice **cuántos días** lleva cada cosa esperando en la cabecera (solo "hoy"/"n d" por fila) ni cuántas están trancadas por bodega
o por el cliente, que es la pregunta que el dueño se hace al abrirla.

### 2.5 Estado de los P0 de la auditoría del 2026-09-28 (verificado en el navegador)

| P0 | Estado | Evidencia |
|---|---|---|
| #9 Renovación aprobada sin firmar "renueva" | **Corregido en código** (4a924e1), no reproducido: no hay un caso así en los datos | `_renovadoPor` en `centro-firma.js:564,616` |
| #10 Doble submit en los 6 `crear*` | **Resuelto** | triple clic → 1 gestión (`03-vendedora.mjs`, `v_doble_clic`) |
| #11 Enviar a firma con Anexo A vacío | **Resuelto** | "Enviar para firma — NO: Bodega todavía no asignó los seriales" (`06-aprobaciones.mjs`) |
| #12 `done/4` fijo | **Resuelto** | 0/7 → 1/7 en el contrato; 0/4 en la demo; 2/6 en el aumento |
| #13 Duración vacía → 1 mes en el editor | **Corregido en código** (`centro-editor-contrato.js:193-198`), no probado |
| #15 "Mi cartera" filtrada en el navegador | **Resuelto** | `listClientesPorVendedor` al servidor |
| #16 Formulario viejo borra datos | **Resuelto** | un solo formulario; `nuevo-cliente.html` redirige |
| Clientes #3 DV con clic extra / dedup sin enlace | **Parcial**: DV automático sí; dedup sigue solo al guardar y sin enlace | `v_alta_guardado` primer intento |
| Clientes #4 Regularización sin try/catch, sin encabezados | **Resuelto** | encabezados NIVEL/CLIENTE/VENDEDOR/PUNTOS/DESDE; Reintentar |

Lo que el brief afirma y no vi: "232 asignar vendedor desde cobros" (§1). Lo que la auditoría anterior afirmaba y ya no aplica:
casi todo el §4.3 (el archivo se partió en 17 archivos, "le toca a" es dato, las acciones están en un solo menú).

---

## 3. Hallazgos

### 3.1 Roto (además de R1–R3 arriba)

| # | Hallazgo | Evidencia |
|---|---|---|
| B1 | "0 inactivos" en el grid con "Solo activos" encendido (hay 207). | `clientes-index.js` `updateStats`, captura 50 |
| B2 | Buscar en el Centro con "Todos" pagina de 30 en 30 y el resumen dice "30 clientes activos (hay más)" incluso cuando la búsqueda tiene 1 resultado ("1 cliente activos (hay más)"). | `r_buscar_seprosa` |
| B3 | La demo se creó con el modelo "1-19000-00011 SC2020": es la primera opción del catálogo ordenado alfabéticamente y es basura del catálogo, no un radio. Cualquier vendedora que no cambie el select manda eso a bodega. | captura 26; `_cargarModelos` ordena por label |

### 3.2 Confuso

| # | Hallazgo | Evidencia | Efecto |
|---|---|---|---|
| C1 | **Los selectores de seriales listan toda la flota sin buscador.** Reemplazo: 273 filas con 50 "No disponible (por_clasificar)" primero; Baja: 221; Cambio de serial: 223. El único input del reemplazo es "Serial dañado que no aparece", no un filtro. | capturas 09, 11, 13; `centro-wiz-reemplazo-demo.js`, `centro-wiz-baja.js`, `centro-cambio-serial.js` | Para reemplazar UN radio en un cliente de 273 hay que leer la tabla entera. Es el paso que más equivocaciones invita (marcar la fila de al lado). |
| C2 | **Renovar cuenta = 18,956 px de modal.** 273 filas con un select de destino cada una. | captura 16 | Nadie revisa 273 decisiones en un modal; "Todos continúan" se vuelve la única salida y la renovación deja de ser una conciliación. |
| C3 | Botón primario "Regularizar con contrato nuevo" en toda cuenta con puntos > 0 (R3). En C COMUNICA compite con la urgencia real de la cuenta ("contrato aprobado hace 71 días sin firma"), que sí está en Ahora pero no en la cabecera. | captura 34-ccomunica | Dos llamados a la acción distintos en la misma pantalla. |
| C4 | "Guardar contrato" deshabilitado sin motivo; el check del representante vive 313 px por debajo del cuerpo visible. Clic en gris = silencio. | `p_btn_antes_check`: chkTop 878 / bodyH 565; captura 60a | El usuario cree que el botón está roto. |
| C5 | El RUC de la cabecera y del directorio es el normalizado: `RUC 15570307122021-08`, `RUC 8NT121875-79`. En la ficha sale bien (`155703071-2-2021 · DV 08`). | capturas 01, 03, 29 | Un número que no se puede cotejar con el documento del cliente; contradice R1 (la gente lo copia con guiones). |
| C6 | Tres formatos de fecha en la misma pantalla: "09/30/2026" (fila de gestión), "2026-09-30" (detalle), "29 mar 2027" (contratos). | capturas 26, 27 | T8 de la auditoría anterior sigue vigente aquí. |
| C7 | "Aprobar" en un clic, sin resumen; "Cerrar el contrato…" como primera acción de un temporal recién aprobado. | §2.4 | Aprobación accidental; cierre accidental de un contrato que no ha salido. |
| C8 | La vendedora no puede corregir datos de contacto de un cliente que ella creó ("solo lectura — los cambios los hace cobros"). | `v_menu_mas` | Un teléfono mal tecleado es un correo a cobros. |
| C9 | "Edición masiva de clientes" al pie del menú "Nueva gestión"; "¿Contrato en papel? Anexo de aumento" en el mismo menú para una cuenta sin contratos. | capturas 07, 24 | El menú mezcla gestiones con navegación. |
| C10 | Bandeja de regularización: 67 de 128 cuentas son "Críticas"; el encabezado es un párrafo de 6 líneas; "126 · 1 pt" no dice que "pt" es una gestión puntual. | captura 30 | Cuando la mitad es crítica, "crítica" no ordena nada. Umbrales sin calibrar (plan §9). |
| C11 | Historial "1 cambio en el historial" en un cliente con 20 contratos y 273 radios (solo el saneo del RUC): la ficha promete auditoría y muestra una línea. Y con R2, esa línea puede ser un relleno. | captura 38, `a_ficha_form` | |
| C12 | Recepción/cobros puede iniciar reemplazos, bajas, terminaciones y corregir seriales desde el Centro (`puedeCrearGestion` incluye RECEPCION). | `centro-gestiones.js:53`, captura 55 | ¿Es intencional? (pregunta 1). |
| C13 | Ficha en tablet: 52 objetivos < 36 px; en escritorio 330. Los "⋯" de fila y los enlaces de contrato son de 24–28 px. | `geometria()` | A un brazo de distancia no se acierta. |

### 3.3 Lento

| # | Hallazgo | Medida |
|---|---|---|
| L1 | Alta de cliente: 5.0 s desde "Crear cliente" hasta la ficha 360 (3 consultas de duplicados en serie + create + redirección + carga de la ficha). | `v_alta_guardado` |
| L2 | Aprobar contrato: 4.9 s hasta ver el siguiente paso (la escucha en vivo espera al trigger). Aceptable, pero sin spinner en la fila. | `p_aprobado` |
| L3 | Ficha grande 2.2 s con 10 requests; el pool completo del cliente (273 docs) se baja en cada apertura y en cada wizard. Tolerable hoy; con 500 radios no. | `ficha` |
| L4 | Bandeja de regularización: 8,311 px, 128 filas de golpe, tope 500 sin paginar. | `a_reg` |
| L5 | Directorio "Todos": llegar a un cliente por la Z son 8 clics de "Cargar más" (30 en 30); la búsqueda es obligatoria, y la búsqueda tiene R1. | `directorio_resumen` |

---

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| P1 | **Búsqueda tolerante**: normalizar el término igual que los tokens (partir por no alfanumérico, quitar guiones), y guardar el RUC como prefijos de dígitos (≥ 4) además del entero. Backfill de `searchTokens` con un script (457 docs). | R1 | Cada búsqueda fallida hoy termina en un duplicado o en un WhatsApp | 2–3 h + backfill | Índice `array-contains` igual; tokens por doc suben ~15 |
| P2 | **Historial honesto**: en `updateCliente`/`guardar` registrar solo `antes !== despues` donde `antes` exista, o etiquetar "campo completado" fuera del conteo. Chip "n cambios" cuenta solo cambios reales. | R2 | 55 % menos líneas de ruido; el chip vuelve a decir la verdad | 1–2 h | Ninguno (no se reescribe lo viejo) |
| P3 | **Primario de la cabecera = primera fila de "Ahora"**, y `deuda` para el CTA solo con `d1+d2+d4+d5+d6 > 0` (D7 es de bodega, "le toca a bodega"). "Actualizar seriales (n)" como botón cuando D1 ≤ umbral; "Regularizar con contrato nuevo" solo cuando no hay contrato vigente o D1 grande. Maqueta: `maquetas/centro-ficha-cabecera.html`. | R3, C3 | Evita renovaciones de 16 contratos por 2 radios; una sola voz en la cabecera | 2–3 h | Decisión de negocio (pregunta 3) |
| P4 | **Selector de seriales único** para reemplazo, baja, cambio de serial y renovación: buscador (con lector de barras), no disponibles escondidas con conteo, agrupado por contrato con encabezado plegable y "todos continúan" por grupo, resumen pegado abajo con lo marcado. Maqueta en el mismo archivo. | C1, C2 | De leer 273 filas a teclear 4 caracteres; el modal de renovación baja de 19,000 px a una pantalla | 1–2 d | Cuatro wizards tocan el mismo componente: probar con SEPROSA y AGENCIA en el emulador |
| P5 | Contrato: "Guardar" habilitado, y al clic decir qué falta (toast + scroll al check); mover el check del representante arriba, junto a "Datos del contrato". Aprobar con resumen (líneas, total, seriales pendientes) y confirmar; "Cerrar el contrato…" solo cuando hubo entrega o está `cancelacion_pendiente`. | C4, C7 | Cero clics muertos; cero aprobaciones o cierres accidentales | 2 h | — |
| P6 | RUC compuesto (`RucPanama.componer`) en cabecera y directorio; fechas `es-PA` en filas de gestiones; "0 inactivos" → cálculo honesto o esconder la cifra con "Solo activos". | C5, C6, B1 | Datos que se pueden cotejar | 1 h | — |
| P7 | Catálogo: `_cargarModelos` esconde modelos sin marca o marcados como no-radio, y el select arranca en "— Modelo —" con validación (ya la hay) pero sin preseleccionar. Retirar "1-19000-00011 SC2020" y "HYTERA NO APLICA" del catálogo vivo. | B3 | Demos y contratos con el modelo correcto | 1 h | Toca datos del catálogo (Zuleika) |
| P8 | Dedup al salir del RUC y del nombre en el alta (ya existe `_duplicado`), con enlace "Abrir el existente" en el aviso y en el toast. | Clientes #3 vigente | −8 campos tecleados cuando el cliente ya existe | 2 h | — |
| P9 | Vendedora edita **contacto** (teléfono, correos, dirección) de sus propios clientes; identidad fiscal y vendedor siguen siendo de cobros. Reglas: `tocaIdentidadCliente` ya separa los campos. | C8 | Un correo menos por cada error de tecleo | 2–3 h | Decisión (pregunta 2) |
| P10 | Bandeja "Pendientes por aprobar" con cabecera de conteos: "n esperan a ti · n a bodega · n al cliente · la más vieja lleva X días", y la bandeja de regularización con umbrales recalibrados y paginada. | §2.4, C10 | El dueño sabe en 2 segundos si hay algo suyo | 3–4 h | Umbrales (pregunta 5) |
| P11 | **Gestiones desde la selección en la ficha**: en el bloque Equipos, marcar radios y elegir "Reemplazar / Dar de baja / Corregir serial" con lo marcado; los wizards reciben la selección en vez de volver a listar la flota. El bloque Equipos ya agrupa por contrato. | C1, C2, la ficha como centro de trabajo | Un solo lugar donde se ve y se elige la flota; los wizards se vuelven formularios cortos | 1–2 sem | Reescribe la entrada de 3 wizards; se hace detrás de P4 |

No propongo rediseñar la ficha desde cero: la reordenación de sep-08 (Ahora → franja → bloques plegables) funciona y se entiende
(ver capturas 34, 35). Tampoco fusionar `clientes/index.html` con la ficha: es la herramienta de limpieza por tandas de cobros y
cumple; solo hay que arreglarle el buscador (P1), los números (P6) y el RUC truncado.

---

## 5. Cómo saber si funcionó

| Medida | Antes (hoy) | Cómo medir después |
|---|---|---|
| Búsquedas con 0 resultados en Centro y grid | desconocido (no se registra) | registrar `{term, n}` en `uso_diario` o consola: meta < 5 % |
| Clientes duplicados nuevos por mes (mismo RUC normalizado) | escaneo de `admin/clientes-duplicados` | mismo escaneo mensual: meta 0 |
| Líneas de historial por guardado | ~3.7 (803 líneas / ~218 guardados) | meta ≈ 1 |
| Interacciones para reemplazar 1 radio en un cliente de 273 | 5 + 273 filas | 5 + 1 tecleo; tiempo con `performance.now()` en el emulador: meta < 20 s |
| Alto del modal "Renovar cuenta" (AGENCIA) | 18,956 px | meta < 3,000 px con grupos plegados |
| Aprobaciones revertidas (anuladas < 24 h después de aprobar) | audit de contratos/gestiones | meta 0 |
| Fichas abiertas por día por usuario (`uso_diario`) | 23 hoy | ver si el dueño abre menos fichas para lo mismo (Ahora + bandeja) |
| Cuentas con "Regularizar con contrato nuevo" como primario | 249 de 457 | tras P3: solo las sin contrato vigente o con D1 alto |

---

## Top 5 impacto/esfuerzo del módulo

1. **P1 búsqueda tolerante (RUC con guiones, palabras con guion)** — evita duplicados y "no existe"; 2–3 h.
2. **P3 primario de la cabecera = primera fila de Ahora, D7 fuera del CTA** — deja de empujar renovaciones de 16 contratos; 2–3 h.
3. **P4 selector de seriales con buscador y grupos** — de 273 filas a 4 caracteres en 4 wizards; 1–2 d.
4. **P2 historial sin cambios fantasma** — el chip y el historial vuelven a decir la verdad; 1–2 h.
5. **P5 guardar/aprobar/cerrar con motivo y confirmación** — cero clics muertos y cero aprobaciones accidentales; 2 h.

## Preguntas para Alberto

1. **¿Recepción/cobros debe poder iniciar reemplazos, bajas, terminaciones y correcciones de serial desde el Centro?** Hoy puede
   (`puedeCrearGestion` incluye recepción). Opciones: (a) dejarlo, porque Brenda a veces lo hace por el vendedor; (b) limitarla a
   demo/temporal/alta de cliente y que lo demás lo abra la vendedora o gerencia. (b) reduce errores en gestiones que mueven equipo.
2. **¿La vendedora puede corregir teléfono, correos y dirección de sus propios clientes?** Hoy es solo lectura. Si sí, P9 (2–3 h);
   identidad fiscal y vendedor asignado seguirían siendo de cobros.
3. **"Por clasificar" (D7, cola de bodega): ¿debe contar en el chip de la cuenta y disparar "Regularizar con contrato nuevo"?**
   El plan de regularización dice que D7 no sube la escalera; hoy el CTA lo cuenta. Opciones: (a) D7 se muestra como "Bodega · n" y
   no dispara nada (mi propuesta); (b) sigue como hoy y se acepta que 249 cuentas tengan ese botón.
4. **Aprobar contrato: ¿un clic o con resumen y confirmación?** Un clic es más rápido para ti; el resumen evita aprobar un TEMP con
   el modelo basura del catálogo (B3) sin verlo. Propongo resumen de 4 líneas + botón.
5. **Umbrales de la bandeja de regularización**: con `D1 ≥ 20 = crítica`, 67 de 128 son críticas. ¿Subir a 50, o definir crítica
   solo como "radios en campo sin ningún contrato vigente"?
6. **El "232 asignar vendedor" del brief**: en el historial de las fichas cobros cambió el vendedor 1 vez en 30 días. Antes de
   invertir en un flujo masivo, ¿confirmamos qué acción está contando ese número? Lo que sí hace cobros son limpiezas por tandas
   (165 activaciones/desactivaciones): si eso es lo habitual, la mejora útil es el buscador del grid y filtros por "sin RUC / sin
   vendedor / sin QBO", no un asignador masivo.
