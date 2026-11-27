// @ts-nocheck
// Caja menuda · Contabilidad — la bandeja de quien custodia el fondo
// (caja/contabilidad.html). Escritorio primero.
//
// Izquierda: todo lo abierto, filtrable por lo que le toca hacer a
// contabilidad (pagar o entregar · esperar la rendición · cerrarla) más los
// terminados del mes elegido. Derecha: el gasto con su factura a la vista y
// los botones que aplican. "Excel del mes" saca todos los gastos del mes para
// el registro en QuickBooks. "Fondo y tope" edita empresa/caja_menuda.
//
// Arriba, el fondo: cuánto debe haber en caja, y "Arqueo y reposición" —
// contar el efectivo por denominación y juntar los recibos pagados en el
// informe con el que se pide el cheque (el formato del Excel de Cheila,
// muestras del 2026-11-26). El informe es por reposición, no por mes.
//
// "Solicitud de pago" imprime la hoja del formato de contabilidad para lo que
// no se paga del fondo — el reembolso por ACH y el cheque de la reposición —
// con lo que ya se aprobó en el sistema; las firmas (y el Vo.Bo. del
// director) van a mano (Alberto, 2026-11-27).
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
  // El fondo: recibos pagados sin reponer (de cualquier mes) y las
  // reposiciones y arqueos recientes.
  let fondo = { gastos: [], reposiciones: [] };

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
    // Un gasto que ya entró en una reposición no se reclasifica: el informe
    // de esa reposición quedó congelado con la categoría que tenía.
    cont.innerHTML = CajaUI.detalleHtml(g)
      + `<div class="cc-acciones">
          ${g.reposicion_id
            ? `<span class="cc-repuesto"><i data-lucide="check"></i> En la reposición ${esc(g.reposicion_numero || '')}</span>`
            : `<select class="form-input" id="ccCat" title="Reclasificar la categoría" style="max-width:190px;margin-right:auto;height:34px;font-size:13px;">
            ${cats.map(c => `<option${c === g.categoria ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`}
          ${C().llevaSolicitudPago(g) ? `<button type="button" class="btn btn-ghost" data-cc-solicitud title="La hoja para las firmas y el Vo.Bo."><i data-lucide="printer"></i> Solicitud de pago</button>` : ''}
          ${orden.map(btn).join('')}</div>`;
    if (window.lucide?.createIcons) lucide.createIcons({ nodes: [cont] });
    CajaUI.cargarRecibos(cont, g);
  }

  // La solicitud de pago en papel: la hoja con lo que ya se aprobó, para
  // llevarla a firmar. `que` es { gasto } o { reposicion }.
  function imprimirSolicitud(que) {
    CajaSolicitud.abrir(C().solicitudPago({ ...que, cfg, hoy: FMT.hoyISOPanama() }), { por: yo.nombre });
  }

  // ── El fondo ────────────────────────────────────────────────────────────
  // Lo que cuenta para el cuadre: lo que el servidor marcó por reponer (de
  // cualquier mes) más lo que esta pantalla acaba de leer — un recibo pagado
  // hace un segundo todavía no trae la marca.
  function gastosDelFondo() {
    const porId = new Map();
    for (const g of fondo.gastos) porId.set(g.id, g);
    for (const g of todos) porId.set(g.id, g);
    return [...porId.values()];
  }
  const cuadre = (conteo = null) => C().cuadre({ fondo: cfg.fondo, gastos: gastosDelFondo(), reposiciones: fondo.reposiciones, conteo });

  function pintarFondo() {
    const d = C().dinero;
    const q = cuadre();
    const toca = q.n > 0 && q.esperado <= cfg.minimo_reposicion;
    const partes = [`Fondo ${d(q.fondo)}`, `${q.n} ${q.n === 1 ? 'recibo pagado' : 'recibos pagados'} sin reponer: ${d(q.gastado)}`];
    if (q.anticipos) partes.push(`anticipos en la calle: ${d(q.anticipos)}`);
    if (q.por_cobrar) partes.push(`reposición con el cheque por cobrar: ${d(q.por_cobrar)}`);
    $('ccFondo').innerHTML = `
      <div class="cc-fondo-n${toca ? ' is-bajo' : ''}"><b>${d(q.esperado)}</b><span>debe haber en caja</span></div>
      <div class="cc-fondo-d">${partes.map(esc).join(' · ')}${toca ? `<span class="cc-fondo-toca">Toca reponer el fondo</span>` : ''}</div>
      <button type="button" class="btn btn-ghost btn-sm" data-cc-fondo="historial"><i data-lucide="history"></i> Reposiciones y arqueos</button>
      <button type="button" class="btn btn-primary btn-sm" data-cc-fondo="arqueo"><i data-lucide="calculator"></i> Arqueo y reposición</button>`;
    if (window.lucide?.createIcons) lucide.createIcons({ nodes: [$('ccFondo')] });
  }

  // El informe de una reposición (o de un arqueo) en el formato del Excel de
  // Cheila: es lo que se imprime y acompaña la solicitud del cheque.
  async function excelInforme(rep) {
    try {
      const XLSX = await cargarXLSX();
      const { filas, columnas } = C().informe(rep, cfg.categorias);
      const ws = XLSX.utils.aoa_to_sheet(filas);
      ws['!cols'] = Array.from({ length: columnas }, (_, i) => ({ wch: i === 2 ? 24 : i === columnas - 2 ? 60 : 14 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, rep.numero || 'Informe');
      XLSX.writeFile(wb, `caja-menuda-${rep.numero || 'informe'}.xlsx`);
    } catch (e) { console.error(e); Toast.show(e.message || 'No se pudo generar el Excel.', 'bad'); }
  }

  // Arqueo: se cuenta el efectivo por denominación y se compara con lo que
  // debe haber. Se puede guardar solo (el arqueo de la semana) o armar de una
  // vez la reposición con los recibos pagados.
  async function hojaArqueo() {
    const d = C().dinero;
    const q0 = cuadre();
    const items = C().itemsInforme(gastosDelFondo());
    const etiqueta = (v) => (v < 1 ? `${Math.round(v * 100)}¢` : `$${v}`);
    const den = (tipo) => C().DENOMINACIONES.filter(x => x.tipo === tipo).map(x => `
      <label class="cc-den"><span>${etiqueta(x.valor)}</span>
        <input type="text" inputmode="numeric" class="form-input" data-den="${x.id}" autocomplete="off" placeholder="0" aria-label="Cantidad de ${tipo}s de ${etiqueta(x.valor)}">
        <em data-den-m="${x.id}">$0.00</em></label>`).join('');
    const linea = (txt, monto, cls = '') => `<div class="cc-cuadre-l ${cls}"><span>${txt}</span><b>${monto}</b></div>`;
    const rango = items.length ? ` · ${esc(items[0].numero)} al ${esc(items[items.length - 1].numero)}` : '';
    const html = `<div class="cm-form">
      <div class="cc-cuadre">
        ${linea('Fondo', d(q0.fondo))}
        ${linea(`Recibos pagados sin reponer (${q0.n})${rango}`, '− ' + d(q0.gastado))}
        ${q0.anticipos ? linea('Anticipos en la calle', '− ' + d(q0.anticipos)) : ''}
        ${q0.por_cobrar ? linea('Reposición pedida, cheque por cobrar', '− ' + d(q0.por_cobrar)) : ''}
        ${linea('Debe haber en caja', d(q0.esperado), 'is-total')}
      </div>
      <div class="cc-dens">
        <fieldset><legend>Monedas</legend>${den('moneda')}</fieldset>
        <fieldset><legend>Billetes</legend>${den('billete')}</fieldset>
      </div>
      <div class="cc-cuadre">
        ${linea('Efectivo contado', '<span id="ccArqEfectivo">$0.00</span>', 'is-total')}
        <div class="cc-cuadre-l" id="ccArqDif"><span>Diferencia</span><b>—</b></div>
      </div>
      <label class="cm-campo"><span>Nota <em>(si no cuadra, explica por qué)</em></span>
        <textarea id="ccArqNota" class="form-input" rows="2" maxlength="300"></textarea></label>
      ${q0.n ? `<p class="form-hint" style="margin:0;">Al reponer, los ${q0.n} recibos quedan en un informe para pedir el cheque por ${d(q0.gastado)} y no vuelven a salir en la próxima reposición. No se puede deshacer.</p>` : ''}
    </div>`;
    const entradas = (root) => [...root.querySelectorAll('[data-den]')];
    const leer = (root) => {
      const conteo = {};
      for (const i of entradas(root)) {
        const t = i.value.trim();
        const n = t === '' ? 0 : Number(t);
        if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
        conteo[i.dataset.den] = n;
      }
      return conteo;
    };
    const refrescar = (root) => {
      const conteo = leer(root);
      const a = C().arqueo(conteo || {});
      for (const l of a.lineas) root.querySelector(`[data-den-m="${l.id}"]`).textContent = d(l.monto);
      root.querySelector('#ccArqEfectivo').textContent = d(a.efectivo);
      const el = root.querySelector('#ccArqDif');
      const vacio = !entradas(root).some(i => i.value.trim() !== '');
      if (!conteo || vacio) { el.className = 'cc-cuadre-l'; el.innerHTML = `<span>Diferencia</span><b>—</b>`; return; }
      const dif = cuadre(conteo).diferencia;
      el.className = 'cc-cuadre-l ' + (dif === 0 ? 'is-ok' : 'is-mal');
      el.innerHTML = dif === 0 ? `<span>Cuadra</span><b>$0.00</b>` : (dif > 0 ? `<span>Sobra</span><b>${d(dif)}</b>` : `<span>Falta</span><b>${d(-dif)}</b>`);
    };
    let ocupado = false;
    const res = await Modal.sheet({
      title: 'Arqueo y reposición del fondo', icon: 'calculator', size: 'md', html,
      buttons: [{ action: 'cancelar', label: 'Cancelar' },
        { action: 'arqueo', label: 'Guardar solo el arqueo', primary: !q0.n },
        ...(q0.n ? [{ action: 'reponer', label: `Reponer ${d(q0.gastado)}`, primary: true }] : [])],
      onMount(root) { root.addEventListener('input', (e) => { if (e.target.matches('[data-den]')) refrescar(root); }); },
      async onAction(action, root) {
        if (action === 'cancelar') return action;
        if (ocupado) return false;
        const conteo = leer(root);
        if (!conteo) { Toast.show('Las cantidades son números enteros.', 'warn'); return false; }
        if (!entradas(root).some(i => i.value.trim() !== '')) { Toast.show('Cuenta el efectivo antes de guardar.', 'warn'); return false; }
        ocupado = true;
        try {
          const r = await S().reponer({ conteo, nota: root.querySelector('#ccArqNota').value, solo_arqueo: action === 'arqueo', ids: items.map(i => i.id) });
          return { ...r, accion: action };
        } catch (e) { console.error(e); Toast.show(e.message || 'No se pudo guardar.', 'bad'); return false; }
        finally { ocupado = false; }
      },
    });
    if (!res || res === 'cancelar') return;
    await cargar();
    const dif = Number(res.diferencia) || 0;
    Toast.show(`${res.numero} guardado: ${dif === 0 ? 'la caja cuadra' : (dif > 0 ? `sobran ${d(dif)}` : `faltan ${d(-dif)}`)}.`
      + (res.accion === 'reponer' ? ' La solicitud de pago del cheque se imprime en "Reposiciones y arqueos".' : ''), dif === 0 ? 'ok' : 'warn');
    if (res.accion === 'reponer') {
      const rep = fondo.reposiciones.find(r => r.id === res.id);
      if (rep) await excelInforme(rep);
    }
  }

  // Reposiciones y arqueos hechos: el informe en Excel de cada uno, y dónde
  // se anota que el cheque de la reposición ya se cobró.
  async function hojaHistorial() {
    const d = C().dinero;
    const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : '');
    const fila = (r) => {
      const dif = Number(r.arqueo?.diferencia) || 0;
      const esRep = r.tipo === 'reposicion';
      const estado = !esRep ? '' : (r.estado === 'repuesta'
        ? `<span class="bj-chip bj-chip--listo">Cheque cobrado${r.pago?.referencia ? ' · ' + esc(r.pago.referencia) : ''}</span>`
        : `<span class="bj-chip bj-chip--aviso">Cheque por cobrar</span>`);
      return `<div class="cc-rep" data-rep="${esc(r.id)}">
        <div class="cc-rep-t"><b>${esc(r.numero || '')}</b> · ${esc(dmy(r.fecha))}${r.created_by_nombre ? ' · ' + esc(r.created_by_nombre) : ''} ${estado}</div>
        <div class="cc-rep-d">${esRep
          ? `${r.n} ${r.n === 1 ? 'recibo' : 'recibos'} (${esc(r.desde || '')} al ${esc(r.hasta || '')}) · <b>${d(r.total)}</b>`
          : `Contado ${d(r.arqueo?.efectivo)} de ${d(r.esperado)}`}
          · ${dif === 0 ? 'cuadró' : `<span class="cc-rep-dif">${dif > 0 ? 'sobraron' : 'faltaron'} ${d(Math.abs(dif))}</span>`}${r.nota ? ` · ${esc(r.nota)}` : ''}</div>
        <div class="cc-rep-b">
          ${esRep && r.estado === 'preparada' ? `<button type="button" class="btn btn-ghost btn-sm" data-rep-cobrada="${esc(r.id)}">Cheque cobrado</button>` : ''}
          ${esRep ? `<button type="button" class="btn btn-ghost btn-sm" data-rep-solicitud="${esc(r.id)}" title="La hoja para pedir el cheque"><i data-lucide="printer"></i> Solicitud de pago</button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-rep-excel="${esc(r.id)}"><i data-lucide="file-spreadsheet"></i> Informe</button>
        </div></div>`;
    };
    const res = await Modal.sheet({
      title: 'Reposiciones y arqueos', icon: 'history', size: 'md',
      html: fondo.reposiciones.length
        ? `<div class="cc-reps">${fondo.reposiciones.map(fila).join('')}</div>`
        : `<div class="cm-vacio">Todavía no hay arqueos ni reposiciones.</div>`,
      buttons: [{ action: 'cerrar', label: 'Cerrar' }],
      onMount(root, api) {
        root.addEventListener('click', async (e) => {
          const x = e.target.closest('[data-rep-excel]');
          const c = e.target.closest('[data-rep-cobrada]');
          const sp = e.target.closest('[data-rep-solicitud]');
          if (sp) { const r = fondo.reposiciones.find(y => y.id === sp.dataset.repSolicitud); if (r) imprimirSolicitud({ reposicion: r }); return; }
          if (x) { const r = fondo.reposiciones.find(y => y.id === x.dataset.repExcel); if (r) await excelInforme(r); return; }
          if (!c) return;
          const ref = await Modal.prompt({ title: 'Cheque cobrado', message: 'El efectivo ya volvió a la caja. Anota el número del cheque.', placeholder: 'N.º de cheque', confirmLabel: 'Guardar' });
          if (ref == null) return;
          try { await S().marcarCobrada(c.dataset.repCobrada, ref); api.close('cobrada'); }
          catch (err) { console.error(err); Toast.show('No se pudo guardar.', 'bad'); }
        });
      },
    });
    if (res === 'cobrada') { await cargar(); Toast.show('Anotado: el fondo vuelve a estar completo.', 'ok'); hojaHistorial(); }
  }

  function pintar() { pintarFondo(); pintarKpis(); pintarFiltros(); pintarLista(); pintarDetalle(); }

  async function cargar() {
    try {
      [todos, fondo] = await Promise.all([S().bandeja({ desde: inicioDelMes() }), S().fondo()]);
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
        <label class="cm-campo"><span>Sin factura <em>(viáticos; una por línea, escrita igual que arriba)</em></span>
          <textarea id="cfSinFac" class="form-input" rows="2" style="font-size:14px;">${esc(cfg.sin_factura.join('\n'))}</textarea></label>
        <p class="form-hint" style="margin:0;">Quién firma la solicitud de pago en papel:</p>
        ${campo('cfRevisa', 'Revisado por', cfg.firmas.revisado)}
        ${campo('cfAprueba', 'Aprobado', cfg.firmas.aprobado)}
        ${campo('cfVobo', 'Vo.Bo.', cfg.firmas.vobo)}
      </div>`,
      buttons: [{ action: 'cancelar', label: 'Cancelar' }, { action: 'ok', label: 'Guardar', primary: true }],
      async onAction(action, root) {
        if (action !== 'ok') return action;
        const n = (id) => C().num(root.querySelector('#' + id).value);
        const nuevo = { fondo: n('cfFondo'), tope_recibo: n('cfTope'), minimo_reposicion: n('cfMin'), dias_rendir: n('cfDias'),
          categorias: root.querySelector('#cfCats').value.split('\n').map(s => s.trim()).filter(Boolean),
          sin_factura: root.querySelector('#cfSinFac').value.split('\n').map(s => s.trim()).filter(Boolean),
          firmas: { revisado: root.querySelector('#cfRevisa').value, aprobado: root.querySelector('#cfAprueba').value, vobo: root.querySelector('#cfVobo').value } };
        if (![nuevo.fondo, nuevo.tope_recibo, nuevo.minimo_reposicion, nuevo.dias_rendir].every(v => v > 0)) { Toast.show('Los cuatro números tienen que ser mayores que cero.', 'warn'); return false; }
        if (!nuevo.categorias.length) { Toast.show('Deja al menos una categoría.', 'warn'); return false; }
        const ajena = nuevo.sin_factura.find(c => !nuevo.categorias.includes(c));
        if (ajena) { Toast.show(`"${ajena}" no está en las categorías: escríbela igual.`, 'warn'); return false; }
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
      if (e.target.closest('[data-cc-solicitud]')) {
        const g = todos.find(x => x.id === sel);
        if (g) imprimirSolicitud({ gasto: g });
        return;
      }
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
    $('ccFondo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cc-fondo]');
      if (!b || !cfg) return;
      if (b.dataset.ccFondo === 'arqueo') hojaArqueo(); else hojaHistorial();
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
