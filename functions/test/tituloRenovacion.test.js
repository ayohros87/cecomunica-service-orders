// El documento de una RENOVACIÓN lo dice en la primera página (2026-11-11).
//
// Pedido de Brenda: los contratos del Centro salen todos con prefijo SERV,
// sean de cliente nuevo o renovación de equipos, y el documento decía
// "CONTRATO DE SERVICIO" en los dos. El 28-oct fiscalizó una renovación de
// Riba Smith La Siesta como contrato regular y terminó gestionando notas de
// crédito. La renovación lleva ahora su título — pero un documento ya
// FIRMADO conserva el título con el que el cliente lo firmó.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargar() {
  const ctx = { window: {}, Date, Number };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "documentoContrato.js"), ctx);
  return ctx.window.DocumentoContrato;
}
const D = cargar();
const ANTES = new Date(D.CORTE_TITULO_RENOVACION - 86400000);
const DESPUES = new Date(D.CORTE_TITULO_RENOVACION + 3600000);
const RENOV = { codigo_tipo: "SERV", accion: "Renovación", estado: "aprobado" };

test("un contrato nuevo conserva el título de siempre", () => {
  for (const accion of ["Nuevo", "Adición", "No Aplica", undefined]) {
    const t = D.titulo({ codigo_tipo: "SERV", accion, estado: "aprobado" });
    assert.equal(t.largo, "CONTRATO DE SERVICIO DE COMUNICACIÓN");
    assert.equal(t.corto, "CONTRATO DE SERVICIO");
    assert.equal(t.renovacion, false);
    assert.equal(t.conserva_anterior, false);
  }
});

test("una renovación SIN firmar lleva el título de renovación", () => {
  for (const estado of ["pendiente_aprobacion", "aprobado"]) {
    const t = D.titulo({ ...RENOV, estado });
    assert.equal(t.corto, "CONTRATO DE RENOVACIÓN");
    assert.equal(t.largo, "CONTRATO DE RENOVACIÓN DE SERVICIO DE COMUNICACIÓN");
    assert.equal(t.renovacion, true);
  }
});

test("firmada en PAPEL antes del corte: el papel firmado no cambia de título", () => {
  const t = D.titulo({ ...RENOV, firmado: true, firmado_fecha: ANTES });
  assert.equal(t.largo, "CONTRATO DE SERVICIO DE COMUNICACIÓN");
  assert.equal(t.conserva_anterior, true, "la pantalla tiene que avisar que es renovación");
});

test("firmada en papel DESPUÉS del corte: se imprimió con el título nuevo", () => {
  const t = D.titulo({ ...RENOV, estado: "activo", firmado: true, firmado_fecha: DESPUES });
  assert.equal(t.renovacion, true);
  assert.equal(t.conserva_anterior, false);
});

test("firma DIGITAL: manda el título congelado en la solicitud, no la fecha", () => {
  const digital = { ...RENOV, estado: "activo", firmado: true, firmado_tipo: "digital",
    firmado_digital: { solicitud_id: "s1" }, firmado_fecha: DESPUES };
  // Enlace anterior al cambio (sin título congelado): el cliente no firmó
  // bajo el título nuevo aunque haya firmado después del corte.
  assert.equal(D.titulo(digital, { clausulas_html: "…" }).conserva_anterior, true);
  assert.equal(D.titulo(digital, null).conserva_anterior, true);
  // Enlace nuevo: el título quedó congelado y se reconstruye igual.
  const t = D.titulo(digital, { titulo: D.TITULOS.renovacion.largo });
  assert.equal(t.renovacion, true);
  assert.equal(t.largo, D.TITULOS.renovacion.largo);
});

test("activo histórico sin `firmado` ni fecha: se trata como firmado antes", () => {
  assert.equal(D.titulo({ ...RENOV, estado: "activo" }).conserva_anterior, true);
});

test("el documento pinta el título desde DocumentoContrato y avisa fuera de la hoja", () => {
  const html = leer("public", "contratos", "documento.html");
  assert.match(html, /id="hTitulo"/);
  assert.match(html, /id="hTituloLargo"/);
  assert.match(html, /id="avisoRenovacion"/);
  // El aviso es de pantalla: la clase que lo esconde al imprimir.
  assert.match(html, /class="aviso-estado" id="avisoRenovacion"/);
  assert.match(html, /\.toolbar, \.aviso-estado \{ display:none !important; \}/);
  const js = leer("public", "js", "pages", "contrato-documento.js");
  assert.match(js, /DocumentoContrato\.titulo\(c, sFirma\?\.documento \|\| null\)/);
  assert.match(js, /if \(tit\.conserva_anterior\)/);
});

test("el enlace de firma congela el título y /firmar/ lo muestra", () => {
  assert.match(leer("public", "js", "pages", "centro-firma.js"), /titulo: DocumentoContrato\.titulo\(c\)\.largo/);
  const firmar = leer("public", "firmar", "index.html");
  assert.match(firmar, /d\.titulo \? `<h3[^`]*\$\{this\.esc\(d\.titulo\)\}/);
  assert.match(firmar, /Contrato de renovación/);
});

test("lista y Centro: la renovación va en chip, no en texto plano; el prefijo no se toca", () => {
  const lista = leer("public", "js", "pages", "contratos-list.js");
  assert.match(lista, /accionHtml\(data\) \{/);
  assert.equal((lista.match(/ContratosLista\.accionHtml\(data\)/g) || []).length, 2, "fila y tarjeta");
  const ficha = leer("public", "js", "pages", "centro-ficha-bloques.js");
  assert.equal((ficha.match(/this\._renovChipHtml\(c\)/g) || []).length, 2, "fila del contrato y título del detalle");
});
