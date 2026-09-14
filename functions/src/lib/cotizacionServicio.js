// Cotización de taller → facturación (2026-09-14, pedido de Solangel).
//
// EL HUECO QUE CIERRA
//   Desde que el taller cotiza una reparación desde la oficina, la cotización
//   sale al cliente y ahí muere: nada en el sistema sabe si esa reparación se
//   facturó. Solangel lleva la lista a mano —"cuáles ya se facturaron y cuáles
//   están pendientes"— y Brenda, que es quien emite la factura, ni siquiera
//   recibía la cotización.
//
// QUÉ HACE ESTE MÓDULO
//   Traduce una cotización de taller (origen='orden') a la forma que entiende
//   la bandeja `facturacion_avisos`, que es donde Brenda ya trabaja todos los
//   días. No decide cuándo: eso lo dispara la ENTREGA de la orden
//   (triggers/ordenes/onOrdenEntregada) — decisión de Alberto 2026-09-14,
//   porque antes de entregar no hay nada que facturar.
//
// Los renglones se guardan APLANADOS en el aviso a propósito: la bandeja no
// tiene que abrir la cotización para mostrar qué se cobra, y si la cotización
// cambiara (no puede: es inmutable fuera de borrador) el aviso sigue diciendo
// lo que se cotizó el día de la entrega.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;

// Estados en los que una cotización de taller SÍ representa un cobro. Un
// borrador nunca salió; rechazada/vencida son un "no" del cliente. 'convertida'
// entra porque es el desenlace ganado.
const ESTADOS_FACTURABLES = ["enviada", "aprobada", "convertida"];

function esFacturable(cot = {}) {
  if (!cot || cot.deleted === true) return false;
  if ((cot.origen || "") !== "orden" && !cot.orden_id) return false;
  return ESTADOS_FACTURABLES.includes(String(cot.estado || ""));
}

/**
 * Renglones aplanados de la cotización, en el orden en que los escribió el
 * taller. `parte` es el número de parte (el campo `modelo` del renglón, que en
 * una cotización de servicio NO es el modelo del radio sino el de la pieza) y
 * `serial` el radio al que se le hizo el trabajo.
 */
function renglones(cot = {}) {
  return (Array.isArray(cot.items) ? cot.items : [])
    .filter((it) => it && num(it.cant) > 0)
    .map((it) => ({
      cant: num(it.cant),
      nombre: String(it.nombre || "—").trim(),
      parte: String(it.modelo || "").trim() || null,
      serial: String(it.equipo?.serial || "").trim() || null,
      precio: r2(num(it.precio)),
      importe: r2(num(it.cant) * num(it.precio) * (1 - num(it.desc) / 100)),
    }));
}

/**
 * Resumen para la fila de la bandeja. `total` es lo que se le cobra al cliente
 * (con ITBMS si aplica), que es el número con el que Brenda contrasta la
 * factura — no un mensual: una reparación se cobra UNA vez.
 */
function resumenCotizacion(cot = {}) {
  const rs = renglones(cot);
  const seriales = [...new Set(rs.map((r) => r.serial).filter(Boolean))];
  const equipos = [...new Set(
    (Array.isArray(cot.items) ? cot.items : [])
      .map((it) => String(it?.equipo?.modelo || "").trim())
      .filter(Boolean)
  )];
  const exento = cot.itbms_aplica === false || cot.cliente_itbms_exento === true;
  return {
    // `equipos` es el texto que la bandeja pinta junto al título de la fila.
    equipos: seriales.length
      ? `${seriales.length} equipo(s)${equipos.length ? ` · ${equipos.join(", ")}` : ""}`
      : (equipos.join(", ") || null),
    seriales,
    renglones_n: rs.length,
    subtotal: r2(num(cot.subtotal)),
    itbms: r2(num(cot.itbms_monto)),
    exento,
    // Único y total: los dos nombres que la bandeja ya sabe leer. `mensual`
    // queda en null a propósito — una reparación no es un alquiler, y dejarlo
    // en 0 haría que la fila dijera "$0.00/mes".
    total: r2(num(cot.total_con_itbms ?? cot.total)),
    unico: r2(num(cot.total_con_itbms ?? cot.total)),
    mensual: null,
    delta_mensual: null,
  };
}

module.exports = { ESTADOS_FACTURABLES, esFacturable, renglones, resumenCotizacion };
