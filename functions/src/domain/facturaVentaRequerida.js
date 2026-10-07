// ¿Esta asignación de serial es una VENTA que exige factura antes de entregar?
// (Alberto, 2026-10-07: "actívalo para SERV, no bloquees la entrega de lo que
// ya se hizo antes de este candado").
//
// El candado de factura de venta nació para los contratos "Propio" (PROP),
// donde todo radio se vende. Desde el 3-sep-2026 las ventas con servicio van en
// contratos SERV con línea "propio" — pero una línea propio NO siempre es
// venta: también jala radios que el cliente ya tenía (comprados antes, o que
// trajo él). La venta es el radio que SALE DE NUESTRA BODEGA hacia una línea
// propio: estaba `en_bodega`, no era del cliente, y la línea lo vuelve suyo.
//
// Solo contratos creados desde el CORTE: lo anterior no se bloquea.
// PROP no pasa por aquí — su candado es por tipo y sigue igual.
// Función pura (test/facturaVentaRequerida.test.js); la usa onSerialWrite,
// que estampa `factura_venta_requerida` en el contrato. Las reglas de
// ordenes_de_servicio leen esa marca.

const CORTE = new Date("2026-10-07T17:00:00Z");

const esContratoPropio = (c) => !!c && (c.tipo_contrato === "Propio" || c.codigo_tipo === "PROP");

function fechaDe(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d;
}

function requiereFacturaVenta({ contrato, propiedadLinea, unidad, corte = CORTE } = {}) {
  if (!contrato || esContratoPropio(contrato)) return false;
  if (propiedadLinea !== "cliente") return false;
  const creado = fechaDe(contrato.fecha_creacion);
  if (!creado || creado < corte) return false;
  if (!unidad || unidad.estado !== "en_bodega") return false;
  // Radio que trajo el cliente (Almacén · Equipos del cliente): ya es suyo.
  if (unidad.propietario?.cliente_id) return false;
  if (unidad.propiedad === "cliente") return false;
  return true;
}

module.exports = { CORTE, esContratoPropio, requiereFacturaVenta };
