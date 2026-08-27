// Conciliación pool ↔ fuentes (L5 de la auditoría 2026-07-24). La lógica vive
// aquí, separada del cron, para poder re-correr el reporte a demanda después de
// una limpieza (scripts/correr-conciliacion.js) en vez de esperar al lunes.
//
// Todos los triggers que mantienen equipos_pool son best-effort (try/catch →
// "no crítico"): un fallo transitorio deja la ficha desincronizada PARA
// SIEMPRE, sin que nadie lo note. Esto compara el pool contra sus fuentes y
// deja el reporte en admin_reportes/conciliacion_pool, que se muestra en
// Admin · Salud. No corrige nada — solo hace visible el drift.
//
// Chequeos:
//   A) serial de contrato vigente (aprobado/activo, no legacy) sin ficha, o
//      con ficha asignada a OTRO contrato.
//   B) ficha en_taller cuya orden actual ya cerró (ENTREGADO/CERRADA/eliminada).
//   C1) device POC ACTIVO cuyo serial no tiene NINGUNA ficha en el pool.
//   C2) device POC ACTIVO con ficha, pero ninguna enlazada a ese device.
//   D) ficha asignada a un contrato ANULADO sin pendiente_devolucion (residuo).
//   E) ficha vendido con orden_actual_id de una orden ya cerrada (colgante).
//   G) ficha asignada a un contrato VIGENTE que ya no la lista en sus seriales
//      (el reverso de A: residuo de asignación). Es lo que dejó a
//      PROP20260731-01 con 24 unidades para 12 radios.
//   F) mismo serial ACTIVO en POC con dos clientes distintos (propiedad). Los
//      ya decididos por una persona se cuentan aparte (F_esperando_apagado):
//      ahí el dato nuestro está bien y lo que falta es apagar el device
//      sobrante en la plataforma POC.
const { admin, db } = require("../lib/admin");
const pool = require("./equiposPool");

const CERRADAS = new Set(["ENTREGADO AL CLIENTE", "CERRADA (ENTRADA)",
  "CERRADA (DEVOLUCION)", "CERRADA (VISITA)", "ANULADA"]);
const MAX_MUESTRAS = 20;

