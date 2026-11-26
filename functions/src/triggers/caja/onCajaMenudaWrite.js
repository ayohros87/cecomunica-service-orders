const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../../lib/admin");
const { escapeHtml } = require("../../domain/emailRenderer");
const { APP_BASE_URL } = require("../../lib/inventario");
const { avisos, numero } = require("../../domain/cajaMenudaAviso");

// Caja menuda (2026-11-26): lo que el servidor hace por cada gasto.
//
//  1. Al crearse le pone el número consecutivo (CM-0001). El navegador no
//     puede escribir `numero` (firestore.rules), así que nadie lo falsea ni
//     lo repite.
//  2. Cada vez que el gasto cambia de manos, avisa por correo a quien le toca
//     (domain/cajaMenudaAviso.js): al jefe que aprueba, a contabilidad que
//     paga o cierra, o a quien pidió cuando ya hay respuesta.
//
// El eco: poner el número reescribe el doc y este trigger vuelve a correr.
// No hace nada la segunda vez porque el estado no cambió (avisos() devuelve
// vacío) y el número ya está.

const activos = (snap) => snap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(u => u.activo !== false && u.email);

async function emailsDeRol(rol) {
  const s = await db.collection("usuarios").where("rol", "==", rol).get();
  return activos(s);
}

// A quién va cada aviso. Sin jefe asignado aprueba administración; sin
// nadie en contabilidad, la caja la lleva administración. Nunca se le pide
// a alguien que apruebe lo suyo.
async function destinatarios(para, g) {
  if (para === "solicitante") {
    if (g.solicitante_email) return [g.solicitante_email];
    const u = await db.collection("usuarios").doc(String(g.solicitante_uid)).get();
    return u.exists && u.data().email ? [u.data().email] : [];
  }
  if (para === "aprobador") {
    if (g.aprobador_uid) {
      const j = await db.collection("usuarios").doc(String(g.aprobador_uid)).get();
      if (j.exists && j.data().activo !== false && j.data().email) return [j.data().email];
    }
    return (await emailsDeRol("administrador")).filter(u => u.uid !== g.solicitante_uid).map(u => u.email);
  }
  if (para === "custodios") {
    const conta = await emailsDeRol("contabilidad");
    if (conta.length) return conta.map(u => u.email);
    return (await emailsDeRol("administrador")).map(u => u.email);
  }
  return [];
}

async function asignarNumero(ref) {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists || doc.data().numero) return doc.exists ? doc.data().numero : null;
    const cRef = db.collection("contadores").doc("caja_menuda");
    const c = await tx.get(cRef);
    const n = (c.exists ? Number(c.data().ultimo) || 0 : 0) + 1;
    tx.set(cRef, { ultimo: n, updated_at: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(ref, { numero: numero(n) });
    return numero(n);
  });
}

module.exports = onDocumentWritten(
  { document: "caja_menuda/{gastoId}", region: "us-central1" },
  async (event) => {
    const antes = event.data?.before?.exists ? event.data.before.data() : null;
    let despues = event.data?.after?.exists ? event.data.after.data() : null;
    if (!despues) return null;
    const id = event.params.gastoId;

    try {
      if (!despues.numero) {
        const num = await asignarNumero(event.data.after.ref);
        if (num) despues = { ...despues, numero: num };
      }
    } catch (e) {
      logger.error("[onCajaMenudaWrite] no se pudo numerar", { id, message: e.message });
    }

    for (const av of avisos(antes, despues, id)) {
      try {
        const to = [...new Set((await destinatarios(av.para, despues)).map(e => String(e).trim().toLowerCase()).filter(Boolean))];
        if (!to.length) {
          logger.warn("[onCajaMenudaWrite] aviso sin destinatarios", { id, para: av.para });
          continue;
        }
        const filas = av.filas.filter(([, v]) => v !== "" && v != null);
        const bodyContent = `
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">${escapeHtml(av.intro)}</p>
          <table role="presentation" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:0 0 4px;">
            ${filas.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td><td style="padding:4px 0;"><b>${escapeHtml(v)}</b></td></tr>`).join("")}
          </table>`;
        const url = `${APP_BASE_URL}${av.cta.path}`;
        await db.collection("mail_queue").add({
          to: to[0],
          cc: to.length > 1 ? to.slice(1).join(",") : null,
          subject: av.asunto,
          preheader: av.intro,
          bodyContent,
          ctaUrl: url,
          ctaLabel: av.cta.label,
          text: [av.intro, "", ...filas.map(([k, v]) => `${k}: ${v}`), "", `${av.cta.label}: ${url}`].join("\n"),
          meta: {
            created_at: FieldValue.serverTimestamp(),
            source: "caja_menuda",
            gasto_id: id,
            aviso: `${av.para}:${despues.estado}`,
          },
          status: "queued",
        });
      } catch (e) {
        logger.error("[onCajaMenudaWrite] no se pudo avisar", { id, para: av.para, message: e.message });
      }
    }
    return null;
  }
);
