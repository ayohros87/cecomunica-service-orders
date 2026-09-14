/**
 * repunta-seriales-cliente-actual.js — radios que el pool le tiene a un cliente
 * y que en realidad están con OTRO.
 *
 * Origen (Alberto, 2026-09-14): de los 77 radios "en campo" con clientes ya
 * desactivados, 14 tenían señal de haberse mudado — una ficha POC activa a
 * nombre de otro cliente, o una orden ENTREGADO AL CLIENTE de otro cliente.
 *
 * LA REGLA QUE PIDIÓ ALBERTO: **la entrega al cliente nuevo tiene que ser
 * POSTERIOR a la fecha del contrato del cliente viejo.** Sin ese filtro se
 * reapuntan radios que fueron y volvieron: tres de BOCAS WILDSIDE salieron a
 * Joel Solís en mayo, pero el TEMP de Bocas entregó en agosto — el pool tiene
 * razón y la señal de mayo está vieja. La fecha del contrato viejo sale de
 * `mejorFechaInicio` (lib/vigencia): facturación → última entrega → aprobación
 * → creación.
 *
 * Se descarta además, sin tocar nada:
 *   · sin contrato en el cliente viejo → no hay con qué comparar.
 *   · señal sin fecha utilizable.
 *   · fichas POC del 2025-07-17 en bloque: es la fecha de la carga inicial de
 *     poc_devices, no prueba de movimiento (por eso la señal debe ser una
 *     ENTREGA real o una ficha posterior a esa carga).
 *
 * El contrato del cliente nuevo se amarra solo si el serial está declarado en
 * uno suyo vigente; si no, la unidad queda como custodia sin contrato — que es
 * la verdad y además la hace aparecer en la deuda de regularización.
 *
 * USAGE (desde functions/):
 *   node scripts/repunta-seriales-cliente-actual.js [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const pool = require("../src/domain/equiposPool");
const { mejorFechaInicio } = require("../src/lib/vigencia");

const dryRun = !process.argv.includes("--write");
const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
const f = (t) => {
  const d = t?.toDate ? t.toDate() : (t instanceof Date ? t : null);
  return d ? d.toISOString().slice(0, 10) : "—";
};
const N = (s, n) => String(s || "—").slice(0, n);
// Carga inicial masiva de poc_devices: una ficha con ESTA fecha no prueba nada.
const CARGA_POC = Date.parse("2025-07-18T00:00:00Z");

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const nom = new Map(), inactivos = new Map();
  (await db.collection("clientes").get()).forEach((d) => {
    const v = d.data();
    nom.set(d.id, v.nombre || d.id);
    if (v.deleted !== true && v.activo === false) inactivos.set(d.id, v.nombre || d.id);
  });

  const objetivo = new Map();
  (await db.collection("equipos_pool").get()).forEach((d) => {
    const v = d.data();
    if (!["en_cliente", "asignado_contrato"].includes(String(v.estado || ""))) return;
    const cid = v.asignacion?.cliente_id;
    if (!cid || !inactivos.has(cid)) return;
    objetivo.set(pool.normSerial(v.serial || d.id), {
      ref: d.ref, serial: v.serial || d.id, estado: v.estado, viejoCid: cid, viejo: inactivos.get(cid),
      contratoDocId: v.asignacion?.contrato_doc_id || null, modelo: v.modelo_label || "",
    });
  });

  const porDoc = new Map(), porCliente = new Map();
  (await db.collection("contratos").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    porDoc.set(d.id, { id: d.id, ...v });
    if (!porCliente.has(v.cliente_id)) porCliente.set(v.cliente_id, []);
    porCliente.get(v.cliente_id).push({ id: d.id, ...v });
  });
  // Seriales declarados por contrato, para amarrar al llegar al cliente nuevo.
  const declarado = new Map();   // serial_norm -> [contrato]
  (await db.collectionGroup("seriales").get()).forEach((d) => {
    const v = d.data();
    const k = pool.normSerial(v.serial || "");
    if (!objetivo.has(k)) return;
    if (!declarado.has(k)) declarado.set(k, []);
    declarado.get(k).push(v.contrato_doc_id || d.ref.parent.parent.id);
  });

  const pocActiva = new Map();
  (await db.collection("poc_devices").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted === true || v.activo === false) return;
    const k = pool.normSerial(v.serial || "");
    if (!objetivo.has(k)) return;
    const cur = { cid: v.cliente_id || "", cli: v.cliente_nombre || v.cliente || "", at: ms(v.created_at || v.updated_at), fecha: f(v.created_at || v.updated_at) };
    const p = pocActiva.get(k);
    if (!p || cur.at > p.at) pocActiva.set(k, cur);
  });
  const entrega = new Map();
  (await db.collection("ordenes_de_servicio").get()).forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    if (String(v.estado_reparacion || "").toUpperCase() !== "ENTREGADO AL CLIENTE") return;
    for (const e of (v.equipos || [])) {
      const k = pool.normSerial(e.numero_de_serie || e.serial || "");
      if (!objetivo.has(k)) continue;
      const at = ms(v.fecha_salida || v.fecha_entrada || v.fecha_creacion);
      const cur = { id: d.id, numero: v.numero_orden || d.id, cid: v.cliente_id || "", cli: v.cliente || "", at, fecha: f(v.fecha_salida || v.fecha_entrada || v.fecha_creacion) };
      const p = entrega.get(k);
      if (!p || at > p.at) entrega.set(k, cur);
    }
  });

  const mover = [], descartados = [];
  for (const [k, o] of objetivo) {
    const e = entrega.get(k), p = pocActiva.get(k);
    // Señal de destino: la ENTREGA manda; una ficha POC solo vale si es
    // posterior a la carga inicial.
    const sig = (e && e.cid && e.cid !== o.viejoCid) ? { tipo: `OS ${e.numero}`, ...e }
      : (p && p.cid && p.cid !== o.viejoCid && p.at >= CARGA_POC) ? { tipo: "ficha POC", ...p } : null;
    if (!sig) continue;

    let cViejo = o.contratoDocId ? porDoc.get(o.contratoDocId) : null;
    if (!cViejo) {
      cViejo = (porCliente.get(o.viejoCid) || []).slice()
        .sort((a, b) => ms(b.fecha_creacion) - ms(a.fecha_creacion))[0] || null;
    }
    const ini = cViejo ? mejorFechaInicio(cViejo) : { fecha: null, fuente: null };
    const destino = sig.cli || nom.get(sig.cid) || sig.cid;

    let motivo = null;
    if (!ini.fecha) motivo = "el cliente viejo no tiene contrato con qué comparar";
    else if (!sig.at) motivo = "la señal no trae fecha";
    else if (sig.at <= ini.fecha.getTime()) {
      motivo = `la entrega (${sig.fecha}) es ANTERIOR al contrato ${cViejo.contrato_id} (${f(ini.fecha)} por ${ini.fuente})`;
    }
    if (motivo) { descartados.push({ o, sig, destino, motivo }); continue; }

    // ¿Algún contrato vigente del cliente nuevo ya lo declara?
    const docsDecl = declarado.get(k) || [];
    const cNuevo = (porCliente.get(sig.cid) || [])
      .filter((c) => docsDecl.includes(c.id) && ["activo", "aprobado"].includes(String(c.estado || "")))
      .sort((a, b) => ms(b.fecha_creacion) - ms(a.fecha_creacion))[0] || null;
    mover.push({ o, sig, destino, cViejo, ini, cNuevo });
  }

  console.log(`═══ ${mover.length} a repuntar ═══`);
  for (const m of mover) {
    console.log(`  ${m.o.serial.padEnd(14)} ${N(m.o.modelo, 16).padEnd(17)} ${N(m.o.viejo, 26).padEnd(27)} → ${N(m.destino, 34).padEnd(35)} ${m.sig.tipo} ${m.sig.fecha} > ${m.cViejo.contrato_id} ${f(m.ini.fecha)}${m.cNuevo ? `   [amarra a ${m.cNuevo.contrato_id}]` : "   [custodia sin contrato]"}`);
  }
  console.log(`\n═══ ${descartados.length} NO se tocan ═══`);
  for (const d of descartados) {
    console.log(`  ⚠ ${d.o.serial.padEnd(14)} ${N(d.o.viejo, 26).padEnd(27)} señal → ${N(d.destino, 30).padEnd(31)} ${d.motivo}`);
  }

  if (dryRun || !mover.length) return;

  let ok = 0;
  for (const m of mover) {
    const asignacion = {
      cliente_id: m.sig.cid,
      cliente_nombre: m.destino,
      contrato_doc_id: m.cNuevo ? m.cNuevo.id : null,
      contrato_id: m.cNuevo ? (m.cNuevo.contrato_id || "") : "",
    };
    // Sin contrato nuevo la unidad no puede quedar 'asignado_contrato': es
    // custodia del cliente, que es justo lo que la regularización persigue.
    const estado = m.cNuevo ? m.o.estado : "en_cliente";
    await m.o.ref.set({
      estado, asignacion,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await m.o.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null,
      tipo: "correccion_asignacion",
      de_estado: m.o.estado, a_estado: estado,
      ref: m.sig.id ? { tipo: "orden", id: m.sig.id, label: m.sig.numero } : null,
      notas: `Correccion 2026-09-14: el pool lo daba con ${m.o.viejo}; ${m.sig.tipo} del ${m.sig.fecha} lo pone con ${m.destino}, despues del contrato ${m.cViejo.contrato_id} (${f(m.ini.fecha)})`,
    });
    ok++;
  }
  console.log(`\n✅ ${ok} serial(es) repuntados.`);
})().catch((e) => { console.error(e); process.exit(1); });
