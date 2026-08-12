# Informe — Tracking de equipos por serial: cómo funciona hoy y dónde se rompe

**Fecha:** 2026-08-12 · **Base:** producción (7,351 unidades, 454 contratos vivos, 2,159 órdenes) + lectura completa del código
**Disparador:** las renovaciones y reemplazos —muchas veces parciales— no controlan bien qué unidad física entra, cuál sigue y cuál se devuelve; el operador no tiene la información cuando el sistema se la pide.
**Relación:** continúa `docs/plans/PLAN_CICLO_VIDA_EQUIPOS.md` (2026-07-16) y el diagnóstico REEMP20260811-01 (CHANGELOG 2026-08-11). No lo reemplaza: mide qué tanto de ese plan aterrizó y qué falta de fondo.

---

## 1. Resumen ejecutivo

El sistema **ya tiene** la infraestructura de tracking por serial correcta: `equipos_pool` con un doc por unidad física, kardex append-only (cobertura 100% en muestreo), ficha universal consultable desde cualquier página, y triggers que sincronizan desde contratos, órdenes y POC. Esa parte no hay que rehacerla.

Lo que sigue siendo por contrato es **el lenguaje comercial y el momento de las decisiones**:

1. **El contrato habla en cantidades, no en unidades.** `equipos[]` es `{modelo, cantidad, precio}` — sin serial. Los seriales llegan después, por otra persona, a una subcolección. Una renovación "parcial" no se puede expresar: el contrato nuevo dice "5 T338" y nada dice qué pasa con cada uno de los 10 P50 del contrato viejo.

2. **La decisión por unidad se le pide a la persona equivocada en el momento equivocado.** Quien SÍ sabe qué continúa, qué se devuelve y qué se reemplaza es el **vendedor al cerrar el trato**. El sistema se lo pregunta a **recepción, semanas después**, en una pantalla separada (transición) que debe reconstruir el acuerdo. Resultado medido: en toda la historia de la base hay **0 unidades con linaje** (`reemplaza_a`), **2 mapeos** (ambos creados por el trigger automático) y **0 excepciones** de renovación parcial registradas. La maquinaria de transición existe completa y nadie la ha podido usar.

3. **El pool sabe DÓNDE está el radio, pero no BAJO QUÉ contrato.** 1,918 de las 3,108 unidades `en_cliente` (62%) tienen cliente pero no contrato. Sin ese vínculo, ni facturación ni renovación ni devolución pueden razonar por serial — y el fallback "todos los equipos del cliente" es inútil justo donde más importa: **70 clientes tienen equipo en 2+ contratos vigentes** (18 con 4+, máximo 34).

**Las tres movidas que este informe propone** (detalle en §5): (P1) capturar el destino de cada unidad **en la venta**, con un checklist sobre la flota real del contrato original — el plan viaja con el contrato y recepción lo ejecuta en vez de inventarlo; (P2) "continúa" como operación de primera clase — mover la unidad al contrato nuevo sin re-teclear seriales; (P3) cerrar la brecha `en_cliente` sin contrato con backfill + bandeja, para que la flota por cliente sea confiable donde se decide.

---

## 2. Cómo funciona hoy — el mapa

### 2.1 Cuatro colecciones, cuatro verdades

| Colección | Qué es | Granularidad | Quién la escribe |
|---|---|---|---|
| `contratos` | El documento comercial | **Cantidades** por modelo (`equipos[]`) | Vendedor (alta), triggers (contadores) |
| `contratos/{id}/seriales` | Qué unidades cumplen ese contrato | Serial | Inventario/recepción, DESPUÉS de aprobar |
| `equipos_pool` (doc ID = serial_norm) | La unidad física y su historia | Serial + kardex | **Solo triggers** ("migración por contacto") + Inventario·Equipos |
| `ordenes_de_servicio` | El trabajo (programar, reparar, entrada) | Serial en `equipos[]` (texto libre) | Recepción/taller |

`poc_devices` (airtime) es la quinta: conoce cliente y radio, se enlaza al pool vía `poc_device_id`.

El pool es **reactivo**: no manda, refleja. Cada vez que un serial toca un flujo (se registra en un contrato, entra a una orden, aparece en POC), `upsertContacto`/`transicionar` lo dan de alta o lo mueven, con movimiento en el kardex. Estados: `en_bodega → asignado_contrato → en_cliente ⇄ en_taller → devuelto_revision → en_bodega`, más `vendido`, `baja`, `por_clasificar` (ubicación desconocida).

