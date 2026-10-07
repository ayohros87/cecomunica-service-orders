// Venta facturada → seriales de bodega → OS de programación (Brenda, 2026-10-07).
//
// EL HUECO QUE CIERRA
//   Recepción factura la venta en QuickBooks y, hasta hoy, le mandaba la
//   factura a bodega POR CORREO para que la registrara en "Registrar venta".
//   Bodega escogía los seriales y la plataforma no le avisaba a nadie: recepción
//   tenía que volver a pedírselos por correo para hacer la OS de programación.
//   Dos correos a mano por venta, y cualquiera de los dos se quedaba pendiente.
//
// AHORA (mismo patrón que las gestiones de reemplazo):
//   1. Recepción registra el PEDIDO (`pedidos_venta`): cliente, factura,
//      modelo y cantidad. Sin seriales — esos los decide bodega.
//   2. Este trigger le escribe a bodega "asignar serial(es)".
//   3. Bodega asigna desde Almacén · Hoy con el asistente de venta de siempre
//      (cada unidad queda `vendido` con venta.pedido_id) y el pedido pasa a
//      'asignada' con los seriales.
//   4. Este trigger crea la OS de programación (si el pedido la pide) y le
//      escribe a recepción con los seriales y la orden. onOrdenWritePool amarra
//      venta.orden_programacion_id por contacto, así que la venta no aparece
//      además en "Órdenes por crear".
//
// CANDADO ANTES DEL EFECTO: cada aviso reserva su `*_at` en una transacción
// antes de encolar el correo o crear la orden. Un reintento del mismo evento,
// o el eco de la propia marca, pierde la carrera y no duplica nada.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const { admin, db } = require("../../lib/admin");
const { APP_BASE_URL } = require("../../lib/inventario");
const G = require("../../lib/gestiones");

const esc = G.escapeHtml;

