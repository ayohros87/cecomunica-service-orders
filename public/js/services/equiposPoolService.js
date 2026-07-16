// Pool de equipos serializados — colección `equipos_pool`, un doc por unidad
// física con el serial normalizado como ID del documento (dedup natural, mismo
// patrón que sim_cards). Plan: docs/plans/PLAN_POOL_EQUIPOS_SERIAL.md.
//
// Failsafe de colisión entre modelos: hay seriales reales repetidos entre
// modelos distintos (p. ej. Kenwood NX420 y NX920 con el mismo serial). El
// serial sigue siendo el ID, pero si al dar de alta ya existe con OTRO modelo,
// el nuevo doc se crea con ID sufijado `${serial}__${modeloKey}` y AMBOS docs
// se marcan `serial_compartido: true`. Por eso la búsqueda canónica por serial
// es la query por el campo `serial_norm` (findBySerial) — nunca asumir que el
// doc-ID es el serial.
//
// El kardex vive en la subcolección `movimientos` (append-only): cada
// transición de estado escribe un movimiento con quién, cuándo y la referencia
// (contrato/orden/cancelación). Las transiciones que nacen en otros flujos
// (seriales de contrato, órdenes, POC, entregas) las escriben Cloud Functions
// con Admin SDK — ver functions/src/domain/equiposPool.js, que duplica la
// normalización de este archivo (mantener sincronizadas).
const EquiposPoolService = {

  ESTADOS: {
    EN_BODEGA:  'en_bodega',
    ASIGNADO:   'asignado_contrato',
    EN_CLIENTE: 'en_cliente',
    EN_TALLER:  'en_taller',
    EN_POC:     'en_poc',
    DEVUELTO:   'devuelto_revision',
    BAJA:       'baja',
  },

  ESTADO_LABELS: {
    en_bodega:         'En bodega',
    asignado_contrato: 'Asignado a contrato',
    en_cliente:        'En cliente',
    en_taller:         'En taller',
    en_poc:            'En POC',
    devuelto_revision: 'Entrada (por inspeccionar)',
    baja:              'Baja',
  },

  // Serial normalizado: mayúsculas, solo [A-Z0-9]. Es el ID del doc (salvo
  // colisión — ver failsafe) y el campo de búsqueda canónico `serial_norm`.
  normalizarSerial(raw) {
    return (raw ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  esSerialValido(serialNorm) {
    return /^[A-Z0-9]{3,30}$/.test(serialNorm);
  },

  // Componente de modelo para el ID sufijado del failsafe. La normalización
  // quita TODO lo no alfanumérico ("NX-420" == "NX 420" == "NX420"), mismo
  // criterio que _tightModelo del backfill linkModeloIdPoc.
  modeloKey(modeloId, modeloLabel) {
    if (modeloId) return modeloId;
    const norm = this._tightLabel(modeloLabel);
    return norm ? `m_${norm}` : 'sinmodelo';
  },

  _tightLabel(label) {
    return (label || '').toString().toLowerCase()
      .normalize('NFD').replace(/[^\x00-\x7f]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  },

  // ¿Es la misma unidad-modelo? Comparación TOLERANTE a datos desparejos entre
  // fuentes (== functions/src/domain/equiposPool.js — mantener sincronizadas):
  // labels normalizados ignorando el sufijo de reuso ("PNC360S-R" ≡ "PNC360S":
  // el catálogo modela N/R como filas distintas pero es el mismo radio físico);
  // ids solo desempatan cuando falta el label; si a un lado le falta todo el
  // dato de modelo se asume la misma unidad (adoptar > duplicar — una colisión
  // real tipo Kenwood trae modelo en ambos lados).
  _mismoModelo(data, modeloId, modeloLabel) {
    // Misma fila del catálogo → misma unidad, sin importar cómo esté el label.
    if (data.modelo_id && modeloId && data.modelo_id === modeloId) return true;
    const la = this._tightLabel(data.modelo_label).replace(/r$/, '');
    const lb = this._tightLabel(modeloLabel).replace(/r$/, '');
    if (la && lb) {
      if (la === lb) return true;
      // Texto de modelo desparejo entre fuentes: con marca o sin marca ("HYTERA
      // PNC360S" vs "PNC360S"), truncado ("PD6" vs "PD606"), o variantes G/U/S
      // ("PD606G" vs "PD606"). Con el MISMO serial, un texto contenido en el
      // otro (≥3 chars) es la misma unidad; la colisión real tipo Kenwood
      // (NX420 vs NX920) no tiene contención.
      const [corto, largo] = la.length <= lb.length ? [la, lb] : [lb, la];
      return corto.length >= 3 && largo.includes(corto);
    }
    // Sin labels comparables: desempata por id; sin ningún dato → misma unidad.
    if (data.modelo_id && modeloId) return data.modelo_id === modeloId;
    return true;
  },

  _autoria(user) {
    return {
      updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
      updated_by:       user?.uid   || null,
      updated_by_email: user?.email || null,
    };
  },

  // Payload completo de un equipo nuevo — única definición del esquema del doc.
  _docNuevo({ serial, serial_norm, modelo_id = null, modelo_label = '',
              condicion = 'nuevo', estado, asignacion = null,
              poc_device_id = null, orden_actual_id = null,
              propiedad = 'cecomunica', proveedor = '', notas = '' }, origen, user) {
    return {
      serial: (serial || '').toString().trim(),
      serial_norm,
      serial_compartido: false,
      modelo_id:    modelo_id || null,
      modelo_label: (modelo_label || '').toString().trim(),
      condicion,
      // 'cecomunica' (flota propia) | 'cliente' (equipo del cliente: contratos
      // "Propio"/venta o traído a taller) | 'desconocida'. Lo que entra por
      // bodega es flota propia por definición.
      propiedad,
      estado,
      asignacion,
      poc_device_id,
      orden_actual_id,
      origen,
      verificado: origen !== 'migracion_contrato'
               && origen !== 'migracion_poc'
               && origen !== 'migracion_orden',
      ingreso_bodega_at: estado === this.ESTADOS.EN_BODEGA
        ? firebase.firestore.FieldValue.serverTimestamp() : null,
      proveedor: (proveedor || '').toString().trim(),
      notas:     (notas || '').toString().trim(),
      baja_motivo: null,
      created_at:       firebase.firestore.FieldValue.serverTimestamp(),
      creado_por_uid:   user?.uid   || null,
      creado_por_email: user?.email || null,
      ...this._autoria(user),
    };
  },

  _movimiento({ tipo, de_estado = null, a_estado = null, ref = null, notas = '' }, user) {
    return {
      at:  firebase.firestore.FieldValue.serverTimestamp(),
      por: user?.uid || 'system',
      por_email: user?.email || null,
      tipo, de_estado, a_estado,
      ref: ref || null,
      notas: (notas || '').toString().trim(),
    };
  },

  // ── Lecturas ─────────────────────────────────────────────────────────

  async getDoc(id) {
    const db = firebase.firestore();
    const doc = await db.collection('equipos_pool').doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  // Búsqueda canónica por serial: query por campo (cubre docs con ID limpio y
  // sufijado por colisión). Devuelve [] | [doc] | [docs] (colisión).
  async findBySerial(serial) {
    const norm = this.normalizarSerial(serial);
    if (!norm) return [];
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool')
      .where('serial_norm', '==', norm).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Resuelve la unidad de un serial+modelo (_mismoModelo ya es tolerante a
  // datos desparejos; si no hay match es una colisión real entre modelos).
  async resolver(serial, modeloId, modeloLabel) {
    const docs = await this.findBySerial(serial);
    return docs.find(d => this._mismoModelo(d, modeloId, modeloLabel)) || null;
  },

  async listar({ estado = null, modeloId = null } = {}) {
    const db = firebase.firestore();
    let q = db.collection('equipos_pool');
    if (estado)   q = q.where('estado', '==', estado);
    if (modeloId) q = q.where('modelo_id', '==', modeloId);
    const snap = await q.get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.modelo_label || '').localeCompare(b.modelo_label || '')
        || (a.serial || '').localeCompare(b.serial || ''));
  },

  // Disponibles de un modelo, para el picker "Tomar del pool".
  async disponiblesDeModelo(modeloId, modeloLabel) {
    const todos = await this.listar({ estado: this.ESTADOS.EN_BODEGA });
    return todos.filter(d => this._mismoModelo(d, modeloId, modeloLabel));
  },

  // Unidades actualmente asignadas a un contrato / con un cliente — para los
  // paneles "Equipos" en contrato y cliente. Solo asignación VIGENTE (liberar/
  // baja limpian `asignacion`, así que lo histórico no aparece).
  async listarPorContrato(contratoDocId) {
    if (!contratoDocId) return [];
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool')
      .where('asignacion.contrato_doc_id', '==', contratoDocId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.modelo_label || '').localeCompare(b.modelo_label || '')
        || (a.serial || '').localeCompare(b.serial || ''));
  },

  async listarPorCliente(clienteId) {
    if (!clienteId) return [];
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool')
      .where('asignacion.cliente_id', '==', clienteId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.modelo_label || '').localeCompare(b.modelo_label || '')
        || (a.serial || '').localeCompare(b.serial || ''));
  },

  // Chip de estado compartido (clases .eqpool-chip en ceco-ui.css) — mismo
  // lenguaje visual del estado en todas las páginas que muestran unidades.
  chipEstadoHtml(estado) {
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
    const cls = this.ESTADO_LABELS[estado] ? estado : 'desconocido';
    return `<span class="eqpool-chip eqpool-chip-${esc(cls)}">${esc(this.ESTADO_LABELS[estado] || estado || '—')}</span>`;
  },

  // Link al kardex de una unidad: la página del pool con ?serial= abre la
  // pestaña "todos" con la búsqueda precargada.
  kardexUrl(serial, { desdeRaiz = false } = {}) {
    const base = desdeRaiz ? 'inventario/equipos.html' : '../inventario/equipos.html';
    return `${base}?serial=${encodeURIComponent((serial || '').toString().trim())}`;
  },

  async getMovimientos(id) {
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool').doc(id)
      .collection('movimientos').orderBy('at', 'desc').limit(100).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Conteo de en_bodega agrupado por modelo — para KPIs y conciliación contra
  // inventario_actual. Retorna Map<modeloKey, {modelo_id, modelo_label, n}>.
  async contarBodegaPorModelo() {
    const enBodega = await this.listar({ estado: this.ESTADOS.EN_BODEGA });
    const porModelo = new Map();
    for (const d of enBodega) {
      const key = this.modeloKey(d.modelo_id, d.modelo_label);
      const cur = porModelo.get(key) || { modelo_id: d.modelo_id, modelo_label: d.modelo_label, n: 0 };
      cur.n++;
      porModelo.set(key, cur);
    }
    return porModelo;
  },

  // ── Alta (con failsafe de colisión) ──────────────────────────────────

  // Alta de UNA unidad. Transaccional:
  //   · el ID limpio no existe            → se crea con ID = serial_norm
  //   · existe con el MISMO modelo        → error 'serial-existe'
  //   · existe con OTRO modelo (colisión) → doc sufijado `${serial}__${modeloKey}`
  //     y ambos docs quedan serial_compartido:true
  // Retorna { id, colision }.
  async agregar({ serial, modelo_id = null, modelo_label = '', condicion = 'nuevo',
                  estado = null, asignacion = null, proveedor = '', notas = '',
                  origen = 'bodega' }, user) {
    const norm = this.normalizarSerial(serial);
    if (!this.esSerialValido(norm)) {
      const e = new Error('Serial inválido'); e.code = 'serial-invalido'; throw e;
    }
    const db = firebase.firestore();
    const limpioRef = db.collection('equipos_pool').doc(norm);
    const estadoFinal = estado || this.ESTADOS.EN_BODEGA;

    return db.runTransaction(async tx => {
      const limpio = await tx.get(limpioRef);

      let ref = limpioRef;
      let colision = false;

      if (limpio.exists) {
        if (this._mismoModelo(limpio.data(), modelo_id, modelo_label)) {
          const e = new Error(`El serial ${norm} ya está registrado en este modelo`);
          e.code = 'serial-existe'; throw e;
        }
        // Colisión legítima entre modelos → failsafe con ID sufijado.
        const sufijadoRef = db.collection('equipos_pool')
          .doc(`${norm}__${this.modeloKey(modelo_id, modelo_label)}`);
        const sufijado = await tx.get(sufijadoRef);
        if (sufijado.exists) {
          const e = new Error(`El serial ${norm} ya está registrado en este modelo`);
          e.code = 'serial-existe'; throw e;
        }
        ref = sufijadoRef;
        colision = true;
        tx.update(limpioRef, { serial_compartido: true, ...this._autoria(user) });
      }

      const doc = this._docNuevo({
        serial, serial_norm: norm, modelo_id, modelo_label, condicion,
        estado: estadoFinal, asignacion, proveedor, notas,
      }, origen, user);
      if (colision) doc.serial_compartido = true;
      tx.set(ref, doc);
      tx.set(ref.collection('movimientos').doc(), this._movimiento({
        tipo: estadoFinal === this.ESTADOS.EN_BODEGA ? 'ingreso_bodega' : 'migracion',
        a_estado: estadoFinal,
        notas: colision ? 'Alta con colisión de serial entre modelos' : '',
      }, user));
      return { id: ref.id, colision };
    });
  },

  // Recepción masiva de un modelo (pegado multilínea / lector de código de
  // barras / import Excel / toma física). Dedup contra la colección con
  // documentId() in (patrón sim_cards); los seriales que ya existen se
  // resuelven uno a uno para aplicar el failsafe de colisión.
  // Retorna { nuevos, existentes, colisiones, invalidos }.
  async recibir(seriales, { modelo_id = null, modelo_label = '', condicion = 'nuevo',
                            proveedor = '', notas = '', origen = 'bodega' }, user, onProgress = null) {
    const db = firebase.firestore();
    const resultado = { nuevos: 0, existentes: 0, colisiones: 0, invalidos: 0 };

    const vistos = new Set();
    const validos = [];
    for (const raw of seriales || []) {
      const norm = this.normalizarSerial(raw);
      if (!this.esSerialValido(norm) || vistos.has(norm)) { resultado.invalidos++; continue; }
      vistos.add(norm);
      validos.push({ raw: (raw || '').toString().trim(), norm });
    }
    if (!validos.length) return resultado;

    // Existencia del ID limpio en chunks de 10 (1 lectura por chunk).
    const existentes = new Set();
    const chunks = [];
    for (let i = 0; i < validos.length; i += 10) {
      chunks.push(validos.slice(i, i + 10).map(v => v.norm));
    }
    const snaps = await Promise.all(chunks.map(ids =>
      db.collection('equipos_pool')
        .where(firebase.firestore.FieldPath.documentId(), 'in', ids).get()
    ));
    snaps.forEach(snap => snap.docs.forEach(d => existentes.add(d.id)));

    // Los inexistentes entran en batches (doc + movimiento = 2 writes c/u).
    const nuevos = validos.filter(v => !existentes.has(v.norm));
    const CHUNK = 200;
    for (let i = 0; i < nuevos.length; i += CHUNK) {
      const batch = db.batch();
      for (const v of nuevos.slice(i, i + CHUNK)) {
        const ref = db.collection('equipos_pool').doc(v.norm);
        batch.set(ref, this._docNuevo({
          serial: v.raw, serial_norm: v.norm, modelo_id, modelo_label,
          condicion, estado: this.ESTADOS.EN_BODEGA, proveedor, notas,
        }, origen, user));
        batch.set(ref.collection('movimientos').doc(), this._movimiento({
          tipo: 'ingreso_bodega', a_estado: this.ESTADOS.EN_BODEGA,
          notas: origen === 'toma_fisica' ? 'Toma física inicial' : '',
        }, user));
      }
      await batch.commit();
      resultado.nuevos += Math.min(CHUNK, nuevos.length - i);
      if (onProgress) onProgress(resultado.nuevos, validos.length, 'guardando');
    }

    // Los que ya existen pasan por el failsafe uno a uno (colisiones son raras).
    for (const v of validos.filter(x => existentes.has(x.norm))) {
      try {
        const r = await this.agregar({
          serial: v.raw, modelo_id, modelo_label, condicion, proveedor, notas, origen,
        }, user);
        if (r.colision) resultado.colisiones++; else resultado.nuevos++;
      } catch (e) {
        if (e.code === 'serial-existe') resultado.existentes++;
        else throw e;
      }
    }
    return resultado;
  },

  // ── Transiciones ─────────────────────────────────────────────────────

  // Transición genérica con movimiento en la misma transacción. `esperado`
  // (opcional) re-verifica el estado actual — dos usuarias no pueden tomar la
  // misma unidad (lanza 'estado-cambio' si otro la movió primero).
  async cambiarEstado(id, aEstado, { esperado = null, tipo = null, ref = null,
                                     notas = '', extra = {} } = {}, user) {
    const db = firebase.firestore();
    const docRef = db.collection('equipos_pool').doc(id);
    return db.runTransaction(async tx => {
      const snap = await tx.get(docRef);
      if (!snap.exists) { const e = new Error('El equipo no existe en el pool'); e.code = 'no-existe'; throw e; }
      const de = snap.data().estado;
      if (esperado && de !== esperado) {
        const e = new Error(`El equipo ya no está "${this.ESTADO_LABELS[esperado] || esperado}" (ahora: ${this.ESTADO_LABELS[de] || de})`);
        e.code = 'estado-cambio'; throw e;
      }
      tx.update(docRef, { estado: aEstado, ...extra, ...this._autoria(user) });
      tx.set(docRef.collection('movimientos').doc(), this._movimiento({
        tipo: tipo || 'cambio_estado', de_estado: de, a_estado: aEstado, ref, notas,
      }, user));
      return { de, a: aEstado };
    });
  },

  // Reserva una unidad en_bodega para un contrato (picker "Tomar del pool").
  // `contrato` = { contrato_doc_id, contrato_id, cliente_id, cliente_nombre }.
  async asignarAContrato(id, contrato, user) {
    return this.cambiarEstado(id, this.ESTADOS.ASIGNADO, {
      esperado: this.ESTADOS.EN_BODEGA,
      tipo: 'asignacion_contrato',
      ref: { tipo: 'contrato', id: contrato.contrato_doc_id, label: contrato.contrato_id || '' },
      extra: {
        asignacion: {
          contrato_doc_id: contrato.contrato_doc_id,
          contrato_id:     contrato.contrato_id || '',
          cliente_id:      contrato.cliente_id || '',
          cliente_nombre:  contrato.cliente_nombre || '',
        },
      },
    }, user);
  },

  // Devuelve una unidad al pool (se soltó de un contrato, o pasó inspección).
  async liberar(id, { ref = null, notas = '' } = {}, user) {
    return this.cambiarEstado(id, this.ESTADOS.EN_BODEGA, {
      tipo: 'liberacion', ref, notas,
      extra: { asignacion: null, orden_actual_id: null, condicion: 'reuso' },
    }, user);
  },

  async darDeBaja(id, motivo, user) {
    return this.cambiarEstado(id, this.ESTADOS.BAJA, {
      tipo: 'baja', notas: motivo,
      extra: { baja_motivo: motivo, asignacion: null, orden_actual_id: null },
    }, user);
  },

  // Confirmación humana de un doc creado por migración automática.
  async verificar(id, user) {
    const db = firebase.firestore();
    return db.collection('equipos_pool').doc(id)
      .update({ verificado: true, ...this._autoria(user) });
  },

  // Corrección de datos de captura (modelo, condición, propiedad, notas, serial).
  async actualizar(id, fields, user) {
    const db = firebase.firestore();
    const permitidos = {};
    ['modelo_id', 'modelo_label', 'condicion', 'propiedad', 'proveedor', 'notas', 'serial']
      .forEach(k => { if (fields[k] !== undefined) permitidos[k] = fields[k]; });
    return db.collection('equipos_pool').doc(id)
      .update({ ...permitidos, ...this._autoria(user) });
  },
};

window.EquiposPoolService = EquiposPoolService;
