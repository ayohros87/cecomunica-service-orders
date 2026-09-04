// Registro de equipos con CONDICIÓN PARTICULAR — colección `equipos_condiciones`,
// un doc por unidad con el serial normalizado como ID (mismo patrón que
// equipos_pool y equipos_descartados: el dedup es natural y "¿este serial tiene
// una condición?" es UN get por doc-ID, sin índice).
//
// Petición de Solangel (2026-09-04): un radio que funciona pero tiene una
// limitación que el taller no puede resolver (auricular dañado que pide
// microsoldadura, por ejemplo). No es un descarte —el radio sirve para un
// cliente que no use esa función— pero la limitación tiene que acompañar al
// SERIAL, no a la orden: quien lo revise al salir de taller, quien lo asigne a
// un contrato y el técnico que lo vuelva a recibir tienen que verla sin
// volver a descifrar el mismo problema.
//
// Por qué colección propia y no una bandera en equipos_pool: las mismas dos
// razones que en equipos_descartados —quien la escribe (técnico, jefe_taller)
// no puede escribir el pool, y la condición debe quedar aunque el serial no
// tenga ficha (equipo del cliente que nunca entró a bodega).
//
// La condición NUNCA se borra: cuando el radio se repara de verdad se
// "levanta" (`vigente: false`) y la traza queda en `historial[]` (append-only).
// Un serial puede volver a recibir una condición después de levantada.
//
// Consumidores: SerialField (chip amarillo al teclear el serial en cualquier
// campo), ordenes-qc.js (la escribe al firmar "aprobado con condición" y la
// muestra en la tarjeta del equipo), ordenes-equipos.js (la muestra al abrir
// la intervención y la marca desde el modal), ordenes-flujo.js (la registra
// al cerrar una ENTRADA), asignador-seriales.js (aviso antes de asignar),
// equipo-ficha.js (sección con historial y "levantar") e
// inventario/condiciones.html (el listado consultable).
const EquiposCondicionesService = {

  COL: 'equipos_condiciones',

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

  // Texto corto para chips y badges: la primera línea, recortada.
  resumen(condicion, max = 60) {
    const t = String(condicion || '').trim().split(/\r?\n/)[0].trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  },

  /**
   * Registra (o re-registra) una condición sobre un serial. Idempotente: si
   * el serial ya tenía condición se reemplaza el texto vigente y se apila la
   * nueva entrada en el historial, no se duplica el doc. Si la condición
   * vigente es la misma (mismo texto), no escribe nada — la firma del QC pasa
   * por aquí cada vez que el radio sale de taller.
   *
   * @param {Object} p
   * @param {string} p.serial      - serial tal como se tecleó (se normaliza)
   * @param {string} p.condicion   - la condición, en palabras del técnico
   * @param {string} [p.modelo]
   * @param {string} [p.modelo_id]
   * @param {string} [p.orden_id]  - orden en la que se detectó
   * @param {string} [p.equipo_id] - id del equipo dentro de orden.equipos[]
   * @param {string} [p.cliente]   - nombre del cliente de la orden
   * @param {string} [p.origen]    - 'qc' | 'entrada' | 'intervencion' | 'ficha'
   * @returns {Promise<string|null>} serial normalizado, o null si no era serial
   *   o la condición venía vacía.
   */
  async registrar({ serial, condicion = '', modelo = '', modelo_id = '', orden_id = '',
                    equipo_id = '', cliente = '', origen = '' } = {}) {
    const norm = this.normalizar(serial);
    const texto = String(condicion || '').trim();
    // Sin serial válido no hay a qué colgar la condición; sin texto no hay
    // condición. Ninguno es error: el campo serial se usa de cajón de sastre
    // (consolas, cargadores) igual que en el pool.
    if (!norm || !this.esSerialValido(norm) || !texto) return null;

    const ref = this._col().doc(norm);
    const previo = await this.buscar(norm);
    if (previo && previo.vigente !== false && String(previo.condicion || '').trim() === texto) {
      return norm;   // ya está registrada tal cual
    }

    const entrada = {
      tipo: 'registro',
      fecha_iso: new Date().toISOString(),   // serverTimestamp no vale en arrayUnion
      condicion: texto, orden_id, equipo_id, origen,
      ...this._autoria()
    };

    await ref.set({
      serial_norm: norm,
      serial: String(serial ?? '').trim(),
      modelo, modelo_id, cliente,
      condicion: texto,
      orden_id, equipo_id, origen,
      vigente: true,
      // Se limpian los campos de un levantamiento anterior: si el serial
      // vuelve a tener condición, el registro tiene que quedar vigente otra vez.
      levantado_motivo: '',
      levantado_por_email: '',
      registrado_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion(entrada),
      ...this._autoria()
    }, { merge: true });

    this._invalidar(norm);
    return norm;
  },

  /**
   * Levanta la condición (el radio se reparó, o se registró por error). No
   * borra: deja `vigente: false` y apila la traza. La alerta deja de salir.
   */
  async levantar(serialNorm, motivo = '') {
    const norm = this.normalizar(serialNorm);
    if (!norm) throw new Error('Serial inválido');
    const a = this._autoria();
    await this._col().doc(norm).update({
      vigente: false,
      levantado_motivo: motivo,
      levantado_por_email: a.por_email,
      levantado_at: firebase.firestore.FieldValue.serverTimestamp(),
      historial: firebase.firestore.FieldValue.arrayUnion({
        tipo: 'levantamiento', motivo, fecha_iso: new Date().toISOString(), ...a
      })
    });
    this._invalidar(norm);
  },

  // ---- Consulta -----------------------------------------------------------

  // Caché corta compartida: SerialField consulta en cada blur y las tablas de
  // órdenes re-decoran en cada snapshot.
  _cache: new Map(),   // norm → { doc, at }
  _TTL_MS: 60 * 1000,

  _invalidar(norm) { this._cache.delete(norm); },

  /**
   * ¿Este serial tiene una condición VIGENTE? Devuelve el doc o null.
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
      // Una condición levantada se trata como inexistente para la alerta; el
      // listado y la ficha sí la muestran (con su traza) si se pide.
      if (snap.exists) {
        const d = { id: snap.id, ...snap.data() };
        doc = d.vigente === false ? null : d;
      }
    } catch (e) {
      // Falla abierto a propósito: un problema de red no puede dejar el campo
      // de serial inutilizable. Se avisa en consola y se sigue.
      console.warn('[EquiposCondiciones] lookup falló:', e);
      return null;
    }
    this._cache.set(norm, { doc, at: Date.now() });
    return doc;
  },

  /**
   * El doc completo, vigente o no — para la ficha del equipo y el historial.
   */
  async buscarCompleto(serial) {
    const norm = this.normalizar(serial);
    if (!norm || !this.esSerialValido(norm)) return null;
    try {
      const snap = await this._col().doc(norm).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
      console.warn('[EquiposCondiciones] lookup falló:', e);
      return null;
    }
  },

  /**
   * Varios seriales de una vez (tabla de equipos de una orden, tarjetas del
   * QC). Devuelve Map(serial_norm → doc vigente). Los inválidos no se
   * consultan; los que fallan quedan fuera.
   */
  async buscarVarios(seriales) {
    const out = new Map();
    const norms = [...new Set((seriales || []).map(s => this.normalizar(s)).filter(n => n && this.esSerialValido(n)))];
    const docs = await Promise.all(norms.map(n => this.buscar(n)));
    docs.forEach((d, i) => { if (d) out.set(norms[i], d); });
    return out;
  },

  /**
   * Listado consultable. `incluirLevantadas` las trae para auditoría.
   * Ordenado por fecha de registro, más reciente primero.
   */
  async listar({ incluirLevantadas = false, limite = 500 } = {}) {
    const snap = await this._col().orderBy('registrado_at', 'desc').limit(limite).get();
    const rows = [];
    snap.forEach(d => {
      const data = { id: d.id, ...d.data() };
      if (!incluirLevantadas && data.vigente === false) return;
      rows.push(data);
    });
    return rows;
  },
};

window.EquiposCondicionesService = EquiposCondicionesService;
