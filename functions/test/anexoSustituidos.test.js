// Radios ya sustituidos en el Anexo A (public/js/domain/anexoSustituidos.js).
//
// El caso (Zuleika, 2026-09-30): SERV20260918-01 imprimió 9 radios, los 2
// reemplazados junto a sus entrantes. El documento vivo anota cada saliente y
// bloquea la impresión solo cuando el dato es imposible: el reemplazo ya se
// entregó y el radio había quedado en casa.
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const A = require("../../public/js/domain/anexoSustituidos.js");

const g = (extra = {}, item = {}) => ({
  id: "GR20260918-01", tipo: "reemplazo", estado: "cerrada",
  cierre: { entrega: true },
  items: [{ serial_saliente: "22806A0291", serial_nuevo: "24220A2196", saliente_en_casa: true, ...item }],
  ...extra,
});

test("entregado con el saliente en casa → incoherente (bloquea)", () => {
  const m = A.clasificar([g()]);
  assert.equal(m.get("22806A0291").estado, "incoherente");
  assert.match(A.nota(m.get("22806A0291")), /Sustituido por 24220A2196 \(GR20260918-01\).*no debe figurar/);
});

test("entregado con el saliente en el cliente → pendiente de devolución (no bloquea)", () => {
  const m = A.clasificar([g({}, { saliente_en_casa: false })]);
  assert.equal(m.get("22806A0291").estado, "por_devolver");
  assert.match(A.nota(m.get("22806A0291")), /pendiente de devolución/);
});

test("reemplazo en curso → solo se anota", () => {
  const m = A.clasificar([g({ estado: "en_proceso", cierre: { asignacion: true } })]);
  assert.equal(m.get("22806A0291").estado, "en_curso");
});

test("anuladas, borradas y otros tipos no cuentan; el serial se normaliza", () => {
  assert.equal(A.clasificar([g({ estado: "anulada" })]).size, 0);
  assert.equal(A.clasificar([g({ deleted: true })]).size, 0);
  assert.equal(A.clasificar([g({ tipo: "demo" })]).size, 0);
  assert.ok(A.clasificar([g({}, { serial_saliente: " 22806a0291 " })]).has(A.norm("22806A0291")));
});

test("el documento lo usa: lee los reemplazos, anota la fila y bloquea también Ctrl+P", () => {
  const pag = leer("public", "js", "pages", "contrato-documento.js");
  assert.match(pag, /where\('contratos_afectados', 'array-contains', docId\)/);
  assert.match(pag, /AnexoSustituidos\.clasificar/);
  assert.match(pag, /anexoFrozen \? \[\] : unidades\.filter\(\(u\) => infoSust\(u\)\?\.estado === 'incoherente'\)/,
    "solo el Anexo vivo se bloquea; el congelado de la firma es lo que el cliente vio");
  assert.match(pag, /classList\.add\('no-imprimir'\)/);
  const html = leer("public", "contratos", "documento.html");
  assert.match(html, /body\.no-imprimir \.wrap \{ display:none !important; \}/);
  assert.match(leer("public", "js", "entry", "contratos-documento.js"), /domain\/anexoSustituidos\.js/);
});
