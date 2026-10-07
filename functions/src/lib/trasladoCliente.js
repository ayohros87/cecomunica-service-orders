// trasladoCliente — mover un contrato (o la cuenta entera) a OTRA ficha de
// cliente, con todo lo que cuelga de él, sin scripts (plan de autoservicio
// 2026-10-07, P3: B2 "Trasladar contrato" y C1 "Cambio de razón social").
//
// Casos que lo originan:
//   · ACODECO → APC (2026-10-07): la renovación se hizo a la ficha de la
//     sigla; el cliente correcto ya tenía su contrato. Traslado del contrato +
//     anular por sustitución (declararSustitutoContrato) lo resuelve sin tocar
//     el pool a mano.
//   · MORENO → ASESORÍA, SECURITY MANAGEMENT → CVP (2026-10-06): cambio de
//     razón social. Se mueven contratos vivos, fichas PoC ACTIVAS y la custodia
//     del pool; la historia (órdenes cerradas, facturas) se queda con el nombre
//     viejo. Lección Moreno: una ficha PoC inactiva NO se mueve — queda por
//     confirmar con bodega.
//
// Todo escribe con el Admin SDK (los campos de cliente en el pool, el historial
// de la ficha y `clientes.activo` no son del navegador). Cada función devuelve
// cuentas y la lista de lo que NO movió, para que la UI lo diga.
"use strict";

const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");

const FV = admin.firestore.FieldValue;
const VIVOS = new Set(["pendiente_aprobacion", "aprobado", "activo"]);
const GESTIONES_ABIERTAS = new Set(["pendiente_aprobacion", "pendiente_cliente", "pendiente_firma", "pendiente_bodega", "en_proceso", "en_demo", "retorno"]);
const OS_ABIERTAS = new Set(["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO", "COMPLETADO (EN OFICINA)"]);

// Mismo cálculo que ContratosService.buildSearchTokens (frontend): prefijos
// de 2+ letras de cada palabra del nombre, más el número del contrato.
function tokensContrato({ cliente_nombre = "", contrato_id = "" } = {}) {
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const toks = new Set();
  norm(cliente_nombre).split(/[^a-z0-9]+/).filter(Boolean).forEach((p) => {
    for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
  });
  if (contrato_id) toks.add(String(contrato_id).toLowerCase());
  return Array.from(toks).slice(0, 200);
}

// La foto del cliente que viaja en el contrato (contratoTarifario.construirDoc).
// El representante NO se pisa: es quien firmó, y suele ser el correcto aunque
// la ficha fuera la equivocada.
function fotoCliente(destinoId, cli, contratoId) {
  const nombre = cli.nombre || "";
  return {
    cliente_id: destinoId,
    cliente_nombre: nombre,
    cliente_nombre_lower: nombre.toLowerCase(),
    searchTokens: tokensContrato({ cliente_nombre: nombre, contrato_id: contratoId }),
    cliente_direccion: cli.direccion || "",
    cliente_telefono: cli.telefono || "",
    cliente_ruc: cli.ruc || "",
    cliente_dv: cli.dv || "",
    cliente_rucdv: (cli.ruc || "") + (cli.dv ? " - DV" + cli.dv : ""),
  };
}

async function escribirEnLotes(ops) {
  // ops: [{ ref, data, merge }] — set con merge; lotes de 400.
  for (let i = 0; i < ops.length; i += 400) {
    const b = db.batch();
    for (const op of ops.slice(i, i + 400)) b.set(op.ref, op.data, { merge: true });
    await b.commit();
  }
}

/**
 * Reapunta UN contrato (y lo que cuelga de él) a otra ficha de cliente.
 * No cambia su número ni su estado. Devuelve cuentas.
 */