### 2.2 El ciclo feliz (contrato nuevo estándar)

```
Vendedor crea contrato (cantidades) ──► aprobado ──► correo pide seriales
   ──► Inventario asigna seriales (picker "Tomar del pool", pegar, jalar de POC)
        └─ onSerialWrite: pool → asignado_contrato + asignacion={contrato,cliente}
   ──► señal 'asignados' ──► PDF a activaciones ──► candado de la página
   ──► Recepción crea orden PROGRAMACIÓN (CTA en la lista; "jalar del contrato" existe)
        └─ onOrdenWritePool: pool → en_taller
   ──► taller COMPLETADO ──► QC ──► ENTREGADO AL CLIENTE
        ├─ onOrdenWritePool: en_taller → en_cliente
        ├─ onOrdenEntregada: contrato.entrega_confirmada = true
        └─ onEntregaPool: lo asignado que no pasó por la orden → en_cliente
```

Este tramo **funciona y cuadra**: 62 de 66 contratos vigentes no-legacy tienen seriales completos (87% de las unidades pactadas con serial).

### 2.3 Renovación / reemplazo hoy

```
Vendedor crea contrato REEMP/Renovación (cantidades del NUEVO equipo)
   └─ desde 2026-08-11: vínculo al original OBLIGATORIO (o "es de papel" + ref)
   ──► mismo ciclo de arriba para los entrantes
   ──► entrega confirmada ──► onEntregaTransicion (si hay origen):
        · lee del pool las unidades del origen aún con el cliente (alquiler)
        · crea mapeos de devolución + orden de DEVOLUCIÓN (recuperación)
        · onMapeoWrite estampa pendiente_devolucion + linaje reemplaza_a
   ──► pantalla de transición (contratos/transicion.html): para EXCEPCIONES
        (renovación parcial = desmarcar "se devuelve" con motivo) y linaje manual
   ──► el cliente entrega ──► ENTRADA ──► devuelto_revision ──► inspección ──► bodega
```

En papel está completo. En datos: **nunca ha corrido de punta a punta**. `transicion_auto_at` apareció por primera vez esta semana (2 contratos); el resto del circuito de linaje está a cero (§3).

### 2.4 Los otros caminos de vuelta

- **Anulación** (`onAnnulment`): libera al pool — a bodega lo que nunca salió, cuarentena/recuperación lo entregado; CC a recepción.
- **Baja/enmienda** (`onCancelacionWrite`): marca `pendiente_devolucion` en las recuperables y abre orden de DEVOLUCIÓN.
- **Venta** (`vendido`): hecho de propiedad, no de ubicación.
- **ENTRADA**: el regreso físico; al cerrarla, la unidad aterriza en bodega `verificado:true`.

---

## 3. Los números (producción, 2026-08-12)

### El pool — la base es sólida, la identidad tiene deuda

| Métrica | Valor | Lectura |
|---|---|---|
| Unidades | 7,351 | |
| Con kardex (muestreo 100) | **100%** · 2.4 mov/unidad | La historia por unidad SÍ existe |
| `en_cliente` | 3,108 | |
| — de esas, **sin contrato** en la asignación | **1,918 (62%)** | El pool sabe dónde, no bajo qué |
| — sin asignación de ningún tipo | 16 | |
| `por_clasificar` (ubicación desconocida) | **1,422 (19%)** | Herencia de conteos/backfills |
| Sin modelo | 2,280 (31%) | Invisibles al inventario por modelo |
| `verificado: false` | 4,955 (67%) | Migración automática sin confirmación humana |
| Asignadas a contrato **anulado** | **50** | Asignaciones muertas sin soltar |
| Con linaje `reemplaza_a` | **0** | La maquinaria jamás produjo un linaje |
| `pendiente_devolucion` | 32 (todas <7 días) | El circuito nuevo sí está arrancando |

### Contratos — cantidades vs seriales

| Métrica | Valor |
|---|---|
| Vigentes con equipo, no legacy | 66 (305 legacy fuera del flujo) |
| Seriales completos | 62 · sin ningún serial: 4 |
| Unidades pactadas con serial | 461/529 (87%) |
| Contratos donde subcolección ≠ pool | **12 de 62** |
| Clientes con equipo en 2+ contratos vigentes | **70** (18 con 4+; máx 34) |

