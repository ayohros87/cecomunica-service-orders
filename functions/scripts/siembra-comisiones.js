/**
 * siembra-comisiones.js — F2 de docs/plans/PLAN_COMISIONES.md.
 *
 * `facturacion_avisos` nació el 2026-09-04 y tiene 11 documentos. Zuleika
 * revisa comisiones de junio en adelante, así que sin sembrar la bandeja nace
 * vacía y no sirve para lo que la pidió.
 *
 * QUÉ HACE (tres partes, todas idempotentes)
 *   A) `comision` en los avisos que YA existen (nacieron sin el bloque).
 *   B) un aviso por contrato ACTIVADO desde --desde que no tenga ninguno, y
 *      por gestión de aumento CERRADA en el mismo rango.
 *   C) los contratos con la marca vieja `listo_para_comision` entran con
 *      `comision.estado: 'pagada'` — esa marca es la única constancia de que
 *      administración ya los revisó y pagó.
 *
 * LAS DOS TRAMPAS QUE EVITA (ninguna estaba en el plan)
 *   1. Los avisos de contratos viejos nacen en estado **'hecho'**, no
 *      'pendiente'. Un contrato activo desde julio ya se está facturando:
 *      meterlo como pendiente inundaría la bandeja de Recepción con 40 filas
 *      de trabajo ya hecho y volvería inútil la única pantalla que hoy sí
 *      usan. Los pasos quedan con `fuente: 'siembra'` para que nadie crea que
 *      una persona los marcó.
 *      Pero 'hecho' NO se pone a ciegas: solo para contratos activados ANTES
 *      de que el aviso empezara a salir por correo (AVISOS_DESDE). Uno
 *      posterior y sin aviso significa que algo se escapó, y nace 'pendiente'
 *      para que Recepción lo vea. Marcar todo 'hecho' escondería trabajo real.
 *   2. El PAGO no se inventa: queda pendiente para que Zuleika lo confirme (o
 *      QuickBooks en la F4). Dar por pagado un contrato porque lleva meses
 *      activo es exactamente el atajo que hace que una comisión se pague dos
 *      veces. La ÚNICA excepción es la marca vieja `listo_para_comision`, que
 *      es constancia de que administración ya lo revisó y pagó.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/siembra-comisiones.js                      # dry-run
 *   node scripts/siembra-comisiones.js --apply
 *   node scripts/siembra-comisiones.js --desde=2026-01-01 --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const FA = require("../src/lib/facturacionAvisos");

const APPLY = process.argv.includes("--apply");
const desdeArg = (process.argv.find((a) => a.startsWith("--desde=")) || "").split("=")[1] || "2026-06-01";
const DESDE = new Date(`${desdeArg}T00:00:00-05:00`);

const COL = "facturacion_avisos";

// Desde esta fecha el aviso de facturación YA salía por correo (es el default
// de backfill-facturacion-avisos.js). Un contrato activado antes: la facturación
// se hizo a mano y ya está corriendo → el aviso nace 'hecho'. Activado después
// y SIN aviso: algo se escapó, así que nace 'pendiente' para que Recepción lo
// vea. Marcar 'hecho' a ciegas escondería trabajo real.
const AVISOS_DESDE = new Date("2026-09-02T00:00:00-05:00");
const fecha = (t) => (t?.toDate ? t.toDate() : (t ? new Date(t) : null));
const iso = (t) => { const d = fecha(t); return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "—"; };

// Tipo de aviso que le corresponde a un contrato por su acción.
const tipoDeContrato = (c) => (c.accion === "Renovación" ? "renovacion_activa" : "contrato_activo");

const cuenta = { comision_agregada: 0, avisos_creados: 0, pagadas: 0, saltados: 0 };
const plan = [];

async function main() {
  console.log(`Siembra de comisiones — desde ${desdeArg}${APPLY ? "" : "  (DRY-RUN)"}\n`);

  // ── A) `comision` en los avisos que ya existen ────────────────────────────
  const avisos = await db.collection(COL).get();
  console.log(`A) Avisos existentes: ${avisos.size}`);
  for (const d of avisos.docs) {
    const a = d.data() || {};
    if (a.comision) { cuenta.saltados++; continue; }
    const [contrato, gestion] = await Promise.all([
      a.contrato_doc_id ? db.collection("contratos").doc(a.contrato_doc_id).get().then((s) => (s.exists ? s.data() : null)) : null,
      a.gestion_id ? db.collection("gestiones").doc(a.gestion_id).get().then((s) => (s.exists ? s.data() : null)) : null,
    ]);
    const comision = FA.bloqueComision(a.tipo, {
      contrato, gestion, resumen: a.resumen || {},
      vendedorEmail: await FA.vendedorDeComision({ contrato, gestion }),
    });
    plan.push({ que: "comision", ref: d.ref, id: d.id,
      etiqueta: `${a.contrato_id || a.gestion_id || d.id} · ${a.cliente_nombre || "—"}`,
      detalle: `${a.tipo} → ${comision.estado}${comision.aplica ? ` · base $${Number(comision.base || 0).toFixed(2)} · ${comision.vendedor_email || "SIN VENDEDOR"}` : ` (${comision.motivo})`}`,
      datos: { comision } });
    cuenta.comision_agregada++;
  }

  // ── B) un aviso por contrato activado desde DESDE, si no tiene ────────────
  const contratos = await db.collection("contratos").where("estado", "==", "activo").get();
  const yaConAviso = new Set(avisos.docs.map((d) => (d.data() || {}).contrato_doc_id).filter(Boolean));
  let enRango = 0;
  for (const d of contratos.docs) {
    const c = d.data() || {};
    if (c.deleted === true) continue;
    const fa = fecha(c.fecha_activacion) || fecha(c.fecha_creacion);
    if (!fa || fa < DESDE) continue;
    enRango++;
    if (yaConAviso.has(d.id)) { cuenta.saltados++; continue; }

    const tipo = tipoDeContrato(c);
    const m = FA.mensualDeContrato(c);
    const resumen = {
      equipos: FA.equiposTexto(c.equipos), equipos_n: m.equipos_n,
      mensual: m.mensual, con_itbms: m.con_itbms, exento: m.exento, unico: m.unico,
      delta_mensual: m.mensual,
    };
    const comision = FA.bloqueComision(tipo, {
      contrato: c, resumen,
      vendedorEmail: await FA.vendedorDeComision({ contrato: c }),
    });
    // La marca vieja es la única constancia de que ya se revisó y se pagó.
    const yaPagada = c.listo_para_comision === true;
    if (yaPagada && comision.aplica) {
      comision.requisitos.pago = { ...comision.requisitos.pago, hecho: true, at: c.fecha_envio_comision || null,
        fuente: "marca_modulo_anterior", motivo: null };
      comision.estado = "pagada";
      comision.periodo = iso(c.fecha_envio_comision || c.fecha_activacion).slice(0, 7);
      comision.liberada_por = c.enviado_por_uid || null;
      comision.liberada_at = c.fecha_envio_comision || null;
      comision.nota = "marca del módulo anterior (listo_para_comision)";
      cuenta.pagadas++;
    }

    // Facturación: 'hecho' solo si el contrato se activó ANTES de que el aviso
    // empezara a salir. Si es posterior y no tiene aviso, algo se escapó.
    const yaFacturado = fa < AVISOS_DESDE;
    const paso = (aplica) => ({ aplica: !!aplica, hecho: !!aplica && yaFacturado,
      at: yaFacturado ? (c.fecha_activacion || null) : null,
      por_email: null, fuente: yaFacturado ? "siembra" : null });
    plan.push({ que: "aviso", ref: db.collection(COL).doc(FA.avisoId(tipo, d.id)), id: FA.avisoId(tipo, d.id),
      etiqueta: `${c.contrato_id || d.id} · ${c.cliente_nombre || "—"}`,
      detalle: `${tipo} · activado ${iso(c.fecha_activacion)} · facturación ${yaFacturado ? "hecho" : "PENDIENTE"} · comisión ${comision.estado}${comision.aplica ? ` · base $${Number(comision.base || 0).toFixed(2)} · ${comision.vendedor_email || "SIN VENDEDOR"}` : ""}`,
      datos: {
        tipo, efecto: FA.TIPOS[tipo].efecto, titulo: FA.TIPOS[tipo].titulo,
        estado: yaFacturado ? "hecho" : "pendiente",
        cliente_id: c.cliente_id || null, cliente_nombre: c.cliente_nombre || "",
        vendedor_email: null,
        contrato_id: c.contrato_id || d.id, contrato_doc_id: d.id, gestion_id: null, orden_id: null,
        origen: { col: "contratos", id: d.id, source: "siembra-comisiones" },
        fecha_efectiva: c.fecha_activacion || c.fecha_creacion || null,
        contexto: { tipo_contrato: c.tipo_contrato || null, duracion: c.duracion || null,
          origen_texto: yaFacturado
            ? `Sembrado para comisiones (contrato ${c.estado}; la facturación ya había corrido a mano)`
            : `Sembrado para comisiones (contrato ${c.estado}) — SIN aviso previo: revisar si ya se facturó` },
        resumen, detalle: { lineas: c.equipos || [], cargos: c.cargos || [] },
        pasos: { qbo: paso(true), poc: paso(true) },
        comision,
        descarte: null, reenvio_solicitado: null,
        correo: { mail_queue_id: null, status: null, error: null },
        historial: [{ accion: "sembrado",
          detalle: yaFacturado
            ? "Aviso sembrado para la bandeja de comisiones; la facturación de este contrato ya había corrido a mano"
            : "Aviso sembrado para la bandeja de comisiones; se activó después de que los avisos empezaron a salir y no tenía ninguno — queda PENDIENTE por revisar",
          fecha_iso: new Date().toISOString(), por_email: null }],
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      } });
    cuenta.avisos_creados++;
  }
  console.log(`B) Contratos activos con activación >= ${desdeArg}: ${enRango}`);

  // ── B2) gestiones de aumento CERRADAS en el rango ────────────────────────
  const gestiones = await db.collection("gestiones").where("tipo", "==", "aumento").get();
  const yaConGestion = new Set(avisos.docs.map((d) => (d.data() || {}).gestion_id).filter(Boolean));
  let gEnRango = 0;
  for (const d of gestiones.docs) {
    const g = d.data() || {};
    if (g.deleted === true || g.estado !== "cerrada") continue;
    if (g.aumento?.es_regularizacion === true || g.aumento?.es_ajuste === true) continue;
    const fs = fecha(g.fecha_solicitud);
    if (!fs || fs < DESDE) continue;
    gEnRango++;
    if (yaConGestion.has(d.id)) { cuenta.saltados++; continue; }

    const a = g.aumento || {};
    const mensual = Number(a.totales?.total_mensual ?? 0);
    const resumen = { equipos: FA.equiposTexto(a.lineas), mensual, delta_mensual: mensual,
      equipos_n: (a.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0) };
    const comision = FA.bloqueComision("aumento_entregado", {
      gestion: g, resumen, vendedorEmail: await FA.vendedorDeComision({ gestion: g }),
    });
    const paso = () => ({ aplica: true, hecho: true, at: g.fecha_solicitud || null, por_email: null, fuente: "siembra" });
    plan.push({ que: "aviso", ref: db.collection(COL).doc(FA.avisoId("aumento_entregado", d.id)),
      id: FA.avisoId("aumento_entregado", d.id),
      etiqueta: `${d.id} · ${g.cliente_nombre || "—"}`,
      detalle: `aumento_entregado · cerrada · comisión ${comision.estado} · base $${mensual.toFixed(2)} · ${comision.vendedor_email || "SIN VENDEDOR"}`,
      datos: {
        tipo: "aumento_entregado", efecto: "cambia", titulo: FA.TIPOS.aumento_entregado.titulo,
        estado: "hecho",
        cliente_id: g.cliente_id || null, cliente_nombre: g.cliente_nombre || "",
        vendedor_email: null,
        contrato_id: a.contrato_id || null, contrato_doc_id: a.contrato_doc_id || null,
        gestion_id: d.id, orden_id: null,
        origen: { col: "gestiones", id: d.id, source: "siembra-comisiones" },
        fecha_efectiva: g.fecha_solicitud || null,
        contexto: { origen_texto: "Sembrado para comisiones (gestión cerrada)" },
        resumen, detalle: { lineas: a.lineas || [], cargos: a.cargos || [] },
        pasos: { qbo: paso(), poc: paso() },
        comision,
        descarte: null, reenvio_solicitado: null,
        correo: { mail_queue_id: null, status: null, error: null },
        historial: [{ accion: "sembrado", detalle: "Gestión cerrada sembrada para la bandeja de comisiones",
          fecha_iso: new Date().toISOString(), por_email: null }],
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      } });
    cuenta.avisos_creados++;
  }
  console.log(`B2) Gestiones de aumento cerradas >= ${desdeArg}: ${gEnRango}\n`);

  // ── Informe ──────────────────────────────────────────────────────────────
  const porEstado = {}; const sinVendedor = [];
  for (const p of plan) {
    const c = p.datos.comision;
    if (!c) continue;
    porEstado[c.estado] = (porEstado[c.estado] || 0) + 1;
    if (c.aplica && !c.vendedor_email) sinVendedor.push(p.etiqueta);
  }
  console.log("Lo que va a quedar:");
  for (const p of plan) console.log(`  [${p.que === "aviso" ? "nuevo" : "comisión"}] ${p.etiqueta}\n      ${p.detalle}`);
  console.log(`\nResumen: ${cuenta.avisos_creados} aviso(s) nuevo(s) · ${cuenta.comision_agregada} bloque(s) de comisión sobre avisos existentes · ${cuenta.pagadas} marcada(s) 'pagada' por la marca vieja · ${cuenta.saltados} sin cambios`);
  console.log(`Comisiones por estado: ${JSON.stringify(porEstado)}`);
  if (sinVendedor.length) {
    console.log(`\nOJO — ${sinVendedor.length} comisionable(s) SIN VENDEDOR (la ficha del cliente no tiene vendedor_asignado y el contrato no dice quién lo creó):`);
    sinVendedor.slice(0, 15).forEach((s) => console.log(`  · ${s}`));
    if (sinVendedor.length > 15) console.log(`  … y ${sinVendedor.length - 15} más`);
    console.log("  No se les puede pagar comisión hasta que alguien diga de quién son.");
  }

  if (!APPLY) { console.log("\nDRY-RUN. Corre con --apply para escribir."); return; }

  console.log("\nEscribiendo…");
  let lote = db.batch(); let enLote = 0; let escritos = 0;
  for (const p of plan) {
    if (p.que === "aviso") lote.set(p.ref, p.datos);
    else lote.set(p.ref, { ...p.datos, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    enLote++; escritos++;
    if (enLote >= 400) { await lote.commit(); lote = db.batch(); enLote = 0; }
  }
  if (enLote) await lote.commit();
  console.log(`Listo — ${escritos} documento(s) escritos.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
