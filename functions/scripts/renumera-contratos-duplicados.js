/**
 * renumera-contratos-duplicados.js — Resuelve los contrato_id repetidos que
 * dejó el bug de zona horaria del generador (nc-guardar.js).
 *
 * CAUSA: el número se sellaba con `new Date().toISOString()` (fecha UTC) pero
 * el conteo del sufijo se hacía contra una ventana de medianoche LOCAL. En
 * Panamá (UTC-5), un contrato creado entre las 19:00 y las 24:00 nacía con la
 * fecha de MAÑANA y caía 5 horas antes del inicio de su propia ventana: no se
 * contaba nunca. Cada contrato de esa franja obtenía sufijo -01, y el primer
 * contrato legítimo del día siguiente también.
 *
 * REGLA DE DESEMPATE (decisión del usuario, 2026-07-28): conserva el número el
 * contrato cuyo sello de fecha SÍ corresponde a su día local de creación; los
 * que nacieron la noche anterior se mueven a su fecha real.
 *
 * Arrastra el número a todas sus copias denormalizadas. La atribución es
 * inequívoca porque cada referencia guarda además `contrato_doc_id`:
 *   · contratos/{doc}                     contrato_id, anulado_ref
 *   · contratos/{doc}/seriales/*          contrato_id
 *   · contratos/{doc}/seriales_historial/* contrato_id
 *   · equipos_pool/{serial}               asignacion.contrato_id
 *   · equipos_pool/{serial}/movimientos/* ref.label
 *
 * NO toca (por diseño):
 *   · mail_queue — es la bitácora de correos YA ENVIADOS (estado=sent). El
 *     correo salió con el número viejo; reescribirlo falsearía el registro.
 *   · verificaciones/* — su campo `contrato_id` guarda el DOC ID, no el número.
 *   · poc_devices, ordenes_de_servicio y fichas del pool que apuntan al gemelo
 *     que conserva su número (se verifica por contrato_doc_id).
 *
 * Los triggers de contratos están protegidos por transiciones de estado
 * (onApproval/onAnnulment/onEntregaPool/onEntregaTransicion), así que el
 * renombrado no dispara correos. onSerialWrite sí corre al tocar la
 * subcolección, pero con el serial intacto solo recalcula seriales_count.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/renumera-contratos-duplicados.js            # dry-run
 *   node scripts/renumera-contratos-duplicados.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");

const PLAN = [
  {
    doc:    "XtjtuGb9ODefi2K2JefL",
    viejo:  "ALQ20260723-01",
    nuevo:  "ALQ20260722-01",
    quien:  "WILLY BUSINESS SOLUTIONS, S. EP.",
    motivo: "Creado 2026-07-22 19:20 hora Panamá; el sello UTC lo fechó el 23 y colisionó con otros dos contratos.",
  },
  {
    doc:    "oD8OPxZGcl21LYZsiTwx",
    viejo:  "ALQ20260723-01",
    nuevo:  "ALQ20260722-02",
    quien:  "WET WILLYS INTERNATIONAL S.E.P",
    motivo: "Creado 2026-07-22 19:28 hora Panamá; el sello UTC lo fechó el 23 y colisionó con otros dos contratos.",
  },
  {
    doc:    "YwDI16pCyvZmJlUbpNNB",
    viejo:  "PROP20260503-01",
    nuevo:  "PROP20260502-02",
    quien:  "Kibian Josue Guardia Gonzalez (anulado)",
    motivo: "Creado 2026-05-02 23:25 hora Panamá; el sello UTC lo fechó el 3 y colisionó con el contrato aprobado del mismo cliente.",
  },
];

// Los que CONSERVAN su número — se verifica que sigan en pie al terminar.
const CONSERVAN = [
  { doc: "1lFLvkupr4WL8GU6mdLB", num: "ALQ20260723-01", quien: "COPASECUVA" },
  { doc: "bWhUXDLRktbzkr55xZHD", num: "PROP20260503-01", quien: "KIBIAN JOSUE GUARDIA GONZALEZ (aprobado)" },
];

const ts = () => admin.firestore.FieldValue.serverTimestamp();

async function planearUno(p) {
  const acciones = [];
  const cRef = db.collection("contratos").doc(p.doc);
  const cSnap = await cRef.get();

  if (!cSnap.exists) throw new Error(`contratos/${p.doc} no existe`);
  const c = cSnap.data();
  if (c.contrato_id !== p.viejo) {
    throw new Error(`contratos/${p.doc} tiene contrato_id="${c.contrato_id}", se esperaba "${p.viejo}" (¿ya se corrió?)`);
  }

  // El número destino tiene que estar libre.
  const choque = await db.collection("contratos").where("contrato_id", "==", p.nuevo).get();
  if (!choque.empty) {
    throw new Error(`"${p.nuevo}" ya lo usa ${choque.docs.map((d) => d.id).join(", ")}`);
  }

  const campos = {
    contrato_id: p.nuevo,
    contrato_id_anterior: p.viejo,
    renumerado_at: ts(),
    renumerado_motivo: p.motivo,
  };
  // anulado_ref es una autorreferencia (contratos-list.js:636), no apunta al gemelo.
  if (c.anulado_ref === p.viejo) campos.anulado_ref = p.nuevo;
  acciones.push({ ref: cRef, campos, que: `contratos/${p.doc}${campos.anulado_ref ? " (+anulado_ref)" : ""}` });

  for (const sub of ["seriales", "seriales_historial"]) {
    const snap = await cRef.collection(sub).get();
    snap.docs.forEach((d) => {
      if (d.data().contrato_id !== p.viejo) return;
      acciones.push({ ref: d.ref, campos: { contrato_id: p.nuevo }, que: `${sub}/${d.id}` });
    });
  }

  // Fichas del pool asignadas a ESTE documento (no al gemelo).
  const fichas = await db.collection("equipos_pool").where("asignacion.contrato_id", "==", p.viejo).get();
  for (const f of fichas.docs) {
    if (f.data().asignacion?.contrato_doc_id !== p.doc) continue;
    acciones.push({
      ref: f.ref,
      campos: { "asignacion.contrato_id": p.nuevo },
      que: `equipos_pool/${f.id}`,
    });
    const movs = await f.ref.collection("movimientos").get();
    movs.docs.forEach((m) => {
      const r = m.data().ref;
      if (!r || r.id !== p.doc || r.label !== p.viejo) return;
      acciones.push({ ref: m.ref, campos: { "ref.label": p.nuevo }, que: `equipos_pool/${f.id}/movimientos/${m.id}` });
    });
  }

  return acciones;
}

(async () => {
  console.log(`\n${EXECUTE ? "=== EJECUTANDO ===" : "=== DRY-RUN (usa --execute para aplicar) ==="}\n`);

  const todo = [];
  for (const p of PLAN) {
    console.log(`${p.viejo}  →  ${p.nuevo}   ${p.quien}`);
    const acciones = await planearUno(p);
    acciones.forEach((a) => console.log(`     · ${a.que}`));
    console.log(`     ${acciones.length} documento(s)\n`);
    todo.push(...acciones);
  }

  console.log(`TOTAL: ${todo.length} escrituras sobre ${PLAN.length} contratos.`);
  console.log("mail_queue NO se toca: son 4 correos ya enviados con el número viejo.\n");

  if (!EXECUTE) { console.log("Nada escrito."); return; }

  for (let i = 0; i < todo.length; i += 400) {
    const batch = db.batch();
    todo.slice(i, i + 400).forEach((a) => batch.update(a.ref, a.campos));
    await batch.commit();
    console.log(`  commit ${i + 1}-${Math.min(i + 400, todo.length)}`);
  }

  // Verificación: cada número queda en un solo documento.
  console.log("\n=== Verificación ===");
  for (const p of PLAN) {
    const s = await db.collection("contratos").where("contrato_id", "==", p.nuevo).get();
    console.log(`  ${p.nuevo}: ${s.size} contrato(s) ${s.size === 1 ? "OK" : "← REVISAR"}`);
  }
  for (const k of CONSERVAN) {
    const s = await db.collection("contratos").where("contrato_id", "==", k.num).get();
    const ok = s.size === 1 && s.docs[0].id === k.doc;
    console.log(`  ${k.num}: ${s.size} contrato(s) ${ok ? `OK (${k.quien})` : "← REVISAR"}`);
  }
})().catch((e) => { console.error("\nABORTADO:", e.message); process.exit(1); });
