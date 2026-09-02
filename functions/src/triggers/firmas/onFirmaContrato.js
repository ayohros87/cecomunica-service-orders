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
    texto_version: s.documento?.texto_version || null,
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
      // La versión del texto legal que el firmante leyó (copia congelada en
      // la solicitud); null = firma anterior al congelado (solo resumen).
      texto_version: s.documento?.texto_version || null,
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

// Anexo de aumento firmado digitalmente: la transición pendiente_firma →
// pendiente_bodega + cierre.firma es EXACTAMENTE la que onGestionWrite (B3)
// espera — él aplica las líneas al contrato y avisa a bodega; aquí solo se
// registra la firma con su rastro.
async function aplicarAnexo(sid, s, extraFirma = {}) {
  const gRef = db.collection("gestiones").doc(s.gestion_id);
  const gSnap = await gRef.get();
  if (!gSnap.exists) { logger.error("[onFirmaContrato] gestión del anexo no existe", { sid }); return null; }
  const g = gSnap.data();
  const f = s.firma || {};
  const hash = hashFirma({
    contrato_id: `${s.gestion_id}|${s.contrato_id || ""}`,
    firmante_nombre: f.nombre, firmante_cedula: f.cedula,
    firmado_at: f.firmado_at?.toDate ? f.firmado_at.toDate().toISOString() : String(f.firmado_at || ""),
    total_mensual: s.resumen?.total_mensual,
    texto_version: s.documento?.texto_version || null,
  });
  const upd = {
    "cierre.firma": true,
    anexo_firma_digital: {
      solicitud_id: sid,
      firmante_nombre: f.nombre || "",
      firmante_cedula: f.cedula || "",
      firmante_cargo: f.cargo || "",
      firmado_at: f.firmado_at || admin.firestore.Timestamp.now(),
      hash,
      texto_version: s.documento?.texto_version || null,
      coincide_representante: s.firmante_coincide !== false,
      ...extraFirma,
    },
    firma_solicitud_estado: "activado",
    firma_pendiente_validacion: admin.firestore.FieldValue.delete(),
  };
  if (g.estado === "pendiente_firma") upd.estado = "pendiente_bodega";
  await gRef.update(upd);
  await G.registrarEvento(s.gestion_id, "firma",
    `Anexo firmado DIGITALMENTE por ${f.nombre || "—"} (cédula ${f.cedula || "—"}) — hash ${hash.slice(0, 12)}…; pasa a bodega.`);
  return { g, hash };
}

// Detalle del anexo firmado, desde el snapshot de la solicitud (2026-09-02:
// "en todos los emails se vea claro de qué se trata").
function resumenAnexoHtml(s) {
  const r = s.resumen || {};
  let html = "";
  const filas = [
    ...(r.equipos || []).map((l) => [String(Number(l.cantidad || 0)),
      G.escapeHtml(l.modelo || "—") + (l.modalidad === "propio" ? " — equipo del cliente" : ""),
      `$${Number(l.precio || 0).toFixed(2)}/mes`]),
    ...(r.cargos || []).map((c) => [String(Number(c.cantidad || 1)),
      G.escapeHtml(c.concepto || "—") + ((c.seriales || []).length ? ` — <code>${c.seriales.map(G.escapeHtml).join(", ")}</code>` : ""),
      `$${Number(c.monto || 0).toFixed(2)}${c.recurrente ? "/mes" : ""}`]),
  ];
  if (filas.length) html += G.tablaHtml(["Cant.", "Detalle", "Monto"], filas);
  if ((s.ajustes_precio || []).length) {
    html += G.tablaHtml(["Tarifa renegociada", "Antes", "Ahora"], s.ajustes_precio.map((x) => [
      G.escapeHtml(x.modelo || "—"),
      `$${Number(x.precio_anterior || 0).toFixed(2)}`,
      `<b>$${Number(x.precio_nuevo || 0).toFixed(2)}</b>`]));
  }
  if (r.total_mensual != null) {
    html += `<p style="margin:8px 0 0;font:14px Arial,sans-serif;">Total mensual del anexo: <b>$${Number(r.total_mensual || 0).toFixed(2)}</b></p>`;
  }
  return html;
}

