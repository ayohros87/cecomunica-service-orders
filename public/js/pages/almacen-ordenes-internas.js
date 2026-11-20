/* =============================================================
   Almacén · Hoy — Órdenes internas con radios (maquillaje).
   (Solangel, 2026-11-20.)

   Las órdenes de C COMUNICA (maquillaje, revisión general, radios para
   stock) no se entregan: los radios vuelven a bodega. Mientras la orden
   sigue abierta, el inventario los tiene "en taller" y bodega no los puede
   asignar ni sacar a una visita — el Sr. Solís los liberaba uno por uno
   desde la ficha. Aquí ve esas órdenes y las devuelve a bodega de un golpe
   (la misma hoja que usan recepción y la jefa de taller desde la bandeja
   de órdenes, que bodega no ve).

   Pinta en #hoyInternas, debajo de "Radios con técnicos"; carga por su
   cuenta y, si falla, falla solo este bloque. Cuatro consultas de igualdad
   (cliente interno × estado vivo): pocas filas, sin índice compuesto.
   ============================================================= */

window.AlmacenOrdenesInternas = (() => {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const $ = (id) => document.getElementById(id);
  const ctx = { rol: '', ordenes: [] };
  const ms = (t) => t?.toMillis?.() ?? (t?.seconds ? t.seconds * 1000 : 0);
  const radiosDe = (o) => (o.equipos || []).filter(e => e && !e.eliminado && (e.numero_de_serie || e.serial));
  const opera = () => !!window.OrdenInterna && OrdenInterna.ROLES_OK.includes(ctx.rol);

  async function cargar() {
    const el = $('hoyInternas');
    if (!el || !window.OrdenInterna) return;
    try {
      const col = firebase.firestore().collection('ordenes_de_servicio');
      const cid = OrdenInterna.clienteInternoId();
      const snaps = await Promise.all(OrdenInterna.VIVOS.map(e =>
        col.where('cliente_id', '==', cid).where('estado_reparacion', '==', e).get()));
      ctx.ordenes = snaps.flatMap(q => q.docs.map(d => ({ ordenId: d.id, ...d.data() })))
        .filter(o => o.eliminado !== true && OrdenInterna.tipoAdmite(o) && radiosDe(o).length)
        .sort((a, b) => String(a.ordenId).localeCompare(String(b.ordenId)));
      render();
    } catch (e) {
      console.warn('[Hoy] órdenes internas:', e?.code || e);
      el.innerHTML = '';
    }
  }

  function render() {
    const el = $('hoyInternas');
    if (!el) return;
    // Sin órdenes internas abiertas no hay nada que decir: el bloque no ocupa.
    if (!ctx.ordenes.length) { el.innerHTML = ''; return; }
    const filas = ctx.ordenes.map(o => {
      const rs = radiosDe(o);
      const lista = rs.slice(0, 12).map(e => `<b style="font-family:var(--mono,monospace);">${esc(e.numero_de_serie || e.serial)}</b>`).join(' · ')
        + (rs.length > 12 ? ` · y ${rs.length - 12} más` : '');
      const lista2 = `<span style="display:block;white-space:normal;line-height:1.5;color:var(--fg-2,#374151);font-size:12.5px;">${lista}</span>`;
      const completada = String(o.estado_reparacion || '').toUpperCase().startsWith('COMPLETADO');
      return Bandeja.fila({
        chip: completada ? `Lista · ${rs.length} radio${rs.length === 1 ? '' : 's'}` : `En curso · ${rs.length}`,
        tono: completada ? 'listo' : 'info', at: ms(o.fecha_completado || o.fecha_creacion) || null,
        txt: `Orden <b>${esc(o.ordenId)}</b> · ${esc(o.tipo_de_servicio || '')}${o.observaciones ? ` · ${esc(String(o.observaciones).slice(0, 70))}` : ''}${lista2}`,
        ctaHtml: opera() ? Bandeja.cta({ label: 'Devolver a bodega', icono: 'warehouse', ghost: !completada, data: { 'interna-devolver': o.ordenId } }) : '',
      });
    }).join('');
    el.innerHTML = `<div class="bj-grupo">
      <h3 class="bj-grupo-t" style="display:flex;align-items:center;gap:8px;">Órdenes internas con radios <span class="bj-n">${ctx.ordenes.length}</span></h3>
      <p style="margin:0 0 8px;font-size:13px;color:var(--fg-3);">Maquillaje y revisiones de C COMUNICA. Mientras la orden siga abierta sus radios figuran en taller;
        <b>Devolver a bodega</b> la cierra y los deja disponibles de una vez (para asignarlos o sacarlos a una visita).</p>
      ${filas}
    </div>`;
    if (window.lucide) lucide.createIcons();
  }

  function init(rol) {
    ctx.rol = rol;
    const el = $('hoyInternas');
    if (!el) return;
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-interna-devolver]');
      if (!b || !opera() || typeof window.abrirDevolverBodega !== 'function') return;
      ev.preventDefault();
      const id = b.dataset.internaDevolver;
      const orden = ctx.ordenes.find(o => o.ordenId === id) || null;
      // El trigger mueve el inventario justo después del cierre: se recarga
      // este bloque ya, y la bandeja completa un momento después.
      window.abrirDevolverBodega(id, { orden, rol: ctx.rol, alTerminar: () => {
        ctx.ordenes = ctx.ordenes.filter(o => o.ordenId !== id);
        render();
        setTimeout(() => { if (window.AlmacenSalidasVisita) AlmacenSalidasVisita.cargar(); }, 2500);
      } });
    });
    cargar();
  }

  return { init, cargar };
})();
