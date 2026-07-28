/**
 * comite-olimpico-cierre.js — El proyecto del COMITÉ OLIMPICO DE PANAMA cerró
 * (dato del usuario, 2026-07-28): no hay radios con ellos. El pool seguía
 * diciendo lo contrario, y su registro POC viejo bloqueaba conflictos de
 * seriales que hoy están activos con OTRO cliente.
 *
 * Hace dos cosas, ambas apoyadas en evidencia del propio sistema (un device POC
 * ACTIVO de otro cliente para el mismo serial):
 *   A) Fusiona los seriales con ficha duplicada Comité + otro cliente,
 *      conservando la del cliente ACTUAL y absorbiendo la del Comité.
 *   B) Reasigna a su tenedor actual las fichas que quedaron a nombre del Comité
 *      pero cuyo serial está activo en POC con otro cliente (custodia, sin
 *      contrato: los contratos del Comité son legacy y quedaron abiertos).
 *
 * NO toca las fichas del Comité sin rastro de otro tenedor: ésas necesitan que
 * alguien diga dónde están (bodega, otro cliente, baja).
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/comite-olimpico-cierre.js            # dry-run
 *   node scripts/comite-olimpico-cierre.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const esCOP = (s) => /COMIT.{0,2}\s*OLIMPICO/i.test(String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, ""));
const SIN_CARGA = new Set(["en_bodega", "devuelto_revision", "baja"]);

function rellenar(keeper, otro) {
  const upd = {};
  if (!keeper.modelo_id && otro.modelo_id) upd.modelo_id = otro.modelo_id;
  if (!(keeper.modelo_label || "").trim() && (otro.modelo_label || "").trim()) upd.modelo_label = otro.modelo_label;
  if ((keeper.propiedad || "desconocida") === "desconocida" && otro.propiedad && otro.propiedad !== "desconocida") upd.propiedad = otro.propiedad;
  if (!keeper.ingreso_bodega_at && otro.ingreso_bodega_at) upd.ingreso_bodega_at = otro.ingreso_bodega_at;
  if (keeper.verificado !== true && otro.verificado === true) upd.verificado = true;
  return upd;
}

(async () => {
  const [poolSnap, pocSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("poc_devices").get(),
  ]);

  // Tenedor ACTUAL según POC: device vivo, activo y de otro cliente.
  const tenedor = new Map(); // serial_norm → {cliente_id, cliente_nombre, device}
  for (const d of pocSnap.docs) {
    const p = d.data();
    if (p.deleted === true || p.activo === false) continue;
    if (esCOP(p.cliente || p.cliente_nombre)) continue;
    const n = norm(p.serial);
    if (!n || tenedor.has(n)) continue;
    tenedor.set(n, { cliente_id: p.cliente_id || "", cliente_nombre: p.cliente || p.cliente_nombre || "", device: d.id });
  }

  const porNorm = new Map();
  for (const d of poolSnap.docs) {
    const u = { id: d.id, ref: d.ref, ...d.data() };
    const k = u.serial_norm || d.id.split("__")[0];
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k).push(u);
  }

  const fusiones = [], reasignaciones = [], sinRastro = [];
  for (const [n, docs] of porNorm) {
    const delComite = docs.filter((d) => esCOP(d.asignacion?.cliente_nombre));
    if (!delComite.length) continue;
    const t = tenedor.get(n);
    if (!t) { sinRastro.push(`${n} (${docs[0].estado}, "${docs[0].modelo_label}")`); continue; }

    const otros = docs.filter((d) => !esCOP(d.asignacion?.cliente_nombre));
    if (otros.length === 1 && delComite.length >= 1 && docs.length > 1) {
      fusiones.push({ n, keeper: otros[0], absorbidos: delComite, tenedor: t });
    } else if (docs.length === 1) {
      reasignaciones.push({ n, ficha: docs[0], tenedor: t });
    } else {
      sinRastro.push(`${n} (${docs.length} fichas, caso no automático)`);
    }
  }

  console.log(`Modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);
  console.log(`── A) Fusiones (sobrevive el cliente actual): ${fusiones.length}`);
  fusiones.forEach((f) => {
    console.log(`  ${f.n} → conserva "${f.keeper.modelo_label}" de ${f.keeper.asignacion?.cliente_nombre || "—"}`);
    f.absorbidos.forEach((a) => console.log(`        absorbe "${a.modelo_label}" del Comité (${a.id})`));
  });
  console.log(`\n── B) Reasignaciones al tenedor actual: ${reasignaciones.length}`);
  reasignaciones.forEach((r) => console.log(`  ${r.n} "${r.ficha.modelo_label}" [${r.ficha.estado}] → ${r.tenedor.cliente_nombre}`));
  console.log(`\n── C) Sin rastro de otro tenedor (NO se tocan, decisión humana): ${sinRastro.length}`);
  sinRastro.slice(0, 60).forEach((x) => console.log("  " + x));
  if (sinRastro.length > 60) console.log(`  … +${sinRastro.length - 60}`);
  if (!EXECUTE) { console.log("\nDRY-RUN — nada escrito."); return; }

  const mov = (extra) => ({
    at: admin.firestore.FieldValue.serverTimestamp(), por: "system", por_email: null,
    de_estado: null, a_estado: null, ref: null, ...extra,
  });

  for (const f of fusiones) {
    for (const g of f.absorbidos) {
      const movs = await g.ref.collection("movimientos").get();
      const batch = db.batch();
      movs.forEach((m) => {
        batch.set(f.keeper.ref.collection("movimientos").doc(), { ...m.data(), fusionado_de: g.id });
        batch.delete(m.ref);
      });
      batch.set(f.keeper.ref.collection("movimientos").doc(), mov({
        tipo: "fusion_duplicado",
        notas: `Proyecto del Comité Olímpico cerrado: absorbida su ficha ${g.id} ("${g.modelo_label || "sin modelo"}"). `
          + `El serial está activo en POC con ${f.tenedor.cliente_nombre}.`,
      }));
      batch.set(f.keeper.ref, {
        ...rellenar(f.keeper, g),
        conflicto_revisado: admin.firestore.FieldValue.delete(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.delete(g.ref);
      await batch.commit();
    }
    const restantes = await db.collection("equipos_pool").where("serial_norm", "==", f.n).get();
    if (restantes.size === 1 && restantes.docs[0].data().serial_compartido) {
      await restantes.docs[0].ref.set({ serial_compartido: false }, { merge: true });
    }
  }

  for (const r of reasignaciones) {
    const antes = r.ficha.asignacion?.cliente_nombre || "—";
    await r.ficha.ref.set({
      asignacion: {
        contrato_doc_id: null, contrato_id: "",
        cliente_id: r.tenedor.cliente_id, cliente_nombre: r.tenedor.cliente_nombre,
      },
      poc_device_id: SIN_CARGA.has(r.ficha.estado) ? (r.ficha.poc_device_id || null) : r.tenedor.device,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await r.ficha.ref.collection("movimientos").add(mov({
      tipo: "reasignacion",
      notas: `Proyecto del Comité Olímpico cerrado: la unidad pasa a ${r.tenedor.cliente_nombre}, `
        + `que la tiene ACTIVA en POC (antes: ${antes}).`,
    }));
  }
  console.log(`\nESCRITURA — fusiones: ${fusiones.length} · reasignaciones: ${reasignaciones.length} · intactas: ${sinRastro.length}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
