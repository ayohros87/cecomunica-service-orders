/**
 * cierra-transiciones-sin-equipo.js — tría la cola de "Transición de equipos"
 * y cierra los contratos donde NO HAY NADA QUE MAPEAR.
 *
 * Por qué (diagnóstico 2026-08-07): 42 contratos vigentes pedían la transición
 * y solo 1 de 232 transicionables se había registrado nunca. La causa no era
 * pereza de bodega: la mayoría no tiene `contrato_origen_ids` (el selector de
 * contrato original se desplegó el 2026-07-17, y buena parte de la cola es
 * anterior), así que el auto-registro de onEntregaTransicion aborta y la
 * pantalla —que sin origen lista "todos los equipos del cliente en el pool
 * menos los del contrato nuevo"— abre con la tabla de salientes VACÍA. Caso
 * canónico: ALQ20260706-01 (CRUZ VERDE), renovación de un contrato en papel,
 * cliente sin ningún otro contrato, sin órdenes y sin poc_devices.
 *
 * Criterio: para cada pendiente se calculan los salientes EXACTAMENTE como lo
 * hace contrato-transicion-page.js. Cero salientes = la pantalla no podría
 * ofrecer ni una fila => se cierra con un doc marcador en contratos/{cid}/
 * mapeos (onMapeoWrite sube `transicion_mapeos_count` y la CTA se apaga).
 * Un solo saliente = trabajo real de recuperación: NO se toca.
 *
 * El marcador lleva `cierre_motivo: 'sin_equipo_rastreado'` para no confundirse
 * con el "sin reemplazos" que escribe la UI (adición pura), y `cierre_nota`
 * es lo que la pantalla muestra al abrir el contrato después.
 *
 * El predicado de pendiente NO se copia: se carga el de
 * public/js/domain/transicionPendiente.js (fuente única, invariante P3 del
 * test colaInventarioPendientes.test.js).
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-transiciones-sin-equipo.js                    # dry-run
 *   node scripts/cierra-transiciones-sin-equipo.js --apply
 *   node scripts/cierra-transiciones-sin-equipo.js --contrato=ALQ20260706-01 --apply
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const SOLO = (process.argv.find(a => a.startsWith("--contrato=")) || "").split("=")[1] || null;

// Estados del pool que significan "lo tiene el cliente" (equiposPoolService.ESTADOS).
const CON_EL_CLIENTE = ["asignado_contrato", "en_cliente"];

// Predicado compartido, cargado del front para no duplicar el criterio.
const ctxPred = { window: {}, console };
vm.createContext(ctxPred);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "..", "public", "js", "domain", "transicionPendiente.js"), "utf8"),
  ctxPred);
const TP = ctxPred.window.TransicionPendiente;

// Salientes candidatos. `pantalla` = lo que ofrecería contrato-transicion-page.js
// (anclado al origen si lo hay, si no todo el pool del cliente); `cliente` = lo
// que el cliente tiene en el pool pase lo que pase.
//
// La diferencia importa: un contrato con origen vinculado cuyo ORIGEN no tiene
// unidades abre la pantalla vacía, pero eso no significa que no haya nada que
// recuperar — puede ser que el equipo viejo del cliente cuelgue de otro
// contrato (origen mal elegido). Cerrar ese caso escribiría una nota falsa, así
// que el cierre exige que las DOS listas estén vacías.
async function salientesDe(docId, c) {
  const origenIds = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length)
    ? c.contrato_origen_ids
    : (c.contrato_origen_id ? [c.contrato_origen_id] : []);

  const recoge = (snap, dest) => snap.forEach((d) => {
    const u = d.data();
    if (!CON_EL_CLIENTE.includes(u.estado)) return;
    if (u.asignacion?.contrato_doc_id === docId) return; // los del contrato nuevo no son salientes
    dest.set(d.id, { id: d.id, serial: u.serial || u.serial_norm || d.id, estado: u.estado, propiedad: u.propiedad || "" });
  });

  const porCliente = new Map();
  if (c.cliente_id) {
    recoge(await db.collection("equipos_pool").where("asignacion.cliente_id", "==", c.cliente_id).get(), porCliente);
  }

  let pantalla = porCliente;
  if (origenIds.length) {
    pantalla = new Map();
    for (const id of origenIds) {
      recoge(await db.collection("equipos_pool").where("asignacion.contrato_doc_id", "==", id).get(), pantalla);
    }
  }
  return { pantalla: [...pantalla.values()], cliente: [...porCliente.values()], conOrigen: !!origenIds.length };
}

(async () => {
  const snap = await db.collection("contratos").where("estado", "in", ["activo", "aprobado"]).get();

  const pendientes = [];
  snap.forEach((d) => {
    const c = d.data();
    if (c.deleted) return;
    if (!TP.contratoNecesitaTransicion(c)) return;
    if (SOLO && (c.contrato_id || d.id) !== SOLO) return;
    pendientes.push({ docId: d.id, ...c });
  });

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} · pendientes según el predicado compartido: ${pendientes.length}${SOLO ? ` (filtrado a ${SOLO})` : ""}\n`);

  const cerrar = [], dejar = [], esperar = [], malVinculados = [];
  for (const c of pendientes) {
    const sal = await salientesDe(c.docId, c);
    const fila = {
      contrato: c.contrato_id || c.docId,
      cliente: (c.cliente_nombre || "").slice(0, 28),
      accion: c.accion || c.codigo_tipo || "",
      origen: c.origen_tipo ?? "(sin campo)",
      enPantalla: sal.pantalla.length,
      delCliente: sal.cliente.length,
      seriales: c.seriales_estado || "-",
      _doc: c.docId, _c: c, _sal: sal,
    };
    // Con los seriales aún sin asignar el trabajo de bodega ni ha empezado:
    // el contrato ya sale en la cola 1 y no se le cierra nada por adelantado.
    if (c.seriales_estado !== "asignados") esperar.push(fila);
    else if (!sal.pantalla.length && sal.cliente.length) malVinculados.push(fila);
    else if (sal.pantalla.length) dejar.push(fila);
    else cerrar.push(fila);
  }

  const tabla = (t) => t.map(({ _doc, _c, _sal, ...r }) => r);
  const listaSeriales = (f, campo) => `   ${f.contrato} → ${f._sal[campo].slice(0, 12).map(u => `${u.serial}(${u.estado}${u.propiedad === "cliente" ? ",propio" : ""})`).join(" ")}${f._sal[campo].length > 12 ? ` …+${f._sal[campo].length - 12}` : ""}`;

  console.log(`── SE CIERRAN (ni la pantalla ni el cliente tienen un solo saliente): ${cerrar.length} ──`);
  console.table(tabla(cerrar));

  console.log(`\n── NO SE TOCAN · ORIGEN MAL VINCULADO: ${malVinculados.length} ──`);
  console.log("   La pantalla abre vacía (el contrato origen no tiene unidades), pero el");
  console.log("   cliente SÍ tiene equipo en el pool: el origen elegido no es el que trae");
  console.log("   los radios viejos. Se arregla revinculando, no cerrando.");
  console.table(tabla(malVinculados));
  malVinculados.forEach(f => console.log(listaSeriales(f, "cliente")));

  console.log(`\n── SE DEJAN (hay equipo del cliente en el pool = recuperación real): ${dejar.length} ──`);
  console.table(tabla(dejar));
  dejar.forEach(f => console.log(listaSeriales(f, "pantalla")));

  console.log(`\n── SE ESPERAN (seriales aún sin asignar; su turno es la cola 1): ${esperar.length} ──`);
  console.table(tabla(esperar));

  if (!APPLY) {
    console.log("\nDry-run: no se escribió nada. Repite con --apply para cerrar.");
    process.exit(0);
  }

  let ok = 0;
  for (const f of cerrar) {
    const propio = f._c.origen_tipo === "legacy";
    await db.collection("contratos").doc(f._doc).collection("mapeos").add({
      sin_reemplazos: true,
      cierre_motivo: "sin_equipo_rastreado",
      cierre_nota: propio
        ? "el contrato original es de papel: los equipos anteriores no tienen ficha en el pool"
        : "no hay equipos del cliente en el pool para mapear como salientes (triage 2026-08-07)",
      saliente: null, saliente_pool_id: null,
      entrante: null, entrante_pool_id: null,
      contrato_id: f._c.contrato_id || f._doc,
      contrato_origen_id: f._c.contrato_origen_id || null,
      auto: true,
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system",
    });
    ok++;
    console.log(`  cerrado ${f.contrato} (${f.cliente})`);
  }
  console.log(`\n${ok} contrato(s) cerrados. El contador lo sube onMapeoWrite; la CTA se apaga en el próximo refresco.`);
  process.exit(0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
