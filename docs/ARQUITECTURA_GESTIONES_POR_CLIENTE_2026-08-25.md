# Gestiones por cliente a nivel de serial — Arquitectura y plan de implementación

**Fecha:** 25 de agosto de 2026
**Estado:** propuesta para revisión
**Contexto:** hoy toda operación (baja, reemplazo, adición, devolución, anulación) se maneja *por contrato*. La nueva forma de trabajar: las gestiones son *del cliente* y afectan *seriales* — que pueden pertenecer a contratos distintos. Este documento mapea todos los flujos actuales del módulo de contratos, identifica dónde el diseño amarra la operación al contrato, y propone la arquitectura y el plan para soltarla sin romper nada.

Prototipos navegables de referencia:
- Centro de gestión de clientes: https://claude.ai/code/artifact/24226c43-8f36-4445-8482-df023da2d979
- Módulo de solicitudes (reemplazo/demo) + plan F0–F7: https://claude.ai/code/artifact/8803f6b5-41d9-4a59-a3f1-e5fc5f233f8b

---

## 1. Resumen ejecutivo

- **El contrato deja de ser la unidad operativa y queda como lo que realmente es: la envoltura comercial y de facturación.** La unidad operativa pasa a ser la **gestión**: un expediente del *cliente* que opera sobre uno o más *seriales*, sin importar de qué contrato cuelguen.
- **`equipos_pool` ya es la fuente de verdad física** (doc por serial, kardex append-only, `asignacion.cliente_id`). La arquitectura lo eleva a fuente de verdad *operativa*: las gestiones leen y mueven el pool; el contrato recibe *efectos derivados* (contadores y fechas de facturación) calculados por triggers.
- **Nada se rompe de golpe (patrón estrangulador):** las gestiones nuevas escriben exactamente los campos derivados que los contratos ya consumen (`baja_cancelado`, `devolucion_estado`, `entrega_confirmada`, `reemplaza_a`…). La facturación no cambia de fórmula en ninguna ola.
- **La facturación ya va en esta dirección:** el plan QBO v4 (2026-07-01) eliminó el sub-customer por contrato — la factura se emite al *Customer = cliente*, con líneas agrupadas por contrato. La operación debe seguir a la cobranza: cliente como eje, contrato como agrupador de líneas.
- **Hallazgo colateral:** no existe ningún proceso de vencimiento de contratos (`duracion` es texto impreso; `fecha_vencimiento` no lo escribe nadie, aunque `admin-integridad` lo chequea). Las señales "contrato vence en X días" del Centro de gestión necesitan crear ese dato (Ola 1).
- **Esfuerzo estimado:** ~6 olas incrementales; la Ola 2 es el módulo de solicitudes ya planificado (15–19 d). El resto suma ~21–29 días adicionales. Cada ola se despliega sola y deja el sistema consistente.

---

## 2. Cómo trabajamos hoy — mapa de flujos del módulo de contratos

