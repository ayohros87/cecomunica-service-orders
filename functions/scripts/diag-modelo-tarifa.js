/**
 * diag-modelo-tarifa.js — SOLO LECTURA. Unidades del pool CON contrato cuyo
 * modelo no parea en exacto con ninguna línea de equipos[] de su contrato
 * (la tarifa/vencimiento por equipo salía en blanco — caso Feduro 2026-08-27).
 *
 * Agrupa por par (modelo del pool ↔ modelo de la línea) y resuelve ambos
 * contra el catálogo `modelos` para ver cuál referencia es la canónica.
 * -R vs base se marca aparte: esos NO se fusionan (buckets de inventario).
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const esR = (s) => /R$/.test(norm(s)) && !/R$/.test(norm(String(s).replace(/-?R$/i, "")));

(async () => {
  const [poolSnap, conSnap, modSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
    db.collection("modelos").get(),
  ]);
  const contratos = new Map();
  conSnap.forEach((d) => contratos.set(d.id, d.data()));
  const catalogo = new Map();
  modSnap.forEach((d) => catalogo.set(d.id, { id: d.id, ...d.data() }));
  const catInfo = (id) => {
    const m = id ? catalogo.get(id) : null;
    return m ? `${(m.marca || "").trim()} ${(m.modelo || "").trim()}`.trim() + (m.activo === false ? " [INACTIVO]" : "") : (id ? "[ID NO EXISTE EN CATALOGO]" : "[sin id]");
  };

  const pares = new Map(); // clave par → {n, ejemplos, contratosSet}
  let conContrato = 0, exactos = 0, tolerantes = 0, sinLinea = 0;
  poolSnap.forEach((d) => {
    const u = d.data();
    const cid = u.asignacion?.contrato_doc_id;
    if (!cid) return;
    const c = contratos.get(cid);
    if (!c || c.deleted) return;
    conContrato++;
    const lineas = c.equipos || [];
    const exacta = lineas.find((l) =>
      (l.modelo_id && u.modelo_id && l.modelo_id === u.modelo_id) ||
      (norm(l.modelo) && norm(l.modelo) === norm(u.modelo_label)));
    if (exacta) { exactos++; return; }
    const tol = lineas.find((l) => {
      const a = norm(l.modelo), b = norm(u.modelo_label);
      return a && b && (a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a));
    });
    const linea = tol || null;
    if (linea) tolerantes++; else { sinLinea++; }
    const clave = `POOL[${u.modelo_label || "?"} · ${u.modelo_id || "sin-id"}] ↔ LINEA[${linea ? `${linea.modelo || "?"} · ${linea.modelo_id || "sin-id"}` : "NINGUNA"}]`;
    if (!pares.has(clave)) pares.set(clave, { n: 0, ejemplos: [], contratos: new Set(), poolId: u.modelo_id, lineaId: linea?.modelo_id, poolLabel: u.modelo_label, lineaLabel: linea?.modelo, refCase: linea ? (esR(u.modelo_label) !== esR(linea.modelo)) : false });
    const p = pares.get(clave);
    p.n++;
    if (p.ejemplos.length < 3) p.ejemplos.push(`${u.serial} (${c.contrato_id})`);
    p.contratos.add(c.contrato_id || cid);
  });

  console.log(`Unidades con contrato: ${conContrato} · match exacto: ${exactos} · SOLO tolerante: ${tolerantes} · SIN línea ni tolerante: ${sinLinea}\n`);
  const orden = [...pares.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [clave, p] of orden) {
    console.log(`× ${p.n}  ${clave}${p.refCase ? "   ⚠ -R↔base (NO fusionar modelo)" : ""}`);
    console.log(`     catálogo pool:  ${catInfo(p.poolId)}`);
    console.log(`     catálogo línea: ${catInfo(p.lineaId)}`);
    console.log(`     ej: ${p.ejemplos.join(", ")} · contratos: ${[...p.contratos].slice(0, 4).join(", ")}${p.contratos.size > 4 ? "…" : ""}`);
  }
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
