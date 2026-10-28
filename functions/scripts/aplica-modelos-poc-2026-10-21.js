/**
 * aplica-modelos-poc-2026-10-21.js — Pone el modelo a los radios del PoC que no
 * lo tienen, con la revisión de Brenda (Excel "modelos-poc 21-10-2026.xlsx",
 * propuesta original del 2026-10-06).
 *
 * Se aplica SOLO lo que tiene evidencia:
 *   · pestaña "Automáticos" completa (modelo de la ficha del pool o de órdenes);
 *   · pestaña "Por revisar": filas visibles en verde, nivel A (orden + prefijo)
 *     o con "Evidencia encontrada" escrita. Las filas que solo tienen el prefijo
 *     del serial y un "Sí" sin evidencia quedan fuera hasta que Brenda aclare.
 *
 * Candados (se vuelve a leer producción, no se confía en el Excel):
 *   · device borrado o inactivo → no se toca;
 *   · device que ya tiene modelo → no se pisa (se reporta si es otro);
 *   · serial del device distinto al del Excel → no se toca;
 *   · ficha del pool con OTRO modelo de familia distinta → no se toca nada.
 * La ficha del pool solo se rellena si está sin modelo (condición según el
 * catálogo, igual que repunta-modelo-lista.js). Cada cambio deja poc_log y
 * movimiento en el kardex.
 *
 * USAGE (desde functions/):
 *   node scripts/aplica-modelos-poc-2026-10-21.js <xlsx> [--write] [--email=..] [--prefijo]
 *
 * --prefijo (Alberto 2026-10-28): carga también las filas de "Por revisar" que
 * solo tienen el prefijo del serial, con el "Modelo correcto" de Brenda. Es una
 * sugerencia, no prueba: el device queda con modelo_por_prefijo: true para que
 * el taller lo confirme cuando pase, y la ficha del pool NO se rellena.
 * Idempotente.
 */
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const XLSX  = process.argv[2];
const WRITE = process.argv.includes("--write");
const EMAIL = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:aplica-modelos-poc-2026-10-21";
const PREFIJO = process.argv.includes("--prefijo");
const MOTIVO = "Modelo recuperado (revisión de Brenda 2026-10-21 sobre la propuesta del 2026-10-06)";
// --extra=SERIAL:evidencia,SERIAL:evidencia → filas de "Por revisar" que Brenda
// confirmó después por correo (sin marcarlas en el Excel). Se aplica el
// "Modelo correcto" de la fila.
const EXTRA = new Map((process.argv.find((a) => a.startsWith("--extra=")) || "")
  .split("=").slice(1).join("=").split(",").filter(Boolean)
  .map((x) => { const [s, ...ev] = x.split(":"); return [s.trim().toUpperCase(), ev.join(":").trim() || "confirmado por correo"]; }));

const txt = (c) => {
  const x = c.value;
  if (x == null) return "";
  if (typeof x === "object") {
    if (x.richText) return x.richText.map((t) => t.text).join("").trim();
    if ("result" in x) return String(x.result ?? "").trim();
    if (x.text) return String(x.text).trim();
  }
  return String(x).trim();
};
const verde = (row) => [1, 2, 3, 4, 5].some((i) => row.getCell(i).fill?.fgColor?.theme === 6);