| # | Flujo | Dónde vive | Qué hace con los seriales |
|---|-------|-----------|---------------------------|
| 1 | Creación + aprobación | `nc-guardar.js`, `contratos-approval.js`, `onApproval.js` | Nada aún; al aprobar pide seriales a inventario (`seriales_estado:'pendiente'`) |
| 2 | Asignación de seriales | `contrato-seriales-page.js`, `contratosService.saveSerialesManual()`, `onSerialWrite.js` | Escribe `contratos/{cid}/seriales/*`; el trigger asigna en pool (`asignado_contrato`, `asignacion.contrato_doc_id`); candado tras `asignados` |
| 3 | Entrega | `onOrdenEntregada.js` → `entrega_confirmada` → `onEntregaPool.js` | Pool `asignado_contrato → en_cliente`, solo unidades de ESE contrato |
| 4 | Renovación / transición | `transicion_plan`, `onEntregaTransicion.js`, `mapeos` + `onMapeoWrite.js` | Reclama salientes del contrato origen, estampa `reemplaza_a`, crea orden DEVOLUCIÓN |
| 5 | Adición | `accion:'Adición'` = contrato nuevo | Unidades del cliente quedan repartidas entre contratos; ninguna vista las une salvo `EquiposCliente` |
| 6 | Enmiendas (baja parcial / terminación total) | `cancelaciones.html`, `cancelacionesService.js`, `onCancelacionWrite.js` | **Por modelo+cantidad, nunca por serial**; deriva `baja_cancelado{modelo→qty}` y crea DEVOLUCIÓN por modelo (por serial solo en Propio) |
| 7 | Anulación / sustitución | `contratos-list.js` (diálogo), `onAnnulment.js`, `sustitucionContrato.js` | Clasifica fichas del contrato en cubos (custodia/bodega/continúan/devolución/**omitidas**); traspaso limitado por cupo del sustituto |
| 8 | Orden de DEVOLUCIÓN | `ordenDevolucion.js`, `onOrdenDevolucionWrite.js` | Check-in por serial → `devuelto_revision` → ENTRADA; espejo `devolucion_*` en el/los contratos |
| 9 | Vencimiento | **No existe** | — |
| 10 | Legacy | `seriales_estado:'legacy'` | Registro histórico directo a pool como `en_cliente`; excluidos de transición/cambios/programación |
| 11 | Facturación / QBO | `calcularFacturaContrato.js`, `facturacionDiaria.js`, plan QBO v4 | Cálculo por líneas de `equipos[]` del contrato con fechas por línea; emisión (futura) al Customer=cliente con Class=contrato |
| 12 | Cambio de serial | `contratos/{cid}/seriales_cambios` + `onSerialCambio.js` | Corrección post-candado; solo con contrato `aprobado` |

## 3. Las fricciones — dónde el contrato amarra al serial

Condensado del análisis de código (la lista completa con path:línea queda en el anexo §9):

**Modelo de datos.** El pool guarda **un solo** `asignacion.contrato_doc_id` (reasignar = pisar). Los seriales *viven dentro* del contrato (subcolección), igual que su historial y sus solicitudes de cambio: el rastro de un serial que cruza contratos queda partido en N subcolecciones — el único hilo continuo es el kardex del pool. El linaje `reemplaza_a` solo nace de `contratos/{cid}/mapeos`.

**Cupos derivados de `equipos[]`.** El número de "slots" de serial es `Σ equipos[].cantidad − baja_cancelado_total` *de ese contrato*. Consecuencias medidas en el propio código: la baja no puede reclamar un serial que cuelga de otro contrato del cliente (`unidadesRecuperablesDeBaja` filtra por `contrato_doc_id`); la anulación **omite** fichas asignadas a otro contrato (caso MAGEN DAVID: radios en taller desaparecieron del proceso); la sustitución deja seriales colgando del contrato muerto si el sustituto no tiene cupo (`pendientes[]`); y la custodia sin contrato (`degradarACustodia`) es un estado **sin salida** — no hay operación para re-vincular ese serial salvo crear otro contrato.

**Bajas ciegas al serial.** Las enmiendas se expresan en modelo+cantidad; el sistema *adivina* qué unidades físicas salen. Con la nueva forma de trabajar (una baja afecta UN serial, quizá de otro contrato) esto es el punto más urgente.

**Triggers y reglas con guard de contrato.** `onEntregaPool`, `onSerialWrite` y `onEntregaTransicion` condicionan todo a `asignacion.contrato_doc_id === cid`; las reglas de Firestore solo autorizan escrituras de seriales como subcolección de `contratos/{docId}`; y sin vínculo contrato→contrato (`origen_ids`) no hay devolución automática aunque el cliente tenga 30 radios afuera.

**Colas por contrato.** Las bandejas de inventario procesan "un contrato" (`seriales_estado`), no "N seriales de un cliente".

---

## 4. Arquitectura propuesta

### 4.1 Principios

1. **Cliente = eje operativo. Contrato = envoltura comercial.** Toda gestión nace en el cliente (desde el Centro de gestión) y referencia seriales; cada serial conoce su contrato *para efectos de facturación*, no para autorizar la operación.
2. **Serial = unidad de operación.** Un ítem de gestión es un serial concreto (modelo+cantidad solo cuando el serial no existe aún: aumentos y demos antes de asignación).
3. **El pool manda.** `equipos_pool/{serial_norm}` es la única fuente de verdad del estado físico; toda transición pasa por `cambiarEstado()` (transaccional + kardex), como hoy. Las subcolecciones del contrato pasan gradualmente a **espejos derivados**.
4. **Efectos contractuales siempre derivados, nunca escritos a mano.** Los contadores que el contrato necesita (`baja_cancelado`, `devolucion_*`, `seriales_count`, fechas de fin de facturación) los calculan triggers a partir de las gestiones y del pool — el mismo patrón que ya usan `estamparEspejo` y `onCancelacionWrite`.
5. **Una gestión puede cruzar contratos.** El fan-out por contrato es responsabilidad del trigger (agrupar ítems por `item.contrato_doc_id`), no del usuario.
6. **Estrangulador, no big-bang.** Cada ola agrega el camino nuevo y mantiene el viejo funcionando; el retiro del camino viejo es la última ola, no la primera.

### 4.2 Modelo de datos

**Colección nueva `gestiones/{id}`** (evolución de la `solicitudes_equipo` ya diseñada — misma colección, más tipos):

```
gestiones/{id}            // GR=reemplazo, GD=demo, GB=baja, GA=aumento, GV=devolución, GC=cambio de serial
  tipo: 'reemplazo' | 'demo' | 'baja' | 'aumento' | 'devolucion' | 'cambio_serial'
  cliente_id, cliente_nombre                  // EL EJE — siempre presente
  estado: máquina por tipo (§4.4)             // + 'anulada'
  origen: { tipo:'vendedor'|'taller'|'sistema'|'anulacion', ref_id?, diagnostico? }
  responsable_uid/_nombre, fecha_solicitud, searchTokens[], deleted:false

  items: [{                                   // 1 ítem = 1 serial (o 1 línea modelo+cantidad)
    serial_norm?, pool_doc_id?, modelo_id, modelo,
    contrato_doc_id?, contrato_id?,           // vínculo de FACTURACIÓN del serial (puede diferir entre ítems)
    // por tipo:
    motivo_codigo?, motivo_detalle?,          // baja, reemplazo
    modelo_solicitado_id?, serial_nuevo?,     // reemplazo
    cantidad?,                                // aumento, demo (pre-asignación)
    fecha_fin_facturacion?,                   // baja (por ítem — permite fechas distintas por contrato)
    resolucion?, resuelto_at?                 // devolución (check-in)
  }]

  contratos_afectados: [contrato_doc_id,...]  // derivado por trigger de items[] — para queries y espejos
  ordenes: { programacion_id?, devolucion_id?, entrada_id? }
  cierre: { ...flags por tipo }               // el cierre es automático al completarse
  aprobacion?: { requiere, aprobado_por, at } // solo tipos que la piden (baja con penalidad, excepciones)
  cerrada_at?
subcolecciones: mapeos/ (linaje reemplaza_a), eventos/ (bitácora del expediente)
```

**`equipos_pool` — cambios mínimos:**
- `asignacion` conserva `contrato_doc_id` (vínculo de facturación) y `cliente_id` (vínculo operativo). Se agrega `asignacion.gestion_doc_id` cuando la unidad está tomada por una gestión en curso (demo, reemplazo entrante).
- Nuevo movimiento de kardex `traspaso_contrato` para la operación de primera clase "mover serial del contrato A al B del mismo cliente" (§4.5) — hoy eso solo existe enterrado en `sustitucionContrato`.
- `venta.garantia_vence` (12 meses desde factura, estampado al vender; sin backfill del histórico por ahora — decisión §8.8).

**`contratos` — solo campos derivados nuevos:**
- **Vigencias por tramo** (decisión de negocio 2026-08-25): un contrato puede tener varios tramos de vigencia — el original y el de cada enmienda de aumento, cada uno con su propio período. Cada línea de `equipos[]` gana `vigencia: {fecha_inicio, duracion, fecha_vencimiento, enmienda_id?}`; el doc del contrato lleva el derivado `fecha_vencimiento_proxima` (el tramo activo más cercano) para señales y listados. Esto reemplaza la razón de ser del contrato Adición: antes se creaba un contrato aparte *precisamente* para que quedara claro que el equipo nuevo vence más tarde; ahora esa claridad vive en el tramo. **Hoy no existe ninguna fecha de vencimiento y `admin-integridad` chk5 la chequea en vano.**
- Los derivados actuales (`baja_cancelado`, `devolucion_*`, `seriales_count`…) no cambian de forma: cambian de *quién los alimenta*.

**Índices:** `equipos_pool(asignacion.cliente_id, estado)`, `gestiones(cliente_id, estado)`, `gestiones(contratos_afectados array-contains, estado)`.

### 4.3 La consulta canónica cambia de eje

| Pregunta | Hoy | Propuesta |
|---|---|---|
| ¿Qué tiene el cliente? | `EquiposCliente` (overlay, único punto cliente-céntrico) | `pool.where('asignacion.cliente_id','==',X)` — consulta central del Centro de gestión y de TODAS las gestiones |
| ¿Qué unidades toca esta operación? | `pool.where('asignacion.contrato_doc_id','==',cid)` en 8+ sitios | Los `items[]` de la gestión (seleccionados de la flota del cliente); el contrato se lee por ítem |
| ¿Qué trabajo hay pendiente? | Colas sobre `contratos` (`seriales_estado`, `seriales_cambio_pendiente`) | Colas sobre `gestiones` (bandeja por estado) + colas viejas hasta la Ola 6 |
| ¿Cuánto facturo? | Líneas de `equipos[]` por contrato | **Igual** — los ítems de gestión derivan los ajustes por línea (§4.6) |

### 4.4 Ciclo de vida por tipo de gestión

| Tipo | Flujo | Reemplaza a |
|---|---|---|
| **reemplazo** | (ya diseñado) solicitud → bodega asigna → OS PROG (correo a recepción + CC vendedor) → entrega seamless → orden DEVOLUCIÓN → check-in → ENTRADA → cierre 4/4. El serial entrante **hereda el `contrato_doc_id` del saliente**; por defecto la tarifa no cambia, con **opción de ajustar el precio de la línea** cuando se cambia por un modelo más costoso (aplicado por CF, registrado en el expediente). **Excepción propio sin garantía: requiere aprobación de administrador antes de que Bodega asigne** | Contrato REEMP |
| **demo** | (ya diseñado) solicitud → bodega asigna (stock **nuevo o refurbished**) → OS PROG → en demo → retorno → ENTRADA → disponible. Recordatorio al responsable a los **15 días** (al vencer la fecha estimada; sin fecha, a los 15 días de la salida) | Contrato DEMO |
| **baja** | El vendedor marca **seriales concretos** de la flota (de uno o varios contratos) + motivo + fecha fin de facturación por ítem → aprobación con **penalidad calculada por el sistema según el tramo** (no vencido: 3 meses de mensualidad; vencido: 30 días = factura corriente del mes + prorrateo de los días pendientes del período), con **una sola aprobación por gestión** cuya pantalla desglosa por contrato cada equipo, sus montos y su penalidad → trigger deriva `baja_cancelado` POR CONTRATO agrupando ítems → orden DEVOLUCIÓN **siempre por serial** (se acabó adivinar por modelo) → check-in → cierre. Terminación total = baja con `todos_los_seriales:true` de un contrato | `solicitudes_cancelacion` (baja_parcial / terminacion_total) |
| **aumento** | **(Decidido 2026-08-25: enmienda CON firma del cliente y vigencia propia.)** Vendedor pide modelo+cantidad e indica a qué contrato se carga → aprobación comercial → se genera el **anexo de aumento** (documento imprimible con correlativo, reusa la maquinaria de PDF/firma/verificación del contrato) → firma del cliente → trigger agrega la línea a `equipos[]` con `vigencia` propia (inicio a la entrega, duración pactada, **vencimiento posterior al del tramo original — debe quedar explícito en el anexo**) → bodega asigna seriales → OS PROG → entrega. "Contrato nuevo" queda solo para clientes sin contrato aplicable | Contrato con `accion:'Adición'` |
| **devolucion** | Envoltura de la orden DEVOLUCIÓN actual, ahora como gestión visible del cliente: agrupa seriales esperados (de N contratos), su check-in y su espejo. Creada por otras gestiones o manual | Orden DEVOLUCIÓN suelta (`contrato_papel`) |
| **cambio_serial** | Corrección de un serial mal capturado, a nivel cliente: ya no exige contrato `aprobado` — la ventana la define el estado del equipo, no el papel | `contratos/{cid}/seriales_cambios` |

**Anulación / sustitución de contrato** no se convierte en gestión (sigue siendo un acto sobre el papel), pero su efecto físico sí: `onAnnulment` deja de clasificar y omitir por su cuenta, y **emite una gestión `devolucion`** con los seriales afectados + usa la operación `traspaso_contrato` para los que continúan. Se acaban las `omitidas` invisibles: todo serial del cliente queda en alguna gestión o en su flota.

### 4.5 Operaciones de primera clase que hoy no existen

1. **`traspasarSerial(serial, contratoDestino)`** — mueve el vínculo de facturación de un serial entre contratos del mismo cliente, con movimiento de kardex `traspaso_contrato` y ajuste de derivados en ambos contratos. Hoy solo existe dentro de `sustitucionContrato` con límite de cupo; se extrae a `lib/`. **Decisión 2026-08-26: no es una operación libre** — solo la ejecuta el sistema al firmarse una **enmienda de traspaso** (anexo con firma del cliente, misma maquinaria del anexo de aumento). Resuelve: sustitución sin cupo, `pendientes[]`, y consolidación de flotas repartidas por Adiciones — siempre con papel firmado de por medio.
2. **`vincularCustodia(serial, contrato|linea)`** — la salida del estado "custodia sin contrato": re-vincula un serial `en_cliente` sin contrato a una línea (vía gestión aumento o traspaso). Cierra el callejón de `degradarACustodia`.
3. **Vigencias por tramo + cron de señales** — al activar un contrato se calcula el tramo inicial desde `duracion`; cada enmienda de aumento crea su propio tramo; un cron diario (colgado del `recordatorioOperativo` existente) estampa `vencimiento_estado` **por tramo** y alimenta las señales del Centro. Reglas decididas: aviso a **60 días** del vencimiento (solo señal, nada se bloquea); **cada tramo renueva a su propia fecha**; en períodos de **18+ meses** el CTA "Renovar" se habilita hasta **3 meses antes** (renovación anticipada).

### 4.6 Facturación: qué cambia y qué NO

**No cambia:** `calcularFacturaContrato` sigue leyendo líneas de `equipos[]` con sus fechas; `facturacionDiaria` sigue activando por contrato; los candados `touchesCFOwnedFields` siguen. QBO v4 factura al cliente con líneas por contrato — exactamente compatible con "cliente eje, contrato agrupador".

**Cambia el origen de los ajustes:** una gestión de baja con ítems de 2 contratos produce, vía trigger, `baja_cancelado` y `fecha_fin_facturacion` en CADA contrato afectado (agrupando sus propios ítems). Una gestión de aumento produce la enmienda de alta en el contrato elegido. El reemplazo no toca facturación (el entrante hereda la línea del saliente). **Regla de oro: ningún flujo nuevo escribe `equipos[]` ni `facturacion_*` desde el cliente — siempre Cloud Functions.**

### 4.7 Reglas y permisos (esqueleto)

```
match /gestiones/{id} {
  allow read:   roles operativos (admin, gerente, vendedor, recepcion, inventario, tecnico lectura);
  allow create: admin, gerente, vendedor, recepcion;        // items solo con serial del MISMO cliente_id
  allow update: por campo — bodega (asignaciones), aprobador (aprobacion.*), CF el resto;
  allow delete: nadie (anulada, no borrada);
}
// equipos_pool: sin cambios de fondo — las gestiones lo mueven vía CF/callables, no escritura directa del cliente.
// contratos/{cid}/seriales*: se mantienen las reglas actuales hasta la Ola 6 (espejo CF-owned).
```

Validación clave en rules + CF: **todos los `items[].serial_norm` deben resolver a fichas con `asignacion.cliente_id == gestion.cliente_id`** (o estar libres en bodega para entrantes). Es el candado que sustituye al guard por contrato.

### 4.8 Mapa "hoy → mañana" por flujo

| Flujo actual | Destino | Ola |
|---|---|---|
| Contratos ALQ/PROP/TEMP, aprobación, firma, PDF, verificación | **Se quedan igual** (envoltura comercial) | — |
| Asignación de seriales al contrato | Se queda; a futuro también alimentable desde gestión aumento | 4 |
| Entrega / `onEntregaPool` | Se queda; entregas de gestiones usan `gestion_doc_id` | 2 |
| Renovación + transición | Se queda (es genuinamente contrato→contrato); comparte `decidirSalientes` y mapeos con reemplazo | 2 |
| Contratos REEMP / DEMO | → gestiones `reemplazo` / `demo` | 2 |
| `solicitudes_cancelacion` (baja por modelo) | → gestión `baja` por serial, cross-contrato | 3 |
| Contrato Adición | → gestión `aumento` (según decisión §8.2) | 4 |
| Anulación: clasificación con `omitidas` | → emite gestión `devolucion` + `traspasarSerial`; cero omitidas | 5 |
| `seriales_cambios` bajo contrato | → gestión `cambio_serial` a nivel cliente | 5 |
| Colas de inventario por contrato | → bandeja de gestiones | 6 |
| `contratos/{cid}/seriales` como fuente | → espejo derivado del pool (CF-owned) | 6 |
| Vencimiento (inexistente) | `fecha_vencimiento` + cron + señal en Centro | 1 |

---

## 5. Invariantes del sistema (válidos en toda ola)

1. Todo cambio de estado físico de un serial pasa por `cambiarEstado()` del pool (transacción + kardex). Sin excepciones nuevas.
2. Los campos derivados del contrato (`baja_cancelado*`, `devolucion_*`, `seriales_count`, `facturacion_*`, `fecha_vencimiento`) los escriben solo Cloud Functions.
3. Una gestión referencia seriales de UN solo cliente. Cross-cliente no existe.
4. El serial entrante de un reemplazo hereda el contrato del saliente; cambiar de línea de facturación es SIEMPRE un `traspaso_contrato` explícito y auditado.
5. Un serial que sale de servicio (`devuelto_revision`/`en_taller`) no vuelve a `en_bodega` sin disposición de taller.
6. Los scripts de saneo cierran, nunca borran (regla vigente del proyecto).
7. La normalización de serial front/functions se mantiene idéntica (test de sincronía existente).

---

## 6. Plan de implementación por olas

> Las estimaciones son días hábiles de desarrollo. Cada ola termina desplegada y con el camino viejo intacto. La Ola 2 es el plan F0–F6 del módulo de solicitudes ya detallado en el artifact; aquí se integra sin repetirlo.

### Ola 0 — Decisiones de negocio (mayormente CERRADA 25–26 ago)
Las decisiones grandes ya están tomadas (§8): excepción de garantía con aprobación admin, aumento por enmienda firmada con tramo propio, renovación por tramo (+anticipada 3 meses en 18+), penalidad de baja (3 meses / 30 días+prorrateo), traspaso solo por adenda firmada, aviso de vencimiento a 60 días, demos nuevo/refurbished con recordatorio a 15 días. Cerradas también el 26 ago: garantía 12 meses sin backfill, ajuste opcional de tarifa al cambiar de modelo, una sola aprobación por baja multi-contrato con desglose por contrato, y cambio de serial por estado del equipo. **Ola 0 CERRADA: las 11 decisiones tomadas, ninguna abierta.**

### Ola 1 — Fundaciones cliente-céntricas (4–5 d)
- Colección `gestiones` + rules + correlativo (`contadores/`), con los tipos `reemplazo|demo` activos y el resto declarados.
- Índices (`asignacion.cliente_id+estado`, `gestiones` por cliente y por contrato afectado).
- `fecha_vencimiento`: backfill desde `duracion` (script solo-lectura primero), estampado al activar, cron de `vencimiento_estado` dentro de `recordatorioOperativo`, arreglo del chk5 de `admin-integridad`.
- **Centro de gestión de clientes v1** (plan F7 ya detallado): lista completa de clientes como navegación principal, ficha 360 leyendo pool por cliente, señales (vencimiento, gestiones abiertas, equipos en taller), menú "Nueva gestión".
- Riesgo: bajo. Nada del flujo actual se toca.

### Ola 2 — Gestiones de equipo: reemplazo y demo (15–19 d)
- El plan F1–F6 del módulo de solicitudes, ejecutado sobre la colección `gestiones` (no una colección aparte): wizard, bodega, OS PROG con correo a recepción + CC vendedor, cadena DEVOLUCIÓN→ENTRADA, cierre automático 4/4, generalización de `onMapeoWrite` (mapeos bajo la gestión), retiro de REEMP/DEMO del selector al final, piloto de 1 semana.
- Extra de esta arquitectura: `asignacion.gestion_doc_id` en pool y `contratos_afectados[]` derivado.
- Riesgo: medio (triggers nuevos). Mitigación: piloto en paralelo al canal viejo; e2e manual (el emulador no cubre triggers — stub sin FieldValue).

### Ola 3 — Baja por serial, cross-contrato (5–7 d)
- Wizard de baja en el Centro: flota del cliente con casillas (multi-contrato), motivo, fecha fin por ítem, y **penalidad calculada por el sistema** según el tramo de cada ítem (no vencido: 3 meses de mensualidad; vencido: 30 días = factura corriente + prorrateo ÷30 — reusa la aritmética de `calcularFacturaContrato`), mostrada por contrato afectado antes de aprobar.
- `onGestionBajaWrite`: deriva `baja_cancelado{modelo→qty}` + `baja_fecha_fin` POR CONTRATO agrupando ítems (mismo shape que produce `onCancelacionWrite` — la facturación no nota la diferencia); terminación total como caso `todos_los_seriales`.
- Orden DEVOLUCIÓN **siempre por serial** (muere `esperados_por_modelo` para bajas; se retira `unidadesRecuperablesDeBaja` del camino nuevo).
- Compatibilidad: `solicitudes_cancelacion` queda en solo-lectura para histórico; la UI de cancelaciones redirige al Centro.
- Riesgo: medio-alto (toca derivados de facturación). Mitigación: los triggers viejo y nuevo escriben el mismo shape; conciliación semanal ampliada con chequeo "baja_cancelado == Σ ítems de gestiones de baja".

### Ola 4 — Aumento por enmienda firmada y regularización (5–7 d)
- Gestión `aumento`: modelo+cantidad+precio → aprobación comercial → **anexo de aumento** imprimible con correlativo propio, firma del cliente y verificación pública (reusa `pdfRenderer`, `firma_*` y `verificaciones/` del contrato) → CF agrega la línea a `equipos[]` con `vigencia` propia → asignación de seriales → OS PROG → entrega.
- El anexo debe dejar **explícito el período del equipo nuevo** (inicio, duración, vencimiento) — es la razón por la que hoy se usa contrato Adición, y se conserva como cláusula del anexo.
- `vincularCustodia`: salida del estado "custodia sin contrato" (los huecos de la toma física y de anulaciones viejas).
- El flujo Adición actual queda para clientes sin contrato aplicable.

### Ola 5 — Anulación, sustitución y cambio de serial sobre el nuevo eje (4–6 d)
- Extraer `traspasarSerial()` de `sustitucionContrato` a `lib/` con kardex `traspaso_contrato`, invocable **solo desde una enmienda de traspaso firmada por el cliente** (anexo con la maquinaria de la Ola 4) — sin operación manual libre.
- `onAnnulment` v2: clasifica igual, pero (a) las `omitidas` se convierten en ítems de una gestión `devolucion` o en traspasos pendientes VISIBLES en el Centro; (b) el espejo de sustitución (`sustitucion_*`) se mantiene.
- Gestión `cambio_serial` a nivel cliente; las `seriales_cambios` bajo contrato quedan de solo-lectura.
- Riesgo: medio. Los casos raros (MAGEN DAVID, PROP mixto) ya tienen fixtures documentados en código — convertirlos en tests.

### Ola 6 — Espejo y retiro del camino viejo (3–4 d)
- `contratos/{cid}/seriales` pasa a espejo derivado del pool (trigger pool→espejo); `saveSerialesManual` queda solo para la asignación inicial; reglas del espejo → CF-owned.
- Colas de inventario leen `gestiones`; badge del rail unificado.
- Conciliación semanal: chequeos nuevos (espejo vs pool, gestiones abiertas huérfanas, `contratos_afectados` vs ítems).
- Documentación: actualizar `docs/FACTURACION_COMO_FUNCIONA.md` (glosario QBO desactualizado) y este documento a "implementado".

**Total estimado adicional a la Ola 2: ~21–29 d.** Olas 1–2 pueden arrancar ya; las decisiones de la Ola 0 que bloqueaban 3–5 quedaron cerradas el 26 de agosto.

---

## 7. Qué gana cada quien (el argumento de negocio)

- **Vendedor:** una sola pantalla (Centro de gestión) para ver la flota real del cliente y arrancar cualquier gestión; las bajas y reemplazos por serial exacto, aunque crucen contratos.
- **Bodega/Inventario:** bandeja de gestiones por estado en vez de "contratos con seriales pendientes"; devoluciones siempre por serial — se acabó adivinar unidades por modelo.
- **Taller:** su diagnóstico alimenta la gestión; la disposición final controla el retorno al inventario (candado ya existente).
- **Contabilidad:** cero cambio de fórmula; los ajustes llegan por los mismos campos derivados, ahora con rastro serial por serial; QBO v4 encaja sin fricción.
- **Gerencia:** cada gestión es un expediente completo (quién, qué serial, por qué, qué órdenes, cuándo cerró) y desaparecen los agujeros conocidos: omitidas de anulación, custodia sin salida, seriales colgando de contratos muertos.

---

## 8. Decisiones de negocio

### Tomadas (Alberto, 25–26 ago 2026)

1. **Excepción de garantía en equipo propio** — el reemplazo de un propio sin garantía vigente **requiere aprobación de administrador** antes de que Bodega asigne (se modela en `gestion.aprobacion`). Para alquiler y propios en garantía no hay aprobación previa.
2. **Aumento** — enmienda sobre el contrato existente, **con firma del cliente** y **vigencia propia por tramo**: el anexo deja explícito que el período del equipo nuevo es distinto y vence más tarde (la razón por la que antes se usaba contrato Adición).
3. **Renovación por tramos** — cada tramo renueva **a su propia fecha**, sin unificación. Para períodos de contrato de **18 meses o más** se permite **renovación anticipada hasta 3 meses** antes del vencimiento (define la ventana del CTA "Renovar" en el Centro).
4. **Penalidad de baja** — se evalúa contra el tramo del ítem: contrato/tramo **no vencido** → penalidad de **3 meses de mensualidad**; **vencido** → **30 días**, que usualmente se compone de la factura corriente del mes (emitida el primer día laboral) más el prorrateo de los días pendientes para completar el período. La gestión de baja calcula y muestra la penalidad **por contrato afectado**.
5. **Traspaso de seriales** — **no existe como operación libre**: mover seriales a otro contrato exige una **adenda/enmienda firmada por el cliente**; solo firmada, el sistema ejecuta el traspaso. La primitiva `traspasarSerial` queda interna, invocable únicamente desde una enmienda de traspaso (aplica también a la sustitución al anular).
6. **Vencimiento** — aviso a **60 días** del vencimiento; no se bloquea nada, es solo señal.
7. **Demos** — pueden salir de stock **nuevo o refurbished**; recordatorio al responsable **al vencerse la fecha estimada de devolución**; si no hay fecha, **a los 15 días** de la salida.
8. **Plazo de garantía** — **12 meses** desde la factura. **Sin backfill del histórico por ahora**: los propios vendidos antes de que exista el dato aparecerán como "sin garantía" y su reemplazo pasará por la vía de excepción con aprobación de administrador (consecuencia aceptada; el dato se puede cargar caso por caso cuando haga falta).
9. **Cambio de modelo en reemplazo** — por defecto **no ajusta la tarifa**; el flujo ofrece la **opción de ajustar el precio de la línea** (p. ej. cuando se cambia por un modelo más costoso). El ajuste lo aplica Cloud Functions sobre `equipos[].precio` de la línea y queda registrado en el expediente de la gestión.
10. **Aprobación de baja multi-contrato** — **una sola aprobación por gestión**. Requisito de UI: la pantalla de aprobación desglosa claramente **de qué contrato viene cada equipo**, con los montos de facturación, la penalidad por tramo y toda la información relevante, antes de aprobar.
11. **Cambio de serial por estado del equipo** — la ventana de corrección de un serial mal capturado la define el **estado del equipo**, no el estado del contrato (hoy la regla exige contrato `aprobado` y cierra la puerta al activarse). La corrección se permite en cualquier momento con **aprobación de administrador** y auditoría en el kardex (`correccion_serial`); si el radio está en una orden o QC en curso, la corrección avisa y arrastra la actualización.

### Aún abiertas

Ninguna — las 11 decisiones de negocio quedaron cerradas entre el 25 y el 26 de agosto de 2026. El plan puede ejecutarse completo.

---

## 9. Anexo — referencias de código clave

- Creación/derivados del contrato: `public/js/pages/nc-guardar.js:201-263` · aprobación: `functions/src/triggers/contratos/onApproval.js`
- Seriales del contrato: `public/js/pages/contrato-seriales-page.js` · `public/js/services/contratosService.js:327-408` · `functions/src/triggers/contratos/onSerialWrite.js`
- Entrega: `functions/src/triggers/ordenes/onOrdenEntregada.js` · `functions/src/triggers/contratos/onEntregaPool.js`
- Transición: `public/js/domain/transicionPlan.js` · `functions/src/triggers/contratos/onEntregaTransicion.js` · `functions/src/lib/transicionPlanExec.js` · `onMapeoWrite.js`
- Enmiendas/bajas: `public/js/services/cancelacionesService.js` · `functions/src/triggers/contratos/onCancelacionWrite.js` · `functions/src/lib/devolucion.js:251-278` (`unidadesRecuperablesDeBaja`)
- Anulación/sustitución: `functions/src/triggers/contratos/onAnnulment.js` · `functions/src/lib/sustitucionContrato.js` · `functions/src/lib/devolucion.js:175-227` (`clasificarUnidadesAnulacion`, cubo `omitidas`)
- Devolución: `functions/src/lib/ordenDevolucion.js` · `functions/src/triggers/ordenes/onOrdenDevolucionWrite.js` (espejo multi-contrato `estamparEspejo`)
- Pool: `functions/src/domain/equiposPool.js` · `public/js/services/equiposPoolService.js` (`listarPorCliente:235`, `cambiarEstado:590`)
- Facturación: `functions/src/callable/calcularFacturaContrato.js` · `functions/src/domain/facturacionDiaria.js:19-33` · `docs/plans/QUICKBOOKS_INTEGRATION_PLAN.md` (v4: Customer=cliente)
- Vencimiento inexistente: `public/js/pages/admin-integridad.js:137-152` (chk5 lee `fecha_vencimiento` que nadie escribe)
- Vista cliente actual: `public/js/ui/equipos-cliente.js` · reglas: `firestore.rules:314-337, 580+`
