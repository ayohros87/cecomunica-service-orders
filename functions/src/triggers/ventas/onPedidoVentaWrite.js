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
const R = require("../../lib/reposicionAlquiler");

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

// Reposición de un radio alquilado (robo, pérdida o daño): no es venta, ver
// lib/reposicionAlquiler.js. Texto corto para asunto y correos.
const perdidosTxt = (p) => (p.reposicion?.items || []).map(i => i.serial_saliente).filter(Boolean).join(", ");
const esReposicion = (p) => (p.reposicion?.items || []).length > 0;

// Quien registró el pedido va en copia de los dos correos: el primero le queda
// como "lo pedí", el segundo como "ya está".
const creador = (p) => String(p.creado_por_email || "").trim().toLowerCase();

async function correoBodega(pid, p) {
  const to = await G.bodegaEmailTo();
  if (!to) { logger.warn("[pedidoVenta] bodega sin correo configurado", { pid }); return; }
  const cc = creador(p) && !to.toLowerCase().includes(creador(p)) ? creador(p) : null;
  await G.encolarCorreo({
    to, cc,
    subject: esReposicion(p)
      ? `Reposición (factura ${facturaTxt(p)}): asignar serial(es) — ${p.cliente_nombre || "Cliente"}`
      : `Venta facturada ${facturaTxt(p)}: asignar serial(es) — ${p.cliente_nombre || "Cliente"}`,
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
      ${esReposicion(p) ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;background:#EFF6FF;border-radius:6px;padding:10px 12px;">
        <b>No es una venta:</b> es la reposición de ${esc(perdidosTxt(p))} (${esc(R.motivoTxt(p.reposicion.motivo))}), radio(s) alquilado(s) del cliente.
        Asígnalo como siempre; el sistema lo deja de CECOMUNICA en el contrato del radio que repone y da de baja ese radio.</p>` : ""}
      ${G.tablaHtml(["Cantidad", "Modelo"], (p.lineas || []).map(l => [
        `${Number(l.cantidad || 0)}`, esc(l.modelo || "—"),
      ]))}
      ${p.notas ? `<p style="margin:12px 0 0;font:14px/1.5 Arial,sans-serif;"><b>Notas:</b> ${esc(p.notas)}</p>` : ""}`,
    ctaUrl: `${APP_BASE_URL}/almacen/index.html?venta=${encodeURIComponent(pid)}`,
    ctaLabel: "Asignar seriales",
    meta: { source: "pedidos_venta", pedido_id: pid, paso: "bodega" },
  });
}

async function crearOrden(pid, p, repo = null) {
  let vendedorUid = "";
  if (p.cliente_id) {
    try {
      const cli = await db.collection("clientes").doc(p.cliente_id).get();
      vendedorUid = (cli.exists && cli.data().vendedor_asignado) || "";
    } catch (e) { logger.warn("[pedidoVenta] vendedor de la ficha ilegible", { pid, error: e.message }); }
  }
  const fact = facturaTxt(p);
  // Reposición: el entrante pareado va con su contrato y su gestión, no como venta.
  const parDe = new Map((repo?.pares || []).map(x => [String(x.entrante).toUpperCase(), x]));
  const equipos = (p.seriales || []).map(s => {
    const serial = String(s.serial || "").trim();
    const par = parDe.get(serial.toUpperCase());
    return {
      id: crypto.randomUUID(),
      modelo_id: s.modelo_id || null,
      modelo: String(s.modelo || "").trim(),
      serial,
      numero_de_serie: serial,
      observaciones: par
        ? `Reposición del ${par.saliente} (${R.motivoTxt(repo.motivo)}, contrato ${par.contrato_id}) — factura ${fact}.`
        : `Venta directa — factura ${fact}.`,
      eliminado: false,
    };
  }).filter(e => e.serial);
  if (!equipos.length) return null;
  const vendidos = equipos.map(e => e.serial).filter(sr => !parDe.has(sr.toUpperCase()));

  const data = {
    cliente_id: p.cliente_id || "",
    cliente_nombre: p.cliente_nombre || "",
    vendedor_asignado: vendedorUid,
    tipo_de_servicio: "PROGRAMACIÓN",
    estado_reparacion: "POR ASIGNAR",
    fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
    observaciones: (repo?.gid
      ? `Orden creada automáticamente por la reposición ${repo.gid} (factura ${fact}): programar ${equipos.length} equipo(s).`
      : `Orden creada automáticamente por la venta facturada ${fact}: programar ${equipos.length} equipo(s).`)
      + (p.notas ? ` Notas de recepción: ${p.notas}` : ""),
    equipos,
    // Mismo amarre que la orden que nace de nueva-orden?origen=venta.
    contrato: repo?.contrato
      ? { aplica: true, contrato_doc_id: repo.contrato.doc_id, contrato_id: repo.contrato.id, motivo_no_aplica: null }
      : { aplica: false, contrato_doc_id: null, contrato_id: null, motivo_no_aplica: repo?.gid ? `Reposición ${repo.gid} — factura QBO ${fact}` : `Venta directa — factura QBO ${fact}` },
    ...(vendidos.length ? { origen_venta: { factura_qbo: p.factura || null, seriales: vendidos, pedido_id: pid } } : {}),
    ...(repo?.gid ? {
      gestion: { id: repo.gid, tipo: "reemplazo", regularizada: true },
      origen_reposicion: { factura_qbo: p.factura || null, pedido_id: pid, gestion_id: repo.gid, seriales: repo.pares.map(x => x.entrante) },
    } : {}),
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

async function correoRecepcion(pid, p, ordenId, repo = null) {
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
      ${repo?.gid ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;background:#ECFDF5;border-radius:6px;padding:10px 12px;">
        <b>Reposición registrada (${esc(repo.gid)}):</b> ${repo.pares.map(x => `${esc(x.entrante)} reemplaza a ${esc(x.saliente)} en el contrato ${esc(x.contrato_id)}`).join("; ")}.
        Los radios nuevos quedan de CECOMUNICA en el contrato y los que reponen quedaron dados de baja.</p>` : ""}
      ${(repo?.rechazados || []).length || (repo?.perdidosSinPar || []).length ? `<p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;background:#FEF3C7;border-radius:6px;padding:10px 12px;">
        ⚠️ No se registró como reposición: ${[...(repo.rechazados || []).map(x => `${esc(x.serial)} (${esc(x.motivo)})`), ...(repo.perdidosSinPar || []).map(x => `${esc(x.serial)} (bodega no asignó un radio del mismo modelo)`)].join("; ")}.
        Lo que quedó sin parear figura como venta: avísale a administración.</p>` : ""}
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
      // Reposición de alquiler: el pool se corrige ANTES de crear la OS, para
      // que la orden nazca con el contrato y la gestión.
      let repo = null;
      if (esReposicion(after)) {
        try {
          repo = await R.aplicar(pid, after);
          await ref.update({ reposicion_resultado: {
            gestion_id: repo?.gid || null, pares: repo?.pares || [],
            rechazados: repo?.rechazados || [], sin_par: (repo?.perdidosSinPar || []).map(x => x.serial),
          } });
        } catch (e) { logger.error("[pedidoVenta] reposición falló: queda como venta", { pid, message: e.message }); }
      }
      let ordenId = null;
      if (after.requiere_programacion !== false) {
        try {
          ordenId = await crearOrden(pid, after, repo);
          if (ordenId) await ref.update({ orden_programacion_id: ordenId });
          if (ordenId && repo?.gid) await R.ligarOrden(repo, ordenId);
        } catch (e) { logger.error("[pedidoVenta] OS de programación falló", { pid, message: e.message }); }
      }
      try { await correoRecepcion(pid, after, ordenId, repo); }
      catch (e) { logger.error("[pedidoVenta] correo a recepción falló", { pid, message: e.message }); }
    }
    return null;
  }
);
