// Política de envío de cotizaciones, validada EN EL SERVIDOR (auditoría UX
// 2026-09-28): descuento máximo y total máximo sin aprobación
// (empresa/config.cotizacion_descuento_max_pct / cotizacion_total_max).
//
// El hueco: el navegador evalúa la política (CotizacionTotales.evaluarPolitica)
// y estampa `requiere_aprobacion`; firestore.rules (politicaEnvioOk) confía en
// ese flag porque no puede recorrer renglones. Un cliente manipulado podía
// mandar `requiere_aprobacion: false` y pasar a 'enviada' sin aprobador.
//
// Este trigger recalcula con la MISMA regla (functions/src/domain/
// cotizacionesTotales.js, copia guardada por test de sincronía) y:
//   (a) si la política exige aprobación y el flag dice otra cosa, lo corrige
//       (`requiere_aprobacion: true` + `politica_verificada_at`). Nunca lo
//       afloja: el editor también pone true por ROL ("tu rol no puede enviar"),
//       y esa razón el servidor no la ve. Fallar cerrado.
//   (b) si el doc PASÓ a 'enviada' (o a 'aprobada' sin aprobador) fuera de
//       política y sin aprobación registrada, y quien escribió no es un
//       aprobador del tipo (mismos roles que rules: admin; jefe_taller en
//       servicio; gerente en comercial), lo REGRESA a 'borrador' con
//       `bloqueada_por_politica: {motivo, motivos, at, estado_previo}` y avisa
//       al aprobador por mail_queue (mismos destinatarios que la solicitud de
//       aprobación del editor). El detalle enseña el bloqueo y ofrece
//       "Solicitar aprobación".
//
// ECO: el trigger se dispara con su propia escritura. No se reescribe si nada
// cambia: tras (a) el flag ya coincide; tras (b) el estado es 'borrador' y no
// hay transición. `bloqueada_por_politica.at` además frena el correo repetido
// si un cliente insiste (ventana MAIL_MIN_MS).

const { onDocumentWrittenWithAuthContext } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const T = require("../../domain/cotizacionesTotales");
const { APP_BASE_URL } = require("../../lib/inventario");
const { tallerEmailTo } = require("../../lib/mailRecipients");

const TAG = "[onCotizacionPolitica]";
const APROBACION_FALLBACK = "ventas@cecomunica.com";
const MAIL_MIN_MS = 60 * 60 * 1000; // un correo por hora por cotización, máximo

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

function esServicio(cot) {
  return String(cot?.origen || "comercial") === "orden";
}

// Aprobación registrada en el doc: lo que deja cot-aprobacion.js al aprobar.
function tieneAprobacion(cot) {
  return cot?.fecha_aprobacion != null || !!cot?.aprobado_por_uid || !!cot?.aprobado_por_email;
}

// Mismo criterio que firestore.rules (allow update → envioTocado):
// admin siempre; jefe_taller aprueba servicio; gerente aprueba comercial.
function rolAprueba(rol, cot) {
  const r = String(rol || "");
  if (r === "administrador") return true;
  if (r === "jefe_taller") return esServicio(cot);
  if (r === "gerente") return !esServicio(cot);
  return false;
}

// ¿Quien escribió puede enviar sin aprobación? Escrituras de servidor
// (Admin SDK / functions) sí; un usuario, solo si su rol aprueba este tipo.
async function escritorExento(event, cot) {
  const authType = String(event.authType || "");
  if (authType === "service_account" || authType === "system") return true;
  const uid = String(event.authId || "").trim();
  if (!uid) return false;
  try {
    const snap = await db.collection("usuarios").doc(uid).get();
    return snap.exists && rolAprueba((snap.data() || {}).rol, cot);
  } catch (e) {
    logger.warn(TAG + " usuarios/{uid} no leído; se trata como no exento", { uid, error: e.message });
    return false;
  }
}

async function leerPolitica() {
  try {
    const snap = await db.collection("empresa").doc("config").get();
    return T.policyFromConfig(snap.exists ? (snap.data() || {}) : {});
  } catch (e) {
    logger.warn(TAG + " empresa/config no leído; defaults", { error: e.message });
    return T.policyFromConfig(null);
  }
}

// Destinatarios: mismo reparto que CotState.enqueueAprobacionMail —
// servicio → jefe de taller; comercial → empresa/config.cotizacion_aprobacion_to
// o el buzón histórico de ventas. to = primero, cc = el resto + creador.
async function destinatariosAprobacion(cot) {
  let lista = [];
  try {
    if (esServicio(cot)) {
      const t = await tallerEmailTo();
      if (t) lista = t.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const snap = await db.collection("empresa").doc("config").get();
      const v = snap.exists ? (snap.data() || {}).cotizacion_aprobacion_to : null;
      if (Array.isArray(v)) lista = v.filter(Boolean);
    }
  } catch (e) {
    logger.warn(TAG + " destinatarios de aprobación no resueltos; usando ventas@", { error: e.message });
  }
  if (!lista.length) lista = [APROBACION_FALLBACK];
  const cc = [...lista.slice(1), cot.creado_por_email].filter(Boolean).join(",") || null;
  return { to: lista[0], cc };
}

