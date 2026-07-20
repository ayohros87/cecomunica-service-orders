/**
 * match-legacy-seriales.js — Match automático CONSERVADOR de radios POC a
 * contratos legacy (registro histórico de seriales). Solo asigna los casos
 * inequívocos; lo ambiguo queda reportado para decisión humana.
 *
 * Reglas:
 *   1. Contratos con seriales_estado='legacy', activos/aprobados, no borrados,
 *      con unidades faltantes. Renglones "NO APLICA"/sin modelo se saltan.
 *   2. Candidatos: radios POC del cliente (serial válido, no deleted) cuya
 *      unidad del pool NO esté ya amparada por un contrato (no
 *      asignado_contrato / en_cliente / baja).
 *   3. Radio ↔ renglón por la misma identidad tolerante del pool (mismoModelo).
 *   4. Si DOS contratos pendientes del mismo cliente necesitan el mismo modelo
 *      → ese modelo se salta para ese cliente (ambiguo multi-contrato).
 *   5. Si hay MÁS radios candidatos que casillas del renglón → se salta el
 *      renglón (elegir un subconjunto sería arbitrario). Solo se asigna cuando
 *      candidatos ≤ faltantes (asignación forzosa, sin elección).
 *
 * En modo escritura crea contratos/{id}/seriales/{autoId} con la misma forma
 * que ContratosService.saveSerialesManual (source: 'auto-match-poc') + un doc
 * de seriales_historial por contrato. El trigger onSerialWrite mueve las
 * unidades del pool a en_cliente automáticamente (contrato legacy = entregado).
 *
 * USAGE (desde functions/):
 *   node scripts/match-legacy-seriales.js                # dry-run
 *   node scripts/match-legacy-seriales.js --write        # ejecuta
 *   node scripts/match-legacy-seriales.js --csv out.csv  # detalle a CSV
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const dryRun = !process.argv.includes("--write");
// Tier C (--con-fechas): además de órdenes vinculadas y POC, usa órdenes del
// cliente SIN vínculo cuya fecha cae en la vigencia del contrato (evidencia
// circunstancial — el cliente tenía ese radio en esas fechas). Mismas reglas
// estrictas; fichas con source 'auto-match-fecha'.
const conFechas = process.argv.includes("--con-fechas");
const csvIdx = process.argv.indexOf("--csv");
const csvOut = csvIdx > -1 ? process.argv[csvIdx + 1] : null;

const normName = (s) => String(s || "").trim().toLowerCase()
  // eslint-disable-next-line no-control-regex -- intencional: recorta todo lo no-ASCII
  .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/\s+/g, " ");
const esNoAplica = (m) => {
  const t = String(m || "").toLowerCase().replace(/[^a-z]/g, "");
  return !t || t === "noaplica" || t === "na";
};
const mm = (aId, aLabel, bId, bLabel) =>
  pool.mismoModelo({ modelo_id: aId, modelo_label: aLabel }, bId, bLabel);

const fechaDe = (t) => (t?.toDate ? t.toDate() : (t ? new Date(t) : null));

(async () => {
  // ── Datos ──
  const [contratosSnap, serialesSnap, pocSnap, poolSnap, ordenesSnap] = await Promise.all([
    db.collection("contratos").where("seriales_estado", "==", "legacy").get(),
    db.collectionGroup("seriales").get(),
    db.collection("poc_devices").get(),
    db.collection("equipos_pool").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);

  // Seriales ya registrados por contrato
  const serialesDe = new Map(); // cid → [{serial, modelo, modelo_id}]
  serialesSnap.docs.forEach((d) => {
    const parent = d.ref.parent.parent;
    if (!parent || d.ref.parent.parent.parent.id !== "contratos") return;
    const s = d.data();
    if (!(s.serial || "").trim()) return;
    (serialesDe.get(parent.id) || serialesDe.set(parent.id, []).get(parent.id)).push(s);
  });

  // Pool por serial_norm → ¿la unidad ya está amparada?
  const poolPorNorm = new Map();
  poolSnap.docs.forEach((d) => {
    const v = d.data();
    (poolPorNorm.get(v.serial_norm) || poolPorNorm.set(v.serial_norm, []).get(v.serial_norm)).push(v);
  });
  const yaAmparado = (serial, modeloId, modeloLabel) => {
    const docs = poolPorNorm.get(pool.normSerial(serial)) || [];
    const u = docs.find((v) => mm(v.modelo_id, v.modelo_label, modeloId, modeloLabel)) || docs[0];
    return u && ["asignado_contrato", "en_cliente", "baja"].includes(u.estado);
  };

  // Radios POC por cliente
  const radiosDe = new Map(); // clave cliente → [{serial, modelo_id, modelo_label, unit}]
  const claveCliente = (id, nombre) => id || `n:${normName(nombre)}`;
  pocSnap.docs.forEach((d) => {
    const v = d.data();
    const serial = (v.serial || "").toString().trim();
    if (v.deleted === true || !serial || !pool.esSerialValido(pool.normSerial(serial))) return;
    const k = claveCliente(v.cliente_id, v.cliente_nombre || v.cliente);
    if (!k) return;
    (radiosDe.get(k) || radiosDe.set(k, []).get(k)).push({
      serial, modelo_id: v.modelo_id || null,
      modelo_label: v.modelo_label || v.modelo || "",
      unit: v.radio_name || v.unit_id || "",
    });
  });

  // Contratos pendientes agrupados por cliente
  const contratos = contratosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((c) => c.deleted !== true && ["activo", "aprobado"].includes(c.estado));
  const porCliente = new Map();
  contratos.forEach((c) => {
    const k = claveCliente(c.cliente_id, c.cliente_nombre);
    (porCliente.get(k) || porCliente.set(k, []).get(k)).push(c);
  });
  const cidsPendientes = new Set(contratos.map((c) => c.id));

  // Órdenes: las VINCULADAS a contratos legacy pendientes son evidencia
  // directa (Tier A; más reciente primero). Las vinculadas a CUALQUIER otro
  // contrato reservan sus seriales (no elegibles por fecha). Las libres del
  // cliente alimentan el Tier C por fecha.
  const ordenesPorContrato = new Map(); // cid → [{fecha, numero, equipos[]}]
  const ordenesLibresDe = new Map();    // clave cliente → [{fecha, numero, equipos[]}]
  const reservadoPorVinculo = new Set(); // norm en órdenes vinculadas a otros contratos
  const evidenciaSerial = new Map();    // norm → Set(cid) — conflictos si ≥2
  ordenesSnap.docs.forEach((d) => {
    const o = d.data();
    if (o.eliminado === true) return;
    const equipos = (o.equipos || [])
      .filter((e) => e && !e.eliminado)
      .map((e) => ({
        serial: (e.serial || e.SERIAL || e.numero_de_serie || "").toString().trim(),
        modelo_id: e.modelo_id || null,
        modelo: (e.modelo || e.MODEL || e.modelo_nombre || "").toString().trim(),
      }))
      .filter((e) => e.serial && pool.esSerialValido(pool.normSerial(e.serial)));
    if (!equipos.length) return;
    const cid = o.contrato?.aplica && o.contrato?.contrato_doc_id ? o.contrato.contrato_doc_id : null;
    const item = { fecha: fechaDe(o.fecha_creacion), numero: o.numero_orden || d.id, equipos };
    if (cid && cidsPendientes.has(cid)) {
      (ordenesPorContrato.get(cid) || ordenesPorContrato.set(cid, []).get(cid)).push(item);
      equipos.forEach((e) => {
        const n = pool.normSerial(e.serial);
        (evidenciaSerial.get(n) || evidenciaSerial.set(n, new Set()).get(n)).add(cid);
      });
    } else if (cid) {
      equipos.forEach((e) => reservadoPorVinculo.add(pool.normSerial(e.serial)));
    } else {
      const k = claveCliente(o.cliente_id, o.cliente_nombre);
      if (k) (ordenesLibresDe.get(k) || ordenesLibresDe.set(k, []).get(k)).push(item);
    }
  });
  ordenesPorContrato.forEach((arr) => arr.sort((a, b) => (b.fecha?.getTime() || 0) - (a.fecha?.getTime() || 0)));
  ordenesLibresDe.forEach((arr) => arr.sort((a, b) => (b.fecha?.getTime() || 0) - (a.fecha?.getTime() || 0)));
  const serialConflictivo = (n) => (evidenciaSerial.get(n)?.size || 0) > 1;

  // ── Match por cliente ──
  const asignaciones = []; // {cid, contrato_id, cliente, renglon, serial, unit}
  const reporte = [];      // filas detalle (también para CSV)
  const stats = { contratosTotales: contratos.length, contratosConAsignacion: 0,
    unidadesAsignadas: 0, unidadesPorOrdenes: 0, unidadesPorPoc: 0, unidadesPorFecha: 0,
    serialesConflictivosExcluidos: 0, renglonesAmbiguoMultiContrato: 0,
    renglonesSobranCandidatos: 0, renglonesSinCandidatos: 0, renglonesNoAplica: 0 };

  for (const [kCliente, cs] of porCliente) {
    const radios = (radiosDe.get(kCliente) || [])
      .filter((r) => !yaAmparado(r.serial, r.modelo_id, r.modelo_label));
    const usados = new Set(); // norm ya asignado en esta corrida (cliente)

    // Renglones de TODOS los contratos pendientes del cliente, con faltantes
    const renglones = []; // {c, modelo_id, modelo, faltan}
    for (const c of cs) {
      const cancelado = c.baja_cancelado || {};
      const existentes = serialesDe.get(c.id) || [];
      const usadosExist = new Set(existentes.map((s) => pool.normSerial(s.serial)));
      usadosExist.forEach((n) => usados.add(n));
      for (const eq of (c.equipos || [])) {
        if (esNoAplica(eq.modelo)) { stats.renglonesNoAplica++; continue; }
        const key = String(eq.modelo_id || eq.modelo);
        const activos = Math.max(0, Number(eq.cantidad || 0) - Number(cancelado[key] || 0));
        if (!activos) continue;
        const yaPuestos = existentes.filter((s) => mm(s.modelo_id, s.modelo, eq.modelo_id, eq.modelo)).length;
        const faltan = Math.max(0, activos - yaPuestos);
        if (faltan) renglones.push({ c, modelo_id: eq.modelo_id || null, modelo: eq.modelo || "", faltan });
      }
    }

    // ── Tier A: órdenes vinculadas al contrato (evidencia directa) ──
    // Resuelve incluso la ambigüedad multi-contrato: la orden dice a qué
    // contrato pertenece el serial. Más reciente primero (flota vigente).
    for (const r of renglones) {
      if (!r.faltan) continue;
      const vinculadas = ordenesPorContrato.get(r.c.id) || [];
      const cand = [];
      const vistos = new Set();
      for (const o of vinculadas) {
        for (const e of o.equipos) {
          const n = pool.normSerial(e.serial);
          if (vistos.has(n) || usados.has(n)) continue;
          if (!mm(e.modelo_id, e.modelo, r.modelo_id, r.modelo)) continue;
          if (serialConflictivo(n)) { stats.serialesConflictivosExcluidos++; vistos.add(n); continue; }
          if (yaAmparado(e.serial, e.modelo_id, e.modelo)) { vistos.add(n); continue; }
          vistos.add(n);
          cand.push({ ...e, orden: o.numero });
          if (cand.length >= r.faltan) break;
        }
        if (cand.length >= r.faltan) break;
      }
      if (!cand.length) continue;
      for (const e of cand) {
        usados.add(pool.normSerial(e.serial));
        asignaciones.push({ cid: r.c.id, contrato_id: r.c.contrato_id || r.c.id,
          cliente_id: r.c.cliente_id || "", cliente_nombre: r.c.cliente_nombre || "",
          modelo: r.modelo, modelo_id: r.modelo_id, serial: e.serial,
          source: "auto-match-ordenes", orden: e.orden });
      }
      stats.unidadesPorOrdenes += cand.length;
      stats.unidadesAsignadas += cand.length;
      reporte.push({ contrato: r.c.contrato_id || r.c.id, cliente: r.c.cliente_nombre || "",
        renglon: r.modelo, faltan: r.faltan, candidatos: cand.length,
        resultado: `ASIGNA ${cand.length} por ÓRDENES${cand.length === r.faltan ? " (completa el renglón)" : " (parcial)"}`,
        seriales: cand.map((x) => `${x.serial}(OS ${x.orden})`).join(" ") });
      r.faltan -= cand.length;
    }

    // ── Tier B: POC estricto (solo casos inequívocos) ──
    for (const r of renglones) {
      if (!r.faltan) continue;
      // Ambigüedad multi-contrato: otro renglón pendiente del MISMO modelo en otro contrato
      const rivales = renglones.filter((o) => o !== r && o.c.id !== r.c.id && o.faltan > 0
        && mm(o.modelo_id, o.modelo, r.modelo_id, r.modelo));
      const candidatos = radios.filter((x) => !usados.has(pool.normSerial(x.serial))
        && mm(x.modelo_id, x.modelo_label, r.modelo_id, r.modelo));
      const base = { contrato: r.c.contrato_id || r.c.id, cliente: r.c.cliente_nombre || "",
        renglon: r.modelo, faltan: r.faltan, candidatos: candidatos.length };

      if (rivales.length) {
        stats.renglonesAmbiguoMultiContrato++;
        reporte.push({ ...base, resultado: "SKIP: mismo modelo en varios contratos del cliente", seriales: "" });
        continue;
      }
      if (!candidatos.length) {
        stats.renglonesSinCandidatos++;
        reporte.push({ ...base, resultado: "SKIP: sin radios POC libres de ese modelo", seriales: "" });
        continue;
      }
      if (candidatos.length > r.faltan) {
        stats.renglonesSobranCandidatos++;
        reporte.push({ ...base, resultado: `SKIP: ${candidatos.length} candidatos para ${r.faltan} casillas (elegir sería arbitrario)`, seriales: "" });
        continue;
      }
      // Inequívoco: candidatos ≤ faltantes → asignar todos
      for (const x of candidatos) {
        usados.add(pool.normSerial(x.serial));
        asignaciones.push({ cid: r.c.id, contrato_id: r.c.contrato_id || r.c.id,
          cliente_id: r.c.cliente_id || "", cliente_nombre: r.c.cliente_nombre || "",
          modelo: r.modelo, modelo_id: r.modelo_id, serial: x.serial, unit: x.unit,
          source: "auto-match-poc" });
      }
      stats.unidadesPorPoc += candidatos.length;
      stats.unidadesAsignadas += candidatos.length;
      reporte.push({ ...base, resultado: `ASIGNA ${candidatos.length} por POC${candidatos.length === r.faltan ? " (completa el renglón)" : " (parcial)"}`,
        seriales: candidatos.map((x) => x.serial).join(" ") });
      r.faltan -= candidatos.length;
    }

    // ── Tier C (--con-fechas): órdenes libres del cliente en la vigencia ──
    if (conFechas) {
      const libres = ordenesLibresDe.get(kCliente) || [];
      for (const r of renglones) {
        if (!r.faltan || !libres.length) continue;
        const rivales = renglones.filter((o) => o !== r && o.c.id !== r.c.id && o.faltan > 0
          && mm(o.modelo_id, o.modelo, r.modelo_id, r.modelo));
        if (rivales.length) continue; // ya reportado por el tier POC
        const ini = fechaDe(r.c.fecha_creacion);
        const desde = ini ? new Date(ini.getTime() - 30 * 24 * 3600 * 1000) : null;
        const vistos = new Set();
        const candidatos = [];
        for (const o of libres) {
          if (desde && (!o.fecha || o.fecha < desde)) continue;
          for (const e of o.equipos) {
            const n = pool.normSerial(e.serial);
            if (vistos.has(n)) continue;
            vistos.add(n);
            if (usados.has(n) || reservadoPorVinculo.has(n) || serialConflictivo(n)) continue;
            if (yaAmparado(e.serial, e.modelo_id, e.modelo)) continue;
            if (!mm(e.modelo_id, e.modelo, r.modelo_id, r.modelo)) continue;
            candidatos.push({ ...e, orden: o.numero });
          }
        }
        if (!candidatos.length || candidatos.length > r.faltan) continue; // ya reportado antes
        for (const e of candidatos) {
          usados.add(pool.normSerial(e.serial));
          asignaciones.push({ cid: r.c.id, contrato_id: r.c.contrato_id || r.c.id,
            cliente_id: r.c.cliente_id || "", cliente_nombre: r.c.cliente_nombre || "",
            modelo: r.modelo, modelo_id: r.modelo_id, serial: e.serial,
            source: "auto-match-fecha", orden: e.orden });
        }
        stats.unidadesPorFecha += candidatos.length;
        stats.unidadesAsignadas += candidatos.length;
        reporte.push({ contrato: r.c.contrato_id || r.c.id, cliente: r.c.cliente_nombre || "",
          renglon: r.modelo, faltan: r.faltan, candidatos: candidatos.length,
          resultado: `ASIGNA ${candidatos.length} por FECHA${candidatos.length === r.faltan ? " (completa el renglón)" : " (parcial)"}`,
          seriales: candidatos.map((x) => `${x.serial}(OS ${x.orden})`).join(" ") });
        r.faltan -= candidatos.length;
      }
    }
  }

  const porContrato = new Map();
  asignaciones.forEach((a) => {
    (porContrato.get(a.cid) || porContrato.set(a.cid, []).get(a.cid)).push(a);
  });
  stats.contratosConAsignacion = porContrato.size;

  // ── Escritura ──
  if (!dryRun) {
    let batch = db.batch(), ops = 0;
    const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };
    for (const [cid, items] of porContrato) {
      for (const a of items) {
        const ref = db.collection("contratos").doc(cid).collection("seriales").doc();
        batch.set(ref, {
          serial: a.serial, modelo: a.modelo, modelo_id: a.modelo_id || "",
          contrato_doc_id: cid, contrato_id: a.contrato_id,
          cliente_id: a.cliente_id, cliente_nombre: a.cliente_nombre,
          source: a.source || "auto-match-poc",
          ...(a.orden ? { source_orden: a.orden } : {}),
          created_at: admin.firestore.FieldValue.serverTimestamp(), created_by: null,
          updated_at: admin.firestore.FieldValue.serverTimestamp(), updated_by: null,
        });
        ops++;
        if (ops >= 400) await flush();
      }
      const hist = db.collection("contratos").doc(cid).collection("seriales_historial").doc();
      batch.set(hist, {
        at: admin.firestore.FieldValue.serverTimestamp(), por: "system",
        estado: "legacy", contrato_id: items[0].contrato_id,
        cliente_id: items[0].cliente_id, cliente_nombre: items[0].cliente_nombre,
        agregados: items.map((a) => ({ serial: a.serial, modelo: a.modelo })),
        eliminados: [],
        nota: "Match automático POC→contrato legacy (scripts/match-legacy-seriales.js)",
      });
      ops++;
      if (ops >= 400) await flush();
    }
    await flush();
  }

  // ── Reporte ──
  console.log(`match-legacy-seriales — ${dryRun ? "DRY-RUN (no escribe)" : "ESCRITURA REAL"}`);
  console.log(JSON.stringify(stats, null, 2));
  if (csvOut) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + ["Contrato;Cliente;Renglón;Faltan;Candidatos;Resultado;Seriales",
      ...reporte.map((f) => [f.contrato, f.cliente, f.renglon, f.faltan, f.candidatos, f.resultado, f.seriales].map(esc).join(";"))].join("\r\n");
    require("fs").writeFileSync(csvOut, csv, "utf8");
    console.log(`Detalle → ${csvOut}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
