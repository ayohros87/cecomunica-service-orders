// @ts-nocheck
// Caja menuda · Contabilidad — la bandeja de quien custodia el fondo
// (caja/contabilidad.html). Escritorio primero.
//
// Izquierda: todo lo abierto, filtrable por lo que le toca hacer a
// contabilidad (pagar o entregar · esperar la rendición · cerrarla) más los
// terminados del mes elegido. Derecha: el gasto con su factura a la vista y
// los botones que aplican. "Excel del mes" saca todos los gastos del mes para
// el registro en QuickBooks. "Fondo y tope" edita empresa/caja_menuda.
(function () {
  const C = () => window.CajaMenuda;
  const S = () => window.CajaMenudaService;
  const esc = (s) => FMT.esc(s);
  const $ = (id) => document.getElementById(id);

  // Filtro → estados. El orden es el del trabajo: primero lo que espera a
  // contabilidad.
  const FILTROS = [
    { id: 'pagar', label: 'Por pagar o entregar', tono: 'aviso', estados: ['aprobado'] },
    { id: 'cerrar', label: 'Por cerrar', tono: 'info', estados: ['rendido'] },
    { id: 'rendir', label: 'Esperan la factura', tono: 'neutro', estados: ['entregado'] },
    { id: 'jefe', label: 'Esperan al jefe', tono: 'neutro', estados: ['solicitado'] },
    { id: 'hechos', label: 'Terminados del mes', tono: 'listo', estados: ['pagado', 'cerrado', 'rechazado', 'anulado'] },
  ];

  let yo = null, cfg = null;
  let todos = [];
  let filtro = 'abiertos';
  let busqueda = '';
  let sel = null; // id del gasto abierto a la derecha
  let mes = '';   // YYYY-MM

  const ms = (t) => (t?.toMillis ? t.toMillis() : 0);
  const delMes = (g) => {
    const d = g.created_at?.toDate ? g.created_at.toDate() : null;
    return !!d && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === mes;
  };
  const inicioDelMes = () => { const [y, m] = mes.split('-').map(Number); return new Date(y, m - 1, 1); };

  function deFiltro(id) {
    if (id === 'abiertos') return todos.filter(g => C().ABIERTOS.includes(g.estado));
    const f = FILTROS.find(x => x.id === id);
    const lista = todos.filter(g => f.estados.includes(g.estado));
    return id === 'hechos' ? lista.filter(delMes) : lista;
  }

  function visibles() {
    const q = FMT.normalize(busqueda);
    let lista = deFiltro(filtro);
    if (q) {
      lista = lista.filter(g => [g.solicitante_nombre, g.concepto, g.numero, g.proveedor, g.categoria, g.factura_numero]
        .some(v => FMT.normalize(String(v || '')).includes(q)));
    }
    // Lo abierto: lo más viejo arriba (es lo que más espera). Terminados: lo último arriba.
    return filtro === 'hechos' ? lista : [...lista].sort((a, b) => ms(a.created_at) - ms(b.created_at));
  }

  const suma = (lista, campo = 'monto') => lista.reduce((n, g) => n + (Number(campo === 'entrega' ? g.entrega?.monto : g.monto) || 0), 0);

  function pintarKpis() {
    const pagar = deFiltro('pagar').filter(g => g.via !== 'ach');
    const ach = deFiltro('pagar').filter(g => g.via === 'ach');
    const rendir = deFiltro('rendir');
    const tarde = rendir.filter(g => (C().diasSinRendir(g) ?? 0) > cfg.dias_rendir).length;
    const kpi = (n, monto, label) => `<div class="cc-kpi"><div class="cc-kpi-n">${n}${n ? `<small>${C().dinero(monto)}</small>` : ''}</div><div class="cc-kpi-l">${label}</div></div>`;
    $('ccKpis').innerHTML =
      kpi(pagar.length, suma(pagar), 'Por pagar o entregar en efectivo')
      + kpi(ach.length, suma(ach), 'Reembolsos por ACH')
      + kpi(rendir.length, suma(rendir, 'entrega'), `Anticipos en la calle${tarde ? ` · ${tarde} pasados de ${cfg.dias_rendir} días` : ''}`)
      + kpi(deFiltro('cerrar').length, suma(deFiltro('cerrar'), 'entrega'), 'Rendiciones por cerrar');
  }

  function pintarFiltros() {
    const items = [{ id: 'abiertos', label: 'Pendientes', n: deFiltro('abiertos').length, all: true, active: filtro === 'abiertos' },
      ...FILTROS.map(f => ({ id: f.id, label: f.label, n: deFiltro(f.id).length, tono: f.tono, active: filtro === f.id }))];
    $('ccFiltros').innerHTML = items.map(Bandeja.filtro).join('');
  }

  function pintarLista() {
    const lista = visibles();
    $('ccLista').innerHTML = lista.length
      ? lista.map(g => CajaUI.tarjeta(g, { quien: 'otro' })).join('')
      : Bandeja.vacio(filtro === 'hechos' ? 'Nada terminado este mes.' : 'Nada pendiente.');
    $('ccLista').querySelectorAll('[data-cm-id]').forEach(b => b.classList.toggle('is-on', b.dataset.cmId === sel));
    if (window.lucide?.createIcons) lucide.createIcons({ nodes: [$('ccLista')] });
  }

  function pintarDetalle() {
    const cont = $('ccDetalle');
    const g = todos.find(x => x.id === sel);
    if (!g) { cont.innerHTML = `<div class="cc-detalle-vacio">Elige un gasto para ver su factura.</div>`; return; }
    const acciones = C().acciones(g, yo);
    const orden = [...acciones].sort((a, b) => (CajaUI.BOTONES[a].primary ? 1 : 0) - (CajaUI.BOTONES[b].primary ? 1 : 0));
    const btn = (a) => {
      const b = CajaUI.BOTONES[a];
      return `<button type="button" class="btn ${b.danger ? 'btn-danger' : b.primary ? 'btn-primary' : 'btn-ghost'}" data-cc-accion="${a}">${esc(b.label)}</button>`;
    };
    const cats = cfg.categorias.includes(g.categoria) ? cfg.categorias : [g.categoria, ...cfg.categorias].filter(Boolean);
    cont.innerHTML = CajaUI.detalleHtml(g)
      + `<div class="cc-acciones">
          <select class="form-input" id="ccCat" title="Reclasificar la categoría" style="max-width:190px;margin-right:auto;height:34px;font-size:13px;">
            ${cats.map(c => `<option${c === g.categoria ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          ${orden.map(btn).join('')}</div>`;
    CajaUI.cargarRecibos(cont, g);
  }

  function pintar() { pintarKpis(); pintarFiltros(); pintarLista(); pintarDetalle(); }

  async function cargar() {
    try {
      todos = await S().bandeja({ desde: inicioDelMes() });
      if (sel && !todos.some(g => g.id === sel)) sel = null;
      pintar();
    } catch (e) {
      console.error('[caja-contabilidad] cargar:', e);
      $('ccLista').innerHTML = `<div class="cm-vacio">No se pudo cargar. Revisa la conexión y recarga.</div>`;
    }
  }

  const panelVisible = () => getComputedStyle($('ccDetalle')).display !== 'none';

  // ── Excel del mes ───────────────────────────────────────────────────────
  // Todos los gastos creados en el mes elegido, en cualquier estado: es el
  // reporte que contabilidad pasa a QuickBooks (cuestionario, 2026-11-26).
  async function excel() {
    const lista = todos.filter(delMes).sort((a, b) => ms(a.created_at) - ms(b.created_at));
    if (!lista.length) { Toast.show('No hay gastos en ese mes.', 'warn'); return; }
    try {
      const XLSX = await cargarXLSX();
      const f = (t) => (t?.toDate ? t.toDate().toLocaleDateString('es-PA') : '');
      const filas = lista.map(g => ({
        'N.º': g.numero || '',
        'Pedido el': f(g.created_at),
        'Persona': g.solicitante_nombre || '',
        'Tipo': C().TIPOS[g.tipo]?.label || g.tipo,
        'Categoría': g.categoria || '',
        'Concepto': g.concepto || '',
        'Proveedor': g.proveedor || '',
        'Fecha factura': g.fecha_gasto || '',
        'N.º factura': g.factura_numero || '',
        'Monto pedido': Number(g.monto) || 0,
        'Estado': C().ESTADOS[g.estado]?.label || g.estado,
        'Aprobó': g.aprobacion?.por_nombre || '',
        'Vía': g.via === 'ach' ? 'ACH' : 'Efectivo',
        'Entregado': g.entrega ? Number(g.entrega.monto) || 0 : '',
        'Fecha de pago': f(g.entrega?.at),
        'Referencia': g.entrega?.referencia || '',
        'Gastado (anticipo)': g.rendicion ? Number(g.rendicion.monto_gastado) || 0 : '',
        'Vuelto recibido': g.cierre ? Number(g.cierre.vuelto_recibido) || 0 : '',
        'Diferencia pagada': g.cierre ? Number(g.cierre.diferencia_pagada) || 0 : '',
        'Efectivo que salió del fondo': C().efectivoFuera(g),
      }));
      const ws = XLSX.utils.json_to_sheet(filas);
      ws['!cols'] = Object.keys(filas[0]).map(k => ({ wch: Math.max(12, k.length + 2) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Caja menuda');
      XLSX.writeFile(wb, `caja-menuda-${mes}.xlsx`);
    } catch (e) { console.error(e); Toast.show(e.message || 'No se pudo generar el Excel.', 'bad'); }
  }

  // ── Fondo y tope ────────────────────────────────────────────────────────
  async function configurar() {
    const campo = (id, label, v, ayuda) => `<label class="cm-campo"><span>${label}</span>
      <input type="text" inputmode="decimal" id="${id}" class="form-input" value="${esc(v)}">${ayuda ? `<small class="form-hint">${ayuda}</small>` : ''}</label>`;
    const res = await Modal.sheet({
      title: 'Fondo y tope de caja menuda', icon: 'settings-2', size: 'sm',
      html: `<div class="cm-form">
        ${campo('cfFondo', 'Monto del fondo ($)', cfg.fondo)}
        ${campo('cfTope', 'Tope por factura ($)', cfg.tope_recibo, 'Un reembolso que lo pase se devuelve por ACH, no en efectivo.')}
        ${campo('cfMin', 'Reponer cuando queden ($)', cfg.minimo_reposicion)}
        ${campo('cfDias', 'Días para rendir un anticipo', cfg.dias_rendir)}
        <label class="cm-campo"><span>Categorías <em>(una por línea)</em></span>
          <textarea id="cfCats" class="form-input" rows="7" style="font-size:14px;">${esc(cfg.categorias.join('\n'))}</textarea></label>
      </div>`,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Guardar', primary: true }],
      async onAction(action, root) {
        if (action !== 'ok') return action;
        const n = (id) => C().num(root.querySelector('#' + id).value);
        const nuevo = { fondo: n('cfFondo'), tope_recibo: n('cfTope'), minimo_reposicion: n('cfMin'), dias_rendir: n('cfDias'),
          categorias: root.querySelector('#cfCats').value.split('\n').map(s => s.trim()).filter(Boolean) };
        if (![nuevo.fondo, nuevo.tope_recibo, nuevo.minimo_reposicion, nuevo.dias_rendir].every(v => v > 0)) { Toast.show('Los cuatro números tienen que ser mayores que cero.', 'warn'); return false; }
        if (!nuevo.categorias.length) { Toast.show('Deja al menos una categoría.', 'warn'); return false; }
        try { cfg = await S().guardarConfig(nuevo); return 'hecho'; }
        catch (e) { console.error(e); Toast.show('No se pudo guardar.', 'bad'); return false; }
      },
    });
    if (res === 'hecho') { CajaUI.init({ yo, cfg, onCambio: cargar }); Toast.show('Guardado.', 'ok'); pintar(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const hoy = new Date();
    mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    $('ccMes').value = mes;
    $('ccMes').addEventListener('change', () => { if (/^\d{4}-\d{2}$/.test($('ccMes').value)) { mes = $('ccMes').value; cargar(); } });
    $('ccBuscar').addEventListener('input', () => { busqueda = $('ccBuscar').value; pintarLista(); });
    $('ccFiltros').addEventListener('click', (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      filtro = b.dataset.f; pintarFiltros(); pintarLista();
    });
    $('ccLista').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cm-id]');
      if (!c) return;
      const g = todos.find(x => x.id === c.dataset.cmId);
      if (!g) return;
      if (!panelVisible()) { CajaUI.abrir(g); return; }
      sel = g.id; pintarLista(); pintarDetalle();
    });
    $('ccDetalle').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cc-accion]');
      if (!b) return;
      const g = todos.find(x => x.id === sel);
      if (!g) return;
      b.disabled = true;
      try { if (await CajaUI.ejecutar(b.dataset.ccAccion, g)) await cargar(); }
      catch (err) { console.error(err); Toast.show(err?.code === 'permission-denied' ? 'Alguien ya movió este gasto. Recargando.' : (err.message || 'No se pudo guardar.'), 'bad'); await cargar(); }
      finally { b.disabled = false; }
    });
    $('ccDetalle').addEventListener('change', async (e) => {
      if (e.target.id !== 'ccCat') return;
      try { await S().reclasificar(sel, e.target.value); Toast.show('Categoría cambiada.', 'ok'); await cargar(); }
      catch (err) { console.error(err); Toast.show('No se pudo cambiar la categoría.', 'bad'); pintarDetalle(); }
    });
    $('ccExcel').addEventListener('click', excel);
    $('ccConfig').addEventListener('click', configurar);

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../login.html'; return; }
      try {
        const p = await Sesion.miPerfil(user);
        window.userRole = p.rol || '';
        // El fondo y lo que pide cada quien: solo quien custodia la caja.
        if (!C().esCustodio(window.userRole)) { MODULOS.rechazar('Esta bandeja es de contabilidad.'); return; }
        yo = { uid: user.uid, rol: p.rol, nombre: p.nombre || user.displayName || '', email: user.email || '' };
        S().usar(yo);
        cfg = await S().config();
        CajaUI.init({ yo, cfg, onCambio: cargar });
        await cargar();
        const g = new URLSearchParams(location.search).get('g');
        if (g && todos.some(x => x.id === g)) { sel = g; pintar(); }
      } catch (e) {
        console.error('[caja-contabilidad] arranque:', e);
        $('ccLista').innerHTML = `<div class="cm-vacio">No se pudo cargar. Revisa la conexión y recarga.</div>`;
      }
    });
  });
})();
