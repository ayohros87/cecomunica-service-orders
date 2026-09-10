/**
 * promueve-avisos-entregados.js — F1 de docs/plans/PLAN_COMISIONES.md.
 *
 * LO QUE ARREGLA
 *   Antes del trigger `onEntregaFacturacion` (2026-09-10), un aviso creado con
 *   `esperando: true` no salía nunca de ahí: la entrega se estampaba en el
 *   contrato y nadie tocaba el aviso. La fila se quedaba en "Espera" en la
 *   bandeja de Recepción, así que nadie iba a facturar ese contrato — y el
 *   correo de activación había prometido "te avisaremos cuando se entregue".
 *
 *   El trigger cubre de aquí en adelante. Este script cubre lo que ya pasó:
 *   avisos en 'esperando' cuyo contrato YA tiene entrega_confirmada.
 *
 * QUÉ HACE con cada uno (solo con --apply):
 *   1. promueve el aviso (misma librería que el trigger: no hay dos criterios)
 *   2. encola el correo prometido, con CTA a la fila de la bandeja
 *
 * Idempotente: `promoverPorEntrega` solo mueve avisos en 'esperando'.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/promueve-avisos-entregados.js            # dry-run
 *   node scripts/promueve-avisos-entregados.js --apply    # promueve y avisa
 *   node scripts/promueve-avisos-entregados.js --apply --sin-correo
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const SIN_CORREO = process.argv.includes("--sin-correo");

const FA = require("../src/lib/facturacionAvisos");
const G = require("../src/lib/gestiones");
const { APP_BASE_URL } = require("../src/lib/inventario");

const fmt = (d) => {
  const x = d?.toDate ? d.toDate() : (d ? new Date(d) : null);
  return x && !isNaN(x) ? x.toLocaleDateString("es-PA", { day: "2-digit", month: "long", year: "numeric" }) : null;
};

(async () => {
  const snap = await db.collection("facturacion_avisos").where("estado", "==", "esperando").get();
  console.log(`Avisos en 'esperando': ${snap.size}\n`);

  const aMover = [];
  for (const d of snap.docs) {
    const a = d.data() || {};
    const cid = a.contrato_doc_id || a.origen?.id;
    if (!cid) { console.log(`  — ${d.id}: sin contrato de origen, se salta`); continue; }
    const c = await db.collection("contratos").doc(cid).get();
    const x = c.exists ? c.data() : null;
    const etiqueta = `${a.contrato_id || cid} · ${a.cliente_nombre || "—"}`;
    if (!x) { console.log(`  — ${etiqueta}: el contrato no existe, se salta`); continue; }
    if (x.deleted === true) { console.log(`  — ${etiqueta}: contrato eliminado, se salta`); continue; }
    if (x.entrega_confirmada !== true) {
      console.log(`  · ${etiqueta}: aún SIN entregar — el trigger lo agarra cuando pase`);
      continue;
    }
    aMover.push({ id: d.id, cid, aviso: a, contrato: x, etiqueta });
  }

  if (!aMover.length) { console.log("\nNada que promover."); process.exit(0); }

  console.log(`\n${aMover.length} aviso(s) con el contrato YA entregado:\n`);
  for (const m of aMover) {
    const cuando = fmt(m.contrato.fecha_entrega_ultima);
    console.log(`  ${m.etiqueta}`);
    console.log(`    entregado: ${cuando || "sin fecha"} · mensual $${Number(m.aviso.resumen?.mensual || 0).toFixed(2)}`);
    console.log(`    aviso: ${m.id}`);
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. Corre con --apply para promoverlos" + (SIN_CORREO ? "" : " y mandar el correo prometido") + ".");
    process.exit(0);
  }

  console.log("");
  for (const m of aMover) {
    const fechaEntrega = m.contrato.fecha_entrega_ultima?.toDate
      ? m.contrato.fecha_entrega_ultima.toDate() : new Date();
    const cuando = fmt(m.contrato.fecha_entrega_ultima) || fmt(fechaEntrega);
    const r = await FA.promoverPorEntrega(m.cid, {
      fechaEntrega,
      detalle: `Equipos entregados${cuando ? ` el ${cuando}` : ""} — ya se puede facturar (regularizado 2026-09-10)`,
    });
    if (!r || !r.promovido) { console.log(`  · ${m.etiqueta}: ya estaba movido, sin cambios`); continue; }
    console.log(`  + ${m.etiqueta}: promovido a 'pendiente'`);

    if (SIN_CORREO) continue;
    const mm = FA.mensualDeContrato(m.contrato);
    const to = await require("../src/lib/mailRecipients").activacionesEmailTo();
    const cc = await G.vendedorEmailDeCliente(m.contrato.cliente_id);
    const mailId = await G.encolarCorreo({
      to, cc: cc || null,
      subject: `FACTURACIÓN: equipos ENTREGADOS — ${m.contrato.cliente_nombre || "Cliente"} (${m.aviso.contrato_id || m.cid})`,
      preheader: "Ya se puede facturar este contrato",
      bodyContent: `
        <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Equipos entregados — ya se puede facturar</h2>
        <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
          Los equipos del contrato <b>${G.escapeHtml(m.aviso.contrato_id || m.cid)}</b> de
          <b>${G.escapeHtml(m.contrato.cliente_nombre || "—")}</b> ya se entregaron${cuando ? ` el <b>${G.escapeHtml(cuando)}</b>` : ""}.
          Este aviso se había quedado en <b>"Espera"</b> por una falla que ya está corregida — de aquí en
          adelante sale solo el día de la entrega.</p>
        ${G.detalleAumentoHtml({ lineas: m.contrato.equipos || [], cargos: m.contrato.cargos || [] })}
        <p style="margin:8px 0 0;font:14px Arial,sans-serif;">Total mensual: <b>$${mm.mensual.toFixed(2)}</b>${
          mm.exento ? " (exento de ITBMS)" : ` · $${mm.con_itbms.toFixed(2)} con ITBMS`}</p>`,
      ctaUrl: `${APP_BASE_URL}/facturacion/bandeja.html?aviso=${encodeURIComponent(r.id)}`,
      ctaLabel: "Abrir en Facturación pendiente",
      meta: { source: "promueve-avisos-entregados", contrato_id: m.aviso.contrato_id || m.cid, aviso_id: r.id, paso: "facturacion_entrega" },
    });
    await FA.vincularCorreo(r.id, mailId);
    console.log(`    correo encolado (${mailId})`);
  }

  console.log("\nListo.");
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