### Transiciones — la evidencia del no-uso

| Métrica | Valor |
|---|---|
| Mapeos en TODA la base | **2** (ambos `sin_reemplazos`, creados por el trigger) |
| Linajes entrante→saliente | **0** |
| Excepciones `no_devuelve` (renovación parcial) | **0** |
| Contratos transicionables sin origen (pre-candado) | 67 → 16 accionables (censo 2026-08-11) |

**La conclusión que estos números gritan:** el problema no es que falte maquinaria de tracking por serial — es que la información por serial **nunca entra** en el punto del flujo donde el negocio la conoce. Todo lo demás (linaje vacío, transiciones sin registrar, 62% de en_cliente sin contrato) es consecuencia.

---

## 4. Diagnóstico — las seis brechas

### B1 · El contrato no habla el idioma de la unidad
`equipos[]` = `{modelo, cantidad, precio}`. El serial ni siquiera tiene dónde vivir en la línea del contrato; la subcolección llega después y por otra persona. Consecuencias:
- Una **renovación parcial es inexpresable** en el documento: "renuevo 6 de los 10" se pacta de palabra y el sistema solo ve un contrato nuevo de 6.
- El contrato viejo sigue diciendo `cantidad: 10` aunque 6 unidades se hayan movido — el total por cliente se infla y la facturación por contrato hereda el error.
- QBO factura al ENTREGAR por contrato; sin continuidad por unidad no puede distinguir "6 radios que ya tenía" de "6 radios nuevos".

### B2 · La decisión por unidad se pide tarde y a la persona equivocada
El vendedor, al cerrar el trato, sabe: *"las P50 se reemplazan por T338"* (lo escribió en observaciones de REEMP20260811-01 — como **texto libre**). El sistema le pide esa decisión a recepción, semanas después, en `transicion.html`, reconstruyéndola desde el pool. Recepción no estuvo en la negociación → no registra nada → 0 linajes. **La pantalla de transición está bien diseñada para las excepciones, pero se usó como captura primaria, y como captura primaria está en el lugar equivocado del flujo.**

### B3 · La asignación es un puntero único que se pisa
`asignacion` guarda UN contrato. La reasignación silenciosa está permitida por decisión (2026-07-22, queda nota en kardex), pero mientras el contrato viejo siga vigente, "cuántas unidades tiene el contrato X" da respuestas distintas según a quién se le pregunte: **12 de 62 contratos difieren** entre su subcolección y el pool. Además **50 unidades siguen asignadas a contratos anulados** (la anulación no siempre soltó).

### B4 · en_cliente sin contrato: la brecha del 62%
1,918 unidades están con un cliente identificado pero sin vehículo comercial. Origen: custodia de órdenes viejas, POC sin contrato, backfills. Es la razón por la que la pantalla de transición cae a "todos los equipos del cliente" y por la que el CTA de renovación no puede proponer nada útil.

### B5 · El multi-contrato hace inservible el fallback por cliente
Con 70 clientes teniendo equipo en varios contratos vigentes (GOLY: 3 renovaciones compitiendo por el mismo pool de 17 contratos), cualquier lógica "por cliente" es ambigua por construcción. La única ancla que discrimina es **contrato original → sus unidades**, que es exactamente el vínculo que faltaba (obligatorio desde 2026-08-11) y la asignación por unidad que B3/B4 debilitan.

### B6 · La deuda de identidad limita lo que el sistema puede afirmar
2,280 fichas sin modelo, 1,422 `por_clasificar`, 4,955 sin verificar, 305 contratos legacy. No es un bug: es historia sin digitalizar. Pone un techo: el sistema no puede prometer trazabilidad completa de flota mientras el 19% tiene ubicación desconocida. Se drena con los conteos físicos (ya en marcha, ~8 modelos saneados) — hay que sostenerlos.

### Transversal · Lo que el operador NO ve (UI)
- **El picker de seriales solo ofrece bodega.** En una renovación donde el cliente CONSERVA los radios, el operador re-teclea los mismos seriales a mano (ALQ20260723-01: 82 seriales). "Jalar de POC" ayuda; "traer del contrato original" no existe.
- **La ficha del cliente no muestra su flota.** El panel de equipos existe en el contrato (`contratos-equipos.js` lee el pool ✅) pero la página del cliente no — Fase A.3 del plan quedó sin aterrizar.
- **La transición esconde `en_taller`.** Filtra salientes a `asignado|en_cliente`; los 10 P50 de MAGEN DAVID eran invisibles porque su orden quedó en COMPLETADO.
- **La entrega no se marca.** 46% de las PROGRAMACIÓN de agosto se pararon en COMPLETADO (EN OFICINA). Sin ENTREGADO no hay `entrega_confirmada` ni transición automática. Es proceso vivo, no histórico (medido 2026-08-11).

