// trasladarContratoCliente — un contrato hecho a la ficha equivocada pasa a la
// ficha correcta con todo lo que cuelga de él (plan de autoservicio
// 2026-10-07, P3/B2; caso ACODECO → APC).
//
// Lo hace administración o gerencia: cambia a quién se factura. Conserva el
// número y el estado del contrato; mueve filas de seriales, custodia del pool
// (kardex `correccion_titular`), fichas PoC, órdenes abiertas, gestiones
// abiertas y avisos de facturación. Avisa a activaciones@ (el PDF del contrato
// aprobado salió a nombre del cliente equivocado).
//
// Si el destino ya tenía su propio contrato con los mismos radios (ACODECO),
// después de trasladar se anula el sobrante por sustitución desde el Centro
// (ya están en la misma cuenta y declararSustitutoContrato hace el traspaso).
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");
const { repuntarContrato, anotarHistorial, VIVOS } = require("../lib/trasladoCliente");
const { activacionesEmailTo } = require("../lib/mailRecipients");

const ROLES = new Set(["administrador", "gerente"]);
const APP_BASE_URL = process.env.APP_BASE_URL || "https://app.cecomunica.net";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));

async function ejecutar({ usuario, uid = null, contratoId, destinoClienteId, motivo = "" }) {
  if (!contratoId || typeof contratoId !== "string") throw new HttpsError("invalid-argument", "Falta el contrato.");
  if (!destinoClienteId || typeof destinoClienteId !== "string") throw new HttpsError("invalid-argument", "Falta la ficha de cliente destino.");
  const [cSnap, dSnap] = await Promise.all([
    db.collection("contratos").doc(contratoId).get(),
    db.collection("clientes").doc(destinoClienteId).get(),
  ]);
  if (!cSnap.exists) throw new HttpsError("not-found", "El contrato no existe.");
  if (!dSnap.exists) throw new HttpsError("not-found", "La ficha de cliente destino no existe.");
  const c = cSnap.data() || {};
  const destino = dSnap.data() || {};
  if (c.deleted === true) throw new HttpsError("failed-precondition", "El contrato está borrado.");
  if (!VIVOS.has(String(c.estado || ""))) throw new HttpsError("failed-precondition", `Solo se traslada un contrato en trámite, aprobado o activo (este está ${c.estado || "?"}).`);
  if (destino.deleted === true || destino.merged_into) throw new HttpsError("failed-precondition", "La ficha destino está borrada o fusionada en otra.");
  if (destino.activo === false) throw new HttpsError("failed-precondition", "La ficha destino está inactiva: actívala primero.");
  if (c.cliente_id === destinoClienteId) throw new HttpsError("failed-precondition", "El contrato ya está en esa ficha.");
  const origenId = c.cliente_id || null;
  const oSnap = origenId ? await db.collection("clientes").doc(origenId).get() : null;
  const origen = oSnap && oSnap.exists ? oSnap.data() : {};
  const origenNombre = origen.nombre || c.cliente_nombre || "";

  const r = await repuntarContrato({ contratoId, contrato: c, destinoId: destinoClienteId, destino, usuario, motivo, origenNombre });

  const numero = c.contrato_id || contratoId;
  const nota = `Contrato ${numero} trasladado a ${destino.nombre || destinoClienteId}${motivo ? ` — ${motivo}` : ""}`;
  if (origenId) await anotarHistorial(origenId, { tipo: "traslado_contrato", por_uid: uid, nota, extra: { contrato_id: numero, destino_id: destinoClienteId } });
  await anotarHistorial(destinoClienteId, { tipo: "traslado_contrato", por_uid: uid, nota: `Recibe el contrato ${numero} de ${origenNombre || origenId || "otra ficha"}${motivo ? ` — ${motivo}` : ""}`, extra: { contrato_id: numero, origen_id: origenId } });

  // Aviso a activaciones: el correo "Contrato APROBADO" salió con el otro cliente.
  if (["aprobado", "activo"].includes(String(c.estado || ""))) {
    try {
      await db.collection("mail_queue").add({
        to: await activacionesEmailTo(),
        subject: `Contrato ${numero} cambia de cliente: ${destino.nombre || destinoClienteId}`,
        preheader: `Antes figuraba con ${origenNombre || "otra ficha"}`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 20px Arial,sans-serif;color:#1F2937;">El contrato ${esc(numero)} pasó a otra ficha de cliente</h2>
          <p style="margin:0 0 10px;font:14px/1.5 Arial,sans-serif;">Estaba a nombre de <b>${esc(origenNombre || "—")}</b> y ahora es de <b>${esc(destino.nombre || destinoClienteId)}</b>${destino.ruc ? ` (RUC ${esc(destino.ruc)}${destino.dv ? ` DV ${esc(destino.dv)}` : ""})` : ""}.
          Mismo número, mismos equipos${r.seriales ? ` (${r.seriales} serial(es))` : ""}. Lo trasladó ${esc(usuario)}${motivo ? `: ${esc(motivo)}` : "."}</p>
          <p style="margin:0;font:13px/1.5 Arial,sans-serif;color:#6B7280;">Si ya se activó algo a nombre del cliente anterior, corrígelo en la plataforma.</p>`,
        ctaUrl: `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(destinoClienteId)}`,
        ctaLabel: "Abrir la ficha del cliente",
        meta: { source: "trasladarContratoCliente", contrato_id: numero },
      });
    } catch (e) { logger.warn("[trasladarContratoCliente] correo no encolado", { contratoId, message: e.message }); }
  }
  logger.info("[trasladarContratoCliente]", { contratoId, numero, origenId, destinoClienteId, usuario, ...r });
  return { ok: true, ...r, destino: destino.nombre || destinoClienteId, origen: origenNombre };
}

module.exports = onCall(
  { region: "us-central1", memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const uSnap = await db.collection("usuarios").doc(uid).get();
    const u = uSnap.exists ? uSnap.data() : null;
    if (!u || !ROLES.has(u.rol) || u.activo === false) {
      throw new HttpsError("permission-denied", "Trasladar un contrato a otra ficha lo hace administración o gerencia.");
    }
    const { contratoId, destinoClienteId, motivo = "" } = request.data || {};
    return ejecutar({ usuario: u.email || uid, uid, contratoId, destinoClienteId, motivo });
  },
);
module.exports.ejecutar = ejecutar;
