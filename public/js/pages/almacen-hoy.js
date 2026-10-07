/* =============================================================
   Almacén · Hoy — la bandeja unificada de trabajo de bodega.
   (Propuesta Almacén/Finanzas 2026-08, etapa E1.)

   Junta en una sola lista lo que antes vivía en dos páginas y
   seis señales del home:
     · De contratos (ColaInventarioService): seriales por asignar,
       cambios de serial, transiciones (si la cola está encendida).
     · Del pool: devueltos por inspeccionar, por clasificar,
       conflictos de ficha, sin verificar (deuda de migración).
     · De conteos: modelos con diferencia pool ≠ conteo (StockAgg).

   La bandeja RUTEA: cada ítem lleva a la pestaña de este mismo
   espacio donde ya se resuelve (Asignar, Existencias, Avanzado).
   La bandeja vacía es el estado de éxito.
   ============================================================= */

window.AlmacenPage = {
  TABS: ['hoy', 'asignar', 'existencias', 'serial'],

  // `extra`: lo que la pestaña necesita al abrirse. Asignar: {contrato, g,
  // corregir}. Avanzado ('serial'): {estado, verificar, modelo, serial} —
  // los mismos deep-links que recibía inventario/equipos.html.
  setTab(tab, extra = {}) {
    this.TABS.forEach(t => {
      const el = document.getElementById('tab-' + t);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
    if (window.WorkspaceTabs) WorkspaceTabs.setActive(tab);
    // Existencias, Asignar y Avanzado cargan bajo demanda la primera vez.
    if (tab === 'existencias' && window.AlmacenExistencias) AlmacenExistencias.activar();
    if (tab === 'asignar' && window.AlmacenAsignar) AlmacenAsignar.activar(extra);
    if (tab === 'serial' && window.EquiposPool) EquiposPool.activar(extra);
    try {
      const url = new URL(location.href);
      if (tab === 'hoy') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
      if (tab !== 'asignar') { url.searchParams.delete('contrato'); url.searchParams.delete('g'); url.searchParams.delete('corregir'); }
      if (tab !== 'serial') { ['estado', 'verificar', 'modelo'].forEach(k => url.searchParams.delete(k)); }
      if (tab !== 'serial' && tab !== 'existencias') url.searchParams.delete('serial');
      history.replaceState(null, '', url);
    } catch { /* la pestaña cambió igual */ }
  },

  // Deep-link a la lista avanzada desde otra pestaña de ESTA página (sin
  // recargar). Es lo que antes era un href a inventario/equipos.html?tab=…
  abrirAvanzado({ estado = '', verificar = false, modelo = '', serial = '' } = {}) {
    AlmacenPage.setTab('serial', { estado, verificar, modelo, serial });
  },

  // El mismo destino como URL real (para Ctrl+clic / abrir en otra pestaña).
  urlAvanzado({ estado = '', verificar = false, modelo = '', serial = '' } = {}) {
    const q = ['tab=serial'];
    if (estado) q.push('estado=' + encodeURIComponent(estado));
    if (verificar) q.push('verificar=1');
    if (modelo) q.push('modelo=' + encodeURIComponent(modelo));
    if (serial) q.push('serial=' + encodeURIComponent(serial));
    return `index.html?${q.join('&')}`;
  },

  // Desde Hoy (y desde cualquier <a data-asignar>): abrir la pestaña Asignar
  // con un contrato o una gestión, sin recargar la página.
  abrirAsignar({ contrato = null, g = null } = {}) {
    AlmacenPage.setTab('asignar', { contrato, g });
  },

  // "Recargar" del menú: refresca la pestaña que se está viendo.
  recargar() {
    const visible = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    if (visible('tab-existencias') && window.AlmacenExistencias) return AlmacenExistencias.recargar();
    if (visible('tab-asignar') && window.AlmacenAsignar) return AlmacenAsignar.recargar();
    if (visible('tab-serial') && window.EquiposPool) return EquiposPool.cargar();
    return AlmacenHoy.recargar();
  },

  recargarTodo() {
    AlmacenHoy.recargar();
    if (window.AlmacenExistencias) AlmacenExistencias.refrescarSiCargado();
    if (window.EquiposPool && EquiposPool._activo) EquiposPool.cargar();
  },

  // Quién OPERA bodega (recibir, contar, importar, vender): administración e
  // inventario. Recepción y ventas entran al espacio por su cola de seriales
  // (gestiones, contratos) pero no mueven inventario (decisión de Alberto
  // 2026-10-01, auditoría de módulos R1/D5). Las rules de equipos_pool
  // cierran lo mismo del lado del servidor; esto evita que lleguen al toast
  // de permiso. `window.userRole` lo fija init().
  puedeOperar() {
    const rol = window.userRole;
    return rol === ROLES.ADMIN || rol === ROLES.INVENTARIO;
  },
  _sinPermiso(accion) {
    if (!window.Toast) return;
    // Los botones se pintan en el parse: un clic antes de que init() resuelva
    // el rol no es "sin permiso", es "todavía no sé quién eres".
    if (!window.userRole) { Toast.show('Un momento: todavía se está cargando tu sesión. Vuelve a intentar.', 'warn'); return; }
    Toast.show(`${accion} es de bodega y administración. Tu usuario no puede hacerlo.`, 'warn');
  },
  // Quita de la topbar las acciones que este rol no puede ejecutar (se
  // pintan en el parse, antes de saber el rol).
  _topbarPorRol() {
    if (this.puedeOperar()) return;
    document.querySelectorAll('.topbar-actions .almacen-op').forEach(b => b.remove());
    document.getElementById('menuEquiposCliente')?.remove();
  },

  // Asistentes (Fase B): componentes propios del espacio. Mientras alguno no
  // esté cargado (transición), cae al deep-link de la página de Equipos.
  abrirConteo() {
    if (!this.puedeOperar()) return this._sinPermiso('El conteo físico');
    if (!window.AsistenteConteo) { location.href = '../inventario/cargar-inventario.html?volver=almacen'; return; }
    AsistenteConteo.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  abrirRecibir() {
    if (!this.puedeOperar()) return this._sinPermiso('Recibir equipos');
    if (!window.AsistenteRecibir) { if (window.Toast) Toast.show('El asistente de recepción no cargó. Recarga la página.', 'bad'); return; }
    AsistenteRecibir.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  // Importar la hoja de bodega tal cual llega. Es la vía principal de un conteo:
  // "Recibir equipos" queda para el alta suelta de dos o tres seriales.
  abrirImportar() {
    if (!this.puedeOperar()) return this._sinPermiso('Importar la hoja de bodega');
    if (!window.AsistenteImportar) { AlmacenPage.abrirRecibir(); return; }
    AsistenteImportar.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  // Radios que trae un cliente para su contrato (2026-10-07). En el menú
  // "Más" y no en la barra: es un caso ocasional.
  abrirEquiposCliente() {
    if (!this.puedeOperar()) return this._sinPermiso('Registrar equipos del cliente');
    if (!window.AsistenteEquiposCliente) { if (window.Toast) Toast.show('El asistente no cargó. Recarga la página.', 'bad'); return; }
    AsistenteEquiposCliente.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  abrirVenta() {
    if (!this.puedeOperar()) return this._sinPermiso('Registrar una venta');
    if (!window.AsistenteVenta) { if (window.Toast) Toast.show('El asistente de venta no cargó. Recarga la página.', 'bad'); return; }
    AsistenteVenta.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
};

window.AlmacenHoy = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const MAX_FILAS = 8;   // por grupo; el resto queda tras "ver todos"

  // Links a la lista avanzada (antes inventario/equipos.html): misma página,
  // pestaña Avanzado. El href es real (Ctrl+clic abre otra pestaña con el
  // deep-link); el clic normal lo captura el listener de abajo y cambia de
  // sección sin recargar.
  const avz = (p) => window.AlmacenPage.urlAvanzado(p);

  // Todo link que sale de la bandeja lleva ?volver=almacen: el topbar de la
  // página destino (layout.js) lo convierte en un "Volver" que regresa AQUÍ
  // y no al módulo histórico de esa página.
  const vol = (url) => url + (url.includes('?') ? '&' : '?') + 'volver=almacen';

  const ctx = { rol: '', datos: null };

  const $ = (id) => document.getElementById(id);

  // ── Presentación ──────────────────────────────────────────────────────
  // La fila, el grupo, la antigüedad y el "ver todos" son del kit de bandeja
  // (js/ui/bandeja.js, 2026-09-07). Aquí solo se traduce el vocabulario de
  // esta bandeja (chips por tipo de cola) al del kit (chips por tono).
  const TONO = {
    seriales: 'aviso', cambio: 'info', transicion: 'aviso', inspeccion: 'aviso',
    clasificar: 'neutro', conflicto: 'alerta', diferencia: 'alerta', ok: 'listo',
  };

  function cta(href, icono, label) {
    return Bandeja.cta({ href, icono, label });
  }

  // CTA que abre la pestaña Asignar de ESTA página (sin recargar). El href
  // sigue siendo un deep-link real para "abrir en otra pestaña".
  function ctaAsignar({ contrato = null, g = null }, icono, label) {
    const q = contrato ? `contrato=${encodeURIComponent(contrato)}` : `g=${encodeURIComponent(g)}`;
    return Bandeja.cta({ href: `index.html?tab=asignar&${q}`, icono, label,
      data: { asignar: '1', contrato: contrato || '', g: g || '' } });
  }

  function fila({ chip, chipCls, txt, at, ctaHtml }) {
    return Bandeja.fila({ chip, tono: TONO[chipCls] || 'neutro', txt, at, clase: 'cola', ctaHtml });
  }

  function grupo(titulo, n, filasHtml, extraHtml = '') {
    return Bandeja.grupo({ titulo, n, filasHtml, notaHtml: extraHtml });
  }

  function conMas(filas, renderFila, hrefTodos, labelTodos) {
    return Bandeja.conMas(filas, renderFila, { max: MAX_FILAS, hrefTodos, label: labelTodos });
  }

  const nota = (html) => Bandeja.nota(html);

  // ── Cargas ────────────────────────────────────────────────────────────
  async function contarSinVerificar() {
    // Firebase 12 (npm, 2026-09-25) no traía Query.count() en compat;
    // firebase-init lo restauró (b5b3726), así que va primero por compat y
    // FbAgg queda de respaldo (mismo criterio que inventario-equipos).
    const q = firebase.firestore().collection('equipos_pool').where('verificado', '==', false);
    if (typeof q.count === 'function') return (await q.count().get()).data().count;
    if (!window.FbAgg || typeof FbAgg.count !== 'function') return null;
    return FbAgg.count('equipos_pool', [['verificado', '==', false]]);
  }

  // La cola de Conflictos es UNA (ConflictosPoolService, compartida con
  // Equipos por serial): mismo predicado, misma fusión, misma marca.
  function cargarConflictos() {
    return ConflictosPoolService.listarPendientes();
  }

  // Gestiones esperando a BODEGA (brecha Ola 6, caso GA20260828-01 de
  // C COMUNICA 2026-08-28: el aumento firmado quedó en pendiente_bodega y la
  // bandeja no lo mostraba — bodega solo se enteraba por el correo):
  //   · aumento en 'pendiente_firma' sin seriales completos (2026-09-03: la
  //     firma corre en paralelo — bodega puede pre-asignar desde la aprobación)
  //   · aumento en 'pendiente_bodega' (anexo firmado; faltan los seriales)
  //   · reemplazo/demo en 'en_proceso' sin cierre.asignacion
  // La asignación se resuelve en la pestaña Asignar (2026-09-03); antes era el
  // expediente del Centro. La comparte AlmacenAsignar para armar su cola.
  async function cargarGestionesBodega() {
    const db = firebase.firestore();
    const snap = await db.collection('gestiones')
      .where('estado', 'in', ['pendiente_firma', 'pendiente_bodega', 'en_proceso']).limit(200).get();
    const out = [];
    const serialesCompletos = (g) => {
      const total = (g.aumento?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = (g.aumento?.seriales_asignados || []).filter(s => String(s.serial || '').trim()).length;
      return total > 0 && asignados >= total;
    };
    snap.docs.forEach(d => {
      const g = { id: d.id, ...d.data() };
      if (g.deleted) return;
      const espera = g.estado === 'pendiente_bodega'
        || (g.estado === 'en_proceso' && ['reemplazo', 'demo'].includes(g.tipo) && !g.cierre?.asignacion)
        || (g.estado === 'pendiente_firma' && g.tipo === 'aumento'
            && g.aumento?.es_ajuste !== true && g.aumento?.es_regularizacion !== true
            && g.dormido !== true   // anexo dormido a los 45 días (2-oct-2026): no es cola
            && !serialesCompletos(g));
      if (espera) out.push(g);
    });
    const ms = (g) => g.actualizado_at?.toMillis?.() || g.updated_at?.toMillis?.()
      || g.creado_at?.toMillis?.() || g.created_at?.toMillis?.() || g.fecha_creacion?.toMillis?.() || 0;
    return out.map(g => ({ ...g, _at: ms(g) })).sort((a, b) => a._at - b._at);
  }

  // Anexos DORMIDOS que apartan equipos (Alberto, 5-oct-2026; AnexoDormido):
  // bodega ve cuándo vuelven sus radios y decide los que vencieron con la
  // orden de programación ya trabajada en el taller (dormido_bodega).
  async function cargarAnexosDormidos() {
    const snap = await firebase.firestore().collection('gestiones').where('dormido', '==', true).limit(200).get();
    const AD = window.AnexoDormido;
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(g => AD && AD.es(g) && (AD.equiposApartados(g) > 0
        || !!(g.ordenes?.programacion_id || (g.ordenes?.programacion_ids || []).length)))
      .map(g => ({ ...g, _bodega: AD.esperaBodega(g), _plazo: AD.plazo(g)?.getTime() ?? null }))
      .sort((a, b) => (b._bodega - a._bodega) || ((a._plazo ?? 9e15) - (b._plazo ?? 9e15)));
  }

  async function cargarDiferencias() {
    const [modelos, conteos, poolMap] = await Promise.all([
      ModelosService.getModelos(),
      InventarioService.getInventarioActual(),
      EquiposPoolService.contarBodegaPorModelo(),
    ]);
    return StockAgg.diferencias(StockAgg.build({ modelos, conteos, poolMap }));
  }

  async function cargar() {
    // El spinner solo si Hoy es la pestaña visible: cuando la carga corre en
    // segundo plano (la página abrió en otra pestaña) no hay nada que tapar.
    const hoyVisible = ($('tab-hoy') || {}).style?.display !== 'none';
    const loader = hoyVisible ? $('loader') : null;
    if (loader) loader.style.display = '';
    try {
      // Cada carga cae por su lado: un permiso o índice roto no tumba la bandeja
      // — se muestra lo que sí se pudo leer y se avisa del hueco (null = falló).
      const [colas, gestiones, devueltos, clasificar, conflictos, sinVerificarN, difs, dormidos, ventas] = await Promise.all([
        ColaInventarioService.todo(),
        cargarGestionesBodega().catch(e => { console.warn('[Hoy] gestiones:', e?.code || e); return null; }),
        EquiposPoolService.listar({ estado: 'devuelto_revision' }).catch(e => { console.warn('[Hoy] devueltos:', e?.code || e); return null; }),
        // Solo dos números para una nota (ver notaClasificar): del resumen, no
        // de las ~1,240 fichas. Envuelto en Promise.resolve().then a propósito:
        // contarPorClasificar es nuevo (2026-09-25), y con un equiposPoolService
        // viejo en caché llamarlo lanza un TypeError EN EL ACTO — antes de que
        // .catch se enganche — y tumbaría el Promise.all y la bandeja ENTERA.
        // Así cae solo la nota, que es la regla de este cargar().
        Promise.resolve().then(() => EquiposPoolService.contarPorClasificar()).catch(e => { console.warn('[Hoy] clasificar:', e?.code || e); return null; }),
        cargarConflictos().catch(e => { console.warn('[Hoy] conflictos:', e?.code || e); return null; }),
        contarSinVerificar().catch(e => { console.warn('[Hoy] sin verificar:', e?.code || e); return null; }),
        cargarDiferencias().catch(e => { console.warn('[Hoy] diferencias:', e?.code || e); return null; }),
        cargarAnexosDormidos().catch(e => { console.warn('[Hoy] anexos dormidos:', e?.code || e); return null; }),
        // Ventas facturadas por recepción esperando seriales (2026-10-07).
        Promise.resolve().then(() => PedidosVentaService.listarPendientes()).catch(e => { console.warn('[Hoy] ventas facturadas:', e?.code || e); return null; }),
      ]);
      ctx.datos = { colas, gestiones, devueltos, clasificar, conflictos, sinVerificarN, difs, dormidos, ventas };
      render();
    } catch (e) {
      console.error('[Hoy] no se pudo cargar:', e);
      if (typeof Toast !== 'undefined') Toast.show('No se pudo cargar la bandeja.', 'bad');
    } finally {
      if (loader) loader.style.display = 'none';
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  function filaContrato(r) {
    // Seriales y cambios se trabajan en la pestaña Asignar de este mismo
    // espacio; la transición sigue en su página (cola apagada).
    const cfgs = {
      seriales: { chip: 'Seriales', cls: 'seriales', icono: 'scan-barcode', cta: 'Asignar seriales', ctaHtml: ctaAsignar({ contrato: r.doc_id }, 'scan-barcode', 'Asignar seriales') },
      cambio: { chip: 'Cambio', cls: 'cambio', icono: 'replace', cta: 'Reemplazar', ctaHtml: ctaAsignar({ contrato: r.doc_id }, 'replace', 'Reemplazar') },
      transicion: { chip: 'Transición', cls: 'transicion', icono: 'arrow-left-right', cta: 'Registrar', href: vol(`../contratos/transicion.html?id=${encodeURIComponent(r.doc_id)}`) },
    };
    const c = cfgs[r.tipo];
    let detalle = '';
    if (r.tipo === 'cambio') {
      const items = (r.cambio?.items || []).map(i => `<span class="bj-eq"><b>${esc(i.serial || '—')}</b>${i.modelo ? ` · ${esc(i.modelo)}` : ''}</span>`).join('');
      const motivo = r.cambio?.motivo_tipo || r.cambio?.motivo || '';
      detalle = ` — ${items}${motivo ? ` <span style="color:var(--fg-3);">${esc(motivo)}</span>` : ''}`;
    } else {
      detalle = ` — ${r.resueltos}/${r.unidades} unidades`;
    }
    return fila({
      chip: c.chip, chipCls: c.cls,
      txt: `<b>${esc(r.contrato_id)}</b> · ${esc(r.cliente_nombre)}${detalle}`,
      at: r.at,
      ctaHtml: c.ctaHtml || cta(c.href, c.icono, c.cta),
    });
  }

  function render() {
    const d = ctx.datos;
    if (!d) return;
    const partes = [];
    const fallidas = [...(d.colas?.fallidas || [])];
    let total = 0;

    // ── De contratos ──
    const colas = d.colas || { seriales: [], cambios: [], transiciones: [] };
    const deContratos = [...colas.seriales, ...colas.cambios, ...colas.transiciones]
      .sort((a, b) => a.at - b.at);
    total += deContratos.length;
    let notaTransicion = '';
    if (!ColaInventarioService.COLA_TRANSICIONES_ACTIVA && ctx.rol === ROLES.ADMIN) {
      notaTransicion = `<p class="bj-nota">Cola de transiciones apagada (atraso histórico sin triar) —
        se enciende en <code>colaInventarioService.js</code>; la mayoría de casos nuevos se
        auto-registra al confirmar la entrega.</p>`;
    }
    // Sin tope: esta bandeja ES la superficie primaria de estas colas.
    partes.push(grupo('De contratos', deContratos.length,
      deContratos.map(filaContrato).join(''),
      notaTransicion));

    // ── De gestiones (bodega asigna) ──
    if (d.gestiones === null) fallidas.push('gestiones');
    const gestiones = d.gestiones || [];
    total += gestiones.length;
    const CHIP_G = { aumento: ['Aumento', 'seriales'], reemplazo: ['Reemplazo', 'cambio'], demo: ['Demo', 'transicion'] };
    partes.push(grupo('De gestiones (bodega asigna)', gestiones.length,
      conMas(gestiones, (g) => {
        const [chip, cls] = CHIP_G[g.tipo] || [g.tipo, 'seriales'];
        let detalle = '';
        if (g.tipo === 'aumento') {
          const a = g.aumento || {};
          detalle = ` — anexo ${g.estado === 'pendiente_firma'
              ? 'aprobado (<b>firma en paralelo</b>)' : 'firmado'} al <b>${esc(a.contrato_id || '—')}</b>: `
            + (a.lineas || []).map(l => `${Number(l.cantidad || 0)} × ${esc(l.modelo || '?')}`).join(', ');
        } else {
          const n = (g.items || []).length;
          detalle = g.tipo === 'demo'
            ? ` — ${n} equipo(s) de demo por asignar`
            : ` — ${n} reemplazo(s): elegir la unidad que sustituye`;
        }
        return fila({
          chip, chipCls: cls,
          txt: `<b>${esc(g.id)}</b> · ${esc(g.cliente_nombre || '—')}${detalle}`,
          at: g._at || null,
          ctaHtml: ctaAsignar({ g: g.id }, 'scan-barcode', 'Asignar seriales'),
        });
      }, 'index.html?tab=asignar', 'gestiones'),
    ));
    // Badge de la pestaña Asignar = lo que bodega tiene que poner.
    if (window.WorkspaceTabs) WorkspaceTabs.setBadge('asignar', colas.seriales.length + colas.cambios.length + gestiones.length);

    // ── Ventas facturadas (recepción pide, bodega asigna) ──
    // Se asignan con el asistente de venta, no en la pestaña Asignar: la
    // unidad sale de bodega como `vendido`, no a un contrato.
    if (d.ventas === null) fallidas.push('ventas facturadas');
    const ventas = d.ventas || [];
    total += ventas.length;
    partes.push(grupo('Ventas facturadas (bodega asigna)', ventas.length,
      ventas.map(p => fila({
        chip: 'Venta', chipCls: 'seriales',
        txt: `<b>${esc(p.cliente_nombre || '—')}</b> · factura ${esc(p.factura || '—')} — `
          + (p.lineas || []).map(l => `${Number(l.cantidad || 0)} × ${esc(l.modelo || '?')}`).join(', ')
          + (p.notas ? ` <span style="color:var(--fg-3);">${esc(p.notas)}</span>` : ''),
        at: p.creado_at?.toMillis?.() || null,
        ctaHtml: AlmacenPage.puedeOperar()
          ? `<button type="button" class="btn btn-sm btn-accent bj-cta" data-venta="${esc(p.id)}">
              <i data-lucide="scan-barcode" style="width:14px;height:14px;"></i> Asignar seriales</button>`
          : '',
      })).join(''),
    ));

    // ── De anexos dormidos ──
    // Solo los que bodega tiene que DECIDIR suman al día; los demás son la
    // fecha en que sus radios vuelven, para no contar con ellos antes.
    if (d.dormidos === null) fallidas.push('anexos dormidos');
    const dormidos = d.dormidos || [];
    const aDecidir = dormidos.filter(g => g._bodega).length;
    total += aDecidir;
    if (dormidos.length) {
      const AD = window.AnexoDormido;
      partes.push(grupo('Equipos apartados por anexos dormidos', aDecidir,
        dormidos.map(g => {
          const n = AD.equiposApartados(g);
          const os = (g.dormido_bodega?.ordenes || g.ordenes?.programacion_ids || []).join(', ');
          return fila({
            chip: g._bodega ? 'Decide' : 'Apartado', chipCls: g._bodega ? 'conflicto' : 'clasificar',
            txt: `<b>${esc(g.id)}</b> · ${esc(g.cliente_nombre || '—')} — ${n ? `${n} equipo(s)` : 'sin seriales'}${os ? ` · orden ${esc(os)}` : ''}: `
              + (g._bodega
                ? '<b>venció sin firma ni retención con la orden ya trabajada</b> — suéltalos o espera a que el vendedor lo reactive'
                : esc(AD.resumen(g))),
            at: g.dormido_at?.toMillis?.() || null,
            ctaHtml: g._bodega && AD.puedeSoltar(g, ctx.rol, firebase.auth().currentUser?.uid).ok
              ? `<button type="button" class="btn btn-sm btn-accent bj-cta" data-soltar-anexo="${esc(g.id)}">
                  <i data-lucide="package-x" style="width:14px;height:14px;"></i> Soltar los equipos</button>`
              : '',
          });
        }).join(''),
        nota('Un anexo de aumento sin firma a los 45 días se duerme; a los 15 días (o al final de una retención del vendedor) sus equipos se sueltan solos. Si el taller ya trabajó la orden, lo decides tú.'),
      ));
    }

    // ── Del pool ──
    let poolHtml = '';
    let poolN = 0;

    // La inspección FORMAL de un devuelto es del TALLER, vía su orden de
    // ENTRADA: al cerrarla, el trigger regresa la unidad a bodega verificada.
    // A bodega solo le toca lo que quedó SIN tiquete de taller — la fuga
    // (migración, o una ENTRADA que nunca se creó). Diagnóstico 2026-08-10:
    // 63 de 66 en cuarentena tenían ENTRADA abierta — mostrarlos aquí era
    // duplicarle al taller su propia cola.
    let notaTaller = '';
    if (d.devueltos === null) fallidas.push('devueltos');
    else if (d.devueltos.length) {
      const sinTaller = d.devueltos.filter(eq => !eq.orden_actual_id);
      const enTaller = d.devueltos.length - sinTaller.length;
      if (sinTaller.length) {
        poolN += sinTaller.length;
        const filas = [...sinTaller].sort((a, b) => (a.updated_at?.toMillis?.() || 0) - (b.updated_at?.toMillis?.() || 0));
        poolHtml += conMas(filas, (eq) => fila({
          chip: 'Inspección', chipCls: 'inspeccion',
          txt: `<b>${esc(eq.serial || eq.serial_norm)}</b> · ${esc(eq.modelo_label || 'sin modelo')}`
            + (eq.asignacion?.cliente_nombre ? ` — de ${esc(eq.asignacion.cliente_nombre)}` : '')
            + ' <span style="color:var(--fg-3);">(sin tiquete de taller)</span>',
          at: eq.updated_at?.toMillis?.() || null,
          // "Revisar" abre la ficha AQUÍ (auditoría UX 2026-09-28): Inspección
          // OK y Dar de baja viven en la ficha; el href a Equipos por serial
          // queda para Ctrl+clic / abrir en otra pestaña.
          ctaHtml: Bandeja.cta({ href: avz({ serial: eq.serial || eq.serial_norm }),
            icono: 'search-check', label: 'Revisar', data: { ficha: eq.serial || eq.serial_norm } }),
        }), avz({ estado: 'devuelto_revision' }), 'devueltos');
      }
      if (enTaller) {
        notaTaller = `<p class="bj-nota">${enTaller} devueltos están en inspección de TALLER
          (orden de ENTRADA abierta) — regresan a bodega solos al cerrarse la ENTRADA;
          no son trabajo de bodega.</p>`;
      }
    }

    // Por clasificar NO se cuenta como trabajo del día: es deuda de migración
    // (diagnóstico 2026-08-10: 1,541 unidades, 1,280 sin modelo — nada lo
    // produce en runtime, solo scripts/backfills). Mismo criterio que la cola
    // de transiciones apagada: mostrarlo entero convierte la bandeja en una
    // lista de reproches. Va como nota, con su tamaño real y su CTA.
    let notaClasificar = '';
    if (d.clasificar === null) fallidas.push('por clasificar');
    else if (d.clasificar.n) {
      const { n, sinModelo } = d.clasificar;
      notaClasificar = `<p class="bj-nota">${n.toLocaleString()} unidades en
        "por clasificar" (deuda de migración — ubicación sin respaldo${sinModelo ? `, ${sinModelo.toLocaleString()} sin modelo` : ''})
        — <a href="${avz({ estado: 'por_clasificar' })}">revisar por lotes →</a></p>`;
    }

    if (d.conflictos === null) fallidas.push('conflictos');
    else if (d.conflictos.length) {
      poolN += d.conflictos.length;
      // Esta es LA cola de Conflictos (la de Equipos por serial se retiró):
      // se pintan todos, no hay "ver todos" a otra pantalla.
      poolHtml += d.conflictos.map((g) => fila({
        chip: 'Conflicto', chipCls: 'conflicto',
        txt: `<b>${esc(g.norm)}</b> — ${g.docs.length} fichas: ${esc(g.docs.map(x => x.modelo_label || '¿?').join(' ↔ '))}`,
        ctaHtml: `<button type="button" class="btn btn-sm btn-accent bj-cta" data-conflicto="${esc(g.norm)}">
          <i data-lucide="git-merge" style="width:14px;height:14px;"></i> Resolver</button>`,
      })).join('');
    }

    total += poolN;
    let notaVerificar = '';
    if (d.sinVerificarN) {
      // Deuda de migración, no trabajo del día: se muestra pero NO suma al badge.
      notaVerificar = `<p class="bj-nota">${d.sinVerificarN.toLocaleString()} fichas de migración sin verificar
        (deuda, no trabajo del día) — <a href="${avz({ estado: 'todos', verificar: true })}">revisar por lotes →</a></p>`;
    }
    partes.push(grupo('Del inventario de equipos', poolN, poolHtml, notaTaller + notaClasificar + notaVerificar));

    // ── De conteos ──
    // Solo diferencias contra un conteo RECIENTE: la conciliación significa
    // algo cuando el conteo es fresco. Contra un conteo de hace meses (33 de
    // 51 tenían >90 días en el diagnóstico 2026-08-10, algunos >400) la
    // diferencia solo dice "este modelo no se ha vuelto a contar" — eso vive
    // en el tablero, no en la bandeja del día.
    const UMBRAL_CONTEO_DIAS = 30;
    if (d.difs === null) fallidas.push('diferencias de conteo');
    const difsTodas = d.difs || [];
    const difs = difsTodas.filter(f => {
      const ms = f.data?.ultima_actualizacion?.toMillis?.();
      return ms && (Date.now() - ms) <= UMBRAL_CONTEO_DIAS * 86400000;
    });
    const difsViejas = difsTodas.length - difs.length;
    const notaConteosViejos = difsViejas > 0
      ? `<p class="bj-nota">${difsViejas} modelos más tienen diferencia contra conteos de hace
         más de ${UMBRAL_CONTEO_DIAS} días — se cuadran recontando (Conteo físico), no son trabajo de hoy.
         <a href="#" onclick="event.preventDefault(); AlmacenPage.setTab('existencias')">Ver Existencias →</a></p>` : '';
    total += difs.length;
    partes.push(grupo('De conteos', difs.length,
      conMas(difs, (f) => fila({
        chip: 'Diferencia', chipCls: 'diferencia',
        txt: `<b>${esc(f.modelo?.modelo || f.label)}</b> — registrado ${f.seriales} vs conteo ${f.conteo} (${f.dif > 0 ? '+' : ''}${f.dif})`,
        at: f.data?.ultima_actualizacion?.toMillis?.() || null,
        // "Revisar" despliega el modelo en Existencias (sus seriales → ficha)
        // sin salir del espacio (auditoría UX 2026-09-28); el href sigue siendo
        // Equipos por serial para abrir en otra pestaña.
        ctaHtml: Bandeja.cta({ href: avz({ estado: 'en_bodega', modelo: f.modelo_id || '' }),
          icono: 'diff', label: 'Revisar', data: { modelo: f.modelo_id || '', 'modelo-label': f.modelo?.modelo || f.label || '' } }),
      }), './index.html?tab=existencias', 'Existencias'),
      notaConteosViejos,
    ));

    // ── Pintado ──
    const cont = $('hoyGrupos');
    const vacio = $('hoyVacio');
    const html = partes.filter(Boolean).join('');
    if (total === 0) {
      cont.innerHTML = '';
      vacio.style.display = '';
    } else {
      vacio.style.display = 'none';
      cont.innerHTML = html;
    }

    const aviso = $('avisoFallidas');
    if (aviso) {
      if (fallidas.length) {
        aviso.style.display = '';
        aviso.innerHTML = `<i data-lucide="alert-triangle"></i> No se pudo leer: <b>${esc(fallidas.join(', '))}</b>. Lo que ves está incompleto.`;
      } else {
        aviso.style.display = 'none';
      }
    }

    if (window.WorkspaceTabs) WorkspaceTabs.setBadge('hoy', total);
    // El badge del rail conserva su semántica (solo colas de contratos, igual
    // que contarParaBadge): se sincroniza con lo que se acaba de leer.
    ColaInventarioService.refrescarBadge(colas.seriales.length + colas.cambios.length);

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function recargar() { return cargar(); }

  // Bodega SUELTA los equipos de un anexo dormido vencido con la orden ya
  // trabajada (5-oct-2026): anular el anexo con motivo — la anulación de
  // siempre (onGestionWrite → limpiarAnulacion) devuelve a bodega los radios
  // apartados y elimina la orden si sigue abierta (POR ASIGNAR / RECIBIDO /
  // ASIGNADO); la que el taller ya completó queda anotada para Órdenes.
  async function soltarAnexo(gid, btn) {
    const g = (ctx.datos?.dormidos || []).find(x => x.id === gid);
    const p = g ? AnexoDormido.puedeSoltar(g, ctx.rol, firebase.auth().currentUser?.uid) : { ok: false, motivo: 'No encontrado.' };
    if (!p.ok) { if (window.Toast) Toast.show(p.motivo, 'warn'); return; }
    const os = (g.dormido_bodega?.ordenes || []).join(', ');
    const motivo = await Modal.prompt({ title: 'Soltar los equipos', confirmLabel: 'Soltar y anular el anexo', multiline: true,
      message: `El anexo ${g.id} (${g.cliente_nombre || '—'}) se anula y sus ${AnexoDormido.equiposApartados(g)} equipo(s) apartados vuelven a bodega. Si la orden ${os} sigue abierta (por asignar o asignada) se elimina con la anulación; si el taller ya la completó, queda anotada en el expediente para cerrarla desde Órdenes. Motivo (obligatorio):` });
    if (motivo === null || motivo === undefined) return;
    if (String(motivo).trim().length < 5) { if (window.Toast) Toast.show('Escribe el motivo (5 letras o más).', 'warn'); return; }
    if (btn) btn.disabled = true;
    try {
      await GestionesService.soltarDormido(g, motivo);
      if (window.Toast) Toast.show('Anexo anulado — los equipos vuelven a bodega en unos segundos', 'ok');
      setTimeout(() => cargar(), 1800);
    } catch (e) {
      console.error(e);
      if (btn) btn.disabled = false;
      if (window.Toast) Toast.show('No se pudo soltar: ' + (e.message || e), 'bad');
    }
  }

  // ── Conflictos: resolver desde la bandeja (Fase C) ─────────────────────
  // Mismo circuito que la cola de Equipos: elegir la ficha real → callable
  // fusionarPoolFicha (conserva kardex, absorbe duplicados), o marcar que son
  // radios físicos distintos (colisión real tipo Kenwood).
  function abrirConflicto(norm) {
    const g = (ctx.datos?.conflictos || []).find(x => x.norm === norm);
    if (!g) return;
    if (!(ctx.rol === ROLES.ADMIN || ctx.rol === ROLES.INVENTARIO)) {
      if (window.Toast) Toast.show('Solo administración o inventario resuelven conflictos.', 'warn');
      return;
    }
    const cards = ConflictosPoolService.tarjetasHtml(g, { elegible: true, esc });
    // Hoja del kit (Modal.sheet): los botones no cierran solos — onAction
    // devuelve false mientras la operación no termine.
    Modal.sheet({
      title: 'Fichas en conflicto', icon: 'git-merge', size: 'md',
      html: `
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 10px;">
          El serial <b style="font-family:var(--mono, monospace);">${esc(norm)}</b> tiene ${g.docs.length} fichas
          (modelos distintos registrados por fuentes distintas). Elige el radio REAL para fusionar
          las demás en él (su kardex se conserva) — o confirma que son radios físicos distintos.
        </p>
        <div style="display:flex; flex-direction:column; gap:8px;">${cards}</div>`,
      buttons: [
        { action: 'distintos', label: 'Son radios distintos' },
        { action: 'cancelar', label: 'Cancelar' },
        { action: 'fusionar', label: 'Fusionar en la seleccionada', primary: true },
      ],
      onAction: async (action, root) => {
        if (action === 'cancelar') return null;
        if (action === 'distintos') return (await _conflictoDistintos(norm)) ? 'distintos' : false;
        if (action === 'fusionar') return (await _conflictoFusionar(norm, root)) ? 'fusionar' : false;
        return false;
      },
    });
  }

  // Devuelven true si la operación se hizo (la hoja se cierra) y false si no.
  async function _conflictoFusionar(norm, root) {
    const g = (ctx.datos?.conflictos || []).find(x => x.norm === norm);
    const sel = root.querySelector('input[name="hyConfl"]:checked');
    if (!g || !sel) { if (window.Toast) Toast.show('Selecciona primero la ficha que se conserva.', 'warn'); return false; }
    const keeperId = sel.value;
    const absorbidosIds = g.docs.map(d => d.id).filter(id => id !== keeperId);
    const ok = await Modal.confirm({ title: 'Fusionar fichas', confirmLabel: 'Fusionar',
      message: `Fusionar ${absorbidosIds.length} ficha(s) en la seleccionada. Sus kardex se conservan.` });
    if (!ok) return false;
    const btn = root.querySelector('[data-sheet-action="fusionar"]'); if (btn) btn.disabled = true;
    try {
      const res = await ConflictosPoolService.fusionar({ keeperId, absorbidosIds });
      // Si la absorbida traía el flujo en curso (orden, cliente), la conservada
      // lo tomó: se dice, para que nadie crea que el radio sigue en bodega.
      const heredo = res.heredoEstado
        ? ` Tomó el estado de la absorbida: ${window.EquiposPoolService?.ESTADO_LABELS?.[res.heredoEstado] || res.heredoEstado}.` : '';
      if (window.Toast) Toast.show(`Fusión lista: ${res.fusionados} ficha(s) absorbida(s).${heredo}`, 'ok');
      cargar();
      return true;
    } catch (e) {
      if (btn) btn.disabled = false;
      if (window.Toast) Toast.show('No se pudo fusionar: ' + (e.message || e), 'bad');
      return false;
    }
  }

  async function _conflictoDistintos(norm) {
    const g = (ctx.datos?.conflictos || []).find(x => x.norm === norm);
    if (!g) return false;
    const ok = await Modal.confirm({ title: 'Radios distintos', confirmLabel: 'Marcar como distintos',
      message: `Las ${g.docs.length} fichas del serial ${norm} quedarán marcadas como radios FÍSICOS distintos (salen de la cola, conservan el aviso "2+ modelos").` });
    if (!ok) return false;
    try {
      // Marca + kardex (ConflictosPoolService): la decisión queda rastreable
      // en la ficha — meses después la pregunta es "¿quién dijo que son
      // distintos y cuándo?", y el chip "2+ modelos" solo no la contesta.
      await ConflictosPoolService.marcarRevisado(g, true, 'Serial compartido entre modelos: son radios distintos.');
      if (window.Toast) Toast.show('Grupo marcado como radios distintos.', 'ok');
      cargar();
      return true;
    } catch (e) {
      if (window.Toast) Toast.show('No se pudo marcar: ' + (e.message || e), 'bad');
      return false;
    }
  }

  // ── Entry ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad(init);
  });

  // Pedido de venta facturada → asistente de venta con cliente y factura
  // fijos. Se relee el pedido: el de la bandeja (o el del correo) pudo
  // asignarse o anularse en otra máquina.
  async function abrirPedidoVenta(id) {
    if (!AlmacenPage.puedeOperar()) return AlmacenPage._sinPermiso('Asignar los seriales de una venta');
    let p = null;
    try { p = await PedidosVentaService.get(id); }
    catch (e) { console.warn('[Hoy] pedido de venta:', e?.code || e); }
    if (!p) { Toast.show('No se encontró ese pedido de venta.', 'bad'); return; }
    if (p.estado !== 'pendiente_bodega') {
      Toast.show(p.estado === 'anulada' ? 'Recepción anuló ese pedido.' : 'Ese pedido ya tiene sus seriales asignados.', 'warn');
      return;
    }
    if (!window.AsistenteVenta) { Toast.show('El asistente de venta no cargó. Recarga la página.', 'bad'); return; }
    AsistenteVenta.abrir({ user: firebase.auth().currentUser, pedido: p, rol: ctx.rol,
      onDone: () => AlmacenPage.recargarTodo() });
  }

  function init(rol) {
    ctx.rol = rol;
    // EquipoFicha decide su footer ("Abrir en Inventario") con window.userRole.
    window.userRole = rol;
    // Antes del gate del cuerpo: el técnico también ve la topbar.
    if (window.AlmacenPage) window.AlmacenPage._topbarPorRol();
    // Mismo criterio que las páginas del área: operan admin/inventario, lee
    // gerencia; y quien puede gestionar seriales (recepción/vendedor) puede
    // ver su cola aquí igual que podía en la bandeja vieja.
    const ok = rol === ROLES.ADMIN || rol === ROLES.INVENTARIO || rol === ROLES.GERENTE
      || (typeof canRole === 'function' && canRole(rol, 'gestionar-seriales'));
    if (!ok) {
      const body = $('bodyAlmacen');
      if (body) {
        body.innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">
          Esta área es de administración e inventario. <a href="../index.html">Volver al inicio</a></div>`;
      }
      const loader = $('loader');
      if (loader) loader.style.display = 'none';
      return;
    }

    // La barra de pestañas y el deep-link ?tab= se resuelven en el parse
    // (scripts inline de la página) para que nada brinque; aquí solo se
    // dispara la carga de datos de la pestaña que quedó visible.
    const qs = new URLSearchParams(location.search);
    let pVisible = null; // la carga de la pestaña visible, si no es Hoy
    const ex = document.getElementById('tab-existencias');
    if (ex && ex.style.display !== 'none' && window.AlmacenExistencias) {
      pVisible = AlmacenExistencias.activar();
      // ?serial= (kardexUrl desde contratos/clientes/órdenes, y el stub de
      // inventario/equipos.html): la ficha del serial encima de Existencias.
      if (qs.get('serial') && window.EquipoFicha) EquipoFicha.abrir(qs.get('serial'));
    }
    // ?tab=serial (lista avanzada) con los deep-links que traducía equipos.html.
    const av = document.getElementById('tab-serial');
    if (av && av.style.display !== 'none' && window.EquiposPool) {
      pVisible = EquiposPool.activar({ estado: qs.get('estado') || '', verificar: qs.get('verificar') === '1',
        modelo: qs.get('modelo') || '', serial: qs.get('serial') || '' });
    }
    // Una acción de la ficha (inspección, baja, venta…) refresca las listas.
    if (window.EquipoFicha) EquipoFicha.onCambio = () => AlmacenPage.recargarTodo();
    // Clics delegados de la bandeja (sin onclick inline): los CTAs "Asignar"
    // abren la pestaña sin recargar; "Resolver" abre la hoja de conflicto.
    document.getElementById('hoyGrupos')?.addEventListener('click', (e) => {
      const c = e.target.closest('[data-conflicto]');
      if (c) { e.preventDefault(); abrirConflicto(c.dataset.conflicto); return; }
      const sa = e.target.closest('[data-soltar-anexo]');
      if (sa) { e.preventDefault(); soltarAnexo(sa.dataset.soltarAnexo, sa); return; }
      const vt = e.target.closest('[data-venta]');
      if (vt) { e.preventDefault(); abrirPedidoVenta(vt.dataset.venta); return; }
      // Ficha y Existencias en la misma página (auditoría UX 2026-09-28).
      const fi = e.target.closest('a[data-ficha]');
      if (fi && window.EquipoFicha && !(e.ctrlKey || e.metaKey || e.button !== 0)) {
        e.preventDefault(); EquipoFicha.abrir(fi.dataset.ficha); return;
      }
      const mo = e.target.closest('a[data-modelo-label]');
      if (mo && window.AlmacenExistencias?.enfocarModelo && !(e.ctrlKey || e.metaKey || e.button !== 0)) {
        e.preventDefault();
        AlmacenPage.setTab('existencias');
        AlmacenExistencias.enfocarModelo(mo.dataset.modelo || null, mo.dataset.modeloLabel || '');
        return;
      }
      const a = e.target.closest('a[data-asignar]');
      if (a && !(e.ctrlKey || e.metaKey || e.button !== 0)) {
        e.preventDefault();
        AlmacenPage.abrirAsignar({ contrato: a.dataset.contrato || null, g: a.dataset.g || null });
        return;
      }
      // Links a la lista avanzada ("ver devueltos", "revisar por lotes"): el
      // href lleva ?tab=serial&…; aquí se traduce a un cambio de sección.
      const av = e.target.closest('a[href*="tab=serial"]');
      if (av && window.EquiposPool && !(e.ctrlKey || e.metaKey || e.button !== 0)) {
        e.preventDefault();
        const q = new URL(av.getAttribute('href'), location.href).searchParams;
        AlmacenPage.abrirAvanzado({ estado: q.get('estado') || '', verificar: q.get('verificar') === '1',
          modelo: q.get('modelo') || '', serial: q.get('serial') || '' });
      }
    });
    // Deep-link ?tab=asignar (correo de "Solicitud de seriales" / de bodega):
    // la sección ya está visible desde el parse; aquí se cargan sus datos.
    if (qs.get('tab') === 'asignar' && window.AlmacenAsignar) {
      // &corregir=1 — el expediente manda a bodega a CORREGIR seriales ya
      // asignados, no a asignar los que faltan (2026-09-16).
      pVisible = AlmacenAsignar.activar({ contrato: qs.get('contrato'), g: qs.get('g'), corregir: qs.get('corregir') === '1' });
    }
    // ?accion=conteo|recibir|vender — deep-links de los asistentes.
    const accion = new URLSearchParams(location.search).get('accion');
    if (accion === 'conteo') AlmacenPage.abrirConteo();
    else if (accion === 'recibir') AlmacenPage.abrirRecibir();
    else if (accion === 'vender') AlmacenPage.abrirVenta();
    // ?venta=<pedido> — el correo "Venta facturada: asignar serial(es)".
    if (qs.get('venta')) abrirPedidoVenta(qs.get('venta'));
    // La bandeja de Hoy (7 fuentes, ~10 consultas) se pide de una vez solo si
    // es la pestaña visible. Si la página abrió en otra (deep-link ?tab=),
    // sus datos van primero y Hoy se carga cuando terminen: antes se lanzaba
    // siempre y competía por el mismo canal de Firestore, así que Asignar,
    // Existencias y Avanzado esperaban a Hoy sin verlo (medido en el
    // emulador, 2026-09-29). Su contador mientras tanto es el último conocido.
    if (!pVisible) cargar();
    else Promise.resolve(pVisible).catch(() => {}).then(() => cargar());
  }

  return { recargar, render, abrirConflicto, _conflictoFusionar, _conflictoDistintos, cargarGestionesBodega };
})();
