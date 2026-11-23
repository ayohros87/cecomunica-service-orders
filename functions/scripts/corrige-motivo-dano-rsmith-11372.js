/**
 * corrige-motivo-dano-rsmith-11372.js
 *
 * Correo de Brenda (2026-11-23, "Consulta Sobre Opción Venta Facturada"):
 * R. SMITH COSTA DEL ESTE pagó con la factura 11372 la reposición del
 * 25D10A3036 (PNC360S, contrato ALQ20260304-01), que se dañó al caer al agua.
 * La puerta de "Venta facturada" solo ofrecía "Robo" y "Pérdida", así que
 * marcó PÉRDIDA y dejó la verdad en las notas. Todo lo demás salió bien: el
 * 23914A0970 quedó de CECOMUNICA en el contrato, gestión GR20261123-01, orden
 * de programación 2026112302. Lo único falso es la etiqueta: el radio figura
 * de baja "por pérdida".
 *
 * Decisión de Alberto (2026-11-23): se agrega el motivo "Daño sin reparación"
 * (lib/reposicionAlquiler.js) y este caso se corrige.
 *
 * QUÉ HACE — solo cambia la etiqueta, no mueve estados ni asignaciones:
 *   · equipos_pool/25D10A3036.baja_motivo
 *   · gestiones/GR20261123-01: notas, reposicion.motivo, aprobacion.motivo y,
 *     en su único item, saliente_perdido / motivo_codigo / motivo_detalle
 *   · ordenes_de_servicio/2026112302: la observación del equipo
 *   · pedidos_venta/8JrOMasYC1G2r3HckH9d.reposicion.motivo
 * Queda escrito exactamente lo que el sistema habría puesto con el motivo
 * nuevo. El kardex y la bitácora NO se reescriben: los renglones viejos siguen
 * diciendo "pérdida" (es lo que pasó ese día) y se les agrega uno de corrección
 * al radio dañado y un evento a la gestión.
 *
 * No manda correos: la gestión está cerrada (onGestionWrite no la mira) y en
 * la orden solo cambia un texto. Idempotente: lo ya corregido se salta.
 *
 * USAGE (desde functions/):
 *   node scripts/corrige-motivo-dano-rsmith-11372.js          # dry-run
 *   node scripts/corrige-motivo-dano-rsmith-11372.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { db } = require("../src/lib/admin");
const R = require("../src/lib/reposicionAlquiler");

const WRITE = process.argv.includes("--write");
const FV = admin.firestore.FieldValue;
const POR = "alberto.yohros@cecomunica.com";

const SALIENTE = "25D10A3036";
const ENTRANTE = "23914A0970";
const GID = "GR20261123-01";
const ORDEN = "2026112302";
const PEDIDO = "8JrOMasYC1G2r3HckH9d";
const CLIENTE = "vvT0TSlBcGaDUHakIwr3";
const NOMBRE = "R. SMITH COSTA DEL ESTE";
const CONTRATO = "ALQ20260304-01";
const FACT = "11372";

// Los mismos textos de lib/reposicionAlquiler.js y onPedidoVentaWrite, por motivo.
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const textos = (motivo) => {
  const t = R.motivoTxt(motivo);
  return {
    nota: `${cap(t)} de radio alquilado: el cliente pagó la reposición con la factura ${FACT}.`,
    baja: `${cap(t)} (${NOMBRE}); repuesto por ${ENTRANTE}, gestión ${GID}, factura ${FACT}`,
    aprobacion: `Reposición por ${t} pagada por el cliente (factura ${FACT})`,
    obsOrden: `Reposición del ${SALIENTE} (${t}, contrato ${CONTRATO}) — factura ${FACT}.`,
  };
};
const VIEJO = textos("perdida");
const NUEVO = textos("dano");

(async () => {
  const exigir = (cond, msg) => { if (!cond) { console.error("ALTO: " + msg); process.exit(1); } };
  const refPool = db.doc(`equipos_pool/${SALIENTE}`);
  const refG = db.doc(`gestiones/${GID}`);
  const refO = db.doc(`ordenes_de_servicio/${ORDEN}`);
  const refP = db.doc(`pedidos_venta/${PEDIDO}`);
  const [sPool, sG, sO, sP, sEnt] = await Promise.all([refPool.get(), refG.get(), refO.get(), refP.get(), db.doc(`equipos_pool/${ENTRANTE}`).get()]);
  exigir(sPool.exists && sG.exists && sO.exists && sP.exists && sEnt.exists, "falta alguno de los documentos del caso");
  const pool = sPool.data(); const g = sG.data(); const o = sO.data(); const p = sP.data(); const ent = sEnt.data();

  // Candados: el script solo corre sobre el caso exacto que se revisó.
  exigir(p.cliente_id === CLIENTE && String(p.factura) === FACT && p.estado === "asignada", "el pedido no es el de la factura 11372 de R. SMITH");
  exigir(p.reposicion_resultado?.gestion_id === GID && p.orden_programacion_id === ORDEN, "el pedido no apunta a la gestión y la orden del caso");
  exigir((p.reposicion?.items || []).length === 1 && p.reposicion.items[0].serial_saliente === SALIENTE, "el pedido no repone exactamente el 25D10A3036");
  exigir(g.tipo === "reemplazo" && g.estado === "cerrada" && g.cliente_id === CLIENTE && g.origen?.pedido_venta_id === PEDIDO, "la gestión no es la reposición del pedido");
  exigir((g.items || []).length === 1 && g.items[0].serial_saliente === SALIENTE && g.items[0].serial_nuevo === ENTRANTE, "la gestión no es 25D10A3036 → 23914A0970");
  exigir(pool.estado === "baja" && !pool.asignacion, `el 25D10A3036 ya no está de baja (${pool.estado})`);
  exigir(ent.reemplaza_a === SALIENTE && ent.asignacion?.gestion_doc_id === GID && ent.propiedad === "cecomunica", "el 23914A0970 no está como se revisó");
  exigir(o.cliente_id === CLIENTE && o.gestion?.id === GID, "la orden no es la de la reposición");
  const eqs = (o.equipos || []).filter((e) => !e.eliminado && String(e.serial || "").toUpperCase() === ENTRANTE);
  exigir(eqs.length === 1, "la orden no tiene exactamente un renglón del 23914A0970");

  // Cada campo: se corrige si dice lo de "pérdida", se salta si ya dice lo de "daño", y si dice otra cosa se detiene.
  const plan = [];
  const campo = (donde, actual, viejo, nuevo) => {
    if (actual === nuevo) return false;
    exigir(actual === viejo, `${donde} no dice lo que se revisó: ${JSON.stringify(actual)}`);
    plan.push(`${donde}: ${JSON.stringify(viejo)} → ${JSON.stringify(nuevo)}`);
    return true;
  };
  const it = g.items[0];
  const tocaPool = campo("pool 25D10A3036 · baja_motivo", pool.baja_motivo, VIEJO.baja, NUEVO.baja);
  const tocaG = [
    campo("gestión · notas", g.notas, VIEJO.nota, NUEVO.nota),
    campo("gestión · reposicion.motivo", g.reposicion?.motivo, "perdida", "dano"),
    campo("gestión · aprobacion.motivo", g.aprobacion?.motivo, VIEJO.aprobacion, NUEVO.aprobacion),
    campo("gestión · item.saliente_perdido", it.saliente_perdido, "perdida", "dano"),
    campo("gestión · item.motivo_codigo", it.motivo_codigo, "perdida", "dano"),
    campo("gestión · item.motivo_detalle", it.motivo_detalle, VIEJO.nota, NUEVO.nota),
  ].some(Boolean);
  const tocaO = campo("orden 2026112302 · observación del equipo", eqs[0].observaciones, VIEJO.obsOrden, NUEVO.obsOrden);
  const tocaP = campo("pedido · reposicion.motivo", p.reposicion.motivo, "perdida", "dano");

  if (!plan.length) { console.log("El caso ya dice \"daño sin reparación\" en todos lados. Nada que hacer."); process.exit(0); }
  console.log(`${WRITE ? "ESCRIBIENDO" : "DRY-RUN"} — ${plan.length} campo(s):`);
  plan.forEach((l) => console.log("  · " + l));
  const explicacion = `Corrección del motivo: no fue pérdida, el radio se dañó al caer al agua (daño sin reparación). Recepción marcó "pérdida" el 2026-11-23 porque el formulario solo ofrecía robo o pérdida. No cambia nada más.`;
  console.log(`  + movimiento de corrección en el kardex del ${SALIENTE} y evento en la gestión ${GID}`);
  if (!WRITE) { console.log("\nDry-run: no se escribió nada. Corre con --write."); process.exit(0); }

  const now = FV.serverTimestamp();
  if (tocaPool) {
    const b = db.batch();
    b.update(refPool, { baja_motivo: NUEVO.baja, updated_at: now });
    b.set(refPool.collection("movimientos").doc(), {
      at: now, por: POR, por_email: POR, tipo: "correccion", de_estado: null, a_estado: null,
      ref: { tipo: "gestion", id: GID, label: GID }, notas: explicacion,
    });
    await b.commit();
    console.log("ok pool");
  }
  if (tocaG) {
    await db.runTransaction(async (tx) => {
      const d = (await tx.get(refG)).data();
      if (d.estado !== "cerrada" || (d.items || []).length !== 1) throw new Error("la gestión cambió mientras corría el script");
      tx.update(refG, {
        notas: NUEVO.nota,
        "reposicion.motivo": "dano",
        "aprobacion.motivo": NUEVO.aprobacion,
        items: [{ ...d.items[0], saliente_perdido: "dano", motivo_codigo: "dano", motivo_detalle: NUEVO.nota }],
        updated_at: now,
      });
    });
    await refG.collection("eventos").add({ accion: "correccion_motivo", at: now, por_uid: null, por_email: POR, detalle: explicacion });
    console.log("ok gestión");
  }
  if (tocaO) {
    // La orden está viva (recepción la edita): se relee y solo se cambia ese texto.
    await db.runTransaction(async (tx) => {
      const d = (await tx.get(refO)).data();
      let n = 0;
      const equipos = (d.equipos || []).map((e) => {
        if (e.eliminado || String(e.serial || "").toUpperCase() !== ENTRANTE || e.observaciones !== VIEJO.obsOrden) return e;
        n++; return { ...e, observaciones: NUEVO.obsOrden };
      });
      if (n !== 1) throw new Error("la observación del equipo cambió mientras corría el script");
      tx.update(refO, { equipos });
    });
    console.log("ok orden");
  }
  if (tocaP) { await refP.update({ "reposicion.motivo": "dano" }); console.log("ok pedido"); }
  console.log("\nLISTO.");
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
