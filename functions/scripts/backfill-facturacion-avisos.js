// backfill-facturacion-avisos.js — siembra la bandeja "Facturación pendiente"
// con los avisos que YA salieron por correo antes de que existiera la
// colección (los 6 de Riba Smith del 2026-09-03 y cualquier otro desde el
// despliegue del aviso, 2026-09-02).
//
// Lee mail_queue (meta.source == onContratoActivado_facturacion o meta.paso
// facturacion_*), reconstruye el aviso desde el doc de origen con la MISMA
// librería que usa el trigger y lo enlaza al correo (status real: sent/error).
// Idempotente: el id es determinista y un aviso existente no se pisa.
//
// Uso (desde functions/, PowerShell con NODE_PATH):
//   node scripts/backfill-facturacion-avisos.js            # dry-run
//   node scripts/backfill-facturacion-avisos.js --apply    # escribe
//   --desde=2026-09-02  (fecha mínima del correo; default 2026-09-02)

const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FA = require("../src/lib/facturacionAvisos");

const APPLY = process.argv.includes("--apply");
const desdeArg = (process.argv.find(a => a.startsWith("--desde=")) || "").split("=")[1] || "2026-09-02";
const DESDE = new Date(`${desdeArg}T00:00:00-05:00`);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function nombreUsuario(uid) {
  if (!uid) return null;
  const u = await db.collection("usuarios").doc(uid).get().catch(() => null);
  return u?.exists ? (u.data().nombre || u.data().email || null) : null;
}

async function avisoDesdeContratoActivo(mail) {
  const contratoId = mail.meta?.contrato_id;
  // El meta guarda contrato_id (el número); el doc se busca por ese campo.
  const cs = await db.collection("contratos").where("contrato_id", "==", contratoId).limit(1).get();
  if (cs.empty) return { skip: `contrato ${contratoId} no encontrado` };
  const d = cs.docs[0]; const c = d.data();
  const esRenov = c.accion === "Renovación";
  const conEquipo = (c.equipos || []).some(e => num(e.cantidad) > 0) && !c.renovacion_sin_equipo;
  const esperando = conEquipo && c.entrega_confirmada !== true;
  const m = FA.mensualDeContrato(c);
  const activadoPor = c.firmado_tipo === "digital" ? "firma digital del cliente" : await nombreUsuario(c.firmado_por_uid);
  const fechaAct = c.fecha_activacion?.toDate ? c.fecha_activacion.toDate() : (mail.meta?.created_at?.toDate?.() || new Date());
  return {
    aviso: {
      tipo: esRenov ? "renovacion_activa" : "contrato_activo",
      origen_col: "contratos", origen_id: d.id,
      cliente_id: c.cliente_id || null, cliente_nombre: c.cliente_nombre || "",
      vendedor_email: mail.cc || null,
      contrato_id: c.contrato_id || d.id, contrato_doc_id: d.id,
      fecha_efectiva: esperando ? null : fechaAct,
      esperando,
      source: "backfill:" + (mail.meta?.source || ""),
      contexto: {
        activado_por: activadoPor,
        contrato_fecha: c.creado_en?.toDate ? c.creado_en.toDate().toISOString().slice(0, 10) : null,
        duracion: c.duracion || null, tipo_contrato: c.tipo_contrato || null,
        firmado_tipo: c.firmado_tipo || null, entrega_pendiente: esperando,
        origen_texto: `${esRenov ? "Renovación" : "Contrato"} activo${activadoPor ? ` (${activadoPor})` : ""} — respaldo`,
      },
      resumen: {
        equipos: FA.equiposTexto(c.equipos), equipos_n: m.equipos_n,
        mensual: m.mensual, con_itbms: m.con_itbms, exento: m.exento, unico: m.unico, delta_mensual: m.mensual,
        seriales_count: num(c.seriales_count) + num(c.seriales_omitidos_count), seriales_total: m.equipos_n,
      },
      detalle: { lineas: c.equipos || [], cargos: c.cargos || [] },
    },
  };
}

async function main() {
  const mq = await db.collection("mail_queue").where("meta.created_at", ">=", DESDE).get();
  const candidatos = mq.docs.filter(d => {
    const x = d.data();
    return x.meta?.source === "onContratoActivado_facturacion"
      || String(x.meta?.paso || "").startsWith("facturacion_");
  });
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} · correos de facturación desde ${desdeArg}: ${candidatos.length}`);

  let creados = 0, existentes = 0, saltados = 0;
  for (const d of candidatos) {
    const mail = d.data();
    let r;
    if (mail.meta?.source === "onContratoActivado_facturacion") r = await avisoDesdeContratoActivo(mail);
    else r = { skip: `paso ${mail.meta?.paso} no respaldado por este script (gestiones)` };
    if (r.skip) { saltados++; console.log("  SKIP", d.id, mail.subject, "→", r.skip); continue; }

    const id = FA.avisoId(r.aviso.tipo, r.aviso.origen_id);
    const ya = await db.collection(FA.COL).doc(id).get();
    if (ya.exists) { existentes++; console.log("  YA  ", id, "(no se toca)"); continue; }

    const correo = { mail_queue_id: d.id, status: mail.status || null, error: mail.error || null,
      ...(mail.sent_at ? { sent_at: mail.sent_at } : {}) };
    console.log(`  ${APPLY ? "CREAR" : "crearía"} ${id} · ${r.aviso.cliente_nombre} · $${r.aviso.resumen.mensual}/mes · correo ${correo.status}${correo.error ? " (" + correo.error + ")" : ""}`);
    if (!APPLY) continue;
    const res = await FA.crearAviso(r.aviso);
    await db.collection(FA.COL).doc(res.id).set({ correo, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    creados++;
  }
  console.log(`\ncreados=${creados} existentes=${existentes} saltados=${saltados}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
