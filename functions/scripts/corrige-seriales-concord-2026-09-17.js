/**
 * corrige-seriales-concord-2026-09-17.js — CONCORD SECURITY, ALQ20260810-01.
 *
 * QUÉ PASÓ
 *   El 6-ago se hizo ALQ20260806-01 y bodega le asignó 15 seriales el 7-ago;
 *   el 7-ago se abrió la orden de PROGRAMACIÓN 2026080705 con esos mismos 15 y
 *   el 12-ago quedaron programados con los grupos de Concord, con QC aprobado y
 *   registrados en PoC. El 10-ago ese contrato se anuló (cambio de
 *   representante legal) y se creó ALQ20260810-01 SUELTO — sin
 *   contrato_origen_ids apuntando al anterior—, así que el contrato nuevo no
 *   heredó nada. El 17-sep bodega le asignó 15 seriales DISTINTOS, sacados de
 *   stock recién devuelto por otros clientes y sin programar.
 *
 *   Resultado: 29 fichas ligadas a Concord para una cuenta de 15 radios, y el
 *   contrato vivo declarando unos equipos que nadie preparó, mientras los que
 *   sí se programaron para este cliente siguen en la oficina sin contrato.
 *
 * QUÉ HACE (decisión de Alberto, 2026-09-17)
 *   Deja en ALQ20260810-01 los 15 seriales ya programados (los de la orden
 *   2026080705) y suelta los 15 que se asignaron el 17-sep. No toca la orden
 *   ni su QC, ni seriales_estado/current: solo cambia QUÉ radios cuelgan del
 *   contrato. El pool lo sincroniza onSerialWrite:
 *     · los entrantes están en_taller → conservan su estado y ganan el vínculo;
 *     · los salientes vuelven a en_bodega con verificado:false.
 *
 * USAGE (desde functions/):
 *   node scripts/corrige-seriales-concord-2026-09-17.js            # dry-run
 *   node scripts/corrige-seriales-concord-2026-09-17.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const APPLY = process.argv.includes("--apply");

const CONTRATO_DOC_ID = "NCvl3uJYaXhHEf4LhCFV";   // ALQ20260810-01, activo
const ORDEN_PROGRAMACION = "2026080705";          // de ahí salen los entrantes
const POR_EMAIL = "script:corrige-seriales-concord-2026-09-17";
const NOTA = "Corrección: el contrato quedó con 15 seriales de stock devuelto "
  + "(asignados el 17-sep) en vez de los 15 que se programaron para este cliente "
  + "en la orden 2026080705 (QC aprobado 12-ago, registrados en PoC). El contrato "
  + "anterior ALQ20260806-01 se anuló el 10-ago y el nuevo nació sin vínculo, así "
  + "que no heredó sus seriales.";

const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  const ref = db.collection("contratos").doc(CONTRATO_DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("contrato no encontrado");
  const c = snap.data();

  // ── Guardas sobre el contrato ───────────────────────────────────────────
  if (c.contrato_id !== "ALQ20260810-01") throw new Error(`contrato_id=${c.contrato_id}`);
  if (c.estado !== "activo") throw new Error(`estado=${c.estado} (se esperaba 'activo')`);

  // Unidades pedidas por modelo_id, según las líneas del contrato.
  const pedidasPorModelo = {};
  for (const e of (c.equipos || [])) {
    const n = Number(e.cantidad || 0);
    if (!n) continue;
    pedidasPorModelo[e.modelo_id] = (pedidasPorModelo[e.modelo_id] || 0) + n;
  }
  const pedidas = Object.values(pedidasPorModelo).reduce((a, b) => a + b, 0);

  // ── Entrantes: los equipos de la orden de programación ──────────────────
  const oSnap = await db.collection("ordenes_de_servicio").doc(ORDEN_PROGRAMACION).get();
  if (!oSnap.exists) throw new Error(`orden ${ORDEN_PROGRAMACION} no encontrada`);
  const orden = oSnap.data();
  if (orden.cliente_id !== c.cliente_id) throw new Error("la orden es de otro cliente");
  const entrantes = [...new Set((orden.equipos || []).map(e => String(e.serial || "").trim()).filter(Boolean))];
  if (entrantes.length !== pedidas) {
    throw new Error(`la orden trae ${entrantes.length} equipos y el contrato pide ${pedidas}`);
  }

  // Cada entrante: ficha en el pool, modelo que calce con una línea del
  // contrato y sin otro contrato vivo encima.
  const filas = [];
  const conteoPorModelo = {};
  for (const s of entrantes) {
    const u = await db.collection("equipos_pool").doc(key(s)).get();
    if (!u.exists) throw new Error(`${s}: sin ficha en el pool`);
    const d = u.data();
    if (!pedidasPorModelo[d.modelo_id]) throw new Error(`${s}: modelo ${d.modelo_label} no está en el contrato`);
    const ctrEncima = d.asignacion?.contrato_doc_id;
    if (ctrEncima && ctrEncima !== CONTRATO_DOC_ID) {
      const otro = await db.collection("contratos").doc(ctrEncima).get();
      const eo = otro.exists ? otro.data().estado : "(no existe)";
      if (["activo", "aprobado", "pendiente_aprobacion"].includes(eo)) {
        throw new Error(`${s}: lo tiene el contrato ${otro.data().contrato_id} (${eo})`);
      }
    }
    conteoPorModelo[d.modelo_id] = (conteoPorModelo[d.modelo_id] || 0) + 1;
    // El texto del modelo sale de la LÍNEA del contrato (el pool lo guarda con
    // la marca: "HYTERA PNC360S-R" vs "PNC360S-R" del contrato).
    const linea = (c.equipos || []).find(e => e.modelo_id === d.modelo_id);
    filas.push({ serial: s, modelo: linea.modelo, modelo_id: d.modelo_id, estado_pool: d.estado, poc: !!d.poc_device_id });
  }
  for (const [mid, n] of Object.entries(conteoPorModelo)) {
    if (n !== pedidasPorModelo[mid]) {
      throw new Error(`modelo ${mid}: la orden trae ${n} y el contrato pide ${pedidasPorModelo[mid]}`);
    }
  }

  // ── Salientes: lo que hoy cuelga del contrato ───────────────────────────
  const actuales = await ref.collection("seriales").get();
  const salientes = actuales.docs.map(d => ({ id: d.id, ...d.data() }));
  const entrantesNorm = new Set(filas.map(f => key(f.serial)));
  const yaCorrecto = salientes.length === filas.length && salientes.every(s => entrantesNorm.has(key(s.serial)));
  if (yaCorrecto) { console.log("El contrato ya tiene los seriales correctos. Nada que hacer."); return; }

  // ── Plan ────────────────────────────────────────────────────────────────
  console.log(`Contrato ${c.contrato_id} · ${c.cliente_nombre} · pide ${pedidas} unidades\n`);
  console.log(`SALEN del contrato (${salientes.length}) — vuelven a bodega para verificar:`);
  salientes.forEach(s => console.log(`   − ${s.serial}  ${s.modelo || "—"}`));
  console.log(`\nENTRAN al contrato (${filas.length}) — los programados en la orden ${ORDEN_PROGRAMACION}:`);
  filas.forEach(f => console.log(`   + ${f.serial}  ${f.modelo}  · pool=${f.estado_pool}${f.poc ? " · en PoC" : ""}`));

  if (!APPLY) { console.log("\nDRY-RUN. Corre con --apply para escribir."); return; }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  const col = ref.collection("seriales");
  salientes.forEach(s => batch.delete(col.doc(s.id)));
  for (const f of filas) {
    batch.set(col.doc(), {
      serial: f.serial, modelo: f.modelo, modelo_id: f.modelo_id,
      contrato_doc_id: CONTRATO_DOC_ID, contrato_id: c.contrato_id || "",
      cliente_id: c.cliente_id || "", cliente_nombre: c.cliente_nombre || "",
      source: "manual", created_at: now, created_by: null, updated_at: now, updated_by: null,
    });
  }
  batch.set(ref.collection("seriales_historial").doc(), {
    at: now, por: null, por_email: POR_EMAIL, estado: "asignados", nota: NOTA,
    contrato_id: c.contrato_id || "", cliente_id: c.cliente_id || "", cliente_nombre: c.cliente_nombre || "",
    agregados:  filas.map(f => ({ serial: f.serial, modelo: f.modelo })),
    eliminados: salientes.map(s => ({ serial: s.serial, modelo: s.modelo || "" })),
  });
  await batch.commit();
  console.log("\nHECHO. onSerialWrite mueve el pool en 1-2 s.");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
