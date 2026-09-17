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

/**
 * @param {object} c              documento del contrato
 * @param {object} opts           { ahora, dias, diasEsc, max }
 * @returns {{accion:"nada"|"recordatorio"|"escalacion", intento:number, diasAprobado:number|null, motivo:string}}
 */
function decideAviso(c = {}, opts = {}) {
  const ahora    = toDate(opts.ahora) || new Date();
  const dias     = Number.isFinite(opts.dias)    && opts.dias    >= 1 ? opts.dias    : DEFAULT_DIAS;
  const diasEsc  = Number.isFinite(opts.diasEsc) && opts.diasEsc >= 1 ? opts.diasEsc : DEFAULT_DIAS_ESC;
  const max      = Number.isFinite(opts.max)     && opts.max     >= 0 ? opts.max     : MAX_RECORDATORIOS;

  const nada = (motivo) => ({ accion: "nada", intento: 0, diasAprobado: null, motivo });

  if (c.deleted) return nada("contrato borrado");

  const aprobado     = toDate(c.fecha_aprobacion);
  const diasAprobado = aprobado ? Math.floor((ahora - aprobado) / DIA_MS) : null;
  const count        = Number(c.seriales_recordatorio_count || 0);

  // Todavía dentro del cupo de recordatorios a bodega.
  if (count < max) {
    const base = toDate(c.seriales_recordatorio_at) || aprobado;
    if (!base) return nada("sin fecha base para el recordatorio");
    if ((ahora - base) / DIA_MS < dias) return nada("aún no toca el recordatorio");
    return { accion: "recordatorio", intento: count + 1, diasAprobado, motivo: "cupo de bodega" };
  }

  // Pasado el cupo: escalar. La base es la última escalación o, la primera vez,
  // el último recordatorio — así la primera escalación no sale el mismo día del
  // cuarto recordatorio.
  const escCount = Number(c.seriales_escalado_count || 0);
  const escBase  = toDate(c.seriales_escalado_at) || toDate(c.seriales_recordatorio_at) || aprobado;
  if (!escBase) return nada("sin fecha base para la escalación");
  if ((ahora - escBase) / DIA_MS < diasEsc) return nada("aún no toca la escalación");
  return { accion: "escalacion", intento: escCount + 1, diasAprobado, motivo: "tope de recordatorios superado" };
}

module.exports = { decideAviso, toDate, MAX_RECORDATORIOS, DEFAULT_DIAS, DEFAULT_DIAS_ESC };
