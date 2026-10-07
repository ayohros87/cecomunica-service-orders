# Plan: herramientas de autoservicio para bodega, vendedor y recepción

Fecha: 2026-10-07. Base: las 14 intervenciones a mano (scripts en `functions/scripts/`) hechas entre el 15-sep y el 7-oct de 2026 a pedido de Alberto, Brenda, Elvia, Zuleika y Solís.

## 1. Qué se arregló a mano y por qué no lo pudo hacer el usuario

| Fecha | Caso | Qué pasó | Quién lo descubrió | Por qué hizo falta un script |
|---|---|---|---|---|
| 09-17 | CONCORD ALQ20260810-01 | Contrato rehecho suelto; bodega asignó 15 radios distintos de los 15 ya programados. 29 fichas para una cuenta de 15. | Alberto | No hay forma de cambiar QUÉ radios cuelgan de un contrato ya `asignados` sin anular la gestión. |
| 09-18 | Órdenes de contratos anulados (CONCORD, SOC. ISRAELITA) | Órdenes apuntando a contrato anulado, sin sustituto declarado. | trigger (`contrato_anulado_revisar`) | La "Puerta 1" (`repuntarContratoOrden`) existe en el servicio, pero la confirmación llegó por correo y se aplicó por script. |
| 09-29 | LIGO 23905A0437 | Entrante de otro modelo quedó `en_bodega` estando con el cliente. | Solís | Bodega no tiene cómo poner un radio `en_cliente` con custodia; "Corrección de migración" solo manda a bodega. |
| 09-30 | Incidencia ENTRADA 23905A0441 | Aviso "no existe en inventario" eterno con el radio ya entregado. | correo repetido | Nadie puede cerrar una incidencia superada. (Raíz arreglada: el kardex la supera solo.) |
| 10-01 | INNOVACIÓN SERV20260918-01 | Dos radios dañados corregidos a mano a `en_bodega` → disponibles para alquilar; contrato anulado "sin sustituto indicado". | Zuleika | Mismo hueco de LIGO (único destino = bodega) + no hay cómo declarar el sustituto después de anular. |
| 10-02 | CEMENTO BAYANO 22610A4066 | Reemplazo hecho por orden (no por gestión); orden quedó EN OFICINA; bodega lo "corrigió" a bodega para sacarlo de "por retirar". | Solís | Recepción no puede registrar una entrega tardía con fecha real; bodega solo tiene el destino bodega. |
| 10-05 | MAGEN DAVID ALQ20260812-02 | Contrato rehecho sin anular el viejo → escalación semanal eterna. | Brenda | El sistema no avisa al vendedor que ya hay un contrato vivo con los mismos equipos. |
| 10-05 | SHEVET ALQ20260826-01 | Repunte a mano sin la señal `seriales_estado` → "pendiente" con todas las filas. | Brenda | Consecuencia de un script anterior; no hay "recalcular estado de seriales". |
| 10-06 | HOTEL GAMBOA + 12 contratos | Cierre tardío de ENTRADAs sacó 37 radios del cliente. | Brenda | Raíz arreglada (4094e93). Reparación de datos solo por script. |
| 10-06 | CONCORD (reemplazo de Elvia) | 15 radios `en_taller` en el pool, el cliente los tiene desde agosto. | Elvia (wizard trancado) | PROGRAMACIÓN 2026080705 nunca marcó entrega. Nadie puede decir "estos radios SÍ están con el cliente". |
| 10-06 | Propiedad en 59 fichas de alquiler | `propiedad: cliente` heredada de migración trancaba el reemplazo. | Elvia | Raíz arreglada (747850b). Barrido de datos por script. |
| 10-06 | MORENO → ASESORÍA, SECURITY MGMT → CVP | Cambio de razón social: fichas PoC y custodia con el nombre viejo. 2 inactivas se fueron de más y se revirtieron. | Brenda (23 vs 21 equipos) | No existe "cambio de razón social"; el panel de duplicados fusiona, no traslada. |
| 10-06 | ANATI (sigla vs razón social) | Dos fichas con el mismo RUC. | Alberto | Panel de duplicados no veía siglas (arreglado); la fusión se corrió por script con el código del panel. |
| 10-07 | ACODECO → APC | Renovación hecha a la ficha equivocada (sigla); el cliente ya tenía contrato firmado con los mismos 22 radios. | Alberto | `traspasarASustituto` se niega entre clientes. No existe "trasladar contrato a otra ficha". |

