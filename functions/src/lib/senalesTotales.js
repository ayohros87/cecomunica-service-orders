// Totales de señales del home que el navegador NO debería recontar bajando
// colecciones enteras (limpieza del home 2026-10-21).
//
// "Cuentas por regularizar" (REGG) bajaba 252 fichas de cliente completas en
// cada carga del inicio de admin/gerencia, y "Comisiones listas" (COM) 61
// avisos, para pintar un número que nadie abre (6 clics en señales en 4 días
// entre 15 personas; ninguno en estas dos). El servidor ya sabe cuándo cambian:
//   · REGG cambia cuando los barridos de regularización escriben
//     `clientes.regularizacion` (regularizacionDiaria / regularizacionMarcadas).
//   · COM cambia cuando cambia `comision` de un aviso (onFacturacionAvisoWrite).
// Aquí se recalculan con el MISMO predicado que la lista del cliente
// (senalesService.listCuentasPorRegularizar / listComisionesListas) y se
// escriben en `empresa/senales_totales`; el home lee ese documento (1 lectura)
// y solo si falta o está rancio vuelve al recuento viejo.
//
// Doc: { regg: n, regg_at, com: n, com_at, updated_at }

const { admin, db } = require("./admin");
const { estaPospuesto } = require("../domain/pendientes");

const DOC = () => db.collection("empresa").doc("senales_totales");

/** Cuentas con deuda de regularización que cuentan en el home: puntos > 0,
 *  vivas, no "solo bodega" (cola de inventario, no del vendedor) y no
 *  pospuestas. Espejo de listCuentasPorRegularizar (sin uid). */
function cuentaParaRegularizar(c, now = new Date()) {
  const r = c && c.regularizacion;
  if (!c || c.deleted || c.activo === false || !r || !(Number(r.puntos) > 0)) return false;
  if (r.solo_bodega) return false;
  if (estaPospuesto(c, now)) return false;
  return true;
}

/** Comisión "lista para confirmar el primer pago": aplica, sin período ni
 *  liberación, con vendedor, y lo ÚNICO que falta entre los requisitos que
 *  aplican es `pago`. Espejo de listComisionesListas. */
function comisionLista(a) {
  const com = (a && a.comision) || {};
  if (!a || com.aplica !== true) return false;
  if (com.liberada_at || com.periodo || !com.vendedor_email) return false;
  const req = Object.entries(com.requisitos || {}).filter(([, x]) => x && x.aplica);
  const faltan = req.filter(([, x]) => !x.hecho);
  return faltan.length > 0 && faltan.every(([k]) => k === "pago");
}

async function totalCuentasPorRegularizar(now = new Date()) {
  const snap = await db.collection("clientes").where("regularizacion.puntos", ">", 0).get();
  let n = 0;
  snap.forEach((d) => { if (cuentaParaRegularizar(d.data() || {}, now)) n++; });
  return n;
}

async function totalComisionesListas() {
  const snap = await db.collection("facturacion_avisos").where("comision.aplica", "==", true).get();
  let n = 0;
  snap.forEach((d) => { if (comisionLista(d.data() || {})) n++; });
  return n;
}

async function escribirRegg() {
  const regg = await totalCuentasPorRegularizar();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  await DOC().set({ regg, regg_at: ts, updated_at: ts }, { merge: true });
  return regg;
}

async function escribirCom() {
  const com = await totalComisionesListas();
  const ts = admin.firestore.FieldValue.serverTimestamp();
  await DOC().set({ com, com_at: ts, updated_at: ts }, { merge: true });
  return com;
}

module.exports = { cuentaParaRegularizar, comisionLista, totalCuentasPorRegularizar, totalComisionesListas, escribirRegg, escribirCom };
