const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

// Lo que cuelga de una ENTREGA. Dos cosas, en este mismo trigger para no
// sumar un séptimo onDocumentWritten sobre ordenes_de_servicio:
//
//   1) Entrega COMPLETA → propaga la señal al contrato (readiness de
//      facturación): estampa `entrega_confirmada` + `fecha_entrega_ultima`.
//      NO activa facturación — solo registra la señal para que el módulo
//      calcule readiness sin leer subcolecciones. La activación es una acción
//      explícita aparte (callable gestionarFacturacion).
//   2) Entrega PARCIAL → encola la copia de la nota de tanda al cliente,
//      cuando la UI la pidió (entrega.tandas[].envio.status === 'solicitado').
//      Mismo circuito que el acuse de devolución: reclamar en transacción,
//      encolar, y que onMailQueued espeje el resultado real del SMTP.
const ENTREGADO = "ENTREGADO AL CLIENTE";
const norm = (s) => String(s || "").trim().toUpperCase();
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
const { emailNotaTanda, numeroDeTanda } = require("../../lib/notaTandaEntrega");

// ── Copia de la nota de entrega parcial al cliente ────────────────────────
// La UI marca entrega.tandas[].envio = {status:'solicitado', to} y aquí se
// reclama la solicitud antes de encolar: si dos instancias procesan la misma
// escritura, solo una gana la transición y solo esa manda el correo. El
// reclamo se hace por `numero` ({ordenId}-E{n}), que es único dentro de la
// orden y estable — el array es append-only.
async function procesarEnviosTandas(ordenId, after) {
  const tandas = (after.entrega || {}).tandas || [];
  const solicitados = tandas.filter(t =>
    t && t.envio && t.envio.status === "solicitado");
  if (!solicitados.length) return;

  const ref = db.collection("ordenes_de_servicio").doc(ordenId);
  for (const t of solicitados) {
    const numero = numeroDeTanda(ordenId, tandas, t);
    const to = String(t.envio.to || "").trim().toLowerCase();
    const valido = isEmail(to);
    const mailRef = db.collection("mail_queue").doc();
    try {
      const claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const arr = ((snap.data().entrega || {}).tandas || []).map(x => ({ ...x }));
        const i = arr.findIndex(x => x && numeroDeTanda(ordenId, arr, x) === numero);
        if (i < 0 || !arr[i].envio || arr[i].envio.status !== "solicitado") return null;
        arr[i].envio = valido
          ? { ...arr[i].envio, to, status: "encolado", mail_id: mailRef.id,
              at: admin.firestore.Timestamp.now(), error: null }
          : { ...arr[i].envio, status: "fallo",
              at: admin.firestore.Timestamp.now(),
              error: "El correo del destinatario no es válido" };
        // update() con ruta de puntos, no set(merge): `entrega` es un mapa y
        // un merge podría dejarlo a medias (regla de la casa).
        tx.update(ref, { "entrega.tandas": arr });
        return valido ? arr[i] : null;
      });
      if (!claim) {
        if (!valido) logger.warn("[onOrdenEntregada] tanda con correo inválido", { ordenId, numero, to });
        continue;
      }
      const payload = emailNotaTanda(ordenId, after, claim);
      await mailRef.set({
        to,
        subject: payload.subject,
        preheader: payload.preheader,
        bodyContent: payload.bodyContent,
        meta: {
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          source: "entrega-parcial",
          orden_id: ordenId,
          tanda_numero: numero,
        },
        status: "queued",
      });
      logger.info("[onOrdenEntregada] Nota de tanda encolada para el cliente", { ordenId, numero, to, mailId: mailRef.id });
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo encolar la nota de tanda (no crítico)", { ordenId, numero, error: e.message });
    }
  }
}

module.exports = onDocumentWritten(
  { document: "ordenes_de_servicio/{ordenId}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after) return null;

    // Copias de notas de entrega parcial pedidas por la UI. Va ANTES del corte
    // de abajo a propósito: una tanda ocurre mientras la orden sigue en
    // COMPLETADO, así que si esperáramos a la transición a ENTREGADO el correo
    // no saldría nunca. Best-effort — un fallo aquí no frena la propagación
    // al contrato.
    try {
      await procesarEnviosTandas(event.params.ordenId, after);
    } catch (e) {
      logger.warn("[onOrdenEntregada] Envíos de tandas fallaron (no crítico)", {
        ordenId: event.params.ordenId, message: e.message,
      });
    }

    // Solo en la TRANSICIÓN a ENTREGADO (no en cada escritura ya entregada).
    if (norm(before?.estado_reparacion) === ENTREGADO || norm(after.estado_reparacion) !== ENTREGADO) {
      return null;
    }

    const contrato = after.contrato || {};
    if (!contrato.aplica || !contrato.contrato_doc_id) return null; // orden sin contrato

    const contratoDocId = contrato.contrato_doc_id;
    try {
      await db.collection("contratos").doc(contratoDocId).set({
        entrega_confirmada: true,
        fecha_entrega_ultima: after.fecha_entrega || admin.firestore.FieldValue.serverTimestamp(),
        facturacion_entrega_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("[onOrdenEntregada] Entrega propagada al contrato", {
        ordenId: event.params.ordenId, contratoDocId,
      });
    } catch (e) {
      logger.warn("[onOrdenEntregada] No se pudo propagar la entrega", {
        contratoDocId, message: e.message,
      });
    }
    return null;
  }
);
