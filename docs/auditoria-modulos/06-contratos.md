# 06 · Contratos — auditoría 2026-09-30

> Recorrido hecho en el emulador con los datos de producción del día (544 contratos, 513 verificaciones, 29 solicitudes
> de firma por enlace, 114 firmas de tablet), como vendedora (Karla), admin (Alberto), bodega (José), recepción (Brenda),
> contabilidad y "el cliente" (página pública sin sesión), en escritorio, tablet y teléfono. Scripts en
> `docs/auditoria-modulos/scripts/contratos/` (00–03 datos y triggers simulados; 10–15 recorridos), 58 capturas en
> `docs/auditoria-modulos/capturas/contratos/`, maqueta en `docs/auditoria-modulos/maquetas/contratos-firma-y-vida.html`.
> Datos de prueba creados: los clientes `PRUEBA-AUDIT-contratos-cliente` y `-cliente-2`, los contratos `SERV20260930-01`
> y `-03` (activos, firmados por enlace) y `SERV20260930-02` (anulado). Nada de producción se tocó.
>
> **Aviso de método.** En el emulador solo corren auth, Firestore y hosting. **Las Cloud Functions NO corren**: lo que
> hacen los triggers (pedir seriales a bodega, espejar los seriales asignados, activar al validar la firma, crear la
> verificación pública, mandar correos y PDF) se simuló con `02-simular-trigger.js`, que escribe solo los campos que la
> UI lee. Storage y las callables tampoco están emulados: la subida de la cédula/selfie del firmante y del PDF firmado
> se bloqueó en la página (`_lib.mjs:blindar`) para que nada saliera a producción; la firma se completó con
> `03-extra.js firmar-cliente` + `02-simular-trigger.js firma`. Los tiempos son del emulador local (en producción súmale
> ~400 ms del primer viaje). El recorrido se hizo tres veces: la corrida 1 (capturas) y la corrida 3 (números de este
> informe) son equivalentes; la corrida 2 falló porque el cliente de prueba ya tenía un contrato vigente y la ficha
> dejó de ofrecer "Nuevo contrato" (eso es un hallazgo, §3.2 C4).

---

## ROTO HOY (atender primero)

