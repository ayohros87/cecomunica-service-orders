/**
 * refsHuerfanasService.js — Detecta y sana referencias huérfanas.
 *
 * Una orden / equipo POC / contrato es "huérfano" si:
 *   - no tiene `cliente_id`, o
 *   - su `cliente_id` apunta a un cliente borrado (deleted) sin sucesor.
 *
 * Para cada huérfano se toma su NOMBRE (cliente / cliente_nombre, o el nombre del
 * cliente borrado), se agrupan por nombre, y se sugiere el cliente ACTIVO que mejor
 * coincide (exacto normalizado, o fuzzy vía ClientesDedupService.nameSim). El usuario
 * revisa y re-apunta: setea `cliente_id` al cliente elegido y unifica el nombre.
 *
 * Contratos: solo se re-enlaza `cliente_id` (snapshot histórico intacto).
 */
(function (global) {
  'use strict';

  function _norm(s){
    return String(s == null ? "" : s)
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }
  const COLS = [
    { name: "ordenes_de_servicio", del: "eliminado", kind: "orden" },
    { name: "poc_devices",         del: "deleted",   kind: "poc" },
    { name: "contratos",           del: "deleted",   kind: "contrato" },
  ];

  const RefsHuerfanasService = {
    norm: _norm,

    // Escaneo de solo lectura. Devuelve grupos de huérfanos por nombre.
    async scan(){
      const db = firebase.firestore();
      const cliSnap = await db.collection("clientes").get();
      const byId = new Map();
      const activos = [];
      const nameToActivo = new Map(); // norm -> { id, nombre } (cliente activo)
      cliSnap.forEach(doc => {
        const c = { id: doc.id, ...doc.data() };
        byId.set(c.id, c);
        if (c.deleted !== true){
          activos.push(c);
          const n = _norm(c.nombre);
          if (n && !nameToActivo.has(n)) nameToActivo.set(n, { id: c.id, nombre: c.nombre });
        }
      });

      // Junta huérfanos por nombre normalizado.
      const grupos = new Map(); // norm -> { nombre, norm, docs:[{col,id,kind,cliente,cliente_nombre}], counts }
      for (const col of COLS){
        const snap = await db.collection(col.name).get();
        for (const doc of snap.docs){
          const d = doc.data();
          if (d[col.del] === true) continue;
          const cid = (d.cliente_id || "").trim();
          // ¿huérfano? sin id, o id que apunta a cliente borrado.
          let esHuerfano = false, nombreRef = "";
          if (!cid){
            esHuerfano = true;
            nombreRef = d.cliente || d.cliente_nombre || "";
          } else {
            const c = byId.get(cid);
            if (!c || c.deleted === true){
              esHuerfano = true;
              nombreRef = d.cliente || d.cliente_nombre || (c ? c.nombre : "") || "";
            }
          }
          if (!esHuerfano) continue;
          const norm = _norm(nombreRef);
          const key = norm || ("__sinnombre__" + col.name);
          if (!grupos.has(key)){
            grupos.set(key, { nombre: nombreRef || "(sin nombre)", norm, docs: [], counts: { orden:0, poc:0, contrato:0 } });
          }
          const g = grupos.get(key);
          g.docs.push({ col: col.name, id: doc.id, kind: col.kind, cliente: ("cliente" in d), cliente_nombre: ("cliente_nombre" in d) });
          g.counts[col.kind]++;
        }
      }

      // Sugerir cliente activo por grupo (exacto, luego fuzzy).
      const Dedup = global.ClientesDedupService;
      for (const g of grupos.values()){
        g.total = g.docs.length;
        g.sugerido = null;
        if (!g.norm) continue;
        const exacto = nameToActivo.get(g.norm);
        if (exacto){ g.sugerido = { id: exacto.id, nombre: exacto.nombre, sim: 1 }; continue; }
        if (Dedup && Dedup.nameSim){
          let best = null, bestSim = 0;
          for (const c of activos){
            const sim = Dedup.nameSim(g.nombre, c.nombre);
            if (sim > bestSim){ bestSim = sim; best = c; }
          }
          if (best && bestSim >= 0.78) g.sugerido = { id: best.id, nombre: best.nombre, sim: bestSim };
        }
      }

      const lista = Array.from(grupos.values()).sort((a, b) => b.total - a.total);
      const totals = {
        grupos: lista.length,
        docs: lista.reduce((s, g) => s + g.total, 0),
        conSugerencia: lista.filter(g => g.sugerido).length,
      };
      return { grupos: lista, totals };
    },

    // Re-apunta todos los docs de un grupo al cliente destino.
    async rePoint(docs, target){
      const db = firebase.firestore();
      const ahora = firebase.firestore.FieldValue.serverTimestamp();
      let n = 0;
      for (const ref of docs){
        const update = { cliente_id: target.id };
        if (ref.kind !== "contrato"){
          if (ref.cliente) update.cliente = target.nombre;
          if (ref.cliente_nombre) update.cliente_nombre = target.nombre;
        } else {
          update.updated_at = ahora;
        }
        await db.collection(ref.col).doc(ref.id).update(update);
        n++;
      }
      return { afectados: n };
    },
  };

  global.RefsHuerfanasService = RefsHuerfanasService;
})(window);
