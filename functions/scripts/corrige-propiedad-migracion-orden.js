/**
 * corrige-propiedad-migracion-orden.js — deshace, solo donde está CLARO, la
 * clasificación en masa de `backfill-propiedad.js` (2026-09-09, Alberto).
 *
 * El error de origen: aquel backfill marcó "del cliente" TODA ficha con
 * `origen: migracion_orden` que no estuviera en POC — "solo pasó por el
 * taller, será suya". Para los contratos LEGACY (los que no tienen filas de
 * seriales) eso barrió radios de la flota: sus equipos nunca se amarraron a
 * un contrato, así que cayeron en la regla. Censo al 2026-09-09: 819 fichas,
 * 735 sin verificar, 478 todavía en cliente, 82 cuentas.
 * La cuenta que lo destapó: FORTUNATO MANGRAVITA (ALQ20251006-02, legacy).
 *
 * QUÉ CORRIGE (y solo eso — "las claras"):
 *   · propiedad 'cliente' + origen 'migracion_orden' + sin poc_device_id;
 *   · el cliente de la ficha tiene contrato VIGENTE (activo/aprobado);
 *   · NINGUNO de sus contratos vigentes es Propio/PROP ni trae una línea con
 *     modalidad 'propio' — si el cliente sí compra equipos, la cuenta es
 *     ambigua y se deja para revisión humana;
 *   · la ficha no tiene venta (estado 'vendido' ni factura_venta);
 *   · y —modo ESTRICTO, el de por defecto— el MODELO de la ficha aparece en
 *     alguna línea de alquiler de esos contratos. Sin eso, cuentas como COLON
 *     CONTAINER TERMINAL (183 fichas y un solo contrato vigente de 3 radios)
 *     se corregirían enteras apoyadas en muy poco. Con `--amplio` se corrige
 *     toda la cuenta, que es la lectura de "si no compran, es flota".
 * Todo lo demás queda como está y sale listado aparte con el motivo.
 *
 * La corrección estampa `propiedad: 'cecomunica'`, deja `propiedad_fuente` y
 * un movimiento en el kardex de cada unidad — nunca es silenciosa.
 *
 * USAGE (desde functions/):
 *   node scripts/corrige-propiedad-migracion-orden.js            # DRY-RUN estricto
 *   node scripts/corrige-propiedad-migracion-orden.js --amplio   # DRY-RUN amplio
 *   node scripts/corrige-propiedad-migracion-orden.js --write    # escribe
 * Salida: Escritorio (propiedad-migracion-orden-YYYY-MM-DD.xlsx) + resumen.
 */
const path = require("path");
const os = require("os");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const ExcelJS = require("exceljs");

const WRITE = process.argv.includes("--write");
const AMPLIO = process.argv.includes("--amplio");
const VIGENTE = ["activo", "aprobado"];
// Clave de modelo tolerante al sufijo -R y a la marca por delante (mismo
// criterio de familia que usa el resto del sistema, sin cargar el catálogo).
const claveModelo = (s) => String(s || "").toUpperCase().normalize("NFD")
  .replace(/[^A-Z0-9]/g, "").replace(/R$/, "");
// La ficha trae la marca por delante ("HYTERA PD606-R") y la línea casi nunca
// ("PD606-R"): se comparan por contención, igual que TransicionPlan._mismaLinea.
const mismoModelo = (a, b) => !!a && !!b
  && (a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b)));
const esPropio = (c) => c.tipo_contrato === "Propio" || c.codigo_tipo === "PROP";
const tieneLineaPropio = (c) => (c.equipos || []).some((l) => l && l.modalidad === "propio");

