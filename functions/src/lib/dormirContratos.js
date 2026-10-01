// Duerme los contratos aprobados sin firmar a los 45 días (decisión 7 de
// Alberto, 1-oct-2026): caduca la solicitud de firma y marca el contrato
// como dormido. La regla vive en domain/contratoDormido; esto es el recorrido
// con Firestore. Lo corre el cron diario (scheduled/dormirContratosSinFirma)
// y, contra el emulador, el script de prueba.
//
// Avisa al vendedor que elaboró el contrato (mail_queue): el contrato sale de
// su señal "Mis contratos por firmar" y sin un correo nadie se enteraría.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const D = require("../domain/contratoDormido");

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function emailDeUid(uid, cache) {
  if (!uid) return "";
  if (cache.has(uid)) return cache.get(uid);
  let email = "";
  try {
    const u = await db.collection("usuarios").doc(uid).get();
    email = String(u.exists ? (u.data().email || "") : "").trim();
  } catch (e) {
    logger.warn("[dormirContratos] usuario no leído para el aviso", { uid, err: e.message });
  }
  cache.set(uid, email);
  return email;
}

async function dormirContratosSinFirma({ dryRun = false, now = new Date(), dias = D.DIAS_DORMIDO, tag = "dormirContratos" } = {}) {
  const startedAt = Date.now();
  // Mismo recorte que la señal "Contratos por firmar": aprobado + seriales
  // asignados. El resto del criterio (lleva firma, sin firmar, sin entregar,
  // vivo, no dormido) lo decide el dominio.
  const snap = await db.collection("contratos")
    .where("estado", "==", "aprobado")
    .where("seriales_estado", "==", "asignados")
    .limit(500).get();

  let scanned = 0, candidatos = 0, dormidos = 0, enlacesCaducados = 0, mails = 0, errors = 0;
  const muestra = [];
  const cacheEmail = new Map();
  const FV = admin.firestore.FieldValue;

  for (const doc of snap.docs) {
    scanned++;
    const c = doc.data() || {};
    if (!D.esperaFirmaViva(c)) continue;
    candidatos++;
    // La solicitud pendiente (si la hay) aporta su created_at a la fecha base.
    let solicitud = null;
    let solRef = null;
    if (c.firma_solicitud_id && c.firma_solicitud_estado === "pendiente") {
      try {
        solRef = db.collection("firma_solicitudes").doc(c.firma_solicitud_id);
        const s = await solRef.get();
        solicitud = s.exists ? (s.data() || {}) : null;
        if (!solicitud || solicitud.estado !== "pendiente") solRef = null;
      } catch (e) {
        logger.warn(`[${tag}] solicitud no leída`, { docId: doc.id, err: e.message });
        solRef = null;
      }
    }
    const dec = D.decidirDormir({ contrato: c, solicitud, now, dias });
    if (!dec.dormir) continue;
    dormidos++;
    if (solRef) enlacesCaducados++;
    if (muestra.length < 25) muestra.push(`${c.contrato_id || doc.id}: ${dec.porQue}${solRef ? " · enlace caducado" : ""}`);
    if (dryRun) continue;
    try {
      const batch = db.batch();
      batch.update(doc.ref, D.patchDormir({ contrato: c, dias: dec.dias, ahora: FV.serverTimestamp(), teniaEnlace: !!solRef }));
      if (solRef) batch.update(solRef, D.patchCaducarSolicitud(FV.serverTimestamp()));
      await batch.commit();
    } catch (e) {
      errors++;
      logger.error(`[${tag}] no se pudo dormir`, { docId: doc.id, err: e.message });
      continue;
    }
    // Aviso al vendedor (best-effort: el correo no frena nada).
    const to = await emailDeUid(c.creado_por_uid, cacheEmail);
    if (!to) continue;
    try {
      const url = `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(c.cliente_id || "")}&contrato=${encodeURIComponent(doc.id)}`;
      await db.collection("mail_queue").add({
        to,
        subject: `Contrato ${c.contrato_id || doc.id} quedó dormido: ${dec.dias} días sin firma`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#111;max-width:520px;">
            <h2 style="font:700 20px Arial,sans-serif;color:#0B2A47;margin:0 0 12px;">Contrato dormido</h2>
            <p style="margin:0 0 12px;">El contrato <b>${esc(c.contrato_id || doc.id)}</b> de
            <b>${esc(c.cliente_nombre || "—")}</b> lleva <b>${dec.dias} días</b> aprobado sin la firma del cliente.
            La solicitud y el enlace de firma caducaron y el contrato quedó <b>dormido</b>: ya no cuenta en
            "Contratos por firmar" ni frena otros trámites de la cuenta.</p>
            <p style="margin:0 0 12px;">Si el cliente todavía va a firmar, reactívalo desde la ficha del cliente
            (<b>Reactivar la solicitud</b>): se genera un enlace nuevo.</p>
            <p style="margin:0;"><a href="${esc(url)}" style="color:#0B2A47;">Abrir la ficha del cliente</a></p>
          </div>`,
        meta: { tipo: "contrato_dormido", contrato_doc_id: doc.id, contrato_id: c.contrato_id || null },
        createdAt: FV.serverTimestamp(),
      });
      mails++;
    } catch (e) {
      logger.warn(`[${tag}] no se pudo encolar el aviso`, { docId: doc.id, err: e.message });
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { scanned, candidatos, dormidos, enlacesCaducados, mails, errors, muestra, elapsedSec };
}

module.exports = { dormirContratosSinFirma };
