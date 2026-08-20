// Helpers del flujo de seriales de inventario, compartidos entre el trigger de
// aprobación (onApproval) y el recordatorio programado (recordatorioSeriales).
const logger = require("firebase-functions/logger");
const { db } = require("./admin");

// URL base de la app (para los enlaces "Agregar seriales" en los correos).
const APP_BASE_URL = "https://app.cecomunica.net";

// Buzón histórico de inventario. ⚠️ NO EXISTE: es un placeholder que nunca se
// creó (confirmado 2026-08-20). Se conserva como último recurso para no dejar
// `to` vacío en los llamadores que no lo comprueban, pero antes de llegar aquí
// se intentan los usuarios con rol `inventario`, que sí son buzones reales.
const INVENTARIO_EMAIL_FALLBACK = "inventario@cecomunica.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails de los usuarios con rol `inventario` — la gente de bodega de carne y
// hueso. Devuelve "" si no hay ninguno o si la lectura falla. Nunca lanza.
async function inventarioPorRol() {
  try {
    const snap = await db.collection("usuarios").where("rol", "==", "inventario").get();
    const out = [];
    snap.forEach(d => {
      const e = String(d.data()?.email || "").trim().toLowerCase();
      if (EMAIL_RE.test(e)) out.push(e);
    });
    return out.join(", ");
  } catch (e) {
    logger.warn("[inventario] usuarios rol inventario no leídos", { message: e.message });
    return "";
  }
}

// Destinatarios de los correos a inventario: empresa/config.email_solicitud_seriales
// (configurable por admin) →  usuarios con rol `inventario` →  buzón histórico.
// El escalón del rol se agregó porque el buzón histórico no existe: sin él, con
// la clave sin configurar los correos de seriales se iban a un rebote silencioso.
// Nunca lanza.
async function inventarioEmailTo() {
  try {
    const snap = await db.collection("empresa").doc("config").get();
    const arr = snap.exists ? snap.data().email_solicitud_seriales : null;
    if (Array.isArray(arr) && arr.length) return arr.join(", ");
  } catch (e) {
    logger.warn("[inventario] No se pudo leer empresa/config; usando fallback.", { message: e.message });
  }
  const porRol = await inventarioPorRol();
  if (porRol) return porRol;
  logger.warn("[inventario] sin destinatarios reales; se usa el buzón histórico (que no existe).");
  return INVENTARIO_EMAIL_FALLBACK;
}

module.exports = { APP_BASE_URL, INVENTARIO_EMAIL_FALLBACK, inventarioEmailTo, inventarioPorRol };
