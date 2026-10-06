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
 * desde los duplicados, re-apunta las referencias y marca los duplicados como
 * eliminados. Deja un registro en admin_audit con los valores anteriores.
 * Referencias:
 *   - contratos:            campo `cliente_id`  (por id)
 *   - ordenes_de_servicio:  `cliente_id`; por NOMBRE solo en grupos exactos
 *   - poc_devices:          `cliente_id`; por NOMBRE solo en grupos exactos
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
// Con las letras: 8-NT-2-39271 y 8-2-39271 son contribuyentes distintos.
function _rucDigits(c){ return ((c.ruc_norm || c.ruc || "") + "").toUpperCase().replace(/[^0-9A-Z]/g, ""); }
// Similitud de RUC; null si alguno no tiene RUC.
function _rucSim(a, b){
  const ra = _rucDigits(a), rb = _rucDigits(b);
  if (!ra || !rb) return null;
  return _ratio(ra, rb);
}

const NAME_HIGH = 0.86;  // nombre casi igual (para match SOLO por nombre, sin RUC que corrobore)
const RUC_HIGH  = 0.88;  // RUC con 1–2 dígitos de diferencia
const DUP_NAME  = 0.78;  // nombre mínimo para duplicado cuando el RUC coincide.
const COLA_TYPO = 0.7;   // similitud mínima entre las COLAS divergentes para leerlas como typo

// ¿Nombres de SUCURSAL y no duplicado? Las sedes comparten el tronco de la
// razón social y divergen en colas DISTINTAS ("…SHEVET AHIM KSI" vs "…AHIM
// CIR", "R. SMITH MULTIPLAZA" vs "ALTA PLAZA") — eso dispara similitudes
// globales de 78–95%, por encima de cualquier umbral útil. Un typo real
// diverge con colas PARECIDAS ("P.H. THE…" vs "PH THE…"). También cuenta como
// sede el nombre que EXTIENDE al otro con una palabra sustantiva ("…AHIM" →
// "…AHIM GAN YELADIM"), salvo boilerplate societario (S.A., CORP…).
const SUFIJOS_SOCIETARIOS = new Set(["sa", "sdea", "sderl", "inc", "corp", "ltda"]);
function _sonSucursales(na, nb){
  const a = _dnorm(na), b = _dnorm(nb);
  if (!a || !b || a === b) return false;
  let i = 0;
  const min = Math.min(a.length, b.length);
  while (i < min && a[i] === b[i]) i++;
  const colaA = a.slice(i).trim(), colaB = b.slice(i).trim();
  if (!colaA && !colaB) return false;
  if (!colaA || !colaB){
    const cola = (colaA || colaB).replace(/[^a-z0-9 ]/g, "").trim();
    if (!cola) return false; // solo puntuación → typo
    return !cola.split(" ").filter(Boolean).every(t => SUFIJOS_SOCIETARIOS.has(t));
  }
  return _ratio(colaA, colaB) < COLA_TYPO;
}

// ¿`corto` es la sigla de `largo`? Una sola palabra de 3–8 letras, misma
// inicial, y sus letras aparecen en orden dentro del nombre largo de 3+ palabras.
function _esSigla(corto, largo){
  const s = _dnorm(corto).replace(/[^a-z0-9]/g, "");
  const l = _dnorm(largo).replace(/[^a-z0-9 ]/g, "").trim();
  if (_dnorm(corto).includes(" ") || s.length < 3 || s.length > 8) return false;
  if (l.split(" ").filter(Boolean).length < 3 || s[0] !== l[0]) return false;
  let i = 0;
  for (const ch of l.replace(/ /g, "")) if (ch === s[i]) i++;
  return i === s.length;
}

