// ¿Este contrato lleva firma del cliente? — espejo de
// public/js/domain/contratoFirma.js (si cambia uno, cambia el otro) y de
// contratoLlevaFirma() en firestore.rules. El porqué completo está en el
// archivo del front.
//
// En resumen: un REEMPLAZO sustituye una unidad por otra bajo el contrato que
// el cliente YA firmó, y un DEMO es un préstamo de evaluación. Ninguno pacta
// nada nuevo, así que no se firman — ni se les persigue la firma al vendedor,
// ni traban la entrega de los radios.

// Tipos de contrato que NO llevan firma del cliente, con el motivo pegado a la
// regla (el front lo pinta en pantalla).
//   REEMP — sustituye una unidad bajo el contrato que el cliente ya firmó.
//   DEMO  — préstamo de evaluación: 14 de 14 demos entregados nunca se firmaron
//           y la GESTIÓN demo ya no tenía paso de firma; el contrato sí la
//           exigía para entregar, y esa contradicción es la que se cierra.
const SIN_FIRMA = {
  REEMP: { nombre: "reemplazo", porQue: "un reemplazo no lleva firma: sustituye una unidad por otra bajo el contrato que el cliente ya firmó" },
  DEMO:  { nombre: "demo",      porQue: "un demo no lleva firma: es un préstamo de evaluación — la custodia la documentan la nota de entrega y el retorno" },
};

function codigoTipo(c) {
  const x = c || {};
  if (x.codigo_tipo) return x.codigo_tipo;
  const porNombre = { Servicio: "SERV", Alquiler: "ALQ", Propio: "PROP", Reemplazo: "REEMP", Demo: "DEMO", Temporal: "TEMP" };
  if (porNombre[x.tipo_contrato]) return porNombre[x.tipo_contrato];
  const m = String(x.contrato_id || "").match(/^[A-Z]+/);
  return m ? m[0] : null;
}

/** ¿Este contrato lleva la firma del cliente? */
function llevaFirma(c) { return !SIN_FIRMA[codigoTipo(c)]; }

/** ¿Está esperando esa firma AHORA? */
function esperandoFirma(c) { return llevaFirma(c) && c?.estado === "aprobado" && c.firmado !== true; }

// ENTREGADO CON LA FIRMA PENDIENTE (2026-11-11, pedido de Brenda): recepción
// entregó los radios dejando la firma digital de quien recibe y el contrato
// sigue sin firmar. La marca `entrega_sin_firma` la estampa onOrdenEntregada;
// el estado se DERIVA, así que se apaga solo cuando el contrato se firma. Sin
// la marca —lo entregado antes de esa fecha— no cuenta: es histórico.
function entregadoSinFirma(c) {
  return !!(c && c.entrega_sin_firma) && c.deleted !== true && llevaFirma(c)
    && c.estado === "aprobado" && c.firmado !== true;
}

// Cuándo fue esa entrega (Date o null).
function fechaEntregaSinFirma(c) {
  const aDate = (v) => !v ? null : (v.toDate ? v.toDate() : (typeof v.seconds === "number" ? new Date(v.seconds * 1000) : new Date(v)));
  const m = (c && c.entrega_sin_firma) || {};
  return [m.fecha_entrega, m.at, c && c.fecha_entrega_ultima].map(aDate).find(d => d && !isNaN(d)) || null;
}

// Días de CALENDARIO (Panamá, UTC-5) desde esa entrega: el cron corre a las
// 07:15 y "entregado ayer por la tarde" tiene que leerse como 1 día, no 0.
function diasEntregadoSinFirma(c, now = new Date()) {
  const f = fechaEntregaSinFirma(c);
  if (!f) return null;
  const dia = (d) => Math.floor((d.getTime() - 5 * 3600000) / 86400000);
  return Math.max(0, dia(now) - dia(f));
}

/** Cómo llamarlo en una frase ("tu demo fue aprobado"). */
function nombreContrato(c) { return SIN_FIRMA[codigoTipo(c)]?.nombre || "contrato"; }

/** Por qué no lleva firma, para escribirlo en el correo. */
function porQueSinFirma(c) { return SIN_FIRMA[codigoTipo(c)]?.porQue || ""; }

// FORMALIZACIÓN POR ORDEN DE COMPRA (2026-11-18, Alberto): clientes de
// gobierno y corporativos formalizan con su OC (refrendada, en gobierno) en vez
// de firmar nuestro contrato. La OC cumple el requisito por la misma vía que el
// firmado (firmado=true), así que el candado, la activación y la facturación no
// cambian; lo que cambia es el plazo para dormirse (90 días) y cómo se le
// habla al vendedor. El porqué completo está en el archivo del front.
const DIAS_DORMIDO_OC = 90;

/** ¿Se formaliza con orden de compra en vez de firma? */
function formalizaConOC(c) { return llevaFirma(c) && c?.formalizacion?.tipo === "orden_compra"; }

/** ¿OC de gobierno (lleva refrendo de la Contraloría)? */
function esOCGobierno(c) { return formalizaConOC(c) && c.formalizacion.sector === "gobierno"; }

/** Lo que se espera del cliente, para los correos ("espera la orden de compra"). */
function requisitoFormalizacion(c) {
  if (!formalizaConOC(c)) return "la firma del cliente";
  return esOCGobierno(c) ? "la orden de compra (refrendada)" : "la orden de compra";
}

module.exports = { SIN_FIRMA, codigoTipo, llevaFirma, esperandoFirma, nombreContrato, porQueSinFirma,
  entregadoSinFirma, fechaEntregaSinFirma, diasEntregadoSinFirma,
  DIAS_DORMIDO_OC, formalizaConOC, esOCGobierno, requisitoFormalizacion };