---

## 5. Propuestas

Principio rector: **el contrato dice cuánto; el pool dice cuál; y el momento de decidir qué pasa con cada unidad es la VENTA, no la recepción.** Nada de esto reemplaza al pool ni inventa una segunda máquina de estados — completa el plan vigente (fases C.5/C.6, E, F) con una corrección de dónde se captura.

### P1 · La transición se decide en la venta (la movida principal)

Al crear Renovación/Reemplazo con origen interno (ya obligatorio), el formulario muestra la **flota real del contrato original** (del pool, con estado y chip) y pide el destino de cada unidad:

```
Contrato original ALQ20260720-03 — 10 unidades HYT-P50
  ○ Continúa en el contrato nuevo      (renovación de la unidad)
  ○ Se devuelve                        (sale del servicio)
  ○ Se reemplaza por unidad nueva      (linaje al entrante)
  [por defecto: todas "se reemplaza" en REEMP, todas "continúa" en Renovación]
```

**Si el vendedor no sabe serial por serial** (el caso que el usuario señala), decide por **modelo y cantidad** — "6 continúan, 4 se devuelven" — y el sistema guarda el plan agregado; recepción/inventario resuelve los seriales concretos al asignar, PERO contra un plan que ya dice cuántos y de qué tipo, no contra una página en blanco. Dos niveles de la misma captura, cada uno en manos de quien sabe.

Qué produce ese único paso:
- `contratos/{id}/transicion_plan` (nuevo, ver P2) — el acuerdo, auditable.
- Los "continúa" → pre-carga de la subcolección de seriales del nuevo (sin re-teclear).
- Los "se reemplaza" → mapeos con linaje al confirmarse los entrantes.
- Los "se devuelve" → `pendiente_devolucion` + orden de recuperación **al entregar** (el trigger actual, pero ejecutando el plan en vez de asumir "todo se devuelve").
- Las cantidades del contrato pueden derivarse/validarse contra la selección (la línea "5 × T338" deja de ser un dato paralelo).

La pantalla de transición actual **queda** — como lo que siempre debió ser: corrección de excepciones y casos sin origen, no captura primaria.

### P2 · El plan de transición como dato de primera clase

`transicion_plan`: `{ por_modelo: [{modelo_id, continuan, devuelven, reemplazan}], resuelto_por_serial: bool }` + su cumplimiento medible. Bandeja "transiciones incompletas": planes cuya asignación de seriales no cuadra con lo pactado, con envejecimiento. Reemplaza el par actual de señales dispersas (`transicion_mapeos_count`, `renovacion_sin_equipo`) como fuente del CTA.

### P3 · Cerrar la brecha en_cliente-sin-contrato

1. **Backfill**: cruzar las 1,918 por serial contra `poc_devices.contrato_doc_id` y las subcolecciones de seriales de contratos vigentes (el patrón `linkContratoPoc` ya existe); lo ambiguo a cola de sospechosos, no auto-enlace.
2. **Invariante hacia adelante**: una unidad no pasa a `en_cliente` sin `asignacion.contrato_doc_id` o custodia explícita (`ordenes` ya estampa custodia); el guard va en `upsertContacto`.
3. **Soltar las 50 asignaciones a contratos anulados** (script puntual con dry-run; la mayoría es residuo de anulaciones previas al fix de 2026-07-15).

### P4 · La flota visible donde se decide (UI, barato)

1. **Ficha del cliente**: panel "Equipos" (mismo componente del contrato, filtrado por `asignacion.cliente_id`) — Fase A.3 pendiente.
2. **Selector de origen en nuevo-contrato**: cada candidato muestra `N unidades en el pool` (el informe `analiza-origen-faltante.js` ya lo calcula en consola; llevarlo a la UI). Sin esto, el vendedor elige el original a ciegas entre 17 contratos de GOLY.
3. **Transición**: listar también `en_taller` (con chip y aviso "está en taller por la orden X") en vez de esconderlas — eran los 10 P50 invisibles.
4. **Todo serial clickeable** ya existe (EquipoFicha) — mantener la regla en las superficies nuevas.

