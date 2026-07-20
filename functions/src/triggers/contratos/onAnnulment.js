const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { crearOrdenDevolucion } = require("../../lib/ordenDevolucion");

module.exports = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    region: "us-central1",
    secrets: [
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const before = event.data.before?.data();
    const after  = event.data.after?.data();
    if (!before || !after) return null;

    const pasoAAnulado = (before.estado !== "anulado" && after.estado === "anulado");
    if (!pasoAAnulado) return null;

    const contratoId      = after.contrato_id || event.params.docId;
    const motivoAnulacion = String(after.anulado_motivo || "No especificado");

    // Cerrar el ciclo de facturación: un contrato anulado no debe quedar con
    // facturacion_estado 'activa'/'en_espera' colgado (hoy invisible porque
    // los consumidores filtran por estado, pero es trampa latente para el
    // facturador mensual futuro). Se preserva el estado previo para auditoría.
    if (["activa", "en_espera"].includes(after.facturacion_estado)) {
      try {
        await db.collection("contratos").doc(event.params.docId).set({
          facturacion_estado: "no_aplica",
          facturacion_estado_previo: after.facturacion_estado,
          facturacion_cerrada_por_anulacion_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        logger.warn("[onContratoAnuladoNotify] No se pudo cerrar facturacion_estado (no crítico)", {
          contratoId, message: e.message
        });
      }
    }

    // Pool de equipos — cambio 2026-07-20: la anulación YA NO manda las
    // unidades a cuarentena de inmediato (eso fingía que el cliente devolvió).
    // El patrón usual de una anulación es que el contrato tuvo un error y los
    // equipos NUNCA salieron del taller. Ahora se crea una orden de DEVOLUCIÓN
    // en modo CONFIRMACIÓN: el check-in por unidad decide —
    //   "nunca salió"  → en_bodega directo (sin inspección)
    //   "recibido"     → cuarentena + ENTRADA de inspección al cerrar
    //   "no se devuelve" → excepción justificada
    // Mientras tanto las unidades quedan pendiente_devolucion (recordatorio
    // semanal las vigila). No crítico: un fallo no bloquea el correo.
    try {
      const cid = event.params.docId;
      if (!after.orden_devolucion_id) {
        const serialesSnap = await db.collection("contratos").doc(cid)
          .collection("seriales").get();
        const unidades = [];
        for (const d of serialesSnap.docs) {
          const s = d.data() || {};
          const serial = (s.serial || "").toString().trim();
          if (!serial) continue;
          try {
            const { ref, data } = await pool.resolver(serial, s.modelo_id, s.modelo);
            if (!data) continue;
            if (![pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE].includes(data.estado)) continue;
            if (data.asignacion?.contrato_doc_id !== cid) continue;
            if (data.propiedad === "cliente") continue; // propio del cliente: no se devuelve
            await ref.set({
              pendiente_devolucion: true,
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            unidades.push({ serial, modelo: s.modelo || "", modelo_id: s.modelo_id || null, pool_doc_id: ref.id });
          } catch (e) { /* unidad no resoluble: se omite */ }
        }
        if (unidades.length) {
          const ordenId = await crearOrdenDevolucion({
            clienteId: after.cliente_id || null,
            clienteNombre: after.cliente_nombre || "",
            contratoDocId: cid,
            contratoId,
            modo: "confirmacion",
            origen: { tipo: "anulacion", ref_id: cid },
            unidades,
            motivo: `Anulación de contrato (${motivoAnulacion})`,
          });
          if (ordenId) {
            await db.collection("contratos").doc(cid)
              .set({ orden_devolucion_id: ordenId }, { merge: true });
          }
        } else {
          logger.info("[onContratoAnuladoNotify] Anulación sin unidades rastreadas en el pool", { contratoId });
        }
      }
    } catch (e) {
      logger.warn("[onContratoAnuladoNotify] Orden de devolución falló (no crítico)", {
        contratoId, message: e.message
      });
    }

    const escapeHtml = (value) => String(value ?? "").replace(/[<>&]/g, (ch) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;"
    }[ch]));

    const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

    const getUserInfo = async (uid) => {
      if (!uid) return { uid: null, nombre: "", email: "" };
      try {
        const snap = await db.collection("usuarios").doc(uid).get();
        if (!snap.exists) return { uid, nombre: uid, email: "" };
        const data = snap.data() || {};
        return { uid, nombre: data.nombre || data.email || uid, email: data.email || "" };
      } catch (e) {
        logger.warn("[onContratoAnuladoNotify] No se pudo leer usuario", { uid, message: e.message });
        return { uid, nombre: uid, email: "" };
      }
    };

    const [anuladorInfo, elaboradorInfo] = await Promise.all([
      getUserInfo(after.anulado_por_uid || null),
      getUserInfo(after.creado_por_uid  || null)
    ]);

    const recipients = [];
    if (isEmail(anuladorInfo.email))  recipients.push(anuladorInfo.email.trim().toLowerCase());
    if (isEmail(elaboradorInfo.email)) recipients.push(elaboradorInfo.email.trim().toLowerCase());

    const uniqueRecipients = [...new Set(recipients)];
    if (!uniqueRecipients.length) {
      logger.warn("[onContratoAnuladoNotify] Sin destinatarios válidos", {
        contratoId,
        anuladorUid:   after.anulado_por_uid || null,
        elaboradorUid: after.creado_por_uid  || null
      });
      return null;
    }

    const to = uniqueRecipients[0];
    const cc = uniqueRecipients.length > 1 ? uniqueRecipients.slice(1).join(",") : undefined;

    const preheader = `Contrato ${contratoId} anulado. Motivo: ${motivoAnulacion}`;
    const bodyHtml  = `
      <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#991b1b;">Contrato anulado</h2>
      <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
        El contrato <b>${escapeHtml(contratoId)}</b> fue anulado.
      </p>
      <div style="margin:0 0 14px; padding:12px 14px; border:2px solid #b91c1c; border-radius:10px; background:#fef2f2; font:700 15px Arial, sans-serif; color:#991b1b;">
        Motivo de anulación: ${escapeHtml(motivoAnulacion)}
      </div>
      <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Contrato ID</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(contratoId)}</td></tr>
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(after.cliente_nombre || "—")}</td></tr>
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Anulado por</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(anuladorInfo.nombre || "—")}</td></tr>
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Elaborador</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(elaboradorInfo.nombre || "—")}</td></tr>
      </table>
    `;

    await db.collection("mail_queue").add({
      to,
      cc: cc || null,
      subject:     `Contrato ANULADO: ${contratoId} – ${after.cliente_nombre || "Cliente"}`,
      preheader,
      bodyContent: bodyHtml,
      ctaUrl:      "https://app.cecomunica.net/contratos/index.html",
      ctaLabel:    "Ver contratos",
      meta: {
        created_at:       admin.firestore.FieldValue.serverTimestamp(),
        source:           "contrato-anulado-notify",
        contrato_id:      contratoId,
        anulado_por_uid:  after.anulado_por_uid || null,
        creado_por_uid:   after.creado_por_uid  || null
      },
      status: "queued"
    });

    logger.info("[onContratoAnuladoNotify] Correo de anulación encolado", { contratoId, to, cc: cc || null });

    return null;
  }
);
