# Plan de ejecución de la auditoría de módulos · 2026-10-01

> Alberto contestó las 18 preguntas de la sección E del [resumen](09-resumen-general.md) el 1 de
> octubre. Este documento traduce esas respuestas y la tabla "ROTO HOY" (sección A) en trabajo
> concreto por módulo, y fija las reglas para quien lo ejecute (agentes de IA, uno por módulo).
> Lo que Alberto decidió está en **negrita**; lo que queda pendiente de pregunta está marcado
> `[PENDIENTE]` y no se implementa hasta tener respuesta.

## 1. Decisiones de Alberto (1-oct)

| # | Tema | Decisión |
|---|---|---|
| 1 | Lector en bodega | **José NO usa lector: teclea.** La verificación por doble escaneo es urgente de quitar. |
| 2 | SIM en dos radios | **No debería pasar. El app AVISA y PIDE MOTIVO**, no bloquea. |
| 3 | Entrega con firma en papel | **Pedir la nota (foto). Se permite cerrar sin nota con advertencia** "no quedará registro de la entrega en el sistema" **y pidiendo la razón.** |
| 4 | Correos por entrega | **Cliente, vendedor, recepción y jefa de taller.** El técnico ya no. |
| 5 | Recepción y ventas en Almacén / Centro | **NO pueden recibir ni vender desde Almacén. SÍ pueden iniciar reemplazos, bajas y terminaciones desde el Centro.** |
| 6 | Contrato nuevo con cuenta vigente | **SÍ, como función de respaldo, no principal.** Se pregunta y se guarda la razón por la que se crea un contrato en vez de anexo o renovación. |
| 7 | Aprobado sin firmar a los 45 días | **Caduca la solicitud y el enlace. Queda dormida; la reactiva el vendedor. No bloquea otros trámites; para todos los efectos es como si no existiera, un borrador para el futuro.** |
| 8 | "Por clasificar" (D7) | **NO cuenta en el chip de la cuenta ni dispara "Regularizar con contrato nuevo".** |
| 9 | Deuda de migración del pool | **Masivo, si es posible.** `[PENDIENTE]` qué regla: (a) sin movimiento desde julio → baja "paradero desconocido (migración)"; (b) se quedan pero fuera de contadores y pestañas de trabajo; (c) cruzar con la Base PoC para ponerles modelo y cliente antes. |
| 10 | Serial con dos fichas PoC vivas | **La buena es la MÁS RECIENTE. Se cruza con la custodia del pool para ver si coinciden; si la custodia del pool viene de la migración, no vale.** |
| 11 | Aprobación de cotizaciones comerciales | **Aprueban los administradores (Alberto y Zuleika).** `ventas@` les llega a los dos: la config está bien; el texto "gerente" sobra. `[PENDIENTE]` política vigente: ¿15 %/$5,000 (brief) o 20 %/$15,000 (config)? |
| 12 | Cotización vencida | **El vencimiento es el fin de la cotización; no requiere más acción.** Si luego se cierra la venta, el vendedor igual la puede marcar como vendida. Sin recordatorios ni "posponer". |
| 13 | Bandeja de facturación (Brenda) | **No se sabe si factura sin marcar.** Preparar un **correo a Brenda** explicando cómo funciona el registro de facturas (posiblemente no lo sabe usar), y **revisar a fondo todas las instancias de facturas y notificaciones**: le toma mucho tiempo y no se conecta bien con las pantallas donde trabaja. |
| 14 | Pestañas de futuro en Finanzas | **SÍ esconder** "Facturará la app", "Emisión" y "Panorama" hasta que exista la emisión. |
| 15 | Refurbished y QuickBooks | **QuickBooks factura POR MODELO, no por estado** (nuevo/refurbished). Los -R usan el ítem y la mensualidad del modelo base. (Los radios que entran a un contrato se sacan del inventario de QBO a mano y entran a depreciación: fuera del alcance del app por ahora.) |
| 16 | Primer pago de comisiones | **Cheila o Zuleika, en lote.** |
| 17 | Roles | **Andrea sigue como recepción** (cubre el puesto a veces). **Contabilidad debe ver Finanzas, Centro de gestión y Clientes.** |
| 18 | Bodega y catálogo | **SÍ**: bodega ve el catálogo de modelos sin precios, y Piezas le oculta el costo. |

