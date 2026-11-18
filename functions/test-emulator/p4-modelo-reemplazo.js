// Integración de proponerModeloSinFicha y regularizarReemplazoOrden (núcleos
// `ejecutar`) contra el emulador de Firestore (8080):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test-emulator/p4-modelo-reemplazo.js
// Vive FUERA de test/ para que `npm test` no lo levante.
//
// Qué protege (plan de autoservicio 2026-10-07, P4):
//   D1 · la propuesta sale del contrato (alta), de las órdenes (alta, y
//        ambigua si se contradicen), o del prefijo del serial (media, solo con
//        ≥10 fichas y ≥90 %); "PNC360" se lee como PNC360S; la fila N/R sigue
//        la condición de la ficha; sin pista no se inventa nada.
//   E1 · el reemplazo a posteriori crea la gestión GR cerrada ligada a la
//        orden, el entrante queda con el cliente en el contrato del saliente
//        con reemplaza_a, el saliente sale a revisión (o pendiente de
//        devolución si el cliente se lo quedó); candados: orden con gestión,
//        serial fuera de la orden, entrante con otro cliente.
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
admin.initializeApp({ projectId: "demo-p4-modelo-reemplazo" });
const proponer = require("../src/callable/proponerModeloSinFicha");
const regularizar = require("../src/callable/regularizarReemplazoOrden");
const { catalogo } = require("../src/domain/modeloCatalogo");
const db = admin.firestore();

async function borrarColeccion(ref) {
  for (const d of (await ref.get()).docs) {
    for (const sub of await d.ref.listCollections()) await borrarColeccion(sub);
    await d.ref.delete();
  }
}
async function limpiar() {
  for (const c of ["modelos", "equipos_pool", "contratos", "ordenes_de_servicio", "gestiones", "contadores"]) await borrarColeccion(db.collection(c));
}
const rechaza = async (fn, args, re) => {
  let err = null;
  try { await fn({ usuario: "test@x", ...args }); } catch (e) { err = e; }
  assert.ok(err, `debía rechazar: ${JSON.stringify(args)}`);
  assert.match(String(err.message), re);
};
const ficha = (id, extra = {}) => db.collection("equipos_pool").doc(id).set({ serial: id, serial_norm: id, modelo_id: null, modelo_label: "", estado: "en_cliente", origen: "migracion_poc", ...extra });

