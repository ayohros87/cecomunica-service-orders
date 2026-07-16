const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const pool = require("../../domain/equiposPool");

// Notifica y deriva el estado del contrato cuando una enmienda (baja/terminación)
// se crea / aprueba / rechaza / cierra. Usa admin SDK: las escrituras al contrato
// NO pasan por reglas (esquiva el guard touchesCFOwnedFields).
const TIPO_LABEL = { terminacion_total: "Terminación total", baja_parcial: "Baja parcial" };
const MOTIVO_LABEL = {
  fin_necesidad: "Fin de la necesidad / proyecto",
  precio: "Precio / presupuesto",
  servicio: "Insatisfacción con el servicio",
  fallas_equipo: "Fallas recurrentes del equipo",
  cierre_operacion: "Cierre / reducción de operación",
  morosidad: "Morosidad / falta de pago",
  cambio_proveedor: "Cambio de proveedor",
  migracion: "Migración tecnológica",
  otro: "Otro",
};

module.exports = onDocumentWritten(
  {
    document: "solicitudes_cancelacion/{id}",
    region: "us-central1",
    secrets: ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
  },
  async (event) => {
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after  = event.data.after?.exists  ? event.data.after.data()  : null;
    if (!after) return null;

    const id = event.params.id;
    const eb = before?.estado || null;
    const ea = after.estado   || null;

    const created  = !before;
    const approved = eb === "pendiente" && ea === "aprobada";
    const rejected = eb === "pendiente" && ea === "rechazada";
    const closed   = eb === "aprobada"  && ea === "cerrada";
    if (!created && !approved && !rejected && !closed) return null;
    const evento = created ? "created" : approved ? "approved" : rejected ? "rejected" : "closed";

    const escapeHtml = (v) => String(v ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
    const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
    const money = (n) => "$" + Number(n || 0).toFixed(2);

    const getUserInfo = async (uid) => {
      if (!uid) return { uid: null, nombre: "", email: "" };
      try {
        const snap = await db.collection("usuarios").doc(uid).get();
        if (!snap.exists) return { uid, nombre: uid, email: "" };
        const d = snap.data() || {};
        return { uid, nombre: d.nombre || d.email || uid, email: d.email || "" };
      } catch (e) {
        logger.warn("[onCancelacionWrite] No se pudo leer usuario", { uid, message: e.message });
        return { uid, nombre: uid, email: "" };
      }
    };

    const getApproverEmails = async () => {
      try {
        const snap = await db.collection("usuarios").where("rol", "in", ["administrador", "gerente"]).get();
        const emails = [];
        snap.forEach((d) => { const e = d.data()?.email; if (isEmail(e)) emails.push(e.trim().toLowerCase()); });
        return [...new Set(emails)];
      } catch (e) {
        logger.warn("[onCancelacionWrite] No se pudieron leer aprobadores", { message: e.message });
        return [];
      }
    };

    const contratoDocId = after.contrato_doc_id || null;
    const contratoId    = after.contrato_id || contratoDocId || "—";
    const cliente       = after.cliente_nombre || "—";
    const items         = Array.isArray(after.items) ? after.items : [];
    const itemsTxt      = items.map((i) => `${i.modelo || "—"} ×${Number(i.cantidad || 0)}`).join(", ") || "—";
    const finTs         = after.fecha_fin_facturacion || null;
    const finStr        = finTs?.toDate ? finTs.toDate().toLocaleDateString("es-PA") : "—";
    const tipoLabel     = TIPO_LABEL[after.tipo] || "Baja parcial";
    const motivoLabel   = MOTIVO_LABEL[after.motivo_codigo] || (after.motivo_codigo || "—");

    // ── 1) Derivar el estado del contrato (admin SDK) ───────────────────────
    if (contratoDocId) {
      try {
        const ref = db.collection("contratos").doc(contratoDocId);
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (created) {
          await ref.set({ baja_estado: "pendiente", baja_solicitud_id: id, baja_actualizado_at: now }, { merge: true });
        } else if (approved) {
          // Recalcula lo cancelado por modelo desde TODAS las enmiendas aprobadas/cerradas
          // del contrato (idempotente). Detecta si alguna es terminación total.
          const sols = await db.collection("solicitudes_cancelacion")
            .where("contrato_doc_id", "==", contratoDocId).get();
          const map = {};
          let terminacionTotal = false;
          let terminacionFin = null;
          sols.forEach((s) => {
            const sd = s.data();
            if (sd.estado !== "aprobada" && sd.estado !== "cerrada") return;
            (sd.items || []).forEach((it) => {
              const key = String(it.modelo_id || it.modelo || "").trim();
              const q = Number(it.cantidad || 0);
              if (!key || q <= 0) return;
              map[key] = Number(map[key] || 0) + q;
            });
            if (sd.tipo === "terminacion_total") { terminacionTotal = true; terminacionFin = sd.fecha_fin_facturacion || terminacionFin; }
          });
          const total = Object.values(map).reduce((s, v) => s + Number(v || 0), 0);
          const payload = {
            baja_estado: "aprobada",
            baja_solicitud_id: id,
            baja_fecha_fin: finTs,
            baja_cancelado: map,
            baja_cancelado_total: total,
            baja_actualizado_at: now,
          };
          if (terminacionTotal) { payload.terminacion_total = true; payload.terminacion_fin = terminacionFin; }
          await ref.set(payload, { merge: true });
        } else if (rejected) {
          await ref.set({
            baja_estado: admin.firestore.FieldValue.delete(),
            baja_solicitud_id: admin.firestore.FieldValue.delete(),
            baja_actualizado_at: now,
          }, { merge: true });
        } else if (closed) {
          await ref.set({ baja_cerrada_at: now }, { merge: true });
        }
      } catch (e) {
        logger.warn("[onCancelacionWrite] No se pudo derivar el contrato", { contratoDocId, message: e.message });
      }
    }

    // ── 1b) Entradas de equipos al cierre → cuarentena de inspección ────────
    // El checklist del cierre (cancelaciones.js) trae las unidades del pool que
    // el cliente devolvió (`entradas`: pool_doc_id + condición). Aquí se
    // transicionan a devuelto_revision ("Entrada — por inspeccionar"); la
    // salida es la inspección en Inventario · Equipos por serial (→ bodega o
    // baja). Server-side por diseño: los cruces al pool van con Admin SDK.
    if (closed && Array.isArray(after.entradas) && after.entradas.length) {
      const COND_LABEL = { bueno: "buen estado", danado: "dañado" };
      for (const ent of after.entradas) {
        if (!ent || !ent.pool_doc_id) continue;
        try {
          const r = await pool.transicionarPorId(String(ent.pool_doc_id), {
            aEstado: pool.ESTADOS.DEVUELTO,
            soloDesde: [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE],
            tipo: "devolucion",
            refMov: { tipo: "cancelacion", id, label: contratoId },
            notas: `Entrada por ${tipoLabel.toLowerCase()} — ${COND_LABEL[ent.condicion] || ent.condicion || "condición sin registrar"}. Pendiente de inspección.`,
            extra: {
              asignacion: null,
              entrada: {
                condicion: ent.condicion || null,
                solicitud_id: id,
                at: admin.firestore.FieldValue.serverTimestamp(),
              },
            },
          });
          logger.info("[onCancelacionWrite] Entrada al pool", { id, pool_doc_id: ent.pool_doc_id, resultado: r });
        } catch (e) {
          logger.warn("[onCancelacionWrite] Entrada al pool falló (no crítico)", { id, pool_doc_id: ent.pool_doc_id, message: e.message });
        }
      }
    }

    // ── 2) Correo ───────────────────────────────────────────────────────────
    const baseUrl = "https://app.cecomunica.net/contratos/cancelaciones.html";
    const filaTabla = `
      <table role="presentation" width="100%" style="font:14px Arial,sans-serif; margin:12px 0 16px;">
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Contrato</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(contratoId)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(cliente)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(tipoLabel)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Equipos</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(itemsTxt)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Motivo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(motivoLabel)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Fin de facturación</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${escapeHtml(finStr)}</td></tr>
      </table>`;
    const liquidHtml = (after.aplica_penalidad && Number(after.penalidad_monto || 0) > 0) || (after.deposito_accion && after.deposito_accion !== "na")
      ? `<p style="margin:0 0 12px;font:13px/1.5 Arial,sans-serif;color:#374151;">
           ${after.aplica_penalidad && Number(after.penalidad_monto || 0) > 0 ? `Penalidad: <b>${money(after.penalidad_monto)}</b>. ` : ""}
           ${after.deposito_accion && after.deposito_accion !== "na" ? `Depósito: ${after.deposito_accion === "devolver" ? "devolver" : "retener"} <b>${money(after.deposito_monto)}</b>.` : ""}
         </p>`
      : "";

    let subject, preheader, bodyHtml, ctaLabel, recipients;

    if (created) {
      const [approvers, solicitante] = await Promise.all([getApproverEmails(), getUserInfo(after.solicitado_por || null)]);
      recipients = [...approvers];
      if (isEmail(solicitante.email)) recipients.push(solicitante.email.trim().toLowerCase());
      subject   = `Enmienda (${tipoLabel}): ${contratoId} – ${cliente}`;
      preheader = `Nueva enmienda pendiente de aprobación · ${cliente}`;
      ctaLabel  = "Revisar enmienda";
      bodyHtml  = `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Enmienda de contrato</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">Hay una nueva enmienda <b>pendiente de aprobación</b>.</p>
        ${filaTabla}${liquidHtml}
        ${after.motivo_detalle ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#374151;"><b>Observaciones:</b> ${escapeHtml(after.motivo_detalle)}</p>` : ""}
        <p style="margin:0 0 12px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">Solicitó: ${escapeHtml(after.solicitado_por_nombre || "—")}</p>`;
    } else {
      const [solicitante, aprobador] = await Promise.all([getUserInfo(after.solicitado_por || null), getUserInfo(after.aprobado_por || after.cerrado_por || null)]);
      recipients = [];
      if (isEmail(solicitante.email)) recipients.push(solicitante.email.trim().toLowerCase());
      if (isEmail(aprobador.email))   recipients.push(aprobador.email.trim().toLowerCase());
      if (approved) {
        subject   = `Enmienda APROBADA: ${contratoId} – ${cliente}`;
        preheader = `Aprobada · se factura hasta ${finStr}`;
        ctaLabel  = "Ver enmiendas";
        bodyHtml  = `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065f46;">Enmienda aprobada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">La enmienda fue <b>aprobada</b>. Se facturará hasta <b>${escapeHtml(finStr)}</b> (último tramo prorrateado). Procede la recuperación de los equipos.</p>
          ${filaTabla}${liquidHtml}`;
      } else if (closed) {
        subject   = `Enmienda CERRADA: ${contratoId} – ${cliente}`;
        preheader = `Equipos recuperados · enmienda cerrada`;
        ctaLabel  = "Ver enmiendas";
        bodyHtml  = `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#1e40af;">Enmienda cerrada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">Los equipos fueron recuperados y la enmienda quedó <b>cerrada</b>.</p>
          ${filaTabla}
          ${after.condicion_notas ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;color:#374151;"><b>Condición:</b> ${escapeHtml(after.condicion_notas)}</p>` : ""}`;
      } else {
        subject   = `Enmienda RECHAZADA: ${contratoId} – ${cliente}`;
        preheader = `Enmienda rechazada · ${cliente}`;
        ctaLabel  = "Ver enmiendas";
        bodyHtml  = `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991b1b;">Enmienda rechazada</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">La enmienda fue <b>rechazada</b>.</p>
          ${filaTabla}
          ${after.motivo_rechazo ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #b91c1c;border-radius:10px;background:#fef2f2;font:700 14px Arial,sans-serif;color:#991b1b;">Motivo: ${escapeHtml(after.motivo_rechazo)}</div>` : ""}`;
      }
    }

    const unique = [...new Set(recipients)];
    if (!unique.length) {
      logger.warn("[onCancelacionWrite] Sin destinatarios válidos", { id, evento });
      return null;
    }

    await db.collection("mail_queue").add({
      to: unique[0],
      cc: unique.length > 1 ? unique.slice(1).join(",") : null,
      subject,
      preheader,
      bodyContent: bodyHtml,
      ctaUrl: baseUrl,
      ctaLabel,
      meta: {
        created_at:   admin.firestore.FieldValue.serverTimestamp(),
        source:       "cancelacion-notify",
        evento,
        solicitud_id: id,
        contrato_id:  contratoId,
      },
      status: "queued",
    });

    logger.info("[onCancelacionWrite] Correo encolado", { id, to: unique[0], evento });
    return null;
  }
);
