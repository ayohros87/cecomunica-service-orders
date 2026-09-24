// @ts-nocheck
// ¿El firmante es el representante registrado? — lógica PURA, espejo de
// functions/src/lib/firmas.js (firmanteCoincide y sus normalizadores).
//
// Por qué existe en el navegador (2026-09-24, pedido de Alberto): cuando
// firma alguien distinto al representante, /firmar/ le EXIGE el documento que
// lo autoriza (poder, Registro Público, acta). La página tiene que saber, antes
// de enviar, si el trigger lo va a mandar a validación — con la misma regla,
// o el cliente sube un poder que nadie pidió o se salta uno que sí hacía falta.
//
// Espejo obligatorio: functions/test/firmanteSync.test.js compara las dos
// implementaciones. Si tocas una, toca la otra.
(function () {
  "use strict";

  const RE_PREFIJO_DOC = /^(?:C[EÉ]D(?:ULA)?|C\.?\s*I|PASAPORTE|PASAP?|PASSPORT)\.?\s*(?:N[O°º]?\.?|#|N[UÚ]M(?:ERO)?\.?|:)?\s*/;

  function normCedula(s) {
    return String(s || "").toUpperCase().trim()
      .replace(RE_PREFIJO_DOC, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  function normNombre(s) {
    return String(s || "").toUpperCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  }

  // La cédula manda (si ambas existen); sin cédulas comparables, el nombre.
  function coincide(representante, firma) {
    const cedR = normCedula(representante?.cedula);
    const cedF = normCedula(firma?.cedula);
    if (cedR && cedF) return cedR === cedF;
    const nR = normNombre(representante?.nombre);
    const nF = normNombre(firma?.nombre);
    return !!nR && !!nF && nR === nF;
  }

  // Qué documento prueba que el firmante puede obligar a la empresa.
  const TIPOS_AUTORIZACION = [
    { value: "poder",            label: "Poder" },
    { value: "registro_publico", label: "Certificado del Registro Público" },
    { value: "acta",             label: "Acta de junta directiva" },
    { value: "otro",             label: "Otro documento" },
  ];
  function labelAutorizacion(tipo) {
    const t = TIPOS_AUTORIZACION.find((x) => x.value === tipo);
    return t ? t.label : "Documento de autorización";
  }

  window.Firmante = { normCedula, normNombre, coincide, TIPOS_AUTORIZACION, labelAutorizacion };
})();
