/**
 * resolver-dos-duenos.js — Aplica las decisiones humanas sobre los seriales que
 * dos clientes tenían ACTIVOS en POC al mismo tiempo (chequeo F de la
 * conciliación, 31 casos el 2026-07-28; decisión del usuario 2026-07-29).
 *
 * Un radio no puede estar en dos sitios: uno de los dos registros POC es el
 * rastro del cliente anterior, que al devolver el equipo quedó encendido en vez
 * de apagarse. Ninguna regla automática podía decidirlo — lo dijo una persona.
 *
 * Qué hace por cada serial resuelto:
 *   · la ficha del pool queda a nombre del dueño elegido (con su contrato
 *     vigente si lo hay; si no, custodia sin contrato) y enlazada a SU device;
 *   · si el destino es bodega: en_bodega, sin asignación y sin enlace POC;
 *   · deja el movimiento en el kardex con quién perdió el reclamo.
 * NO toca poc_devices: el apagado del device sobrante se hace en la plataforma
 * POC. El script imprime la lista al final.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/resolver-dos-duenos.js            # dry-run
 *   node scripts/resolver-dos-duenos.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const BODEGA = "__BODEGA__";
const PENDIENTE = "__PENDIENTE__";
const VIGENTE = new Set(["aprobado", "activo"]);
const eqNombre = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();

// Decisiones del usuario, 2026-07-29.
const DECISION = {
  "20311A1481": "JOEL GABRIEL SOLIS MURILLO",
  "21814A0101": "JOEL GABRIEL SOLIS MURILLO",
  "22326A1511": "XENIA GUADALUPE",
  "22610A4009": "CELSO PIMENTEL",
  "22610A4034": "FERRECENTRO OSCAR",
  "23411A1116": PENDIENTE,
  "23706A0378": "FERRECENTRO OSCAR",
  "24523A0399": "MP SECURITY GROUP PTY CORP",
  "24708A1234": "KIBIAN JOSUE GUARDIA GONZALEZ",
  "24708A1235": "SOCIEDAD ISRAELITA DE BENEFICENCIA - MACABIADA",
  "24708A1254": "KIBIAN JOSUE GUARDIA GONZALEZ",
  "24O22A0033": "TRANSPORTE LIGO, S.A.",
  "24O22A0036": "INSTITUTO BILINGUE CRISTIANO ELOHIM",
  "25D10A3052": "AGENCIA DE SEGURIDAD UNIDA",
  "25D10A3053": "PH PARADISE POINT",
  "25D10A3054": "PH PARADISE POINT",
  "25D10A3055": "PH CENTRO COMERCIAL PLAZA BAL HARBOUR",
  "25D10A3056": "PH PARADISE POINT",
  "25D10A3057": "SERVICIOS A NAVES Y PUERTOS, SA",
  "25D10A3058": "SERVICIOS A NAVES Y PUERTOS, SA",
  "25D10A3059": "SERVICIOS A NAVES Y PUERTOS, SA",
  "25D10A3060": "SERVICIOS A NAVES Y PUERTOS, SA",
  "25D10A3062": "PROYCON",
  "25D10A3063": "PROYCON",
  "25D10A3064": "PROYCON",
  "25D10A3065": "PARADISE BEACH CORPORATION - (DREAMS)",
  "25D10A3066": "PARADISE BEACH CORPORATION - (DREAMS)",
  "25O10A0690": "P.H. THE CENTURY TOWER",
  "25O10A0691": "SHEBANDOWAN HOLDINGS, S.A. - HOTEL LA COMPAÑIA",
  "25O10A0692": "P.H. THE CENTURY TOWER",
  "25O10A0696": BODEGA,
};

(async () => {
  const [pocSnap, poolSnap, serSnap, contSnap] = await Promise.all([
    db.collection("poc_devices").get(),
    db.collection("equipos_pool").get(),
    db.collectionGroup("seriales").get(),
    db.collection("contratos").get(),
  ]);
  const contratos = new Map(contSnap.docs.map((d) => [d.id, d.data()]));

  const fichasPorNorm = new Map();
  for (const d of poolSnap.docs) {
    const u = { id: d.id, ref: d.ref, ...d.data() };
    const k = u.serial_norm || d.id.split("__")[0];
    if (!fichasPorNorm.has(k)) fichasPorNorm.set(k, []);
    fichasPorNorm.get(k).push(u);
  }
  const devicesPorNorm = new Map();
  for (const d of pocSnap.docs) {
    const p = d.data();
    if (p.deleted === true || p.activo === false) continue;
    const n = pool.normSerial(p.serial || "");
    if (!DECISION[n]) continue;
    if (!devicesPorNorm.has(n)) devicesPorNorm.set(n, []);
    devicesPorNorm.get(n).push({ id: d.id, ...p });
  }
  // Contrato VIGENTE que lista el serial, por cliente.
  const contratoDe = new Map(); // norm → [{doc_id, contrato_id, cliente}]
  for (const s of serSnap.docs) {
    const n = pool.normSerial(s.data().serial || "");
    if (!DECISION[n]) continue;
    const cid = s.ref.parent.parent.id;
    const c = contratos.get(cid) || {};
    if (!VIGENTE.has(String(c.estado || "").toLowerCase())) continue;
    if (!contratoDe.has(n)) contratoDe.set(n, []);
    contratoDe.get(n).push({ doc_id: cid, contrato_id: c.contrato_id || cid,
      cliente: c.cliente_nombre || "", cliente_id: c.cliente_id || "" });
  }

  const plan = [], apagar = [], avisos = [];
  for (const [norm, destino] of Object.entries(DECISION)) {
    if (destino === PENDIENTE) { avisos.push(`${norm}: sin decidir — se queda en la cola`); continue; }
    const fichas = fichasPorNorm.get(norm) || [];
    if (fichas.length !== 1) { avisos.push(`${norm}: ${fichas.length} fichas — se omite, revisar a mano`); continue; }
    const ficha = fichas[0];
    // Re-ejecutable: si ya se aplicó la misma decisión, no se reescribe ni se
    // duplica el movimiento del kardex (solo se refresca la lista de apagados).
    const yaResuelto = ficha.dos_duenos_resuelto?.dueno === destino
      || (destino === BODEGA && ficha.dos_duenos_resuelto?.dueno === "__BODEGA__");
    const devs = devicesPorNorm.get(norm) || [];

    if (destino === BODEGA) {
      plan.push({ norm, ficha, destino: "bodega", devGana: null, yaResuelto,
        perdedores: devs.map((d) => ({ ...d, motivo: "el radio volvió a bodega" })) });
      devs.forEach((d) => apagar.push({ norm, device: d.id, cliente: d.cliente || d.cliente_nombre || "",
        unit: d.unit_id, radio: d.radio_name || "", motivo: "volvió a bodega" }));
      continue;
    }

    const devGana = devs.find((d) => eqNombre(d.cliente || d.cliente_nombre, destino)) || null;
    const perdedores = devs.filter((d) => d !== devGana);
    if (!devGana) avisos.push(`${norm}: "${destino}" no tiene device ACTIVO — se asigna igual, sin enlace POC`);
    const cVig = (contratoDe.get(norm) || []).find((c) => eqNombre(c.cliente, destino)) || null;
    plan.push({ norm, ficha, destino, devGana, contrato: cVig, perdedores, yaResuelto });
    perdedores.forEach((d) => apagar.push({ norm, device: d.id, cliente: d.cliente || d.cliente_nombre || "",
      unit: d.unit_id, radio: d.radio_name || "", motivo: `el radio es de ${destino}` }));
  }

  console.log(`Decisiones: ${Object.keys(DECISION).length} · a aplicar: ${plan.length}`
    + ` · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);
  for (const p of plan) {
    const destinoTxt = p.destino === "bodega" ? "BODEGA (en_bodega, sin asignación)" : p.destino;
    console.log(`  ${p.norm} [${p.ficha.estado}] "${p.ficha.modelo_label}" → ${destinoTxt}`
      + (p.contrato ? ` · contrato ${p.contrato.contrato_id}` : p.destino === "bodega" ? "" : " · custodia sin contrato")
      + (p.devGana ? ` · POC unit ${p.devGana.unit_id}` : ""));
  }
  if (avisos.length) { console.log("\nAvisos:"); avisos.forEach((a) => console.log("  " + a)); }

  console.log(`\n── Devices POC a APAGAR en la plataforma (${apagar.length}) ──`);
  apagar.forEach((a) => console.log(`  ${a.norm} · unit ${a.unit} · "${a.radio}" · ${a.cliente}  — ${a.motivo}`));
  if (!EXECUTE) { console.log("\nDRY-RUN — nada escrito."); return; }

  let nuevas = 0, refrescadas = 0;
  for (const p of plan) {
    // Marca de "ya lo decidió una persona": la conciliación deja de contarlo
    // como conflicto y lo reporta como pendiente de apagar en POC, que es una
    // tarea en la plataforma y no un problema de datos nuestro.
    const marca = {
      dos_duenos_resuelto: {
        dueno: p.destino === "bodega" ? BODEGA : p.destino,
        at: admin.firestore.FieldValue.serverTimestamp(),
        devices_a_apagar: p.perdedores.map((d) => d.id),
      },
    };
    if (p.yaResuelto) {
      await p.ficha.ref.set(marca, { merge: true });
      refrescadas++;
      continue;
    }
    nuevas++;
    const cambios = { ...marca, updated_at: admin.firestore.FieldValue.serverTimestamp() };
    let notas;
    if (p.destino === "bodega") {
      cambios.estado = pool.ESTADOS.EN_BODEGA;
      cambios.asignacion = null;
      cambios.poc_device_id = null;
      cambios.verificado = false;
      if (!p.ficha.ingreso_bodega_at) cambios.ingreso_bodega_at = admin.firestore.FieldValue.serverTimestamp();
      notas = "Decisión de operaciones: el radio volvió a bodega. "
        + `Se apagan sus registros POC (${p.perdedores.map((d) => `unit ${d.unit_id} de ${d.cliente || "?"}`).join(", ")}).`;
    } else {
      // en_taller se respeta: la unidad está físicamente en el taller por una
      // orden; lo que se corrige aquí es de QUIÉN es, no dónde está.
      if (p.ficha.estado !== pool.ESTADOS.EN_TALLER) cambios.estado = pool.ESTADOS.EN_CLIENTE;
      cambios.asignacion = {
        contrato_doc_id: p.contrato ? p.contrato.doc_id : null,
        contrato_id: p.contrato ? p.contrato.contrato_id : "",
        cliente_id: p.contrato ? p.contrato.cliente_id : (p.devGana?.cliente_id || ""),
        cliente_nombre: p.destino,
      };
      if (p.devGana) cambios.poc_device_id = p.devGana.id;
      notas = `Decisión de operaciones: el radio es de ${p.destino}`
        + (p.contrato ? ` (contrato ${p.contrato.contrato_id})` : " (custodia sin contrato)")
        + (p.perdedores.length ? `. Reclamo descartado: ${p.perdedores.map((d) => d.cliente || d.cliente_nombre || "?").join(", ")}` : "");
    }
    await p.ficha.ref.set(cambios, { merge: true });
    await p.ficha.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null,
      tipo: p.destino === "bodega" ? "ingreso_bodega" : "reasignacion",
      de_estado: p.ficha.estado, a_estado: cambios.estado || p.ficha.estado,
      ref: null, notas,
    });
  }
  console.log(`\nESCRITURA — fichas resueltas: ${nuevas} nuevas · ${refrescadas} ya lo estaban (solo se refrescó la marca)`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
