// @ts-nocheck
// Centro de gestión de clientes — Wizard: nuevo contrato / renovación (Ola 7).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Wizard: nuevo contrato / renovación (Ola 7) ═════════ */

  // Contrato desde la ficha del cliente, sin pasar por el formulario clásico.
  // Escribe EXACTAMENTE el mismo doc (ContratoTarifario.construirDoc) con el
  // mismo correlativo y estado inicial, así que la aprobación, la solicitud de
  // seriales a bodega, el PDF y la activación por firmado corren igual.
  // opts: id de contrato (Renovar de la fila) · {renovarCuenta:true} (consolida
  // los que están en ventana; sin contratos = regularización vía legacy) · nada.
  // SERV (2026-09-01, decisión de Alberto): el contrato maestro de la cuenta
  // es de SERVICIO y puede MEZCLAR modalidades — la propiedad vive por línea
  // (modalidad) y por serial (pool/Anexo A). ALQ/PROP quedan como legacy: se
  // absorben al renovar. Los nuevos desde el Centro nacen SERV.
  TIPOS_CONTRATO: { SERV: 'Servicio', ALQ: 'Alquiler', PROP: 'Propio', DEMO: 'Demo', TEMP: 'Temporal' },

  // Líneas fijas del anexo de regularización a partir de los seriales
  // marcados (_aumRegulariza), fusionadas por modelo+modalidad. `precios`
  // conserva lo ya tecleado (clave modelo|modalidad) al re-pintar.
  _aumLineasFijasHtml(precios = {}) {
    const m = new Map();
    (this._aumRegulariza || []).forEach(u => {
      const k = (u.modelo_id || u.modelo) + '|' + (u.modalidad || 'alquiler');
      const g = m.get(k) || { modelo_id: u.modelo_id, modelo: u.modelo, modalidad: u.modalidad, cantidad: 0, precio: precios[k] ?? '' };
      g.cantidad++; m.set(k, g);
    });
    return [...m.values()].map(l => this._lineaModeloFija('wau', l)).join('');
  },
  // Los tres destinos posibles de un serial en el anexo de regularización.
  // 'pendiente' es el viejo "desmarcado": ni entra ni se suelta — sigue como
  // deuda de la cuenta, que a veces es lo honesto ("no sé si lo tiene").
  AUM_REG_DESTINOS: [
    ['entra', 'Lo tiene — entra al contrato'],
    ['no_tiene', 'El cliente NO lo tiene — sale de la cuenta'],
    ['pendiente', 'Dejarlo pendiente — sigue como deuda'],
  ],
  _aumRegSerialesHtml() {
    const filas = (this._aumRegularizaTodos || []).map((u, i) => {
      const d = this._aumRegDestino[u.serial] || 'entra';
      return `<tr>
        <td class="cg-mono">${this.esc(u.serial)}${u.nuevo ? ' <span style="color:var(--ok-deep, #065F46); font-size:11px;">agregado</span>' : ''}</td>
        <td style="font-size:12.5px;">${this.esc(u.modelo || '—')}${u.sinFicha ? ' <span style="color:var(--fg-4); font-size:11px;">sin ficha — se da de alta al aprobar</span>' : ''}</td>
        <td><select class="form-select" style="min-width:250px;" aria-label="Destino de ${this.esc(u.serial)}"
              onchange="Centro._aumRegDestinoSet('${this.esc(u.serial)}', this.value)">
          ${this.AUM_REG_DESTINOS.map(([v, l]) => `<option value="${v}" ${v === d ? 'selected' : ''}>${l}</option>`).join('')}
        </select></td>
        <td>${u.nuevo ? `<button type="button" class="btn btn-ghost" style="padding:2px 8px;" title="Quitar de la lista"
              onclick="Centro._aumRegQuitarAgregado(${i})">✕</button>` : ''}</td></tr>`;
    }).join('');
    return `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>¿Lo tiene el cliente?</th><th></th></tr></thead>
      <tbody>${filas || '<tr><td colspan="4" class="cg-empty">Ningún serial declarado todavía.</td></tr>'}</tbody></table></div>`;
  },
  // Re-pinta seriales y líneas fijas conservando los precios tecleados.
  _aumRegRepintar() {
    const precios = {};
    for (const l of this._lineasModelo('wau')) precios[(l.modelo_id || l.modelo) + '|' + (l.modalidad || 'alquiler')] = l.precio || '';
    this._aumRegulariza = (this._aumRegularizaTodos || []).filter(u => (this._aumRegDestino[u.serial] || 'entra') === 'entra');
    const ser = document.getElementById('waRegSeriales');
    if (ser) ser.innerHTML = this._aumRegSerialesHtml();
    const cont = document.getElementById('waLineas');
    if (cont) cont.innerHTML = this._aumLineasFijasHtml(precios);
    const n = document.getElementById('waRegN');
    if (n) n.textContent = String(this._aumRegulariza.length);
    this._aumPreview();
  },
  _aumRegDestinoSet(serial, valor) {
    if (!this._aumRegularizaTodos) return;
    this._aumRegDestino[serial] = valor;
    this._aumRegRepintar();
  },
  _aumRegNoTiene() {
    return (this._aumRegularizaTodos || []).filter(u => this._aumRegDestino[u.serial] === 'no_tiene');
  },
  _aumRegQuitarAgregado(i) {
    const u = (this._aumRegularizaTodos || [])[i];
    if (!u || !u.nuevo) return;
    this._aumRegularizaTodos.splice(i, 1);
    delete this._aumRegDestino[u.serial];
    this._aumRegRepintar();
  },
  // Agrega al anexo un serial que el cliente tiene y la lista no trae. Si el
  // sistema no lo conoce, nace con el anexo (por eso el modelo es obligatorio
  // ahí); si ya tiene ficha con contrato, no se toca desde aquí.
  async _aumRegAgregarSerial() {
    if (!this._aumRegularizaTodos) return;
    const inp = document.getElementById('waRegSerialNuevo');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (!EquiposPoolService.esSerialValido(norm)) { Toast.show('Ese serial no parece válido', 'warn'); return; }
    if (this._aumRegularizaTodos.some(u => EquiposPoolService.normalizarSerial(u.serial) === norm)) {
      Toast.show(`${norm} ya está en la lista`, 'warn'); return;
    }
    let ficha = null;
    try { ficha = await EquiposPoolService.findBySerial(raw); } catch (_) { /* sin red: se agrega sin ficha */ }
    if (ficha?.estado === 'baja') { Toast.show(`${norm} está dado de BAJA — no se puede reactivar desde aquí`, 'bad'); return; }
    if (ficha?.asignacion?.contrato_doc_id) {
      Toast.show(`${norm} ya está amarrado al contrato ${ficha.asignacion.contrato_id || ''} — no hace falta regularizarlo`, 'warn');
      return;
    }
    const mSel = this._modeloDeSelect(document.getElementById('waRegModeloNuevo'));
    if (!ficha && !mSel) { Toast.show('Ese serial no está en el sistema: elige su modelo para darlo de alta', 'warn'); return; }
    const modelo = ficha ? { id: ficha.modelo_id || mSel?.id || null, label: ficha.modelo_label || mSel?.label || '' } : mSel;
    this._aumRegularizaTodos.push({
      pool_doc_id: ficha ? ficha.id : null,
      serial: ficha ? (ficha.serial || raw) : raw,
      serial_norm: norm,
      modelo_id: modelo.id || null, modelo: modelo.label || '',
      // La modalidad la manda la LÍNEA: se arranca con lo que diga la ficha
      // (si la hay) y el vendedor la corrige arriba si está mal.
      modalidad: ficha?.propiedad === 'cliente' ? 'propio' : 'alquiler',
      nuevo: true, sinFicha: !ficha,
    });
    this._aumRegDestino[ficha ? (ficha.serial || raw) : raw] = 'entra';
    if (inp) inp.value = '';
    this._aumRegRepintar();
    inp?.focus();
  },

  // Línea FIJA (anexo de regularización): el modelo y la cantidad salen de los
  // seriales y no se editan. El precio y la MODALIDAD sí: la modalidad venía
  // de `propiedad` de la ficha y estaba bloqueada, así que una marca falsa de
  // la migración ("del cliente") se colaba al anexo sin que el vendedor
  // pudiera corregirla — justo el caso FORTUNATO MANGRAVITA (2026-09-09).
  // Quien declara de quién es el equipo es la línea, no la ficha.
  _lineaModeloFija(pref, l) {
    const k = (l?.modelo_id || l?.modelo || '') + '|' + (l?.modalidad === 'propio' ? 'propio' : 'alquiler');
    return `<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      ${this._selModelo(`data-${pref}-modelo disabled style="flex:1;"`, l?.modelo_id, l?.modelo)}
      <input class="form-input" data-${pref}-cant type="number" readonly value="${Math.max(1, Number(l?.cantidad || 1))}" style="width:86px; background:var(--surface-sunken, #EEF2F6);" title="Cantidad — fija por los seriales">
      <input class="form-input" data-${pref}-precio type="number" min="0" step="1" placeholder="$/mes" value="${l?.precio != null && l.precio !== '' ? Number(l.precio).toFixed(2) : ''}" style="width:110px;" title="Precio mensual">
      ${this._selModalidad(pref, l?.modalidad === 'propio' ? 'propio' : 'alquiler',
        `onchange="Centro._aumRegModalidad('${this.esc(k)}', this.value)"`)}
    </div>`;
  },

  // Cambiar "de quién es" una línea del anexo de regularización: la modalidad
  // baja a los seriales de esa línea (y a la lista completa, para que marcar y
  // desmarcar no la revierta) y las líneas se re-pintan conservando el precio.
  _aumRegModalidad(k, valor) {
    if (!this._aumRegulariza || (valor !== 'propio' && valor !== 'alquiler')) return;
    const clave = (u) => (u.modelo_id || u.modelo || '') + '|' + (u.modalidad === 'propio' ? 'propio' : 'alquiler');
    const precios = {};
    for (const l of this._lineasModelo('wau')) precios[(l.modelo_id || l.modelo) + '|' + (l.modalidad || 'alquiler')] = l.precio || '';
    const base = k.split('|')[0];
    precios[base + '|' + valor] = precios[k] ?? precios[base + '|' + valor] ?? '';
    for (const lista of [this._aumRegulariza, this._aumRegularizaTodos || []]) {
      lista.forEach(u => { if (clave(u) === k) u.modalidad = valor; });
    }
    const cont = document.getElementById('waLineas');
    if (cont) cont.innerHTML = this._aumLineasFijasHtml(precios);
    this._aumPreview();
  },

  _lineaModeloPre(pref, conPrecio, l) {
    return `<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      ${this._selModelo(`data-${pref}-modelo style="flex:1;"`, l?.modelo_id, l?.modelo)}
      <input class="form-input" data-${pref}-cant type="number" min="1" value="${Math.max(1, Number(l?.cantidad || 1))}" style="width:86px;" title="Cantidad">
      ${conPrecio ? `<input class="form-input" data-${pref}-precio type="number" min="0" step="1" placeholder="$/mes" value="${l?.precio != null && l.precio !== '' ? Number(l.precio).toFixed(2) : ''}" style="width:110px;" title="Precio mensual">
      ${this._selModalidad(pref, l?.modalidad)}` : ''}
      <button type="button" class="btn btn-ghost" style="padding:4px 8px;" title="Quitar"
        onclick="this.parentElement.remove(); Centro._previewTarifario()">✕</button>
    </div>`;
  },

  _wcCandidatos() {
    return this.contratos.filter(c => this._esVigente(c) && !c.deleted);
  },
  // ¿Hay un contrato VIVO de esta cuenta con exactamente los mismos equipos
  // (familia de modelo + modalidad + cantidad)? Es la huella de "rehecho sin
  // anular el viejo" (MAGEN DAVID 2026-10-05: dos contratos vivos por los
  // mismos 22 PNC460-R y la alerta de seriales escalando para siempre).
  _wcHuellaLineas(lineas) {
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/R$/, '');
    const fam = (l) => {
      const f = window.ModeloFamilia?.familiaDe ? ModeloFamilia.familiaDe(l.modelo_id || l.modelo) : '';
      return (f && !String(f).startsWith('~')) ? String(f) : norm(l.modelo);
    };
    const m = new Map();
    for (const l of (lineas || [])) {
      if (!l || !(Number(l.cantidad) > 0)) continue;
      const k = `${fam(l)}|${l.modalidad === 'propio' ? 'propio' : 'alquiler'}`;
      m.set(k, (m.get(k) || 0) + Number(l.cantidad));
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `${k}=${n}`).join(';');
  },
  _wcContratoVivoIgual(lineas) {
    const huella = this._wcHuellaLineas(lineas);
    if (!huella) return null;
    return this._wcCandidatos()
      .filter(c => !this._renovadoPor(c) && this._wcHuellaLineas(c.equipos) === huella)
      .sort((a, b) => (b.fecha_creacion?.seconds || 0) - (a.fecha_creacion?.seconds || 0))[0] || null;
  },
  async _wcPreguntarDuplicado(dup) {
    const unid = (dup.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const r = await Modal.sheet({
      title: 'Esta cuenta ya tiene un contrato vivo con estos mismos equipos', icon: 'copy', size: 'md',
      html: `<p style="margin:0 0 10px;font-size:13.5px;line-height:1.5;">
          <b class="cg-mono">${this.esc(dup.contrato_id || dup.id)}</b> (${this.esc(this._estadoLabel(dup))}) tiene exactamente las mismas líneas: ${unid} equipo(s)${dup.total_mensual ? ` por $${Number(dup.total_mensual).toFixed(2)}/mes` : ''}.
        </p>
        <p style="margin:0 0 6px;font-size:13px;color:var(--fg-3);line-height:1.5;">
          Si este contrato <b>rehace</b> aquel (precio, representante, modelo…), dilo aquí: al aprobarlo, el viejo se anula por sustitución y sus seriales pasan solos a este. Dejar los dos vivos amarra el inventario al contrato muerto y las alertas de seriales no paran.
        </p>`,
      buttons: [
        { action: 'cancelar', label: 'Cancelar' },
        { action: 'distinto', label: 'Son cuentas distintas, seguir' },
        { action: 'sustituye', label: `Este sustituye a ${dup.contrato_id || 'aquel'}`, primary: true, icon: 'replace' },
      ],
    });
    return r;
  },
  _wcEnVentana(c) {
    if (!this._aplicaVenc(c) || this._renovadoPor(c)) return false;
    const dias = this._diasA(c.fecha_vencimiento);
    return dias !== null && dias <= this.AVISO_DIAS;
  },
  _wcCustodia() {
    return this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id);
  },
  // Fusión de líneas por modelo: suma cantidades; el precio queda el PRIMERO
  // > 0 en el orden dado (las líneas llegan del contrato más reciente primero,
  // así que gana la tarifa vigente). Clave por modelo_id o por label normalizado.
  _wcMergeLineas(lineas) {
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const out = new Map();
    for (const l of lineas) {
      if (!l) continue;
      // La modalidad separa la fusión: alquiler y equipo-del-cliente del
      // mismo modelo son líneas DISTINTAS (tarifas distintas) en SERV mixto.
      // Sin modalidad (legacy) se fusiona aparte y llega al wizard sin elegir.
      const mod = l.modalidad === 'propio' ? 'propio' : l.modalidad === 'alquiler' ? 'alquiler' : null;
      const k = (l.modelo_id || norm(l.modelo)) + '|' + (mod || '?');
      if (!l.modelo_id && !norm(l.modelo)) continue;
      const cur = out.get(k);
      if (!cur) out.set(k, { modelo_id: l.modelo_id || null, modelo: l.modelo || '', modalidad: mod,
        cantidad: Number(l.cantidad) || 0, precio: Number(l.precio) > 0 ? Number(l.precio) : '' });
      else {
        cur.cantidad += Number(l.cantidad) || 0;
        if (!(cur.precio > 0) && Number(l.precio) > 0) cur.precio = Number(l.precio);
      }
    }
    return [...out.values()];
  },

  async wizContrato(opts) {
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no crea contratos desde aquí', 'warn'); return; }
    if (typeof opts === 'string') opts = { renovarDe: opts };
    opts = opts || {};
    // crearContrato() lee aquí si este contrato nace con cuenta vigente (D6).
    this._wcOpts = opts;
    // B1 (2026-10-07): si al guardar hay un contrato vivo con los mismos
    // equipos, se pregunta una vez; aquí se olvida la respuesta anterior.
    this._wcSustituyeA = null; this._wcDuplicadoVisto = false;
    // Con una renovación en curso no se abre otra: se lleva al trámite.
    if (opts.renovarCuenta || opts.renovarDe) {
      const tram = this._renovacionEnTramite();
      if (tram) {
        Toast.show(`Ya hay una renovación en trámite (${tram.contrato_id || ''}) — te llevo al expediente`, 'warn');
        this.abrirGestion('ct-' + tram.id);
        return;
      }
    }
    this._cerrarModal();
    this.cerrarMenu?.();
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);

    const candidatos = this._wcCandidatos();
    let preIds = [];
    if (opts.renovarDe) preIds = candidatos.some(c => c.id === opts.renovarDe) ? [opts.renovarDe] : [];
    // "Renovar cuenta" = CONSOLIDACIÓN (Alberto 2026-08-28, caso SEPROSA):
    // preselecciona TODOS los contratos vigentes renovables del cliente —
    // adiciones y reemplazos incluidos — para que la renovación los unifique
    // en UN contrato y muera el overhang de contratitos por cliente.
    else if (opts.renovarCuenta) {
      preIds = candidatos.filter(c => this._aplicaVenc(c) && !this._renovadoPor(c)).map(c => c.id);
    }
    const esRenov = !!(opts.renovarDe || opts.renovarCuenta);
    // Contrato TEMPORAL (evento) desde el menú (2026-09-07): entra con el tipo
    // fijo en TEMP, sin origen ni plan — es independiente de la cuenta.
    const esTemp = !esRenov && !!opts.temporal;
    const custodia = this._wcCustodia();
    // Regularización: cuenta sin contratos en el sistema → escape legacy.
    const legacyAuto = esRenov && !preIds.length && !candidatos.length;

    // Prefill de líneas: copia del/los contratos que se renuevan (los más
    // recientes primero — su tarifa es la vigente); en "Renovar cuenta" suma
    // la custodia agrupada por modelo (sin precio — lo fija el vendedor).
    // Después se FUSIONA por modelo: una consolidación de 13 contratitos no
    // debe salir con 13 líneas repetidas del mismo radio. Todo editable.
    let lineas = [];
    const origenesSel = preIds.map(id => candidatos.find(x => x.id === id)).filter(Boolean)
      .sort((a, b) => String(b.contrato_id || '').localeCompare(String(a.contrato_id || '')));
    for (const c of origenesSel) {
      (c.equipos || []).forEach(l => lineas.push({ modelo_id: l.modelo_id, modelo: l.modelo,
        cantidad: l.cantidad, precio: l.precio,
        // Un origen PROP entero era "equipo del cliente" y uno ALQ, alquiler;
        // SERV lo trae por línea — y si no lo trae (legacy), queda SIN
        // modalidad para que el vendedor la declare (no se asume alquiler).
        modalidad: l.modalidad || (this._codigoTipo(c) === 'PROP' ? 'propio' : this._codigoTipo(c) === 'ALQ' ? 'alquiler' : null) }));
    }
    if (opts.renovarCuenta && custodia.length) {
      const porModelo = new Map();
      custodia.forEach(e => {
        // Propiedad desconocida → sin modalidad: la declara el vendedor.
        const mod = e.propiedad === 'cliente' ? 'propio' : (e.propiedad && e.propiedad !== 'desconocida') ? 'alquiler' : null;
        const k = (e.modelo_id || (e.modelo_label || '?')) + '|' + (mod || '?');
        const cur = porModelo.get(k) || { modelo_id: e.modelo_id || null, modelo: e.modelo_label || '', modalidad: mod, cantidad: 0, precio: '' };
        cur.cantidad += 1; porModelo.set(k, cur);
      });
      porModelo.forEach(l => lineas.push(l));
    }
    lineas = this._wcMergeLineas(lineas);
    // "Agregar equipos" (cuenta fragmentada): la venta nueva entra en la misma
    // renovación consolidadora — línea en blanco lista para el equipo nuevo.
    if (opts.agregar) lineas.push(null);
    if (!lineas.length) lineas.push(null);

    const itbmsDefault = this.cliente?.itbms_exento === true ? false
      : (preIds.length ? (candidatos.find(c => c.id === preIds[0])?.itbms_aplica !== false) : true);

    const origenChks = candidatos.map(c => {
      const v = this._aplicaVenc(c) ? this._diasA(c.fecha_vencimiento) : null;
      const chip = v === null ? '' : v < 0 ? ` <span class="cg-venc vencido num">vencido ${-v} d</span>`
        : v <= this.AVISO_DIAS ? ` <span class="cg-venc por_vencer num">${v} d</span>` : '';
      return `<label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:3px 0;">
        <input type="checkbox" data-wco value="${this.esc(c.id)}" ${preIds.includes(c.id) ? 'checked' : ''}
          onchange="Centro._wcSyncPlan()" style="width:auto; margin:0;">
        <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>
        <span style="color:var(--fg-3);">${this.esc(c.tipo_contrato || '')} · ${this._unidadesActivas(c)} unid.</span>${chip}</label>`;
    }).join('');

    this._abrirModalA({
      // Cuenta SIN contratos (legacyAuto): esto ES un contrato nuevo que
      // regulariza la custodia — llamarlo "renovar" confundía (2026-09-01).
      titulo: `${legacyAuto ? 'Nuevo contrato (regulariza la cuenta)'
        : opts.renovarCuenta ? 'Renovar cuenta (consolidación)'
        : esRenov ? 'Renovación' : esTemp ? 'Contrato temporal (evento)' : 'Nuevo contrato'} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 14px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        El contrato nace <b>pendiente de aprobación</b> con el mismo flujo de siempre (aprobación →
        seriales de bodega → firma → activo).
        ${opts.renovarCuenta && preIds.length > 1 ? `Esta renovación <b>consolida los ${preIds.length} contratos
        marcados en UNO solo</b>: al activarse quedan marcados como renovados y pasan al histórico de la ficha.` : ''}
        ${legacyAuto && custodia.length ? `La cuenta no tiene contratos vigentes pero
        <b>${custodia.length} equipo(s) siguen con el cliente</b> — este contrato nuevo los cubre
        y se amarran solos al activarse.` : ''}
        ${!legacyAuto && custodia.length ? `<b>${custodia.length} equipo(s) en campo sin
        contrato formal</b> — al renovar, la cuenta los cubre.` : ''}
        ${opts.agregar ? `<b>La última línea de equipos está en blanco para la venta nueva</b> — elige el modelo,
        cantidad y precio; bodega asignará los seriales solo de los equipos nuevos.` : ''}</p>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Datos del contrato <span class="hint">tipo · duración</span></div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
          <div class="form-field" style="margin:0; max-width:170px;">
            <label class="form-label" for="wcTipo">Tipo</label>
            <select class="form-select" id="wcTipo" onchange="Centro._wcSyncTipo()">
              ${(esTemp ? ['TEMP'] : esRenov ? ['SERV'] : ['SERV', 'TEMP'])
                .map(k => `<option value="${k}" ${k === (esTemp ? 'TEMP' : 'SERV') ? 'selected' : ''}>${this.TIPOS_CONTRATO[k]}</option>`).join('')}
            </select></div>
          <div class="form-field" style="margin:0; max-width:210px;">
            <label class="form-label" for="wcMeses">Duración</label>
            <div style="display:flex; gap:6px;">
              <input class="form-input" type="number" id="wcMeses" min="1" value="${esTemp ? 7 : 18}" style="width:90px;">
              <!-- Días solo para TEMP (eventos cortos, caso FANLYC 2026-09-02:
                   "del 3 al 6 de septiembre" forzado a meses). _wcSyncTipo lo
                   muestra/oculta. -->
              <select class="form-select" id="wcDurUnidad" style="width:100px; ${esTemp ? '' : 'display:none;'}">
                <option value="meses" ${esTemp ? '' : 'selected'}>meses</option>
                <option value="dias" ${esTemp ? 'selected' : ''}>días</option>
              </select>
              <span id="wcDurMesesLbl" style="align-self:center; font-size:13px; color:var(--fg-3); ${esTemp ? 'display:none;' : ''}">meses</span>
            </div></div>
          <p style="margin:0 0 7px; font-size:12.5px; color:var(--fg-3);">
            ${legacyAuto ? 'Regulariza la cuenta: los equipos en campo se amarran a este contrato al activarse.'
              : esRenov ? 'Renovación de la cuenta — los orígenes marcados pasan al histórico al activarse.'
              : esTemp ? 'Contrato temporal por evento: termina con la devolución de los equipos — no renueva ni toca los demás contratos de la cuenta.'
              : 'Contrato nuevo.'}</p>
        </div>
        <!-- La acción NO se pregunta (2026-09-01, "el menú decide"): la fija
             el punto de entrada. Select oculto porque crearContrato y los
             triggers (onRenovacionActivada exige 'Renovación' para amarrar la
             custodia) leen de aquí; DEMO/TEMP mapean a 'No Aplica' en
             _wcSyncTipo, igual que siempre. Los DEMO van por su wizard. -->
        <select id="wcAccion" class="hidden" aria-hidden="true">
          <option value="Nuevo" ${!esRenov ? 'selected' : ''}>Nuevo</option>
          <option value="Renovación" ${esRenov ? 'selected' : ''}>Renovación</option>
          <option value="No Aplica">No Aplica</option>
        </select>
        <!-- "Sin equipo" y "refurbished" ya NO se preguntan (Alberto
             2026-09-04): se derivan del plan por serial del paso 2
             (TransicionPlan.derivarModalidad) y se muestran aquí. -->
        <div id="wcRenovBloque" class="${esRenov ? '' : 'hidden'}" style="margin-top:8px;">
          <div id="wcModalidad" style="font-size:12.5px; color:var(--fg-3);">La modalidad (sin equipo / con reemplazos / refurbished) sale de lo que declares por serial en el paso 2.</div>
        </div>
      </div>

      <div id="wcOrigenBloque" class="cg-paso ${esRenov ? '' : 'hidden'}">
        <div class="cg-paso-t"><span class="n">2</span> ${legacyAuto ? 'Origen de la cuenta' : 'Contratos que se renuevan'}
          <span class="hint">${legacyAuto ? 'sin contratos vigentes en el sistema — queda registrado contra la referencia' : opts.renovarCuenta ? 'preseleccionados — la consolidación los absorbe todos' : 'el origen define qué equipos transicionan'}</span></div>
        <div class="form-field" style="margin-bottom:10px;">
          ${origenChks || (legacyAuto ? '' : '<p style="font-size:13px; color:var(--fg-3); margin:0;">El cliente no tiene contratos vigentes en el sistema.</p>')}
          <label style="display:flex; gap:8px; align-items:center; font-size:13px; padding:6px 0 0;">
            <input type="checkbox" id="wcLegacy" ${legacyAuto ? 'checked' : ''} onchange="Centro._wcSyncPlan()" style="width:auto; margin:0;">
            El contrato original es de papel / no está en el sistema</label>
          <input class="form-input" id="wcLegacyRef" placeholder="Referencia del contrato en papel…" aria-label="Referencia del contrato en papel"
            value="${legacyAuto ? 'Cuenta sin contrato en sistema — regularización' : ''}"
            style="margin-top:6px; max-width:420px; ${legacyAuto ? '' : 'display:none;'}">
        </div>
        <div class="form-field" style="margin-bottom:4px;">
          <label class="form-label">Seriales de la cuenta — qué pasa con cada equipo</label>
          <p style="margin:0 0 8px; font-size:12.5px; color:var(--fg-3); max-width:72ch;">
            Todo lo que el sistema cree que el cliente tiene, con su destino. Marca <b>“El cliente no lo
            tiene”</b> en lo que no está con él (queda por clasificar y sale de la cuenta) y <b>agrega</b> los
            seriales que sí tiene y no aparecen. Los que <b>continúan</b> entran al Anexo A que el cliente firma.</p>
          <div id="wcPlan" class="cg-twrap"></div>
        </div>
      </div>

      <div oninput="Centro._wcPreview(); Centro._wcConciliar()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Equipos y tarifas
          <span class="hint">fusionados por modelo — la tarifa vigente manda</span></div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="wcLineas">${lineas.map(l => this._lineaModeloPre('wcm', true, l)).join('')}</div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('wcLineas').insertAdjacentHTML('beforeend', Centro._lineaModeloPre('wcm', true)); Centro._wcPreview()">+ Agregar otro modelo</button></div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Otros conceptos (cargos del catálogo — únicos o mensuales)</label>
          <div id="wcCargos"></div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('wcCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml())">+ Agregar cargo</button></div>
        <label class="cg-toggle">
          <input type="checkbox" id="wcItbms" ${itbmsDefault ? 'checked' : ''} onchange="Centro._wcPreview()">
          Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}
        </label>
        <div id="wcTot" class="ds-card" style="padding:10px 14px; max-width:380px; margin-top:10px;"></div>
      </div>

      ${opts.nuevoConVigente ? `
      <div class="cg-paso" id="wcMotivoNuevoBloque">
        <div class="cg-paso-t">¿Por qué un contrato nuevo y no un anexo o renovación? <span class="hint">obligatorio</span></div>
        <p style="margin:0 0 6px; font-size:12.5px; color:var(--fg-3); max-width:72ch;">
          Esta cuenta ya tiene contrato vigente: lo normal es <b>Agregar equipos</b> (anexo) o <b>Renovar cuenta</b>.
          Un contrato aparte es un respaldo (otra sede, otro servicio). La razón queda guardada en el contrato y se ve en el expediente.</p>
        <textarea class="form-input" id="wcMotivoNuevo" rows="2" style="resize:vertical;" minlength="10" required
          placeholder="Ej.: sucursal de Colón con facturación aparte" aria-label="Por qué un contrato nuevo"></textarea>
      </div>` : ''}

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">4</span> Observaciones <span class="hint">opcional</span></div>
        <textarea class="form-input" id="wcObs" rows="2" style="resize:vertical;" aria-label="Observaciones"></textarea>
      </div>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">5</span> Representante legal</div>
        ${this._wcRepHtml()}
      </div>
      </div>`,
      footer: `
        <button type="button" id="wcGuardarMotivo" class="btn btn-ghost cg-act hidden" style="color:var(--warn-deep, #92400E); font-size:12.5px;"
          onclick="Centro._wcIrAlCheck()" title="Ir al paso 5">Falta validar el representante legal (paso 5) ↓</button>
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="wcGuardar" onclick="Centro.crearContrato()">Guardar contrato</button>`,
    });
    document.getElementById('wcLegacy')?.addEventListener('change', (e) => {
      const ref = document.getElementById('wcLegacyRef');
      if (ref) ref.style.display = e.target.checked ? '' : 'none';
    });
    this._wcRepMontar();
    this._wcPlanState = { destinos: {}, reemplazos: {}, refurb: {}, agregados: [] };
    this._ssReset('wcp');
    // Precarga (plan 2026-09-08 §5): al regularizar/renovar la cuenta, los
    // radios en campo SIN contrato (D1) entran como "Continúa" — es lo que la
    // deuda dice que el cliente tiene. El vendedor los corrige si no es así;
    // los del contrato de origen siguen pidiendo destino explícito.
    if (opts.renovarCuenta) {
      for (const { u, fuente } of this._wcUnidadesCuenta(preIds)) {
        if (fuente === 'custodia') this._wcPlanState.destinos[u.id] = 'continua';
      }
    }
    this._wcSoloPlan = false;
    // TEMP fijo: la acción pasa a 'No Aplica' y se esconde el bloque de origen
    // (lo mismo que hace el select al cambiar a mano).
    if (esTemp) this._wcSyncTipo();
    this._wcSyncPlan();
    this._wcPreview();
  },

  _wcSyncTipo() {
    const tipo = document.getElementById('wcTipo')?.value || 'SERV';
    const acc = document.getElementById('wcAccion');
    if (!acc) return;
    if (tipo === 'DEMO' || tipo === 'TEMP') { acc.value = 'No Aplica'; acc.disabled = true; }
    else {
      acc.disabled = false;
      if (acc.value === 'No Aplica') acc.value = 'Nuevo';
    }
    // TEMP (evento) puede durar DÍAS: aparece el selector de unidad, con
    // días por defecto y un valor corto razonable; al volver a SERV, meses.
    const uni = document.getElementById('wcDurUnidad');
    const lbl = document.getElementById('wcDurMesesLbl');
    const num = document.getElementById('wcMeses');
    if (uni && lbl && num) {
      if (tipo === 'TEMP') {
        uni.style.display = ''; lbl.style.display = 'none';
        if (uni.value === 'meses' && Number(num.value) >= 12) { uni.value = 'dias'; num.value = 7; }
      } else {
        uni.style.display = 'none'; lbl.style.display = '';
        uni.value = 'meses';
        if (Number(num.value) < 12 && Number(num.value) <= 31) num.value = 18;
      }
    }
    const sel = { accion: acc.value, codigo_tipo: tipo };
    document.getElementById('wcOrigenBloque')?.classList.toggle('hidden', !OrigenContrato.aplica(sel));
    document.getElementById('wcRenovBloque')?.classList.toggle('hidden', acc.value !== 'Renovación');
    this._wcSyncPlan();
  },

  _wcOrigenIds() {
    return [...document.querySelectorAll('input[data-wco]:checked')].map(i => i.value);
  },
});
