const PocService = {

  // unit_id se guarda SIEMPRE como string (candado en rules); unit_id_num es su
  // espejo numérico para ordenar (Firestore ordena strings alfabéticamente y
  // separa por tipo, así que "999" > "274206" y los números viejos quedaban en
  // un bloque aparte). null cuando el unit_id no es numérico (ej. CONSOLA_DSI).
  // Todo escritor de unit_id DEBE escribir ambos campos.
  unitIdNum(v) {
    const s = (v ?? '').toString().trim();
    return /^\d+$/.test(s) ? parseInt(s, 10) : null;
  },

  // Los orderBy de unit_id van contra el espejo numérico. Los docs sin el campo
  // no aparecerían en el orderBy — el backfill 2026-07-21 lo estampó en toda la
  // colección y los escritores lo mantienen.
  _sortFieldFor(field) {
    return field === 'unit_id' ? 'unit_id_num' : field;
  },

  async getPocDevices() {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getPocDevice(id, opts) {
    const db = firebase.firestore();
    const doc = await db.collection('poc_devices').doc(id).get(opts);
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  // Red de seguridad para TODO caller: unit_id sale string y unit_id_num
  // siempre acompaña (en create aunque no venga unit_id — un doc sin el campo
  // no aparecería en el orderBy de la lista). Rules rechazan tipos inválidos.
  _conUnitIdNormalizado(obj, esCreate) {
    const out = { ...obj };
    if ('unit_id' in out) {
      out.unit_id = (out.unit_id ?? '').toString().trim();
      out.unit_id_num = this.unitIdNum(out.unit_id);
    } else if (esCreate) {
      out.unit_id_num = null;
    }
    return out;
  },

  async addPocDevice(data) {
    const db = firebase.firestore();
    return db.collection('poc_devices').add(this._conUnitIdNormalizado(data, true));
  },

  // Alta de un lote con WriteBatch en tandas de 400 (tope de Firestore: 500
  // escrituras por batch). Un lote normal (<400) queda TODO o NADA; antes
  // eran N .add() en serie y un fallo a la mitad dejaba un lote parcial
  // (auditoría UX 2026-09-28, 4.7 #8). `onProgress(hechos, total)` se llama
  // antes de cada tanda y al final. Devuelve los ids creados; si una tanda
  // falla, el error lleva `guardados` = cuántos quedaron escritos.
  async addPocDevicesBatch(items, { onProgress = null, tanda = 400 } = {}) {
    const db = firebase.firestore();
    const col = db.collection('poc_devices');
    const ids = [];
    const total = (items || []).length;
    for (let i = 0; i < total; i += tanda) {
      if (onProgress) onProgress(i, total);
      const batch = db.batch();
      const idsTanda = [];
      items.slice(i, i + tanda).forEach(data => {
        const ref = col.doc();
        batch.set(ref, this._conUnitIdNormalizado(data, true));
        idsTanda.push(ref.id);
      });
      try {
        await batch.commit();
      } catch (e) {
        e.guardados = ids.length;
        throw e;
      }
      ids.push(...idsTanda);
    }
    if (onProgress) onProgress(total, total);
    return ids;
  },

  // ── Lotes preparados por ventas (traspaso vendedor → recepción) ─────────
  // Antes el vendedor descargaba un JSON y lo mandaba por correo o WhatsApp;
  // ahora el lote viaja dentro del app (auditoría UX 2026-09-28, 4.7 #9).
  // `filas` es EXACTAMENTE el arreglo del JSON de siempre: recepción lo carga
  // por la misma función que procesa el archivo, así no hay dos formatos.
  LOTE_PREP_COL: 'poc_lotes_preparados',
  // Techo de un doc de Firestore: 1 MiB. Se deja margen porque el JSON en
  // UTF-8 es solo una aproximación del tamaño real que cuenta Firestore.
  LOTE_PREP_MAX_BYTES: 900 * 1024,

  _bytesAprox(obj) {
    const s = JSON.stringify(obj);
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3;
  },

  // Doc base del lote (sin id, sin timestamps). Puro: lo usan la página y las
  // pruebas para asegurar que lo guardado y lo descargado son lo mismo.
  armarLotePreparado(filas, { modelo = '', grupos = [], notas = '', user = null, nombre = '' } = {}) {
    const f = Array.isArray(filas) ? filas : [];
    return {
      cliente_id:        f[0]?.cliente_id || null,
      cliente_nombre:    f[0]?.cliente_nombre || '',
      filas:             f,
      total:             f.length,
      modelo:            modelo || '',
      grupos:            Array.isArray(grupos) ? grupos.slice() : [],
      gps:               f.filter(x => x && x.gps).length,
      notas:             (notas || '').toString().trim(),
      estado:            'pendiente',
      creado_por_uid:    user?.uid || null,
      creado_por_email:  user?.email || null,
      creado_por_nombre: nombre || user?.email || '',
    };
  },

  // Parte el lote en varios docs si no cabe en uno (un lote de miles de
  // equipos). Cada parte es un lote pendiente propio "parte i de n": recepción
  // las carga una por una, igual que cargaría varios archivos.
  partirLotePreparado(base, { maxBytes = this.LOTE_PREP_MAX_BYTES } = {}) {
    const filas = base.filas || [];
    const vacio = this._bytesAprox({ ...base, filas: [], codigo: 'XXXXXX', envio_id: 'x'.repeat(20), parte: 99, partes: 99 }) + 64;
    const grupos = [];
    let actual = [], tam = vacio;
    for (const fila of filas) {
      // +32: el id que la fila suma a batch_ref cuando recepción la carga.
      const b = this._bytesAprox(fila) + 1 + 32;
      if (vacio + b > maxBytes) throw new Error('Una fila del lote es demasiado grande para guardarse.');
      if (actual.length && tam + b > maxBytes) { grupos.push(actual); actual = []; tam = vacio; }
      actual.push(fila); tam += b;
    }
    if (actual.length) grupos.push(actual);
    return grupos.map((fs, i) => ({
      ...base, filas: fs, total: fs.length, gps: fs.filter(x => x && x.gps).length,
      parte: i + 1, partes: grupos.length,
    }));
  },

  // Escribe todas las partes en un solo WriteBatch (todo o nada). Devuelve
  // [{ id, codigo, parte, partes, total }]. `codigo` es el "Lote #…" que ven
  // vendedor y recepción (los 6 primeros del id: corto y sin contador).
  async enviarLotePreparado(partes) {
    const db = firebase.firestore();
    const col = db.collection(this.LOTE_PREP_COL);
    const refs = partes.map(() => col.doc());
    const envioId = refs[0]?.id || null;
    const batch = db.batch();
    const out = [];
    partes.forEach((p, i) => {
      const codigo = refs[i].id.slice(0, 6).toUpperCase();
      batch.set(refs[i], {
        ...p, codigo, envio_id: envioId, estado: 'pendiente',
        creado_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
      out.push({ id: refs[i].id, codigo, parte: p.parte, partes: p.partes, total: p.total });
    });
    await batch.commit();
    return out;
  },

  async getLotePreparado(id, opts) {
    const doc = await firebase.firestore().collection(this.LOTE_PREP_COL).doc(id).get(opts);
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  _porCreadoDesc(a, b) {
    return (b.creado_at?.toMillis?.() || 0) - (a.creado_at?.toMillis?.() || 0);
  },

  // Pendientes de cargar (recepción/admin). Sin orderBy: la cola se vacía al
  // cargar, así que es corta y se ordena aquí sin índice compuesto.
  async getLotesPendientes({ limit = 100 } = {}) {
    const snap = await firebase.firestore().collection(this.LOTE_PREP_COL)
      .where('estado', '==', 'pendiente').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(this._porCreadoDesc);
  },

  // Lotes del vendedor, los más recientes. Con el índice compuesto
  // (creado_por_uid ASC, creado_at DESC) pide solo `limit`; sin él (índice aún
  // no desplegado) cae a traer los suyos y ordenar aquí.
  async getMisLotesPreparados(uid, { limit = 20 } = {}) {
    const col = firebase.firestore().collection(this.LOTE_PREP_COL);
    let docs;
    try {
      const snap = await col.where('creado_por_uid', '==', uid).orderBy('creado_at', 'desc').limit(limit).get();
      docs = snap.docs;
    } catch (e) {
      if (e?.code !== 'failed-precondition') throw e;
      const snap = await col.where('creado_por_uid', '==', uid).get();
      docs = snap.docs;
    }
    return docs.map(d => ({ id: d.id, ...d.data() })).sort(this._porCreadoDesc).slice(0, limit);
  },

  _quien(user, nombre) {
    return { uid: user?.uid || null, email: user?.email || null, nombre: nombre || user?.email || '' };
  },

  // Recepción creó los equipos: el lote pasa a 'cargado' con los ids creados.
  // Las rules solo dejan pasar de 'pendiente', así que un segundo intento (otra
  // pestaña, otra recepcionista) falla en vez de pisar el primero.
  async marcarLotePreparadoCargado(id, deviceIds, { user = null, nombre = '' } = {}) {
    return firebase.firestore().collection(this.LOTE_PREP_COL).doc(id).update({
      estado:      'cargado',
      cargado_por: this._quien(user, nombre),
      cargado_at:  firebase.firestore.FieldValue.serverTimestamp(),
      batch_ref:   Array.isArray(deviceIds) ? deviceIds : [],
    });
  },

  // Descartar no borra: el vendedor ve el motivo en "Mis lotes enviados".
  async descartarLotePreparado(id, motivo, { user = null, nombre = '' } = {}) {
    return firebase.firestore().collection(this.LOTE_PREP_COL).doc(id).update({
      estado:          'descartado',
      motivo_descarte: (motivo || '').toString().trim(),
      descartado_por:  this._quien(user, nombre),
      descartado_at:   firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async updatePocDevice(id, fields) {
    const db = firebase.firestore();
    return db.collection('poc_devices').doc(id).update(this._conUnitIdNormalizado(fields, false));
  },

  // Borrado y restauración SIEMPRE dejan rastro en poc_logs. Era la única
  // operación de POC sin log: cuando "Corregir estado → En bodega" desactivó el
  // device equivocado (RADIO 3 de ERICK REYES, 2026-07-31) la auditoría no tenía
  // dónde verlo y hubo que reconstruirlo por los movimientos del pool. `antes`
  // es el doc tal como lo tenía la pantalla; `origen` dice qué flujo lo borró.
  async softDeletePocDevice(id, { antes = null, user = null, origen = 'poc' } = {}) {
    const db = firebase.firestore();
    await db.collection('poc_devices').doc(id).update({
      deleted:          true,
      updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
      updated_by:       user?.uid   || null,
      updated_by_email: user?.email || null,
    });
    this._logBorrado(id, antes, user, origen, true);
  },

  async restorePocDevice(id, { antes = null, user = null, origen = 'poc' } = {}) {
    const db = firebase.firestore();
    await db.collection('poc_devices').doc(id).update({
      deleted:          false,
      updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
      updated_by:       user?.uid   || null,
      updated_by_email: user?.email || null,
    });
    this._logBorrado(id, antes, user, origen, false);
  },

  // Best-effort: un log que falle no debe tumbar el borrado (mismo criterio que
  // PocEdit.guardar). `accion` distingue estas entradas de las ediciones, que
  // no traen el campo.
  _logBorrado(id, antes, user, origen, borrado) {
    this.addLog({
      equipo_id: id,
      fecha:     firebase.firestore.FieldValue.serverTimestamp(),
      usuario:   user?.email || null,
      accion:    borrado ? 'eliminar' : 'restaurar',
      origen,
      cambios:   { antes: antes || {}, despues: { deleted: borrado } },
    }).catch(e => console.warn('poc_log write failed (non-critical):', e));
  },

  async addLog(data) {
    const db = firebase.firestore();
    return db.collection('poc_logs').add(data);
  },

  // FieldValue sentinels (delete/serverTimestamp) no pueden ir ANIDADOS dentro
  // de un .add()/.set() — este helper limpia un payload de update antes de
  // embeberlo en un poc_log (cambios.antes/despues). Única definición; usada
  // por poc-edit, poc-bulk y poc-sim-liberar.
  stripSentinels(obj) {
    const FV = firebase.firestore.FieldValue;
    return Object.fromEntries(
      Object.entries(obj || {}).filter(([, v]) => !(v instanceof FV))
    );
  },

  async findByField(field, value) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').where(field, '==', value).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Query devices by client. Cuando se proveen AMBOS clienteId y clienteNombre,
  // corre las DOS queries y combina los resultados (dedup por docId) — los
  // equipos legacy escriben solo `cliente` (string) sin `cliente_id`, así que
  // sin esto faltarían equipos cuando se llama por id pero hay nombre legacy.
  async getByCliente({ clienteId = null, clienteNombre = null, fresh = false } = {}) {
    if (!clienteId && !clienteNombre) return [];
    const db = firebase.firestore();
    const found = new Map();
    // `fresh` salta la caché y lee del servidor — necesario en herramientas
    // admin que deben ver TODOS los equipos (la caché del navegador puede tener
    // solo las páginas cargadas en la lista PoC y devolver un subconjunto).
    const runQuery = async (field, value) => {
      const base = db.collection('poc_devices').where(field, '==', value);
      let snap = fresh ? await base.get() : await base.get({ source: 'cache' });
      if (!fresh && snap.empty) snap = await base.get();
      snap.docs.forEach(d => { if (!found.has(d.id)) found.set(d.id, { id: d.id, ...d.data() }); });
    };
    const tasks = [];
    if (clienteId)     tasks.push(runQuery('cliente_id', clienteId));
    if (clienteNombre) tasks.push(runQuery('cliente',    clienteNombre));
    await Promise.all(tasks);
    return Array.from(found.values());
  },

  // ── Configuración del radio que SALE (reemplazos) ───────────────────────
  // De dónde saca el lote el nombre, los grupos y el GPS de un reemplazo sin
  // que nadie tenga que armar otro JSON: de la ficha POC del radio que se está
  // sustituyendo. El dato ya está escrito —el saliente lleva meses trabajando
  // con ese nombre y esos grupos— y es exactamente lo que hay que copiar en el
  // radio nuevo: la OS de programación se lo pide al técnico con esas palabras
  // ("REEMPLAZA al serial X: copiar su configuración").
  //
  // Se busca EN MEMORIA sobre las fichas del cliente, no con
  // where('serial','==',…): `poc_devices` no tiene `serial_norm`, así que esa
  // query es exacta y un guión o una minúscula la deja en cero (el mismo hueco
  // que pocCierre tapa siguiendo `poc_device_id`). Una sola lectura del cliente
  // —la que el lote ya hace para validar Unit IDs— resuelve todos los
  // salientes del lote de un golpe.
  //
  // Ficha VIVA primero. Si el saliente ya se devolvió, su ficha está cerrada
  // (la devolución la cierra sola) y sirve igual —el nombre y los grupos siguen
  // ahí—, pero se marca `cerrada` para que la pantalla lo diga en vez de
  // presentarlo como dato fresco.
  //
  // Devuelve Map Serial.clave(saliente) → { radio_name, grupos, gps, unit_id,
  //   sim_number, serial, ficha_id, cerrada, ambigua, fecha }.
  // NO devuelve modelo: el modelo del radio que ENTRA lo manda el contrato o la
  // gestión, y un reemplazo bien puede traer otro modelo.
  // Tampoco es fuente de Unit ID ni de SIM (Alberto, 2026-09-10): el lote nuevo
  // asigna su propio Unit ID consecutivo y el SIM puede cambiar. Van en el
  // resultado solo como referencia para mostrar, nunca para copiar.
  async configDelSaliente({ clienteId = null, clienteNombre = null, salientes = [], fresh = false } = {}) {
    const claves = new Set((salientes || []).map(s => Serial.clave(s)).filter(Boolean));
    if (!claves.size) return new Map();

    const fichas = await this.getByCliente({ clienteId, clienteNombre, fresh });
    const porClave = new Map();
    for (const f of fichas) {
      const k = Serial.clave(f.serial);
      if (k && claves.has(k)) {
        if (!porClave.has(k)) porClave.set(k, []);
        porClave.get(k).push(f);
      }
    }

    const ms = (f) => f.created_at?.toMillis?.() ?? 0;
    const salida = new Map();
    for (const [k, lista] of porClave) {
      // Vivas de la más nueva a la más vieja; si no queda ninguna viva, se cae
      // a las cerradas con el mismo criterio (la última que trabajó).
      const vivas = lista.filter(f => f.deleted !== true).sort((a, b) => ms(b) - ms(a));
      const f = (vivas.length ? vivas : lista.slice().sort((a, b) => ms(b) - ms(a)))[0];
      if (!f) continue;
      salida.set(k, {
        radio_name: (f.radio_name || '').toString().trim(),
        grupos: Array.isArray(f.grupos) ? f.grupos.slice() : [],
        gps: f.gps === true,
        unit_id: (f.unit_id ?? '').toString().trim(),
        sim_number: (f.sim_number || '').toString().trim(),
        serial: (f.serial || '').toString().trim(),
        ficha_id: f.id,
        cerrada: !vivas.length,
        // Dato sucio anterior al candado (817 seriales con más de una ficha
        // viva al 2026-09-09): se toma la más reciente y la pantalla avisa.
        ambigua: vivas.length > 1,
        fecha: f.created_at?.toDate?.() || null,
      });
    }
    return salida;
  },

  // Returns identifiers de clientes que tienen al menos un device no eliminado
  // con al menos un grupo + (opcional) los grupos crudos agrupados por cliente
  // para análisis de duplicados desde la página. Una sola lectura cache-first
  // de poc_devices — sirve tanto para filtrar la lista como para el scan de
  // duplicados (no se duplica el read).
  //
  // Retorna:
  //   { ids: Set<clienteId>, nombres: Set<clienteNombre>,
  //     gruposPorId: Map<clienteId, Set<grupoRaw>>,
  //     gruposPorNombre: Map<clienteNombre, Set<grupoRaw>> }
  //
  // Los Sets de grupos dedupan por forma cruda (case-sensitive trimmed) —
  // las helpers de gruposAnalisis hacen su propia normalización.
  async getClientesConGrupos({ fresh = false } = {}) {
    const db = firebase.firestore();
    let snap = fresh
      ? await db.collection('poc_devices').get()
      : await db.collection('poc_devices').get({ source: 'cache' });
    if (!fresh && snap.empty) snap = await db.collection('poc_devices').get();
    const ids = new Set();
    const nombres = new Set();
    const gruposPorId = new Map();
    const gruposPorNombre = new Map();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.deleted === true) return;
      const grupos = (Array.isArray(d.grupos) ? d.grupos : [])
        .map(g => (g || '').toString().trim())
        .filter(Boolean);
      if (!grupos.length) return;
      if (d.cliente_id) {
        ids.add(d.cliente_id);
        if (!gruposPorId.has(d.cliente_id)) gruposPorId.set(d.cliente_id, new Set());
        const set = gruposPorId.get(d.cliente_id);
        for (const g of grupos) set.add(g);
      }
      if (d.cliente) {
        nombres.add(d.cliente);
        if (!gruposPorNombre.has(d.cliente)) gruposPorNombre.set(d.cliente, new Set());
        const set = gruposPorNombre.get(d.cliente);
        for (const g of grupos) set.add(g);
      }
    });
    return { ids, nombres, gruposPorId, gruposPorNombre };
  },

  async getRecent(limit = 5) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').orderBy('created_at', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Agrupa los equipos más recientes por contrato para el menú "Contratos
  // recientes" (selección de un batch completo sin marcar uno por uno). Lee una
  // ventana acotada de los devices más nuevos (created_at desc) y devuelve los
  // contratos distintos dentro de ella, del más reciente al más viejo, cada uno
  // con su etiqueta + el conteo de equipos VISTOS EN LA VENTANA. El conteo es un
  // preview: al elegir el contrato se re-consulta completo (getByContrato), así
  // que un batch mayor que la ventana igual se selecciona entero.
  async getContratosRecientes({ windowSize = 600, max = 12 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices')
      .orderBy('created_at', 'desc').limit(windowSize).get();
    const orden = [];               // primer-visto = más reciente
    const porClave = new Map();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.deleted === true) return;
      const docId = (d.contrato_doc_id || '').toString();
      const ref   = (d.contrato_id || '').toString();
      if (!docId && !ref) return;   // equipos sin contrato → fuera del menú
      const clave = docId || ref;
      let entry = porClave.get(clave);
      if (!entry) {
        entry = {
          contrato_doc_id: docId || null,
          contrato_id: ref || '',
          cliente_id: d.cliente_id || '',
          cliente: d.cliente_nombre || d.cliente || '',
          count: 0,
        };
        porClave.set(clave, entry);
        orden.push(clave);
      }
      // Conserva la mejor etiqueta/ref disponible entre los docs del contrato.
      if (!entry.cliente && (d.cliente_nombre || d.cliente)) entry.cliente = d.cliente_nombre || d.cliente;
      if (!entry.cliente_id && d.cliente_id) entry.cliente_id = d.cliente_id;
      if (!entry.contrato_id && ref) entry.contrato_id = ref;
      entry.count++;
    });
    return orden.slice(0, max).map(k => porClave.get(k));
  },

  // Trae TODOS los equipos de un contrato. Corre la query sobre las anclas
  // provistas (contrato_doc_id es la precisa; contrato_id es respaldo para docs
  // estampados antes de existir doc_id) y dedupa por id. Misma forma que
  // getByCliente. El filtrado de eliminados queda al caller.
  async getByContrato({ contratoDocId = null, contratoRef = null } = {}) {
    if (!contratoDocId && !contratoRef) return [];
    const db = firebase.firestore();
    const found = new Map();
    const runQuery = async (field, value) => {
      const snap = await db.collection('poc_devices').where(field, '==', value).get();
      snap.docs.forEach(d => { if (!found.has(d.id)) found.set(d.id, { id: d.id, ...d.data() }); });
    };
    const tasks = [];
    if (contratoDocId) tasks.push(runQuery('contrato_doc_id', contratoDocId));
    if (contratoRef)   tasks.push(runQuery('contrato_id', contratoRef));
    await Promise.all(tasks);
    return Array.from(found.values());
  },

  // Paginated sorted list, excluding deleted. Returns { docs, lastDoc }.
  // source:'cache' lee SOLO la persistencia local (preview instantáneo; el
  // caller debe repintar con el pase de servidor — el cursor de un snapshot
  // de caché no es confiable para paginar).
  async listPage({ sortField = 'cliente', sortAsc = true, onlyActivos = false, cursorDoc = null, limit = 50, source = null } = {}) {
    const db = firebase.firestore();
    let q = db.collection('poc_devices')
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .orderBy(this._sortFieldFor(sortField), sortAsc ? 'asc' : 'desc')
      .limit(limit);
    if (onlyActivos) q = q.where('activo', '==', true);
    if (cursorDoc) q = q.startAfter(cursorDoc);
    const snap = await (source ? q.get({ source }) : q.get());
    return {
      docs: snap.docs.map(d => ({ id: d.id, ...d.data() })),
      lastDoc: snap.empty ? null : snap.docs[snap.docs.length - 1],
    };
  },

  // Full list for filter/export — no pagination, sorted by created_at desc.
  // Returns unique non-null operador strings across all poc_devices (fallback when empresa list is empty).
  async getUniqueOperadores(limit = 1000) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices')
      .where('operador', '!=', null).limit(limit).get();
    const set = new Set();
    snap.forEach(doc => {
      const v = (doc.data().operador || '').toString().trim();
      if (v) set.add(v);
    });
    return Array.from(set);
  },

  async getAll({ sortField = 'created_at', sortAsc = false, onlyActivos = false } = {}) {
    const db = firebase.firestore();
    let q = db.collection('poc_devices')
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .orderBy(this._sortFieldFor(sortField), sortAsc ? 'asc' : 'desc');
    if (onlyActivos) q = q.where('activo', '==', true);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Fichas CERRADAS (deleted:true) — el histórico de lo que el cliente TUVO.
  // Fuera de la lista normal: solo las trae el toggle "Incluir cerradas", y
  // por eso no se ordena en el servidor (sin orderBy no hace falta índice
  // compuesto; el orden lo pone el caller como a cualquier otra fila).
  // Una devolución cierra la ficha (functions/src/lib/pocCierre.js): recepción
  // sigue necesitando el serial —y el SIM que tenía, guardado en `cierre`—
  // para pedir la desconexión del airtime (Brenda, 2026-09-16).
  async getCerradas() {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices').where('deleted', '==', true).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Suscripción VIVA a las fichas vivas o cerradas, para la búsqueda de la
  // lista (poc-list.js, 2026-09-25). Misma query que getAll() (created_at ↓)
  // y getCerradas(): tiene que dar exactamente el mismo conjunto.
  //
  // onDatos(docs, delServidor): `delServidor` es !metadata.fromCache. El
  // primer snapshot de onSnapshot suele venir de la caché local de IndexedDB y
  // PUEDE ESTAR INCOMPLETO — quien consume no debe tomarlo como el conjunto
  // entero hasta ver uno del servidor (ver PocList._escuchar). Por eso
  // includeMetadataChanges: sin él no llega el aviso de "ya sincronizó".
  // Devuelve la función para cancelar la suscripción.
  escuchar(nombre, onDatos, onError) {
    const db = firebase.firestore();
    const q = nombre === 'cerradas'
      ? db.collection('poc_devices').where('deleted', '==', true)
      : db.collection('poc_devices')
          .where('deleted', '!=', true)
          .orderBy('deleted')
          .orderBy(this._sortFieldFor('created_at'), 'desc');
    return q.onSnapshot({ includeMetadataChanges: true },
      snap => onDatos(snap.docs.map(d => ({ id: d.id, ...d.data() })), !snap.metadata.fromCache),
      onError);
  },

  // ── Group administration ─────────────────────────────────────────────
  // Two layers:
  //   1. Canonical CATALOG — clientes/{id}.poc_grupos (string[]). Source of
  //      truth for "which groups this empresa has". Managed from admin/grupos
  //      and offered as a checklist at data-entry. Can hold groups with 0
  //      devices (pre-provisioned).
  //   2. Device tags — grupos[] on each poc_devices doc (denormalized copy so
  //      filters/exports/queries keep working). rename/merge/delete propagate
  //      to BOTH layers.
  // Pre-backfill clients have no catalog yet; the helpers below derive + seed
  // it lazily from the device tags on the first admin edit.

  // Read the canonical catalog. Returns string[] or null when the field is
  // absent (caller distinguishes "empty catalog" from "no catalog yet").
  async getCatalogoGrupos(clienteId, { fresh = false } = {}) {
    if (!clienteId) return null;
    const ref = firebase.firestore().collection('clientes').doc(clienteId);
    // OJO: get({source:'cache'}) sobre un DOC individual LANZA si no está en
    // caché (las queries de colección sí devuelven vacío). Probamos caché y
    // caemos al servidor ante cualquier fallo o cache-miss.
    // `fresh` salta la caché del SDK y lee del servidor — necesario cuando otro
    // usuario (recepción/admin) acaba de editar el catálogo y este cliente debe
    // ver los grupos nuevos (la caché local quedaría obsoleta).
    let doc;
    if (fresh) {
      doc = await ref.get();
    } else {
      try {
        doc = await ref.get({ source: 'cache' });
        if (!doc.exists) doc = await ref.get();
      } catch (_) {
        doc = await ref.get();
      }
    }
    if (!doc.exists) return null;
    const arr = doc.data().poc_grupos;
    return Array.isArray(arr) ? arr.slice() : null;
  },

  // Write the catalog (deduped accent/case-insensitively + sorted). Stamps
  // updated_at/by like ClientesService does.
  async _writeCatalogo(clienteId, grupos) {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    const limpio = FMT.dedupGrupos(grupos)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    await db.collection('clientes').doc(clienteId).update({
      poc_grupos: limpio,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    });
    return limpio;
  },

  // Apply transformFn to the catalog and persist. Keyed by clientes doc id
  // (legacy name-only clients have no catalog). Seeds from device tags the
  // first time so the catalog materializes on first edit.
  async _syncCatalogo(clienteId, clienteNombre, transformFn) {
    if (!clienteId) return;
    let base = await this.getCatalogoGrupos(clienteId);
    if (base === null) {
      const derivados = await this.listGruposByCliente({ clienteId, clienteNombre });
      base = derivados.map(g => g.nombre);
    }
    await this._writeCatalogo(clienteId, transformFn(base.slice()));
  },

  // ── Prefijo de grupo por empresa (clientes/{id}.poc_grupo_prefix) ─────
  async getGrupoPrefix(clienteId) {
    if (!clienteId) return null;
    const ref = firebase.firestore().collection('clientes').doc(clienteId);
    let doc;
    try {
      doc = await ref.get({ source: 'cache' });
      if (!doc.exists) doc = await ref.get();
    } catch (_) {
      doc = await ref.get();
    }
    if (!doc.exists) return null;
    const p = FMT.normalizePrefijo(doc.data().poc_grupo_prefix);
    return p.length === 3 ? p : null;
  },

  async setGrupoPrefix(clienteId, prefijo) {
    const p = FMT.normalizePrefijo(prefijo);
    if (!clienteId || p.length !== 3) return null;
    await firebase.firestore().collection('clientes').doc(clienteId).update({
      poc_grupo_prefix: p,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: firebase.auth().currentUser?.uid || null,
    });
    return p;
  },

  // Add one group to the catalog without touching any device. Returns
  // { added, grupos }. No-op (added:false) if an accent/case variant exists.
  // Si se pasa `prefijo`, el nombre se guarda como "AAA-Nombre".
  async agregarGrupoCatalogo({ clienteId = null, clienteNombre = null, nombre, prefijo = null }) {
    let n = FMT.normalizeGrupo(nombre);
    if (prefijo) n = FMT.aplicarPrefijoGrupo(prefijo, n);
    if (!clienteId || !n) return { added: false, grupos: [] };
    let base = await this.getCatalogoGrupos(clienteId);
    if (base === null) {
      const derivados = await this.listGruposByCliente({ clienteId, clienteNombre });
      base = derivados.map(g => g.nombre);
    }
    const exists = base.some(g => FMT.normalize(g) === FMT.normalize(n));
    const grupos = await this._writeCatalogo(clienteId, exists ? base : base.concat([n]));
    return { added: !exists, grupos };
  },

  // Alta en lote: agrega varios grupos al catálogo en UNA sola escritura.
  // Aplica `prefijo` a cada nombre y omite los que ya existan. Devuelve
  // { added: <cuántos nuevos>, grupos }.
  async agregarGruposCatalogo({ clienteId = null, clienteNombre = null, nombres = [], prefijo = null }) {
    if (!clienteId) return { added: 0, grupos: [] };
    const items = (nombres || [])
      .map(n => (prefijo ? FMT.aplicarPrefijoGrupo(prefijo, n) : FMT.normalizeGrupo(n)))
      .filter(Boolean);
    let base = await this.getCatalogoGrupos(clienteId);
    if (base === null) {
      const derivados = await this.listGruposByCliente({ clienteId, clienteNombre });
      base = derivados.map(g => g.nombre);
    }
    if (!items.length) return { added: 0, grupos: base };
    const have = new Set(base.map(g => FMT.normalize(g)));
    const next = base.slice();
    let added = 0;
    for (const it of items) {
      const k = FMT.normalize(it);
      if (have.has(k)) continue;
      have.add(k); next.push(it); added++;
    }
    const grupos = added ? await this._writeCatalogo(clienteId, next) : base;
    return { added, grupos };
  },

  // Migración: aplica `prefijo` a TODOS los grupos del cliente — equipos
  // (server-fresh) + catálogo — y guarda el prefijo en el cliente. Idempotente
  // y soporta cambio de prefijo (lee el anterior para no duplicar). Devuelve
  // { affected, grupos, prefijo }.
  async aplicarPrefijoCliente({ clienteId = null, clienteNombre = null, prefijo }) {
    const pfx = FMT.normalizePrefijo(prefijo);
    if (!clienteId || pfx.length !== 3) return { affected: 0, grupos: [], prefijo: null };
    const oldPfx = await this.getGrupoPrefix(clienteId);   // puede ser null
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    const CHUNK = 450;

    // Equipos (server-fresh, así migramos el universo completo).
    const devices = (await this.getByCliente({ clienteId, clienteNombre, fresh: true }))
      .filter(d => d.deleted !== true);

    const prefijar = g => FMT.aplicarPrefijoGrupo(pfx, g, oldPfx);
    const targets = [];
    for (const d of devices) {
      const orig = (d.grupos || []).map(g => (g || '').toString().trim()).filter(Boolean);
      const next = Array.from(new Set(orig.map(prefijar).filter(Boolean)));
      const cambia = next.length !== orig.length || next.some((g, i) => g !== orig[i]);
      if (cambia) targets.push({ id: d.id, next });
    }
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = db.batch();
      for (const t of targets.slice(i, i + CHUNK)) {
        batch.update(db.collection('poc_devices').doc(t.id), {
          grupos: t.next,
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_by: uid,
        });
      }
      await batch.commit();
    }

    // Catálogo = (catálogo actual ∪ grupos de equipos), todo prefijado.
    const cat = await this.getCatalogoGrupos(clienteId);
    const universo = new Set();
    (cat || []).forEach(g => { const v = prefijar(g); if (v) universo.add(v); });
    devices.forEach(d => (d.grupos || []).forEach(g => {
      const v = prefijar((g || '').toString().trim());
      if (v) universo.add(v);
    }));
    const grupos = await this._writeCatalogo(clienteId, Array.from(universo));

    // Guarda el prefijo en el cliente.
    await db.collection('clientes').doc(clienteId).update({
      poc_grupo_prefix: pfx,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    });

    return { affected: targets.length, grupos, prefijo: pfx };
  },

  // Admin/data-entry view: union of catalog + device-derived groups.
  // Returns { grupos: [{ nombre, count }], tieneCatalogo }. count = number of
  // non-deleted devices tagging the group (0 for catalog-only groups).
  async listGruposConCatalogo({ clienteId = null, clienteNombre = null, fresh = false } = {}) {
    const [derivados, catalogo] = await Promise.all([
      this.listGruposByCliente({ clienteId, clienteNombre, fresh }),
      clienteId ? this.getCatalogoGrupos(clienteId) : Promise.resolve(null),
    ]);
    const map = new Map();   // normKey → { nombre, count }
    for (const g of derivados) map.set(FMT.normalize(g.nombre), { nombre: g.nombre, count: g.count });
    for (const raw of (catalogo || [])) {
      const k = FMT.normalize(raw);
      if (!map.has(k)) map.set(k, { nombre: raw, count: 0 });
    }
    const grupos = Array.from(map.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    return { grupos, tieneCatalogo: Array.isArray(catalogo) };
  },

  // Groups are stored as a string[] on each poc_devices doc. There is no
  // grupos collection; the canonical list per client is derived by unioning
  // grupos[] across the client's non-deleted devices.

  // Returns [{ nombre, count, devices: [deviceId] }] sorted by nombre.
  // Excludes soft-deleted devices.
  async listGruposByCliente({ clienteId = null, clienteNombre = null, fresh = false } = {}) {
    const devices = await this.getByCliente({ clienteId, clienteNombre, fresh });
    const map = new Map();
    devices.forEach(d => {
      if (d.deleted === true) return;
      (d.grupos || []).forEach(g => {
        const nombre = (g || '').toString().trim();
        if (!nombre) return;
        if (!map.has(nombre)) map.set(nombre, { nombre, count: 0, devices: [] });
        const entry = map.get(nombre);
        entry.count++;
        entry.devices.push(d.id);
      });
    });
    return Array.from(map.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  },

  // Rename `from` → `to` across every non-deleted device of the client that
  // references `from`. If a device already has `to`, the rename simply removes
  // `from` (dedup). Touched devices' grupos arrays are deduped and trimmed.
  // Returns { affected: number }.
  async renombrarGrupo({ clienteId = null, clienteNombre = null, from, to }) {
    const fromN = (from || '').toString().trim();
    const toN   = (to   || '').toString().trim();
    if (!fromN || !toN || fromN === toN) return { affected: 0 };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const targets = devices.filter(d => d.deleted !== true && (d.grupos || []).includes(fromN));
    if (targets.length) {
      const db = firebase.firestore();
      const CHUNK = 450;
      const uid = firebase.auth().currentUser?.uid || null;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = db.batch();
        for (const d of targets.slice(i, i + CHUNK)) {
          const next = Array.from(new Set(
            (d.grupos || [])
              .map(g => (g || '').toString().trim())
              .filter(Boolean)
              .map(g => (g === fromN ? toN : g))
          ));
          batch.update(db.collection('poc_devices').doc(d.id), {
            grupos: next,
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_by: uid,
          });
        }
        await batch.commit();
      }
    }
    // Keep the catalog in sync (also seeds it on the first edit). Runs even
    // when 0 devices matched, so renaming a catalog-only group still works.
    await this._syncCatalogo(clienteId, clienteNombre, list =>
      list.map(g => (FMT.normalize(g) === FMT.normalize(fromN) ? toN : g))
    );
    return { affected: targets.length };
  },

  // Merge `sources[]` → `target` across the client's devices. Equivalent to
  // calling renombrarGrupo for each source but in a single pass.
  async fusionarGrupos({ clienteId = null, clienteNombre = null, sources = [], target }) {
    const targetN = (target || '').toString().trim();
    const sourcesN = (sources || [])
      .map(s => (s || '').toString().trim())
      .filter(s => s && s !== targetN);
    if (!targetN || !sourcesN.length) return { affected: 0 };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const sourceSet = new Set(sourcesN);
    const targets = devices.filter(d => d.deleted !== true
      && (d.grupos || []).some(g => sourceSet.has((g || '').toString().trim())));
    if (targets.length) {
      const db = firebase.firestore();
      const CHUNK = 450;
      const uid = firebase.auth().currentUser?.uid || null;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = db.batch();
        for (const d of targets.slice(i, i + CHUNK)) {
          const next = Array.from(new Set(
            (d.grupos || [])
              .map(g => (g || '').toString().trim())
              .filter(Boolean)
              .map(g => (sourceSet.has(g) ? targetN : g))
          ));
          batch.update(db.collection('poc_devices').doc(d.id), {
            grupos: next,
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_by: uid,
          });
        }
        await batch.commit();
      }
    }
    // Catalog: drop the sources, ensure the target is present.
    const srcNorms = new Set(sourcesN.map(s => FMT.normalize(s)));
    await this._syncCatalogo(clienteId, clienteNombre, list => {
      const kept = list.filter(g => !srcNorms.has(FMT.normalize(g)));
      if (!kept.some(g => FMT.normalize(g) === FMT.normalize(targetN))) kept.push(targetN);
      return kept;
    });
    return { affected: targets.length };
  },

  // Remove `nombre` from every non-deleted device of the client. Antes de
  // tocar el primer device se escribe un snapshot en poc_grupos_historial
  // (grupo + device_ids) que permite deshacer con restaurarGrupo(); si el
  // snapshot no se puede escribir, no se borra nada.
  // Returns { affected, historialId }.
  async eliminarGrupo({ clienteId = null, clienteNombre = null, nombre }) {
    const nombreN = (nombre || '').toString().trim();
    if (!nombreN) return { affected: 0, historialId: null };
    const devices = await this.getByCliente({ clienteId, clienteNombre });
    const targets = devices.filter(d => d.deleted !== true && (d.grupos || []).includes(nombreN));
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    const histRef = await db.collection('poc_grupos_historial').add({
      cliente_id:     clienteId || null,
      cliente_nombre: clienteNombre || null,
      grupo:          nombreN,
      device_ids:     targets.map(d => d.id),
      count:          targets.length,
      fecha:          firebase.firestore.FieldValue.serverTimestamp(),
      usuario:        user?.email || null,
      usuario_uid:    user?.uid || null,
      restaurado:     false,
    });
    if (targets.length) {
      const CHUNK = 450;
      const uid = user?.uid || null;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = db.batch();
        for (const d of targets.slice(i, i + CHUNK)) {
          const next = (d.grupos || [])
            .map(g => (g || '').toString().trim())
            .filter(g => g && g !== nombreN);
          batch.update(db.collection('poc_devices').doc(d.id), {
            grupos: Array.from(new Set(next)),
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_by: uid,
          });
        }
        await batch.commit();
      }
    }
    // Catalog: remove the group too (runs even with 0 device matches, so a
    // catalog-only group can be deleted).
    await this._syncCatalogo(clienteId, clienteNombre, list =>
      list.filter(g => FMT.normalize(g) !== FMT.normalize(nombreN))
    );
    return { affected: targets.length, historialId: histRef.id };
  },

  // Reversa de eliminarGrupo a partir del snapshot en poc_grupos_historial:
  // re-etiqueta el grupo en los mismos devices (arrayUnion, así no pisa
  // ediciones que hayan pasado en medio) y lo devuelve al catálogo. Solo se
  // aplica una vez (restaurado:true marca el snapshot como consumido).
  // Returns { affected, grupo }.
  async restaurarGrupo({ historialId }) {
    if (!historialId) return { affected: 0, grupo: null };
    const db = firebase.firestore();
    const ref = db.collection('poc_grupos_historial').doc(historialId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('No se encontró el registro del borrado.');
    const h = snap.data();
    if (h.restaurado === true) return { affected: 0, grupo: h.grupo };
    const ids = Array.isArray(h.device_ids) ? h.device_ids : [];
    const uid = firebase.auth().currentUser?.uid || null;
    const CHUNK = 450;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + CHUNK)) {
        batch.update(db.collection('poc_devices').doc(id), {
          grupos:     firebase.firestore.FieldValue.arrayUnion(h.grupo),
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_by: uid,
        });
      }
      await batch.commit();
    }
    await this._syncCatalogo(h.cliente_id, h.cliente_nombre, list => {
      if (!list.some(g => FMT.normalize(g) === FMT.normalize(h.grupo))) list.push(h.grupo);
      return list;
    });
    await ref.update({
      restaurado:     true,
      restaurado_at:  firebase.firestore.FieldValue.serverTimestamp(),
      restaurado_por: uid,
    });
    return { affected: ids.length, grupo: h.grupo };
  },
};

window.PocService = PocService;