## 2. Los cinco patrones

**A. El radio está donde el sistema no dice** (5 casos: LIGO, INNOVACIÓN, CEMENTO BAYANO, CONCORD ×2).
La única corrección que tiene bodega es "Corrección de migración", cuyo único destino es `en_bodega`. Cuando el radio está en la calle, esa corrección lo pone DISPONIBLE y el siguiente contrato se lo lleva en papel. Es el patrón más repetido y el de mayor daño (doble alquiler sobre el papel).

**B. El contrato correcto es otro** (5 casos: CONCORD, MAGEN DAVID, SHEVET, INNOVACIÓN, ACODECO).
Contrato rehecho sin anular el viejo, anulado sin declarar sustituto, o hecho a la ficha equivocada. El vendedor no recibe aviso al crear, y después de anular no hay cómo declarar el sustituto.

**C. La cuenta cambió de nombre o estaba duplicada** (3 casos: MORENO, SECURITY MGMT, ANATI, más la fusión ACODECO).
Hay motor (`clientesDedupService.mergeCluster`) pero solo fusiona y solo en Admin. Un cambio de razón social no es una fusión: la ficha vieja sigue siendo historia.

**D. Dato de migración incompleto que tranca** (ACODECO modelos, propiedad ×59, 1,984 radios sin modelo del PoC).
Ya arreglado para renovación (la línea pone el modelo) y para propiedad (el alquiler manda). Falta cubrir los demás wizards y darle a bodega una forma de completar el modelo en lote.

**E. Reemplazo hecho por fuera de la gestión** (LIGO, CEMENTO BAYANO, INDUSTRIAL PROTECCIÓN).
El taller cambia el radio en una PROGRAMACIÓN sin abrir gestión de reemplazo; después nadie puede ligar saliente y entrante.

**Transversal.** Casi todo lo descubrió una persona trancada (Elvia en el wizard) o contando a ojo (Brenda, 23 vs 21). Las señales existen (`intentos_fallidos`, `desfase_inventario`, `sustitucion_vinculo_pendiente`, `contrato_anulado_revisar`) pero o solo las ve admin o no las ve nadie.

## 3. Herramientas propuestas, por rol

### Bodega (Almacén)

**A1. "Corregir ubicación" en la ficha del pool** (reemplaza a "Corrección de migración" como acción visible; la vieja queda como uno de los destinos).
Destinos: *En bodega* · *Con el cliente* (elige cliente; si tiene contrato vigente con línea del modelo, se ofrece ligarlo; si no, queda en custodia) · *Devuelto, por revisar* (taller decide) · *En taller con orden* (elige la orden abierta). Siempre con motivo, kardex `correccion_ubicacion` y `verificado: false` si salió a la calle. Bodega declara dónde está el radio porque lo tiene o no en el estante: no se deduce ([[preguntar-no-deducir]]).
Cubre: LIGO, INNOVACIÓN, CEMENTO BAYANO, CONCORD 10-06.
Candado: si el radio cuelga de una gestión viva, lo manda a "Corregir seriales…" de la gestión (ya existe) en vez de moverlo suelto.

**A2. Cola "Por cuadrar" en Almacén · Hoy.**
Un grupo nuevo, al lado de "Ventas facturadas", con lo que hoy solo se descubre trancado:
- Radios `en_taller`/`asignado_contrato` cuya orden lleva más de 7 días en COMPLETADO (EN OFICINA) → acción "El cliente ya lo tiene" (= A1 destino cliente + pide a recepción la entrega tardía, R1).
- Eventos `desfase_inventario` que dejó un wizard de reemplazo (hoy nadie los ve) → acción A1.
- Seriales de una ENTRADA cerrada sin ficha en el pool → acción "Corregir serial de la fila" (ya existe en ENTRADA editable).
- Incidencias de ENTRADA no superadas por el kardex.
Con tope de 40 filas y sin tripwire de lecturas (consulta por `orden_actual_id` y por evento, no barrido del pool).

**D1. "Completar modelo" por lote desde Existencias.**
La fila "(sin modelo)" de Existencias abre un panel con la propuesta por prefijo de serial y por órdenes (la lógica ya está en `infiere-modelo-sin-ficha.js` y en el Excel del 10-06: 1,186 automáticas). Bodega acepta por grupo, con `verificado: false` y kardex `correccion_modelo`. Lo "por revisar" se queda en la fila. Regla fija: PNC360 → PNC360S.

