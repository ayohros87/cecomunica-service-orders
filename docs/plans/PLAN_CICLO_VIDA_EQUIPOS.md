# Plan — Ciclo de vida completo del equipo (todo conectado)

**Fecha:** 2026-07-16 · **Estado:** en ejecución
**Avance:** Fase A ✅ (48ec4c8) · Fase B ✅ (032e597) · Fase C núcleo ✅ + Fase D ✅ (este commit).
**Diferido de C (siguiente pasada):** C.5 sugerencia de cierre del contrato viejo al completarse las devoluciones · C.6 cola de revisión de renovaciones/adiciones históricas sin enlace · C.7 digitalizar legacy dentro del flujo de transición (mientras tanto: el equipo faltante se regulariza recibiéndolo en Equipos por serial).
**Basado en:** auditoría completa del flujo real (4 barridos de código, 2026-07-16), `docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md` (F1–F4 implementadas) y `docs/mejoras-solicitadas/05b_diseno_reemplazos_poc.md` (diseño de reemplazos, no implementado).

**Objetivo:** que cada equipo físico tenga UNA historia continua y navegable — recepción → contrato → entrega → cliente → taller → devolución → renovación/reemplazo → baja — y que esa historia se VEA donde el personal trabaja, sin estorbar: chips, enlaces y paneles informativos; nunca bloqueos nuevos durante la transición.

---

## 1. Estado actual — mapa del ciclo por etapa

Leyenda: ✅ funciona · 🟡 funciona con huecos · ❌ no existe.

### 1.1 Recepción de equipos ✅
- `inventario/equipos.html` (`inventario-equipos.js:304-344`): recepción manual (pegar/escanear), import Excel con preview, modo toma física. Crea unidades `en_bodega` con kardex (`movimientos`).
- Failsafe de colisión de serial entre modelos (Kenwood) operativo en front y functions.

### 1.2 Contrato nuevo y seriales 🟡
- Alta → `pendiente_aprobacion` → `aprobado` (pide seriales a inventario, `onApproval.js:126`) → seriales en `contratos/{id}/seriales` → señal `asignados` → PDF a activaciones (`onApproval.js:207`).
- Asignación: picker "Tomar del pool" (elegir unidades o selección automática FIFO, `contrato-seriales-page.js`), pegar columna, jalar de POC/órdenes. Validación suave contra el pool (avisa serial desconocido / otro estado / otro modelo; nunca bloquea).
- `onSerialWrite.js` sincroniza el pool: serial nuevo → `asignado_contrato` (o crea doc `verificado:false` por migración); serial removido → `en_bodega` `verificado:false`.
- **Huecos:** `equipos[]` del contrato no lleva serial (solo la subcolección); tipos de contrato desincronizados entre alta y edición (`editar-contrato.html` omite TEMP).

### 1.3 Orden de programación para entrega 🟡
- 100 % manual: nadie crea la orden al aprobar el contrato (`onApproval.js` no escribe en `ordenes_de_servicio`). Tipo PROGRAMACION habilita el bloque de contrato (`nueva-orden.js:26-103`); vínculo anidado `orden.contrato.contrato_doc_id`.
- **Los seriales del contrato NO se jalan a la orden** — `equipos[]` nace vacío; el "jalar" existente solo trae de POC (`ordenes-nuevo-batch.js:138`).
- Al marcar `ENTREGADO AL CLIENTE`: `onOrdenEntregada.js` estampa `entrega_confirmada` en el contrato → `onEntregaPool.js` mueve pool `asignado_contrato → en_cliente`; `onOrdenWritePool.js` saca de taller los equipos de la orden. ✅ este tramo cierra bien.

### 1.4 Reparación (entra a taller, regresa al cliente) ✅ (con matices)
- Agregar equipo con serial a la orden → pool `en_taller` + `orden_actual_id` (`onOrdenWritePool.js:88-118`). Entregar/eliminar orden → `en_taller → en_cliente` (`:57-85`).
- Matices: el pool no distingue `COMPLETADO (EN OFICINA)` (sigue `en_taller` hasta ENTREGADO — aceptable: físicamente sigue en taller); la orden no guarda referencia al doc del pool (nexo unidireccional por `orden_actual_id` + serial).

