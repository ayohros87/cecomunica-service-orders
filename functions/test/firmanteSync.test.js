// Guardia de sincronía: ¿el firmante coincide con el representante?
//
// La regla existe DUPLICADA a propósito (sin build step compartido):
//   · functions/src/lib/firmas.js     (onFirmaContrato: activa o manda a validar)
//   · public/js/domain/firmante.js    (/firmar/: exige el documento de autorización)
// Si se separan, /firmar/ le pide un poder a quien el trigger activa solo, o
// deja pasar sin poder a quien el trigger manda a validación.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const backend = require("../src/lib/firmas");

function cargarFrontend() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "public", "js", "domain", "firmante.js"), "utf8");
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "firmante.js" });
  return sandbox.window.Firmante;
}

const CASOS = [
  [{ nombre: "Ana Pérez", cedula: "8-712-1043" }, { nombre: "ANA PEREZ", cedula: "8-712-1043" }],
  [{ nombre: "Ana Pérez", cedula: "8-712-1043" }, { nombre: "Ana Pérez", cedula: "8-712-1044" }],
  [{ nombre: "Ana Pérez", cedula: "8-712-1043" }, { nombre: "Otro Nombre", cedula: "871 21043" }],
  [{ nombre: "José Núñez", cedula: "" }, { nombre: "jose nunez", cedula: "E-8-1234" }],
  [{ nombre: "José Núñez", cedula: "" }, { nombre: "José Núñez Jr", cedula: "" }],
  [{ nombre: "", cedula: "" }, { nombre: "Sharon Engel Osorio", cedula: "8-1-1" }],
  [{ nombre: "X", cedula: "Pasaporte No. 150685537" }, { nombre: "Y", cedula: "150685537" }],
  [{ nombre: "X", cedula: "CÉD. 8-1-1" }, { nombre: "Y", cedula: "8-1-1" }],
  [undefined, { nombre: "Ana", cedula: "1" }],
  [{ nombre: "Ana" }, undefined],
];

test("firmante: frontend y backend dan el mismo veredicto", () => {
  const F = cargarFrontend();
  for (const [rep, firma] of CASOS) {
    assert.equal(F.coincide(rep, firma), backend.firmanteCoincide(rep, firma),
      `divergen con ${JSON.stringify(rep)} vs ${JSON.stringify(firma)}`);
  }
});

test("firmante: normalizadores idénticos", () => {
  const F = cargarFrontend();
  for (const s of ["Pasaporte No. 150685537", "CÉD. 8-712-1043", "PE-12-345", "", null, "Ñandú Ávila-Soto", "  josé   núñez "]) {
    assert.equal(F.normCedula(s), backend.normCedula(s), `normCedula(${s})`);
    assert.equal(F.normNombre(s), backend.normNombre(s), `normNombre(${s})`);
  }
});

test("firmante: sin representante registrado nunca coincide", () => {
  const F = cargarFrontend();
  assert.equal(F.coincide({ nombre: "", cedula: "" }, { nombre: "Sharon", cedula: "8-1-1" }), false);
});
