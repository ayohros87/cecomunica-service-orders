/**
 * asigna-seriales-serv20260911-01.js — caso Jean Simancas (2026-09-15).
 *
 * Bodega (Solís) no pudo asignar los dos PNC360S-R de la factura 10762 al
 * contrato SERV20260911-01: la política dura de Almacén · Asignar rechaza un
 * serial en estado `vendido` y su panel de bloqueo no ofrece forzar. Los
 * radios SON del cliente (línea "propio": él los compró y nos paga la
 * frecuencia), así que la asignación es correcta — lo que falla es el candado.
 *
 * Escribe LO MISMO que ContratosService.saveSerialesManual + el paso "Listo
 * para programar": subcolección `seriales`, `seriales_historial` y
 * `seriales_estado/current` = 'asignados'. El resto lo hace onSerialWrite.
 *
 * USAGE (desde functions/):
 *   node scripts/asigna-seriales-serv20260911-01.js            # dry-run
 *   node scripts/asigna-seriales-serv20260911-01.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");

const CONTRATO_DOC_ID = "I7HiurOcQodFhTurTNez";
const SERIALES = ["25219A0944", "24708A1192"];
const MODELO = "HYTERA PNC360S-R";
const MODELO_ID = "x7hlVuYhyf22JhzR4hqz";
const POR_EMAIL = "script:asigna-seriales-caso-solis-2026-09-15";
const NOTA = "Asignado por soporte: bodega quedó trancada porque el serial estaba "
  + "'vendido' (factura 10762) y la política dura de Almacén no ofrece forzar. "
  + "Línea 'propio': los radios son del cliente.";

const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  const ref = db.collection("contratos").doc(CONTRATO_DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("contrato no encontrado");
  const c = snap.data();

  // ── Guardas: no escribir a ciegas ───────────────────────────────────────
  if (c.seriales_estado !== "pendiente") throw new Error(`seriales_estado=${c.seriales_estado} (se esperaba 'pendiente')`);
  if (!["aprobado", "activo"].includes(c.estado)) throw new Error(`estado=${c.estado}`);
  const pedidas = (c.equipos || []).reduce((n, e) => n + Number(e.cantidad || 0), 0);
  if (pedidas !== SERIALES.length) throw new Error(`el contrato pide ${pedidas} unidad(es) y traigo ${SERIALES.length}`);
  const yaHay = await ref.collection("seriales").get();
  if (!yaHay.empty) throw new Error(`ya tiene ${yaHay.size} serial(es) registrados`);

  for (const s of SERIALES) {
    const u = await db.collection("equipos_pool").doc(key(s)).get();
    if (!u.exists) throw new Error(`${s}: sin ficha en el pool`);
    const d = u.data();
    if (d.modelo_id !== MODELO_ID) throw new Error(`${s}: modelo ${d.modelo_label} ≠ ${MODELO}`);
    console.log(`  ${s}: ${d.modelo_label} · estado=${d.estado} · propiedad=${d.propiedad} · factura=${d.venta?.factura || "—"}`);
  }

  console.log(`\nContrato ${c.contrato_id} · ${c.cliente_nombre} · ${pedidas} × ${MODELO} (${(c.equipos || [])[0]?.modalidad})`);
  console.log(`Se escribirán ${SERIALES.length} seriales + historial + seriales_estado/current='asignados'.`);
  if (!APPLY) { console.log("\nDRY-RUN. Corre con --apply para escribir."); return; }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  const col = ref.collection("seriales");
  for (const s of SERIALES) {
    batch.set(col.doc(), {
      serial: s, modelo: MODELO, modelo_id: MODELO_ID,
      contrato_doc_id: CONTRATO_DOC_ID, contrato_id: c.contrato_id || "",
      cliente_id: c.cliente_id || "", cliente_nombre: c.cliente_nombre || "",
      source: "manual", created_at: now, created_by: null, updated_at: now, updated_by: null,
    });
  }
  batch.set(ref.collection("seriales_historial").doc(), {
    at: now, por: null, por_email: POR_EMAIL, estado: "asignados", nota: NOTA,
    contrato_id: c.contrato_id || "", cliente_id: c.cliente_id || "", cliente_nombre: c.cliente_nombre || "",
    agregados: SERIALES.map(s => ({ serial: s, modelo: MODELO })), eliminados: [],
  });
  batch.set(ref.collection("seriales_estado").doc("current"),
    { estado: "asignados", omisiones: [], por: null, at: now }, { merge: true });
  await batch.commit();
  console.log("\nHECHO. onSerialWrite mueve el pool en 1-2 s.");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
