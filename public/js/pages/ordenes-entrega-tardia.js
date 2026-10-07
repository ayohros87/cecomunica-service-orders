// @ts-nocheck
/* =============================================================
   Entrega tardía (recepción, 2026-10-07).

   La orden quedó en COMPLETADO (EN OFICINA) pero el cliente se llevó los
   radios hace días o meses y nadie lo marcó (CEMENTO BAYANO 2026070104,
   CONCORD 2026080705: 15 radios "en taller" que el cliente tenía desde
   agosto, y el wizard de reemplazo trancó a Elvia). Hasta hoy la salida era
   un script. Aquí recepción registra la fecha real, quién recibió y una
   nota; OrdenesService.registrarEntregaTardia mueve el pool y cierra la
   orden con `correccion_terminal` (sin correo, fuera de los KPIs del día).

   Mismos candados que "Entregar" (QC, firma del contrato, anexo, factura):
   una entrega tardía sigue siendo una entrega.

   Diferido (CargaDiferida.entregaTardia). Expone window.abrirEntregaTardia.
   ============================================================= */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const hoyPanama = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });
  const fmtFecha = (ts) => {
    const ms = ts?.toMillis?.() ?? (ts?.seconds ? ts.seconds * 1000 : null);
    return ms ? new Date(ms).toLocaleDateString('es-PA', { timeZone: 'America/Panama' }) : '—';
  };

  async function abrirEntregaTardia(ordenId) {
    const rol = APP.state.userRole || '';
    if (rol !== ROLES.ADMIN && rol !== ROLES.RECEPCION) { Toast.show('Solo recepción o administración registran una entrega tardía.', 'warn'); return; }
    const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || await OrdenesService.getOrder(ordenId);
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    if ((orden.estado_reparacion || '') !== 'COMPLETADO (EN OFICINA)') { Toast.show('Solo una orden en COMPLETADO (EN OFICINA) admite una entrega tardía.', 'warn'); return; }
    // Los mismos candados que Entregar (expuesto por ordenes-flujo.js).
    if (typeof window.puedeEntregarOrden === 'function' && !(await window.puedeEntregarOrden(orden, ordenId))) return;

    const equipos = (typeof EntregaTandas !== 'undefined')
      ? EntregaTandas.equiposPendientes(orden)
      : (orden.equipos || []).filter(e => e && !e.eliminado);
    const lista = equipos.map(e => `<li style="font-family:var(--mono,monospace);font-size:12.5px;">${esc(e.numero_de_serie || e.serial || '(sin serial)')} <span style="color:var(--fg-3);font-family:inherit;">· ${esc(e.modelo || '')}</span></li>`).join('');

    const res = await Modal.sheet({
      title: `Registrar entrega tardía · orden ${ordenId}`,
      icon: 'calendar-check', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">
          <b>${esc(orden.cliente_nombre || orden.cliente || 'Cliente')}</b> · completada el ${esc(fmtFecha(orden.fecha_completado))}.
          El cliente ya se llevó estos radios y la orden se quedó "en oficina". Esto la cierra como <b>entregada en la fecha real</b>
          y pasa los radios al cliente en el inventario. No manda correo ni cuenta como entrega de hoy.
        </p>
        <ul style="margin:0 0 12px 18px;padding:0;max-height:120px;overflow:auto;">${lista || '<li style="color:var(--fg-3);">Sin equipos pendientes.</li>'}</ul>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label class="form-label" for="etFecha">¿Cuándo se entregó? *</label>
            <input type="date" id="etFecha" class="form-input" max="${hoyPanama()}" value="${hoyPanama()}">
          </div>
          <div>
            <label class="form-label" for="etReceptor">¿Quién recibió?</label>
            <input type="text" id="etReceptor" class="form-input" placeholder="Nombre (opcional)">
          </div>
        </div>
        <label class="form-label" for="etNotas" style="margin-top:10px;">¿Cómo se sabe? *</label>
        <textarea id="etNotas" class="form-input" rows="2" placeholder="Ej.: lo confirmó el vendedor con el cliente; el radio aparece en la Base PoC desde agosto"></textarea>
        <div id="etAviso" role="alert" style="display:none;margin-top:10px;padding:8px 12px;border:1px solid #FCD34D;background:#FFFBEB;color:#92400E;border-radius:6px;font-size:13px;"></div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'registrar', label: 'Registrar entrega', primary: true, icon: 'check' },
      ],
      onAction: async (a, root) => {
        if (a !== 'registrar') return null;
        const avisoEl = root.querySelector('#etAviso');
        const avisar = (m) => { avisoEl.textContent = m; avisoEl.style.display = ''; return false; };
        const f = root.querySelector('#etFecha').value;
        if (!f) return avisar('Indica la fecha real de la entrega.');
        // Mediodía de Panamá: la fecha que se escribió es la que se lee.
        const fecha = new Date(`${f}T12:00:00-05:00`);
        if (Number.isNaN(fecha.getTime()) || fecha.getTime() > Date.now() + 60_000) return avisar('La fecha no puede ser futura.');
        const notas = (root.querySelector('#etNotas').value || '').trim();
        if (notas.length < 10) return avisar('Di en una frase cómo se sabe que se entregó (mínimo 10 caracteres).');
        const receptor = (root.querySelector('#etReceptor').value || '').trim();
        const botones = root.querySelectorAll('button');
        botones.forEach(b => { b.disabled = true; });
        try {
          const r = await OrdenesService.registrarEntregaTardia(ordenId, { fecha, receptor, notas });
          return r;
        } catch (err) {
          console.error('[entrega-tardia]', err);
          botones.forEach(b => { b.disabled = false; });
          return avisar(err.message || 'No se pudo registrar la entrega.');
        }
      },
    });
    if (!res || res === 'cerrar' || typeof res !== 'object') return;
    const n = res.movidos.length;
    Toast.show(`✅ Orden ${ordenId} entregada · ${n} radio${n === 1 ? '' : 's'} pasaron al cliente`, 'ok');
    if (res.omitidos.length) {
      await Modal.alert({
        title: 'Radios que no se movieron', icon: 'alert-triangle',
        message: 'La orden quedó entregada, pero estos radios no se tocaron en el inventario:<br>'
          + res.omitidos.map(o => `<b style="font-family:var(--mono,monospace);">${esc(o.serial)}</b> · ${esc(o.motivo)}`).join('<br>')
          + '<br><br>Si alguno sí está con el cliente, bodega lo corrige desde la ficha del radio ("Corregir ubicación").',
      });
    }
    // El snapshot en vivo de la bandeja recoge el cambio: sin recarga manual.
  }

  window.abrirEntregaTardia = abrirEntregaTardia;
})();
