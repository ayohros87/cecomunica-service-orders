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
  const norm = (s) => Serial.clave(s);
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

  const TIPO_G = { aumento: 'Aumento', reemplazo: 'Reemplazo', demo: 'Demo', cambio_serial: 'Cambio de serial' };

  // El cambio de serial comparte la pantalla pero NO el trabajo: aquí no sale
  // nada del estante — se confirma contra el radio cuál es el serial de verdad
  // y el sistema corrige el contrato. Se distingue en cada sitio donde el
  // texto diría "asignar" o "sacar".
  const esCambio = (g) => g?.tipo === 'cambio_serial';

  function puedeAsignarGestion() {
    return st.rol === ROLES.ADMIN || st.rol === ROLES.INVENTARIO;
  }
  function puedeAsignarContrato() {
    return (typeof canRole === 'function') ? canRole(st.rol, 'gestionar-seriales') : puedeAsignarGestion();
  }

  // ── Entrada ───────────────────────────────────────────────────────────
  // activar({contrato, g}): carga la cola (una vez) y abre el deep-link o el
  // primero de la cola. Lo llama AlmacenPage.setTab('asignar') y el init.
  async function activar({ contrato = null, g = null, forzar = false, corregir = false } = {}) {
    st.rol = window.userRole || st.rol;
    if (!st.cargado || forzar) await cargarCola();
    if (contrato) return abrirContrato(contrato);
    if (g) return abrirGestion(g, { corregir });
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
        const porItem = g.tipo === 'reemplazo' || esCambio(g);
        const lineas = esCambio(g)
          ? `corregir ${(g.items || []).map(i => i.serial || '—').join(', ')}`
          : g.tipo === 'reemplazo'
            ? `${(g.items || []).length} reemplazo(s)`
            : resumenEquipos((g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || []);
        const total = porItem ? (g.items || []).length
          : ((g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
        const hechos = porItem
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
    // Ítems de la lista seleccionable del kit de bandeja (js/ui/bandeja.js).
    const fila = (it) => Bandeja.item({
      titulo: it.titulo, n: it.n, sub: it.sub, listo: it.listo,
      sel: !!(st.sel && st.sel.tipo === it.tipo && st.sel.id === it.id),
      data: { tipo: it.tipo, id: it.id },
    });
    const aviso = (st.fallidas || []).length
      ? `<p class="bj-nota" style="margin:8px 12px;">No se pudo leer: ${esc(st.fallidas.join(', '))}.</p>` : '';
    el.innerHTML = Bandeja.listaTitulo('Por asignar', porAsignar.length)
      + (porAsignar.map(fila).join('') || Bandeja.listaVacia('Nada por asignar. Bodega al día.'))
      + (cambios.length ? Bandeja.listaTitulo('Cambio de serial', cambios.length) + cambios.map(fila).join('') : '')
      + aviso;
  }

  function onClickCola(e) {
    const btn = e.target.closest('.bj-item');
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
      const delModelo = lista.filter(u => EquiposPoolService._mismoModelo(u, g.modelo_id || null, g.modelo || ''));
      // "Disponible" ≠ "en bodega" (auditoría UX 2026-09-28, P2 #15): lo que
      // el importador marcó DAÑADA cuenta en el estante pero no se ofrece. Lo
      // descartado en QC y las condiciones particulares las filtra el picker
      // (viven en otras colecciones; aquí no se consultan por cada modelo).
      const danadas = EquiposPoolService.esDanada ? delModelo.filter(u => EquiposPoolService.esDanada(u)).length : 0;
      const disp = delModelo.length - danadas;
      const faltan = Math.max(0, Number(g.activos || 0) - (g.slots || []).filter(s => s.serial || s.omitido).length);
      const corto = disp < faltan;
      return `<div class="as-pl${corto ? ' short' : ''}">
        <b>${Number(g.activos || 0)} × ${esc(g.modelo)}</b>
        <small>${disp} disponible${disp === 1 ? '' : 's'}${danadas ? ` · ${danadas} dañada${danadas === 1 ? '' : 's'}` : ''}${corto ? ` · faltan ${faltan - disp}` : ''}</small></div>`;
    }).join('');
    return `<div class="as-picklist">${chips}</div>`;
  }

  // ── Trabajo (derecha) ─────────────────────────────────────────────────
  function renderTrabajoVacio() {
    const el = $('asTrabajo');
    if (!el) return;
    el.innerHTML = Bandeja.vacio('Nada por asignar. Cuando un contrato o una gestión espere seriales, aparece aquí.');
    if (window.lucide) lucide.createIcons();
  }

  // pillCls: tono del kit (aviso · info · alerta · listo · neutro).
  function cascaron({ titulo, sub, pill, pillCls }) {
    const el = $('asTrabajo');
    el.innerHTML = `
      <div class="as-work-h">
        <div>
          <div class="as-work-t">${titulo}</div>
          <div class="as-work-s">${sub}</div>
        </div>
        ${pill ? Bandeja.chip(pill, pillCls || 'aviso') : ''}
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

  // Solo existen info/warn/ok. Un tipo desconocido (el 'aviso' de antes)
  // salía sin borde, sin fondo y con icono "undefined": ahora cae en info
  // (auditoría UX 2026-09-28).
  function banner(kind, html) {
    const tipos = { info: ['#BFDBFE', '#EFF6FF', '#1E3A8A', 'info'], warn: ['#FCD34D', '#FFFBEB', '#92400E', 'lock'], ok: ['#A7F3D0', '#ECFDF5', '#065F46', 'check-circle-2'] };
    const s = tipos[kind] || tipos.info;
    return `<div style="margin-bottom:var(--sp-3,12px);padding:12px 14px;border:1px solid ${s[0]};background:${s[1]};color:${s[2]};border-radius:10px;display:flex;gap:8px;align-items:flex-start;font-size:14px;">
      <i data-lucide="${s[3]}" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div>${html}</div></div>`;
  }

  // La vía para corregir un serial ya programado es una gestión de cambio de
  // serial en el Centro. El rol inventario NO tiene el Centro: mandarlo allá
  // era un callejón (auditoría UX 2026-09-28, P0 #23). A inventario se le dice
  // a quién pedírselo; a los demás, enlace directo a la ficha del cliente.
  function viaCambioSerialHtml(clienteId) {
    if (window.userRole === 'inventario' || !clienteId) {
      return 'Pídele a recepción o a ventas que abra la gestión de <strong>cambio de serial</strong> desde la ficha del cliente';
    }
    return `Ábrelo como gestión de <strong>cambio de serial</strong> desde la <a href="/clientes/centro.html?id=${encodeURIComponent(clienteId)}">ficha del cliente</a>`;
  }

  function crearAsignador(opciones) {
    st.asignador = AsignadorSeriales.crear({
      body: $('asBody'),
      norm,
      politica: 'dura',
      tituloPicker: 'Tomar del estante',
      origenPicker: 'el estante',
      onChange: ({ done, req }) => { const p = $('asProg'); if (p) p.textContent = `${done} / ${req}`; },
      // Progreso de la validación por lotes (auditoría UX 2026-09-28, T12);
      // null = terminó → vuelve el contador de avance.
      onValidando: (i, n) => {
        const p = $('asProg'); if (!p) return;
        if (i == null) st.asignador?.refresh();
        else p.textContent = `Validando ${i}/${n}…`;
      },
      ...opciones,
    });
    return st.asignador;
  }

  // Lista imprimible por serial (pick & confirm, auditoría UX 2026-09-28):
  // se imprime DESPUÉS de escoger, para ir al estante con la hoja.
  const BTN_IMPRIMIR = `<button type="button" class="btn btn-ghost btn-sm" data-as="imprimir" title="Lista por serial (modelo, serial, ubicación, cliente) para sacar del estante con casilla de verificación"><i data-lucide="printer"></i> Imprimir lista</button>`;

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
    if (!contrato) { el.innerHTML = Bandeja.vacio('No se encontró el contrato.', 'search-x'); return; }

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
      pillCls: modoReemplazo ? 'info' : yaAsignados ? 'listo' : esLegacy ? 'neutro' : 'aviso',
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
      $('asBanner').innerHTML = banner('ok', `<strong>Seriales listos.</strong> Este contrato ya pasó a programación${contrato.seriales_asignados_at?.toMillis ? ` (${hace(contrato.seriales_asignados_at.toMillis())})` : ''}. Para corregir un serial: ${viaCambioSerialHtml(ctxC.clienteId)}; el trabajo vuelve a aparecer aquí.`);
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
          BTN_IMPRIMIR,
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
    return (e) => {
      if (e.tipo !== 'ocupado' || !c.clienteId || !e.doc) return false;
      const mismoCliente = e.doc.asignacion?.cliente_id === c.clienteId
        || e.doc.venta?.cliente_id === c.clienteId;
      if (!mismoCliente) return false;
      // El cliente YA compró el radio: ponerlo en su contrato no se lo quita a
      // nadie — es la promo "compra el equipo y paga la frecuencia", y pasa en
      // contratos NUEVOS. Sin esto bodega quedaba trancada: el panel de bloqueo
      // no ofrece forzar un 'ocupado' (caso Jean Simancas, factura 10762,
      // 2026-09-15) y `vendido` tampoco tenía salida en la ficha del equipo.
      if (e.doc.estado === EquiposPoolService.ESTADOS.VENDIDO) return true;
      // Renovación / reemplazo: la unidad sigue con el MISMO cliente.
      return String(c.contrato.accion || 'Nuevo') !== 'Nuevo';
    };
  }

  async function persistirContrato(c, estado, datos, { verificacion = null } = {}) {
    const uid = firebase.auth().currentUser?.uid || null;
    await ContratosService.saveSerialesManual(c.docId, datos.seriales, {
      uid, estado, contrato_id: c.contratoIdVisible, cliente_id: c.clienteId, cliente_nombre: c.clienteNombre,
    });
    // La verificación por escaneo (pick & confirm) queda junto al estado:
    // quién confirmó unidad por unidad, cuándo, cuántas y qué sustituyó.
    const verif = verificacion ? {
      picklist_verificada_at: firebase.firestore.FieldValue.serverTimestamp(),
      picklist_verificada_por: uid,
      picklist_verificada_n: verificacion.n,
      picklist_reemplazos: (verificacion.reemplazos || []).map(r => ({ anterior: r.anterior, nuevo: r.nuevo, modelo: r.modelo || '', motivo: r.motivo })),
    } : {};
    await db().collection('contratos').doc(c.docId).collection('seriales_estado').doc('current').set({
      estado, omisiones: datos.omisiones, por: uid, at: firebase.firestore.FieldValue.serverTimestamp(), ...verif,
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
    let datos = asg.collect();
    let r = await validarContrato(c, datos.seriales);
    if (!r) return;
    // Pick & confirm: antes de cerrar, bodega escanea cada serial con el
    // radio en la mano. Si sustituyó alguno, el formulario cambió: se vuelve
    // a recoger y a validar contra el pool.
    const v = await verificarPicklist(datos.seriales);
    if (!v) return;
    if (v.reemplazos.length) {
      datos = asg.collect();
      r = await validarContrato(c, datos.seriales);
      if (!r) return;
    }
    if (!await hojaListo(c, datos)) return;
    const btn = $('asFoot').querySelector('[data-as="listo"]'); if (btn) btn.disabled = true;
    try {
      await persistirContrato(c, 'asignados', datos, { verificacion: v });
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

  // Hoja del paso que cierra el trabajo — en el idioma de bodega. Resuelve
  // true solo si se confirma (Modal.sheet devuelve null al cerrar).
  async function hojaListo(c, { seriales, omisiones }) {
    const porModelo = new Map();
    seriales.forEach(s => porModelo.set(s.modelo || '—', (porModelo.get(s.modelo || '—') || 0) + 1));
    (omisiones || []).forEach(o => { if (!porModelo.has(o.modelo || '—')) porModelo.set(o.modelo || '—', 0); });
    const filas = [...porModelo.entries()].map(([modelo, n]) => {
      const oms = (omisiones || []).filter(o => (o.modelo || '—') === modelo).length;
      return `<tr><td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:13px;">${esc(modelo)}</td>
        <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:13px; text-align:right; white-space:nowrap;"><b>${n}</b> con serial${oms ? ` · ${oms} sin serial` : ''}</td></tr>`;
    }).join('');
    const r = await Modal.sheet({
      title: 'Listo para programar', icon: 'check', size: 'md',
      html: `
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
          Después de esto, para corregir un serial: ${viaCambioSerialHtml(c.clienteId)}.
        </div>`,
      buttons: [
        { action: 'cancel', label: 'Volver a revisar' },
        { action: 'confirm', label: 'Listo para programar', primary: true, icon: 'check' },
      ],
    });
    return r === 'confirm';
  }

  function traerDelOriginal() {
    const c = st.trabajo;
    const plan = c?.contrato?.transicion_plan;
    const continuan = (plan?.nivel === 'serial') ? (plan.unidades || []).filter(u => u.destino === 'continua') : [];
    if (!continuan.length) { toast('El plan de la venta no tiene unidades que continúen.', 'warn'); return; }
    st.asignador.jalarItems(continuan.map(u => ({ serial: u.serial, modelo: u.modelo || '', modeloId: u.modelo_id || '' })), 'el contrato original');
  }

  /* ═════════ GESTIÓN (aumento · demo · reemplazo) ═════════ */

  // Los seriales que la gestión tiene HOY, en una sola lista 1:1 — sin
  // importar dónde los guarde su tipo. Es lo que la corrección necesita: cada
  // fila es "este radio por este otro", no "cuántos de este modelo".
  function serialesActuales(g) {
    if (g.tipo === 'reemplazo' || esCambio(g)) {
      return (g.items || []).filter(it => it.serial_nuevo).map(it => ({
        serial: it.serial_nuevo, modelo: it.modelo_nuevo || it.modelo_solicitado || it.modelo || '',
        modelo_id: it.modelo_id_nuevo || it.modelo_solicitado_id || it.modelo_id || '',
        nota: it.serial_saliente ? `sustituye a ${it.serial_saliente}` : '',
      }));
    }
    const lista = (g.tipo === 'demo' ? g.demo?.seriales_asignados : g.aumento?.seriales_asignados) || [];
    return lista.filter(s => String(s.serial || '').trim())
      .map(s => ({ serial: s.serial, modelo: s.modelo || '', modelo_id: s.modelo_id || '', nota: '' }));
  }

  // Una fila por serial: el que está puesto arriba, el correcto abajo. Lo que
  // el TALLER marcó se dice en la fila con su motivo — es lo que le contesta a
  // bodega "¿y cuál cambio?" sin tener que ir a leer el expediente.
  function gruposCorreccion(g) {
    const marcas = g.correccion_solicitada || {};
    return serialesActuales(g).map((s, ix) => {
      const m = marcas[norm(s.serial)];
      return {
        clave: String(ix),
        modelo: s.modelo || '—', modelo_id: s.modelo_id || '', activos: 1,
        titulo: (m ? '<span title="El taller avisó que este no sirve">⚠ </span>' : '')
          + `Hoy figura <span style="font-family:var(--font-mono,monospace);">${esc(s.serial)}</span>`
          + ` <span style="color:var(--fg-3); font-weight:400;">(${esc(s.modelo || '—')})</span> → ¿cuál es el correcto?`,
        nota: m
          ? `El taller lo marcó: ${esc(m.motivo_detalle || m.motivo_codigo || 'no se puede usar')}`
            + `${m.por_email ? ` — ${esc(m.por_email)}` : ''}`
          : s.nota,
        slots: [{ serial: s.serial }],
      };
    });
  }

  // ¿El taller pidió cambiar algo de esta gestión? Es lo que enciende el aviso
  // aunque bodega entre por la cola y no por el enlace del correo.
  const marcadosPorTaller = (g) => Object.keys(g?.correccion_solicitada || {}).length;

  async function abrirGestion(gid, { corregir = false } = {}) {
    marcarSel('gestion', gid);
    const el = cascaron({ titulo: 'Cargando…', sub: '' });
    let g = null;
    try { g = await GestionesService.get(gid); } catch (e) { console.error(e); }
    if (!g) { el.innerHTML = Bandeja.vacio('No se encontró la gestión.', 'search-x'); return; }

    // Modo corrección: las filas son los seriales que ya tiene puestos, para
    // cambiarlos por los correctos. Solo se entra a pedido (el botón del
    // banner o el enlace del expediente), nunca por defecto.
    const actuales = serialesActuales(g);
    const corrigiendo = corregir && actuales.length > 0 && puedeAsignarGestion()
      && !['cerrada', 'anulada'].includes(g.estado);
    const grupos = corrigiendo ? gruposCorreccion(g) : gruposDeGestion(g);
    const total = grupos.reduce((s, x) => s + x.activos, 0);
    const label = TIPO_G[g.tipo] || g.tipo;
    const conOS = !!(g.ordenes?.programacion_id || (g.ordenes?.programacion_ids || []).length);
    const cerrada = ['cerrada', 'anulada'].includes(g.estado);
    // En el cambio de serial la corrección YA aplicada (cierre.derivacion) es
    // el final del trabajo — no como en el aumento, donde `derivacion` es la
    // firma del anexo y bodega todavía tiene que asignar.
    const esperaBodega = !cerrada && !conOS && !(esCambio(g) && g.cierre?.derivacion) && (
      g.estado === 'pendiente_bodega'
      || (g.estado === 'en_proceso' && ['reemplazo', 'demo'].includes(g.tipo) && !g.cierre?.asignacion)
      || (g.estado === 'pendiente_firma' && g.tipo === 'aumento' && !g.aumento?.es_ajuste && !g.aumento?.es_regularizacion));
    const guardadosObj = serialesGuardadosGestion(g);
    st.trabajo = { tipo: 'gestion', g, gid, guardadosObj, corrigiendo, actuales };

    cascaron({
      titulo: `${esc(gid)} · ${total} equipo${total === 1 ? '' : 's'}`,
      sub: `${esc(label)} · ${esc(g.cliente_nombre || 'Cliente')}`
        + (g.tipo === 'aumento' && g.aumento?.contrato_id ? ` · al contrato ${esc(g.aumento.contrato_id)}` : '')
        + (g.tipo === 'demo' && g.demo?.finalidad ? ` · ${esc(g.demo.finalidad)}` : '')
        + (g.tipo === 'aumento' && g.estado === 'pendiente_firma' ? ' · <b>firma del anexo en paralelo</b>' : ''),
      pill: corrigiendo ? 'Corrigiendo seriales'
        : cerrada ? (g.estado === 'anulada' ? 'Anulada' : 'Cerrada') : esperaBodega ? 'Por asignar' : conOS ? 'En programación' : 'Sin pendiente de bodega',
      pillCls: corrigiendo ? 'info' : esperaBodega ? 'aviso' : cerrada ? 'neutro' : 'listo',
    });

    // La picklist dice "saca esto del estante". En un cambio de serial no hay
    // nada que sacar: pintarla mandaría a bodega a buscar un radio que ya está
    // con el cliente.
    const puede = esperaBodega && puedeAsignarGestion();
    if (puede && !esCambio(g) && !corrigiendo) $('asPicklist').innerHTML = await picklistHtml(grupos);

    const asg = crearAsignador({ permitirOmitir: false, clienteId: g.cliente_id || null,
      textoVacio: 'Esta gestión no tiene equipos que asignar.' });
    asg.setGuardados(Object.keys(guardadosObj));
    const hay = asg.render(grupos);

    // ¿Se puede corregir? Bodega ya asignó, la gestión sigue viva. Hasta que
    // cierre: después ya alimentó devoluciones y facturación.
    const puedeCorregir = !cerrada && !esperaBodega && actuales.length > 0 && puedeAsignarGestion();

    if (corrigiendo) {
      const entregado = g.cierre?.entrega === true;
      const marcados = marcadosPorTaller(g);
      $('asBanner').innerHTML = banner(marcados ? 'warn' : 'info',
        (marcados
          ? `<strong>El taller marcó ${marcados} radio(s) que no se pueden usar</strong> (van con ⚠ y su motivo). `
          : '<strong>Corrigiendo los seriales de esta gestión.</strong> ')
        + 'Escribe el serial que de verdad va en cada línea. '
        + (entregado
          ? 'Como ya se entregó, el radio que sale vuelve al estante marcado <strong>verificar físicamente</strong>.'
          : 'El radio que sale vuelve al estante disponible.')
        + ' El que entra tiene que estar en bodega, y toma el lugar exacto del que sale: '
        + 'se corrigen la gestión, sus órdenes y el inventario de una vez.');
      toolbar([]);
      footer([`<button type="button" class="btn btn-primary" data-as="guardar-correccion"><i data-lucide="replace"></i> Guardar corrección</button>`]);
    } else if (!esperaBodega) {
      $('asBanner').innerHTML = banner('ok', conOS
        ? '<strong>Seriales amarrados.</strong> La orden de programación ya existe; el inventario y la orden los tienen.'
        : cerrada ? `<strong>Gestión ${g.estado}.</strong> Solo lectura.` : '<strong>Sin pendiente de bodega.</strong> Esta gestión no espera seriales en este paso.');
      asg.setLocked(true);
      if (puedeCorregir && marcadosPorTaller(g)) {
        $('asBanner').innerHTML = banner('warn',
          `<strong>El taller marcó ${marcadosPorTaller(g)} radio(s) que no se pueden usar.</strong> `
          + 'Entra a <strong>Corregir seriales</strong> y pon los que van en su lugar.');
      }
      // La salida: corregir un serial mal puesto sin anular la gestión entera.
      footer(puedeCorregir
        ? [`<button type="button" class="btn btn-ghost" data-as="corregir"><i data-lucide="replace"></i> Corregir seriales…</button>`]
        : []);
    } else if (!puedeAsignarGestion()) {
      $('asBanner').innerHTML = banner('warn', 'Solo administración e inventario asignan seriales de gestiones.');
      asg.setLocked(true);
      footer([]);
    } else if (hay) {
      if (g.tipo === 'aumento' && g.estado === 'pendiente_firma') {
        $('asBanner').innerHTML = banner('info', 'El anexo está <strong>aprobado</strong> y la firma del cliente corre en paralelo. Puedes asignar desde ya: la orden de programación saldrá sola cuando el anexo quede firmado.');
      }
      if (esCambio(g)) {
        const props = (g.items || []).filter(i => i.serial_nuevo).length;
        $('asBanner').innerHTML = banner('info',
          '<strong>Corrección de registro — no saques nada del estante.</strong> El radio ya está con el cliente; '
          + 'lo que está mal es el serial anotado. Escribe el serial que tiene el radio de verdad'
          + (props ? ` (${props === 1 ? 'uno viene propuesto' : `${props} vienen propuestos`} — verifícalo).` : '.')
          + ' Al guardar, el sistema corrige el contrato y avisa a activaciones.');
        // Sin "Tomar del estante": lo que hay que teclear no está en bodega
        // como stock disponible, es el radio que el cliente tiene en la mano.
        toolbar([]);
        footer([`<button type="button" class="btn btn-primary" data-as="guardar-gestion"><i data-lucide="replace"></i> Guardar corrección</button>`]);
      } else {
        toolbar([`<button type="button" class="btn btn-primary btn-sm" data-as="tomar"><i data-lucide="scan-barcode"></i> Tomar del estante</button>`, BTN_IMPRIMIR]);
        footer([`<button type="button" class="btn btn-primary" data-as="guardar-gestion"><i data-lucide="save"></i> Guardar asignación</button>`]);
      }
    } else {
      footer([]);
    }
    asg.refresh();
    if (window.lucide) lucide.createIcons();
  }

  // norm(serial) → objeto guardado {serial, pool_doc_id, modelo, modelo_id}
  function serialesGuardadosGestion(g) {
    const out = {};
    if (g.tipo === 'reemplazo' || esCambio(g)) {
      (g.items || []).forEach(it => { const k = norm(it.serial_nuevo); if (k) out[k] = { serial: it.serial_nuevo, pool_doc_id: it.pool_doc_id_nuevo || null, modelo: it.modelo_nuevo || it.modelo_solicitado || it.modelo || '', modelo_id: it.modelo_id_nuevo || it.modelo_solicitado_id || it.modelo_id || null }; });
    } else {
      const lista = (g.tipo === 'demo' ? g.demo?.seriales_asignados : g.aumento?.seriales_asignados) || [];
      lista.forEach(s => { const k = norm(s.serial); if (k) out[k] = s; });
    }
    return out;
  }

  function gruposDeGestion(g) {
    if (esCambio(g)) {
      // Un grupo por ítem, con el serial equivocado en el título: lo que
      // bodega compara contra el radio que tiene enfrente. El modelo NO
      // cambia — un dígito mal tecleado no convierte un radio en otro.
      return (g.items || []).map((it, ix) => ({
        clave: String(ix),
        modelo: it.modelo || '—',
        modelo_id: it.modelo_id || '',
        activos: 1,
        titulo: `Figura <span style="font-family:var(--font-mono,monospace);">${esc(it.serial || '—')}</span>`
          + ` <span style="color:var(--fg-3); font-weight:400;">(${esc(it.modelo || '—')}`
          + `${it.contrato_id ? ` · contrato ${esc(it.contrato_id)}` : ''}) → ¿cuál es el serial real?</span>`,
        nota: it.motivo_detalle || it.motivo_codigo ? esc(it.motivo_detalle || it.motivo_codigo) : '',
        slots: it.serial_nuevo ? [{ serial: it.serial_nuevo }] : [],
      }));
    }
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

  // Corregir seriales YA asignados. Bodega solo deja el PEDIDO (los pares
  // anterior→nuevo) en la gestión; mover la gestión, sus órdenes y el pool es
  // de onGestionWrite. El navegador no toca tres sitios a la vez: si se cae a
  // la mitad, queda medio corregido y nadie sabe dónde.
  async function guardarCorreccion() {
    const t = st.trabajo; const asg = st.asignador;
    const g = t.g;
    if ($('asBody').querySelector('.serial-input.dup')) { toast('Hay seriales duplicados (marcados en rojo).', 'warn'); return; }
    const datos = asg.collect();

    // Solo lo que de verdad cambió. Lo que bodega dejó igual no se valida ni
    // se toca: esos radios están asignados, no en bodega — exigirlos en el
    // estante rebotaría la corrección entera por las líneas que están bien.
    const pares = [];
    (t.actuales || []).forEach((a, ix) => {
      const s = datos.seriales.find(x => x.clave === String(ix));
      const nuevo = String(s?.serial || '').trim();
      if (!nuevo || norm(nuevo) === norm(a.serial)) return;
      pares.push({ anterior: a.serial, nuevo, modelo: a.modelo || '', modelo_id: a.modelo_id || null });
    });
    if (!pares.length) { toast('No cambiaste ningún serial.', 'warn'); return; }

    const r = await asg.exigirEnBodega(pares.map(p => ({ serial: p.nuevo, modelo: p.modelo, modelo_id: p.modelo_id })), {});
    if (!r) return;

    const entregado = g.cierre?.entrega === true;
    const ok = await Modal.sheet({
      title: 'Corregir los seriales de la gestión', icon: 'replace', size: 'md',
      html: `
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
          Se corrige la gestión <b>${esc(t.gid)}</b>, sus órdenes de servicio y el inventario, de una vez.</p>
        <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">
          <table style="border-collapse:collapse; width:100%; font-size:13px;">
            ${pares.map(p => `<tr>
              <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-family:var(--font-mono,monospace); color:#991B1B; text-decoration:line-through;">${esc(p.anterior)}</td>
              <td style="padding:6px 10px; border-bottom:1px solid var(--border);">→</td>
              <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-family:var(--font-mono,monospace); color:#065F46; font-weight:700;">${esc(p.nuevo)}</td>
            </tr>`).join('')}
          </table>
        </div>
        <div style="margin-top:12px; padding:10px 12px; background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; color:#92400E; font-size:12.5px; line-height:1.55;">
          El radio que entra toma el lugar exacto del que sale.
          ${entregado
    ? 'Como la gestión ya se entregó, el que sale vuelve al estante marcado <b>verificar físicamente</b>: confirma que lo tienes.'
    : 'El que sale vuelve al estante disponible.'}
        </div>`,
      buttons: [
        { action: 'cancel', label: 'Volver a revisar' },
        { action: 'confirm', label: 'Corregir', primary: true, icon: 'replace' },
      ],
    });
    if (ok !== 'confirm') return;

    const btn = $('asFoot').querySelector('[data-as="guardar-correccion"]'); if (btn) btn.disabled = true;
    try {
      await GestionesService.pedirCorreccionSeriales(t.gid, pares);
      if (r.excepcion) {
        await GestionesService.registrarEvento(t.gid, 'asignar',
          `Excepción de modelo al corregir (${r.excepcion.seriales.join(', ')}): ${r.excepcion.motivo}`).catch(() => {});
      }
      invalidarBodega();
      toast(`Corrección enviada (${pares.length}) — el sistema actualiza la gestión, sus órdenes y el inventario.`, 'ok');
      setTimeout(() => abrirGestion(t.gid), 2500);
    } catch (e) {
      console.error('[Asignar] corrección:', e);
      toast('No se pudo guardar la corrección: ' + (e.message || e), 'bad');
      if (btn) btn.disabled = false;
    }
  }

  async function guardarGestion() {
    const t = st.trabajo; const asg = st.asignador;
    const g = t.g;
    if (asg.validarCompleto() && $('asBody').querySelector('.serial-input.dup')) { toast('Hay seriales duplicados (marcados en rojo).', 'warn'); return; }
    let datos = asg.collect();
    if (!datos.seriales.length && g.tipo !== 'reemplazo' && !esCambio(g)) { toast('Captura al menos un serial.', 'warn'); return; }
    if (esCambio(g) && !datos.seriales.length) { toast('Escribe el serial que tiene el radio de verdad.', 'warn'); return; }
    // Misma política dura que el resto: el serial existe, está en bodega y es
    // del modelo pedido. En una corrección eso es justo lo que se espera —
    // el radio "correcto" nunca salió, así que en el sistema sigue en bodega.
    let r = await asg.exigirEnBodega(datos.seriales, {});
    if (!r) return;
    // Pick & confirm: cuando la asignación queda COMPLETA (sale del estante de
    // verdad) se verifica por escaneo, como en el contrato. Un cambio de
    // serial no saca nada del estante; una parcial se verifica al completarse.
    const esperado = (g.tipo === 'reemplazo' || esCambio(g))
      ? (g.items || []).length
      : ((g.tipo === 'demo' ? g.demo?.lineas : g.aumento?.lineas) || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    let v = null;
    if (!esCambio(g) && esperado && datos.seriales.length >= esperado) {
      v = await verificarPicklist(datos.seriales);
      if (!v) return;
      if (v.reemplazos.length) {
        datos = asg.collect();
        r = await asg.exigirEnBodega(datos.seriales, {});
        if (!r) return;
      }
    }
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
      if (g.tipo === 'reemplazo' || esCambio(g)) {
        const items = (g.items || []).map(it => ({ ...it }));
        items.forEach((it, ix) => {
          const s = datos.seriales.find(x => x.clave === String(ix));
          if (!s) { it.serial_nuevo = null; it.pool_doc_id_nuevo = null; it.modelo_id_nuevo = null; it.modelo_nuevo = null; return; }
          const o = objeto(s);
          it.serial_nuevo = o.serial; it.pool_doc_id_nuevo = o.pool_doc_id; it.asignado_at = new Date().toISOString();
          // El modelo del radio que ENTRA es el de su ficha, no el pedido: un
          // PNC460-R puesto por un PNC550-R partía una ficha fantasma en la OS
          // de programación (GR20260923-01, 2026-09-29). Ver G.modeloEntrante.
          if (g.tipo === 'reemplazo') {
            const u = r.unidades.get(norm(s.serial));
            it.modelo_id_nuevo = u?.modelo_id || null;
            it.modelo_nuevo = u?.modelo_label || null;
          }
          // Lo que bodega confirma deja de ser propuesta de quien la pidió.
          if (esCambio(g)) { it.serial_nuevo_propuesto = false; it.confirmado_por_bodega = true; }
        });
        await GestionesService.asignarItems(t.gid, items, { tipo: g.tipo });
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
      // La verificación queda como evento de la gestión (el doc no admite
      // campos nuevos en rules): quién, cuántas y qué sustituyó.
      if (v) {
        await GestionesService.registrarEvento(t.gid, 'asignar',
          `Lista verificada por escaneo: ${v.n} serial(es)`
          + (v.reemplazos.length ? `. Sustituidos: ${v.reemplazos.map(x => `${x.anterior} → ${x.nuevo} (${x.motivo})`).join('; ')}` : '')).catch(() => {});
      }
      invalidarBodega();
      toast(esCambio(g)
        ? (completo
          ? 'Corrección guardada — el sistema corrige el contrato y avisa a activaciones.'
          : 'Corrección guardada (parcial): falta confirmar el resto para que se aplique.')
        : completo
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

  /* ═════════ Pick & confirm (auditoría UX 2026-09-28, P2 #13) ═════════ */
  // Después de escoger, bodega imprime la lista por serial y va al estante.
  // Antes de cerrar el trabajo confirma unidad por unidad escaneando (o
  // tecleando) el serial del radio que tiene en la mano: ✓ por serial, aviso
  // si el escaneado no está en la lista, "falta N" hasta completar. Lo que no
  // aparece se sustituye por otro disponible del mismo modelo, con motivo, y
  // el que no estaba se lo lleva en el kardex. La verificación queda en
  // seriales_estado/current (contrato) o como evento (gestión).

  function destinoTexto() {
    const t = st.trabajo;
    if (!t) return '';
    if (t.tipo === 'contrato') return `${t.clienteNombre || 'Cliente'} · ${t.contratoIdVisible}`;
    return `${t.g?.cliente_nombre || 'Cliente'} · ${t.gid} (${TIPO_G[t.g?.tipo] || t.g?.tipo || 'gestión'})`;
  }
  function refTrabajo() {
    const t = st.trabajo;
    if (!t) return null;
    return t.tipo === 'contrato'
      ? { tipo: 'contrato', id: t.docId, label: t.contratoIdVisible }
      : { tipo: 'gestion', id: t.gid, label: t.gid };
  }

  // Dónde/cómo está la unidad según el estante (la ficha del pool no tiene
  // estante ni pasillo: se dice lo que sí sabe — condición, ingreso, proveedor).
  function ubicacionDe(u) {
    if (!u) return 'no está en bodega';
    const partes = ['Bodega', u.condicion === 'reuso' ? 'Refurbished' : 'Nuevo'];
    if (u.ingreso_bodega_at?.toDate) partes.push('desde ' + u.ingreso_bodega_at.toDate().toLocaleDateString('es-PA'));
    if (u.proveedor) partes.push(String(u.proveedor));
    return partes.join(' · ');
  }

  // Las filas de la lista: lo que hay en el formulario ahora mismo, con lo que
  // el estante sabe de cada unidad (caché de bodega).
  async function filasPicklist(seriales = null) {
    const lista = seriales || st.asignador.collect().seriales;
    let bodega = [];
    try { bodega = await enBodega(); } catch (e) { /* sin ubicación */ }
    const porNorm = new Map(bodega.map(u => [norm(u.serial || u.serial_norm), u]));
    return lista.map(s => {
      const u = porNorm.get(norm(s.serial)) || null;
      return {
        serial: s.serial, modelo: s.modelo || u?.modelo_label || '', modelo_id: s.modelo_id || u?.modelo_id || '',
        ubicacion: ubicacionDe(u), nota: u?.notas || '',
      };
    });
  }

  async function imprimirPicklist() {
    if (!st.trabajo || !st.asignador) return;
    const filas = await filasPicklist();
    if (!filas.length) { toast('Todavía no hay seriales en la lista: escoge o teclea primero.', 'warn'); return; }
    const user = firebase.auth().currentUser;
    const destino = destinoTexto();
    const fecha = new Date().toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' });
    const tr = filas.map((f, i) => `<tr>
        <td>${i + 1}</td><td>${esc(f.modelo || '—')}</td><td class="mono">${esc(f.serial)}</td>
        <td>${esc(f.ubicacion)}${f.nota ? `<br><small>${esc(f.nota)}</small>` : ''}</td>
        <td>${esc(destino)}</td><td class="chk">☐</td></tr>`).join('');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Lista de picking · ${esc(destino)}</title>
      <style>
        body { font: 13px/1.4 system-ui, sans-serif; color: #111; margin: 24px; }
        h1 { font-size: 18px; margin: 0 0 4px; } .sub { color: #555; margin: 0 0 14px; font-size: 12px; }
        table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { background: #f1f1f1; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
        .mono { font-family: ui-monospace, Consolas, monospace; font-size: 14px; } .chk { font-size: 18px; text-align: center; width: 36px; }
        small { color: #555; } .pie { margin-top: 18px; font-size: 12px; color: #555; }
        @media print { body { margin: 10mm; } }
      </style></head>
      <body onload="window.print()">
        <h1>Lista de picking — ${esc(destino)}</h1>
        <p class="sub">${filas.length} unidad${filas.length === 1 ? '' : 'es'} · impresa ${esc(fecha)}${user?.email ? ` por ${esc(user.email)}` : ''}</p>
        <table><thead><tr><th>#</th><th>Modelo</th><th>Serial</th><th>Ubicación</th><th>Cliente / contrato</th><th>✓</th></tr></thead><tbody>${tr}</tbody></table>
        <p class="pie">Marca cada casilla con el radio en la mano. Al volver, en Almacén · Asignar se escanea cada serial antes de cerrar: lo que no esté se sustituye ahí mismo.</p>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio.', 'warn'); return; }
    w.document.write(html);
    w.document.close();
  }

  // Unidades DISPONIBLES del modelo para sustituir una que no apareció: en
  // bodega, sin DAÑADA / condición / descarte (misma regla que el picker) y
  // que no estén ya en la lista. Las más antiguas primero.
  async function disponiblesDe(modeloId, modelo, excluir) {
    const asg = st.asignador;
    invalidarBodega();
    const bodega = await enBodega();
    const cand = bodega.filter(u => EquiposPoolService._mismoModelo(u, modeloId || null, modelo || '')
      && !excluir.has(norm(u.serial || u.serial_norm)));
    const seriales = cand.map(u => u.serial || u.serial_norm);
    const [descartados, condiciones] = await Promise.all([
      asg.descartadosDe ? asg.descartadosDe(seriales) : Promise.resolve(new Map()),
      asg.condicionesVigentes ? asg.condicionesVigentes() : Promise.resolve(new Map()),
    ]);
    return cand
      .filter(u => !(asg.motivoNoDisponible ? asg.motivoNoDisponible(u, descartados, condiciones) : null))
      .sort((a, b) => (a.ingreso_bodega_at?.toMillis?.() || 0) - (b.ingreso_bodega_at?.toMillis?.() || 0)
        || String(a.serial || '').localeCompare(String(b.serial || '')));
  }

  // La hoja de verificación. Resuelve { n, reemplazos } al confirmar con todo
  // marcado, o null si se vuelve atrás.
  async function hojaVerificacion(filas) {
    const pend = new Map(filas.map(f => [norm(f.serial), { ...f, ok: false }]));
    const reemplazos = [];
    const faltan = () => [...pend.values()].filter(f => !f.ok).length;
    const filaHtml = (k, f) => `<tr data-k="${esc(k)}" style="${f.ok ? 'background:#ECFDF5;' : ''}">
        <td style="width:28px; text-align:center; color:#067647; font-weight:700;">${f.ok ? '✓' : ''}</td>
        <td style="font-family:var(--font-mono, monospace); font-size:13.5px;">${esc(f.serial)}</td>
        <td style="font-size:12.5px;">${esc(f.modelo || '—')}</td>
        <td style="font-size:12px; color:var(--fg-3);">${esc(f.ubicacion)}${f.sustituye ? `<br>en lugar de ${esc(f.sustituye)}` : ''}</td>
        <td style="text-align:right;">${f.ok ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-ver="reemplazar" data-k="${esc(k)}" title="No apareció en el estante: sustituirlo por otro disponible del mismo modelo">No está…</button>`}</td>
      </tr>`;
    const pintar = (root) => {
      root.querySelector('[data-ver="tabla"]').innerHTML = [...pend.entries()].map(([k, f]) => filaHtml(k, f)).join('');
      const n = faltan();
      root.querySelector('[data-ver="faltan"]').innerHTML = n
        ? `Falta${n === 1 ? '' : 'n'} <b>${n}</b> de ${pend.size}`
        : `<b style="color:#067647;">Todo verificado</b> · ${pend.size} de ${pend.size}`;
      const btn = root.querySelector('[data-sheet-action="confirm"]');
      if (btn) btn.disabled = n > 0;
    };
    const aviso = (root, msg, kind) => {
      const el = root.querySelector('[data-ver="aviso"]');
      const colores = { ok: ['#ECFDF5', '#065F46'], warn: ['#FFFBEB', '#92400E'], bad: ['#FEF2F2', '#991B1B'] }[kind] || ['#EFF6FF', '#1E3A8A'];
      el.textContent = msg; el.style.background = colores[0]; el.style.color = colores[1];
      el.style.display = msg ? '' : 'none';
    };
    const procesar = (root, valor) => {
      const k = norm(valor);
      if (!k) return;
      const f = pend.get(k);
      if (!f) { aviso(root, `${valor.trim()} NO está en la lista. Revisa el radio; si va en lugar de otro, usa "No está…" en la fila que sustituye.`, 'bad'); return; }
      if (f.ok) { aviso(root, `${f.serial} ya estaba marcado.`, 'warn'); return; }
      f.ok = true;
      aviso(root, `✓ ${f.serial} · ${f.modelo || ''}`, 'ok');
      pintar(root);
    };
    const reemplazar = async (root, k) => {
      const f = pend.get(k);
      if (!f || f.ok) return;
      const motivo = await Modal.prompt({
        title: 'No está en el estante', confirmLabel: 'Buscar sustituto',
        message: `${f.serial} (${f.modelo || 'modelo ?'}) no apareció al verificar. ¿Qué pasó? Queda en el kardex de esa unidad.`,
        placeholder: 'Ej.: no está en el estante; la etiqueta no coincide; está dañado',
      });
      if (!motivo || !motivo.trim()) return;
      let cand = [];
      try { cand = await disponiblesDe(f.modelo_id, f.modelo, new Set(pend.keys())); }
      catch (e) { console.warn('[Asignar] sustitutos:', e?.code || e); }
      if (!cand.length) { toast(`No hay otra unidad disponible de ${f.modelo || 'ese modelo'} en bodega.`, 'warn'); return; }
      const r = await EntityPicker.abrir({
        titulo: `Sustituto para ${f.serial}`, icono: 'replace', size: 'md', multiple: false,
        descripcion: `Unidades disponibles de <b>${esc(f.modelo || '')}</b> (las más antiguas primero). La que escojas también hay que escanearla.`,
        grupos: [{ id: 0, titulo: f.modelo || 'Modelo', cupos: 1,
          items: cand.map(u => ({ id: u.serial || u.serial_norm, label: u.serial || u.serial_norm, sub: ubicacionDe(u) })) }],
        confirmar: 'Usar esta', iconoConfirmar: 'check', placeholderBuscar: 'Filtrar por serial…', normalizar: (s) => norm(s),
      });
      const nuevo = r?.seleccion?.[0]?.id;
      if (!nuevo) return;
      const u = cand.find(x => (x.serial || x.serial_norm) === nuevo) || null;
      pend.delete(k);
      pend.set(norm(nuevo), { serial: nuevo, modelo: f.modelo, modelo_id: f.modelo_id, ubicacion: ubicacionDe(u), ok: false, sustituye: f.serial });
      reemplazos.push({ anterior: f.serial, nuevo, modelo: f.modelo, modelo_id: f.modelo_id, motivo: motivo.trim() });
      pintar(root);
      aviso(root, `${nuevo} va en lugar de ${f.serial}. Escanéalo para marcarlo.`, 'warn');
      root.querySelector('[data-ver="input"]')?.focus();
    };
    const r = await Modal.sheet({
      title: 'Verificar la lista', icon: 'scan-line', size: 'md',
      html: `
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-2);">Con el radio en la mano, escanea o teclea su serial y pulsa Enter. Cada uno se marca ✓; el que no aparezca se sustituye con <b>No está…</b>.</p>
        <input class="form-input" data-ver="input" type="text" autocomplete="off" placeholder="Escanea o teclea el serial y pulsa Enter"
               style="font-family:var(--font-mono, monospace); font-size:15px; height:42px; margin-bottom:8px;">
        <div data-ver="aviso" style="display:none; padding:8px 10px; border-radius:8px; font-size:12.5px; margin-bottom:8px;"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; margin-bottom:6px;">
          <span data-ver="faltan"></span><span style="color:var(--fg-3);">${esc(destinoTexto())}</span>
        </div>
        <div style="border:1px solid var(--border); border-radius:8px; max-height:300px; overflow-y:auto;">
          <table style="border-collapse:collapse; width:100%;"><tbody data-ver="tabla"></tbody></table>
        </div>`,
      buttons: [
        { action: 'cancel', label: 'Volver' },
        { action: 'confirm', label: 'Lista verificada', primary: true, icon: 'check' },
      ],
      onMount: (root) => {
        pintar(root);
        const inp = root.querySelector('[data-ver="input"]');
        inp.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          procesar(root, inp.value);
          inp.value = '';
        });
        root.addEventListener('click', (e) => {
          const b = e.target.closest('[data-ver="reemplazar"]');
          if (b) reemplazar(root, b.dataset.k);
        });
        setTimeout(() => inp.focus(), 80);
      },
      onAction: (action) => {
        if (action === 'confirm' && faltan() > 0) { toast(`Faltan ${faltan()} por verificar.`, 'warn'); return false; }
        return action;
      },
    });
    if (r !== 'confirm') return null;
    return { n: pend.size, reemplazos };
  }

  // Aplica los sustitutos al formulario y deja el rastro en el kardex del que
  // no estaba (solo si tiene ficha; sin ficha no hay dónde anotarlo).
  async function aplicarReemplazos(reemplazos) {
    const asg = st.asignador;
    const user = firebase.auth().currentUser;
    for (const r of reemplazos) {
      const inp = [...asg.body.querySelectorAll('.serial-input')].find(i => norm(i.value) === norm(r.anterior));
      if (inp) inp.value = r.nuevo;
      try {
        const docs = await EquiposPoolService.findBySerial(r.anterior);
        const d = Array.isArray(docs) ? docs[0] : null;
        if (d && EquiposPoolService.registrarMovimiento) {
          await EquiposPoolService.registrarMovimiento(d.id, {
            tipo: 'picklist_no_encontrado', estadoActual: d.estado || null, ref: refTrabajo(),
            notas: `${r.motivo} — sustituido por ${r.nuevo} al verificar la lista de ${destinoTexto()}`,
          }, user);
        }
      } catch (e) { console.warn('[Asignar] kardex del sustituido:', e?.code || e); }
    }
    asg.refresh();
  }

  // El paso completo: filas → hoja → sustitutos aplicados. null = volver.
  async function verificarPicklist(seriales) {
    const filas = await filasPicklist(seriales);
    if (!filas.length) return { n: 0, reemplazos: [] };
    const v = await hojaVerificacion(filas);
    if (!v) return null;
    if (v.reemplazos.length) await aplicarReemplazos(v.reemplazos);
    return v;
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
      else if (a === 'imprimir') imprimirPicklist();
      else if (a === 'traer-original') traerDelOriginal();
      else if (a === 'guardar') guardarAvance();
      else if (a === 'listo') listoParaProgramar();
      else if (a === 'reemplazo') guardarReemplazo();
      else if (a === 'guardar-gestion') guardarGestion();
      else if (a === 'corregir') abrirGestion(st.trabajo?.gid, { corregir: true });
      else if (a === 'guardar-correccion') guardarCorreccion();
    });
  });

  return { activar, recargar, abrirContrato, abrirGestion, cargarCola, imprimirPicklist, verificarPicklist };
})();
