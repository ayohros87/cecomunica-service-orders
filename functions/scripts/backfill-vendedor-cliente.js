/**
 * backfill-vendedor-cliente.js — el dueño de la cuenta (2026-09-11)
 *
 * `clientes.vendedor_asignado` quedaba vacío porque el alta vivía en un
 * formulario sin ese campo, y además el payload canónico lo BORRABA en cada
 * edición hecha desde ahí. Sin dueño el cliente no aparece en "Mi cartera" del
 * Centro y su propio vendedor no puede ni abrirlo (candado de cartera).
 *
 * Regla (Alberto 2026-09-11): el vendedor de la cuenta es QUIEN ELABORÓ EL
 * CONTRATO — `contratos.creado_por_uid`, la misma fuente que ya usa el vendedor
 * de la orden (ver memoria vendedor-orden-contrato). Si hay varios contratos
 * con distinto elaborador, manda el MÁS RECIENTE.
 *
 * Solo RELLENA huecos: nunca pisa un vendedor_asignado que ya existe (esos
 * salen listados aparte para que los decida una persona).
 *
 * Fuentes, en orden, y solo si la anterior no dio nada:
 *   1. contrato más reciente → creado_por_uid          [contrato]
 *   2. gestión del cliente   → responsable_uid         [gestion]
 *   3. cotización            → vendedor_uid/creado_por_uid  [cotizacion]
 *   4. alta de la ficha      → created_by, si ese rol vende [alta]
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-vendedor-cliente.js                 (dry-run)
 *   node scripts/backfill-vendedor-cliente.js --apply
 *   node scripts/backfill-vendedor-cliente.js --apply --solo-contrato
 *   node scripts/backfill-vendedor-cliente.js --apply --corregir-no-vende
 *
 * --solo-contrato      ignora las fuentes 2-4 (solo el elaborador del contrato)
 * --corregir-no-vende  además REEMPLAZA el vendedor de las fichas cuyo dueño
 *                      actual tiene un rol que no vende (p. ej. recepción),
 *                      cuando el contrato dice quién fue el vendedor real.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const SOLO_CONTRATO = process.argv.includes("--solo-contrato");
const CORREGIR_NO_VENDE = process.argv.includes("--corregir-no-vende");

// Quién puede figurar como vendedor de una cuenta: el mismo criterio que
// UsuariosService.getVendedores() en el front (vendedor + administrador).
const ROLES_VENDEN = ["vendedor", "administrador"];

// Fecha comparable de un contrato (los docs viejos traen fecha_creacion).
function cuando(k) {
  const t = k.created_at || k.fecha_creacion || k.fecha || null;
  if (!t) return 0;
  if (typeof t.toMillis === "function") return t.toMillis();
  const d = new Date(t);
  return isNaN(d) ? 0 : d.getTime();
}

(async () => {
  const [cs, us, ks, gs, qs] = await Promise.all([
    db.collection("clientes").get(),
    db.collection("usuarios").get(),
    db.collection("contratos").get(),
    db.collection("gestiones").get(),
    db.collection("cotizaciones").get(),
  ]);

  const U = new Map();
  us.forEach(d => U.set(d.id, d.data()));
  const rolDe  = uid => (U.get(uid) || {}).rol || "(sin usuario)";
  const mailDe = uid => (U.get(uid) || {}).email || uid;
  const vende  = uid => ROLES_VENDEN.includes(rolDe(uid));

  // Contratos por cliente, del más reciente al más viejo.
  const porCliente = new Map();
  ks.forEach(d => {
    const k = d.data();
    if (!k.cliente_id || !k.creado_por_uid) return;
    if (!porCliente.has(k.cliente_id)) porCliente.set(k.cliente_id, []);
    porCliente.get(k.cliente_id).push({ uid: k.creado_por_uid, num: k.contrato_id || d.id, ts: cuando(k) });
  });
  for (const arr of porCliente.values()) arr.sort((a, b) => b.ts - a.ts);

  const gestionPorCliente = new Map();
  gs.forEach(d => {
    const g = d.data();
    if (!g.cliente_id || !g.responsable_uid) return;
    if (!gestionPorCliente.has(g.cliente_id)) gestionPorCliente.set(g.cliente_id, g.responsable_uid);
  });
  const cotPorCliente = new Map();
  qs.forEach(d => {
    const q = d.data();
    const uid = q.vendedor_uid || q.creado_por_uid || null;
    if (!q.cliente_id || !uid) return;
    if (!cotPorCliente.has(q.cliente_id)) cotPorCliente.set(q.cliente_id, uid);
  });

  const aEscribir = [];          // {id, nombre, uid, email, fuente, detalle, antes}
  const discrepan = [];          // ficha con dueño ≠ elaborador del contrato
  const sinFuente = [];          // hueco que ningún rastro resuelve

  for (const d of cs.docs) {
    const c = d.data();
    if (c.deleted === true) continue;

    const contratos = porCliente.get(d.id) || [];
    const delContrato = contratos.length ? contratos[0] : null;

    if (c.vendedor_asignado) {
      const dueno = c.vendedor_asignado;
      if (delContrato && delContrato.uid !== dueno) {
        discrepan.push(`${c.nombre} | ficha: ${mailDe(dueno)} [${rolDe(dueno)}] | contrato ${delContrato.num}: ${mailDe(delContrato.uid)}`);
      }
      // El dueño actual no vende (recepción, técnico, usuario de baja) y el
      // contrato sí dice quién fue el vendedor: corregible con la bandera.
      if (!vende(dueno) && delContrato && vende(delContrato.uid) && CORREGIR_NO_VENDE) {
        aEscribir.push({ id: d.id, nombre: c.nombre, uid: delContrato.uid, email: mailDe(delContrato.uid),
                         fuente: "contrato", detalle: `contrato ${delContrato.num}`, antes: `${mailDe(dueno)} [${rolDe(dueno)}]` });
      }
      continue;
    }

    let elegido = null;
    if (delContrato) {
      elegido = { uid: delContrato.uid, fuente: "contrato", detalle: `contrato ${delContrato.num}` };
    } else if (!SOLO_CONTRATO) {
      const g = gestionPorCliente.get(d.id);
      const q = cotPorCliente.get(d.id);
      if (g) elegido = { uid: g, fuente: "gestion", detalle: "responsable de la gestión" };
      else if (q) elegido = { uid: q, fuente: "cotizacion", detalle: "vendedor de la cotización" };
      else if (c.created_by && vende(c.created_by)) elegido = { uid: c.created_by, fuente: "alta", detalle: "quien dio de alta la ficha" };
    }

    if (!elegido) { sinFuente.push(`${c.nombre}`); continue; }
    aEscribir.push({ id: d.id, nombre: c.nombre, uid: elegido.uid, email: mailDe(elegido.uid),
                     fuente: elegido.fuente, detalle: elegido.detalle, antes: null });
  }

  // ── Informe ──
  const porFuente = {};
  aEscribir.forEach(x => { porFuente[x.fuente] = (porFuente[x.fuente] || 0) + 1; });
  console.log(`\n${APPLY ? "APLICANDO" : "DRY-RUN"} — clientes vivos: ${cs.docs.filter(d => d.data().deleted !== true).length}`);
  console.log(`A escribir: ${aEscribir.length}`, porFuente);
  for (const x of aEscribir) {
    console.log(`  · ${x.nombre}  →  ${x.email}   (${x.detalle})${x.antes ? `   [antes: ${x.antes}]` : ""}`);
  }

  console.log(`\nSIN FUENTE — ${sinFuente.length} cliente(s) sin contrato, gestión ni cotización: hay que asignarlos a mano en la ficha.`);
  sinFuente.slice(0, 20).forEach(n => console.log(`  · ${n}`));
  if (sinFuente.length > 20) console.log(`  …y ${sinFuente.length - 20} más`);

  console.log(`\nREVISAR A MANO — ${discrepan.length} ficha(s) con un dueño DISTINTO al elaborador del contrato (no se tocan):`);
  discrepan.forEach(n => console.log(`  · ${n}`));

  if (!APPLY) { console.log("\nNada escrito. Repite con --apply.\n"); return; }

  let n = 0;
  for (let i = 0; i < aEscribir.length; i += 400) {
    const lote = db.batch();
    for (const x of aEscribir.slice(i, i + 400)) {
      lote.update(db.collection("clientes").doc(x.id), {
        vendedor_asignado: x.uid,
        vendedor_email: x.email,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: "script:backfill-vendedor-cliente",
      });
      n++;
    }
    await lote.commit();
  }
  console.log(`\nListo: ${n} ficha(s) con vendedor asignado.\n`);
})().catch(e => { console.error(e); process.exit(1); });