| # | Qué pasa | Evidencia | A quién le pega |
|---|---|---|---|
| R1 | **El QR impreso certifica como "válido y vigente" contratos anulados y vencidos.** `/c/0d3PXcs7M8D20L9n6s8g?v=22D3A10827` (ALQ20260618-04, ASAP PANAMA, **anulado**) → banner verde "Contrato válido y vigente". Lo mismo para ALQ20251215-04 (activo pero **vencido por fecha** desde diciembre). La página sí mira el estado (`public/verify/index.html:135-150`, P0 #1 de la auditoría anterior), pero lo lee de `verificaciones.estado`, y ese campo solo se actualiza **al cambiar** el estado y solo desde el 28-sep (`functions/src/triggers/contratos/onApproval.js:97-118,137-161`). Nunca se hizo backfill: **192 de 513 verificaciones tienen un estado distinto al del contrato**: 89 de los 92 anulados dicen "aprobado", 7 activos vencidos por fecha dicen "activo", y los 88 `vencido` dicen lo que decían. | script `00-datos.js` (bloque "verificaciones"); capturas `81-…verify-anulado-viejo.png`, `82-…verify-vencido-por-fecha.png`; contraste: el anulado de hoy sí sale "ANULADO" (`84-…verify-anulado-hoy.png`) | Cualquier tercero (banco, cliente, auditor) que escanee el QR de un contrato viejo: el sistema le dice que un contrato muerto está vigente. Es la única promesa pública del módulo y hoy miente en 192 casos. |
| R2 | **El archivo dice "Firmado en tablet" en contratos firmados por enlace.** `archivo-expediente.js:70` traduce `firmado_tipo === 'digital'` como "Firmado en tablet". No existe firma de contrato en tablet: `firmas_tablet` solo admite `acuse_devolucion`, `recepcion` y `entrega` (`firestore.rules:1299`), y `firmado_tipo: "digital"` lo escribe exclusivamente el trigger del enlace (`functions/src/triggers/firmas/onFirmaContrato.js:86`). | captura `65-admin-escritorio-lista-expediente-fila.png` (SERV20260930-01, firmado desde `/firmar/?s=`); 4 contratos digitales en producción | Quien revise un expediente desde el archivo busca una firma de tablet que no existe. Arreglo: una palabra. |
| R3 | **"Devolución pendiente" en el archivo filtra sobre las 40 filas cargadas, no sobre la base.** Con el filtro encendido salen **1** contrato ("de 40 cargado(s)") cuando hay **14** con `devolucion_estado = 'pendiente'` (más los "sin registro"). El filtro es local a propósito (`contratos-list.js:429-452`, nota al pie `:496-497`) porque `sin_registro` es una ausencia de campo. El `PLAN_DEVOLUCION_EN_CONTRATOS.md` §2 diseñó el espejo `devolucion_estado` justamente para "filtrar server-side" y esa parte no se usa. | captura `63-admin-escritorio-lista-devolucion-pendiente.png`; `00-datos.js` ("devolucion_estado: pendiente 14") | Recepción y el vendedor que busquen "qué radios faltan por devolver" ven 1 de 14 y concluyen que está casi todo. |

R1 se arregla con un backfill de una vez (script de 20 líneas con Admin SDK: `verificaciones.estado` = estado real,
`vencido` si `vencimiento_estado === 'vencido'`) más un job semanal de cuadre. R2 es un texto. R3 es una consulta
`where('devolucion_estado','==','pendiente')` para el chip, dejando "sin registro" como vista aparte.

---

## 1. Para quién es y qué hacen ahí

- **El contrato se crea, aprueba, firma y anula desde el Centro de gestión** (`clientes/centro.html`), no desde
  `/contratos/`. El módulo `contratos/` quedó como **archivo de consulta** (`index.html`), **papel** (`documento.html`
  v2 e `imprimir-contrato.html` clásico), **seriales históricos** (`seriales.html`, que para bodega rebota a Almacén ·
  Asignar), transición y carga de firmados. `nuevo-contrato`, `editar-contrato` y `cancelaciones` redirigen.
- **Firma:** por enlace (`/firmar/?s=`, página pública en el celular del cliente), o en papel (imprimir + subir el PDF
  firmado desde el Centro, que activa). **La tablet de recepción (`/firmar/tablet.html`) no firma contratos**: firma el
  acuse de entrega, el acuse de devolución y el recibo en mostrador. La relación con el contrato es indirecta: la
  entrega de la orden de programación se bloquea si el contrato no está firmado (`ordenes-flujo.js:259-328`).
- **Verificación pública** `/c/<id>?v=` (rewrite a `verify/index.html`), QR impreso en el documento.
- **Quién:** vendedoras (Karla, Elvia, Salomón, Alondra) crean y mandan a firma; admin/gerencia aprueban, anulan y
  cierran; bodega asigna seriales; recepción crea la orden de programación; contabilidad consulta el archivo con la
  columna Total (recepción la ve sin Total).

**Uso real.** 89 acciones de Contratos y 226 firmas en 30 días según el brief (los audit logs no están en la
exportación del emulador, así que no pude desglosarlos). Hoy, único día de `uso_diario`, el módulo pesa poco frente
al Centro: `clientes/centro` 48 vistas, `contratos/index` 16 (6 de Alberto, 6 de contabilidad, 3 de recepción, 2 de
Karla), `contratos/documento` 6 y `contratos/imprimir-contrato` 2 (todas de Alberto), `contratos/seriales` 6 (José,
que rebota a Almacén), `firmar/tablet` 5 (Brenda), `firmar/index` 1, `/c/…` 9 (de esta auditoría).

**Estado de la base (emulador = producción de hoy):** 493 contratos vivos: 203 `aprobado`, 110 `activo`, 92
`anulado`, 88 `vencido`. De los 203 aprobados, **153 son "legacy"** (histórico que opera sin firma en el sistema: 32
con entrega confirmada, 40 con órdenes), 45 tienen seriales asignados y 4 esperan seriales. De los 110 activos, 109
se activaron subiendo el papel y **1** por enlace (los otros 3 firmados por enlace ya vencieron). 7 enlaces de firma
están vivos, ninguno caduca. **Ningún contrato vivo tiene `representante_doc_tipo`** salvo 4 (3 cédula, 1
pasaporte): el campo nació el 18-sep.

Implicación: el módulo "Contratos" como pantalla casi no se usa; lo que se usa es el **trámite del contrato dentro del
Centro** y el **papel**. La auditoría se centró ahí.

---

## 2. Recorrido real

Tiempos = `msTotal` hasta DOM quieto en el emulador. Interacciones = camino feliz con el app abierto (1 clic, 1 campo,
1 confirmación, 1 gesto = 1). Scripts `10`–`15`; salida completa de la corrida 3 en los `.txt` del scratchpad.

### 2.1 Contrato nuevo de punta a punta (3 modelos serializables)

| Paso | Quién · dónde · dispositivo | Interacciones | Tiempo | Captura | Qué vi |
|---|---|---|---|---|---|
| A. Crear | Karla · Centro → Nueva gestión → Nuevo contrato · escritorio | **21** (2 llegar a la ficha, 2 menú, 3×4 líneas, 2 "+ otro modelo", 1 observación, 1 "Validé el representante", 1 Guardar) | ficha 1.8 s (8 req) · guardar 2.3 s | 02–06 | Wizard de un solo paso: tipo (Servicio por defecto), duración 18, líneas modelo·cant·precio·"¿De quién es?", cargos, ITBMS, tarifario en vivo, representante. **"Guardar contrato" sale gris sin decir por qué** hasta marcar "Validé con el cliente que X sigue siendo el representante", que está al final del cuerpo (`10.txt`: "Guardar deshabilitado sin validar representante: true"). Tras guardar: toast persistente "creado — pendiente de aprobación · Ver documento" y la ficha muestra "Ahora · 1 · espera aprobación de administración · le toca a administración". |
| B. Aprobar | Alberto · home → señal "Pendientes por aprobar" (1) → fila → Centro · escritorio | **3** | home 2.4 s · aprobar 1.9 s | 10–13 | "Ahora" ofrece "Ver contrato" y "Aprobar". **Sin confirmación**; el toast dice el paso siguiente ("bodega asigna los seriales y luego sigue la firma"). Línea de tiempo 1/7 "Esperando seriales · le toca a bodega". El menú ⋯ muestra "Enviar para firma" **gris con el motivo** ("Bodega todavía no asignó los seriales; el anexo saldría vacío") → P0 #11 anterior **resuelto**. |
| C. Seriales | José · enlace del correo (`contratos/seriales.html?id=`) → rebota a Almacén · Asignar con el contrato abierto · escritorio | **13** (1 enlace, Tomar del estante, Selección automática, Asignar, Listo, 3×2 escanear+Enter, Lista verificada, confirmar) | rebote 3.4 s · asignación **18.4 s** (4.5 s de ellos esperando que el toast se quite de encima del botón) | 20–27 | Flujo sólido: picker con 356/490/226 disponibles, selección automática, hoja "Verificar la lista" (pick & confirm por escáner) y hoja "Listo para programar" que explica qué pasa después. **El toast "Desde el estante: 3 agregado(s)" tapa el botón primario "Listo para programar"** justo cuando la persona va a pulsarlo (`12.txt`: "tapado: toast toast-success"). En teléfono (28) la pestaña Asignar sirve: 4 de 38 objetivos chicos, sin scroll horizontal. |
| D1. Pedir firma | Karla · home → "Mis contratos por firmar" (1) → "Pedir firma" → Centro "Ahora" → Enviar para firma → Copiar · escritorio | **4** | enlace 1.9 s | 30–32 | La señal FIRV cuenta 1 y la fila dice "hoy · Pedir firma". El modal explica bien (quién debe firmar, reenviar por WhatsApp, qué pasa si firma otro) y ofrece Copiar o correo. **No dice nada de la vía en papel**, que está en el menú ⋯. |
| D2. Firmar | "El cliente" · `/firmar/?s=` · teléfono 390×844 | **7** (+ leer) | página 1.9 s · alto 2,314 px | 33–38 | Resumen, "Leer el contrato completo" (**el Anexo A trae los 3 seriales**, `13.txt`), nombre/cédula/cargo prellenados con el representante, 2 fotos + consentimiento Ley 81, firma, "Declaro que he leído…" **bloqueado hasta abrir el documento**, Firmar. Si cambias el nombre/cédula aparece la tarjeta "Documento que lo autoriza a firmar" (poder / certificado / acta) → correcto desde el 24-sep. Al pulsar Firmar, el botón pasa a "Subiendo evidencia…" y, si Storage no responde, el SDK reintenta en silencio (en mi caso, bloqueado a propósito): **sin barra ni tiempo estimado**. |
| D3. Activar | Trigger `onFirmaContrato` (simulado) | 0 | — | 70 | Cédula coincide → `activo`, `firmado_tipo: digital`, verificación pública creada. El documento v2 muestra el sello "Firmado electrónicamente por MARIA PRUEBA AUDITORIA · Hash…" en las 3 hojas y el QR. |
| E. Papel (alternativa a D) | Karla · menú ⋯ → Documento completo → imprimir → firma → escanear → Subir el contrato firmado → confirmar · escritorio | **9** | — | 50–51 | Confirmación explícita: **"Esto ACTIVA el contrato y arranca la facturación y la comisión"** → P0 (d) anterior **resuelto**. |
| F. Entrega | Recepción · orden de PROGRAMACIÓN → Entregar → acuse en tablet | (fuera de este módulo) | — | 52 | La tablet (`/firmar/tablet.html`) es un kiosko en espera ("Bienvenido · En línea"); recibe el acuse de **entrega**, no la firma del contrato. Si el contrato no está firmado, la entrega se bloquea con un modal que manda al enlace o al PDF (`ordenes-flujo.js:311-328`). |

**Total del camino feliz: 57 interacciones, 4 personas (vendedora, admin, bodega, cliente) + recepción en la
entrega, 6 pantallas (home, Centro, Almacén·Asignar, /firmar/, orden, tablet).** Las 21 de crear y las 13 de bodega son
razonables para lo que hacen; lo que **se atasca es el tiempo de espera entre personas**, no los clics: hoy hay 13
contratos esperando firma con una edad promedio de **50 días** (de 12 a 78), 10 de ellos sin ningún enlace enviado.

### 2.2 Estados: anular, cerrar, el doble "Aprobado"

| Flujo | Interacciones | Captura | Qué vi |
|---|---|---|---|
| Anular (admin, SERV20260930-02 aprobado con seriales) | **6** (⋯, Anular, elegir "Termina el acuerdo", motivo, Anular) | 53–55 | Modal claro: **"Se rehace el contrato — el cliente conserva los equipos"** (sustitución) vs **"Termina el acuerdo — el cliente devuelve los equipos"** (abre DEVOLUCIÓN), "Contrato que lo sustituye (opcional)" con la lista del cliente, motivo **obligatorio** ("Debes indicar un motivo." si vas sin él). Tras anular la ficha se refresca sola ("Al día · Nada pendiente"). Bien. |
| Cerrar un temporal (admin, TEMP20260908-01 con 20 radios en campo) | modal, no confirmado | 56 | "El contrato queda vencido… no se mueve ningún equipo… si lo que quieres es deshacer el papel, usa Anular" + aviso rojo "todavía tiene 20 equipo(s) en campo. Cerrarlo no los recupera… primero haz la baja". Es la distinción CERRAR ≠ ANULAR bien explicada. |
| "Cerrar el contrato…" en un contrato recién aprobado | — | 13, `11.txt` | El menú ⋯ de SERV20260930-03 **recién aprobado y sin seriales** ofrece arriba de todo "Cerrar el contrato… · el acuerdo terminó y no queda equipo en campo". No terminó: no empezó. `centro-acciones.js:195-209` lo ofrece siempre que `enCampo === 0`. |

**El doble significado de "Aprobado".** En la base, `aprobado` es a la vez (a) "aprobado, esperando seriales o
firma" (50 contratos) y (b) "histórico que opera sin firma en el sistema" (153 `legacy`, con entregas y órdenes).
Cada pantalla lo resuelve a su manera:

- El Centro etiqueta **todos** los 203 como "Aprobado (sin firma)" (`centro-regularizacion.js:239-243`: solo mira
  `fecha_activacion || firmado`, y de los 203 ninguno tiene `firmado === true`). Para un histórico que opera, "sin
  firma" suena a falta.
- El archivo pinta "Aprobado" + chip gris **"Histórico"** cuando `seriales_estado === 'legacy'`
  (`contratos-list.js:52-58`), y "Aprobado · Sin seriales" cuando faltan. Esa sí distingue.
- La señal del home "Contratos por firmar" los excluye (exige `seriales_estado === 'asignados'`). Correcto.
- La línea de tiempo del Centro **saca del trámite** al aprobado sin firmar a los **45 días** de creado
  (`centro-gestiones.js:187-194`): **10 de los 13 contratos "por firmar" del home ya no aparecen como trámite en la
  ficha de su cliente**; la ficha dice "Nada pendiente en esta cuenta" mientras el home dice "falta la firma". Son dos
  verdades contradictorias para la misma persona (Alberto ve ambas).

### 2.3 Lista de contratos (`contratos/index.html`)

| Rol · dispositivo | Tiempo | Captura | Qué vi |
|---|---|---|---|
| Admin · escritorio | 2.2 s · 2 consultas (caché + servidor) | 60–65 | 11 columnas (ID, Cliente, Tipo, Acción, Equipos, Estado, Papel, Devolución, Fecha, Creado por, Total) → **scroll horizontal a 1280 px** (`geometría: scrollHorizontal: true`); 152 de 157 objetivos < 36 px. Chips de estado y composición (Alquiler/Propio/Mixto, nuevo del 28-sep), "Devolución pendiente", "Mostrar inactivos", gestiones, "Solo abiertas", fechas, CSV. **Chip "Anulado" ya funciona** (P0 #14 anterior **resuelto**, captura 62). Chip "Aprobado" → "40 contratos · Cargar más" (son 203): el conteo del resumen es de la página, no de la base. Expediente en la fila (65): hitos + Anexo A por serial. Bien, salvo R2. |
| Admin · teléfono | alto **9,164 px** | 66 | El banner "Este módulo es de consulta" ocupa una pantalla entera y luego vienen **15 chips + 2 checks + 2 fechas** antes de la primera fila. |
| Karla (vendedor) · escritorio | 1.9 s | 67-vendedor | Ve **2** contratos: los que **ella creó** (`contratos-list.js:585`, `creadoPorUid`). Su cartera tiene 3 clientes con 5 contratos; `TEMP20260930-01` de un cliente suyo (creado por admin) no le sale. El Centro filtra por `vendedor_asignado`; el archivo por creador. **P1 anterior vigente.** |
| Contabilidad / recepción · escritorio | 2.0 s | 67-contabilidad, 67-recepcion | Iguales, contabilidad con la columna Total y recepción sin ella. Correcto para el need-to-know. |

**Señal "Contratos por firmar" verificada contra el emulador:** la fórmula del servicio
(`senalesService.js:294-306`: `estado == aprobado && seriales_estado == asignados`, sin `firmado`, sin
`entrega_confirmada`, sin REEMP/DEMO) da **13** con los datos del día, y el home de Alberto muestra **13**; filtrada por
`creado_por_uid` da 1 para Karla y el home muestra 1 (`11.txt`, `13.txt`). Cuadra. Lo que la señal no dice: de los 13,
**8 nunca recibieron enlace** (`firma_sol: null`), 5 tienen enlace vivo desde hace 12–71 días, 4 son PROP "Adición"
(¿lleva firma una adición de equipo propio del cliente?, ver preguntas), y 6 "trancan la entrega" (tienen orden). Y 5
aprobados con firma pendiente quedan **fuera** porque bodega no ha asignado seriales (correcto por diseño, pero nadie
los ve en ninguna señal salvo bodega).

### 2.4 Documento e impresión

| Caso | Captura | Qué vi |
|---|---|---|
| v2 pantalla vs impresión (SERV20260930-01, firmado por enlace) | 70, 71 | 3 hojas (contrato, condiciones, Anexo A con tarifa por serial y columna "Verif."). Aviso arriba: "Texto conforme al firmado digitalmente — copia congelada en la solicitud de firma (versión v2-2026-09-02)". Sello del cliente con hash en las 3 hojas; sello de la empresa "Alberto Yohros · Gerente General · 4:20 p.m." (la hora de la aprobación). QR + URL de verificación. **Pantalla e impresión coinciden** (misma estructura, `@media print` solo quita la barra). |
| Clásico (ALQ20260902-01, activo, papel) | 72, 73 | Formato viejo a 2 columnas de cláusulas. **"Pasaporte: PASAPORTE: XDB367055"**: la etiqueta se duplica (`contratos-imprimir.js`, `#labelRepresentanteDoc` + valor con prefijo). Dos sellos de la empresa (Alberto y Zuleika) y la firma del cliente en blanco: el papel firmado está en Storage, no se reconstruye. "Documento completo" del Centro ya respeta el formato (`_urlDocumento` → `DocumentoContrato.urlDocumento`): P1 anterior **resuelto**. |
| Representante con pasaporte (SERV20260918-01) | 74 | "representada por KAY NATHALY BERMUDEZ RODRIGUEZ, **pasaporte** 150685537": la palabra la decide `DocIdentidad` (`contrato-documento.js:99-104`). Correcto. |
| Firmante ≠ representante (ALQ20260828-03) | 75 | Banner amarillo: "se firmó digitalmente sobre el RESUMEN del enlace de firma: el texto completo no quedó congelado… las cláusulas mostradas son el texto vigente". Partes: "representada por ALBERTO Y, cédula 8" (dato de un cliente de prueba viejo); sello "Firmado por ALBERTO YOHROS · 8113456". La solicitud quedó `firmante_coincide: false` y el contrato se activó igual (fue aceptado). De las 4 solicitudes con firmante distinto, **ninguna tiene documento de autorización** (todas anteriores al 24-sep). |

### 2.5 Verificación pública `/c/<id>?v=` (teléfono, sin sesión)

| Caso | Captura | Resultado |
|---|---|---|
| Activo (ALQ20260902-01) | 80 | Verde "Contrato válido y vigente". Pero el campo **"Contrato" muestra `0tvyC3iqszzPIVmJQFTv`** (el ID interno del documento), no `ALQ20260902-01`: `verificaciones.contrato_id` guarda el docId. Un cliente no puede cotejar eso con su papel. La fecha sale `09/02/2026, 12:20 p. m.` (mes/día, T8 anterior). |
| Anulado en junio | 81 | **Verde "válido y vigente"** → R1. |
| Activo vencido por fecha | 82 | **Verde "válido y vigente"** → R1. |
| Código incorrecto | 83 | Rojo "Código incorrecto". Bien. |
| Anulado hoy (SERV20260930-02) | 84 | Rojo "Contrato ANULADO… ya no tiene validez" (en el emulador lo escribí yo con `02-simular-trigger.js verificacion`, que copia el estado real; en producción lo hace el trigger desde el 28-sep). |
| Enlace viejo `verificar-contrato.html?id=&v=` | — | Redirige a `/verify/index.html?id=…&v=…`. Bien. |

Qué certifica la página: que el código `v` coincide con el guardado para ese docId, y el estado **espejado**. No
verifica el hash de la firma del cliente ni muestra quién firmó ni cuándo; solo "Aprobado por" y la fecha de
aprobación. Para un contrato firmado por enlace, lo valioso (firmante, fecha, hash) está en el documento, no en la
verificación.

---

## 3. Hallazgos

### 3.1 Roto

Ver "ROTO HOY" (R1 verificación desfasada, R2 "Firmado en tablet", R3 filtro de devolución local). Además:

| # | Qué | Evidencia |
|---|---|---|
| B1 | "Pasaporte: PASAPORTE: XDB367055" en el clásico. | captura 72; `15.txt`: `rep clásico: … / Pasaporte: PASAPORTE: XDB367055` |
| B2 | La verificación pública muestra el ID interno del documento como "Contrato": el trigger guarda `contrato_id: contratoId` (el docId) en `verificaciones/`. | captura 80 (dato real); `functions/src/triggers/contratos/onApproval.js:296` |

### 3.2 Confuso

| # | Qué | Evidencia | Efecto |
|---|---|---|---|
| C1 | **"sin duración" junto a "Duración 18 meses"** en la vista del contrato aprobado; en el pendiente de aprobación la misma línea sale como "—" (la nota del auditor anterior: "el texto del trámite salió vacío"; era esto, no el trámite). `_vidaHtml` busca `fecha_vencimiento`, que no existe hasta activar. | capturas 11, 31; `centro-regularizacion.js:320-335` | El vendedor cree que falta un dato que ya puso. Maqueta §1. |
| C2 | **El paso "Firma del cliente" no dice cuál firma aplica ni cuánto lleva esperando.** "enlace de firma enviado — esperando" sin fecha, sin a quién, sin que exista la vía en papel (está en ⋯). El modal de enviar tampoco menciona el papel. La tablet no aplica y nadie lo dice; el archivo dice lo contrario (R2). | capturas 31, 32; `centro-gestiones.js:267`; `centro-firma.js:97-106` | Brenda persiguió firmas inexistentes (memoria del proyecto, 2026-09-15); los vendedores preguntan "¿esto cómo se firma?". Maqueta §2. |
| C3 | **Dos verdades sobre el mismo contrato**: a los 45 días el aprobado sin firmar desaparece del trámite del Centro, pero sigue en la señal del home. 10 de 13 hoy. | `centro-gestiones.js:188`; `00-datos.js` (edades 47–78 días) | Alberto abre la ficha desde la señal "por firmar" y la ficha le dice "Nada pendiente". P1 #10 anterior **vigente**. |
| C4 | **"Nuevo contrato" desaparece cuando la cuenta ya tiene un contrato vigente.** La cabecera y el menú ofrecen solo "Agregar equipos (anexo)", "Contrato temporal", "Demo", "Renovar cuenta". Es la regla "la unidad es la cuenta" (`centro-menu-gestion.js:27-33`, `centro-ficha-bloques.js:122-139`). Pero el equipo sigue hablando de "contrato nuevo" para un segundo servicio (otra sede, otro proyecto), y la corrida 2 de esta auditoría se cayó por eso. | `corrida2/10.txt`: "no encontré Nuevo contrato en #cgMenu"; capturas 06 (sin contratos: botón azul) vs 55 (1 vigente: solo "Nueva gestión") | Decisión de negocio que hay que explicitar en la pantalla ("¿Otro contrato? Entra por anexo o renovación") o reabrir. Pregunta para Alberto. |
| C5 | **"Cerrar el contrato…" arriba del menú en un contrato recién aprobado** (0 en campo). | `11.txt` menú ⋯; `centro-acciones.js:195-209` | Un clic en el lugar equivocado y el admin "cierra" (vence) un contrato que no empezó, con motivo prellenado. |
| C6 | **"Aprobado (sin firma)" para los 153 históricos que operan.** | `centro-regularizacion.js:239-243`; `00-datos.js` (aprobados firmado===true: 0) | "Sin firma" se lee como "falta algo" en contratos de 2024-2025 con radios entregados. |
| C7 | **"Guardar contrato" gris sin motivo** hasta marcar la validación del representante al final del cuerpo. Igual en el wizard de temporal (lo reportó el auditor del Centro). | `10.txt`; captura 05 | Clic en gris = nada. 1 intento perdido por contrato. |
| C8 | **El archivo del vendedor filtra por creador, el Centro por cartera.** | `contratos-list.js:585`; captura 67-vendedor | Un contrato de su cliente creado por admin no le aparece en el archivo. P1 #7 anterior **vigente**. |
| C9 | La vista del contrato activo tiene **una fila "Firmado"** que dice "digital — MARIA…" pero el expediente del archivo dice "tablet" (R2) y el documento dice "electrónicamente". Tres palabras para la misma firma. | capturas 31, 65, 70 | Glosario (T2 anterior). |
| C10 | El texto de la señal del home "Nuevo. Antes decía Contratos por activar…" sigue saliendo (marca hasta 10-02). Bien que exista, pero en la vista de Karla ocupa una fila entera del panel. | captura 30 | Menor. |

### 3.3 Lento

| # | Qué | Evidencia | Efecto |
|---|---|---|---|
| L1 | **El toast tapa "Listo para programar" 4–5 s** justo después de "Asignar seleccionados". | `12.txt`: "tapado al momento: toast toast-success"; captura 23 | El clic cae en el toast; José vuelve a intentar. Con 534 acciones de Almacén al mes, son segundos todos los días. |
| L2 | El rebote `contratos/seriales.html` → Almacén cuesta **3.4 s** (dos páginas). El correo a bodega sigue apuntando a `seriales.html`. | `12.txt` | Un correo que apunte directo a `almacen/index.html?tab=asignar&contrato=` ahorra una carga. |
| L3 | Lista en teléfono: **9,164 px** de alto, el banner de consulta y 19 controles antes de la primera fila. | captura 66; `15.txt` geometría móvil | Nadie la usa en el celular hoy (y así seguirá). |
| L4 | Lista en escritorio: scroll horizontal con 11 columnas; 152/157 objetivos < 36 px. | `15.txt` geometría | Columnas "Tipo", "Acción" y "Papel" podrían ser un chip en la celda del ID. |
| L5 | `/firmar/`: "Subiendo evidencia…" sin progreso; dos fotos de celular pueden pesar 4–8 MB en una red lenta. | `firmar/index.html:494-510` | El cliente no sabe si esperar o repetir. |

### 3.4 Lo que la auditoría del 28-sep decía y hoy está así

| Punto anterior | Hoy |
|---|---|
| P0 #11 enviar a firma con Anexo A vacío | **Resuelto**: botón gris con motivo hasta `seriales_estado === 'asignados'`; el Anexo A del enlace trae los seriales. |
| P0 #12 `done/4` fijo | **Resuelto**: 7 pasos reales con firma, 3 sin firma; chips "Esperando seriales / firma". |
| P0 #14 chip "Anulado" vacío | **Resuelto** (captura 62). |
| (c) sin paso de bodega en la línea de tiempo | **Resuelto**: "Seriales de bodega · le toca a bodega". |
| (d) subir el firmado activa sin confirmar | **Resuelto**: confirmación "Esto ACTIVA… y arranca la facturación y la comisión". |
| (h) anular sin motivo | **Resuelto** para contratos ("Debes indicar un motivo."). |
| (i) "le toca a" por regex; 45 días sin aviso | Parcial: "le toca a" ya es dato por paso; **los 45 días siguen** (C3). |
| P1 "ventas" → "administración" | **Resuelto** en los textos que vi ("espera aprobación de administración"). |
| P1 "Documento completo" siempre v2 | **Resuelto** (`_urlDocumento`). |
| P1 archivo filtrado por creador | **Vigente** (C8). |
| P1 filtros no persisten | **Resuelto** (`FILTROS_KEY`). |
| Guía `GUIA_CONTRATOS…md:20-23` desactualizada | **Actualizada** el 28-sep: ya dice "Centro de gestión → Nuevo contrato". Falta decirle que con un contrato vigente no hay "Nuevo contrato" (C4). |

Lo que el brief afirma y resultó distinto: pide medir "firma en tablet (recepción, viewport tablet)"; **no existe firma
de contrato en tablet**. Lo que existe es el acuse de entrega en tablet, que es de Órdenes.

---

## 4. Propuestas (de la más chica a la más ambiciosa)

| # | Qué cambia | Por qué | Ahorra | Cuesta | Riesgo |
|---|---|---|---|---|---|
| P1 | **Backfill de `verificaciones.estado`** (192 docs) + job semanal que compare `contratos.estado`/`vencimiento_estado` con `verificaciones.estado` y repare. | R1 | Que el QR no certifique contratos muertos. | 2–3 h (script Admin SDK + scheduled) | Bajo: solo escribe el espejo. |
| P2 | Textos: "Firmado en tablet" → "Firmado por enlace" (`archivo-expediente.js:70`); "Pasaporte: PASAPORTE:" (clásico); `verificaciones.contrato_id` = número de contrato (y mostrar el docId solo en pequeño). | R2, B1, B2 | Expedientes y verificación que se leen. | 1 h | Nulo. |
| P3 | **"Devolución pendiente" al servidor**: `where('devolucion_estado','==','pendiente')` (+ `cerrada_con_faltantes`) con su propia paginación; "sin registro" como chip aparte que sí sea local y lo diga. | R3; es lo que el plan de devolución diseñó. | 14 en vez de 1. | 2 h | Índice compuesto si se combina con orden por fecha. |
| P4 | **Vida del contrato en trámite**: en `_vidaHtml`, si el contrato no está vigente pero tiene duración, pintar "la vigencia (18 meses) empieza al firmar · vence ~ mes/año si se firma hoy"; "sin duración" solo cuando de verdad no hay `duracion`/`duracion_dias`. "—" nunca. | C1 | Cero contradicciones en la cabecera. | 1–2 h | Nulo. Maqueta §1. |
| P5 | **Paso "Firma del cliente" con las tres vías y la edad** (maqueta §2): "enviado el D-M a correo · abierto N veces · hace X días", botones Reenviar WhatsApp / Reenviar correo / Subir el firmado / Retirar; nota "en tablet no aplica". El modal de "Enviar para firma" también ofrece "¿Prefieres papel? Imprime y sube el firmado". | C2, C9 | Menos preguntas a Alberto; firmas que no se pierden 50 días. | 4–6 h (los datos ya están en `firma_solicitudes`: `creado_en`, aperturas auditadas) | Bajo. |
| P6 | **Los 45 días no sacan el trámite: lo marcan.** En vez de desaparecer, la fila pasa a "Esperando firma · 47 días · ¿sigue vivo este contrato?" con acciones Reenviar / Anular. La señal del home y la ficha dicen lo mismo. | C3 | 10 contratos hoy que nadie ve desde la ficha. | 2 h | Nulo. |
| P7 | **Confirmación en "Cerrar el contrato…" solo cuando no hubo entrega** y no ofrecerlo en un aprobado sin seriales/firma (`estado === 'aprobado' && !entrega_confirmada` → fuera del menú, salvo `cancelacion_pendiente`). | C5 | Evita vencer por error un contrato que no empezó. | 1 h | Nulo. |
| P8 | **"Aprobado (sin firma)" → "Aprobado · histórico"** cuando `seriales_estado === 'legacy'` o `entrega_confirmada`, igual que el archivo. | C6 | Un solo nombre por estado (T1). | 1 h | Nulo. |
| P9 | **Toast de Almacén fuera del camino del botón**: posición arriba-derecha en la pestaña Asignar, o 1.5 s, o inline sobre el formulario ("3 agregados desde el estante"). | L1 | 4 s × cada asignación. | 1 h | Nulo. |
| P10 | Correo a bodega con el enlace directo a `almacen/index.html?tab=asignar&contrato=`; `seriales.html` solo para el histórico. | L2 | 1 carga por asignación. | 1 h | Nulo. |
| P11 | **Archivo del vendedor por cartera** (`where vendedor_asignado ==` en el cliente del contrato, o `vendedor_uid` espejado en el contrato al crear/asignar vendedor). | C8 | Que el archivo y el Centro muestren lo mismo. | 3–4 h (espejo + backfill + índice) | Medio: hay que mantener el espejo al cambiar el vendedor del cliente. |
| P12 | **Lista compacta**: ID + chips (tipo, acción, papel) en una celda; Cliente; Equipos; Estado; Devolución; Fecha; Total (según rol). Banner de consulta como una línea con enlace, no una tarjeta. En teléfono, filtros en un cajón. | L3, L4 | Sin scroll horizontal; móvil usable. | 1 día | Bajo. |
| P13 | **"Guardar contrato" siempre activo; al pulsar sin validar el representante, llevar el foco al check y marcarlo en rojo** (T3/T10 anterior). | C7 | 1 intento perdido por contrato. | 1 h | Nulo. |
| P14 | **Progreso real en `/firmar/`**: `uploadBytesResumable` con porcentaje y "foto 1 de 2"; comprimir las fotos en el cliente a ~1 MB antes de subir. | L5 | Firmas que no se abandonan en 4G. | 3–4 h | Bajo. |
| P15 | **Verificación pública que certifique la firma**: mostrar número de contrato, firmante (nombre + documento enmascarado), fecha de firma y los primeros 8 del hash, además del estado. Hoy certifica la aprobación, no la firma. | §2.5 | Valor real del QR frente a un banco o un auditor. | 1 día (el trigger ya tiene los datos) | Medio: definir qué PII sale en público (nombre sí, cédula enmascarada). |
| P16 | **Decidir la regla "un contrato por cuenta"** (C4): o la pantalla lo explica ("Esta cuenta ya tiene contrato: lo nuevo entra como anexo o renovación · ¿Es otro servicio aparte? → Nuevo contrato (admin)") o se reabre "Nuevo contrato" con aviso. | C4 | Que una vendedora no se quede sin camino. | 2 h tras decidir | Depende de la respuesta de Alberto. |

**Si solo se hacen tres:** P1 (el QR no puede mentir), P5+P4 (la firma es el cuello de botella real: 50 días de
espera promedio) y P3 (la devolución pendiente es por lo que el equipo pidió el archivo).

**¿Rediseñar?** No. La decisión de mover el trámite al Centro y dejar `/contratos/` como archivo es correcta y las
pantallas nuevas (wizard, línea de tiempo, Asignar, `/firmar/`) están bien hechas. Lo que falta es **coherencia entre
las vistas del mismo hecho** (firma, aprobado, 45 días, cartera) y **mantener el espejo público**. Sí recomiendo
retirar `contratos/seriales.html` del camino de bodega (ya rebota) y no invertir más en el formato clásico.

---

## 5. Cómo saber si funcionó

| Medida | Antes (hoy) | Después (meta) | Cómo |
|---|---|---|---|
| Verificaciones con estado distinto al del contrato | 192 / 513 | 0 | `00-datos.js` bloque "verificaciones", semanal |
| Contratos "por firmar" > 30 días | 10 de 13 (promedio 50 días) | < 3; promedio < 15 días | `00-datos.js` bloque "señal", o la señal del home con edad |
| "Por firmar" sin ningún enlace enviado | 8 de 13 | 0 (todos con enlace o marcados "papel") | `firma_solicitud_estado` por contrato |
| Chip "Devolución pendiente" vs base | 1 vs 14 | iguales | captura + `devolucion_estado` |
| Asignación en Almacén (3 seriales, clic a clic) | 18.4 s con 4.5 s de toast | < 13 s | `12-bodega-asigna.mjs` |
| Vistas de `contratos/index` en teléfono | 0 | las que sean, sin scroll de 9,000 px | `uso_diario` + geometría |
| Contratos cerrados por error (vencido sin entrega) | ? | 0 | query `estado==vencido && !entrega_confirmada && fecha_activacion==null` |

---

## Top 5 impacto/esfuerzo del módulo

1. **Backfill + cuadre de `verificaciones.estado`** — el QR deja de certificar 192 contratos muertos · 2–3 h.
2. **Paso "Firma del cliente" con vías, edad y reenvío (P5) + vida proyectada (P4)** — ataca los 50 días de espera · 6–8 h.
3. **"Devolución pendiente" al servidor** — 14 en vez de 1 · 2 h.
4. **Toast fuera del botón en Almacén·Asignar + enlace directo del correo** — 4–5 s por asignación · 2 h.
5. **Los 45 días marcan en vez de esconder + "Aprobado · histórico" + textos (tablet, pasaporte, ID interno)** — una sola verdad por contrato · 4 h.

## Preguntas para Alberto

1. **¿Una cuenta con contrato vigente puede tener otro "contrato nuevo"?** Hoy la ficha solo ofrece anexo, temporal, demo o renovar (C4). Opciones: (a) mantener la regla y explicarla en la pantalla; (b) reabrir "Nuevo contrato" para admin/gerencia con aviso "esta cuenta ya tiene contrato"; (c) permitirlo a ventas también. (a) es coherente con "la unidad es la cuenta"; (b) cubre otra sede/otro proyecto sin romper la regla para ventas.
2. **¿Una adición de equipo PROPIO del cliente lleva firma?** 4 de los 13 "por firmar" son `PROP · Adición` de 2 meses. Si no la lleva (como REEMP/DEMO), hay que meter PROP-Adición en `ContratoFirma.SIN_FIRMA` y la señal baja a 9; si sí, hay que pedirla.
3. **¿Qué hacer con un aprobado sin firmar a los 45 días?** (a) marcarlo y escalar al vendedor por correo semanal (como las activaciones); (b) anularlo solo con motivo "sin firma" y avisar; (c) dejarlo. Hoy desaparece del trámite y nadie lo reclama.
4. **¿El enlace de firma debe caducar?** Hoy no caduca (7 vivos, el más viejo de julio). Un enlace de 30 días obliga a reenviar y deja rastro; uno eterno se puede firmar sobre un texto de hace meses.
5. **¿Qué certifica la verificación pública?** Hoy: aprobación y estado. ¿Debe mostrar firmante y fecha de firma (P15)? ¿Con la cédula enmascarada o sin ella?
6. **¿Se mantiene el formato clásico de impresión?** 299 de 313 vivos son clásicos pero ya no se crean. Si solo se consulta, no vale arreglarle más que el "PASAPORTE:" duplicado.
