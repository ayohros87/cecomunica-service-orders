// Firma digital del contrato (2026-08-28) — el ejecutor de firma_solicitudes.
//
// Flujo: el vendedor genera el ENLACE (doc con id-portador + snapshot del
// contrato), el cliente lo abre sin sesión, dibuja su firma y declara quién
// es. Este trigger reacciona a las dos transiciones:
//
//   pendiente → firmado (la firma del cliente, escrita por rules públicas):
//     · firmante COINCIDE con el representante registrado (lib/firmas —
//       la cédula manda) → el contrato se marca firmado digital y, si estaba
//       'aprobado', pasa a 'activo' EN EL MISMO ACTO (onContratoActivado
//       estampa la verificación HMAC + QR como con cualquier activación).
//       Correo informativo a ventas + vendedor.
//     · NO coincide (apoderado, gerente, representante desactualizado) → la
//       firma queda REGISTRADA con todo su rastro y el contrato en
//       "firmado — pendiente de validar firmante": correo a ventas con el
//       contraste y el visto bueno se da desde la ficha (Centro).
//
//   validacion → aceptado (ventas, autenticado): activa el contrato y, si se
//     marcó actualizar_ficha, corrige el representante en clientes/ — cada
//     trámite deja el directorio mejor que como lo encontró.
//
// La foto de WhatsApp queda como respaldo (contratos-upload con multi-foto).
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { firmanteCoincide, hashFirma } = require("../../lib/firmas");
const G = require("../../lib/gestiones");
const { APP_BASE_URL } = require("../../lib/inventario");

async function activarContrato(sid, s, extraFirmado = {}) {
  const cRef = db.collection("contratos").doc(s.contrato_doc_id);
  const cSnap = await cRef.get();
  if (!cSnap.exists) { logger.error("[onFirmaContrato] contrato no existe", { sid }); return null; }
  const c = cSnap.data();
  const ahora = admin.firestore.Timestamp.now();
  const f = s.firma || {};
  const hash = hashFirma({
    contrato_id: c.contrato_id || s.contrato_doc_id,
    firmante_nombre: f.nombre, firmante_cedula: f.cedula,
    firmado_at: f.firmado_at?.toDate ? f.firmado_at.toDate().toISOString() : String(f.firmado_at || ""),
    total_mensual: c.total_mensual,
  });
  const upd = {
    firmado: true,
    firmado_tipo: "digital",
    firmado_fecha: ahora,
    firmado_digital: {
      solicitud_id: sid,
      firmante_nombre: f.nombre || "",
      firmante_cedula: f.cedula || "",
      firmante_cargo: f.cargo || "",
      firmado_at: f.firmado_at || ahora,
      hash,
      coincide_representante: s.firmante_coincide !== false,
      ...extraFirmado,
    },
    firmado_pendiente_validacion: admin.firestore.FieldValue.delete(),
    firma_solicitud_estado: "activado",
    fecha_modificacion: new Date(),
  };
  if (c.estado === "aprobado") {
    upd.estado_previo = c.estado;
    upd.estado = "activo";
    upd.fecha_activacion = ahora;
  }
  await cRef.update(upd);
  return { c, hash };
}

async function correo(to, cc, subject, cuerpo, ctaUrl, ctaLabel, meta) {
  try {
    await G.encolarCorreo({ to, cc, subject, preheader: subject, bodyContent: cuerpo, ctaUrl, ctaLabel, meta });
  } catch (e) { logger.warn("[onFirmaContrato] correo no encolado", { message: e.message }); }
}

