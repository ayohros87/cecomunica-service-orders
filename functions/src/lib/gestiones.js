// Gestiones por cliente — helpers compartidos de la Ola 2 (reemplazo y demo).
// docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md §4.4.
//
// Una gestión (gestiones/{gid}) es el expediente del CLIENTE; el contrato es
// solo la envoltura de facturación de cada ítem. La cadena completa:
//   crear → correo a Bodega → Bodega asigna serial → OS PROGRAMACIÓN (correo a
//   Recepción + CC vendedor) → entrega desde la OS → orden DEVOLUCIÓN del
//   saliente → check-in → ENTRADA (cadena existente) → cierre automático 4/4.
// Todo el avance es por triggers: nadie "regresa" a la gestión a apretar nada.
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { configEmailTo, bodegaEmailTo } = require("./mailRecipients");

const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, s => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]
));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

const TIPO_LABEL = { reemplazo: "Reemplazo", demo: "Demo", baja: "Baja de equipos", aumento: "Aumento de equipos" };

// Deep-link al expediente dentro del Centro de gestión.
// Enlace de BODEGA: la pestaña Asignar de Almacén con la gestión abierta
// (2026-09-03). Bodega ya no trabaja en la ficha del cliente.
function urlBodegaGestion(gid) {
  return `${APP_BASE_URL}/almacen/index.html?tab=asignar&g=${encodeURIComponent(gid)}`;
}

function urlGestion(g, gid) {
  return `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(g.cliente_id || "")}&g=${encodeURIComponent(gid)}`;
}

// Número de orden AAAAMMDDNN (misma aritmética que ordenEntrada/ordenDevolucion;
// tercera copia consciente — extraerla a lib común es limpieza pendiente).
async function _siguienteOrdenId() {
  const hoy = new Date();
  const local = new Date(hoy.getTime() - 5 * 60 * 60 * 1000); // Panamá UTC-5 sin DST
  const fechaBase = `${local.getUTCFullYear()}${String(local.getUTCMonth() + 1).padStart(2, "0")}${String(local.getUTCDate()).padStart(2, "0")}`;
  const snap = await db.collection("ordenes_de_servicio")
    .where(admin.firestore.FieldPath.documentId(), ">=", `${fechaBase}00`)
    .where(admin.firestore.FieldPath.documentId(), "<=", `${fechaBase}99`)
    .get();
  const usados = snap.docs.map(d => parseInt(d.id.slice(-2), 10)).filter(n => !Number.isNaN(n));
  return { fechaBase, siguiente: usados.length ? Math.max(...usados) + 1 : 1 };
}

// Recepción (config o rol) + vendedor asignado del cliente. Nunca lanza.
async function destinatariosRecepcionVendedor(clienteId) {
  const emails = new Set();
  try {
    const cfg = await configEmailTo("recepcion", "");
    if (cfg) cfg.split(",").map(s => s.trim().toLowerCase()).filter(isEmail).forEach(e => emails.add(e));
  } catch (e) { /* fallback abajo */ }
  if (!emails.size) {
    try {
      const snap = await db.collection("usuarios").where("rol", "==", "recepcion").get();
      snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
    } catch (e) { logger.warn("[gestiones] usuarios de recepción ilegibles", { error: e.message }); }
  }
  try {
    if (clienteId) {
      const cli = await db.collection("clientes").doc(clienteId).get();
      const vendUid = cli.exists ? cli.data().vendedor_asignado : null;
      if (vendUid) {
        const v = await db.collection("usuarios").doc(vendUid).get();
        const e = v.exists ? v.data().email : null;
        if (isEmail(e)) emails.add(e.trim().toLowerCase());
      }
    }
  } catch (e) { logger.warn("[gestiones] vendedor del cliente ilegible", { clienteId, error: e.message }); }
  return [...emails];
}

// Administradores (para la aprobación de la excepción por servicio al cliente).
async function adminEmails() {
  const emails = new Set();
  try {
    const snap = await db.collection("usuarios").where("rol", "==", "administrador").get();
    snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
  } catch (e) { logger.warn("[gestiones] usuarios admin ilegibles", { error: e.message }); }
  return [...emails];
}

