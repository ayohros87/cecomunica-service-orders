// ¿Qué aviso toca hoy para un contrato aprobado cuyos seriales siguen pendientes?
//
// La decisión vive aquí, fuera del cron, porque es lo único del recordatorio que
// tiene riesgo real: contadores, fechas base y el corte entre "insistirle a
// bodega" y "escalar fuera de bodega". Con la decisión inline en el onSchedule
// solo se podía probar leyendo el fuente; aquí se prueba de verdad.
//
// El escalamiento nació del caso CONCORD ALQ20260810-01 (2026-09-17): el cron
// se callaba al cuarto recordatorio y el contrato pasó 38 días aprobado —y
// activo— sin seriales, sin que nadie fuera de bodega se enterara.

const MAX_RECORDATORIOS = 4;   // correos A BODEGA antes de escalar
const DEFAULT_DIAS      = 3;   // cadencia del recordatorio a bodega
const DEFAULT_DIAS_ESC  = 7;   // cadencia de la escalación

const DIA_MS = 86400000;

// Acepta Timestamp de Firestore, Date o string ISO. Devuelve null si no hay
// fecha usable — nunca lanza.
function toDate(v) {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v));
  return d && !isNaN(d.getTime()) ? d : null;
}

// La cadencia pura, sin saber si es un contrato o una gestión: cuántos avisos
// a bodega van, cuándo toca el siguiente y cuándo se escala. `base` es desde
// cuándo espera bodega.
function decideCadencia({ base, recAt, recCount, escAt, escCount } = {}, opts = {}) {
  const ahora    = toDate(opts.ahora) || new Date();
  const dias     = Number.isFinite(opts.dias)    && opts.dias    >= 1 ? opts.dias    : DEFAULT_DIAS;
  const diasEsc  = Number.isFinite(opts.diasEsc) && opts.diasEsc >= 1 ? opts.diasEsc : DEFAULT_DIAS_ESC;
  const max      = Number.isFinite(opts.max)     && opts.max     >= 0 ? opts.max     : MAX_RECORDATORIOS;

  const nada = (motivo) => ({ accion: "nada", intento: 0, diasAprobado: null, motivo });

  const desde        = toDate(base);
  const diasAprobado = desde ? Math.floor((ahora - desde) / DIA_MS) : null;
  const count        = Number(recCount || 0);

  // Todavía dentro del cupo de recordatorios a bodega.
  if (count < max) {
    const b = toDate(recAt) || desde;
    if (!b) return nada("sin fecha base para el recordatorio");
    if ((ahora - b) / DIA_MS < dias) return nada("aún no toca el recordatorio");
    return { accion: "recordatorio", intento: count + 1, diasAprobado, motivo: "cupo de bodega" };
  }

  // Pasado el cupo: escalar. La base es la última escalación o, la primera vez,
  // el último recordatorio — así la primera escalación no sale el mismo día del
  // cuarto recordatorio.
  const eb = toDate(escAt) || toDate(recAt) || desde;
  if (!eb) return nada("sin fecha base para la escalación");
  if ((ahora - eb) / DIA_MS < diasEsc) return nada("aún no toca la escalación");
  return { accion: "escalacion", intento: Number(escCount || 0) + 1, diasAprobado, motivo: "tope de recordatorios superado" };
}

// Estados en los que un contrato todavía necesita sus seriales. Un anulado o
// vencido con la marca `pendiente` colgada NO: DEMO20260814-01 (Tocumen) se
// anuló y siguió recibiendo la escalación semanal — cuyo propio texto dice
// "anula el contrato y deja de llegar" (2026-09-30).
const ESTADOS_VIVOS = ["aprobado", "activo"];

/**
 * @param {object} c              documento del contrato
 * @param {object} opts           { ahora, dias, diasEsc, max }
 * @returns {{accion:"nada"|"recordatorio"|"escalacion", intento:number, diasAprobado:number|null, motivo:string}}
 */
function decideAviso(c = {}, opts = {}) {
  const nada = (motivo) => ({ accion: "nada", intento: 0, diasAprobado: null, motivo });
  if (c.deleted) return nada("contrato borrado");
  // Sin estado se deja pasar: preferimos un correo de más a otro silencio.
  if (c.estado && !ESTADOS_VIVOS.includes(c.estado)) return nada(`contrato ${c.estado}`);
  return decideCadencia({
    base: c.fecha_aprobacion,
    recAt: c.seriales_recordatorio_at, recCount: c.seriales_recordatorio_count,
    escAt: c.seriales_escalado_at, escCount: c.seriales_escalado_count,
  }, opts);
}

