// Firma digital de contratos (2026-08-28) — lógica PURA del firmante.
//
// El problema real: quien firma (representante legal) muchas veces NO es el
// contacto del contrato, y a veces ni siquiera es el representante REGISTRADO
// (apoderados, cambios de junta). La regla de diseño: la identidad no es una
// barrera de entrada sino una verificación de salida — cualquiera con el
// enlace firma declarando quién es; si coincide con el representante
// registrado el contrato se activa solo, y si no, la firma queda registrada y
// VENTAS valida al firmante antes de activar (la fricción se la queda
// CECOMUNICA, nunca el cliente).
const crypto = require("crypto");

// El documento puede ser cédula panameña o PASAPORTE (2026-09-18: el
// representante extranjero no residente no tiene cédula). Antes de comparar se
// le quita la palabra que algunos escriben delante ("Pasaporte No. 150685537"):
// sin eso, el mismo documento escrito de dos maneras no coincidía consigo mismo
// y el contrato se quedaba esperando validación manual.
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

// ¿El firmante declarado es el representante registrado? La cédula manda
// (si ambas existen); sin cédulas comparables, decide el nombre normalizado.
function firmanteCoincide(representante, firma) {
  const cedR = normCedula(representante?.cedula);
  const cedF = normCedula(firma?.cedula);
  if (cedR && cedF) return cedR === cedF;
  const nR = normNombre(representante?.nombre);
  const nF = normNombre(firma?.nombre);
  return !!nR && !!nF && nR === nF;
}

// Huella de integridad de la firma: amarra QUIÉN firmó QUÉ y CUÁNDO. No es la
// verificación pública (esa vive en verificaciones/ con HMAC + QR al
// activarse); es el fingerprint que viaja en firmado_digital del contrato.
// texto_version (2026-08-31): amarra también QUÉ VERSIÓN del texto legal leyó
// el firmante (la copia congelada en la solicitud). Ausente en firmas viejas
// → cadena vacía, así sus hashes históricos no cambian.
function hashFirma({ contrato_id, firmante_nombre, firmante_cedula, firmado_at, total_mensual, texto_version }) {
  return crypto.createHash("sha256")
    .update([contrato_id, normNombre(firmante_nombre), normCedula(firmante_cedula),
      String(firmado_at || ""), String(total_mensual ?? ""),
      ...(texto_version ? [String(texto_version)] : [])].join("|"))
    .digest("hex");
}

module.exports = { normCedula, normNombre, firmanteCoincide, hashFirma };