async function correo(to, cc, subject, cuerpo, ctaUrl, ctaLabel, meta) {
  try {
    await G.encolarCorreo({ to, cc, subject, preheader: subject, bodyContent: cuerpo, ctaUrl, ctaLabel, meta });
  } catch (e) { logger.warn("[onFirmaContrato] correo no encolado", { message: e.message }); }
}

// La COPIA del cliente (2026-09-01, pedido de Alberto): al quedar firmado, el
// cliente recibe por correo el enlace de su copia — /firmar/?s= muestra el
// documento CONGELADO que leyó, con el rastro de la firma, en modo lectura.
async function correoCopiaCliente(sid, s, esAnexo) {
  try {
    const cli = await db.collection("clientes").doc(s.cliente_id || "-").get();
    if (!cli.exists) return;
    const c = cli.data();
    const email = [c.representante_email, c.email]
      .find((e) => typeof e === "string" && e.includes("@") && !e.endsWith("@sin.email.cecomunica.com"));
    if (!email) {
      logger.info("[onFirmaContrato] cliente sin email — copia no enviada", { sid, cliente: s.cliente_id });
      return;
    }
    const f = s.firma || {};
    const etiqueta = esAnexo ? `anexo ${s.gestion_id || ""} al contrato ${s.contrato_id || ""}` : `contrato ${s.contrato_id || ""}`;
    await correo(email, null,
      `Su ${esAnexo ? "anexo" : "contrato"} ${esAnexo ? (s.gestion_id || "") : (s.contrato_id || "")} firmado — copia y constancia`,
      `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Gracias — su firma quedó registrada</h2>
       <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
         El ${G.escapeHtml(etiqueta)} con <b>C COMUNICA, S.A.</b> fue firmado por
         <b>${G.escapeHtml(f.nombre || "—")}</b>. Con el botón puede abrir <b>su copia</b>:
         el documento completo tal como lo firmó, con la constancia de la firma.
         Le recomendamos conservar este correo.</p>
       ${resumenAnexoHtml(s)}`,
      `${APP_BASE_URL}/firmar/?s=${sid}`, esAnexo ? "Ver mi anexo firmado" : "Ver mi contrato firmado",
      { firma_solicitud: sid, paso: "copia_cliente" });
  } catch (e) { logger.warn("[onFirmaContrato] copia al cliente falló", { sid, message: e.message }); }
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

        // ── Anexo de aumento ──
        if (after.tipo === "anexo_aumento") {
          if (coincide) {
            const r = await aplicarAnexo(sid, { ...after, firmante_coincide: true });
            await ref.update({ estado: "activado", firmante_coincide: true, hash: r?.hash || null,
              procesado_at: admin.firestore.FieldValue.serverTimestamp() });
            await correo(ventas, vendedor, `Anexo ${after.gestion_id} FIRMADO digitalmente — ${after.cliente_nombre || ""}`,
              `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Anexo de aumento firmado</h2>
               <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                 El anexo <b>${G.escapeHtml(after.gestion_id || "")}</b> al contrato <b>${G.escapeHtml(after.contrato_id || "")}</b>
                 de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b> fue firmado digitalmente por
                 <b>${G.escapeHtml(f.nombre || "—")}</b> — coincide con el representante registrado.
                 ${after.es_ajuste
                   ? "El ajuste de tarifa/servicios se aplicó al contrato — no requiere bodega ni entrega."
                   : after.es_regularizacion
                   ? "Los equipos (ya en poder del cliente) quedaron amarrados al contrato — sin bodega ni entrega."
                   : "Las líneas se aplicaron al contrato y Bodega ya tiene la asignación en su bandeja."}</p>
               ${resumenAnexoHtml(after)}`,
              urlFicha, "Abrir la ficha del cliente", { firma_solicitud: sid, resultado: "activado" });
            await correoCopiaCliente(sid, after, true);
            logger.info("[onFirmaContrato] anexo firmado", { sid, gestion: after.gestion_id });
          } else {
            await ref.update({ estado: "validacion", firmante_coincide: false,
              procesado_at: admin.firestore.FieldValue.serverTimestamp() });
            await db.collection("gestiones").doc(after.gestion_id).update({
              firma_pendiente_validacion: true,
              firma_solicitud_id: sid,
              firma_solicitud_estado: "validacion",
            });
            await correo(ventas, vendedor, `Validar firmante: anexo ${after.gestion_id} firmado por persona distinta al representante`,
              `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Firma del anexo recibida — falta validar al firmante</h2>
               <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                 El anexo <b>${G.escapeHtml(after.gestion_id || "")}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>
                 fue firmado, pero el firmante <b>no coincide</b> con el representante registrado. Se aplica cuando
                 ventas acepte al firmante (botón en el expediente de la gestión).</p>
               ${tabla}
               <p style="margin:12px 0 4px;font:14px Arial,sans-serif;"><b>Qué contiene el anexo:</b></p>
               ${resumenAnexoHtml(after)}`,
              urlFicha, "Revisar y aceptar firmante", { firma_solicitud: sid, resultado: "validacion" });
            logger.info("[onFirmaContrato] anexo en validación", { sid, gestion: after.gestion_id });
          }
          return null;
        }

        if (coincide) {
          const r = await activarContrato(sid, { ...after, firmante_coincide: true });
          await ref.update({ estado: "activado", firmante_coincide: true, hash: r?.hash || null,
            procesado_at: admin.firestore.FieldValue.serverTimestamp() });
          await correo(ventas, vendedor, `Contrato ${after.contrato_id} FIRMADO digitalmente y activado — ${after.cliente_nombre || ""}`,
            `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Contrato firmado y activado</h2>
             <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
               <b>${G.escapeHtml(after.contrato_id || "")}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b> fue firmado
               digitalmente por <b>${G.escapeHtml(f.nombre || "—")}</b> (cédula ${G.escapeHtml(f.cedula || "—")}) — coincide con el
               representante registrado — y quedó <b>activo</b>. La firma, el rastro y el sello de verificación quedaron en el contrato.</p>
             ${resumenAnexoHtml(after)}`,
            urlFicha, "Abrir la ficha del cliente", { firma_solicitud: sid, resultado: "activado" });
          await correoCopiaCliente(sid, after, false);
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
             ${tabla}
             <p style="margin:12px 0 4px;font:14px Arial,sans-serif;"><b>Qué contiene el contrato:</b></p>
             ${resumenAnexoHtml(after)}`,
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
        const r = after.tipo === "anexo_aumento"
          ? await aplicarAnexo(sid, { ...after, firmante_coincide: false },
              { validado_por_uid: after.validado_por_uid || null })
          : await activarContrato(sid, { ...after, firmante_coincide: false },
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
        const esAnexo = after.tipo === "anexo_aumento";
        await correo(ventas, vendedor,
          esAnexo ? `Anexo ${after.gestion_id} APLICADO — firmante validado`
                  : `Contrato ${after.contrato_id} ACTIVADO — firmante validado`,
          `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#065F46;">Firmante validado</h2>
           <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
             Ventas aceptó a <b>${G.escapeHtml(after.firma?.nombre || "—")}</b> como firmante
             ${esAnexo
               ? `del anexo <b>${G.escapeHtml(after.gestion_id || "")}</b> al contrato <b>${G.escapeHtml(after.contrato_id || "")}</b>${after.es_ajuste ? " (ajuste de tarifa/servicios — sin bodega)" : after.es_regularizacion ? " (regularización — sin bodega)" : ": las líneas se aplicaron y Bodega ya tiene la asignación"}.`
               : `del contrato <b>${G.escapeHtml(after.contrato_id || "")}</b> de <b>${G.escapeHtml(after.cliente_nombre || "—")}</b>; el contrato quedó <b>activo</b>.`}
             ${after.actualizar_ficha ? " La ficha del cliente se actualizó con el nuevo representante." : ""}</p>
           ${resumenAnexoHtml(after)}`,
          `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(after.cliente_id || "")}`,
          "Abrir la ficha del cliente", { firma_solicitud: sid, resultado: "aceptado" });
        await correoCopiaCliente(sid, after, esAnexo);
        logger.info("[onFirmaContrato] firmante aceptado y contrato activado", { sid, contrato: after.contrato_id });
      } catch (e) {
        logger.error("[onFirmaContrato] fallo aceptando firmante", { sid, message: e.message });
      }
      return null;
    }

    return null;
  }
);
