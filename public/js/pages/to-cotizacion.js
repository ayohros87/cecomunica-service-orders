// @ts-nocheck
// Trabajar-Orden: cotización — resumen, completar, desbloquear, exportar
window.TOCotizacion = {

  async renderResumen() {
    const consItems = await OrdenesService.getConsumos(TO.ordenId, { tipo: 'cobro' });
    let subtotal = 0;
    consItems.forEach(line => {
      subtotal += Number(line.subtotal || (line.qty || 0) * (line.precio_unit || 0));
    });
    const itbms = +(subtotal * TO.itbmsPct).toFixed(2);
    const total = +(subtotal + itbms).toFixed(2);
    TO.byId('resumenTxt').innerHTML =
      `Subtotal: <strong>${TO.fmtMoney(subtotal)}</strong> · ` +
      `ITBMS ${(TO.itbmsPct * 100).toFixed(0)}%: <strong>${TO.fmtMoney(itbms)}</strong> · ` +
      `Total: <strong>${TO.fmtMoney(total)}</strong>`;
  },

  async completar() {
    try {
      if (TO.ordenData?.cotizacion_emitida === true) { alert('La cotización ya estaba completada.'); return; }
      if (!confirm('¿Deseas marcar la cotización como COMPLETADA? Esto bloqueará la edición.')) return;

      await OrdenesService.mergeOrder(TO.ordenId, {
        cotizacion_emitida:    true,
        cotizacion_emitida_en: firebase.firestore.FieldValue.serverTimestamp(),
        trabajo_estado:        'COMPLETADO',
        os_logs:               firebase.firestore.FieldValue.arrayUnion({
          action: 'COTIZACION_COMPLETADA',
          by:     TO.usuarioActual.email || TO.usuarioActual.uid,
          at_ms:  Date.now()
        }),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });

      try {
        const d = (await OrdenesService.getOrder(TO.ordenId)) || {};
        const vendedorUid = d.vendedor_asignado || '';
        let vendedorEmail = '';
        if (vendedorUid) {
          const uDoc = await UsuariosService.getUsuario(vendedorUid);
          vendedorEmail = uDoc ? (uDoc.email || '') : '';
        }
        const toList = ['atencionalcliente@cecomunica.com'].concat(vendedorEmail ? [vendedorEmail] : []);
        if (toList.length) {
          await MailService.enqueue({
            to:      toList.join(','),
            subject: `Cotización COMPLETADA – Orden ${TO.ordenId}`,
            text:    `La cotización de la orden ${TO.ordenId} fue marcada como COMPLETADA.`,
            html:    `<p>La cotización de la orden <strong>${TO.ordenId}</strong> fue marcada como <strong>COMPLETADA</strong>.</p>`,
          });
        }
      } catch (e) { console.warn('mail cotización', e); }

      TO.ordenData.cotizacion_emitida = true;
      document.body.classList.add('solo-lectura');

      const b1 = TO.byId('btnCompletarCot');
      if (b1) { b1.disabled = true; b1.textContent = '✅ Cotización completada'; }
      const b2 = TO.byId('btnDesbloquearCot');
      if (b2) b2.style.display = 'inline-block';
      TO.pintarChipTrabajo('COMPLETADO');

      alert('✅ Cotización completada. La orden quedó bloqueada para edición.');
    } catch (e) { console.error(e); alert('No se pudo completar la cotización.'); }
  },

  async desbloquear() {
    try {
      if (!confirm('¿Desbloquear la orden para continuar editando?')) return;
      await OrdenesService.mergeOrder(TO.ordenId, {
        cotizacion_emitida: false,
        trabajo_estado:     'EN_PROGRESO',
        os_logs:            firebase.firestore.FieldValue.arrayUnion({
          action: 'COTIZACION_DESBLOQUEADA',
          by:     TO.usuarioActual.email || TO.usuarioActual.uid,
          at_ms:  Date.now()
        }),
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });

      TO.ordenData.cotizacion_emitida = false;
      document.body.classList.remove('solo-lectura');

      const b1 = TO.byId('btnCompletarCot');
      if (b1) { b1.disabled = false; b1.textContent = '✅ Completar cotización'; }
      const b2 = TO.byId('btnDesbloquearCot');
      if (b2) b2.style.display = 'none';
      TO.pintarChipTrabajo('EN_PROGRESO');

      alert('🔓 Orden desbloqueada. Puedes seguir trabajando.');
    } catch (e) { console.error(e); alert('No se pudo desbloquear la orden.'); }
  },

  async exportar() {
    try {
      const od = await OrdenesService.getOrder(TO.ordenId);
      if (!od) return alert('Orden no encontrada');

      const rows        = await OrdenesService.getConsumos(TO.ordenId, { tipo: 'cobro' });
      const equiposList = Array.isArray(od.equipos) ? od.equipos.filter(e => !e.eliminado) : [];
      const eqMap       = {};
      equiposList.forEach(e => { const k = e.id || e.numero_de_serie || 'X'; eqMap[k] = e; });

      const data = rows.map(r => {
        const eq = eqMap[r.equipoId] || {};
        return {
          Orden:       TO.ordenId,
          EquipoId:    r.equipoId,
          Serie:       eq.numero_de_serie || r.equipoId || '',
          Modelo:      eq.modelo || '',
          Descripcion: r.pieza_nombre,
          SKU:         r.sku || '',
          Cantidad:    r.qty,
          PrecioUnit:  Number(r.precio_unit || 0),
          Subtotal:    Number(r.subtotal || (r.qty || 0) * (r.precio_unit || 0))
        };
      });

      if (typeof XLSX === 'undefined') {
        const csv  = this.toCSV(data);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `cotizacion_${TO.ordenId}.csv`;
        a.click();
        return;
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Cotizacion');
      XLSX.writeFile(wb, `cotizacion_${TO.ordenId}.xlsx`);
    } catch (e) { console.error(e); alert('No se pudo exportar.'); }
  },

  toCSV(arr) {
    if (!arr.length) return '';
    const headers = Object.keys(arr[0]);
    const lines   = [headers.join(',')];
    arr.forEach(o => lines.push(headers.map(h => JSON.stringify(o[h] ?? '')).join(',')));
    return lines.join('\n');
  }
};