module.exports = onDocumentUpdated(
  { document: "firma_solicitudes/{sid}", region: "us-central1" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    const sid = event.params.sid;
    const ref = event.data.after.ref;

    // ── Firma recibida ──
    if (before.estado === "pendiente" && after.estado === "firmado") {
      try {
        const coincide = firmanteCoincide(after.representante, after.firma);
        const ventas = await G.aprobacionesTo();
        const vendedor = await G.vendedorEmailDeCliente(after.cliente_id);
        const urlFicha = `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(after.cliente_id || "")}`;
        const f = after.firma || {};
        const tabla = G.tablaHtml(["", "Registrado", "Firmó"], [
          ["Nombre", G.escapeHtml(after.representante?.nombre || "—"), G.escapeHtml(f.nombre || "—")],
          ["Cédula", G.escapeHtml(after.representante?.cedula || "—"), G.escapeHtml(f.cedula || "—")],
          ["Cargo", "representante legal", G.escapeHtml(f.cargo || "—")],
        ]);

        if (coincide) {
          const r = await activarContrato(sid, { ...after, firmante_coincide: true });
          await ref.update({ estado: "activado", firmante_coincide: true, hash: r?.hash || null,
            procesado_at: admin.firestore.FieldValue.serverTimestamp() });
          await correo(ventas, vendedor, `Contrato ${after.contrato_id} FIRMADO digitalmente y activado — ${after.cliente_nombre || ""}`,
            `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Contrato firmado y activado</h2>
             <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
               <b>${G.escapeHtml(after.contrato_id || "")}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b> fue firmado
               digitalmente por <b>${G.escapeHtml(f.nombre || "—")}</b> (cédula ${G.escapeHtml(f.cedula || "—")}) — coincide con el
               representante registrado — y quedó <b>activo</b>. La firma, el rastro y el sello de verificación quedaron en el contrato.</p>`,
            urlFicha, "Abrir la ficha del cliente", { firma_solicitud: sid, resultado: "activado" });
          logger.info("[onFirmaContrato] firmado y activado", { sid, contrato: after.contrato_id });
        } else {
          await ref.update({ estado: "validacion", firmante_coincide: false,
            procesado_at: admin.firestore.FieldValue.serverTimestamp() });
          await db.collection("contratos").doc(after.contrato_doc_id).update({
            firmado_pendiente_validacion: true,
            firma_solicitud_id: sid,
            firma_solicitud_estado: "validacion",
            fecha_modificacion: new Date(),
          });
          await correo(ventas, vendedor, `Validar firmante: contrato ${after.contrato_id} firmado por persona distinta al representante`,
            `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Firma recibida — falta validar al firmante</h2>
             <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
               El contrato <b>${G.escapeHtml(after.contrato_id || "")}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>
               fue firmado digitalmente, pero el firmante <b>no coincide</b> con el representante legal registrado.
               La firma quedó registrada con su rastro completo; el contrato se activa cuando ventas acepte al firmante
               (botón en la ficha del cliente, vista del contrato).</p>
             ${tabla}`,
            urlFicha, "Revisar y aceptar firmante", { firma_solicitud: sid, resultado: "validacion" });
          logger.info("[onFirmaContrato] firma en validación", { sid, contrato: after.contrato_id });
        }
      } catch (e) {
        logger.error("[onFirmaContrato] fallo procesando la firma", { sid, message: e.message });
      }
      return null;
    }

    // ── Ventas aceptó al firmante ──
    if (before.estado === "validacion" && after.estado === "aceptado") {
      try {
        const r = await activarContrato(sid, { ...after, firmante_coincide: false },
          { validado_por_uid: after.validado_por_uid || null });
        await ref.update({ estado: "activado", hash: r?.hash || null,
          procesado_at: admin.firestore.FieldValue.serverTimestamp() });
        if (after.actualizar_ficha === true && after.cliente_id && after.firma?.nombre) {
          // El directorio se corrige solo: el firmante aceptado pasa a ser el
          // representante registrado del cliente.
          await db.collection("clientes").doc(after.cliente_id).update({
            representante: after.firma.nombre,
            representante_cedula: after.firma.cedula || "",
          }).catch((e) => logger.warn("[onFirmaContrato] ficha no actualizada", { message: e.message }));
        }
        const vendedor = await G.vendedorEmailDeCliente(after.cliente_id);
        const ventas = await G.aprobacionesTo();
        await correo(ventas, vendedor, `Contrato ${after.contrato_id} ACTIVADO — firmante validado`,
          `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Firmante validado — contrato activo</h2>
           <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
             Ventas aceptó a <b>${G.escapeHtml(after.firma?.nombre || "—")}</b> como firmante del contrato
             <b>${G.escapeHtml(after.contrato_id || "")}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>;
             el contrato quedó <b>activo</b>.${after.actualizar_ficha ? " La ficha del cliente se actualizó con el nuevo representante." : ""}</p>`,
          `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(after.cliente_id || "")}`,
          "Abrir la ficha del cliente", { firma_solicitud: sid, resultado: "aceptado" });
        logger.info("[onFirmaContrato] firmante aceptado y contrato activado", { sid, contrato: after.contrato_id });
      } catch (e) {
        logger.error("[onFirmaContrato] fallo aceptando firmante", { sid, message: e.message });
      }
      return null;
    }

    return null;
  }
);
