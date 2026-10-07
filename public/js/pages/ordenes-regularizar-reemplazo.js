// @ts-nocheck
/* =============================================================
   Registrar como reemplazo (a posteriori), 2026-10-07 — P4/E1.

   El taller cambió el radio del cliente en una orden de programación o
   reparación sin abrir la gestión de reemplazo (LIGO 23905A0437, CEMENTO
   BAYANO 22610A4066). Después nadie podía ligar saliente y entrante: el
   entrante quedaba "en bodega" estando con el cliente y el saliente seguía
   en el contrato. Hasta hoy la salida era un script.

   Aquí recepción, jefe de taller, bodega o administración eligen en la orden
   cuál radio salió y cuál entró, dicen si el saliente quedó en el taller, y
   el callable regularizarReemplazoOrden crea la gestión REEMP cerrada con
   esta orden como su programación y deja el pool como lo habría dejado la
   entrega normal. Si cambió la familia del modelo, queda aprobado con la
   tarifa "se mantiene" (como el caso LIGO).

   Diferido (CargaDiferida.regularizarReemplazo). Expone
   window.abrirRegularizarReemplazo(ordenId).
   ============================================================= */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const ROLES_OK = ['administrador', 'recepcion', 'jefe_taller', 'inventario', 'gerente'];

  async function abrirRegularizarReemplazo(ordenId) {
    const rol = APP.state.userRole || '';
    if (!ROLES_OK.includes(rol)) { Toast.show('Tu rol no registra reemplazos a posteriori.', 'warn'); return; }
    const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || await OrdenesService.getOrder(ordenId);
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    if (orden.gestion?.id) { Toast.show(`Esta orden ya pertenece a la gestión ${orden.gestion.id}: el reemplazo se registra allá.`, 'warn'); return; }
    if (!orden.cliente_id) { Toast.show('La orden no tiene cliente registrado.', 'warn'); return; }
    const equipos = (orden.equipos || []).filter(e => e && !e.eliminado && (e.numero_de_serie || e.serial));
    if (equipos.length < 2) { Toast.show('Hacen falta al menos dos radios en la orden (el que salió y el que entró).', 'warn'); return; }
    const qc = orden.qc?.por_equipo || {};
    const descartado = (e) => Object.values(qc).some(q => q && q.resultado === 'descartado' && (q.equipo_id === e.id || (q.serial && q.serial === (e.numero_de_serie || e.serial))));
    const op = (e, sel) => `<option value="${esc(e.numero_de_serie || e.serial)}" ${sel ? 'selected' : ''}>${esc(e.numero_de_serie || e.serial)} · ${esc(e.modelo || '')}${descartado(e) ? ' · descartado en QC' : ''}</option>`;
    const primerDesc = equipos.find(descartado);
    const salDefault = primerDesc || equipos[0];
    const entDefault = equipos.find(e => e !== salDefault);

    const res = await Modal.sheet({
      title: `Registrar como reemplazo · orden ${ordenId}`, icon: 'replace', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">
          <b>${esc(orden.cliente_nombre || orden.cliente || 'Cliente')}</b>. En esta orden un radio del cliente salió y otro entró en su lugar sin gestión de reemplazo.
          Se crea la gestión <b>REEMP</b> ya cerrada con esta orden como su programación; el entrante queda con el cliente (en el contrato del saliente, si lo tenía) y el saliente sale del contrato.
          No manda correos ni abre órdenes nuevas.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label class="form-label" for="rrSal">Radio que SALIÓ (del cliente)</label>
            <select id="rrSal" class="form-input">${equipos.map(e => op(e, e === salDefault)).join('')}</select>
          </div>
          <div>
            <label class="form-label" for="rrEnt">Radio que ENTRÓ en su lugar</label>
            <select id="rrEnt" class="form-input">${equipos.map(e => op(e, e === entDefault)).join('')}</select>
          </div>
        </div>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;">
          <input type="checkbox" id="rrEnCasa" checked style="margin-top:3px;">
          <span>El radio saliente <b>quedó en CECOMUNICA</b> (taller/bodega). Si el cliente se lo quedó, desmárcalo: queda pendiente de devolución.</span>
        </label>
        <label class="form-label" for="rrMotivo" style="margin-top:10px;">¿Qué pasó? *</label>
        <textarea id="rrMotivo" class="form-input" rows="2" placeholder="Ej.: el radio falló en la programación (humedad) y se entregó otro; la orden quedó sin gestión"></textarea>
        <div id="rrAviso" role="alert" style="display:none;margin-top:10px;padding:8px 12px;border:1px solid #FCD34D;background:#FFFBEB;color:#92400E;border-radius:6px;font-size:13px;"></div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'registrar', label: 'Registrar reemplazo', primary: true, icon: 'check' },
      ],
      onAction: async (a, root) => {
        if (a !== 'registrar') return null;
        const avisoEl = root.querySelector('#rrAviso');
        const avisar = (m) => { avisoEl.textContent = m; avisoEl.style.display = ''; return false; };
        const sal = root.querySelector('#rrSal').value; const ent = root.querySelector('#rrEnt').value;
        if (!sal || !ent) return avisar('Elige los dos radios.');
        if (sal === ent) return avisar('El saliente y el entrante no pueden ser el mismo radio.');
        const motivo = (root.querySelector('#rrMotivo').value || '').trim();
        if (motivo.length < 10) return avisar('Di en una frase qué pasó (mínimo 10 caracteres).');
        const salienteEnCasa = !!root.querySelector('#rrEnCasa').checked;
        const botones = root.querySelectorAll('button'); botones.forEach(b => { b.disabled = true; });
        try {
          const r = await firebase.functions().httpsCallable('regularizarReemplazoOrden')({ ordenId, serialSaliente: sal, serialEntrante: ent, salienteEnCasa, motivo });
          return r.data || { ok: true };
        } catch (err) {
          console.error('[regularizar-reemplazo]', err);
          botones.forEach(b => { b.disabled = false; });
          return avisar(err.message || 'No se pudo registrar el reemplazo.');
        }
      },
    });
    if (!res || typeof res !== 'object') return;
    Toast.show(`✅ Reemplazo registrado: gestión ${res.gestion_id}${res.contrato ? ` (contrato ${res.contrato})` : ''}${res.cambio_modelo ? ' · cambio de modelo aprobado, tarifa se mantiene' : ''}`, 'ok', 8000);
  }

  window.abrirRegularizarReemplazo = abrirRegularizarReemplazo;
})();
