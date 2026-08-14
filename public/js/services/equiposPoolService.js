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
    // en_poc ELIMINADO (2026-07-24): POC es la plataforma de airtime, no una
    // ubicación física — la membresía POC vive en poc_device_id, no en estado.
    DEVUELTO:   'devuelto_revision',
    // Ubicación desconocida — ver equiposPool.js (functions) para el criterio.
    POR_CLASIFICAR: 'por_clasificar',
    // Venta directa sin contrato (facturada en QuickBooks): sale de bodega y
    // pasa a propiedad del cliente. No es terminal como baja — el radio
    // vendido puede volver a taller por una orden de servicio.
    VENDIDO:    'vendido',
    BAJA:       'baja',
  },

  // Etiqueta OPERATIVA de cada estado. Una palabra por concepto (auditoría
  // 2026-08-04, A2): `devuelto_revision` decía "Entrada", que ya nombra un TIPO
  // DE ORDEN del taller — tres palabras vecinas (DEVOLUCIÓN el tiquete, ENTRADA
  // la orden, "Entrada" el estado) para tres cosas distintas. El estado pasa a
  // "Devuelto · por inspeccionar", que además calza con el nombre del dato.
  // Si agregas un estado aquí, agrega su color en .eqpool-chip-* (ceco-ui.css).
  ESTADO_LABELS: {
    en_bodega:         'En bodega',
    asignado_contrato: 'Asignado a contrato',
    en_cliente:        'En cliente',
    en_taller:         'En taller',
    en_poc:            'En POC (histórico)', // solo para kardex/docs sin migrar
    devuelto_revision: 'Devuelto · por inspeccionar',
    por_clasificar:    'Por clasificar (ubicación desconocida)',
    vendido:           'Vendido',
    baja:              'Baja',
  },

  // Serial normalizado: mayúsculas, solo [A-Z0-9]. Es el ID del doc (salvo
  // colisión — ver failsafe) y el campo de búsqueda canónico `serial_norm`.
  normalizarSerial(raw) {
    return (raw ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  },

  // 3-30 alfanuméricos Y al menos un dígito. Lo del dígito (2026-07-27): el
  // campo serial se usa de cajón de sastre para lo que no es radio ("CONSOLA"
  // estaba en 55 devices POC de clientes distintos y el pool los colapsaba en
  // una sola ficha; igual "GPS", "DEMO", "MICROFONO"). Sin dígito no es serial
  // y no entra al pool. DUPLICADO en functions/src/domain/equiposPool.js —
  // functions/test/poolNormalizacion.test.js exige que sigan idénticos.
  esSerialValido(serialNorm) {
    return /^[A-Z0-9]{3,30}$/.test(serialNorm) && /\d/.test(serialNorm);
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

  // Chip "pendiente de devolución" (transición renovación/reemplazo). Solo
  // aplica mientras la unidad sigue con el cliente: al registrarse la ENTRADA
  // la unidad pasa a devuelto_revision y el flag deja de mostrarse (no hay
  // limpieza — la condición es computada).
  chipPendienteDevolucionHtml(eq) {
    if (!eq?.pendiente_devolucion) return '';
    if (eq.estado !== this.ESTADOS.EN_CLIENTE && eq.estado !== this.ESTADOS.ASIGNADO) return '';
    return '<span class="eqpool-chip" style="background:#fef3c7;color:#92400e;" title="En transición de renovación/reemplazo — el cliente aún lo tiene; registra su devolución como Entrada">pendiente de devolución</span>';
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

  // Separa los seriales que YA existen en dos grupos: los del mismo modelo
  // (nada que hacer) y los que chocan con otro modelo. Pura a propósito —
  // poolColisionRecepcion.test.js la ejercita sin Firestore.
  //
  // La colisión tiene dos causas que se ven idénticas y terminan distinto:
  //   · serie realmente compartida entre modelos (Kenwood NX-420 / NX-920):
  //     son dos radios físicos → la ficha aparte es correcta.
  //   · modelo mal capturado en el conteo: es el MISMO radio → la ficha aparte
  //     duplica el inventario (2026-07/08: 8 fichas así, 5 en circulación y
  //     una llegó a facturarse).
  // El sistema no puede distinguirlas; quien cuenta, sí. Por eso se devuelven
  // para que la UI pregunte en vez de partir la ficha en silencio.
  clasificarColisiones(items, existentesData, modeloId, modeloLabel) {
    const mismoModelo = [], colisiones = [];
    for (const v of items || []) {
      const data = existentesData.get(v.norm);
      if (!data) continue;
      if (this._mismoModelo(data, modeloId, modeloLabel)) {
        mismoModelo.push(v);
      } else {
        colisiones.push({
          serial: v.raw, norm: v.norm,
          modelo_existente: (data.modelo_label || '').trim() || '(sin modelo)',
          estado_existente: data.estado || '',
        });
      }
    }
    return { mismoModelo, colisiones };
  },

  // Estados desde los que un conteo físico PUEDE traer una unidad de vuelta a
  // bodega. Son las ubicaciones que el sistema cree saber y el estante
  // desmiente. Fuera quedan a propósito:
  //   · baja / vendido → resucitar por una caja de pegado es demasiado; tienen
  //     su propio flujo (revivir) y una decisión detrás.
  //   · devuelto_revision → físicamente SÍ está en el estante, pero sale a
  //     bodega cuando el taller le da "Inspección OK"; adelantarlo la pondría
  //     disponible para entrega sin revisar (convención 2026-08-05).
  REUBICABLES_DESDE: ['asignado_contrato', 'en_cliente', 'en_taller', 'por_clasificar'],

  // De los seriales que YA tienen ficha del mismo modelo, cuáles hay que mover.
  // Pura a propósito, igual que clasificarColisiones.
  //
  // Existe porque la recepción masiva sólo daba de alta lo que NO existía: un
  // conteo de 44 radios que ya tenían ficha decía "44 ya existían" y no movía
  // nada, con lo que bodega no tenía forma de corregir el inventario desde el
  // app (agosto 2026 — los conteos salían por script).
  clasificarReubicacion(items, existentesData) {
    const enBodega = [], reubicables = [], bloqueados = [];
    for (const v of items || []) {
      const data = existentesData.get(v.norm);
      if (!data) continue;
      const estado = data.estado || '';
      if (estado === this.ESTADOS.EN_BODEGA) { enBodega.push(v); continue; }
      const info = {
        serial: v.raw, norm: v.norm, estado,
        cliente: (data.asignacion && data.asignacion.cliente_nombre) || '',
        contrato: (data.asignacion && data.asignacion.contrato_id) || '',
      };
      if (this.REUBICABLES_DESDE.includes(estado)) reubicables.push(info);
      else bloqueados.push(info);
    }
    return { enBodega, reubicables, bloqueados };
  },

  // De lo que YA está en bodega, cuáles tienen la ficha sin modelo. Pura, igual
  // que sus dos hermanas.
  //
  // Una ficha sin modelo es invisible para el inventario: todas las vistas
  // agrupan por `modeloKey`, así que cae en un cubo "(sin modelo)" y no suma
  // bajo ninguno. Contarla tampoco lo arreglaba — `clasificarReubicacion` la
  // manda a `enBodega`, que no escribe nada, y el conteo respondía "ya estaba"
  // dejando el hueco igual. Bodega lo reportó al revés: "está en bodega y en
  // sistema, pero no me deja verificar y no suma en el total".
  //
  // Nacen así las fichas de `migracion_poc` (el device de la plataforma POC no
  // trae modelo): 2,399 en total, 54 de ellas en bodega — corregidas por script
  // el 2026-08-11 cruzándolas contra órdenes y contratos.
  //
  // Completar el modelo es ADOPTAR, no reclasificar: `clasificarColisiones` ya
  // apartó todo lo que tiene OTRO modelo, así que aquí nunca se pisa un dato.
  clasificarSinModelo(items, existentesData) {
    return (items || []).filter(v => {
      const d = existentesData.get(v.norm);
      return !!d && !d.modelo_id && !(d.modelo_label || '').toString().trim();
    });
  },

  // Recepción masiva de un modelo (pegado multilínea / lector de código de
  // barras / import Excel / toma física). Dedup contra la colección con
  // documentId() in (patrón sim_cards); los seriales que ya existen se
  // clasifican con `clasificarColisiones`.
  //
  // Las colisiones NO se escriben en la primera pasada: vuelven en
  // `colisiones_pendientes` para que la UI las confirme una por una. Con
  // `confirmarColisiones: true` (segunda llamada) sí se crean, sufijadas.
  //
  // Los seriales que ya tienen ficha del MISMO modelo pero no están en bodega
  // vuelven igual en `reubicables_pendientes`: contar un radio es afirmar dónde
  // está, así que la UI lo pregunta y con `confirmarReubicacion: true` se los
  // trae a bodega por `corregirABodega` (la misma función que usa la acción en
  // lote de la página — nunca una segunda ruta de escritura).
  // Los que ya están en bodega con la ficha SIN modelo se completan sin
  // preguntar (`clasificarSinModelo`): no hay dato que pisar y era el único
  // caso en que contar una unidad no cambiaba nada.
  // Retorna { nuevos, existentes, colisiones, invalidos, reubicados,
  //           modelo_completado, colisiones_pendientes, reubicables_pendientes,
  //           bloqueados }.
  async recibir(seriales, { modelo_id = null, modelo_label = '', condicion = 'nuevo',
                            proveedor = '', notas = '', origen = 'bodega',
                            confirmarColisiones = false, confirmarReubicacion = false,
                            motivo = '' }, user, onProgress = null) {
    const db = firebase.firestore();
    const resultado = { nuevos: 0, existentes: 0, colisiones: 0, invalidos: 0, reubicados: 0,
      modelo_completado: 0,
      colisiones_pendientes: [], reubicables_pendientes: [], bloqueados: [] };

    const vistos = new Set();
    const validos = [];
    for (const raw of seriales || []) {
      const norm = this.normalizarSerial(raw);
      if (!this.esSerialValido(norm) || vistos.has(norm)) { resultado.invalidos++; continue; }
      vistos.add(norm);
      validos.push({ raw: (raw || '').toString().trim(), norm });
    }
    if (!validos.length) return resultado;

    // Existencia del ID limpio en chunks de 10 (1 lectura por chunk). Se
    // guardan los datos, no solo el id: el modelo de la ficha existente decide
    // si esto es una colisión que hay que consultar.
    const existentes = new Map();
    const chunks = [];
    for (let i = 0; i < validos.length; i += 10) {
      chunks.push(validos.slice(i, i + 10).map(v => v.norm));
    }
    const snaps = await Promise.all(chunks.map(ids =>
      db.collection('equipos_pool')
        .where(firebase.firestore.FieldPath.documentId(), 'in', ids).get()
    ));
    snaps.forEach(snap => snap.docs.forEach(d => existentes.set(d.id, d.data())));

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

    // Los que ya existen: mismo modelo = nada que hacer; modelo distinto =
    // decisión de quien cuenta.
    const yaEstaban = validos.filter(x => existentes.has(x.norm));
    const { mismoModelo, colisiones } = this.clasificarColisiones(
      yaEstaban, existentes, modelo_id, modelo_label);

    // Del mismo modelo: las que ya están en bodega no dan trabajo; las que el
    // sistema tenía en otro lado hay que traerlas — con confirmación.
    const { enBodega, reubicables, bloqueados } =
      this.clasificarReubicacion(mismoModelo, existentes);
    resultado.existentes += enBodega.length;
    resultado.bloqueados = bloqueados;

    // Fichas sin modelo que el conteo puede completar. Se juntan las dos vías:
    // lo que ya estaba en bodega, y lo que la reubicación acaba de traer
    // (`corregirABodega` mueve la unidad pero no le pone modelo).
    const completar = (modelo_id || modelo_label)
      ? this.clasificarSinModelo(enBodega, existentes) : [];

    if (confirmarReubicacion) {
      const nota = motivo || 'Toma física de bodega: la unidad está en el estante';
      for (const v of reubicables) {
        try {
          await this.corregirABodega(v.norm, nota, user);
          resultado.reubicados++;
          if (modelo_id || modelo_label) completar.push(...this.clasificarSinModelo([v], existentes));
        } catch (e) {
          // Otra sesión pudo moverla entre el conteo y la confirmación: se
          // reporta como bloqueada en vez de tumbar la tanda entera.
          bloqueados.push({ ...v, error: e.message || String(e) });
        }
        if (onProgress) onProgress(resultado.reubicados, reubicables.length, 'reubicando');
      }
    } else {
      resultado.reubicables_pendientes = reubicables;
    }

    // Completar el modelo no se pregunta: no se pisa ningún dato (las fichas
    // con OTRO modelo ya salieron por `clasificarColisiones`) y sin esto contar
    // la unidad no cambiaba nada. Queda en el kardex como cualquier corrección.
    for (let i = 0; i < completar.length; i += 200) {
      const batch = db.batch();
      for (const v of completar.slice(i, i + 200)) {
        const ref = db.collection('equipos_pool').doc(v.norm);
        batch.update(ref, { modelo_id, modelo_label, condicion, ...this._autoria(user) });
        batch.set(ref.collection('movimientos').doc(), this._movimiento({
          tipo: 'correccion_modelo',
          de_estado: this.ESTADOS.EN_BODEGA, a_estado: this.ESTADOS.EN_BODEGA,
          notas: `Modelo completado por el conteo: ${modelo_label || modelo_id} (${condicion}).`
            + ' La ficha no tenía modelo.',
        }, user));
      }
      await batch.commit();
      resultado.modelo_completado += Math.min(200, completar.length - i);
    }

    if (!confirmarColisiones) {
      resultado.colisiones_pendientes = colisiones;
      return resultado;
    }

    // Confirmadas: se crean sufijadas por el failsafe de `agregar` (una a una,
    // en transacción — puede haber ya una sufijada de ese mismo modelo).
    for (const c of colisiones) {
      try {
        const r = await this.agregar({
          serial: c.serial, modelo_id, modelo_label, condicion, proveedor, notas, origen,
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
  // Limpia pendiente_devolucion: la unidad ya regresó, el flag de los mapeos
  // de transición cumplió su propósito.
  async liberar(id, { ref = null, notas = '' } = {}, user) {
    return this.cambiarEstado(id, this.ESTADOS.EN_BODEGA, {
      tipo: 'liberacion', ref, notas,
      extra: { asignacion: null, orden_actual_id: null, condicion: 'reuso',
               pendiente_devolucion: firebase.firestore.FieldValue.delete() },
    }, user);
  },

  async darDeBaja(id, motivo, user) {
    return this.cambiarEstado(id, this.ESTADOS.BAJA, {
      tipo: 'baja', notas: motivo,
      extra: { baja_motivo: motivo, asignacion: null, orden_actual_id: null,
               pendiente_devolucion: firebase.firestore.FieldValue.delete() },
    }, user);
  },

  // Reversa de una baja registrada por error: la unidad regresa a bodega como
  // disponible. `esperado: BAJA` — solo se revive lo que está de baja. La baja
  // ya limpió asignación/orden, así que si la unidad seguía comprometida hay
  // que re-asignarla por el flujo normal. El kardex conserva la baja y esta
  // reactivación: la historia completa queda a la vista.
  async reactivar(id, motivo, user) {
    return this.cambiarEstado(id, this.ESTADOS.EN_BODEGA, {
      esperado: this.ESTADOS.BAJA,
      tipo: 'reactivacion', notas: motivo,
      extra: { baja_motivo: null },
    }, user);
  },

  // Corrección de un estado heredado mal por la migración por contacto: el
  // dato fuente estaba viejo (POC nunca devuelto, typo de serial en contrato,
  // orden que no se cerró) y la unidad REALMENTE está en bodega. Único destino
  // permitido: en_bodega — cualquier otro estado real se registra por su flujo
  // normal (seriales de contrato / orden / device POC), que arma los vínculos
  // correctos y pisa el estado heredado en la dirección correcta. Limpia los
  // vínculos falsos, deja movimiento 'correccion_migracion' y marca la unidad
  // como verificada (corregir el estado ES verificarla). No toca `condicion`:
  // la unidad nunca salió de bodega.
  async corregirABodega(id, motivo, user) {
    return this.cambiarEstado(id, this.ESTADOS.EN_BODEGA, {
      tipo: 'correccion_migracion', notas: motivo,
      extra: { asignacion: null, poc_device_id: null, orden_actual_id: null,
               verificado: true,
               pendiente_devolucion: firebase.firestore.FieldValue.delete() },
    }, user);
  },

  // Venta directa sin contrato: la factura ya se emitió en QuickBooks y aquí
  // solo se descuenta la unidad de bodega. `esperado: EN_BODEGA` evita vender
  // dos veces (o vender algo que otro flujo ya movió). La asignación guarda a
  // quién se vendió; cliente_id llega del autocompletado de la página y va
  // vacío solo en ventas por excepción (comprador QBO sin ficha en la app),
  // que quedan marcadas con cliente_excepcion. `venta` conserva el vínculo a
  // la factura.
  async vender(id, { factura = '', cliente_id = '', cliente_nombre = '', cliente_excepcion = false, notas = '' } = {}, user) {
    const fact  = (factura || '').toString().trim();
    const cli   = (cliente_nombre || '').toString().trim();
    const cliId = (cliente_id || '').toString().trim();
    return this.cambiarEstado(id, this.ESTADOS.VENDIDO, {
      esperado: this.ESTADOS.EN_BODEGA,
      tipo: 'venta',
      ref: fact ? { tipo: 'factura_qbo', id: fact, label: fact } : null,
      notas: notas || `Venta directa${cli ? ` a ${cli}` : ''}${fact ? ` — factura QBO ${fact}` : ''}`,
      extra: {
        propiedad: 'cliente',
        asignacion: { contrato_doc_id: null, contrato_id: '', cliente_id: cliId, cliente_nombre: cli },
        venta: {
          factura: fact,
          cliente_id: cliId,
          cliente_nombre: cli,
          cliente_excepcion: !!cliente_excepcion,
          // null explícito (no ausente): el feed "Órdenes por crear" del home
          // consulta == null para hallar ventas sin orden de programación —
          // Firestore no puede consultar "campo ausente". Lo llena
          // vincularOrdenProgramacion; ventas previas al campo no aparecen
          // en el feed (corte legacy).
          orden_programacion_id: null,
          at: firebase.firestore.FieldValue.serverTimestamp(),
        },
      },
    }, user);
  },

  // Amarra la venta con su orden de PROGRAMACIÓN (CTA post-venta en
  // inventario/equipos.html → nueva-orden con ?origen=venta). No cambia el
  // estado — la unidad sigue 'vendido' — solo deja la traza factura↔orden en
  // el doc y una línea en el kardex.
  async vincularOrdenProgramacion(id, ordenId, user) {
    const db = firebase.firestore();
    const ref = db.collection('equipos_pool').doc(id);
    const batch = db.batch();
    batch.update(ref, { 'venta.orden_programacion_id': ordenId, ...this._autoria(user) });
    batch.set(ref.collection('movimientos').doc(), this._movimiento({
      tipo: 'orden_programacion',
      ref: { tipo: 'orden', id: ordenId, label: ordenId },
      notas: `Orden de programación ${ordenId} creada desde la venta`,
    }, user));
    return batch.commit();
  },

  // La venta NO va a generar orden de programación: recepción la saca del feed
  // "Órdenes por crear" del home con un motivo. No cambia el estado — la unidad
  // sigue 'vendido' y la venta sigue sin orden — solo marca que ya se decidió
  // que no la lleva. Se escribe por unidad (una venta = varias unidades) y deja
  // línea en el kardex, igual que vincularOrdenProgramacion: la historia de la
  // unidad debe explicar por qué nunca hubo orden.
  async descartarOrdenProgramacion(id, { motivo = 'otro', nota = '' } = {}, user) {
    const db = firebase.firestore();
    const ref = db.collection('equipos_pool').doc(id);
    const txt = (nota || '').toString().trim();
    const batch = db.batch();
    batch.update(ref, {
      'venta.orden_descartada': {
        motivo,
        nota: txt,
        at: firebase.firestore.FieldValue.serverTimestamp(),
        por: user?.uid || null,
        por_email: user?.email || null,
      },
      ...this._autoria(user),
    });
    batch.set(ref.collection('movimientos').doc(), this._movimiento({
      tipo: 'orden_descartada',
      notas: `No se creará orden de programación para esta venta — ${motivo}${txt ? `: ${txt}` : ''}`,
    }, user));
    return batch.commit();
  },

  // Reversa del descarte: la venta vuelve al feed "Órdenes por crear".
  async reactivarOrdenProgramacion(id, user) {
    const db = firebase.firestore();
    const ref = db.collection('equipos_pool').doc(id);
    const batch = db.batch();
    batch.update(ref, {
      'venta.orden_descartada': firebase.firestore.FieldValue.delete(),
      ...this._autoria(user),
    });
    batch.set(ref.collection('movimientos').doc(), this._movimiento({
      tipo: 'orden_descartada',
      notas: 'Descarte revertido: la venta vuelve a pedir orden de programación',
    }, user));
    return batch.commit();
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

  // ── Correcciones CON kardex ──────────────────────────────────────────
  // `actualizar` de arriba pisa el dato y no deja rastro: sirve para arreglar
  // un typo recién capturado, no para cambiar qué ES una unidad o de quién.
  // Estas tres escriben el movimiento en la misma tanda, con los MISMOS tipos
  // que usan los scripts equivalentes (repunta-modelo-lista, corrige-propiedad
  // -lista, anota-lista) para que el kardex se lea igual venga de donde venga.
  // Sin la nota, el próximo backfill vuelve a "corregir" al revés.

  _conKardex(id, campos, mov, user) {
    const db = firebase.firestore();
    const ref = db.collection('equipos_pool').doc(id);
    const batch = db.batch();
    batch.update(ref, { ...campos, ...this._autoria(user) });
    batch.set(ref.collection('movimientos').doc(), this._movimiento(mov, user));
    return batch.commit();
  },

  // Corrige un serial mal transcrito SIN partir la historia (auditoría UX
  // 2026-08-13): el remedio anterior era baja + alta, que dejaba el kardex
  // repartido en dos fichas. El doc conserva su ID — un ID viejo es tolerado
  // porque la búsqueda canónica es por el CAMPO serial_norm (ver failsafe de
  // colisión arriba) — y se reescriben serial + serial_norm EN LA MISMA tanda
  // (ningún trigger los re-deriva: dejar serial_norm viejo rompería
  // findBySerial para el serial corregido).
  async corregirSerial(id, serialNuevo, motivo, user) {
    const serial = String(serialNuevo || '').trim();
    const norm = this.normalizarSerial(serial);
    if (!norm) throw new Error('Serial vacío o inválido.');
    if (!/\d/.test(norm)) throw new Error('El serial debe contener al menos un dígito.');
    // Si el serial corregido ya existe en OTRA ficha, esto no es un typo:
    // es un duplicado a fusionar, no a pisar.
    const existentes = await this.findBySerial(serial);
    const choque = (existentes || []).find(d => d.id !== id);
    if (choque) {
      throw new Error(`Ya existe una ficha con ese serial (${choque.modelo_label || choque.modelo_id || 'modelo ?'} · estado ${choque.estado || '?'}). Si son la misma unidad hay que fusionarlas, no corregir el serial.`);
    }
    const ref = firebase.firestore().collection('equipos_pool').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('La ficha ya no existe.');
    const d = snap.data();
    return this._conKardex(id,
      { serial, serial_norm: norm },
      { tipo: 'correccion_serial', de_estado: d.estado || null, a_estado: d.estado || null,
        notas: `Serial corregido: ${d.serial || '¿?'} → ${serial}.` + (motivo ? ` ${motivo}` : '') },
      user);
  },

  // Cambia QUÉ es la unidad. La condición la impone la fila del catálogo (-R →
  // reuso), nunca se elige aparte: una ficha no puede decir "reuso" con un
  // modelo que el catálogo tiene como nuevo.
  // `estadoActual` solo alimenta el movimiento; no se toca dónde está la unidad.
  async reclasificarModelo(id, { modelo_id, modelo_label, condicion, estadoActual = null, antes = '' }, motivo, user) {
    return this._conKardex(id,
      { modelo_id: modelo_id || null, modelo_label: (modelo_label || '').trim(), condicion },
      { tipo: 'correccion_modelo', de_estado: estadoActual, a_estado: estadoActual,
        notas: `Reclasificado a ${modelo_label} (${condicion}).`
          + (antes ? ` Antes: ${antes}.` : '') + (motivo ? ` ${motivo}` : '') },
      user);
  },

  // Cambia de QUIÉN es. El motivo no es decorativo: es la única memoria de por
  // qué, y la regla 4 de backfill-propiedad.js marcó "del cliente" todo radio
  // que entró solo por una orden de servicio — 47 fichas en bodega así.
  async corregirPropiedad(id, propiedad, { estadoActual = null, antes = '' } = {}, motivo, user) {
    return this._conKardex(id, { propiedad },
      { tipo: 'correccion_propiedad', de_estado: estadoActual, a_estado: estadoActual,
        notas: `Propiedad ${antes || '(vacía)'} → ${propiedad}.` + (motivo ? ` ${motivo}` : '') },
      user);
  },

  // Nota visible en la ficha, para lo que el conteo observa y el pool no
  // modela — el caso que lo motivó son las bases marcadas DAÑADA: el radio
  // está en el estante (así que va a bodega como cualquiera) pero no sirve, y
  // eso no cabe en `estado`, que es una ubicación.
  async anotar(id, nota, { estadoActual = null, antes = '' } = {}, user) {
    return this._conKardex(id, { notas: (nota || '').toString().trim() },
      { tipo: 'nota', de_estado: estadoActual, a_estado: estadoActual,
        notas: (nota || '') + (antes ? ` (antes: "${antes}")` : '') },
      user);
  },
};

window.EquiposPoolService = EquiposPoolService;
