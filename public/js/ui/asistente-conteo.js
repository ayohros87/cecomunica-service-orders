// Asistente de CONTEO FÍSICO — absorbe inventario/cargar-inventario.html
// (propuesta Almacén 2026-08, fase B). Cierra el circuito completo de F2:
//   1) capturar cantidades por modelo (a ciegas, sin ver el pool — el conteo
//      físico es verificación independiente),
//   2) revisar el diff contra el pool ANTES de guardar (StockAgg, mismo join
//      del tablero y la bandeja),
//   3) guardar (InventarioService.guardarInventario) → las diferencias caen
//      a la bandeja "Hoy" como trabajo.
// window.AsistenteConteo.abrir({ user, onDone }). La página gatea el rol.
window.AsistenteConteo = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const ctx = { modelos: [], cantidades: {}, opts: null };

  function abrir(opts = {}) {
    ctx.opts = opts;
    ctx.cantidades = {};
    render(`<p style="color:var(--fg-3); font-size:13px;">Cargando catálogo…</p>`);
    ModelosService.getModelos().then(ms => {
      ctx.modelos = (ms || []).filter(m => m.activo !== false)
        .sort((a, b) => `${a.marca || ''} ${a.modelo || ''}`.localeCompare(`${b.marca || ''} ${b.modelo || ''}`));
      paso1();
    }).catch(e => render(`<p style="color:#b91c1c;">No se pudo cargar el catálogo: ${esc(e.message || e)}</p>`));
  }

  // ── Paso 1: captura ─────────────────────────────────────────────────────
  function paso1(filtro = '') {
    const q = filtro.toLowerCase().trim();
    const filas = ctx.modelos
      .filter(m => !q || `${m.marca || ''} ${m.modelo || ''}`.toLowerCase().includes(q))
      .map(m => `
        <tr>
          <td>${esc(m.marca || '—')}</td>
          <td class="td-primary">${esc(m.modelo || '—')}</td>
          <td style="text-align:right;">
            <input type="number" min="0" inputmode="numeric" data-conteo-modelo="${esc(m.id)}"
              value="${ctx.cantidades[m.id] ?? ''}" placeholder="—"
              style="width:82px; text-align:right;" class="cc-input"
              oninput="AsistenteConteo._setCantidad('${esc(m.id)}', this.value)">
          </td>
        </tr>`).join('');
    render(`
      <p style="font-size:12.5px; color:var(--fg-3); margin:0 0 8px;">
        Cuenta lo físico en bodega y teclea la cantidad por modelo. Deja vacío lo que no
        contaste (no se toca su conteo anterior). El pool no se muestra a propósito:
        el conteo es la verificación independiente.
      </p>
      <input type="search" class="cc-input" placeholder="Filtrar modelo…" style="width:100%; margin-bottom:8px;"
        oninput="AsistenteConteo._filtrar(this.value)">
      <div style="max-height:46vh; overflow-y:auto;">
        <table class="app-table compact">
          <thead><tr><th>Marca</th><th>Modelo</th><th style="text-align:right;">Cantidad contada</th></tr></thead>
          <tbody>${filas || '<tr><td colspan="3" style="color:var(--fg-3);">Sin modelos con ese filtro.</td></tr>'}</tbody>
        </table>
      </div>`,
      `<button class="btn btn-primary" onclick="AsistenteConteo._revisar()">Revisar diferencias →</button>`);
  }

  function _setCantidad(modeloId, v) {
    if (v === '' || v === null) delete ctx.cantidades[modeloId];
    else ctx.cantidades[modeloId] = Math.max(0, Number(v) || 0);
  }
  function _filtrar(v) { paso1(v); }

  // ── Paso 2: diff contra el pool ANTES de guardar ────────────────────────
  async function _revisar() {
    const entradas = Object.entries(ctx.cantidades);
    if (!entradas.length) { if (window.Toast) Toast.show('No tecleaste ninguna cantidad.', 'warn'); return; }
    render('<p style="color:var(--fg-3); font-size:13px;">Comparando contra el pool…</p>');
    let poolMap;
    try {
      poolMap = await EquiposPoolService.contarBodegaPorModelo();
    } catch (e) { poolMap = new Map(); }
    const mapa = {}; ctx.modelos.forEach(m => { mapa[m.id] = m; });
    const filas = StockAgg.join({
      conteos: entradas.map(([id, cantidad]) => ({ id, cantidad })),
      poolMap,
      labelDeModelo: id => mapa[id]?.modelo || '',
    }).filter(f => !f.sinConteo);
    const nDif = filas.filter(f => f.dif !== 0).length;
    render(`
      <p style="font-size:12.5px; color:var(--fg-3); margin:0 0 8px;">
        ${filas.length} modelos contados · <b>${nDif === 0 ? 'todo cuadra' : `${nDif} con diferencia`}</b>.
        Dif = pool − conteo: positiva, el pool tiene unidades que no viste (¿doble registro?);
        negativa, contaste unidades que faltan en el pool (captúralas con "Recibir · toma física").
        Al guardar, las diferencias quedan como trabajo en la bandeja Hoy.
      </p>
      <div style="max-height:46vh; overflow-y:auto;">
        <table class="app-table compact">
          <thead><tr><th>Modelo</th><th style="text-align:right;">Contado</th><th style="text-align:right;">Pool</th><th style="text-align:right;">Dif.</th></tr></thead>
          <tbody>${filas.map(f => `
            <tr>
              <td>${esc(f.label)}</td>
              <td style="text-align:right;">${f.conteo}</td>
              <td style="text-align:right;">${f.seriales}</td>
              <td style="text-align:right; font-weight:600; color:${f.dif === 0 ? '#15803d' : '#b91c1c'};">${f.dif > 0 ? '+' : ''}${f.dif}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`,
      `<button class="btn btn-ghost" onclick="AsistenteConteo._volverPaso1()">← Corregir</button>
       <button class="btn btn-primary" onclick="AsistenteConteo._guardar(this)">Guardar conteo</button>`);
  }

  function _volverPaso1() { paso1(); }

  async function _guardar(btn) {
    btn.disabled = true;
    try {
      const entries = Object.entries(ctx.cantidades).map(([modeloId, cantidad]) => ({ modeloId, cantidad }));
      await InventarioService.guardarInventario(entries);
      if (window.Toast) Toast.show(`Conteo guardado (${entries.length} modelos).`, 'ok');
      cerrar();
      if (typeof ctx.opts?.onDone === 'function') ctx.opts.onDone();
    } catch (e) {
      btn.disabled = false;
      if (window.Toast) Toast.show('No se pudo guardar: ' + (e.message || e), 'bad');
    }
  }

  // ── Overlay propio (mismo patrón que EquipoFicha) ───────────────────────
  function render(bodyHtml, footerHtml = '') {
    document.getElementById('asistenteConteoOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'asistenteConteoOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px; width:min(640px, 94vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;"><i data-lucide="clipboard-list"></i> Conteo físico de radios</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:14px 10px;">${bodyHtml}</div>
        <div class="footer" style="display:flex; justify-content:flex-end; gap:8px;">
          ${footerHtml}
          <button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="cerrar"]')) cerrar();
    });
    document.addEventListener('keydown', escHandler);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function escHandler(e) { if (e.key === 'Escape') cerrar(); }

  function cerrar() {
    document.getElementById('asistenteConteoOverlay')?.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', escHandler);
  }

  return { abrir, _setCantidad, _filtrar, _revisar, _volverPaso1, _guardar };
})();