// Email del vendedor asignado de un cliente (o null). Nunca lanza.
async function vendedorEmailDeCliente(clienteId) {
  try {
    if (!clienteId) return null;
    const cli = await db.collection("clientes").doc(clienteId).get();
    const uid = cli.exists ? cli.data().vendedor_asignado : null;
    if (!uid) return null;
    const u = await db.collection("usuarios").doc(uid).get();
    const e = u.exists ? u.data().email : null;
    return isEmail(e) ? e.trim().toLowerCase() : null;
  } catch (e) {
    logger.warn("[gestiones] vendedor del cliente ilegible", { clienteId, error: e.message });
    return null;
  }
}

// Aprobadores de bajas: administración y gerencia (mismo criterio que las
// enmiendas clásicas de solicitudes_cancelacion).
async function aprobadoresEmails() {
  const emails = new Set();
  try {
    const snap = await db.collection("usuarios").where("rol", "in", ["administrador", "gerente"]).get();
    snap.forEach(d => { const e = d.data()?.email; if (isEmail(e)) emails.add(e.trim().toLowerCase()); });
  } catch (e) { logger.warn("[gestiones] usuarios aprobadores ilegibles", { error: e.message }); }
  return [...emails];
}

// Buzón de TODAS las solicitudes de aprobación (regla de Alberto 2026-08-28):
// van a ventas@cecomunica.com — los aprobadores individuales quedan en copia.
// Configurable con empresa/config.email_aprobaciones.
async function aprobacionesTo() {
  return configEmailTo("aprobaciones", "ventas@cecomunica.com");
}

// Devuelve el id del doc en mail_queue (la bandeja de facturación lo enlaza
// para mostrar si el correo salió y reenviarlo si falló).
async function encolarCorreo({ to, cc, subject, preheader, bodyContent, ctaUrl, ctaLabel, meta }) {
  const ref = await db.collection("mail_queue").add({
    to,
    cc: cc || null,
    subject, preheader, bodyContent,
    ctaUrl, ctaLabel,
    meta: { created_at: admin.firestore.FieldValue.serverTimestamp(), source: "gestiones", ...(meta || {}) },
    status: "queued",
  });
  return ref.id;
}

