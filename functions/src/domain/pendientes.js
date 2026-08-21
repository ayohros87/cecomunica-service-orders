// Predicados de PENDIENTE — qué espera por una persona, escrito UNA vez.
//
// Hasta 2026-08-21 el criterio de "QC caducado" vivía copiado en CUATRO
// archivos (ordenes-qc.js, recordatorioOperativo.js, senalesService.js,
// ordenesService.js) y "lista para entregar" / "estancada" solo existían
// dentro del cron del correo diario — invisibles para la app. Este módulo es
// la única definición del lado del servidor.
//
// DUPLICADO A PROPÓSITO en public/js/domain/pendientes.js (no hay build step
// que comparta código entre navegador y functions — mismo trato que la
// normalización del pool). functions/test/pendientesSync.test.js evalúa ambos
// sobre un corpus y exige que respondan idéntico: si tocas uno, el test te
// obliga a tocar el otro.
//
// Todos los predicados son PUROS: reciben el doc y deciden. Las queries (qué
// colección, qué límite) son del consumidor; el "posponer" (pendiente_snooze)
// es una función aparte para que cada consumidor decida si lo respeta.

// Umbrales por defecto. El cron los sobreescribe con empresa/config; el
// espejo del navegador los lee de ahí también (senalesService). Cambiarlos
// aquí sin cambiar el espejo rompe el test de sincronía — a propósito.
const DEFAULTS = {
  stale_dias: 10,        // orden abierta sin movimiento → estancada
  stale_max_dias: 30,    // más vieja que esto = legacy, se omite para no enmascarar
  entrada_dias: 7,       // días en cuarentena (devuelto_revision) sin inspección
  entrega_dias: 3,       // completada con QC listo sin marcar ENTREGADO
  qc_dias: 3,            // completada esperando la firma de QC
};

// Estados de ordenes_de_servicio que cuentan como "abiertos" para estancadas.
const ESTADOS_ABIERTOS = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO"];
const COMPLETADO = "COMPLETADO (EN OFICINA)";

// ── Fechas ──────────────────────────────────────────────────────────────
// Acepta Timestamp de Firestore (.toDate), Date, ISO string o epoch.
function aDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function edadDias(ts, now) {
  const d = aDate(ts);
  if (!d) return null;
  const ref = aDate(now) || new Date();
  return (ref - d) / (1000 * 60 * 60 * 24);
}

// ── Control de calidad ──────────────────────────────────────────────────
// La firma de QC cubre lo que la orden tenía al firmarse. Caduca por DOS vías:
//   1. cambió el CONTEO de equipos (la única que las reglas de Firestore
//      pueden verificar — no saben iterar arrays);
//   2. cambió un SERIAL manteniendo el conteo (detectable desde el checklist
//      por equipo, qc.por_equipo, 2026-08-20). Sin esta vía, sustituir un
//      radio por otro dejaba viva una firma que no cubría lo que iba a salir.
// qc.por_equipo ausente = firma anterior al checklist por equipo → corte
// legacy, solo aplica la vía 1.
function qcCaducado(orden) {
  if (!orden || !orden.qc || orden.qc.resultado !== "aprobado") return false;
  const n = orden.qc.equipos_n;
  if (typeof n !== "number") return false;
  if (n !== (Array.isArray(orden.equipos) ? orden.equipos.length : 0)) return true;

  const pe = orden.qc.por_equipo;
  if (!pe || !Object.keys(pe).length) return false;
  const firmados = new Set(Object.values(pe)
    .map((d) => String(d.serial || "").trim()).filter(Boolean));
  const ahora = (orden.equipos || [])
    .filter((x) => x && !x.eliminado)
    .map((e) => String(e.numero_de_serie || e.serial || "").trim())
    .filter(Boolean);
  return ahora.some((s) => !firmados.has(s));
}

function qcAprobado(orden) {
  return !!orden && !!orden.qc && orden.qc.resultado === "aprobado" && !qcCaducado(orden);
}

// Pendiente = la marca exige QC y no hay aprobación vigente (incluye
// rechazadas re-completadas y aprobaciones caducadas).
function qcPendiente(orden) {
  return !!orden && orden.qc_requerido === true && !qcAprobado(orden);
}