async function leerExcel() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  const catalogo = new Map();   // label → modelo_id
  wb.getWorksheet("Catálogo").eachRow((r, i) => { if (i > 1) catalogo.set(txt(r.getCell(1)), txt(r.getCell(3))); });

  const filas = [];
  wb.getWorksheet("Automáticos").eachRow((r, i) => {
    if (i === 1) return;
    filas.push({ hoja: "Automáticos", fila: i, cliente: txt(r.getCell(1)), serial: txt(r.getCell(4)),
      label: txt(r.getCell(5)), modelo_id: txt(r.getCell(11)), device: txt(r.getCell(12)),
      ficha: txt(r.getCell(13)), base: txt(r.getCell(6)) });
  });
  const fuera = { ocultas: 0, sinEvidencia: 0 };
  wb.getWorksheet("Por revisar").eachRow((r, i) => {
    if (i === 1) return;
    if (r.hidden) { fuera.ocultas++; return; }
    const nivel = txt(r.getCell(1)).slice(0, 1), ev = txt(r.getCell(11)), mc = txt(r.getCell(10));
    const g = verde(r);
    const extra = EXTRA.get(txt(r.getCell(5)).toUpperCase());
    const porPrefijo = !(g || nivel === "A" || ev || extra);
    if (porPrefijo && !(PREFIJO && nivel === "B" && mc)) { fuera.sinEvidencia++; return; }
    filas.push({ hoja: "Por revisar", fila: i, cliente: txt(r.getCell(2)), serial: txt(r.getCell(5)),
      label: mc, modelo_id: catalogo.get(mc) || "", device: txt(r.getCell(15)), ficha: txt(r.getCell(16)),
      porPrefijo,
      base: g ? `verde (${ev || "sin nota"})` : nivel === "A" ? "orden + prefijo"
        : porPrefijo ? "solo prefijo del serial (sin verificar)" : ev || extra });
  });
  return { filas, fuera };
}

