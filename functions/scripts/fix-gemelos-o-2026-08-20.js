/**
 * fix-gemelos-o-2026-08-20.js — Fusiona los 14 grupos de seriales gemelos
 * O↔0 de MISMO modelo: la grafía correcta es la LETRA O (código de mes
 * Hytera; medido: 24O31A* 102 fichas vs 24031A* 2, y bodega leyó 39
 * etiquetas físicas con O y CERO con dígito).
 *
 * Regla de resolución (decisión del usuario 2026-08-20): la historia del
 * radio termina en su evento MÁS RECIENTE — esa es la ubicación real.
 *
 * Mecánica en 4 fases (una corrida):
 *   1. SNAPSHOT de las 28 fichas (14 O + 14 cero) → JSON local (respaldo).
 *   2. fix-serial-truncado por cada orden con grafía cero (7 órdenes):
 *      corrige las filas de la orden Y fusiona la ficha fantasma en la O
 *      (kardex viaja con `fusionado_de`; el fantasma se borra).
 *   3. ESPERA 45 s + REPARACIÓN: onOrdenWritePool trata las 2 ENTRADAs
 *      CERRADAS como órdenes vivas (yaEntregada solo cubre ENTREGADO) y su
 *      rama `nuevos` empuja los seriales O a en_taller con propiedad
 *      cliente. Se restaura la TABLA DE VERDAD: el snapshot de cada ficha O
 *      + 5 overrides por la regla del evento más reciente (Ligo, SEPROSA,
 *      Serv. Ambientales, por_clasificar ANATI, pista Sociedad Israelita).
 *   4. POST-VERIFY: imprime el estado final de las 14.
 *
 * FUERA DE ALCANCE a propósito: los 2 seriales del contrato DEMO20251112-01
 * (Millenium) y sus 2 poc_devices — ese demo ya fue devuelto (ENTRADA
 * sep-2025) y corregirles la grafía dispararía onSerialWrite re-asignando
 * el pool a Millenium. Van con la conciliación de ese DEMO.
 *
 * USAGE (desde functions/):  node scripts/fix-gemelos-o-2026-08-20.js [--write]
 */
const fs = require("fs");
const { execSync } = require("child_process");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const WRITE = process.argv.includes("--write");
const EMAIL = "ayohros@gmail.com";

// cero → O (14 grupos, mismo modelo verificado)
const PARES = {
  "19016C0874": "19O16C0874",
  "24022A0015": "24O22A0015", "24022A0016": "24O22A0016", "24022A0017": "24O22A0017",
  "24022A0018": "24O22A0018", "24022A0019": "24O22A0019", "24022A0021": "24O22A0021",
  "24022A0023": "24O22A0023", "24022A0030": "24O22A0030", "24022A0031": "24O22A0031",
  "24022A0032": "24O22A0032",
  "24031A0905": "24O31A0905", "24031A0945": "24O31A0945",
  "25010A2032": "25O10A2032",
};

// órdenes que usan la grafía cero (censo 2026-08-20)
const ORDENES = {
  "2025072401": ["24022A0030"],
  "2025073104": ["24022A0031", "24022A0032"],
  "2025081502": ["19016C0874"],
  "2025121506": ["24022A0015", "24022A0016", "24022A0017", "24022A0018", "24022A0019", "24022A0021", "24022A0023"],
  "2026021002": ["24031A0905"],
  "2026042701": ["24031A0945"],
  "2026071403": ["25010A2032"],
};

// Overrides de la regla "el evento más reciente manda" (el resto de fichas
// restaura su snapshot tal cual).
const OVERRIDES = {
  "24O22A0030": {
    estado: "en_cliente",
    asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: "y4v9MaOjuH7GA6LevRHt", cliente_nombre: "TRANSPORTE LIGO, S.A." },
    nota: "Historia termina en REPARACIÓN 2026050502 entregada 2026-07-16 (Transporte Ligo).",
  },
  "24O22A0031": {
    estado: "en_cliente",
    asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: "jT6FlI02u2L52On6zsaj", cliente_nombre: "SEGURIDAD PERMANENTE Y PROTECCION S A SEPROSA" },
    nota: "Historia termina en PROGRAMACIÓN 2025100304 entregada oct-2025 (SEPROSA). El DEMO de Millenium ya había sido devuelto (ENTRADA 2025091907).",
  },
  "24O22A0032": {
    estado: "en_cliente",
    asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: "50W3JkGDlIcW0z9uQ9MQ", cliente_nombre: "SERVICIOS AMBIENTALES DE CHIRIQUI" },
    nota: "Historia termina en PROGRAMACIÓN 2025100301 entregada 2025-10-08 (Servicios Ambientales). El DEMO de Millenium ya había sido devuelto (ENTRADA 2025091907).",
  },
  "24O31A0905": {
    estado: "por_clasificar",
    nota: "Historia termina en ENTRADA 2026022306 CERRADA (2026-02-23): el radio volvió de ANATI. por_clasificar = volvió según papel, falta ubicarlo físicamente (convención regla A 2026-07-28). La asignación se conserva como pista.",
  },
  "24O31A0945": {
    estado: "devuelto_revision",
    asignacion: { contrato_doc_id: null, contrato_id: "TEMP20260521-01", cliente_id: "zvVlyCCb6PYxxReFJZFV", cliente_nombre: "SOCIEDAD ISRAELITA DE BENEFICENCIA - MACABIADA" },
    nota: "Historia termina en ENTRADA 2026072904 (RECIBIDO EN MOSTRADOR 2026-07-29): devuelto por Sociedad Israelita, pendiente de inspección. La pista anterior (TOPPNIVA) quedó atrás — el radio salió a Sociedad en PROGRAMACIÓN 2026052103 (2026-05-21).",
  },
};

