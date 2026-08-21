/**
 * precio-nx420r-y-cobro-til.js — Le pone precio de venta al NX-420-R y
 * reprecia el renglón de cobro de TIL PANAMA, que había nacido sin monto.
 *
 * Contexto (docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md):
 *   El renglón de los 4 equipos que TIL no devolvió se abrió el 2026-08-20 con
 *   monto 0 y marcado `sin_referencia`, porque el modelo NX-420-R no tenía
 *   `precio_venta` en el catálogo. Un renglón sin monto no se puede facturar:
 *   la bandeja lo señala y el correo diario lo cuenta aparte.
 *   El usuario fijó el precio en $375 (2026-08-21).
 *
 * Hace dos cosas, y la segunda depende de la primera:
 *   1. estampa `precio_venta` en el modelo — así TODO renglón futuro de este
 *      modelo nace con el monto puesto, no solo el de TIL;
 *   2. reprecia el renglón abierto de TIL contra ese precio de catálogo.
 *
 * El descuento queda en 0: se cobra el precio de lista. Si mañana se decide
 * cobrar menos, se ajusta desde la bandeja y ahí sí aplica la regla del 15%.
 *
 * USAGE (desde functions/):
 *   node scripts/precio-nx420r-y-cobro-til.js [--write] [--email=quien@corre.esto]
 * Idempotente: si el precio ya está y el renglón ya cuadra, no escribe.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const cobros = require("../src/lib/cobrosEquipos");

const MODELO_ID = "68N7zR5APzO3xIaJCZCU";   // NX-420-R
const PRECIO = 375;

const dryRun = !process.argv.includes("--write");
const EMAIL = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:precio-nx420r";

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  // ── 1. Precio en el catálogo ─────────────────────────────────────────
  const mRef = db.collection("modelos").doc(MODELO_ID);
  const m = await mRef.get();
  if (!m.exists) throw new Error(`El modelo ${MODELO_ID} no existe`);
  const actual = Number(m.data().precio_venta);
  const label = m.data().modelo || m.data().nombre || MODELO_ID;
  console.log(`catálogo · ${label}: precio_venta ${Number.isFinite(actual) && actual > 0 ? `$${actual}` : "(sin precio)"} → $${PRECIO}`);
  if (!dryRun && actual !== PRECIO) {
    await mRef.set({ precio_venta: PRECIO }, { merge: true });
  }

  // ── 2. Renglones abiertos de ese modelo sin monto ────────────────────
  const snap = await db.collection(cobros.COL)
    .where("modelo_id", "==", MODELO_ID)
    .get();
  const abiertos = snap.docs.filter((d) => cobros.ABIERTAS.includes(d.data().etapa));
  console.log(`\ncobros abiertos de ${label}: ${abiertos.length}`);

  for (const d of abiertos) {
    const c = d.data();
    const qty = Number(c.cantidad) || 1;
    const total = Math.round(PRECIO * qty * 100) / 100;
    // Solo reprecia lo que nunca tuvo monto. Un renglón donde alguien ya puso
    // una cifra a mano (o negoció un descuento) NO se pisa desde un script.
    if (Number(c.monto_unit) > 0) {
      console.log(`  ${d.id}: ya tiene $${c.monto_unit} c/u puesto a mano — no se toca`);
      continue;
    }
    console.log(`  ${d.id}: ${c.cliente_nombre} · ${qty} × ${label} → $${PRECIO} c/u = $${total}`);
    if (dryRun) continue;
    await d.ref.update({
      monto_catalogo_unit: PRECIO,
      monto_unit: PRECIO,
      descuento_pct: 0,
      monto_total: total,
      sin_referencia: false,
      requiere_aprobacion: false,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      historial: admin.firestore.FieldValue.arrayUnion({
        accion: "monto",
        detalle: `$${PRECIO.toFixed(2)} c/u — precio de venta de ${label} fijado en el catálogo`,
        fecha_iso: new Date().toISOString(),
        por_uid: "system", por_email: EMAIL,
      }),
    });
  }

  console.log(dryRun ? "\n*** DRY-RUN — volver a correr con --write para aplicar ***" : "\n=== listo ===");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
