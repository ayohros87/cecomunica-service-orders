/**
 * correccionRecibido — recepción corrige el SERIAL o el MODELO de una unidad
 * que ya marcó "recibido" en el check-in de una DEVOLUCIÓN, antes de que el
 * cliente firme el acuse.
 *
 * Pedido de Brenda (2026-10-27, FORTALEZA 2026102601): el serial tecleado no
 * lo reconoció el sistema, el radio quedó registrado sin modelo, y la
 * devolución no dejaba tocar ni el serial ni el modelo — la ENTRADA sí, pero
 * el acuse que firma el cliente sale de la devolución, y tiene que decir el
 * serial del radio que de verdad entregó.
 *
 * Aquí viven las partes PURAS (sin Firestore) que usa onOrdenDevolucionWrite:
 *   · detectarCorrecciones: qué filas cambiaron de identidad en esta escritura.
 *   · fichaNacidaAqui: si la ficha del serial viejo la creó ESTA devolución
 *     (o su ENTRADA) — entonces es una ficha fantasma de un serial mal
 *     digitado y se renombra o se da de baja; una ficha con historia previa
 *     es otro radio y solo se le deshace el movimiento.
 *   · estadoPrevioADevolucion: a qué estado vuelve una ficha real que se
 *     movió por error (el de_estado del movimiento de esta devolución).
 */
const { normSerial } = require("./equiposPool");

/**
 * Filas recibidas cuyo serial o modelo cambió en ESTA escritura. Solo
 * unidades que YA estaban recibidas antes (la tanda nueva la cubre el loop de
 * resoluciones) y que no tienen acuse firmado ni antes ni después (candado:
 * el acuse es el papel del cliente). Las sustituciones del plan
 * (`serial_original`, ver sustitucionSaliente) tienen su propio camino y se
 * excluyen cuando el serial original cambió en la misma escritura.
 * @param {Map<string,Object>} antes esperados previos por id
 * @param {Array<Object>} esperados esperados después
 */
function detectarCorrecciones(antes, esperados) {
  const out = [];
  for (const e of (esperados || [])) {
    if (!e || e.resolucion !== "recibido" || e.acuse_id) continue;
    const b = antes ? antes.get(e.id) : null;
    if (!b || b.resolucion !== "recibido" || b.acuse_id) continue;
    if ((e.serial_original || "") !== (b.serial_original || "")) continue; // sustitución, no corrección
    const serial_norm = normSerial(e.serial);
    const antes_norm = normSerial(b.serial);
    if (!serial_norm) continue;
    const cambioSerial = serial_norm !== antes_norm;
    const modelo = String(e.modelo || "").trim();
    const modeloAntes = String(b.modelo || "").trim();
    const cambioModelo = modelo !== modeloAntes || (e.modelo_id || null) !== (b.modelo_id || null);
    if (!cambioSerial && !cambioModelo) continue;
    out.push({
      id: e.id,
      serial: String(e.serial).trim(), serial_norm,
      serial_antes: String(b.serial || "").trim(), antes_norm,
      modelo, modelo_id: e.modelo_id || null,
      modelo_antes: modeloAntes, modelo_id_antes: b.modelo_id || null,
      pool_doc_id: e.pool_doc_id || null,
      cambioSerial, cambioModelo,
    });
  }
  return out;
}

/**
 * ¿La ficha nació por esta devolución (o por la ENTRADA que abrió)? Sí cuando
 * TODO su kardex apunta a esas órdenes y arranca con un alta ("migracion").
 * Una ficha sin kardex no se puede juzgar: se trata como preexistente.
 * @param {Array<{tipo?:string, ref?:{id?:string}|null}>} movimientos
 * @param {Array<string>} ordenIds ids de la devolución y su ENTRADA
 */
function fichaNacidaAqui(movimientos, ordenIds) {
  const ids = new Set((ordenIds || []).filter(Boolean));
  const movs = Array.isArray(movimientos) ? movimientos : [];
  if (!movs.length || !ids.size) return false;
  return movs.every(m => m && m.ref && ids.has(m.ref.id))
    && movs.some(m => m && m.tipo === "migracion");
}

/**
 * Estado del que salió una ficha real al recibirse en esta devolución: el
 * `de_estado` del movimiento tipo "devolucion" con ref a la orden (el más
 * reciente si hubo varios). null si no hay rastro.
 */
function estadoPrevioADevolucion(movimientos, ordenId) {
  let mejor = null;
  for (const m of (Array.isArray(movimientos) ? movimientos : [])) {
    if (!m || m.tipo !== "devolucion" || !m.de_estado) continue;
    if (!m.ref || m.ref.id !== ordenId) continue;
    const t = m.at && typeof m.at.toMillis === "function" ? m.at.toMillis()
      : (typeof m.at === "number" ? m.at : 0);
    if (!mejor || t >= mejor.t) mejor = { t, de: m.de_estado };
  }
  return mejor ? mejor.de : null;
}

module.exports = { detectarCorrecciones, fichaNacidaAqui, estadoPrevioADevolucion };
