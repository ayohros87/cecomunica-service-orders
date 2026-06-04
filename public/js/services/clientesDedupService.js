/**
 * clientesDedupService.js — Detección y fusión de clientes duplicados.
 *
 * Problema: el mismo cliente quedó capturado varias veces (uno con DV y otro sin,
 * variaciones de nombre, uno con RUC y otro sin). No son sub-cuentas: son
 * duplicados sucios que hay que UNIFICAR en un solo registro canónico.
 *
 * Detección (union-find):
 *   - Mismo `ruc_norm` (no vacío) → mismo cliente.
 *   - Mismo `nombre_norm` → mismo cliente, SALVO que tengan RUCs distintos no
 *     vacíos (ahí probablemente son entidades diferentes y no se unen por nombre).
 * Cada clúster de 2+ miembros es un duplicado candidato (se revisa antes de fusionar).
 *
 * Fusión: elige el registro canónico (el más completo), rellena lo que le falte
 * desde los duplicados, re-apunta las referencias y hace soft-delete de los
 * duplicados. Referencias:
 *   - contratos:            campo `cliente_id`  (por id)
 *   - ordenes_de_servicio:  campo `cliente`     (por NOMBRE)
 *   - poc_devices:          campo `cliente`     (por NOMBRE)
 */

function _dnorm(s){
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim();
}
function _val(c, ...keys){
  for (const k of keys){ const v = (c[k] || "").toString().trim(); if (v) return v; }
  return "";
}

const ClientesDedupService = {
  norm: _dnorm,

  // ── Detección (puro) ─────────────────────────────────────────────────
  buildClusters(clientes){
    const parent = {};
    const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => { parent[find(a)] = find(b); };
    clientes.forEach(c => { parent[c.id] = c.id; });

    // Unir por ruc_norm (no vacío).
    const byRuc = new Map();
    for (const c of clientes){
      const k = (c.ruc_norm || "").trim();
      if (!k) continue;
      if (!byRuc.has(k)) byRuc.set(k, []);
      byRuc.get(k).push(c.id);
    }
    for (const ids of byRuc.values())
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

    // Unir por nombre_norm, salvo que el grupo tenga 2+ RUCs distintos no vacíos.
    const byName = new Map();
    for (const c of clientes){
      const k = _dnorm(c.nombre);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    }
    for (const arr of byName.values()){
      if (arr.length < 2) continue;
      const rucs = new Set(arr.map(c => (c.ruc_norm || "").trim()).filter(Boolean));
      if (rucs.size > 1) continue; // mismo nombre, RUCs distintos → no unir
      for (let i = 1; i < arr.length; i++) union(arr[0].id, arr[i].id);
    }

    const groups = new Map();
    for (const c of clientes){
      const r = find(c.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(c);
    }
    return Array.from(groups.values()).filter(g => g.length >= 2);
  },

  // Puntaje de completitud (para sugerir el canónico).
  score(c){
    let s = 0;
    if (_val(c, "ruc_norm")) s += 4;
    if (_val(c, "dv")) s += 2;
    if (_val(c, "representante")) s += 2;
    if (_val(c, "representante_cedula", "cedula_representante")) s += 1;
    if (_val(c, "email")) s += 1;
    if (_val(c, "telefono")) s += 1;
    if (_val(c, "direccion")) s += 1;
    return s;
  },

  // Cliente canónico sugerido: el de mayor puntaje (desempate estable por id).
  pickCanonical(cluster){
    return cluster.slice().sort((a, b) => {
      const d = this.score(b) - this.score(a);
      return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
    })[0];
  },

  // Campos que el canónico ganaría desde los duplicados (donde el canónico está vacío).
  proposeFill(canonical, dups){
    const campos = ["ruc", "dv", "representante", "representante_cedula",
      "email", "telefono", "direccion", "direccion_facturacion",
      "itbms_motivo_exencion"];
    const fill = {};
    for (const f of campos){
      if (_val(canonical, f)) continue;
      for (const d of dups){
        const v = _val(d, f, f === "representante_cedula" ? "cedula_representante" : f);
        if (v){ fill[f] = v; break; }
      }
    }
    // ITBMS exento: si el canónico no está exento pero algún duplicado sí, proponerlo.
    if (!canonical.itbms_exento && dups.some(d => d.itbms_exento)){
      fill.itbms_exento = true;
    }
    return fill;
  },

  // ── Referencias (Firestore, solo lectura) ────────────────────────────
  async contarReferencias(cliente){
    const db = firebase.firestore();
    const nombre = cliente.nombre || "";
    const [c, o, p] = await Promise.all([
      db.collection("contratos").where("cliente_id", "==", cliente.id).get(),
      nombre ? db.collection("ordenes_de_servicio").where("cliente", "==", nombre).get() : Promise.resolve({ size: 0 }),
      nombre ? db.collection("poc_devices").where("cliente", "==", nombre).get() : Promise.resolve({ size: 0 }),
    ]);
    return { contratos: c.size, ordenes: o.size, poc: p.size };
  },

  async getClientesActivos(){
    const db = firebase.firestore();
    const snap = await db.collection("clientes").where("deleted", "==", false).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // ── Fusión (Firestore, escribe) ──────────────────────────────────────
  // Re-apunta referencias de cada duplicado al canónico, rellena sus huecos y
  // hace soft-delete de los duplicados. Devuelve conteos de lo afectado.
  async mergeCluster({ canonical, dups, fill = {} }){
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    const ahora = firebase.firestore.FieldValue.serverTimestamp();
    let contratosRepointed = 0, ordenesRepointed = 0, pocRepointed = 0;

    for (const dup of dups){
      // contratos por cliente_id
      const cSnap = await db.collection("contratos").where("cliente_id", "==", dup.id).get();
      for (const doc of cSnap.docs){
        await doc.ref.update({ cliente_id: canonical.id, cliente_nombre: canonical.nombre || "" });
        contratosRepointed++;
      }
      // ordenes y poc por nombre
      const nombre = dup.nombre || "";
      if (nombre && canonical.nombre){
        const oSnap = await db.collection("ordenes_de_servicio").where("cliente", "==", nombre).get();
        for (const doc of oSnap.docs){ await doc.ref.update({ cliente: canonical.nombre }); ordenesRepointed++; }
        const pSnap = await db.collection("poc_devices").where("cliente", "==", nombre).get();
        for (const doc of pSnap.docs){ await doc.ref.update({ cliente: canonical.nombre }); pocRepointed++; }
      }
      // soft-delete del duplicado
      await db.collection("clientes").doc(dup.id).update({
        deleted: true,
        merged_into: canonical.id,
        merged_at: ahora,
        merged_by: uid,
        updated_at: ahora,
        updated_by: uid,
      });
    }

    // Rellenar huecos del canónico (vía buildClientePayload si está disponible,
    // para mantener derivados/tokens consistentes).
    if (Object.keys(fill).length){
      const base = { ...canonical, ...fill };
      let payload;
      if (window.ClientesService && ClientesService.buildClientePayload){
        payload = ClientesService.buildClientePayload(base, { user: firebase.auth().currentUser, isCreate: false });
      } else {
        payload = { ...fill, updated_at: ahora, updated_by: uid };
      }
      await db.collection("clientes").doc(canonical.id).update(payload);
    }

    return { contratosRepointed, ordenesRepointed, pocRepointed, eliminados: dups.length };
  },
};

window.ClientesDedupService = ClientesDedupService;
