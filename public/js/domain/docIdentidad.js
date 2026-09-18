// @ts-nocheck
// Documento de identidad del representante legal — lógica PURA.
//
// El problema (Zuleika, 2026-09-18): un cliente nuevo cuyo representante legal
// se identifica con PASAPORTE ("Pasaporte No. 150685537"). La casilla solo
// aceptaba el formato de cédula panameña (8-712-1043 / PE-12-345), así que el
// formulario no dejaba guardar la ficha. El extranjero no residente no tiene
// cédula: el pasaporte ES su documento.
//
// Dos decisiones de diseño:
//   1. Se guarda SOLO EL NÚMERO, sin la palabra "pasaporte". La palabra se
//      deriva al imprimir. Así el número sigue siendo comparable: al firmar,
//      firmanteCoincide() coteja el documento declarado contra el registrado
//      (functions/src/lib/firmas.js) y un prefijo escrito a mano lo rompería.
//      Si alguien igual escribe "Pasaporte No. X", `limpiar` le quita el
//      prefijo en vez de rechazarlo.
//   2. La palabra se deriva por los GUIONES, no por una lista de formatos: la
//      cédula panameña siempre los lleva (8-712-1043, PE-12-345, E-8-91234,
//      8-NT-1-234) y ningún pasaporte los lleva. Una lista de formatos deja
//      afuera la variante rara y la imprime como "pasaporte", que en un
//      contrato es una declaración falsa.
(function () {
  "use strict";

  // "Pasaporte No.", "Céd.", "CI:", "pas #"… lo que la gente escribe delante
  // del número cuando quiere aclarar de qué documento habla.
  const RE_PREFIJO = /^(?:c[eé]d(?:ula)?|c\.?\s*i|pasaporte|pasap?|passport)\.?\s*(?:n[o°º]?\.?|#|n[uú]m(?:ero)?\.?|:)?\s*/i;

  // Cédula: tres o cuatro bloques alfanuméricos separados por guiones
  // (8-712-1043, PE-12-345, E-8-91234, 8-NT-1-234).
  const RE_CEDULA = /^[A-Z0-9]{1,4}(?:-[A-Z0-9]{1,6}){2,3}$/i;
  // Pasaporte: alfanumérico corrido, 5 a 20 caracteres, sin separadores.
  const RE_PASAPORTE = /^[A-Z0-9]{5,20}$/i;

  // Valor guardable: sin prefijo, sin espacios sobrantes, en mayúsculas
  // (la "PE" de la cédula y las letras del pasaporte se escriben así).
  function limpiar(valor) {
    return String(valor == null ? "" : valor)
      .trim().replace(/\s+/g, " ")
      .replace(RE_PREFIJO, "")
      .trim().toUpperCase();
  }

  function tipo(valor) {
    const v = limpiar(valor);
    if (!v) return "";
    if (RE_CEDULA.test(v)) return "cedula";
    if (RE_PASAPORTE.test(v)) return "pasaporte";
    return "";
  }

  // Un vacío no es error: lo obligatorio se decide en cada formulario.
  function esValido(valor) {
    const v = limpiar(valor);
    return !v || RE_CEDULA.test(v) || RE_PASAPORTE.test(v);
  }

  // La palabra con la que el documento se nombra en el contrato.
  function etiqueta(valor) {
    return tipo(valor) === "pasaporte" ? "pasaporte" : "cédula";
  }

  // "cédula 8-712-1043" / "pasaporte 150685537". Sin valor, la línea del
  // contrato conserva su espacio en blanco para llenar a mano.
  function frase(valor, vacio) {
    const v = limpiar(valor);
    if (!v) return `cédula ${vacio == null ? "________________" : vacio}`;
    return `${etiqueta(v)} ${v}`;
  }

  const API = { RE_CEDULA, RE_PASAPORTE, limpiar, tipo, esValido, etiqueta, frase };

  if (typeof window !== "undefined") window.DocIdentidad = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
