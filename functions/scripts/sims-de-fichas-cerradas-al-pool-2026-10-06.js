/**
 * SIMs de fichas de POC ya cerradas que nunca entraron al pool (2026-10-06).
 *
 *   Hasta dc11930 el cierre de una ficha (lib/pocCierre) solo devolvía al pool
 *   los SIMs que ya existían en `sim_cards`; los tecleados directo en la ficha
 *   se quedaban fuera, y recepción tenía que buscarlos a mano para reusarlos
 *   (Brenda: GANDER → GOLY). Este script da de alta como `disponible` esos
 *   SIMs, con el mismo criterio que el cierre nuevo:
 *     · solo si el pool no tiene el SIM (ni disponible ni asignado);
 *     · solo si NINGUNA ficha viva lo tiene tecleado (ya está en otro radio);
 *     · ICCID de 10 a 22 dígitos;
 *     · un SIM repetido en varias fichas cerradas se toma de la más reciente.
 *
 *   Grupos (por el motivo del cierre):
 *     devolucion — la orden de DEVOLUCIÓN recibió el radio, o recepción la
 *                  cerró a mano. Es el caso de Brenda.
 *     limpieza   — limpieza masiva del 2026-09-09 (radio en bodega/taller).
 *     duplicado  — ficha vieja de un serial con ficha más reciente: el radio
 *                  sigue con el cliente; NUNCA se libera aquí.
 *
 *   Uso:  node scripts/sims-de-fichas-cerradas-al-pool-2026-10-06.js [--grupos=devolucion,limpieza] [--apply]
 *   Sin --apply solo cuenta. Default de grupos: devolucion.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APPLY = process.argv.includes("--apply");
const GRUPOS = new Set(((process.argv.find(a => a.startsWith("--grupos=")) || "--grupos=devolucion").split("=")[1]).split(","));
const dig = (s) => String(s ?? "").replace(/\D/g, "");
const SIM_VALIDO = /^\d{10,22}$/;
const USUARIO = "script:sims-de-fichas-cerradas-al-pool-2026-10-06";

function grupoDe(c) {
  const m = String(c.motivo || "");
  if (/^Duplicado por serial/i.test(m)) return "duplicado";
  if (/^Limpieza 2026-09-09/i.test(m)) return "limpieza";
  return "devolucion";
}

(async () => {
  const pool = new Set((await db.collection("sim_cards").get()).docs.map(d => d.id));
  const fichas = await db.collection("poc_devices").get();
  const vivos = new Set();
  fichas.forEach(d => { const x = d.data(); if (x.deleted !== true && dig(x.sim_number)) vivos.add(dig(x.sim_number)); });

  const porSim = new Map();   // sim -> { ficha, cierre, ms, grupo }
  const conteo = { devolucion: 0, limpieza: 0, duplicado: 0 };
  fichas.forEach(d => {
    const x = d.data();
    if (x.deleted !== true || !x.cierre) return;
    const sim = dig(x.cierre.sim_number);
    if (!SIM_VALIDO.test(sim) || pool.has(sim) || vivos.has(sim)) return;
    const grupo = grupoDe(x.cierre);
    const ms = x.cierre.at?.toMillis ? x.cierre.at.toMillis() : 0;
    const prev = porSim.get(sim);
    if (!prev || ms > prev.ms) porSim.set(sim, { id: d.id, x, ms, grupo });
  });
  porSim.forEach(v => { conteo[v.grupo]++; });
  console.log("SIMs únicos fuera del pool y fuera de fichas vivas, por grupo:", conteo);

  const aplicar = [...porSim.entries()].filter(([, v]) => GRUPOS.has(v.grupo) && v.grupo !== "duplicado");
  console.log(`Grupos pedidos: ${[...GRUPOS].join(", ")} → ${aplicar.length} SIMs`);
  aplicar.slice(0, 8).forEach(([sim, v]) => console.log("  ", sim, v.x.cierre.sim_phone || "", v.x.cierre.operador || "", "|", v.x.serial, v.x.cliente_nombre || v.x.cliente, "|", v.x.cierre.motivo));
  if (!APPLY) { console.log("Simulación. Repetir con --apply para escribir."); return; }

  let hechos = 0, saltados = 0;
  for (const [sim, v] of aplicar) {
    const ref = db.collection("sim_cards").doc(sim);
    // create() falla si el doc apareció entre la lectura y ahora: no se pisa.
    try {
      await ref.create({
        sim_number: sim,
        sim_phone: String(v.x.cierre.sim_phone || "").trim(),
        operador: String(v.x.cierre.operador || "").trim(),
        estado: "disponible",
        origen: "liberado",
        asignado_a: null,
        liberado_de: { device_id: v.id, serial: v.x.serial || "", cliente_nombre: v.x.cliente_nombre || v.x.cliente || "", motivo: v.x.cierre.motivo || "" },
        backfill: "sims-de-fichas-cerradas-al-pool-2026-10-06",
        created_at: FV.serverTimestamp(),
        creado_por_uid: null,
        creado_por_email: USUARIO,
        updated_at: FV.serverTimestamp(),
        updated_by: null,
        updated_by_email: USUARIO,
      });
      hechos++;
    } catch (e) { saltados++; console.warn("  saltado", sim, e.code || e.message); }
  }
  console.log(`Escritos ${hechos}, saltados ${saltados}.`);
})().catch(e => { console.error(e); process.exit(1); });
