/**
 * barrido-custodia-contrato.js — Amarra unidades "en cliente SIN contrato" al
 * contrato vigente de su cliente cuando el pareo es INEQUÍVOCO (brecha B4;
 * 1,861 de 3,058 unidades en_cliente al 2026-08-26 — caso C COMUNICA 1).
 *
 * PAREO (conservador) por unidad [cliente_id + sin contrato + en_cliente]:
 *   candidatos = contratos VIGENTES (activo/aprobado) del cliente cuyas líneas
 *   de equipos[] incluyen el MODELO de la unidad (mismoModelo del pool, mismo
 *   matching tolerante que usa todo el sistema) y con CUPO libre:
 *   cantidad de la línea − baja_cancelado del modelo − filas de serial ya
 *   registradas de ese modelo. AUTO solo con EXACTAMENTE UN candidato.
 *
 * ESCRITURA (solo --write, y SOLO cuando no perturba el estado físico):
 *   se agrega la fila a contratos/{cid}/seriales (shape de saveSerialesManual,
 *   source 'barrido_custodia') y onSerialWrite hace el resto (asignación en el
 *   pool, conteos). Eso mantiene en_cliente ÚNICAMENTE si el contrato es
 *   legacy o tiene entrega_confirmada — en cualquier otro caso upsertContacto
 *   movería la unidad a asignado_contrato (flip falso: el radio SÍ está en la
 *   calle), así que esos pareos se REPORTAN pero NO se escriben
 *   (categoría CONTRATO_SIN_ENTREGA: primero confirmar la entrega real).
 *
 * USAGE (desde functions/):
 *   node scripts/barrido-custodia-contrato.js            # dry-run
 *   node scripts/barrido-custodia-contrato.js --write
 * Idempotente: unidad ya asignada o fila ya existente se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const dryRun = !process.argv.includes("--write");
const SOURCE = "barrido_custodia";
const vigente = (c) => ["activo", "aprobado"].includes(c.estado) && !c.deleted;

(async () => {
  // 1) Unidades objetivo: en_cliente, con cliente, sin contrato.
  const poolSnap = await db.collection("equipos_pool").where("estado", "==", "en_cliente").get();
  const unidades = [];
  poolSnap.forEach((d) => {
    const u = d.data();
    if (!u.asignacion?.cliente_id || u.asignacion?.contrato_doc_id) return;
    unidades.push({ id: d.id, ref: d.ref, ...u });
  });

  // 2) Contratos vigentes por cliente.
  const conSnap = await db.collection("contratos").get();
  const porCliente = new Map();
  conSnap.forEach((d) => {
    const c = d.data();
    if (!vigente(c) || !c.cliente_id) return;
    if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
    porCliente.get(c.cliente_id).push({ id: d.id, ref: d.ref, ...c });
  });

  // 3) Filas de serial existentes por contrato candidato (cache perezoso).
  const filasCache = new Map(); // cid -> [{serial_norm, modelo_id, modelo}]
  const filasDe = async (cid) => {
    if (!filasCache.has(cid)) {
      const s = await db.collection("contratos").doc(cid).collection("seriales").get();
      filasCache.set(cid, s.docs.map((d) => {
        const x = d.data() || {};
        return { serial_norm: pool.normSerial(x.serial || ""), modelo_id: x.modelo_id || null, modelo: x.modelo || "" };
      }));
    }
    return filasCache.get(cid);
  };
  const asignadasPorBarrido = new Map(); // `${cid}|${lineaIdx}` -> n (cupo consumido en esta corrida)

  const res = { AUTO: [], AMBIGUA: 0, SIN_DESTINO: 0, SIN_MODELO: 0, FILA_EXISTENTE: 0 };
  for (const u of unidades) {
    const contratos = porCliente.get(u.asignacion.cliente_id) || [];
    if (!contratos.length) { res.SIN_DESTINO++; continue; }
    if (!u.modelo_id && !(u.modelo_label || "").trim()) { res.SIN_MODELO++; continue; }

    const candidatos = [];
    for (const c of contratos) {
      const lineas = c.equipos || [];
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        if (!pool.mismoModelo(u, l.modelo_id || null, l.modelo || "")) continue;
        const filas = await filasDe(c.id);
        const filasModelo = filas.filter((f) =>
          (f.modelo_id && l.modelo_id && f.modelo_id === l.modelo_id) ||
          String(f.modelo || "").trim().toUpperCase() === String(l.modelo || "").trim().toUpperCase()).length;
        const bajaModelo = Number((c.baja_cancelado || {})[String(l.modelo_id || l.modelo || "").trim()] || 0);
        const consumido = asignadasPorBarrido.get(`${c.id}|${i}`) || 0;
        const cupo = Number(l.cantidad || 0) - bajaModelo - filasModelo - consumido;
        if (cupo > 0) { candidatos.push({ c, lineaIdx: i, linea: l }); break; }
        // Sin cupo pero ¿la fila YA lista este serial? → el amarre existe en el
        // contrato y solo falta el pool: lo cuenta aparte (revisión puntual).
        if (filas.some((f) => f.serial_norm && f.serial_norm === u.serial_norm)) {
          res.FILA_EXISTENTE++;
          break;
        }
      }
    }

    if (candidatos.length === 1) {
      const { c, lineaIdx, linea } = candidatos[0];
      const seguro = c.seriales_estado === "legacy" || c.entrega_confirmada === true;
      asignadasPorBarrido.set(`${c.id}|${lineaIdx}`, (asignadasPorBarrido.get(`${c.id}|${lineaIdx}`) || 0) + 1);
      res.AUTO.push({ u, c, linea, seguro });
    } else if (candidatos.length > 1) {
      res.AMBIGUA++;
    } else {
      res.SIN_DESTINO++;
    }
  }

  const seguros = res.AUTO.filter((a) => a.seguro);
  const sinEntrega = res.AUTO.filter((a) => !a.seguro);
  console.log(`\n=== barrido-custodia-contrato ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);
  console.log(`Unidades en_cliente sin contrato: ${unidades.length}`);
  console.log(`  AUTO (candidato único):        ${res.AUTO.length}`);
  console.log(`     · APLICABLES (contrato legacy/entregado — estado intacto): ${seguros.length}`);
  console.log(`     · CONTRATO_SIN_ENTREGA (pareado pero NO se escribe):       ${sinEntrega.length}`);
  console.log(`  AMBIGUAS (varios contratos con cupo): ${res.AMBIGUA}`);
  console.log(`  SIN_DESTINO (sin contrato vigente con cupo del modelo): ${res.SIN_DESTINO}`);
  console.log(`  SIN_MODELO en la ficha: ${res.SIN_MODELO} · FILA_EXISTENTE (solo falta pool): ${res.FILA_EXISTENTE}`);
  console.log(`\nMuestras APLICABLES (20):`);
  seguros.slice(0, 20).forEach((a) =>
    console.log(`   · ${a.u.serial}  ${a.u.modelo_label || "?"}  →  ${a.c.contrato_id}  (${a.u.asignacion.cliente_nombre || a.c.cliente_nombre || "?"})`));
  console.log(`\nMuestras CONTRATO_SIN_ENTREGA (10):`);
  sinEntrega.slice(0, 10).forEach((a) =>
    console.log(`   · ${a.u.serial}  →  ${a.c.contrato_id}  [${a.c.seriales_estado || "—"}, entrega=${!!a.c.entrega_confirmada}]`));

  if (dryRun) { console.log(`\nDry-run: nada escrito. --write aplica SOLO los ${seguros.length} seguros.`); process.exit(0); }

  let escritos = 0;
  for (const a of seguros) {
    await a.c.ref.collection("seriales").add({
      serial: a.u.serial || a.u.id,
      modelo: a.u.modelo_label || a.linea.modelo || "",
      modelo_id: a.u.modelo_id || a.linea.modelo_id || null,
      contrato_doc_id: a.c.id,
      contrato_id: a.c.contrato_id || "",
      cliente_id: a.c.cliente_id || "",
      cliente_nombre: a.c.cliente_nombre || "",
      source: SOURCE,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      created_by: `script:${SOURCE}`,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_by: `script:${SOURCE}`,
    });
    escritos++;
    if (escritos % 100 === 0) console.log(`   … ${escritos}/${seguros.length}`);
  }
  console.log(`\nListo: ${escritos} filas de serial escritas — onSerialWrite amarra el pool (asignación + conteos).`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
