// Reglas de Firestore para la ORDEN DE COMPRA (2026-11-18).
//
// Corre con:
//   firebase emulators:exec --only firestore --project demo-oc-rules \
//     "node functions/test-emulator/orden-compra-rules.js"
//
// Congela:
//   1) contrato: registrar la OC activa el contrato por la MISMA vía que el
//      firmado (rules::esActivacionPorFirmado) — vendedor sí, recepción no;
//   2) contrato: el refrendo y la OC siguiente se escriben sobre el activo
//      (no tocan estado) y el historial del firmado solo crece;
//   3) cliente: el vendedor puede marcar `formalizacion_contrato` (no es campo
//      de identidad), pero sigue sin poder cambiar el nombre/RUC;
//   4) anexo: la OC del aumento hace el paso pendiente_firma → pendiente_bodega;
//   5) anexo: el refrendo llega una sola vez y no cambia número ni monto.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, updateDoc, arrayUnion } = require("firebase/firestore");

const CONTRATO = {
  contrato_id: "ALQ20261118-01", codigo_tipo: "ALQ", tipo_contrato: "Alquiler", cliente_id: "cli-1",
  estado: "aprobado", seriales_estado: "asignados", firmado: false, deleted: false,
  formalizacion: { tipo: "orden_compra", sector: "gobierno", origen: "cliente" },
  total_mensual: 214, primer_pago: 214, duracion_meses: 12,
};
const OC = (extra = {}) => ({ numero: "OC-2026-1", fecha: "2026-11-18", monto: 2568, sector: "gobierno",
  url: "https://x/oc.pdf", storage_path: "contratos_firmados/x.pdf", refrendo: null, ...extra });
const ANEXO = {
  tipo: "aumento", cliente_id: "cli-1", estado: "pendiente_firma", deleted: false, cierre: { aprobacion: true },
  formalizacion: { tipo: "orden_compra", sector: "gobierno", origen: "cliente" },
  aumento: { contrato_id: "ALQ20261118-01", duracion_meses: 12, totales: { total_mensual: 107, primer_pago: 107 } },
};

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-oc-rules",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ["administrador", "vendedor", "recepcion", "tecnico"]) {
      await setDoc(doc(db, `usuarios/${r}`), { rol: r, email: `${r}@test` });
    }
    await setDoc(doc(db, "contratos/c1"), CONTRATO);
    await setDoc(doc(db, "contratos/c2"), CONTRATO);
    await setDoc(doc(db, "clientes/cli-1"), { nombre: "MINISTERIO X", ruc: "1", deleted: false, activo: true });
    await setDoc(doc(db, "gestiones/ga1"), ANEXO);
    await setDoc(doc(db, "gestiones/ga2"), { ...ANEXO, estado: "pendiente_bodega", cierre: { aprobacion: true, firma: true },
      anexo_firmado_tipo: "orden_compra", orden_compra: OC({ monto: 1284 }) });
  });
  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
  const ahora = new Date();
  const registroOC = {
    firmado: true, firmado_tipo: "orden_compra", firmado_url: "https://x/oc.pdf",
    firmado_nombre: "oc.pdf", firmado_storage_path: "contratos_firmados/x.pdf", firmado_fecha: ahora,
    firmado_por_uid: "vendedor", orden_compra: OC(), oc_meses_cubiertos: 12,
    estado_previo: "aprobado", estado: "activo", fecha_activacion: ahora,
  };

  // ── 1) Registrar la OC del contrato ────────────────────────────────────
  await assertFails(updateDoc(doc(as("recepcion"), "contratos/c2"), registroOC));
  ok("recepción NO activa un contrato subiendo la OC");
  await assertSucceeds(updateDoc(doc(as("vendedor"), "contratos/c1"), registroOC));
  ok("el vendedor registra la OC y el contrato queda activo (vía del firmado)");
  await assertFails(updateDoc(doc(as("vendedor"), "contratos/c2"), { estado: "activo", orden_compra: OC() }));
  ok("sin firmado + firmado_url, la OC sola no activa nada");

  // ── 2) Refrendo y OC siguiente sobre el activo ────────────────────────
  await assertSucceeds(updateDoc(doc(as("vendedor"), "contratos/c1"), {
    "orden_compra.refrendo": { numero: "R-1", fecha: "2026-12-01" },
    firmado_url: "https://x/oc_ref.pdf",
    firmado_historial: arrayUnion({ firmado_url: "https://x/oc.pdf", motivo: "refrendo de la orden de compra" }),
  }));
  ok("el refrendo repunta el documento y archiva la OC sin refrendo");
  await assertSucceeds(updateDoc(doc(as("vendedor"), "contratos/c1"), {
    orden_compra: OC({ numero: "OC-2027-1" }), oc_meses_cubiertos: 24,
    ordenes_compra_anteriores: arrayUnion(OC()),
  }));
  ok("la OC siguiente se registra sobre el contrato activo");

  // ── 3) El perfil del cliente ──────────────────────────────────────────
  await assertSucceeds(updateDoc(doc(as("vendedor"), "clientes/cli-1"), { formalizacion_contrato: "oc_gobierno", updated_at: ahora }));
  ok("el vendedor marca cómo formaliza el cliente");
  await assertFails(updateDoc(doc(as("vendedor"), "clientes/cli-1"), { nombre: "OTRO", formalizacion_contrato: "firma" }));
  ok("…pero no aprovecha para cambiar la identidad del cliente");

  // ── 4) OC del anexo ───────────────────────────────────────────────────
  await assertSucceeds(updateDoc(doc(as("vendedor"), "gestiones/ga1"), {
    estado: "pendiente_bodega", "cierre.firma": true,
    anexo_firmado_path: "gestiones_anexos/ga1/anexo_OC.pdf", anexo_firmado_at: ahora, anexo_firmado_por: "vendedor@test",
    anexo_firmado_tipo: "orden_compra", orden_compra: OC({ monto: 1284 }),
  }));
  ok("la OC del anexo hace el paso de la firma (pendiente_firma → pendiente_bodega)");

  // ── 5) Refrendo del anexo ─────────────────────────────────────────────
  await assertFails(updateDoc(doc(as("tecnico"), "gestiones/ga2"), { "orden_compra.refrendo": { numero: "R" } }));
  ok("un técnico no registra refrendos");
  await assertFails(updateDoc(doc(as("vendedor"), "gestiones/ga2"), { orden_compra: OC({ monto: 1, refrendo: { numero: "R" } }) }));
  ok("el refrendo no cambia el monto de la OC");
  await assertFails(updateDoc(doc(as("vendedor"), "gestiones/ga2"), { "orden_compra.refrendo": { numero: "R" }, estado: "cerrada" }));
  ok("el refrendo no mueve el estado");
  await assertSucceeds(updateDoc(doc(as("vendedor"), "gestiones/ga2"), { "orden_compra.refrendo": { numero: "R-7", fecha: "2026-12-01" } }));
  ok("el vendedor registra el refrendo del anexo");
  await assertFails(updateDoc(doc(as("vendedor"), "gestiones/ga2"), { "orden_compra.refrendo": { numero: "R-8" } }));
  ok("…y una vez registrado no se pisa");

  await testEnv.cleanup();
  console.log(`\n${n} pruebas OK`);
}

main().catch((e) => { console.error(e); process.exit(1); });
