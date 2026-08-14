/**
 * reparar-sustitucion.js — Completa el traspaso de equipo de una anulación por
 * SUSTITUCIÓN que quedó a medias.
 *
 * Por qué existe: la anulación por sustitución (feature del 2026-08-14) traspasa
 * el equipo al contrato nuevo desde el trigger onAnnulment, y el trigger corre
 * UNA vez —en el instante en que el contrato pasa a 'anulado'—. Si en ese
 * momento algo no cuadró (no se había creado el contrato sustituto todavía, el
 * modelo no tenía renglón, o —el caso original— las fichas estaban en un estado
 * que la clasificación descartaba), no hay forma de volver a dispararlo sin
 * des-anular y re-anular el contrato. Esto lo rehace, con la misma librería que
 * usa el trigger: `traspasarASustituto`.
 *
 * El caso que lo origina (verificado en datos, 2026-08-14):
 *   2026-08-11  REEMP20260811-01 (MAGEN DAVID) aprobado con 5 T338
 *   2026-08-13  los 5 entran al taller por la orden de programación 2026081307
 *               → las fichas pasan de asignado_contrato a en_taller
 *   2026-08-14  se anula como SUSTITUCIÓN hacia ALQ20260812-01 (que creció a 10
 *               unidades: 5 HYT-P50 + 5 T338). `en_taller` no estaba en los
 *               estados que la clasificación consideraba "colgando del
 *               contrato", así que los 5 cayeron en `omitidas`: cero seriales
 *               traspasados, cero avisos, y el contrato nuevo sin equipo
 *
 * El agujero ya está tapado en el código (lib/devolucion.js: con sustituto
 * indicado se traspasa TODO lo que siga ligado al contrato). Esto repara los
 * contratos que se anularon antes del arreglo.
 *
 * Idempotente: los seriales ya presentes en el sustituto se saltan.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/reparar-sustitucion.js --origen=REEMP20260811-01
 *   node scripts/reparar-sustitucion.js --origen=REEMP20260811-01 --execute
 *   node scripts/reparar-sustitucion.js --origen=<docId> --sustituto=<docId|contrato_id>
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });

const pool = require("../src/domain/equiposPool");
const { clasificarUnidadesAnulacion, TIPO_ANULACION } = require("../src/lib/devolucion");
const { traspasarASustituto } = require("../src/lib/sustitucionContrato");

const db = admin.firestore();
const EXECUTE = process.argv.includes("--execute");
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || "").split("=").slice(1).join("=");

// Acepta el número visible (REEMP20260811-01) o el doc id: pedirle a alguien que
// busque un id de Firestore para reparar un contrato es pedirle que se equivoque.
async function buscarContrato(clave) {
  if (!clave) return null;
  const porId = await db.collection("contratos").doc(clave).get();
  if (porId.exists) return { id: porId.id, data: porId.data() };
  const q = await db.collection("contratos").where("contrato_id", "==", clave).limit(2).get();
  if (q.empty) return null;
  if (q.size > 1) throw new Error(`"${clave}" identifica a más de un contrato — usar el doc id`);
  return { id: q.docs[0].id, data: q.docs[0].data() };
}

(async () => {
  console.log(`Modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);

  const origen = await buscarContrato(arg("origen"));
  if (!origen) { console.error("Falta --origen=<contrato_id|docId> (no encontrado)."); process.exit(1); }

  const sustClave = arg("sustituto") || origen.data.sustituido_por_id || "";
  const sust = await buscarContrato(sustClave);
  if (!sust) {
    console.error(`El contrato anulado no indica sustituto y no se pasó --sustituto=<contrato_id|docId>.`);
    process.exit(1);
  }

  console.log(`  origen    ${origen.data.contrato_id || origen.id} (${origen.id}) · estado=${origen.data.estado}`
    + ` · anulacion_tipo=${origen.data.anulacion_tipo || "-"}`);
  console.log(`  sustituto ${sust.data.contrato_id || sust.id} (${sust.id}) · estado=${sust.data.estado}`
    + ` · seriales_estado=${sust.data.seriales_estado || "-"}`);

  // Premisas. Reparar hacia un contrato equivocado mueve equipo de verdad.
  const chequeos = [
    [origen.data.estado === "anulado", `el origen está anulado (es ${origen.data.estado})`],
    [origen.data.anulacion_tipo === TIPO_ANULACION.SUSTITUCION || !!arg("sustituto"),
      "la anulación fue por SUSTITUCIÓN (o se pasó --sustituto explícito)"],
    [sust.id !== origen.id, "el sustituto no es el mismo contrato"],
    [sust.data.deleted !== true, "el sustituto no está borrado"],
    [sust.data.estado !== "anulado", "el sustituto no está anulado"],
    [sust.data.cliente_id === origen.data.cliente_id, "mismo cliente en ambos contratos"],
  ];
  let ok = true;
  for (const [pasa, desc] of chequeos) {
    console.log(`  ${pasa ? "✓" : "✗"} ${desc}`);
    if (!pasa) ok = false;
  }
  if (!ok) { console.error("\nPremisas rotas. Abortado — revisar a mano."); process.exit(1); }

  // Las mismas dos fases que el trigger: resolver el pool y clasificar.
  const serialesSnap = await db.collection("contratos").doc(origen.id).collection("seriales").get();
  const fichas = [];
  const omitidasResolver = [];
  for (const d of serialesSnap.docs) {
    const s = d.data() || {};
    const serial = (s.serial || "").toString().trim();
    if (!serial) continue;
    try {
      const { ref, data } = await pool.resolver(serial, s.modelo_id, s.modelo, { adoptarSiExiste: true });
      if (!data) { omitidasResolver.push({ serial, motivo: "sin ficha en el pool" }); continue; }
      fichas.push({
        serial, modelo: s.modelo || "", modelo_id: s.modelo_id || null,
        pool_doc_id: ref.id, estado: data.estado, propiedad: data.propiedad,
        contrato_doc_id: data.asignacion?.contrato_doc_id || null,
        contrato_id: data.asignacion?.contrato_id || "",
      });
    } catch (e) {
      omitidasResolver.push({ serial, motivo: `error: ${e.message}` });
    }
  }

  const plan = clasificarUnidadesAnulacion({
    fichas, contratoDocId: origen.id, tipo: TIPO_ANULACION.SUSTITUCION,
    entregaConfirmada: origen.data.entrega_confirmada === true, haySustituto: true,
  });
  const omitidas = [...omitidasResolver, ...plan.omitidas];

  console.log(`\n  ${serialesSnap.size} serial(es) en el contrato anulado`);
  console.log(`  ${plan.continuan.length} continúan → pasan al sustituto`);
  plan.continuan.forEach((f) => console.log(`    · ${f.serial} [${f.modelo || "?"}] estado=${f.estado}`));
  if (omitidas.length) {
    console.log(`  ${omitidas.length} omitida(s) — NO se traspasan:`);
    omitidas.forEach((o) => console.log(`    · ${o.serial}: ${o.motivo}`));
  }

  if (!plan.continuan.length) {
    console.log("\nNada que traspasar. Nada escrito.");
    process.exit(omitidas.length ? 1 : 0);
  }
  if (!EXECUTE) {
    console.log(`\n── Se haría ──`);
    console.log(`  copiar ${plan.continuan.length} serial(es) → contratos/${sust.id}/seriales`);
    console.log(`  (por su modelo y hasta el cupo del renglón; onSerialWrite re-apunta el pool)`);
    console.log("\ndry-run: nada escrito.");
    process.exit(0);
  }

  const r = await traspasarASustituto({
    origenId: origen.id, origen: origen.data, sustitutoId: sust.id, unidades: plan.continuan,
  });
  if (!r.ok) { console.error(`\nEl traspaso no procedió: ${r.motivo}`); process.exit(1); }

  console.log(`\n  ${r.copiados} serial(es) copiado(s) al sustituto`
    + ` · completo=${r.completo} · faltan por cargar=${r.faltan}`);
  (r.pendientes || []).forEach((p) => console.log(`    ! ${p.serial}: ${p.motivo}`));

  // El rastro en el contrato anulado, igual que lo deja el trigger cuando el
  // traspaso sale limpio: si quedó algo fuera, el chip de la lista lo dice.
  const sinResolver = [...(r.pendientes || []), ...omitidas];
  const patch = {
    sustitucion_traspasados: r.copiados || 0,
    sustitucion_reparado_at: admin.firestore.FieldValue.serverTimestamp(),
    sustitucion_reparado_por: "script:reparar-sustitucion",
  };
  if (sinResolver.length) {
    patch.sustitucion_vinculo_pendiente = true;
    patch.sustitucion_vinculo_motivo = `${sinResolver.length} unidad(es) sin traspasar`;
    patch.sustitucion_pendientes = sinResolver.slice(0, 50);
  } else {
    patch.sustitucion_vinculo_pendiente = admin.firestore.FieldValue.delete();
    patch.sustitucion_vinculo_motivo = admin.firestore.FieldValue.delete();
    patch.sustitucion_pendientes = admin.firestore.FieldValue.delete();
  }
  await db.collection("contratos").doc(origen.id).set(patch, { merge: true });
  console.log(`  rastro estampado en ${origen.data.contrato_id || origen.id}`);

  console.log("\nListo. Ningún radio se movió de sitio — solo cambió de contrato.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
