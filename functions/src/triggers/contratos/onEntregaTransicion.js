// Auto-registro de la transición de equipos al CONFIRMARSE LA ENTREGA del
// contrato nuevo (renovación / adición / reemplazo con origen vinculado).
//
// Regla de negocio (2026-07-20): en una renovación, TODO equipo de ALQUILER
// de los contratos originales se devuelve — la acción humana es la excepción,
// no la devolución. Momento elegido: la entrega del contrato nuevo (el
// cliente ya recibió los radios nuevos; ahora debe entregar los viejos).
//
// Qué hace: por cada contrato de origen vinculado, toma sus unidades del pool
// aún con el cliente (asignado_contrato / en_cliente) cuya propiedad NO sea
// del cliente, y crea mapeos de devolución en contratos/{cid}/mapeos.
// onMapeoWrite hace el resto (pendiente_devolucion + contador + kardex) y el
// recordatorio semanal de transiciones engancha solo. Se avisa por correo al
// vendedor del cliente + recepción con la lista a recuperar.
//
// La página de transición queda para las EXCEPCIONES (justificar no
// devoluciones, linaje opcional) y para contratos sin origen vinculado.
//
// Idempotencia: `transicion_auto_at` en el contrato + solo corre si aún no
// hay mapeos (transicion_mapeos_count == 0). Los equipos PROPIOS del cliente
// se omiten (son suyos). Contratos legacy quedan fuera (mismo corte que la CTA).

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { recepcionEmails } = require("../../lib/mailRecipients");
const { APP_BASE_URL } = require("../../lib/inventario");

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = onDocumentUpdated(
  { document: "contratos/{cid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data();
    const after  = event.data.after?.data();
    if (!before || !after) return null;

    const entregaConfirmada = !before.entrega_confirmada && after.entrega_confirmada === true;
    if (!entregaConfirmada) return null;

    const cid = event.params.cid;
    const contratoId = after.contrato_id || cid;

    // Solo transicionables con origen vinculado, sin mapeos previos, no legacy.
    const esTransicionable = !after.renovacion_sin_equipo
      && (after.accion === "Renovación" || after.accion === "Adición" || after.codigo_tipo === "REEMP");
    const origenIds = (Array.isArray(after.contrato_origen_ids) && after.contrato_origen_ids.length)
      ? after.contrato_origen_ids
      : (after.contrato_origen_id ? [after.contrato_origen_id] : []);
    if (!esTransicionable || !origenIds.length) return null;
    if (after.seriales_estado === "legacy") return null;
    if (Number(after.transicion_mapeos_count || 0) > 0) return null; // ya hay registro manual
    if (after.transicion_auto_at) return null;                        // ya corrió

    // Unidades de los orígenes aún con el cliente; alquiler solamente
    // (propiedad 'cliente' = equipos propios, no se devuelven).
    const unidades = [];
    for (const origenId of origenIds) {
      try {
        const snap = await db.collection("equipos_pool")
          .where("asignacion.contrato_doc_id", "==", origenId).get();
        snap.forEach((d) => {
          const u = d.data();
          if (!["asignado_contrato", "en_cliente"].includes(u.estado)) return;
          if (u.propiedad === "cliente") return;
          if (unidades.some(x => x.id === d.id)) return;
          unidades.push({ id: d.id, origenId, ...u });
        });
      } catch (e) {
        logger.warn("[onEntregaTransicion] No se pudo leer el pool del origen", { cid, origenId, message: e.message });
      }
    }

    if (!unidades.length) {
      // Origen vinculado pero sin unidades rastreadas (p.ej. origen legacy sin
      // seriales) — no se auto-cierra: la revisión queda manual en la página.
      logger.info("[onEntregaTransicion] Origen sin unidades en el pool; sin auto-registro", { contratoId, origenIds });
      return null;
    }

    // Mapeos de devolución (batch). onMapeoWrite marca pendiente_devolucion,
    // incrementa el contador y escribe el kardex de cada unidad.
    const batch = db.batch();
    const col = db.collection("contratos").doc(cid).collection("mapeos");
    unidades.forEach((u) => batch.set(col.doc(), {
      saliente: u.serial || u.serial_norm || u.id,
      saliente_pool_id: u.id,
      entrante: null,
      entrante_pool_id: null,
      modelo: u.modelo_label || "",
      modelo_id: u.modelo_id || null,
      contrato_id: contratoId,
      contrato_origen_id: u.origenId,
      auto: true,
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system",
    }));
    batch.set(db.collection("contratos").doc(cid), {
      transicion_auto_at: admin.firestore.FieldValue.serverTimestamp(),
      transicion_auto_unidades: unidades.length,
    }, { merge: true });
    await batch.commit();
    logger.info("[onEntregaTransicion] Devolución auto-registrada", { contratoId, unidades: unidades.length });

    // Aviso al vendedor del cliente + recepción (best-effort).
    try {
      let vendedor = null;
      if (after.cliente_id) {
        const cli = await db.collection("clientes").doc(after.cliente_id).get();
        const uidV = cli.exists ? cli.data().vendedor_asignado : null;
        if (uidV) {
          const u = await db.collection("usuarios").doc(uidV).get();
          const e = u.exists ? u.data().email : null;
          if (e) vendedor = String(e).toLowerCase();
        }
      }
      const recep = await recepcionEmails();
      const to = vendedor || recep[0];
      if (!to) { logger.warn("[onEntregaTransicion] Sin destinatarios para el aviso", { contratoId }); return null; }
      const cc = [...new Set([...(vendedor ? recep : recep.slice(1))])].filter(e => e !== to);

      const filas = unidades.slice(0, 40).map(u =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${esc(u.serial || u.id)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(u.modelo_label || "—")}</td></tr>`).join("");
      const extra = unidades.length > 40 ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${unidades.length - 40} más.</p>` : "";

      await db.collection("mail_queue").add({
        to,
        cc: cc.length ? cc.join(", ") : null,
        subject: `Equipos por recuperar: ${unidades.length} de ${after.cliente_nombre || "cliente"} (renovación ${contratoId})`,
        preheader: `La entrega de ${contratoId} activó la devolución de los equipos del contrato anterior`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Equipos por recuperar</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Se confirmó la entrega del contrato <b>${esc(contratoId)}</b> de
            <b>${esc(after.cliente_nombre || "—")}</b>. Los equipos de alquiler del contrato
            anterior quedaron <b>pendientes de devolución</b> — coordina la recuperación con el cliente.
            Si alguno NO se devuelve (renovación parcial, venta…), registra la excepción con su motivo
            en la página de transición.
          </p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>
          ${extra}`,
        ctaUrl: `${APP_BASE_URL}/contratos/transicion.html?id=${encodeURIComponent(cid)}`,
        ctaLabel: "Ver transición / registrar excepciones",
        meta: { source: "onEntregaTransicion", contrato_id: contratoId, unidades: unidades.length },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn("[onEntregaTransicion] Aviso no enviado (no crítico)", { contratoId, message: e.message });
    }

    return null;
  }
);