### 1.5 Devoluciones (cancelación, cambio, cualquier razón) ❌ — el hueco más grave
- **Nada asigna `devuelto_revision`**: el estado, su pestaña y el botón "Inspección OK → bodega" (`inventario-equipos.js:279,397-409`) existen pero ningún flujo los alimenta. Toda liberación cae directo a `en_bodega verificado:false`.
- **Cierre de cancelaciones no toca el pool**: `CancelacionesService.cerrar()` solo escribe `equipos_recibidos:true` + nota de texto libre (`cancelacionesService.js:92-101`); `onCancelacionWrite.js` deriva `baja_cancelado` en el contrato pero no libera unidades. Una baja parcial aprobada deja los seriales `en_cliente` para siempre.
- **Cambio de serial por defecto ignora el motivo**: `onSerialWrite` no ve `seriales_cambios.motivo_tipo`, así que un equipo defectuoso devuelto entra a stock bueno (`en_bodega`) sin cuarentena.
- Anulación de contrato ✅ libera el pool (`onAnnulment.js`, 2026-07-15) pero también directo a `en_bodega`, sin inspección.

### 1.6 Renovación y reemplazo ❌ — contratos sueltos
- Renovación = contrato nuevo con `accion:'Renovación'` (+ 3 subcampos de modalidad). Reemplazo = `codigo_tipo:'REEMP'`. **Ningún campo los vincula al contrato original** (grep exhaustivo: no existe `contrato_origen_id` ni similar en producción).
- La transición con equipos simultáneos (viejo y nuevo activos para no dejar al cliente sin equipo) **no se modela**: el contrato viejo queda con seriales `en_cliente` hasta anulación o limpieza manual; no hay "pendiente de devolución", ni mapeo saliente→entrante, ni linaje.
- Existe diseño completo no implementado: `05b_diseno_reemplazos_poc.md` (linaje `reemplaza_a`, `mapeos`, `devoluciones`, cola de revisión de históricos). **Nota:** ese diseño (2026-07-01) ancla en `poc_devices` porque `equipos_pool` no existía; hoy el pool ya es el registro por unidad con kardex — ver decisión §3.1.

### 1.7 Agregar / dar de baja equipos en contrato vigente 🟡
- Agregar: **bloqueado** una vez `aprobado`/`activo` (`editar-contrato.js:38-42`); la "Adición" crea otro contrato suelto sin vínculo.
- Baja: módulo de enmiendas (`solicitudes_cancelacion`) → `baja_cancelado` en el contrato ✅, pero sin selección de seriales y sin efecto en el pool (§1.5).

### 1.8 Visibilidad (la parte visual) ❌ — el pool es una isla
- La página del pool muestra cliente/contrato como **texto sin enlace** (`inventario-equipos.js:268-270`).
- **Ninguna** página de detalle (contrato, cliente, orden) lee `equipos_pool`: no existe "equipos de este contrato/cliente" con estados.
- Home/command center: cero señales del pool (solo tarjeta de navegación).
- La conciliación es un modal dentro del pool, solo bodega vs conteo manual.

### 1.9 Detalles menores detectados (arreglos puntuales)
- `editar-contrato.html` omite tipo TEMP.
- Estados `vencido`/`finalizado`/`inactivo` del contrato: nadie los escribe (solo filtros/labels).
- `CONFIG.ESTADOS` en `ordenes-state.js:43-48` no lista `RECIBIDO EN MOSTRADOR`.
- API del pool sin uso: `asignarAContrato`, `disponiblesDeModelo`, `contarBodegaPorModelo` (decidir: usar o borrar).

---

## 2. Principios del plan

