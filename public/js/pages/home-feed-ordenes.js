/* =============================================================
   HomeFeedOrdenes — panel "Órdenes por crear" del home.

   Bandeja de órdenes de PROGRAMACIÓN que ya se pueden crear:
   contratos con seriales listos sin orden vinculada, y ventas
   directas del pool sin orden amarrada. Cada fila lleva a
   nueva-orden PRECARGADA (mismos deep-links que los CTA de la
   lista de contratos y del registro de venta) — crear la orden
   sigue siendo decisión humana.

   Visibilidad: SOLO recepción y administrador (rol efectivo,
   respeta "Ver como"). Es un límite visual — las lecturas que
   usa las tiene cualquier usuario autenticado.

   No estorba: si no hay nada que crear no se muestra; con filas,
   es una tarjeta compacta colapsable (estado persistido por
   usuario en localStorage). Datos con cache sessionStorage TTL
   5 min, mismo patrón que HomeSignals.
   ============================================================= */

window.HomeFeedOrdenes = (() => {

  const ROLES_FEED = ['recepcion', 'administrador'];
  const TTL_MS = 5 * 60 * 1000;
  const CACHE_KEY = (uid) => `ccHomeFeedOrdenes:v1:${uid}`;
  const COLLAPSE_KEY = (uid) => `ccHomeFeedOrdenesCollapsed:v1:${uid}`;
  const MAX_FILAS = 5;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  function hace(ts) {
    if (!ts) return '';
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 60) return 'hace un momento';
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'hace 1 día' : `hace ${d} días`;
  }

  function _readCache(uid) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY(uid));
      if (!raw) return null;
      const data = JSON.parse(raw);
      return (Date.now() - data.t > TTL_MS) ? null : data.feed;
    } catch { return null; }
  }

  function _writeCache(uid, feed) {
    try { sessionStorage.setItem(CACHE_KEY(uid), JSON.stringify({ t: Date.now(), feed })); }
    catch { /* storage lleno/bloqueado: sin cache */ }
  }

  function _rowContrato(c) {
    const url = `ordenes/nueva-orden.html?cliente_id=${encodeURIComponent(c.cliente_id)}&contrato_doc_id=${encodeURIComponent(c.doc_id)}&tipo=PROGRAMACION`;
    return `
<div class="fo-row">
  <span class="fo-ico fo-ico--contrato"><i data-lucide="file-text"></i></span>
  <div class="fo-main">
    <div class="fo-t">${esc(c.cliente_nombre)}</div>
    <div class="fo-s">${esc(c.contrato_id)} · ${c.equipos} equipo(s), seriales listos · contrato ${esc(c.estado)}${c.at ? ` · ${hace(c.at)}` : ''}</div>
  </div>
  <a class="fo-btn" href="${url}" title="Crear la orden de programación (formulario precargado)"><i data-lucide="calendar-plus"></i> Crear orden</a>
</div>`;
  }

  function _rowVenta(v) {
    const meta = `${v.seriales.length} equipo(s) vendidos${v.factura ? ` · factura QBO ${esc(v.factura)}` : ''}${v.at ? ` · ${hace(v.at)}` : ''}`;
    // Venta por excepción: sin cliente_id no hay prefill posible — el paso
    // previo es crear la ficha del cliente.
    const accion = (v.excepcion || !v.cliente_id)
      ? `<span class="fo-nota" title="La venta se registró a un comprador sin ficha en la app; crea el cliente para poder precargar la orden">cliente sin ficha</span>`
      : `<a class="fo-btn" href="ordenes/nueva-orden.html?${new URLSearchParams({
          tipo: 'PROGRAMACION', origen: 'venta',
          cliente_id: v.cliente_id,
          seriales: v.seriales.join(','),
          ...(v.factura ? { factura: v.factura } : {}),
        }).toString()}" title="Crear la orden de programación (formulario precargado)"><i data-lucide="calendar-plus"></i> Crear orden</a>`;
    return `
<div class="fo-row">
  <span class="fo-ico fo-ico--venta"><i data-lucide="banknote"></i></span>
  <div class="fo-main">
    <div class="fo-t">${esc(v.cliente_nombre)}</div>
    <div class="fo-s">${meta}</div>
  </div>
  ${accion}
</div>`;
  }

  function _pintar(mount, uid, feed) {
    const filas = [
      ...feed.ventas.map(v => ({ at: v.at, html: _rowVenta(v) })),
      ...feed.contratos.map(c => ({ at: c.at, html: _rowContrato(c) })),
    ].sort((a, b) => b.at - a.at);

    if (!filas.length) { mount.style.display = 'none'; return; }

    const visibles = filas.slice(0, MAX_FILAS);
    const resto = filas.length - visibles.length;
    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY(uid)) === '1'; } catch {}

    mount.innerHTML = `
<div class="fo-card${collapsed ? ' is-collapsed' : ''}">
  <button class="fo-head" type="button" aria-expanded="${!collapsed}" title="Mostrar / ocultar">
    <i data-lucide="clipboard-plus" class="fo-head__ico"></i>
    <span class="fo-head__t">Órdenes por crear</span>
    <span class="fo-count">${filas.length}</span>
    <span class="fo-head__hint">contratos listos y ventas sin orden</span>
    <i data-lucide="chevron-down" class="fo-chev"></i>
  </button>
  <div class="fo-body">
    ${visibles.map(f => f.html).join('')}
    ${resto > 0 ? `<div class="fo-foot">+${resto} más — <a href="contratos/index.html">ver contratos</a> · <a href="inventario/equipos.html?tab=otros">ver ventas en el pool</a></div>` : ''}
  </div>
</div>`;
    mount.style.display = '';

    mount.querySelector('.fo-head').addEventListener('click', () => {
      const card = mount.querySelector('.fo-card');
      const ahora = card.classList.toggle('is-collapsed');
      mount.querySelector('.fo-head').setAttribute('aria-expanded', String(!ahora));
      try { localStorage.setItem(COLLAPSE_KEY(uid), ahora ? '1' : '0'); } catch {}
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  /**
   * @param {Object} opts
   * @param {string} opts.rolEfectivo  rol tras "Ver como" (gating visual)
   * @param {string} opts.uid          uid real (queries corren como el usuario real)
   * @param {string} [opts.mountId]    contenedor; default 'feedOrdenes'
   */
  async function render({ rolEfectivo, uid, mountId = 'feedOrdenes' }) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    if (!ROLES_FEED.includes(rolEfectivo)) { mount.style.display = 'none'; return; }

    const cached = _readCache(uid);
    if (cached) { _pintar(mount, uid, cached); return; }

    try {
      const feed = await FeedOrdenesService.ordenesPorCrear();
      _writeCache(uid, feed);
      _pintar(mount, uid, feed);
    } catch (e) {
      // El home nunca se rompe por el feed.
      console.warn('[HomeFeedOrdenes] no disponible:', e?.code || e);
      mount.style.display = 'none';
    }
  }

  return { render };
})();
