/**
 * backfill-asignacion-en-cliente.js — Completa el CONTRATO en la asignación de
 * las unidades en_cliente que solo saben el cliente, cruzando por serial contra
 * dos fuentes con contrato explícito. Solo escribe lo INEQUÍVOCO.
 *
 * CONTEXTO (informe docs/INFORME_TRACKING_SERIAL_2026-08-12.md, brecha B4):
 * 1,918 de 3,108 unidades en_cliente tienen cliente pero no contrato — el pool
 * sabe DÓNDE está el radio, no BAJO QUÉ vehículo comercial. Sin ese vínculo la
 * renovación no puede anclar salientes y la facturación no puede razonar por
 * serial.
 *
 * FUENTES (en este orden de fuerza):
 *   1. contratos VIGENTES (activo/aprobado, no deleted) cuya subcolección de
 *      seriales lista el serial Y cuyo cliente coincide con el de la unidad.
 *   2. poc_devices vivos con contrato_doc_id que apunte a un contrato vigente
 *      del MISMO cliente.
 *
 * REGLA: se escribe solo si TODAS las pistas apuntan al mismo contrato.
 * 0 pistas → 'sin-pista' (se queda como está; es custodia legítima o legacy).
 * 2+ contratos distintos → 'ambigua' (cola de revisión, humano decide).
 * Cliente distinto → 'otro-cliente' (probable reasignación no registrada; NO
 * se pisa la custodia actual — reporte).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-asignacion-en-cliente.js            # dry-run
 *   node scripts/backfill-asignacion-en-cliente.js --write
 * Idempotente: una unidad con contrato ya no matchea el filtro.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const nk = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const [pool, cs, seriales, poc] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
    db.collectionGroup("seriales").get(),
    db.collection("poc_devices").get(),
  ]);

  const contratos = new Map();
  cs.forEach((d) => contratos.set(d.id, { id: d.id, ...d.data() }));
  const vigente = (cid) => {
    const c = contratos.get(cid);
    return c && !c.deleted && ["activo", "aprobado"].includes(c.estado) ? c : null;
  };

  // serial_norm → Set<contrato_doc_id> por fuente (solo contratos vigentes).
  const pistaContrato = new Map();
  seriales.forEach((d) => {
    const cid = d.ref.parent.parent?.id;
    if (!cid || !vigente(cid)) return;
    const s = nk(d.data()?.serial);
    if (!s) return;
    if (!pistaContrato.has(s)) pistaContrato.set(s, new Set());
    pistaContrato.get(s).add(cid);
  });
  const pistaPoc = new Map();
  poc.forEach((d) => {
    const p = d.data();
    if (p.eliminado === true || p.deleted === true) return;
    const cid = p.contrato_doc_id;
    if (!cid || !vigente(cid)) return;
    const s = nk(p.serial || p.serial_norm || p.numero_de_serie);
    if (!s) return;
    if (!pistaPoc.has(s)) pistaPoc.set(s, new Set());
    pistaPoc.get(s).add(cid);
  });

  const res = { corregidas: 0, sinPista: 0, ambiguas: 0, otroCliente: 0 };
  const ambiguas = [], otroCliente = [];

  for (const d of pool.docs) {
    const u = d.data();
    if (u.estado !== "en_cliente") continue;
    const a = u.asignacion || null;
    if (!a || !a.cliente_id || a.contrato_doc_id) continue;

    const s = nk(u.serial_norm || d.id.split("__")[0]);
    const cids = new Set([...(pistaContrato.get(s) || []), ...(pistaPoc.get(s) || [])]);
    if (!cids.size) { res.sinPista++; continue; }

    // Filtro de cliente: una pista que apunta a OTRO cliente no completa la
    // custodia — la contradice. Eso es una reasignación sin registrar y la
    // decide un humano con el kardex.
    const delMismo = [...cids].filter((cid) => vigente(cid)?.cliente_id === a.cliente_id);
    if (!delMismo.length) {
      res.otroCliente++;
      if (otroCliente.length < 15) {
        otroCliente.push({ serial: d.id, custodia: (a.cliente_nombre || "").slice(0, 24),
          pistas: [...cids].map((c) => vigente(c)?.contrato_id).join(",") });
      }
      continue;
    }
    if (delMismo.length > 1) {
      res.ambiguas++;
      if (ambiguas.length < 15) {
        ambiguas.push({ serial: d.id, cliente: (a.cliente_nombre || "").slice(0, 24),
          candidatos: delMismo.map((c) => vigente(c)?.contrato_id).join(",") });
      }
      continue;
    }

    const c = vigente(delMismo[0]);
    res.corregidas++;
    if (res.corregidas <= 15) {
      console.log(`  ${d.id.padEnd(22)} → ${c.contrato_id}  (${(a.cliente_nombre || "").slice(0, 34)})`);
    }
    if (!dryRun) {
      await d.ref.set({
        asignacion: { ...a, contrato_doc_id: c.id, contrato_id: c.contrato_id || "" },
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await d.ref.collection("movimientos").add({
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: null,
        tipo: "asignacion_contrato", de_estado: u.estado, a_estado: u.estado,
        ref: { tipo: "contrato", id: c.id, label: c.contrato_id || "" },
        notas: "Backfill 2026-08-12: contrato inferido por serial (subcolección del contrato / POC), cliente coincidente",
      });
    }
  }
  if (res.corregidas > 15) console.log(`  … y ${res.corregidas - 15} más`);

  console.log(`\n=== resumen ===`);
  console.log(`corregidas (pista única, mismo cliente): ${res.corregidas}`);
  console.log(`sin pista (custodia legítima / legacy):  ${res.sinPista}`);
  console.log(`ambiguas (2+ contratos del cliente):     ${res.ambiguas}`);
  console.log(`pistas de OTRO cliente (no se toca):     ${res.otroCliente}`);
  if (ambiguas.length) { console.log("\n--- ambiguas (muestra) ---"); console.table(ambiguas); }
  if (otroCliente.length) { console.log("--- otro cliente (muestra) ---"); console.table(otroCliente); }
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
