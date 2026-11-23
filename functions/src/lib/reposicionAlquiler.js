// Reposición de un radio ALQUILADO que el cliente pagó (robo, pérdida o daño
// sin reparación) — pedido por la puerta de "Venta facturada" (Alberto, 2026-10-08).
//
// EL CASO QUE LO DESTAPÓ
//   COMPAÑÍA GOLY reportó robado el PNC460 23905A0436, de CECOMUNICA y en el
//   contrato REEMP20260303-01, y pagó el reemplazo con la factura 11076.
//   Recepción lo pidió como venta facturada y bodega asignó 25220A0521, que
//   quedó `vendido`, propiedad del cliente: un radio de alquiler regalado en
//   el pool, y el robado "con el cliente" para siempre. Alberto: el reemplazo
//   queda de CECOMUNICA y el robado se da de baja (lo corrigió el script
//   scripts/goly-reposicion-robo-2026-10-08.js; esto lo hace de aquí en más).
//
// CÓMO
//   Recepción marca la venta facturada como reposición y declara el/los
//   serial(es) perdido(s) (`pedidos_venta.reposicion.items`). Bodega asigna
//   como cualquier venta (las unidades quedan `vendido` un instante). Al pasar
//   el pedido a 'asignada', onPedidoVentaWrite llama `aplicar` ANTES de crear
//   la OS:
//     · parea cada perdido con un entrante del mismo modelo (o familia);
//     · entrante: vendido → asignado_contrato, propiedad cecomunica, en el
//       contrato del perdido, con reemplaza_a; la venta pasa a `venta_anulada`
//       (la factura sigue siendo el cobro de la reposición);
//     · perdido: baja con el motivo;
//     · gestión GR cerrada (origen regularización, como regularizarReemplazoOrden)
//       con `saliente_en_casa: true` — así la entrega de la OS no abre una
//       devolución de un radio que no va a volver.
//   Lo que no se pueda parear o validar sigue como venta, y el correo lo dice.
//
// DAÑO SIN REPARACIÓN (Brenda, 2026-11-23, R. SMITH COSTA DEL ESTE, factura
//   11372): el vendedor reportó un radio que cayó al agua; nunca pasó por el
//   taller y la factura ya estaba hecha. Solo había "robo" y "pérdida", así que
//   el radio quedó de baja como PERDIDO. El motivo es una etiqueta (nada más lo
//   lee): cambia el texto de la baja, la gestión y los correos, y el resto es
//   igual — el dañado se da de baja y no se espera devolución. El radio dañado
//   que SÍ está en el taller sigue por el Centro (lib/reposicionDano), que
//   cotiza antes de facturar.
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const pool = require("../domain/equiposPool");
const { catalogo, ModeloFamilia } = require("../domain/modeloCatalogo");

const FV = admin.firestore.FieldValue;
const MOTIVOS = { robo: "robo", perdida: "pérdida", dano: "daño sin reparación" };
// Un motivo que no se conoce (pedido viejo, dato a mano) cuenta como robo.
const motivoCodigo = (m) => (Object.prototype.hasOwnProperty.call(MOTIVOS, m) ? m : "robo");
const motivoTxt = (m) => MOTIVOS[motivoCodigo(m)];

// Estados en los que un radio de contrato está "con el cliente" (o en su
// orden de taller). Fuera de eso no hay qué dar de baja como perdido.
const ESTADOS_CON_CLIENTE = new Set([pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_TALLER]);

// ¿Este radio puede reponerse como alquiler para este cliente? Pura.
function validarPerdido(data, clienteId) {
  if (!data) return "no está en el inventario";
  if (data.propiedad === "cliente") return "es del cliente (equipo propio): eso es una venta, no una reposición";
  if (!ESTADOS_CON_CLIENTE.has(data.estado)) return `está ${data.estado || "sin estado"}, no con el cliente`;
  const a = data.asignacion || {};
  if (a.cliente_id !== clienteId) return a.cliente_nombre ? `está con ${a.cliente_nombre}` : "no está asignado a este cliente";
  if (!a.contrato_doc_id) return "no está en ningún contrato";
  return null;
}

