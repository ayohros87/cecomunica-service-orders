// responderCotizacionPublica — el cliente acepta o rechaza la cotización desde
// el enlace público (verify/cotizacion.html). Auditoría UX 2026-09-28 §4.5 #12.
//
// Por qué una Function y no el navegador: quien responde NO tiene sesión, y las
// rules de `cotizaciones` (con razón) no dejan escribir a un anónimo. Aquí se
// valida el código secreto del enlace contra el espejo público y se escribe con
// el admin SDK, en una transacción, lo mismo que deja "Respuesta del cliente"
// en el detalle (CotState.patchCierre): estado, fecha_conversion / fecha_rechazo
// y, para aceptar, `aceptacion` con medio 'pagina'. Así el historial del detalle,
// la bandeja de facturación del taller (onCotizacionEstadoChange →
// abrirFacturacionCotizacion) y la reposición por daño (lib/reposicionDano)
// reaccionan igual que si lo hubiera marcado el vendedor.
//
// Input:  { docId, token, respuesta: 'aceptada'|'rechazada', nombre, comentario? }
// Output: { status, estado, respuesta?, nombre?, fecha? }
//   status: 'registrada' | 'ya_respondida' | 'cerrada' | 'vencida' | 'no_disponible'
// Idempotente: si la cotización ya está aceptada o rechazada, no cambia nada y
// devuelve el estado actual (con la respuesta del cliente si la hubo).

const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const { APP_BASE_URL } = require("../lib/inventario");

const RESPUESTAS = ["aceptada", "rechazada"];
// Solo lo que ya salió al cliente se puede responder. 'aprobada' entra porque
// el panel de aprobación la deja así un instante antes de enviarla.
const ESTADOS_RESPONDIBLES = ["enviada", "aprobada"];
const ESTADOS_CERRADOS = ["convertida", "rechazada", "descartada", "vencida"];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