async function reservar(ref, campo) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()[campo]) return false;
    tx.update(ref, { [campo]: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
}

const facturaTxt = (p) => String(p.factura || "").trim() || "—";
const lineasTxt = (p) => (p.lineas || [])
  .map(l => `${Number(l.cantidad || 0)} × ${l.modelo || "?"}`).join(", ");

// Quien registró el pedido va en copia de los dos correos: el primero le queda
// como "lo pedí", el segundo como "ya está".
const creador = (p) => String(p.creado_por_email || "").trim().toLowerCase();

async function correoBodega(pid, p) {
  const to = await G.bodegaEmailTo();
  if (!to) { logger.warn("[pedidoVenta] bodega sin correo configurado", { pid }); return; }
  const cc = creador(p) && !to.toLowerCase().includes(creador(p)) ? creador(p) : null;
  await G.encolarCorreo({
    to, cc,
    subject: `Venta facturada ${facturaTxt(p)}: asignar serial(es) — ${p.cliente_nombre || "Cliente"}`,
    preheader: `Asignar ${lineasTxt(p)}`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Venta facturada — asignar equipos</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Recepción facturó una venta a <b>${esc(p.cliente_nombre || "—")}</b>
        (factura <b>${esc(facturaTxt(p))}</b>) y espera que Bodega asigne los seriales.
        ${p.requiere_programacion !== false
          ? "Al asignarlos, el sistema crea solo la orden de programación y le avisa a Recepción."
          : "Esta venta <b>no lleva programación</b>: al asignarlos, el sistema solo le avisa a Recepción."}
      </p>
      ${G.tablaHtml(["Cantidad", "Modelo"], (p.lineas || []).map(l => [
        `${Number(l.cantidad || 0)}`, esc(l.modelo || "—"),
      ]))}
      ${p.notas ? `<p style="margin:12px 0 0;font:14px/1.5 Arial,sans-serif;"><b>Notas:</b> ${esc(p.notas)}</p>` : ""}`,
    ctaUrl: `${APP_BASE_URL}/almacen/index.html?venta=${encodeURIComponent(pid)}`,
    ctaLabel: "Asignar seriales",
    meta: { source: "pedidos_venta", pedido_id: pid, paso: "bodega" },
  });
}

async function crearOrden(pid, p) {
  let vendedorUid = "";
  if (p.cliente_id) {
    try {
      const cli = await db.collection("clientes").doc(p.cliente_id).get();
      vendedorUid = (cli.exists && cli.data().vendedor_asignado) || "";
    } catch (e) { logger.warn("[pedidoVenta] vendedor de la ficha ilegible", { pid, error: e.message }); }
  }
  const fact = facturaTxt(p);
  const equipos = (p.seriales || []).map(s => {
    const serial = String(s.serial || "").trim();
    return {
      id: crypto.randomUUID(),
      modelo_id: s.modelo_id || null,
      modelo: String(s.modelo || "").trim(),
      serial,
      numero_de_serie: serial,
      observaciones: `Venta directa — factura ${fact}.`,
      eliminado: false,
    };
  }).filter(e => e.serial);
  if (!equipos.length) return null;

  const data = {
    cliente_id: p.cliente_id || "",
    cliente_nombre: p.cliente_nombre || "",
    vendedor_asignado: vendedorUid,
    tipo_de_servicio: "PROGRAMACIÓN",
    estado_reparacion: "POR ASIGNAR",
    fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
    observaciones: `Orden creada automáticamente por la venta facturada ${fact}: programar ${equipos.length} equipo(s).`
      + (p.notas ? ` Notas de recepción: ${p.notas}` : ""),
    equipos,
    // Mismo amarre que la orden que nace de nueva-orden?origen=venta.
    contrato: { aplica: false, contrato_doc_id: null, contrato_id: null, motivo_no_aplica: `Venta directa — factura QBO ${fact}` },
    origen_venta: { factura_qbo: p.factura || null, seriales: equipos.map(e => e.serial), pedido_id: pid },
    creado_por_uid: "system",
    creado_por_email: null,
    eliminado: false,
    os_logs: [{ action: "CREAR", by: "system:pedidos_venta" }],
  };

  const { fechaBase, siguiente } = await G.siguienteOrdenId();
  for (let i = 0; i < 5; i++) {
    const candidato = `${fechaBase}${String(siguiente + i).padStart(2, "0")}`;
    try {
      await db.collection("ordenes_de_servicio").doc(candidato).create(data);
      logger.info("[pedidoVenta] OS de programación creada", { pid, ordenId: candidato, equipos: equipos.length });
      return candidato;
    } catch (e) {
      if (e.code !== 6 && !/already exists/i.test(e.message || "")) throw e;
    }
  }
  logger.error("[pedidoVenta] no se pudo reservar número para la OS", { pid });
  return null;
}

async function correoRecepcion(pid, p, ordenId) {
  const dests = await G.destinatariosRecepcionVendedor(p.cliente_id);
  if (creador(p) && !dests.includes(creador(p))) dests.push(creador(p));
  if (!dests.length) { logger.warn("[pedidoVenta] aviso de seriales sin destinatarios", { pid }); return; }
  const fact = facturaTxt(p);
  const n = (p.seriales || []).length;
  const pedidos = (p.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
  const incompleto = pedidos > 0 && n < pedidos;
  // Sin OS (el pedido no la pedía, o no se pudo crear): el botón lleva a crearla
  // precargada, igual que la fila de "Órdenes por crear".
  const ctaUrl = ordenId
    ? `${APP_BASE_URL}/ordenes/index.html?ids=${encodeURIComponent(ordenId)}`
    : `${APP_BASE_URL}/ordenes/nueva-orden.html?${new URLSearchParams({
        tipo: "PROGRAMACION", origen: "venta", cliente_id: p.cliente_id || "",
        seriales: (p.seriales || []).map(s => s.serial).join(","), factura: p.factura || "",
      }).toString()}`;
  await G.encolarCorreo({
    to: dests[0],
    cc: dests.length > 1 ? dests.slice(1).join(",") : null,
    subject: ordenId
      ? `Seriales asignados · OS de programación ${ordenId} — factura ${fact} · ${p.cliente_nombre || "Cliente"}`
      : `Seriales asignados — factura ${fact} · ${p.cliente_nombre || "Cliente"}`,
    preheader: `${n} equipo(s): ${(p.seriales || []).slice(0, 4).map(s => s.serial).join(", ")}${n > 4 ? "…" : ""}`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Bodega asignó los seriales</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Venta a <b>${esc(p.cliente_nombre || "—")}</b>, factura <b>${esc(fact)}</b>:
        Bodega asignó <b>${n}</b> equipo(s)${p.asignado_por_email ? ` (${esc(p.asignado_por_email)})` : ""}.
        ${ordenId
          ? `El sistema creó la orden de programación <b>${esc(ordenId)}</b>.`
          : p.requiere_programacion === false
            ? "Esta venta se registró <b>sin programación</b>: no se creó orden."
            : "<b>No se pudo crear la orden de programación</b>: créala desde el botón (sale precargada)."}
      </p>
      ${incompleto ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;background:#FEF3C7;border-radius:6px;padding:10px 12px;">
        ⚠️ Se pidieron <b>${pedidos}</b> equipo(s) y bodega asignó <b>${n}</b>.</p>` : ""}
      ${G.tablaHtml(["Serial", "Modelo"], (p.seriales || []).map(s => [
        `<code>${esc(s.serial || "—")}</code>`, esc(s.modelo || "—"),
      ]))}`,
    ctaUrl,
    ctaLabel: ordenId ? "Ver la orden" : "Crear orden de programación",
    meta: { source: "pedidos_venta", pedido_id: pid, paso: "asignada", ...(ordenId ? { ordenes: ordenId } : {}) },
  });
}

module.exports = onDocumentWritten(
  { document: "pedidos_venta/{pid}", region: "us-central1" },
  async (event) => {
    const pid = event.params.pid;
    const before = event.data.before?.exists ? event.data.before.data() : null;
    const after = event.data.after?.exists ? event.data.after.data() : null;
    if (!after) return null;
    const ref = event.data.after.ref;

    // 1) Pedido nuevo → bodega.
    if (after.estado === "pendiente_bodega" && !after.aviso_bodega_at) {
      if (await reservar(ref, "aviso_bodega_at")) {
        try { await correoBodega(pid, after); }
        catch (e) { logger.error("[pedidoVenta] correo a bodega falló", { pid, message: e.message }); }
      }
    }

    // 2) Bodega asignó → OS + recepción.
    if (after.estado === "asignada" && before?.estado !== "asignada" && !after.aviso_asignada_at) {
      if (!(await reservar(ref, "aviso_asignada_at"))) return null;
      let ordenId = null;
      if (after.requiere_programacion !== false) {
        try {
          ordenId = await crearOrden(pid, after);
          if (ordenId) await ref.update({ orden_programacion_id: ordenId });
        } catch (e) { logger.error("[pedidoVenta] OS de programación falló", { pid, message: e.message }); }
      }
      try { await correoRecepcion(pid, after, ordenId); }
      catch (e) { logger.error("[pedidoVenta] correo a recepción falló", { pid, message: e.message }); }
    }
    return null;
  }
);
