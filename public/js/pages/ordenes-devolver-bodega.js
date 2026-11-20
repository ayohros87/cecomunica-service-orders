// @ts-nocheck
/* =============================================================
   Devolver a bodega una orden INTERNA (Solangel, 2026-11-20).

   Las órdenes de C COMUNICA (maquillaje, revisión general, radios para
   stock) no se entregan a nadie: los radios vuelven a bodega y de ahí salen
   a un cliente o a una visita. No tenían cierre — quedaban en "Completado"
   con el botón "Entregar" y el Sr. Solís liberaba cada radio a mano desde su
   ficha. Esta hoja cierra la orden (CERRADA (A BODEGA)) y el inventario pasa
   a bodega, de un golpe, lo que siga en ella.

   La usan recepción, jefa de taller y administración desde la bandeja de
   órdenes, y bodega desde Almacén · Hoy (no ve la bandeja de órdenes). Todo
   pasa por el callable devolverOrdenABodega, que es quien valida.

   Sin dependencias de la página: recibe la orden o la lee. Expone
   window.abrirDevolverBodega(ordenId, { orden, alTerminar }).
   ============================================================= */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  // Los predicados viven en domain/ordenInterna.js (la bandeja los necesita
  // al pintar, antes de que esta hoja se cargue).
  const admite = (orden, rol) => !!window.OrdenInterna && OrdenInterna.admiteDevolverABodega(orden, rol);

  async function abrir(ordenId, { orden = null, rol = '', alTerminar = null } = {}) {
    const r = rol || window.APP?.state?.userRole || window.userRole || '';
    let o = orden || (window.APP?.state?.orders || []).find(x => x.ordenId === ordenId) || null;
    if (!o) {
      try {
        const s = await firebase.firestore().collection('ordenes_de_servicio').doc(ordenId).get();
        o = s.exists ? s.data() : null;
      } catch { /* cae al aviso de abajo */ }
    }
    if (!o) { Toast.show('Orden no encontrada', 'bad'); return; }
    if (!admite(o, r)) { Toast.show('Esta orden no se puede devolver a bodega (solo órdenes internas abiertas).', 'warn'); return; }

    const equipos = (o.equipos || []).filter(e => e && !e.eliminado && (e.numero_de_serie || e.serial));
    const lista = equipos.map(e => `<li style="font-family:var(--mono,monospace);font-size:12.5px;">${esc(e.numero_de_serie || e.serial)} <span style="color:var(--fg-3);font-family:inherit;">· ${esc(e.modelo || '')}</span></li>`).join('');
    const enCurso = sinTildes(o.estado_reparacion) !== 'COMPLETADO (EN OFICINA)';

    const res = await Modal.sheet({
      title: `Devolver a bodega · orden ${ordenId}`,
      icon: 'warehouse', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">
          Orden interna de <b>${esc(o.cliente_nombre || 'C COMUNICA')}</b>${o.observaciones ? ` — ${esc(String(o.observaciones).slice(0, 90))}` : ''}.
          Al devolverla, <b>la orden se cierra</b> y los radios que sigan en ella pasan a <b>bodega</b> en el inventario,
          disponibles para un cliente o una visita. No es una entrega: no se firma nada ni sale correo al cliente.
        </p>
        <p style="margin:0 0 6px;font-size:12.5px;color:var(--fg-3);">Los que ya salieron por otro lado (se entregaron, se vendieron, los lleva un técnico) no se tocan.</p>
        <ul style="margin:0 0 12px 18px;padding:0;max-height:140px;overflow:auto;">${lista || '<li style="color:var(--fg-3);">La orden no tiene radios con serial.</li>'}</ul>
        ${enCurso ? `<div style="margin:0 0 10px;padding:8px 12px;border:1px solid #FCD34D;background:#FFFBEB;color:#92400E;border-radius:6px;font-size:13px;">
          Ojo: la orden todavía no está completada (${esc(o.estado_reparacion || 'POR ASIGNAR')}). Devuélvela solo si el trabajo ya no se va a hacer aquí.</div>` : ''}
        <label class="form-label" for="dbMotivo">¿Por qué vuelven a bodega? *</label>
        <textarea id="dbMotivo" class="form-input" rows="2" placeholder="Ej.: ya maquillados; salen a la visita de Decameron del 20-nov"></textarea>
        <div id="dbAviso" role="alert" style="display:none;margin-top:10px;padding:8px 12px;border:1px solid #FCD34D;background:#FFFBEB;color:#92400E;border-radius:6px;font-size:13px;"></div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'devolver', label: 'Devolver a bodega', primary: true, icon: 'warehouse' },
      ],
      onAction: async (a, root) => {
        if (a !== 'devolver') return null;
        const avisoEl = root.querySelector('#dbAviso');
        const avisar = (m) => { avisoEl.textContent = m; avisoEl.style.display = ''; return false; };
        const motivo = (root.querySelector('#dbMotivo').value || '').trim();
        if (motivo.length < 10) return avisar('Di en una frase por qué vuelven a bodega (mínimo 10 caracteres).');
        const botones = root.querySelectorAll('button');
        botones.forEach(b => { b.disabled = true; });
        try {
          const out = await firebase.functions().httpsCallable('devolverOrdenABodega')({ ordenId, motivo });
          return out.data;
        } catch (err) {
          console.error('[devolver-bodega]', err);
          botones.forEach(b => { b.disabled = false; });
          return avisar(err?.message || 'No se pudo devolver la orden a bodega.');
        }
      },
    });
    if (!res || res === 'cerrar' || typeof res !== 'object') return;
    const n = (res.vuelven || []).length;
    Toast.show(`Orden ${ordenId} cerrada · ${n} radio${n === 1 ? '' : 's'} a bodega`, 'ok');
    const yaNo = res.ya_no_estaban || [];
    if (yaNo.length) {
      await Modal.alert({
        title: 'Radios que ya no estaban en la orden', icon: 'alert-triangle',
        message: 'La orden quedó cerrada. Estos radios habían salido antes y no se tocaron en el inventario:<br>'
          + yaNo.map(u => `<b style="font-family:var(--mono,monospace);">${esc(u.serial)}</b> · ${esc(u.donde || '')}`).join('<br>'),
      });
    }
    if (typeof alTerminar === 'function') alTerminar(res);
  }

  window.abrirDevolverBodega = abrir;
})();
