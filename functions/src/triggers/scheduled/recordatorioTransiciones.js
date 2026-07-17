// Recordatorio SEMANAL de equipos pendientes de devolución (transiciones de
// renovación/reemplazo): cada vendedor recibe la lista de las unidades de SUS
// clientes que siguen sin devolverse, con copia a recepción y a ventas@
// (administración). Las unidades sin vendedor asignado van en un correo aparte
// a recepción + ventas@ para que nadie quede sin dueño.
//
// Fuente: equipos_pool con pendiente_devolucion == true y estado aún con el
// cliente (en_cliente / asignado_contrato) — el flag es computado: al
// registrarse la ENTRADA la unidad pasa a devuelto_revision y sale sola de
// este recordatorio. Solo correos (mail_queue → onMailQueued); no escribe nada.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const { recepcionEmails } = require("../../lib/mailRecipients");

const VENTAS_EMAIL = "ventas@cecomunica.com";
const ESTADOS_CON_CLIENTE = ["en_cliente", "asignado_contrato"];

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

module.exports = onSchedule(
  {
    schedule: "every monday 07:30",
    timeZone: "America/Panama",
    region: "us-central1",
    retryCount: 1,
  },
  async () => {
    const snap = await db.collection("equipos_pool")
      .where("pendiente_devolucion", "==", true)
      .limit(1000)
      .get();
    const unidades = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => ESTADOS_CON_CLIENTE.includes(u.estado));

    if (!unidades.length) {
      logger.info("[recordatorioTransiciones] sin equipos pendientes de devolución");
      return null;
    }

    // Vendedor por cliente (cache): clientes/{id}.vendedor_asignado → usuarios email.
    const vendedorPorCliente = new Map();
    const vendedorDe = async (clienteId) => {
      if (!clienteId) return null;
      if (vendedorPorCliente.has(clienteId)) return vendedorPorCliente.get(clienteId);
      let email = null;
      try {
        const cli = await db.collection("clientes").doc(clienteId).get();
        const uid = cli.exists ? cli.data().vendedor_asignado : null;
        if (uid) {
          const u = await db.collection("usuarios").doc(uid).get();
          const e = u.exists ? String(u.data().email || "").trim().toLowerCase() : "";
          if (e.includes("@")) email = e;
        }
      } catch (e) { /* sin vendedor */ }
      vendedorPorCliente.set(clienteId, email);
      return email;
    };

    // Agrupar unidades por vendedor ("__sin__" = sin vendedor asignado).
    const grupos = new Map();
    for (const u of unidades) {
      const vend = await vendedorDe(u.asignacion?.cliente_id || null);
      const key = vend || "__sin__";
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(u);
    }

    const copiasBase = new Set([VENTAS_EMAIL, ...(await recepcionEmails())]);
    let enviados = 0;

    for (const [vendedor, lista] of grupos) {
      const filas = lista.map(u => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${esc(u.serial || u.serial_norm)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(u.modelo_label || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(u.asignacion?.cliente_nombre || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(u.asignacion?.contrato_id || "—")}</td>
        </tr>`).join("");

      const esSinVendedor = vendedor === "__sin__";
      const copias = new Set(copiasBase);
      if (!esSinVendedor) copias.delete(vendedor);
      const destinatarios = esSinVendedor ? [...copias] : [vendedor, ...copias];
      if (!destinatarios.length) continue;

      await db.collection("mail_queue").add({
        to: destinatarios[0],
        cc: destinatarios.length > 1 ? destinatarios.slice(1).join(",") : null,
        subject: esSinVendedor
          ? `Equipos pendientes de devolución SIN vendedor asignado (${lista.length})`
          : `Recordatorio: ${lista.length} equipo(s) de tus clientes pendientes de devolución`,
        preheader: "Transiciones de renovación/reemplazo con equipos aún sin devolver",
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Equipos pendientes de devolución</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            ${esSinVendedor
              ? "Estos equipos quedaron salientes en una transición de renovación/reemplazo, siguen con el cliente y <b>no tienen vendedor asignado</b> — coordinar quién gestiona su recuperación:"
              : "Estos equipos de tus clientes quedaron salientes en una transición de renovación/reemplazo y <b>siguen sin devolverse</b>. Coordina la recuperación con el cliente:"}
          </p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 12px;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Cliente</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Contrato</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>
          <p style="margin:0 0 12px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
            Cuando el cliente entregue los equipos, regístralo al <b>cerrar la enmienda</b> o
            <b>anular el contrato original</b> — eso los pasa a inspección y crea la orden de
            ENTRADA para el taller. Este recordatorio se repite cada semana mientras queden pendientes.
          </p>`,
        ctaUrl: `${APP_BASE_URL}/inventario/equipos.html?tab=en_cliente`,
        ctaLabel: "Ver equipos en clientes",
        meta: {
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          source: "recordatorio-transiciones",
          vendedor: esSinVendedor ? null : vendedor,
          unidades: lista.length,
        },
        status: "queued",
      });
      enviados++;
    }

    logger.info("[recordatorioTransiciones] correos encolados", {
      vendedores: enviados, unidades: unidades.length,
    });
    return null;
  }
);
