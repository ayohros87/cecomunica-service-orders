/**
 * backfill-enlace-poc.js — Estampa `poc_device_id` en las fichas del pool cuyo
 * serial tiene un device POC ACTIVO pero que nunca quedaron enlazadas (chequeo
 * C2 de la conciliación: 299 casos el 2026-07-28).
 *
 * Por qué existe el hueco: onPocDeviceWritePool solo actúa cuando el serial
 * APARECE o CAMBIA en el device. Si la ficha nació después (por contrato u
 * orden), nadie volvió a tocar el device y el enlace nunca se escribió. Sin él,
 * la ficha no muestra "Plataforma POC: Registrado" y el desenlace automático al
 * borrar el device no encuentra a quién soltar.
 *
 * Reglas (conservadoras):
 *   · solo devices vivos y ACTIVOS, con serial de verdad (con dígitos);
 *   · se SALTAN los seriales con dos clientes activos (chequeo F): ahí el
 *     enlace no es el problema, la propiedad sí;
 *   · se escribe solo si la ficha no tiene enlace o si el que tiene apunta a un
 *     device inexistente, borrado o apagado — nunca pisa un enlace vivo;
 *   · con varias fichas del mismo serial gana la que no tiene enlace, y entre
 *     ésas la de modelo más parecido al del device.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/backfill-enlace-poc.js            # dry-run
 *   node scripts/backfill-enlace-poc.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const [pocSnap, poolSnap] = await Promise.all([
    db.collection("poc_devices").get(),
    db.collection("equipos_pool").get(),
  ]);

  const devices = new Map(pocSnap.docs.map((d) => [d.id, d.data()]));
  const vivoYActivo = (id) => {
    const p = devices.get(id);
    return !!p && p.deleted !== true && p.activo !== false;
  };

  const porNorm = new Map();
  for (const d of poolSnap.docs) {
    const u = { id: d.id, ref: d.ref, ...d.data() };
    const k = u.serial_norm || d.id.split("__")[0];
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k).push(u);
  }

  // Devices activos por serial + detección de doble dueño (chequeo F).
  const activosPorSerial = new Map();
  for (const [id, p] of devices) {
    if (p.deleted === true || p.activo === false) continue;
    const n = pool.normSerial(p.serial || "");
    if (!pool.esSerialValido(n)) continue;
    if (!activosPorSerial.has(n)) activosPorSerial.set(n, []);
    activosPorSerial.get(n).push({ id, p });
  }

  const plan = [];
  const saltados = { sinFicha: 0, dosDuenos: 0, yaEnlazado: 0, enlaceVivoDistinto: 0 };
  for (const [n, devs] of activosPorSerial) {
    const clientes = new Set(devs.map((d) => d.p.cliente_id || "").filter(Boolean));
    if (clientes.size > 1) { saltados.dosDuenos++; continue; }
    const fichas = porNorm.get(n) || [];
    if (!fichas.length) { saltados.sinFicha++; continue; }
    if (fichas.some((f) => devs.some((d) => f.poc_device_id === d.id))) { saltados.yaEnlazado++; continue; }

    // Candidatas: enlace vacío o apuntando a un device muerto/apagado.
    const candidatas = fichas.filter((f) => !f.poc_device_id || !vivoYActivo(f.poc_device_id));
    if (!candidatas.length) { saltados.enlaceVivoDistinto++; continue; }

    const dev = devs[0];
    const modeloDev = dev.p.modelo_label || dev.p.modelo || "";
    const elegida = candidatas.find((f) => pool.mismoModelo(f, dev.p.modelo_id || null, modeloDev))
      || candidatas.find((f) => !f.poc_device_id) || candidatas[0];
    plan.push({ n, ficha: elegida, device: dev, previo: elegida.poc_device_id || null });
  }

  console.log(`Seriales con device POC activo: ${activosPorSerial.size} · a enlazar: ${plan.length} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  console.log(`Saltados → ya enlazados: ${saltados.yaEnlazado} · sin ficha: ${saltados.sinFicha}`
    + ` · dos dueños activos: ${saltados.dosDuenos} · con enlace vivo a otro device: ${saltados.enlaceVivoDistinto}\n`);
  plan.slice(0, 15).forEach((p) => console.log(
    `  ${p.ficha.serial} [${p.ficha.estado}] "${p.ficha.modelo_label}" → device ${p.device.id}`
    + ` (${p.device.p.cliente || p.device.p.cliente_nombre || "—"})${p.previo ? `  [reemplaza enlace muerto ${p.previo}]` : ""}`));
  if (plan.length > 15) console.log(`  … +${plan.length - 15}`);
  if (!EXECUTE) { console.log("\nDRY-RUN — nada escrito."); return; }

  let n = 0;
  for (const p of plan) {
    await p.ficha.ref.set({
      poc_device_id: p.device.id,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await p.ficha.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null, tipo: "registro_poc",
      de_estado: null, a_estado: null,
      ref: { tipo: "poc", id: p.device.id, label: p.device.p.radio_name || p.device.p.unit_id || "" },
      notas: p.previo
        ? "Enlace POC restaurado (el anterior apuntaba a un device borrado o apagado)."
        : "Enlace POC restaurado: la ficha nació después del device y nunca se enlazó.",
    });
    n++;
  }
  console.log(`\nESCRITURA — fichas enlazadas: ${n}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