1. **El pool (`equipos_pool`) es la columna vertebral del equipo físico.** Un doc por unidad, kardex append-only, ya sincronizado por triggers desde contratos/órdenes/POC/entregas. Todo lo nuevo (linaje, devoluciones, cuarentena) vive ahí — no se inventa una segunda máquina de estados.
2. **Visual primero, candados después.** Cada fase entrega superficie visible (chips, paneles, enlaces) antes que validaciones. Nada nuevo bloquea al personal durante la transición (mismo espíritu del plan del pool: avisar, nunca bloquear — endurecer solo al final).
3. **Conectar, no duplicar.** El contrato sigue siendo el documento comercial; la orden, el trabajo; POC, la programación de radio. El pool los referencia a todos (`asignacion`, `orden_actual_id`, `poc_device_id`) y todos deben poder mostrar y navegar hacia el pool.
4. **Los flujos existentes no cambian de forma; ganan contexto.** El vendedor, recepción, taller e inventario siguen usando sus mismas pantallas; se les agrega información en el lugar y momento en que ya están, no pasos extra.

---

## 3. Decisiones (fijadas 2026-07-16)

### 3.1 Ancla del linaje de reemplazos: `equipos_pool` — ✅ CONFIRMADA
El diseño 05b fijó "fuente de verdad = POC" en un mundo sin pool. Decisión: **la identidad y el linaje físico viven en `equipos_pool`** (`reemplaza_a`, estados de devolución) y POC sigue siendo la fuente de la programación (SIM, grupos), enlazada vía `poc_device_id`. Ventajas: el pool ya tiene kardex, failsafe de colisión y triggers de todos los flujos; POC no cubre equipos que nunca pasaron por POC (venta directa, taller). El resto de 05b (cola de revisión, digitalizar legacy bajo demanda, enlace suave de contratos) se conserva tal cual.

### 3.2 Cuarentena universal — ✅ CONFIRMADA · terminología: "ENTRADA"
Toda unidad que REGRESA de un cliente pasa por inspección (`devuelto_revision`): cancelación, anulación, reemplazo, fin de demo. Solo la remoción de serial pre-entrega (typo) sigue yendo directo a `en_bodega` (nunca salió físicamente). Inventario ya tiene el botón "Inspección OK → bodega" — por fin tendrá qué inspeccionar.
**Terminología de UI:** el personal llama a este proceso **"entrada"** — toda la interfaz debe decir "Entrada" (registrar entrada, entradas pendientes de inspección), no "devolución". Los nombres internos de datos (`devuelto_revision`, movimiento `devolucion`) no cambian.

### 3.4 Mapeo asimétrico en renovaciones/reemplazos (restricción de negocio)
Una renovación o reemplazo puede tener **menos o más equipos** que el contrato original. La pantalla de transición (C.4) NO asume mapeo 1:1:
- **Saliente sin entrante**: el equipo se devuelve sin sustituto (renovación con menos unidades) → se marca `pendiente_devolucion` sin `mapeos`; su entrada se registra igual.
- **Entrante sin saliente**: unidad neta nueva (renovación con más unidades) → entra normal, sin linaje.
- **Sin contrato original** (legacy en papel o inexistente): la transición funciona anclada en los equipos reales del cliente en el pool (`asignacion.cliente_id`), no en la cadena de contratos; `origen_tipo='legacy'` + referencia libre, o `'ninguno'`.

### 3.3 Reserva estricta de serial (pendiente de 05b)
¿Un serial `asignado_contrato`/`en_cliente` puede aparecer en otro contrato? Hoy sí (aviso suave). Propuesta: mantener suave hasta la fase de endurecimiento (F5 del plan pool) y ahí decidir con datos de conciliación.

---

## 4. Fases

### Fase A — Conectar lo visual (sin tocar datos) · riesgo bajo, impacto inmediato
La app ya TIENE los datos; solo no los muestra donde se trabaja.