### P5 · El lenguaje de la renovación parcial

Hoy la parcialidad se expresa como **excepción de devolución** ("NO se devuelve, motivo: renovación parcial") en la pantalla de transición — negativo, tardío, 0 usos. Con P1 pasa a ser la opción **"continúa"** — positiva, en la venta. El motivo tipificado se conserva para las excepciones reales de recepción (perdido, vendido).

### P6 · Marcar la entrega (proceso, no código)

El eslabón más débil sigue siendo humano: la orden se queda en COMPLETADO. Propuestas mínimas:
- Sección nueva del `recordatorioOperativo`: PROGRAMACIÓN/REPARACIÓN con QC aprobado hace ≥N días sin ENTREGADO → correo a recepción con CTA directo.
- CTA "Marcar entregada" en la bandeja de almacén (hoy exige entrar a la orden).
- Medir semanalmente el % de paradas (la conciliación ya corre; agregar la métrica).

### P7 · Saneos puntuales (con dry-run, patrón de la casa)

| Qué | Cuántos | Cómo |
|---|---|---|
| Asignaciones a contratos anulados | 50 | script desasignar + kardex |
| Contratos subcolección ≠ pool | 12 | informe por contrato; corregir la fuente que difiera |
| Vigentes sin ningún serial | 4 | pedir asignación (bandeja ya los muestra) |
| Sin origen accionables | 16 | `analiza-origen-faltante.js` ya los lista con candidatos |
| REPARACIÓN paradas | 151 | misma segmentación por evidencia que PROGRAMACIÓN |

### P8 · Endurecimiento (Fase F del plan, sin adelantarla)

Cuando conciliación sostenida en 0: doble asignación bloqueante (§3.3 del plan), aviso "no está en el pool" → bloqueante con excepción admin, y `seriales_count == cantidad` como requisito de entrega. **No antes**: el principio "avisar, nunca bloquear durante la transición" ha funcionado y los candados prematuros se pagan en soporte.

---

## 6. Qué NO cambiar

- **El pool como columna vertebral** — un doc por unidad, kardex append-only, migración por contacto. Es la parte que ya está bien y los números lo confirman.
- **El mapeo asimétrico** (§3.4 del plan): salientes sin entrante, entrantes netos. El diseño es correcto; lo que falla es el momento de captura, no el modelo.
- **"Adición no devuelve nada"** (2026-08-10) — el corte evitó órdenes de recuperación falsas.
- **El contrato como documento comercial** — no se propone meter seriales en `equipos[]`; se propone que el PLAN por unidad exista desde la venta y las cantidades se deriven de él.

## 7. Orden recomendado

```
1. P7 saneos + P3.3 (50 anulados)         → días; limpia la base para medir lo demás
2. P4 UI (ficha cliente, origen con conteos, en_taller en transición)
                                           → días; el operador EMPIEZA a ver
3. P3.1-3.2 backfill en_cliente + invariante
                                           → 1-2 semanas; la flota por cliente se vuelve confiable
4. P1+P2+P5 captura en la venta            → el núcleo; requiere coordinar con ventas
                                             (mismo riesgo que señaló el plan: es SU pantalla)
5. P6 proceso de entrega                   → paralelo, es gestión más que código
6. P8 endurecimiento                       → al final, con conciliación en 0
```

## 8. Anexo — reproducibilidad

Los números de §3 salen de scripts de solo lectura re-ejecutables (patrón `NODE_PATH` + Admin SDK):
`analiza-transiciones.js`, `analiza-origen-faltante.js` (en `functions/scripts/`) y el diagnóstico de este informe (pool/contratos/mapeos/multi-contrato — candidato a promover a `functions/scripts/analiza-tracking-serial.js` si se quiere re-medir tras cada fase).

Hallazgos previos que este informe integra: REEMP20260811-01 (origen obligatorio, 2026-08-11), cierre de 138 PROGRAMACIÓN + 197 ENTRADA + 21 VISITA (2026-08-11), incidentes NADCAR/ACQUA TRES (adición, 2026-08-10), PROP20260731 (fichas dobles, 2026-08-03), Sociedad Israelita (modelo por serial, 2026-07-23).