**E1. "Regularizar reemplazo" desde la orden.**
En una PROGRAMACIÓN donde un radio del cliente salió descartado y entró otro sin gestión, el taller o bodega abre "Registrar como reemplazo…": elige saliente y entrante entre los radios de la orden, el sistema crea la gestión REEMP a posteriori (`aprobado`, origen `regularizacion`, con la OS ya ligada) y pone a cada radio en su sitio. Es la "puerta 1" de LIGO y CEMENTO BAYANO hecha botón. Si el entrante es de otro modelo, cae en el paso `cambio_modelo` que ya existe (administración decide la tarifa).

### Vendedor (Centro)

**B1. Aviso al crear o renovar: "este cliente ya tiene equipos iguales en un contrato vivo".**
Al guardar un contrato nuevo o una renovación, si el mismo cliente (o una ficha con el mismo RUC o sigla) tiene un contrato `aprobado/activo` con los mismos modelos y cantidades, el wizard lo muestra y ofrece: *Este contrato sustituye a X* (anula X por sustitución al aprobar, traspasa seriales solo) · *Son cuentas distintas, seguir*. Aviso, no bloqueo ([[feedback_no_trancar_recepcion]]).
Cubre: MAGEN DAVID, CONCORD 09-17, ACODECO (si la ficha duplicada tiene el mismo RUC o es sigla).

**B2. "Trasladar este contrato a otra ficha de cliente…"** en el menú del contrato.
Para cuando el contrato se hizo a la ficha equivocada. Sin seriales asignados: cambia `cliente_id` y renumera si hace falta. Con seriales: hace lo del script ACODECO (copia filas con `ya_en_cliente`, espera el pool, reescribe la señal, reapunta PoC, anula el viejo sin tipo). Lo pide el vendedor; lo aprueba administración porque cambia a quién se factura. Correo a activaciones con el contrato correcto.

**B3. "Declarar el contrato sustituto…"** en un contrato anulado con `sustitucion_vinculo_pendiente`.
Hoy el chip rojo vive en `/contratos/` (archivo) y no tiene acción. En el Centro, la ficha del cliente lista los anulados pendientes y el vendedor elige el sustituto entre los vivos de la misma cuenta; corre `traspasarASustituto` y `reapuntarPoc`. Si el sustituto ya tiene sus filas, solo cierra el vínculo y recalcula `seriales_estado` (el caso SHEVET).
Cubre: INNOVACIÓN, SHEVET, MAGEN DAVID (segunda parte).

**C1. "Cambio de razón social / traslado de cuenta…"** en la ficha del cliente.
El vendedor lo pide con el RUC y el nombre nuevo; administración aprueba. Motor: `mergeCluster` en modo *traslado*: mueve contratos vivos, fichas PoC `activo !== false`, custodia del pool, grupos PoC; deja la ficha vieja `activo: false` con `trasladado_a` (no `merged_into`: el historial y las facturas viejas son historia). Devuelve la lista de lo que NO movió (fichas inactivas, radios en bodega o con otro cliente) como tarea de bodega en "Por cuadrar".
Cubre: MORENO, SECURITY MGMT. La fusión de duplicados (ANATI, ACODECO) sigue en Admin, pero el Centro muestra la señal "hay otra ficha con este RUC" al vendedor.

**D2. La regla "la línea corrige el modelo" sale de la renovación** y entra en aumento, reemplazo y asignar desde Almacén, con el mismo aviso.

### Recepción (Órdenes)

**R1. "Registrar entrega tardía…"** en una orden COMPLETADO (EN OFICINA).
Pide la fecha real de entrega y quién la recibió; pone ENTREGADO con `correccion_terminal` (sin correo ni KPI del día, como hace el script de CEMENTO BAYANO) y arrastra el pool a `en_cliente` aunque la ficha ya no tenga `orden_actual_id`. Hoy el "Entregar" normal no mueve un radio que bodega ya corrigió.
Cubre: CEMENTO BAYANO, CONCORD 10-06 (15 radios, PROGRAMACIÓN 2026080705).

**R2. "Repuntar al contrato vivo"** visible en la bandeja.
La marca `contrato_anulado_revisar` ya existe y la Puerta 1 también; falta el chip en la fila y el botón para recepción, con la lista de contratos vivos del mismo cliente. Lo que hoy se confirma por correo y se aplica por script.

