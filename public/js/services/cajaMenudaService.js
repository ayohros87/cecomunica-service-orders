// @ts-nocheck
// Caja menuda — lecturas y escrituras de caja_menuda/{id}.
//
// Cada escritura mueve el estado y agrega UNA entrada al historial firmada
// por quien escribe: es lo que exigen las reglas (match /caja_menuda). Qué
// puede hacer cada quien lo decide domain/cajaMenuda.js (acciones) y lo
// confirman las reglas; aquí no se repite.
//
// `numero` (CM-0001) no se escribe desde aquí: lo pone el servidor al crear
// (onCajaMenudaWrite), junto con los correos de aviso.
window.CajaMenudaService = (() => {
  const COL = 'caja_menuda';
  const db = () => firebase.firestore();
  const FV = () => firebase.firestore.FieldValue;
  const ahora = () => firebase.firestore.Timestamp.now();
  const C = () => window.CajaMenuda;

  let _yo = null; // { uid, rol, nombre, email }

  function usar(yo) { _yo = yo; }
  function yo() {
    if (!_yo || !_yo.uid) throw new Error('Sin sesión.');
    return _yo;
  }

  const paso = (accion, nota) => {
    const p = { at: ahora(), por_uid: yo().uid, por_nombre: yo().nombre || '', accion };
    if (nota) p.nota = String(nota).slice(0, 300);
    return p;
  };
  const firma = () => ({ por_uid: yo().uid, por_nombre: yo().nombre || '', at: ahora() });
  const mover = (id, campos, accion, nota) => db().collection(COL).doc(id).update({
    ...campos,
    historial: FV().arrayUnion(paso(accion, nota)),
    updated_at: FV().serverTimestamp(),
  });

  // ── Configuración y jefe ────────────────────────────────────────────────
  async function config() {
    const leer = async () => {
      const s = await db().collection('empresa').doc('caja_menuda').get();
      return s.exists ? s.data() : {};
    };
    const crudo = window.Sesion?.memo ? await Sesion.memo('caja_menuda:config', 10 * 60 * 1000, leer) : await leer();
    return C().config(crudo);
  }

  async function guardarConfig(cfg) {
    const c = C().config(cfg);
    await db().collection('empresa').doc('caja_menuda').set({
      ...c, updated_at: FV().serverTimestamp(), updated_by: yo().uid,
    }, { merge: true });
    if (window.Sesion?.olvidar) Sesion.olvidar('caja_menuda:config');
    return c;
  }

  // Quién aprueba lo que pida esta persona: el jefe que administración le
  // asignó en Usuarios. Sin jefe → { uid: null } y aprueba administración.
  async function miJefe() {
    const u = await db().collection('usuarios').doc(yo().uid).get();
    const jefeUid = (u.exists && u.data().jefe_uid) || null;
    if (!jefeUid) return { uid: null, nombre: null };
    const j = await db().collection('usuarios').doc(jefeUid).get();
    return { uid: jefeUid, nombre: (j.exists && (j.data().nombre || j.data().email)) || null };
  }

  // ── Fotos de la factura ─────────────────────────────────────────────────
  // Foto a JPEG de 1600 px: un celular saca 4–8 MB y aquí basta con que la
  // factura se lea. El PDF sube tal cual.
  async function _comprimir(file, maxLado = 1600, calidad = 0.8) {
    const url = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const esc = Math.min(1, maxLado / Math.max(img.width || maxLado, img.height || maxLado));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('No se pudo leer la foto.'))), 'image/jpeg', calidad));
  }

  async function subirRecibo(file) {
    const esPdf = file.type === 'application/pdf';
    if (!esPdf && !/^image\//.test(file.type || '')) throw new Error('La factura tiene que ser una foto o un PDF.');
    const cuerpo = esPdf ? file : await _comprimir(file);
    if (cuerpo.size >= 10 * 1024 * 1024) throw new Error('El archivo pasa de 10 MB.');
    const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${esPdf ? 'pdf' : 'jpg'}`;
    const path = `caja_menuda_recibos/${yo().uid}/${nombre}`;
    await firebase.storage().ref(path).put(cuerpo, { contentType: esPdf ? 'application/pdf' : 'image/jpeg' });
    return { path, tipo: esPdf ? 'application/pdf' : 'image/jpeg', nombre: String(file.name || '').slice(0, 80) };
  }

  const _urls = new Map();
  function urlRecibo(path) {
    if (!_urls.has(path)) {
      const p = firebase.storage().ref(path).getDownloadURL();
      p.catch(() => _urls.delete(path));
      _urls.set(path, p);
    }
    return _urls.get(path);
  }

  // ── Lecturas ────────────────────────────────────────────────────────────
  const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  const deSnap = (s) => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const recientesPrimero = (a) => a.sort((x, y) => ms(y.created_at) - ms(x.created_at));

  async function get(id) {
    const d = await db().collection(COL).doc(id).get();
    return d.exists ? { id: d.id, ...d.data() } : null;
  }

  async function mios() {
    const s = await db().collection(COL).where('solicitante_uid', '==', yo().uid).get();
    return recientesPrimero(deSnap(s));
  }

  // Lo que espera MI aprobación: lo de mi gente y, si soy de administración,
  // todo lo solicitado (suplencia y los que no tienen jefe). Nunca lo mío.
  async function porAprobar() {
    const q = yo().rol === 'administrador'
      ? db().collection(COL).where('estado', '==', 'solicitado')
      : db().collection(COL).where('aprobador_uid', '==', yo().uid).where('estado', '==', 'solicitado');
    const s = await q.get();
    return deSnap(s).filter(g => g.solicitante_uid !== yo().uid)
      .sort((x, y) => ms(x.created_at) - ms(y.created_at)); // lo más viejo arriba
  }

  // Bandeja del custodio: todo lo abierto + lo terminado desde `desde` (Date).
  async function bandeja({ desde = null } = {}) {
    const abiertosP = db().collection(COL).where('estado', 'in', C().ABIERTOS).get();
    const cerradosP = desde
      ? db().collection(COL).where('created_at', '>=', desde).get()
      : Promise.resolve(null);
    const [a, c] = await Promise.all([abiertosP, cerradosP]);
    const porId = new Map();
    for (const g of deSnap(a)) porId.set(g.id, g);
    if (c) for (const g of deSnap(c)) porId.set(g.id, g);
    return recientesPrimero([...porId.values()]);
  }

  // ── Escrituras ──────────────────────────────────────────────────────────
  const limpio = (s, max) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, max);

  function _contenido(f, cfg) {
    const monto = C().num(f.monto);
    return {
      via: C().via(f.tipo, monto, cfg),
      monto,
      concepto: limpio(f.concepto, 300),
      categoria: f.categoria,
      proveedor: limpio(f.proveedor, 120),
      fecha_gasto: f.tipo === 'reembolso' ? f.fecha_gasto : '',
      factura_numero: limpio(f.factura_numero, 40),
      recibos: (f.recibos || []).map(r => ({ path: r.path, tipo: r.tipo, nombre: r.nombre || '' })),
    };
  }

  // `f.recibos` ya vienen subidos (subirRecibo). Devuelve el id nuevo.
  async function crear(f) {
    const cfg = await config();
    const errores = C().validar(f, cfg, { hoyISO: FMT.hoyISOPanama() });
    if (errores.length) throw new Error(errores[0]);
    const jefe = await miJefe();
    const ref = await db().collection(COL).add({
      solicitante_uid: yo().uid,
      solicitante_nombre: yo().nombre || '',
      solicitante_email: yo().email || '',
      aprobador_uid: jefe.uid,
      aprobador_nombre: jefe.nombre,
      tipo: f.tipo,
      estado: 'solicitado',
      ..._contenido(f, cfg),
      historial: [paso('solicitado')],
      created_at: FV().serverTimestamp(),
      updated_at: FV().serverTimestamp(),
    });
    return ref.id;
  }

  async function editar(id, f) {
    const cfg = await config();
    const errores = C().validar(f, cfg, { hoyISO: FMT.hoyISOPanama() });
    if (errores.length) throw new Error(errores[0]);
    return mover(id, _contenido(f, cfg), 'editado');
  }

  const anular = (id) => mover(id, { estado: 'anulado' }, 'anulado');
  const aprobar = (id) => mover(id, { estado: 'aprobado', aprobacion: firma() }, 'aprobado');

  function rechazar(id, motivo) {
    const m = limpio(motivo, 300);
    if (m.length < 3) throw new Error('Escribe el motivo.');
    return mover(id, { estado: 'rechazado', rechazo: { ...firma(), motivo: m } }, 'rechazado', m);
  }

  // Paga un reembolso (efectivo del fondo, o ACH con su referencia) o entrega
  // el efectivo de un anticipo.
  function entregar(g, { monto, referencia = '' } = {}) {
    const m = C().num(monto);
    if (!(m > 0)) throw new Error('Escribe el monto.');
    const metodo = g.via === 'ach' ? 'ach' : 'efectivo';
    const ref = limpio(referencia, 60);
    if (metodo === 'ach' && !ref) throw new Error('Escribe la referencia del ACH.');
    const estado = g.tipo === 'anticipo' ? 'entregado' : 'pagado';
    return mover(g.id, { estado, entrega: { ...firma(), monto: m, metodo, referencia: ref } },
      estado, metodo === 'ach' ? `ACH ${ref}` : '');
  }

  // Quien recibió el anticipo dice cuánto gastó y sube la factura.
  function rendir(g, { monto_gastado, recibos, nota = '' } = {}) {
    const r = C().rendicion(g.entrega?.monto, monto_gastado);
    if (!r) throw new Error('Escribe cuánto gastaste.');
    const lista = [...(g.recibos || []), ...(recibos || [])];
    if (!lista.length) throw new Error('Falta la foto de la factura.');
    if (lista.length > C().MAX_RECIBOS) throw new Error(`Máximo ${C().MAX_RECIBOS} fotos.`);
    return mover(g.id, {
      estado: 'rendido',
      rendicion: { ...r, at: ahora(), nota: limpio(nota, 300) },
      recibos: lista.map(x => ({ path: x.path, tipo: x.tipo, nombre: x.nombre || '' })),
    }, 'rendido');
  }

  // Al cerrar vuelve el vuelto al fondo, o sale la diferencia si la persona
  // gastó más de lo que se le entregó.
  function cerrar(g, { vuelto_recibido = 0, diferencia_pagada = 0 } = {}) {
    const v = C().num(vuelto_recibido), d = C().num(diferencia_pagada);
    if (!(v >= 0) || !(d >= 0)) throw new Error('Escribe el monto (0 si no hubo).');
    return mover(g.id, { estado: 'cerrado', cierre: { ...firma(), vuelto_recibido: v, diferencia_pagada: d } }, 'cerrado');
  }

  function devolverRendicion(id, motivo) {
    const m = limpio(motivo, 300);
    if (m.length < 3) throw new Error('Escribe qué falta.');
    return mover(id, { estado: 'entregado', rendicion_devuelta: { ...firma(), motivo: m } }, 'rendición devuelta', m);
  }

  const reclasificar = (id, categoria) => mover(id, { categoria }, 'reclasificado', categoria);

  return {
    usar, config, guardarConfig, miJefe, subirRecibo, urlRecibo,
    get, mios, porAprobar, bandeja,
    crear, editar, anular, aprobar, rechazar, entregar, rendir, cerrar, devolverRendicion, reclasificar,
  };
})();
