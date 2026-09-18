// @ts-nocheck
// Documento de identidad del representante legal — lógica PURA.
//
// El problema (Zuleika, 2026-09-18): un cliente nuevo cuyo representante legal
// se identifica con PASAPORTE ("Pasaporte No. 150685537"). La casilla solo
// aceptaba el formato de cédula panameña (8-712-1043 / PE-12-345), así que el
// formulario no dejaba guardar la ficha. El extranjero no residente no tiene
// cédula: el pasaporte ES su documento.
//
// LA REGLA DEL CONTRATO: el pasaporte se declara ESCRIBIENDO LA PALABRA
// ("PASAPORTE 150685537"); sin palabra, el documento es cédula, como siempre.
//
// Por qué no se adivina: se revisaron los 452 clientes de producción. De los
// 10 valores sin guiones, 5 ya traían la palabra escrita a mano (la gente ya
// resolvía así, y el contrato les imprimía "cédula PASAPORTE: XDB367055") y 4
// son ambiguos — `8928240`, `107230214`: a ojo son cédulas sin guiones, pero
// una regla "sin guiones = pasaporte" las declararía pasaporte en un contrato
// firmado. Adivinar mal ahí es peor que el candado que esto vino a quitar.
// Sin palabra, entonces, se imprime lo mismo que se imprimía antes.
(function () {
  "use strict";

  // La palabra que la gente escribe delante del número. La de pasaporte se
  // CONSERVA (es la declaración); la de cédula se quita (es el caso normal y
  // el campo queda limpio).
  const RE_PASAPORTE = /^(?:pasaporte|pasap?|passport)\.?\s*(?:n[o°º]?\.?|#|n[uú]m(?:ero)?\.?|:)?\s*/i;
  const RE_CEDULA = /^(?:c[eé]d(?:ula)?|c\.?\s*i)\.?\s*(?:n[o°º]?\.?|#|n[uú]m(?:ero)?\.?|:)?\s*/i;

  // El identificador en sí. Laxo a propósito: acepta 8-712-1043, PE-12-345,
  // E-13077112, XDB367055, 150685537 — y rechaza lo que NO es un documento
  // (un nombre, un guion suelto, un dígito solo). Al menos un número, sin
  // espacios adentro, de 4 a 20 caracteres.
  const RE_NUMERO = /^(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,19}$/i;

  const _base = (valor) => String(valor == null ? "" : valor).trim().replace(/\s+/g, " ").toUpperCase();

  // ¿Se declaró pasaporte? Solo si la palabra está escrita.
  function esPasaporte(valor) {
    return RE_PASAPORTE.test(_base(valor));
  }

  // El identificador, sin la palabra: es lo que se compara contra el documento
  // que declara quien firma (functions/src/lib/firmas.js hace lo mismo).
  function numero(valor) {
    return _base(valor).replace(RE_PASAPORTE, "").replace(RE_CEDULA, "").trim();
  }

  // Valor guardable: el pasaporte conserva su palabra en forma canónica
  // ("PASAPORTE: XDB367055" y "pasaporte no. XDB367055" quedan iguales); la
  // cédula queda pelada.
  function limpiar(valor) {
    const n = numero(valor);
    if (!n) return "";
    return esPasaporte(valor) ? `PASAPORTE ${n}` : n;
  }

  function tipo(valor) {
    if (!numero(valor)) return "";
    return esPasaporte(valor) ? "pasaporte" : "cedula";
  }

  // Un vacío no es error: lo obligatorio se decide en cada formulario.
  function esValido(valor) {
    const n = numero(valor);
    return !n || RE_NUMERO.test(n);
  }

  // La palabra con la que el documento se nombra en el contrato.
  function etiqueta(valor) {
    return esPasaporte(valor) ? "pasaporte" : "cédula";
  }

  // "cédula 8-712-1043" / "pasaporte 150685537". Sin valor, la línea del
  // contrato conserva su espacio en blanco para llenar a mano.
  function frase(valor, vacio) {
    const n = numero(valor);
    if (!n) return `cédula ${vacio == null ? "________________" : vacio}`;
    return `${etiqueta(valor)} ${n}`;
  }

  const API = { RE_NUMERO, esPasaporte, numero, limpiar, tipo, esValido, etiqueta, frase };

  if (typeof window !== "undefined") window.DocIdentidad = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
