/**
 * sanear-entradas-por-asignar.js — Cierra las órdenes de ENTRADA viejas cuyo
 * trabajo ya se resolvió por otra vía.
 *
 * CONTEXTO (destape de la bandeja de pendientes, 2026-08-24). Al volverse
 * visible la señal "Órdenes por asignar" apareció su sedimento: 35 órdenes
 * vivas, de las cuales 18 son ENTRADA (inspección de equipos devueltos) con
 * 31+ días sin que nadie las tome. Es la misma familia del atraso de
 * cuarentena: el equipo volvió, la orden se creó sola y nadie la asignó.
 * Muchas de sus unidades ya salieron de cuarentena por OTRA vía (conteos
 * físicos, ventas, bajas) — la orden quedó como cascarón.
 *
 * ⚠️ POR QUÉ EL CRITERIO ES EL QUE ES. Cerrar una ENTRADA no es inocuo:
 * onOrdenWritePool transiciona sus unidades a EN_BODEGA desde
 * [devuelto_revision, en_taller, en_cliente, asignado_contrato] y las marca
 * `verificado: true` — "el taller la tuvo en la mano". Cerrar en lote una
 * orden con unidades aún en esos estados FALSIFICA inventario (declara
 * inspeccionado lo que nadie inspeccionó, o arranca del cliente un radio que
 * volvió a salir). Por eso cada orden se clasifica por el estado REAL de sus
 * unidades en el pool:
 *
 *   · CERRABLE — todas en {en_bodega, vendido, baja} o sin ficha: el trigger
 *     no tiene nada que mover; el cierre es papeleo con evidencia.
 *   · EN CIRCULACIÓN — alguna en en_cliente/asignado_contrato: NO se cierra
 *     por estado (el trigger la jalaría a bodega); decisión humana.
 *   · INSPECCIÓN REAL — alguna en devuelto_revision/en_taller: trabajo
 *     físico pendiente; es la cola de cuarentena, no un cascarón.
 *
 * Deja la orden en su terminal propio "CERRADA (ENTRADA)" con la marca
 * `entrada_saneada` + evidencia, para que nunca se confunda con una
 * inspección hecha de verdad.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/sanear-entradas-por-asignar.js                # dry-run
 *   node scripts/sanear-entradas-por-asignar.js --dias 30
 *   node scripts/sanear-entradas-por-asignar.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const iDias = process.argv.indexOf("--dias");
const MIN_DIAS = iDias > -1 ? Number(process.argv[iDias + 1]) : 30;

const now = new Date();
const aDate = (ts) => { if (!ts) return null; if (ts.toDate) return ts.toDate();
  const d = new Date(ts); return isNaN(d.getTime()) ? null : d; };
const edadDias = (ts) => { const d = aDate(ts); return d ? (now - d) / 864e5 : null; };

// Estados del pool que hacen SEGURO el cierre (el trigger no los toca).
const RESUELTOS = new Set(["en_bodega", "vendido", "baja", "por_clasificar"]);
// Estados que significan "el radio volvió a salir": cerrar lo arrancaría.
const CIRCULANDO = new Set(["en_cliente", "asignado_contrato"]);

(async () => {
  const snap = await db.collection("ordenes_de_servicio")
    .where("estado_reparacion", "==", "POR ASIGNAR").limit(1000).get();

  const candidatas = [];
  snap.forEach((d) => {
    const o = d.data() || {};
    if (o.eliminado === true) return;
    if ((o.tipo_de_servicio || "").toUpperCase() !== "ENTRADA") return;
    const edad = edadDias(o.fecha_creacion);
    if (edad == null || edad < MIN_DIAS) return;
    candidatas.push({
      id: d.id,
      cliente: o.cliente_nombre || o.cliente || "—",
      dias: Math.floor(edad),
      seriales: (o.equipos || []).filter((e) => e && !e.eliminado)
        .map((e) => String(e.numero_de_serie || e.serial || "").trim()).filter(Boolean),
    });
  });

  const cerrables = [], circulando = [], inspeccion = [];
  for (const c of candidatas) {
    const estados = [];
    for (const s of c.seriales) {
      const norm = pool.normSerial(s);
      const q = await db.collection("equipos_pool")
        .where("serial_norm", "==", norm).limit(5).get();
      if (q.empty) { estados.push({ s, e: "(sin ficha)" }); continue; }
      q.forEach((u) => estados.push({ s, e: (u.data() || {}).estado || "?" }));
    }
    c.detalle = estados;
    const enCirc = estados.filter((x) => CIRCULANDO.has(x.e));
    const enInsp = estados.filter((x) => x.e === "devuelto_revision" || x.e === "en_taller");
    if (enInsp.length) { c.motivo = `${enInsp.length} unidad(es) aún en cuarentena/taller`; inspeccion.push(c); }
    else if (enCirc.length) { c.motivo = `${enCirc.length} unidad(es) volvieron a circular (${enCirc.map(x => x.e)[0]}…)`; circulando.push(c); }
    else cerrables.push(c);
  }

  const linea = (c) => `  ${String(c.dias).padStart(4)}d  ${c.id.padEnd(12)} ${c.cliente.slice(0, 36).padEnd(37)} ${String(c.seriales.length).padStart(2)} eq  ${c.motivo || ""}`;
  const resumenEstados = (c) => {
    const m = new Map();
    c.detalle.forEach((x) => m.set(x.e, (m.get(x.e) || 0) + 1));
    return [...m.entries()].map(([k, v]) => `${v}×${k}`).join(", ");
  };

  console.log(`ENTRADA vivas en POR ASIGNAR con ${MIN_DIAS}+ días: ${candidatas.length}\n`);
  console.log(`=== CERRABLES — todas sus unidades ya resueltas por otra vía (${cerrables.length}) ===`);
  cerrables.sort((a, b) => b.dias - a.dias).forEach((c) => {
    console.log(linea(c)); console.log(`        ↳ ${resumenEstados(c)}`);
  });
  console.log(`\n=== EN CIRCULACIÓN — el radio volvió a salir; decisión humana (${circulando.length}) ===`);
  circulando.forEach((c) => { console.log(linea(c)); console.log(`        ↳ ${resumenEstados(c)}`); });
  console.log(`\n=== INSPECCIÓN REAL — cola de cuarentena, no cascarón (${inspeccion.length}) ===`);
  inspeccion.forEach((c) => { console.log(linea(c)); console.log(`        ↳ ${resumenEstados(c)}`); });

  if (!EXECUTE) {
    console.log(`\n(dry-run — nada escrito. --execute cierra las ${cerrables.length} del primer bloque.)`);
    process.exit(0);
  }

  console.log(`\nCerrando ${cerrables.length} entradas…`);
  let ok = 0;
  for (const c of cerrables) {
    try {
      await db.collection("ordenes_de_servicio").doc(c.id).update({
        estado_reparacion: "CERRADA (ENTRADA)",
        entrada_saneada: true,
        entrada_saneada_at: admin.firestore.FieldValue.serverTimestamp(),
        entrada_saneada_motivo: "Cierre administrativo: todas sus unidades ya salieron de cuarentena por otra vía (conteos/ventas/bajas); la orden quedó como cascarón.",
        entrada_saneada_evidencia: resumenEstados(c),
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "ENTRADA_SANEADA",
          by: "script:sanear-entradas-por-asignar",
          evidencia: resumenEstados(c),
          fecha_iso: new Date().toISOString(),
        }),
      });
      ok++;
      console.log(`  ✓ ${c.id}`);
    } catch (e) {
      console.error(`  ✗ ${c.id}: ${e.message}`);
    }
  }
  console.log(`\nListo: ${ok}/${cerrables.length} cerradas. El trigger del pool no tiene nada que mover (esa fue la condición).`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
