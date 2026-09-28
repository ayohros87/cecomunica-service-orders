# Auditoría UX/UI del sistema, vista de ingeniería industrial — 2026-09-28

> **Alcance:** las 99 páginas HTML de `public/` (unas 80 de trabajo, el resto redirecciones,
> impresión y públicas) y sus scripts en `js/pages`, `js/ui`, `js/core` y `js/services`, al
> commit `f1aa065`. Método: lectura de código por 7 auditores en paralelo (shell, Órdenes,
> Centro y Contratos, Clientes y Cotizaciones, Almacén, PoC y Finanzas, Admin), con la misma
> rúbrica: para qué sirve cada pantalla, qué rol la usa, desde dónde se llega, pasos exactos
> del usuario con conteo de interacciones (1 click, 1 campo tecleado, 1 confirmación o 1 gesto
> = 1 interacción), mapa de estados, hallazgos con evidencia `archivo:línea`, y contraste con
> la auditoría del 2026-08-13. Los P0 que encabezan el informe se re-verificaron a mano.
> Ningún archivo del app fue modificado. Nada se probó en navegador ni en dispositivo: todo
> sale de leer el código, y la sección 9 dice qué no se pudo confirmar.
>
> **Prioridad:** P0 = roto hoy, dato falso o instrucción que no se puede cumplir ·
> P1 = quick win (horas) · P2 = proyecto (días). Las rutas son relativas a `public/` salvo
> que se indique `functions/`.

---

## 0. Veredicto general

Desde la auditoría de agosto hubo 467 commits y el sistema **cambió de piel**: los diálogos
nativos (`confirm`/`prompt`/`alert`) desaparecieron del código de la app (quedan 17, todos en
la definición del kit y en `tools/`), `Modal.confirm` tiene 126 usos, el atajo Ctrl+K vive en
las 62 páginas que cargan `layout.js`, las señales del home ya aterrizan filtradas, la
renovación de contrato bajó de ~22 a 4-6 interacciones, el módulo viejo de contratos se
retiró y el Centro de gestión concentra todas las gestiones del cliente, el espacio Almacén
concentra el trabajo de bodega, y la numeración de órdenes ya es atómica. **De los 12 P0 de
agosto, 10 están resueltos y 2 quedaron a medias.**

La fricción de hoy tiene otra forma. Ya no son botones muertos: son **números que mienten,
nombres que no coinciden y caminos que llevan a un callejón sin salida.**

1. **Datos falsos en las pantallas de mando.** Los 4 KPI del panel admin y 3 chequeos de
   Operación e Integridad usan nombres de estado que no existen (`'COMPLETADA'`,
   `'ENTREGADA'`, `'EN PROCESO'`), así que "Órdenes abiertas" cuenta solo POR ASIGNAR y
   "entregadas sin firma" siempre sale en verde. El reporte de pendientes de Órdenes omite
   toda orden creada en la app. Existencias no cuenta los radios "no retirados". Una
   renovación aprobada pero sin firmar ya marca a sus orígenes como "renovado ✓". El
   historial de cotizaciones registra el rechazo del gerente como "el cliente declinó". La
   verificación pública certifica "Contrato válido y activo" sin mirar el estado.
2. **Un mismo concepto con 2, 3 o 4 nombres y 2 paletas de color.** "Registro (Ventas)" /
   "Carga rápida" / "Vendedores (batch)" / "Preparar Equipos PoC" son la misma página, y
   además no registra nada. "Cuarentena" / "Devuelto · por inspeccionar" / "Por inspeccionar"
   / "Inspección" son el mismo estado del pool. "POR ASIGNAR" en Órdenes significa en realidad
   "por recibir". "Aprobado" en contratos significa a la vez "esperando firma" y "contrato
   histórico operando". La marca se escribe de 4 formas y "Centro de gestión" es a la vez el
   nombre del app y el de un módulo.
3. **Caminos sin salida y dobles caminos.** Bodega recibe la instrucción "regístrelo a mano
   en Descartados" y esa página no tiene alta; recibe "abre un cambio de serial desde la
   ficha del cliente" y su rol no tiene ese módulo. Hay dos formularios de cliente (uno de
   ellos borra correos y etiquetas al guardar), dos editores del catálogo de modelos, dos
   páginas para cargar equipos a una orden, dos importadores de Excel de bodega, tres
   pantallas de conciliación, dos páginas de precios de piezas, tres pickers y dos lienzos
   de firma.
4. **Doble submit donde más cuesta.** Las 6 acciones que crean gestiones en el Centro no
   tienen candado: dos clicks crean dos expedientes con dos correlativos y dos correos de
   aprobación. Lo mismo al asignar técnico, al enviar cotización y en la edición masiva de
   PoC. El helper `withBusy` que agosto pidió no existe; hay 144 `.disabled = true` a mano.
5. **Bodega sin lector de barras real.** En el asignador de seriales Enter no avanza de
   casilla y el segundo escaneo se pega al primero; en el Conteo Enter no pasa al siguiente
   modelo; corregir un serial cuesta 8 interacciones y obliga a salir del espacio Almacén.

Se encontraron **31 defectos P0**, unos **90 quick wins P1** y **22 proyectos P2**. Las
secciones 2 y 3 dan la lista transversal; la sección 4 va módulo por módulo con los pasos
del usuario y los cambios propuestos; la sección 7 es el plan.

### Tabla de interacciones (camino feliz, app abierta)

| Flujo | Hoy | Propuesto | Qué lo logra |
|---|---|---|---|
| Recepción crea orden REPARACIÓN con 2 equipos y la recibe | ~19 | ~15 | "Guardar y recibir" al final de agregar-equipo; campo "Falla reportada" |
| Técnico registra intervención en 3 equipos y completa | ~12 | ~9 | "Guardar y siguiente" + "marcar todos" en el modal |
| Entrega con firma en papel (7 de cada 10 en septiembre) | 6 | 4-5 | Casilla "firmó en papel" arriba del bloque de firma |
| Vendedor crea contrato de alquiler con 3 equipos | 10-18 | 8-14 | Tipo "Alquiler" visible y modalidad Alquiler por defecto por línea |
| Renovación | 4-6 | 4-6 | Ya óptimo (era ~22 en agosto) |
| Reemplazo de un equipo dañado | 6 + 1 confirm de JSON | 5 | Quitar el confirm "JSON para recepción" del momento equivocado |
| Cotización comercial de 3 líneas, guardada y enviada | ~15 | ~13 | Aterrizar con el modal de envío abierto (`?enviar=1`) |
| Alta de cliente con RUC/DV | 14-15 | 13 | Autocompletar el DV y avisar duplicados al salir del RUC |
| Bodega asigna 20 seriales con lector | 1 + 20 escaneos + 19 Tab/click | 1 + 20 escaneos | Enter salta a la siguiente casilla vacía |
| Sumar 10 unidades a una pieza | 10 clicks + 10 recargas | 2 | Campo "±N" con motivo |
| Corregir un serial mal transcrito | ~8, saliendo a la página avanzada | ~4 | "Corregir serial" en la ficha de Almacén (el servicio ya existe) |
| Recepción trabaja un aviso de facturación | 6 | 6 | Ya óptimo |
| Cerrar comisiones de una planilla de 15 | 5-6 × 15 | ~4 por planilla | Cierre en lote por vendedor y período |
| Vendedor entrega un lote PoC a recepción | 9 + 3 fuera del app | 9 dentro del app | Traspaso del lote preparado dentro del sistema |
| Cambiar de módulo desde Órdenes en el teléfono | 3 + scroll | 2 | Botón "Menú" en la barra inferior |
| Cliente firma acuse en la tablet | 4 | 2 | Prellenar nombre y cédula desde la solicitud |

---

## 1. P0: roto hoy, dato falso o instrucción imposible

Los marcados con ✔ los re-verifiqué a mano contra el código; los demás vienen del auditor del
módulo con evidencia `archivo:línea`.

### Shell, sesión y páginas públicas

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 1 ✔ | **La verificación pública certifica "Contrato válido y activo" sin mirar el estado.** El único texto de estado en la página es ese literal; el trigger sale temprano cuando el contrato no está `activo`/`aprobado`, así que `verificaciones` no se entera de anulaciones ni vencimientos. Además inyecta `cliente_nombre` y datos del aprobador sin escapar y expone su correo y rol. La página huérfana `verificar-contrato.html` sí valida y escapa. | `verify/index.html:119`; `functions/src/triggers/contratos/onApproval.js:114`; `verificar-contrato.html:64,88` | Un contrato anulado se certifica como vigente ante terceros (el QR está impreso en los contratos) |
| 2 ✔ | **Los atajos de una tecla del home ignoran Ctrl/Cmd.** Ctrl+F abre "Mi firma de correo", Ctrl+C va a Contratos, Ctrl+P a PoC (y además imprime). La tarjeta del Centro anuncia la tecla G y no hay handler para `g`. | `index.html:330-343`, `:135` | El usuario "sale volando" del home al intentar buscar o copiar |
| 3 ✔ | **Cierre de sesión y expiración redirigen a `"login.html"` relativo** (14 sitios más el guard): desde `/ordenes/`, `/contratos/` o `/admin/` eso es un 404 y el guard cierra la sesión sin decir por qué. | `js/firebase-init.js:306`; `agregar-equipo.js:323`; `ordenes-nuevo-batch.js:813`; `ordenes/config.html:33,37`; `modelo-de-radio.html:30,36`; `estado_reparacion.html`; `cerrarSesion()` en 6 páginas más | 404 al salir o al vencer la sesión |
| 4 | **En Órdenes móvil casi no hay forma de ir a otro módulo.** ≤768 px el topbar se oculta, el FAB del rail no se inyecta porque existe `#mobileBottomNav`, y esa barra solo tiene Órdenes/Nueva/Filtros; la salida está en Filtros → scroll → "Menú principal". Entre 769 y 1024 px no hay ni drawer ni FAB. | `css/ordenes-index.css:1556`; `js/core/layout.js:313`; `ordenes/index.html:621-635,704` | La pantalla más usada es la peor para navegar en el teléfono |
| 5 | **El resultado PoC del Ctrl+K no enfoca nada:** manda a `/POC/index.html?focus=…` y ninguna página lee `focus`. | `js/services/busquedaGlobalService.js:164` | +2 interacciones: aterrizas en la lista y buscas de nuevo |

### Órdenes

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 6 ✔ | **El reporte de pendientes omite todas las órdenes creadas en la app.** `filterByStatuses` ordena por `fecha_entrada`, campo que solo escribe el importador de Excel; Firestore deja fuera los docs sin ese campo. Además excluye RECIBIDO y COMPLETADO y las columnas Fecha/Vendedor leen campos que las órdenes nuevas no tienen. | `js/services/ordenesService.js:1732-1736`; `js/pages/importar-exportar.js:83`; `ordenes/reporte-pendientes.html:119,147,159` | El reporte impreso "de lo pendiente" sale casi vacío |
| 7 ✔ | **El importador de Excel corrompe datos si sigues su propia plantilla:** `id = row.id \|\| row.orden_id` manda las filas de equipo (que traen `id: "eq001"`) a una orden fantasma; `setOrder` usa `set()` sin merge y pisa firmas, QC y cliente al reimportar; sin vista previa; solo exige estar logueado. | `js/pages/importar-exportar.js:12-16,57,174-177`; `ordenesService.js:1723` | Pérdida de datos con un archivo bien intencionado |
| 8 | **El correo "Nueva orden creada" muestra el UID del vendedor** en vez del nombre, y el enlace va a la bandeja sin `?orden=`. | `js/pages/nueva-orden.js:138,587,680-695` | Correo inútil para quien lo recibe |

### Centro de gestión y Contratos

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 9 ✔ | **Una renovación aprobada pero sin firmar ya "renueva".** `_esVigente` incluye `aprobado`; `renovado_por_ids` se escribe al crear; `_renovadoPor` acepta cualquier renovador vigente. Los orígenes pasan a Histórico como "renovado ✓", la renovación no sale en la tabla porque está en trámite, y la franja "Vigentes / Mensual" la cuenta. | `js/pages/clientes-centro.js:509,532-543,554,759,1954-1956`; `functions/src/triggers/contratos/onLinajeWrite.js:35-39` | Ficha con "Sin contratos operativos" y franja que no cuadra con la tabla, antes de que el cliente firme |
| 10 ✔ | **Doble submit en las 6 acciones que crean gestiones** (`crearReemplazo`, `crearDemo`, `crearCambioSerial`, `crearAumento`, `crearAjuste`, `crearBaja`): ni bandera ni `disabled`. Cada click consume un correlativo y manda un correo de aprobación. Solo `crearContrato`, `guardarContratoEditado` y `guardarPlanRenovacion` tienen candado. | `clientes-centro.js:4731,4963,5083,5447,5742,7412`; `js/services/gestionesService.js:63-81` | Dos expedientes y dos correos por un doble click |
| 11 | **Se puede enviar a firma con el Anexo A vacío:** `enviarFirma` no revisa `seriales_estado`; la página de firma simplemente omite la tabla si no hay equipos. | `clientes-centro.js:1462-1538`; `firmar/index.html:344` | El cliente firma un contrato sin seriales |
| 12 | **`done/4` fijo en los contratos en trámite:** un REEMP o DEMO tiene 3 pasos y entregado se muestra "3/4". Ya se corrigió para las gestiones, no para los contratos. | `clientes-centro.js:2531` vs `:2500-2504,2652-2653` | Progreso falso |
| 13 | **El editor convierte la duración vacía en 1 mes sin avisar** (`Math.max(1, Number(...))` anula la validación siguiente). Es el P0 #12 de agosto, reaparecido al editar. | `clientes-centro.js:7098-7099` | Documento legal con duración que nadie escribió |
| 14 | **El chip "Anulado" del archivo siempre da vacío:** el servidor trae los anulados pero `filtrarLocal` los esconde si "Mostrar inactivos" está apagado, y el chip no enciende el toggle. | `js/pages/contratos-list.js:418,483,621`; `contratos/index.html:359-369` | "No hay anulados" es falso |
| 15 | **"Mi cartera" del vendedor se filtra en el navegador** sobre páginas de 30 clientes de toda la base; si en la primera página no hay clientes suyos, el directorio queda en blanco sin mensaje. | `clientes-centro.js:144-155` | La vista principal del vendedor puede salir vacía |