## 2. Reglas para quien ejecute

1. **Un agente por módulo, mismo árbol de trabajo.** Edita solo los archivos de tu módulo; si tienes que
   tocar un archivo compartido (`firestore.rules`, `public/js/core/modulos.js`, `public/js/ui/toast.js`,
   `busquedaGlobalService.js`, `functions/src/...`), **vuelve a leerlo justo antes de editarlo** y haz
   cambios mínimos y localizados: otro agente puede estar en el mismo archivo.
2. **Commitea tú mismo cada cosa terminada y probada**, con pathspec explícito y nunca `git add -A`:
   `git add <archivos> && git commit -m "<mensaje>" -- <archivos>`. Mensaje en español, estilo del
   repo (`fix(ordenes): ...`), y al final la línea `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
   Hay otras sesiones trabajando en este repo: lo que no está commiteado se lo puede llevar otro commit.
   Nunca commitees `docs/auditoria-modulos/capturas/` ni `emu-data.json`.
3. **Pruebas:** los emuladores están arriba (hosting 5000, Firestore 8080, Auth 9099) sembrados con
   producción. Antes de probar en el navegador corre `npm run build` (2-3 s; si una página falla por un
   chunk que no existe, otro agente estaba construyendo: vuelve a construir y reintenta). Usa
   `tools/emulador-almacen/emu-lib.mjs` como en la auditoría (ver [00-metodo.md](00-metodo.md) §3);
   reutiliza los scripts de `scripts/<modulo>/` para medir antes/después. `node --check` de cada archivo
   tocado; `cd functions && npm test` si tocas functions. El emulador recarga `firestore.rules` solo al
   guardar el archivo.
4. **Nada contra producción.** Ni Admin SDK sin `FIRESTORE_EMULATOR_HOST`, ni `firebase deploy`, ni
   `gcloud`. Los backfills de datos se escriben como job del panel admin (`runBackfill`, patrón existente)
   o como script en `tools/`, se prueban en el emulador y se **reportan con conteos**; los corre Alberto o
   el coordinador después.
5. **Si una decisión no está en la tabla de arriba ni en tu informe, no la supongas:** anótala en tu
   respuesta final como pregunta y sigue con lo demás.
6. **No rompas lo que funciona.** Los informes dicen qué P0 anteriores están resueltos: no los deshagas.
   Recuerda las reglas del repo: `ordenes_de_servicio` está al tope de 1,000 expresiones en rules al
   DENEGAR; un diff vacío pasa cualquier `hasOnly`; los saneos CIERRAN, no eliminan; no trancar a recepción.
7. Español de Panamá, tuteo. Textos de pantalla cortos y en el vocabulario que ya usa el app.

## 3. Trabajo por módulo

Cada lista va en orden: primero lo ROTO HOY (R), luego las decisiones (D) y luego las propuestas del
Top 5 del informe que Alberto no vetó. Los números entre corchetes son los del informe del módulo.

### 3.1 Órdenes · [01-ordenes.md](01-ordenes.md) · ola 1

- R1 "Ver entrega" lee `entrega_persona_interna`, `no_recibido_motivo` y `nota_firmada_url` cuando la firma fue en papel.
- R2 **Filtros por URL consultan al servidor** como el chip (`?estado=`, `?mias=`), y un deep-link nuevo
  `ordenes/index.html?ids=<id>[,<id>…]` carga esas órdenes directo, estén o no entre las 40 recientes
  (sustituye el `?orden=` que solo filtra la primera página). Es el contrato que el agente de Home usará
  para las señales, "Órdenes sin movimiento" y el resultado de orden en Ctrl+K. Mantén `?orden=` como alias.
- R3 Fechas en hora de Panamá (`formatFecha` de `ordenes-state.js`, `imprimir-orden.js`); un solo formato corto en el módulo (C3).
- R4 + transversal 3: **el toast no debe tapar botones**: en `public/js/ui/toast.js` mueve la región del
  toast arriba (o fuera del `.modal-footer`) para todo el app; verifica en teléfono (técnico) y en
  Almacén→Asignar (informe 06 L1). Y que "Guardar y siguiente" no descarte texto sin guardar.
- R5 Enter en el serial del lote = fila nueva (escáner/teclado).
- D3 Entrega en papel: pedir la foto de la nota; permitir cerrar sin nota con advertencia textual "no
  quedará registro de la entrega en el sistema" y razón obligatoria (guardarla).
- D4 Correos de entrega: cliente, vendedor, recepción y jefa de taller. Quitar al técnico (busca dónde se
  arman: `functions` `onOrdenEntregada`/plantillas o `ordenes-flujo.js`).
- P4 + P6 Bandeja legible a 1280/1024 con rail abierto (número y chips sin cortar) y lápiz de editar
  equipos visible (hoy `opacity: 0`, 16×20 px).
- R7 El chip activo no se desmarca al tocarlo de nuevo. R6 si es barato.

### 3.2 Almacén · [04-almacen.md](04-almacen.md) · ola 1

- R1 + D5 **Recepción y ventas no reciben ni venden desde Almacén**: topbar por rol (solo lo que su rol
  puede) y, si cabe sin reventar el tope de rules ni romper lo que recepción sí hace sobre `equipos_pool`
  (asignar seriales de gestiones, órdenes), cerrar en `firestore.rules` las transiciones de venta y
  recepción a bodega a `inventario`/`administrador`. Toasts de permiso legibles (B3).
- R2 KPIs de Existencias honestos: "por inspeccionar" solo lo que no está en una ENTRADA abierta; "modelos
  con diferencia" solo conteos de ≤30 días o con etiqueta "viejos"; fila "(sin modelo)" única y explicada (C1).
- R3 "Recibir equipos" se cierra al recibir.
- D1 + P7 **Verificación solo de lo que no se escaneó/tecleó a mano**: lo que vino del picker se verifica;
  lo tecleado ya está verificado. Medir con `scripts/almacen/03-asignar-lector.mjs` (25 radios: 54 → ~29).
- D18 Bodega ve `inventario/modelos.html` sin precios ni mapeo QBO; Piezas oculta el costo a `inventario`.
- L1 Buscar un serial en Avanzado consulta por serial normalizado (no baja el pool). (El pool en Ctrl+K lo hace el agente de Home.)
- B1 El filtro de modelo de Recibir no roba el foco a media palabra. B4 transacciones con `esperado`. R4 si es barato.
- D9 `[PENDIENTE]`: no tocar la deuda de migración hasta que Alberto escoja la regla.

### 3.3 PoC · [03-poc.md](03-poc.md) · ola 1

- R1 "Preparar lote (Ventas)" carga la lista completa de clientes (`fresh`), y la caché de 6 h no puede
  dejar fuera clientes nuevos.
- R2 + D2 **Validar la SIM en los cuatro caminos** (cajón, edición masiva, "Asignar del pool", lote): si el
  SIM está activo en otra ficha viva, **avisar con el radio y el cliente donde está, y pedir motivo**
  obligatorio; guardar el motivo (en la ficha y en `poc_logs`). No bloquear.
- R3 + D10 + P6 Duplicados por serial: agrupar por serial, marcar **la más reciente como la buena**,
  mostrar si coincide con la custodia del pool (y "custodia por migración: no vale"), cerrar las demás en
  lote; al cerrar una no volver a la página 1 ni perder el buscador. Script de saneo masivo probado en el
  emulador con conteos (cuántas se cerrarían con la regla); **no se corre en producción** sin aprobación.
- B2 Cerrar una ficha pone `activo:false`. B1 la fila refleja el SIM nuevo tras "Asignar del pool".
- P4 Cabecera con el total del cliente (activos/inactivos/seleccionados) y "incompleta" honesta (C1, C2).
- P5 (SIM en la fila) si queda tiempo.

### 3.4 Contratos · [06-contratos.md](06-contratos.md) · ola 1 (incluye functions)

- R1 **Backfill de `verificaciones.estado`** (estado real; `vencido` si `vencimiento_estado === 'vencido'`)
  como job de `runBackfill` + **cuadre semanal** (cron) o cuadre en `onContratoWrite`. Probar en el
  emulador y reportar cuántos cambiarían (esperado ~192). La verificación pública muestra el número de
  contrato, no el ID interno (B2).
- R2 Texto "Firmado en tablet" → "Firmado por enlace" (y una sola palabra para la firma digital: C9).
- R3 "Devolución pendiente" consulta `devolucion_estado == 'pendiente'` al servidor; "sin registro" como vista aparte.
- D7 **Solicitud de firma que caduca a los 45 días**: cron diario marca la solicitud (`firma_solicitudes`)
  y el contrato como **dormido** (estado explícito, no borrado); el enlace `/firmar/?s=` rechaza las
  caducadas con un mensaje claro; el Centro muestra el contrato dormido como "borrador de solicitud" con
  botón **Reactivar** (solo vendedor/admin: nueva solicitud y nuevo enlace); el dormido **no cuenta** en
  "Contratos por firmar" ni bloquea otros trámites de la cuenta. Coordina con el agente de Home el
  predicado de la señal (`senalesService`).
- D6 "Nuevo contrato" vuelve a estar disponible con cuenta vigente, **como acción secundaria** (al final
  del menú, no en la cabecera), con un campo obligatorio "¿Por qué un contrato nuevo y no un anexo o
  renovación?" que se guarda en el contrato (`motivo_contrato_nuevo`) y se ve en el expediente.
- P5 + P4 Paso "Firma del cliente" dice la vía (enlace/papel), a quién se envió, hace cuánto, y permite
  reenviar; "sin duración" junto a "Duración 18 meses" (C1). C5 "Cerrar el contrato…" no encabeza el menú
  de un recién aprobado. B1 "Pasaporte: PASAPORTE:".
- C6 "Aprobado (sin firma)" en históricos → "Aprobado · histórico".

### 3.5 Cotizaciones · [02-cotizaciones.md](02-cotizaciones.md) · ola 2

- R1 Eliminar escribe el espejo público (`cotizacion_verificaciones`) como cerrada; la vista pública lo lee.
- R2 `CotState.toUi` copia los siete campos (rechazo, descarte, aprobación, respuesta del cliente).
- D11 Aprueban administradores: textos y comprobaciones que digan "gerente" pasan a "administración";
  `verTodasCot`/aprobación: admin. La config de correo (`ventas@`) se queda. `[PENDIENTE]` umbral: no tocar.
- D12 Vencida es terminal: no recordatorios ni "posponer" (descarta la propuesta 11); comprobar que desde
  `vencida` el vendedor pueda marcar "convertida" (si no, permitirlo con motivo).
- C1 + P4 Tarjetas y segmentos de la lista con un solo alcance y una sola lectura (y menos `count()`).
- P6 Autoguardado del borrador de taller con debounce de 2.5 s y en blur.
- C2 Eliminar: solo borradores; para enviadas, "Descartar" con motivo (o "Rehacer" = duplicar + descartar).
- C9 anchos de columna; C10 "Cotizar" solo en estados con intervención.

### 3.6 Centro y Clientes · [05-centro-clientes.md](05-centro-clientes.md) · ola 2

- R1 Búsqueda tolerante: el término se tokeniza igual que lo guardado (guiones), RUC con y sin guiones, prefijos.
- R2 Historial sin cambios fantasma: `buildClientePayload` no cuenta como cambio el relleno de valores por defecto.
- R3 + D8 `deuda` excluye D7 (por clasificar); el primario de la cabecera es la primera fila de "Ahora";
  "por clasificar" se muestra como "Bodega · n" sin disparar nada.
- D5 Recepción sigue pudiendo iniciar gestiones (no cambiar `puedeCrearGestion`).
- P4 **Selectores de seriales con buscador y grupos** en los cuatro wizards (reemplazo, baja, cambio de
  serial, renovación): de 273 filas a teclear 4 caracteres; "No disponible" al final o colapsado.
- B1 "0 inactivos"; B2 resumen de búsqueda; B3 ningún modelo preseleccionado en los wizards (y el modelo
  "1-19000-00011 SC2020" fuera del catálogo seleccionable si es basura: confírmalo con `modelos`).
- C7 Aprobar con resumen de 4 líneas y confirmación; C4 "Guardar contrato" gris con motivo visible.
- C5 RUC con formato en cabecera y directorio; C6 un solo formato de fecha.

### 3.7 Facturación · [07-facturacion.md](07-facturacion.md) · ola 2

- D14 Esconder "Facturará la app" (Activación), "Emisión" y "Panorama" para todos (código se queda; se
  reactivan con la emisión). Con eso R1 (Panorama a contabilidad) deja de aparecer; igual arregla la
  regla si contabilidad necesita listar cotizaciones para algo más.
- R2 "Ver hechos y no aplica" consulta al servidor aunque haya cerrados locales.
- R3 Trigger: al anular o vencer un contrato se cierran sus avisos (`no_aplica` con motivo); el chip "En
  espera" muestra el correo en error y permite reenviar.
- D15 Los modelos -R **heredan el ítem/bundle y la tarifa QBO del modelo base** (`variante_de` o por
  familia) en readiness, preview y mapeo: "213 sin mapeo" debe bajar a ~60 sin escribir en `modelos`.
- D16 + P9 Confirmación del primer pago de comisiones **en lote** para contabilidad y admin.
- P5 Número de factura visible y reutilizado (confirmar al marcar sin número, chip "Sin número",
  Comisiones lo toma del aviso).
- D13 **Revisión a fondo de la bandeja desde la silla de Brenda**: cómo llega a un aviso desde la orden,
  la cotización de taller o el contrato donde está trabajando, y de vuelta; qué le toma tiempo; qué
  notificaciones recibe y cuáles sobran. Implementa los enlaces/atajos que falten (aviso ↔ orden /
  cotización / contrato) y **redacta el correo a Brenda** explicando cómo funciona el registro de
  facturas (≤250 palabras, resultado primero, una sola acción pedida) y entrégalo en tu respuesta final.
- P8 Señal del home "avisos con más de 7 días" y "comisiones listas" (coordina con el agente de Home: tú
  escribes el predicado en `senalesService`, él la pinta).

### 3.8 Home, navegación y admin · [08-home-navegacion-admin.md](08-home-navegacion-admin.md) · ola 2

- R1 KPI de contratos del panel admin sin borrados (como el de órdenes).
- R2 + P2 Señales de órdenes, "Órdenes sin movimiento" y el resultado de orden de Ctrl+K apuntan a
  `ordenes/index.html?ids=…` (contrato del agente de Órdenes, ya implementado en ola 1); nada apunta a
  `editar-orden.html` salvo "Editar cabecera" en POR ASIGNAR.
- P5 Ctrl+K busca el pool por serial (bodega) y el resultado de cliente abre el Centro directo.
- D17 Contabilidad ve **Finanzas, Centro de gestión y Clientes** (`modulos.js`, `roles.js`, rules si hace
  falta) y su home trae las señales de Finanzas (avisos con más de 7 días, comisiones listas: predicado del
  agente de Facturación) en vez de un home vacío. Andrea se queda como recepción.
- Señal "Contratos por firmar" excluye los dormidos (predicado del agente de Contratos).
- P8 **Franja de contexto con enlaces cruzados**: en el detalle de orden, el cliente y el contrato; en la
  ficha del Centro, las órdenes abiertas; en la ficha del pool, el cliente y el contrato; en el contrato,
  los seriales en Almacén. Misma pestaña (Alberto no pidió pestaña nueva).
- R4 Consultas del home con `limit(150)` sin `orderBy` → `orderBy` + tope explícito con aviso. C8 ruido
  de "Requiere atención". P4 salida del teléfono en Órdenes (botón Menú en la barra inferior) si no lo
  hizo el agente de Órdenes.

## 4. Orden y cierre

- **Ola 1** (en paralelo): Órdenes, Almacén, PoC, Contratos. **Ola 2**: Cotizaciones, Centro, Facturación,
  Home. Home va último porque depende de los contratos de Órdenes (`?ids=`), Contratos (dormidos) y
  Facturación (señales).
- Al cerrar cada ola, el coordinador revisa `git log`, corre `npm run build` y un barrido de páginas con
  `emu-lib`, y despliega: `firebase deploy --only firestore:rules`, functions (con `CI=true`, sin matarlo,
  exigir "Successful update operation") y hosting desde un worktree limpio.
- Backfills y saneos (verificaciones, duplicados PoC, deuda de migración) se corren en producción solo
  con el OK de Alberto, con el conteo del emulador a la vista.
