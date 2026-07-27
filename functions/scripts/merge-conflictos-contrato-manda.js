/**
 * merge-conflictos-contrato-manda.js — Resuelve los conflictos del pool donde
 * las fuentes solo discrepan en el MODELO, aplicando la regla de negocio
 * "EL CONTRATO MANDA SOBRE POC" (decisión del usuario, 2026-07-27).
 *
 * Un conflicto = el mismo serial con 2+ fichas en equipos_pool. El failsafe las
 * parte cuando las fuentes traen modelos distintos. La auditoría de 2026-07-27
 * mostró que 35 de 64 grupos son el MISMO radio del MISMO cliente con el modelo
 * escrito distinto en POC ("PNC360S-R" vs "PNC460-R" vs "HYT-P50").
 *
 * Regla: sobrevive la ficha cuyo modelo coincide con el que dice el CONTRATO
 * (subcolección contratos/{id}/seriales); las demás se absorben conservando su
 * kardex. Se exige que la decisión sea inequívoca — si el contrato no lista el
 * serial, si ninguna ficha coincide, o si coinciden dos, el grupo se salta y
 * queda para revisión humana en la cola de Conflictos.
 *
 * NO toca (por diseño):
 *   · grupos donde el serial está vivo en POC con DOS clientes distintos — ese
 *     es un problema de propiedad, no de modelo.
 *   · grupos donde la ficha que sobreviviría está en bodega y otra está
 *     colocada — el estado se contradice y lo tiene que ver una persona.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/merge-conflictos-contrato-manda.js            # dry-run
 *   node scripts/merge-conflictos-contrato-manda.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const tight = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
const COLOCADA = new Set(["asignado_contrato", "en_cliente", "en_taller"]);
const SIN_CARGA = new Set(["en_bodega", "devuelto_revision", "baja"]);

// ¿El modelo de la ficha es el que dice el contrato? Tolera el prefijo de marca
// ("HYT-P50" del contrato vs "HYTERA HYT-P50" de la ficha) por contención, pero
// NO ignora el sufijo -R: refurbished y nuevo son filas distintas del catálogo.
function coincide(labelFicha, labelContrato) {
  const a = tight(labelFicha), b = tight(labelContrato);
  if (!a || !b) return false;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return corto.length >= 4 && largo.includes(corto);
}

// El keeper adopta del absorbido solo lo que le falta (== fusionarPoolFicha).
function rellenar(keeper, otro) {
  const upd = {};
  if (!keeper.modelo_id && otro.modelo_id) upd.modelo_id = otro.modelo_id;
  if (!(keeper.modelo_label || "").trim() && (otro.modelo_label || "").trim()) upd.modelo_label = otro.modelo_label;
  if ((keeper.propiedad || "desconocida") === "desconocida" && otro.propiedad && otro.propiedad !== "desconocida") upd.propiedad = otro.propiedad;
  const cargaAsignacion = !SIN_CARGA.has(keeper.estado);
  if (cargaAsignacion && !keeper.poc_device_id && otro.poc_device_id) upd.poc_device_id = otro.poc_device_id;
  if (cargaAsignacion && !keeper.asignacion && otro.asignacion) upd.asignacion = otro.asignacion;
  if (!keeper.ingreso_bodega_at && otro.ingreso_bodega_at) upd.ingreso_bodega_at = otro.ingreso_bodega_at;
  if (keeper.verificado !== true && otro.verificado === true) upd.verificado = true;
  return upd;
}

(async () => {
  const [poolSnap, pocSnap, contSnap, serSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("poc_devices").get(),
    db.collection("contratos").get(),
    db.collectionGroup("seriales").get(),
  ]);
  const contratos = new Map(contSnap.docs.map((d) => [d.id, d.data()]));

  const porNorm = new Map();
  for (const d of poolSnap.docs) {
    const u = { id: d.id, ref: d.ref, ...d.data() };
    const k = u.serial_norm || d.id.split("__")[0];
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k).push(u);
  }
  const grupos = [...porNorm.entries()]
    .filter(([, docs]) => docs.length >= 2 && !docs.every((d) => d.conflicto_revisado === true))
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Modelo según contrato: primero los vigentes, si no los hay cualquiera.
  const diceVigente = new Map(), diceCualquiera = new Map();
  for (const d of serSnap.docs) {
    const s = d.data();
    const n = String(s.serial || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!porNorm.has(n)) continue;
    const c = contratos.get(d.ref.parent.parent.id) || {};
    const m = (s.modelo || "").trim();
    if (!m) continue;
    const dest = ["aprobado", "activo"].includes(String(c.estado || "").toLowerCase()) ? diceVigente : diceCualquiera;
    if (!dest.has(n)) dest.set(n, new Set());
    dest.get(n).add(m);
  }

  // Seriales vivos en POC con más de un cliente → problema de propiedad.
  const clientesPoc = new Map();
  for (const d of pocSnap.docs) {
    const p = d.data();
    if (p.deleted === true) continue;
    const n = String(p.serial || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!porNorm.has(n) || !p.cliente_id) continue;
    if (!clientesPoc.has(n)) clientesPoc.set(n, new Set());
    clientesPoc.get(n).add(p.cliente_id);
  }

  const saltados = { dosClientes: [], sinContrato: [], contratoAmbiguo: [], sinCoincidencia: [], dosCoinciden: [], estadoContradictorio: [] };
  const plan = [];

  for (const [norm, docs] of grupos) {
    if ((clientesPoc.get(norm)?.size || 0) > 1) { saltados.dosClientes.push(norm); continue; }
    const dicen = diceVigente.get(norm) || diceCualquiera.get(norm) || null;
    if (!dicen || !dicen.size) { saltados.sinContrato.push(norm); continue; }

    // Si el contrato (o los contratos) dicen dos modelos distintos, no decide.
    const modelos = [...dicen];
    const claves = new Set(modelos.map(tight));
    if (claves.size > 1) { saltados.contratoAmbiguo.push(`${norm}: ${modelos.join(" / ")}`); continue; }

    const coinciden = docs.filter((d) => modelos.some((m) => coincide(d.modelo_label, m)));
    if (!coinciden.length) { saltados.sinCoincidencia.push(`${norm}: contrato "${modelos[0]}" vs ${docs.map((d) => `"${d.modelo_label}"`).join(" ")}`); continue; }
    if (coinciden.length > 1) { saltados.dosCoinciden.push(`${norm}: ${coinciden.map((d) => `"${d.modelo_label}"`).join(" ")}`); continue; }

    const keeper = coinciden[0];
    const absorbidos = docs.filter((d) => d.id !== keeper.id);
    if (SIN_CARGA.has(keeper.estado) && absorbidos.some((a) => COLOCADA.has(a.estado))) {
      saltados.estadoContradictorio.push(`${norm}: sobreviviría ${keeper.estado} pero hay ${absorbidos.map((a) => a.estado).join("/")}`);
      continue;
    }
    plan.push({ norm, keeper, absorbidos, modeloContrato: modelos[0] });
  }

  console.log(`Grupos en conflicto: ${grupos.length} · resolubles por contrato: ${plan.length} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);
  for (const p of plan) {
    console.log(`  ${p.norm} · contrato dice "${p.modeloContrato}"`);
    console.log(`      conserva "${p.keeper.modelo_label}" [${p.keeper.estado}] ${p.keeper.id}`);
    p.absorbidos.forEach((a) => console.log(`      absorbe  "${a.modelo_label}" [${a.estado}] ${a.id}`));
  }
  console.log("\n── Saltados (quedan en la cola para revisión humana) ──");
  for (const [k, v] of Object.entries(saltados)) {
    if (!v.length) continue;
    console.log(`  ${k}: ${v.length}`);
    v.slice(0, 10).forEach((x) => console.log(`     ${x}`));
    if (v.length > 10) console.log(`     … +${v.length - 10}`);
  }
  if (!EXECUTE) { console.log("\nDRY-RUN — nada escrito."); return; }

  let fusionadas = 0;
  for (const p of plan) {
    for (const g of p.absorbidos) {
      const movs = await g.ref.collection("movimientos").get();
      const batch = db.batch();
      movs.forEach((m) => {
        batch.set(p.keeper.ref.collection("movimientos").doc(), { ...m.data(), fusionado_de: g.id });
        batch.delete(m.ref);
      });
      batch.set(p.keeper.ref.collection("movimientos").doc(), {
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: null,
        tipo: "fusion_duplicado", de_estado: null, a_estado: null, ref: null,
        notas: `Fusión automática "el contrato manda sobre POC": absorbida la ficha ${g.id} `
          + `("${g.modelo_label || "sin modelo"}", ${g.estado}). El contrato dice "${p.modeloContrato}".`,
      });
      batch.set(p.keeper.ref, {
        ...rellenar(p.keeper, g),
        conflicto_revisado: admin.firestore.FieldValue.delete(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.delete(g.ref);
      await batch.commit();
      fusionadas++;
    }
    const restantes = await db.collection("equipos_pool").where("serial_norm", "==", p.norm).get();
    if (restantes.size === 1 && restantes.docs[0].data().serial_compartido) {
      await restantes.docs[0].ref.set({ serial_compartido: false }, { merge: true });
    }
  }
  console.log(`\nESCRITURA — grupos resueltos: ${plan.length} · fichas absorbidas: ${fusionadas}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