const CAMPOS_RESTAURA = ["estado", "asignacion", "propiedad", "orden_actual_id", "verificado", "modelo_id", "modelo_label", "condicion"];

const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

(async () => {
  console.log(WRITE ? "*** ESCRIBIENDO ***\n" : "*** DRY-RUN ***\n");

  // ── Fase 1: snapshot ────────────────────────────────────────────────
  const snapshot = {};
  for (const [cero, conO] of Object.entries(PARES)) {
    for (const s of [cero, conO]) {
      const snap = await db.collection("equipos_pool").where("serial_norm", "==", s).get();
      snapshot[s] = snap.empty ? null : { doc_id: snap.docs[0].id, ...snap.docs[0].data() };
    }
    if (!snapshot[conO]) throw new Error(`Falta la ficha O de ${conO} — abortar`);
  }
  const rutaSnap = "../local-data/limpieza-2026-08-19/gemelos-snapshot-pre-fusion.json";
  fs.writeFileSync(rutaSnap, JSON.stringify(snapshot, (k, v) => (v && v.toDate ? v.toDate().toISOString() : v), 2));
  console.log(`snapshot de ${Object.keys(snapshot).length} fichas → ${rutaSnap}\n`);

  // ── Fase 2: fix-serial-truncado por orden ───────────────────────────
  for (const [orden, ceros] of Object.entries(ORDENES)) {
    const pares = ceros.map((c) => `${c}:${PARES[c]}`).join(",");
    const cmd = `node scripts/fix-serial-truncado.js ${orden} ${pares}${WRITE ? " --write" : ""} --email=${EMAIL}`;
    console.log(`\n════ ${cmd}`);
    execSync(cmd, { stdio: "inherit" });
  }

  if (!WRITE) {
    console.log("\n*** DRY-RUN — nada escrito. Correr con --write para aplicar. ***");
    process.exit(0);
  }

  // ── Fase 3: esperar triggers y reparar con la tabla de verdad ───────
  console.log("\n… esperando 45 s a que onOrdenWritePool termine …");
  await new Promise((r) => setTimeout(r, 45000));

  for (const conO of Object.values(PARES)) {
    const base = snapshot[conO];
    const objetivo = {};
    for (const c of CAMPOS_RESTAURA) objetivo[c] = base[c] ?? null;
    const ov = OVERRIDES[conO];
    if (ov) {
      if (ov.estado) objetivo.estado = ov.estado;
      if (ov.asignacion) objetivo.asignacion = ov.asignacion;
    }

    const ref = db.collection("equipos_pool").doc(base.doc_id);
    const cur = (await ref.get()).data() || {};
    const difs = CAMPOS_RESTAURA.filter((c) => !igual(cur[c], objetivo[c]));
    if (!difs.length) { console.log(`${conO}: ya está en la tabla de verdad`); continue; }

    console.log(`${conO}: reparando [${difs.join(", ")}] → estado=${objetivo.estado} · ${objetivo.asignacion?.cliente_nombre || "sin asignación"}`);
    await ref.set({ ...objetivo, updated_at: admin.firestore.FieldValue.serverTimestamp(), updated_by_email: EMAIL }, { merge: true });
    await ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: EMAIL, ref: null,
      tipo: "reclasificacion",
      de_estado: cur.estado || null, a_estado: objetivo.estado,
      notas: `Gemelo O/0 fusionado (grafía correcta: letra O, código de mes Hytera). ` +
        `Regla 2026-08-20: la ubicación real es la del evento más reciente. ` +
        `${ov?.nota || "Estado restaurado tras la fusión (el trigger de la orden lo había pisado)."}`,
    });
  }

  // ── Fase 4: verificación final ──────────────────────────────────────
  console.log("\n═══ ESTADO FINAL ═══");
  let fantasmas = 0;
  for (const [cero, conO] of Object.entries(PARES)) {
    const [fO, f0] = await Promise.all([
      db.collection("equipos_pool").where("serial_norm", "==", conO).get(),
      db.collection("equipos_pool").where("serial_norm", "==", cero).get(),
    ]);
    const x = fO.empty ? null : fO.docs[0].data();
    if (!f0.empty) fantasmas++;
    console.log(`${conO}: ${x ? `${x.modelo_label} · ${x.estado} · ${x.asignacion?.cliente_nombre || "sin asignación"}` : "¡FALTA!"}` +
      `   | fantasma ${cero}: ${f0.empty ? "eliminado ✓" : "¡SIGUE VIVO!"}`);
  }
  console.log(`\nfantasmas restantes: ${fantasmas} (esperado 0)`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