async function ejecutar() {
  // ── Cargas base ──
  const poolSnap = await db.collection("equipos_pool").get();
  const fichas = poolSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const porNorm = new Map();
  for (const f of fichas) {
    const k = f.serial_norm || f.id.split("__")[0];
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k).push(f);
  }

  const contSnap = await db.collection("contratos").get();
  const contratos = new Map(contSnap.docs.map((d) => [d.id, d.data()]));

  const ordenCache = new Map(); // id → estado_reparacion|null (null = no existe/eliminada)
  async function estadoOrden(id) {
    if (!id) return null;
    if (ordenCache.has(id)) return ordenCache.get(id);
    try {
      const s = await db.collection("ordenes_de_servicio").doc(id).get();
      const v = s.exists && s.data().eliminado !== true
        ? String(s.data().estado_reparacion || "").trim().toUpperCase() : null;
      ordenCache.set(id, v);
      return v;
    } catch (e) { return null; }
  }

  const R = {
    at: admin.firestore.FieldValue.serverTimestamp(),
    fichas_total: fichas.length,
    A_contrato_sin_ficha: 0, A_muestras: [],
    B_taller_orden_cerrada: 0, B_muestras: [],
    C_poc_sin_ficha: 0, C_sin_ficha_muestras: [],
    C_poc_sin_enlace: 0, C_muestras: [],
    D_asignada_a_anulado: 0, D_muestras: [],
    E_vendido_orden_cerrada: 0, E_muestras: [],
    F_serial_dos_clientes: 0, F_muestras: [],
    F_esperando_apagado: 0, F_apagado_muestras: [],
    G_asignada_sin_serial: 0, G_muestras: [],
    // Contexto, no drift: cuántos devices se ignoraron por estar apagados.
    poc_apagados_ignorados: 0,
  };

  // ── A: seriales de contratos vigentes ──
  const serSnap = await db.collectionGroup("seriales").get();
  // Set de seriales por contrato — alimenta también el chequeo G de abajo.
  const serialesPorContrato = new Map();
  for (const d of serSnap.docs) {
    const cid = d.ref.parent.parent.id;
    const n = pool.normSerial(d.data()?.serial || "");
    if (!n) continue;
    if (!serialesPorContrato.has(cid)) serialesPorContrato.set(cid, new Set());
    serialesPorContrato.get(cid).add(n);
  }
  for (const d of serSnap.docs) {
    const cid = d.ref.parent.parent.id;
    const c = contratos.get(cid);
    if (!c) continue;
    if (!["aprobado", "activo"].includes(String(c.estado || "").toLowerCase())) continue;
    if (c.seriales_estado === "legacy") continue;
    const s = d.data();
    if (s.omitido) continue;
    const norm = pool.normSerial(s.serial || d.id);
    if (!norm) continue;
    const docs = porNorm.get(norm) || [];
    const propia = docs.find((f) => f.asignacion?.contrato_doc_id === cid);
    if (!docs.length || !propia) {
      R.A_contrato_sin_ficha++;
      if (R.A_muestras.length < MAX_MUESTRAS) R.A_muestras.push({
        serial: s.serial || d.id, contrato: c.contrato_id || cid,
        detalle: docs.length ? `ficha asignada a ${docs[0].asignacion?.contrato_id || docs[0].asignacion?.cliente_nombre || "nadie"}` : "sin ficha en el pool",
      });
    }
  }

  // ── B y E: fichas cuyo enlace de orden ya venció ──
  for (const f of fichas) {
    if (f.estado === "en_taller" && f.orden_actual_id) {
      const eo = await estadoOrden(f.orden_actual_id);
      if (eo === null || CERRADAS.has(eo)) {
        R.B_taller_orden_cerrada++;
        if (R.B_muestras.length < MAX_MUESTRAS) R.B_muestras.push({
          serial: f.serial, orden: f.orden_actual_id, estado_orden: eo || "(no existe)",
        });
      }
    }
    if (f.estado === "vendido" && f.orden_actual_id) {
      const eo = await estadoOrden(f.orden_actual_id);
      if (eo === null || CERRADAS.has(eo)) {
        R.E_vendido_orden_cerrada++;
        if (R.E_muestras.length < MAX_MUESTRAS) R.E_muestras.push({
          serial: f.serial, orden: f.orden_actual_id, estado_orden: eo || "(no existe)",
        });
      }
    }
    // ── D ──
    if (["asignado_contrato", "en_cliente"].includes(f.estado)
        && f.asignacion?.contrato_doc_id && !f.pendiente_devolucion) {
      const c = contratos.get(f.asignacion.contrato_doc_id);
      if (c && String(c.estado || "").toLowerCase() === "anulado" && !c.orden_devolucion_id) {
        R.D_asignada_a_anulado++;
        if (R.D_muestras.length < MAX_MUESTRAS) R.D_muestras.push({
          serial: f.serial, contrato: c.contrato_id || f.asignacion.contrato_doc_id,
        });
      }
    }
    // ── G: residuo de asignación (el reverso de A) ──
    // Contratos SIN seriales registrados quedan fuera: ahí no hay nada contra
    // qué comparar y toda asignación parecería huérfana.
    if (f.asignacion?.contrato_doc_id) {
      const c = contratos.get(f.asignacion.contrato_doc_id);
      const vigente = c && ["aprobado", "activo"].includes(String(c.estado || "").toLowerCase())
        && c.seriales_estado !== "legacy";
      const lista = serialesPorContrato.get(f.asignacion.contrato_doc_id);
      const norm = f.serial_norm || f.id.split("__")[0];
      if (vigente && lista && lista.size && !lista.has(norm)) {
        R.G_asignada_sin_serial++;
        if (R.G_muestras.length < MAX_MUESTRAS) R.G_muestras.push({
          serial: f.serial, estado: f.estado,
          contrato: c.contrato_id || f.asignacion.contrato_doc_id,
          detalle: `el contrato lista ${lista.size} serial(es) y este no está`,
        });
      }
    }
  }

  // ── C y F: devices POC ──
  // SOLO cuentan los ACTIVOS (2026-07-28): al devolver un radio, su device POC
  // se DESACTIVA en vez de borrarse, así que el registro del cliente anterior
  // sobrevive. Contarlos inflaba el chequeo a 1,248 casos —865 de ellos puro
  // rastro histórico— y un reporte que grita mil no lo lee nadie.
  const pocSnap = await db.collection("poc_devices").get();
  const activos = [];
  for (const d of pocSnap.docs) {
    const p = d.data();
    if (p.deleted === true) continue;
    if (p.activo === false) { R.poc_apagados_ignorados++; continue; }
    const norm = pool.normSerial(p.serial || "");
    if (!pool.esSerialValido(norm)) continue;   // "CONSOLA", "GPS"… no son seriales
    activos.push({ id: d.id, norm, p });
  }

  // F primero: el serial con dos dueños activos es problema de PROPIEDAD, y sus
  // devices no deben contarse además como "falta enlace" (solo uno puede estar
  // enlazado por definición).
  const clientesPorSerial = new Map();
  for (const a of activos) {
    const cid = a.p.cliente_id || "";
    if (!cid) continue;
    if (!clientesPorSerial.has(a.norm)) clientesPorSerial.set(a.norm, new Map());
    clientesPorSerial.get(a.norm).set(cid, a.p.cliente || a.p.cliente_nombre || cid);
  }
  const dosDuenos = new Set();
  for (const [norm, clientes] of clientesPorSerial) {
    if (clientes.size < 2) continue;
    dosDuenos.add(norm);
    // Ya decidido por una persona (scripts/resolver-dos-duenos.js): el dato
    // nuestro está bien y lo que falta es apagar el device sobrante EN LA
    // PLATAFORMA POC. Repetirlo como conflicto convierte el reporte en ruido;
    // se cuenta aparte, como tarea pendiente.
    const resuelto = (porNorm.get(norm) || []).some((f) => f.dos_duenos_resuelto?.dueno);
    if (resuelto) {
      R.F_esperando_apagado++;
      if (R.F_apagado_muestras.length < MAX_MUESTRAS) R.F_apagado_muestras.push({
        serial: norm, detalle: [...clientes.values()].join(" | "),
      });
      continue;
    }
    R.F_serial_dos_clientes++;
    if (R.F_muestras.length < MAX_MUESTRAS) R.F_muestras.push({
      serial: norm, detalle: [...clientes.values()].join(" | "),
    });
  }

  for (const a of activos) {
    if (dosDuenos.has(a.norm)) continue;
    const docs = porNorm.get(a.norm) || [];
    if (!docs.length) {
      R.C_poc_sin_ficha++;
      if (R.C_sin_ficha_muestras.length < MAX_MUESTRAS) R.C_sin_ficha_muestras.push({
        serial: a.p.serial, device: a.id, detalle: a.p.cliente || a.p.cliente_nombre || "—",
      });
      continue;
    }
    if (!docs.some((f) => f.poc_device_id === a.id)) {
      R.C_poc_sin_enlace++;
      if (R.C_muestras.length < MAX_MUESTRAS) R.C_muestras.push({
        serial: a.p.serial, device: a.id, detalle: "ficha sin enlace a este device",
      });
    }
  }

  // ── H: modelo_id inválido en líneas de contratos vigentes ──
  // La clase de bug del "modelo fantasma" (uYNSf5…, caso Feduro 2026-08-27):
  // la línea apunta a un doc del catálogo que NO existe → la tarifa por equipo
  // no resuelve y la facturación queda ciega. fix-lineas-modelo-id.js repara
  // lo histórico; este chequeo vigila que no vuelva a entrar.
  R.H_modelo_invalido = 0; R.H_muestras = [];
  try {
    const modSnap = await db.collection("modelos").get();
    const modelosIds = new Set(modSnap.docs.map((d) => d.id));
    for (const [cid, c] of contratos) {
      if (c.deleted) continue;
      if (!["aprobado", "activo"].includes(String(c.estado || "").toLowerCase())) continue;
      for (const l of (c.equipos || [])) {
        if (l.modelo_id && !modelosIds.has(l.modelo_id)) {
          R.H_modelo_invalido++;
          if (R.H_muestras.length < MAX_MUESTRAS) R.H_muestras.push({
            contrato: c.contrato_id || cid, modelo: l.modelo || "?", modelo_id: l.modelo_id,
          });
        }
      }
    }
  } catch (e) { /* best-effort: el resto del reporte vale igual */ }

  // ── I: gestiones abiertas huérfanas (Ola 6) ──
  // Abiertas sin cliente válido, o con ítems cuyo contrato no está en
  // contratos_afectados (drift cabecera↔ítems que rompe filtros y correos).
  R.I_gestiones_huerfanas = 0; R.I_muestras = [];
  try {
    const gSnap = await db.collection("gestiones").get();
    const ABIERTAS_G = new Set(["pendiente_aprobacion", "pendiente_firma", "pendiente_bodega", "en_proceso", "en_demo", "retorno"]);
    const clienteOk = new Map();
    for (const d of gSnap.docs) {
      const g = d.data();
      if (g.deleted || !ABIERTAS_G.has(g.estado)) continue;
      let mal = null;
      if (!g.cliente_id) mal = "sin cliente_id";
      else {
        if (!clienteOk.has(g.cliente_id)) {
          const cs = await db.collection("clientes").doc(g.cliente_id).get();
          clienteOk.set(g.cliente_id, cs.exists && cs.data().deleted !== true);
        }
        if (!clienteOk.get(g.cliente_id)) mal = "cliente inexistente o borrado";
      }
      if (!mal) {
        const af = new Set(g.contratos_afectados || []);
        const fuera = (g.items || []).find((it) => it.contrato_doc_id && !af.has(it.contrato_doc_id));
        if (fuera) mal = `ítem con contrato ${fuera.contrato_id || fuera.contrato_doc_id} fuera de contratos_afectados`;
      }
      if (mal) {
        R.I_gestiones_huerfanas++;
        if (R.I_muestras.length < MAX_MUESTRAS) R.I_muestras.push({
          gestion: d.id, tipo: g.tipo || "?", cliente: g.cliente_nombre || g.cliente_id || "—", detalle: mal,
        });
      }
    }
  } catch (e) { /* best-effort */ }

  // El total es DRIFT: lo que el sistema no sabe. F_esperando_apagado queda
  // fuera a propósito — eso ya se decidió y es una tarea en POC, no un dato
  // roto; sumarlo haría que el reporte nunca bajara y volviera a ser ruido.
  const total = R.A_contrato_sin_ficha + R.B_taller_orden_cerrada
    + R.C_poc_sin_ficha + R.C_poc_sin_enlace
    + R.D_asignada_a_anulado + R.E_vendido_orden_cerrada + R.F_serial_dos_clientes
    + R.G_asignada_sin_serial + R.H_modelo_invalido + R.I_gestiones_huerfanas;
  await db.collection("admin_reportes").doc("conciliacion_pool").set({ ...R, total });
  return { ...R, total };
}

module.exports = { ejecutar };