// La cola OPERATIVA de QC: lo que de verdad espera una firma hoy. Excluye
// eliminadas, las que no están completadas y las ENTRADA (cierran sin QC).
function esQcColaOperativa(orden) {
  if (!orden || orden.eliminado === true) return false;
  if ((orden.estado_reparacion || "") !== COMPLETADO) return false;
  if ((orden.tipo_de_servicio || "") === "ENTRADA") return false;
  return qcPendiente(orden);
}

// ── Lista para entregar ─────────────────────────────────────────────────
// El eslabón más débil del ciclo es humano: la orden queda COMPLETADA con QC
// aprobado y nadie la marca ENTREGADO AL CLIENTE (67 acumuladas al medirlo,
// 2026-08-20). Solo los tipos cuyo terminal ES la entrega: ENTRADA cierra sin
// entregar, VISITA cierra en sitio, DEVOLUCIÓN tiene su circuito.
function esListaParaEntregar(orden, now, entregaDias) {
  const dias = typeof entregaDias === "number" ? entregaDias : DEFAULTS.entrega_dias;
  if (!orden || orden.eliminado === true) return false;
  if ((orden.estado_reparacion || "") !== COMPLETADO) return false;
  const tipo = (orden.tipo_de_servicio || "").toUpperCase();
  if (!/PROGRAMA|REPARA/.test(tipo)) return false;
  if (orden.qc_requerido === true && !qcAprobado(orden)) return false;
  const edad = edadDias(orden.fecha_completado || orden.fecha_modificacion || orden.fecha_creacion, now);
  return edad != null && edad >= dias;
}

// ── Estancada ───────────────────────────────────────────────────────────
// Abierta y sin movimiento. La ventana [staleDias, staleMax] es deliberada:
// más vieja que el tope es ruido legacy que enmascara lo accionable (mismo
// criterio que admin/operacion). El caller restringe a ESTADOS_ABIERTOS en la
// query; las DEVOLUCIÓN tienen su propia sección con otro SLA y otra audiencia.
function esOrdenEstancada(orden, now, opts) {
  const staleDias = (opts && typeof opts.staleDias === "number") ? opts.staleDias : DEFAULTS.stale_dias;
  const staleMax = (opts && typeof opts.staleMax === "number") ? opts.staleMax : DEFAULTS.stale_max_dias;
  if (!orden || orden.eliminado === true) return false;
  if ((orden.tipo_de_servicio || "") === "DEVOLUCION") return false;
  const base = orden.fecha_modificacion || orden.fecha_actualizacion
    || orden.updatedAt || orden.fecha_entrada || orden.fecha_creacion;
  const edad = edadDias(base, now);
  return edad != null && edad >= staleDias && edad <= staleMax;
}

// ── Cuarentena ──────────────────────────────────────────────────────────
// Unidad del pool en devuelto_revision sin movimiento. La salida de
// cuarentena es manual por unidad (inspección OK / baja).
function esCuarentenaAtascada(unidad, now, entradaDias) {
  const dias = typeof entradaDias === "number" ? entradaDias : DEFAULTS.entrada_dias;
  if (!unidad) return false;
  const edad = edadDias(unidad.updated_at || unidad.created_at, now);
  return edad != null && edad >= dias;
}

// ── Posponer ────────────────────────────────────────────────────────────
// El estado vive EN EL DOCUMENTO FUENTE (orden o unidad del pool), nunca en
// una bandeja: `pendiente_snooze: { hasta, motivo, por_email, at }` — mismo
// principio que el descarte de "Órdenes por crear" (orden_prog_descartada).
// La bandeja del home Y el correo diario lo respetan; el doc sigue diciendo
// la verdad y cualquier vista se reconstruye sola.
function estaPospuesto(doc, now) {
  const s = doc && doc.pendiente_snooze;
  if (!s || !s.hasta) return false;
  const hasta = aDate(s.hasta);
  if (!hasta) return false;
  const ref = aDate(now) || new Date();
  return hasta.getTime() > ref.getTime();
}

module.exports = {
  DEFAULTS, ESTADOS_ABIERTOS, COMPLETADO,
  aDate, edadDias,
  qcCaducado, qcAprobado, qcPendiente, esQcColaOperativa,
  esListaParaEntregar, esOrdenEstancada, esCuarentenaAtascada,
  estaPospuesto,
};
