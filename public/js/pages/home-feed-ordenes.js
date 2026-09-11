/* =============================================================
   HomeFeedOrdenes — panel "Órdenes por crear" del home.

   Bandeja de órdenes de PROGRAMACIÓN que ya se pueden crear:
   contratos con seriales listos sin orden vinculada, y ventas
   directas del pool sin orden amarrada. Cada fila lleva a
   nueva-orden PRECARGADA (mismos deep-links que los CTA de la
   lista de contratos y del registro de venta) — crear la orden
   sigue siendo decisión humana.

   DESCARTAR (2026-08-11): cuando la orden no se va a crear, la
   fila se descarta con un motivo y sale de la bandeja. Sin esto
   los casos que nunca iban a convertirse en orden se acumulaban
   y la bandeja dejaba de significar "esto hay que hacerlo". El
   descarte queda escrito en el contrato / en las unidades de la
   venta (quién, cuándo, por qué), se puede revertir desde el pie
   de la tarjeta, y el de contrato CADUCA si cambian los equipos.

   Visibilidad: SOLO recepción y administrador (rol efectivo,
   respeta "Ver como"). Es un límite visual — las lecturas que
   usa las tiene cualquier usuario autenticado; el descarte lo
   cierran las reglas.

   Integrada en HomeSignals: el contador usa el mismo feed que el panel.
   Con cero se conserva como acceso compacto, incluso para consultar los
   descartes. Datos con cache sessionStorage TTL 5 min.
   ============================================================= */

