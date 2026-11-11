/**
 * preview-escalacion-retiro.js — SOLO LECTURA. Arma el correo semanal "Sin
 * retirar" con los datos de producción y lo guarda como HTML, sin encolarlo.
 * Sirve para ver qué saldría antes de que le llegue a alguien.
 *
 * USAGE (desde functions/, con NODE_PATH=node_modules):
 *   node scripts/preview-escalacion-retiro.js --out C:/ruta/preview.html
 *   node scripts/preview-escalacion-retiro.js --desde 2026-10-01 --dias 15 --out ...
 * Sin --desde usa empresa/config.retiro_escalacion_desde (como el cron).
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const RET = require("../src/lib/escalacionRetiro");
const { APP_BASE_URL } = require("../src/lib/inventario");

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

async function main() {
  const now = new Date();
  const cfg = (await db.collection("empresa").doc("config").get()).data() || {};
  const retiro = RET.leerConfig(cfg);
  if (flag("--desde")) retiro.desde = new Date(flag("--desde"));
  if (flag("--dias")) retiro.dias = Number(flag("--dias"));

  const snap = await db.collection("ordenes_de_servicio")
    .where("estado_reparacion", "==", "COMPLETADO (EN OFICINA)").limit(1000).get();
  const filas = [];
  const vendedores = new Map();
  snap.forEach(d => {
    const o = d.data() || {};
    if (!RET.esEscalable(o, now, retiro)) return;
    filas.push(RET.fila(d.id, o, now));
    if (o.vendedor_asignado) vendedores.set(String(o.vendedor_asignado), null);
  });
  for (const uid of vendedores.keys()) {
    const u = await db.collection("usuarios").doc(uid).get();
    const v = u.exists ? (u.data() || {}) : {};
    vendedores.set(uid, { email: String(v.email || "").toLowerCase(), nombre: v.nombre || v.email || "" });
  }
  filas.forEach(f => { f.vendedor = vendedores.get(f.vendedor_uid)?.nombre || "—"; });
  const cc = [...new Set([...vendedores.values()].map(v => v?.email).filter(Boolean))];

  console.log(`config: dias=${retiro.dias} desde=${retiro.desde ? retiro.desde.toISOString().slice(0, 10) : "(sin fecha)"} extra=${retiro.extra || "(nadie)"}`);
  console.log(`órdenes que entrarían: ${filas.length} · vendedores en copia: ${cc.join(", ") || "(ninguno)"}`);
  console.log(`¿hoy se mandaría? ${RET.esDiaDeEnvio(now) ? "sí (lunes)" : "no (solo lunes)"}`);
  if (!filas.length) return;
  const m = RET.armarCorreo(filas, retiro.dias, APP_BASE_URL);
  console.log(`asunto: ${m.subject}`);
  const out = flag("--out");
  if (out) {
    require("fs").writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${m.subject}</title>` +
      `<p style="font:13px Arial;color:#6b7280;">Para: taller${retiro.extra ? " + " + retiro.extra : ""} · CC: ${cc.join(", ") || "—"}</p>` +
      m.bodyContent + `<p><a href="${m.ctaUrl}">${m.ctaLabel}</a></p>`, "utf8");
    console.log(`HTML: ${out}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
