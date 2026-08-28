/**
 * asigna-custodia-por-ordenes-masivo.js — El barrido MASIVO de
 * asigna-custodia-por-ordenes.js (Alberto 2026-08-28: "procede con esto
 * masivamente para todas las cuentas"). Misma clasificación y los mismos
 * candados, pero carga pool + órdenes + contratos UNA sola vez y procesa
 * todos los clientes con custodia, de mayor a menor.
 *
 * Por unidad en_cliente SIN contrato:
 *   A) la evidencia de órdenes nombra un contrato VIGENTE → fila en
 *      contratos/{cid}/seriales (source 'custodia_por_ordenes'); si faltaba,
 *      entrega_confirmada (JAMÁS en contratos con origen amarrado —
 *      onEntregaTransicion); vigencia del contrato si no tenía.
 *   B) hay fecha de entrega pero ningún contrato → vigencia 18m EN LA UNIDAD.
 *   C) la última orden dice que VOLVIÓ o que salió a OTRO cliente → drift del
 *      pool: se reporta, no se toca.
 *   D) sin evidencia → se reporta.
 *
 * Claves de extracción (descubiertas con SEPROSA): serial viejo =
 * `numero_de_serie`; el contrato viene escrito en equipos[].observaciones
 * ("ADICION CONTRATO ALQ20250818-02").
 *
 * USAGE (desde functions/):
 *   node scripts/asigna-custodia-por-ordenes-masivo.js [--write] [--top=N]
 * Salida: consola + Excel en el Escritorio (custodia-masivo-<fecha>.xlsx).
 */
const path = require("path");
const os = require("os");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");
const VIG = require("../src/lib/vigencia");
const ExcelJS = require("exceljs");

const WRITE = process.argv.includes("--write");
const TOP = Number((process.argv.find((a) => a.startsWith("--top=")) || "").slice(6)) || Infinity;
const SOURCE = "custodia_por_ordenes";

const aDate = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d : null; };
const fmt = (d) => (d ? d.toISOString().slice(0, 10) : "");
const addMeses = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const RX_CONTRATO = /\b(?:ALQ|PROP|REEMP|DEMO|TEMP)\d{8}-\d{2}\b/;

