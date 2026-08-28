/**
 * fix-drift-custodia.js — Cirugía del drift que destapó el barrido masivo de
 * custodia (2026-08-28): fichas en_cliente cuya PROPIA historia de órdenes
 * dice otra cosa.
 *
 *   VOLVIO — la última orden del serial es una ENTRADA o DEVOLUCIÓN CERRADA:
 *     el radio aterrizó en CECOMUNICA y la ficha nunca se enteró. Se
 *     transiciona en_cliente → en_bodega (transicionarPorId: kardex
 *     'correccion_drift' con la orden como referencia, borra asignación y
 *     pendiente_devolucion). Es lo que onOrdenWritePool habría hecho.
 *
 *   OTRO_CLIENTE — la última salida fue ENTREGADA a OTRO cliente: la ficha
 *     apunta al titular viejo. Se re-apunta asignacion = {cliente de la
 *     orden} SIN contrato (kardex 'correccion_titular'); queda como custodia
 *     del titular real y el masivo (asigna-custodia-por-ordenes-masivo) la
 *     amarra con su propia evidencia en la siguiente corrida.
 *
 * Alcance: unidades en_cliente SIN contrato (custodia) + la lista EXTRA de
 * los 5 seriales de demos/temporales detectados el 2026-08-27 (tienen
 * contrato DEMO/TEMP asignado y por eso no son custodia).
 *
 * USAGE (desde functions/): node scripts/fix-drift-custodia.js [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const WRITE = process.argv.includes("--write");
const RX_CONTRATO = /\b(?:ALQ|PROP|REEMP|DEMO|TEMP)\d{8}-\d{2}\b/;
// Seriales con contrato asignado (demos/temps) cuyo drift ya se verificó a mano.
const EXTRA_NORMS = new Set(["23706A0395", "23706A0420", "24O31A0948", "18610A0014", "18610A0018"]);

const aDate = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d : null; };
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : "?");

(async () => {
  console.log("Cargando pool y órdenes…");
  const [poolSnap, ordSnap] = await Promise.all([
    db.collection("equipos_pool").where("estado", "==", "en_cliente").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);

  const porSerial = new Map();
  ordSnap.forEach((d) => {
    const o = d.data();
    if (o.eliminado) return;
    const fecha = aDate(o.fecha_entrega) || aDate(o.fecha_creacion);
    const base = {
      id: d.id, tipo: (o.tipo_de_servicio || "").toUpperCase(),
      estado: (o.estado_reparacion || "").toUpperCase(),
      cliente_id: o.cliente_id || null, cliente_nombre: o.cliente_nombre || "",
      fecha,
    };
    const vistos = new Set();
    (o.equipos || []).forEach((e) => { const n = pool.normSerial(e.serial || e.numero_serie || e.numero_de_serie || ""); if (n) vistos.add(n); });
    (o.devolucion?.esperados || []).forEach((e) => { const n = pool.normSerial(e.serial || ""); if (n) vistos.add(n); });
    for (const n of vistos) {
      if (!porSerial.has(n)) porSerial.set(n, []);
      porSerial.get(n).push(base);
    }
  });
  porSerial.forEach((arr) => arr.sort((a, b) => (a.fecha || 0) - (b.fecha || 0)));

  const volvio = [], otro = [];
  poolSnap.forEach((d) => {
    const u = { id: d.id, ref: d.ref, ...d.data() };
    const norm = u.serial_norm || d.id.split("__")[0];
    const esCustodia = u.asignacion?.cliente_id && !u.asignacion?.contrato_doc_id;
    if (!esCustodia && !EXTRA_NORMS.has(norm)) return;

    const apar = porSerial.get(norm) || [];
    if (!apar.length) return;
    const ult = apar[apar.length - 1];
    if ((ult.tipo === "ENTRADA" || ult.tipo === "DEVOLUCION") && ult.estado.startsWith("CERRADA")) {
      volvio.push({ u, orden: ult });
      return;
    }
    const salidas = apar.filter((a) => a.tipo !== "ENTRADA" && a.tipo !== "DEVOLUCION" && a.estado !== "ANULADA");
    if (!salidas.length) return;
    const ultSalida = salidas[salidas.length - 1];
    if (ultSalida.cliente_id && ultSalida.cliente_id !== u.asignacion?.cliente_id) {
      otro.push({ u, orden: ultSalida });
    }
  });

  console.log(`\nVOLVIO (→ en_bodega): ${volvio.length}`);
  volvio.slice(0, 15).forEach((x) => console.log(`  ${String(x.u.serial).padEnd(14)} de ${x.u.asignacion?.cliente_nombre || "?"} · orden ${x.orden.id} ${x.orden.tipo} ${fmt(x.orden.fecha)}`));
  if (volvio.length > 15) console.log(`  … y ${volvio.length - 15} más`);
  console.log(`\nOTRO_CLIENTE (re-apuntar titular): ${otro.length}`);
  otro.slice(0, 15).forEach((x) => console.log(`  ${String(x.u.serial).padEnd(14)} ${x.u.asignacion?.cliente_nombre || "?"} → ${x.orden.cliente_nombre || x.orden.cliente_id} (orden ${x.orden.id} ${fmt(x.orden.fecha)})`));
  if (otro.length > 15) console.log(`  … y ${otro.length - 15} más`);

  if (!WRITE) { console.log("\nDRY-RUN — nada escrito. Repite con --write."); return; }

  const FV = admin.firestore.FieldValue;
  // Nombre del titular nuevo: si la orden no lo trae, se resuelve del directorio.
  const nombreCache = new Map();
  const nombreDe = async (cid) => {
    if (!nombreCache.has(cid)) {
      const s = await db.collection("clientes").doc(cid).get().catch(() => null);
      nombreCache.set(cid, s?.exists ? (s.data().nombre || "") : "");
    }
    return nombreCache.get(cid);
  };
  let nBodega = 0, nTitular = 0;
  for (const x of volvio) {
    const r = await pool.transicionarPorId(x.u.id, {
      aEstado: pool.ESTADOS.EN_BODEGA,
      soloDesde: [pool.ESTADOS.EN_CLIENTE],
      tipo: "correccion_drift",
      refMov: { tipo: "orden", id: x.orden.id, label: x.orden.id },
      notas: `Corrección de drift (barrido 2026-08-28): la ${x.orden.tipo} ${x.orden.id} cerró el ${fmt(x.orden.fecha)} — el radio ya está en CECOMUNICA`,
      extra: { asignacion: FV.delete(), orden_actual_id: FV.delete() },
    });
    if (r === "transicion") nBodega++;
    else console.log(`  ! ${x.u.serial}: ${r}`);
  }
  for (const x of otro) {
    const nombre = x.orden.cliente_nombre || await nombreDe(x.orden.cliente_id);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(x.u.ref);
      if (!snap.exists || snap.data().estado !== "en_cliente") return;
      // update() reemplaza el mapa `asignacion` COMPLETO (un set con merge
      // dejaría vivo el contrato_doc_id del titular viejo dentro del mapa).
      tx.update(x.u.ref, {
        asignacion: { cliente_id: x.orden.cliente_id, cliente_nombre: nombre },
        pendiente_devolucion: FV.delete(),
        updated_at: FV.serverTimestamp(),
      });
      tx.set(x.u.ref.collection("movimientos").doc(), {
        at: FV.serverTimestamp(), por: "system", por_email: null,
        tipo: "correccion_titular", de_estado: null, a_estado: null,
        ref: { tipo: "orden", id: x.orden.id, label: x.orden.id },
        notas: `Corrección de titular (barrido 2026-08-28): la última salida fue a ${x.orden.cliente_nombre || x.orden.cliente_id} (orden ${x.orden.id}, ${fmt(x.orden.fecha)}); la ficha apuntaba a ${x.u.asignacion?.cliente_nombre || "?"}`,
      });
    });
    nTitular++;
  }
  console.log(`\nOK: ${nBodega} a bodega · ${nTitular} titulares corregidos.`);
  console.log("Siguiente paso: re-correr asigna-custodia-por-ordenes-masivo.js para amarrar la custodia re-apuntada.");
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
