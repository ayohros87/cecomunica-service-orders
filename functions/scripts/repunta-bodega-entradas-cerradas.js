/**
 * repunta-bodega-entradas-cerradas.js — radios que YA volvieron y que el pool
 * sigue dando en campo.
 *
 * Origen (Alberto, 2026-09-14): tras cerrar los contratos de los clientes
 * desactivados quedaron 77 radios nuestros "en campo" con cuentas que ya no
 * son clientes. Al cruzarlos con las 1,993 órdenes de servicio, 14 tienen una
 * **ENTRADA CERRADA** como último movimiento: el taller los recibió y los
 * revisó, pero la unidad nunca aterrizó en bodega — el trigger que lo hace
 * (aterrizarEntrada en onOrdenWritePool) es del 2026-07, y estas entradas son
 * anteriores.
 *
 * Qué hace: misma transición que haría el cierre de la ENTRADA hoy —
 * en_cliente/asignado_contrato → en_bodega, sin asignación y `verificado:true`
 * (la ENTRADA *es* la inspección: alguien tuvo el radio en la mano).
 *
 * Qué NO hace: marcar refurbished. aterrizarEntrada sí repunta a la fila -R de
 * la familia, pero eso cambia el modelo de la unidad y con él el inventario
 * valorado; para una corrección retroactiva de 14 radios eso se decide aparte.
 *
 * Alcance: SOLO clientes desactivados (el encargo). El mismo patrón —ENTRADA
 * cerrada y el pool dando el radio en campo— puede existir en clientes activos;
 * ese barrido es otro trabajo.
 *
 * USAGE (desde functions/):
 *   node scripts/repunta-bodega-entradas-cerradas.js [--write]
 * Idempotente: `transicionar` devuelve 'sin-cambio' si ya está en bodega.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const pool = require("../src/domain/equiposPool");

const dryRun = !process.argv.includes("--write");
const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
const f = (t) => (t?.toDate ? t.toDate().toISOString().slice(0, 10) : "—");

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const inactivos = new Map();
  (await db.collection("clientes").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted !== true && v.activo === false) inactivos.set(d.id, v.nombre || d.id);
  });

  // Los radios que el pool da en campo con esos clientes.
  const objetivo = new Map();
  (await db.collection("equipos_pool").get()).forEach((d) => {
    const v = d.data();
    if (!["en_cliente", "asignado_contrato"].includes(String(v.estado || ""))) return;
    const cid = v.asignacion?.cliente_id;
    if (!cid || !inactivos.has(cid)) return;
    objetivo.set(pool.normSerial(v.serial || d.id), {
      serial: v.serial || d.id, cli: inactivos.get(cid), estado: v.estado,
      modelo_id: v.modelo_id || null, modelo: v.modelo_label || "",
    });
  });

  // La última orden que tocó cada uno.
  const ultima = new Map();
  (await db.collection("ordenes_de_servicio").get()).forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    for (const e of (v.equipos || [])) {
      const k = pool.normSerial(e.numero_de_serie || e.serial || "");
      if (!objetivo.has(k)) continue;
      const at = ms(v.fecha_salida || v.fecha_entrada || v.fecha_creacion);
      const cur = {
        id: d.id, numero: v.numero_orden || d.id, at, fecha: f(v.fecha_salida || v.fecha_entrada || v.fecha_creacion),
        tipo: String(v.tipo_de_servicio || "").toUpperCase(), estado: String(v.estado_reparacion || "").toUpperCase(),
      };
      const p = ultima.get(k);
      if (!p || at > p.at) ultima.set(k, cur);
    }
  });

  // Ficha POC ACTIVA más nueva: si alguien le abrió ficha a nombre de otro
  // cliente DESPUÉS de la entrada, el radio volvió a salir y la entrada ya no
  // es la última palabra. Gana la señal más reciente (criterio de Alberto,
  // 2026-09-14) — así se salvaron 22N22A0192 y 22N22A0228.
  const pocActiva = new Map();
  (await db.collection("poc_devices").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted === true || v.activo === false) return;
    const k = pool.normSerial(v.serial || "");
    if (!objetivo.has(k)) return;
    const cur = {
      cli: v.cliente_nombre || v.cliente || "—",
      at: ms(v.created_at || v.updated_at), fecha: f(v.created_at || v.updated_at),
    };
    const p = pocActiva.get(k);
    if (!p || cur.at > p.at) pocActiva.set(k, cur);
  });

  const aBodega = [], contradictorios = [];
  for (const [k, o] of objetivo) {
    const u = ultima.get(k);
    if (!u) continue;
    if (!/ENTRADA/.test(u.tipo) || !/CERRADA/.test(u.estado)) continue;
    const p = pocActiva.get(k);
    if (p && p.at > u.at) { contradictorios.push({ k, ...o, orden: u, poc: p }); continue; }
    aBodega.push({ k, ...o, orden: u });
  }
  if (contradictorios.length) {
    console.log(`${contradictorios.length} NO se tocan — tienen ficha POC activa POSTERIOR a la entrada:`);
    for (const x of contradictorios) {
      console.log(`  ⚠ ${x.serial.padEnd(14)} entrada ${x.orden.numero} (${x.orden.fecha}) pero ficha POC de ${x.poc.cli} el ${x.poc.fecha}`);
    }
    console.log("");
  }

  aBodega.sort((a, b) => a.cli.localeCompare(b.cli) || a.serial.localeCompare(b.serial));
  console.log(`${aBodega.length} radio(s) con ENTRADA cerrada y el pool dandolos en campo:\n`);
  for (const x of aBodega) {
    console.log(`  ${x.serial.padEnd(14)} ${x.modelo.slice(0, 16).padEnd(17)} ${x.cli.slice(0, 32).padEnd(33)} ${x.estado.padEnd(19)} → en_bodega   (OS ${x.orden.numero}, ${x.orden.fecha})`);
  }

  if (dryRun || !aBodega.length) return;

  let ok = 0, sin = 0, err = 0;
  for (const x of aBodega) {
    try {
      const r = await pool.transicionar(x.serial, x.modelo_id, x.modelo, {
        aEstado: pool.ESTADOS.EN_BODEGA,
        soloDesde: [pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.ASIGNADO],
        tipo: "cierre_entrada",
        refMov: { tipo: "orden", id: x.orden.id, label: x.orden.numero },
        notas: `Correccion 2026-09-14: la ENTRADA ${x.orden.numero} (${x.orden.fecha}) cerro y la unidad nunca aterrizo en bodega; el pool la seguia dando con ${x.cli}`,
        extra: { orden_actual_id: null, asignacion: null, verificado: true },
      });
      if (r === "transicion") ok++;
      else { sin++; console.log(`  · ${x.serial}: ${r}`); }
    } catch (e) {
      err++;
      console.log(`  ✖ ${x.serial}: ${e.message}`);
    }
  }
  console.log(`\n✅ ${ok} a bodega · ${sin} sin cambio · ${err} con error`);
})().catch((e) => { console.error(e); process.exit(1); });
