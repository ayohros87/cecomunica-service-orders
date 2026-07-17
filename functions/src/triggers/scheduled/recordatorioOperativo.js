// Digest diario de estancamiento operativo — cierra dos "quedan en el aire"
// que hasta ahora solo eran visibles entrando a las páginas:
//
//  A) ÓRDENES ESTANCADAS: atascadas en POR ASIGNAR / RECIBIDO EN MOSTRADOR /
//     ASIGNADO con edad entre empresa/config.orden_stale_dias (10) y
//     orden_stale_max_dias (30). Fuera del tope = legacy noise que se omite
//     para no enmascarar lo accionable — mismo criterio que admin/operacion.
//     Destinatario: taller (email_taller o usuarios jefe_taller).
//
//  B) CUARENTENA SIN INSPECCIÓN: unidades de equipos_pool en devuelto_revision
//     (entrada por anulación/baja/defectuoso) sin movimiento hace >=
//     empresa/config.entrada_recordatorio_dias (7). La salida de cuarentena es
//     manual por unidad (inspección OK / baja) y nada avisaba si nadie la hacía.
//     Destinatario: recepción (email_recepcion o usuarios rol recepcion).
//
// Solo correos (mail_queue → onMailQueued); no escribe en órdenes ni en el
// pool. Un correo por sección por día, solo si hay filas.

const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const { tallerEmailTo, recepcionEmails } = require("../../lib/mailRecipients");

const ESTADOS_ABIERTOS = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO"];
const STALE_DIAS_DEFAULT = 10;
const STALE_MAX_DEFAULT = 30;
const ENTRADA_DIAS_DEFAULT = 7;
const MAX_FILAS = 30; // tope de filas por correo; el resto se resume

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function aDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function edadDias(ts, now) {
  const d = aDate(ts);
  return d ? (now - d) / (1000 * 60 * 60 * 24) : null;
}

