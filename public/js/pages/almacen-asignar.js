// @ts-nocheck
/* =============================================================
   Almacén · Asignar — la herramienta de bodega para poner seriales.
   (Propuesta "Asignar desde Almacén" 2026-09-03, F1 + F2.)

   Antes bodega asignaba en dos pantallas ajenas: contratos/seriales.html
   (módulo Contratos, validación suave) y la ficha 360 del cliente para
   aumentos, reemplazos y demos (validación dura, sin picker). Aquí las dos
   colas se trabajan en el mismo sitio con el mismo formulario
   (js/ui/asignador-seriales.js) y UNA política: el serial existe en el
   inventario, está en bodega y es del modelo pedido.

   Izquierda: la cola (la misma lista de Hoy). Derecha: el trabajo. El
   encabezado dice qué sacar del estante y cuánto hay, no quién es el cliente.

   Escrituras: exactamente las de siempre. Contratos → subcolecciones
   seriales / seriales_estado (el pool lo mueve onSerialWrite). Gestiones →
   GestionesService.asignarAumento / asignarDemo / asignarItems (el pool y la
   OS los mueve onGestionWrite). Ningún trigger ni regla cambió.
   ============================================================= */

window.AlmacenAsignar = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const $ = (id) => document.getElementById(id);
  const norm = (s) => (typeof ContratosService !== 'undefined' && ContratosService._serialKey)
    ? ContratosService._serialKey(s)
    : EquiposPoolService.normalizarSerial(s);
  const db = () => firebase.firestore();
  const toast = (m, k) => { if (window.Toast) Toast.show(m, k); };

  const st = {
    rol: '', cargado: false, cargando: null,
    items: [],            // la cola: [{tipo:'contrato'|'cambio'|'gestion', id, ...}]
    sel: null,            // {tipo, id}
    asignador: null,      // instancia del componente para el trabajo abierto
    trabajo: null,        // contexto del trabajo abierto
    bodega: null,         // cache de en_bodega {t, lista}
    cerrados: new Map(),  // 'tipo:id' → ms en que se cerró desde esta pestaña
  };

  const TIPO_G = { aumento: 'Aumento', reemplazo: 'Reemplazo', demo: 'Demo' };

  function puedeAsignarGestion() {
    return st.rol === ROLES.ADMIN || st.rol === ROLES.INVENTARIO;
  }
  function puedeAsignarContrato() {
    return (typeof canRole === 'function') ? canRole(st.rol, 'gestionar-seriales') : puedeAsignarGestion();
  }

  // ── Entrada ───────────────────────────────────────────────────────────
  // activar({contrato, g}): carga la cola (una vez) y abre el deep-link o el
  // primero de la cola. Lo llama AlmacenPage.setTab('asignar') y el init.
  async function activar({ contrato = null, g = null, forzar = false } = {}) {
    st.rol = window.userRole || st.rol;
    if (!st.cargado || forzar) await cargarCola();
    if (contrato) return abrirContrato(contrato);
    if (g) return abrirGestion(g);
    if (!st.sel && st.items.length) return seleccionar(st.items[0]);
    if (!st.sel) renderTrabajoVacio();
  }

  async function cargarCola() {
    if (st.cargando) return st.cargando;
    st.cargando = (async () => {
      const [colas, gestiones] = await Promise.all([
        ColaInventarioService.todo().catch(e => { console.warn('[Asignar] colas:', e?.code || e); return { seriales: [], cambios: [], transiciones: [], fallidas: ['seriales', 'cambios'] }; }),
        (window.AlmacenHoy?.cargarGestionesBodega ? AlmacenHoy.cargarGestionesBodega() : Promise.resolve([]))
          .catch(e => { console.warn('[Asignar] gestiones:', e?.code || e); return null; }),
      ]);
      const items = [];
      (colas.seriales || []).forEach(r => items.push({
        tipo: 'contrato', id: r.doc_id, titulo: r.contrato_id, cliente: r.cliente_nombre,
        sub: `${r.accion || 'Contrato'} · ${r.cliente_nombre} · ${resumenEquipos(r.equipos)}`,
        n: `${r.resueltos} / ${r.unidades}`, listo: r.resueltos >= r.unidades && r.unidades > 0, at: r.at,
      }));
      (colas.cambios || []).forEach(r => items.push({
        tipo: 'cambio', id: r.doc_id, titulo: r.contrato_id, cliente: r.cliente_nombre,
        sub: `Cambio de serial · ${r.cliente_nombre} · ${(r.cambio?.items || []).map(i => i.serial || '—').join(', ')}`,
        n: String((r.cambio?.items || []).length), at: r.at, cambio: r.cambio,
      }));
      (gestiones || []).forEach(g => {
        const lineas = g.tipo === 'reemplazo'
          ? `${(g.items || []).length} reemplazo(s)`
          : resumenEquipos((g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || []);
        const total = g.tipo === 'reemplazo' ? (g.items || []).length
          : ((g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
        const hechos = g.tipo === 'reemplazo'
          ? (g.items || []).filter(i => i.serial_nuevo).length
          : ((g.tipo === 'demo' ? g.demo?.seriales_asignados : g.aumento?.seriales_asignados) || []).filter(s => String(s.serial || '').trim()).length;
        items.push({
          tipo: 'gestion', id: g.id, titulo: g.id, cliente: g.cliente_nombre || '—',
          sub: `${TIPO_G[g.tipo] || g.tipo} · ${g.cliente_nombre || '—'} · ${lineas}${g.tipo === 'aumento' && g.estado === 'pendiente_firma' ? ' · firma en paralelo' : ''}`,
          n: `${hechos} / ${total}`, at: g._at || 0, g,
        });
      });
      items.sort((a, b) => (a.at || 0) - (b.at || 0));
      // Lo recién cerrado desde aquí sale de la cola aunque el trigger que
      // actualiza el contrato/gestión tarde unos segundos en correr.
      const ahora = Date.now();
      st.items = items.filter(i => {
        const t = st.cerrados.get(`${i.tipo}:${i.id}`) || st.cerrados.get(`*:${i.id}`);
        return !(t && ahora - t < 60 * 1000);
      });
      st.cargado = true;
      st.fallidas = [...(colas.fallidas || []), ...(gestiones === null ? ['gestiones'] : [])];
      renderCola();
      if (window.WorkspaceTabs) WorkspaceTabs.setBadge('asignar', items.length);
    })();
    try { await st.cargando; } finally { st.cargando = null; }
  }

  function resumenEquipos(equipos) {
    return (equipos || []).filter(e => Number(e.cantidad || 0) > 0)
      .map(e => `${Number(e.cantidad)} × ${e.modelo || '?'}`).join(', ') || 'sin equipos';
  }

  // ── Cola (izquierda) ──────────────────────────────────────────────────
  function renderCola() {
    const el = $('asCola');
    if (!el) return;
    const porAsignar = st.items.filter(i => i.tipo !== 'cambio');
    const cambios = st.items.filter(i => i.tipo === 'cambio');
    const fila = (it) => `
      <button type="button" class="as-item${st.sel && st.sel.tipo === it.tipo && st.sel.id === it.id ? ' is-on' : ''}"
              data-tipo="${esc(it.tipo)}" data-id="${esc(it.id)}">
        <span class="as-item-t">${esc(it.titulo)}</span>
        <span class="as-item-n${it.listo ? ' ok' : ''}">${esc(it.n)}</span>
        <span class="as-item-s">${esc(it.sub)}</span>
      </button>`;
    const aviso = (st.fallidas || []).length
      ? `<p class="hy-nota" style="margin:8px 12px;">No se pudo leer: ${st.fallidas.join(', ')}.</p>` : '';
    el.innerHTML = `
      <div class="as-cola-h"><span>Por asignar</span><span>${porAsignar.length}</span></div>
      ${porAsignar.map(fila).join('') || '<p class="as-cola-vacio">Nada por asignar. Bodega al día.</p>'}
      ${cambios.length ? `<div class="as-cola-h" style="border-top:1px solid var(--border-default);"><span>Cambio de serial</span><span>${cambios.length}</span></div>${cambios.map(fila).join('')}` : ''}
      ${aviso}`;
  }

  function onClickCola(e) {
    const btn = e.target.closest('.as-item');
    if (!btn) return;
    const it = st.items.find(i => i.tipo === btn.dataset.tipo && i.id === btn.dataset.id);
    if (it) seleccionar(it);
  }

  function seleccionar(it) {
    if (it.tipo === 'gestion') return abrirGestion(it.id);
    return abrirContrato(it.id);
  }

  function marcarSel(tipo, id) {
    st.sel = { tipo, id };
    renderCola();
    try {
      const url = new URL(location.href);
      url.searchParams.set('tab', 'asignar');
      url.searchParams.delete('contrato'); url.searchParams.delete('g');
      url.searchParams.set(tipo === 'gestion' ? 'g' : 'contrato', id);
      history.replaceState(null, '', url);
    } catch { /* ok */ }
  }

  // ── Stock en bodega por modelo (picklist) ─────────────────────────────
  async function enBodega() {
    if (st.bodega && Date.now() - st.bodega.t < 2 * 60 * 1000) return st.bodega.lista;
    const lista = await EquiposPoolService.listar({ estado: EquiposPoolService.ESTADOS.EN_BODEGA });
    st.bodega = { t: Date.now(), lista };
    return lista;
  }
  function invalidarBodega() { st.bodega = null; }

  async function picklistHtml(grupos) {
    let lista = [];
    try { lista = await enBodega(); } catch (e) { console.warn('[Asignar] stock:', e?.code || e); }
    const chips = grupos.map(g => {
      const disp = lista.filter(u => EquiposPoolService._mismoModelo(u, g.modelo_id || null, g.modelo || '')).length;
      const faltan = Math.max(0, Number(g.activos || 0) - (g.slots || []).filter(s => s.serial || s.omitido).length);
      const corto = disp < faltan;
      return `<div class="as-pl${corto ? ' short' : ''}">
        <b>${Number(g.activos || 0)} × ${esc(g.modelo)}</b>
        <small>${disp} en bodega${corto ? ` · faltan ${faltan - disp}` : ''}</small></div>`;
    }).join('');
    return `<div class="as-picklist">${chips}</div>`;
  }

  // ── Trabajo (derecha) ─────────────────────────────────────────────────
  function renderTrabajoVacio() {
    const el = $('asTrabajo');
    if (!el) return;
    el.innerHTML = `<div class="as-vacio"><i data-lucide="check-circle-2"></i><p>Nada por asignar. Cuando un contrato o una gestión espere seriales, aparece aquí.</p></div>`;
    if (window.lucide) lucide.createIcons();
  }

  function cascaron({ titulo, sub, pill, pillCls }) {
    const el = $('asTrabajo');
    el.innerHTML = `
      <div class="as-work-h">
        <div>
          <div class="as-work-t">${titulo}</div>
          <div class="as-work-s">${sub}</div>
        </div>
        ${pill ? `<span class="hy-chip hy-chip--${pillCls || 'seriales'}">${esc(pill)}</span>` : ''}
      </div>
      <div id="asPicklist"></div>
      <div id="asBanner"></div>
      <div id="asToolbar" class="as-toolbar"></div>
      <div id="asBody"></div>
      <div id="asFoot" class="as-foot" style="display:none;">
        <span class="as-foot-prog" id="asProg">0 / 0</span>
        <span style="flex:1;"></span>
        <span id="asFootBtns" style="display:flex; gap:8px; align-items:center;"></span>
      </div>`;
    return el;
  }

  function hace(ms) {
    if (!ms) return '';
    const d = Math.floor((Date.now() - ms) / 86400000);
    return d === 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`;
  }

  function banner(kind, html) {
    const s = { info: ['#BFDBFE', '#EFF6FF', '#1E3A8A', 'info'], warn: ['#FCD34D', '#FFFBEB', '#92400E', 'lock'], ok: ['#A7F3D0', '#ECFDF5', '#065F46', 'check-circle-2'] }[kind] || [];
    return `<div style="margin-bottom:var(--sp-3,12px);padding:12px 14px;border:1px solid ${s[0]};background:${s[1]};color:${s[2]};border-radius:10px;display:flex;gap:8px;align-items:flex-start;font-size:14px;">
      <i data-lucide="${s[3]}" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div>${html}</div></div>`;
  }

  function crearAsignador(opciones) {
    st.asignador = AsignadorSeriales.crear({
      body: $('asBody'),
      norm,
      politica: 'dura',
      tituloPicker: 'Tomar del estante',
      origenPicker: 'el estante',
      onChange: ({ done, req }) => { const p = $('asProg'); if (p) p.textContent = `${done} / ${req}`; },
      ...opciones,
    });
    return st.asignador;
  }

  function toolbar(botones) {
    const tb = $('asToolbar');
    tb.innerHTML = botones.join('')
      + '<span style="font-size:12px; color:var(--fg-3);">o teclea cada serial abajo — también puedes pegar una columna de Excel sobre la primera casilla.</span>';
  }

  function footer(botones) {
    const f = $('asFoot');
    const b = $('asFootBtns');
    b.innerHTML = botones.join('');
    f.style.display = botones.length ? '' : 'none';
  }

  /* ═════════ CONTRATO ═════════ */

  async function abrirContrato(docId) {
    const item = st.items.find(i => (i.tipo === 'contrato' || i.tipo === 'cambio') && i.id === docId);
    marcarSel(item?.tipo || 'contrato', docId);
    const el = cascaron({ titulo: 'Cargando…', sub: '' });
    let contrato;
    try { contrato = await ContratosService.getContrato(docId); } catch (e) { console.error(e); }
    if (!contrato) { el.innerHTML = '<div class="as-vacio"><p>No se encontró el contrato.</p></div>'; return; }

    let guardados = [], omisiones = [], estadoSenal = '';
    try { guardados = await ContratosService.getSerialesManual(docId); } catch (e) { /* ok */ }
    try {
      const sig = await db().collection('contratos').doc(docId).collection('seriales_estado').doc('current').get();
      if (sig.exists) { const sd = sig.data() || {}; if (Array.isArray(sd.omisiones)) omisiones = sd.omisiones; estadoSenal = sd.estado || ''; }
    } catch (e) { /* ok */ }

    const esLegacy = contrato.seriales_estado === 'legacy';
    const yaAsignados = !esLegacy && (estadoSenal === 'asignados' || contrato.seriales_estado === 'asignados');

    // Solicitud de cambio de serial pendiente → modo reemplazo.
    let cambioReq = null;
    if (yaAsignados) {
      try {
        const qs = await db().collection('contratos').doc(docId).collection('seriales_cambios').where('estado', '==', 'pendiente').get();
        if (!qs.empty) {
          const docs = qs.docs.map(d => ({ id: d.id, ...d.data() }));
          docs.sort((a, b) => (b.solicitado_at?.toMillis?.() || 0) - (a.solicitado_at?.toMillis?.() || 0));
          const r = docs[0];
          cambioReq = { id: r.id, items: Array.isArray(r.items) ? r.items : [], motivo: r.motivo || '', motivo_tipo: r.motivo_tipo || '' };
        }
      } catch (e) { /* ok */ }
    }
    const cambioSet = new Set((cambioReq?.items || []).map(i => norm(i.serial)).filter(Boolean));
    const modoReemplazo = !!cambioReq && cambioSet.size > 0;

    const ctxC = {
      docId, contrato, guardados, omisiones, esLegacy, yaAsignados, cambioReq, cambioSet, modoReemplazo,
      contratoIdVisible: contrato.contrato_id || docId,
      clienteId: contrato.cliente_id || '',
      clienteNombre: contrato.cliente_nombre || '',
    };
    st.trabajo = { tipo: 'contrato', ...ctxC };

    const grupos = gruposDelContrato(ctxC);
    const unidades = grupos.reduce((s, g) => s + g.activos, 0);
    cascaron({
      titulo: `${esc(ctxC.contratoIdVisible)} · ${unidades} equipo${unidades === 1 ? '' : 's'}`,
      sub: `${esc(contrato.accion || 'Contrato')} · ${esc(ctxC.clienteNombre || 'Cliente')}`
        + (contrato.fecha_aprobacion?.toMillis ? ` · aprobado ${hace(contrato.fecha_aprobacion.toMillis())}` : ''),
      pill: modoReemplazo ? 'Cambio de serial' : yaAsignados ? 'Listo para programar' : esLegacy ? 'Histórico' : 'Por asignar',
      pillCls: modoReemplazo ? 'cambio' : yaAsignados ? 'ok' : 'seriales',
    });

    const locked = yaAsignados && !modoReemplazo;
    if (!locked) $('asPicklist').innerHTML = await picklistHtml(grupos);

    const asg = crearAsignador({
      contratoDocId: docId, clienteId: ctxC.clienteId, esLegacy,
      permitirOmitir: !modoReemplazo,
      politica: esLegacy ? 'suave' : 'dura',
      textoVacio: 'Este contrato no tiene unidades activas que serializar.',
    });
    asg.setGuardados(guardados);
    const hay = asg.render(grupos);

    if (locked) {
      $('asBanner').innerHTML = banner('ok', `<strong>Seriales listos.</strong> Este contrato ya pasó a programación${contrato.seriales_asignados_at?.toMillis ? ` (${hace(contrato.seriales_asignados_at.toMillis())})` : ''}. Para corregir un serial, recepción crea una <strong>solicitud de cambio</strong> y vuelve a aparecer aquí.`);
      asg.setLocked(true);
      footer([]);
    } else if (modoReemplazo) {
      const m = cambioReq.motivo_tipo ? ` (${esc(cambioReq.motivo_tipo)}${cambioReq.motivo ? ' — ' + esc(cambioReq.motivo) : ''})` : '';
      $('asBanner').innerHTML = banner('info', `<strong>Solicitud de cambio de serial${m}.</strong> Reemplaza los ${cambioSet.size} serial(es) resaltados. Los demás quedan bloqueados.`);
      asg.setLocked(true);
      $('asBody').querySelectorAll('.serial-input[data-reemplazo]').forEach(inp => { inp.disabled = false; });
      toolbar([]);
      footer([`<button type="button" class="btn btn-primary" data-as="reemplazo"><i data-lucide="replace"></i> Guardar reemplazo</button>`]);
    } else {
      if (esLegacy) $('asBanner').innerHTML = banner('info', '<strong>Contrato histórico.</strong> Los seriales quedan registrados para referencia; no se envía nada a activaciones.');
      if (!puedeAsignarContrato()) {
        $('asBanner').innerHTML += banner('warn', 'Tu rol no asigna seriales. Puedes ver el avance, no guardarlo.');
        asg.setLocked(true);
        footer([]);
      } else if (hay) {
        const continuan = (contrato.transicion_plan?.nivel === 'serial')
          ? (contrato.transicion_plan.unidades || []).filter(u => u.destino === 'continua') : [];
        toolbar([
          continuan.length
            ? `<button type="button" class="btn btn-primary btn-sm" data-as="traer-original" title="El plan de la venta dice que ${continuan.length} unidad(es) del contrato original continúan en este."><i data-lucide="repeat"></i> Traer del original (${continuan.length} continúan)</button>` : '',
          `<button type="button" class="btn ${continuan.length ? 'btn-ghost' : 'btn-primary'} btn-sm" data-as="tomar" title="Escoge unidades disponibles en bodega. Es la vía normal."><i data-lucide="scan-barcode"></i> Tomar del estante</button>`,
        ]);
        footer([
          `<button type="button" class="btn btn-ghost" data-as="guardar"><i data-lucide="save"></i> Guardar avance</button>`,
          esLegacy ? '' : `<button type="button" class="btn btn-primary" data-as="listo"><i data-lucide="check"></i> Listo para programar</button>`,
        ]);
      } else {
        footer([]);
      }
    }
    asg.refresh();
    if (window.lucide) lucide.createIcons();
  }

  function gruposDelContrato({ contrato, guardados, omisiones, modoReemplazo, cambioSet }) {
    const equipos = Array.isArray(contrato.equipos) ? contrato.equipos : [];
    const cancelado = contrato.baja_cancelado || {};
    const savedByModel = {};
    guardados.forEach(s => { const k = norm(s.modelo); (savedByModel[k] = savedByModel[k] || []).push(String(s.serial || '').trim()); });
    const omsByModel = {};
    (omisiones || []).forEach(o => { const k = norm(o.modelo); (omsByModel[k] = omsByModel[k] || []).push(String(o.motivo || '')); });
    return equipos.map(eq => {
      const modelo = String(eq?.modelo || '-').trim() || '-';
      const modeloId = eq?.modelo_id || '';
      const key = String(modeloId || modelo);
      const activos = Math.max(0, Number(eq?.cantidad || 0) - Number(cancelado[key] || 0));
      if (activos === 0) return null;
      const k = norm(modelo);
      const slots = [];
      (savedByModel[k] || []).filter(Boolean).forEach(s => {
        const enCambio = modoReemplazo && cambioSet.has(norm(s));
        slots.push(enCambio ? { serial: s, dataReemplazo: s, clase: 'reemplazo' } : { serial: s, bloqueado: modoReemplazo });
      });
      (omsByModel[k] || []).forEach(m => slots.push({ omitido: true, motivo: m, bloqueado: modoReemplazo }));
      return { modelo, modelo_id: modeloId, activos, slots };
    }).filter(Boolean);
  }

  // Excepciones de la política dura para un contrato: las unidades que el
  // plan de la venta marcó "continúa", y —en renovaciones/reemplazos— las
  // que siguen con el MISMO cliente (no es robo, es continuidad).
  function excepcionesContrato(c) {
    const set = new Set();
    if (c.contrato.transicion_plan?.nivel === 'serial') {
      (c.contrato.transicion_plan.unidades || []).filter(u => u.destino === 'continua').forEach(u => { const k = norm(u.serial); if (k) set.add(k); });
    }
    return set;
  }
  function permitirContrato(c) {
    return (e) => e.tipo === 'ocupado' && !!c.clienteId
      && e.doc?.asignacion?.cliente_id === c.clienteId
      && String(c.contrato.accion || 'Nuevo') !== 'Nuevo';
  }

  async function persistirContrato(c, estado, datos) {
    const uid = firebase.auth().currentUser?.uid || null;
    await ContratosService.saveSerialesManual(c.docId, datos.seriales, {
      uid, estado, contrato_id: c.contratoIdVisible, cliente_id: c.clienteId, cliente_nombre: c.clienteNombre,
    });
    await db().collection('contratos').doc(c.docId).collection('seriales_estado').doc('current').set({
      estado, omisiones: datos.omisiones, por: uid, at: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  // La excepción de modelo queda en el historial del contrato: quién, cuándo,
  // qué seriales y por qué. Meses después la pregunta es "¿quién dijo que ese
  // PNC460-R iba en un contrato de PNC360S?".
  async function registrarExcepcion(c, excepcion) {
    if (!excepcion) return;
    const user = firebase.auth().currentUser;
    await db().collection('contratos').doc(c.docId).collection('seriales_historial').add({
      at: firebase.firestore.FieldValue.serverTimestamp(),
      por: user?.uid || null, por_email: user?.email || null,
      tipo: 'excepcion_modelo', nota: excepcion.motivo, seriales: excepcion.seriales,
      contrato_id: c.contratoIdVisible, cliente_id: c.clienteId, cliente_nombre: c.clienteNombre,
      agregados: [], eliminados: [],
    }).catch(e => console.warn('[Asignar] excepción no registrada:', e?.code || e));
  }

  // Valida según la política del trabajo. Devuelve {unidades, excepcion} o null.
  async function validarContrato(c, seriales) {
    const asg = st.asignador;
    if (asg.politica === 'suave') return (await asg.confirmarAvisosPool(seriales)) ? { unidades: new Map(), excepcion: null } : null;
    return asg.exigirEnBodega(seriales, { excepciones: excepcionesContrato(c), permitir: permitirContrato(c) });
  }

  async function guardarAvance() {
    const c = st.trabajo; const asg = st.asignador;
    const datos = asg.collect();
    const btn = $('asFoot').querySelector('[data-as="guardar"]'); if (btn) btn.disabled = true;
    try {
      const r = await validarContrato(c, datos.seriales);
      if (!r) return;
      await persistirContrato(c, c.yaAsignados ? 'asignados' : 'pendiente', datos);
      await registrarExcepcion(c, r.excepcion);
      asg.setGuardados(datos.seriales);
      invalidarBodega();
      toast(`Avance guardado (${datos.seriales.length} serial(es)${datos.omisiones.length ? `, ${datos.omisiones.length} sin serial` : ''}).`, 'ok');
      refrescarColaSuave();
    } catch (e) {
      console.error('[Asignar] guardar:', e);
      toast('No se pudo guardar el avance.', 'bad');
    } finally { if (btn) btn.disabled = false; }
  }

  async function listoParaProgramar() {
    const c = st.trabajo; const asg = st.asignador;
    const error = asg.validarCompleto();
    if (error) { toast(error, 'warn'); return; }
    const datos = asg.collect();
    const r = await validarContrato(c, datos.seriales);
    if (!r) return;
    if (!await hojaListo(c, datos)) return;
    const btn = $('asFoot').querySelector('[data-as="listo"]'); if (btn) btn.disabled = true;
    try {
      await persistirContrato(c, 'asignados', datos);
      await registrarExcepcion(c, r.excepcion);
      invalidarBodega();
      toast(`${c.contratoIdVisible} listo para programar.`, 'ok');
      await siguiente({ cerrado: true });
    } catch (e) {
      console.error('[Asignar] listo:', e);
      toast('No se pudo confirmar. Intenta de nuevo.', 'bad');
      if (btn) btn.disabled = false;
    }
  }

  async function guardarReemplazo() {
    const c = st.trabajo; const asg = st.asignador;
    if (!c.cambioReq) return;
    const reemplazos = [];
    $('asBody').querySelectorAll('.serial-input[data-reemplazo]').forEach(inp => {
      const anterior = inp.dataset.reemplazo; const nuevo = inp.value.trim();
      if (nuevo && norm(nuevo) !== norm(anterior)) reemplazos.push({ anterior, nuevo, modelo: inp.getAttribute('data-modelo') || '' });
    });
    if (!reemplazos.length) { toast('No cambiaste ningún serial marcado. Escribe el serial de reemplazo.', 'warn'); return; }
    if ($('asBody').querySelector('.serial-input.dup')) { toast('Un serial de reemplazo duplica otro ya asignado.', 'warn'); return; }
    const datos = asg.collect();
    const nuevos = datos.seriales.filter(s => reemplazos.some(r => norm(r.nuevo) === norm(s.serial)));
    const r = await asg.exigirEnBodega(nuevos, {});
    if (!r) return;
    const btn = $('asFoot').querySelector('[data-as="reemplazo"]'); if (btn) btn.disabled = true;
    try {
      await persistirContrato(c, 'asignados', datos);
      await registrarExcepcion(c, r.excepcion);
      const uid = firebase.auth().currentUser?.uid || null;
      await db().collection('contratos').doc(c.docId).collection('seriales_cambios').doc(c.cambioReq.id).set({
        estado: 'resuelto', resuelto_por: uid, resuelto_at: firebase.firestore.FieldValue.serverTimestamp(), reemplazos,
      }, { merge: true });
      invalidarBodega();
      toast(`Reemplazo guardado (${reemplazos.length}). Se notificará a activaciones.`, 'ok');
      await siguiente({ cerrado: true });
    } catch (e) {
      console.error('[Asignar] reemplazo:', e);
      toast('No se pudo guardar el reemplazo.', 'bad');
      if (btn) btn.disabled = false;
    }
  }

  // Hoja del paso que cierra el trabajo — en el idioma de bodega.
  function hojaListo(c, { seriales, omisiones }) {
    return new Promise((resolve) => {
      const porModelo = new Map();
      seriales.forEach(s => porModelo.set(s.modelo || '—', (porModelo.get(s.modelo || '—') || 0) + 1));
      (omisiones || []).forEach(o => { if (!porModelo.has(o.modelo || '—')) porModelo.set(o.modelo || '—', 0); });
      const filas = [...porModelo.entries()].map(([modelo, n]) => {
        const oms = (omisiones || []).filter(o => (o.modelo || '—') === modelo).length;
        return `<tr><td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:13px;">${esc(modelo)}</td>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:13px; text-align:right; white-space:nowrap;"><b>${n}</b> con serial${oms ? ` · ${oms} sin serial` : ''}</td></tr>`;
      }).join('');
      const overlay = document.createElement('div');
      overlay.className = 'overlay'; overlay.style.display = 'flex';
      overlay.innerHTML = `
        <div class="modal" style="max-width:560px; width:min(560px, 94vw);">
          <div class="sheet-header"><h3 class="sheet-title">Listo para programar</h3></div>
          <div class="sheet-body" style="padding:12px 8px;">
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:10px 16px; margin-bottom:12px;">
              <div><div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Contrato</div><div style="font-size:13.5px;">${esc(c.contratoIdVisible)}</div></div>
              <div><div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Cliente</div><div style="font-size:13.5px;">${esc(c.clienteNombre || '—')}</div></div>
              <div><div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Unidades</div><div style="font-size:13.5px;"><b>${seriales.length}</b> con serial${omisiones.length ? ` · <b>${omisiones.length}</b> sin serial` : ''}</div></div>
            </div>
            <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; max-height:240px; overflow-y:auto;">
              <table style="border-collapse:collapse; width:100%;">${filas}</table>
            </div>
            <div style="margin-top:12px; padding:10px 12px; background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; color:#92400E; font-size:12.5px; line-height:1.55;">
              El contrato pasa a la <b>cola de programación</b> y activaciones recibe los seriales.
              Después de esto, corregir un serial requiere una <b>solicitud de cambio</b> de recepción.
            </div>
          </div>
          <div class="footer">
            <button class="btn btn-ghost" data-action="cancel">Volver a revisar</button>
            <button class="btn btn-primary" data-action="confirm"><i data-lucide="check" style="width:14px;height:14px;"></i> Listo para programar</button>
          </div>
        </div>`;
      const cleanup = (r) => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); resolve(r); };
      const kb = (e) => { if (e.key === 'Escape') cleanup(false); };
      overlay.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (action === 'confirm') cleanup(true);
        else if (action === 'cancel' || e.target === overlay) cleanup(false);
      });
      document.addEventListener('keydown', kb);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      if (window.lucide) lucide.createIcons();
    });
  }

  function traerDelOriginal() {
    const c = st.trabajo;
    const plan = c?.contrato?.transicion_plan;
    const continuan = (plan?.nivel === 'serial') ? (plan.unidades || []).filter(u => u.destino === 'continua') : [];
    if (!continuan.length) { toast('El plan de la venta no tiene unidades que continúen.', 'warn'); return; }
    st.asignador.jalarItems(continuan.map(u => ({ serial: u.serial, modelo: u.modelo || '', modeloId: u.modelo_id || '' })), 'el contrato original');
  }

  /* ═════════ GESTIÓN (aumento · demo · reemplazo) ═════════ */

  async function abrirGestion(gid) {
    marcarSel('gestion', gid);
    const el = cascaron({ titulo: 'Cargando…', sub: '' });
    let g = null;
    try { g = await GestionesService.get(gid); } catch (e) { console.error(e); }
    if (!g) { el.innerHTML = '<div class="as-vacio"><p>No se encontró la gestión.</p></div>'; return; }

    const grupos = gruposDeGestion(g);
    const total = grupos.reduce((s, x) => s + x.activos, 0);
    const label = TIPO_G[g.tipo] || g.tipo;
    const conOS = !!(g.ordenes?.programacion_id || (g.ordenes?.programacion_ids || []).length);
    const cerrada = ['cerrada', 'anulada'].includes(g.estado);
    const esperaBodega = !cerrada && !conOS && (
      g.estado === 'pendiente_bodega'
      || (g.estado === 'en_proceso' && ['reemplazo', 'demo'].includes(g.tipo) && !g.cierre?.asignacion)
      || (g.estado === 'pendiente_firma' && g.tipo === 'aumento' && !g.aumento?.es_ajuste && !g.aumento?.es_regularizacion));
    const guardadosObj = serialesGuardadosGestion(g);
    st.trabajo = { tipo: 'gestion', g, gid, guardadosObj };

    cascaron({
      titulo: `${esc(gid)} · ${total} equipo${total === 1 ? '' : 's'}`,
      sub: `${esc(label)} · ${esc(g.cliente_nombre || 'Cliente')}`
        + (g.tipo === 'aumento' && g.aumento?.contrato_id ? ` · al contrato ${esc(g.aumento.contrato_id)}` : '')
        + (g.tipo === 'demo' && g.demo?.finalidad ? ` · ${esc(g.demo.finalidad)}` : '')
        + (g.tipo === 'aumento' && g.estado === 'pendiente_firma' ? ' · <b>firma del anexo en paralelo</b>' : ''),
      pill: cerrada ? (g.estado === 'anulada' ? 'Anulada' : 'Cerrada') : esperaBodega ? 'Por asignar' : conOS ? 'En programación' : 'Sin pendiente de bodega',
      pillCls: esperaBodega ? 'seriales' : 'ok',
    });

    const puede = esperaBodega && puedeAsignarGestion();
    if (puede) $('asPicklist').innerHTML = await picklistHtml(grupos);

    const asg = crearAsignador({ permitirOmitir: false, clienteId: g.cliente_id || null,
      textoVacio: 'Esta gestión no tiene equipos que asignar.' });
    asg.setGuardados(Object.keys(guardadosObj));
    const hay = asg.render(grupos);

    if (!esperaBodega) {
      $('asBanner').innerHTML = banner('ok', conOS
        ? '<strong>Seriales amarrados.</strong> La orden de programación ya existe; pool y orden los tienen. Cambios, desde la orden.'
        : cerrada ? `<strong>Gestión ${g.estado}.</strong> Solo lectura.` : '<strong>Sin pendiente de bodega.</strong> Esta gestión no espera seriales en este paso.');
      asg.setLocked(true);
      footer([]);
    } else if (!puedeAsignarGestion()) {
      $('asBanner').innerHTML = banner('warn', 'Solo administración e inventario asignan seriales de gestiones.');
      asg.setLocked(true);
      footer([]);
    } else if (hay) {
      if (g.tipo === 'aumento' && g.estado === 'pendiente_firma') {
        $('asBanner').innerHTML = banner('info', 'El anexo está <strong>aprobado</strong> y la firma del cliente corre en paralelo. Puedes asignar desde ya: la orden de programación saldrá sola cuando el anexo quede firmado.');
      }
      toolbar([`<button type="button" class="btn btn-primary btn-sm" data-as="tomar"><i data-lucide="scan-barcode"></i> Tomar del estante</button>`]);
      footer([`<button type="button" class="btn btn-primary" data-as="guardar-gestion"><i data-lucide="save"></i> Guardar asignación</button>`]);
    } else {
      footer([]);
    }
    asg.refresh();
    if (window.lucide) lucide.createIcons();
  }

  // norm(serial) → objeto guardado {serial, pool_doc_id, modelo, modelo_id}
  function serialesGuardadosGestion(g) {
    const out = {};
    if (g.tipo === 'reemplazo') {
      (g.items || []).forEach(it => { const k = norm(it.serial_nuevo); if (k) out[k] = { serial: it.serial_nuevo, pool_doc_id: it.pool_doc_id_nuevo || null, modelo: it.modelo_solicitado || it.modelo || '', modelo_id: it.modelo_solicitado_id || null }; });
    } else {
      const lista = (g.tipo === 'demo' ? g.demo?.seriales_asignados : g.aumento?.seriales_asignados) || [];
      lista.forEach(s => { const k = norm(s.serial); if (k) out[k] = s; });
    }
    return out;
  }

  function gruposDeGestion(g) {
    if (g.tipo === 'reemplazo') {
      return (g.items || []).map((it, ix) => ({
        clave: String(ix),
        modelo: it.modelo_solicitado || it.modelo || '—',
        modelo_id: it.modelo_solicitado_id || '',
        activos: 1,
        titulo: `Sale <span style="font-family:var(--font-mono,monospace);">${esc(it.serial_saliente || '—')}</span> <span style="color:var(--fg-3); font-weight:400;">(${esc(it.modelo || '—')})</span> → entra ${esc(it.modelo_solicitado || it.modelo || '—')}`,
        nota: it.motivo_detalle || it.motivo_codigo ? esc(it.motivo_detalle || it.motivo_codigo) : '',
        slots: it.serial_nuevo ? [{ serial: it.serial_nuevo }] : [],
      }));
    }
    const lineas = (g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || [];
    const asignados = ((g.tipo === 'demo' ? g.demo?.seriales_asignados : g.aumento?.seriales_asignados) || [])
      .filter(s => String(s.serial || '').trim());
    const usados = new Set();
    const grupos = lineas.filter(l => Number(l.cantidad || 0) > 0).map(l => ({
      modelo: l.modelo || '—', modelo_id: l.modelo_id || '', activos: Number(l.cantidad || 0), slots: [],
    }));
    // Repartir lo guardado por modelo; lo que no cuadre, por orden.
    asignados.forEach((s, i) => {
      const gr = grupos.find(x => x.slots.length < x.activos && EquiposPoolService._mismoModelo({ modelo_id: s.modelo_id, modelo_label: s.modelo }, x.modelo_id || null, x.modelo));
      if (gr) { gr.slots.push({ serial: s.serial }); usados.add(i); }
    });
    asignados.forEach((s, i) => {
      if (usados.has(i)) return;
      const gr = grupos.find(x => x.slots.length < x.activos);
      if (gr) gr.slots.push({ serial: s.serial });
    });
    return grupos;
  }

  async function guardarGestion() {
    const t = st.trabajo; const asg = st.asignador;
    const g = t.g;
    if (asg.validarCompleto() && $('asBody').querySelector('.serial-input.dup')) { toast('Hay seriales duplicados (marcados en rojo).', 'warn'); return; }
    const datos = asg.collect();
    if (!datos.seriales.length && g.tipo !== 'reemplazo') { toast('Captura al menos un serial.', 'warn'); return; }
    const r = await asg.exigirEnBodega(datos.seriales, {});
    if (!r) return;
    const btn = $('asFoot').querySelector('[data-as="guardar-gestion"]'); if (btn) btn.disabled = true;
    try {
      const objeto = (s) => {
        const k = norm(s.serial);
        const u = r.unidades.get(k);
        const prev = t.guardadosObj[k];
        return {
          serial: u?.serial || prev?.serial || s.serial,
          pool_doc_id: u?.id || prev?.pool_doc_id || null,
          modelo: u?.modelo_label || prev?.modelo || s.modelo || '',
          modelo_id: u?.modelo_id || prev?.modelo_id || s.modelo_id || null,
        };
      };
      let completo = false;
      if (g.tipo === 'reemplazo') {
        const items = (g.items || []).map(it => ({ ...it }));
        items.forEach((it, ix) => {
          const s = datos.seriales.find(x => x.clave === String(ix));
          if (!s) { it.serial_nuevo = null; it.pool_doc_id_nuevo = null; return; }
          const o = objeto(s);
          it.serial_nuevo = o.serial; it.pool_doc_id_nuevo = o.pool_doc_id; it.asignado_at = new Date().toISOString();
        });
        await GestionesService.asignarItems(t.gid, items);
        completo = items.every(it => it.serial_nuevo);
      } else {
        const seriales = datos.seriales.map(objeto);
        if (g.tipo === 'demo') await GestionesService.asignarDemo(t.gid, seriales);
        else await GestionesService.asignarAumento(t.gid, seriales);
        const total = ((g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
        completo = seriales.length >= total;
      }
      if (r.excepcion) {
        await GestionesService.registrarEvento(t.gid, 'asignar',
          `Excepción de modelo (${r.excepcion.seriales.join(', ')}): ${r.excepcion.motivo}`).catch(() => {});
      }
      invalidarBodega();
      toast(completo
        ? 'Asignación completa — el sistema crea la orden de programación y avisa a Recepción.'
        : 'Asignación guardada (parcial).', 'ok');
      // El avance lo hace el trigger (~1-2 s): la cola se refresca después.
      setTimeout(() => siguiente({ cerrado: completo }), 1800);
    } catch (e) {
      console.error('[Asignar] gestión:', e);
      toast('No se pudo guardar la asignación.', 'bad');
      if (btn) btn.disabled = false;
    }
  }

  /* ═════════ Navegación tras guardar ═════════ */

  // cerrado=true: el trabajo terminó (listo / reemplazo / gestión completa) y
  // no debe reabrirse aunque el trigger aún no haya actualizado el doc.
  async function siguiente({ cerrado = false } = {}) {
    const prev = st.sel;
    if (cerrado && prev) st.cerrados.set(`*:${prev.id}`, Date.now());
    st.sel = null;
    await cargarCola();
    const sigue = st.items.find(i => i.id === prev?.id);
    if (sigue) return seleccionar(sigue);         // quedó en cola (parcial)
    if (st.items.length) return seleccionar(st.items[0]);
    st.trabajo = null;
    renderTrabajoVacio();
    if (window.AlmacenHoy?.recargar) AlmacenHoy.recargar();
  }

  // Tras "Guardar avance" solo se refresca la cola (el contrato sigue ahí).
  async function refrescarColaSuave() {
    const sel = st.sel;
    await cargarCola();
    st.sel = sel; renderCola();
    if (window.AlmacenHoy?.recargar) AlmacenHoy.recargar();
  }

  function recargar() { st.sel = null; st.trabajo = null; return activar({ forzar: true }); }

  // ── Wiring ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    $('asCola')?.addEventListener('click', onClickCola);
    $('asTrabajo')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-as]');
      if (!btn) return;
      const a = btn.getAttribute('data-as');
      if (a === 'tomar') st.asignador?.tomarDelPool();
      else if (a === 'traer-original') traerDelOriginal();
      else if (a === 'guardar') guardarAvance();
      else if (a === 'listo') listoParaProgramar();
      else if (a === 'reemplazo') guardarReemplazo();
      else if (a === 'guardar-gestion') guardarGestion();
    });
  });

  return { activar, recargar, abrirContrato, abrirGestion, cargarCola };
})();
