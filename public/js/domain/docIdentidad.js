// @ts-nocheck
// Documento de identidad del representante legal — lógica PURA.
//
// El problema (Zuleika, 2026-09-18): un cliente nuevo cuyo representante legal
// se identifica con PASAPORTE ("Pasaporte No. 150685537"). La casilla solo
// aceptaba el formato de cédula panameña (8-712-1043 / PE-12-345), así que el
// formulario no dejaba guardar la ficha. El extranjero no residente no tiene
// cédula: el pasaporte ES su documento.
//
// QUÉ DOCUMENTO ES, LO DICE EL VENDEDOR — no lo adivina el sistema. El
// formulario pregunta con un selector y guarda `representante_doc_tipo`
// ('cedula' | 'pasaporte'); el contrato imprime esa palabra.
//
// Las dos versiones que se descartaron antes de llegar aquí, y por qué
// (se barrieron los 452 clientes de producción para decidirlo):
//   · Por la FORMA del número ("sin guiones = pasaporte"): 4 valores de
//     producción son ambiguos —`8928240`, `107230214`—, a ojo cédulas escritas
//     sin guiones. Declararlas pasaporte en un contrato firmado es una
//     declaración falsa.
//   · Por la PALABRA escrita en la casilla (5 fichas ya traían
//     "PASAPORTE: XDB367055"): sigue siendo adivinar, y depende de que alguien
//     se acuerde de escribirla.
// Lo que queda de esas dos: la palabra escrita se sigue ENTENDIENDO, para que
// las fichas viejas se impriman bien sin migración y para que pegar
// "Pasaporte No. X" en la casilla mueva el selector en vez de ensuciar el
// número. Pero la fuente de verdad es lo que el vendedor contestó.
(function () {
  "use strict";

  // La palabra que la gente escribe delante del número, en las fichas viejas
  // y al copiar y pegar.
  const RE_PASAPORTE = /^(?:pasaporte|pasap?|passport)\.?\s*(?:n[o°º]?\.?|#|n[uú]m(?:ero)?\.?|:)?\s*/i;
  const RE_CEDULA = /^(?:c[eé]d(?:ula)?|c\.?\s*i)\.?\s*(?:n[o°º]?\.?|#|n[uú]m(?:ero)?\.?|:)?\s*/i;

  // El identificador en sí. Laxo a propósito: acepta 8-712-1043, PE-12-345,
  // E-13077112, XDB367055, 150685537 — y rechaza lo que NO es un documento
  // (un nombre, un guion suelto, un dígito solo). Al menos un número, sin
  // espacios adentro, de 4 a 20 caracteres.
  const RE_NUMERO = /^(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,19}$/i;

  const TIPOS = ["cedula", "pasaporte"];

  const _base = (valor) => String(valor == null ? "" : valor).trim().replace(/\s+/g, " ").toUpperCase();

  // ¿El texto trae la palabra "pasaporte" delante? Solo sirve para las fichas
  // viejas y para el copiar-y-pegar; el tipo lo manda el selector.
  function traePalabraPasaporte(valor) {
    return RE_PASAPORTE.test(_base(valor));
  }

  // El identificador, sin la palabra: es lo que se guarda y lo que se compara
  // contra el documento que declara quien firma (functions/src/lib/firmas.js).
  function limpiar(valor) {
    return _base(valor).replace(RE_PASAPORTE, "").replace(RE_CEDULA, "").trim();
  }

  // Un vacío no es error: lo obligatorio se decide en cada formulario.
  function esValido(valor) {
    const n = limpiar(valor);
    return !n || RE_NUMERO.test(n);
  }

  // El tipo que vale: el guardado; y si la ficha es vieja y no lo tiene, la
  // palabra que alguien escribió en la casilla; si tampoco, cédula — que es lo
  // que el contrato imprimía antes de todo esto.
  function tipo(valor, tipoGuardado) {
    if (TIPOS.includes(tipoGuardado)) return tipoGuardado;
    return traePalabraPasaporte(valor) ? "pasaporte" : "cedula";
  }

  // La palabra con la que el documento se nombra en el contrato.
  function etiqueta(valor, tipoGuardado) {
    return tipo(valor, tipoGuardado) === "pasaporte" ? "pasaporte" : "cédula";
  }

  // "cédula 8-712-1043" / "pasaporte 150685537". Sin valor, la línea del
  // contrato conserva su espacio en blanco para llenar a mano.
  function frase(valor, tipoGuardado) {
    const n = limpiar(valor);
    if (!n) return "cédula ________________";
    return `${etiqueta(valor, tipoGuardado)} ${n}`;
  }

  const API = { TIPOS, RE_NUMERO, traePalabraPasaporte, limpiar, esValido, tipo, etiqueta, frase };

  if (typeof window !== "undefined") window.DocIdentidad = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
