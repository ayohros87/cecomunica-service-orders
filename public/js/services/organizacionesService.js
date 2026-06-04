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

  // ── Membresía (escriben en `clientes`, vía ClientesService.batchUpdate) ───
  // Nota: al asignar/renombrar se hace arrayUnion de los tokens de la org para
  // que el cliente sea buscable por el nombre de su matriz. Al quitar no se
  // podan tokens (queda buscable por el nombre antiguo; impacto menor).

  // Asigna una o varias cuentas a una organización.
  async asignarCuentas(orgId, clienteIds){
    if (!clienteIds || !clienteIds.length) return { affected: 0 };
    const org = await this.getOrg(orgId);
    if (!org) throw new Error("Organización no encontrada");
    const toks = _orgTokens(org.nombre);
    await ClientesService.batchUpdate(clienteIds, {
      organizacionId: orgId,
      organizacion_nombre: org.nombre,
      organizacion_norm: org.nombre_norm,
      searchTokens: firebase.firestore.FieldValue.arrayUnion(...toks),
    });
    return { affected: clienteIds.length };
  },

  // Quita una o varias cuentas de su organización (las deja sueltas).
  async quitarCuentas(clienteIds){
    if (!clienteIds || !clienteIds.length) return { affected: 0 };
    await ClientesService.batchUpdate(clienteIds, {
      organizacionId: "",
      organizacion_nombre: "",
      organizacion_norm: "",
    });
    return { affected: clienteIds.length };
  },

  // Renombra la organización y re-sincroniza el nombre denormalizado en sus cuentas.
  async renombrar(orgId, nuevoNombre){
    const org = await this.getOrg(orgId);
    if (!org) throw new Error("Organización no encontrada");
    const nombre = (nuevoNombre || "").trim();
    if (!nombre) throw new Error("Nombre vacío");
    const nombre_norm = _orgNorm(nombre);
    await this.updateOrg(orgId, {
      nombre, nombre_norm,
      searchTokens: this.buildSearchTokens({ nombre, ruc: org.ruc }),
    });
    const cuentas = await this.listCuentas(orgId);
    if (cuentas.length){
      await ClientesService.batchUpdate(cuentas.map(c => c.id), {
        organizacion_nombre: nombre,
        organizacion_norm: nombre_norm,
        searchTokens: firebase.firestore.FieldValue.arrayUnion(..._orgTokens(nombre)),
      });
    }
    return { affected: cuentas.length };
  },

  // Fusiona organizaciones origen en una destino: reasigna sus cuentas y
  // hace soft-delete de las origen.
  async fusionar(sourceIds, targetId){
    const target = await this.getOrg(targetId);
    if (!target) throw new Error("Organización destino no encontrada");
    const toks = _orgTokens(target.nombre);
    let affected = 0;
    for (const sid of (sourceIds || [])){
      if (!sid || sid === targetId) continue;
      const cuentas = await this.listCuentas(sid);
      if (cuentas.length){
        await ClientesService.batchUpdate(cuentas.map(c => c.id), {
          organizacionId: targetId,
          organizacion_nombre: target.nombre,
          organizacion_norm: target.nombre_norm,
          searchTokens: firebase.firestore.FieldValue.arrayUnion(...toks),
        });
        affected += cuentas.length;
      }
      await this.softDeleteOrg(sid);
    }
    return { affected };
  },

  // Soft-delete de una organización, dejando sus cuentas sueltas.
  async eliminarConCuentas(orgId){
    const cuentas = await this.listCuentas(orgId);
    if (cuentas.length) await this.quitarCuentas(cuentas.map(c => c.id));
    await this.softDeleteOrg(orgId);
    return { affected: cuentas.length };
  },
};

window.OrganizacionesService = OrganizacionesService;
