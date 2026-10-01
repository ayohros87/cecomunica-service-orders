// @ts-nocheck
// SIM en la fila (auditoría de módulos 2026-10-01, PoC P5). Cambiar la SIM es
// la acción más frecuente del módulo (293 cambios al mes) y exigía abrir un
// cajón de 14 campos para tocar 3. Clic en la celda "SIM / Teléfono" → editor
// en sitio con ICCID, teléfono y operador; Enter guarda, Esc cancela;
// autocompleta teléfono y operador si el ICCID está disponible en el pool;
// lector de código de barras con la cámara cuando el navegador trae
// BarcodeDetector (Chrome en tablet/teléfono). Pasa por la misma validación
// de "SIM en otro radio" (PocSimConflicto). El cajón sigue para lo demás.
window.PocSimInline = {
  _activo: null,   // { row, docId, d, td, original }
  _pool:   null,   // SIMs disponibles del pool (una lectura por sesión)
  _poolP:  null,

  puedeEditar(d) {
    return !PocState.esLectura() && d && d.deleted !== true;
  },

  abrir(row, docId, d) {
    if (!this.puedeEditar(d)) return;
    if (window.PocBulk?._modo) return;                 // la masiva ya tiene sus inputs
    if (this._activo?.docId === docId) return;
    if (this._activo) this.cancelar();
    const td = row.cells[PocState.COL.sim_tel];
    if (!td) return;
    const esc = FMT.esc;
    const ops = [...(PocState.listaOperadores || [])];
    if (d.operador && !ops.includes(d.operador)) ops.push(d.operador);
    const puedeEscanear = ('BarcodeDetector' in window) && !!navigator.mediaDevices?.getUserMedia;
    const original = td.innerHTML;
    td.innerHTML = `
      <form class="sim-inline" autocomplete="off">
        <input type="text" class="table-input sim-inline-iccid" inputmode="numeric" placeholder="ICCID (SIM)" list="simInlinePool" value="${esc(d.sim_number || '')}" aria-label="SIM (ICCID)">
        <input type="text" class="table-input sim-inline-tel" inputmode="tel" placeholder="Teléfono" value="${esc(d.sim_phone || '')}" aria-label="Teléfono">
        <select class="table-input table-select sim-inline-op" aria-label="Operador">
          <option value="">Operador…</option>
          ${ops.map(o => `<option value="${esc(o)}"${o === d.operador ? ' selected' : ''}>${esc(o)}</option>`).join('')}
        </select>
        <span class="sim-inline-btns">
          ${puedeEscanear ? '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-sim="escanear" title="Leer el código de barras del SIM con la cámara" aria-label="Escanear SIM"><i data-lucide="camera"></i></button>' : ''}
          <button type="submit" class="btn btn-primary btn-icon btn-sm" title="Guardar (Enter)" aria-label="Guardar SIM"><i data-lucide="check"></i></button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-sim="cancelar" title="Cancelar (Esc)" aria-label="Cancelar"><i data-lucide="x"></i></button>
        </span>
      </form>`;
    this._activo = { row, docId, d, td, original };
    const form = td.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); this.guardar(); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelar(); } });
    td.querySelector('[data-sim="cancelar"]').addEventListener('click', () => this.cancelar());
    td.querySelector('[data-sim="escanear"]')?.addEventListener('click', () => this.escanear());
    const iccid = td.querySelector('.sim-inline-iccid');
    iccid.addEventListener('input',  () => this._autocompletar(iccid.value));
    iccid.addEventListener('change', () => this._autocompletar(iccid.value));
    this._cargarPool().then(() => this._pintarDatalist()).catch(() => { /* sin pool no pasa nada */ });
    if (window.Icons) Icons.pintar(td);
    else if (typeof lucide !== 'undefined') lucide.createIcons();
    // En tablet la celda SIM vive detrás del scroll horizontal de la tabla:
    // el editor se trae a la vista antes de enfocar.
    try { form.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) { /* navegador viejo */ }
    iccid.focus();
    iccid.select();
  },

  cancelar() {
    const a = this._activo;
    if (!a) return;
    this._activo = null;
    a.td.innerHTML = a.original;
    if (window.Icons) Icons.pintar(a.td);
    else if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // ── Pool de SIM disponibles: datalist + autocompletar teléfono/operador ──
  _cargarPool() {
    if (this._pool) return Promise.resolve(this._pool);
    if (!this._poolP) {
      this._poolP = SimCardsService.listar({ estado: 'disponible' })
        .then(l => { this._pool = l; return l; })
        .catch(e => { this._poolP = null; throw e; });
    }
    return this._poolP;
  },

  _pintarDatalist() {
    let dl = document.getElementById('simInlinePool');
    if (!dl) { dl = document.createElement('datalist'); dl.id = 'simInlinePool'; document.body.appendChild(dl); }
    const esc = FMT.esc;
    dl.innerHTML = (this._pool || []).map(s =>
      `<option value="${esc(s.sim_number)}">${esc([s.sim_phone, s.operador].filter(Boolean).join(' · ') || 'disponible en el pool')}</option>`).join('');
  },

  _autocompletar(valor) {
    const a = this._activo;
    if (!a || !this._pool) return;
    const n = SimCardsService.normalizarSim(valor);
    if (!n) return;
    const s = this._pool.find(x => SimCardsService.normalizarSim(x.sim_number) === n);
    if (!s) return;
    const tel = a.td.querySelector('.sim-inline-tel');
    const op  = a.td.querySelector('.sim-inline-op');
    // El teléfono viaja con el SIM: si el ICCID es uno del pool, su teléfono
    // pisa el que tenía la ficha (mismo criterio que "Asignar del pool").
    if (tel && s.sim_phone) tel.value = s.sim_phone;
    if (op && s.operador) {
      if (![...op.options].some(o => o.value === s.operador)) {
        const o = document.createElement('option'); o.value = s.operador; o.textContent = s.operador; op.appendChild(o);
      }
      op.value = s.operador;
    }
  },

  async guardar() {
    const a = this._activo;
    if (!a) return;
    const td = a.td;
    const sim = (td.querySelector('.sim-inline-iccid')?.value || '').trim();
    const tel = (td.querySelector('.sim-inline-tel')?.value || '').trim();
    const op  = td.querySelector('.sim-inline-op')?.value || '';
    const simN  = SimCardsService.normalizarSim(sim);
    const prevN = SimCardsService.normalizarSim(a.d.sim_number);
    if (sim && !SimCardsService.esSimValido(simN)) { Toast.show('El SIM (ICCID) debe tener entre 10 y 22 dígitos.', 'bad'); return; }
    if (sim === (a.d.sim_number || '') && tel === (a.d.sim_phone || '') && op === (a.d.operador || '')) { this.cancelar(); return; }

    const user = firebase.auth().currentUser;
    const FV = firebase.firestore.FieldValue;
    const payload = {
      sim_number: sim, sim_phone: tel, operador: op,
      updated_at: FV.serverTimestamp(), updated_by: user?.uid || null, updated_by_email: user?.email || null,
    };
    const btn = td.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      // SIM que ya está en otro radio: avisa y pide motivo, no bloquea (R2/D2).
      if (simN && simN !== prevN) {
        const rev = await PocSimConflicto.revisar([{ id: a.docId, sim_number: sim, serial: a.d.serial || '', cliente: PocState.nombreClienteDe(a.d) }]);
        if (rev.cancelado) return;                       // sigue en edición
        const sc = PocSimConflicto.campo(rev, a.docId, user);
        if (sc) payload.sim_conflicto = sc;
        else if (a.d.sim_conflicto) payload.sim_conflicto = FV.delete();
      }
      await PocService.updatePocDevice(a.docId, payload);
      const clean = PocService.stripSentinels(payload);
      PocService.addLog({
        equipo_id: a.docId,
        fecha:     FV.serverTimestamp(),
        usuario:   user?.email,
        origen:    'sim-en-fila',
        ...(clean.sim_conflicto ? { motivo: clean.sim_conflicto.motivo, sim_conflicto: clean.sim_conflicto } : {}),
        cambios:   { antes: a.d, despues: { ...a.d, ...clean } },
      }).catch(e => console.warn('poc_log write failed (non-critical):', e));

      // Pool: el SIM nuevo tecleado a mano que exista disponible pasa a
      // asignado; el anterior, si el pool lo tenía asignado a ESTE equipo,
      // vuelve a disponible (mismo criterio que "Asignar del pool"). Best-effort.
      if (simN && simN !== prevN && a.d.activo !== false) {
        SimCardsService.marcarAsignadoSiExiste(simN, { id: a.docId, serial: a.d.serial || '', cliente_nombre: PocState.nombreClienteDe(a.d) }, user);
      }
      if (prevN && prevN !== simN) {
        SimCardsService.getSim(prevN).then(prevDoc => {
          if (prevDoc && prevDoc.estado === 'asignado' && prevDoc.asignado_a?.device_id === a.docId) {
            return SimCardsService.liberar({ sim_number: prevN, sim_phone: prevDoc.sim_phone, operador: prevDoc.operador,
              desde: { device_id: a.docId, serial: a.d.serial || '', cliente_nombre: PocState.nombreClienteDe(a.d) } }, user);
          }
        }).catch(e => console.warn('No se pudo liberar el SIM anterior en el pool (no crítico):', e));
      }
      this._pool = null; this._poolP = null;             // el pool cambió
      this._activo = null;
      PocList.aplicarCambioLocal(a.docId, clean);
      Toast.show('SIM guardado', 'ok');
    } catch (e) {
      console.error('[PocSimInline] guardar', e);
      Toast.show('No se pudo guardar el SIM: ' + (e.message || e), 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // ── Lector de código de barras (BarcodeDetector + cámara) ──────────
  async escanear() {
    if (!('BarcodeDetector' in window)) { Toast.show('Este navegador no puede leer códigos de barras.', 'bad'); return; }
    let detector;
    try { detector = new BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code'] }); }
    catch (e) { Toast.show('Este navegador no puede leer códigos de barras.', 'bad'); return; }
    let stream = null, timer = null;
    const detener = () => { if (timer) clearInterval(timer); timer = null; try { stream?.getTracks().forEach(t => t.stop()); } catch (_) { /* ya cerrada */ } };
    const r = await Modal.sheet({
      title: 'Leer el SIM con la cámara', icon: 'camera', size: 'sm',
      html: '<video id="simInlineVideo" autoplay playsinline muted style="width:100%;max-height:60vh;border-radius:8px;background:#000;"></video>'
          + '<p class="form-hint" style="margin-top:8px;">Apunta al código de barras del SIM (ICCID). Se llena solo al leerlo.</p>',
      buttons: [{ action: 'cancelar', label: 'Cancelar' }],
      onMount: async (root, api) => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          const video = root.querySelector('#simInlineVideo');
          video.srcObject = stream;
          timer = setInterval(async () => {
            try {
              const codes = await detector.detect(video);
              const hit = codes.map(c => (c.rawValue || '').match(/\d{10,22}/)?.[0]).find(Boolean);
              if (hit) api.close(hit);
            } catch (_) { /* cuadro sin código */ }
          }, 250);
        } catch (e) {
          Toast.show('No se pudo abrir la cámara.', 'bad');
          api.close(null);
        }
      },
    });
    detener();
    if (r && typeof r === 'string' && r !== 'cancelar') {
      const i = this._activo?.td.querySelector('.sim-inline-iccid');
      if (i) { i.value = r; this._autocompletar(r); i.focus(); }
    }
  },
};