(async () => {
  await limpiar();
  // Catálogo: PNC360S (N) con su -R, y PNC460 (N).
  await db.collection("modelos").doc("m360").set({ modelo: "PNC360S", marca: "HYTERA", estado: "N", activo: true });
  await db.collection("modelos").doc("m360r").set({ modelo: "PNC360S-R", marca: "HYTERA", estado: "R", activo: true, variante_de: "m360" });
  await db.collection("modelos").doc("m460").set({ modelo: "PNC460", marca: "HYTERA", estado: "N", activo: true });
  await catalogo({ force: true });

  // ── D1 ──
  // A: evidencia del contrato (texto viejo "PNC360", condición reuso → fila R).
  await db.collection("contratos").doc("c1").set({ contrato_id: "ALQ-1", cliente_id: "cli" });
  await db.collection("contratos").doc("c1").collection("seriales").doc("x").set({ serial: "24220A0001", modelo: "PNC360", modelo_id: null });
  await ficha("24220A0001", { condicion: "reuso", asignacion: { contrato_doc_id: "c1", contrato_id: "ALQ-1", cliente_id: "cli" } });
  // B: evidencia de órdenes (dos órdenes, misma familia).
  await db.collection("ordenes_de_servicio").doc("2026010101").set({ searchTokens: ["24220a0002"], equipos: [{ numero_de_serie: "24220A0002", modelo: "HYTERA PNC360S" }] });
  await db.collection("ordenes_de_servicio").doc("2026010102").set({ searchTokens: ["24220a0002"], equipos: [{ numero_de_serie: "24220A0002", modelo: "PNC360S-R" }] });
  await ficha("24220A0002", { condicion: "nuevo" });
  // C: órdenes que se contradicen (familias distintas) → ambigua.
  await db.collection("ordenes_de_servicio").doc("2026010103").set({ searchTokens: ["24220a0003"], equipos: [{ numero_de_serie: "24220A0003", modelo: "PNC360S" }] });
  await db.collection("ordenes_de_servicio").doc("2026010104").set({ searchTokens: ["24220a0003"], equipos: [{ numero_de_serie: "24220A0003", modelo: "PNC460" }] });
  await ficha("24220A0003");
  // D: prefijo con mayoría: 12 fichas 25219A* con modelo PNC460 y una sin modelo.
  for (let i = 0; i < 12; i++) await db.collection("equipos_pool").doc(`25219A00${String(i).padStart(2, "0")}`).set({ serial: `25219A00${String(i).padStart(2, "0")}`, serial_norm: `25219A00${String(i).padStart(2, "0")}`, modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_bodega" });
  await ficha("25219A0099");
  // E: prefijo sin mayoría (pocas fichas) → sin pista.
  await ficha("ZZ999A0001");
  // F: ya tiene modelo → "ya tiene modelo".
  await ficha("24220A0009", { modelo_id: "m360", modelo_label: "HYTERA PNC360S" });

  const r = await proponer.ejecutar({ ids: ["24220A0001", "24220A0002", "24220A0003", "25219A0099", "ZZ999A0001", "24220A0009"] });
  const por = Object.fromEntries(r.propuestas.map((p) => [p.id, p]));
  assert.equal(por["24220A0001"].modelo_id, "m360r", "contrato + reuso → fila R (y PNC360 se lee como PNC360S)");
  assert.equal(por["24220A0001"].fuente, "contrato");
  assert.equal(por["24220A0002"].modelo_id, "m360", "órdenes de la misma familia + nuevo → fila N");
  assert.equal(por["24220A0002"].fuente, "orden");
  assert.ok(r.ambiguas.some((a) => a.id === "24220A0003"), "órdenes que se contradicen → ambigua");
  assert.equal(por["25219A0099"].modelo_id, "m460", "prefijo con mayoría → la familia");
  assert.equal(por["25219A0099"].confianza, "media");
  assert.ok(r.sinPista.some((s) => s.id === "ZZ999A0001"), "sin evidencia no se inventa");
  assert.ok(r.sinPista.some((s) => s.id === "24220A0009" && /ya tiene/.test(s.motivo)));
  assert.equal(proponer._textoConAlias("PNC360R"), "PNC360S-R");
  console.log("  ok   D1 propuestas: contrato, órdenes, ambigua, prefijo, sin pista");

  // ── E1 ──
  await db.collection("contratos").doc("c2").set({ contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" });
  await db.collection("equipos_pool").doc("SAL001").set({ serial: "SAL001", serial_norm: "SAL001", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente",
    asignacion: { contrato_doc_id: "c2", contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("ENT001").set({ serial: "ENT001", serial_norm: "ENT001", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_bodega" });
  await db.collection("equipos_pool").doc("AJENO1").set({ serial: "AJENO1", serial_norm: "AJENO1", modelo_id: "m460", modelo_label: "HYTERA PNC460", estado: "en_cliente", asignacion: { cliente_id: "otro", cliente_nombre: "OTRO" } });
  await db.collection("ordenes_de_servicio").doc("2026092403").set({ estado_reparacion: "ENTREGADO AL CLIENTE", cliente_id: "cli", cliente_nombre: "LIGO", tipo_de_servicio: "PROGRAMACION",
    equipos: [{ id: "e1", numero_de_serie: "SAL001", modelo: "PNC360S" }, { id: "e2", numero_de_serie: "ENT001", modelo: "PNC460" }, { id: "e3", numero_de_serie: "AJENO1", modelo: "PNC460" }] });
  await db.collection("ordenes_de_servicio").doc("2026092404").set({ estado_reparacion: "ASIGNADO", cliente_id: "cli", gestion: { id: "GR-X" }, equipos: [] });

  await rechaza(regularizar.ejecutar, { ordenId: "2026092404", serialSaliente: "A", serialEntrante: "B" }, /ya pertenece a la gestión/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "NOPE" }, /no está en la orden/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "AJENO1" }, /figura con OTRO/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "SAL001" }, /mismo serial/);
  console.log("  ok   E1 candados");

  const re = await regularizar.ejecutar({ usuario: "recep@x", uid: "rec", ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "ENT001", salienteEnCasa: true, motivo: "falló en la programación" });
  assert.equal(re.ok, true);
  assert.match(re.gestion_id, /^GR\d{8}-01$/);
  assert.equal(re.cambio_modelo, true, "PNC360S → PNC460 es cambio de familia");
  const g = (await db.collection("gestiones").doc(re.gestion_id).get()).data();
  assert.equal(g.tipo, "reemplazo"); assert.equal(g.estado, "cerrada"); assert.equal(g.regularizada, true);
  assert.equal(g.ordenes.programacion_id, "2026092403");
  assert.equal(g.items[0].serial_saliente, "SAL001"); assert.equal(g.items[0].serial_nuevo, "ENT001");
  assert.equal(g.items[0].contrato_doc_id, "c2");
  assert.equal(g.cambio_modelo.SAL001.tarifa, "se_mantiene");
  assert.deepEqual(g.cierre, { aprobacion: true, asignacion: true, programacion: true, entrega: true, entrada: true });
  assert.equal((await db.collection("gestiones").doc(re.gestion_id).collection("mapeos").get()).size, 1);
  const o = (await db.collection("ordenes_de_servicio").doc("2026092403").get()).data();
  assert.equal(o.gestion.id, re.gestion_id); assert.equal(o.gestion.regularizada, true);
  const ent = (await db.collection("equipos_pool").doc("ENT001").get()).data();
  assert.equal(ent.estado, "en_cliente", "el entrante queda con el cliente");
  assert.equal(ent.asignacion.contrato_doc_id, "c2", "en el contrato del saliente");
  assert.equal(ent.reemplaza_a, "SAL001");
  assert.equal(ent.reemplazo_origen.gestion_id, re.gestion_id);
  const sal = (await db.collection("equipos_pool").doc("SAL001").get()).data();
  assert.equal(sal.estado, "devuelto_revision", "el saliente en casa sale a revisión");
  assert.equal(sal.asignacion, null, "y sale del contrato");
  const movs = (await db.collection("equipos_pool").doc("SAL001").collection("movimientos").get()).docs.map((d) => d.data().tipo);
  assert.deepEqual(movs, ["reemplazo"]);
  await rechaza(regularizar.ejecutar, { ordenId: "2026092403", serialSaliente: "SAL001", serialEntrante: "ENT001" }, /ya pertenece a la gestión/);
  console.log("  ok   E1 reemplazo a posteriori: gestión, orden, entrante y saliente");

  // Saliente que el cliente se quedó: pendiente de devolución, sin mover.
  await db.collection("equipos_pool").doc("SAL002").set({ serial: "SAL002", serial_norm: "SAL002", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("ENT002").set({ serial: "ENT002", serial_norm: "ENT002", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("ordenes_de_servicio").doc("2026092405").set({ estado_reparacion: "ENTREGADO AL CLIENTE", cliente_id: "cli", cliente_nombre: "LIGO", equipos: [{ numero_de_serie: "SAL002" }, { numero_de_serie: "ENT002" }] });
  const r2 = await regularizar.ejecutar({ usuario: "recep@x", ordenId: "2026092405", serialSaliente: "SAL002", serialEntrante: "ENT002", salienteEnCasa: false, motivo: "el cliente se quedó el dañado" });
  assert.equal(r2.cambio_modelo, false);
  const sal2 = (await db.collection("equipos_pool").doc("SAL002").get()).data();
  assert.equal(sal2.estado, "en_cliente"); assert.equal(sal2.pendiente_devolucion, true);
  assert.equal((await db.collection("equipos_pool").doc("ENT002").get()).data().reemplaza_a, "SAL002");
  console.log("  ok   E1 saliente con el cliente: pendiente de devolución");

  // Visita técnica (2026-11-18, MACELLO): cambio en sitio con un radio que el
  // técnico llevaba (NO está en la orden), visita ya cerrada, varios cambios.
  await db.collection("equipos_pool").doc("VSAL1").set({ serial: "VSAL1", serial_norm: "VSAL1", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { contrato_doc_id: "c2", contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("VSAL2").set({ serial: "VSAL2", serial_norm: "VSAL2", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { contrato_doc_id: "c2", contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("VENT1").set({ serial: "VENT1", serial_norm: "VENT1", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_bodega" });
  await db.collection("equipos_pool").doc("VENT2").set({ serial: "VENT2", serial_norm: "VENT2", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_bodega" });
  await db.collection("equipos_pool").doc("VTALLER").set({ serial: "VTALLER", serial_norm: "VTALLER", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_taller" });
  await db.collection("ordenes_de_servicio").doc("2026111602").set({ estado_reparacion: "CERRADA (VISITA)", tipo_de_servicio: "VISITA TECNICA", cliente_id: "cli", cliente_nombre: "LIGO",
    equipos: [{ id: "v1", numero_de_serie: "VSAL1", modelo: "PNC360S" }, { id: "v2", numero_de_serie: "VSAL2", modelo: "PNC360S" }] });
  await rechaza(regularizar.ejecutar, { ordenId: "2026111602", serialSaliente: "VSAL1", serialEntrante: "VTALLER" }, /no en bodega/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026111602", serialSaliente: "VSAL1", serialEntrante: "NOEXISTE9" }, /no existe en el inventario/);
  const v1 = await regularizar.ejecutar({ usuario: "tec@x", ordenId: "2026111602", serialSaliente: "VSAL1", serialEntrante: "VENT1", salienteEnCasa: true, motivo: "no transmitía; cambio en sitio" });
  const v2 = await regularizar.ejecutar({ usuario: "tec@x", ordenId: "2026111602", serialSaliente: "VSAL2", serialEntrante: "VENT2", salienteEnCasa: true, motivo: "pantalla rota; cambio en sitio" });
  assert.notEqual(v1.gestion_id, v2.gestion_id, "cada cambio es su gestión");
  const ve1 = (await db.collection("equipos_pool").doc("VENT1").get()).data();
  assert.equal(ve1.estado, "en_cliente", "el radio dejado en sitio queda con el cliente aunque la visita esté cerrada");
  assert.equal(ve1.asignacion.contrato_doc_id, "c2"); assert.equal(ve1.reemplaza_a, "VSAL1");
  const vs1 = (await db.collection("equipos_pool").doc("VSAL1").get()).data();
  assert.equal(vs1.estado, "devuelto_revision"); assert.equal(vs1.asignacion, null);
  const vo = (await db.collection("ordenes_de_servicio").doc("2026111602").get()).data();
  assert.equal(vo.gestion, undefined, "a la visita no se le cuelga gestión");
  assert.ok(vo.reemplazos_regularizados.VSAL1 && vo.reemplazos_regularizados.VSAL2);
  const vg = (await db.collection("gestiones").doc(v1.gestion_id).get()).data();
  assert.equal(vg.ordenes.visita_id, "2026111602"); assert.equal(vg.ordenes.programacion_id, undefined);
  // 2026-11-18 (Brenda/Solís): el "¿Qué pasó?" queda en el kardex de los dos
  // radios y bodega recibe el correo (aquí sin bodega configurada cae a
  // recepción/taller; si no hay nadie, no se encola y no truena).
  const movE = (await db.collection("equipos_pool").doc("VENT1").collection("movimientos").get()).docs.map(d => d.data().notas || "");
  const movS = (await db.collection("equipos_pool").doc("VSAL1").collection("movimientos").get()).docs.map(d => d.data().notas || "");
  assert.ok(movE.some(n => /Qué pasó: no transmitía; cambio en sitio/.test(n)), "el motivo va al kardex del entrante");
  assert.ok(movS.some(n => /Qué pasó: no transmitía; cambio en sitio/.test(n)), "el motivo va al kardex del saliente");
  await db.collection("usuarios").doc("bod").set({ rol: "inventario", email: "bodega@x.com", activo: true });
  await db.collection("equipos_pool").doc("VSAL3").set({ serial: "VSAL3", serial_norm: "VSAL3", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_cliente", asignacion: { contrato_doc_id: "c2", contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("equipos_pool").doc("VENT3").set({ serial: "VENT3", serial_norm: "VENT3", modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_bodega" });
  await db.collection("ordenes_de_servicio").doc("2026111602").set({ equipos: [{ id: "v1", numero_de_serie: "VSAL1", modelo: "PNC360S" }, { id: "v2", numero_de_serie: "VSAL2", modelo: "PNC360S" }, { id: "v3", numero_de_serie: "VSAL3", modelo: "PNC360S" }] }, { merge: true });
  const v3 = await regularizar.ejecutar({ usuario: "tec@x", nombre: "Jesús Santos", ordenId: "2026111602", serialSaliente: "VSAL3", serialEntrante: "VENT3", salienteEnCasa: true, motivo: "batería hinchada; cambio en sitio" });
  assert.ok(v3.aviso_mail_id, "se encola el aviso a bodega");
  const mail = (await db.collection("mail_queue").doc(v3.aviso_mail_id).get()).data();
  assert.match(mail.to, /bodega@x\.com/); assert.match(mail.subject, /VSAL3 → VENT3/);
  assert.match(mail.bodyContent, /batería hinchada/); assert.match(mail.bodyContent, /Jesús Santos/);
  await rechaza(regularizar.ejecutar, { ordenId: "2026111602", serialSaliente: "VSAL1", serialEntrante: "VENT2" }, /ya se registró/);
  assert.match(mail.bodyContent, /salió sin registrarse/, "el entrante seguía en bodega: el correo lo dice");
  console.log("  ok   E1 visita: entrante escrito, visita cerrada, varios cambios, candado por serial");

  // ── Salida de radios a la visita (2026-11-18) ──
  const salida = require("../src/callable/salidaRadiosVisita");
  const pf = (id, extra = {}) => db.collection("equipos_pool").doc(id).set({ serial: id, serial_norm: id, modelo_id: "m360", modelo_label: "HYTERA PNC360S", estado: "en_bodega", ...extra });
  await pf("SAL01"); await pf("SAL02"); await pf("SAL03"); await pf("SALTALLER1", { estado: "en_taller" });
  await pf("SCLI1", { estado: "en_cliente", asignacion: { contrato_doc_id: "c2", contrato_id: "GR-C2", cliente_id: "cli", cliente_nombre: "LIGO" } });
  await db.collection("ordenes_de_servicio").doc("2026111801").set({ estado_reparacion: "ASIGNADO", tipo_de_servicio: "VISITA TECNICA", cliente_id: "cli", cliente_nombre: "LIGO",
    tecnico_asignado: "Jesús Santos", equipos: [{ id: "s1", numero_de_serie: "SCLI1", modelo: "PNC360S" }] });
  await db.collection("ordenes_de_servicio").doc("2026111802").set({ estado_reparacion: "ASIGNADO", tipo_de_servicio: "VISITA TECNICA", cliente_id: "cli2", cliente_nombre: "OTRO", equipos: [] });
  await db.collection("ordenes_de_servicio").doc("2026111803").set({ estado_reparacion: "ASIGNADO", tipo_de_servicio: "REPARACION", cliente_id: "cli", equipos: [] });
  // Candados: no visita, visita cerrada, serial fuera de bodega → no se mueve NINGUNO.
  await rechaza(salida.ejecutar, { accion: "sacar", ordenId: "2026111803", seriales: ["SAL01"] }, /no es una visita/);
  await rechaza(salida.ejecutar, { accion: "sacar", ordenId: "2026111602", seriales: ["SAL01"] }, /ya está cerrada/);
  await rechaza(salida.ejecutar, { accion: "sacar", ordenId: "2026111801", seriales: ["SAL01", "SALTALLER1"] }, /No se movió ningún radio.*SALTALLER1/);
  assert.equal((await db.collection("equipos_pool").doc("SAL01").get()).data().estado, "en_bodega", "todo o nada");
  const s1 = await salida.ejecutar({ usuario: "bodega@x", accion: "sacar", ordenId: "2026111801", seriales: ["sal01", "SAL02", "SAL03", "SAL02"] });
  assert.equal(s1.radios.length, 3, "duplicados colapsan");
  const p1 = (await db.collection("equipos_pool").doc("SAL01").get()).data();
  assert.equal(p1.estado, "con_tecnico"); assert.equal(p1.salida_visita.orden_id, "2026111801"); assert.equal(p1.salida_visita.tecnico, "Jesús Santos");
  await rechaza(salida.ejecutar, { accion: "sacar", ordenId: "2026111802", seriales: ["SAL01"] }, /ya salió con la visita 2026111801/);
  // Cambio en sitio: con un radio de OTRA visita se rechaza; con el de esta, queda dejado.
  await rechaza(regularizar.ejecutar, { ordenId: "2026111802", serialSaliente: "SCLI1", serialEntrante: "SAL01" }, /no está en la orden|salió de bodega con la visita/);
  const r1 = await regularizar.ejecutar({ usuario: "tec@x", ordenId: "2026111801", serialSaliente: "SCLI1", serialEntrante: "SAL01", salienteEnCasa: true, motivo: "no transmitía; cambio en sitio" });
  const p1b = (await db.collection("equipos_pool").doc("SAL01").get()).data();
  assert.equal(p1b.estado, "en_cliente"); assert.equal(p1b.salida_visita, undefined, "la salida se cierra al dejarlo");
  const mail2 = (await db.collection("mail_queue").doc(r1.aviso_mail_id).get()).data();
  assert.doesNotMatch(mail2.bodyContent, /salió sin registrarse/);
  const g1 = (await db.collection("gestiones").doc(r1.gestion_id).get()).data();
  assert.equal(g1.items[0].salida_bodega, "registrada");
  // Devolver: el dejado ya no está con el técnico; el sobrante vuelve a bodega.
  await rechaza(salida.ejecutar, { accion: "devolver", ordenId: "2026111801", seriales: ["SAL01"] }, /no con el técnico/);
  await rechaza(salida.ejecutar, { accion: "devolver", ordenId: "2026111802", seriales: ["SAL02"] }, /no con esta/);
  await salida.ejecutar({ usuario: "bodega@x", accion: "devolver", ordenId: "2026111801", seriales: ["SAL02"] });
  const p2 = (await db.collection("equipos_pool").doc("SAL02").get()).data();
  assert.equal(p2.estado, "en_bodega"); assert.equal(p2.salida_visita, undefined);
  const vo2 = (await db.collection("ordenes_de_servicio").doc("2026111801").get()).data();
  assert.equal(vo2.radios_salida.SAL01.estado, "dejado"); assert.equal(vo2.radios_salida.SAL01.serial, "sal01");
  assert.equal(vo2.radios_salida.SAL02.estado, "devuelto"); assert.equal(vo2.radios_salida.SAL03.estado, "llevado");
  const kx = (await db.collection("equipos_pool").doc("SAL02").collection("movimientos").get()).docs.map(d => d.data().tipo).sort();
  assert.deepEqual(kx, ["regreso_visita", "salida_visita"]);
  console.log("  ok   Salida a visita: sacar todo-o-nada, dejado en sitio, devolver sobrantes");

  await limpiar();
  console.log("\nTODO OK");
  process.exit(0);
})().catch((e) => { console.error("\nFALLA:", e); process.exit(1); });
