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

   VISITA TÉCNICA (2026-11-18, MACELLO): el técnico cambia radios EN SITIO
   con los que lleva consigo. El entrante no está en la orden: se ESCRIBE su
   serial. Se registra un cambio a la vez y la visita admite varios (el
   candado es por serial saliente). El técnico también puede registrarlo.

   2026-11-18 (Brenda): "Radio que SALIÓ" se leía ambiguo (¿salió de bodega o
   del cliente?) → "Radio recibido del cliente (equipo reemplazado)". El
   callable ahora avisa por correo a bodega, recepción y taller, y lo escrito
   en "¿Qué pasó?" queda en el kardex de los dos radios.

   Diferido (CargaDiferida.regularizarReemplazo). Expone
   window.abrirRegularizarReemplazo(ordenId).
   ============================================================= */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const ROLES_OK = ['administrador', 'recepcion', 'jefe_taller', 'inventario', 'gerente', 'tecnico', 'tecnico_operativo'];
  const normSerial = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // opts.serialSaliente (2026-11-24): el técnico lo abre desde la intervención
  // de UN radio de la visita ("Lo cambié por otro radio"); ese radio queda fijo
  // como el recibido del cliente. Devuelve el resultado del callable (más
  // serial_entrante y motivo) o undefined si se canceló.
  async function abrirRegularizarReemplazo(ordenId, opts = {}) {
    const rol = APP.state.userRole || '';
    if (!ROLES_OK.includes(rol)) { Toast.show('Tu rol no registra reemplazos a posteriori.', 'warn'); return; }
    const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || await OrdenesService.getOrder(ordenId);
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    const esVisita = typeof esOrdenVisita === 'function' && esOrdenVisita(orden);
    if (orden.gestion?.id && !esVisita) { Toast.show(`Esta orden ya pertenece a la gestión ${orden.gestion.id}: el reemplazo se registra allá.`, 'warn'); return; }
    if (!orden.cliente_id) { Toast.show('La orden no tiene cliente registrado.', 'warn'); return; }
    const hechos = orden.reemplazos_regularizados || {};
    const equipos = (orden.equipos || []).filter(e => e && !e.eliminado && (e.numero_de_serie || e.serial));
    if (esVisita) return abrirVisita(ordenId, orden, equipos.filter(e => !hechos[normSerial(e.numero_de_serie || e.serial)]), hechos, opts);
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
          No abre órdenes nuevas; bodega, recepción y taller reciben un correo con el cambio.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label class="form-label" for="rrSal">Radio recibido del cliente (equipo reemplazado)</label>
            <select id="rrSal" class="form-input">${equipos.map(e => op(e, e === salDefault)).join('')}</select>
          </div>
          <div>
            <label class="form-label" for="rrEnt">Radio entregado al cliente (en su lugar)</label>
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

  // ── Visita técnica: el radio que entró se escribe ─────────────────────────
  async function abrirVisita(ordenId, orden, equipos, hechos, opts = {}) {
    const yaHechos = Object.values(hechos);
    if (!equipos.length) { Toast.show('Todos los radios de esta visita ya tienen su reemplazo registrado.', 'info'); return; }
    // Abierto desde la intervención de un radio: ese es el recibido del cliente.
    const fijo = opts.serialSaliente
      ? equipos.find(e => normSerial(e.numero_de_serie || e.serial) === normSerial(opts.serialSaliente)) : null;
    if (opts.serialSaliente && !fijo) { Toast.show(`El cambio del radio ${opts.serialSaliente} ya está registrado.`, 'info'); return; }
    if (fijo) equipos = [fijo];
    const op = (e) => `<option value="${esc(e.numero_de_serie || e.serial)}">${esc(e.numero_de_serie || e.serial)} · ${esc(e.modelo || '')}</option>`;
    // Radios que bodega le entregó al técnico para ESTA visita (Almacén → Hoy →
    // "Salida a visita", 2026-11-18): se sugieren al escribir el serial.
    const llevados = Object.values(orden.radios_salida || {}).filter(r => r && r.estado === 'llevado' && r.serial);
    const res = await Modal.sheet({
      title: `Registrar cambio en sitio · visita ${ordenId}`, icon: 'replace', size: 'md',
      html: `
        <p style="margin:0 0 10px;font-size:13.5px;line-height:1.45;">
          <b>${esc(orden.cliente_nombre || orden.cliente || 'Cliente')}</b>. Usa esto cuando en la visita cambiaste un radio del cliente por uno que llevabas.
          El que dejaste queda con el cliente (en el contrato del que salió) y el que salió sale del contrato.
          No se le pide nada a bodega: recibe un correo con el cambio, igual que recepción y taller. ${fijo ? '' : '<b>Un cambio a la vez</b>: si cambiaste varios, repítelo por cada radio.'}
        </p>
        ${yaHechos.length ? `<p style="margin:0 0 10px;font-size:12.5px;color:#475569;">Ya registrados en esta visita: ${yaHechos.map(h => `${esc(h.saliente)} → ${esc(h.entrante)}`).join(' · ')}</p>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label class="form-label" for="rrSal">Radio recibido del cliente (equipo reemplazado)</label>
            <select id="rrSal" class="form-input"${fijo ? ' disabled' : ''}>${equipos.map(op).join('')}</select>
          </div>
          <div>
            <label class="form-label" for="rrEnt">Radio que dejaste con el cliente (serial) *</label>
            <input id="rrEnt" class="form-input" autocomplete="off" spellcheck="false" placeholder="Ej.: 18607A0484" style="text-transform:uppercase;"${llevados.length ? ' list="rrLlevados"' : ''}>
            ${llevados.length ? `<datalist id="rrLlevados">${llevados.map(r => `<option value="${esc(String(r.serial).toUpperCase())}">${esc(r.modelo || '')}</option>`).join('')}</datalist>` : ''}
          </div>
        </div>
        ${llevados.length
          ? `<p style="margin:8px 0 4px;font-size:12.5px;color:#475569;">Salieron de bodega con esta visita — toca el que dejaste:</p>
             <div id="rrLlevadosChips" style="display:flex;flex-wrap:wrap;gap:6px;">${llevados.map(r => `<button type="button" class="btn btn-secondary btn-sm" data-rr-llevado="${esc(String(r.serial).toUpperCase())}" style="font-family:var(--font-mono);">${esc(String(r.serial).toUpperCase())}</button>`).join('')}</div>`
          : `<p style="margin:6px 0 0;font-size:12.5px;color:#92400E;">Bodega no registró radios para esta visita. Si te llevaste uno, se acepta igual, pero bodega recibe el aviso de que salió sin registrarse.</p>`}
        <label style="display:flex;gap:8px;align-items:flex-start;margin-top:10px;font-size:13px;">
          <input type="checkbox" id="rrEnCasa" checked style="margin-top:3px;">
          <span><b>Me traje el radio del cliente.</b> Si se quedó con el cliente, desmárcalo: queda pendiente de devolución.</span>
        </label>
        <p style="margin:6px 0 0 24px;font-size:12.5px;color:#475569;line-height:1.45;">
          El radio que recibiste del cliente se entrega en <b>recepción</b>: al registrar el cambio se abre sola su orden de DEVOLUCIÓN, y queda pendiente hasta que recepción lo reciba.
          Si fue daño del cliente, el cobro sale de esa revisión, con la cotización del taller.</p>
        <label class="form-label" for="rrMotivo" style="margin-top:10px;">¿Qué pasó? *</label>
        <textarea id="rrMotivo" class="form-input" rows="2" placeholder="Ej.: no transmitía; se cambió en sitio. Si parece daño del cliente, dilo aquí."></textarea>
        <div id="rrAviso" role="alert" style="display:none;margin-top:10px;padding:8px 12px;border:1px solid #FCD34D;background:#FFFBEB;color:#92400E;border-radius:6px;font-size:13px;"></div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'registrar', label: 'Registrar cambio', primary: true, icon: 'check' },
      ],
      // Los radios que bodega le entregó se eligen de un toque (2026-11-24): en
      // el teléfono la lista de sugerencias del campo casi no se ve.
      onMount: (root) => {
        const input = root.querySelector('#rrEnt');
        const chips = Array.from(root.querySelectorAll('[data-rr-llevado]'));
        const marcar = () => chips.forEach(c => {
          const on = normSerial(c.dataset.rrLlevado) === normSerial(input.value);
          c.classList.toggle('btn-primary', on); c.classList.toggle('btn-secondary', !on);
        });
        chips.forEach(c => c.addEventListener('click', () => { input.value = c.dataset.rrLlevado; marcar(); root.querySelector('#rrMotivo')?.focus(); }));
        input?.addEventListener('input', marcar);
        if (chips.length === 1 && fijo) { input.value = chips[0].dataset.rrLlevado; marcar(); }
      },
      onAction: async (a, root) => {
        if (a !== 'registrar') return null;
        const avisoEl = root.querySelector('#rrAviso');
        const avisar = (m) => { avisoEl.textContent = m; avisoEl.style.display = ''; return false; };
        const sal = root.querySelector('#rrSal').value;
        const ent = String(root.querySelector('#rrEnt').value || '').trim().toUpperCase();
        if (!sal) return avisar('Elige el radio que recibiste del cliente.');
        if (!ent) return avisar('Escribe el serial del radio que dejaste.');
        if (normSerial(sal) === normSerial(ent)) return avisar('El radio recibido y el que dejaste no pueden ser el mismo.');
        const motivo = (root.querySelector('#rrMotivo').value || '').trim();
        if (motivo.length < 10) return avisar('Di en una frase qué pasó (mínimo 10 caracteres).');
        const salienteEnCasa = !!root.querySelector('#rrEnCasa').checked;
        const botones = root.querySelectorAll('button'); botones.forEach(b => { b.disabled = true; });
        try {
          const r = await firebase.functions().httpsCallable('regularizarReemplazoOrden')({ ordenId, serialSaliente: sal, serialEntrante: ent, salienteEnCasa, motivo });
          return { ...(r.data || { ok: true }), serial_entrante: ent, motivo };
        } catch (err) {
          console.error('[regularizar-reemplazo:visita]', err);
          botones.forEach(b => { b.disabled = false; });
          return avisar(err.message || 'No se pudo registrar el cambio.');
        }
      },
    });
    if (!res || typeof res !== 'object') return;
    Toast.show(`✅ Cambio registrado: gestión ${res.gestion_id}${res.contrato ? ` (contrato ${res.contrato})` : ''}${res.devolucion_id ? ` · entrega el radio del cliente en recepción (devolución ${res.devolucion_id})` : ''}`, 'ok', 10000);
    return res;
  }

  window.abrirRegularizarReemplazo = abrirRegularizarReemplazo;
})();
