/**
 * analiza-colisiones-pool.js — SOLO LECTURA. Recorre las mismas tres fuentes
 * que seedPoolEquipos y lista en detalle los seriales cuyos registros NO
 * clusterizan como la misma unidad según mismoModelo (las "colisiones"),
 * con fuente, modelo y cliente/ref de cada lado, para revisión humana.
 *
 * USAGE (desde functions/): node scripts/analiza-colisiones-pool.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

(async () => {
  const registros = []; // {norm, serial, modelo_id, modelo_label, fuente, ref, cliente}

  // Fuente 1: contratos/*/seriales (activos/aprobados)
  const contratosSnap = await db.collection("contratos").get();
  const contratos = new Map();
  contratosSnap.forEach((d) => contratos.set(d.id, d.data()));
  const serialesSnap = await db.collectionGroup("seriales").get();
  for (const doc of serialesSnap.docs) {
    const parent = doc.ref.parent.parent;
    if (!parent || doc.ref.parent.parent.parent.id !== "contratos") continue;
    const s = doc.data();
    const c = contratos.get(parent.id) || {};
    if (c.deleted === true || !["activo", "aprobado"].includes(c.estado)) continue;
    const norm = pool.normSerial(s.serial);
    if (!pool.esSerialValido(norm)) continue;
    registros.push({
      norm, serial: (s.serial || "").trim(),
      modelo_id: s.modelo_id || null, modelo_label: s.modelo || "",
      fuente: "contrato", ref: s.contrato_id || c.contrato_id || parent.id,
      cliente: s.cliente_nombre || c.cliente_nombre || "",
    });
  }

  // Fuente 2: poc_devices
  const pocSnap = await db.collection("poc_devices").get();
  for (const doc of pocSnap.docs) {
    const d = doc.data();
    if (d.deleted === true) continue;
    const norm = pool.normSerial(d.serial);
    if (!d.serial || !pool.esSerialValido(norm)) continue;
    registros.push({
      norm, serial: (d.serial || "").trim(),
      modelo_id: d.modelo_id || null, modelo_label: d.modelo_label || d.modelo || "",
      fuente: "poc", ref: d.radio_name || d.unit_id || doc.id,
      cliente: d.cliente_nombre || d.cliente || "",
    });
  }

  // Fuente 3: órdenes vivas < 365 días
  const ordenesSnap = await db.collection("ordenes_de_servicio").get();
  const hace365 = Date.now() - 365 * 24 * 60 * 60 * 1000;
  for (const doc of ordenesSnap.docs) {
    const d = doc.data();
    if (d.eliminado === true) continue;
    if (String(d.estado_reparacion || "").trim().toUpperCase() === "ENTREGADO AL CLIENTE") continue;
    const creada = d.fecha_creacion?.toDate ? d.fecha_creacion.toDate().getTime() : null;
    if (creada && creada < hace365) continue;
    for (const e of (d.equipos || [])) {
      if (!e || e.eliminado) continue;
      const serial = (e.serial || e.SERIAL || e.numero_de_serie || "").toString().trim();
      const norm = pool.normSerial(serial);
      if (!serial || !pool.esSerialValido(norm)) continue;
      registros.push({
        norm, serial,
        modelo_id: e.modelo_id || null,
        modelo_label: (e.modelo || e.MODEL || e.modelo_nombre || "").toString().trim(),
        fuente: "orden", ref: d.numero_orden || doc.id,
        cliente: d.cliente_nombre || "",
      });
    }
  }

  // Agrupa por serial y clusteriza con mismoModelo (un registro pertenece a un
  // cluster si matchea con ALGÚN miembro — misma semántica greedy que el seed,
  // que compara contra los docs ya creados del serial).
  const porSerial = new Map();
  for (const r of registros) {
    (porSerial.get(r.norm) || porSerial.set(r.norm, []).get(r.norm)).push(r);
  }

  const colisiones = [];
  for (const [norm, regs] of porSerial) {
    const clusters = [];
    for (const r of regs) {
      const c = clusters.find((cl) => cl.some((m) =>
        pool.mismoModelo({ modelo_id: m.modelo_id, modelo_label: m.modelo_label }, r.modelo_id, r.modelo_label)));
      if (c) c.push(r); else clusters.push([r]);
    }
    if (clusters.length > 1) colisiones.push({ norm, clusters });
  }

  console.log(`Registros: ${registros.length} · Seriales únicos: ${porSerial.size} · Seriales con colisión: ${colisiones.length}\n`);
  for (const c of colisiones.sort((a, b) => a.norm.localeCompare(b.norm))) {
    console.log(`── ${c.norm}`);
    c.clusters.forEach((cl, i) => {
      for (const r of cl) {
        console.log(`   [${i + 1}] ${r.fuente.padEnd(8)} ${String(r.modelo_label || r.modelo_id || "SIN MODELO").padEnd(24)} ${String(r.ref).padEnd(18)} ${r.cliente}`);
      }
    });
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