async function encolarAviso(docId, cot, motivos, estadoPrevio) {
  const { to, cc } = await destinatariosAprobacion(cot);
  const id = cot.cotizacion_id || docId;
  await db.collection("mail_queue").add({
    to,
    cc,
    subject: `Solicitud de aprobación: ${id} – ${cot.cliente_nombre || ""}`,
    preheader: `Cotización devuelta a borrador por política de envío: ${cot.cliente_nombre || ""}`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Solicitud de aprobación</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        La cotización <b>${esc(id)}</b> se marcó como <b>${esc(estadoPrevio)}</b> sin aprobación
        y está fuera de la política de envío directo. El sistema la devolvió a <b>borrador</b>:
        requiere aprobación antes de salir al cliente.
      </p>
      <div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid #B45309;background:#FFFBEB;font:14px/1.5 Arial,sans-serif;">
        <b>Motivo de la aprobación</b>
        <ul style="margin:6px 0 0;padding-left:18px;">${motivos.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
      </div>
      <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${esc(cot.cliente_nombre || "-")}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Vendedor</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${esc(cot.ejecutivo_nombre || cot.creado_por_email || "-")}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Email destinatario</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${esc(cot.dirigido_email || "-")}</td></tr>
      </table>`,
    ctaUrl: `${APP_BASE_URL}/cotizaciones/index.html?aprobar=${encodeURIComponent(docId)}`,
    ctaLabel: "Revisar y aprobar",
    meta: { source: "onCotizacionPolitica", cotizacion_id: id, doc_id: docId, estado_previo: estadoPrevio },
    status: "queued",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

function msDe(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Decide qué hacer con el doc. Puro: recibe before/after y la política y
// devuelve { patch, bloquea, motivos } o null. Exportado para los tests.
function decidir(before, after, policy, { exento = false, ahoraMs = Date.now() } = {}) {
  if (!after || after.deleted === true) return null;
  const pol = T.evaluarPolitica(after, policy);
  const patch = {};

  // (a) el flag solo se APRIETA.
  if (pol.requiere && after.requiere_aprobacion !== true) {
    patch.requiere_aprobacion = true;
    patch.politica_verificada_at = admin.firestore.FieldValue.serverTimestamp();
  }

  // (b) transición a enviada/aprobada fuera de política y sin aprobación.
  const antes = String(before?.estado || "");
  const ahora = String(after.estado || "");
  const transicion = antes !== ahora
    && (ahora === "enviada" || (ahora === "aprobada" && !tieneAprobacion(after)));
  let bloquea = false;
  let mandaCorreo = false;
  if (transicion && pol.requiere && !tieneAprobacion(after) && !exento) {
    bloquea = true;
    const prev = after.bloqueada_por_politica || null;
    mandaCorreo = !prev || (ahoraMs - msDe(prev.at)) > MAIL_MIN_MS;
    patch.estado = "borrador";
    patch.requiere_aprobacion = true;
    patch.politica_verificada_at = admin.firestore.FieldValue.serverTimestamp();
    patch.bloqueada_por_politica = {
      motivo: pol.motivos.join(" "),
      motivos: pol.motivos,
      estado_previo: ahora,
      veces: Number(prev?.veces || 0) + 1,
      at: admin.firestore.Timestamp.now(),
    };
    // `enviada_en` es lo que el historial lee como "Enviada al cliente":
    // no fue un envío válido, así que no queda como tal.
    if (ahora === "enviada" && after.enviada_en != null) {
      patch.enviada_en = admin.firestore.FieldValue.delete();
      patch.bloqueada_por_politica.enviada_en_previa = after.enviada_en;
    }
  }

  if (!Object.keys(patch).length) return null;
  return { patch, bloquea, mandaCorreo, motivos: pol.motivos };
}

const fn = onDocumentWrittenWithAuthContext(
  { document: "cotizaciones/{docId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return null; // borrado físico
    const before = event.data?.before?.data() || null;
    const docId = event.params.docId;

    const policy = await leerPolitica();
    // El rol del escritor solo hace falta si hay transición que bloquear:
    // una lectura de usuarios/{uid} por envío, no por cada guardado.
    let decision = decidir(before, after, policy);
    if (decision && decision.bloquea) {
      const exento = await escritorExento(event, after);
      decision = decidir(before, after, policy, { exento });
    }
    if (!decision) return null;

    try {
      await event.data.after.ref.update(decision.patch);
    } catch (e) {
      logger.error(TAG + " no se pudo estampar", { docId, error: e.message });
      return null;
    }
    if (decision.bloquea) {
      logger.warn(TAG + " cotización devuelta a borrador por política", {
        docId, cotizacion_id: after.cotizacion_id, estado_previo: after.estado,
        authType: event.authType, authId: event.authId, motivos: decision.motivos,
      });
      if (decision.mandaCorreo) {
        try { await encolarAviso(docId, after, decision.motivos, String(after.estado || "")); }
        catch (e) { logger.error(TAG + " aviso al aprobador no encolado", { docId, error: e.message }); }
      }
    }
    return null;
  }
);

fn._interno = { decidir, rolAprueba, tieneAprobacion, destinatariosAprobacion, MAIL_MIN_MS };
module.exports = fn;
