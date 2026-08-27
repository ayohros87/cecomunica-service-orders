/**
 * asigna-custodia-por-ordenes.js — Amarra la CUSTODIA (unidades en_cliente sin
 * contrato) usando la EVIDENCIA de las órdenes de servicio (pedido de Alberto
 * 2026-08-28, caso SEPROSA: 142 radios sin contrato/tarifa/vencimiento).
 *
 * Por unidad: busca TODAS las órdenes que contienen su serial y toma la última
 * cronológicamente. Según lo que diga:
 *   A) ENTREGADO AL CLIENTE (este cliente) con CONTRATO en la orden →
 *      · fila en contratos/{cid}/seriales (shape saveSerialesManual, source
 *        'custodia_por_ordenes'); onSerialWrite amarra el pool.
 *      · si el contrato no tenía entrega_confirmada, se estampa (la orden ES
 *        la prueba) — SALVO que el contrato tenga ORIGEN amarrado: ahí el flip
 *        dispararía onEntregaTransicion (devoluciones del origen) y se reporta
 *        en vez de escribir (CONTRATO_CON_ORIGEN).
 *      · si el contrato no tenía fecha_vencimiento: se estampa vigencia con
 *        inicio = PRIMERA entrega evidenciada y su duración (sin duración
 *        parseable → 18 meses, decisión 2026-08-28).
 *   B) ENTREGADO sin contrato en la orden → la fecha y la vigencia (18 meses)
 *      se estampan EN LA UNIDAD del pool (vigencia{...} + fecha_entrega) para
 *      que el semáforo por equipo y la renovación la vean.
 *   C) La última orden dice que VOLVIÓ (ENTRADA/DEVOLUCIÓN cerrada) o que se
 *      entregó a OTRO cliente → DRIFT del pool: se reporta, no se toca.
 *   D) Sin órdenes → SIN_EVIDENCIA: se reporta.
 *
 * USAGE (desde functions/):
 *   node scripts/asigna-custodia-por-ordenes.js --cliente=<id o parte del nombre> [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");
const VIG = require("../src/lib/vigencia");

const WRITE = process.argv.includes("--write");
const SOURCE = "custodia_por_ordenes";
const CLIENTE_ARG = (process.argv.find((a) => a.startsWith("--cliente=")) || "").slice(10).trim();
if (!CLIENTE_ARG) { console.error("Falta --cliente=<id o parte del nombre>"); process.exit(1); }

const aDate = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d : null; };
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : "—");
const addMeses = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };

(async () => {
  // ── Cliente ──
  let cliente = null;
  const porId = await db.collection("clientes").doc(CLIENTE_ARG).get().catch(() => null);
  if (porId?.exists) cliente = { id: porId.id, ...porId.data() };
  else {
    const cs = await db.collection("clientes").get();
    const m = cs.docs.filter((d) => d.data().deleted !== true
      && (d.data().nombre || "").toUpperCase().includes(CLIENTE_ARG.toUpperCase()));
    if (m.length !== 1) {
      console.error(`El nombre "${CLIENTE_ARG}" matchea ${m.length} clientes:${m.map((d) => `\n  ${d.id}  ${d.data().nombre}`).join("")}`);
      process.exit(1);
    }
    cliente = { id: m[0].id, ...m[0].data() };
  }
  console.log(`CLIENTE: ${cliente.nombre} (${cliente.id})\n`);

  // ── Cargas ──
  const [poolSnap, ordSnap, conSnap] = await Promise.all([
    db.collection("equipos_pool")
      .where("asignacion.cliente_id", "==", cliente.id)
      .where("estado", "==", "en_cliente").get(),
    db.collection("ordenes_de_servicio").get(),
    db.collection("contratos").get(),
  ]);
  const unidades = poolSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
    .filter((u) => !u.asignacion?.contrato_doc_id);
  console.log(`Unidades en_cliente SIN contrato: ${unidades.length}`);

  const contratos = new Map();
  conSnap.forEach((d) => contratos.set(d.id, { id: d.id, ref: d.ref, ...d.data() }));

  // Índice de contratos por número (para resolver "ADICION CONTRATO ALQ...-02"
  // escrito en las observaciones del equipo — las órdenes viejas no llevan
  // o.contrato pero sí lo nombran ahí).
  const porNumero = new Map();
  contratos.forEach((c) => { if (c.contrato_id) porNumero.set(c.contrato_id, c); });
  const RX_CONTRATO = /\b(?:ALQ|PROP|REEMP|DEMO|TEMP)\d{8}-\d{2}\b/;

  // Índice serial_norm → apariciones en órdenes (cronológicas). OJO: las
  // órdenes viejas guardan el serial como `numero_de_serie` (con "de").
  const porSerial = new Map();
  ordSnap.forEach((d) => {
    const o = d.data();
    if (o.eliminado) return;
    const fecha = aDate(o.fecha_entrega) || aDate(o.fecha_creacion);
    const obsOrden = String(o.observaciones || "").match(RX_CONTRATO)?.[0] || null;
    const base = {
      id: d.id, tipo: (o.tipo_de_servicio || "").toUpperCase(),
      estado: (o.estado_reparacion || "").toUpperCase(),
      cliente_id: o.cliente_id || null, cliente_nombre: o.cliente_nombre || "",
      contrato_doc_id: o.contrato?.contrato_doc_id || null,
      contrato_id: o.contrato?.contrato_id || null,
      fecha,
    };
    const vistos = new Map(); // norm → contrato_obs (del renglón del equipo)
    (o.equipos || []).forEach((e) => {
      const n = pool.normSerial(e.serial || e.numero_serie || e.numero_de_serie || "");
      if (!n) return;
      const obsEq = String(e.observaciones || "").match(RX_CONTRATO)?.[0] || null;
      vistos.set(n, obsEq || obsOrden);
    });
    (o.devolucion?.esperados || []).forEach((e) => {
      const n = pool.normSerial(e.serial || "");
      if (n && !vistos.has(n)) vistos.set(n, null);
    });
    for (const [n, contratoObs] of vistos) {
      if (!porSerial.has(n)) porSerial.set(n, []);
      porSerial.get(n).push({ ...base, contrato_obs: contratoObs });
    }
  });

  const filasCache = new Map();
  const filasDe = async (cid) => {
    if (!filasCache.has(cid)) {
      const s = await db.collection("contratos").doc(cid).collection("seriales").get();
      filasCache.set(cid, s.docs.map((x) => pool.normSerial(x.data().serial || "")));
    }
    return filasCache.get(cid);
  };

  // ── Clasificación ──
  const R = { A_ASIGNAR: [], B_UNIDAD: [], DRIFT: [], OTRO_CLIENTE: [], SIN_EVIDENCIA: [], FILA_EXISTENTE: [], CONTRATO_CON_ORIGEN: [], CONTRATO_NO_VIGENTE: [], SIN_LINEA: [] };
  const contratoPlan = new Map(); // cid → {entrega:boolean, primeraEntrega:Date, ultimaEntrega:Date, vigencia:boolean}

  for (const u of unidades) {
    const norm = u.serial_norm || u.id.split("__")[0];
    const apar = (porSerial.get(norm) || []).slice().sort((a, b) => (a.fecha || 0) - (b.fecha || 0));
    if (!apar.length) { R.SIN_EVIDENCIA.push(u); continue; }
    const ult = apar[apar.length - 1];

    // ¿La última palabra de las órdenes es que VOLVIÓ?
    if ((ult.tipo === "ENTRADA" || ult.tipo === "DEVOLUCION") && ult.estado.startsWith("CERRADA")) {
      R.DRIFT.push({ u, orden: ult }); continue;
    }
    // Salidas: órdenes que ponen/tienen el equipo con el cliente (PROGRAMACIÓN,
    // REPARACIÓN, VISITA…). El pool ya dice en_cliente: una PROGRAMACIÓN aunque
    // no se haya marcado ENTREGADO es la mejor aproximación de la salida.
    const salidas = apar.filter((a) => a.tipo !== "ENTRADA" && a.tipo !== "DEVOLUCION" && a.estado !== "ANULADA");
    if (!salidas.length) { R.SIN_EVIDENCIA.push(u); continue; }
    const ultSalida = salidas[salidas.length - 1];
    if (ultSalida.cliente_id && ultSalida.cliente_id !== cliente.id) { R.OTRO_CLIENTE.push({ u, orden: ultSalida }); continue; }
    const propias = salidas.filter((a) => !a.cliente_id || a.cliente_id === cliente.id);
    if (!propias.length) { R.SIN_EVIDENCIA.push(u); continue; }

    // Contrato: la PRIMERA salida que lo nombre (o.contrato, o el número
    // escrito en las observaciones del renglón del equipo).
    let evidencia = null, c = null;
    for (const a of propias) {
      const cand = (a.contrato_doc_id && contratos.get(a.contrato_doc_id))
        || (a.contrato_id && porNumero.get(a.contrato_id))
        || (a.contrato_obs && porNumero.get(a.contrato_obs)) || null;
      if (cand && !cand.deleted) { evidencia = a; c = cand; break; }
    }

    if (c) {
      if (!["activo", "aprobado"].includes(c.estado)) { R.CONTRATO_NO_VIGENTE.push({ u, c, orden: evidencia }); continue; }
      const filas = await filasDe(c.id);
      if (filas.includes(norm)) { R.FILA_EXISTENTE.push({ u, c }); continue; }
      const entregado = c.seriales_estado === "legacy" || c.entrega_confirmada === true;
      const tieneOrigen = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length) || c.contrato_origen_id;
      if (!entregado && tieneOrigen) { R.CONTRATO_CON_ORIGEN.push({ u, c, orden: evidencia }); continue; }

      const lineaOk = (c.equipos || []).some((l) => pool.mismoModelo(u, l.modelo_id || null, l.modelo || ""));
      if (!lineaOk) R.SIN_LINEA.push({ u, c });

      const fechaEntrega = evidencia.fecha;
      const plan = contratoPlan.get(c.id) || { c, entrega: false, primeraEntrega: null, ultimaEntrega: null, vigencia: false };
      if (!entregado) plan.entrega = true;
      if (fechaEntrega) {
        if (!plan.primeraEntrega || fechaEntrega < plan.primeraEntrega) plan.primeraEntrega = fechaEntrega;
        if (!plan.ultimaEntrega || fechaEntrega > plan.ultimaEntrega) plan.ultimaEntrega = fechaEntrega;
      }
      if (!c.fecha_vencimiento && VIG.aplicaVencimiento(c)) plan.vigencia = true;
      contratoPlan.set(c.id, plan);
      R.A_ASIGNAR.push({ u, c, orden: evidencia, fechaEntrega });
    } else {
      // Sin contrato en ninguna salida: la PRIMERA salida aproxima la entrega.
      // Si esa primera evidencia es una REPARACIÓN, el equipo ya estaba con el
      // cliente desde antes — queda registrado en la fuente.
      const primera = propias[0];
      R.B_UNIDAD.push({
        u, orden: primera, fechaEntrega: primera.fecha,
        fuente: primera.tipo.startsWith("REPARACI") ? "orden_reparacion" : "orden_entrega",
      });
    }
  }

  // ── Reporte ──
  console.log(`\nA) Asignables a contrato por evidencia de orden: ${R.A_ASIGNAR.length}  (contratos tocados: ${contratoPlan.size})`);
  const porContrato = new Map();
  R.A_ASIGNAR.forEach((a) => porContrato.set(a.c.contrato_id, (porContrato.get(a.c.contrato_id) || 0) + 1));
  [...porContrato.entries()].forEach(([k, n]) => console.log(`   ${k}: ${n} unid.`));
  console.log(`B) Sin contrato en la orden → vigencia 18m EN LA UNIDAD: ${R.B_UNIDAD.length}`);
  R.B_UNIDAD.slice(0, 10).forEach((b) => console.log(`   ${b.u.serial}  entrega=${fmt(b.fechaEntrega)} (orden ${b.orden.id})`));
  console.log(`C) DRIFT — la última orden dice que VOLVIÓ: ${R.DRIFT.length}`);
  R.DRIFT.slice(0, 10).forEach((x) => console.log(`   ${x.u.serial}  orden ${x.orden.id} ${x.orden.tipo} [${x.orden.estado}] ${fmt(x.orden.fecha)}`));
  console.log(`   Entregado a OTRO cliente: ${R.OTRO_CLIENTE.length}`);
  R.OTRO_CLIENTE.slice(0, 10).forEach((x) => console.log(`   ${x.u.serial} → ${x.orden.cliente_nombre} (orden ${x.orden.id} ${fmt(x.orden.fecha)})`));
  console.log(`D) SIN_EVIDENCIA (ninguna orden útil): ${R.SIN_EVIDENCIA.length}`);
  console.log(`   FILA_EXISTENTE (amarre ya en el contrato): ${R.FILA_EXISTENTE.length} · CONTRATO_CON_ORIGEN (no se toca): ${R.CONTRATO_CON_ORIGEN.length}`);
  console.log(`   CONTRATO_NO_VIGENTE (la orden nombra un contrato ya terminado): ${R.CONTRATO_NO_VIGENTE.length}`);
  R.CONTRATO_NO_VIGENTE.slice(0, 10).forEach((x) => console.log(`   ${x.u.serial} → ${x.c.contrato_id} [${x.c.estado}] (orden ${x.orden.id})`));
  console.log(`   SIN_LINEA del modelo en el contrato (se asigna, tarifa no resolverá): ${R.SIN_LINEA.length}`);
  R.SIN_LINEA.slice(0, 10).forEach((x) => console.log(`   ${x.u.serial} ${x.u.modelo_label || "?"} → ${x.c.contrato_id}`));

  const stamps = [...contratoPlan.values()].filter((p) => p.entrega || p.vigencia);
  console.log(`\nContratos a estampar:`);
  stamps.forEach((p) => {
    const meses = VIG.parseDuracionMeses(p.c.duracion) || 18;
    console.log(`   ${p.c.contrato_id}: ${p.entrega ? "entrega_confirmada " : ""}${p.vigencia ? `vigencia inicio=${fmt(p.primeraEntrega)} +${meses}m → ${fmt(p.primeraEntrega ? addMeses(p.primeraEntrega, meses) : null)}` : ""}`);
  });

  if (!WRITE) { console.log("\nDRY-RUN — nada escrito. Repite con --write."); return; }

  const FV = admin.firestore.FieldValue;
  const now = new Date();
  // 1) Contratos primero (para que onSerialWrite vea la entrega confirmada).
  for (const p of contratoPlan.values()) {
    const upd = {};
    if (p.entrega) {
      upd.entrega_confirmada = true;
      upd.entrega_confirmada_fuente = `script:${SOURCE}`;
      if (p.ultimaEntrega) upd.fecha_entrega_ultima = admin.firestore.Timestamp.fromDate(p.ultimaEntrega);
    }
    if (p.vigencia && p.primeraEntrega) {
      let meses = VIG.parseDuracionMeses(p.c.duracion);
      if (!meses) { meses = 18; upd.duracion = "18 meses"; upd.duracion_meses = 18; }
      const fv = addMeses(p.primeraEntrega, meses);
      upd.fecha_vencimiento = admin.firestore.Timestamp.fromDate(fv);
      upd.vencimiento_estado = VIG.estadoVencimiento(fv, now);
      upd.vigencia = {
        fecha_inicio: admin.firestore.Timestamp.fromDate(p.primeraEntrega),
        duracion_meses: meses,
        fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
        fuente_inicio: "orden_entrega",
        estampado_por: `script:${SOURCE}`,
      };
    }
    if (Object.keys(upd).length) { upd.fecha_modificacion = new Date(); await p.c.ref.update(upd); }
  }
  // 2) Filas de serial (onSerialWrite amarra el pool sin flip: entrega confirmada).
  let filas = 0;
  for (const a of R.A_ASIGNAR) {
    await a.c.ref.collection("seriales").add({
      serial: a.u.serial || a.u.id,
      modelo: a.u.modelo_label || "",
      modelo_id: a.u.modelo_id || null,
      contrato_doc_id: a.c.id,
      contrato_id: a.c.contrato_id || "",
      cliente_id: a.c.cliente_id || "",
      cliente_nombre: a.c.cliente_nombre || "",
      source: SOURCE,
      evidencia_orden_id: a.orden.id,
      created_at: FV.serverTimestamp(), created_by: `script:${SOURCE}`,
      updated_at: FV.serverTimestamp(), updated_by: `script:${SOURCE}`,
    });
    filas++;
    if (filas % 50 === 0) console.log(`   … filas ${filas}/${R.A_ASIGNAR.length}`);
  }
  // 3) Unidades sin contrato en la orden: vigencia en la ficha del pool.
  for (const b of R.B_UNIDAD) {
    if (!b.fechaEntrega) continue;
    const fv = addMeses(b.fechaEntrega, 18);
    await b.u.ref.update({
      fecha_entrega: b.fechaEntrega.toISOString(),
      vigencia: {
        fecha_inicio: admin.firestore.Timestamp.fromDate(b.fechaEntrega),
        duracion_meses: 18,
        fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
        fuente_inicio: b.fuente,
        orden_id: b.orden.id,
        estampado_por: `script:${SOURCE}`,
      },
      updated_at: FV.serverTimestamp(),
    });
  }
  console.log(`\nOK: ${filas} filas de serial · ${stamps.length} contratos estampados · ${R.B_UNIDAD.length} unidades con vigencia propia.`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