// Nivel de enlace entre dos clientes: 'exacta' | 'fuzzy' | null.
// CLAVE: mismo RUC NO basta — una empresa con varias sucursales comparte RUC.
// Para ser duplicado se exige RUC compatible Y nombre parecido, y que la
// diferencia de nombre parezca typo y no sede (_sonSucursales).
function _edge(a, b){
  const rs = _rucSim(a, b);
  if (rs !== null && rs < 0.7) return null;       // RUCs distintos → entidades distintas (o RUC mal puesto): no unir
  const ns = _nameSim(a.nombre, b.nombre);
  const mismoNombre = _dnorm(a.nombre) && _dnorm(a.nombre) === _dnorm(b.nombre);
  if (mismoNombre) return "exacta";
  // Sigla del mismo contribuyente ("ANATI" / "AUTORIDAD NACIONAL DE
  // ADMINISTRACION DE TIERRAS"): no se parece en nada y las colas parecen de
  // sede, pero con el RUC idéntico se propone para revisar (caso 2026-10-06).
  if (rs === 1 && (_esSigla(a.nombre, b.nombre) || _esSigla(b.nombre, a.nombre))) return "fuzzy";
  if (_sonSucursales(a.nombre, b.nombre)) return null; // sedes del mismo grupo → NO agrupar
  if (rs === 1){
    // Mismo RUC: duplicado solo si el nombre también se parece.
    if (ns >= 0.9) return "exacta";
    if (ns >= DUP_NAME) return "fuzzy";
    return null;
  }
  // RUC compatible (alguno vacío, o parecido por typo).
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

    // Bloques: clientes que comparten prefijo de nombre (3, solo alfanumérico:
    // "P.H. X" y "PH X" deben caer juntos), prefijo de RUC (4 dígitos) o algún
    // token significativo del nombre ("RIBA SMITH" / "R. SMITH" no comparten
    // prefijo pero sí el token "smith" — sin esto nunca se comparan).
    const buckets = new Map();
    const addBucket = (k, id) => { if (!k) return; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(id); };
    for (const c of clientes){
      const nn = _dnorm(c.nombre).replace(/[^a-z0-9]/g, "");
      if (nn) addBucket("n:" + nn.slice(0, 3), c.id);
      const rd = _rucDigits(c);
      if (rd) addBucket("r:" + rd.slice(0, 4), c.id);
      _dnorm(c.nombre).split(" ")
        .map(t => t.replace(/[^a-z0-9]/g, ""))
        .filter(t => t.length >= 4)
        .forEach(t => addBucket("t:" + t, c.id));
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

  // Trae TODOS los clientes y filtra en memoria: `where deleted == false`
  // excluiría los docs legacy que no tienen el campo `deleted`, que son
  // justamente los más propensos a estar duplicados.
  async getClientesActivos(){
    const db = firebase.firestore();
    const snap = await db.collection("clientes").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.deleted !== true);
  },

  // ── Fusión (Firestore, escribe) ──────────────────────────────────────
  // Auditoría UX 2026-09-28: la fusión NO es reversible por sí sola (antes el
  // texto decía "soft-delete, reversible"). Ahora se hace en dos pasos:
  //   1. planFusion (solo lee): arma la lista exacta de cambios con el valor
  //      ANTERIOR de cada campo. Con eso el confirm muestra conteos reales.
  //   2. ejecutarFusion: guarda el plan en `admin_audit` {tipo:'fusion'} ANTES
  //      de escribir nada (si no se puede guardar, no se fusiona) y aplica los
  //      cambios con db.batch() en tandas de 400.
  // Qué se toca:
  //   - Contratos: solo se re-enlaza `cliente_id` (el snapshot histórico —
  //     nombre/RUC/dirección— se conserva tal como se emitió).
  //   - Órdenes y POC: se re-apunta `cliente_id` y se unifica el nombre
  //     denormalizado. Por id siempre; por NOMBRE normalizado solo si el grupo
  //     es "exacto" (porNombre). En grupos "por similitud" el nombre parecido
  //     no prueba que la orden sea de ese cliente, así que no se re-apunta.
  async planFusion({ canonical, dups, fill = {}, porNombre = false }){
    const db = firebase.firestore();
    const refs = [];   // { col, id, antes:{campo:valor|null}, despues:{campo:valor}, via:'id'|'nombre' }
    const cuenta = { contratos: 0, ordenes: 0, poc: 0, ordenesPorNombre: 0, pocPorNombre: 0 };
    const antesDe = (d, campos) => Object.fromEntries(campos.map(k => [k, k in d ? d[k] : null]));

    // 1) Contratos por cliente_id.
    for (const dup of dups){
      const cSnap = await db.collection("contratos").where("cliente_id", "==", dup.id).get();
      for (const doc of cSnap.docs){
        refs.push({ col: "contratos", id: doc.id, via: "id",
          antes: { cliente_id: dup.id }, despues: { cliente_id: canonical.id } });
        cuenta.contratos++;
      }
    }

    // 2) Órdenes y POC.
    const dupIds = new Set(dups.map(d => d.id));
    const variantes = new Set([canonical, ...dups].map(c => _dnorm(c.nombre)).filter(Boolean));
    for (const col of ["ordenes_de_servicio", "poc_devices"]){
      const all = await db.collection(col).get();
      for (const doc of all.docs){
        const d = doc.data();
        const porId = !!(d.cliente_id && dupIds.has(d.cliente_id));
        // Sin cliente_id (legacy) o apuntando al canónico: el nombre decide,
        // solo en grupos exactos. Un doc con cliente_id de OTRO cliente nunca
        // se toca por nombre.
        const idLibre = !d.cliente_id || d.cliente_id === canonical.id;
        const coincideNombre =
          (d.cliente && variantes.has(_dnorm(d.cliente))) ||
          (d.cliente_nombre && variantes.has(_dnorm(d.cliente_nombre)));
        const viaNombre = !porId && porNombre && idLibre && coincideNombre;
        if (!porId && !viaNombre) continue;

        const despues = {};
        if (d.cliente_id !== canonical.id) despues.cliente_id = canonical.id;
        if (canonical.nombre){
          if ("cliente" in d && d.cliente !== canonical.nombre) despues.cliente = canonical.nombre;
          if ("cliente_nombre" in d && d.cliente_nombre !== canonical.nombre) despues.cliente_nombre = canonical.nombre;
        }
        if (!Object.keys(despues).length) continue; // ya apunta al canónico
        refs.push({ col, id: doc.id, via: porId ? "id" : "nombre", antes: antesDe(d, Object.keys(despues)), despues });
        if (col === "ordenes_de_servicio"){ cuenta.ordenes++; if (!porId) cuenta.ordenesPorNombre++; }
        else { cuenta.poc++; if (!porId) cuenta.pocPorNombre++; }
      }
    }

    // 2b) Pool: `asignacion.cliente_id` (dónde está hoy el radio) y
    // `venta.cliente_id`. Sin esto la flota del cliente se quedaba colgando del
    // duplicado borrado (caso ANATI, 2026-10-06: 36 equipos). El kardex
    // (movimientos) es histórico y no se toca.
    cuenta.pool = 0;
    for (const dup of dups){
      for (const campo of ["asignacion", "venta"]){
        const pSnap = await db.collection("equipos_pool").where(`${campo}.cliente_id`, "==", dup.id).get();
        for (const doc of pSnap.docs){
          const sub = doc.data()[campo] || {};
          const despues = { [`${campo}.cliente_id`]: canonical.id };
          if (canonical.nombre && "cliente_nombre" in sub && sub.cliente_nombre !== canonical.nombre){
            despues[`${campo}.cliente_nombre`] = canonical.nombre;
          }
          const ya = refs.find(r => r.col === "equipos_pool" && r.id === doc.id);
          if (ya){
            Object.assign(ya.despues, despues);
            Object.keys(despues).forEach(k => { ya.antes[k] = k.endsWith("_id") ? dup.id : (sub.cliente_nombre ?? null); });
            continue;
          }
          const antes = { [`${campo}.cliente_id`]: dup.id };
          if (despues[`${campo}.cliente_nombre`]) antes[`${campo}.cliente_nombre`] = sub.cliente_nombre ?? null;
          refs.push({ col: "equipos_pool", id: doc.id, via: "id", antes, despues });
          cuenta.pool++;
        }
      }
    }

    // 3) Soft-delete de los duplicados (con su estado anterior).
    const bajas = dups.map(dup => ({ id: dup.id, nombre: dup.nombre || "",
      antes: antesDe(dup, ["deleted", "merged_into", "merged_at", "merged_by"]) }));

    // 4) Relleno del canónico (vía buildClientePayload si está, para mantener
    // derivados/tokens consistentes).
    let relleno = null;
    if (Object.keys(fill).length){
      const base = { ...canonical, ...fill };
      let payload;
      if (window.ClientesService && ClientesService.buildClientePayload){
        payload = ClientesService.buildClientePayload(base, { user: firebase.auth().currentUser, isCreate: false });
      } else {
        payload = { ...fill };
      }
      relleno = { payload, antes: antesDe(canonical, Object.keys(payload)) };
    }

    // 5) Catálogo de grupos PoC (clientes/{id}.poc_grupos + prefijo). Vive en
    // la ficha, no en los equipos: si se queda en el duplicado, los radios
    // re-apuntados llegan a un cliente sin catálogo (caso ANATI, 2026-10-06).
    let catalogoPoc = null;
    const gruposCanon = Array.isArray(canonical.poc_grupos) ? canonical.poc_grupos : [];
    const union = gruposCanon.slice();
    for (const dup of dups){
      for (const g of (Array.isArray(dup.poc_grupos) ? dup.poc_grupos : [])){
        if (g && !union.includes(g)) union.push(g);
      }
    }
    const despuesCat = {};
    if (union.length !== gruposCanon.length) despuesCat.poc_grupos = union.slice().sort((a, b) => a.localeCompare(b, "es"));
    if (!canonical.poc_grupo_prefix){
      const pref = dups.map(d => d.poc_grupo_prefix).find(Boolean);
      if (pref) despuesCat.poc_grupo_prefix = pref;
    }
    if (Object.keys(despuesCat).length){
      catalogoPoc = { antes: antesDe(canonical, Object.keys(despuesCat)), despues: despuesCat,
        nuevos: union.length - gruposCanon.length };
    }

    return { canonical, dups, fill, porNombre, refs, bajas, relleno, catalogoPoc, cuenta };
  },

  async ejecutarFusion(plan){
    const db = firebase.firestore();
    const FV = firebase.firestore.FieldValue;
    const uid = firebase.auth().currentUser?.uid || null;
    const ahora = FV.serverTimestamp();
    const { canonical, refs, bajas, relleno } = plan;

    // Firestore no guarda `undefined`; FieldValue (serverTimestamp) en el
    // payload tampoco sirve como "valor anterior": se limpia para el registro.
    const limpio = (o) => JSON.parse(JSON.stringify(o ?? null, (k, v) =>
      (v && typeof v === "object" && typeof v.toMillis === "function") ? { _ts: v.toMillis() } : (v === undefined ? null : v)));

    // Registro previo: sin él no se fusiona (es la única vía para deshacer).
    // Las refs van en tandas de 1,500 por doc para no pasar el 1 MB por doc.
    const TANDA_REG = 1500;
    const principal = {
      estado: "en_curso",
      conservado: { id: canonical.id, nombre: canonical.nombre || "" },
      fusionados: bajas.map(b => ({ id: b.id, nombre: b.nombre, antes: limpio(b.antes) })),
      por_nombre: !!plan.porNombre,
      cuenta: plan.cuenta,
      refs: limpio(refs.slice(0, TANDA_REG)),
      refs_partes: Math.max(1, Math.ceil(refs.length / TANDA_REG)),
      relleno: relleno ? { antes: limpio(relleno.antes), campos: Object.keys(relleno.payload) } : null,
      catalogo_poc: plan.catalogoPoc ? { antes: limpio(plan.catalogoPoc.antes), despues: limpio(plan.catalogoPoc.despues) } : null,
    };
    let auditRef;
    try {
      auditRef = await EmpresaService.registrarAdminAudit("fusion", principal);
      for (let i = TANDA_REG, parte = 2; i < refs.length; i += TANDA_REG, parte++){
        await EmpresaService.registrarAdminAudit("fusion_refs", {
          fusion_id: auditRef.id, parte, refs: limpio(refs.slice(i, i + TANDA_REG)),
        });
      }
    } catch (e){
      throw new Error("no se pudo guardar el registro previo de la fusión (" + (e.message || e.code || e) + "). No se cambió nada.");
    }

    // Escrituras en lotes de 400 (tope de Firestore: 500 por batch).
    const ops = [];
    for (const r of refs){
      const extra = r.col === "contratos" ? { updated_at: ahora } : {};
      ops.push([db.collection(r.col).doc(r.id), { ...r.despues, ...extra }]);
    }
    for (const b of bajas){
      ops.push([db.collection("clientes").doc(b.id), {
        deleted: true, merged_into: canonical.id, merged_at: ahora, merged_by: uid,
        merged_audit_id: auditRef.id, updated_at: ahora, updated_by: uid,
      }]);
    }
    if (relleno) ops.push([db.collection("clientes").doc(canonical.id), relleno.payload]);
    if (plan.catalogoPoc) ops.push([db.collection("clientes").doc(canonical.id), plan.catalogoPoc.despues]);

    let hechas = 0;
    try {
      for (let i = 0; i < ops.length; i += 400){
        const batch = db.batch();
        for (const [ref, data] of ops.slice(i, i + 400)) batch.update(ref, data);
        await batch.commit();
        hechas += Math.min(400, ops.length - i);
      }
    } catch (e){
      await auditRef.update({ estado: "fallida", ops_aplicadas: hechas, ops_total: ops.length, error: String(e.message || e) }).catch(() => {});
      throw new Error(`la fusión quedó a medias (${hechas} de ${ops.length} cambios aplicados). El registro en Auditoría tiene los valores anteriores. ` + (e.message || e));
    }
    await auditRef.update({ estado: "completada", ops_aplicadas: hechas, ops_total: ops.length }).catch(() => {});

    const c = plan.cuenta;
    return { contratosRepointed: c.contratos, ordenesRepointed: c.ordenes, pocRepointed: c.poc, poolRepointed: c.pool || 0,
             eliminados: bajas.length, auditId: auditRef.id };
  },

  // Compatibilidad: plan + ejecución en un paso.
  async mergeCluster({ canonical, dups, fill = {}, porNombre = false }){
    const plan = await this.planFusion({ canonical, dups, fill, porNombre });
    return this.ejecutarFusion(plan);
  },
};

window.ClientesDedupService = ClientesDedupService;
