/**
 * analiza-tracking-serial.js — SOLO LECTURA. Radiografía del tracking por
 * serial vs por contrato: las métricas del informe
 * docs/INFORME_TRACKING_SERIAL_2026-08-12.md, re-ejecutables para medir el
 * avance tras cada fase (P1-P8 del informe).
 *
 * Secciones: (1) calidad del dato por unidad en el pool, (2) cantidad pactada
 * vs seriales reales en contratos vigentes, (3) contratos donde la subcolección
 * y el pool difieren, (4) envejecimiento de pendiente_devolucion, (5) cobertura
 * de kardex (muestreo), (6) mapeos de transición registrados en toda la base,
 * (7) clientes con equipo en varios contratos vigentes (la ambigüedad).
 *
 * USAGE (desde functions/): node scripts/analiza-tracking-serial.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const HOY = new Date();
const dias = (t) => { const d = t?.toDate ? t.toDate() : null; return d && !isNaN(d) ? Math.floor((HOY - d) / 86400000) : null; };

(async () => {
  const [poolSnap, contratosSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
  ]);

  const contratos = new Map();
  contratosSnap.forEach(d => contratos.set(d.id, { id: d.id, ...d.data() }));

  // ── 1. EL POOL: calidad del dato por unidad ─────────────────────────────
  console.log("=== 1. POOL — calidad del dato por unidad ===");
  const tot = { n: 0, sinModelo: 0, sinVerificar: 0, conAsig: 0, asigContratoMuerto: 0,
    enClienteSinAsig: 0, enClienteSinContrato: 0, propDesconocida: 0, conLinaje: 0,
    pendDev: 0, excepDev: 0, porClasificar: 0, conPoc: 0 };
  const porEstado = new Map();
  const asigMuertaDetalle = new Map();
  poolSnap.forEach(d => {
    const u = d.data();
    tot.n++;
    porEstado.set(u.estado, (porEstado.get(u.estado) || 0) + 1);
    if (!(u.modelo_label || "").trim() && !u.modelo_id) tot.sinModelo++;
    if (u.verificado === false) tot.sinVerificar++;
    if (u.propiedad === "desconocida" || !u.propiedad) tot.propDesconocida++;
    if (u.reemplaza_a) tot.conLinaje++;
    if (u.pendiente_devolucion) tot.pendDev++;
    if (u.devolucion_excepcion) tot.excepDev++;
    if (u.estado === "por_clasificar") tot.porClasificar++;
    if (u.poc_device_id) tot.conPoc++;
    const a = u.asignacion;
    if (a?.contrato_doc_id) {
      tot.conAsig++;
      const c = contratos.get(a.contrato_doc_id);
      if (!c || c.deleted || !["activo", "aprobado"].includes(c.estado)) {
        tot.asigContratoMuerto++;
        const k = c ? c.estado : "(contrato no existe)";
        asigMuertaDetalle.set(k, (asigMuertaDetalle.get(k) || 0) + 1);
      }
    }
    if (u.estado === "en_cliente") {
      if (!a) tot.enClienteSinAsig++;
      else if (!a.contrato_doc_id) tot.enClienteSinContrato++;
    }
  });
  console.log(`unidades: ${tot.n}`);
  console.log("por estado:", JSON.stringify([...porEstado.entries()].sort((a, b) => b[1] - a[1])));
  console.log(`sin modelo: ${tot.sinModelo} · verificado:false: ${tot.sinVerificar} · propiedad desconocida: ${tot.propDesconocida}`);
  console.log(`con asignación a contrato: ${tot.conAsig} · de esas, contrato MUERTO/no existe: ${tot.asigContratoMuerto}`);
  console.log("  detalle asignación muerta:", JSON.stringify([...asigMuertaDetalle.entries()]));
  console.log(`en_cliente SIN asignación: ${tot.enClienteSinAsig} · en_cliente con cliente pero SIN contrato: ${tot.enClienteSinContrato}`);
  console.log(`con linaje (reemplaza_a): ${tot.conLinaje} · pendiente_devolucion: ${tot.pendDev} · devolucion_excepcion: ${tot.excepDev}`);
  console.log(`enlazadas a POC: ${tot.conPoc}`);

  // ── 2. CONTRATOS: cantidad vs serial ────────────────────────────────────
  console.log("\n=== 2. CONTRATOS VIGENTES — cantidad pactada vs seriales reales ===");
  const vig = [...contratos.values()].filter(c => !c.deleted && ["activo", "aprobado"].includes(c.estado));
  let completos = 0, incompletos = 0, sinNada = 0, legacy = 0, sobre = 0;
  let eqTotal = 0, serTotal = 0;
  const incompletosDet = [];
  // unidades del pool por contrato (asignación)
  const poolPorContrato = new Map();
  poolSnap.forEach(d => {
    const u = d.data();
    const cid = u.asignacion?.contrato_doc_id;
    if (!cid) return;
    if (!poolPorContrato.has(cid)) poolPorContrato.set(cid, []);
    poolPorContrato.get(cid).push({ estado: u.estado, serial: u.serial_norm || d.id });
  });
  for (const c of vig) {
    if (c.seriales_estado === "legacy") { legacy++; continue; }
    const cant = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0)
      - Number(c.baja_cancelado_total || 0);
    const ser = Number(c.seriales_count || 0) + Number(c.seriales_omitidos_count || 0);
    if (cant <= 0) continue;
    eqTotal += cant; serTotal += Math.min(ser, cant);
    if (ser >= cant) { completos++; if (ser > cant) sobre++; }
    else if (ser === 0) sinNada++;
    else { incompletos++; incompletosDet.push({ contrato: c.contrato_id, cant, ser, cliente: (c.cliente_nombre || "").slice(0, 28) }); }
  }
  console.log(`vigentes con equipo (no legacy): ${completos + incompletos + sinNada} · completos: ${completos} (con más seriales que cantidad: ${sobre}) · parciales: ${incompletos} · sin ningún serial: ${sinNada} · legacy: ${legacy}`);
  console.log(`unidades pactadas: ${eqTotal} · con serial: ${serTotal} (${Math.round(100 * serTotal / eqTotal)}%)`);
  if (incompletosDet.length) console.table(incompletosDet.slice(0, 12));

  // ── 3. Pool vs subcolección de seriales: ¿cuadran? ──────────────────────
  console.log("\n=== 3. CONTRATO vs POOL — el mismo contrato, dos respuestas ===");
  let cuadra = 0, difiere = 0;
  const difDet = [];
  for (const c of vig.slice()) {
    if (c.seriales_estado === "legacy") continue;
    const ser = Number(c.seriales_count || 0);
    const enPool = (poolPorContrato.get(c.id) || []).length;
    if (!ser && !enPool) continue;
    if (ser === enPool) cuadra++;
    else { difiere++; if (difDet.length < 12) difDet.push({ contrato: c.contrato_id, subcoleccion: ser, pool: enPool, cliente: (c.cliente_nombre || "").slice(0, 26) }); }
  }
  console.log(`contratos donde subcolección == pool: ${cuadra} · donde DIFIEREN: ${difiere}`);
  console.table(difDet);

  // ── 4. pendiente_devolucion: envejecimiento ─────────────────────────────
  console.log("\n=== 4. PENDIENTE DE DEVOLUCIÓN — envejecimiento ===");
  const pend = [];
  poolSnap.forEach(d => { const u = d.data(); if (u.pendiente_devolucion) pend.push({ serial: d.id, dias: dias(u.updated_at), cliente: (u.asignacion?.cliente_nombre || "").slice(0, 30), estado: u.estado }); });
  pend.sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0));
  console.log(`total: ${pend.length} · >30 días: ${pend.filter(p => p.dias > 30).length} · >60 días: ${pend.filter(p => p.dias > 60).length}`);
  console.table(pend.slice(0, 10));

  // ── 5. Kardex: cobertura ────────────────────────────────────────────────
  console.log("\n=== 5. KARDEX — muestreo de cobertura (100 unidades al azar determinista) ===");
  const docs = poolSnap.docs.filter((_, i) => i % Math.ceil(poolSnap.size / 100) === 0).slice(0, 100);
  let conKardex = 0, sinKardex = 0, movTotal = 0;
  for (const d of docs) {
    const mv = await d.ref.collection("movimientos").count().get();
    const n = mv.data().count;
    if (n > 0) { conKardex++; movTotal += n; } else sinKardex++;
  }
  console.log(`muestra: ${docs.length} · con kardex: ${conKardex} · SIN un solo movimiento: ${sinKardex} · movimientos promedio (cuando hay): ${(movTotal / Math.max(1, conKardex)).toFixed(1)}`);

  // ── 6. Renovaciones parciales registradas ───────────────────────────────
  console.log("\n=== 6. TRANSICIONES REGISTRADAS (mapeos) en toda la base ===");
  const mapeos = await db.collectionGroup("mapeos").get().catch(() => null);
  if (mapeos) {
    let conLinaje = 0, sinSustituto = 0, noDevuelve = 0, sinReemplazos = 0, auto = 0;
    mapeos.forEach(d => {
      const m = d.data();
      if (m.sin_reemplazos) sinReemplazos++;
      else if (m.tipo === "no_devuelve") noDevuelve++;
      else if (m.entrante && m.saliente) conLinaje++;
      else if (m.saliente) sinSustituto++;
      if (m.auto) auto++;
    });
    console.log(`mapeos totales: ${mapeos.size} · con linaje (ent+sal): ${conLinaje} · devolución sin sustituto: ${sinSustituto} · excepción no_devuelve: ${noDevuelve} · cierre sin_reemplazos: ${sinReemplazos} · creados por el trigger auto: ${auto}`);
  }

  // ── 7. Multi-contrato del mismo cliente: la ambigüedad del operador ─────
  console.log("\n=== 7. CLIENTES con VARIOS contratos vigentes con equipo (la ambigüedad) ===");
  const porCliente = new Map();
  vig.forEach(c => {
    if (!c.cliente_id) return;
    const cant = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    if (!cant) return;
    porCliente.set(c.cliente_id, (porCliente.get(c.cliente_id) || 0) + 1);
  });
  const multi = [...porCliente.values()].filter(n => n > 1);
  console.log(`clientes con equipo en contratos vigentes: ${porCliente.size} · con 2+: ${multi.length} · con 4+: ${multi.filter(n => n >= 4).length} · máx: ${Math.max(...multi, 0)}`);
})().catch(e => { console.error(e); process.exit(1); });
