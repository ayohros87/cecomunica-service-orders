const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { db } = require("../lib/admin");
const C = require("../domain/cajaMenuda");

/**
 * cajaMenudaReponer — el arqueo y la reposición del fondo de caja menuda.
 *
 * Cómo lo lleva Cheila (contabilidad; muestras del 2026-11-26): cuando el
 * fondo se va acabando junta los recibos pagados desde la última reposición,
 * cuenta el efectivo por denominación y pide un cheque por el total de los
 * recibos. Esto hace lo mismo, de una sola vez y sin que se pueda repetir un
 * recibo en dos reposiciones:
 *
 *   { conteo, nota?, solo_arqueo?, ids? } → { id, numero, n, total, esperado, diferencia }
 *
 *  · `conteo` = cuántas monedas y billetes hay de cada denominación.
 *  · `solo_arqueo: true` guarda el conteo y el cuadre (ARQ-0001) sin tocar
 *    ningún gasto.
 *  · Sin `solo_arqueo` arma la reposición (REP-0001): congela la lista de
 *    recibos, y a cada gasto le pone `reposicion_id` para que no vuelva a
 *    salir. Queda "preparada" hasta que el cheque se cobra.
 *  · `ids` = los gastos que la pantalla ve por reponer. Se suman a los que
 *    el servidor ya marcó (`por_reponer`): así un recibo pagado hace un
 *    segundo, que el trigger todavía no ha marcado, no se queda por fuera.
 *    El servidor no le cree a la lista: revisa cada gasto.
 *
 * Va por callable y no por reglas porque son muchos documentos que tienen
 * que cambiar juntos (el consecutivo, la reposición y cada gasto).
 *
 * Solo quien custodia la caja (contabilidad o administración).
 */

const MAX_GASTOS = 400; // una reposición real trae ~25 recibos

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
    const u = await db.collection("usuarios").doc(uid).get();
    const yo = u.exists ? u.data() : null;
    if (!yo || yo.activo === false || !C.esCustodio(yo.rol)) {
      throw new HttpsError("permission-denied", "Solo quien custodia la caja menuda.");
    }

    const d = request.data || {};
    const soloArqueo = d.solo_arqueo === true;
    const conteo = d.conteo;
    if (!C.conteoValido(conteo)) {
      throw new HttpsError("invalid-argument", "Cuenta el efectivo: cuántas monedas y billetes hay de cada denominación.");
    }
    const nota = String(d.nota || "").trim().replace(/\s+/g, " ").slice(0, 300);
    const ids = Array.isArray(d.ids)
      ? [...new Set(d.ids.filter((x) => typeof x === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, MAX_GASTOS)
      : [];

    const cfgSnap = await db.collection("empresa").doc("caja_menuda").get();
    const cfg = C.config(cfgSnap.exists ? cfgSnap.data() : {});
    const col = db.collection("caja_menuda");
    const tipo = soloArqueo ? "arqueo" : "reposicion";

    const res = await db.runTransaction(async (tx) => {
      const [marcados, enCalle, preparadas] = await Promise.all([
        tx.get(col.where("por_reponer", "==", true)),
        tx.get(col.where("estado", "in", ["entregado", "rendido"])),
        tx.get(db.collection("caja_menuda_reposiciones").where("estado", "==", "preparada")),
      ]);
      const porId = new Map();
      for (const s of marcados.docs) porId.set(s.id, { id: s.id, ...s.data() });
      const faltan = ids.filter((id) => !porId.has(id));
      if (faltan.length) {
        const extra = await tx.getAll(...faltan.map((id) => col.doc(id)));
        for (const s of extra) if (s.exists) porId.set(s.id, { id: s.id, ...s.data() });
      }
      const gastos = [...porId.values()].filter(C.porReponer);
      if (gastos.length > MAX_GASTOS) {
        throw new HttpsError("failed-precondition", `Hay más de ${MAX_GASTOS} recibos por reponer; avisa a sistemas.`);
      }
      const items = C.itemsInforme(gastos);
      if (!soloArqueo && !items.length) {
        throw new HttpsError("failed-precondition", "No hay recibos pagados en efectivo por reponer.");
      }
      const q = C.cuadre({
        fondo: cfg.fondo,
        gastos: [...gastos, ...enCalle.docs.map((s) => ({ id: s.id, ...s.data() }))],
        reposiciones: preparadas.docs.map((s) => s.data()),
        conteo,
      });

      const cRef = db.collection("contadores").doc("caja_menuda_reposiciones");
      const c = await tx.get(cRef);
      const campo = soloArqueo ? "ultimo_arqueo" : "ultimo";
      const n = (c.exists ? Number(c.data()[campo]) || 0 : 0) + 1;
      const numero = C.numeroReposicion(tipo, n);
      const ahora = Timestamp.now();
      const ref = db.collection("caja_menuda_reposiciones").doc();

      tx.set(cRef, { [campo]: n, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(ref, {
        tipo,
        numero,
        estado: soloArqueo ? "hecho" : "preparada",
        fecha: C.fechaPanama(ahora.toMillis()),
        fondo: q.fondo,
        n: q.n,
        // En un arqueo los recibos siguen por reponer: se guarda cuánto
        // sumaban, no la lista (esa queda congelada en la reposición).
        total: q.gastado,
        desde: items.length ? items[0].numero : "",
        hasta: items.length ? items[items.length - 1].numero : "",
        items: soloArqueo ? [] : items,
        gasto_ids: soloArqueo ? [] : items.map((it) => it.id),
        anticipos: q.anticipos,
        por_cobrar: q.por_cobrar,
        esperado: q.esperado,
        arqueo: { conteo, efectivo: q.efectivo, diferencia: q.diferencia },
        nota,
        created_at: FieldValue.serverTimestamp(),
        created_by_uid: uid,
        created_by_nombre: yo.nombre || "",
      });
      if (!soloArqueo) {
        const paso = { at: ahora, por_uid: uid, por_nombre: yo.nombre || "", accion: "repuesto", nota: numero };
        for (const it of items) {
          tx.update(col.doc(it.id), {
            reposicion_id: ref.id,
            reposicion_numero: numero,
            por_reponer: false,
            historial: FieldValue.arrayUnion(paso),
            updated_at: FieldValue.serverTimestamp(),
          });
        }
      }
      return { id: ref.id, numero, n: q.n, total: q.gastado, esperado: q.esperado, efectivo: q.efectivo, diferencia: q.diferencia };
    });

    logger.info("[cajaMenudaReponer]", { uid, tipo, ...res });
    return res;
  }
);
