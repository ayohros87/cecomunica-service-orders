// Destinatarios de correos internos, configurables por admin desde empresa/config
// con fallback a la constante (nunca lanza). Mismo patrón que inventarioEmailTo.
// Claves en empresa/config: email_activaciones, email_atencion_cliente (array o
// string). Evita tener los buzones hardcodeados en cada trigger.
const logger = require("firebase-functions/logger");
const { db } = require("./admin");

const FALLBACKS = {
  activaciones:     "alberto.yohros@cecomunica.com, activaciones@cecomunica.com",
  atencion_cliente: "atencionalcliente@cecomunica.com",
  // Jefe de taller: sin buzón por defecto — se configura en empresa/config
  // (email_taller). Los callers omiten el destinatario cuando viene vacío.
  taller:           "",
  // Bodega: sin buzón por defecto. No existe un rol `bodega` en el sistema y el
  // buzón inventario@cecomunica.com es un PLACEHOLDER que nunca se creó
  // (confirmado 2026-08-20) — poner eso aquí mandaba el correo a un rebote
  // silencioso. Se resuelve con empresa/config.email_bodega y, si está vacío,
  // con los usuarios de rol `inventario`. Ver bodegaEmailTo().
  bodega:           "",
};

async function configEmailTo(key, fallback) {
  try {
    const snap = await db.collection("empresa").doc("config").get();
    const v = snap.exists ? snap.data()["email_" + key] : null;
    if (Array.isArray(v) && v.length) return v.join(", ");
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch (e) {
    logger.warn("[mailRecipients] empresa/config no leído; usando fallback.", { key, message: e.message });
  }
  return fallback;
}

const activacionesEmailTo    = () => configEmailTo("activaciones", FALLBACKS.activaciones);
const atencionClienteEmailTo = () => configEmailTo("atencion_cliente", FALLBACKS.atencion_cliente);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Taller: empresa/config.email_taller o, si está vacío, los usuarios con rol
// jefe_taller — el fallback por rol que la cabecera de recordatorioOperativo ya
// prometía pero que no existía. Sin él, con la clave sin configurar el `to`
// quedaba en "" y los correos de órdenes estancadas y de cola de QC no se
// enviaban a nadie, en silencio. Mismo patrón que recepcionEmails().
async function tallerEmailTo() {
  const cfg = await configEmailTo("taller", FALLBACKS.taller);
  if (cfg) return cfg;
  try {
    const snap = await db.collection("usuarios").where("rol", "==", "jefe_taller").get();
    const out = [];
    snap.forEach(d => {
      const e = String(d.data()?.email || "").trim().toLowerCase();
      if (EMAIL_RE.test(e)) out.push(e);
    });
    if (out.length) return out.join(", ");
  } catch (e) {
    logger.warn("[mailRecipients] usuarios rol jefe_taller no leídos", { message: e.message });
  }
  return "";
}

// Bodega: empresa/config.email_bodega (Admin · Configuración, selector de
// usuarios) o, si está vacío, los usuarios con rol `inventario`. Devuelve ""
// cuando no hay nadie — el llamador NO envía y lo registra, que es mejor que
// mandarlo al buzón placeholder que no existe. Nunca lanza.
async function bodegaEmailTo() {
  const cfg = await configEmailTo("bodega", FALLBACKS.bodega);
  if (cfg) return cfg;
  const { inventarioPorRol } = require("./inventario");
  return (await inventarioPorRol()) || "";
}

// Recepción como ARRAY de emails: empresa/config.email_recepcion o, si está
// vacío, todos los usuarios con rol recepcion. Puede devolver []. Nunca lanza.
async function recepcionEmails() {
  const out = new Set();
  try {
    const cfg = await configEmailTo("recepcion", "");
    if (cfg) cfg.split(",").map(s => s.trim().toLowerCase()).filter(e => EMAIL_RE.test(e)).forEach(e => out.add(e));
  } catch (e) { /* cae al rol */ }
  if (!out.size) {
    try {
      const snap = await db.collection("usuarios").where("rol", "==", "recepcion").get();
      snap.forEach(d => {
        const e = String(d.data()?.email || "").trim().toLowerCase();
        if (EMAIL_RE.test(e)) out.add(e);
      });
    } catch (e) {
      logger.warn("[mailRecipients] usuarios rol recepcion no leídos", { message: e.message });
    }
  }
  return [...out];
}

// CC extra del correo "Contrato APROBADO" (empresa/config.mail_cc_contrato_aprobado,
// editable en Admin · Configuración). Array; [] si no hay o falla la lectura.
async function ccContratoAprobado() {
  try {
    const snap = await db.collection("empresa").doc("config").get();
    const v = snap.exists ? snap.data().mail_cc_contrato_aprobado : null;
    if (Array.isArray(v)) return v.map(s => String(s).trim().toLowerCase()).filter(e => EMAIL_RE.test(e));
  } catch (e) {
    logger.warn("[mailRecipients] mail_cc_contrato_aprobado no leído", { message: e.message });
  }
  return [];
}

module.exports = { configEmailTo, activacionesEmailTo, atencionClienteEmailTo, bodegaEmailTo, tallerEmailTo, recepcionEmails, ccContratoAprobado, FALLBACKS };
