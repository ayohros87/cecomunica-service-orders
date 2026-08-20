// Registro de equipos DESCARTADOS en control de calidad — colección
// `equipos_descartados`, un doc por unidad con el serial normalizado como ID
// (mismo patrón que equipos_pool y sim_cards: el dedup es natural y la
// consulta "¿este serial está descartado?" es UN get por doc-ID, sin índice).
//
// Por qué colección propia y no una bandera en equipos_pool:
//   1. `jefe_taller` NO está en puedeGestionarSeriales() (firestore.rules), así
//      que no puede escribir el pool desde el navegador — y es justamente quien
//      firma el QC. Meter el descarte en el pool obligaba a un trigger.
//   2. El descarte debe quedar registrado aunque el serial no tenga ficha en el
//      pool (equipo del cliente que nunca entró a bodega, serial mal transcrito
//      que igual hay que marcar). El pool solo admite `create` de admin/inventario.
//
// El descarte NUNCA se borra: revocarlo escribe `revocado: true` y deja la traza
// en `historial[]` (append-only). Así un descarte revocado por error sigue siendo
// auditable, y la alerta al teclear el serial deja de salir sin perder el rastro.
//
// Consumidores: SerialField (alerta al teclear un serial en Bodega o Taller),
// ordenes-qc.js (lo escribe al marcar "Equipo descartado") e
// inventario/descartados.html (el listado consultable).
const EquiposDescartadosService = {

  COL: 'equipos_descartados',

  // Misma normalización que el pool — es el ID del doc, así que tienen que
  // coincidir carácter por carácter o la alerta no encuentra el registro.
  normalizar(raw) {
    return typeof EquiposPoolService !== 'undefined'
      ? EquiposPoolService.normalizarSerial(raw)
      : (raw ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  esSerialValido(norm) {
    return typeof EquiposPoolService !== 'undefined'
      ? EquiposPoolService.esSerialValido(norm)
      : /^[A-Z0-9]{3,30}$/.test(norm) && /\d/.test(norm);
  },

  _col() { return firebase.firestore().collection(this.COL); },

  _autoria() {
    const u = firebase.auth().currentUser;
    return { por_uid: u?.uid || '', por_email: u?.email || '' };
  },

  /**
   * Registra (o re-registra) un serial como descartado. Idempotente: si el
   * serial ya estaba descartado se refresca la referencia y se apila la nueva
   * entrada en el historial, no se duplica el doc.
   *
   * Se llama desde el QC por equipo (ordenes-qc.js). `motivo` es texto libre
   * del revisor — el checklist marcado va en `checklist` para que el listado
   * pueda decir POR QUÉ se descartó sin abrir la orden.
   *
   * @param {Object} p
   * @param {string} p.serial       - serial tal como se tecleó (se normaliza)
   * @param {string} [p.modelo]     - etiqueta del modelo, para el listado
   * @param {string} [p.modelo_id]
   * @param {string} [p.orden_id]   - orden en cuyo QC se descartó
   * @param {string} [p.equipo_id]  - id del equipo dentro de orden.equipos[]
   * @param {string} [p.cliente]    - nombre del cliente de la orden
   * @param {string} [p.motivo]     - observación del revisor
   * @param {Object} [p.checklist]  - checklist del equipo en esa pasada de QC
   * @returns {Promise<string|null>} serial normalizado, o null si no era serial
   */
  async registrar({ serial, modelo = '', modelo_id = '', orden_id = '',
                    equipo_id = '', cliente = '', motivo = '', checklist = null } = {}) {
    const norm = this.normalizar(serial);
    // Sin serial válido no hay a qué colgar el descarte. No es un error: el
    // campo serial se usa de cajón de sastre (consolas, cargadores) igual que
    // en el pool — el descarte igual queda en qc.por_equipo de la orden.
    if (!norm || !this.esSerialValido(norm)) return null;

    const ref = this._col().doc(norm);
    const entrada = {
      fecha_iso: new Date().toISOString(),   // serverTimestamp no vale en arrayUnion
      orden_id, equipo_id, motivo,
      checklist: checklist || {},
      ...this._autoria()
    };

    await ref.set({
      serial_norm: norm,
      serial: String(serial ?? '').trim(),
      modelo, modelo_id, cliente,
      orden_id, equipo_id, motivo,
      checklist: checklist || {},
      revocado: false,
      // Se limpian los campos de una revocación anterior: si el serial se
      // vuelve a descartar, el registro tiene que quedar vigente otra vez.
      revocado_motivo: '',
      revocado_por_email: '',
      descartado_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion({ tipo: 'descarte', ...entrada }),
      ...this._autoria()
    }, { merge: true });

    this._invalidar(norm);
    return norm;
  },

  /**
   * Revoca un descarte (se descartó por error, o el equipo se recuperó). No
   * borra: deja `revocado: true` y apila la traza. La alerta deja de salir.
   */
  async revocar(serialNorm, motivo = '') {
    const norm = this.normalizar(serialNorm);
    if (!norm) throw new Error('Serial inválido');
    const a = this._autoria();
    await this._col().doc(norm).update({
      revocado: true,
      revocado_motivo: motivo,
      revocado_por_email: a.por_email,
      revocado_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion({
        tipo: 'revocacion', motivo, fecha_iso: new Date().toISOString(), ...a
      })
    });
    this._invalidar(norm);
  },

  // ---- Consulta -----------------------------------------------------------

  // Caché corta compartida: SerialField consulta en cada blur y el mismo serial
  // se teclea varias veces por sesión (batch de seriales, correcciones).
  _cache: new Map(),   // norm → { doc, at }
  _TTL_MS: 60 * 1000,

  _invalidar(norm) { this._cache.delete(norm); },

  /**
   * ¿Este serial está descartado y vigente? Devuelve el doc o null.
   * Un get por doc-ID: sin índice y sin coste de query.
   */
  async buscar(serial) {
    const norm = this.normalizar(serial);
    if (!norm || !this.esSerialValido(norm)) return null;

    const hit = this._cache.get(norm);
    if (hit && Date.now() - hit.at < this._TTL_MS) return hit.doc;

    let doc = null;
    try {
      const snap = await this._col().doc(norm).get();
      // Un registro revocado se trata como inexistente para la alerta; el
      // listado sí lo muestra (con su traza) si se pide explícitamente.
      if (snap.exists) {
        const d = { id: snap.id, ...snap.data() };
        doc = d.revocado === true ? null : d;
      }
    } catch (e) {
      // Falla abierto a propósito: un problema de red no puede dejar el campo
      // de serial inutilizable. Se avisa en consola y se sigue.
      console.warn('[EquiposDescartados] lookup falló:', e);
      return null;
    }
    this._cache.set(norm, { doc, at: Date.now() });
    return doc;
  },

  /**
   * Listado consultable. `incluirRevocados` los trae para auditoría.
   * Ordenado por fecha de descarte, más reciente primero.
   */
  async listar({ incluirRevocados = false, limite = 500 } = {}) {
    let q = this._col().orderBy('descartado_at', 'desc').limit(limite);
    const snap = await q.get();
    const rows = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (!incluirRevocados && data.revocado === true) return;
      rows.push(data);
    });
    return rows;
  },
};

window.EquiposDescartadosService = EquiposDescartadosService;