async function repuntarContrato({ contratoId, contrato, destinoId, destino, usuario, motivo = "", origenNombre = "" }) {
  const numero = contrato.contrato_id || contratoId;
  const foto = fotoCliente(destinoId, destino, numero);
  const now = FV.serverTimestamp();
  const res = { contrato: numero, seriales: 0, pool: 0, poc: 0, ordenes: 0, gestiones: 0, avisos: 0 };
  const nota = `Contrato ${numero} trasladado de ${origenNombre || contrato.cliente_nombre || contrato.cliente_id} a ${destino.nombre || destinoId}${motivo ? ` — ${motivo}` : ""}`;

  // 1) El contrato.
  await db.collection("contratos").doc(contratoId).set({
    ...foto,
    traslado_cliente: { de_id: contrato.cliente_id || null, de_nombre: contrato.cliente_nombre || origenNombre || "", a_id: destinoId, a_nombre: destino.nombre || "", at: now, por: usuario, motivo: String(motivo || "").slice(0, 300) },
    fecha_modificacion: now,
  }, { merge: true });

  // 2) Filas de seriales (llevan cliente_id/nombre).
  const filas = await db.collection("contratos").doc(contratoId).collection("seriales").get();
  const ops = [];
  for (const d of filas.docs) ops.push({ ref: d.ref, data: { cliente_id: destinoId, cliente_nombre: destino.nombre || "", updated_at: now } });
  res.seriales = filas.size;

  // 3) Pool: fichas amarradas a este contrato → custodia del destino, con kardex.
  const pool = await db.collection("equipos_pool").where("asignacion.contrato_doc_id", "==", contratoId).get();
  for (const d of pool.docs) {
    const a = d.data().asignacion || {};
    ops.push({ ref: d.ref, data: { asignacion: { ...a, cliente_id: destinoId, cliente_nombre: destino.nombre || "" }, updated_at: now } });
    ops.push({ ref: d.ref.collection("movimientos").doc(), data: {
      at: now, por: usuario, por_email: usuario, tipo: "correccion_titular", de_estado: null, a_estado: null,
      ref: { tipo: "contrato", id: contratoId, label: numero }, notas: nota,
    } });
    res.pool++;
  }

  // 4) Fichas PoC del contrato (activas o no: siguen al contrato).
  const poc = await db.collection("poc_devices").where("contrato_doc_id", "==", contratoId).get();
  for (const d of poc.docs) {
    if (d.data().deleted === true) continue;
    ops.push({ ref: d.ref, data: { cliente: destino.nombre || "", cliente_id: destinoId, cliente_anterior: d.data().cliente || d.data().cliente_nombre || origenNombre || "", updated_at: now, updated_by_email: usuario } });
    ops.push({ ref: db.collection("poc_logs").doc(), data: {
      equipo_id: d.id, fecha: now, usuario, accion: "editar", origen: "sistema",
      motivo: nota, cambios: { antes: { cliente: d.data().cliente || "", cliente_id: d.data().cliente_id || "" }, despues: { cliente: destino.nombre || "", cliente_id: destinoId } },
    } });
    res.poc++;
  }

  // 5) Órdenes ABIERTAS bajo el contrato. Las cerradas son historia.
  const os = await db.collection("ordenes_de_servicio").where("contrato.contrato_doc_id", "==", contratoId).get();
  for (const d of os.docs) {
    const o = d.data();
    if (o.eliminado === true || !OS_ABIERTAS.has(String(o.estado_reparacion || "").toUpperCase())) continue;
    ops.push({ ref: d.ref, data: { cliente_id: destinoId, cliente: destino.nombre || "", cliente_nombre: destino.nombre || "",
      os_logs: FV.arrayUnion({ action: "TRASLADO_CLIENTE", by: usuario, at: admin.firestore.Timestamp.now(), nota }) } });
    res.ordenes++;
  }

  // 6) Gestiones abiertas que nombran este contrato.
  const gs = await db.collection("gestiones").where("contratos_afectados", "array-contains", contratoId).get().catch(() => ({ docs: [] }));
  for (const d of gs.docs) {
    const g = d.data();
    if (!GESTIONES_ABIERTAS.has(g.estado) || g.cliente_id === destinoId) continue;
    ops.push({ ref: d.ref, data: { cliente_id: destinoId, cliente_nombre: destino.nombre || "", traslado_cliente_at: now } });
    res.gestiones++;
  }

  // 7) Avisos de facturación del contrato (todos: la factura va al titular real).
  const av = await db.collection("facturacion_avisos").where("contrato_doc_id", "==", contratoId).get();
  for (const d of av.docs) {
    ops.push({ ref: d.ref, data: { cliente_id: destinoId, cliente_nombre: destino.nombre || "", updated_at: now } });
    res.avisos++;
  }

  await escribirEnLotes(ops);
  logger.info("[trasladoCliente] contrato repuntado", { contratoId, numero, destinoId, ...res });
  return res;
}

