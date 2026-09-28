/* =============================================================
   Almacén · Existencias — el grid unificado de stock.
   (Propuesta Almacén/Finanzas 2026-08, etapa E2.)

   Un solo grid con tres niveles de zoom en la misma pantalla:
     modelo (agregado por estado)  →  seriales (fila expandible)
     →  ficha con kardex (drawer EquipoFicha, ya existente).

   Reemplaza el par "Inventario de Radios" (por modelo) / "Equipos
   por serial" (por unidad) como vista. La ficha (EquipoFicha) ya trae
   las acciones de cada unidad (inspección, baja, corregir serial…) y
   aquí viven los lotes por bloque, con el runner común del espacio
   (AsistenteLote: barra, Detener, reporte por motivo). La lista por
   serial completa ("+N más", filtros finos, lotes por selección) es
   la pestaña Avanzado de esta misma página; inventario/equipos.html
   solo redirige (auditoría UX 2026-09-28, P2 #14). La conciliación
   contra el conteo es la columna Dif. de este grid — no hay otra.

   El join conteo↔pool es el de StockAgg (P6: un número, un
   cálculo); aquí solo se le pegan los conteos por estado.
   ============================================================= */

window.AlmacenExistencias = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const MAX_CHIPS = 40;   // seriales visibles por estado en la expansión

  // Links a la lista avanzada (pestaña Avanzado de esta misma página): el
  // href es el deep-link real (Ctrl+clic) y el onclick cambia de sección sin
  // recargar. `p` = {estado, modelo}.
  const linkAvanzado = (p, texto, extraCss = '') => {
    const args = JSON.stringify({ estado: p.estado || '', modelo: p.modelo || '' }).replace(/"/g, '&quot;');
    const href = window.AlmacenPage ? window.AlmacenPage.urlAvanzado(p) : 'index.html?tab=serial';
    return `<a class="ex-mas${extraCss ? ' ' + extraCss : ''}" href="${esc(href)}"
      onclick="if(!(event.ctrlKey||event.metaKey)){event.preventDefault();event.stopPropagation();AlmacenPage.abrirAvanzado(${args});}">${texto}</a>`;
  };

  // Columnas de estado del grid (el resto cae en "Otros").
  const COLS = [
    { estado: 'en_bodega',         label: 'Bodega' },
    { estado: 'asignado_contrato', label: 'Asignado' },
    { estado: 'en_cliente',        label: 'Cliente' },
    { estado: 'en_taller',         label: 'Taller' },
    { estado: 'devuelto_revision', label: 'Devueltos' },
  ];
  // `pendiente_cobro` va en "Otros" y NO en una columna propia: el equipo no
  // devuelto no es una ubicación que bodega pueda contar en el estante. Su
  // seguimiento vive en la bandeja de no devueltos, no en existencias.
  // `no_retirado` (radio del cliente sin retirar) también va aquí: antes no
  // estaba ni en COLS ni en OTROS y esas unidades no sumaban en ninguna
  // columna ni salían al desplegar el modelo (auditoría UX 2026-09-28).
  const OTROS = ['vendido', 'baja', 'por_clasificar', 'en_poc', 'pendiente_cobro', 'no_retirado'];

  // Filas cuyas unidades se están trayendo — evita que dos clicks seguidos
  // sobre la misma fila lancen dos consultas.
  const _cargandoDocs = new Set();

  const ctx = {
    cargado: false, cargando: false,
    // fila = { key, modelo_id, label, est:{}, docs, conteo, dif, seriales, data }
    // `docs`: null = sus unidades aún no se han traído (se piden al expandir);
    // [] = no tiene unidades en el pool (fila que solo existe por el conteo).
    filas: [],
    expandida: null,     // key de la fila expandida
    q: '', filtroEstado: '', soloDif: false,
  };

  const $ = (id) => document.getElementById(id);

  // ── Carga y armado ────────────────────────────────────────────────────
  async function activar() {
    if (ctx.cargado || ctx.cargando) return;
    ctx.cargando = true;
    const loader = $('loader');
    if (loader) loader.style.display = '';
    try {
      const [resumen, modelos, conteos] = await Promise.all([
        EquiposPoolService.resumenPorModelo(),
        ModelosService.getModelos(),
        InventarioService.getInventarioActual(),
      ]);
      // Red de seguridad: si el resumen no está (aún sin construir, rules,
      // una reconciliación que lo dejó vacío), la pantalla NO se queda muda —
      // cae al pool completo como antes. Se avisa porque volver a barrer
      // 7,600 fichas en cada apertura es justo lo que se vino a quitar: que
      // pase en silencio sería peor que el error.
      if (!resumen.length) {
        console.warn('[Existencias] agregados_pool vacío — leyendo el pool completo');
        if (typeof Toast !== 'undefined') Toast.show('Resumen de inventario no disponible: se leyó el pool completo.', 'warn');
        ctx.filas = armarFilas({ resumen: resumenDesdePool(await EquiposPoolService.listar()), modelos, conteos });
      } else {
        ctx.filas = armarFilas({ resumen, modelos, conteos });
      }
      ctx.cargado = true;
      render();
      if (_enfoquePendiente) {
        const p = _enfoquePendiente; _enfoquePendiente = null;
        enfocarModelo(p.modeloId, p.label);
      }
      // Una recarga (tras un lote, o desde un hook externo) rearma las filas
      // con `docs: null`. Si había una fila abierta hay que volver a traer sus
      // unidades, o se quedaría en "Cargando…" sin que nadie las pida.
      if (ctx.expandida) cargarDocs(ctx.expandida);
    } catch (e) {
      console.error('[Existencias] no se pudo cargar:', e);
      if (typeof Toast !== 'undefined') Toast.show('No se pudieron cargar las existencias.', 'bad');
    } finally {
      ctx.cargando = false;
      if (loader) loader.style.display = 'none';
    }
  }

  // Deriva el mismo resumen a partir del pool en memoria — solo para la red
  // de seguridad de arriba, que necesita alimentar a armarFilas con la forma
  // que ahora viene de `agregados_pool`.
  function resumenDesdePool(pool) {
    const m = new Map();
    for (const eq of (pool || [])) {
      const key = EquiposPoolService.modeloKey(eq.modelo_id, eq.modelo_label);
      const g = m.get(key) || { key, modelo_id: eq.modelo_id || null, modelo_label: eq.modelo_label || '', est: {}, docs: [] };
      g.est[eq.estado] = (g.est[eq.estado] || 0) + 1;
      g.docs.push(eq);
      if (!g.modelo_id && eq.modelo_id) g.modelo_id = eq.modelo_id;
      if (!g.modelo_label && eq.modelo_label) g.modelo_label = eq.modelo_label;
      m.set(key, g);
    }
    return [...m.values()];
  }

  function armarFilas({ resumen, modelos, conteos }) {
    // Grupos por modelo. Los conteos vienen ya hechos del resumen; las
    // unidades (`docs`) NO se cargan aquí: se traen al expandir la fila. Esa
    // es toda la diferencia de consumo — la tabla necesita números, y los
    // seriales solo hacen falta del modelo que el usuario abre.
    const grupos = new Map();
    for (const r of resumen) {
      grupos.set(r.key, {
        key: r.key,
        modelo_id: r.modelo_id || null,
        label: r.modelo_label || '',
        est: r.est || {},
        // `null` = sin cargar todavía (distinto de `[]` = cargado y vacío).
        docs: Array.isArray(r.docs) ? r.docs : null,
      });
    }
    const porId = new Map(), porTight = new Map();
    for (const g of grupos.values()) {
      if (g.modelo_id) porId.set(g.modelo_id, g);
      const tl = EquiposPoolService._tightLabel(g.label);
      if (tl && !porTight.has(tl)) porTight.set(tl, g);
    }

    // Join canónico conteo ↔ bodega (StockAgg). `agruparPool` arma este mismo
    // Map recorriendo docs; aquí el conteo de bodega ya viene hecho, así que
    // se arma con la misma FORMA (modeloKey → {modelo_id, modelo_label, n})
    // para que StockAgg reciba exactamente lo de siempre.
    const bodegaMap = new Map();
    for (const g of grupos.values()) {
      const n = g.est['en_bodega'] || 0;
      if (!n) continue;
      bodegaMap.set(g.key, { modelo_id: g.modelo_id, modelo_label: g.label, n });
    }
    const joinRows = StockAgg.build({ modelos, conteos, poolMap: bodegaMap });

    const usados = new Set();
    const filas = joinRows.map(f => {
      const g = (f.modelo_id && porId.get(f.modelo_id))
        || porTight.get(EquiposPoolService._tightLabel(f.modelo?.modelo || f.label)) || null;
      if (g) usados.add(g.key);
      return {
        key: g?.key || `join_${f.modelo_id || f.label}`,
        modelo_id: f.modelo_id || g?.modelo_id || null,
        label: f.modelo?.modelo || f.label,
        marca: f.modelo?.marca || '',
        modelo: f.modelo,
        // Sin grupo en el pool = fila que solo existe por el conteo físico:
        // `[]` (no hay unidades) y no `null`, que dispararía una carga inútil.
        est: g?.est || {}, docs: g ? g.docs : [],
        seriales: f.seriales, conteo: f.conteo, dif: f.dif, data: f.data,
      };
    });
    // Modelos con unidades SOLO fuera de bodega y sin conteo (100% en cliente,
    // taller, vendido…): el join no los ve, pero existen — se agregan.
    for (const g of grupos.values()) {
      if (usados.has(g.key)) continue;
      filas.push({
        key: g.key, modelo_id: g.modelo_id, label: g.label || '(sin modelo)', marca: '',
        modelo: { modelo: g.label || '(sin modelo)' },
        est: g.est, docs: g.docs, seriales: g.est['en_bodega'] || 0, conteo: null, dif: null, data: {},
      });
    }
    filas.sort((a, b) => (a.label || '').toLowerCase().localeCompare((b.label || '').toLowerCase()));
    return filas;
  }

  // ── Filtros ───────────────────────────────────────────────────────────
  function filtradas() {
    const q = ctx.q.toLowerCase().trim();
    return ctx.filas.filter(f => {
      if (ctx.soloDif && !(f.dif != null && f.dif !== 0)) return false;
      if (ctx.filtroEstado) {
        const n = ctx.filtroEstado === 'otros'
          ? OTROS.reduce((s, e) => s + (f.est[e] || 0), 0)
          : (f.est[ctx.filtroEstado] || 0);
        if (!n) return false;
      }
      if (q && !(`${f.marca} ${f.label}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function onBuscar(val) {
    ctx.q = val || '';
    render();
  }

  // Enter en el buscador. Auditoría UX 2026-09-28: si el texto coincide con
  // un modelo, Enter lo despliega (antes "NX-410" se trataba como serial y
  // abría una ficha inexistente); si no, y parece un serial, abre la ficha
  // — búsqueda universal sobre TODO el registro, sin importar filtros. Si
  // solo queda un modelo en la tabla, Enter lo abre también.
  function onBuscarEnter() {
    const raw = ($('exBuscador')?.value || '').trim();
    if (!raw) return;
    const tl = EquiposPoolService._tightLabel(raw);
    const exacto = tl && ctx.filas.find(f =>
      EquiposPoolService._tightLabel(f.label) === tl
      || EquiposPoolService._tightLabel(`${f.marca} ${f.label}`) === tl);
    if (exacto) { abrirFila(exacto.key); return; }
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (norm && EquiposPoolService.esSerialValido(norm)) { EquipoFicha.abrir(raw); return; }
    const vis = filtradas();
    if (vis.length === 1) abrirFila(vis[0].key);
  }

  function abrirFila(key) {
    if (ctx.expandida !== key) toggleFila(key);
  }

  // Deep-link desde Hoy ("Revisar" de una diferencia de conteo, auditoría UX
  // 2026-09-28): despliega el modelo y lo trae a la vista. Si la tabla aún no
  // cargó, queda pendiente y se aplica al terminar activar().
  let _enfoquePendiente = null;
  function enfocarModelo(modeloId, label = '') {
    if (!ctx.cargado) { _enfoquePendiente = { modeloId, label }; activar(); return; }
    const tl = EquiposPoolService._tightLabel(label);
    const f = ctx.filas.find(x => (modeloId && x.modelo_id === modeloId))
      || (tl && ctx.filas.find(x => EquiposPoolService._tightLabel(x.label) === tl));
    if (!f) return;
    ctx.q = ''; ctx.filtroEstado = ''; ctx.soloDif = false;
    const b = $('exBuscador'); if (b) b.value = '';
    abrirFila(f.key);
    requestAnimationFrame(() => document.querySelector('tr.ex-fila.is-abierta')?.scrollIntoView({ block: 'center' }));
  }

  function setFiltroEstado(v) { ctx.filtroEstado = v; render(); }
  function toggleSoloDif(chk) {
    ctx.soloDif = !!chk.checked;
    chk.closest('.toggle-pill')?.classList.toggle('is-on', chk.checked);
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────
  function render() {
    const filas = filtradas();
    pintarKpis();

    const tbody = $('exTabla');
    if (!tbody) return;
    if (!filas.length) {
      // Mientras se teclea un serial la tabla no debe decir "sin modelos" a
      // secas: el buscador también encuentra seriales (auditoría UX 2026-09-28).
      const q = ctx.q.trim();
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:var(--fg-3); padding:var(--sp-5);">
        ${q ? `Ningún modelo coincide con «${esc(q)}». Pulsa <b>Enter</b> para buscar el serial.`
            : 'Sin modelos que cumplan el filtro.'}</td></tr>`;
    } else {
      tbody.innerHTML = filas.map(filaHtml).join('');
    }
    const resumen = $('exResumen');
    if (resumen) resumen.innerHTML = `Mostrando <strong>${filas.length}</strong> de <strong>${ctx.filas.length}</strong> modelos`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function pintarKpis() {
    const t = { bodega: 0, cliente: 0, taller: 0, cuarentena: 0, difs: 0 };
    for (const f of ctx.filas) {
      t.bodega += f.est['en_bodega'] || 0;
      t.cliente += (f.est['en_cliente'] || 0) + (f.est['asignado_contrato'] || 0);
      t.taller += f.est['en_taller'] || 0;
      t.cuarentena += f.est['devuelto_revision'] || 0;
      if (f.dif != null && f.dif !== 0) t.difs++;
    }
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v.toLocaleString(); };
    set('exKpiBodega', t.bodega);
    set('exKpiCliente', t.cliente);
    set('exKpiTaller', t.taller);
    set('exKpiCuarentena', t.cuarentena);
    set('exKpiDif', t.difs);
    const difCard = $('exKpiDif');
    if (difCard) difCard.classList.toggle('kpi-warn', t.difs !== 0);
  }

  // `sec`: columna secundaria — en tablet (≤1024 px) se esconde y su número
  // pasa a la fila expandida (ver .ex-sec en almacen/index.html).
  function celda(n, danger = false, sec = false) {
    const cls = sec ? ' class="ex-sec"' : '';
    if (!n) return `<td${cls} style="text-align:right; color:var(--fg-4);">—</td>`;
    return `<td${cls} style="text-align:right; font-variant-numeric:tabular-nums; ${danger ? 'color:#991B1B; font-weight:600;' : ''}">${n}</td>`;
  }

  function filaHtml(f) {
    const abierta = ctx.expandida === f.key;
    const otros = OTROS.reduce((s, e) => s + (f.est[e] || 0), 0);
    const difHtml = f.dif == null
      ? '<td style="text-align:right; color:var(--fg-4);">—</td>'
      : f.dif === 0
        ? '<td style="text-align:right;"><span class="badge completo">0</span></td>'
        : `<td style="text-align:right;"><span class="badge ${f.dif > 0 ? 'pendiente' : 'danger'}">${f.dif > 0 ? '+' : ''}${f.dif}</span></td>`;
    const fila = `
      <tr class="ex-fila${abierta ? ' is-abierta' : ''}" onclick="AlmacenExistencias.toggleFila('${esc(f.key).replace(/'/g, "\\'")}')">
        <td class="td-primary" style="cursor:pointer;">
          <i data-lucide="${abierta ? 'chevron-down' : 'chevron-right'}" style="width:14px;height:14px; vertical-align:-2px;"></i>
          ${esc(f.marca ? `${f.marca} ` : '')}<b>${esc(f.label)}</b>
        </td>
        ${celda(f.est['en_bodega'] || 0)}
        ${celda(f.est['asignado_contrato'] || 0, false, true)}
        ${celda(f.est['en_cliente'] || 0, false, true)}
        ${celda(f.est['en_taller'] || 0, false, true)}
        ${celda(f.est['devuelto_revision'] || 0, true)}
        ${celda(otros, false, true)}
        <td style="text-align:right; color:var(--fg-3);">${f.conteo ?? '—'}</td>
        ${difHtml}
        <td class="ex-sec" style="text-align:right; color:var(--fg-4); font-size:12px; white-space:nowrap;">${ultimoConteo(f)}</td>
      </tr>`;
    return fila + (abierta ? expansionHtml(f) : '');
  }

  function ultimoConteo(f) {
    return f.data?.ultima_actualizacion?.toDate ? f.data.ultima_actualizacion.toDate().toLocaleDateString('es-PA') : '—';
  }

  // Lo que la tabla esconde en tablet, dicho en la fila expandida (solo se
  // ve a ≤1024 px; en escritorio ya está en las columnas).
  function resumenSecHtml(f) {
    const otros = OTROS.reduce((s, e) => s + (f.est[e] || 0), 0);
    return `<div class="ex-sec-resumen">
      <span>Asignado <b>${f.est['asignado_contrato'] || 0}</b></span>
      <span>Cliente <b>${f.est['en_cliente'] || 0}</b></span>
      <span>Taller <b>${f.est['en_taller'] || 0}</b></span>
      <span>Otros <b>${otros}</b></span>
      <span>Últ. conteo <b>${esc(ultimoConteo(f))}</b></span>
    </div>`;
  }

  function expansionHtml(f) {
    // Las unidades se traen al abrir (ver cargarDocs). Mientras llegan, la
    // fila dice que está cargando en vez de mentir con "sin unidades".
    if (f.docs === null) {
      return `<tr class="ex-expansion"><td colspan="10">
        ${resumenSecHtml(f)}
        <span style="color:var(--fg-3); font-size:13px;">Cargando las unidades de ${esc(f.label)}…</span>
      </td></tr>`;
    }
    const porEstado = new Map();
    for (const eq of f.docs) {
      if (!porEstado.has(eq.estado)) porEstado.set(eq.estado, []);
      porEstado.get(eq.estado).push(eq);
    }
    const orden = [...COLS.map(c => c.estado), ...OTROS];
    const bloques = orden.filter(e => porEstado.has(e)).map(estado => {
      const docs = porEstado.get(estado);
      const chips = docs.slice(0, MAX_CHIPS).map(eq => `
        <button type="button" class="ex-serial" data-dot="${esc(estado)}"
          onclick="event.stopPropagation(); EquipoFicha.abrir('${esc(eq.serial || eq.serial_norm).replace(/'/g, "\\'")}')"
          title="Ver ficha y kardex">
          <i></i>${esc(eq.serial || eq.serial_norm)}
        </button>`).join('');
      const resto = docs.length - MAX_CHIPS;
      const mas = resto > 0
        ? linkAvanzado({ estado, modelo: f.modelo_id || '' }, `+${resto} más →`) : '';
      // Acciones de LOTE por bloque (Fase C): aplican a TODAS las unidades de
      // ese estado en este modelo — la forma de atacar el atraso por tandas.
      const puede = ['administrador', 'inventario'].includes(window.userRole);
      let lote = '';
      if (puede && estado === 'devuelto_revision') {
        // Solo las que NO tienen ENTRADA del taller abierta: esas las
        // inspecciona el taller y regresan solas al cerrarse la orden — mismo
        // criterio que Hoy (auditoría UX 2026-09-28).
        const nLibres = docs.filter(x => !x.orden_actual_id).length;
        const nTaller = docs.length - nLibres;
        lote = nLibres ? `<button type="button" class="btn btn-sm btn-accent" style="margin-left:6px;"
          onclick="event.stopPropagation(); AlmacenExistencias.loteAccion('${esc(f.key).replace(/'/g, "\\'")}', '${esc(estado)}', 'inspeccion_ok', this)">
          ✓ Inspección OK (${nLibres})</button>` : '';
        if (nTaller) lote += ` <span style="text-transform:none; letter-spacing:0;">· ${nTaller} con ENTRADA de taller abierta (las inspecciona el taller)</span>`;
      } else if (puede && estado === 'por_clasificar') {
        lote = `<button type="button" class="btn btn-sm btn-accent" style="margin-left:6px;"
          onclick="event.stopPropagation(); AlmacenExistencias.loteAccion('${esc(f.key).replace(/'/g, "\\'")}', '${esc(estado)}', 'corregir', this)">
          Corregir a bodega (${docs.length})</button>`;
      }
      const sinVerif = puede ? docs.filter(x => x.verificado === false).length : 0;
      const loteVerif = sinVerif ? `<button type="button" class="btn btn-sm" style="margin-left:6px;"
        onclick="event.stopPropagation(); AlmacenExistencias.loteAccion('${esc(f.key).replace(/'/g, "\\'")}', '${esc(estado)}', 'verificar', this)">
        Marcar verificados (${sinVerif})</button>` : '';
      return `<div class="ex-bloque">
        <span class="ex-bloque-t">${esc(EquiposPoolService.ESTADO_LABELS[estado] || estado)} · ${docs.length}${lote}${loteVerif}</span>
        ${chips}${mas}
      </div>`;
    }).join('');
    const linkEquipos = linkAvanzado({ estado: 'todos', modelo: f.modelo_id || '' },
      '<i data-lucide="sliders-horizontal" style="width:13px;height:13px;"></i> Ver en la lista por serial (Avanzado) →', 'ex-mas--pie');
    const linkHistorico = f.modelo_id
      ? ` · <a href="#" onclick="event.preventDefault(); event.stopPropagation(); AlmacenExistencias.verHistorico('${esc(f.modelo_id).replace(/'/g, "\\'")}')">
          <i data-lucide="bar-chart-2" style="width:13px;height:13px;"></i> Histórico de conteos</a>` : '';
    return `
      <tr class="ex-expansion"><td colspan="10">
        ${resumenSecHtml(f)}
        ${bloques || '<span style="color:var(--fg-3); font-size:13px;">Sin unidades registradas (solo conteo físico).</span>'}
        <div class="ex-expansion-pie">
          ${linkEquipos}${linkHistorico}
          <span id="exHistorico-${esc(f.modelo_id || '')}"></span>
        </div>
      </td></tr>`;
  }

  function toggleFila(key) {
    ctx.expandida = ctx.expandida === key ? null : key;
    render();
    if (ctx.expandida) cargarDocs(ctx.expandida);
  }

  // Trae las unidades del modelo expandido. Es el otro lado del trato: la
  // tabla se pinta con el resumen (~111 lecturas) y solo el modelo que el
  // usuario abre paga por sus seriales. Una vez cargadas se quedan en memoria
  // mientras dure la página — reabrir la misma fila no vuelve a leer.
  async function cargarDocs(key) {
    const f = ctx.filas.find(x => x.key === key);
    if (!f || f.docs !== null || _cargandoDocs.has(key)) return;
    _cargandoDocs.add(key);
    try {
      f.docs = await EquiposPoolService.listarPorModeloKey(key, f.modelo_id);
    } catch (e) {
      console.error('[Existencias] no se pudieron cargar las unidades de', key, e);
      // Se deja en null para que un segundo click reintente, en vez de
      // quedarse mostrando "sin unidades" para siempre.
      if (typeof Toast !== 'undefined') Toast.show('No se pudieron cargar las unidades de ' + (f.label || key) + '.', 'bad');
    } finally {
      _cargandoDocs.delete(key);
    }
    if (ctx.expandida === key) render();
  }

  // ── Export / reporte (mismo cálculo del join — StockAgg) ──────────────
  async function exportarExcel() {
    await cargarXLSX();
    const wsData = [['Marca', 'Modelo', 'Bodega', 'Asignado', 'En cliente', 'Taller', 'Devuelto por inspeccionar', 'Otros', 'Conteo físico', 'Diferencia']];
    for (const f of filtradas()) {
      wsData.push([
        f.marca || '-', f.label,
        f.est['en_bodega'] || 0, f.est['asignado_contrato'] || 0, f.est['en_cliente'] || 0,
        f.est['en_taller'] || 0, f.est['devuelto_revision'] || 0,
        OTROS.reduce((s, e) => s + (f.est[e] || 0), 0),
        f.conteo ?? '-', f.dif ?? '-',
      ]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsData), 'Existencias');
    XLSX.writeFile(wb, `Existencias_Cecomunica_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  async function copiarReporte() {
    if (!ctx.filas.length) { Toast.show('Existencias aún no cargadas', 'warn'); return; }
    // El reporte por correo conserva su formato canónico (bodega vs conteo):
    // se arma con las filas del join de StockAgg, igual que el tablero.
    const filasReporte = ctx.filas
      .filter(f => f.seriales || f.conteo != null)
      .map(f => ({
        modelo: f.modelo || { marca: f.marca, modelo: f.label },
        seriales: f.seriales, conteo: f.conteo, dif: f.dif, data: f.data,
      }));
    const html = StockAgg.emailHtml(filasReporte);
    const plano = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('sin ClipboardItem');
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plano], { type: 'text/plain' }),
      })]);
      Toast.show('Reporte copiado — pégalo en el correo.', 'ok');
    } catch (e) {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); Toast.show('Se abrió el reporte en una pestaña.', 'ok'); }
      else Toast.show('No se pudo copiar el reporte: ' + (e.message || e), 'bad');
    }
  }

  function recargar() {
    ctx.cargado = false;
    return activar();
  }

  // Refresco desde hooks externos (ficha, asistentes): solo si ya se cargó.
  function refrescarSiCargado() {
    if (ctx.cargado) recargar();
  }

  // Histórico de conteos del modelo (absorbe el verHistorico del tablero —
  // que era un alert()): se pinta inline en la expansión.
  async function verHistorico(modeloId) {
    const cont = document.getElementById(`exHistorico-${modeloId}`);
    if (!cont) return;
    cont.innerHTML = ' <span style="color:var(--fg-3);">cargando…</span>';
    try {
      const hist = await InventarioService.getHistorialModelo(modeloId);
      if (!hist.length) { cont.innerHTML = ' <span style="color:var(--fg-3);">— sin conteos registrados</span>'; return; }
      cont.innerHTML = '<span style="display:block; margin-top:6px; font-size:12px; color:var(--fg-3);">'
        + hist.slice(0, 8).map(h =>
          `${h.timestamp?.toDate ? h.timestamp.toDate().toLocaleDateString('es-PA') : '—'}: <b>${h.cantidad}</b>`
        ).join(' · ')
        + (hist.length > 8 ? ` · +${hist.length - 8} más` : '') + '</span>';
    } catch (e) {
      cont.innerHTML = ' <span style="color:#b91c1c;">no se pudo cargar</span>';
    }
  }

  // ── Acciones de lote por bloque (Fase C) ────────────────────────────────
  // Reutiliza las mismas funciones unitarias del servicio que las acciones de
  // fila. El runner es AsistenteLote (auditoría UX 2026-09-28, P2 #13): barra
  // de progreso, Detener y reporte agrupado por motivo — antes esto corría un
  // bucle mudo en el botón ("Procesando i/N") sin forma de parar un lote de
  // 300 ni de saber cuáles fallaron.
  // Candado (auditoría P0): un segundo clic no lanza OTRO lote sobre las
  // mismas unidades (kardex con movimientos duplicados).
  let _loteEnVuelo = false;

  // Qué hace cada lote. `correr` es LA función de servicio de la acción de
  // fila — nunca una copia de la escritura.
  const LOTES = {
    inspeccion_ok: {
      titulo: 'Inspección OK en lote', icono: 'check-circle-2', labelOk: 'Inspección OK',
      cuerpo: (n, f) => `<b>${n}</b> unidad(es) de <b>${esc(f.label)}</b> devueltas por inspeccionar (sin ENTRADA de taller abierta) pasan inspección y vuelven a bodega como disponibles (tipo Refurbished).<br><br>Cada una deja su movimiento en el kardex.`,
      correr: (eq, motivo, user) => EquiposPoolService.liberar(eq.id,
        { notas: motivo || 'Inspección OK en lote (Almacén · Existencias)', esperado: EquiposPoolService.ESTADOS.DEVUELTO }, user),
    },
    corregir: {
      titulo: 'Corregir estado en lote', icono: 'pencil-ruler', labelOk: 'Corregir a bodega',
      pideMotivo: true, motivoPlaceholder: 'p. ej. conteo físico del 4-ago, estante A2',
      cuerpo: (n, f) => `<b>${n}</b> unidad(es) de <b>${esc(f.label)}</b> en "por clasificar" pasarán a <b>En bodega</b>.<br><br>Al confirmar estás <b>afirmando que están físicamente en bodega</b> — normalmente porque acabas de contarlas. No lo uses para “limpiar la lista”.`,
      correr: (eq, motivo, user) => EquiposPoolService.corregirABodega(eq.id, motivo, user),
    },
    verificar: {
      titulo: 'Marcar como verificados', icono: 'badge-check', labelOk: 'Verificados',
      cuerpo: (n, f) => `Se marcarán <b>${n}</b> ficha(s) de <b>${esc(f.label)}</b> como verificadas: confirmas que el dato de la migración es correcto porque tienes el equipo a la vista. <b>No hay deshacer en lote.</b>`,
      correr: (eq, motivo, user) => EquiposPoolService.verificar(eq.id, user),
    },
  };

  async function loteAccion(key, estado, accion, btn) {
    if (_loteEnVuelo) return;
    const f = ctx.filas.find(x => x.key === key);
    const L = LOTES[accion];
    if (!f || !L) return;
    // El botón de lote vive DENTRO de la expansión, así que las unidades ya
    // están cargadas. Si aun así no lo estuvieran (una recarga a medias), se
    // para: un lote sobre una lista vacía no haría nada y parecería que sí.
    if (!Array.isArray(f.docs)) {
      if (typeof Toast !== 'undefined') Toast.show('Las unidades aún se están cargando — inténtalo de nuevo.', 'warn');
      return;
    }
    const docs = f.docs.filter(eq => eq.estado === estado
      && (accion !== 'verificar' || eq.verificado === false)
      // Inspección OK no toca lo que tiene ENTRADA abierta (auditoría UX 2026-09-28).
      && (accion !== 'inspeccion_ok' || !eq.orden_actual_id));
    if (!docs.length) return;
    if (!window.AsistenteLote) { if (window.Toast) Toast.show('El runner de lotes no cargó. Recarga la página.', 'bad'); return; }
    const user = firebase.auth().currentUser;
    _loteEnVuelo = true;
    if (btn) btn.disabled = true;
    try {
      const r = await AsistenteLote.correr({
        titulo: L.titulo, icono: L.icono, cuerpoHtml: L.cuerpo(docs.length, f),
        items: docs, etiqueta: (eq) => eq.serial || eq.serial_norm,
        pideMotivo: !!L.pideMotivo, motivoPlaceholder: L.motivoPlaceholder || '',
        correr: (eq, motivo) => L.correr(eq, motivo, user), labelOk: L.labelOk,
      });
      if (!r) return;                 // canceló antes de empezar: nada cambió
      await recargar();
      if (window.AlmacenHoy) AlmacenHoy.recargar();
    } finally {
      _loteEnVuelo = false;
      // recargar() repinta la tabla (el botón viejo queda huérfano), pero si
      // se canceló antes del repintado hay que revivirlo.
      if (btn) btn.disabled = false;
    }
  }

  return { activar, recargar, refrescarSiCargado, render, toggleFila, onBuscar, onBuscarEnter, setFiltroEstado, toggleSoloDif, exportarExcel, copiarReporte, loteAccion, verHistorico, enfocarModelo, LOTES };
})();
