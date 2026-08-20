/**
 * sanear-entregas-no-registradas.js — Cierra las órdenes cuyo equipo YA salió
 * del taller pero que nadie marcó "ENTREGADO AL CLIENTE".
 *
 * CONTEXTO (diagnóstico 2026-08-20). 67 órdenes en COMPLETADO (EN OFICINA) con
 * el trabajo terminado y el QC aprobado. NINGUNA tiene firma, receptor ni nota
 * de entrega: el modal de entrega jamás se abrió. Repartidas parejo entre los
 * tres técnicos y entre muchos clientes, así que no es una persona — es un paso
 * que nadie hace, agravado porque la bandeja carga las 40 más recientes y estas
 * se reparten en once meses: recepción no podía verlas aunque quisiera.
 *
 * Consecuencias: 182 radios contados en el taller que no están ahí, y contratos
 * cuya renovación no corre porque nunca se estampó `entrega_confirmada`.
 *
 * QUÉ SANEA. Solo las que tienen evidencia EXTERNA de que el equipo salió, y
 * más de `--dias` (90 por defecto). La evidencia es independiente del propio
 * flujo de la orden — ojo, el estado `en_taller` del pool NO sirve: lo fija esa
 * misma entrega que falta, así que sería circular. Vale como evidencia:
 *   1. algún serial aparece en una orden POSTERIOR (el radio salió y volvió), o
 *   2. el pool movió el serial por OTRA vía (en_cliente, en_bodega, …).
 * El corte de 90 días no es arbitrario: en el diagnóstico, TODAS las órdenes de
 * más de 90 días tenían evidencia, y ninguna sin evidencia pasaba de 90. Un
 * taller no guarda un radio 300 días.
 *
 * ⚠️ LO QUE NO TOCA, Y POR QUÉ. Marcar ENTREGADO dispara dos triggers:
 *   · onOrdenWritePool  → mueve las unidades en_taller → en_cliente. DESEADO:
 *     es justo lo que corrige el inventario.
 *   · onOrdenEntregada  → estampa `entrega_confirmada` en el contrato, y eso
 *     despierta a onEntregaTransicion, que en RENOVACIÓN/REEMP **crea órdenes
 *     de recuperación** del equipo viejo. Sobre un contrato de hace un año eso
 *     serían reclamos falsos de equipo ya resuelto (mismo riesgo que documenta
 *     docs/… devoluciones duplicadas en reemplazos).
 * Por eso las órdenes cuyo contrato dispararía una transición se EXCLUYEN y se
 * listan aparte para decisión humana. El script nunca las cierra solo.
 *
 * NO inventa firma ni receptor: no los tenemos. Deja la orden marcada como
 * saneada (`entrega_saneada`) con su evidencia, para que se distinga siempre de
 * una entrega registrada de verdad.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/sanear-entregas-no-registradas.js                 # dry-run
 *   node scripts/sanear-entregas-no-registradas.js --dias 90
 *   node scripts/sanear-entregas-no-registradas.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const iDias = process.argv.indexOf("--dias");
const MIN_DIAS = iDias > -1 ? Number(process.argv[iDias + 1]) : 90;
const ENTREGADO = "ENTREGADO AL CLIENTE";

const now = new Date();
const aDate = (ts) => { if (!ts) return null; if (ts.toDate) return ts.toDate();
  const d = new Date(ts); return isNaN(d.getTime()) ? null : d; };
const edadDias = (ts) => { const d = aDate(ts); return d ? (now - d) / 864e5 : null; };
const norm = (s) => String(s ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

// Espejo de la guarda de onEntregaTransicion: si esto es cierto, confirmar la
// entrega abriría una recuperación del equipo de origen.
function dispararaTransicion(c) {
  if (!c) return false;
  if (c.entrega_confirmada === true) return false;      // ya estampado: no re-dispara
  const origen = c.origen_ids || c.origen_contrato_ids || c.renovacion_de_ids || [];
  const tieneOrigen = Array.isArray(origen) ? origen.length > 0 : !!origen;
  return !c.renovacion_sin_equipo && tieneOrigen
    && (c.accion === "Renovación" || c.codigo_tipo === "REEMP");
}

(async () => {
  const snap = await db.collection("ordenes_de_servicio").limit(5000).get();

  const candidatas = [], todas = [];
  snap.forEach((d) => {
    const o = d.data() || {};
    const seriales = (o.equipos || []).filter((e) => !e.eliminado)
      .map((e) => norm(e.numero_de_serie || e.serial)).filter(Boolean);
    todas.push({ id: d.id, seriales, creada: aDate(o.fecha_creacion) });

    if (o.eliminado) return;
    if ((o.estado_reparacion || "") !== "COMPLETADO (EN OFICINA)") return;
    const tipo = (o.tipo_de_servicio || "").toUpperCase();
    if (!/PROGRAMA|REPARA/.test(tipo)) return;
    if (o.qc_requerido === true) {
      if (o.qc?.resultado !== "aprobado") return;
      const n = o.qc?.equipos_n;
      if (typeof n === "number" && n !== (Array.isArray(o.equipos) ? o.equipos.length : 0)) return;
    }
    const completada = aDate(o.fecha_completado || o.fecha_modificacion || o.fecha_creacion);
    const edad = edadDias(completada);
    if (edad == null || edad < MIN_DIAS) return;

    candidatas.push({
      id: d.id, seriales, completada, dias: Math.floor(edad),
      cliente: o.cliente_nombre || o.cliente || "—",
      contratoDocId: o.contrato?.contrato_doc_id || "",
      contratoId: o.contrato?.contrato_id || "",
    });
  });

  // Índice serial → órdenes (para la evidencia "aparece en una orden posterior")
  const porSerial = new Map();
  for (const o of todas) for (const s of o.seriales) {
    if (!porSerial.has(s)) porSerial.set(s, []);
    porSerial.get(s).push(o);
  }
  // Estado del pool de los seriales implicados
  const necesarios = [...new Set(candidatas.flatMap((c) => c.seriales))];
  const estadoPool = new Map();
  for (let i = 0; i < necesarios.length; i += 30) {
    const q = await db.collection("equipos_pool")
      .where("serial_norm", "in", necesarios.slice(i, i + 30)).get();
    q.forEach((d) => { const u = d.data() || {}; estadoPool.set(u.serial_norm, u.estado || "?"); });
  }

  const seguras = [], revisar = [], sinEvidencia = [];
  for (const c of candidatas) {
    const posterior = c.seriales.filter((s) => (porSerial.get(s) || [])
      .some((o) => o.id !== c.id && o.creada && c.completada && o.creada > c.completada));
    const movidos = c.seriales.filter((s) => {
      const e = estadoPool.get(s);
      return e && e !== "en_taller";
    });
    if (!posterior.length && !movidos.length) { sinEvidencia.push(c); continue; }

    c.evidencia = posterior.length
      ? `${posterior.length} serial(es) en una orden posterior`
      : `${movidos.length} serial(es) movidos en inventario por otra vía`;

    if (c.contratoDocId) {
      const cd = await db.collection("contratos").doc(c.contratoDocId).get();
      const cData = cd.exists ? cd.data() : null;
      if (dispararaTransicion(cData)) {
        c.motivoRevisar = `contrato ${c.contratoId || c.contratoDocId} es ${cData.accion || cData.codigo_tipo}`
          + " con origen: confirmar la entrega abriría una recuperación del equipo viejo";
        revisar.push(c);
        continue;
      }
    }
    seguras.push(c);
  }

  const linea = (c) => `  ${String(c.dias).padStart(4)}d  ${c.id.padEnd(12)} `
    + `${c.cliente.slice(0, 32).padEnd(33)} ${String(c.seriales.length).padStart(2)} eq  ${c.evidencia || ""}`;

  console.log(`Candidatas COMPLETADO con ${MIN_DIAS}+ días: ${candidatas.length}`);
  console.log(`\n=== A CERRAR (${seguras.length}) ===`);
  seguras.sort((a, b) => b.dias - a.dias).forEach((c) => console.log(linea(c)));

  console.log(`\n=== EXCLUIDAS — abrirían una recuperación, decisión humana (${revisar.length}) ===`);
  revisar.forEach((c) => { console.log(linea(c)); console.log(`        ↳ ${c.motivoRevisar}`); });

  console.log(`\n=== EXCLUIDAS — sin evidencia externa (${sinEvidencia.length}) ===`);
  sinEvidencia.forEach((c) => console.log(linea(c)));

  if (!EXECUTE) {
    console.log(`\n(dry-run — nada escrito. Añade --execute para cerrar las ${seguras.length} del primer bloque.)`);
    process.exit(0);
  }

  console.log(`\nEscribiendo ${seguras.length} entregas…`);
  let ok = 0;
  for (const c of seguras) {
    try {
      await db.collection("ordenes_de_servicio").doc(c.id).update({
        estado_reparacion: ENTREGADO,
        // La fecha de la entrega REAL no se conoce; se usa la de completado,
        // que es la más cercana defendible y nunca posterior a la salida.
        fecha_entrega: c.completada || admin.firestore.FieldValue.serverTimestamp(),
        // Marca permanente: esto NO es una entrega registrada por alguien.
        entrega_saneada: true,
        entrega_saneada_at: admin.firestore.FieldValue.serverTimestamp(),
        entrega_saneada_motivo: "Cierre administrativo: el equipo salió del taller pero la entrega nunca se registró.",
        entrega_saneada_evidencia: c.evidencia,
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "ENTREGA_SANEADA",
          by: "script:sanear-entregas-no-registradas",
          evidencia: c.evidencia,
          fecha_iso: new Date().toISOString(),
        }),
      });
      ok++;
      console.log(`  ✓ ${c.id}`);
    } catch (e) {
      console.error(`  ✗ ${c.id}: ${e.message}`);
    }
  }
  console.log(`\nListo: ${ok}/${seguras.length} cerradas.`);
  console.log("Los triggers moverán sus radios a en_cliente y estamparán la entrega en el contrato.");
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