/** Historial de la ficha (admin): el navegador no puede escribirlo. */
async function anotarHistorial(clienteId, { tipo, nota, por_uid = null, extra = {} }) {
  await db.collection("clientes").doc(clienteId).collection("historial").add({
    tipo, nota, ...extra, por_uid, at: FV.serverTimestamp(),
  }).catch((e) => logger.warn("[trasladoCliente] historial no escrito", { clienteId, message: e.message }));
}

/**
 * Traslada la CUENTA: contratos vivos, fichas PoC activas, custodia del pool,
 * gestiones y avisos abiertos, catálogo PoC. Deja la ficha vieja inactiva con
 * `trasladado_a`. Devuelve cuentas y lo que quedó por confirmar.
 */
async function trasladarCuenta({ origenId, origen, destinoId, destino, usuario, uid = null, motivo = "" }) {
  const now = FV.serverTimestamp();
  const res = { contratos: [], poc: 0, pool: 0, gestiones: 0, avisos: 0, poc_grupos: 0, por_confirmar: [] };
  const nota = `Cambio de razón social / traslado de cuenta: ${origen.nombre || origenId} → ${destino.nombre || destinoId}${motivo ? ` — ${motivo}` : ""}`;

  // 1) Contratos vivos (los anulados/vencidos/renovados son historia).
  const cs = await db.collection("contratos").where("cliente_id", "==", origenId).get();
  const movidos = new Set();
  for (const d of cs.docs) {
    const c = d.data();
    if (c.deleted === true || !VIVOS.has(String(c.estado || ""))) continue;
    const r = await repuntarContrato({ contratoId: d.id, contrato: c, destinoId, destino, usuario, motivo, origenNombre: origen.nombre || "" });
    res.contratos.push(r);
    movidos.add(d.id);
  }

  // 2) Fichas PoC ACTIVAS a nombre de la cuenta vieja (por id o, en legacy,
  //    por nombre). Las inactivas quedan por confirmar (lección Moreno).
  const ops = [];
  const vistos = new Set();
  const snaps = [await db.collection("poc_devices").where("cliente_id", "==", origenId).get()];
  if (origen.nombre) snaps.push(await db.collection("poc_devices").where("cliente", "==", origen.nombre).get());
  const serialesMovidos = new Set();
  for (const s of snaps) {
    for (const d of s.docs) {
      if (vistos.has(d.id)) continue;
      vistos.add(d.id);
      const p = d.data();
      if (p.deleted === true) continue;
      if (p.cliente_id === destinoId) continue;                       // ya la movió el contrato
      if (p.cliente_id && p.cliente_id !== origenId) continue;      // de otra cuenta
      if (p.activo === false) { res.por_confirmar.push({ serial: p.serial || d.id, motivo: "ficha PoC inactiva: confirmar con bodega dónde está" }); continue; }
      ops.push({ ref: d.ref, data: { cliente: destino.nombre || "", cliente_id: destinoId, cliente_anterior: p.cliente || origen.nombre || "", updated_at: now, updated_by_email: usuario } });
      ops.push({ ref: db.collection("poc_logs").doc(), data: {
        equipo_id: d.id, fecha: now, usuario, accion: "editar", origen: "sistema", motivo: nota,
        cambios: { antes: { cliente: p.cliente || "", cliente_id: p.cliente_id || "" }, despues: { cliente: destino.nombre || "", cliente_id: destinoId } },
      } });
      if (p.serial) serialesMovidos.add(String(p.serial).toUpperCase().replace(/[^A-Z0-9]/g, ""));
      res.poc++;
    }
  }

  // 3) Custodia del pool a nombre de la vieja: se mueve si cuelga de un
  //    contrato movido (ya lo hizo repuntarContrato) o si su ficha PoC activa
  //    se movió; el resto queda por confirmar.
  const pool = await db.collection("equipos_pool").where("asignacion.cliente_id", "==", origenId).get();
  for (const d of pool.docs) {
    const u = d.data();
    const a = u.asignacion || {};
    if (a.contrato_doc_id && movidos.has(a.contrato_doc_id)) continue;          // ya movido con el contrato
    const sn = String(u.serial_norm || u.serial || d.id).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!serialesMovidos.has(sn) || !["en_cliente", "por_clasificar"].includes(u.estado)) {
      res.por_confirmar.push({ serial: u.serial || d.id, motivo: `${u.estado || "?"} a nombre de la cuenta vieja sin contrato vivo ni ficha PoC activa` });
      continue;
    }
    ops.push({ ref: d.ref, data: { asignacion: { ...a, cliente_id: destinoId, cliente_nombre: destino.nombre || "" }, updated_at: now } });
    ops.push({ ref: d.ref.collection("movimientos").doc(), data: {
      at: now, por: usuario, por_email: usuario, tipo: "correccion_titular", de_estado: null, a_estado: null,
      ref: { tipo: "cliente", id: destinoId, label: destino.nombre || "" }, notas: nota,
    } });
    res.pool++;
  }

  // 4) Gestiones y avisos abiertos a nombre de la vieja (sin contrato movido).
  const gs = await db.collection("gestiones").where("cliente_id", "==", origenId).get();
  for (const d of gs.docs) {
    if (!GESTIONES_ABIERTAS.has(d.data().estado)) continue;
    ops.push({ ref: d.ref, data: { cliente_id: destinoId, cliente_nombre: destino.nombre || "", traslado_cliente_at: now } });
    res.gestiones++;
  }
  const av = await db.collection("facturacion_avisos").where("cliente_id", "==", origenId).get();
  for (const d of av.docs) {
    if (["descartado", "no_aplica", "facturada"].includes(d.data().estado)) continue;
    ops.push({ ref: d.ref, data: { cliente_id: destinoId, cliente_nombre: destino.nombre || "", updated_at: now } });
    res.avisos++;
  }

  // 5) Catálogo PoC: unión de grupos; prefijo si el destino no tiene.
  const gruposDest = Array.isArray(destino.poc_grupos) ? destino.poc_grupos : [];
  const union = gruposDest.slice();
  for (const g of (Array.isArray(origen.poc_grupos) ? origen.poc_grupos : [])) if (g && !union.includes(g)) union.push(g);
  const patchDestino = { updated_at: now, updated_by: uid || null, trasladado_de: FV.arrayUnion(origenId) };
  if (union.length !== gruposDest.length) { patchDestino.poc_grupos = union.sort((a, b) => a.localeCompare(b, "es")); res.poc_grupos = union.length - gruposDest.length; }
  if (!destino.poc_grupo_prefix && origen.poc_grupo_prefix) patchDestino.poc_grupo_prefix = origen.poc_grupo_prefix;
  for (const k of ["ip", "vendedor_asignado", "vendedor_email", "direccion", "telefono", "email", "email_acuses"]) {
    if (!destino[k] && origen[k]) patchDestino[k] = origen[k];
  }
  ops.push({ ref: db.collection("clientes").doc(destinoId), data: patchDestino });

  await escribirEnLotes(ops);

  // 6) La ficha vieja: inactiva, apuntando a la nueva. DESPUÉS de repuntar los
  //    contratos (onClienteDesactivado cierra los que sigan apuntándole).
  await db.collection("clientes").doc(origenId).set({
    activo: false, trasladado_a: destinoId, trasladado_a_nombre: destino.nombre || "", trasladado_at: now, trasladado_por: usuario,
    trasladado_motivo: String(motivo || "").slice(0, 300), updated_at: now, updated_by: uid || null,
  }, { merge: true });

  await anotarHistorial(origenId, { tipo: "traslado_cuenta", por_uid: uid, nota: `${nota}. ${res.contratos.length} contrato(s), ${res.poc} ficha(s) PoC, ${res.pool} radio(s) en custodia, ${res.gestiones} gestión(es), ${res.avisos} aviso(s).`, extra: { destino_id: destinoId, por_confirmar: res.por_confirmar.slice(0, 50) } });
  await anotarHistorial(destinoId, { tipo: "traslado_cuenta", por_uid: uid, nota: `Recibe la cuenta de ${origen.nombre || origenId}: ${res.contratos.map((c) => c.contrato).join(", ") || "sin contratos vivos"}; ${res.poc} ficha(s) PoC, ${res.pool} radio(s) en custodia.`, extra: { origen_id: origenId } });
  logger.info("[trasladoCliente] cuenta trasladada", { origenId, destinoId, usuario, contratos: res.contratos.length, poc: res.poc, pool: res.pool, porConfirmar: res.por_confirmar.length });
  return res;
}

module.exports = { repuntarContrato, trasladarCuenta, anotarHistorial, tokensContrato, VIVOS };