(async () => {
  const [poolSnap, conSnap, cliSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
    db.collection("clientes").get(),
  ]);
  const nombre = new Map();
  cliSnap.forEach((d) => nombre.set(d.id, d.data().nombre || ""));

  // Cuentas: qué dicen sus contratos vigentes.
  const cuenta = new Map();   // cliente_id → { vigentes, propio, lineaPropio, refs }
  conSnap.forEach((d) => {
    const c = d.data();
    if (c.deleted === true || !VIGENTE.includes(c.estado)) return;
    const cid = c.cliente_id;
    if (!cid) return;
    const g = cuenta.get(cid) || { vigentes: 0, propio: false, lineaPropio: false, refs: [], modelos: new Set() };
    g.vigentes++;
    if (esPropio(c)) g.propio = true;
    if (tieneLineaPropio(c)) g.lineaPropio = true;
    for (const l of (c.equipos || [])) {
      if (!l || l.modalidad === "propio") continue;
      const k = claveModelo(l.modelo);
      if (k) g.modelos.add(k);
    }
    g.refs.push(c.contrato_id || d.id);
    cuenta.set(cid, g);
  });

  const corregir = [];
  const dejar = [];
  poolSnap.forEach((d) => {
    const v = d.data();
    if (v.propiedad !== "cliente") return;
    if (v.origen !== "migracion_orden") return;
    if (v.poc_device_id) return;
    const cid = v.asignacion?.cliente_id || "";
    const g = cid ? cuenta.get(cid) : null;
    const fila = {
      id: d.id, serial: v.serial || d.id, modelo: v.modelo_label || "", estado: v.estado || "",
      cliente: nombre.get(cid) || cid || "(sin cliente)", cliente_id: cid,
      contratos: g ? g.refs.join(" ") : "", verificado: v.verificado === false ? "no" : "sí",
    };
    let motivo = "";
    if (!cid) motivo = "la ficha no dice de qué cliente es";
    else if (!g) motivo = "el cliente no tiene contrato vigente";
    else if (g.propio) motivo = "el cliente tiene contrato Propio — puede tener equipos suyos";
    else if (g.lineaPropio) motivo = "algún contrato vigente trae línea 'del cliente'";
    else if (v.estado === "vendido" || v.factura_venta) motivo = "la ficha tiene venta registrada";
    else if (!AMPLIO && ![...g.modelos].some((k) => mismoModelo(k, claveModelo(v.modelo_label)))) {
      motivo = "el modelo no aparece en ninguna línea de alquiler vigente de la cuenta";
    }
    if (motivo) dejar.push({ ...fila, motivo });
    else corregir.push({ ...fila, ref: d.ref });
  });

  const porCuenta = new Map();
  for (const f of corregir) porCuenta.set(f.cliente, (porCuenta.get(f.cliente) || 0) + 1);

  console.log(`\n${WRITE ? "ESCRITURA REAL" : "DRY-RUN"} — corrección de propiedad (migración de órdenes)`);
  console.log(`  a corregir → 'cecomunica': ${corregir.length} ficha(s) en ${porCuenta.size} cuenta(s)`);
  console.log(`  se dejan como están:       ${dejar.length} ficha(s)`);
  console.log("\n  Cuentas que se corrigen:");
  [...porCuenta.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([c, n]) => console.log(`    ${String(n).padStart(4)}  ${c}`));
  const motivos = new Map();
  for (const f of dejar) motivos.set(f.motivo, (motivos.get(f.motivo) || 0) + 1);
  console.log("\n  Por qué se dejan las otras:");
  [...motivos.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([m, n]) => console.log(`    ${String(n).padStart(4)}  ${m}`));

  // Excel para revisar antes de escribir.
  const wb = new ExcelJS.Workbook();
  const cols = [
    { header: "Serial", key: "serial", width: 16 },
    { header: "Modelo", key: "modelo", width: 22 },
    { header: "Estado", key: "estado", width: 18 },
    { header: "Cliente", key: "cliente", width: 38 },
    { header: "Contratos vigentes", key: "contratos", width: 30 },
    { header: "Verificado", key: "verificado", width: 11 },
    { header: "Motivo", key: "motivo", width: 46 },
  ];
  const h1 = wb.addWorksheet("A corregir");
  h1.columns = cols;
  corregir.forEach((f) => h1.addRow({ ...f, motivo: "cliente → cecomunica (cuenta solo de alquiler)" }));
  const h2 = wb.addWorksheet("Se dejan");
  h2.columns = cols;
  dejar.forEach((f) => h2.addRow(f));
  for (const h of [h1, h2]) h.getRow(1).font = { bold: true };
  const salida = path.join(os.homedir(), "Desktop",
    `propiedad-migracion-orden-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.writeFile(salida);
  console.log(`\n  Excel: ${salida}`);

  if (!WRITE) {
    console.log("\n  DRY-RUN — no se escribió nada. Repite con --write para aplicar.");
    process.exit(0);
  }

  let hechas = 0;
  for (const f of corregir) {
    await f.ref.update({
      propiedad: "cecomunica",
      propiedad_fuente: "correccion_migracion_orden_2026-09-09",
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    await f.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "script", por_email: null,
      tipo: "correccion", de_estado: null, a_estado: null,
      ref: { tipo: "script", id: "corrige-propiedad-migracion-orden", label: "corrección 2026-09-09" },
      notas: "Propiedad corregida: cliente → cecomunica. La marca 'del cliente' la puso backfill-propiedad "
        + "por haber pasado solo por una orden; la cuenta no tiene contratos Propio ni líneas del cliente.",
    });
    hechas++;
    if (hechas % 100 === 0) console.log(`    ${hechas}/${corregir.length}…`);
  }
  console.log(`\n  Listo: ${hechas} ficha(s) corregidas, cada una con su movimiento en el kardex.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
