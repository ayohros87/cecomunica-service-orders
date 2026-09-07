// Adenda a contrato en papel — helpers puros de lib/adendaPapel.
// Corre con: node --test (desde functions/).
const test = require("node:test");
const assert = require("node:assert/strict");
const AP = require("../src/lib/adendaPapel");

test("esAdendaPapel: solo cuando contrato_papel=true y NO hay contrato interno", () => {
  assert.equal(AP.esAdendaPapel({ contrato_papel: true, contrato_doc_id: null, contrato_id: "ALQ 2019-044" }), true);
  assert.equal(AP.esAdendaPapel({ contrato_papel: true, contrato_doc_id: "", contrato_id: "X" }), true);
  // Un aumento normal (contrato del sistema) nunca es adenda de papel, aunque
  // alguien deje el flag por error: el contrato interno manda.
  assert.equal(AP.esAdendaPapel({ contrato_papel: true, contrato_doc_id: "abc123" }), false);
  assert.equal(AP.esAdendaPapel({ contrato_doc_id: null }), false);
  assert.equal(AP.esAdendaPapel(null), false);
});

test("normalizarRefPapel: recorta, colapsa espacios, quita comillas y sube a mayúsculas", () => {
  assert.equal(AP.normalizarRefPapel("  alq  2019-044 "), "ALQ 2019-044");
  assert.equal(AP.normalizarRefPapel('"Contrato 1234"'), "CONTRATO 1234");
  assert.equal(AP.normalizarRefPapel(""), "");
  assert.equal(AP.normalizarRefPapel(null), "");
});

test("vigenciaAdenda: el tramo corre desde la entrega y deja el rastro del papel", () => {
  const inicio = new Date(2026, 8, 7); // 7 sep 2026
  const v = AP.vigenciaAdenda({ inicio, meses: 18, gid: "GA20260907-01", contratoRef: "ALQ 2019-044", ordenId: "2026090701" });
  assert.equal(v.duracion_meses, 18);
  assert.equal(v.fecha_inicio.getTime(), inicio.getTime());
  assert.equal(v.fecha_vencimiento.getFullYear(), 2028);
  assert.equal(v.fecha_vencimiento.getMonth(), 2); // marzo 2028
  assert.equal(v.fecha_vencimiento.getDate(), 7);
  assert.equal(v.fuente_inicio, "entrega_adenda_papel");
  assert.equal(v.enmienda_id, "GA20260907-01");
  assert.equal(v.contrato_papel_ref, "ALQ 2019-044");
  assert.equal(v.orden_id, "2026090701");
  // El inicio que se pasa no se muta.
  assert.equal(inicio.getFullYear(), 2026);
});

test("vigenciaAdenda: sin meses válidos no hay tramo que estampar", () => {
  assert.equal(AP.vigenciaAdenda({ inicio: new Date(), meses: 0 }), null);
  assert.equal(AP.vigenciaAdenda({ inicio: new Date(), meses: "x" }), null);
});