**R3. Chip "modelo sin verificar / sin modelo"** en la fila del equipo de la orden, con enlace a la ficha del pool, para que el dato se complete en el mostrador y no tranque después.

## 4. Estado (2026-10-07, mismo día)

Los cuatro paquetes están hechos, probados y desplegados.

| Paquete | Commit | Qué quedó | Cómo se probó |
|---|---|---|---|
| P1 | `544fb78` | Ficha del equipo y Avanzado: "Corregir ubicación…". Órdenes ⋯: "Registrar entrega tardía…". Almacén · Hoy: grupo "Por cuadrar" (58 órdenes viejas en producción el primer día) con "El cliente ya los tiene". `onGestionWrite` estampa `desfase_inventario` en la gestión. | `test/corregirUbicacion.test.js` · `tools/emulador-almacen/emu-test-por-cuadrar.mjs` |
| P2 | `e528c8d` | Callable `declararSustitutoContrato`. Centro: "Declarar el contrato sustituto…" en el anulado y en Ahora; órdenes abiertas bajo contrato anulado/vencido sin marca también en Ahora. Contrato nuevo con equipos iguales a uno vivo → pregunta; "sustituye a X" se ejecuta al aprobar. | `test-emulator/declarar-sustituto.js` · `test/declararSustitutoCentro.test.js` · `emu-test-declarar-sustituto.mjs` |
| P3 | `d753519` | `lib/trasladoCliente` + callables `trasladarContratoCliente` y `trasladarCuentaCliente` (administración/gerencia). Centro: "Trasladar a otra ficha de cliente…" y "Cambio de razón social / traslado de cuenta…". Lo que no se puede afirmar vuelve "por confirmar". | `test-emulator/traslado-cliente.js` · `emu-test-traslado.mjs` |
| P4 | `368437b` | Existencias (sin modelo): "Completar modelo" con `proponerModeloSinFicha`. Asignar: la línea corrige el modelo de migración sin verificar. Órdenes ⋯: "Registrar como reemplazo…" con `regularizarReemplazoOrden`. Chip "sin modelo / modelo sin verificar" en la fila del equipo. | `test-emulator/p4-modelo-reemplazo.js` · `emu-test-p4.mjs` |

Pendiente que quedó fuera a propósito: el aviso B1 solo mira contratos con acción "Nuevo" y sin origen declarado (una renovación ya declara su origen). La aprobación de administración para los traslados se resolvió haciendo que solo administración/gerencia los ejecute (el vendedor ve la acción deshabilitada con el motivo).

## 4b. Orden propuesto (original)

| Prioridad | Qué | Casos que habría evitado | Tamaño |
|---|---|---|---|
| P1 | A1 Corregir ubicación + R1 Entrega tardía + A2 cola "Por cuadrar" | 6 de 14 | M (ficha del pool + orden + Hoy; sin estados nuevos; rules para `inventario` en `estado/asignacion` con kardex obligatorio) |
| P2 | B3 Declarar sustituto + B1 aviso al crear + R2 repuntar visible | 5 de 14 | M (reusa `traspasarASustituto`, `reapuntarPoc`, `repuntarContratoOrden`) |
| P3 | B2 Trasladar contrato + C1 Cambio de razón social | 3 de 14 | L (aprobación de administración, motor `mergeCluster` en modo traslado, correos) |
| P4 | D1 Completar modelo en lote + D2 regla en los otros wizards + E1 regularizar reemplazo + R3 chip | el resto y el pedido de Brenda (1,984 radios) | M |

Cada paquete se prueba en el emulador con el harness de módulos y se despliega solo (rules + functions + hosting), como lo demás.

## 5. Reglas que se mantienen

- Nada bloquea al vendedor ni a recepción por dato viejo: se avisa y se limpia en el mismo paso.
- Lo que cambia facturación (cliente del contrato, razón social, tarifa por cambio de modelo) lo aprueba administración; lo que solo cuadra el inventario lo hace bodega con kardex.
- Todo movimiento deja kardex y un `verificado: false` cuando el radio anduvo fuera. Ningún saneo borra: cierra a la vista.
- Sin estados nuevos en el pool ni reabrir `/contratos/`. Las herramientas viven en la ficha del pool, el menú del contrato en el Centro, el menú de la orden y Almacén · Hoy.
- La propuesta de un dato (modelo por prefijo, sustituto probable) es sugerencia; la declaración la hace quien tiene el radio o el papel enfrente.
