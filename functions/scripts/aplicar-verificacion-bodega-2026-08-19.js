/**
 * aplicar-verificacion-bodega-2026-08-19.js — Aplica las respuestas de bodega
 * (José Solís) a la lista de 33 seriales dudosos que se le envió el 2026-08-19
 * (docs/mejoras-solicitadas/correo-bodega-seriales-a-verificar.md). Respuesta
 * recibida el 2026-08-26 en CSV; las 33 decisiones van EMBEBIDAS aquí para que
 * el script sea auditable por sí solo.
 *
 * Dos tipos de decisión:
 *
 * 1. CORREGIR (21) — el serial tenía un guión, un espacio o un carácter colado
 *    que la etiqueta física no trae. La normalización YA ignora esos caracteres
 *    (serial_norm idéntico → el doc-ID del pool no cambia): esto corrige el
 *    serial CRUDO —el que la gente ve— en las cuatro puntas donde vive:
 *      · equipos_pool (campo `serial` de la ficha; búsqueda por serial_norm,
 *        nunca por doc-ID — failsafe de colisión),
 *      · poc_devices (query por el texto exacto),
 *      · subcolecciones `seriales` de contratos (collectionGroup, por texto),
 *      · ordenes_de_servicio.equipos[] (scan; los arrays se reescriben
 *        completos vía update()).
 *
 * 2. BAJA POR NO-SERIAL (12) — bodega confirmó que son códigos de producto,
 *    no números de serie ("407595-R", "XX 1", "PS-34", "BASE (PS0000894)"…).
 *    La ficha del pool pasa a estado `baja` con nota — NO se borra: el pool
 *    nunca borra, y además el doc en baja impide que los triggers resuciten
 *    una ficha nueva mientras el texto siga en órdenes/contratos viejos. El
 *    texto en la orden o el contrato SE QUEDA (es lo que el documento del
 *    cliente dice — mismo trato que los "CONSOLA" de la auditoría 2026-07-27).
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/aplicar-verificacion-bodega-2026-08-19.js            # dry-run
 *   node scripts/aplicar-verificacion-bodega-2026-08-19.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const FECHA = "2026-08-26";
const FUENTE = "verificación de bodega 2026-08-19 (José Solís, respuesta 2026-08-26)";

// ── Las 33 decisiones, tal como vinieron en el CSV ────────────────────────
const CORREGIR = [
  // 15 INRICO TM-7PLUSS-R: la etiqueta NO trae el guión después de la T.
  { de: "7T-M27PA2460", a: "7TM27PA2460" }, { de: "7T-M27PA3013", a: "7TM27PA3013" },
  { de: "7T-M27PA3208", a: "7TM27PA3208" }, { de: "7T-M27PA3417", a: "7TM27PA3417" },
  { de: "7T-M27PA3423", a: "7TM27PA3423" }, { de: "7T-M27PA3424", a: "7TM27PA3424" },
  { de: "7T-M27PA3462", a: "7TM27PA3462" }, { de: "7T-M27PA3463", a: "7TM27PA3463" },
  { de: "7T-M27PA3478", a: "7TM27PA3478" }, { de: "7T-M27PA3551", a: "7TM27PA3551" },
  { de: "7T-M27PA3624", a: "7TM27PA3624" }, { de: "7T-M27PA3665", a: "7TM27PA3665" },
  { de: "7T-M27PA3675", a: "7TM27PA3675" }, { de: "7T-M27PA3972", a: "7TM27PA3972" },
  { de: "7T-M27PA3483", a: "7TM27PA3483" },
  // 5 HYTERA HP786 vendidos: espacio colado después de la A.
  { de: "26611A 3685", a: "26611A3685" }, { de: "26611A 3686", a: "26611A3686" },
  { de: "26611A 3687", a: "26611A3687" }, { de: "26611A 3688", a: "26611A3688" },
  { de: "26611A 3689", a: "26611A3689" },
  // Backtick colado al teclear.
  { de: "`B6710759", a: "B6710759" },
];

// "eliminar, no es una serie, es código de producto"
const NO_SERIAL = [
  "407595-R",          // aparece bajo DOS modelos (PNC360S-R y PNC370-R): colisión, 2 fichas
  "PC143-R", "XX 1", "XX 2", "PS-20R", "PS-34", "PS-505", "PS2023-R",
  "BASE (PS0000894)", "300-01462", "DVP-2712",
];

// ── Helpers ───────────────────────────────────────────────────────────────
const cambios = [];   // registro plano de todo lo que se haría/hizo
function plan(coleccion, id, detalle, fn) {
  cambios.push({ coleccion, id, detalle, fn });
}

async function fichasPorNorm(norm) {
  const q = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
  const out = [];
  q.forEach((d) => out.push({ ref: d.ref, data: d.data() || {} }));
  return out;
}

(async () => {
  // ══ 1. CORRECCIONES ═════════════════════════════════════════════════════
  console.log("═══ CORRECCIONES DE TIPEO (serial visible; serial_norm no cambia) ═══");
  for (const { de, a } of CORREGIR) {
    const normDe = pool.normSerial(de);
    const normA = pool.normSerial(a);
    if (normDe !== normA) {   // paranoia: si difieren, esto NO es un fix de display
      console.log(`  ⚠ ${de} → ${a}: los serial_norm difieren (${normDe} ≠ ${normA}) — SE OMITE, requiere migración de doc-ID`);
      continue;
    }

    // Pool: la ficha (o fichas, si hay colisión de modelos)
    const fichas = await fichasPorNorm(normA);
    if (!fichas.length) console.log(`  · ${de}: sin ficha en el pool (norm ${normA})`);
    for (const f of fichas) {
      if (String(f.data.serial || "") === a) { console.log(`  = ${a}: ficha ${f.ref.id} ya está correcta`); continue; }
      console.log(`  ✎ pool/${f.ref.id}: serial "${f.data.serial}" → "${a}" (estado ${f.data.estado})`);
      plan("equipos_pool", f.ref.id, `${f.data.serial} → ${a}`, () => f.ref.update({
        serial: a,
        notas_serial_fix: `Corregido por ${FUENTE}: la etiqueta no trae el separador`,
      }));
    }

    // POC devices: por texto exacto viejo
    const poc = await db.collection("poc_devices").where("serial", "==", de).get();
    poc.forEach((d) => {
      console.log(`  ✎ poc_devices/${d.id}: serial "${de}" → "${a}"`);
      plan("poc_devices", d.id, `${de} → ${a}`, () => d.ref.update({ serial: a }));
    });

    // Seriales de contrato: DIRIGIDO vía la asignación de la ficha (el
    // collectionGroup por `serial` exigiría un índice nuevo solo para este
    // script). Si la unidad está asignada a un contrato, se revisa SU
    // subcolección; las unidades en bodega/vendidas no tienen contrato vivo.
    for (const f of fichas) {
      const cid = f.data.asignacion?.contrato_doc_id;
      if (!cid) continue;
      const cs = await db.collection("contratos").doc(cid).collection("seriales")
        .where("serial", "==", de).get();
      cs.forEach((d) => {
        console.log(`  ✎ ${d.ref.path}: serial "${de}" → "${a}"`);
        plan(d.ref.parent.path, d.id, `${de} → ${a}`, () => d.ref.update({ serial: a }));
      });
    }
  }

  // Órdenes: un solo scan para los 21 (los arrays no se pueden consultar)
  const mapa = new Map(CORREGIR.map((c) => [c.de, c.a]));
  const ords = await db.collection("ordenes_de_servicio").limit(5000).get();
  ords.forEach((d) => {
    const o = d.data() || {};
    const eqs = Array.isArray(o.equipos) ? o.equipos : [];
    let toca = false;
    const nuevos = eqs.map((e) => {
      if (!e) return e;
      const n = { ...e };
      for (const campo of ["numero_de_serie", "serial"]) {
        const v = String(n[campo] || "").trim();
        if (mapa.has(v)) { n[campo] = mapa.get(v); toca = true; }
      }
      return n;
    });
    if (toca) {
      const lista = eqs.map((e, i) => {
        const antes = String(e?.numero_de_serie || e?.serial || "");
        const despues = String(nuevos[i]?.numero_de_serie || nuevos[i]?.serial || "");
        return antes !== despues ? `${antes}→${despues}` : null;
      }).filter(Boolean).join(", ");
      console.log(`  ✎ ordenes/${d.id}: ${lista}`);
      // El array se reescribe COMPLETO (rutas anidadas van con update()).
      plan("ordenes_de_servicio", d.id, lista, () => d.ref.update({ equipos: nuevos }));
    }
  });

  // ══ 2. BAJA POR NO-SERIAL ═══════════════════════════════════════════════
  console.log("\n═══ BAJA POR NO-SERIAL (códigos de producto según bodega) ═══");
  for (const raw of NO_SERIAL) {
    const norm = pool.normSerial(raw);
    const fichas = await fichasPorNorm(norm);
    if (!fichas.length) { console.log(`  · "${raw}": sin ficha en el pool (norm ${norm})`); continue; }
    for (const f of fichas) {
      if (f.data.estado === "baja") { console.log(`  = "${raw}": ficha ${f.ref.id} ya está en baja`); continue; }
      console.log(`  ✎ pool/${f.ref.id}: "${f.data.serial}" (${f.data.modelo_label || "?"}, estado ${f.data.estado}) → BAJA por no-serial`);
      plan("equipos_pool", f.ref.id, `baja no-serial (era ${f.data.estado})`, async () => {
        await f.ref.update({
          estado: "baja",
          baja_motivo: `No es un número de serie — código de producto, según ${FUENTE}`,
          baja_no_serial: true,
          baja_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Kardex: la salida queda contada como cualquier transición.
        await f.ref.collection("movimientos").add({
          tipo: "baja_no_serial",
          de_estado: f.data.estado,
          a_estado: "baja",
          notas: `Bodega confirmó que es un código de producto, no un serial (${FECHA}). El texto se conserva en las órdenes/contratos que lo mencionan.`,
          at: admin.firestore.FieldValue.serverTimestamp(),
          by: "script:aplicar-verificacion-bodega-2026-08-19",
        });
      });
    }
  }

  // ══ Resumen / ejecución ═════════════════════════════════════════════════
  console.log(`\nTotal de escrituras planificadas: ${cambios.length}`);
  if (!EXECUTE) { console.log("(dry-run — nada escrito. Añade --execute para aplicar.)"); process.exit(0); }

  let ok = 0;
  for (const c of cambios) {
    try { await c.fn(); ok++; }
    catch (e) { console.error(`  ✗ ${c.coleccion}/${c.id}: ${e.message}`); }
  }
  console.log(`Aplicadas: ${ok}/${cambios.length}`);
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
