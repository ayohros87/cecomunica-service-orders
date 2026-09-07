/**
 * dedupeDevolucion — ¿la orden de DEVOLUCIÓN que se va a crear ya existe?
 *
 * Lógica pura (sin Firestore) que usa lib/ordenDevolucion.js antes de crear
 * un tiquete. Mata el duplicado sin importar el orden de los eventos: da
 * igual si recepción abrió el tiquete a mano antes de que se confirmara la
 * entrega (caso Gamboa, REEMP20260814-01) o si dos disparadores reclamaron
 * lo mismo (baja + renovación; gestión + contrato).
 *
 * Señales de "es la misma devolución", cualquiera basta:
 *   · SERIAL: la orden existente ya lista alguno de los seriales nuevos.
 *   · ORIGEN: mismo disparador (`devolucion.origen.tipo` + `ref_id`) — el
 *     trigger corrió dos veces.
 * El contrato solo, sin serial en común, NO es señal: un contrato puede
 * tener una baja parcial y luego una renovación, y son tiquetes distintos.
 *
 * Decisión:
 *   · alimentar — hay una orden ABIERTA que coincide: se le agregan los
 *     seriales que le falten (patrón crearOAlimentarEntrada).
 *   · omitir    — todo lo que se iba a reclamar ya está cubierto: en una
 *     orden abierta (ya listado) o resuelto físicamente en una cerrada
 *     (recibido / nunca salió). Se devuelve la orden que lo cubre.
 *   · crear     — no hay coincidencia, o la coincidencia cerrada solo cubre
 *     una parte: se crea con lo que falte.
 *
 * Solo se miran tiquetes del mismo cliente, no eliminados, de los últimos
 * `ventanaDias` (30 por defecto): una devolución del año pasado con el mismo
 * serial es otra vuelta del mismo radio, no un duplicado.
 */
const { normSerial } = require("./equiposPool");

const ESTADO_CERRADA = "CERRADA (DEVOLUCION)";
const RESUELTA_FISICA = new Set(["recibido", "nunca_salio"]);

const _ms = (v) => {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v._seconds === "number") return v._seconds * 1000;
  return 0;
};

/**
 * @param {Object} p
 * @param {Array<{serial:string}>} p.unidades   lo que se quiere reclamar (por serial)
 * @param {{tipo?:string, ref_id?:string}} [p.origen]  disparador del tiquete nuevo
 * @param {Array<Object>} p.existentes  órdenes DEVOLUCION del cliente, con `id`
 * @param {number} [p.ahora]  Date.now() (inyectable para tests)
 * @param {number} [p.ventanaDias]
 * @returns {{accion:'crear'|'alimentar'|'omitir', ordenId:string|null,
 *            unidades:Array, motivo:string}}
 *   `unidades` = las que quedan por reclamar (para 'crear' y 'alimentar').
 */
function decidirDedupe({ unidades, origen, existentes, ahora = Date.now(), ventanaDias = 30 }) {
  const nuevas = (unidades || []).filter((u) => u && normSerial(u.serial));
  if (!nuevas.length) return { accion: "crear", ordenId: null, unidades: unidades || [], motivo: "sin_seriales" };

  const desde = ahora - ventanaDias * 86400000;
  const recientes = (existentes || []).filter((o) => o
    && o.tipo_de_servicio === "DEVOLUCION"
    && o.eliminado !== true
    && _ms(o.fecha_creacion) >= desde);

  const normsNuevas = new Set(nuevas.map((u) => normSerial(u.serial)));
  const refNueva = origen && origen.ref_id ? `${origen.tipo || ""}:${origen.ref_id}` : null;

  // Seriales ya resueltos físicamente en CUALQUIER tiquete reciente del
  // cliente: el radio ya volvió, no se persigue dos veces.
  const yaVolvieron = new Set();
  const coincidencias = [];
  for (const o of recientes) {
    const dev = o.devolucion || {};
    const esperados = Array.isArray(dev.esperados) ? dev.esperados : [];
    const listados = new Set(esperados.map((e) => normSerial(e && e.serial)).filter(Boolean));
    esperados.forEach((e) => {
      if (e && RESUELTA_FISICA.has(e.resolucion) && normSerial(e.serial)) yaVolvieron.add(normSerial(e.serial));
    });
    const solape = [...normsNuevas].filter((n) => listados.has(n));
    const refO = dev.origen && dev.origen.ref_id ? `${dev.origen.tipo || ""}:${dev.origen.ref_id}` : null;
    const mismoOrigen = !!refNueva && refO === refNueva;
    if (solape.length || mismoOrigen) {
      coincidencias.push({
        orden: o, listados,
        abierta: String(o.estado_reparacion || "").toUpperCase() !== ESTADO_CERRADA,
        solape: solape.length, mismoOrigen,
      });
    }
  }

  const pendientes = nuevas.filter((u) => !yaVolvieron.has(normSerial(u.serial)));

  // Abierta que coincide: se alimenta. Si hay varias, la de más solape.
  const abiertas = coincidencias.filter((c) => c.abierta)
    .sort((a, b) => (b.solape - a.solape) || (_ms(b.orden.fecha_creacion) - _ms(a.orden.fecha_creacion)));
  if (abiertas.length) {
    const c = abiertas[0];
    const faltan = pendientes.filter((u) => !c.listados.has(normSerial(u.serial)));
    if (!faltan.length) {
      return { accion: "omitir", ordenId: c.orden.id, unidades: [], motivo: "cubierta_por_abierta" };
    }
    return { accion: "alimentar", ordenId: c.orden.id, unidades: faltan, motivo: c.solape ? "serial_en_abierta" : "mismo_origen_abierta" };
  }

  // Nada abierto coincide. Lo que ya volvió no se reclama; si no queda nada,
  // la cerrada que lo cubrió es la respuesta.
  if (!pendientes.length) {
    const cerrada = coincidencias[0] ? coincidencias[0].orden.id : null;
    return { accion: "omitir", ordenId: cerrada, unidades: [], motivo: "ya_devueltas" };
  }
  return {
    accion: "crear", ordenId: null, unidades: pendientes,
    motivo: pendientes.length < nuevas.length ? "parcialmente_devueltas" : "sin_coincidencia",
  };
}

module.exports = { decidirDedupe, ESTADO_CERRADA };
