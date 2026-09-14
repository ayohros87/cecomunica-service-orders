/**
 * cierra-contratos-clientes-inactivos.js — pone al día los clientes que ya
 * estaban desactivados antes de que existiera el trigger.
 *
 * Regla (Alberto, 2026-09-14): desactivar un cliente CIERRA sus contratos
 * vigentes — la desactivación es el acto que declara terminada la cuenta. De
 * ahora en adelante lo hace onClienteDesactivado en el mismo write; este
 * script cubre lo que quedó atrás.
 *
 * Contexto: cobros (Andrea) arrancó el 2026-09-11 la limpieza que se le pidió
 * por correo el 2026-08-27 y va en orden alfabético. Al 2026-09-14 llevaba 93
 * clientes desactivados y 24 de ellos seguían con contrato vigente y/o radios
 * nuestros en campo — invisibles en el Centro (el filtro "Solo activos" viene
 * encendido) pero contando para vencimientos, comisiones y pendientes.
 *
 * Lo que NO hace: tocar equipos. Un cliente inactivo con radios en campo es una
 * contradicción REAL que hay que resolver con una devolución física, no con un
 * cambio de estado. El script los lista aparte para que alguien los persiga.
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-contratos-clientes-inactivos.js [--write] [--solo-sin-equipo]
 *
 * --solo-sin-equipo cierra ÚNICAMENTE los contratos de clientes que ya no
 * tienen un solo radio nuestro en campo. Es la mitad sin ambigüedad: un
 * cliente inactivo CON equipo puede ser una cuenta terminada a la que le falta
 * la devolución… o una desactivación equivocada (PANAMA PORT BALBOA: 27 radios
 * y 4 contratos vigentes hasta 2027, desactivado el 2026-09-14). Esos se miran
 * uno por uno antes de cerrarles nada.
 *
 * Idempotente: un contrato ya cerrado no se vuelve a tocar.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const { VIGENTES, buildCierre } = require("../src/domain/cierreContrato");

const dryRun = !process.argv.includes("--write");
const soloSinEquipo = process.argv.includes("--solo-sin-equipo");
const HOY = new Date().toISOString().slice(0, 10);

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const inactivos = new Map();   // id -> nombre
  (await db.collection("clientes").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    if (v.activo === false) inactivos.set(d.id, v.nombre || d.id);
  });
  console.log(`Clientes inactivos: ${inactivos.size}`);

  // Equipos todavía en campo, por cliente (no se tocan: se reportan).
  //
  // La PROPIEDAD parte el reporte en dos, y la diferencia es todo (Alberto,
  // 2026-09-14): un radio de CECOMUNICA con un cliente que ya no lo es hay que
  // ir a buscarlo; uno que el cliente COMPRÓ se queda con él y no es pendiente
  // de nadie. Sin separarlos, PANAMA PORT BALBOA inflaba la lista con 26
  // Kenwood suyos —comprados en dos contratos Propio— y parecía un faltante
  // de inventario que no existe.
  const enCampo = new Map();      // solo lo NUESTRO: eso es el pendiente real
  const delCliente = new Map();   // comprados por el cliente: se quedan con él
  (await db.collection("equipos_pool").get()).forEach((d) => {
    const v = d.data();
    if (!["en_cliente", "asignado_contrato"].includes(String(v.estado || ""))) return;
    const cid = v.asignacion?.cliente_id;
    if (!cid || !inactivos.has(cid)) return;
    const mapa = v.propiedad === "cliente" ? delCliente : enCampo;
    if (!mapa.has(cid)) mapa.set(cid, []);
    mapa.get(cid).push(d.id);
  });

  const porCerrar = [];
  (await db.collection("contratos").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    if (!inactivos.has(v.cliente_id)) return;
    if (!VIGENTES.has(String(v.estado || "").toLowerCase())) return;
    porCerrar.push({ ref: d.ref, id: d.id, doc: v });
  });

  console.log(`Contratos vigentes de clientes inactivos: ${porCerrar.length}\n`);
  const elegidos = [];
  for (const c of porCerrar) {
    const eq = (enCampo.get(c.doc.cliente_id) || []).length;
    const fuera = soloSinEquipo && eq > 0;
    if (!fuera) elegidos.push(c);
    console.log(`  ${fuera ? "—" : "·"} ${(c.doc.contrato_id || c.id).padEnd(20)} ${
      String(inactivos.get(c.doc.cliente_id)).slice(0, 34).padEnd(35)} ${
      String(c.doc.estado).padEnd(9)} ${eq ? `⚠ ${eq} radio(s) en campo${fuera ? " — SE SALTA" : ""}` : ""}`);
  }
  if (soloSinEquipo) console.log(`\n--solo-sin-equipo: se cerrarían ${elegidos.length} de ${porCerrar.length}.`);

  if (!dryRun && elegidos.length) {
    let n = 0;
    for (const c of elegidos) {
      await c.ref.update({
        ...buildCierre(c.doc, {
          motivo: `Cliente desactivado (puesta al día ${HOY}): la cuenta terminó`,
          FieldValue: admin.firestore.FieldValue,
        }),
        cierre_masivo: {
          origen: "backfill_clientes_inactivos",
          cliente_id: c.doc.cliente_id,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
      n++;
    }
    console.log(`\n✅ ${n} contrato(s) cerrados.`);
  }

  // Lo que el cierre NO resuelve: radios NUESTROS con clientes que ya no lo son.
  const conEquipo = [...enCampo.entries()].sort((a, b) => b[1].length - a[1].length);
  if (conEquipo.length) {
    const total = conEquipo.reduce((s, [, xs]) => s + xs.length, 0);
    console.log(`\n── PENDIENTE FÍSICO: ${total} radio(s) de CECOMUNICA en campo con ${conEquipo.length} cliente(s) inactivo(s) ──`);
    console.log("   Cerrar el contrato no los recupera. Cada uno necesita una devolución (o corregir el dato).");
    for (const [cid, seriales] of conEquipo) {
      console.log(`  ${String(inactivos.get(cid)).slice(0, 40).padEnd(41)} ${seriales.length} — ${seriales.slice(0, 6).join(", ")}${seriales.length > 6 ? ", …" : ""}`);
    }
  }

  // Los del cliente: NO son pendiente de nadie. Se listan aparte y solo como
  // conteo, para que nadie los confunda con un faltante de inventario.
  const conPropios = [...delCliente.entries()].sort((a, b) => b[1].length - a[1].length);
  if (conPropios.length) {
    const total = conPropios.reduce((s, [, xs]) => s + xs.length, 0);
    console.log(`\n── ${total} equipo(s) PROPIOS DEL CLIENTE en ${conPropios.length} cuenta(s) inactiva(s) — se quedan con ellos, no hay nada que recuperar ──`);
    for (const [cid, seriales] of conPropios) {
      console.log(`  ${String(inactivos.get(cid)).slice(0, 40).padEnd(41)} ${seriales.length}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
