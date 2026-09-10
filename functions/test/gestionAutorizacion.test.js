// Cómo quedó AUTORIZADA una gestión — el texto sale del expediente, nunca del
// camino que tomó el código (2026-09-10, caso GA20260909-03: al vendedor le
// llegó "El cliente firmó el anexo GA20260909-03" por una gestión que se
// aplicó SIN firma).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const A = require("../src/domain/gestionAutorizacion");

test("gestionAutorizacion.js es idéntico en functions/src/domain y public/js/domain", () => {
  const back = fs.readFileSync(path.join(__dirname, "..", "src", "domain", "gestionAutorizacion.js"), "utf8");
  const front = fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "domain", "gestionAutorizacion.js"), "utf8");
  assert.equal(front, back, "public/js/domain/gestionAutorizacion.js difiere de functions/src/domain/gestionAutorizacion.js — copia una sobre la otra");
});

// El caso real: GA20260909-03, aplicada con "Aplicar sin firma" por Alberto.
const GA20260909_03 = {
  sin_firma: {
    motivo: "regularizacion sin firma, para actualizar la cuenta",
    por_email: "alberto.yohros@cecomunica.com",
  },
  aprobacion: { aprobado_por_email: "alberto.yohros@cecomunica.com" },
};

test("sin firma: NUNCA dice que el cliente firmó, y nombra a quien autorizó", () => {
  const r = A.texto(GA20260909_03);
  assert.equal(r.firmado, false);
  assert.match(r.corto, /SIN firma del cliente/);
  assert.match(r.corto, /alberto\.yohros@cecomunica\.com/);
  assert.match(r.html, /sin firma del cliente/);
  assert.match(r.html, /no se le envió nada a firmar/);
  assert.doesNotMatch(r.html, /El cliente lo <b>firmó/);
  assert.match(r.html, /Motivo: regularizacion sin firma/);
});

test("firma digital: firmante y cédula, y firmado = true", () => {
  const r = A.texto({ anexo_firma_digital: { firmante_nombre: "Fortunato Mangravita", firmante_cedula: "8-123-456" } });
  assert.equal(r.firmado, true);
  assert.match(r.corto, /Firmado digitalmente por el cliente \(Fortunato Mangravita\)/);
  assert.match(r.html, /firmó digitalmente/);
  assert.match(r.html, /cédula 8-123-456/);
});

test("firmado en papel: dice quién lo registró, no quién firmó", () => {
  const r = A.texto({ anexo_firmado_path: "anexos/x.pdf", anexo_firmado_por: "elvia.onodera@cecomunica.com" });
  assert.equal(r.firmado, true);
  assert.equal(r.corto, "Firmado por el cliente en papel");
  assert.match(r.html, /lo registró elvia\.onodera@cecomunica\.com/);
});

test("la firma digital manda sobre el resto del rastro", () => {
  // Una gestión que quedó con `sin_firma` de un intento previo y DESPUÉS se
  // firmó: gana la firma, que es la prueba más fuerte.
  const r = A.texto({ ...GA20260909_03, anexo_firma_digital: { firmante_nombre: "Ana Ruiz" } });
  assert.equal(r.firmado, true);
  assert.match(r.corto, /Firmado digitalmente/);
});

test("sin rastro de nada: aplicado, y tampoco inventa una firma", () => {
  const r = A.texto({ aprobacion: { aprobado_por_email: "gerencia@cecomunica.com" } });
  assert.equal(r.firmado, false);
  assert.match(r.html, /sin firma del cliente/);
  assert.match(r.html, /gerencia@cecomunica\.com/);
  const vacio = A.texto({});
  assert.equal(vacio.firmado, false);
  assert.doesNotMatch(vacio.html, /firmó/);
});

test("gestión nula o indefinida no revienta", () => {
  for (const g of [null, undefined]) {
    const r = A.texto(g);
    assert.equal(r.firmado, false);
    assert.equal(typeof r.corto, "string");
  }
});

test("el HTML escapa lo que viene del dato (nombre con comillas / etiquetas)", () => {
  const r = A.texto({ anexo_firma_digital: { firmante_nombre: '<script>x</script>"' } });
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /&quot;/);
});

test("pasoFirma: el checklist rotula con la verdad, no con la plantilla", () => {
  assert.equal(A.pasoFirma(GA20260909_03, false), "Aplicado sin firma del cliente");
  assert.equal(A.pasoFirma({ anexo_firma_digital: { firmante_nombre: "X" } }, false), "Anexo firmado por el cliente");
  // Paso todavía pendiente: no se afirma nada en ningún sentido.
  assert.equal(A.pasoFirma(GA20260909_03, true), "Firma del cliente");
});
