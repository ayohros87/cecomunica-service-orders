/**
 * infiere-modelo-sin-ficha.js — SOLO LECTURA. Le busca modelo a las fichas del
 * pool que no lo tienen, cruzándolas contra las fuentes que SÍ lo registran.
 *
 * El backfill `migracion_poc` creó la ficha desde el device de la plataforma
 * POC, y ese device no trae modelo: quedaron 2,399 fichas con `modelo_id` y
 * `modelo_label` vacíos. Una ficha sin modelo es invisible para el inventario —
 * todas las vistas agrupan por `modeloKey`, así que cae en un cubo "(sin
 * modelo)" y nunca suma bajo su modelo real. Peor: la toma física por modelo la
 * ve `en_bodega`, la cuenta como "ya estaba" y no le escribe nada, así que el
 * hueco no se cierra solo contando.
 *
 * El mismo radio SÍ tiene modelo en las órdenes de servicio y en los seriales
 * de contrato. Este script junta esos candidatos y propone uno cuando no hay
 * ambigüedad. NO escribe: la corrección se aplica con repunta-modelo-lista.js
 * (o ingresa-bodega-lista.js si además hay conteo físico), que son las rutas
 * canónicas de escritura.
 *
 * Los candidatos por TEXTO se resuelven contra el catálogo por label
 * normalizado; el par N/R no se colapsa a propósito ("PNC380" y "PNC380-R" son
 * dos filas y el inventario las cuenta por separado), pero cuando los
 * candidatos solo difieren en eso se propone la fila que calza con la
 * `condicion` que la ficha ya tiene.
 *
 * USAGE (desde functions/):
 *   node scripts/infiere-modelo-sin-ficha.js [--estado=en_bodega] [--todos]
 *   OUT_CSV=ruta.csv para elegir la salida (default: sin-modelo-inferido.csv).
 *   OUT_DIR=ruta para escribir un .txt de seriales por modelo propuesto.
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ESTADO = (process.argv.find((a) => a.startsWith("--estado=")) || "").split("=")[1] || "en_bodega";
const TODOS  = process.argv.includes("--todos");
const OUT_CSV = process.env.OUT_CSV || "sin-modelo-inferido.csv";
const OUT_DIR = process.env.OUT_DIR || "";

function tight(s) {
  return (s || "").toString().toLowerCase()
    // eslint-disable-next-line no-control-regex -- intencional: recorta lo no-ASCII
    .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "");
}

(async () => {
  // ── Catálogo ────────────────────────────────────────────────────────────
  const modelos = new Map();          // id → {id, label, estado, cond}
  const porTight = new Map();         // label normalizado → id
  (await db.collection("modelos").get()).forEach((d) => {
    const m = d.data();
    const label = `${m.marca || ""} ${m.modelo || ""}`.trim();
    const cond = (m.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
    modelos.set(d.id, { id: d.id, label, cond, activo: m.activo !== false, modelo: m.modelo || "" });
    // Con marca y sin marca: las órdenes escriben "PNC380-R", el catálogo
    // "HYTERA PNC380-R".
    for (const k of [tight(label), tight(m.modelo)]) {
      if (k && !porTight.has(k)) porTight.set(k, d.id);
    }
  });
  console.log(`catálogo: ${modelos.size} filas`);

  // Texto suelto → fila del catálogo. Solo match exacto por label normalizado:
  // adivinar más que eso es como se reparten radios entre modelos equivocados.
  const resolverTexto = (txt) => porTight.get(tight(txt)) || null;

  // ── Fuentes con modelo ──────────────────────────────────────────────────
  const candidatos = new Map();       // serial_norm → [{modelo_id, texto, fuente}]
  const anota = (serial, modelo_id, texto, fuente) => {
    const norm = pool.normSerial(serial);
    if (!norm) return;
    const id = modelo_id || resolverTexto(texto);
    if (!id && !texto) return;
    const arr = candidatos.get(norm) || [];
    arr.push({ modelo_id: id || null, texto: (texto || "").toString().trim(), fuente });
    candidatos.set(norm, arr);
  };

  const ord = await db.collection("ordenes_de_servicio").get();
  ord.forEach((d) => {
    const o = d.data();
    if (o.eliminado === true) return;
    (o.equipos || []).forEach((e) => {
      anota(e.numero_de_serie, e.modelo_id, e.modelo, `orden ${d.id}`);
    });
  });
  console.log(`órdenes: ${ord.size}`);

  const con = await db.collection("contratos").get();
  for (const c of con.docs) {
    const ser = await c.ref.collection("seriales").get();
    ser.forEach((s) => {
      const v = s.data();
      anota(v.serial_norm || v.serial, v.modelo_id, v.modelo || v.modelo_label, `contrato ${c.id}`);
    });
  }
  console.log(`contratos: ${con.size}`);

  // ── Fichas sin modelo ───────────────────────────────────────────────────
  const fichas = [];
  (await db.collection("equipos_pool").get()).forEach((d) => {
    const v = d.data();
    if (v.modelo_id || (v.modelo_label || "").trim()) return;
    if (!TODOS && (v.estado || "") !== ESTADO) return;
    fichas.push({ id: d.id, ...v });
  });
  console.log(`fichas sin modelo${TODOS ? "" : ` en ${ESTADO}`}: ${fichas.length}\n`);

  const filas = [];
  const porPropuesta = new Map();     // modelo_id → [seriales]
  const r = { propuesta: 0, ambiguo: 0, sinPista: 0, textoNoResuelto: 0 };

  for (const f of fichas) {
    const cands = candidatos.get(f.serial_norm) || [];
    const ids = [...new Set(cands.map((c) => c.modelo_id).filter(Boolean))];
    const textos = [...new Set(cands.map((c) => c.texto).filter(Boolean))];
    const fuentes = [...new Set(cands.map((c) => c.fuente))];

    let propuesto = null, motivo = "";
    if (!cands.length) {
      motivo = "SIN PISTA — no aparece en órdenes ni contratos";
      r.sinPista++;
    } else if (!ids.length) {
      motivo = `TEXTO NO RESUELTO — "${textos.join(" | ")}" no calza con ninguna fila del catálogo`;
      r.textoNoResuelto++;
    } else if (ids.length === 1) {
      propuesto = ids[0];
      motivo = "único candidato";
      r.propuesta++;
    } else {
      // Varias filas: si son la misma familia (N/R), manda la condición que la
      // ficha ya tiene. Si son familias distintas, no se decide desde aquí.
      const familias = [...new Set(ids.map((id) => tight(modelos.get(id)?.modelo).replace(/r$/, "")))];
      if (familias.length === 1) {
        const cond = (f.condicion || "").toLowerCase();
        propuesto = ids.find((id) => modelos.get(id)?.cond === cond) || ids[0];
        motivo = `misma familia (${ids.length} filas) — se toma la de condicion "${modelos.get(propuesto)?.cond}"`;
        r.propuesta++;
      } else {
        motivo = `AMBIGUO — familias distintas: ${ids.map((id) => modelos.get(id)?.label || id).join(" | ")}`;
        r.ambiguo++;
      }
    }

    if (propuesto) {
      const lista = porPropuesta.get(propuesto) || [];
      lista.push(f.serial_norm);
      porPropuesta.set(propuesto, lista);
    }

    filas.push({
      serial: f.serial_norm, doc_id: f.id, estado: f.estado || "", condicion: f.condicion || "",
      propiedad: f.propiedad || "", poc_device_id: f.poc_device_id || "",
      propuesto_id: propuesto || "", propuesto_label: propuesto ? modelos.get(propuesto)?.label : "",
      propuesto_cond: propuesto ? modelos.get(propuesto)?.cond : "",
      motivo, textos: textos.join(" | "), fuentes: fuentes.slice(0, 4).join(" ; "),
    });
  }

  const cols = ["serial", "doc_id", "estado", "condicion", "propiedad", "propuesto_label",
    "propuesto_id", "propuesto_cond", "motivo", "textos", "fuentes", "poc_device_id"];
  fs.writeFileSync(OUT_CSV, [cols.join(",")].concat(filas.map((x) =>
    cols.map((c) => `"${String(x[c] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n"), "utf8");

  console.log("=== propuestas por modelo ===");
  [...porPropuesta.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([id, ss]) => {
      const m = modelos.get(id);
      console.log(`${String(ss.length).padStart(4)}  ${m?.label || id} (${id}) · ${m?.cond}${m?.activo ? "" : " [INACTIVO]"}`);
      if (OUT_DIR) {
        const nombre = `sinmodelo-${tight(m?.label || id)}.txt`;
        fs.writeFileSync(path.join(OUT_DIR, nombre), ss.join("\n") + "\n", "utf8");
        console.log(`      → ${nombre}`);
      }
    });

  console.log(`\n=== ${fichas.length} fichas ===`);
  console.log(`con propuesta:      ${r.propuesta}`);
  console.log(`ambiguas:           ${r.ambiguo}`);
  console.log(`texto no resuelto:  ${r.textoNoResuelto}`);
  console.log(`sin pista alguna:   ${r.sinPista}`);
  filas.filter((x) => !x.propuesto_id).forEach((x) =>
    console.log(`  ${x.serial}  ${x.motivo}`));
  console.log(`\nCSV: ${OUT_CSV}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