function tablaHtml(headers, rows) {
  const th = headers.map(h => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">${escapeHtml(h)}</th>`).join("");
  const trs = rows.map(cols =>
    `<tr>${cols.map(c => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${c}</td>`).join("")}</tr>`).join("");
  return `<table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 4px;">
    <thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// Bitácora del expediente (append-only, autor system).
async function registrarEvento(gid, accion, detalle) {
  try {
    await db.collection("gestiones").doc(gid).collection("eventos").add({
      accion, detalle: detalle || "",
      at: admin.firestore.FieldValue.serverTimestamp(),
      por_uid: "system", por_email: null,
    });
  } catch (e) { logger.warn("[gestiones] evento no registrado", { gid, accion, error: e.message }); }
}

/**
 * Crea la(s) orden(es) de PROGRAMACIÓN de una gestión con seriales asignados.
 * Reemplazo: UNA orden por contrato afectado (los ítems pueden cruzar
 * contratos y la orden lleva el vínculo de facturación del suyo); cada equipo
 * indica el serial saliente cuya configuración se toma de referencia.
 * Demo: una sola orden sin contrato (motivo_no_aplica: 'demo').
 * Devuelve la lista de ids creadas.
 */
async function crearOrdenesProgramacion(gid, g) {
  const ordenes = [];
  const grupos = [];
  if (g.tipo === "reemplazo") {
    const porContrato = new Map();
    for (const it of (g.items || [])) {
      const k = it.contrato_doc_id || "__sin__";
      if (!porContrato.has(k)) porContrato.set(k, []);
      porContrato.get(k).push(it);
    }
    for (const [cid, items] of porContrato) grupos.push({ contratoDocId: cid === "__sin__" ? null : cid, items });
  } else if (g.tipo === "aumento") {
    // Aumento por enmienda firmada: todas las unidades van al contrato destino
    // del anexo; la vigencia del tramo la estampa onOrdenWriteGestion al entregar.
    grupos.push({
      contratoDocId: g.aumento?.contrato_doc_id || null,
      contratoIdForzado: g.aumento?.contrato_id || null,
      items: (g.aumento?.seriales_asignados || []).map(s => ({ ...s, esLinea: true })),
    });
  } else {
    grupos.push({ contratoDocId: null, items: (g.demo?.seriales_asignados || []).map(s => ({ ...s, esDemo: true })) });
  }

  for (const grupo of grupos) {
    const contratoId = grupo.contratoIdForzado || grupo.items.find(i => i.contrato_id)?.contrato_id || null;
    const equipos = grupo.items.map(it => {
      const serial = String((it.esDemo || it.esLinea) ? it.serial : it.serial_nuevo || "").trim();
      return {
        id: crypto.randomUUID(),
        modelo_id: ((it.esDemo || it.esLinea) ? it.modelo_id : (it.modelo_solicitado_id || it.modelo_id)) || null,
        modelo: String((it.esDemo || it.esLinea) ? it.modelo : (it.modelo_solicitado || it.modelo || "")).trim(),
        serial,
        numero_de_serie: serial,
        observaciones: it.esDemo
          ? `Programación para DEMO (gestión ${gid}).`
          : it.esLinea
            ? `Programación de AUMENTO (enmienda ${gid}) — equipo nuevo del contrato ${contratoId || "—"} con vigencia propia.`
            : `REEMPLAZA al serial ${it.serial_saliente || "—"}: copiar su configuración, colocar su ID y confirmar. Motivo: ${it.motivo_detalle || it.motivo_codigo || "reemplazo"}.`,
        eliminado: false,
      };
    }).filter(e => e.serial);
    if (!equipos.length) continue;

    const data = {
      cliente_id: g.cliente_id || "",
      cliente_nombre: g.cliente_nombre || "",
      vendedor_asignado: "",
      tipo_de_servicio: "PROGRAMACIÓN",
      estado_reparacion: "POR ASIGNAR",
      fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
      observaciones: g.tipo === "reemplazo"
        ? `Orden creada automáticamente por la gestión ${gid} (reemplazo): programar ${equipos.length} equipo(s). Cada equipo indica el serial que sustituye — la programación toma como referencia la configuración del radio reemplazado.`
        : g.tipo === "aumento"
          ? `Orden creada automáticamente por la enmienda de aumento ${gid}: programar ${equipos.length} equipo(s) nuevos del contrato ${contratoId || "—"} (vigencia propia del tramo).`
          : `Orden creada automáticamente por la gestión ${gid} (demo): programar ${equipos.length} equipo(s) para demostración.`,
      equipos,
      contrato: grupo.contratoDocId
        ? { aplica: true, contrato_doc_id: grupo.contratoDocId, contrato_id: contratoId, motivo_no_aplica: null }
        : { aplica: false, contrato_doc_id: null, contrato_id: null, motivo_no_aplica: g.tipo === "demo" ? "demo" : "gestion" },
      gestion: { id: gid, tipo: g.tipo },
      creado_por_uid: "system",
      creado_por_email: null,
      eliminado: false,
      os_logs: [{ action: "CREAR", by: "system:gestiones" }],
    };

    let ordenId = null;
    const { fechaBase, siguiente } = await _siguienteOrdenId();
    for (let i = 0; i < 5 && !ordenId; i++) {
      const candidato = `${fechaBase}${String(siguiente + i).padStart(2, "0")}`;
      try {
        await db.collection("ordenes_de_servicio").doc(candidato).create(data);
        ordenId = candidato;
      } catch (e) {
        if (e.code !== 6 && !/already exists/i.test(e.message || "")) throw e;
      }
    }
    if (ordenId) {
      ordenes.push(ordenId);
      logger.info("[gestiones] OS de programación creada", { gid, ordenId, equipos: equipos.length });
    } else {
      logger.error("[gestiones] no se pudo reservar número para la OS de programación", { gid });
    }
  }
  return ordenes;
}

/**
 * Limpieza al ANULAR una gestión (pedido 2026-08-27, caso P223344): revierte
 * los efectos que la gestión dejó regados — sin tocar lo que ya ocurrió en el
 * mundo físico (entregas y check-ins se revisan a mano, no se des-hacen).
 *   · Orden de DEVOLUCIÓN sin ningún check-in → eliminada (soft-delete).
 *   · OS de PROGRAMACIÓN aún abiertas (POR ASIGNAR/RECIBIDO/ASIGNADO) → ídem.
 *   · Salientes: se les quita pendiente_devolucion (con movimiento en kardex).
 *   · Entrantes asignados por la gestión y aún en asignado_contrato → vuelven
 *     a bodega (liberación); si tenían reemplaza_a de esta gestión, se borra.
 *   · Baja: se recalculan los derivados de los contratos afectados (la lib ya
 *     excluye gestiones anuladas). Aumento derivado sin entregar: se retiran
 *     las líneas/cargos de la enmienda.
 * Devuelve la lista de acciones (queda en la bitácora del expediente).
 */
async function limpiarAnulacion(gid, g) {
  const pool = require("../domain/equiposPool");
  const acciones = [];
  const ABIERTOS = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO"];

  // 1) Orden de DEVOLUCIÓN
  const devId = g.ordenes?.devolucion_id;
  if (devId) {
    try {
      const ref = db.collection("ordenes_de_servicio").doc(devId);
      const s = await ref.get();
      const o = s.exists ? s.data() : null;
      if (o && !o.eliminado) {
        const resueltos = (o.devolucion?.esperados || []).filter(e => e.resolucion).length;
        if (resueltos === 0 && (o.estado_reparacion || "") !== "CERRADA (DEVOLUCION)") {
          await ref.update({
            eliminado: true,
            eliminado_motivo: `Gestión ${gid} anulada`,
            os_logs: admin.firestore.FieldValue.arrayUnion({ action: "ELIMINAR", by: "system:gestiones", motivo: `Gestión ${gid} anulada`, at_iso: new Date().toISOString() }),
          });
          acciones.push(`devolución ${devId} eliminada`);
        } else {
          acciones.push(`devolución ${devId} tiene check-ins — revisar a mano`);
        }
      }
    } catch (e) { logger.warn("[gestiones] limpieza devolución falló", { gid, devId, message: e.message }); }
  }

  // 2) OS de PROGRAMACIÓN abiertas
  const progIds = g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : []);
  for (const pid of progIds) {
    try {
      const ref = db.collection("ordenes_de_servicio").doc(pid);
      const s = await ref.get();
      const o = s.exists ? s.data() : null;
      if (o && !o.eliminado) {
        if (ABIERTOS.includes((o.estado_reparacion || "").toUpperCase())) {
          await ref.update({
            eliminado: true,
            eliminado_motivo: `Gestión ${gid} anulada`,
            os_logs: admin.firestore.FieldValue.arrayUnion({ action: "ELIMINAR", by: "system:gestiones", motivo: `Gestión ${gid} anulada`, at_iso: new Date().toISOString() }),
          });
          acciones.push(`OS ${pid} eliminada`);
        } else {
          acciones.push(`OS ${pid} ya trabajada (${o.estado_reparacion}) — revisar a mano`);
        }
      }
    } catch (e) { logger.warn("[gestiones] limpieza OS falló", { gid, pid, message: e.message }); }
  }

  const movAnulacion = (notas) => ({
    at: admin.firestore.FieldValue.serverTimestamp(),
    por: "system", por_email: null,
    tipo: "gestion_anulada", de_estado: null, a_estado: null,
    ref: { tipo: "gestion", id: gid, label: gid },
    notas,
  });

  // 3) Salientes: quitar pendiente_devolucion
  for (const it of (g.items || [])) {
    const serial = String(it.serial_saliente || it.serial || "").trim();
    if (!serial) continue;
    try {
      const r = await pool.resolver(serial, it.modelo_id || null, it.modelo || "");
      if (r.data?.pendiente_devolucion) {
        await r.ref.set({
          pendiente_devolucion: admin.firestore.FieldValue.delete(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await r.ref.collection("movimientos").add(movAnulacion(`Gestión ${gid} anulada — ya no está pendiente de devolución`));
        acciones.push(`${serial}: pendiente_devolucion retirado`);
      }
    } catch (e) { logger.warn("[gestiones] limpieza saliente falló", { gid, serial, message: e.message }); }
  }

  // 4) Entrantes asignados por la gestión
  const entrantes = [
    ...(g.items || []).map(it => ({ serial: it.serial_nuevo, modelo_id: it.modelo_solicitado_id || it.modelo_id, modelo: it.modelo_solicitado || it.modelo, saliente: it.serial_saliente })),
    ...((g.demo?.seriales_asignados || [])),
    ...((g.aumento?.seriales_asignados || [])),
  ].filter(u => String(u.serial || "").trim());
  for (const u of entrantes) {
    try {
      const r = await pool.resolver(u.serial, u.modelo_id || null, u.modelo || "");
      if (!r.data) continue;
      if (u.saliente && r.data.reemplaza_a === pool.normSerial(u.saliente)) {
        await r.ref.set({ reemplaza_a: admin.firestore.FieldValue.delete(), updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
      if (r.data.asignacion?.gestion_doc_id === gid && r.data.estado === pool.ESTADOS.ASIGNADO) {
        const t = await pool.transicionar(u.serial, u.modelo_id || null, u.modelo || "", {
          aEstado: pool.ESTADOS.EN_BODEGA,
          soloDesde: [pool.ESTADOS.ASIGNADO],
          tipo: "liberacion",
          refMov: { tipo: "gestion", id: gid, label: gid },
          notas: `Gestión ${gid} anulada — vuelve a bodega`,
          extra: { asignacion: null },
        });
        if (t === "transicion") acciones.push(`${u.serial}: liberado a bodega`);
      } else if (r.data.asignacion?.gestion_doc_id === gid && r.data.estado === pool.ESTADOS.EN_CLIENTE) {
        acciones.push(`${u.serial}: YA ENTREGADO — recuperar a mano`);
      }
    } catch (e) { logger.warn("[gestiones] limpieza entrante falló", { gid, serial: u.serial, message: e.message }); }
  }

  // 5) Baja: recalcular derivados (la lib excluye gestiones anuladas)
  if (g.tipo === "baja" && Array.isArray(g.contratos_afectados)) {
    const { derivarBajaContrato } = require("./bajas");
    for (const cid of g.contratos_afectados) {
      await derivarBajaContrato(cid);
    }
    if (g.contratos_afectados.length) acciones.push(`derivados de baja recalculados en ${g.contratos_afectados.length} contrato(s)`);
  }

  // 6) Aumento derivado y sin entregar: retirar líneas/cargos de la enmienda.
  //    El anexo de REGULARIZACIÓN es la excepción a "vigente = intocable": sus
  //    líneas nacen vigentes pero sus equipos no salieron de bodega, así que
  //    la anulación sí puede revertirlo completo (des-amarre + sobrantes de
  //    vuelta a la conciliación).
  if (g.tipo === "aumento" && g.cierre?.derivacion && g.aumento?.contrato_doc_id) {
    const esReg = g.aumento?.es_regularizacion === true;
    try {
      const cRef = db.collection("contratos").doc(g.aumento.contrato_doc_id);
      let revertido = false;
      await db.runTransaction(async (tx) => {
        const s = await tx.get(cRef);
        if (!s.exists) return;
        const c = s.data();
        const propias = (c.equipos || []).filter(l => l.enmienda_id === gid);
        if (!esReg && propias.some(l => l.vigencia?.estado === "vigente")) {
          acciones.push("líneas del aumento YA ENTREGADAS — revisar el contrato a mano");
          return;
        }
        const patch = {
          equipos: (c.equipos || []).filter(l => l.enmienda_id !== gid),
          ...(Array.isArray(c.cargos) ? { cargos: c.cargos.filter(x => x.enmienda_id !== gid) } : {}),
          enmiendas_aumento: admin.firestore.FieldValue.arrayRemove(gid),
        };
        if (esReg && c.regularizacion?.ultima_por === `anexo:${gid}`) {
          // Los seriales vuelven a la lista de sobrantes (sin_linea) para que
          // el trámite/bandeja los sigan reclamando.
          const r = c.regularizacion || {};
          const devueltos = (g.aumento.regulariza_seriales || []).map(x => String(x.serial || "")).filter(Boolean);
          const sl = [...new Set([...(r.sin_linea_seriales || []), ...devueltos])];
          patch.regularizacion = {
            ...r,
            amarradas: Math.max(0, Number(r.amarradas || 0) - devueltos.length),
            sin_linea: sl.length, sin_linea_seriales: sl,
            ultima_por: `anulacion:${gid}`,
          };
        }
        tx.set(cRef, patch, { merge: true });
        revertido = true;
        if (propias.length) acciones.push(`${propias.length} línea(s) del aumento retiradas del contrato`);
      });
      if (esReg && revertido) {
        let sueltos = 0;
        for (const sr of (g.aumento.regulariza_seriales || [])) {
          if (!sr.pool_doc_id) continue;
          try {
            const pSnap = await db.collection("equipos_pool").doc(sr.pool_doc_id).get();
            // Solo se des-amarra lo que ESTE anexo amarró (gestion_doc_id).
            if (pSnap.exists && pSnap.data().asignacion?.gestion_doc_id === gid) {
              await pSnap.ref.update({
                "asignacion.contrato_doc_id": null,
                "asignacion.contrato_id": "",
                "asignacion.gestion_doc_id": admin.firestore.FieldValue.delete(),
              });
              sueltos++;
            }
          } catch (e) { logger.warn("[gestiones] des-amarre de regularización falló", { gid, serial: sr.serial, message: e.message }); }
        }
        if (sueltos) acciones.push(`${sueltos} equipo(s) des-amarrados — vuelven como sobrantes de la conciliación`);
      }
    } catch (e) { logger.warn("[gestiones] limpieza aumento falló", { gid, message: e.message }); }
  }

  await registrarEvento(gid, "anulacion_limpieza", acciones.length ? acciones.join(" · ") : "Sin efectos que revertir.");
  logger.info("[gestiones] anulación limpiada", { gid, acciones: acciones.length });
  return acciones;
}

// ── Aviso unificado a RECEPCIÓN (buzón "activaciones") ──────────────────────
// Decisión Alberto 2026-09-02: cada vez que algo se vuelve COMERCIALMENTE
// EFECTIVO — contrato/renovación activo, tramo de aumento entregado, ajuste o
// regularización firmados, baja aprobada, terminación completada — recepción
// recibe EL MISMO correo de acción: QuickBooks (manual, aún sin integración),
// POC y taller. CC: el vendedor del cliente. Cuando QBO se integre, estos
// cinco puntos son el enchufe de la automatización.
// 2026-09-04 (bandeja "Facturación pendiente"): el pie ya no lista acciones —
// dice dónde se marcan. "Pasar a taller" salió: la OS llega a taller sola.
const CHECKLIST_FACTURACION = `
  <p style="margin:14px 0 0;font:13px/1.6 Arial,sans-serif;color:#40525f;border-top:1px solid #e5e7eb;padding-top:10px;">
    Marca <b>QuickBooks</b> y <b>POC</b> como hechos en la bandeja <b>Facturación pendiente</b> (Finanzas).
    Si este aviso no aplica, descártalo ahí con el motivo.</p>`;

// `aviso` (opcional): datos estructurados para crear el renglón en
// facturacion_avisos ANTES de encolar el correo — el correo puede fallar y el
// aviso existe igual. Ver lib/facturacionAvisos.js. Si viene, el CTA del
// correo apunta a la fila de la bandeja (el contrato/expediente se abren desde
// ahí) y el aviso queda enlazado al doc de mail_queue.
async function avisoFacturacion({ subject, titulo, cuerpo, cliente_id, cliente_nombre = "",
  responsable_uid = null, responsable_email = null, ctaUrl, ctaLabel, meta, aviso = null }) {
  let avisoId = null;
  try {
    const cc = await vendedorEmailDeCliente(cliente_id);
    if (aviso) {
      try {
        const FA = require("./facturacionAvisos");
        const r = await FA.crearAviso({ ...aviso, cliente_id, cliente_nombre, vendedor_email: cc || null,
          source: meta?.source || meta?.paso || null });
        avisoId = r.id;
      } catch (e0) { logger.error("[gestiones] facturacion_avisos no creado", { message: e0.message, subject }); }
    }
    const { activacionesEmailTo } = require("./mailRecipients");
    const to = await activacionesEmailTo();
    const mailId = await encolarCorreo({
      to, cc: cc || null, subject,
      preheader: "Acción de facturación / servicio",
      bodyContent: `<h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">${titulo}</h2>${cuerpo}${CHECKLIST_FACTURACION}`,
      ctaUrl: avisoId ? `${APP_BASE_URL}/facturacion/bandeja.html?aviso=${encodeURIComponent(avisoId)}` : ctaUrl,
      ctaLabel: avisoId ? "Abrir en Facturación pendiente" : ctaLabel,
      meta: { ...(meta || {}), ...(avisoId ? { aviso_id: avisoId } : {}) },
    });
    if (avisoId && mailId) {
      try { await require("./facturacionAvisos").vincularCorreo(avisoId, mailId); }
      catch (e1) { logger.warn("[gestiones] aviso sin enlace al correo", { avisoId, message: e1.message }); }
    }

    // Ficha SIN vendedor asignado (2026-09-02, decisión Alberto tras el caso
    // FANLYC): el aviso salió sin CC al vendedor — se alerta a RECEPCIÓN
    // (cecrecep) con copia al ELABORADOR para que la ficha se corrija.
    if (!cc && cliente_id) {
      try {
        const { recepcionEmails } = require("./mailRecipients");
        const recep = await recepcionEmails();
        const toAlerta = (recep && recep.length) ? recep.join(",") : "cecrecep@cecomunica.com";
        let elaborador = responsable_email || null;
        if (!elaborador && responsable_uid) {
          const u = await db.collection("usuarios").doc(responsable_uid).get().catch(() => null);
          elaborador = u?.exists ? (u.data().email || null) : null;
        }
        if (elaborador && (!isEmail(elaborador) || String(elaborador).endsWith("@sin.email.cecomunica.com"))) elaborador = null;
        await encolarCorreo({
          to: toAlerta, cc: elaborador,
          subject: `Cuenta sin vendedor asignado: ${cliente_nombre || cliente_id}`,
          preheader: "El aviso de facturación salió sin copia al vendedor",
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Ficha sin vendedor asignado</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              El aviso «${escapeHtml(subject)}» salió <b>sin copia al vendedor</b> porque la ficha de
              <b>${escapeHtml(cliente_nombre || cliente_id)}</b> no tiene <b>vendedor asignado</b>.
              Asignen el vendedor en la ficha del cliente para que los próximos avisos lo copien solos.</p>`,
          ctaUrl: `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(cliente_id)}`,
          ctaLabel: "Abrir la ficha del cliente",
          meta: { ...(meta || {}), paso: "alerta_sin_vendedor" },
        });
      } catch (e2) { logger.warn("[gestiones] alerta sin-vendedor no encolada", { message: e2.message }); }
    }
  } catch (e) { logger.warn("[gestiones] avisoFacturacion no encolado", { message: e.message, subject }); }
}

// Detalle completo de un anexo/aumento (líneas con modalidad, cargos con sus
// seriales, tarifas renegociadas, total) — compartido por los correos de
// aprobación, cierre y los avisos de facturación.
function detalleAumentoHtml(a = {}) {
  let html = "";
  if ((a.lineas || []).length) {
    html += tablaHtml(["Cant.", "Equipo", "Precio/mes"], a.lineas.map(l => [
      String(Number(l.cantidad || 0)),
      escapeHtml(l.modelo || "—") + (l.modalidad === "propio" ? " — equipo del cliente" : ""),
      `$${Number(l.precio || 0).toFixed(2)}`,
    ]));
  }
  if ((a.cargos || []).length) {
    html += tablaHtml(["Cant.", "Cargo / servicio", "Tipo", "Monto", "Equipos"], a.cargos.map(cg => [
      String(Number(cg.cantidad || 1)),
      escapeHtml(cg.concepto || "—"),
      cg.recurrente ? "Mensual" : "Único",
      `$${Number(cg.monto || 0).toFixed(2)}`,
      (cg.seriales || []).length ? `<code>${cg.seriales.map(escapeHtml).join(", ")}</code>` : "—",
    ]));
  }
  if ((a.ajustes_precio || []).length) {
    html += `<p style="margin:12px 0 4px;font:14px Arial,sans-serif;"><b>Tarifas renegociadas:</b></p>`
      + tablaHtml(["Línea", "Cant.", "Antes", "Ahora"], a.ajustes_precio.map(x => [
          escapeHtml(x.modelo || "—"), String(Number(x.cantidad || 0)),
          `$${Number(x.precio_anterior || 0).toFixed(2)}`, `<b>$${Number(x.precio_nuevo || 0).toFixed(2)}</b>`,
        ]));
  }
  const t = a.totales || {};
  if (t.total_mensual != null) {
    html += `<p style="margin:8px 0 0;font:14px Arial,sans-serif;">Total mensual del anexo:
      <b>$${Number(t.total_mensual || 0).toFixed(2)}</b>${Number(t.cargos_uni || 0) > 0
        ? ` · Primer pago: <b>$${Number(t.primer_pago || 0).toFixed(2)}</b>` : ""}</p>`;
  }
  return html || `<p style="font:13px Arial,sans-serif;color:#666;">(sin detalle registrado)</p>`;
}

module.exports = {
  limpiarAnulacion,
  avisoFacturacion, detalleAumentoHtml,
  TIPO_LABEL, escapeHtml, isEmail, urlGestion, urlBodegaGestion, tablaHtml,
  destinatariosRecepcionVendedor, vendedorEmailDeCliente, adminEmails, aprobadoresEmails, aprobacionesTo, encolarCorreo,
  configEmailTo,
  registrarEvento, crearOrdenesProgramacion,
  bodegaEmailTo,
};
