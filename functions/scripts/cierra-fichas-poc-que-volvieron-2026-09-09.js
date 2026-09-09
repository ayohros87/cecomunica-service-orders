/**
 * cierra-fichas-poc-que-volvieron-2026-09-09.js — cierra las fichas de POC de
 * radios que YA NO están con el cliente.
 *
 * POR QUÉ
 *   POC es la plataforma de airtime: mientras el radio está con el cliente
 *   tiene ficha viva. Nadie las cerraba (la devolución empezó a hacerlo el
 *   2026-09-09, ver src/lib/pocCierre.js), y el atraso trancaba a recepción:
 *   el batch veía el serial "ya registrado con este cliente" y se paraba.
 *
 * QUÉ CIERRA (la verdad la dice el pool, no POC)
 *   A) unidad en_bodega / devuelto_revision / baja → nadie la tiene: se cierra.
 *   B) unidad en_taller pero asignada a OTRO cliente (o a ninguno) → se cierra.
 *      El taller con el MISMO cliente NO se toca: es una reparación y el radio
 *      vuelve a esa misma cuenta.
 *   C) por_clasificar, en_cliente, asignado_contrato y vendido: NO se tocan.
 *      (Las fichas de un radio que hoy está con OTRO cliente son otro caso
 *      —el arrastre de duplicados— y se limpian donde hay un humano mirando:
 *      el batch de POC las lista y ofrece cerrarlas.)
 *   Sin ficha en el pool → no se toca: no hay con qué afirmar nada.
 *
 * CÓMO CIERRA
 *   Reusa lib/pocCierre.cerrarFicha: baja lógica + activo:false, el SIM vuelve
 *   al pool salvo que ya esté en otro radio, y log en poc_logs (origen
 *   'sistema', motivo 'Limpieza 2026-09-09'). Restaurable desde POC.
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-fichas-poc-que-volvieron-2026-09-09.js            # informe
 *   node scripts/cierra-fichas-poc-que-volvieron-2026-09-09.js --aplicar  # cierra
 *   … --csv ../local-data/fichas-poc-cerradas-2026-09-09.csv
 */
const fs = require("fs");
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { cerrarFicha } = require("../src/lib/pocCierre");

const db = admin.firestore();
const APLICAR = process.argv.includes("--aplicar");
const CSV = (process.argv.find(a => a.startsWith("--csv=")) || "").slice(6)
  || (process.argv.includes("--csv") ? process.argv[process.argv.indexOf("--csv") + 1] : null);

const norm = (s) => (s ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const EN_CASA = new Set(["en_bodega", "devuelto_revision", "baja"]);
const MOTIVO = "Limpieza 2026-09-09: el radio ya no está con el cliente";
const REF = { tipo: "limpieza", id: "cierre-poc-2026-09-09", label: "Limpieza de fichas POC" };

// Decide qué hacer con UNA ficha viva. Devuelve el motivo del cierre o null.
function razonDeCierre(ficha, unidad) {
  if (!unidad) return null;
  if (EN_CASA.has(unidad.estado)) return unidad.estado;
  if (unidad.estado === "en_taller") {
    const suyo = unidad.asignacion && unidad.asignacion.cliente_id;
    if (!suyo || (ficha.cliente_id && suyo !== ficha.cliente_id)) return "en_taller_de_otro";
    return null;   // reparación del mismo cliente: su registro sigue vivo
  }
  return null;
}

(async () => {
  const [devSnap, poolSnap] = await Promise.all([
    db.collection("poc_devices").get(),
    db.collection("equipos_pool").get(),
  ]);
  const pool = new Map();
  poolSnap.forEach(d => pool.set(d.id, { id: d.id, ...d.data() }));

  const aCerrar = [];
  const porRazon = {}, porCliente = {};
  let vivas = 0, conSim = 0;
  devSnap.forEach(d => {
    const f = { id: d.id, ...d.data() };
    if (f.deleted === true) return;
    vivas++;
    const razon = razonDeCierre(f, pool.get(norm(f.serial)));
    if (!razon) return;
    aCerrar.push({ ...f, _razon: razon });
    porRazon[razon] = (porRazon[razon] || 0) + 1;
    const c = f.cliente_nombre || f.cliente || "(sin cliente)";
    porCliente[c] = (porCliente[c] || 0) + 1;
    if ((f.sim_number || "").toString().trim()) conSim++;
  });

  console.log(`Fichas POC vivas: ${vivas}`);
  console.log(`A cerrar: ${aCerrar.length}  ${JSON.stringify(porRazon)}`);
  console.log(`De esas, con SIM asignado: ${conSim}`);
  console.log("\nTop clientes:");
  Object.entries(porCliente).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([c, n]) => console.log(`   ${String(n).padStart(4)}  ${c}`));

  if (CSV) {
    const filas = ["serial,unit_id,cliente,razon,sim,ficha_id"].concat(aCerrar.map(f =>
      [f.serial, f.unit_id || "", (f.cliente_nombre || f.cliente || "").replace(/,/g, " "), f._razon, f.sim_number || "", f.id].join(",")));
    fs.writeFileSync(CSV, filas.join("\n"), "utf8");
    console.log(`\nDetalle en ${CSV}`);
  }

  if (!APLICAR) return console.log("\nSimulación. Corre con --aplicar para cerrarlas.");

  let ok = 0, simsAjenos = 0, fallos = 0;
  for (const f of aCerrar) {
    try {
      const r = await cerrarFicha(f, { motivo: `${MOTIVO} (${f._razon})`, ref: REF, usuario: "sistema" }, db);
      if (r === "cerrada-sim-ajeno") simsAjenos++;
      ok++;
      if (ok % 100 === 0) console.log(`   ${ok}/${aCerrar.length}…`);
    } catch (e) {
      fallos++;
      console.warn(`   falló ${f.serial} (${f.id}): ${e.message}`);
    }
  }
  console.log(`\nCerradas: ${ok}   con SIM que ya estaba en otro radio (pool intacto): ${simsAjenos}   fallos: ${fallos}`);
})().catch(e => { console.error(e); process.exit(1); });
