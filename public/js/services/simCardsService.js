// Pool de SIM cards — colección `sim_cards`, un doc por SIM con el ICCID como
// ID del documento (dedup natural al importar). Estados: 'disponible' |
// 'asignado'. El operador viaja con el SIM: al asignar, el equipo hereda el
// operador del SIM.
const SimCardsService = {

  // ICCID normalizado: solo dígitos (quita espacios, guiones, etc.).
  normalizarSim(raw) {
    return (raw ?? '').toString().replace(/\D/g, '');
  },

  // ICCIDs reales son 18-20 dígitos, pero hay data legacy más corta; se acepta
  // un rango amplio para no rechazar SIMs que ya circulan en poc_devices.
  esSimValido(sim) {
    return /^[0-9]{10,22}$/.test(sim);
  },

  async getSim(simNumber) {
    const db = firebase.firestore();
    const doc = await db.collection('sim_cards').doc(simNumber).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  // Lista con filtros de igualdad (sin índice compuesto). Orden client-side.
  async listar({ estado = null, operador = null } = {}) {
    const db = firebase.firestore();
    let q = db.collection('sim_cards');
    if (estado)   q = q.where('estado', '==', estado);
    if (operador) q = q.where('operador', '==', operador);
    const snap = await q.get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.sim_number || '').localeCompare(b.sim_number || ''));
  },

  _autoria(user) {
    return {
      updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
      updated_by:       user?.uid   || null,
      updated_by_email: user?.email || null,
    };
  },

  // Alta manual de un SIM disponible. Falla si el SIM ya existe.
  async agregar({ sim_number, sim_phone = '', operador = '' }, user) {
    const sim = this.normalizarSim(sim_number);
    if (!this.esSimValido(sim)) { const e = new Error('SIM inválido'); e.code = 'sim-invalido'; throw e; }
    const db  = firebase.firestore();
    const ref = db.collection('sim_cards').doc(sim);
    const existente = await ref.get();
    if (existente.exists) { const e = new Error('El SIM ya está registrado'); e.code = 'sim-existe'; throw e; }
    await ref.set({
      sim_number: sim,
      sim_phone:  (sim_phone || '').toString().trim(),
      operador:   (operador  || '').toString().trim(),
      estado:     'disponible',
      origen:     'manual',
      asignado_a: null,
      liberado_de: null,
      created_at:       firebase.firestore.FieldValue.serverTimestamp(),
      creado_por_uid:   user?.uid   || null,
      creado_por_email: user?.email || null,
      ...this._autoria(user),
    });
    return sim;
  },

  // Import masivo (Excel). rows: [{sim_number, sim_phone, operador}].
  // Deduplica contra la colección: los ya registrados se saltan (no se pisan,
  // podrían estar asignados). Retorna { nuevos, existentes, invalidos }.
  async importar(rows, user, onProgress = null) {
    const db = firebase.firestore();
    const resultado = { nuevos: 0, existentes: 0, invalidos: 0 };
    const vistos = new Set();          // dedup dentro del propio archivo
    const validos = [];
    for (const r of rows || []) {
      const sim = this.normalizarSim(r.sim_number);
      if (!this.esSimValido(sim) || vistos.has(sim)) { resultado.invalidos++; continue; }
      vistos.add(sim);
      validos.push({
        sim_number: sim,
        sim_phone:  (r.sim_phone || '').toString().trim(),
        operador:   (r.operador  || '').toString().trim(),
      });
    }

    // Existencia en chunks de 10 vía documentId() in — 1 lectura por chunk.
    const existentes = new Set();
    for (let i = 0; i < validos.length; i += 10) {
      const ids = validos.slice(i, i + 10).map(v => v.sim_number);
      const snap = await db.collection('sim_cards')
        .where(firebase.firestore.FieldPath.documentId(), 'in', ids).get();
      snap.docs.forEach(d => existentes.add(d.id));
      if (onProgress) onProgress(Math.min(i + 10, validos.length), validos.length, 'verificando');
    }

    const nuevos = validos.filter(v => !existentes.has(v.sim_number));
    resultado.existentes = validos.length - nuevos.length;

    const CHUNK = 400;
    for (let i = 0; i < nuevos.length; i += CHUNK) {
      const batch = db.batch();
      for (const v of nuevos.slice(i, i + CHUNK)) {
        batch.set(db.collection('sim_cards').doc(v.sim_number), {
          ...v,
          estado:     'disponible',
          origen:     'excel',
          asignado_a: null,
          liberado_de: null,
          created_at:       firebase.firestore.FieldValue.serverTimestamp(),
          creado_por_uid:   user?.uid   || null,
          creado_por_email: user?.email || null,
          ...this._autoria(user),
        });
      }
      await batch.commit();
      resultado.nuevos += Math.min(CHUNK, nuevos.length - i);
      if (onProgress) onProgress(resultado.nuevos, nuevos.length, 'guardando');
    }
    return resultado;
  },

  // Devuelve un SIM al pool (equipo desactivado/eliminado). Upsert: si el doc
  // no existe se crea con origen 'liberado'; si existe se marca disponible
  // conservando su origen. `desde` = { device_id, serial, cliente_nombre }.
  async liberar({ sim_number, sim_phone = '', operador = '', desde = null }, user) {
    const sim = this.normalizarSim(sim_number);
    if (!this.esSimValido(sim)) { const e = new Error('SIM inválido'); e.code = 'sim-invalido'; throw e; }
    const db  = firebase.firestore();
    const ref = db.collection('sim_cards').doc(sim);
    const existente = await ref.get();
    if (existente.exists) {
      await ref.set({
        sim_phone:  (sim_phone || existente.data().sim_phone || '').toString().trim(),
        operador:   (operador  || existente.data().operador  || '').toString().trim(),
        estado:     'disponible',
        asignado_a: null,
        liberado_de: desde || null,
        ...this._autoria(user),
      }, { merge: true });
    } else {
      await ref.set({
        sim_number: sim,
        sim_phone:  (sim_phone || '').toString().trim(),
        operador:   (operador  || '').toString().trim(),
        estado:     'disponible',
        origen:     'liberado',
        asignado_a: null,
        liberado_de: desde || null,
        created_at:       firebase.firestore.FieldValue.serverTimestamp(),
        creado_por_uid:   user?.uid   || null,
        creado_por_email: user?.email || null,
        ...this._autoria(user),
      });
    }
    return sim;
  },

  // Asigna un SIM disponible a un equipo POC. Transacción: re-verifica que el
  // SIM siga disponible (dos usuarias no pueden asignar el mismo SIM) y escribe
  // SIM + equipo atómicamente. El equipo hereda sim_number/sim_phone/operador
  // del SIM. `device` = { id, serial, cliente_nombre }.
  // Lanza error con code 'sim-no-disponible' si otro lo tomó primero.
  async asignar(simNumber, device, user) {
    const sim = this.normalizarSim(simNumber);
    const db  = firebase.firestore();
    const simRef = db.collection('sim_cards').doc(sim);
    const devRef = db.collection('poc_devices').doc(device.id);
    return db.runTransaction(async tx => {
      const simSnap = await tx.get(simRef);
      if (!simSnap.exists || simSnap.data().estado !== 'disponible') {
        const e = new Error(`SIM ${sim} ya no está disponible`);
        e.code = 'sim-no-disponible';
        throw e;
      }
      const s = simSnap.data();
      tx.update(simRef, {
        estado: 'asignado',
        asignado_a: {
          device_id:      device.id,
          serial:         device.serial || '',
          cliente_nombre: device.cliente_nombre || '',
        },
        ...this._autoria(user),
      });
      tx.update(devRef, {
        sim_number: s.sim_number,
        sim_phone:  s.sim_phone || '',
        operador:   s.operador  || '',
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null,
      });
      return { sim_number: s.sim_number, sim_phone: s.sim_phone || '', operador: s.operador || '' };
    });
  },

  // Consistencia con los flujos manuales (modal de pegar, drawer): si un SIM
  // tecleado a mano existe en el pool como disponible, se marca asignado para
  // que no aparezca ofrecido dos veces. Best-effort: nunca lanza.
  async marcarAsignadoSiExiste(simNumber, device, user) {
    try {
      const sim = this.normalizarSim(simNumber);
      if (!this.esSimValido(sim)) return false;
      const db  = firebase.firestore();
      const ref = db.collection('sim_cards').doc(sim);
      const snap = await ref.get();
      if (!snap.exists || snap.data().estado !== 'disponible') return false;
      await ref.update({
        estado: 'asignado',
        asignado_a: {
          device_id:      device.id,
          serial:         device.serial || '',
          cliente_nombre: device.cliente_nombre || '',
        },
        ...this._autoria(user),
      });
      return true;
    } catch (e) {
      console.warn('marcarAsignadoSiExiste falló (no crítico):', e?.code || e);
      return false;
    }
  },

  // Hard-delete (solo admin según reglas) — para SIMs cargados por error.
  async eliminar(simNumber) {
    const db = firebase.firestore();
    return db.collection('sim_cards').doc(this.normalizarSim(simNumber)).delete();
  },

  // Editar teléfono/operador de un SIM (correcciones de captura).
  async actualizar(simNumber, { sim_phone, operador }, user) {
    const db = firebase.firestore();
    const fields = { ...this._autoria(user) };
    if (sim_phone !== undefined) fields.sim_phone = (sim_phone || '').toString().trim();
    if (operador  !== undefined) fields.operador  = (operador  || '').toString().trim();
    return db.collection('sim_cards').doc(this.normalizarSim(simNumber)).update(fields);
  },
};

window.SimCardsService = SimCardsService;
