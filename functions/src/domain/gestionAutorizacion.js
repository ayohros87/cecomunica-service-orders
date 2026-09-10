// Cómo quedó AUTORIZADA una gestión de aumento / actualización de seriales —
// UNA sola definición, y siempre sacada del expediente.
//
// El caso que lo obligó (2026-09-10, GA20260909-03 · FORTUNATO MANGRAVITA):
// el aviso de facturación le llegó al vendedor diciendo "El cliente firmó el
// anexo GA20260909-03". El cliente nunca firmó: esa gestión se aplicó con
// "Aplicar sin firma". El texto estaba escrito a mano en el trigger desde
// antes del 2026-09-09, cuando la actualización de seriales dejó de pasar por
// firma — y nadie lo volvió a leer. Un texto que AFIRMA algo del cliente no
// puede deducirse del camino que tomó el código: tiene que salir del dato.
//
// Los cuatro estados posibles, en orden de fuerza probatoria:
//   anexo_firma_digital → firma digital, con firmante y cédula (hay hash)
//   anexo_firmado_path  → firmó en papel y el documento está en el expediente
//   sin_firma           → se aplicó SIN firma, diciendo quién lo autorizó
//   (ninguno)           → aplicado tras la aprobación, sin rastro de firma
//
// Devuelve { corto, html, firmado }:
//   corto   texto plano para bitácoras, `contexto.origen_texto` y chips
//   html    frase completa para el cuerpo de un correo (ya escapada)
//   firmado true SOLO si el cliente firmó de verdad — quien necesite decidir
//           (candados, iconos) mira este booleano, nunca el texto
//
// Este archivo existe DUPLICADO a propósito (no hay build step):
//   · functions/src/domain/gestionAutorizacion.js  (Admin SDK: triggers)
//   · public/js/domain/gestionAutorizacion.js      (navegador, window.GestionAutorizacion)
// functions/test/gestionAutorizacion.test.js exige que sean byte a byte iguales.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GestionAutorizacion = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (s) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
  ));

  function texto(gestion) {
    const g = gestion || {};
    const d = g.anexo_firma_digital;
    if (d) {
      const quien = d.firmante_nombre || "";
      const ced = d.firmante_cedula || "";
      return {
        firmado: true,
        corto: `Firmado digitalmente por el cliente${quien ? ` (${quien})` : ""}`,
        html: `El cliente lo <b>firmó digitalmente</b>${quien
          ? ` — <b>${esc(quien)}</b>${ced ? ` (cédula ${esc(ced)})` : ""}` : ""}.`,
      };
    }
    if (g.anexo_firmado_path) {
      const quien = g.anexo_firmado_por || "";
      return {
        firmado: true,
        corto: "Firmado por el cliente en papel",
        html: `El cliente lo <b>firmó</b> y el documento quedó en el expediente${quien
          ? ` — lo registró ${esc(quien)}` : ""}.`,
      };
    }
    if (g.sin_firma) {
      const quien = g.sin_firma.por_email || (g.aprobacion || {}).aprobado_por_email || "";
      const motivo = String(g.sin_firma.motivo || "").trim();
      return {
        firmado: false,
        corto: `Aplicado SIN firma del cliente${quien ? ` (${quien})` : ""}`,
        html: `Se aplicó <b>sin firma del cliente</b>${quien
          ? `, autorizado por <b>${esc(quien)}</b>` : ""}: al cliente no se le envió nada a firmar.${motivo
          ? ` Motivo: ${esc(motivo)}.` : ""}`,
      };
    }
    const quien = (g.aprobacion || {}).aprobado_por_email || "";
    return {
      firmado: false,
      corto: `Aplicado sin firma del cliente${quien ? ` (${quien})` : ""}`,
      html: `Se aplicó <b>sin firma del cliente</b>${quien
        ? `, tras la aprobación de <b>${esc(quien)}</b>` : ""}.`,
    };
  }

  // Etiqueta del paso "firma" en el checklist del expediente: la misma
  // verdad, en dos palabras. `pendiente` = el paso todavía no se cumplió.
  function pasoFirma(gestion, pendiente) {
    const g = gestion || {};
    if (pendiente) return "Firma del cliente";
    const r = texto(g);
    return r.firmado ? "Anexo firmado por el cliente" : "Aplicado sin firma del cliente";
  }

  return { texto, pasoFirma };
});
