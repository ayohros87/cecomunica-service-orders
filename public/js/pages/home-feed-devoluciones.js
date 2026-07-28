/* =============================================================
   HomeFeedDevoluciones — panel "Contratos por cancelar" del home.

   Contratos que siguen VIGENTES aunque su equipo ya volvió: al
   cerrar una orden de ENTRADA con contrato ligado, el trigger
   onOrdenWritePool estampa `cancelacion_pendiente` en el contrato.
   Esta bandeja los muestra hasta que alguien los cancela o anula
   — al cambiar de estado dejan de ser vigentes y salen solos, sin
   necesidad de marcarlos como resueltos.

   Por qué existe: de 460 ENTRADAs históricas solo 3 llevaban
   contrato, así que la devolución nunca se amarraba y la
   cancelación quedaba en el aire (8 contratos vigentes sin equipo
   detectados el 2026-07-28). Cancelar sigue siendo decisión
   humana: una ENTRADA también puede ser reparación o reemplazo.

   Visibilidad: administrador y gerente — los que pueden anular un
   contrato ('anular-contrato' en core/roles.js). Es un límite
   visual; las lecturas las tiene cualquier autenticado.
   ============================================================= */

window.HomeFeedDevoluciones = (() => {

  const ROLES_FEED = ['administrador', 'gerente'];
  const VIGENTES = ['aprobado', 'activo'];
  const TTL_MS = 5 * 60 * 1000;
  const CACHE_KEY = (uid) => `ccHomeFeedDevol:v1:${uid}`;
  const COLLAPSE_KEY = (uid) => `ccHomeFeedDevolCollapsed:v1:${uid}`;
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
      return (Date.now() - data.t > TTL_MS) ? null : data.filas;
    } catch { return null; }
  }

  function _writeCache(uid, filas) {
    try { sessionStorage.setItem(CACHE_KEY(uid), JSON.stringify({ t: Date.now(), filas })); }
    catch { /* storage lleno/bloqueado: sin cache */ }
  }

  async function _cargar() {
    const db = firebase.firestore();
    const snap = await db.collection('contratos').where('estado', 'in', VIGENTES).get();
    const filas = [];
    snap.forEach(d => {
      const v = d.data();
      if (v.deleted === true) return;
      const cp = v.cancelacion_pendiente;
      if (!cp || !cp.orden_entrada_id) return;
      const at = cp.at?.toMillis ? cp.at.toMillis() : 0;
      filas.push({
        doc_id: d.id,
        contrato_id: v.contrato_id || d.id,
        cliente_nombre: v.cliente_nombre || cp.cliente_nombre || '',
        estado: v.estado || '',
        orden: cp.orden_numero || cp.orden_entrada_id,
        n: Array.isArray(cp.seriales) ? cp.seriales.length : 0,
        // Por qué está en la bandeja. Sin el campo (marcas viejas) se infiere:
        // si hay orden de entrada fue una devolución, si no, un conteo.
        motivo: cp.motivo || (cp.orden_entrada_id ? 'entrada' : 'conteo_bodega'),
        dias: cp.dias_sin_cerrar || null,
        at,
      });
    });
    return filas.sort((a, b) => b.at - a.at);
  }

  // Cada motivo cuenta una historia distinta; un texto único mentiría en dos
  // de los tres casos (p.ej. "0 equipos devueltos" para un temporal vencido).
  const MOTIVO_TXT = {
    entrada: (c) => `${c.n} equipo(s) devueltos en la entrada ${esc(c.orden)}`,
    conteo_bodega: (c) => `${c.n} equipo(s) aparecieron en el conteo de bodega`,
    temporal_vencido: (c) => c.dias
      ? `temporal/demo de ${c.dias} días, sin equipo asignado ni devolución registrada`
      : 'temporal/demo vencido, sin equipo asignado ni devolución registrada',
  };

  function _row(c) {
    const detalle = (MOTIVO_TXT[c.motivo] || MOTIVO_TXT.conteo_bodega)(c);
    const meta = `${esc(c.contrato_id)} · ${detalle} · contrato ${esc(c.estado)}`
      + `${c.at ? ` · ${hace(c.at)}` : ''}`;
    return `
<div class="fo-row">
  <span class="fo-ico fo-ico--contrato"><i data-lucide="package-check"></i></span>
  <div class="fo-main">
    <div class="fo-t">${esc(c.cliente_nombre)}</div>
    <div class="fo-s">${meta}</div>
  </div>
  <a class="fo-btn" href="contratos/index.html?buscar=${encodeURIComponent(c.contrato_id)}"
     title="Abrir el contrato para cancelarlo o anularlo"><i data-lucide="file-x"></i> Ver contrato</a>
</div>`;
  }

  function _pintar(mount, uid, filas) {
    if (!filas.length) { mount.style.display = 'none'; return; }
    const visibles = filas.slice(0, MAX_FILAS);
    const resto = filas.length - visibles.length;
    let collapsed = false;
    try { collapsed = localStorage.getItem(COLLAPSE_KEY(uid)) === '1'; } catch {}

    mount.innerHTML = `
<div class="fo-card${collapsed ? ' is-collapsed' : ''}">
  <button class="fo-head" type="button" aria-expanded="${!collapsed}" title="Mostrar / ocultar">
    <i data-lucide="file-x" class="fo-head__ico"></i>
    <span class="fo-head__t">Contratos por cancelar</span>
    <span class="fo-count">${filas.length}</span>
    <span class="fo-head__hint">el equipo ya volvió, el contrato sigue vigente</span>
    <i data-lucide="chevron-down" class="fo-chev"></i>
  </button>
  <div class="fo-body">
    ${visibles.map(_row).join('')}
    ${resto > 0 ? `<div class="fo-foot">+${resto} más — <a href="contratos/index.html">ver contratos</a></div>` : ''}
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
   * @param {string} opts.uid          uid real
   * @param {string} [opts.mountId]    contenedor; default 'feedDevoluciones'
   */
  async function render({ rolEfectivo, uid, mountId = 'feedDevoluciones' }) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    if (!ROLES_FEED.includes(rolEfectivo)) { mount.style.display = 'none'; return; }

    const cached = _readCache(uid);
    if (cached) { _pintar(mount, uid, cached); return; }

    try {
      const filas = await _cargar();
      _writeCache(uid, filas);
      _pintar(mount, uid, filas);
    } catch (e) {
      // El home nunca se rompe por el feed.
      console.warn('[HomeFeedDevoluciones] no disponible:', e?.code || e);
      mount.style.display = 'none';
    }
  }

  return { render };
})();