1. **Enlaces en la página del pool**: "Asignado a" → link al contrato y al cliente; "orden en taller" → link a la orden. (`inventario-equipos.js:268-270`.)
2. **Panel "Equipos" en el detalle/lista de contratos**: en el modal/panel de equipos del contrato (`contratos-equipos.js`), además de conteos, listar las unidades del pool con `asignacion.contrato_doc_id == id`: serial + chip de estado (paleta unificada del Command Center) + link al kardex. Muestra de un vistazo "3 en cliente, 1 en taller".
3. **Panel "Equipos del cliente"**: misma lista filtrada por `asignacion.cliente_id`, en la ficha del cliente. Es la "vista Equipo del cliente" que 05b pedía en su Fase 0.
4. **En la orden**: junto a cada equipo con serial, chip discreto del estado en el pool (si existe) + aviso suave si el serial figura con OTRO cliente. Ayuda a recepción a detectar equipos mal identificados al recibirlos.
5. **Señal en el home**: tarjeta con `en_bodega` disponibles, `en_taller`, `devuelto_revision` pendientes de inspección y "por verificar" (reusa `contarBodegaPorModelo`/KPIs ya calculados).
6. Arreglos menores §1.9 (TEMP en editar, CONFIG.ESTADOS).

*Índice compuesto probable:* `equipos_pool (asignacion.contrato_doc_id)` y `(asignacion.cliente_id)` — verificar necesidad de índices al implementar.

### Fase B — Cerrar el circuito de devoluciones · riesgo medio, es el hueco más caro
1. **Cierre de cancelación con checklist por serial** (retoma plan pool §3.5): al "Cerrar (equipos recibidos)", modal que lista los seriales `en_cliente`/`asignado_contrato` del contrato (del pool) con checkbox "regresó" + condición por unidad (bueno / dañado / no regresó). Los marcados → `devuelto_revision` con movimiento `devolucion` y nota. Los "no regresó" quedan registrados (pendientes visibles en Fase A.2/A.3). La cantidad sin serial sigue funcionando igual (contratos legacy).
2. **Anulación → `devuelto_revision`** en vez de `en_bodega` (`onAnnulment.js:44`): el equipo anulado también regresa físicamente y merece inspección.
3. **Cambio de serial con motivo**: `onSerialCambio`/`onSerialWrite` — cuando la solicitud de cambio tiene `motivo_tipo:'Equipo defectuoso'`, la unidad saliente va a `devuelto_revision` con nota del motivo (hoy va a stock bueno). Implementación: al aplicar el reemplazo, el front estampa el motivo en el doc del serial (o el trigger de cambios hace la transición al resolver).
4. **Bandeja de inspección**: la pestaña "otros" del pool se divide — `devuelto_revision` se vuelve pestaña propia "Por inspeccionar" con contador en el KPI y en el home (A.5). El botón "Inspección OK → bodega" (ya existe) y "Dar de baja" (ya existe) son las dos salidas.
5. **Reglas**: permitir la transición `devuelto_revision` desde functions ya está cubierto (Admin SDK); revisar reglas front solo para el cierre de cancelaciones si escribe directo.

### Fase C — Renovación y reemplazo conectados (linaje + transición) · el núcleo
Implementa 05b adaptado a §3.1. Aditivo: campos nuevos, cero cambios a flujos existentes hasta la UI final.

