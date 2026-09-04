// esDocumentoV2 (lib/documentoContrato.js): qué contratos usan el documento
// nuevo — el correo a activaciones no debe adjuntar el PDF del formato
// anterior a un contrato v2 (2026-09-04, caso Chino Panameño).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { esDocumentoV2 } = require("../src/lib/documentoContrato");

test("SERV (maestro de cuenta del Centro) es v2 aunque no traiga la marca", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "SERV" }), true);
  assert.equal(esDocumentoV2({ tipo_contrato: "Servicio" }), true);
});

test("la marca explícita y la firma digital también son v2", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", documento_version: "v2" }), true);
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", firma_solicitud_id: "abc" }), true);
  assert.equal(esDocumentoV2({ codigo_tipo: "PROP", firmado_tipo: "digital" }), true);
});

test("ALQ/PROP/REEMP históricos sin marca siguen en el formato anterior", () => {
  assert.equal(esDocumentoV2({ codigo_tipo: "ALQ", tipo_contrato: "Alquiler" }), false);
  assert.equal(esDocumentoV2({ tipo_contrato: "Reemplazo" }), false);
  assert.equal(esDocumentoV2(null), false);
});