window.HomeFeedOrdenes = (() => {

  const ROLES_FEED = ['recepcion', 'administrador'];
  const TTL_MS = 5 * 60 * 1000;
  // v2: las filas ahora traen `ids`/`descartada` — un cache v1 rompería el
  // pintado, así que la versión de la clave lo invalida solo.
  const CACHE_KEY = (uid) => `ccHomeFeedOrdenes:v2:${uid}`;
  const MAX_FILAS = 5;

  // Estado vivo del panel: el feed cargado, el usuario que escribe y el mount.
  // El descarte re-pinta desde aquí (sin releer Firestore) y refresca el cache.
  let _st = { mount: null, uid: '', user: null, feed: null, verDescartadas: false };
  const _cargas = new Map();
  let _renderToken = 0;

  // Filas, esqueleto y antigüedad: kit de bandeja (js/ui/bandeja.js,
  // 2026-09-08). Semáforo de SEÑAL (10/30 días).
  const esc = (v) => Bandeja.esc(v);

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

  async function _cargar(uid) {
    const cached = _readCache(uid);
    if (cached) return cached;
    if (!_cargas.has(uid)) {
      _cargas.set(uid, FeedOrdenesService.ordenesPorCrear().then(feed => {
        _writeCache(uid, feed);
        return feed;
      }).finally(() => _cargas.delete(uid)));
    }
    return _cargas.get(uid);
  }

  async function contar({ rolEfectivo, uid }) {
    if (!ROLES_FEED.includes(rolEfectivo)) throw new Error('Cola no disponible para este rol');
    const feed = await _cargar(uid);
    return _filas(feed).filter(f => !f.descartada).length;
  }

  // Clave estable de una fila — la usa el DOM para saber a quién descartar.
  const claveContrato = (c) => `c:${c.doc_id}`;
  const claveVenta    = (v) => `v:${v.ids.join(',')}`;

  function _rowContrato(c) {
    const url = `ordenes/nueva-orden.html?cliente_id=${encodeURIComponent(c.cliente_id)}&contrato_doc_id=${encodeURIComponent(c.doc_id)}&tipo=PROGRAMACION`;
    return Bandeja.fila({
      chip: 'Contrato', tono: 'info', clase: 'senal', at: c.at || null,
      data: { key: claveContrato(c) },
      txt: `<b>${esc(c.cliente_nombre)}</b> · ${esc(c.contrato_id)} · ${c.equipos} equipo(s), seriales listos · contrato ${esc(c.estado)}`,
      ctaHtml: Bandeja.cta({ href: url, label: 'Crear orden', icono: 'calendar-plus', plano: true, title: 'Crear la orden de programación (formulario precargado)' }) + _btnDescartar(),
    });
  }

  function _rowVenta(v) {
    const meta = `${v.seriales.length} equipo(s) vendidos${v.factura ? ` · factura QBO ${esc(v.factura)}` : ''}`;
    // Venta por excepción: sin cliente_id no hay prefill posible — el paso
    // previo es crear la ficha del cliente.
    const accion = (v.excepcion || !v.cliente_id)
      ? `<span class="fo-nota" title="La venta se registró a un comprador sin ficha en la app; crea el cliente para poder precargar la orden">cliente sin ficha</span>`
      : Bandeja.cta({ href: `ordenes/nueva-orden.html?${new URLSearchParams({
          tipo: 'PROGRAMACION', origen: 'venta',
          cliente_id: v.cliente_id,
          seriales: v.seriales.join(','),
          ...(v.factura ? { factura: v.factura } : {}),
        }).toString()}`, label: 'Crear orden', icono: 'calendar-plus', plano: true, title: 'Crear la orden de programación (formulario precargado)' });
    return Bandeja.fila({
      chip: 'Venta', tono: 'listo', clase: 'senal', at: v.at || null,
      data: { key: claveVenta(v) },
      txt: `<b>${esc(v.cliente_nombre)}</b> · ${meta}`,
      ctaHtml: accion + _btnDescartar(),
    });
  }

  // Acción secundaria, deliberadamente discreta: descartar no es lo normal.
  function _btnDescartar() {
    return `<button class="fo-x" type="button" data-act="descartar"
      title="Esta orden no se va a crear: quitarla de la bandeja"
      aria-label="Descartar"><i data-lucide="x"></i></button>`;
  }

  // Formulario de descarte, inline en la fila. El motivo es obligatorio: un
  // descarte sin razón deja a la siguiente persona sin saber qué pasó.
  function _formDescarte(key) {
    const opts = OrdenProgPendiente.MOTIVOS
      .map(m => `<option value="${esc(m.codigo)}">${esc(m.label)}</option>`).join('');
    return `
<div class="fo-descarte" data-key="${esc(key)}">
  <div class="fo-descarte__t">¿Por qué no se va a crear esta orden?</div>
  <div class="fo-descarte__row">
    <select class="cc-input fo-descarte__sel" data-f="motivo">
      <option value="">Selecciona el motivo…</option>
      ${opts}
    </select>
    <input class="cc-input fo-descarte__nota" data-f="nota" type="text" maxlength="140"
           placeholder="Nota (opcional; obligatoria si es 'Otro')">
    <button class="fo-btn fo-btn--danger" type="button" data-act="confirmar">Descartar</button>
    <button class="fo-btn fo-btn--ghost" type="button" data-act="cancelar">Cancelar</button>
  </div>
  <div class="fo-descarte__err" data-f="err"></div>
</div>`;
  }

  function _rowDescartada(f) {
    const quien = f.descarte?.por_email ? ` · ${esc(f.descarte.por_email)}` : '';
    const nota  = f.descarte?.nota ? ` — ${esc(f.descarte.nota)}` : '';
    // Fila apagada (off) con la reversa a la mano. Conserva .fo-row--off
    // para el fondo gris del descarte.
    return Bandeja.fila({
      chip: 'Descartada', tono: 'neutro', off: true,
      data: { key: f.key },
      txt: `<b>${esc(f.titulo)}</b> · ${esc(OrdenProgPendiente.motivoLabel(f.descarte?.motivo))}${nota}${quien}`,
      ctaHtml: `<button class="fo-btn fo-btn--ghost" type="button" data-act="reactivar"
        title="Devolver esta orden a la bandeja"><i data-lucide="undo-2"></i> Reactivar</button>`,
    }).replace('class="bj-row is-off"', 'class="bj-row is-off fo-row--off"');
  }

  // El feed (dos fuentes) se aplana a filas con clave, título y orden.
  function _filas(feed) {
    return [
      ...feed.ventas.map(v => ({
        key: claveVenta(v), at: v.at, descartada: !!v.descartada, descarte: v.descarte,
        titulo: `${v.cliente_nombre}${v.factura ? ` · factura ${v.factura}` : ''}`,
        html: () => _rowVenta(v),
      })),
      ...feed.contratos.map(c => ({
        key: claveContrato(c), at: c.at, descartada: !!c.descartada, descarte: c.descarte,
        titulo: `${c.cliente_nombre} · ${c.contrato_id}`,
        html: () => _rowContrato(c),
      })),
    ].sort((a, b) => b.at - a.at);
  }

  function _buscar(key) {
    const feed = _st.feed || { contratos: [], ventas: [] };
    const c = feed.contratos.find(x => claveContrato(x) === key);
    if (c) return { tipo: 'contrato', item: c };
    const v = feed.ventas.find(x => claveVenta(x) === key);
    return v ? { tipo: 'venta', item: v } : null;
  }

  function _pintar() {
    const { mount, feed } = _st;
    const todas = _filas(feed);
    const activas = todas.filter(f => !f.descartada);
    const descartadas = todas.filter(f => f.descartada);

    _st.onCount?.(activas.length);
    if (!mount?.isConnected || mount.dataset.signalPanel !== 'OPC') return;

    const visibles = activas.slice(0, MAX_FILAS);
    const resto = activas.length - visibles.length;

    const pieLinks = resto > 0
      ? `+${resto} más — <a href="contratos/index.html">ver contratos</a> · <a href="inventario/equipos.html?tab=otros">ver ventas en el pool</a>`
      : '';
    const pieDesc = descartadas.length
      ? `<button class="fo-link" type="button" data-act="toggle-descartadas">${
          _st.verDescartadas ? 'Ocultar' : 'Ver'} ${descartadas.length} descartada(s)</button>`
      : '';

    mount.innerHTML = Bandeja.panelHead({ titulo: 'Órdenes por crear', n: activas.length, href: 'ordenes/index.html' }) + `
    ${visibles.map(f => f.html()).join('')}
    ${activas.length ? '' : Bandeja.listaVacia('Nada por crear ahora mismo.')}
    ${_st.verDescartadas ? descartadas.map(_rowDescartada).join('') : ''}
    ${(pieLinks || pieDesc) ? `<div class="fo-foot">${pieLinks}${pieLinks && pieDesc ? ' · ' : ''}${pieDesc}</div>` : ''}
    `;
    // Delegación en el contenedor (sobrevive a los re-pintados) y una sola vez:
    // _pintar() se llama en cada descarte y los listeners se acumularían.
    if (!mount._foBound) { mount.addEventListener('click', _onClick); mount._foBound = true; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function _onClick(ev) {
    if (ev.currentTarget !== _st.mount || _st.mount.dataset.signalPanel !== 'OPC') return;
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');

    if (act === 'toggle-descartadas') { _st.verDescartadas = !_st.verDescartadas; _pintar(); return; }

    const cont = btn.closest('[data-key]');
    const key = cont && cont.getAttribute('data-key');
    if (!key) return;

    if (act === 'descartar')  return _abrirForm(cont, key);
    if (act === 'cancelar')   return _pintar();
    if (act === 'confirmar')  return _confirmar(cont, key, btn);
    if (act === 'reactivar')  return _reactivar(key, btn);
  }

  // La fila se reemplaza por el formulario: no hay diálogo modal en el home y
  // así el contexto (de qué fila hablamos) nunca se pierde.
  function _abrirForm(row, key) {
    // replaceWith y no outerHTML: la clave de la fila lleva ':' y ',' (no es un
    // selector válido sin escapar) y así se conserva la referencia al nodo.
    const tmp = document.createElement('div');
    tmp.innerHTML = _formDescarte(key);
    const form = tmp.firstElementChild;
    row.replaceWith(form);
    form.querySelector('[data-f="motivo"]').focus();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  async function _confirmar(form, key, btn) {
    const st = _st;
    const motivo = form.querySelector('[data-f="motivo"]').value;
    const nota   = form.querySelector('[data-f="nota"]').value.trim();
    const err    = form.querySelector('[data-f="err"]');
    if (!motivo) { err.textContent = 'Selecciona un motivo.'; return; }
    if (motivo === 'otro' && !nota) { err.textContent = 'Explica el motivo en la nota.'; return; }

    const hallado = _buscar(key);
    if (!hallado) { err.textContent = 'La fila ya no está disponible; recarga el home.'; return; }

    btn.disabled = true; btn.textContent = 'Descartando…'; err.textContent = '';
    try {
      const { tipo, item } = hallado;
      if (tipo === 'contrato') {
        await FeedOrdenesService.descartarContrato(item.doc_id, {
          motivo, nota,
          equipos_activos: item.equipos,
          seriales_resueltos: item.seriales_resueltos,
        }, st.user);
      } else {
        await FeedOrdenesService.descartarVenta(item.ids, { motivo, nota }, st.user);
      }
      // Estado local + cache: el descarte se ve al instante y no reaparece al
      // volver al home dentro del TTL.
      item.descartada = true;
      item.descarte = { motivo, nota, por_email: st.user?.email || '' };
      _writeCache(st.uid, st.feed);
      if (_st === st) _pintar();
    } catch (e) {
      console.warn('[HomeFeedOrdenes] descarte falló:', e?.code || e);
      btn.disabled = false; btn.textContent = 'Descartar';
      err.textContent = e?.code === 'permission-denied'
        ? 'Tu usuario no puede descartar órdenes.'
        : 'No se pudo descartar. Intenta de nuevo.';
    }
  }

  async function _reactivar(key, btn) {
    const st = _st;
    const hallado = _buscar(key);
    if (!hallado) return;
    btn.disabled = true;
    try {
      const { tipo, item } = hallado;
      if (tipo === 'contrato') await FeedOrdenesService.reactivarContrato(item.doc_id);
      else await FeedOrdenesService.reactivarVenta(item.ids, st.user);
      item.descartada = false;
      item.descarte = null;
      _writeCache(st.uid, st.feed);
      if (_st === st) _pintar();
    } catch (e) {
      console.warn('[HomeFeedOrdenes] reactivar falló:', e?.code || e);
      btn.disabled = false;
    }
  }

  // HomeSignals controla abrir/cerrar. Este módulo conserva las acciones del
  // feed y avisa al contador después de descartar/reactivar una fila.
  async function renderPanel(mount, { rolEfectivo, uid, user = null }, onCount) {
    if (!ROLES_FEED.includes(rolEfectivo)) return;
    const token = ++_renderToken;
    mount.innerHTML = Bandeja.esqueleto(2);
    try {
      const feed = await _cargar(uid);
      if (token !== _renderToken || !mount.isConnected || mount.dataset.signalPanel !== 'OPC') return;
      _st = { mount, uid, user: user || { uid }, feed, verDescartadas: false, onCount };
      _pintar();
    } catch (e) {
      console.warn('[HomeFeedOrdenes] no disponible:', e?.code || e);
      if (token === _renderToken && mount.isConnected && mount.dataset.signalPanel === 'OPC') {
        mount.innerHTML = Bandeja.listaVacia('No se pudo cargar. Cierra y abre la ficha para reintentar.');
      }
    }
  }

  return { contar, renderPanel };
})();