### Clientes y Cotizaciones

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 16 | **Guardar desde el formulario viejo borra datos del cliente.** Grid "Editar" y Centro "Documentos → subir" abren `nuevo-cliente.html?id=`; ese formulario arma `raw` sin `representante_email`, `email_acuses`, `activo` ni `tags`; `buildClientePayload` los rellena con `""`, `true`, `[]` y `updateCliente` los escribe. Sin dedup al editar, sin candado, sin `try/catch`. | `js/pages/clientes-index.js:748`; `clientes-centro.js:1739,4293`; `js/pages/nuevo-cliente.js:95-110,132,151`; `js/services/clientesService.js:83-89` | Borra el correo de firma y el de acuses, las etiquetas, y **reactiva un cliente inactivo** |
| 17 | **El rechazo del gerente queda como "Rechazada · cliente declinó"**, sin motivo, sin correo al vendedor, y cuenta como oportunidad perdida en la tasa de cierre. | `js/pages/cotizaciones-index.js:806-827,200`; `js/pages/cot-detalle.js:117-121` | Historial y KPI del vendedor falsos |
| 18 | **"Podrá restaurarse desde 'Mostrar eliminadas'" es falso:** `CotizacionesService.restore` existe y nadie lo llama; con el toggle encendido las eliminadas se ven sin marca y con Editar/Duplicar activos. | `cotizaciones-index.js:526,274-300`; `js/services/cotizacionesService.js:109` | Promesa incumplida en el diálogo de borrar |
| 19 | **Recuperar el respaldo del editor pierde el cliente recién creado:** al volver de la ficha con `?cliente_id=X`, el merge `{...draft, ...bk.draft}` pisa `clienteId` e `itbmsPct`. | `js/pages/cot-editor.js:332,984` | El vendedor crea el cliente y lo pierde |
| 20 | **KPIs "Monto cerrado" y "Tasa de cierre" sobre lo paginado** (30, 60…) sin decirlo; la señal SAP "por aprobar" cuenta `requiere_aprobacion` pero aterriza en todos los borradores. | `cotizaciones-index.js:159-210`; `js/services/senalesService.js:181-189`; `js/pages/home-signals.js:180` | Números que cambian según cuántas páginas cargaste |

### Almacén e Inventario

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 21 ✔ | **Existencias no cuenta los "no retirados":** `no_retirado` no está ni en `COLS` ni en `OTROS`; esas unidades no suman en ninguna columna ni aparecen entre los chips al desplegar el modelo. | `js/pages/almacen-existencias.js:33-43,264,302` | El total por modelo miente |
| 22 ✔ | **El aviso del taller en Asignar sale sin estilo:** `banner('aviso', …)` pero `banner()` solo conoce `info`, `warn`, `ok`; borde/fondo `undefined` e icono `data-lucide="undefined"`. | `js/pages/almacen-asignar.js:682,230-231` | Justo el aviso "el taller marcó radios que no sirven" pierde peso visual |
| 23 | **Dos instrucciones que no se pueden cumplir:** "Regístrelo a mano en Inventario · Descartados" (la página no tiene alta) y "abre una gestión de cambio de serial desde la ficha del cliente" (el rol inventario no tiene el módulo Centro). | `js/pages/ordenes-flujo.js:827`; `almacen-asignar.js:329,545`; `js/core/modulos.js:41` | Bodega se queda trancada y pregunta por WhatsApp |

### Base PoC y Finanzas

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 24 | **El gerente ve la tarjeta de PoC y lo rebotan:** `modulos.js` le da "poc", `poc-index.js` no incluye GERENTE; `sim-cards.js` sí lo deja. Mismo patrón del P0 #9 de agosto. | `js/core/modulos.js:38`; `js/pages/poc-index.js:17`; `sim-cards.js:311` | "No autorizado" en una tarjeta que el sistema le muestra |
| 25 | **"Confirmar entrega" en Activación falla en silencio con cualquier fecha no ISO:** `Modal.prompt` de texto "YYYY-MM-DD"; escribir "28/09/2026" lanza `RangeError` antes del `try`. | `js/pages/facturacion-activacion.js:258-260` | El click "no hace nada" |
| 26 | **Textos que mienten:** "Registro de Equipos (Ventas) · Carga rápida" para una página que dice "no los carga al sistema"; "usando seriales consecutivos" cuando lo consecutivo es el Unit ID; un toast manda a "+ Grupo", botón que no existe; Emisión habla de una "pestaña Activación" que se llama "Facturará la app". | `index.html:118-119` vs `POC/vendedores-batch.html:226`; `POC/nuevo-batch.html:170`; `js/pages/vendedores-batch.js:193,906`; `facturacion/emision.html:74` | El vendedor cree que ya registró los equipos |

### Panel de administración

| # | Defecto | Evidencia | Efecto |
|---|---|---|---|
| 27 ✔ | **KPI "Órdenes abiertas" usa estados que no existen** (`'EN PROCESO'`, `'DIAGNÓSTICO'`, `'LISTA'`, `'RECEPCIONADA'`…); los reales son POR ASIGNAR, RECIBIDO EN MOSTRADOR, ASIGNADO, COMPLETADO (EN OFICINA), ENTREGADO AL CLIENTE. El subtítulo busca `'COMPLETADA'`/`'ENTREGADA'` y siempre da 0. | `js/pages/admin-index.js:19-22,93-94`; `js/domain/pendientes.js:23-24` | La portada del admin cuenta solo POR ASIGNAR |
| 28 ✔ | **Las alertas se evalúan con ese mismo número**, y "Probar" cuenta las cotizaciones vencidas dentro de "por vencer" mientras la portada no. | `js/pages/admin-alertas.js:155,163`; `admin-index.js:131-133` | Dos números distintos para el mismo indicador |
| 29 ✔ | **Operación: "Completadas sin entregar" filtra `'COMPLETADA'`** (siempre 0) y **"Carga por técnico"** excluye `'ENTREGADA','COMPLETADA'` (cuenta también las cerradas). El propio archivo documenta el error en `:146-149` y solo lo corrigió en un sitio. | `js/pages/admin-operacion.js:216,410` | Panel de operación falso |
| 30 ✔ | **Integridad: "entregadas sin firma" busca `'ENTREGADA'`**, siempre verde. | `js/pages/admin-integridad.js:111` | Un chequeo que nunca falla |
| 31 ✔ | **"Ver como" no abre:** usa `Modal.sheet` y el entry del panel no importa `modal.js` (se rompió en `4d46199`). Falta además el rol contabilidad en la lista. La página de impresión del KPI tiene el mismo hueco con `Modal.alert`. | `js/ui/verComoPicker.js:16-25,36`; `js/entry/admin-index.js`; `js/entry/admin-kpi-reporte-print.js`; `admin-kpi-reporte-print.js:378,399` | Click muerto sin mensaje; errores del PDF en silencio |

**Casi P0, de paso:** `public/tools/` tiene 8 páginas que no se publican (Vite las excluye) pero
que con `npm run dev` escriben en el proyecto de **producción**; `fix-deleted-clientes`,
`migrar-contratos` (pasa todos los contratos de activo a aprobado) y `migrar-fechas` no
revisan rol ni piden confirmación. Borrarlas.

---

## 2. Mejoras transversales (lo que se repite en todos los módulos)

### T1. Un solo nombre y un solo color por estado, en todo el app
El usuario nuevo no descifra los estados porque cada módulo los nombra y colorea distinto:

- **Órdenes:** "POR ASIGNAR" es en realidad "por recibir" (su botón es Recibir; la cola real
  de asignación es "Recibido"). "COMPLETADO (EN OFICINA)" en verde parece "listo para
  entregar" aunque QC lo tenga trabado. ANULADA cae en el ámbar por defecto, sin chip ni
  filtro. CERRADA (DEVOLUCION/ENTRADA), SIN RETIRAR y ANULADA no se pueden filtrar
  (`js/pages/ordenes-state.js:296-339`; `ordenes/index.html:194-238`).
- **Contratos:** `aprobado` = "esperando firma" y también "histórico que opera"
  (`clientes-centro.js:508-509`); `vencido` se muestra "Inactivo" aunque haya chip "Vencido"
  (`contratos-list.js:288-300`); las clases de chip se llaman como estados de órdenes
  (`chip-diagnostico`); escritorio dice "Pendiente Aprobación" y móvil "Pendiente"; el Centro
  muestra claves crudas (`pendiente_aprobacion`) en títulos e Histórico (`:1083,2010`); el
  trámite tiene una tercera nomenclatura ("Esperando firma / Aprobado — por entregar").
- **Cotizaciones:** el éxito ("Convertida") se ve **gris**, igual que "Descartada"; el único
  verde es "Aprobada", un estado intermedio; naranja significa "Vencida" y "Por facturar";
  azul "Borrador" y "Taller" (`js/pages/cot-editor-state.js:6-19`; `css/ceco-ui.css:164-171`;
  `cotizaciones-index.js:238-240,286`).
- **Pool de equipos:** dos paletas para lo mismo (chip vs punto de Existencias: taller es
  amarillo y morado; baja es gris y rojo); `devuelto_revision` tiene 4 nombres
  ("Devuelto · por inspeccionar", "Cuarentena", "Por inspeccionar", "Inspección");
  "Condición" significa Nuevo/Refurbished y también "condición particular"
  (`css/ceco-ui.css:2302-2321`; `almacen/index.html:46-53,130,219`).
- **PoC:** el punto verde/rojo de "Activo" no tiene texto ni leyenda; el botón "Eliminar"
  produce una ficha "Cerrada" reabrible (`js/pages/poc-list.js:279-285,340-346`).
- **Avisos de facturación:** `descartado` se muestra "No aplica", el botón es "No aplica…",
  el confirm "Descartar", el toast "Descartado.", y Comisiones usa "No aplica" con otro
  sentido; el chip "Pendientes" suma los `esperando` y el badge de la pestaña no
  (`js/pages/facturacion-bandeja.js:337,379-387`).

**Cambio:** un mapa único de etiquetas y clases por dominio (`domain/estadoLabels.js` o
dentro de cada `*-state.js`) consumido por bandeja, chips, filtros, correos y móvil. Renombrar
en pantalla sin tocar los datos: "Por recibir" / "Por asignar" / "Listo (falta QC)" /
"Listo para entregar" según QC / "Anulada" en gris con chip; "Convertida" en verde y
"Aprobada" en azul; "Devuelto · por inspeccionar" en todas partes; "Tipo: Nuevo/Refurbished"
en vez de "Condición"; "Cerrar ficha" en PoC. Esfuerzo: 1-2 días en total. Es el cambio que
más consultas por WhatsApp elimina.

