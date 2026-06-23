// facturacionDiaria — corrida diaria de facturación (Fase B):
//  1) Auto-activación OPCIONAL (config `empresa/facturacion_config.auto_activar`):
//     activa los contratos "Listos" (requeridos verdes) si está habilitada.
//  2) Alertas: fuga de ingresos (listos sin activar > 7 días) y falso arranque
//     (activos sin entrega ni serial). Encola un digest a admin/contabilidad.
// Solo lee/escribe vía admin SDK (no pasa por reglas). No emite facturas.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");

const TS = admin.firestore.Timestamp;
const DIAS_FUGA = 7;
const norm = (s) => String(s || "").trim().toLowerCase();
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
const esc = (v) => String(v ?? "").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[ch]));
const toMillis = (ts) => (ts?.toMillis ? ts.toMillis() : (ts ? new Date(ts).getTime() : 0));

function readiness(c, modelosById, modelosByName) {
  const vigente = ["activo", "aprobado"].includes(c.estado);
  let mapeo = true;
  for (const e of (c.equipos || [])) {
    const m = (e.modelo_id && modelosById[e.modelo_id]) || modelosByName[norm(e.modelo)] || null;
    if (!m || !(Number(m.precio_alquiler) > 0) || !m.qbo_item_alquiler_id || !m.qbo_bundle_id) { mapeo = false; break; }
  }
  const total = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
  const activos = Math.max(0, total - Number(c.baja_cancelado_total || 0));
  const entrega = c.entrega_confirmada === true;
  const seriales = activos > 0 && Number(c.seriales_count || 0) >= activos;
  return { vigente, mapeo, entrega, seriales, activos, requeridosOk: vigente && mapeo };
}

module.exports = onSchedule(
  {
    schedule: "every day 07:00",
    timeZone: "America/Panama",
    region: "us-central1",
    secrets: ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
  },
  async () => {
    // Config (auto-activación)
    let autoActivar = false;
    try {
      const cfg = await db.collection("empresa").doc("facturacion_config").get();
      autoActivar = !!(cfg.exists && cfg.data().auto_activar);
    } catch (e) { logger.warn("[facturacionDiaria] sin config", { message: e.message }); }

    // Catálogo de modelos
    const modelosById = {}, modelosByName = {};
    (await db.collection("modelos").get()).forEach((d) => {
      const m = { id: d.id, ...d.data() };
      modelosById[m.id] = m;
      if (m.modelo) modelosByName[norm(m.modelo)] = m;
    });

    // Contratos vigentes
    const snap = await db.collection("contratos").where("estado", "in", ["aprobado", "activo"]).get();
    const contratos = snap.docs.map((d) => ({ id: d.id, _ref: d.ref, ...d.data() })).filter((c) => c.deleted !== true);

    const ahora = Date.now();
    let autoActivados = 0;
    const fuga = [];
    const falso = [];

    for (const c of contratos) {
      const facturable = c.facturable !== false && c.facturacion_estado !== "no_aplica";
      const r = readiness(c, modelosById, modelosByName);
      const enCiclo = ["activa", "en_espera"].includes(c.facturacion_estado);

      // 1) Auto-activación
      if (autoActivar && facturable && r.requeridosOk && !enCiclo) {
        const fechaTs = c.fecha_entrega_ultima || TS.now();
        const equipos = Array.isArray(c.equipos)
          ? c.equipos.map((e) => ({ ...e, fecha_inicio_facturacion: fechaTs, facturacion_estado: "activa" }))
          : [];
        try {
          await c._ref.set({
            equipos,
            facturacion_estado: "activa",
            facturacion_fecha_inicio: fechaTs,
            facturacion_activada_por: "auto",
            facturacion_activada_at: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          autoActivados++;
          c.facturacion_estado = "activa"; // refleja para las alertas de abajo
        } catch (e) { logger.warn("[facturacionDiaria] no se pudo auto-activar", { id: c.id, message: e.message }); }
      }

      // 2a) Fuga: facturable + listo + sin activar/en espera > N días
      if (facturable && r.requeridosOk && !["activa", "en_espera"].includes(c.facturacion_estado)) {
        const reloj = toMillis(c.fecha_entrega_ultima) || toMillis(c.fecha_aprobacion) || toMillis(c.fecha_creacion);
        const dias = reloj ? Math.floor((ahora - reloj) / 86400000) : null;
        if (dias != null && dias > DIAS_FUGA) fuga.push({ c, dias });
      }

      // 2b) Falso arranque: activa sin entrega ni serial
      if (c.facturacion_estado === "activa" && !c.entrega_confirmada && Number(c.seriales_count || 0) === 0) {
        falso.push({ c });
      }
    }

    logger.info("[facturacionDiaria]", { contratos: contratos.length, autoActivar, autoActivados, fuga: fuga.length, falso: falso.length });

    if (!fuga.length && !falso.length) return null;

    // Destinatarios: admin + contabilidad
    const emails = [];
    try {
      const us = await db.collection("usuarios").where("rol", "in", ["administrador", "contabilidad"]).get();
      us.forEach((d) => { const e = d.data()?.email; if (isEmail(e)) emails.push(e.trim().toLowerCase()); });
    } catch (e) { logger.warn("[facturacionDiaria] sin destinatarios", { message: e.message }); }
    const unique = [...new Set(emails)];
    if (!unique.length) return null;

    const fila = (id, cli, extra) => `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee;">${esc(id)}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;">${esc(cli)}</td><td style="padding:5px 8px;border-bottom:1px solid #eee;">${esc(extra)}</td></tr>`;
    const tabla = (titulo, color, rows) => rows.length ? `
      <h3 style="margin:16px 0 6px;font:700 16px Arial,sans-serif;color:${color};">${titulo} (${rows.length})</h3>
      <table style="border-collapse:collapse;font:13px Arial,sans-serif;width:100%;">
        <thead><tr><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #ddd;">Contrato</th><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #ddd;">Cliente</th><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #ddd;">Detalle</th></tr></thead>
        <tbody>${rows.join("")}</tbody></table>` : "";

    const bodyHtml = `
      <h2 style="margin:0 0 8px;font:700 20px Arial,sans-serif;color:#111827;">Revisión diaria de facturación</h2>
      <p style="margin:0 0 8px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">${autoActivar ? `Auto-activación ON · ${autoActivados} activados hoy.` : "Auto-activación OFF (activación manual)."}</p>
      ${tabla("Fuga de ingresos — listos sin activar", "#92400e", fuga.map(({ c, dias }) => fila(c.contrato_id || c.id, c.cliente_nombre || "", `${dias} días sin activar`)))}
      ${tabla("Falso arranque — activos sin entrega/serial", "#991b1b", falso.map(({ c }) => fila(c.contrato_id || c.id, c.cliente_nombre || "", "facturando sin entrega ni serial")))}`;

    await db.collection("mail_queue").add({
      to: unique[0],
      cc: unique.length > 1 ? unique.slice(1).join(",") : null,
      subject: `Revisión de facturación: ${fuga.length} fuga · ${falso.length} falso arranque`,
      preheader: "Contratos que requieren tu atención en facturación",
      bodyContent: bodyHtml,
      ctaUrl: "https://app.cecomunica.net/facturacion/activacion.html",
      ctaLabel: "Abrir activación",
      meta: { created_at: admin.firestore.FieldValue.serverTimestamp(), source: "facturacion-diaria", fuga: fuga.length, falso: falso.length },
      status: "queued",
    });
    return null;
  }
);
