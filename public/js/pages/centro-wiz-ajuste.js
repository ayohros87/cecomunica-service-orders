// @ts-nocheck
// Centro de gestión de clientes — Wizard: ajuste de tarifa / servicios (2026-09-02).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Wizard: ajuste de tarifa / servicios (2026-09-02) ═════════ */

  // Anexo SOLO-CARGOS (caso FORTALEZA: agregar "Servicio GPS" $5/mes a radios
  // concretos). Sin equipos nuevos → sin bodega, sin OS, sin entrega: al
  // firmarse el cliente, B3 aplica los cargos al contrato, estampa el servicio
  // en el pool de cada serial marcado y CIERRA la gestión — mismo patrón del
  // anexo de regularización. Los cargos recurrentes quedan AMARRADOS POR
  // SERIAL (cargo.seriales[]): la cantidad sale de la selección, y la baja de
  // un serial descuenta el cargo sola (onGestionWrite B2).
  // `opts.cargos`: cargos ya elegidos en "Agregar equipos" (solo cargos, sin
  // radios) — el ajuste abre con ellos cargados en vez de en blanco.
  async wizAjuste(preselId, opts = {}) {
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no crea gestiones desde aquí', 'warn'); return; }
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarCargos();
    const activos = this.contratos.filter(c => this._esVigente(c));
    if (!activos.length) { Toast.show('El cliente no tiene contratos vigentes', 'warn'); return; }
    const cBase = activos.find(c => c.id === preselId) || this._cuentaAncla() || activos[0];
    const itbmsDefault = this.cliente?.itbms_exento === true ? false : (cBase?.itbms_aplica !== false);
    this._abrirModalA({
      titulo: `Consola, servicio o ajuste de tarifa (anexo) — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Agrega <b>cargos del catálogo</b> (consolas, servicios como GPS, o ajustes) a un contrato vigente —
        <b>sin equipos nuevos</b>: no pasa por bodega ni genera entrega. Requiere aprobación
        comercial y la <b>firma del cliente</b>; al firmarse se aplica y cierra solo.</p>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Contrato destino</div>
        <div class="form-field" style="margin-bottom:4px; max-width:340px;">
          <select class="form-select" id="wjContrato" onchange="Centro._wjSyncFlota()">
            ${activos.map(c => `<option value="${this.esc(c.id)}" ${c.id === cBase.id ? 'selected' : ''}>${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
          </select></div>
      </div>
      <div oninput="Centro._wjPreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Tarifas de las líneas actuales
          <span class="hint">precio negociado — deja en blanco lo que no cambia</span></div>
        <div id="wjLineas"></div>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Cargos / servicios nuevos <span class="hint">opcional</span></div>
        <div id="wjCargos">${this._wjCargoRow()}</div>
        <button class="btn btn-ghost cg-act"
          onclick="document.getElementById('wjCargos').insertAdjacentHTML('beforeend', Centro._wjCargoRow())">+ Agregar cargo</button>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">4</span> Totales</div>
        <label class="cg-toggle">
          <input type="checkbox" id="wjItbms" ${itbmsDefault ? 'checked' : ''} onchange="Centro._wjPreview()">
          Aplica ITBMS</label>
        <div id="wjTot" class="ds-card" style="padding:10px 14px; max-width:380px; margin-top:10px;"></div>
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearAjuste(this)">Enviar a aprobación</button>`,
    });
    this._wjSyncFlota();
    if (Array.isArray(opts.cargos) && opts.cargos.length) this._wjPrecargar(opts.cargos);
    this._wjPreview();
  },
  _wjPrecargar(cargos) {
    const cont = document.getElementById('wjCargos');
    if (!cont) return;
    cont.innerHTML = cargos.map(() => this._wjCargoRow()).join('');
    [...cont.querySelectorAll('.wj-cargo')].forEach((fila, i) => {
      const c = cargos[i];
      const sel = fila.querySelector('[data-wjc-sel]');
      sel.value = c.cargo_id;
      if (sel.value !== c.cargo_id) return;   // ya no está en el catálogo
      this._wjRowSel(sel);
      fila.querySelector('[data-wjc-monto]').value = c.monto;
      fila.querySelector('[data-wjc-tipo]').value = c.recurrente ? 'recurrente' : 'unico';
      const cant = fila.querySelector('[data-wjc-cant]');
      if (!cant.readOnly) cant.value = c.cantidad || 1;
    });
  },
  // Tarifas actuales del contrato destino, editables (renegociación de
  // precio, 2026-09-02): cada línea muestra su precio vigente y un campo
  // "nuevo" — vacío = sin cambio. Se aplica al firmarse el anexo.
  _wjSyncLineas() {
    const cont = document.getElementById('wjLineas');
    if (!cont) return;
    const cid = document.getElementById('wjContrato')?.value || '';
    const c = this.contratos.find(x => x.id === cid);
    const lineas = (c?.equipos || []);
    cont.innerHTML = lineas.length ? `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Línea</th><th class="num">Cant.</th><th class="num">Precio actual</th><th class="num">Precio nuevo</th></tr></thead><tbody>
      ${lineas.map((l, i) => `<tr>
        <td>${this.esc(l.modelo || l.descripcion || '—')}${l.modalidad === 'propio' ? ' <span class="cg-venc vigente" style="font-size:10.5px;">del cliente</span>' : ''}</td>
        <td class="num">${Number(l.cantidad || 0)}</td>
        <td class="num">$${Number(l.precio || 0).toFixed(2)}</td>
        <td class="num"><input class="form-input num" type="number" min="0" step="1" placeholder="sin cambio"
          data-wj-nuevo data-idx="${i}" style="max-width:110px; padding:4px 8px; font-size:13px;"></td></tr>`).join('')}
    </tbody></table></div>`
      : `<p style="font-size:12.5px; color:var(--fg-3); margin:0;">El contrato no tiene líneas de equipos.</p>`;
  },
  _wjAjustes() {
    const cid = document.getElementById('wjContrato')?.value || '';
    const c = this.contratos.find(x => x.id === cid);
    return [...document.querySelectorAll('input[data-wj-nuevo]')].map(inp => {
      if (inp.value === '' || inp.value == null) return null;
      const i = Number(inp.dataset.idx);
      const l = (c?.equipos || [])[i];
      if (!l) return null;
      const nuevo = Math.max(0, Number(inp.value) || 0);
      if (nuevo === Number(l.precio || 0)) return null;
      return { idx: i, modelo_id: l.modelo_id || null, modelo: l.modelo || '',
        modalidad: l.modalidad || null, cantidad: Number(l.cantidad || 0),
        precio_anterior: Number(l.precio || 0), precio_nuevo: nuevo };
    }).filter(Boolean);
  },
  // Cambio de contrato destino: tarifas nuevas + las filas de cargos se
  // reinician (los pickers de radios dependen de la flota del destino).
  _wjSyncFlota() {
    this._wjSyncLineas();
    const cont = document.getElementById('wjCargos');
    if (cont) cont.innerHTML = this._wjCargoRow();
    this._wjPreview();
  },

  // Fila de cargo del AJUSTE (rediseño 2026-09-02: cero jerga — el CATÁLOGO
  // sabe si un cargo es por equipo, cargos.por_equipo). Al elegir "Servicio
  // GPS" la fila despliega "¿A cuáles radios?" ahí mismo; al elegir "Consola"
  // solo pide monto y cantidad. El vendedor nunca decide el amarre.
  _wjCargoRow() {
    const opts = (this.cargosCat || []).map(c =>
      `<option value="${this.esc(c.id)}" data-monto="${Number(c.monto_default) || 0}"
        data-rec="${c.recurrente ? 1 : 0}" data-poreq="${c.por_equipo ? 1 : 0}">${this.esc(c.concepto || '')}</option>`).join('');
    return `<div class="wj-cargo" style="border:1px solid var(--border-subtle); border-radius:8px; padding:8px 10px; margin-bottom:8px;">
      <div style="display:flex; gap:8px; align-items:center;">
        <select class="form-select" data-wjc-sel style="flex:1;" onchange="Centro._wjRowSel(this)">
          <option value="">— cargo del catálogo —</option>${opts}</select>
        <input class="form-input" data-wjc-cant type="number" min="1" value="1" style="width:70px;" title="Cantidad" onchange="Centro._wjPreview()">
        <input class="form-input" data-wjc-monto type="number" min="0" step="1" placeholder="$" style="width:100px;" onchange="Centro._wjPreview()">
        <select class="form-select" data-wjc-tipo style="width:110px;" onchange="Centro._wjPreview()">
          <option value="unico">Único</option><option value="recurrente">Mensual</option></select>
        <button type="button" class="btn btn-ghost" style="padding:4px 8px;" title="Quitar"
          onclick="this.closest('.wj-cargo').remove(); Centro._wjPreview()">✕</button>
      </div>
      <div data-wj-picker class="hidden" style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--border-subtle);"></div>
    </div>`;
  },
  _wjRowSel(sel) {
    const fila = sel.closest('.wj-cargo');
    const opt = sel.selectedOptions[0];
    if (opt && opt.value) {
      const m = Number(opt.dataset.monto) || 0;
      const monto = fila.querySelector('[data-wjc-monto]');
      if (m && !monto.value) monto.value = m;
      fila.querySelector('[data-wjc-tipo]').value = opt.dataset.rec === '1' ? 'recurrente' : 'unico';
    }
    const picker = fila.querySelector('[data-wj-picker]');
    const cant = fila.querySelector('[data-wjc-cant]');
    if (opt?.dataset.poreq === '1') {
      const cid = document.getElementById('wjContrato')?.value || '';
      const flota = this.equipos.filter(e => e.asignacion?.contrato_doc_id === cid);
      picker.innerHTML = `<div style="font-size:12.5px; font-weight:600; margin-bottom:4px;">¿A cuáles radios aplica?</div>`
        + (flota.length ? `<div style="max-height:160px; overflow:auto;">${flota.map(e => `
          <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:2px 0;">
            <input type="checkbox" data-wj-rs value="${this.esc(e.serial || e.id)}"
              onchange="Centro._wjRowSerial(this)" style="width:auto; margin:0;">
            <span class="cg-mono">${this.esc(e.serial || e.id)}</span>
            <span style="color:var(--fg-3);">${this.esc(e.modelo_label || '')}</span>
            ${(e.servicios || []).length ? `<span class="cg-venc vigente" style="font-size:10.5px;">${this.esc(e.servicios.join(', '))}</span>` : ''}
          </label>`).join('')}</div>`
        : `<p style="font-size:12.5px; color:var(--fg-3); margin:0;">El contrato no tiene seriales amarrados — el cargo irá con cantidad manual.</p>`);
      picker.classList.remove('hidden');
      if (flota.length) { cant.value = 0; cant.readOnly = true; }
    } else {
      picker.classList.add('hidden');
      picker.innerHTML = '';
      cant.readOnly = false;
      if (!(Number(cant.value) > 0)) cant.value = 1;
    }
    this._wjPreview();
  },
  _wjRowSerial(chk) {
    const fila = chk.closest('.wj-cargo');
    const n = [...fila.querySelectorAll('input[data-wj-rs]:checked')].length;
    const cant = fila.querySelector('[data-wjc-cant]');
    if (cant && cant.readOnly) cant.value = n;
    this._wjPreview();
  },
  _wjCargos() {
    return [...document.querySelectorAll('#wjCargos .wj-cargo')].map(f => {
      const sel = f.querySelector('[data-wjc-sel]');
      const opt = sel?.selectedOptions[0];
      if (!sel?.value) return null;
      const seriales = [...f.querySelectorAll('input[data-wj-rs]:checked')].map(i => i.value);
      return {
        cargo_id: sel.value,
        concepto: opt ? (opt.textContent || '').trim() : '',
        cantidad: Math.max(seriales.length ? seriales.length : 1,
          Math.round(Number(f.querySelector('[data-wjc-cant]')?.value)) || 1),
        monto: Math.max(0, Number(f.querySelector('[data-wjc-monto]')?.value || 0)),
        recurrente: f.querySelector('[data-wjc-tipo]')?.value === 'recurrente',
        por_equipo: opt?.dataset.poreq === '1',
        ...(seriales.length ? { seriales } : {}),
      };
    }).filter(c => c && c.monto > 0);
  },
  _wjPreview() {
    const cont = document.getElementById('wjTot');
    if (!cont) return;
    const t = this._totAumento([], this._wjCargos(), document.getElementById('wjItbms')?.checked !== false);
    const ajustes = this._wjAjustes();
    const delta = ajustes.reduce((s, a) => s + a.cantidad * (a.precio_nuevo - a.precio_anterior), 0);
    cont.innerHTML =
      (ajustes.length ? `<div style="display:flex; font-size:13px; padding:2px 0;">
        <span>Ajuste de tarifas (${ajustes.length} línea${ajustes.length === 1 ? '' : 's'})</span>
        <span class="num" style="margin-left:auto; ${delta >= 0 ? '' : 'color:var(--warn-deep, #92400E);'}">${delta >= 0 ? '+' : '−'}$${Math.abs(delta).toFixed(2)}/mes</span></div>` : '')
      + this._tarifarioHtml(t);
  },
  // Candado contra el doble submit (auditoría UX 2026-09-28, P0 #10): cada
  // click consumía un correlativo y mandaba un correo de aprobación.
  crearAjuste(btn) {
    return withBusy(btn || null, () => this._crearAjuste(), { key: 'crearAjuste', label: 'Enviando…', rethrow: false, intento: this._intento('crearAjuste', 'Consola, servicio o ajuste de tarifa') });
  },
  async _crearAjuste() {
    const cid = document.getElementById('wjContrato')?.value || '';
    const contrato = this.contratos.find(c => c.id === cid);
    if (!contrato) { Toast.show('Elige el contrato destino', 'warn'); return; }
    // El catálogo decide el amarre: un cargo por_equipo (GPS) exige sus
    // radios marcados; los demás (consola) van al contrato sin serial.
    const cargosRaw = this._wjCargos();
    const sinRadios = cargosRaw.find(c => c.por_equipo && !(c.seriales || []).length);
    if (sinRadios) {
      Toast.show(`"${sinRadios.concepto}" aplica por equipo — marca los radios en su fila`, 'warn'); return;
    }
    const cargos = cargosRaw.map(({ por_equipo, ...c }) => c);
    const ajustes = this._wjAjustes();
    if (!cargos.length && !ajustes.length) {
      Toast.show('Agrega un cargo del catálogo o ajusta la tarifa de alguna línea', 'warn'); return;
    }
    const itbmsAplica = document.getElementById('wjItbms')?.checked !== false;
    const totales = this._totAumento([], cargos, itbmsAplica);
    try {
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
        tipo: 'aumento',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_aprobacion',
        origen: { tipo: 'vendedor' },
        items: [],
        cierre: {},
        aprobacion: { requiere: true },
        aumento: {
          contrato_doc_id: contrato.id,
          contrato_id: contrato.contrato_id || contrato.id,
          lineas: [],
          cargos,
          itbms: { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
          totales,
          // El ajuste no crea tramo propio: hereda la vigencia del contrato
          // destino (2026-09-02 — el "? meses" venía de dejarla en null).
          duracion_meses: Number(contrato.duracion_meses)
            || Number(String(contrato.duracion || '').match(/\d+/)?.[0]) || null,
          seriales_asignados: [],
          es_ajuste: true,
          ...(ajustes.length ? { ajustes_precio: ajustes } : {}),
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`Ajuste ${gid} enviado a aprobación — al firmarse el cliente, se aplica y cierra solo`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear el ajuste', 'bad'); }
  },
});