(async () => {
  if (!XLSX) throw new Error("USAGE: <xlsx> [--write]");
  const { filas, fuera } = await leerExcel();
  console.log(WRITE ? "*** ESCRIBIENDO ***" : "*** DRY-RUN — no se escribe nada ***");
  console.log(`Filas a aplicar: ${filas.length} (Automáticos ${filas.filter((f) => f.hoja === "Automáticos").length}, Por revisar ${filas.filter((f) => f.hoja === "Por revisar").length})`);
  console.log(`Fuera: ${fuera.ocultas} ocultas (consolas/apps), ${fuera.sinEvidencia} solo prefijo sin evidencia\n`);

  // Catálogo vivo.
  const ids = [...new Set(filas.map((f) => f.modelo_id).filter(Boolean))];
  const modelos = new Map();
  for (const s of await db.getAll(...ids.map((id) => db.collection("modelos").doc(id)))) {
    if (s.exists) {
      const m = s.data();
      modelos.set(s.id, { label: `${m.marca || ""} ${m.modelo || ""}`.trim(),
        cond: (m.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo" });
    }
  }

  const r = { device: 0, ficha: 0, yaIgual: 0 };
  const salto = {};
  const anota = (k, f, extra = "") => { (salto[k] = salto[k] || []).push(`${f.hoja} fila ${f.fila} · ${f.cliente} · ${f.serial} ${extra}`); };
  const bitacora = [];

  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200);
    const snaps = await db.getAll(...lote.map((f) => db.collection("poc_devices").doc(f.device || "_")));
    for (let k = 0; k < lote.length; k++) {
      const f = lote[k], s = snaps[k];
      const m = modelos.get(f.modelo_id);
      if (!m) { anota("modelo no existe en el catálogo", f, `"${f.label}" ${f.modelo_id}`); continue; }
      if (!s.exists) { anota("device no existe", f); continue; }
      const d = s.data();
      if (d.deleted === true) { anota("device borrado", f); continue; }
      if (d.activo === false) { anota("device inactivo (baja)", f); continue; }
      if (pool.normSerial(d.serial) !== pool.normSerial(f.serial)) { anota("serial del device cambió", f, `→ ${d.serial}`); continue; }
      const actualId = d.modelo_id || "";
      if (actualId === f.modelo_id) { r.yaIgual++; continue; }
      if (actualId || (d.modelo_label || "").trim()) {
        anota("device ya tiene modelo", f, `"${d.modelo_label || actualId}" vs propuesto "${m.label}"`); continue;
      }

      // Ficha del pool.
      let fichaRef = null, ficha = null;
      if (f.ficha) {
        const fs_ = await db.collection("equipos_pool").doc(f.ficha).get();
        if (fs_.exists) { fichaRef = fs_.ref; ficha = fs_.data(); }
      }
      if (!ficha) {
        const q = await db.collection("equipos_pool").where("serial_norm", "==", pool.normSerial(f.serial)).get();
        if (q.size === 1) { fichaRef = q.docs[0].ref; ficha = q.docs[0].data(); }
        else if (q.size > 1) { anota("serial con varias fichas", f); continue; }
      }
      let tocaFicha = false;
      if (ficha && ficha.modelo_id && ficha.modelo_id !== f.modelo_id) {
        if (!pool.mismoModelo(ficha, f.modelo_id, m.label)) {
          anota("ficha dice otra familia", f, `ficha "${ficha.modelo_label}" vs propuesto "${m.label}"`); continue;
        }
      } else if (ficha && !ficha.modelo_id && !f.porPrefijo) tocaFicha = true;

      bitacora.push({ hoja: f.hoja, fila: f.fila, cliente: f.cliente, serial: f.serial,
        device: s.id, ficha: fichaRef?.id || "", modelo: m.label, modelo_id: f.modelo_id, base: f.base,
        ficha_rellenada: tocaFicha });
      r.device++; if (tocaFicha) r.ficha++;

      if (WRITE) {
        const ts = admin.firestore.FieldValue.serverTimestamp();
        await s.ref.update({ modelo_id: f.modelo_id, modelo_label: m.label,
          ...(f.porPrefijo ? { modelo_por_prefijo: true } : {}),
          updated_at: ts, updated_by: null, updated_by_email: EMAIL });
        await db.collection("poc_logs").add({ equipo_id: s.id, fecha: ts, usuario: EMAIL,
          accion: "correccion_modelo", motivo: `${MOTIVO} — ${f.base}`,
          cambios: { antes: { modelo_id: null, modelo_label: d.modelo_label || "" },
            despues: { modelo_id: f.modelo_id, modelo_label: m.label } } });
        if (tocaFicha) {
          await fichaRef.set({ modelo_id: f.modelo_id, modelo_label: m.label, condicion: m.cond,
            updated_at: ts, updated_by_email: EMAIL }, { merge: true });
          await fichaRef.collection("movimientos").doc().set({ at: ts, por: "system", por_email: EMAIL,
            tipo: "correccion_modelo", de_estado: ficha.estado || null, a_estado: ficha.estado || null, ref: null,
            notas: `Modelo puesto: ${m.label} (${m.cond}). Antes: sin modelo. ${MOTIVO} — ${f.base}` });
        }
      }
    }
    process.stdout.write(`  ${Math.min(i + 200, filas.length)}/${filas.length}\r`);
  }

  console.log(`\n\n=== RESULTADO ${WRITE ? "(escrito)" : "(dry-run)"} ===`);
  console.log(`devices con modelo nuevo: ${r.device}`);
  console.log(`  …y ficha del pool rellenada: ${r.ficha}`);
  console.log(`ya tenían ese mismo modelo:  ${r.yaIgual}`);
  for (const [k, l] of Object.entries(salto)) {
    console.log(`\nSALTADAS — ${k}: ${l.length}`);
    l.slice(0, 40).forEach((x) => console.log("   " + x));
    if (l.length > 40) console.log(`   … y ${l.length - 40} más`);
  }
  const dir = path.join(__dirname, "..", "..", "local-data", "modelos-poc-2026-10-21");
  fs.mkdirSync(dir, { recursive: true });
  // Un archivo por corrida: una segunda pasada no pisa la bitácora de la primera.
  const sello = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.join(dir, `${WRITE ? "bitacora-escrito" : "bitacora-dryrun"}-${sello}.json`);
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), resultado: r, saltadas: salto, cambios: bitacora }, null, 1));
  console.log(`\nBitácora: ${out}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