// Parea perdidos con entrantes: primero el mismo modelo_id, después la misma
// familia (N/R). Pura; devuelve { pares, perdidosSinPar, entrantesSinPar }.
function parear(perdidos, entrantes, mismaFamilia = (a, b) => ModeloFamilia.mismaFamilia(a, b)) {
  const libres = [...entrantes];
  const pares = []; const perdidosSinPar = [];
  const tomar = (pred) => { const i = libres.findIndex(pred); return i < 0 ? null : libres.splice(i, 1)[0]; };
  for (const p of perdidos) {
    const e = tomar((x) => x.modelo_id && x.modelo_id === p.modelo_id)
      || tomar((x) => mismaFamilia({ modelo_id: p.modelo_id, modelo: p.modelo }, { modelo_id: x.modelo_id, modelo: x.modelo }));
    if (e) pares.push({ perdido: p, entrante: e }); else perdidosSinPar.push(p);
  }
  return { pares, perdidosSinPar, entrantesSinPar: libres };
}

async function reservarNumeroGR() {
  const fechaStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Panama" }).replace(/-/g, "");
  const ref = db.collection("contadores").doc(`gestiones_GR_${fechaStr}`);
  const seq = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const siguiente = (snap.exists ? Number(snap.data().seq || 0) : 0) + 1;
    t.set(ref, { seq: siguiente, prefijo: "GR", fecha: fechaStr, actualizado_en: FV.serverTimestamp() }, { merge: true });
    return siguiente;
  });
  return `GR${fechaStr}-${String(seq).padStart(2, "0")}`;
}

