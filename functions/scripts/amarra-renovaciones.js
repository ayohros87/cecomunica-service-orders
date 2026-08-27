/**
 * amarra-renovaciones.js — Amarra el linaje de renovaciones y REEMP sueltos
 * (deep-dive 2026-08-26): contratos que SON renovación/reemplazo de uno viejo
 * pero quedaron sin `contrato_origen_ids`, así que el viejo aparece "vencido
 * sin renovar" y el REEMP no puede heredar vigencia.
 *
 * DOS grupos:
 *  1. accion="Renovación" vigente sin origen → candidato: contrato del MISMO
 *     cliente y MISMO tipo, vigente, creado antes, aún no renovado.
 *  2. REEMP vigente sin origen → candidato: contrato ALQ/PROP del mismo
 *     cliente, vigente, creado antes.
 *
 * Solo amarra los casos AUTO (exactamente UN candidato). Los ambiguos y los
 * sin candidato se listan para decisión manual — un amarre equivocado
 * suprimiría la señal de renovación del contrato equivocado.
 *
 * QUÉ TOCA (solo con --write): en el contrato NUEVO estampa
 * contrato_origen_ids/contrato_origen_id + marker linaje_amarrado. El
 * back-pointer renovado_por_ids del viejo lo escribe onLinajeWrite (trigger
 * vivo). NO toca entrega_confirmada (onEntregaTransicion solo corre en ese
 * flanco, así que este amarre NO dispara devoluciones retroactivas).
 *
 * USAGE (desde functions/):
 *   node scripts/amarra-renovaciones.js            # dry-run
 *   node scripts/amarra-renovaciones.js --write
 * Idempotente: un contrato con origen se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const V = require("../src/lib/vigencia");

const dryRun = !process.argv.includes("--write");
const AUTOR = "script:amarra-renovaciones";
const iso = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "—"; };
const ms = (t) => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0));
const vigente = (c) => ["activo", "aprobado"].includes(c.estado);
const origenIds = (c) => Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length
  ? c.contrato_origen_ids : (c.contrato_origen_id ? [c.contrato_origen_id] : []);

// El contrato NO está suelto: el vendedor ya respondió que el original es de
// papel y no está en el sistema. Buscarle un origen interno es contradecir la
// respuesta que el formulario le exigió — y con consecuencias, porque
// onEntregaTransicion lee ese vínculo para pedirle equipos al cliente.
//
// REEMP20260825-01 (SEGURIDAD IDEAL) es el caso: declaró papel
// (ALQ2024-10-30-01), este script lo amarró a ALQ20260206-01 —la adición de
// febrero, único candidato— y al confirmarse la entrega el 2026-08-27 se abrió
// la orden 2026082705 reclamando dos radios ajenos al reemplazo.
const declaraPapel = (c) => c.origen_tipo === "legacy" || !!String(c.origen_legacy_ref || "").trim();

(async () => {
  const snap = await db.collection("contratos").get();
  const todos = [];
  snap.forEach((d) => { const c = d.data(); if (!c.deleted) todos.push({ id: d.id, ref: d.ref, ...c }); });
  const porCliente = new Map();
  for (const c of todos) {
    if (!c.cliente_id) continue;
    if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
    porCliente.get(c.cliente_id).push(c);
  }

  const candidatosDe = (n, tiposOrigen) => (porCliente.get(n.cliente_id) || []).filter((v) =>
    v.id !== n.id
    && tiposOrigen.includes(V.codigoTipo(v))
    && vigente(v)
    && ms(v.fecha_creacion) < ms(n.fecha_creacion)
    && !(Array.isArray(v.renovado_por_ids) && v.renovado_por_ids.length))
    .sort((a, b) => ms(b.fecha_creacion) - ms(a.fecha_creacion));

  const grupos = [
    {
      nombre: "Renovaciones sueltas",
      sueltos: todos.filter((c) => c.accion === "Renovación" && !origenIds(c).length && vigente(c) && V.codigoTipo(c) !== "REEMP" && !declaraPapel(c)),
      tiposOrigen: (n) => [V.codigoTipo(n)],
    },
    {
      nombre: "REEMP sin origen",
      sueltos: todos.filter((c) => V.codigoTipo(c) === "REEMP" && !origenIds(c).length && vigente(c) && !declaraPapel(c)),
      tiposOrigen: () => ["ALQ", "PROP"],
    },
  ];

  console.log(`\n=== amarra-renovaciones ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);
  const papel = todos.filter((c) => vigente(c) && !origenIds(c).length && declaraPapel(c)
    && (c.accion === "Renovación" || V.codigoTipo(c) === "REEMP"));
  if (papel.length) {
    console.log(`\n── Omitidos por declarar contrato de papel: ${papel.length} ──`);
    papel.forEach((c) => console.log(`  [PAPEL]    ${c.contrato_id}  ${iso(c.fecha_creacion)}  (${c.cliente_nombre || "?"})  ref: ${c.origen_legacy_ref || "—"}`));
  }
  const aAmarrar = [];
  for (const g of grupos) {
    let auto = 0, ambiguas = 0, sin = 0;
    console.log(`\n── ${g.nombre}: ${g.sueltos.length} ──`);
    for (const n of g.sueltos) {
      const cands = candidatosDe(n, g.tiposOrigen(n));
      if (cands.length === 1) {
        auto++;
        aAmarrar.push({ nuevo: n, viejo: cands[0], grupo: g.nombre });
        console.log(`  [AUTO]     ${n.contrato_id}  →  ${cands[0].contrato_id}  (${n.cliente_nombre || "?"})`);
      } else if (cands.length > 1) {
        ambiguas++;
        console.log(`  [AMBIGUA]  ${n.contrato_id}  (${n.cliente_nombre || "?"}): ${cands.slice(0, 4).map(c => c.contrato_id).join(", ")}${cands.length > 4 ? "…" : ""}`);
      } else {
        sin++;
      }
    }
    console.log(`  Resumen: auto=${auto}  ambiguas=${ambiguas}  sin candidato=${sin}`);
  }

  if (dryRun) { console.log(`\nDry-run: ${aAmarrar.length} amarres AUTO listos. --write para aplicar.`); process.exit(0); }

  let escritos = 0;
  for (const a of aAmarrar) {
    await a.nuevo.ref.update({
      contrato_origen_ids: admin.firestore.FieldValue.arrayUnion(a.viejo.id),
      ...(a.nuevo.contrato_origen_id ? {} : { contrato_origen_id: a.viejo.id }),
      linaje_amarrado: {
        por: AUTOR,
        at: admin.firestore.FieldValue.serverTimestamp(),
        origen_contrato_id: a.viejo.contrato_id || a.viejo.id,
        criterio: a.grupo,
      },
    });
    escritos++;
    console.log(`  ✓ ${a.nuevo.contrato_id} → ${a.viejo.contrato_id}`);
  }
  console.log(`\nListo: ${escritos} amarres aplicados (el back-pointer lo estampa onLinajeWrite).`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