// Comparación en tiempo constante: el código es el único secreto del enlace.
function codigoValido(esperado, recibido) {
  const a = Buffer.from(String(esperado || ""));
  const b = Buffer.from(String(recibido || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Mismo cálculo que markCotizacionesVencidas: base = enviada_en (o la fecha
// del documento a medianoche) + validezDias. Si difieren, el cron y esta
// Function dirían cosas distintas sobre la misma cotización.
function venceAt(c) {
  const dias = Number(c.validezDias || c.validez_dias || 15);
  let base = null;
  if (c.enviada_en && typeof c.enviada_en.toDate === "function") base = c.enviada_en.toDate();
  else if (c.fecha) base = new Date(c.fecha + "T00:00:00");
  if (!base || isNaN(base.getTime())) return null;
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}

function limpiarInput(data) {
  const d = data || {};
  const docId = String(d.docId || "").trim();
  const token = String(d.token || "").trim();
  const respuesta = String(d.respuesta || "").trim();
  const nombre = String(d.nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const comentario = String(d.comentario || "").trim().slice(0, 500);
  if (!docId || docId.length > 128 || docId.includes("/")) throw new HttpsError("invalid-argument", "Enlace inválido.");
  if (!token || token.length > 64) throw new HttpsError("invalid-argument", "Enlace inválido.");
  if (!RESPUESTAS.includes(respuesta)) throw new HttpsError("invalid-argument", "Respuesta inválida.");
  // El nombre es la firma de quien responde: sin él, nadie sabría quién aceptó.
  if (nombre.length < 3) throw new HttpsError("invalid-argument", "Escribe tu nombre completo.");
  return { docId, token, respuesta, nombre, comentario };
}

function fechaIso(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

// Lo que ya quedó registrado, en la forma que devuelve la Function.
function respuestaActual(c) {
  const r = c.respuesta_cliente || null;
  return {
    estado: c.estado || "borrador",
    respuesta: r ? r.respuesta : null,
    nombre: r ? r.nombre : null,
    fecha: r ? fechaIso(r.fecha) : null,
  };
}

/**
 * Decide qué hacer con la respuesta, sin tocar la base (puro, se prueba solo).
 * @returns {{accion:'escribir'}|{accion:'nada', status:string}}
 */
function evaluar(cot, ahora = new Date()) {
  if (!cot || cot.deleted === true) return { accion: "nada", status: "no_disponible" };
  const estado = String(cot.estado || "borrador");
  if (estado === "convertida" || estado === "rechazada") {
    return { accion: "nada", status: cot.respuesta_cliente ? "ya_respondida" : "cerrada" };
  }
  if (estado === "vencida") return { accion: "nada", status: "vencida" };
  if (ESTADOS_CERRADOS.includes(estado)) return { accion: "nada", status: "cerrada" };
  if (!ESTADOS_RESPONDIBLES.includes(estado)) return { accion: "nada", status: "no_disponible" };
  const vence = venceAt(cot);
  // El cron de las 06:00 la marcará vencida; mientras tanto no se acepta un
  // precio que ya no está vigente.
  if (vence && vence <= ahora) return { accion: "nada", status: "vencida" };
  return { accion: "escribir" };
}

/**
 * Patch de la cotización + el del espejo público. `ahora` es un Timestamp real
 * (no serverTimestamp) porque también se devuelve y va dentro de mapas.
 */
function construirPatches({ respuesta, nombre, comentario, ip, userAgent }, ahora) {
  const respuestaCliente = {
    respuesta, nombre, comentario,
    fecha: ahora,
    medio: "pagina",
    ...(ip ? { ip: String(ip).slice(0, 64) } : {}),
    ...(userAgent ? { user_agent: String(userAgent).slice(0, 200) } : {}),
  };
  const cot = { respuesta_cliente: respuestaCliente, estado: respuesta === "aceptada" ? "convertida" : "rechazada" };
  if (respuesta === "aceptada") {
    // Misma forma que CotState.patchCierre + aceptacion del taller: la lee el
    // historial del detalle, la fila de facturación y la gestión de reposición.
    cot.fecha_conversion = ahora;
    cot.convertida_por_uid = null;
    cot.aceptacion = {
      medio: "pagina",
      nota: comentario ? (nombre + ": " + comentario).slice(0, 200) : nombre,
      por_uid: null,
      por_email: null,
      por_nombre: nombre,
      at: ahora,
    };
  } else {
    cot.fecha_rechazo = ahora;
    cot.rechazado_por_uid = null;
    // 'cliente' ≠ 'aprobador': este sí cuenta como oportunidad perdida.
    cot.rechazo_origen = "cliente";
    if (comentario) cot.rechazo_motivo = comentario;
  }
  // El espejo es de lectura pública: sin IP ni user-agent.
  const espejo = {
    estado: cot.estado,
    estado_at: ahora,
    respuesta_cliente: { respuesta, nombre, comentario, fecha: ahora },
  };
  return { cot, espejo };
}

function correoVendedor({ docId, cot, respuesta, nombre, comentario }) {
  const to = cot.creado_por_email || cot.ejecutivo_email || null;
  if (!to) return null;
  const cc = cot.ejecutivo_email && cot.ejecutivo_email.toLowerCase() !== to.toLowerCase() ? cot.ejecutivo_email : null;
  const legible = cot.cotizacion_id || docId;
  const cliente = cot.cliente_nombre || "el cliente";
  const taller = String(cot.origen || "") === "orden";
  const acepto = respuesta === "aceptada";
  // Qué pasa después, dicho en el correo: en el taller aceptar abre la fila en
  // Facturación pendiente (o libera a bodega si es reposición); en ventas el
  // vendedor sigue con el contrato o la venta.
  const siguiente = acepto
    ? (taller
      ? (cot.gestion_id
        ? "Recepción recibe la fila en Facturación pendiente y Bodega el aviso para asignar el radio de reposición."
        : "Recepción recibe la fila en Facturación pendiente, aunque el equipo siga en el taller.")
      : "Comunícate con el cliente para cerrar la venta o preparar el contrato.")
    : (taller
      ? (cot.gestion_id
        ? "No se repone el radio: el caso se cierra y el daño pasa a cobranza."
        : "No se factura nada y el candado de materiales de la orden se reabre.")
      : "Queda como oportunidad perdida. Si hay espacio para una nueva propuesta, llámalo.");
  return {
    to,
    cc,
    subject: acepto
      ? `✅ ${cliente} aceptó la cotización ${legible}`
      : `Cotización ${legible}: ${cliente} no la aceptó`,
    preheader: acepto
      ? `${nombre} la aceptó desde el enlace de la cotización`
      : `${nombre} respondió que no la acepta`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:${acepto ? "#065F46" : "#991B1B"};">
        ${acepto ? "El cliente aceptó la cotización" : "El cliente no aceptó la cotización"}
      </h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        <b>${esc(nombre)}</b> respondió desde el enlace de la cotización <b>${esc(legible)}</b>
        para <b>${esc(cliente)}</b>.
      </p>
      ${comentario ? `<div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid ${acepto ? "#065F46" : "#B91C1C"};background:${acepto ? "#ECFDF5" : "#FEF2F2"};font:14px/1.5 Arial,sans-serif;">
        <b>Comentario del cliente</b><br>${esc(comentario)}
      </div>` : ""}
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${esc(siguiente)}</p>`,
    ctaUrl: `${APP_BASE_URL}/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(docId)}`,
    ctaLabel: "Ver la cotización",
    meta: {
      source: "responderCotizacionPublica",
      tipo: acepto ? "cotizacion_aceptada_cliente" : "cotizacion_rechazada_cliente",
      cotizacion_id: legible,
      doc_id: docId,
    },
  };
}

// El trabajo real, separado del wrapper onCall para probarlo con un db falso.
async function handler(request, deps = {}) {
  const fdb = deps.db || db;
  const fadmin = deps.admin || admin;
  const input = limpiarInput(request.data);
  const raw = request.rawRequest || {};
  const ip = raw.ip || (raw.headers && String(raw.headers["x-forwarded-for"] || "").split(",")[0].trim()) || null;
  const userAgent = raw.headers ? raw.headers["user-agent"] : null;

  const vRef = fdb.collection("cotizacion_verificaciones").doc(input.docId);
  const cRef = fdb.collection("cotizaciones").doc(input.docId);

  const r = await fdb.runTransaction(async (tx) => {
    const vSnap = await tx.get(vRef);
    const v = vSnap.exists ? (vSnap.data() || {}) : null;
    // Mismo mensaje para "no existe" y "código malo": no se revela cuál falló.
    if (!v || !codigoValido(v.code, input.token)) {
      throw new HttpsError("permission-denied", "Este enlace no es válido. Pide a tu vendedor que te lo reenvíe.");
    }
    const cSnap = await tx.get(cRef);
    const cot = cSnap.exists ? (cSnap.data() || {}) : null;
    const decision = evaluar(cot, new Date());
    if (decision.accion === "nada") {
      return { status: decision.status, ...respuestaActual(cot || {}), cot: null };
    }
    const ahora = fadmin.firestore.Timestamp.now();
    const { cot: patch, espejo } = construirPatches({ ...input, ip, userAgent }, ahora);
    tx.update(cRef, patch);
    tx.set(vRef, espejo, { merge: true });
    return {
      status: "registrada",
      estado: patch.estado,
      respuesta: input.respuesta,
      nombre: input.nombre,
      fecha: fechaIso(ahora),
      cot,
    };
  });

  // El correo va FUERA de la transacción (un reintento no lo duplica) y es
  // best-effort: la respuesta del cliente ya quedó registrada.
  if (r.status === "registrada" && r.cot) {
    try {
      const mail = correoVendedor({ docId: input.docId, cot: r.cot, ...input });
      if (mail) {
        await fdb.collection("mail_queue").add({
          ...mail,
          createdAt: fadmin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        logger.warn("[responderCotizacionPublica] sin correo del vendedor", { docId: input.docId });
      }
    } catch (e) {
      logger.error("[responderCotizacionPublica] no se pudo avisar al vendedor", { docId: input.docId, error: e.message });
    }
    logger.info("[responderCotizacionPublica] respuesta registrada", {
      docId: input.docId, respuesta: input.respuesta, cotizacion: r.cot.cotizacion_id || null,
    });
  }

  delete r.cot; // el doc completo no sale a un anónimo
  return r;
}

const fn = onCall(
  // Sin auth a propósito: lo llama el cliente desde el enlace público. El
  // control es el código secreto del enlace, validado arriba.
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, invoker: "public" },
  (request) => handler(request)
);

fn._interno = { handler, evaluar, venceAt, construirPatches, correoVendedor, codigoValido, limpiarInput };
module.exports = fn;
