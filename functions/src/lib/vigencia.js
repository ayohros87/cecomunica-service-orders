// Vigencias de contrato — Ola 1 del plan de gestiones por cliente
// (docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md, §4.5.3).
//
// Hasta hoy `duracion` era texto impreso en el PDF y NADIE escribía
// `fecha_vencimiento` (admin-integridad chk5 lo chequeaba en vano). Estas
// funciones son la única aritmética de vigencia del sistema: las usan el
// trigger de activación (onApproval), el backfill (scripts/backfill-
// vencimiento.js) y la sección H del cron recordatorioOperativo.
//
// Decisiones de negocio (Alberto, 2026-08-26):
//   · aviso a 60 días del vencimiento; nada se bloquea, es solo señal
//   · cada tramo renueva a su propia fecha; en períodos de 18+ meses la
//     renovación anticipada se habilita hasta 3 meses antes
// Funciones puras: nada de Firestore aquí.

const AVISO_DIAS = 60;              // ventana de la señal "por vencer"

// La señal de vencimiento/renovación aplica a contratos de servicio continuo
// (deep-dive 2026-08-26): un DEMO o un TEMP terminan y sus equipos se
// recuperan por su propio flujo — "renovar un demo" no hace sentido. El REEMP
// SÍ vence: con su duración propia si la tiene, y si no, HEREDA la vigencia
// del contrato de origen (decisión de Alberto 2026-08-26) — por eso el linaje
// del REEMP importa doble.
const CODIGOS_CON_VENCIMIENTO = ["SERV", "ALQ", "PROP", "REEMP"];

// Código de tipo tolerante al histórico (docs viejos sin codigo_tipo).
function codigoTipo(contrato) {
  const c = contrato || {};
  if (c.codigo_tipo) return c.codigo_tipo;
  const porNombre = { "Servicio": "SERV", "Alquiler": "ALQ", "Propio": "PROP", "Reemplazo": "REEMP", "Demo": "DEMO", "Temporal": "TEMP" };
  if (porNombre[c.tipo_contrato]) return porNombre[c.tipo_contrato];
  const m = String(c.contrato_id || "").match(/^[A-Z]+/);
  return m ? m[0] : null;
}

function aplicaVencimiento(contrato) {
  return CODIGOS_CON_VENCIMIENTO.includes(codigoTipo(contrato));
}
const ANTICIPADA_MESES = 3;         // renovación anticipada (solo 18+ meses)
const ANTICIPADA_MINIMO_MESES = 18; // período mínimo para renovar anticipado

// "12 meses" → 12 · "2 años" → 24 · "24" → 24 · "indefinido"/"" → null.
// El select de nuevo-contrato ofrece "12 meses" / "18 meses" / otra (número),
// pero el histórico trae texto libre — por eso el parseo es tolerante.
function parseDuracionMeses(duracion) {
  const s = String(duracion == null ? "" : duracion).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/(\d+)\s*mes/);
  if (m) return Number(m[1]) || null;
  m = s.match(/(\d+)\s*a(?:ñ|n)o/);
  if (m) return (Number(m[1]) || 0) * 12 || null;
  if (/^\d+$/.test(s)) return Number(s) || null;
  return null;
}

function _aDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Mejor fecha de inicio del tramo inicial de un contrato existente, en orden
// de fidelidad al negocio: inicio de facturación → última entrega → aprobación
// → creación. Devuelve { fecha: Date|null, fuente: string|null }.
function mejorFechaInicio(contrato) {
  const c = contrato || {};
  const candidatos = [
    ["facturacion_fecha_inicio", c.facturacion_fecha_inicio],
    ["fecha_entrega_ultima", c.fecha_entrega_ultima],
    ["fecha_aprobacion", c.fecha_aprobacion],
    ["fecha_creacion", c.fecha_creacion],
  ];
  for (const [fuente, v] of candidatos) {
    const fecha = _aDate(v);
    if (fecha) return { fecha, fuente };
  }
  return { fecha: null, fuente: null };
}

// fechaInicio + meses. Date.setMonth maneja el desborde (31 ene + 1 mes → 3 mar
// es aceptable para una señal a 60 días; no es aritmética de facturación).
function calcularVencimiento(fechaInicio, meses) {
  const base = _aDate(fechaInicio);
  if (!base || !Number.isFinite(meses) || meses <= 0) return null;
  const d = new Date(base.getTime());
  d.setMonth(d.getMonth() + meses);
  return d;
}

// 'vencido' | 'por_vencer' (≤ avisoDias) | 'vigente'.
function estadoVencimiento(fechaVencimiento, now, avisoDias = AVISO_DIAS) {
  const fv = _aDate(fechaVencimiento);
  if (!fv) return null;
  const ref = _aDate(now) || new Date();
  const dias = (fv - ref) / 86400000;
  if (dias < 0) return "vencido";
  if (dias <= avisoDias) return "por_vencer";
  return "vigente";
}

// ¿Se puede ofrecer "Renovar" ya? Siempre dentro de la ventana de aviso;
// además, anticipada (3 meses) para tramos de 18+ meses.
function renovacionDisponible(fechaVencimiento, duracionMeses, now) {
  const fv = _aDate(fechaVencimiento);
  if (!fv) return false;
  const ref = _aDate(now) || new Date();
  const dias = (fv - ref) / 86400000;
  if (dias <= AVISO_DIAS) return true;
  if (Number(duracionMeses) >= ANTICIPADA_MINIMO_MESES) {
    return dias <= ANTICIPADA_MESES * 30.44;
  }
  return false;
}

module.exports = {
  AVISO_DIAS,
  ANTICIPADA_MESES,
  ANTICIPADA_MINIMO_MESES,
  CODIGOS_CON_VENCIMIENTO,
  codigoTipo,
  aplicaVencimiento,
  parseDuracionMeses,
  mejorFechaInicio,
  calcularVencimiento,
  estadoVencimiento,
  renovacionDisponible,
};
