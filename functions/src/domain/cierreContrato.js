/**
 * cierreContrato — cuándo un contrato se CIERRA de verdad y con qué escritura.
 *
 * Fuente única de la decisión y del payload. La usan:
 *   · triggers/ordenes/onOrdenWritePool.js  — la ENTRADA devolvió el equipo
 *   · triggers/clientes/onClienteDesactivado.js — el cliente dejó de ser cliente
 *   · scripts/cierra-contratos-clientes-inactivos.js — el backfill de los viejos
 *   · (espejo front: public/js/domain/contratoCierre.js, para el Centro)
 *
 * Por qué existe (Alberto, 2026-09-14, caso FANLYC / TEMP20260902-01): un
 * contrato TEMPORAL cuyo equipo ya volvió NO tenía forma de cerrarse. El menú
 * del Centro solo termina contratos "renovables" (SERV/ALQ/PROP/REEMP —
 * lib/vigencia.js), y a los TEMP/DEMO se los dejaba fuera con el comentario
 * "terminan por su propio flujo"… un flujo que nunca se escribió. Quedaban
 * vigentes para siempre, pidiendo en el home una cancelación que ninguna
 * pantalla sabía hacer. Esto ES ese flujo.
 *
 * CERRAR ≠ ANULAR. Anular (domain de contratoAnulacion) deshace el papel y
 * puede abrir una DEVOLUCIÓN para recuperar equipos; cerrar reconoce que el
 * acuerdo llegó a su fin con el equipo ya en casa — no mueve un solo radio.
 * Terminal 'vencido', el mismo de la terminación total (onOrdenWriteGestion).
 */
const { codigoTipo } = require("../lib/vigencia");

const VIGENTES = new Set(["activo", "aprobado"]);

// Contratos que NO tienen vencimiento propio: mueren cuando el equipo vuelve
// (complemento exacto de CODIGOS_CON_VENCIMIENTO en lib/vigencia.js).
const TERMINAN_POR_DEVOLUCION = ["TEMP", "DEMO"];

function esVigente(contrato) {
  return VIGENTES.has(String(contrato?.estado || "").toLowerCase());
}

function terminaPorDevolucion(contrato) {
  return TERMINAN_POR_DEVOLUCION.includes(codigoTipo(contrato));
}

/**
 * ¿Qué hacer con el contrato tras cerrar una ENTRADA que le devolvió equipo?
 *
 * Solo se cierra solo lo que termina por devolución (TEMP/DEMO) y que ya no
 * tiene NI UNA unidad en campo. Un ALQ al que le devolvieron 3 de 50 radios
 * sigue vivo; uno al que se los devolvieron todos puede ser una terminación o
 * una renovación en curso — eso lo decide un humano, y para eso está la marca.
 *
 * @param {Object} p
 * @param {Object} p.contrato          doc del contrato
 * @param {number|null} p.unidadesEnCampo  unidades del contrato todavía con el
 *   cliente; null si no se pudo contar (en la duda NO se cierra: un cierre
 *   equivocado corta la facturación).
 * @returns {{cerrar:boolean, marcar:boolean, motivo:string}}
 */
function decidirCierreTrasEntrada({ contrato, unidadesEnCampo }) {
  if (!esVigente(contrato)) return { cerrar: false, marcar: false, motivo: "no_vigente" };
  if (!terminaPorDevolucion(contrato)) return { cerrar: false, marcar: true, motivo: "tipo_con_vigencia" };
  if (unidadesEnCampo === null || unidadesEnCampo === undefined) {
    return { cerrar: false, marcar: true, motivo: "conteo_desconocido" };
  }
  if (unidadesEnCampo > 0) return { cerrar: false, marcar: true, motivo: "quedan_en_campo" };
  return { cerrar: true, marcar: false, motivo: "devuelto_completo" };
}

/**
 * Payload del cierre. `FieldValue` se recibe para que esto siga siendo puro
 * (y probable sin emulador): el llamador pasa admin.firestore.FieldValue.
 *
 * @param {Object} contrato  doc actual (para guardar de qué estado venía)
 * @param {Object} p  { motivo, por_uid, FieldValue }
 */
function buildCierre(contrato, { motivo, por_uid = null, FieldValue }) {
  return {
    estado: "vencido",
    estado_previo: contrato?.estado || null,
    vencido_at: FieldValue.serverTimestamp(),
    vencido_motivo: String(motivo || "").trim(),
    vencido_por_uid: por_uid || null,
    fecha_fin: FieldValue.serverTimestamp(),
    // La pregunta del home ya tiene respuesta: la marca se retira para que la
    // bandeja no la siga pidiendo (el estado la sacaría igual, pero dejarla
    // ahí haría creer que quedó algo sin hacer).
    cancelacion_pendiente: FieldValue.delete(),
    fecha_modificacion: new Date(),
  };
}

module.exports = {
  VIGENTES,
  TERMINAN_POR_DEVOLUCION,
  esVigente,
  terminaPorDevolucion,
  decidirCierreTrasEntrada,
  buildCierre,
};