(async () => {
  console.log("Cargando pool, órdenes y contratos…");
  const [poolSnap, ordSnap, conSnap] = await Promise.all([
    db.collection("equipos_pool").where("estado", "==", "en_cliente").get(),
    db.collection("ordenes_de_servicio").get(),
    db.collection("contratos").get(),
  ]);

  const contratos = new Map();
  const porNumero = new Map();
  conSnap.forEach((d) => {
    const c = { id: d.id, ref: d.ref, ...d.data() };
    contratos.set(d.id, c);
    if (c.contrato_id) porNumero.set(c.contrato_id, c);
  });

  // Índice serial_norm → apariciones cronológicas en órdenes.
  const porSerial = new Map();
  ordSnap.forEach((d) => {
    const o = d.data();
    if (o.eliminado) return;
    const fecha = aDate(o.fecha_entrega) || aDate(o.fecha_creacion);
    const obsOrden = String(o.observaciones || "").match(RX_CONTRATO)?.[0] || null;
    const base = {
      id: d.id, tipo: (o.tipo_de_servicio || "").toUpperCase(),
      estado: (o.estado_reparacion || "").toUpperCase(),
      cliente_id: o.cliente_id || null, cliente_nombre: o.cliente_nombre || "",
      contrato_doc_id: o.contrato?.contrato_doc_id || null,
      contrato_id: o.contrato?.contrato_id || null,
      fecha,
    };
    const vistos = new Map();
    (o.equipos || []).forEach((e) => {
      const n = pool.normSerial(e.serial || e.numero_serie || e.numero_de_serie || "");
      if (!n) return;
      const obsEq = String(e.observaciones || "").match(RX_CONTRATO)?.[0] || null;
      vistos.set(n, obsEq || obsOrden);
    });
    (o.devolucion?.esperados || []).forEach((e) => {
      const n = pool.normSerial(e.serial || "");
      if (n && !vistos.has(n)) vistos.set(n, null);
    });
    for (const [n, contratoObs] of vistos) {
      if (!porSerial.has(n)) porSerial.set(n, []);
      porSerial.get(n).push({ ...base, contrato_obs: contratoObs });
    }
  });
  porSerial.forEach((arr) => arr.sort((a, b) => (a.fecha || 0) - (b.fecha || 0)));

  // Custodia agrupada por cliente, de mayor a menor.
  const porCliente = new Map();
  poolSnap.forEach((d) => {
    const u = { id: d.id, ref: d.ref, ...d.data() };
    const cid = u.asignacion?.cliente_id;
    if (!cid || u.asignacion?.contrato_doc_id) return;
    if (!porCliente.has(cid)) porCliente.set(cid, { nombre: u.asignacion.cliente_nombre || cid, unidades: [] });
    porCliente.get(cid).unidades.push(u);
  });
  const clientes = [...porCliente.entries()]
    .sort((a, b) => b[1].unidades.length - a[1].unidades.length)
    .slice(0, TOP === Infinity ? undefined : TOP);
  console.log(`Clientes con custodia: ${porCliente.size} · unidades: ${[...porCliente.values()].reduce((s, x) => s + x.unidades.length, 0)} · a procesar: ${clientes.length}\n`);

  const filasCache = new Map();
  const filasDe = async (cid) => {
    if (!filasCache.has(cid)) {
      const s = await db.collection("contratos").doc(cid).collection("seriales").get();
      filasCache.set(cid, s.docs.map((x) => pool.normSerial(x.data().serial || "")));
    }
    return filasCache.get(cid);
  };

  const FV = admin.firestore.FieldValue;
  const now = new Date();
  const TOT = { A: 0, B: 0, DRIFT: 0, OTRO: 0, SIN_EV: 0, FILA: 0, CON_ORIGEN: 0, NO_VIG: 0, SIN_LINEA: 0, contratosEstampados: 0 };
  const xls = { resumen: [], drift: [], otro: [], asignadas: [], sinLinea: [] };

  for (const [clienteId, info] of clientes) {
    const R = { A: [], B: [], DRIFT: [], OTRO: [], SIN_EV: 0, FILA: 0, CON_ORIGEN: 0, NO_VIG: 0, SIN_LINEA: [] };
    const contratoPlan = new Map();

    for (const u of info.unidades) {
      const norm = u.serial_norm || u.id.split("__")[0];
      const apar = porSerial.get(norm) || [];
      if (!apar.length) { R.SIN_EV++; continue; }
      const ult = apar[apar.length - 1];
      if ((ult.tipo === "ENTRADA" || ult.tipo === "DEVOLUCION") && ult.estado.startsWith("CERRADA")) {
        R.DRIFT.push({ u, orden: ult }); continue;
      }
      const salidas = apar.filter((a) => a.tipo !== "ENTRADA" && a.tipo !== "DEVOLUCION" && a.estado !== "ANULADA");
      if (!salidas.length) { R.SIN_EV++; continue; }
      const ultSalida = salidas[salidas.length - 1];
      if (ultSalida.cliente_id && ultSalida.cliente_id !== clienteId) { R.OTRO.push({ u, orden: ultSalida }); continue; }
      const propias = salidas.filter((a) => !a.cliente_id || a.cliente_id === clienteId);
      if (!propias.length) { R.SIN_EV++; continue; }

      let evidencia = null, c = null;
      for (const a of propias) {
        const cand = (a.contrato_doc_id && contratos.get(a.contrato_doc_id))
          || (a.contrato_id && porNumero.get(a.contrato_id))
          || (a.contrato_obs && porNumero.get(a.contrato_obs)) || null;
        if (cand && !cand.deleted) { evidencia = a; c = cand; break; }
      }

      if (c) {
        // El contrato de la evidencia debe ser VIGENTE y del MISMO cliente
        // (una obs vieja puede nombrar el contrato de otro titular).
        if (c.cliente_id && c.cliente_id !== clienteId) { R.OTRO.push({ u, orden: evidencia, nota: `contrato ${c.contrato_id} es de ${c.cliente_nombre}` }); continue; }
        if (!["activo", "aprobado"].includes(c.estado)) { R.NO_VIG++; continue; }
        const filas = await filasDe(c.id);
        if (filas.includes(norm)) { R.FILA++; continue; }
        const entregado = c.seriales_estado === "legacy" || c.entrega_confirmada === true;
        const tieneOrigen = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length) || c.contrato_origen_id;
        if (!entregado && tieneOrigen) { R.CON_ORIGEN++; continue; }
        if (!(c.equipos || []).some((l) => pool.mismoModelo(u, l.modelo_id || null, l.modelo || ""))) {
          R.SIN_LINEA.push({ u, c });
        }
        const plan = contratoPlan.get(c.id) || { c, entrega: false, primeraEntrega: null, ultimaEntrega: null, vigencia: false };
        if (!entregado) plan.entrega = true;
        if (evidencia.fecha) {
          if (!plan.primeraEntrega || evidencia.fecha < plan.primeraEntrega) plan.primeraEntrega = evidencia.fecha;
          if (!plan.ultimaEntrega || evidencia.fecha > plan.ultimaEntrega) plan.ultimaEntrega = evidencia.fecha;
        }
        if (!c.fecha_vencimiento && VIG.aplicaVencimiento(c)) plan.vigencia = true;
        contratoPlan.set(c.id, plan);
        R.A.push({ u, c, orden: evidencia, fechaEntrega: evidencia.fecha });
      } else {
        const primera = propias[0];
        if (!primera.fecha) { R.SIN_EV++; continue; }
        R.B.push({ u, orden: primera, fechaEntrega: primera.fecha,
          fuente: primera.tipo.startsWith("REPARACI") ? "orden_reparacion" : "orden_entrega" });
      }
    }

    // ── Escritura por cliente ──
    if (WRITE) {
      for (const p of contratoPlan.values()) {
        const upd = {};
        if (p.entrega) {
          upd.entrega_confirmada = true;
          upd.entrega_confirmada_fuente = `script:${SOURCE}`;
          if (p.ultimaEntrega) upd.fecha_entrega_ultima = admin.firestore.Timestamp.fromDate(p.ultimaEntrega);
        }
        if (p.vigencia && p.primeraEntrega) {
          let meses = VIG.parseDuracionMeses(p.c.duracion);
          if (!meses) { meses = 18; upd.duracion = "18 meses"; upd.duracion_meses = 18; }
          const fv = addMeses(p.primeraEntrega, meses);
          upd.fecha_vencimiento = admin.firestore.Timestamp.fromDate(fv);
          upd.vencimiento_estado = VIG.estadoVencimiento(fv, now);
          upd.vigencia = {
            fecha_inicio: admin.firestore.Timestamp.fromDate(p.primeraEntrega),
            duracion_meses: meses,
            fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
            fuente_inicio: "orden_entrega",
            estampado_por: `script:${SOURCE}`,
          };
        }
        if (Object.keys(upd).length) {
          upd.fecha_modificacion = new Date();
          await p.c.ref.update(upd);
          TOT.contratosEstampados++;
        }
      }
      for (const a of R.A) {
        await a.c.ref.collection("seriales").add({
          serial: a.u.serial || a.u.id,
          modelo: a.u.modelo_label || "",
          modelo_id: a.u.modelo_id || null,
          contrato_doc_id: a.c.id,
          contrato_id: a.c.contrato_id || "",
          cliente_id: a.c.cliente_id || "",
          cliente_nombre: a.c.cliente_nombre || "",
          source: SOURCE,
          evidencia_orden_id: a.orden.id,
          created_at: FV.serverTimestamp(), created_by: `script:${SOURCE}`,
          updated_at: FV.serverTimestamp(), updated_by: `script:${SOURCE}`,
        });
        filasCache.get(a.c.id)?.push(a.u.serial_norm || "");
      }
      for (const b of R.B) {
        const fv = addMeses(b.fechaEntrega, 18);
        await b.u.ref.update({
          fecha_entrega: b.fechaEntrega.toISOString(),
          vigencia: {
            fecha_inicio: admin.firestore.Timestamp.fromDate(b.fechaEntrega),
            duracion_meses: 18,
            fecha_vencimiento: admin.firestore.Timestamp.fromDate(fv),
            fuente_inicio: b.fuente,
            orden_id: b.orden.id,
            estampado_por: `script:${SOURCE}`,
          },
          updated_at: FV.serverTimestamp(),
        });
      }
    }

    TOT.A += R.A.length; TOT.B += R.B.length; TOT.DRIFT += R.DRIFT.length; TOT.OTRO += R.OTRO.length;
    TOT.SIN_EV += R.SIN_EV; TOT.FILA += R.FILA; TOT.CON_ORIGEN += R.CON_ORIGEN; TOT.NO_VIG += R.NO_VIG;
    TOT.SIN_LINEA += R.SIN_LINEA.length;
    console.log(`${String(info.unidades.length).padStart(4)} unid  ${info.nombre.slice(0, 44).padEnd(45)} A=${R.A.length} B=${R.B.length} drift=${R.DRIFT.length} otro=${R.OTRO.length} sinEv=${R.SIN_EV}${R.CON_ORIGEN ? ` conOrigen=${R.CON_ORIGEN}` : ""}${R.NO_VIG ? ` noVig=${R.NO_VIG}` : ""}`);

    xls.resumen.push({ cliente: info.nombre, unidades: info.unidades.length, asignadas: R.A.length, vigenciaUnidad: R.B.length,
      drift: R.DRIFT.length, otroCliente: R.OTRO.length, sinEvidencia: R.SIN_EV, filaExistente: R.FILA,
      conOrigen: R.CON_ORIGEN, contratoNoVigente: R.NO_VIG, sinLinea: R.SIN_LINEA.length });
    R.DRIFT.forEach((x) => xls.drift.push({ cliente: info.nombre, serial: x.u.serial, orden: x.orden.id, tipo: x.orden.tipo, estado: x.orden.estado, fecha: fmt(x.orden.fecha) }));
    R.OTRO.forEach((x) => xls.otro.push({ cliente: info.nombre, serial: x.u.serial, orden: x.orden.id, fecha: fmt(x.orden.fecha), destino: x.nota || x.orden.cliente_nombre || "?" }));
    R.A.forEach((x) => xls.asignadas.push({ cliente: info.nombre, serial: x.u.serial, contrato: x.c.contrato_id, orden: x.orden.id, entrega: fmt(x.fechaEntrega) }));
    R.SIN_LINEA.forEach((x) => xls.sinLinea.push({ cliente: info.nombre, serial: x.u.serial, modelo: x.u.modelo_label || "", contrato: x.c.contrato_id }));
  }

  console.log(`\n═══ TOTALES ${WRITE ? "(APLICADO)" : "(DRY-RUN)"} ═══`);
  console.log(`A asignadas a contrato: ${TOT.A} · B vigencia en la unidad: ${TOT.B}`);
  console.log(`DRIFT (volvió): ${TOT.DRIFT} · OTRO cliente: ${TOT.OTRO} · SIN evidencia: ${TOT.SIN_EV}`);
  console.log(`Fila existente: ${TOT.FILA} · Contrato con origen (no tocado): ${TOT.CON_ORIGEN} · Contrato no vigente: ${TOT.NO_VIG}`);
  console.log(`Sin línea del modelo (tarifa no resuelve): ${TOT.SIN_LINEA} · Contratos estampados: ${TOT.contratosEstampados}`);

  // ── Excel ──
  const wb = new ExcelJS.Workbook();
  const add = (nombre, cols, rows) => {
    const ws = wb.addWorksheet(nombre);
    ws.columns = cols;
    ws.addRows(rows);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  add("Resumen por cliente", [
    { header: "Cliente", key: "cliente", width: 44 }, { header: "Custodia", key: "unidades", width: 10 },
    { header: "Asignadas", key: "asignadas", width: 10 }, { header: "Vigencia unidad", key: "vigenciaUnidad", width: 14 },
    { header: "Drift (volvió)", key: "drift", width: 12 }, { header: "Otro cliente", key: "otroCliente", width: 11 },
    { header: "Sin evidencia", key: "sinEvidencia", width: 12 }, { header: "Fila existente", key: "filaExistente", width: 12 },
    { header: "Con origen", key: "conOrigen", width: 10 }, { header: "Contrato no vigente", key: "contratoNoVigente", width: 16 },
    { header: "Sin línea", key: "sinLinea", width: 9 },
  ], xls.resumen);
  add("Asignadas", [
    { header: "Cliente", key: "cliente", width: 40 }, { header: "Serial", key: "serial", width: 15 },
    { header: "Contrato", key: "contrato", width: 18 }, { header: "Orden", key: "orden", width: 12 }, { header: "Entrega", key: "entrega", width: 12 },
  ], xls.asignadas);
  add("Drift - volvieron", [
    { header: "Cliente", key: "cliente", width: 40 }, { header: "Serial", key: "serial", width: 15 },
    { header: "Orden", key: "orden", width: 12 }, { header: "Tipo", key: "tipo", width: 13 },
    { header: "Estado", key: "estado", width: 20 }, { header: "Fecha", key: "fecha", width: 12 },
  ], xls.drift);
  add("Otro cliente", [
    { header: "Cliente (pool)", key: "cliente", width: 40 }, { header: "Serial", key: "serial", width: 15 },
    { header: "Orden", key: "orden", width: 12 }, { header: "Fecha", key: "fecha", width: 12 }, { header: "Salió a", key: "destino", width: 44 },
  ], xls.otro);
  add("Sin línea del modelo", [
    { header: "Cliente", key: "cliente", width: 40 }, { header: "Serial", key: "serial", width: 15 },
    { header: "Modelo", key: "modelo", width: 22 }, { header: "Contrato", key: "contrato", width: 18 },
  ], xls.sinLinea);
  const out = path.join(os.homedir(), "Desktop", `custodia-masivo-${new Date().toISOString().slice(0, 10)}${WRITE ? "" : "-DRYRUN"}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`\nExcel → ${out}`);
  if (!WRITE) console.log("DRY-RUN — nada escrito. Repite con --write.");
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
