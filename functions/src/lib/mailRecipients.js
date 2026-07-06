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
const tallerEmailTo          = () => configEmailTo("taller", FALLBACKS.taller);

module.exports = { configEmailTo, activacionesEmailTo, atencionClienteEmailTo, tallerEmailTo, FALLBACKS };