1. **Campos de origen en el contrato** (de 05b): `origen_tipo` (`interno|legacy|ninguno`), `contrato_origen_id`, `contrato_origen_ref`, `origen_legacy_ref`. La UI de alta: cuando `accion ∈ {Renovación, Adición}` o `codigo_tipo = REEMP`, aparece un buscador de contratos del MISMO cliente para elegir el original (o marcar "legacy/papel" con referencia libre). Suave: se puede omitir, queda `ninguno` y entra a la cola de revisión.
2. **Linaje en el pool**: `equipos_pool.reemplaza_a` (serial_norm saliente) + subcolección `contratos/{id}/mapeos` (saliente→entrante, de 05b). El kardex de la unidad nueva muestra "Reemplaza a X"; el de la vieja, "Reemplazada por Y".
3. **Estado de transición**: campo `pendiente_devolucion: true` en la unidad saliente (flag, no estado nuevo — sigue `en_cliente` porque físicamente ahí está). Esto modela el período de equipos simultáneos SIN mentir sobre la ubicación física. Visible en A.2/A.3 como chip ámbar "pendiente de devolución".
4. **Pantalla de transición** (la pieza visual clave): en el contrato nuevo (renovación/reemplazo), sección "Transición de equipos": dos columnas — salientes del contrato original (desde el pool, con estado real) y entrantes del nuevo — con mapeo serial→serial (auto-propuesta por modelo, editable; E4/E5 de 05b). Al confirmar el mapeo: entrantes quedan normales, salientes se marcan `pendiente_devolucion` + `mapeos`. Cuando recepción registra la devolución (flujo B.1 reutilizado), el saliente pasa a `devuelto_revision` y el mapeo se cierra.
5. **Cierre del contrato viejo**: cuando todos sus salientes estén devueltos/mapeados, sugerir (no forzar) la anulación/terminación del original con motivo "Renovado por {nuevo}". El original y el nuevo se enlazan visualmente en ambas fichas ("Renovado por →" / "← Renueva a").
6. **Cola de revisión de históricos** (de 05b): página admin que sugiere origen para renovaciones/adiciones existentes (mismo cliente, fecha anterior, seriales solapados vía pool); confirmar o marcar legacy. Sin auto-enlace.
7. **Digitalizar legacy bajo demanda** (de 05b, caso 3): si un serial saliente no existe en el pool, el flujo de transición ofrece capturarlo (serial, modelo) → entra al pool `en_cliente` `verificado:false`, origen `digitalizado_en_reemplazo`.

### Fase D — Órdenes conectadas al contrato · riesgo bajo/medio
1. **"Jalar seriales del contrato" en la orden**: en `agregar-equipo`/`nuevo-batch`, si la orden tiene `contrato.contrato_doc_id`, botón que trae los seriales del contrato (picker con checkboxes, mismo patrón del picker del pool). Elimina el tecleo en órdenes de programación.
2. **CTA "Crear orden de programación" desde el contrato**: cuando `seriales_estado = 'asignados'` y no hay orden PROGRAMACION vinculada, botón en la lista/ficha de contratos que abre `nueva-orden.html` precargada (cliente, tipo, contrato, equipos+seriales). NO automático — la orden sigue siendo decisión humana; el sistema solo prepara todo.
3. **Autocompletar por serial en `agregar-equipo`** (pendiente F4 del plan pool): al teclear/escanear un serial que existe en el pool, autollenar modelo y avisar de quién es. Ayuda directa a recepción con equipos que llegan a reparación.
4. **Backlink orden→pool opcional**: no necesario si A.1 y D.3 cubren la navegación (el pool ya apunta a la orden).

### Fase E — Equipos en contratos vigentes (adición/baja formales) · riesgo medio
1. **Adición conectada**: mantener "Adición = contrato nuevo" (decisión de negocio existente) pero con `contrato_origen_id` (C.1) para que la ficha del original muestre el total real de equipos del cliente. Alternativa mayor (editar `equipos[]` post-activación con enmienda de adición) queda explícitamente FUERA de este plan salvo que negocio la pida.
2. **Baja parcial con seriales** (extiende B.1): al SOLICITAR la baja, opcionalmente elegir QUÉ seriales salen (checkbox de los `en_cliente` del contrato); al cerrar, el checklist llega pre-marcado. `baja_cancelado` sigue por cantidad (compatibilidad).

### Fase POC — Conectar POC con contratos y el resto del sistema
Hoy `poc_devices` conoce al cliente pero NO al contrato; el pool enlaza `poc_device_id` pero la relación POC↔contrato no existe en datos. Implementado 2026-07-16:
1. **Vínculo en el alta de batch POC**: selector "Contrato del cliente" en POC/nuevo-batch — vincula el batch (`poc_devices.contrato_doc_id`/`contrato_id`, el campo que 05b pedía en su Fase 0) y botón "Jalar seriales" que trae los del contrato sin re-teclear.
2. **El pool hereda el vínculo**: `onPocDeviceWritePool` estampa la asignación con contrato (antes solo cliente) cuando la unidad no tiene ya una asignación.

