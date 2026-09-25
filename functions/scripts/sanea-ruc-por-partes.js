/**
 * sanea-ruc-por-partes.js — deja derechos los RUC que se pueden demostrar.
 *
 * Contexto (2026-09-25): el RUC se captura por partes y el DV se verifica
 * contra la DGI (public/js/domain/rucPanama.js). El barrido de producción
 * encontró RUC viejos que la casilla libre dejó torcidos. Este script arregla
 * SOLO lo que se puede probar, sin adivinar:
 *   · DV pegado dentro del RUC ("8-496-731:84", "3-87-2598 DV 53") → el RUC
 *     queda limpio y el DV pasa a su casilla. Es mecánico: el número ya estaba
 *     escrito. Si la ficha YA tenía otro DV distinto al pegado, no se toca.
 *   · NT perdido (8-1-12607 → 8-NT-1-12607): solo cuando es la ÚNICA lectura
 *     vecina con la que cuadra el DV guardado (sugerirCorreccion; nunca con DV
 *     00, que es relleno).
 *   · Guiones mal puestos con los dígitos completos (15575157922024 →
 *     155751579-2-2024): solo si UN corte con forma de RUC moderno hace
 *     cuadrar el DV guardado (ver reacomodar()).
 *   · DV de un dígito que cuadra → dos dígitos ("5" → "05").
 *   · Minúsculas y espacios (e-8-150107 → E-8-150107).
 *   · ruc_tipo, solo cuando el DV lo demuestra (cuadra con esa lectura).
 * Lo que NO toca, y lista para revisar contra el documento del cliente:
 *   · RUC sin ningún formato de la DGI (solo dígitos, partes de más).
 *   · DV que no cuadra y no tiene lectura vecina que lo explique.
 *
 * Los CONTRATOS ya emitidos no se tocan: son la prueba de lo que se firmó.
 * Cada cambio queda en el historial de la ficha (trigger onClienteHistorial),
 * sin autor: no lo editó una persona.
 *
 * USAGE (desde functions/):
 *   node scripts/sanea-ruc-por-partes.js             ensayo (no escribe)
 *   node scripts/sanea-ruc-por-partes.js --aplicar   escribe
 *   node scripts/sanea-ruc-por-partes.js --csv <ruta>  además vuelca la lista de revisión
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const R = require("../../public/js/domain/rucPanama.js");

const aplicar = process.argv.includes("--aplicar");
const iCsv = process.argv.indexOf("--csv");
const csv = iCsv > 0 ? process.argv[iCsv + 1] : null;

// Mismas fórmulas que ClientesService.buildClientePayload / buildSearchTokens.
const rucNorm = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const dig = (s) => String(s || "").replace(/\D/g, "");

// Un RUC sin formato con los dígitos completos y los guiones mal puestos
// ("15575157922024", "1560934-1659006", "8-NT-2764681"). Se prueban los cortes
// con la forma de un RUC moderno — sociedad ficha-1-imagen o folio-2-año, o
// provincia-NT-tomo-asiento — y se acepta SOLO si exactamente uno hace cuadrar
// el DV guardado (nunca con DV 0/00, que es relleno). Si no, a revisión.
function reacomodar(ruc, dv) {
  if (!dv || /^0+$/.test(dv)) return null;
  const meta = dv.padStart(2, "0");
  const s = String(ruc).toUpperCase().replace(/\s+/g, "");
  const hits = [];
  if (/NT/.test(s)) {
    const d = s.replace("NT", "").replace(/-/g, "");
    if (!/^\d+$/.test(d)) return null;
    for (let i = 1; i <= 2; i++) for (let j = i + 1; j < d.length; j++) for (const tipo of ["juridica", "natural"]) {
      const p = { tipo, letra: "NT", provincia: d.slice(0, i), tomo: d.slice(i, j), asiento: d.slice(j) };
      if (!R.problemaPartes(p) && R.calcularDV(p) === meta) hits.push(p);
    }
  } else {
    const d = s.replace(/-/g, "");
    if (!/^\d+$/.test(d)) return null;
    for (let i = 1; i < d.length - 1; i++) {
      const mid = d[i];
      if (mid !== "1" && mid !== "2") continue;
      const p = { tipo: "juridica", letra: "", p1: d.slice(0, i), p2: mid, p3: d.slice(i + 1) };
      if (mid === "2" && !/^(19|20)\d\d$/.test(p.p3)) continue;
      if (!R.problemaPartes(p) && R.calcularDV(p) === meta) hits.push(p);
    }
  }
  return hits.length === 1 ? hits[0] : null;
}

(async () => {
  const snap = await db.collection("clientes").get();
  const plan = [], revisar = [], choques = [];
  const porNorm = new Map();
  snap.forEach((d) => {
    const c = d.data();
    if (c.deleted === true) return;
    if (c.ruc_norm) porNorm.set(c.ruc_norm, [...(porNorm.get(c.ruc_norm) || []), d.id]);
  });

  snap.forEach((d) => {
    const c = d.data();
    if (c.deleted === true) return;
    const ruc = String(c.ruc || "").trim();
    if (!ruc) return;
    const dvG = dig(c.dv);
    let p = R.descomponer(ruc, { tipo: c.ruc_tipo || "", dv: dvG });
    const fila = { id: d.id, nombre: c.nombre || "", ruc, dv: c.dv || "" };
    if (p.vacio) return;
    let reacomodo = null;
    if (p.tipo === "otro") {
      reacomodo = reacomodar(p.texto, dvG || p.dvPegado);
      if (reacomodo) reacomodo.dvPegado = p.dvPegado;
      if (!reacomodo) { revisar.push({ ...fila, motivo: "sin formato de la DGI" }); return; }
      p = reacomodo;
    }
    if (R.problemaPartes(p)) { revisar.push({ ...fila, motivo: "partes fuera de límite: " + R.problemaPartes(p) }); return; }
    if (p.dvPegado && dvG && p.dvPegado.padStart(2, "0") !== dvG.padStart(2, "0")) {
      revisar.push({ ...fila, motivo: `DV pegado (${p.dvPegado}) distinto al de la casilla (${dvG})` }); return;
    }
    let dv = dvG || p.dvPegado || "";
    const motivos = [];
    if (p.dvPegado && !dvG) motivos.push("DV pegado al RUC");
    if (reacomodo) motivos.push("guiones reacomodados (los confirma el DV)");
    const sug = R.sugerirCorreccion(p, dv);
    if (sug) { p = { ...sug.partes }; motivos.push(sug.motivo); }
    const nuevo = R.componer(p);
    const v = R.verificarDV(p, dv);
    const tipoProbado = v.estado === "ok" ? p.tipo : "";
    // El DV de la DGI son dos dígitos: "5" que cuadra es "05".
    if (v.estado === "ok" && dv.length === 1) { dv = v.esperado; motivos.push("DV a dos dígitos"); }
    if (nuevo !== ruc && !motivos.length) motivos.push("formato (mayúsculas/espacios)");
    const cambiaRuc = nuevo !== c.ruc || dv !== String(c.dv || "");
    const cambiaTipo = tipoProbado && tipoProbado !== c.ruc_tipo;
    if (v.estado === "no_cuadra") revisar.push({ ...fila, motivo: `DV no cuadra (la DGI da ${v.esperado})${cambiaRuc ? " — igual se separa el DV" : ""}` });
    if (!cambiaRuc && !cambiaTipo) return;

    const ruc_norm = rucNorm(nuevo);
    const dv_norm = dig(dv);
    const rucdv_norm = ruc_norm + (dv_norm ? "-" + dv_norm : "");
    const otros = (porNorm.get(ruc_norm) || []).filter((x) => x !== d.id);
    if (otros.length) choques.push({ ...fila, nuevo, otros });
    const upd = { ruc: nuevo, dv, ruc_norm, dv_norm, rucdv_norm };
    if (tipoProbado) upd.ruc_tipo = tipoProbado;
    const toks = [dig(nuevo), ruc_norm.toLowerCase(), rucdv_norm.toLowerCase(), dig(rucdv_norm)].filter(Boolean);
    plan.push({ ...fila, upd, toks, motivos: motivos.length ? motivos : ["ruc_tipo demostrado por el DV"], dvEstado: v.estado });
  });

  const soloTipo = plan.filter((p) => p.upd.ruc === p.ruc && p.upd.dv === String(p.dv));
  const conCambio = plan.filter((p) => !soloTipo.includes(p));
  console.log(`clientes vivos con RUC revisados · a enderezar: ${conCambio.length} · solo ruc_tipo: ${soloTipo.length}${aplicar ? "" : "  (ENSAYO — no se escribe nada)"}\n`);
  const cuenta = {};
  conCambio.forEach((p) => p.motivos.forEach((m) => { cuenta[m] = (cuenta[m] || 0) + 1; }));
  console.log("por motivo:", cuenta, "\n");
  conCambio.forEach((p) => console.log(`  ${p.nombre.slice(0, 40).padEnd(40)}  ${JSON.stringify(p.ruc)} dv ${JSON.stringify(p.dv)}  →  ${p.upd.ruc} DV ${p.upd.dv || "—"}  [${p.motivos.join(", ")}; DV ${p.dvEstado}]`));
  if (choques.length) {
    console.log(`\nOJO — ${choques.length} quedan con el mismo ruc_norm que otra ficha viva:`);
    choques.forEach((x) => console.log(`  ${x.nombre.slice(0, 40)}  ${x.nuevo}  ↔  ${x.otros.join(", ")}`));
  }
  console.log(`\npara revisar contra el documento (no se tocan): ${revisar.length}`);
  revisar.forEach((x) => console.log(`  ${x.nombre.slice(0, 40).padEnd(40)}  ${JSON.stringify(x.ruc)} dv ${JSON.stringify(x.dv)}  — ${x.motivo}`));
  if (csv) {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    require("fs").writeFileSync(csv, "﻿cliente;ruc guardado;dv guardado;por qué revisar;id\n" +
      revisar.map((x) => [x.nombre, x.ruc, x.dv, x.motivo, x.id].map(q).join(";")).join("\n"));
    console.log(`\nlista de revisión → ${csv}`);
  }
  if (!plan.length || !aplicar) { process.exit(0); }

  // Respaldo de lo que había, para revertir si hace falta (la corrida del
  // 2026-09-25 se respaldó aparte: local-data/respaldo-sanea-ruc-2026-09-25.json).
  const bak = `respaldo-sanea-ruc-${Date.now()}.json`;
  require("fs").writeFileSync(require("path").join(__dirname, "..", "..", "local-data", bak),
    JSON.stringify(plan.map((p) => ({ id: p.id, antes: { ruc: p.ruc, dv: p.dv }, despues: p.upd })), null, 1));
  console.log(`\nrespaldo → local-data/${bak}`);
  console.log("escribiendo…");
  for (const p of plan) {
    await db.collection("clientes").doc(p.id).update({
      ...p.upd,
      searchTokens: admin.firestore.FieldValue.arrayUnion(...p.toks),
    });
  }
  console.log(`listo: ${plan.length} fichas.`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e.message); process.exit(1); });
