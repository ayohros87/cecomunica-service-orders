/**
 * reporte-radios-clientes-inactivos.js — Excel para bodega con los radios de
 * CECOMUNICA que siguen en campo con cuentas que ya no son clientes.
 *
 * Por qué (Alberto, 2026-09-14): al desactivar clientes y cerrar sus contratos
 * quedaron 67 radios "en campo" con cuentas muertas. Pero 41 de esos son
 * PROPIEDAD DEL CLIENTE —los compró, se quedan con él, no hay nada que
 * recuperar— y solo 26 son nuestros. El modo por defecto lista justamente esos
 * 26, que son el pendiente real de bodega.
 *
 * El caso que enseñó la diferencia: PANAMA PORT BALBOA parecía deber 26
 * Kenwood, y resultaron ser suyos (dos contratos "Propio"); 24 de los 26 ni
 * siquiera estaban declarados en un contrato — el pool se los adjudicó en la
 * limpieza de inventario y la única marca que los explica es `propiedad`.
 *
 * USAGE (desde functions/):
 *   node scripts/reporte-radios-clientes-inactivos.js [--out ruta.xlsx]
 *   node scripts/reporte-radios-clientes-inactivos.js --cliente "NOMBRE"
 *
 * Con --cliente saca TODO lo que el pool le tiene a esa cuenta (nuestro y de
 * ella), que es lo que sirve para investigar una cuenta puntual.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const path = require("path");
const ExcelJS = require("exceljs");
const pool = require("../src/domain/equiposPool");

const arg = (n, def) => {
  const i = process.argv.indexOf(n);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const CLIENTE = arg("--cliente", null);
const HOY = new Date().toISOString().slice(0, 10);
const SLUG = CLIENTE ? CLIENTE.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "nuestros-en-clientes-inactivos";
const OUT = arg("--out", path.join(__dirname, "..", "..", "local-data", `radios-${SLUG}-${HOY}.xlsx`));

const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
const f = (t) => (t?.toDate ? t.toDate().toISOString().slice(0, 10) : "");

(async () => {
  // Alcance: una cuenta concreta, o todos los radios NUESTROS en cuentas
  // desactivadas (el pendiente real de bodega).
  let cid = null, incluir = null;
  const nombreDe = new Map();
  if (CLIENTE) {
    const cli = (await db.collection("clientes").where("nombre", "==", CLIENTE).limit(1).get()).docs[0];
    if (!cli) { console.error(`No existe el cliente "${CLIENTE}"`); process.exit(1); }
    cid = cli.id;
    nombreDe.set(cid, CLIENTE);
    incluir = (v) => v.asignacion?.cliente_id === cid;
  } else {
    (await db.collection("clientes").get()).forEach((d) => {
      const v = d.data();
      if (v.deleted !== true && v.activo === false) nombreDe.set(d.id, v.nombre || d.id);
    });
    // Solo lo de CECOMUNICA: lo que el cliente compró se queda con él.
    incluir = (v) => nombreDe.has(v.asignacion?.cliente_id || "")
      && ["en_cliente", "asignado_contrato"].includes(String(v.estado || ""))
      && v.propiedad !== "cliente";
  }

  const filas = [];
  (await db.collection("equipos_pool").get()).forEach((d) => {
    const v = d.data();
    if (!incluir(v)) return;
    filas.push({
      serial: v.serial || d.id, norm: pool.normSerial(v.serial || d.id),
      cliente: nombreDe.get(v.asignacion?.cliente_id) || v.asignacion?.cliente_nombre || "",
      modelo: v.modelo_label || "", condicion: v.condicion || "", estado: v.estado || "",
      propiedad: v.propiedad || "", contrato: v.asignacion?.contrato_id || "",
      pool_upd: f(v.updated_at), notas: v.notas || "",
    });
  });

  // Última orden de servicio de cada serial.
  const porSerial = new Map(filas.map((x) => [x.norm, x]));
  (await db.collection("ordenes_de_servicio").get()).forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    for (const e of (v.equipos || [])) {
      const k = pool.normSerial(e.numero_de_serie || e.serial || "");
      const x = porSerial.get(k);
      if (!x) continue;
      const at = ms(v.fecha_salida || v.fecha_entrada || v.fecha_creacion);
      if (x._at && at <= x._at) continue;
      x._at = at;
      x.os = v.numero_orden || d.id;
      x.os_tipo = v.tipo_de_servicio || "";
      x.os_estado = v.estado_reparacion || "";
      x.os_fecha = f(v.fecha_salida || v.fecha_entrada || v.fecha_creacion);
      x.os_cliente = v.cliente || "";
      x.os_tecnico = v.tecnico_asignado || "";
    }
  });

  // Ficha POC (la más nueva), abierta o cerrada: el unit_id y la SIM son lo que
  // bodega usa para rastrear un radio que ya no tiene etiqueta legible.
  (await db.collection("poc_devices").get()).forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    const x = porSerial.get(pool.normSerial(v.serial || ""));
    if (!x) return;
    const at = ms(v.updated_at || v.created_at);
    if (x._pat && at <= x._pat) return;
    x._pat = at;
    x.poc_cliente = v.cliente_nombre || v.cliente || "";
    x.poc_activa = v.activo === false ? "cerrada" : "ABIERTA";
    x.poc_unit = v.unit_id || "";
    x.poc_sim = v.sim_number || "";
    x.poc_tel = v.sim_phone || "";
    x.poc_nombre = v.radio_name || "";
    x.poc_fecha = f(v.updated_at || v.created_at);
  });

  filas.sort((a, b) => String(a.cliente).localeCompare(String(b.cliente))
    || String(a.modelo).localeCompare(String(b.modelo)) || a.serial.localeCompare(b.serial));

  const wb = new ExcelJS.Workbook();
  wb.creator = "Cecomunica";
  wb.created = new Date();
  const ws = wb.addWorksheet("Radios por ubicar");

  const cuentas = new Set(filas.map((x) => x.cliente)).size;
  ws.mergeCells("A1:S1");
  ws.getCell("A1").value = CLIENTE
    ? `${CLIENTE} — ${filas.length} radios que el sistema todavia le tiene asignados (${HOY})`
    : `${filas.length} radios de CECOMUNICA en campo con ${cuentas} cuentas ya desactivadas (${HOY})`;
  ws.getCell("A1").font = { bold: true, size: 13 };

  let intro;
  if (CLIENTE) {
    // Los contratos de la cuenta explican la columna "Propiedad": un contrato
    // "Propio" es una VENTA — ese radio es del cliente y se queda con él.
    const contratos = [];
    (await db.collection("contratos").where("cliente_id", "==", cid).get()).forEach((d) => {
      const v = d.data();
      if (v.deleted === true) return;
      contratos.push(`${v.contrato_id} (${v.tipo_contrato || ""}, ${v.estado})`);
    });
    const propios = filas.filter((x) => x.propiedad === "cliente").length;
    intro = `La cuenta se desactivo y sus contratos se cerraron. ${propios} de ${filas.length} figuran como propiedad DEL CLIENTE (contrato "Propio" = venta): esos se quedan con el y no hay nada que recuperar. Contratos: ${contratos.join(", ")}.`;
  } else {
    intro = "Estos radios son de CECOMUNICA y el sistema los da en campo con clientes que ya se desactivaron. Lo que el cliente compro NO esta en esta lista. Cada fila trae la ultima orden de servicio que toco el radio y los datos de su ficha PoC, para poder rastrearlo.";
  }
  ws.mergeCells("A2:S2");
  ws.getCell("A2").value = intro;
  ws.getCell("A2").font = { size: 10, italic: true };
  ws.getCell("A2").alignment = { wrapText: true };
  ws.getRow(2).height = 42;
  ws.mergeCells("A3:S3");
  ws.getCell("A3").value = "Favor anotar en las dos ultimas columnas donde esta cada radio y que hay que hacer con el.";
  ws.getCell("A3").font = { size: 10, bold: true };

  const cols = [
    ["Serial", "serial", 16], ["Cliente (sistema)", "cliente", 30], ["Modelo", "modelo", 20], ["Condicion", "condicion", 11],
    ["Estado en sistema", "estado", 18], ["Propiedad", "propiedad", 12], ["Contrato", "contrato", 18],
    ["Ultima OS", "os", 13], ["Tipo OS", "os_tipo", 15], ["Estado OS", "os_estado", 22],
    ["Fecha OS", "os_fecha", 12], ["Cliente de la OS", "os_cliente", 26], ["Tecnico", "os_tecnico", 16],
    ["Ficha POC", "poc_activa", 10], ["Cliente en POC", "poc_cliente", 26], ["Unit ID", "poc_unit", 11],
    ["SIM", "poc_sim", 21], ["Nombre del radio", "poc_nombre", 16], ["Fecha POC", "poc_fecha", 12],
  ];
  const head = ws.addRow(cols.map((c) => c[0]).concat(["DONDE ESTA (bodega)", "QUE HAY QUE HACER"]));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2A47" } };
  head.alignment = { vertical: "middle", wrapText: true };
  head.height = 30;

  for (const x of filas) {
    const r = ws.addRow(cols.map((c) => x[c[1]] || "").concat(["", ""]));
    // La ficha POC abierta a nombre de otro es la pista más fuerte: se resalta.
    if (x.poc_activa === "ABIERTA" && x.poc_cliente && x.poc_cliente !== x.cliente) {
      r.getCell(15).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDF4E1" } };
      r.getCell(15).font = { bold: true };
    }
  }

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c[2]; });
  ws.getColumn(cols.length + 1).width = 26;
  ws.getColumn(cols.length + 2).width = 34;
  ws.views = [{ state: "frozen", ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length + 2 } };
  for (let i = 5; i <= 4 + filas.length; i++) {
    ws.getRow(i).getCell(cols.length + 1).border = { left: { style: "thin" }, right: { style: "thin" }, top: { style: "thin" }, bottom: { style: "thin" } };
    ws.getRow(i).getCell(cols.length + 2).border = { left: { style: "thin" }, right: { style: "thin" }, top: { style: "thin" }, bottom: { style: "thin" } };
  }

  await wb.xlsx.writeFile(OUT);
  console.log(`${filas.length} radios → ${OUT}`);
  const porModelo = new Map();
  filas.forEach((x) => porModelo.set(x.modelo, (porModelo.get(x.modelo) || 0) + 1));
  console.log("Por modelo:", [...porModelo].map(([m, n]) => `${m}: ${n}`).join(" · "));
  const conPocAjena = filas.filter((x) => x.poc_activa === "ABIERTA" && x.poc_cliente && x.poc_cliente !== x.cliente);
  if (conPocAjena.length) console.log(`Con ficha POC ABIERTA a nombre de otro cliente: ${conPocAjena.map((x) => `${x.serial}→${x.poc_cliente}`).join(", ")}`);
})().catch((e) => { console.error(e); process.exit(1); });
