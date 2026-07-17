const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");
const { crearOrdenEntrada } = require("../../lib/ordenEntrada");

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

    // Pool de equipos: las unidades asignadas a ESTE contrato entran en
    // cuarentena de inspección (devuelto_revision — "Entrada"): todo lo que
    // regresa de un cliente se inspecciona antes de volver a bodega
    // (PLAN_CICLO_VIDA_EQUIPOS.md §3.2). Los docs de contratos/{id}/seriales
    // NO se borran (historial del contrato anulado), así que onSerialWrite
    // nunca dispara esta transición — se hace aquí. No crítico: un fallo no
    // debe bloquear el correo de anulación.
    try {
      const cid = event.params.docId;
      const serialesSnap = await db.collection("contratos").doc(cid)
        .collection("seriales").get();
      let liberados = 0;
      const devueltos = []; // para la orden de ENTRADA (inspección en taller)
      for (const d of serialesSnap.docs) {
        const s = d.data() || {};
        const serial = (s.serial || "").toString().trim();
        if (!serial) continue;
        const r = await pool.transicionar(serial, s.modelo_id, s.modelo, {
          aEstado: pool.ESTADOS.DEVUELTO,
          soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
          condicion: (data) => data.asignacion?.contrato_doc_id === cid,
          tipo: "devolucion",
          refMov: { tipo: "contrato", id: cid, label: contratoId },
          notas: `Entrada por anulación de contrato (${motivoAnulacion}) — pendiente de inspección`,
          extra: { asignacion: null, verificado: false },
        });
        if (r === "transicion") {
          liberados++;
          devueltos.push({ serial, modelo: s.modelo || "", modelo_id: s.modelo_id || null });
        }
      }
      if (serialesSnap.size) {
        logger.info("[onContratoAnuladoNotify] Pool: seriales a inspección por anulación", {
          contratoId, total: serialesSnap.size, liberados
        });
      }

      // Orden de ENTRADA para el taller (inspección de los devueltos) + correo
      // a recepción y al vendedor. Solo si alguna unidad entró en cuarentena.
      if (devueltos.length && !after.orden_entrada_id) {
        try {
          const ordenId = await crearOrdenEntrada({
            clienteId: after.cliente_id || null,
            clienteNombre: after.cliente_nombre || "",
            contratoDocId: cid,
            contratoId,
            unidades: devueltos,
            motivo: `Anulación de contrato (${motivoAnulacion})`,
            refEntrada: { tipo: "anulacion", id: cid },
          });
          if (ordenId) {
            await db.collection("contratos").doc(cid)
              .set({ orden_entrada_id: ordenId }, { merge: true });
          }
        } catch (e) {
          logger.warn("[onContratoAnuladoNotify] Orden de entrada falló (no crítico)", { contratoId, message: e.message });
        }
      }
    } catch (e) {
      logger.warn("[onContratoAnuladoNotify] Pool: liberación por anulación falló (no crítico)", {
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
