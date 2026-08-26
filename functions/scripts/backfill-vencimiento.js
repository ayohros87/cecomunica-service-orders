/**
 * backfill-vencimiento.js — Estampa la vigencia del tramo inicial en los
 * contratos ACTIVOS que no tienen `fecha_vencimiento` (Ola 1 del plan de
 * gestiones por cliente, docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md).
 *
 * CONTEXTO (2026-08-26). `duracion` siempre fue texto del PDF y NADIE escribía
 * `fecha_vencimiento` — admin-integridad chk5 lo chequea desde siempre contra
 * un campo que no existe. Sin este dato no hay señal de renovación (aviso a 60
 * días, decisión de Alberto) ni ventana de renovación anticipada (3 meses en
 * contratos de 18+ meses).
 *
 * QUÉ TOCA (solo con --write): `fecha_vencimiento`, `vencimiento_estado`,
 * `vigencia{...}` en contratos activos sin el campo. NADA MÁS: no toca estado,
 * facturación ni seriales. Nada se bloquea al vencer — es solo señal.
 * QUÉ NO: contratos con `duracion` no parseable quedan fuera y se listan en el
 * reporte para arreglarlos a mano (fijar duración o dejarlos sin señal).
 *
 * La fecha de inicio del tramo sale de la mejor fuente disponible, en orden:
 * facturacion_fecha_inicio → fecha_entrega_ultima → fecha_aprobacion →
 * fecha_creacion (misma regla que el trigger onContratoActivado).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-vencimiento.js            # dry-run: solo reporte
 *   node scripts/backfill-vencimiento.js --write    # aplica
 * Idempotente: un contrato con fecha_vencimiento se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const V = require("../src/lib/vigencia");

const dryRun = !process.argv.includes("--write");
const AUTOR = "script:backfill-vencimiento";

function fmt(d) { return d ? d.toISOString().slice(0, 10) : "—"; }

(async () => {
  const snap = await db.collection("contratos").where("estado", "==", "activo").get();
  const now = new Date();

  const yaTienen = [];
  const sinDuracion = [];
  const aEstampar = [];
  const fuentes = {};
  let borrados = 0;

  snap.forEach((d) => {
    const c = d.data() || {};
    if (c.deleted) { borrados++; return; }
    if (c.fecha_vencimiento) { yaTienen.push(d.id); return; }

    const meses = V.parseDuracionMeses(c.duracion);
    if (!meses) {
      sinDuracion.push({ id: d.id, contrato: c.contrato_id || d.id, cliente: c.cliente_nombre || "—", duracion: c.duracion || "(vacía)" });
      return;
    }
    const { fecha, fuente } = V.mejorFechaInicio(c);
    if (!fecha) {
      sinDuracion.push({ id: d.id, contrato: c.contrato_id || d.id, cliente: c.cliente_nombre || "—", duracion: `${c.duracion} (sin fecha de inicio)` });
      return;
    }
    const fv = V.calcularVencimiento(fecha, meses);
    const estado = V.estadoVencimiento(fv, now);
    fuentes[fuente] = (fuentes[fuente] || 0) + 1;
    aEstampar.push({ ref: d.ref, id: d.id, contrato: c.contrato_id || d.id, cliente: c.cliente_nombre || "—", inicio: fecha, fuente, meses, fv, estado });
  });

  const vencidos = aEstampar.filter((x) => x.estado === "vencido");
  const porVencer = aEstampar.filter((x) => x.estado === "por_vencer");

  console.log(`\n=== backfill-vencimiento ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);
  console.log(`Contratos activos leídos: ${snap.size} (borrados omitidos: ${borrados})`);
  console.log(`Ya tenían fecha_vencimiento: ${yaTienen.length}`);
  console.log(`A estampar: ${aEstampar.length}  →  vigentes: ${aEstampar.length - vencidos.length - porVencer.length} · por_vencer(≤60d): ${porVencer.length} · vencidos: ${vencidos.length}`);
  console.log(`Fuente de la fecha de inicio:`, fuentes);
  console.log(`Sin duración parseable (quedan sin señal): ${sinDuracion.length}`);
  sinDuracion.slice(0, 25).forEach((x) => console.log(`   · ${x.contrato}  ${x.cliente}  duracion=${JSON.stringify(x.duracion)}`));
  if (sinDuracion.length > 25) console.log(`   … y ${sinDuracion.length - 25} más`);

  console.log(`\nMuestras a estampar (10):`);
  aEstampar.slice(0, 10).forEach((x) =>
    console.log(`   · ${x.contrato}  ${x.cliente}  inicio=${fmt(x.inicio)} (${x.fuente}) +${x.meses}m → vence=${fmt(x.fv)} [${x.estado}]`));

  if (dryRun) {
    console.log(`\nDry-run: no se escribió nada. Ejecuta con --write para aplicar.`);
    process.exit(0);
  }

  let escritos = 0;
  for (let i = 0; i < aEstampar.length; i += 400) {
    const batch = db.batch();
    for (const x of aEstampar.slice(i, i + 400)) {
      batch.update(x.ref, {
        fecha_vencimiento: admin.firestore.Timestamp.fromDate(x.fv),
        vencimiento_estado: x.estado,
        vigencia: {
          fecha_inicio: admin.firestore.Timestamp.fromDate(x.inicio),
          duracion_meses: x.meses,
          fecha_vencimiento: admin.firestore.Timestamp.fromDate(x.fv),
          fuente_inicio: x.fuente,
          estampado_por: AUTOR,
        },
      });
      escritos++;
    }
    await batch.commit();
    console.log(`   lote ${Math.floor(i / 400) + 1}: ${Math.min(i + 400, aEstampar.length)}/${aEstampar.length}`);
  }
  console.log(`\nListo: ${escritos} contratos estampados.`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
