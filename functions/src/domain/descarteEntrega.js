// Equipos DESCARTADOS en el control de calidad — lado servidor.
//
// Espejo de public/js/domain/descarteEntrega.js (allí está el porqué
// completo). Aquí solo vive lo que necesita el trigger del pool al entregar:
// QUÉ seriales de la orden se quedan en Cecomunica en vez de salir al cliente.
//
// Fuente: la última pasada de QC (`orden.qc.por_equipo`). Un descarte sin
// `destino` (anterior al 2026-10-08) se lee como 'cecomunica', el caso normal.
//
// Consumidor: triggers/ordenes/onOrdenWritePool.js.

const normSerial = (s) => String(s == null ? "" : s).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Descartes de la última pasada de QC, por serial normalizado.
 * @param {object|null} orden
 * @returns {Map<string, {destino:'cecomunica'|'cliente', causa:string, nota:string, serial:string}>}
 */
function descartesPorSerial(orden) {
  const out = new Map();
  const pe = orden && orden.qc && orden.qc.por_equipo;
  if (!pe || typeof pe !== "object") return out;
  for (const d of Object.values(pe)) {
    if (!d || d.resultado !== "descartado") continue;
    const s = normSerial(d.serial);
    if (!s) continue;
    out.set(s, {
      destino: d.destino === "cliente" ? "cliente" : "cecomunica",
      causa: d.causa === "dano_cliente" || d.causa === "garantia" ? d.causa : "",
      nota: String(d.nota || ""),
      serial: String(d.serial || ""),
    });
  }
  return out;
}

/** Seriales (normalizados) que se quedan en Cecomunica al entregar la orden. */
function serialesQueSeQuedan(orden) {
  const out = new Set();
  for (const [s, d] of descartesPorSerial(orden)) if (d.destino === "cecomunica") out.add(s);
  return out;
}

/**
 * Seriales (normalizados) descartados en la revisión de una ENTRADA. Esos
 * radios no aterrizan en bodega al cerrar: se quedan en cuarentena hasta que
 * bodega los dé de baja.
 */
function serialesDescartadosEnRevision(orden) {
  const out = new Set();
  for (const e of (Array.isArray(orden && orden.equipos) ? orden.equipos : [])) {
    if (!e || e.eliminado || e.descartado_revision !== true) continue;
    const s = normSerial(e.numero_de_serie || e.serial || e.SERIAL);
    if (s) out.add(s);
  }
  return out;
}

const CAUSAS = { garantia: "garantía", dano_cliente: "daño del cliente" };

module.exports = { normSerial, descartesPorSerial, serialesQueSeQuedan, serialesDescartadosEnRevision, CAUSAS };
