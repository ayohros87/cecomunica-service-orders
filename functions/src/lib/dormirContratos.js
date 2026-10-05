// Duerme los contratos aprobados sin firmar a los 45 días de su aprobación
// (decisión 7 de Alberto, 1-oct-2026; desde la aprobación, 2-oct-2026): caduca
// la solicitud de firma y marca el contrato como dormido. Desde el 2-oct
// también los ANEXOS de aumento en 'pendiente_firma' (anexosDormidos). La regla vive en domain/contratoDormido; esto es el recorrido
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
    // La edad sale solo del contrato (aprobación o reactivación).
    const dec = D.decidirDormir({ contrato: c, now, dias });
    if (!dec.dormir) continue;
    // La solicitud pendiente (si la hay) caduca con él.
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

  const anexos = await dormirAnexosSinFirma({ dryRun, now, dias, tag });
  // Lo que apartan los anexos dormidos: avisos, retención vencida, soltar
  // o dejar a bodega (Alberto, 5-oct-2026 — domain/anexoDormido).
  const anexosPlazo = await soltarAnexosDormidos({ dryRun, now, tag });

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { scanned, candidatos, dormidos, enlacesCaducados, mails, errors, muestra, anexos, anexosPlazo, elapsedSec };
}

// Anexos de aumento aprobados sin firmar a los 45 días (Alberto, 2-oct-2026):
// la gestión sigue en 'pendiente_firma' con la marca dormido; la solicitud
// caduca; aviso al vendedor (el mismo buzón que el recordatorio J).
async function dormirAnexosSinFirma({ dryRun = false, now = new Date(), dias = D.DIAS_DORMIDO, tag = "dormirContratos" } = {}) {
  const G = require("./gestiones");
  const FV = admin.firestore.FieldValue;
  const snap = await db.collection("gestiones")
    .where("estado", "==", "pendiente_firma")
    .limit(500).get();

  let scanned = 0, candidatos = 0, dormidos = 0, enlacesCaducados = 0, mails = 0, errors = 0;
  const muestra = [];
  for (const doc of snap.docs) {
    scanned++;
    const g = doc.data() || {};
    if (!D.anexoEsperaFirmaViva(g)) continue;
    candidatos++;
    const dec = D.decidirDormirAnexo({ gestion: g, now, dias });
    if (!dec.dormir) continue;
    let solRef = null;
    if (g.firma_solicitud_id && g.firma_solicitud_estado === "pendiente") {
      try {
        const ref = db.collection("firma_solicitudes").doc(g.firma_solicitud_id);
        const s = await ref.get();
        if (s.exists && (s.data() || {}).estado === "pendiente") solRef = ref;
      } catch (e) {
        logger.warn(`[${tag}] solicitud del anexo no leída`, { gid: doc.id, err: e.message });
      }
    }
    dormidos++;
    if (solRef) enlacesCaducados++;
    if (muestra.length < 25) muestra.push(`${doc.id}: ${dec.porQue}${solRef ? " · enlace caducado" : ""}`);
    if (dryRun) continue;
    try {
      const batch = db.batch();
      batch.update(doc.ref, D.patchDormirAnexo({ gestion: g, dias: dec.dias, ahora: FV.serverTimestamp(), teniaEnlace: !!solRef, borrar: FV.delete() }));
      if (solRef) batch.update(solRef, D.patchCaducarSolicitud(FV.serverTimestamp()));
      await batch.commit();
    } catch (e) {
      errors++;
      logger.error(`[${tag}] no se pudo dormir el anexo`, { gid: doc.id, err: e.message });
      continue;
    }
    await G.registrarEvento(doc.id, "dormido",
      `Anexo dormido: ${dec.dias} días aprobado sin la firma del cliente. La solicitud y el enlace de firma caducaron; lo reactiva el vendedor.`);
    try {
      const to = g.responsable_email || await G.vendedorEmailDeCliente(g.cliente_id);
      if (!to) continue;
      const a = g.aumento || {};
      await G.encolarCorreo({
        to,
        subject: `Anexo ${doc.id} quedó dormido: ${dec.dias} días sin firma — ${g.cliente_nombre || "Cliente"}`,
        preheader: "La solicitud y el enlace de firma caducaron",
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Anexo dormido</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            El anexo de aumento <b>${G.escapeHtml(doc.id)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>
            ${a.contrato_id ? `(contrato <b>${G.escapeHtml(a.contrato_id)}</b>) ` : ""}lleva <b>${dec.dias} días</b>
            aprobado sin la firma del cliente. La solicitud y el enlace de firma caducaron y el anexo quedó
            <b>dormido</b>: ya no cuenta como trámite de la cuenta.</p>
          <p style="margin:0;font:14px/1.5 Arial,sans-serif;">
            Si el cliente todavía va a firmar, reactívalo desde la ficha del cliente
            (<b>Reactivar la solicitud</b>): se genera un enlace nuevo. Si no, tienes <b>15 días</b> para decidir qué
            pasa con los equipos apartados: <b>Retenerlos</b> (30 días más) o <b>Soltarlos</b>. Si nadie decide,
            el anexo se anula solo y los equipos vuelven a bodega.</p>`,
        ctaUrl: G.urlGestion(g, doc.id),
        ctaLabel: "Abrir la gestión",
        meta: { tipo: "anexo_dormido", gestion: doc.id, dias: dec.dias },
      });
      mails++;
    } catch (e) {
      logger.warn(`[${tag}] no se pudo encolar el aviso del anexo`, { gid: doc.id, err: e.message });
    }
  }
  return { scanned, candidatos, dormidos, enlacesCaducados, mails, errors, muestra };
}

// Lo que APARTA un anexo dormido (Alberto, 5-oct-2026): plazo de 15 días para
// que el vendedor lo retenga o lo suelte; avisos a los 10 días y un día antes;
// al vencer, se anula solo (la anulación de siempre libera los radios y
// elimina la OS sin trabajar en onGestionWrite → limpiarAnulacion) o, si el
// taller ya trabajó su orden, queda marcado para que bodega decida. La regla
// vive en domain/anexoDormido.
async function soltarAnexosDormidos({ dryRun = false, now = new Date(), tag = "dormirContratos" } = {}) {
  const G = require("./gestiones");
  const A = require("../domain/anexoDormido");
  const FV = admin.firestore.FieldValue;
  const snap = await db.collection("gestiones").where("dormido", "==", true).limit(500).get();

  const cuenta = { scanned: 0, dormidos: 0, avisos10: 0, avisosPrevios: 0, soltados: 0, aBodega: 0, esperanBodega: 0, retenidos: 0, mails: 0, errors: 0 };
  const muestra = [];
  for (const doc of snap.docs) {
    cuenta.scanned++;
    const g = doc.data() || {};
    if (!A.esAnexoDormido(g)) continue;
    cuenta.dormidos++;
    if (A.esperaBodega(g)) cuenta.esperanBodega++;
    if (A.retenciones(g) > 0) cuenta.retenidos++;
    // Las órdenes solo importan al vencer: se leen entonces.
    let dec = A.decidir({ gestion: g, now });
    if (dec.accion === "soltar") {
      const ordenes = [];
      let fallo = false;
      for (const oid of A.ordenesProgramacion(g)) {
        try {
          const s = await db.collection("ordenes_de_servicio").doc(oid).get();
          if (s.exists) ordenes.push({ id: oid, data: s.data() || {} });
        } catch (e) {
          // Sin poder leer la orden no se suelta nada: mejor un día más
          // apartado que anular sobre trabajo del taller.
          logger.warn(`[${tag}] orden del anexo no leída`, { gid: doc.id, oid, err: e.message });
          fallo = true;
        }
      }
      if (fallo) { cuenta.errors++; continue; }
      dec = A.decidir({ gestion: g, ordenes, now });
    }
    if (dec.accion === "nada") continue;
    if (muestra.length < 25) muestra.push(`${doc.id}: ${dec.accion} — ${dec.porQue}`);
    const k = { aviso_10: "avisos10", aviso_previo: "avisosPrevios", soltar: "soltados", bodega: "aBodega" }[dec.accion];
    cuenta[k]++;
    if (dryRun) continue;
    const ahora = FV.serverTimestamp();
    try {
      if (dec.accion === "soltar") {
        // estado → 'anulada': onGestionWrite (A0) corre limpiarAnulacion.
        await doc.ref.update(A.patchSoltarAuto({ ahora, porQue: dec.porQue }));
        await G.registrarEvento(doc.id, "anular",
          `Anulada sola: ${A.MOTIVO_AUTO} (${dec.porQue}). La anulación libera los radios apartados y elimina la orden de programación sin trabajar.`);
      } else if (dec.accion === "bodega") {
        await doc.ref.update(A.patchBodega({ ahora, trabajadas: dec.trabajadas, porQue: dec.porQue }));
        await G.registrarEvento(doc.id, "dormido_bodega",
          `Venció el plazo sin firma ni retención, pero la orden ${dec.trabajadas.join(", ")} ya la trabajó el taller: no se anula ni se sueltan los radios. Decide bodega (Almacén · Hoy).`);
      } else {
        await doc.ref.update(A.patchAviso({ accion: dec.accion, ahora, plazo: dec.plazo }));
      }
    } catch (e) {
      cuenta.errors++;
      logger.error(`[${tag}] anexo dormido no actualizado`, { gid: doc.id, accion: dec.accion, err: e.message });
      continue;
    }
    if (dec.accion !== "aviso_10" && dec.accion !== "aviso_previo") continue;
    // Aviso al vendedor (best-effort, mismo buzón que el correo de dormido).
    try {
      const to = g.responsable_email || await G.vendedorEmailDeCliente(g.cliente_id);
      if (!to) continue;
      const a = g.aumento || {};
      const nEq = (a.seriales_asignados || []).filter(s => String(s.serial || "").trim()).length;
      const fecha = A.diaPanama(dec.plazo).split("-").reverse().join("/");
      const previo = dec.accion === "aviso_previo";
      await G.encolarCorreo({
        to,
        subject: previo
          ? `Anexo ${doc.id}: mañana se sueltan sus equipos — ${g.cliente_nombre || "Cliente"}`
          : `Anexo ${doc.id} dormido: decide antes del ${fecha} — ${g.cliente_nombre || "Cliente"}`,
        preheader: previo ? "Si nadie decide, el anexo se anula solo" : "Retener o soltar los equipos apartados",
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">${previo ? "Mañana se sueltan los equipos" : "Anexo dormido: falta tu decisión"}</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            El anexo de aumento <b>${G.escapeHtml(doc.id)}</b> de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>
            ${a.contrato_id ? `(contrato <b>${G.escapeHtml(a.contrato_id)}</b>) ` : ""}sigue dormido sin la firma del cliente
            ${nEq ? `y aparta <b>${nEq} equipo(s)</b> en bodega` : ""}.
            ${previo
              ? `El <b>${fecha}</b> se anula solo y los equipos vuelven a bodega (si el taller ya trabajó la orden, lo decide bodega).`
              : `Si nadie decide, el <b>${fecha}</b> se anula solo y los equipos vuelven a bodega.`}</p>
          <p style="margin:0;font:14px/1.5 Arial,sans-serif;">
            Desde la ficha del cliente: <b>Retener los equipos</b> (motivo y fecha probable de firma; 30 días más),
            <b>Soltar los equipos</b> si el cliente ya no lo quiere, o <b>Reactivar la solicitud</b> si va a firmar.</p>`,
        ctaUrl: G.urlGestion(g, doc.id),
        ctaLabel: "Abrir la gestión",
        meta: { tipo: previo ? "anexo_dormido_previo" : "anexo_dormido_10d", gestion: doc.id },
      });
      cuenta.mails++;
    } catch (e) {
      logger.warn(`[${tag}] no se pudo encolar el aviso del anexo dormido`, { gid: doc.id, err: e.message });
    }
  }
  return { ...cuenta, muestra };
}

module.exports = { dormirContratosSinFirma, dormirAnexosSinFirma, soltarAnexosDormidos };