function tablaHtml(headers, rows) {
  const th = headers.map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">${esc(h)}</th>`).join("");
  const trs = rows.map(cols =>
    `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${c}</td>`).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
    <thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

module.exports = onSchedule(
  {
    schedule: "every day 07:15",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    const now = new Date();

    // Config con fallbacks (nunca lanza).
    let staleDias = STALE_DIAS_DEFAULT, staleMax = STALE_MAX_DEFAULT, entradaDias = ENTRADA_DIAS_DEFAULT;
    try {
      const cfg = (await db.collection("empresa").doc("config").get()).data() || {};
      if (Number.isFinite(Number(cfg.orden_stale_dias)) && Number(cfg.orden_stale_dias) >= 1) staleDias = Number(cfg.orden_stale_dias);
      if (Number.isFinite(Number(cfg.orden_stale_max_dias)) && Number(cfg.orden_stale_max_dias) > staleDias) staleMax = Number(cfg.orden_stale_max_dias);
      if (Number.isFinite(Number(cfg.entrada_recordatorio_dias)) && Number(cfg.entrada_recordatorio_dias) >= 1) entradaDias = Number(cfg.entrada_recordatorio_dias);
    } catch (e) { /* defaults */ }

    // ── A) Órdenes estancadas ────────────────────────────────────────────
    try {
      const snap = await db.collection("ordenes_de_servicio")
        .where("estado_reparacion", "in", ESTADOS_ABIERTOS)
        .limit(1000)
        .get();

      const estancadas = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (o.eliminado) return;
        // Última actividad conocida — misma cadena que admin/operacion.
        const base = o.fecha_modificacion || o.fecha_actualizacion || o.updatedAt || o.fecha_entrada || o.fecha_creacion;
        const edad = edadDias(base, now);
        if (edad == null || edad < staleDias || edad > staleMax) return;
        estancadas.push({
          id: d.id,
          orden: o.numero_orden || d.id,
          cliente: o.cliente_nombre || o.cliente || "—",
          estado: o.estado_reparacion || "—",
          tecnico: o.tecnico_asignado || "—",
          dias: Math.floor(edad),
        });
      });
      estancadas.sort((a, b) => b.dias - a.dias);

      const to = await tallerEmailTo();
      if (estancadas.length && to) {
        const filas = estancadas.slice(0, MAX_FILAS).map(o => [
          esc(o.orden), esc(o.cliente), esc(o.estado), esc(o.tecnico), `<b>${o.dias}</b>`,
        ]);
        const extra = estancadas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${estancadas.length - MAX_FILAS} más (ver listado completo en la app).</p>` : "";
        await db.collection("mail_queue").add({
          to,
          subject: `Órdenes estancadas: ${estancadas.length} sin avanzar hace ${staleDias}+ días`,
          preheader: `${estancadas.length} órdenes abiertas sin movimiento`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Órdenes sin avanzar</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estas órdenes llevan <b>${staleDias}+ días</b> sin movimiento en un estado abierto
              (se omiten las de más de ${staleMax} días — legacy).
            </p>
            ${tablaHtml(["Orden", "Cliente", "Estado", "Técnico", "Días"], filas)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/ordenes/index.html`,
          ctaLabel: "Ver órdenes",
          meta: { source: "recordatorioOperativo", seccion: "ordenes_estancadas", total: estancadas.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] órdenes", { abiertas: snap.size, estancadas: estancadas.length, notificado: !!(estancadas.length && to) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección órdenes falló", { message: e.message });
    }

    // ── B) Cuarentena de entrada sin inspección ──────────────────────────
    try {
      const snap = await db.collection("equipos_pool")
        .where("estado", "==", "devuelto_revision")
        .limit(1000)
        .get();

      const atascadas = [];
      snap.forEach(d => {
        const u = d.data() || {};
        const edad = edadDias(u.updated_at || u.created_at, now);
        if (edad == null || edad < entradaDias) return;
        atascadas.push({
          serial: u.serial || d.id,
          modelo: u.modelo_label || "—",
          cliente: u.asignacion?.cliente_nombre || "—",
          dias: Math.floor(edad),
        });
      });
      atascadas.sort((a, b) => b.dias - a.dias);

      const dests = await recepcionEmails();
      if (atascadas.length && dests.length) {
        const filas = atascadas.slice(0, MAX_FILAS).map(u => [
          esc(u.serial), esc(u.modelo), esc(u.cliente), `<b>${u.dias}</b>`,
        ]);
        const extra = atascadas.length > MAX_FILAS
          ? `<p style="font:13px Arial,sans-serif;color:#6b7280;">…y ${atascadas.length - MAX_FILAS} más.</p>` : "";
        await db.collection("mail_queue").add({
          to: dests[0],
          cc: dests.length > 1 ? dests.slice(1).join(", ") : null,
          subject: `Entradas sin inspeccionar: ${atascadas.length} equipos en cuarentena hace ${entradaDias}+ días`,
          preheader: `${atascadas.length} unidades esperan inspección`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#9A3412;">Equipos en cuarentena sin inspección</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Estas unidades entraron como devolución (anulación / baja / defectuoso) y llevan
              <b>${entradaDias}+ días</b> esperando inspección. Hasta que se resuelvan
              (inspección OK → bodega, o baja) no vuelven a estar disponibles.
            </p>
            ${tablaHtml(["Serial", "Modelo", "Venía de", "Días"], filas)}
            ${extra}`,
          ctaUrl: `${APP_BASE_URL}/inventario/equipos.html`,
          ctaLabel: "Abrir pool de equipos",
          meta: { source: "recordatorioOperativo", seccion: "cuarentena", total: atascadas.length },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      logger.info("[recordatorioOperativo] cuarentena", { enCuarentena: snap.size, atascadas: atascadas.length, notificado: !!(atascadas.length && dests.length) });
    } catch (e) {
      logger.error("[recordatorioOperativo] sección cuarentena falló", { message: e.message });
    }

    return null;
  }
);