// ── Gestiones esperando a bodega (2026-09-30, GR20260917-03 BALBOA) ─────────
// Un reemplazo/demo/aumento en `pendiente_bodega` recibía UN correo y después
// silencio: BALBOA llevaba 13 días aprobado sin serial y nadie más se enteró.
// Misma cadencia que los contratos; los contadores viven en `bodega_aviso`.

// Desde cuándo espera bodega: la entrada MÁS RECIENTE a la cola que el
// documento deja ver — aprobación, cliente que aceptó la reposición,
// decisión de un cambio de modelo, o la solicitud si nació en bodega.
function baseBodegaGestion(g = {}) {
  const fechas = [g.fecha_solicitud, g.aprobacion?.at, g.cobro?.aceptada_at,
    ...Object.values(g.cambio_modelo || {}).map(d => d?.decidido_at)]
    .map(toDate).filter(Boolean);
  return fechas.length ? new Date(Math.max(...fechas.map(d => d.getTime()))) : null;
}

function decideAvisoGestion(g = {}, opts = {}) {
  const nada = (motivo) => ({ accion: "nada", intento: 0, diasAprobado: null, motivo });
  if (g.deleted) return nada("gestión borrada");
  if (g.estado !== "pendiente_bodega") return nada(`gestión ${g.estado || "sin estado"}`);
  if (g.tipo === "baja") return nada("la baja no pasa por bodega");
  const a = g.bodega_aviso || {};
  return decideCadencia({
    base: baseBodegaGestion(g),
    recAt: a.recordatorio_at, recCount: a.recordatorio_count,
    escAt: a.escalado_at, escCount: a.escalado_count,
  }, opts);
}

// Lo que falta asignar en una gestión, por renglón, para el cuerpo del aviso.
// { total, asignados, faltan: [{ que, detalle }] }
function pendienteGestion(g = {}) {
  if (g.tipo === "reemplazo" || g.tipo === "cambio_serial") {
    const items = g.items || [];
    const faltan = items.filter(it => !String(it.serial_nuevo || "").trim())
      .map(it => ({ que: it.serial_saliente || it.serial || "—", detalle: it.modelo_solicitado || it.modelo || "—" }));
    return { total: items.length, asignados: items.length - faltan.length, faltan };
  }
  const bloque = g.tipo === "aumento" ? g.aumento : g.demo;
  const total = (bloque?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
  const asignados = (bloque?.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
  const faltan = asignados >= total ? [] : (bloque?.lineas || [])
    .filter(l => Number(l.cantidad || 0) > 0)
    .map(l => ({ que: `${Number(l.cantidad || 0)} × ${l.modelo || "—"}`, detalle: "" }));
  return { total, asignados, faltan };
}

// ── Qué se le pide a bodega en un contrato ──────────────────────────────────
// Una sola definición para la solicitud y para sus recordatorios: en una
// renovación con reemplazos declarados, a bodega le toca SOLO lo que entra por
// reemplazo — el recordatorio mostraba todas las líneas del contrato.
// `reemplazos` = planRenovacion.reemplazosPorModelo(c.transicion_plan).
function unidadesSerializables(c = {}) {
  const total = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
  return Math.max(0, total - Number(c.baja_cancelado_total || 0));
}

function pedidoSeriales(c = {}, reemplazos = []) {
  const soloReemplazos = reemplazos.length > 0 && !!c.renovacion_sin_equipo;
  const filas = soloReemplazos
    ? reemplazos.map(r => ({ modelo: r.modelo, cantidad: r.cantidad }))
    : (c.equipos || []).filter(e => Number(e.cantidad || 0) > 0).map(e => ({ modelo: e.modelo, cantidad: Number(e.cantidad || 0) }));
  // El avance solo se puede medir cuando las filas del contrato son todas de
  // lo pedido; con reemplazos, las que continúan ya están ahí desde antes.
  return { filas, soloReemplazos, total: soloReemplazos ? null : unidadesSerializables(c) };
}

module.exports = {
  decideAviso, decideCadencia, decideAvisoGestion, baseBodegaGestion, pendienteGestion,
  pedidoSeriales, unidadesSerializables, toDate,
  ESTADOS_VIVOS, MAX_RECORDATORIOS, DEFAULT_DIAS, DEFAULT_DIAS_ESC,
};
