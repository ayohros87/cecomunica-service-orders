/**
 * fix-gran-terminal-devolucion.js — Saneo del caso GRAN TERMINAL DE TRANSPORTE
 * (REEMP20260806-01, 2026-08-25).
 *
 * Qué pasó: el reemplazo (1 radio: 24220A2357 dañado → 22806A0313) se creó el
 * 2026-08-06, ANTES de que existiera el plan de transición en la venta. Al
 * confirmarse la entrega (2026-08-13) onEntregaTransicion aplicó la regla
 * clásica "todo el origen se devuelve": 19 mapeos auto + orden DEVOLUCION
 * 2026081301 reclamando toda la flota del ALQ20250925-03, que sigue vigente.
 * La orden se borró (lógico) ese mismo día, pero borrarla no revierte los
 * mapeos → 19 unidades quedaron pendiente_devolucion y el recordatorio diario
 * las lista como "equipos sin orden".
 *
 * Qué hace (dry-run por default; --apply para escribir):
 *   1. Borra los 19 mapeos auto (onMapeoWrite revierte pendiente_devolucion,
 *      descuenta el contador y deja kardex — mismo camino que el caso Gamboa).
 *   2. Espera el asentado de los triggers y verifica que las 19 marcas cayeron.
 *   3. Crea el mapeo CORRECTO (saliente 24220A2357 → entrante 22806A0313):
 *      restaura el linaje reemplaza_a del radio nuevo. La marca
 *      pendiente_devolucion que le pone al saliente es inocua: está en_taller
 *      (el cron C2 solo mira asignado_contrato/en_cliente) y equiposPool la
 *      limpia sola cuando la ENTRADA 2026081116 lo pase a devuelto/bodega.
 *   4. Deja nota de corrección en el contrato.
 *
 * Los seriales van FIJOS (no por query) a propósito: el guard exige que el
 * estado actual coincida con el diagnóstico o aborta sin escribir.
 *
 * USAGE (desde functions/): node scripts/fix-gran-terminal-devolucion.js [--apply]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const CONTRATO_ID = "QmtrYssp1AaL24ctqCGa";   // REEMP20260806-01
const ORIGEN_ID = "Vf3ppNGjUbYahtVLUEVg";     // ALQ20250925-03
const ORDEN_DEV = "2026081301";               // la orden borrada
const SALIENTE = "24220A2357";                // radio dañado (en_taller)
const ENTRANTE = "22806A0313";                // radio nuevo (en_cliente)
const MODELO_ID = "x7hlVuYhyf22JhzR4hqz";
const MODELO = "PNC360S-R";

const ESPERADOS = [
  "22806A0241", "22806A0315", "23411A1034", "23418A0353", "23418A0379",
  "23706A0468", "23706A0472", "23706A0582", "23706A0620", "23914A1083",
  "24522A0513", "24523A0372", "24523A0381", "24523A0382", "24523A0384",
  "24523A0388", "24813A0564", "24813A0579", "24813A0660",
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(APPLY ? "== MODO APPLY ==" : "== DRY-RUN (nada se escribe; --apply para aplicar) ==");

  // ── Guard: el estado actual debe coincidir con el diagnóstico ──────────
  const con = await db.collection("contratos").doc(CONTRATO_ID).get();
  const c = con.data();
  if (!c || c.contrato_id !== "REEMP20260806-01") throw new Error("Contrato no es REEMP20260806-01");
  if (!c.transicion_auto_at) throw new Error("El contrato no tiene transicion_auto_at — el guard anti-rearme no aplica, abortar");

  const ord = await db.collection("ordenes_de_servicio").doc(ORDEN_DEV).get();
  if (!ord.exists || ord.data().eliminado !== true) throw new Error(`La orden ${ORDEN_DEV} no está eliminada — revisar antes de sanear`);

  const mapeos = await db.collection("contratos").doc(CONTRATO_ID).collection("mapeos").get();
  const aBorrar = [];
  mapeos.forEach((d) => {
    const m = d.data();
    if (m.auto === true && !m.entrante && ESPERADOS.includes(String(m.saliente || "").trim())) aBorrar.push(d);
    else console.log(`  (se conserva mapeo ajeno: ${d.id} saliente=${m.saliente} auto=${m.auto})`);
  });
  if (aBorrar.length !== ESPERADOS.length) {
    throw new Error(`Se esperaban ${ESPERADOS.length} mapeos auto y hay ${aBorrar.length} — el estado cambió, abortar`);
  }

  let flags = 0;
  for (const s of ESPERADOS) {
    const u = (await db.collection("equipos_pool").doc(s).get()).data();
    if (!u) throw new Error(`Unidad ${s} no existe en el pool`);
    if (u.estado !== "en_cliente") throw new Error(`Unidad ${s} está ${u.estado}, se esperaba en_cliente`);
    if (u.pendiente_devolucion === true) flags++;
  }
  const sal = (await db.collection("equipos_pool").doc(SALIENTE).get()).data();
  const ent = (await db.collection("equipos_pool").doc(ENTRANTE).get()).data();
  if (!sal || sal.estado !== "en_taller") throw new Error(`${SALIENTE} debería estar en_taller y está ${sal ? sal.estado : "(no existe)"}`);
  if (!ent || ent.estado !== "en_cliente") throw new Error(`${ENTRANTE} debería estar en_cliente y está ${ent ? ent.estado : "(no existe)"}`);

  console.log(`Guard OK: ${aBorrar.length} mapeos auto a borrar · ${flags}/19 unidades con pendiente_devolucion · ${SALIENTE} en_taller · ${ENTRANTE} en_cliente (reemplaza_a=${ent.reemplaza_a || "—"})`);

  if (!APPLY) {
    console.log("\nDRY-RUN — acciones que haría:");
    aBorrar.forEach((d) => console.log(`  DELETE contratos/${CONTRATO_ID}/mapeos/${d.id} (saliente ${d.data().saliente})`));
    console.log(`  CREATE mapeo corregido: saliente=${SALIENTE} entrante=${ENTRANTE}`);
    console.log(`  SET nota de corrección en el contrato`);
    process.exit(0);
  }

  // ── 1. Borrar los 19 mapeos auto (el trigger revierte las marcas) ──────
  for (const d of aBorrar) {
    await d.ref.delete();
    console.log(`  borrado mapeo ${d.id} (${d.data().saliente})`);
  }

  // ── 2. Esperar el asentado y verificar ─────────────────────────────────
  console.log("Esperando a que onMapeoWrite asiente (30s)...");
  await dormir(30000);
  let pendientes = [];
  for (let intento = 0; intento < 6; intento++) {
    pendientes = [];
    for (const s of ESPERADOS) {
      const u = (await db.collection("equipos_pool").doc(s).get()).data();
      if (u.pendiente_devolucion === true) pendientes.push(s);
    }
    if (!pendientes.length) break;
    console.log(`  aún con marca: ${pendientes.length} — reintento en 15s`);
    await dormir(15000);
  }
  if (pendientes.length) {
    console.log(`OJO: quedaron ${pendientes.length} unidades con la marca (${pendientes.join(", ")}) — revisar logs de onMapeoWrite. NO se crea el mapeo corregido.`);
    process.exit(1);
  }
  console.log("Verificado: 19/19 marcas pendiente_devolucion limpiadas.");

  // ── 3. Mapeo corregido (mismo shape que onEntregaTransicion) ───────────
  const nuevo = await db.collection("contratos").doc(CONTRATO_ID).collection("mapeos").add({
    saliente: SALIENTE,
    saliente_pool_id: SALIENTE,
    entrante: ENTRANTE,
    entrante_pool_id: ENTRANTE,
    modelo: MODELO,
    modelo_id: MODELO_ID,
    contrato_id: "REEMP20260806-01",
    contrato_origen_id: ORIGEN_ID,
    auto: false,
    corregido_nota: "Saneo 2026-08-25: la transición auto (sin plan de venta) reclamó los 19 radios del ALQ20250925-03, que sigue vigente. Este es el único reemplazo real.",
    at: admin.firestore.FieldValue.serverTimestamp(),
    por: "saneo:fix-gran-terminal-devolucion",
  });
  console.log(`Mapeo corregido creado: ${nuevo.id} (${SALIENTE} → ${ENTRANTE})`);

  // ── 4. Nota en el contrato ─────────────────────────────────────────────
  await db.collection("contratos").doc(CONTRATO_ID).update({
    transicion_corregido_nota: "Saneo 2026-08-25: los 19 mapeos auto se borraron (el ALQ20250925-03 sigue vigente; el reemplazo era de una sola unidad). Mapeo real: 24220A2357 → 22806A0313.",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  // ── Verificación final ─────────────────────────────────────────────────
  await dormir(20000);
  const entFin = (await db.collection("equipos_pool").doc(ENTRANTE).get()).data();
  const conFin = (await db.collection("contratos").doc(CONTRATO_ID).get()).data();
  console.log(`\nFinal: ${ENTRANTE}.reemplaza_a=${entFin.reemplaza_a || "—"} · transicion_mapeos_count=${conFin.transicion_mapeos_count}`);
  console.log("Listo.");
  process.exit(0);
})().catch((e) => { console.error("ABORTADO:", e.message); process.exit(1); });
