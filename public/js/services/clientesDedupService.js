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
    .toLowerCase().replace(/\s+/g, " ").trim();
}
function _val(c, ...keys){
  for (const k of keys){ const v = (c[k] || "").toString().trim(); if (v) return v; }
  return "";
}

// ── Similitud (puro) ──────────────────────────────────────────────────
function _lev(a, b){
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++){
    let cur = [i];
    for (let j = 1; j <= n; j++){
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
function _ratio(a, b){
  if (!a && !b) return 1;
  const len = Math.max(a.length, b.length);
  return len ? 1 - _lev(a, b) / len : 1;
}
function _tokenSetRatio(a, b){
  const sort = s => s.split(" ").filter(Boolean).sort().join(" ");
  return _ratio(sort(a), sort(b));
}
// Similitud de nombre: máx entre normalizado, sin-espacios y por tokens ordenados.
function _nameSim(a, b){
  const na = _dnorm(a), nb = _dnorm(b);
  if (!na || !nb) return 0;
  return Math.max(_ratio(na, nb), _ratio(na.replace(/ /g, ""), nb.replace(/ /g, "")), _tokenSetRatio(na, nb));
}
function _rucDigits(c){ return ((c.ruc_norm || c.ruc || "") + "").replace(/\D/g, ""); }
// Similitud de RUC por dígitos; null si alguno no tiene RUC.
function _rucSim(a, b){
  const ra = _rucDigits(a), rb = _rucDigits(b);
  if (!ra || !rb) return null;
  return _ratio(ra, rb);
}

const NAME_HIGH = 0.86;  // nombre casi igual (para match SOLO por nombre, sin RUC que corrobore)
const RUC_HIGH  = 0.88;  // RUC con 1–2 dígitos de diferencia
const DUP_NAME  = 0.78;  // nombre mínimo para duplicado cuando el RUC coincide.
// (En los datos reales, los duplicados quedan en 78–100% y las sucursales del
//  mismo RUC en 52–74%, así que 0.78 las separa: typo = duplicado, sucursal = no.)
// Nivel de enlace entre dos clientes: 'exacta' | 'fuzzy' | null.
// CLAVE: mismo RUC NO basta — una empresa con varias sucursales comparte RUC.
// Para ser duplicado se exige RUC compatible Y nombre parecido.
function _edge(a, b){
  const rs = _rucSim(a, b);
  if (rs !== null && rs < 0.7) return null;       // RUCs distintos → entidades distintas (o RUC mal puesto): no unir
  const ns = _nameSim(a.nombre, b.nombre);
  const mismoNombre = _dnorm(a.nombre) && _dnorm(a.nombre) === _dnorm(b.nombre);
  if (rs === 1){
    // Mismo RUC: duplicado solo si el nombre también se parece. Si no, son
    // sucursales del mismo RUC o un RUC mal tecleado → NO agrupar.
    if (mismoNombre || ns >= 0.9) return "exacta";
    if (ns >= DUP_NAME) return "fuzzy";
    return null;
  }
  // RUC compatible (alguno vacío, o parecido por typo).
  if (mismoNombre) return "exacta";
  if (ns >= NAME_HIGH) return "fuzzy";                       // nombre casi igual (sin RUC que corrobore)
  if (rs !== null && rs >= RUC_HIGH && ns >= DUP_NAME) return "fuzzy"; // RUC con typo + nombre parecido
  return null;
}

const ClientesDedupService = {
  norm: _dnorm,

  // ── Detección (puro) ─────────────────────────────────────────────────
  // Agrupa por similitud: exacto (mismo RUC o nombre) + fuzzy (nombre/RUC casi
  // iguales, para errores de dedo). Usa "blocking" por prefijo para no comparar
  // todos contra todos. Cada par candidato se enlaza con union-find.
  buildClusters(clientes){
    const parent = {};
    const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => { parent[find(a)] = find(b); };
    const byId = new Map();
    clientes.forEach(c => { parent[c.id] = c.id; byId.set(c.id, c); });

    // Bloques: clientes que comparten prefijo de nombre (3) o de RUC (4 dígitos).
    const buckets = new Map();
    const addBucket = (k, id) => { if (!k) return; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(id); };
    for (const c of clientes){
      const nn = _dnorm(c.nombre).replace(/ /g, "");
      if (nn) addBucket("n:" + nn.slice(0, 3), c.id);
      const rd = _rucDigits(c);
      if (rd) addBucket("r:" + rd.slice(0, 4), c.id);
    }

    // Candidatos: pares dentro de un mismo bloque. Evalúa el enlace una sola vez.
    const seen = new Set();
    for (const ids of buckets.values()){
      for (let i = 0; i < ids.length; i++){
        for (let j = i + 1; j < ids.length; j++){
          const a = ids[i], b = ids[j];
          if (find(a) === find(b)) continue;
          const key = a < b ? a + "|" + b : b + "|" + a;
          if (seen.has(key)) continue;
          seen.add(key);
          if (_edge(byId.get(a), byId.get(b))) union(a, b);
        }
      }
    }

    const groups = new Map();
    for (const c of clientes){
      const r = find(c.id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(c);
    }
    return Array.from(groups.values()).filter(g => g.length >= 2);
  },

  // Similitud expuesta para la UI.
  nameSim(a, b){ return _nameSim(a, b); },
  rucSim(a, b){ return _rucSim(a, b); },

  // Confianza del grupo: 'exacta' si todos tienen el mismo nombre, o el mismo RUC
  // con nombres casi idénticos (≥90%). Si no, 'revisar' (se formó por similitud).
  clusterConfianza(cluster){
    const canon = this.pickCanonical(cluster);
    const nombres = cluster.map(c => _dnorm(c.nombre)).filter(Boolean);
    if (nombres.length === cluster.length && new Set(nombres).size === 1) return "exacta";
    const rucs = cluster.map(c => _rucDigits(c)).filter(Boolean);
    const unRuc = rucs.length === cluster.length && new Set(rucs).size === 1;
    const nombresCerca = cluster.every(c => c.id === canon.id || _nameSim(c.nombre, canon.nombre) >= 0.9);
    return (unRuc && nombresCerca) ? "exacta" : "revisar";
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
