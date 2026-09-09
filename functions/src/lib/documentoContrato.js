// ¿Qué "papel" es el contrato? (2026-09-04, reclamo de Alberto: "al aprobar
// desde el Centro sale el trigger con el contrato VIEJO a activaciones").
//
// Desde el 2026-08-31 el documento real es el v2 (contratos/documento.html:
// secciones numeradas, Anexo A por serial, firma digital). El correo a
// activaciones seguía adjuntando el PDF del formato anterior
// (templates/imprimir-contrato.html — texto de alquiler, sin Anexo A) y
// enlazando a imprimir-contrato.html: Recepción recibía un contrato que ya
// no es el que el cliente firma.
//
// CORTE (2026-09-09, "el corte es ya"): la regla dejó de ser opt-in. Antes
// era v2 solo el que traía la estampa `documento_version: 'v2'` — y el
// formulario clásico (nuevo-contrato.html) nunca la mandaba, así que todo
// alquiler nuevo creado ahí volvía a salir con el formato anterior. Ahora
// **todo contrato nacido a partir del corte es v2**, lo haya creado quien lo
// haya creado; lo de antes conserva su papel porque es el que el cliente
// tiene firmado. Sin backfill: los históricos no se tocan.
//
// Regla, en orden: `documento_version: 'v1'` es la salida explícita (para
// re-imprimir tal cual un contrato viejo); la estampa 'v2' y el SERVICIO
// (SERV — el maestro de cuenta del Centro) y la firma digital son v2 sin
// importar la fecha; y de resto manda la fecha de creación contra el corte.
// Función pura (test/documentoContrato.test.js).
"use strict";

// 2026-09-09 00:00 hora de Panamá (UTC-5). Fecha FIJA a propósito: si fuera
// relativa ("hace 30 días") un contrato cambiaría de papel con el tiempo.
const CORTE_V2 = Date.parse("2026-09-09T00:00:00-05:00");

// fecha_creacion llega como Timestamp del Admin SDK, pero los scripts y los
// tests pasan Date o millis — se aceptan los tres.
function millisDe(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

function esDocumentoV2(c) {
  if (!c) return false;
  if (c.documento_version === "v1") return false;
  if (c.documento_version === "v2") return true;
  if (c.codigo_tipo === "SERV" || c.tipo_contrato === "Servicio") return true;
  if (c.firma_solicitud_id || c.firmado_tipo === "digital") return true;
  return millisDe(c.fecha_creacion) >= CORTE_V2;
}

module.exports = { esDocumentoV2, CORTE_V2 };