### T2. Glosario del sistema (una palabra por concepto)
Conviven en los textos: gestión / trámite / expediente / solicitud (78, 18, 34 y 29
menciones solo en el Centro); anexo / adenda / enmienda; baja / terminación; cliente /
cuenta / empresa; vendedor / ejecutivo; cotización / propuesta (14) / oferta; convertida /
aceptada / "orden de venta" (documento que no existe, `cot-detalle.js:107`); batch / lote /
registro; equipo / unidad / serial / ficha / **pool** (la palabra "pool" le sale a bodega en
pantalla); revivir / reactivar; baja / descartado. La marca se escribe "Cecomunica",
"CeComunica", "C Comunica" y "CECOMUNICA"; "Centro de gestión" es el nombre del app
(`layout.js:256`, `login.html:32`) **y** del módulo de clientes (`modulos.js:68`). Las
etiquetas del home y del rail no coinciden ("Base de Datos PoC" / "Base PoC", "Órdenes de
Servicio" / "Órdenes").

**Cambio:** fijar el glosario (gestión = expediente; anexo para todo lo que se firma;
cliente; vendedor; cotización; aceptada; lote; equipo/serial; "Devuelto"; "Reactivar";
"Cecomunica") y hacer una pasada de textos. Renombrar el sufijo de marca del app
("Plataforma Cecomunica") para que "Centro de gestión" quede solo para el módulo. Generar las
tarjetas del home desde `MODULOS.CATALOGO` (hoy son HTML estático con una tarjeta muerta
`data-mod="clientes"` que ningún rol ve, `index.html:153`, y el "espejo de emergencia" de
`layout.js:205-220` ya está desincronizado: le faltan `centro` y `facturacion_bandeja`).
Medio día de textos + 2 h de home.

### T3. `withBusy(btn, fn)` y fin del doble submit
No existe (0 coincidencias) y hay 144 `.disabled = true` a mano; solo `facturacion-bandeja.js:420`
tiene su `conCandado` y FormKit cubre 2 páginas. Sin candado hoy: las 6 `crear*` de
gestiones (P0 #10), aprobar gestiones y contratos (`clientes-centro.js:1441-1455,3200-3320`),
asignar técnico (`ordenes-flujo.js:106-159`), enviar cotización (`cotizaciones-index.js:410`,
`cot-detalle.js:540`), edición masiva PoC (`js/pages/poc-bulk.js:104-181`), acciones masivas
del grid de clientes (`clientes-index.js:276,310,340,357`), alta manual de SIM
(`sim-cards.js:129-144`). **Cambio:** extraer `withBusy` a `ui/` partiendo de `conCandado` y
FormKit (deshabilita, texto "Guardando…", rehabilita en error, `try/catch` con Toast) y
migrar esos 12 sitios primero. 1-2 días.

### T4. Un solo guard de acceso por página (UI = `roles.js` = `modulos.js`)
Las incoherencias se repiten módulo por módulo: gerente ve PoC y lo rebotan (P0 #24);
gerente ve dos botones "Nueva cotización" y el editor lo expulsa (`cotizaciones/index.html:45,59`
vs `cot-editor.js:924`); contabilidad tiene `ver-contratos` pero no el módulo
(`roles.js:25` vs `modulos.js:42`) y su home tiene 0 señales; vendedor ve "Config" y "Nueva"
en el cajón móvil porque se oculta con `querySelector` en vez de `querySelectorAll`
(`ordenes-filters.js:73-83`); "Progreso" se muestra a técnicos y no a jefe de taller ni
gerente aunque `ver-progreso` diga lo contrario (`ordenes-filters.js:96-102` vs `roles.js:35`);
`ver-inventario` incluye a jefe_taller y nadie lo consulta; gerente no ve "Documentos" desde
`documento.html` (`js/pages/contrato-documento.js:28`); `estado_reparacion.html`,
`nuevo-batch`, `nueva-consola`, `imprimir-cotizacion`, `anexo-aumento` e `importar-exportar`
no revisan rol; las rules permiten `create` de PoC y escritura de `empresa/*` a cualquier
autenticado (`firestore.rules:764,1270-1274`). **Cambio:** helper `Acceso.guard(pageId)` que
lea `modulos.js` + `roles.js` (y un test que cruce las tres tablas), más cerrar las dos
rules. 1 día.

### T5. Sesión y login
"Mantener sesión" viene desmarcado y aplica persistencia `SESSION` (`login.html:71,179-180`):
cada CTA de correo o Ctrl+click que abre pestaña nueva vuelve a pedir login. Firebase 12
devuelve `auth/invalid-credential` y `mapAuthError` no lo conoce (`login.html:158-167`): el
usuario lee "No se pudo iniciar sesión" en vez de "Correo o contraseña incorrectos". Un
usuario sin rol ve un home con solo "Mi Perfil" y ningún mensaje (`firebase-init.js:132`).
Más el P0 #3. **Cambio:** LOCAL por defecto, mapear el código, `/login.html?motivo=` absoluto
con el motivo en pantalla, y estado vacío "Tu cuenta no tiene rol; pídeselo a
administración". 2 h.

### T6. Buscar de verdad
Ctrl+K ya está en 62 páginas pero **no en el home** (no carga `layout.js`), no tiene botón
visible fuera del admin ni en móvil, escanea solo los últimos 500 docs por colección
(`busquedaGlobalService.js:17,55-57,98,122`) y no busca en el pool de equipos. En Órdenes el
índice solo guarda palabras completas ("hospi" no encuentra "Hospital",
`functions/src/lib/searchTokens.js:55-80`), la búsqueda rápida corta en 100 sin avisar
(`ordenesService.js:1258-1261`), tocar un chip borra la búsqueda (`ordenes-filters.js:947-949`)
y no hay filtro por fecha. En Contratos y Cotizaciones la búsqueda por cliente es sobre lo
cargado + "Cargar más". **Cambio:** cargar `layout.js` en el home y abrir el palette desde su
input ("Buscar cliente, orden, contrato, serial…"); botón "Buscar ⌘K" en topbar y rail;
`?focus=` en PoC; búsqueda del pool en el palette; tokens por prefijo y filtro de fechas en
órdenes; combinar texto + chip. 3 h lo primero, 2-3 días lo del índice.

### T7. Móvil y tablet
Órdenes móvil sin salida (P0 #4); PoC (12 columnas), Activación, QBO, Existencias (10
columnas) y las tablas del admin sin `@media` ni scroll horizontal; las líneas de equipo del
wizard de contrato son flex sin wrap y se desbordan a 360 px (`clientes-centro.js:5947-5954`);
las tarjetas móviles de cotizaciones solo tienen Ver/Editar/Imprimir (no se puede enviar,
aprobar ni cerrar desde el teléfono, `cotizaciones-index.js:326-330`); `user-scalable=no`
sigue en 4 páginas (`index.html:23`, `ordenes/index.html`, `progreso-tecnicos.html:20`,
`inventario/piezas.html:31`) y `maximum-scale=1` en las dos pantallas que usa el cliente
(`firmar/index.html:5`, `firmar/tablet.html:5`); blanco sobre `#0091D7` ≈ 3,5:1 en botones
de 14 px (`ceco-ui.css:121,292-293`). **Cambio:** botón "Menú" en `#mobileBottomNav` que abra
el drawer y condición de `layout.js:313` por visibilidad; `.app-table-wrap` con scroll;
quitar los bloqueos de zoom; acento `#0074AC` en primarios; `min-height:44px` con
`pointer:coarse`; bottom-nav en PoC y Almacén. 1-2 días.

### T8. Fechas en hora de Panamá
Activación y Comisiones prellenan con `toISOString()` (después de las 7 pm proponen mañana),
aunque el mismo archivo advierte la trampa en `mesHoy` (`facturacion-activacion.js:208-209`;
`facturacion-comisiones.js:44-47,264,397`). Progreso de técnicos formatea con `es-MX`
(`progreso-tecnicos.js:70`). **Cambio:** un `Fechas.hoyPanama()` en `core/formatting.js` y
reemplazar. 1 h.

### T9. Una sola forma de hacer cada cosa
Duplicidades vivas: **cliente** (`clientes/ficha.html` vs `contratos/nuevo-cliente.html?id=`,
P0 #16); **modelos** (`ordenes/modelo-de-radio.html` vs `inventario/modelos.html`; el primero
borra sin contar referencias y pinta sin escapar, `:66-69,88-91`); **equipos en orden**
(`agregar-equipo.html` vs `nuevo-batch.html`); **importar Excel de bodega** (Almacén con
diff vs `equipos.html` con plantilla); **conciliación contra conteo** (3 pantallas); **precios
de piezas** (`piezas.html` vs `piezas-tarifas.html`, y el rol inventario ve costos);
**asignar seriales** (Almacén · Asignar vs `contratos/seriales.html`); **duplicar cotización**
(lista `{...src}` vs detalle `toDoc`); **cerrar cotización** (hoja "Cerrar" vs panel "Cambiar
estado" sin motivo); **pickers** (`entity-combo`, `entity-picker`, `filtered-select`);
**lienzos de firma** (`firmaPad.js` vs el propio de `firmar/index.html`); **auditoría de
"con qué papel se sostiene"** (Centro vs herramienta admin). **Cambio:** por cada par, elegir
la oficial, redirigir la otra (patrón `tecnicos.html`) y borrar el código. Ver el detalle en
cada módulo.

### T10. Modales: uno en vez de una cadena, y sin trampas de teclado
`nuevo-batch` de PoC encadena hasta 6 `Modal.confirm/sheet` seguidos más la pregunta de SIM
(`js/pages/nuevo-batch.js:1318-1551`); Activación encadena confirm + prompt (`:262-263`);
Reemplazo abre un confirm "JSON para recepción" al terminar (`clientes-centro.js:4790-4796`).
`Modal.confirm` confirma con Enter aunque el foco esté en Cancelar y pone el foco inicial en
el botón de confirmar incluso con `danger` (`js/ui/modal.js:285-301`); Toast no tiene
`aria-live` y los errores desaparecen en 3 s igual que los éxitos (`js/ui/toast.js:36`); el
modal de intervención se cierra con un toque fuera sin preguntar y no pasa por `Modal.open`
(`ordenes-equipos.js:891-895`). **Cambio:** hoja-resumen única con decisiones por grupo
(plantilla: `contrato-seriales-page.js`); Enter solo confirma con foco en el botón; foco en
Cancelar cuando es `danger`; `role="status"` y 6 s para errores; "¿Descartar lo escrito?" al
cerrar con texto. 1 día.

### T11. Código muerto y páginas legacy
Sin ningún entry que los importe: `nc-cargos/combo/form/guardar/preview/state.js`,
`nuevo-contrato.js`, `editar-contrato.js`, `cancelaciones.js`, `contratos-approval.js`
(~2,440 líneas); `entry/contratos-editar-contrato.js` solo importa `firebase-init`. Páginas:
`tools/*` (8), `verificar-contrato.html` (huérfana, pero es la versión correcta de la
pública), `inventario/vista-correo.html` (dos saltos y texto de 2025), `facturacion/index.html`,
`clientes/editar.html`, `ordenes/tecnicos.html`, `POC/editar-batch.html`, `contratos/nuevo-contrato.html`,
`editar-contrato.html`, `cancelaciones.html` (todas redirecciones que se pueden retirar cuando
caduquen los correos). Método duplicado `_pintarChipReg` (el segundo pisa al primero,
`clientes-centro.js:304,812`); restos `void deuda; renovar=''` (`:4078-4079`). Comentarios que
mienten: "máx. 4 señales" (`home-signals.js:269,300`), "tope de la fila", "mutaciones siguen en
equipos.html" (`almacen-existencias.js:9-14`). 1-2 h de limpieza, y menos superficie para bugs.

### T12. Bodega con lector de barras
En el asignador de seriales las casillas no tienen `keydown`: Enter no avanza y el segundo
escaneo se pega al primero (`js/ui/asignador-seriales.js:112-117`); en el Conteo Enter no pasa
al siguiente modelo (`asistente-conteo.js:38-41`); en Recibir el foco cae en el filtro pero no
salta al cuadro de seriales al elegir modelo (`asistente-recibir.js:371`); el contador dice
"N repetidos" sin resaltar cuál y `recibir()` sigue sumando repetidos dentro de inválidos
(`equiposPoolService.js:653`); la validación consulta un serial a la vez
(`asignador-seriales.js:544-548`; `asistente-venta.js:182-213`); ni Recibir ni el Importador ni
la política dura consultan `equipos_descartados` (solo `SerialField` al perder el foco,
`serial-field.js:104-116`), así que un radio descartado en QC puede volver a bodega o
asignarse. **Cambio:** Enter = siguiente casilla vacía / siguiente modelo / cuadro de
seriales; línea repetida resaltada; consulta de descartados en los 4 puntos; validación por
lotes `in` de 10. 1 día.

---

## 3. Lo que está bien (no tocar, copiar de aquí)

| Patrón | Dónde vive | Reutilizar en |
|---|---|---|
| Bandeja de Facturación pendiente: candado, buscador, estado vacío, detalle con historial | `facturacion-bandeja.js:420` | Cualquier bandeja nueva |
| Renovación con orígenes, líneas fusionadas y plan por serial precargados | `clientes-centro.js` (wizard de renovación, candado `:5998-6005`) | — |
| Anulación de contrato y cierre de temporal: modal con consecuencias y motivo obligatorio | `clientes-centro.js:1194-1262` | Anular gestión, aprobar baja/terminación, subir firmado |
| Hoja de confirmación con consecuencias | `contrato-seriales-page.js` | La cadena de modales de `nuevo-batch` PoC |
| Cascada JSON del vendedor → lote PoC autocompletado | `nuevo-batch.js:1644-1676` | — |
| Importador de SIM con vista previa, dedup y WriteBatch | `sim-cards.js`, `simCardsService.js:111` | Lote PoC, importar-poc, importar-exportar de órdenes |
| Importador de la hoja de bodega con intención + diff antes de escribir | `asistente-importar.js` | Retirar el importador de `equipos.html` |
| Bandeja "Hoy" de Almacén: colas por origen | `almacen-hoy.js` | — |
| QC por equipo con candado y "Guardando…" | `ordenes-qc.js:913-914` | — |
| Visita técnica: el botón "Cotizar" desaparece si ya hay cotización | `ordenes-render.js:1156` | Menú ⋯ de Cotizar en toda orden |
| Ficha de cliente con FormKit: cambios sucios, validación junto al campo, "Guardando…", historial | `clientes-ficha.js` | Todos los formularios de cabecera |
| Ajustes de piezas y equipos con kardex | `equiposPoolService.js:1137-1158` (`corregirSerial`), `reclasificarModelo`, `corregirPropiedad` | "Editar ficha" de `equipos.html` |
| Deep-links con limpieza de URL | `ordenes-filters.js:501-557`, `contratos-index.js:152-163` | Señal S9, SAP, EST, S7, REGV |
| Confirm de vínculo QBO con nombres lado a lado + `qbo_vinculado_por/at` | `facturacion-clientes-qbo.js:196-235` | — |
| Página honesta para función no construida | `facturacion/emision.html` | — |
| Menú por intención que esconde lo que no aplica y explica lo deshabilitado | `clientes-centro.js:3948,4056-4061` | Menú ⋯ de órdenes |

---

## 4. Módulo por módulo

Cada módulo trae: para qué sirve (inventario resumido), los pasos que da el usuario hoy, los
hallazgos que no están en las secciones 1-2, y la lista de cambios en orden.

### 4.1 Home, shell y páginas públicas

**Para qué sirve.** `index.html` es el Command Center: marca, señales por rol (0 a 8,
`home-signals.js:287-304`), feed "Contratos por cerrar" (admin/gerente) y tarjetas de módulo.
`layout.js` da el topbar legado (40 páginas), el rail (61 páginas), el drawer móvil y Ctrl+K;
`renderShell` (el modo final) lo usan **0 páginas**. `login`, `perfil` (solo lectura, rol
crudo), `firma-correo` (sin rail, rellena "Juan Perez" y un teléfono genérico si faltan
datos, `:255-265`), `firmar/index` (firma remota del cliente, buena), `firmar/tablet` (kiosco
de acuses; nadie lo enlaza, hay que tenerlo en marcador), `verify/*` (públicas).

**Pasos.** Login → home → módulo: 4 interacciones (5 con "Mantener sesión"). Usar una señal: 2.
Ctrl+K desde un módulo: 3; desde el home no existe. Cambiar de módulo: 1 en escritorio, 2 en
móvil híbrido, 3 + scroll en Órdenes móvil. Tablet: 1 del personal + 4 del cliente (siempre
borra nombre y cédula, `tablet.html:360-361`). Los conteos del home al volver salen de una
caché de 5 min: asignas una orden, regresas y "por asignar" sigue igual
(`home-signals.js:674-685`).

**Hallazgos adicionales (P1):** deep-links a medias: SAP → todos los borradores; EST, S7 y
REGV aterrizan sin filtro (`home-signals.js:121,154,180,243`). Contabilidad: 0 señales.
`_ROL_LABELS` duplicado (`layout.js:222`, `index.html:227`). Convenciones de botón: `.btn-primary`
(217 usos), `.btn.primary` (11 páginas), `.btn--primary/--ghost` (ceco-command), `btn-p/btn-g`
(firmar), `fo-btn`.

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | Verificación pública real: validar `estado`, escapar, quitar correo/rol del aprobador; propagar anulado/vencido a `verificaciones`; retirar `verificar-contrato.html` | `verify/index.html`, `onApproval.js:114` | 3-4 h | Un anulado deja de certificarse como vigente |
| 2 | `if (e.ctrlKey \|\| e.metaKey \|\| e.altKey) return;` + tecla `g` | `index.html:330-343` | 30 min | Ctrl+F/C/P dejan de sacarte del home |
| 3 | `/login.html?motivo=` absoluto en el guard y en los 14 sitios; motivo en pantalla | `firebase-init.js:306` y 14 archivos | 30 min | Fin del 404 |
| 4 | Botón "Menú" en `#mobileBottomNav` + condición por visibilidad en `layout.js:313` | `ordenes/index.html:621-635` | 2 h | Órdenes móvil con salida |
| 5 | Ctrl+K en el home (cargar `layout.js`, abrir desde el input), botón "Buscar ⌘K" en topbar/rail, `?focus=` en PoC | `index.html:77`, `layout.js:426-476`, `poc-list.js` | 3 h | "Buscar el contrato de X" desde el home: de 4-5 a 3 |
| 6 | LOCAL por defecto, `auth/invalid-credential`, estado vacío sin rol, Contratos para contabilidad (decisión de negocio) | `login.html:71,158-167`, `modulos.js:42` | 2 h | −3 interacciones por pestaña nueva |
| 7 | `Modal.confirm`: Enter solo con foco en confirmar; foco en Cancelar si `danger`; Toast `aria-live` y 6 s en errores | `modal.js:285-301`, `toast.js:36` | 2 h | Sin confirmaciones destructivas por accidente |
| 8 | Invalidar `ccHomeSignals` en `pageshow`/`visibilitychange` o mostrar "actualizado hace N min" | `home-signals.js:674-733` | 1 h | El home no contradice la lista |
| 9 | Deep-links que faltan (SAP `?aprobar=1`, EST, S7, REGV, S9) | `home-signals.js` | 1 h | 6 señales más accionables |
| 10 | Tarjetas del home desde `MODULOS.CATALOGO`; borrar tarjeta muerta y espejo de `layout.js`; `ROL_LABELS` exportado | `index.html:96-219`, `layout.js:205-220` | 3 h | Una sola fuente de etiquetas |
| 11 | Accesibilidad: quitar `user-scalable=no` (4) y `maximum-scale=1` (2); acento `#0074AC`; 44 px táctil | ver T7 | 2 h | WCAG 1.4.4 y AA |
| 12 | firma-correo: sin datos falsos de relleno, con rail, cargo y teléfono guardados en `usuarios/{uid}` | `firma-correo.html` | 2 h | Firma correcta la primera vez |
| 13 | Tablet: prellenar nombre y cédula desde la solicitud | `firmar/tablet.html:360` | 2 h | −2 interacciones por firma |
| 14 | P2: `renderShell` + rail en el home + una convención de botón; unificar pickers y lienzos; palette con índice de tokens | `layout.js`, `ui/` | 5-8 d | Un solo shell |

### 4.2 Órdenes de servicio

**Para qué sirve.** `ordenes/index.html` es la bandeja (todos los roles): chips por estado,
acciones por fila, modales de recibir, asignar, intervención, QC, entrega (normal, parcial,
papel, tablet), devolución con acuse, reemplazo y visita. Satélites: `nueva-orden` (cabecera),
`agregar-equipo` y `nuevo-batch` (equipos, uno a uno o en tabla; "batch" es jerga),
`editar-orden` (solo en POR ASIGNAR), `cotizar-orden`, `imprimir-orden`,
`nota-entrega-intervenciones` (marca "C COMUNICA, S.A."), `progreso-tecnicos`,
`reporte-pendientes` (roto, P0 #6), `config` (menú de listas: `estado_reparacion` cuyos estados
extra no se usan en ningún sitio, `editar-orden.js:493`; `modelo-de-radio` duplicado;
`importar-exportar` peligroso, P0 #7), `admin-equipos-cliente` (enlazada 3 veces; su filtro
omite RECIBIDO y las CERRADA, `:78-83`).

**Mapa de estados.** POR ASIGNAR (rojo con pulso) → Recibir → RECIBIDO EN MOSTRADOR (violeta)
→ Asignar → ASIGNADO (azul) → Completar → COMPLETADO (EN OFICINA) (verde; un rechazo de QC
regresa a ASIGNADO) → Entregar (candados de QC, firma de contrato, anexo y factura,
`ordenes-flujo.js:642-668`) → ENTREGADO AL CLIENTE (gris). Terminales propios: CERRADA
(VISITA/DEVOLUCION/ENTRADA) esmeralda, CERRADA (SIN RETIRAR) ámbar, ANULADA (ámbar por
defecto). Ver T1 para lo que un usuario nuevo no entiende.

**Pasos del usuario.**

| Flujo | Hoy | Nota |
|---|---|---|
| (a) Crear orden REPARACIÓN con 2 equipos y recibirla | ~19 | Aterriza sola en agregar-equipo (bien); la recepción es un paso aparte aunque el cliente esté en el mostrador; dos "Observaciones" y ninguna se llama "falla reportada", que es lo que QC verifica (`ordenes-qc.js:30`); el vendedor solo se autollena si la ficha lo tiene (`nueva-orden.js:338`) |
| (b) Jefe asigna técnico | 4 (2 si se la asigna a sí mismo, ya preseleccionado) | Sin candado: doble click = dos escrituras y dos correos (`ordenes-flujo.js:106-159`) |
| (c) Técnico interviene 3 equipos y completa | ~12 | El modal se cierra al guardar y hay que reabrir; "Anterior/Siguiente" no guarda (pide descartar, `ordenes-equipos.js:869-880`); "Aplicar también a otros" escondido en `<details>` sin "marcar todos" (`:743-759`) |
| (d) QC aprueba / rechaza | 4 / 6-7 | Bien resuelto |
| (e) Entrega normal / papel / parcial | 4 / 6 / 5+N | Según el comentario del código, 7 de cada 10 entregas de septiembre salieron por papel (`index.html:578-582`) y esa casilla está al fondo del modal, después del bloque de firma (`:555`). Investigar por qué |
| (f) Devolución con acuse | 2 + (3 por unidad o 1 lote) + 3 | El menú dice "Devolución sin contrato" y el tooltip "con contrato de papel" (`index.html:97`) |
| (g) Cotizar desde la orden | 3 | "Cotizar" aparece siempre y no revisa si ya existe `cotizacion_doc_id` (`ordenes-render.js:1478-1482`; `cotizar-orden.js:976-1085`); sin "Generando…" |
| (i) Buscar una orden vieja | 2 en el caso feliz | Falla con palabras parciales, corta en 100 sin avisar, el chip borra la búsqueda, no hay fecha (ver T6) |

**Hallazgos adicionales (P1):** los chips se contradicen: "Todas" cuenta lo cargado y los
demás cuentan en el servidor ("Todas 50" junto a "Entregado 3,400", `ordenes-render.js:1516-1576`);
al tocar un chip la lista corta en 200 y "Cargar más" se oculta sin aviso
(`ordenes-filters.js:972,978`); "Cargar más órdenes (40)" muestra las cargadas, no las que
faltan (`:485`). El ⋯ de admin/recepción tiene 9-11 acciones y "Eliminar orden" (rojo) no
es la última (`ordenes-render.js:1436-1482`). Las acciones de la fila están al 45 % de opacidad
hasta el hover y un Entregar bloqueado queda al ~20 % (`ordenes-index.css:1277-1296`): un
usuario nuevo no ve los botones. "Selecciona un cliente…" se pinta en `#mensaje` al pie de
un formulario largo (`nueva-orden.js:495`). El formulario de entrega valida con toasts sueltos
en vez de marcar el campo (`ordenes-flujo.js:1756-1784`). Progreso atenúa hasta los botones
del topbar en modo lectura (`progreso-tecnicos.js:18-21`). Crear cliente desde la orden sigue
pidiendo solo el nombre (`nueva-orden.js:367`). El bloque de contrato de ENTRADA no existe en
editar-orden (`editar-orden.js:30`). Siguen dos sistemas de fotos (`ordenes-fotos.js:8`).

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | Reporte de pendientes: ordenar por `fecha_creacion` (o en el navegador), incluir RECIBIDO, columnas con los campos reales | `ordenesService.js:1732`, `reporte-pendientes.html:119-159` | 1 h | El reporte deja de mentir |
| 2 | Importar-exportar: `orden_id` primero, `set` con merge, vista previa, guard admin (o retirar la importación) | `importar-exportar.js:12-57`, `ordenesService.js:1723` | 2-4 h | No se pisan órdenes |
| 3 | Correo de nueva orden con nombre del vendedor y `?orden=` | `nueva-orden.js:587,680-695` | 30 min | Correo útil |
| 4 | Candado + "Guardando…" al asignar; "Generando…" y "Ver cotización" si ya existe (patrón visita) | `ordenes-flujo.js:106`, `ordenes-render.js:1478`, `cotizar-orden.js:976` | 2 h | Sin correos ni cotizaciones duplicadas |
| 5 | Modal de intervención: `Modal.open`, no cerrar con texto sin preguntar, "Guardar y siguiente", "marcar todos" | `ordenes-equipos.js:729-895` | 3 h | −1 interacción por equipo; cero textos perdidos en tablet |
| 6 | Chips coherentes: "Todas" con `count()` o sin número; "mostrando 200 de N"; "Cargar más" sin contador; chip que no borre la búsqueda | `ordenes-render.js:1516`, `ordenes-filters.js:947-978` | 3-4 h | Se puede pedir "cliente X entregadas" |
| 7 | Nombres de estado en pantalla (T1): "Por recibir", "Por asignar", "Listo (falta QC)" / "Listo para entregar", ANULADA gris con chip; chips para CERRADA (DEV/ENTRADA), SIN RETIRAR, ANULADA | `ordenes-state.js:296-339`, `index.html:194-238` | 1 d | La cola se entiende sin explicación |
| 8 | Config: redirigir `modelo-de-radio` a `inventario/modelos.html`; `estado_reparacion` solo lectura + guard + rule; logout absoluto | `ordenes/config.html:77`, `estado_reparacion.html:58`, `firestore.rules:1270` | 1 h | Cierra dos trampas |
| 9 | Permisos: `querySelectorAll` + alinear Progreso y Nueva con `roles.js` | `ordenes-filters.js:73-102` | 1-2 h | Menús coherentes por rol |
| 10 | ⋯: "Eliminar" al final y separado; documentos agrupados; el vendedor también directo | `ordenes-render.js:1436-1482` | 1 h | Menos clicks equivocados |
| 11 | Entrega: "firmó en papel" arriba del bloque de firma + análisis del 70 % | `index.html:555-582` | 2 h + análisis | −1 o 2 interacciones en 7 de cada 10 entregas |
| 12 | Acciones de la fila al 100 % de opacidad; Entregar bloqueado con candado visible | `ordenes-index.css:1277-1296` | 30 min | Los botones se descubren |
| 13 | "Guardar y recibir" al final de agregar-equipo; campo "Falla reportada" en la orden | `agregar-equipo.js`, `nueva-orden.html` | 4 h | −2 interacciones; QC con qué comparar |
| 14 | Validación junto al campo en nueva-orden y entrega; mini-formulario de cliente (nombre, RUC, email) | `nueva-orden.js:367,495`, `ordenes-flujo.js:1756` | 3 h | Menos errores en el mostrador |
| 15 | Textos: "Devolución sin contrato" vs tooltip; "C COMUNICA" → Cecomunica; `es-MX` → `es-PA`; `user-scalable` en Progreso | `index.html:97`, `nota-entrega-intervenciones.html`, `progreso-tecnicos.*` | 1 h | Consistencia |
| 16 | P2: unir agregar-equipo con nuevo-batch en una captura en tabla; búsqueda por prefijo + fecha + chip; bloque de ENTRADA en editar-orden; unificar fotos | — | Días | Una sola forma de cargar equipos; órdenes viejas en 2 interacciones |

### 4.3 Centro de gestión y Contratos

**Para qué sirve.** `clientes/centro.html` + `clientes-centro.js` (7,461 líneas, un objeto
`window.Centro` con ~260 métodos) es el directorio de clientes, la ficha 360 y todos los
wizards: contrato nuevo (SERV/TEMP), renovación, regularización con contrato, aumento/anexo,
adenda en papel, actualización de seriales, ajuste de tarifa, demo, reemplazo, cambio de
serial, baja parcial / terminación, anulación, cierre de temporal. Inicia: admin, gerente,
vendedor, recepción; aprueba: admin o gerente (`:2318-2320`). `contratos/index.html` es el
archivo de consulta (única operación que queda: `?factura_venta=`). `documento.html`
(documento v2) e `imprimir-contrato.html` (formato clásico). `seriales.html` solo desde
"Registrar seriales (histórico)". `transicion.html` (mapeo saliente→entrante) desde Almacén.
`nuevo-contrato`, `editar-contrato` y `cancelaciones` redirigen. La gestión "Devolución" (GV)
está en `TIPOS` y en el filtro del archivo pero **nadie la crea** (`gestionesService.js:25`,
`contratos/index.html:211`).

**Duplicidades:** dos formularios de cliente (P0 #16); dos pantallas de asignar seriales;
para el vendedor dos entradas del rail ("Centro" y "Contratos") que además filtran distinto:
el Centro por `vendedor_asignado` (`:151-153`) y el archivo por `creado_por_uid`
(`contratos-list.js:505`), así que un contrato de su cartera creado por un admin no le aparece
en el archivo.

**Mapa de estados.** Contrato: `pendiente_aprobacion` → `aprobado` → `activo`; salidas
`anulado` y `vencido`; `inactivo` legado. Gestión: `pendiente_aprobacion`, `pendiente_cliente`,
`pendiente_firma`, `pendiente_bodega`, `en_proceso`, `en_demo`, `retorno`, `cerrada`, `anulada`
(`gestionesService.js:31-44`; colores en `css/ceco-gestion.css:54-62`, entendibles). Ver T1.

**Pasos del usuario.**

| Flujo | Hoy | Nota |
|---|---|---|
| (a) Vendedor crea contrato de alquiler con 3 equipos | 10 (hasta ~18 con 3 modelos) | El arriendo no se llama "Alquiler": se elige "Servicio" y luego, línea por línea, modalidad "Alquiler" (existe `ALQ` en `TIPOS_CONTRATO`, `:5805`, y no se ofrece); "¿De quién es?" sale vacío en cada línea; preselección de modelo por substring puede equivocarse (`:4466`); sin autosave |
| (b) Admin aprueba | 2 | Sin confirmación ni candado (`:1441-1455`) |
| (c) Bodega asigna seriales | (Almacén · Asignar) | **La línea de tiempo del contrato en trámite no tiene paso de bodega**: son aprobación → firma → activación → regularización (`:2495-2499`); el wizard promete "aprobación → seriales → firma → activo" (`:6083-6084`) y el expediente dice "aprobación → firma → activo" (`:2541`): tres versiones del mismo flujo |
| (d) Firma y activación | Digital 2-3; papel 4 | Subir el firmado **activa el contrato en el mismo write, sin vista previa ni confirmación** (`:1379-1419`), y la activación dispara facturación y comisión. No hay "modo tablet" para contratos (la tablet es solo acuses) |
| (e) Renovación | 4-6 | Ya óptimo |
| (f) Reemplazo | 6 + 1 | El texto del modal miente: "si hay un propio sin garantía, primero pasa por aprobación" (`:4620-4621`) cuando desde el 10-sep todo reemplazo va a aprobación (`:4761-4779`); confirm "JSON para recepción" al final (`:4790-4796`) |
| (g) Terminación con devolución | 6-7 + 2 | El admin aprueba sin confirmación aunque crea la orden de DEVOLUCIÓN (`:3314-3320`) |
| (h) Anulación de contrato | 4-6 | Bien (modal con consecuencias). Pero **anular una gestión acepta motivo vacío** (`:3329`; `gestionesService.js:364` guarda `''`) |
| (i) ¿El vendedor sabe en qué paso va? | A medias | Progreso n/N, chip y línea de tiempo (bien); pero "le toca a" se deduce con regex sobre el texto mostrado (`:720-729`), faltan bodega/programación/entrega (la entrega es lo que persigue por la comisión), y un aprobado sin firmar desaparece del trámite a los 45 días sin aviso (`:2455`) |

**Hallazgos adicionales (P1):** textos que contradicen el código: "espera aprobación de
ventas" (`:613,722`, "llega a ventas@" `:2496`, "ventas valida al firmante" `:1549`) cuando la
decisión es administración (`:2784-2788`); "Requiere tu acción" (`:2023`) ya se llama "Ahora".
"Documento completo" siempre abre v2, incluso para contratos clásicos (`:3905-3907`): usar
`DocumentoContrato.urlDocumento`. "Esperando firma" en actualizaciones de seriales que ya no
se firman (`:3729-3733`). Filtros del archivo no persisten. N+1 secuencial en
`advertenciasPool` (`asignador-seriales.js:461-470`). `qrcode` por CDN (`documento.html:79`).
Guía `docs/GUIA_CONTRATOS_Y_EQUIPOS_PASO_A_PASO.md:20-23` desactualizada ("Contratos · Nuevo").

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | `_renovadoPor` solo cuenta renovadores `activo` o con firma; la franja excluye trámites | `clientes-centro.js:531-543,759` | 1-2 h | Fin del "renovado ✓" falso |
| 2 | `withBusy` en los 6 `crear*` y en las aprobaciones | `:1441,3200-3320,4731,4963,5083,5447,5742,7412` | 2-3 h | Sin expedientes duplicados |
| 3 | Bloquear "Enviar para firma" mientras `seriales_estado !== 'asignados'` (salvo renovación sin equipo) + paso "Seriales de bodega" en la línea de tiempo | `:619-622,1462,2495` | 3-4 h | Nadie firma un Anexo A vacío; el vendedor ve el paso real |
| 4 | Confirmar antes de subir el firmado ("esto ACTIVA y factura") y antes de aprobar baja/terminación, con resumen (plantilla `:3233-3240`) | `:1370,3314` | 2 h | Sin activaciones ni devoluciones accidentales |
| 5 | `done/4` → pasos reales; duración vacía en el editor; chip "Anulado"; "vencido" con etiqueta propia; motivo obligatorio al anular gestión | `:2531,7098,3329`, `contratos-list.js:295,418` | 2 h | Números y estados honestos |
| 6 | Textos: reemplazo, "ventas" → "administración", "Requiere tu acción" → "Ahora", "Esperando firma" en actualizaciones | `:613,722,1549,2023,2496,4621` | 1 h | Menos confusión |
| 7 | Cartera del vendedor en el servidor (`where vendedor_asignado ==` + índice); archivo filtrado por cartera, no por creador | `clientesService.js:298`, `clientes-centro.js:144`, `contratos-list.js:505` | 3-4 h | La vista principal del vendedor funciona |
| 8 | Contrato nuevo: tipo "Alquiler" visible y modalidad Alquiler por defecto; CTA "Ver/Imprimir" tras guardar | `:5030,6101,6899` | 2 h | −1 interacción por línea |
| 9 | "Documento completo" vía `urlDocumento`; gerente en `documento.html`; quitar el confirm de JSON del reemplazo o moverlo a la cola de bodega | `:3907,4790`, `contrato-documento.js:28` | 1 h | Un solo papel |
| 10 | Aprobado sin firmar a los 45 días → señal en "Ahora" en vez de desaparecer | `:2455` | 1 h | Nada se pierde en silencio |
| 11 | Borrar código muerto (~2,440 líneas) y el tipo GV o darle creador | `pages/nc-*`, `nuevo-contrato.js`, `editar-contrato.js`, `cancelaciones.js`, `contratos-approval.js` | 1-2 h | Menos superficie |
| 12 | Autosave de `wizContrato`, `wizAumento`, `wizBaja` (patrón `vendedores-batch.js`); líneas de equipo con wrap | `:5947` | 1-2 d | No se pierde trabajo; sirve en el celular |
| 13 | P2: partir `clientes-centro.js` por sus 16 secciones; "le toca a" como dato `{rol}`; línea de tiempo completa con programación y entrega; unificar formulario de cliente y asignación de seriales; actualizar la guía | todo el archivo | 3-5 d | Mantenibilidad y menos regresiones |

### 4.4 Clientes

**Para qué sirve.** `clientes/ficha.html` es el formulario único de alta (`?nuevo=1`) y edición
con historial; es el camino bueno (FormKit, "Guardando…", ayudas). `clientes/index.html` es el
grid tipo hoja de cálculo con edición inline y acciones masivas (admin/recepción), casi
huérfano: solo desde el pie del menú del cliente en el Centro y una tarjeta de admin; su título
"Clientes" no dice que es la edición masiva avanzada. `contratos/nuevo-cliente.html?id=` sigue
vivo como segundo formulario para "Documentos" y para "Editar" del grid (P0 #16).
`regularizacion.html` es la bandeja "Cuentas por regularizar" (deuda de registro de la cuenta:
radios sin contrato, contratos sin seriales, marcos en papel; la calcula el backend). `editar.html`
solo redirige. `anexo-aumento.html` es el documento imprimible del anexo, sin "Volver" ni guard.

**Pasos.** Alta con RUC/DV desde el Centro: 14-15 (duplicados solo al final con 3 consultas
exactas, `clientes-ficha.js:291-300`; el banner "Ya existe otro cliente con ese RUC" no
enlaza al existente; el DV se calcula pero pide un click más "Usar X", `rucInput.js:126`).
Editar: **5 caminos** (Centro → ficha, bueno; grid inline con guardado a los 700 ms que
escribe valores parciales y genera líneas de historial, `clientes-index.js:691-698`; grid
"Editar" → formulario viejo; Centro "Documentos" → formulario viejo; regularización → solo
vendedor). Regularización: 5 (asignar = elegir + botón; podría guardar al elegir; "puntos de
deuda", "Exceden el margen", "asistida" sin explicar; sin `try/catch` queda en "Cargando…"
para siempre, `clientes-regularizacion.js:56-69`; `limit(500)` sin aviso; columnas sin
encabezado, `:141-142`).

**Hallazgos adicionales (P1):** renombrar en el grid no revisa duplicados (`:508-511`); el modal
"No se puede eliminar" reutiliza el banner "Vas a eliminar (soft-delete)… No se pierde
información" con botón rojo "Entendido" y además "Cancelar", y el texto enseña `deleted: true`
(`index.html:205-211`, `:791`); "Cargar más" es "página siguiente" (`:162-164`) y "Mostrar
todo" rompe el paginador; acciones masivas sin candado ni `try/catch`, consecuencias
consultadas una por una (`:276-357,298-302`); la búsqueda necesita Enter mientras cotizaciones
filtra en vivo, y el placeholder dice "nombre o representante" pero también busca RUC y
dirección; el comentario del HTML dice que carga Toast/Modal y no (`index.html:32-34`).

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | "Editar" del grid → `ficha.html?id=&from=clientes`; en `nuevo-cliente.js` partir `raw` de `...d` como hace la ficha | `clientes-index.js:748`, `nuevo-cliente.js:95` | 30 min | Se acaba la pérdida de correos y la reactivación |
| 2 | Grid: guardar en `change`/blur; dedup al renombrar; "Cargar más" que agregue o se quite; modal limpio; masivas con `withBusy` y `Promise.all` | `clientes-index.js` | 4 h | Grid confiable |
| 3 | Ficha: DV autocompletado; dedup aproximado al salir del RUC y del nombre (`nameSim` ya existe en `clientesDedupService`); enlace "Abrir el existente" | `clientes-ficha.js:291`, `rucInput.js:126` | 3-4 h | −1 interacción y menos duplicados |
| 4 | Regularización: `try/catch` + Reintentar; encabezados; glosario de "puntos" y "margen"; asignar al elegir; aviso del tope 500 | `clientes-regularizacion.js` | 1-2 h | Bandeja usable sin explicación |
| 5 | Título del grid "Clientes · edición masiva (avanzada)"; búsqueda en vivo y placeholder completo; guard y "Volver" en anexo-aumento | `clientes/index.html`, `anexo-aumento.html` | 1 h | Consistencia |
| 6 | P2: un solo formulario (documentos a la ficha o al Centro; retirar el modo edición de `nuevo-cliente.html`) | `contratos/nuevo-cliente.html` | 1-2 d | Un solo camino |

### 4.5 Cotizaciones

**Para qué sirve.** `cotizaciones/index.html`: lista, KPIs, pestañas Taller/Ventas y modal de
aprobación (admin, vendedor, jefe_taller, gerente). `nueva/editar-cotizacion`: editor
compartido con respaldo local de 3 días (admin, vendedor, jefe_taller; el gerente ve los dos
botones "Nueva" y el editor lo expulsa). `detalle-cotizacion`: historial, aperturas del cliente,
"Cambiar estado", enviar, cerrar. `imprimir-cotizacion` (sin guard; "Editar" siempre visible).
`verify/cotizacion.html`: vista pública, solo ver y "Descargar PDF": **no acepta ni rechaza,
no muestra estado ni vencimiento**; un link de una cotización vencida o descartada se ve
vigente. `ordenes/cotizar-orden`: cotización de taller con autoguardado en servidor.

**Mapa de estados.** Borrador (azul) → Enviada (ámbar) / Aprobada (verde, intermedio) →
Rechazada (rojo, cliente **o** gerente) / Descartada (gris) / Vencida (naranja) / Convertida
(gris). Derivados: Por facturar (naranja), Facturada (gris), Taller (azul). Ver T1: el éxito
es gris y hay dos caminos de cierre.

**Pasos.** Comercial de 3 líneas dentro de política: ~15 (la página de detalle intermedia no
aporta nada: el sistema ya sabe que está en política, `cot-editor.js:861-867`; sin spinner al
generar el link). Fuera de política: guardar encola el correo (`:864`); el gerente aprueba en
2-4 desde el correo; **aprobar desde el detalle redirige a la lista y carga 30 docs**
(`cot-detalle.js:365-367`); en edición cruzar el umbral no encola (solo en modo nueva,
`:868-885`) y "Solicitar aprobación" no dice si ya se pidió. Cliente: abre, ve, descarga;
acepta respondiendo el correo; el vendedor cierra en 2 (taller en 4). Taller: **siempre**
encola aprobación aunque prepare la propia jefa, y el toast lo dice mal (`cotizar-orden.js:705,717`);
no estampa `requiere_aprobacion`. Buscar vieja: 2 por número COT exacto; por cliente sobre
las 30 cargadas; sin fechas. Duplicar: 2 implementaciones.

**Hallazgos adicionales (P1):** `preview()` hace `if (!validar())` sobre una función `async`
y nunca bloquea (`cot-editor.js:908-909`); el botón del modal dice "Aprobar" aunque envía, y
el aviso "sale al cliente de inmediato" solo aparece en comerciales (`index.html:199`,
`cotizaciones-index.js:629-637`); correo de solicitud titulado "Nueva cotización creada"
(`cot-editor-state.js:1081-1086`); descuento con clamp y `validar()` ya hechos; adjuntos
huérfanos en Storage (`cot-editor.js:648`); `requiere_aprobacion` lo estampa el cliente y las
rules confían en él (`firestore.rules:190`).

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | Rechazo del aprobador separado: `rechazo_origen:'aprobador'` + motivo obligatorio + correo al vendedor; fuera de la tasa de cierre; texto del historial | `cotizaciones-index.js:806,200`, `cot-detalle.js:117` | 3-4 h | Historial y KPI verdaderos |
| 2 | "Restaurar" en filas eliminadas (fila atenuada, sin Editar/Duplicar) | `cotizaciones-index.js:274-300,526` | 1 h | Promesa cumplida |
| 3 | Respaldo: aplicar `cliente_id` después del merge y recalcular ITBMS; "Nuevo cliente" pasa por `salir()` | `cot-editor.js:332,984` | 30 min | No se pierde el cliente |
| 4 | KPIs honestos ("de las N cargadas" o `count()`); SAP → `?aprobar=1` | `cotizaciones-index.js:159-210`, `home-signals.js:180` | 2 h / 1 d | Números estables |
| 5 | Colores (T1) y retirar "Marcar Convertida/Rechazada" del panel | `ceco-ui.css:164-171`, `cot-detalle.js:388-399` | 2 h | Estado de un vistazo |
| 6 | `?enviar=1` al guardar en política; spinner y candado en enviar; "Aprobar y enviar" con aviso también en taller | `cot-editor.js:867`, `cot-detalle.js:540`, `index.html:199` | 2-3 h | −1 página por cotización |
| 7 | Aprobar desde el detalle sin redirigir (extraer `openAprobacion`) | `cot-detalle.js:365` | 3 h | −30 lecturas y −1 salto |
| 8 | Gerente: ocultar "Nueva" según el editor; quitar el botón duplicado | `index.html:45,59` | 20 min | Sin rebotes |
| 9 | Taller: encolar solo si quien prepara no puede aprobar; estampar `requiere_aprobacion`; toast correcto | `cotizar-orden.js:705,717` | 1 h | Sin aprobaciones a sí misma |
| 10 | `await validar()` en preview; "Editar" solo si editable; correo "Solicitud de aprobación" | `cot-editor.js:909`, `imprimir-cotizacion.js:182`, `cot-editor-state.js:1081` | 30 min | Detalles |
| 11 | Glosario: cotización, cliente, vendedor, aceptada (T2) | textos | medio día | Consistencia |
| 12 | P2: aceptar/rechazar + estado + vencimiento en la vista pública (1-2 d); búsqueda en servidor con fechas (1 d); unificar duplicar (medio día); limpieza de adjuntos (medio día); `requiere_aprobacion` validado en Function (medio día) | — | 4-5 d | El cliente responde en la página |

### 4.6 Almacén e Inventario

**Para qué sirve.** El espacio `/almacen/` (pestañas de `almacen-nav.js:19-36`; entran admin,
inventario, gerente, y recepción/vendedor por `gestionar-seriales`): **Hoy** (bandeja única:
colas de contratos, gestiones, devueltos sin tiquete, conflictos, diferencias de conteo),
**Asignar** (seriales a contratos y gestiones con política dura + corrección de seriales),
**Existencias** (modelo → seriales → ficha, Dif contra conteo, lotes, Excel, reporte por
correo), **Piezas**, **Descartados** (solo consulta; revocar admin/jefe_taller), **Con
condición** (consulta; sin botón para registrar una nueva), **No devueltos** (cobro:
aprobar descuento, facturar, condonar, "apareció"). Fuera del espacio: `inventario/equipos.html`
("Equipos por serial, avanzado") es la segunda casa con acciones que Almacén no tiene: Corregir
serial, Editar ficha (sin kardex, `inventario-equipos.js:1428-1440`), lotes con **Detener**,
conciliación e importador propio; casi todos los "Revisar" de Hoy mandan allá
(`almacen-hoy.js:322,390`). `modelos`, `piezas-tarifas`, `cargos` pertenecen a Finanzas y **el
rol inventario no puede abrir el catálogo de modelos**. Cuatro páginas solo redirigen
(`vista-correo.html` con dos saltos y texto viejo).

**Mapa de estados del pool** (`equiposPoolService.js:21-64`): `en_bodega`, `asignado_contrato`,
`en_cliente`, `en_taller`, `devuelto_revision`, `por_clasificar`, `vendido`, `pendiente_cobro`,
`no_retirado`, `baja`. Ver T1 (dos paletas, cuatro nombres para "devuelto", `no_retirado` sin
columna). "Disponible" = `en_bodega` sin matices: una unidad marcada DAÑADA por el importador
sigue seleccionable, porque la marca es solo una nota (`asistente-importar.js:195-200`); el
selector del estante solo filtra Nuevo/Refurbished (`asignador-seriales.js:422`).

**Pasos.**

| Flujo | Hoy | Nota |
|---|---|---|
| (a) Recibir 20 radios con lector | 5-6 + 20 escaneos + 0-3 confirms | Foco no salta al cuadro de seriales; NX-410 vs NX-410-R obliga a un select nativo; "Condición" deshabilitado ocupa espacio; casilla "Toma física inicial (migración…)" confunde |
| (b) Asignar 20 seriales | 6 con selector automático; con lector 1 + 20 + 19 Tab | La selección automática (FIFO) da seriales que bodega tiene que **buscar en el estante sin lista imprimible por serial** (`almacen-asignar.js:179-191`) |
| (c) Conteo de un modelo | 5 | Enter no pasa al siguiente |
| (d) Importar hoja | 8-9 | Pide el modelo **antes** del archivo (`asistente-importar.js:609-626,733`) aunque ya reconoce nombres de modelo dentro de la hoja (`:816-822`) |
| (e) Buscar serial y ver kardex | 2-3 | Mientras tecleas la tabla dice "Sin modelos que cumplan el filtro" (`almacen-existencias.js:227-229`); Hoy no tiene buscador; Ctrl+K no busca en el pool |
| (f) Corregir serial | ~8 saliendo a `equipos.html` | La ficha de Almacén no tiene la acción (`equipo-ficha.js:211-235`) aunque el servicio sí |
| (g) Baja / descartar | 5-6 | Bodega no puede descartar (lo hace QC en ENTRADA); "Descartados" no muestra las bajas |
| (h) Venta desde el pool | 6 + N | 1 consulta por serial; vende uno a uno sin Detener |
| (i) Piezas | Sumar 10 = 10 clicks + 10 recargas | Sin filtro "Sin stock" (solo "Stock bajo" mezclado); KPI no clicables; S9 aterriza sin filtro (`home-signals.js:190`); "Editar" sin motivo ni kardex; `ajustarDelta` recorta en 0 sin avisar (`piezasService.js:65`); vacío por filtro dice "Crea tu primera pieza" (`piezas.js:489-499`) |
| (j) Condición particular | 5-6 | Solo desde la ficha |
| (k) No devueltos | 1 | Bien |

**Hallazgos adicionales (P1):** "Inspección OK (N)" en lote libera **también** unidades con
ENTRADA del taller abierta, contradiciendo a Hoy (`almacen-existencias.js:318-321,471-488` vs
`almacen-hoy.js:302-329`), y `liberar` no revisa el estado esperado (`equiposPoolService.js:823-847`);
el importador premarca corregir propiedad y "traer a bodega" aunque el contrato siga vigente
(`asistente-importar.js:106,108`) y "Fijar conteo" usa el total con bloqueadas y colisiones
(`:1090,1194`); `equipos.html` no carga `SerialPatron` ni `EquiposCondicionesService`
(`entry/inventario-equipos.js`), así que recibir desde ahí no detecta seriales mal
transcritos; su búsqueda repinta el pool entero por tecla sin debounce (`equipos.html:203`);
lotes de Existencias solo muestran "Procesando i/N" en el botón, sin Detener ni reporte
(`:486`); eliminar modelo sin contador de referencias (`inventario-modelos.js:503-507`); textos
viejos: menú "Radios" (`piezas.html:80`), "Volver: Inventario" (`equipos.html:175`), "picker
Tomar del pool" (`inventario-equipos.js:893`).

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | `no_retirado` en `OTROS` o columna propia, con punto | `almacen-existencias.js:43` | 15 min | Totales veraces |
| 2 | `banner('aviso')` → `'warn'` | `almacen-asignar.js:682` | 5 min | El aviso del taller se ve |
| 3 | Cerrar los dos callejones: "Registrar descarte" en `descartados.html` (o texto nuevo en `ordenes-flujo.js:827`); vía de cambio de serial al alcance del rol inventario (o texto de `almacen-asignar.js:329`) | — | 2-4 h | Bodega termina sola |
| 4 | Lector (T12): Enter → siguiente casilla / siguiente modelo / cuadro de seriales; repetido resaltado; repetidos ≠ inválidos | `asignador-seriales.js:112`, `asistente-conteo.js:38`, `asistente-recibir.js:371`, `equiposPoolService.js:653` | 2 h | −19 interacciones por contrato de 20 |
| 5 | Consultar `equipos_descartados` en Recibir, Importador, `validarDuro` y selector del estante | `serial-field.js:104` como modelo | 4-6 h | Un descartado no vuelve a circular |
| 6 | "Inspección OK" en lote: excluir `orden_actual_id`; `liberar` con `esperado` | `almacen-existencias.js:471`, `equiposPoolService.js:823` | 1 h | No se salta al taller |
| 7 | "Corregir serial" en `EquipoFicha`; "Revisar" de Hoy abre la ficha | `equipo-ficha.js:211`, `almacen-hoy.js:322,390` | 3 h | Corregir en 4 en vez de 8 |
| 8 | "Editar ficha" → `reclasificarModelo` / `corregirPropiedad` | `inventario-equipos.js:1428` | 2 h | Kardex completo |
| 9 | Importador: archivo primero y modelo propuesto; sin premarcar con contrato vivo; `FilteredSelect`; conteo solo con altas/presentes/traídas | `asistente-importar.js:106-108,609-626,1090` | 3 h | Menos Dif artificial |
| 10 | Terminología y color del pool (T1/T2): "Devuelto · por inspeccionar" único, "Tipo" en vez de "Condición", "Reactivar" único, sin "pool", paleta única de puntos | `almacen/index.html:46-53,130,219`, `ceco-ui.css:2302` | 3-4 h | Menos consultas |
| 11 | Piezas: ±N con motivo, "Sin stock", KPI clicables, deep-link S9, vacío correcto, sin `user-scalable=no` | `piezas.js:479-559,722`, `piezas.html:31` | 3 h | 10 clicks → 2 |
| 12 | Limpieza legacy: `vista-correo` directo; textos; importar `SerialPatron`/condiciones en el entry de equipos; debounce | ver arriba | 2 h | Consistencia |
| 13 | P2: pick & confirm (picklist por serial y verificación por escaneo) | Asignar | 2-3 d | Menos seriales cruzados |
| 14 | P2: absorber `equipos.html` en Almacén (lotes con Detener y reporte, edición con kardex) y retirar su importador y conciliación | — | 4-6 d | Una sola casa |
| 15 | P2: validación por lotes `in`; pool en Ctrl+K; "disponible" ≠ "en bodega"; kardex y una sola página de precios de piezas; Existencias en tablet | — | 3-5 d | Escala y veracidad |

### 4.7 Base PoC

**Para qué sirve.** `POC/index.html` ("Equipos PoC" / "Base PoC" / "Base de Datos PoC"): lista
maestra, filtro por campo, duplicados (seriales, SIMs, grupos inválidos; **no** Unit IDs),
cajón de edición, edición en masa (tope 25), imprimir, "Contratos recientes". `nuevo-batch`:
recepción crea el lote desde el JSON del vendedor (botón "Nuevo equipo" → página "Nuevo
batch"). `vendedores-batch`: el vendedor **prepara** nombres, modelo, grupos y GPS y descarga
un JSON que viaja por correo o WhatsApp (4 nombres distintos y ninguno dice "preparar"; P0 #26).
`nueva-consola` (bien), `sim-cards` (bien), `imprimir-equipos` (carga en serie, `innerHTML` sin
escapar, `:201,221-231`), `importar-poc` (ya con revisión, dedup y candado; escritura uno a uno,
`:227`), `editar-batch` retirada.

**Estado del dispositivo:** no tiene campo; se deriva de `activo` (punto sin texto), `deleted`
("Cerrada" reabrible aunque el botón diga "Eliminar") e "Incompleto". Toggles "Solo activos" /
"Solo inactivos" como dos casillas excluyentes (`POC/index.html:248-249`).

**Pasos.** Vendedor prepara: ~9 + envío fuera del app (archivo siempre `equipos-vendedores.json`,
`:722`; el borrador se borra al descargar, `:728`). Recepción crea: ~5 pero hasta **6 modales
seguidos** + pregunta de SIM; guardado uno a uno con `addPocDevice` (fallo a la mitad = lote
parcial, `nuevo-batch.js:1508,1572`); `registrarCliente` corre **antes** de validar (`:1222`).
Editar uno: 5. Edición masiva sin `try/catch` ni candado. Imprimir: 5. SIM manual 7 / Excel ~5.
Consola 8 (4 desde el aviso). Buscar: 2.

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | GERENTE en `poc-index.js:17` (o quitar "poc" del gerente) | `modulos.js:38` | 10 min | La tarjeta funciona |
| 2 | Textos: "Preparar lote (Ventas)" en home/rail/menú/título; "Nuevo lote"; quitar "seriales consecutivos"; quitar "+ Grupo" del toast; un solo nombre "Base PoC" | `index.html:110-119`, `modulos.js:64-65`, `POC/index.html:179-185`, `nuevo-batch.html:170`, `vendedores-batch.js:193` | 1-2 h | El vendedor sabe que aún falta cargar |
| 3 | Guard de rol en `nuevo-batch` y `nueva-consola` (reusar `PocState.esLectura`) + endurecer `firestore.rules:764` | `nuevo-batch.js:1104`, `poc-nueva-consola.js:328` | 2 h | Cierra la escritura abierta |
| 4 | Choque de Unit ID al editar (cajón y masiva) + vista "Unit IDs duplicados" | `poc-edit.js:226`, `poc-bulk.js:124-139`, `poc-list.js:929` | 3 h | Sin IDs repetidos en la plataforma |
| 5 | `withBusy` + `try/catch` en edición masiva; `registrarCliente` después de validar | `poc-bulk.js:104-181`, `nuevo-batch.js:1222` | 2 h | Sin lotes a medias |
| 6 | "Cerrar ficha" en vez de "Eliminar", con qué pasa con el SIM; segmento único activos/inactivos; leyenda del punto | `poc-list.js:279-346`, `POC/index.html:248` | 2 h | Se entiende sin preguntar |
| 7 | JSON con cliente y fecha en el nombre; `Promise.all` y escape en imprimir | `vendedores-batch.js:722`, `imprimir-equipos.html:201-231` | 1 h | Recepción no confunde archivos |
| 8 | P2: lote atómico (WriteBatch o callable) + **una hoja-resumen** con decisiones por grupo en vez de 6 modales | `nuevo-batch.js:1318-1551`, `importar-poc.html:227` | 2-3 d | Sin lotes parciales; 6 → 1 |
| 9 | P2: traspaso vendedor → recepción **dentro del app** (lote "pendiente de cargar" + cola en recepción) | nuevo | 3-4 d | Desaparecen el archivo y el WhatsApp |
| 10 | P2: vista móvil de la tabla de 12 columnas | `POC/index.html` | 1-2 d | Uso de pie |

### 4.8 Finanzas y facturación

**Para qué sirve.** Espacio con pestañas (`finanzas-nav.js`): **Bandeja** de Facturación
pendiente (recepción por su módulo propio; admin y contabilidad por la pestaña; la mejor
pantalla del alcance), **Comisiones** ("listo para pago", derivadas de los hechos),
**Catálogo** (`inventario/modelos.html`, que es la **portada** del espacio aunque la nav ponga
Bandeja primero "por uso real", `modulos.js:79` vs `finanzas-nav.js:9-12`), **QuickBooks**
(vincular clientes con Customers; estado del token), **Facturará la app** (`activacion.html`;
la confirmación dice "Activar facturación" y Emisión la llama "pestaña Activación"),
**Emisión** (página honesta: "la app todavía NO emite", con jerga "qboPost", "idempotencia",
`:83`), **Panorama** (`admin/financiero.html`). "No devueltos" (cobro de equipos) vive en Almacén
y contabilidad no lo encuentra en su espacio. Need-to-know: bien resuelto (recepción ve
montos por línea e ITBMS en la Bandeja, que es lo que necesita para facturar en QBO, y nada
más).

**Estados.** Aviso: `pendiente` / `esperando` / `hecho` / `descartado`; efectos arranca /
cambia / termina (claros); terminología cruzada de "No aplica" (T1). Comisión: esperando /
listo / pagada / no_aplica (claro). Activación: Pendientes / Listos / Activos / En espera / No
facturables con checklist rojo/ámbar (claro).

**Pasos.** Bandeja: 6 por aviso (pastilla QBO, número de factura, hecho, pastilla POC, hecho);
sale de la cola cuando todos los pasos aplican o con "No aplica…" + motivo; "Facturar desde"
se mantiene en las bajas donde la ayuda dice "Fecha en que deja de cobrarse" (`bandeja.js:212-214`);
el paso "POC" se confunde con la Base PoC. Activación: 5; "Confirmar entrega" P0 #25; "No
facturable" confirm + prompt encadenados; "Sí factura" y "Reactivar" sin confirmación. QBO:
seguro 2, riesgo 3 con nombres lado a lado, sin match 4 con `<select>` nativo de ~509 Customers
(`clientes-qbo.js:147-160`); no valida que el Customer ya esté vinculado a otro cliente (regla
1 a 1); un apóstrofe en el nombre rompe el botón (`:167`). Comisiones: 5-6 por comisión, **sin
cierre en lote** por vendedor/período (justo cuando se paga la planilla); fecha de pago en UTC.
`listCerrados` con `limit(200)` sin `orderBy` (`facturacionAvisosService.js:48`): al pasar de 200
"Ver hechos" mostrará un subconjunto arbitrario (hoy ~43).

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | Date picker en "Confirmar entrega" con validación; confirm + prompt → un modal; confirmar "Activar" con el nombre del contrato | `facturacion-activacion.js:256-263` | 1 h | Deja de fallar en silencio |
| 2 | Fechas en hora de Panamá (T8) | `activacion.js:208`, `comisiones.js:264,397` | 1 h | Sin fechas corridas |
| 3 | Portada de Finanzas = Bandeja; "Volver" consistente | `modulos.js:79`, `facturacion/index.html:12` | 30 min | Se entra a lo que se usa |
| 4 | QBO: validación 1 a 1, arreglo del apóstrofe, combo con búsqueda | `clientes-qbo.js:147-167,196-235` | 3-4 h | No se factura a otra empresa |
| 5 | `orderBy` en `listCerrados` | `facturacionAvisosService.js:48` | 15 min | Riesgo latente cerrado |
| 6 | Terminología de la bandeja: "No aplica" **o** "Descartado"; paso "Plataforma PoC"; "Deja de cobrarse el" en bajas; un solo conteo de pendientes | `bandeja.js:212,337,379-387` | 2 h | Menos dudas por aviso |
| 7 | Emisión sin jerga; "pestaña Facturará la app" | `emision.html:74,83` | 30 min | Contabilidad lo entiende |
| 8 | P2: cierre de comisiones en lote por vendedor/período + CSV | `facturacion-comisiones.js` | 1-2 d | 5-6 × N → ~4 por planilla |
| 9 | P2: "No devueltos" enlazado desde Finanzas; vistas móviles de Activación y QBO; actualizar `docs/FACTURACION_COMO_FUNCIONA.md` (2026-06-24, no menciona Bandeja ni Comisiones) | — | 2-3 d | Cobranza con dueño |

### 4.9 Panel de administración

**Para qué sirve.** Ya está agrupado por tarea (Monitoreo, Usuarios y acceso, Configuración,
Calidad de datos, Herramientas técnicas colapsadas, `admin/index.html:118-274`), lo que sigue
técnico es el contenido: Salud ("Mail queue", "enum ROLES", "drift"), Integridad ("callable
`rebuildContractCache`", "`os_count`"; bajo "Modifican registros" pero se declara "Sólo
diagnóstico"), Backfills (todo `searchTokens`, `equipos_pool`; "idempotente" pero no dice
"no se puede deshacer"; "Ejecutar" activo sin dry-run y destacado; sin registro de ejecución),
Configuración (ayudas buenas con jerga suelta: "admin-tuneables que sobre-escriben los defaults
hardcoded", "Kill-switch"; ITBMS como decimal 0.07; "Última edición por `<uid>`"; sin historial
ni antes/después), Grupos PoC (trabajo diario de recepción bajo "Calidad de datos", con
`poc_grupo_prefix` y "🔴 exactos / 🟡 fuzzy"). Usuarios: roles como claves crudas; **un usuario
sin rol se ve como "administrador"** (el navegador marca la primera opción,
`admin-usuarios.js:16,69`). Auditoría: filtro "Usuarios" activo pero fuera del estado inicial
(`admin-auditoria.js:19`); solo últimas 300 órdenes/contratos por fecha de creación (una entrega
de hoy sobre una orden vieja no aparece); sin filtro por persona ni fecha; no registra cambios
de configuración, fusiones, backfills ni purgas. Clientes duplicados: confirm bueno pero dice
"soft-delete, reversible" y no lo es (`mergeCluster` re-apunta órdenes, PoC y contratos sin
guardar el valor anterior, sin lote; re-apunta también por nombre normalizado, riesgoso en
grupos "por similitud"; "~N referencias" subestima, `clientesDedupService.js:272-306`). PII:
**activar** la purga no pide confirmación y desactivarla sí (`admin-pii.js:201`). KPI Junta: el
mes se marca publicado **antes** de generar el PDF (`admin-kpi-reportes.js:118-121`). El aviso
"usuarios sin rol" manda a la consola de Firestore aunque exista `usuarios.html`
(`admin-index.js:170-171`). Descripciones de accesos que prometen lo que no hay ("índices,
integridad", "operadores, tipos de servicio", `index.html:141,190`); tooltip "cada 60 s" vs
300 s (`:67`).

**Pasos.** Crear usuario y rol: ~10 + link fuera del sistema + cargo aparte (+3). Cambiar
umbral: 5-6 (bien). Alertas/salud: 2-4 pero sin salida (solo se actúa sobre correos fallidos;
errores solo en consola, `admin-salud.js:176-178`). Fusionar: ~6 por grupo. KPI e imprimir:
12-14. Auditoría: 2, incompleta. Ver como: roto. Backfill: 5-6.

**Cambios en orden:**

| # | Qué | Dónde | Esfuerzo | Beneficio |
|---|---|---|---|---|
| 1 | Lista única de estados abiertos/cerrados (`PendientesDomain.ESTADOS_ABIERTOS` + cerrados de `admin-operacion.js:150-157`) para los 4 consumidores + test | `admin-index.js:19-22,93`, `admin-alertas.js:155`, `admin-operacion.js:216,410`, `admin-integridad.js:111` | 2-3 h | KPI y alertas dejan de mentir |
| 2 | `import '/js/ui/modal.js'` en los dos entries; contabilidad en Ver como | `entry/admin-index.js`, `entry/admin-kpi-reporte-print.js`, `verComoPicker.js:16` | 15 min | Ver como y errores del PDF vuelven |
| 3 | Borrar `public/tools/` (mínimo las 3 peligrosas) | `public/tools/` | 10 min | Nadie corre una migración sin rol |
| 4 | Aviso "sin rol" → `usuarios.html?filtro=sinrol`; opción "— sin rol —"; roles legibles con descripción (reusar `ROL_LABELS` de `admin-config.js:205`) | `admin-index.js:170`, `admin-usuarios.js:69,229` | 2 h | El dueño actúa sin consola |
| 5 | PII: confirmar al **activar**; KPI: publicar solo tras archivar el PDF | `admin-pii.js:201`, `admin-kpi-reportes.js:118` | 1 h | Sin activaciones ni meses sin PDF |
| 6 | Auditoría: filtro arreglado, persona y fechas, y colección `admin_audit` para config/fusiones/backfills | `admin-auditoria.js:19`, `auditoriaService.js`, `empresaService.setConfig` | 1-2 d | Se sabe quién cambió qué |
| 7 | Fusión: quitar "reversible", guardar registro previo para deshacer, lotes, no re-apuntar por nombre en grupos "por similitud" | `clientes-duplicados.html`, `clientesDedupService.js:266-338` | 1 d | Una fusión mal hecha tiene vuelta |
| 8 | Backfills: "Ejecutar" solo tras dry-run del día; "No se puede deshacer" por tarjeta; última ejecución guardada | `backfills.html`, `admin-backfills.js:95-105` | 3 h | Menos riesgo |
| 9 | Pasada de textos: ITBMS en %, "Última edición por <nombre>", sin nombres de función/campo, accesos y tooltip correctos, mensajes de alerta legibles | `admin-config.js`, `config.html:72`, `salud.html`, `index.html:67,141,190`, `adminMetrics.js:78-101` | 3-4 h | El dueño lo entiende |
| 10 | Tablas con scroll horizontal y un solo sistema (`app-table`); colores de `alert-banner` a tokens | `admin-panel.css:193-295` | 0.5-1 d | Usable en móvil |
| 11 | Reorganizar por tareas: **Cómo va el negocio** (Operación, Financiero, Junta) · **Personas y accesos** (Usuarios con contador sin rol, Ver como, Auditoría) · **Reglas del negocio** (Configuración, Alertas, Estados y Modelos traídos de `ordenes/config`, Privacidad) · **Limpieza de datos** (Duplicados, Enlaces rotos, Grupos PoC con acceso directo desde PoC) · **Salud del sistema** colapsado (Salud, Integridad, Migraciones, Preview de correo) | `admin/index.html` | 3 h | Panel por tarea de verdad |

---

## 5. Estado de la auditoría del 2026-08-13

| Recomendación de agosto | Estado hoy |
|---|---|
| P0 #1 Toast/Modal en clientes/index | Hecho (entry) |
| P0 #2 debounce global del grid | Hecho (por cliente); queda el guardado por pausa |
| P0 #3 "Limpiar selección" mata Guardar | Resuelto por retiro de `nuevo-contrato` (código muerto sigue en el repo) |
| P0 #4 `ruc_norm` inline | Hecho, y RUC/DV de solo lectura en el grid |
| P0 #5 `window.cargarOrdenes` | Hecho |
| P0 #6 filtro del Conteo | Hecho |
| P0 #7 importar-poc sin preview | Hecho (revisión, dedup, candado, guard); escritura uno a uno pendiente |
| P0 #8 editar-batch | Hecho (retirada) |
| P0 #9 gerente bloqueado de Contratos | Hecho (`canRole('ver-contratos')`); **reaparece con gerente en PoC y contabilidad en Contratos** |
| P0 #10 conteos que mienten | A medias: chips de órdenes con `count()` y KPIs de órdenes retirados; siguen "Todas" local, el tope 200 sin aviso, y los KPIs de cotizaciones |
| P0 #11 tecnicos/estado_reparacion | Hecho en lo principal (redirección, candado en 5 estados, Modal); pendiente guard de rol y rule; los estados extra siguen sin uso |
| P0 #12 duración "Otro" vacía | Hecho al crear; **reapareció al editar** (`:7098`) |
| Doble submit (nueva/editar orden, cot-editor, activación, existencias) | Hecho en esos 5; ver T3 para los 12 que faltan |
| A1 shell y móvil | Parcial: 61 páginas con rail, FAB del drawer sin `renderShell`, topbar de Órdenes migrado; `renderShell` 0 páginas; Órdenes móvil quedó peor; 6 páginas de trabajo sin rail |
| A2 Ctrl+K global | Hecho en 62 páginas; falta el home, botón visible, móvil, `?focus=` de PoC, "recientes" |
| A3 señales con deep-link | Hecho (S1-S8, ENT abre el modal); flecos SAP/EST/S7/REGV/S9 |
| A4 confirmación, aviso y "ocupado" | Parcial: 0 diálogos nativos en el app; `withBusy` no existe; el Enter de `Modal.confirm` sigue |
| A5 contador atómico de órdenes | Hecho |
| A6 combo buscable reutilizable | Parcial: `EntityCombo` y `FilteredSelect` en nueva-orden, cotizaciones, contratos, venta y Recibir; siguen selects nativos en el Importador, `equipos.html` y QBO |
| A7 autosave | Parcial: cot-editor con respaldo (con el bug P0 #19); wizards del Centro sin autosave |
| A8 búsquedas | Parcial: número COT exacto y filtro de vendedor en servidor; contratos por tokens no verificado; fechas y `count()` pendientes |
| A9 catálogo único | Parcial: rail y palette desde `CATALOGO`; tarjetas del home estáticas y espejo desincronizado |
| A10 umbral por línea + backend | Hecho en UI y rules; el flag lo pone el cliente (validar en Function) |
| 4.1 Órdenes | Hechos: redirect a agregar-equipo (mejor: batch si hay contrato), "Asignármela", chip QC, documentos directos (salvo vendedor), aviso al completar, volver con `?orden=`, chips de accesorios, Eliminar en terminales, escape del reporte. Pendientes: intervención en lote (a medias), fotos, ENTRADA en editar-orden, cliente con email |
| 4.2 Cotizaciones | Hechos: COT exacto, duplicar con confirm, clamp/validar/aviso, aperturas en detalle, doble submit. Pendientes: `?enviar=1`, spinner, "Aprobar y enviar" en el botón, unificar duplicar, adjuntos |
| 4.3 Contratos y Clientes | Hechos: renovar 4-6, fila inicial automática, alta por ficha, anular con modal, aprobado editable con reaprobación, pre-check de borrar cliente, dedup al guardar. Pendientes: filtros persistentes, N+1 de `advertenciasPool`, `qrcode` CDN, `?redirect=true` en edición |
| 4.4 Almacén | Hechos: `SerialPatron` en Recibir (Almacén), candado y progreso en lotes, corregir serial (solo en la página avanzada). Pendientes: archivo primero en el importador, ±N en piezas, repetido resaltado, venta por lotes `in`, debounce, "Fijar conteo", propiedad premarcada, referencias al eliminar modelo |
| 4.5 PoC y Facturación | Hechos: doble submit en activación, confirm + rastro QBO, "Sin match" con vínculo manual y recarga, buscadores. Pendientes: WriteBatch del lote, Unit ID al editar, modales encadenados (a medias), imprimir en paralelo, prompt de fecha (hoy P0 #25) |
| 4.6 Home | Hecho: Roboto self-hosted. Pendientes: `user-scalable`, CTA duplicado de cotizaciones, contraste, bottom-nav en PoC/Almacén, convención de botón |

---

## 6. Módulos y roles: quién ve qué (para validar con Alberto)

| Rol | Ve en el home | Incoherencias encontradas |
|---|---|---|
| administrador | todo | "Ver como" roto; KPI falsos |
| gerente | órdenes, poc, almacén, inventario, equipos, centro, contratos, cotizaciones | PoC lo rebota; ve "Nueva cotización" y el editor lo expulsa; no ve "Documentos" desde `documento.html` |
| vendedor | órdenes, vendedores, centro, contratos, cotizaciones | "Registro (Ventas)" no registra; cartera puede salir vacía; el archivo filtra por creador; ve "Config" y "Nueva" en el cajón móvil de órdenes aunque `roles.js` sí le deja crear órdenes |
| recepcion | órdenes, poc, vendedores, centro, contratos, facturación pendiente | entra a Grupos PoC con doble salto si falla la redirección |
| inventario | almacén, inventario, equipos, pendientes, piezas | recibe instrucción de abrir el Centro sin tenerlo; no puede abrir el catálogo de modelos; ve costos de piezas |
| contabilidad | facturación | tiene `ver-contratos` sin módulo; 0 señales en el home; falta en "Ver como" |
| jefe_taller | órdenes, poc, cotizaciones | `ver-inventario` sin efecto; no ve "Progreso" aunque `ver-progreso` lo incluya |
| tecnico / tecnico_operativo / vista | órdenes, poc | técnicos ven "Progreso" sin tener `ver-progreso` |

---

## 7. Plan de ejecución sugerido

**Semana 1, P0 (31 ítems, casi todo son horas):** los 5 del shell, 3 de Órdenes, 7 del Centro,
5 de Clientes/Cotizaciones, 3 de Almacén, 3 de PoC/Finanzas, 5 del Admin, más borrar `tools/`.
Empezar por los que producen dato falso ante terceros o pérdida de datos: verificación pública
(#1), formulario viejo de cliente (#16), importador de órdenes (#7), KPI del admin (#27-30),
renovación sin firmar (#9), doble submit de gestiones (#10), Anexo A vacío (#11).

**Semanas 2-4, transversales y quick wins (P1):**
1. `withBusy` y los 12 sitios sin candado (T3).
2. `Acceso.guard` + las dos rules abiertas (T4) y la tabla de la sección 6 validada con Alberto.
3. Login/sesión (T5) y fechas de Panamá (T8).
4. Estados con un nombre y un color (T1) y glosario (T2): es el trabajo de mayor efecto en
   "¿esto qué significa?" y no toca datos.
5. Búsqueda: Ctrl+K en el home con botón visible, `?focus=`, deep-links que faltan (T6).
6. Móvil: "Menú" en Órdenes, scroll en tablas, zoom, contraste (T7).
7. Bodega con lector (T12) y los callejones cerrados.
8. Los quick wins por módulo de la sección 4 (~90), en el orden de cada tabla.

**Meses 2-3, proyectos (P2):** hoja-resumen única y lote atómico en PoC; traspaso
vendedor→recepción dentro del app; línea de tiempo del contrato con bodega, programación y
entrega + candado de firma; partir `clientes-centro.js`; absorber `equipos.html` en Almacén y
pick & confirm; aceptar/rechazar en la cotización pública; búsqueda en servidor con fechas y
`count()`; un solo formulario de cliente, un solo editor de modelos, una sola captura de
equipos en órdenes; `renderShell` + rail en el home + una convención de botón; cierre de
comisiones en lote; auditoría de configuración/fusiones/backfills; unificar pickers y lienzos.

---

## 8. Métricas de partida (para medir el efecto)

| Indicador | Hoy |
|---|---|
| Páginas HTML en `public/` | 99 (80 de trabajo) |
| Páginas con rail | 61 · con `renderShell`: 0 |
| Diálogos nativos en código del app | 0 (17 en kit y `tools/`) · `Modal.confirm`: 126 |
| `.disabled = true` a mano | 144 · `withBusy`: no existe |
| Redirecciones a `login.html` relativo | 14 + el guard |
| Páginas con `user-scalable=no` / `maximum-scale=1` | 4 / 2 |
| Código muerto de contratos | ~2,440 líneas (10 archivos) |
| Tamaño de `clientes-centro.js` | 7,461 líneas, ~260 métodos |
| Nombres para el estado "devuelto por inspeccionar" | 4 |
| Nombres para la página de preparar lotes PoC | 4 |
| Formas de escribir la marca | 4 |

---

## 9. Lo que no se verificó (todo sale de leer el código)

- Comportamiento real en navegador, móvil, tablet y con el lector de barras de la bodega
  (si su sufijo es Enter o Tab).
- Que el reporte de pendientes salga efectivamente vacío en producción (P0 #6) y que las
  rules no frenen la importación que pisa documentos (P0 #7).
- El porqué del 70 % de entregas en papel: solo se cita del comentario del código.
- El volumen de clientes por cartera de vendedor (para dimensionar P0 #15).
- Si el proyecto de Firebase tiene activa la protección contra enumeración (T5).
- Si `/clientes/centro.html` rechaza al rol inventario por URL directa.
- En qué estado del pool queda un equipo descartado en QC tras cerrar la ENTRADA.
- Si hay usuarios sin rol hoy en producción.
- Lo que hace `runBackfill` en el servidor (la idempotencia viene del texto de la UI).
- El contenido de `admin/financiero.html` más allá de su guard.

---

## Nota de alineación

Este informe continúa `docs/AUDITORIA_UX_2026-08-13.md` (sección 5 dice qué se hizo de aquello)
y es consistente con la migración modular cerrada el 2026-09-28 (`docs/plans/`): producción
sirve `dist/`, así que **cualquier cambio de página nueva pasa por un entry en `js/entry/`**,
y dos de los P0 de hoy (Ver como, errores del PDF del KPI) son justamente entries a los que
les faltó un import en esa migración. Los conteos de interacciones son del camino feliz con
el app abierta; el detalle por pantalla con evidencia `archivo:línea` está en las secciones
1, 2 y 4.
