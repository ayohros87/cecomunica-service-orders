/**
 * organizacionesService.js
 * Capa de datos para la colección `organizaciones` (matrices que agrupan
 * varias cuentas de cliente). Espeja los patrones de ClientesService:
 * normalización, tokens de búsqueda, paginación por cursor y soft-delete.
 *
 * Una "subcuenta" es un doc de `clientes` con `organizacionId` apuntando aquí.
 * Esta colección es ADITIVA: contratos, órdenes y POC nunca la leen.
 */

// ── Helpers puros (sin Firestore) ────────────────────────────────────────
function _orgNorm(s){
  return (s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim();
}
function _orgTokens(text){
  if (!text) return [];
  const parts = _orgNorm(text).split(/[^a-z0-9]+/).filter(Boolean);
  const toks = new Set();
  for (const p of parts){
    for (let i = 2; i <= p.length; i++) toks.add(p.slice(0, i));
  }
  return Array.from(toks).slice(0, 200);
}

const OrganizacionesService = {
  norm: _orgNorm,
  tokensFrom: _orgTokens,

  buildSearchTokens(org){
    const t = new Set([ ..._orgTokens(org.nombre) ]);
    if (org.ruc) t.add(String(org.ruc).replace(/\D/g, ""));
    return Array.from(t);
  },

  // Payload normalizado, fuente única de verdad de campos derivados.
  buildOrgPayload(raw, { user = null, isCreate = false } = {}){
    const ahora = firebase.firestore.FieldValue.serverTimestamp();
    const ruc = (raw.ruc || "").trim();
    const ruc_norm = ruc.replace(/\D/g, "");
    const org = {
      nombre: (raw.nombre || "").trim(),
      nombre_norm: _orgNorm(raw.nombre),
      ruc, ruc_norm,
      activo: raw.activo !== false,
      updated_at: ahora,
      updated_by: user?.uid || null,
    };
    org.searchTokens = this.buildSearchTokens(org);
    if (isCreate){
      org.created_at = ahora;
      org.created_by = user?.uid || null;
      org.deleted = false;
    }
    return org;
  },

  async createOrg(payload){
    const db = firebase.firestore();
    const ref = await db.collection("organizaciones").add(payload);
    return ref.id;
  },

  async updateOrg(orgId, updates){
    const db = firebase.firestore();
    return db.collection("organizaciones").doc(orgId).update({
      ...updates,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: firebase.auth().currentUser?.uid || null,
    });
  },

  async softDeleteOrg(orgId){
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    return db.collection("organizaciones").doc(orgId).update({
      deleted: true,
      deleted_at: firebase.firestore.FieldValue.serverTimestamp(),
      deleted_by: uid,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    });
  },

  async getOrg(orgId){
    const db = firebase.firestore();
    const doc = await db.collection("organizaciones").doc(orgId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  // Chequeo de duplicado por campo normalizado, ignorando soft-deleted.
  async existsActiveByNorm(field, value){
    const db = firebase.firestore();
    const snap = await db.collection("organizaciones")
      .where(field, "==", value)
      .where("deleted", "==", false)
      .limit(1).get();
    return !snap.empty;
  },

  // Página ordenada por nombre, excluyendo soft-deleted.
  // Si `term`, busca por token (array-contains). Returns { docs, lastDoc, count }.
  async listOrgsPage({ term = "", onlyActive = false, cursorDoc = null, limit = 20 } = {}){
    const db = firebase.firestore();
    let q;
    if (term){
      q = db.collection("organizaciones")
        .where("searchTokens", "array-contains", term.toLowerCase())
        .where("deleted", "==", false)
        .limit(limit);
    } else {
      q = db.collection("organizaciones")
        .where("deleted", "==", false)
        .orderBy("nombre")
        .limit(limit);
    }
    if (onlyActive) q = q.where("activo", "==", true);
    if (cursorDoc) q = q.startAfter(cursorDoc);
    const snap = await q.get();
    return {
      docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
      count: snap.size,
    };
  },

  // Lista completa para el picker/autocomplete (cache-first, 500 por página).
  async getAllOrgs(){
    const db = firebase.firestore();
    const baseQ = db.collection("organizaciones").where("deleted", "==", false).orderBy("nombre");
    const PAGE = 500;
    let lastDoc = null;
    const results = [];
    while (true){
      let q = lastDoc ? baseQ.startAfter(lastDoc).limit(PAGE) : baseQ.limit(PAGE);
      let snap = await q.get({ source: "cache" });
      if (snap.empty) snap = await q.get();
      if (snap.empty) break;
      snap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < PAGE) break;
    }
    return results;
  },

  // Cuentas (clientes) que pertenecen a una organización. Excluye soft-deleted.
  async listCuentas(orgId){
    const db = firebase.firestore();
    const snap = await db.collection("clientes")
      .where("deleted", "==", false)
      .where("organizacionId", "==", orgId)
      .orderBy("nombre")
      .get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
};

window.OrganizacionesService = OrganizacionesService;
