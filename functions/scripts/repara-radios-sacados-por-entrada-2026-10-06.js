/**
 * repara-radios-sacados-por-entrada-2026-10-06.js — devuelve al cliente los
 * radios que el cierre TARDÍO de una ENTRADA vieja mandó a bodega, y reabre
 * las fichas de POC que la limpieza del 09-09 les cerró por eso.
 *
 * CASO (Brenda, 2026-10-06): TROPICAL RESORTS / HOTEL GAMBOA, ALQ20260806-02.
 *   POC mostraba 10 radios activos de 22. Los que faltan volvieron de M.A.M.,
 *   R. SMITH, GOLY y MAS SEGURIDAD con ENTRADAs que se quedaron abiertas; bodega
 *   los asignó al hotel el 07-ago, se entregaron el 13-ago, y el 07/14-ago se
 *   cerraron esas ENTRADAs: el cierre los mandó a bodega y les soltó la
 *   asignación. El 09-09 `cierra-fichas-poc-que-volvieron-2026-09-09.js` vio
 *   "en bodega" y cerró sus fichas. El trigger ya no lo hace (ver
 *   lib/incidenciasEntrada.reubicadaTrasEntrada); esto repara el atraso.
 *
 * QUÉ REPARA (conservador: lo que no calza todo, solo se informa)
 *   · el cierre_entrada movió el radio desde en_cliente / asignado_contrato /
 *     en_taller, y ANTES del cierre pero DESPUÉS de abrir la ENTRADA el kardex
 *     lo había ubicado en otro lado;
 *   · hoy sigue en_bodega y nadie lo ha movido desde el cierre;
 *   · el contrato al que se había asignado sigue vivo y el serial sigue en él.
 *   Estado al que vuelve: el que tenía al cerrarse la ENTRADA; si estaba en el
 *   taller de otra orden y esa orden ya se entregó, en_cliente.
 *   POC: reabre las fichas de ese serial y ese cliente que cerró la limpieza
 *   del 09-09, activas y con su SIM si el SIM sigue libre desde ese cierre.
 *
 * USAGE (desde functions/):
 *   node scripts/repara-radios-sacados-por-entrada-2026-10-06.js            # informe
 *   node scripts/repara-radios-sacados-por-entrada-2026-10-06.js --aplicar
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "cecomunica-service-orders" });
const pool = require("../src/domain/equiposPool");
const { reubicadaTrasEntrada } = require("../src/lib/incidenciasEntrada");

const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APLICAR = process.argv.includes("--aplicar");
const E = pool.ESTADOS;
const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
const dia = (t) => (t && t.toDate ? t.toDate().toISOString().slice(0, 10) : "");
const soloDigitos = (s) => (s ?? "").toString().replace(/\D/g, "");
const normNombre = (s) => (s ?? "").toString().trim().toUpperCase();
const MUERTOS = new Set(["anulado", "cancelado", "vencido", "terminado", "cerrado", "rechazado"]);
const LIMPIEZA_POC = "cierre-poc-2026-09-09";
const MOTIVO = "El cierre tardío de una ENTRADA vieja lo había mandado a bodega estando con el cliente (caso HOTEL GAMBOA, 2026-10-06)";
const REF = { tipo: "limpieza", id: "repara-entrada-tardia-2026-10-06", label: "Reparación: cierre tardío de ENTRADA" };
const ENTREGADO = "ENTREGADO AL CLIENTE";

(async () => {
  const ords = await db.collection("ordenes_de_servicio").where("tipo_de_servicio", "==", "ENTRADA").get();
  const contratos = new Map();
  const getContrato = async (id) => {
    if (!contratos.has(id)) {
      const s = await db.collection("contratos").doc(id).get();
      contratos.set(id, s.exists ? { id, ...s.data() } : null);
    }
    return contratos.get(id);
  };

  const plan = [], informe = [];
  for (const od of ords.docs) {
    const o = od.data();
    if (!o.fecha_cierre_entrada) continue;
    const abierta = ms(o.fecha_creacion);
    for (const eq of (o.equipos || [])) {
      const sn = pool.normSerial(eq.serial || eq.SERIAL || eq.numero_de_serie);
      if (!sn) continue;
      const uRef = db.collection("equipos_pool").doc(sn);
      const movs = (await uRef.collection("movimientos").get()).docs.map((d) => d.data());
      const cierre = movs.find((m) => m.tipo === "cierre_entrada" && m.ref?.id === od.id
        && [E.EN_CLIENTE, E.ASIGNADO, E.EN_TALLER].includes(m.de_estado));
      if (!cierre) continue;
      const antes = movs.filter((m) => ms(m.at) < ms(cierre.at));
      if (!reubicadaTrasEntrada(antes, { ordenId: od.id, desdeMs: abierta })) continue;

      const fila = { serial: sn, entrada: od.id, ent_cliente: o.cliente_nombre || "", cierre: dia(cierre.at), de: cierre.de_estado };
      const asig = antes.filter((m) => ["asignacion_contrato", "asignacion_gestion"].includes(m.tipo) && ms(m.at) > abierta)
        .sort((a, b) => ms(b.at) - ms(a.at))[0];
      const despues = movs.filter((m) => ms(m.at) > ms(cierre.at) && m.ref?.id !== od.id
        && !/^(correccion|migracion)/.test(m.tipo || "") && m.tipo !== "cambio_condicion");
      const u = (await uRef.get()).data() || {};
      fila.hoy = u.estado;
      if (u.estado !== E.EN_BODEGA) { informe.push({ ...fila, nota: `hoy ${u.estado}: ya lo ubicaron` }); continue; }
      if (despues.length) { informe.push({ ...fila, nota: `movido después: ${despues.map((m) => m.tipo).join(",")}` }); continue; }
      if (!asig || asig.ref?.tipo !== "contrato") { informe.push({ ...fila, nota: "sin asignación a contrato que reponer" }); continue; }

      const c = await getContrato(asig.ref.id);
      fila.contrato = asig.ref.label;
      if (!c || c.deleted === true || MUERTOS.has((c.estado || "").toLowerCase())) {
        informe.push({ ...fila, nota: `contrato ${c ? c.estado : "no existe"}` }); continue;
      }
      const serSnap = await db.collection("contratos").doc(c.id).collection("seriales").get();
      if (!serSnap.docs.some((d) => pool.normSerial(d.data().serial) === sn)) {
        informe.push({ ...fila, nota: "el serial ya no está en el contrato" }); continue;
      }

      let destino = cierre.de_estado, ordenTaller = null;
      if (destino === E.EN_TALLER) {
        const ing = antes.filter((m) => m.tipo === "ingreso_taller" && m.ref?.id && m.ref.id !== od.id)
          .sort((a, b) => ms(b.at) - ms(a.at))[0];
        const ot = ing ? (await db.collection("ordenes_de_servicio").doc(ing.ref.id).get()).data() : null;
        if (!ot) { informe.push({ ...fila, nota: "estaba en taller de una orden que no aparece" }); continue; }
        if (ot.estado_reparacion === ENTREGADO) destino = E.EN_CLIENTE;
        else if (ot.eliminado !== true) ordenTaller = ing.ref.id;
        else { informe.push({ ...fila, nota: `orden de taller ${ing.ref.id} eliminada` }); continue; }
      }
      plan.push({ ...fila, destino, ordenTaller, contrato_doc_id: c.id, contrato_id: c.contrato_id,
        cliente_id: c.cliente_id, cliente_nombre: c.cliente_nombre });
    }
  }

  // Fichas de POC que la limpieza del 09-09 cerró por ese "en bodega".
  for (const p of plan) {
    const snap = await db.collection("poc_devices").where("serial", "==", p.serial).get();
    const fichas = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const delCliente = (f) => (f.cliente_id ? f.cliente_id === p.cliente_id
      : normNombre(f.cliente_nombre || f.cliente) === normNombre(p.cliente_nombre));
    p.vivaYa = fichas.some((f) => f.deleted !== true && delCliente(f));
    p.fichas = p.vivaYa ? [] : fichas.filter((f) => f.deleted === true && f.cierre?.ref?.id === LIMPIEZA_POC && delCliente(f));
  }

  console.log(`ENTRADAs cerradas revisadas: ${ords.size}`);
  console.log(`\nA REPARAR: ${plan.length} radios`);
  console.table(plan.map((p) => ({ serial: p.serial, contrato: p.contrato, cliente: p.cliente_nombre.slice(0, 32),
    entrada: p.entrada, cierre: p.cierre, vuelve_a: p.destino + (p.ordenTaller ? ` (${p.ordenTaller})` : ""),
    poc: p.vivaYa ? "ya viva" : p.fichas.map((f) => f.unit_id).join(" ") || "—" })));
  console.log(`\nSOLO INFORME (no se tocan): ${informe.length}`);
  console.table(informe.map((r) => ({ serial: r.serial, contrato: r.contrato || "", entrada: r.entrada, cierre: r.cierre, nota: r.nota })));

  if (!APLICAR) return console.log("\nSimulación. Corre con --aplicar para reparar.");

  let radios = 0, fichasOk = 0, simsOk = 0;
  const simsNo = [];
  for (const p of plan) {
    const asignacion = { cliente_id: p.cliente_id, cliente_nombre: p.cliente_nombre,
      contrato_id: p.contrato_id, contrato_doc_id: p.contrato_doc_id };
    const r = await pool.transicionarPorId(p.serial, {
      aEstado: p.ordenTaller ? E.EN_TALLER : p.destino,
      soloDesde: [E.EN_BODEGA],
      tipo: "correccion_cierre_entrada",
      refMov: { tipo: "contrato", id: p.contrato_doc_id, label: p.contrato_id },
      notas: `${MOTIVO}. ENTRADA ${p.entrada} cerrada el ${p.cierre}.`,
      extra: { asignacion, orden_actual_id: p.ordenTaller || null },
    });
    if (r === "transicion") radios++;
    else { console.warn(`   ${p.serial}: ${r}, no se tocó`); continue; }

    for (const f of p.fichas) {
      const sim = soloDigitos(f.cierre?.sim_number);
      const devRef = db.collection("poc_devices").doc(f.id);
      const reabre = {
        deleted: false, activo: true,
        cierre: FV.delete(), cierre_revertido: { ...f.cierre, revertido_at: FV.serverTimestamp(), ref: REF },
        updated_at: FV.serverTimestamp(), updated_by: null, updated_by_email: "sistema",
      };
      const conSim = await db.runTransaction(async (tx) => {
        const simRef = sim ? db.collection("sim_cards").doc(sim) : null;
        const s = simRef ? await tx.get(simRef) : null;
        // SIM fuera del inventario de SIMs (los viejos): no hay pool que
        // cuidar, la ficha recupera su número tal cual.
        const sinPool = s && !s.exists;
        const libre = sinPool || (s && s.exists && s.data().estado === "disponible"
          && (!s.data().liberado_de || s.data().liberado_de.device_id === f.id));
        if (libre) {
          if (!sinPool) tx.update(simRef, { estado: "asignado",
            asignado_a: { device_id: f.id, serial: f.serial || "", cliente_nombre: f.cliente_nombre || "" },
            liberado_de: null, updated_at: FV.serverTimestamp(), updated_by: null, updated_by_email: "sistema" });
          tx.update(devRef, { ...reabre, sim_number: f.cierre.sim_number || "", sim_phone: f.cierre.sim_phone || "",
            ...(f.cierre.operador ? { operador: f.cierre.operador } : {}) });
          return true;
        }
        tx.update(devRef, reabre);
        return false;
      });
      fichasOk++;
      if (conSim) simsOk++; else if (sim) simsNo.push(`${f.unit_id} (${p.serial}) SIM ${f.cierre.sim_number}`);
      await db.collection("poc_logs").add({
        equipo_id: f.id, fecha: FV.serverTimestamp(), usuario: "sistema", accion: "restaurar",
        origen: "sistema", motivo: MOTIVO, ref: REF,
        cambios: { antes: { deleted: true, activo: false }, despues: { deleted: false, activo: true, sim_restaurado: conSim } },
      }).catch(() => {});
    }
  }
  console.log(`\nRadios devueltos al cliente: ${radios}/${plan.length}   fichas POC reabiertas: ${fichasOk} (con SIM ${simsOk})`);
  if (simsNo.length) console.log("Fichas reabiertas SIN su SIM (el SIM ya no estaba libre):\n   " + simsNo.join("\n   "));
})().catch((e) => { console.error(e); process.exit(1); });