// Aplica la reposición de un pedido ya 'asignada'. Devuelve null si el pedido
// no es de reposición; si no, { gid, pares[], rechazados[], perdidosSinPar[],
// contrato: {doc_id, id} | null }. `pares[i]` = { saliente, entrante, contrato_doc_id, contrato_id }.
async function aplicar(pid, p) {
  const items = p.reposicion?.items || [];
  if (!items.length) return null;
  await catalogo();
  const motivo = motivoCodigo(p.reposicion.motivo);
  const fact = String(p.factura || "").trim();
  const usuario = p.creado_por_email || "system";

  // Perdidos: se re-validan contra el pool de AHORA (el formulario validó al pedir).
  const rechazados = []; const perdidos = [];
  for (const it of items) {
    const id = pool.normSerial(it.serial_saliente || "");
    if (!id) continue;
    const snap = await db.collection("equipos_pool").doc(id).get();
    const d = snap.exists ? snap.data() : null;
    const err = validarPerdido(d, p.cliente_id);
    if (err) { rechazados.push({ serial: it.serial_saliente, motivo: err }); continue; }
    perdidos.push({ serial: d.serial || id, pool_id: id, modelo_id: d.modelo_id || null, modelo: d.modelo_label || "",
      contrato_doc_id: d.asignacion.contrato_doc_id, contrato_id: d.asignacion.contrato_id || "", estado: d.estado });
  }
  // Entrantes: lo que bodega dejó vendido para ESTE pedido.
  const entrantes = [];
  for (const s of (p.seriales || [])) {
    const id = s.pool_id || pool.normSerial(s.serial || "");
    const snap = id ? await db.collection("equipos_pool").doc(id).get() : null;
    const d = snap?.exists ? snap.data() : null;
    if (d && d.estado === pool.ESTADOS.VENDIDO && d.venta?.pedido_id === pid) {
      entrantes.push({ serial: d.serial || id, pool_id: id, modelo_id: d.modelo_id || null, modelo: d.modelo_label || "" });
    }
  }
  const { pares, perdidosSinPar } = parear(perdidos, entrantes);
  if (!pares.length) {
    logger.warn("[reposicionAlquiler] nada que parear: queda como venta", { pid, rechazados, perdidosSinPar: perdidosSinPar.map(x => x.serial) });
    return { gid: null, pares: [], rechazados, perdidosSinPar, contrato: null };
  }

  const gid = await reservarNumeroGR();
  const now = FV.serverTimestamp();
  const refMov = { tipo: "gestion", id: gid, label: gid };
  const nota = `${motivoTxt(motivo)[0].toUpperCase()}${motivoTxt(motivo).slice(1)} de radio alquilado: el cliente pagó la reposición con la factura ${fact}.`;
  const hechos = [];
  for (const { perdido: s, entrante: e } of pares) {
    try {
      // Entrante: deshace la venta y queda en el contrato del perdido.
      await db.runTransaction(async (tx) => {
        const ref = db.collection("equipos_pool").doc(e.pool_id);
        const snap = await tx.get(ref);
        const d = snap.data() || {};
        if (d.estado !== pool.ESTADOS.VENDIDO || d.venta?.pedido_id !== pid) throw new Error(`el entrante ${e.serial} ya no está vendido por este pedido`);
        tx.set(ref, {
          estado: pool.ESTADOS.ASIGNADO,
          propiedad: "cecomunica",
          venta: FV.delete(),
          venta_anulada: { ...d.venta, motivo: "reposicion_alquiler", gestion_id: gid, at: now },
          asignacion: { contrato_doc_id: s.contrato_doc_id, contrato_id: s.contrato_id, cliente_id: p.cliente_id || "", cliente_nombre: p.cliente_nombre || "", gestion_doc_id: gid },
          reemplaza_a: pool.normSerial(s.serial),
          reemplazo_origen: { gestion_id: gid, saliente: pool.normSerial(s.serial), orden_entrega_id: null, contrato_doc_id: s.contrato_doc_id, contrato_id: s.contrato_id, at: now, regularizado: true },
          updated_at: now,
        }, { merge: true });
        tx.set(ref.collection("movimientos").doc(), {
          at: now, por: "system", por_email: null, tipo: "reemplazo", de_estado: pool.ESTADOS.VENDIDO, a_estado: pool.ESTADOS.ASIGNADO, ref: refMov,
          notas: `No es venta: reposición del ${s.serial} (${motivoTxt(motivo)}, contrato ${s.contrato_id}), pagada con la factura ${fact}. Queda de CECOMUNICA en el contrato (gestión ${gid}).`,
        });
      });
      // Perdido: baja.
      await db.runTransaction(async (tx) => {
        const ref = db.collection("equipos_pool").doc(s.pool_id);
        const snap = await tx.get(ref);
        const d = snap.data() || {};
        if (!ESTADOS_CON_CLIENTE.has(d.estado)) return;
        tx.set(ref, {
          estado: pool.ESTADOS.BAJA,
          baja_motivo: `${motivoTxt(motivo)[0].toUpperCase()}${motivoTxt(motivo).slice(1)} (${p.cliente_nombre || "cliente"}); repuesto por ${e.serial}, gestión ${gid}, factura ${fact}`,
          asignacion: null, orden_actual_id: null, pendiente_devolucion: FV.delete(),
          updated_at: now,
        }, { merge: true });
        tx.set(ref.collection("movimientos").doc(), {
          at: now, por: "system", por_email: null, tipo: "baja", de_estado: d.estado, a_estado: pool.ESTADOS.BAJA, ref: refMov,
          notas: `Baja por ${motivoTxt(motivo)}. Sustituido por ${e.serial} (gestión ${gid}); el cliente pagó la reposición (factura ${fact}).`,
        });
      });
      hechos.push({ saliente: s.serial, entrante: e.serial, contrato_doc_id: s.contrato_doc_id, contrato_id: s.contrato_id, perdido: s, ent: e });
    } catch (err) {
      logger.error("[reposicionAlquiler] par no aplicado", { pid, gid, saliente: s.serial, entrante: e.serial, message: err.message });
      rechazados.push({ serial: s.serial, motivo: `no se pudo aplicar (${err.message})` });
    }
  }
  if (!hechos.length) return { gid: null, pares: [], rechazados, perdidosSinPar, contrato: null };

  const contratos = [...new Set(hechos.map(h => h.contrato_doc_id))];
  await db.collection("gestiones").doc(gid).set({
    tipo: "reemplazo", numero: gid, estado: "cerrada", regularizada: true,
    cliente_id: p.cliente_id || "", cliente_nombre: p.cliente_nombre || "",
    causa: "regularizacion", notas: nota,
    reposicion: { motivo, factura_qbo: fact || null, pedido_venta_id: pid, pagada: true },
    origen: { tipo: "reposicion_venta", pedido_venta_id: pid, por_uid: p.creado_por_uid || null, por_email: usuario, at: now },
    aprobacion: { requiere: false, aprobado_por_email: usuario, at: now, motivo: `Reposición por ${motivoTxt(motivo)} pagada por el cliente (factura ${fact})` },
    items: hechos.map(h => ({
      serial_saliente: h.saliente, pool_doc_id_saliente: h.perdido.pool_id, modelo: h.perdido.modelo, modelo_id: h.perdido.modelo_id,
      contrato_doc_id: h.contrato_doc_id, contrato_id: h.contrato_id,
      serial_nuevo: h.entrante, pool_doc_id_nuevo: h.ent.pool_id, modelo_id_nuevo: h.ent.modelo_id, modelo_nuevo: h.ent.modelo,
      saliente_en_casa: true, saliente_perdido: motivo,
      elegibilidad: "regularizacion", motivo_codigo: motivo, motivo_detalle: nota,
    })),
    contratos_afectados: contratos,
    ordenes: {},
    cierre: { aprobacion: true, asignacion: true, programacion: false, entrega: false, entrada: true },
    cerrada_at: now, cerrada_por: usuario, cerrada_motivo: "reposicion",
    creado_por_uid: p.creado_por_uid || null, creado_por_email: usuario, fecha_creacion: now, updated_at: now,
  });
  const gref = db.collection("gestiones").doc(gid);
  for (const h of hechos) {
    await gref.collection("mapeos").add({ saliente: h.saliente, entrante: h.entrante, modelo: h.ent.modelo, modelo_id: h.ent.modelo_id, contrato_doc_id: h.contrato_doc_id, contrato_id: h.contrato_id, auto: false, regularizado: true, at: now, por: usuario });
  }
  await gref.collection("eventos").add({ accion: "regularizacion", at: now, por_uid: null, por_email: usuario,
    detalle: `Reposición desde la venta facturada ${fact}: ${hechos.map(h => `${h.saliente} (${motivoTxt(motivo)}) → ${h.entrante}`).join(", ")}. ${nota}` });
  logger.info("[reposicionAlquiler] aplicada", { pid, gid, pares: hechos.map(h => `${h.saliente}>${h.entrante}`), rechazados });
  return {
    gid, rechazados, perdidosSinPar, motivo,
    pares: hechos.map(({ saliente, entrante, contrato_doc_id, contrato_id }) => ({ saliente, entrante, contrato_doc_id, contrato_id })),
    contrato: contratos.length === 1 ? { doc_id: contratos[0], id: hechos[0].contrato_id } : null,
  };
}

// La OS ya existe: la gestión la toma como su programación y cada entrante
// sabe con qué orden se entrega.
async function ligarOrden(repo, ordenId) {
  if (!repo?.gid || !ordenId) return;
  await db.collection("gestiones").doc(repo.gid).set({ ordenes: { programacion_id: ordenId, programacion_ids: [ordenId] } }, { merge: true });
  for (const par of repo.pares) {
    await db.collection("equipos_pool").doc(pool.normSerial(par.entrante))
      .set({ reemplazo_origen: { orden_entrega_id: ordenId } }, { merge: true });
  }
}

module.exports = { validarPerdido, parear, aplicar, ligarOrden, motivoTxt, motivoCodigo };
