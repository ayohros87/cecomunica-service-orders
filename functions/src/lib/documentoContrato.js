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
// Regla: es v2 todo contrato de SERVICIO (SERV — el maestro de cuenta del
// Centro, que mezcla modalidades), todo contrato que el Centro estampó con
// `documento_version: 'v2'`, y todo contrato con firma digital (solo el v2
// se firma en /firmar/). Lo demás (ALQ/PROP/REEMP históricos y los creados
// por el formulario clásico) sigue imprimiendo el formato anterior — son los
// firmados en papel. Función pura (test/documentoContrato.test.js).
"use strict";

function esDocumentoV2(c) {
  if (!c) return false;
  if (c.documento_version === "v2") return true;
  if (c.codigo_tipo === "SERV" || c.tipo_contrato === "Servicio") return true;
  if (c.firma_solicitud_id || c.firmado_tipo === "digital") return true;
  return false;
}

module.exports = { esDocumentoV2 };