Pendiente (propuesta, siguiente pasada):
3. **Chip de contrato en la lista POC** (`poc-list.js` tiene cambios locales del usuario — no tocado) + filtro "sin contrato".
4. **Backfill `linkContratoPoc`**: inferir `contrato_doc_id` para devices existentes cruzando por serial contra `equipos_pool.asignacion` (el pool ya conoce el contrato de 5,787 unidades) — cola de sospechosos para lo ambiguo, mismo patrón que `linkModeloIdPoc`.
5. **Editar-batch POC**: poder vincular/corregir el contrato de un batch existente.
6. **Al convertir POC en contrato** (jalar desde POC en seriales del contrato): estampar de vuelta `contrato_doc_id` en los devices jalados — cierra el ciclo demo→contrato.
7. Con 4+6, la vista "Equipos del cliente" y la transición de renovación pueden mostrar también la programación del radio (grupos, SIM) vía `poc_device_id`.

### Fase F — Endurecimiento y conciliación (= F5 del plan pool, ampliada)
Cuando la conciliación esté en 0 sostenido:
1. Validación de seriales al asignar: el aviso "no está en el pool" se vuelve bloqueante (con excepción admin), y la doble asignación se bloquea (§3.3).
2. KPI de inventario del índice derivado del pool; conteo manual pasa a auditoría.
3. Conciliación ampliada: % contratos activos con seriales completos, unidades `pendiente_devolucion` envejecidas, `devuelto_revision` estancadas, docs sin verificar por origen.
4. Regreso `en_poc → en_bodega` al cerrar demos (hoy manual).

---

## 5. Lineamientos visuales (aplican a todas las fases)

- **Un solo lenguaje de estado**: chips con la paleta de estados unificada del Command Center; los 7 estados del pool + flags (`pendiente_devolucion` ámbar, `sin verificar` gris punteado) se definen UNA vez (helper compartido) y se usan idénticos en pool, contrato, cliente, orden y home.
- **El kardex a un clic desde cualquier serial**: todo serial mostrado en la app es clickeable → drawer de historia de la unidad (reusar el drawer del pool). El personal deja de reconstruir historias preguntando.
- **Información en el flujo, no pasos nuevos**: paneles y chips aparecen en pantallas que ya se usan; los únicos flujos nuevos (checklist de devolución, pantalla de transición) sustituyen trabajo que hoy se hace por fuera (notas de texto, memoria, Excel).
- **Avisos suaves hasta la Fase F**: ningún candado nuevo antes del endurecimiento; todo aviso dice QUÉ hacer ("recíbelo en Inventario · Equipos por serial"), no solo qué está mal.
- **Contadores honestos**: toda lista filtrada muestra cuántos oculta; toda bandeja (inspección, cola de revisión, pendientes de devolución) muestra su tamaño en el home.

---

## 6. Orden recomendado y dependencias

```
A (visual) ──────────────► inmediata, sin dependencias, alto impacto percibido
B (devoluciones) ────────► requiere decisión §3.2 · desbloquea inspección real
C (renovación/reemplazo) ► requiere decisiones §3.1 + B (reusa checklist) · núcleo
D (órdenes conectadas) ──► independiente de B/C; D.2 tras A.2
E (adición/baja formal) ─► tras C.1 (origen) y B.1 (checklist)
F (endurecimiento) ──────► al final, con conciliación en 0 sostenida
```

Riesgos principales: (1) C toca el flujo comercial de renovación — coordinar con ventas antes de cambiar la pantalla de alta; (2) B cambia el significado del cierre de cancelaciones — capacitar a recepción con la primera versión; (3) la sincronización front/functions de normalización de seriales sigue duplicada — cualquier cambio debe tocar ambos lados (`equiposPoolService.js` ↔ `functions/src/domain/equiposPool.js`).
