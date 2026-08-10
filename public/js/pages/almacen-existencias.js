/* =============================================================
   Almacén · Existencias — el grid unificado de stock.
   (Propuesta Almacén/Finanzas 2026-08, etapa E2.)

   Un solo grid con tres niveles de zoom en la misma pantalla:
     modelo (agregado por estado)  →  seriales (fila expandible)
     →  ficha con kardex (drawer EquipoFicha, ya existente).

   Reemplaza el par "Inventario de Radios" (por modelo) / "Equipos
   por serial" (por unidad) como vista. Las MUTACIONES (recibir,
   vender, inspección, baja, lotes) siguen viviendo en
   inventario/equipos.html — cada serial y cada modelo enlazan ahí
   con deep-link; los asistentes se abren desde la topbar de este
   espacio con ?accion=.

   El join conteo↔pool es el de StockAgg (P6: un número, un
   cálculo); aquí solo se le pegan los conteos por estado.
   ============================================================= */

window.AlmacenExistencias = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const EQUIPOS = '../inventario/equipos.html';
  const MAX_CHIPS = 40;   // seriales visibles por estado en la expansión

  // Columnas de estado del grid (el resto cae en "Otros").
  const COLS = [
    { estado: 'en_bodega',         label: 'Bodega' },
    { estado: 'asignado_contrato', label: 'Asignado' },
    { estado: 'en_cliente',        label: 'Cliente' },
    { estado: 'en_taller',         label: 'Taller' },
    { estado: 'devuelto_revision', label: 'Cuarent.' },
  ];
  const OTROS = ['vendido', 'baja', 'por_clasificar', 'en_poc'];

  const ctx = {
    cargado: false, cargando: false,
    filas: [],           // fila = { key, modelo_id, label, est:{}, docs:[], conteo, dif, seriales, data }
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
      const [pool, modelos, conteos] = await Promise.all([
        EquiposPoolService.listar(),
        ModelosService.getModelos(),
        InventarioService.getInventarioActual(),
      ]);
      ctx.filas = armarFilas({ pool, modelos, conteos });
      ctx.cargado = true;
      render();
    } catch (e) {
      console.error('[Existencias] no se pudo cargar:', e);
      if (typeof Toast !== 'undefined') Toast.show('No se pudieron cargar las existencias.', 'bad');
    } finally {
      ctx.cargando = false;
      if (loader) loader.style.display = 'none';
    }
  }

  function armarFilas({ pool, modelos, conteos }) {
    // Grupos del pool por modelo (mismo criterio modeloKey de todo el sistema).
    const grupos = new Map();
    for (const eq of pool) {
      const key = EquiposPoolService.modeloKey(eq.modelo_id, eq.modelo_label);
      const g = grupos.get(key) || { key, modelo_id: eq.modelo_id || null, label: eq.modelo_label || '', docs: [], est: {} };
      g.docs.push(eq);
      g.est[eq.estado] = (g.est[eq.estado] || 0) + 1;
      if (!g.modelo_id && eq.modelo_id) g.modelo_id = eq.modelo_id;
      grupos.set(key, g);
    }
    const porId = new Map(), porTight = new Map();
    for (const g of grupos.values()) {
      if (g.modelo_id) porId.set(g.modelo_id, g);
      const tl = EquiposPoolService._tightLabel(g.label);
      if (tl && !porTight.has(tl)) porTight.set(tl, g);
    }

    // Join canónico conteo ↔ bodega (StockAgg) + conteos por estado del grupo.
    const bodegaMap = StockAgg.agruparPool(pool.filter(e => e.estado === 'en_bodega'));
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
        est: g?.est || {}, docs: g?.docs || [],
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

  // Enter en el buscador: si parece un serial, abre la ficha directamente —
  // búsqueda universal sobre TODO el pool, sin importar filtros.
  function onBuscarEnter() {
    const raw = ($('exBuscador')?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (norm && EquiposPoolService.esSerialValido(norm)) EquipoFicha.abrir(raw);
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
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--fg-3); padding:var(--sp-5);">
        Sin modelos que cumplan el filtro.</td></tr>`;
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

  function celda(n, danger = false) {
    if (!n) return '<td style="text-align:right; color:var(--fg-4);">—</td>';
    return `<td style="text-align:right; font-variant-numeric:tabular-nums; ${danger ? 'color:#991B1B; font-weight:600;' : ''}">${n}</td>`;
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
        ${celda(f.est['asignado_contrato'] || 0)}
        ${celda(f.est['en_cliente'] || 0)}
        ${celda(f.est['en_taller'] || 0)}
        ${celda(f.est['devuelto_revision'] || 0, true)}
        ${celda(otros)}
        <td style="text-align:right; color:var(--fg-3);">${f.conteo ?? '—'}</td>
        ${difHtml}
      </tr>`;
    return fila + (abierta ? expansionHtml(f) : '');
  }

  function expansionHtml(f) {
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
        ? `<a class="ex-mas" href="${EQUIPOS}?tab=${encodeURIComponent(estado)}${f.modelo_id ? `&modelo=${encodeURIComponent(f.modelo_id)}` : ''}">+${resto} más →</a>` : '';
      return `<div class="ex-bloque">
        <span class="ex-bloque-t">${esc(EquiposPoolService.ESTADO_LABELS[estado] || estado)} · ${docs.length}</span>
        ${chips}${mas}
      </div>`;
    }).join('');
    const linkEquipos = `${EQUIPOS}?tab=todos${f.modelo_id ? `&modelo=${encodeURIComponent(f.modelo_id)}` : ''}`;
    return `
      <tr class="ex-expansion"><td colspan="9">
        ${bloques || '<span style="color:var(--fg-3); font-size:13px;">Sin unidades en el pool (solo conteo físico).</span>'}
        <div class="ex-expansion-pie">
          <a href="${linkEquipos}"><i data-lucide="scan-barcode" style="width:13px;height:13px;"></i>
            Gestionar en Equipos por serial →</a>
        </div>
      </td></tr>`;
  }

  function toggleFila(key) {
    ctx.expandida = ctx.expandida === key ? null : key;
    render();
  }

  // ── Export / reporte (mismo cálculo del join — StockAgg) ──────────────
  async function exportarExcel() {
    await cargarXLSX();
    const wsData = [['Marca', 'Modelo', 'Bodega', 'Asignado', 'En cliente', 'Taller', 'Cuarentena', 'Otros', 'Conteo físico', 'Diferencia']];
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

  return { activar, recargar, render, toggleFila, onBuscar, onBuscarEnter, setFiltroEstado, toggleSoloDif, exportarExcel, copiarReporte };
})();
