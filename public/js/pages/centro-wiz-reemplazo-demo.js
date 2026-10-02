// @ts-nocheck
// Centro de gestión de clientes — Wizards: reemplazo y demo.
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Wizards: reemplazo y demo ═════════ */

  // Catálogo de modelos (colección `modelos`) — regla de Alberto 2026-08-26:
  // los wizards SIEMPRE ofrecen la lista real, nunca texto libre.
  modelos: null,
  async _cargarModelos() {
    if (this.modelos) return this.modelos;
    try {
      const todos = await ModelosService.getModelos();
      this.modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim() }))
        .filter(m => m.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('[centro] catálogo de modelos no disponible:', e?.message || e);
      this.modelos = [];
    }
    return this.modelos;
  },
  // <select> del catálogo. Preselecciona por id del catálogo o por label.
  _selModelo(attrs, selId, selLabel) {
    const up = String(selLabel || '').trim().toUpperCase();
    const opts = (this.modelos || []).map(m => {
      const sel = (selId && m.id === selId)
        || (!selId && up && (m.label.toUpperCase() === up || (up && m.label.toUpperCase().includes(up))));
      return `<option value="${this.esc(m.id)}" ${sel ? 'selected' : ''}>${this.esc(m.label)}</option>`;
    }).join('');
    return `<select class="form-select" ${attrs}><option value="">— Modelo —</option>${opts}</select>`;
  },
  _modeloDeSelect(sel) {
    const id = sel?.value || '';
    if (!id) return null;
    const m = (this.modelos || []).find(x => x.id === id);
    return m ? { id: m.id, label: m.label } : null;
  },

  MOTIVOS: [
    ['dano_no_reparable', 'Dañado — no reparable (diagnóstico de taller)'],
    ['falla_recurrente', 'Falla recurrente'],
    ['garantia_fabrica', 'Garantía de fábrica'],
    ['actualizacion', 'Actualización de modelo'],
    ['servicio_cliente', 'Servicio al cliente'],
    ['otro', 'Otro'],
  ],

  // Motivos del CAMBIO DE SERIAL. Son otros que los del reemplazo a propósito:
  // aquí nadie va a buscar un radio — se corrige lo que quedó mal anotado.
  // "Cambiado en el mostrador" es el caso real que más se repite: bodega
  // entregó otro radio del mismo modelo y el papel se quedó con el primero.
  MOTIVOS_CAMBIO_SERIAL: [
    ['error_captura', 'Serial mal digitado al registrarlo'],
    ['cambiado_mostrador', 'Bodega entregó otro radio y no se actualizó'],
    ['defectuoso', 'El radio salió defectuoso y se cambió antes de entregarlo'],
    ['otro', 'Otro'],
  ],
  // Tipos de daño que declara el taller (mismas claves que
  // functions/src/lib/reposicionDano.TIPOS_DANO y OrdenesReemplazo.TIPOS_DANO).
  TIPOS_DANO: {
    golpe: 'Golpe o caída',
    liquido: 'Líquido o humedad',
    carcasa: 'Carcasa, pantalla o antena rota',
    manipulacion: 'Manipulación o sellos violados',
    otro: 'Otro daño físico',
  },
  get MOTIVOS_CAMBIO_SERIAL_LABEL() {
    return Object.fromEntries(this.MOTIVOS_CAMBIO_SERIAL);
  },

  // ── Modales del Centro: hojas del kit (Modal.sheet, 2026-09-10) ────────
  // Antes esto pintaba a mano dentro de un <div id="cgModal"> con CSS suelto
  // en la propia página (.cg-overlay/.cg-modal). Un resto de declaración
  // huérfano invalidó esa regla entre el 26-ago y el 9-sep-2026 y los modales
  // salieron al PIE de la página, sin fondo ni centrado: había que scrollear
  // para verlos. Ahora el centrado, el z-index y la anatomía los pone
  // ceco-ui.css, que tiene guardias (K3, K9, K10).
  //
  // Las firmas no cambian: `_abrirModal(html)` para el modal simple (el
  // contenido trae su propio título y sus botones) y `_abrirModalA({...})`
  // para la anatomía. El nodo raíz conserva el id `cgModal`, así que los
  // `document.querySelector('#cgModal …')` de la página siguen sirviendo.
  _abrirModal(html, size = 'lg') {
    this._montarHoja({ html, size, focoEn: '.modal-body' });
  },

  // Anatomía del kit (header fijo + cuerpo scrolleable + footer fijo) para los
  // modales largos: el título y las acciones nunca se pierden con el scroll.
  // Banda de regularización en los wizards (plan 2026-09-08 §4.3): un renglón,
  // nunca bloquea. Dice cuánta deuda hay y que esta gestión quedará como
  // puntual (#n). banda:false para los modales que no crean nada.
  _bandaReg() {
    const r = this._reg();
    if (!r || typeof Regularizacion === 'undefined') return '';
    // Sin D7 (decisión 8, 1-oct-2026): lo de bodega no es deuda de la cuenta.
    const puntos = Regularizacion.puntosCuenta(r);
    if (!(puntos > 0)) return '';
    const n = (Number(r.gestiones_puntuales) || 0) + 1;
    const bad = r.nivel === 'critica' || r.excede_margen;
    // UN renglón de contexto bajo el título (2026-09-08): el campo va primero.
    return `<div class="cg-banda-reg" style="display:flex; gap:10px; align-items:center; margin:-4px 0 12px; font-size:12.5px; color:${bad ? 'var(--cg-bad-deep, #991B1B)' : 'var(--cg-warn-deep, #92400E)'};">
      <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><b>Cuenta por regularizar · ${puntos}</b> · gestión puntual #${n}${r.excede_margen ? ' · excede el margen' : ''}</span>
      <button type="button" style="background:none; border:0; padding:0; font:inherit; font-weight:600; color:var(--accent); cursor:pointer; white-space:nowrap;" onclick="Centro.verRegularizacion()">Qué falta</button>
    </div>`;
  },

  _abrirModalA({ titulo, cuerpo, footer, banda = true, size = 'lg' }) {
    this._montarHoja({
      titleHtml: titulo,
      html: (banda ? this._bandaReg() : '') + cuerpo,
      footerHtml: footer || '',
      size,
      focoEn: '.modal-body',
    });
  },

  // Una hoja a la vez: abrir otra cierra la anterior, igual que cuando todas
  // compartían el mismo div. El foco va al primer campo del CUERPO (no al
  // botón del pie, que es lo que enfoca el kit por defecto): estos modales
  // son formularios y wizards, y ahí se empieza escribiendo.
  _montarHoja({ titleHtml = '', html = '', footerHtml = '', size = 'lg', focoEn = '' }) {
    this._cerrarModal();
    let propia = null;
    Modal.sheet({
      titleHtml, html, footerHtml, size,
      onMount: (root, api) => {
        propia = api;
        this._hojaApi = api;
        root.id = 'cgModal';
        if (focoEn) {
          setTimeout(() => root.querySelector(
            `${focoEn} input:not([type=hidden]), ${focoEn} select, ${focoEn} textarea, ${focoEn} button`
          )?.focus(), 60);
        }
      },
    }).then(() => { if (this._hojaApi === propia) this._hojaApi = null; });
  },

  _cerrarModal() {
    const api = Centro._hojaApi;
    Centro._hojaApi = null;
    if (api) api.close(null);
  },

  // Elegibilidad de un equipo del pool para reemplazo (decisiones §8):
  // alquiler siempre; propio adquirido en CECOMUNICA siempre (sin garantía →
  // excepción con aprobación admin); comprado fuera → bloqueado.
  _eleg(e) {
    if (!['en_cliente', 'asignado_contrato'].includes(e.estado)) {
      return { ok: false, label: 'No disponible', why: `El equipo no está con el cliente (${e.estado}).` };
    }
    if (e.propiedad === 'cliente') {
      if (!e.venta) return { ok: false, label: 'No adquirido en CECOMUNICA', why: 'Equipo del cliente comprado fuera — no aplica reemplazo.' };
      // Una sola definición de garantía, compartida con la propuesta del
      // taller (domain/garantiaEquipo.js): la fecha declarada manda y, si no
      // la hay, se muestra la derivada de la factura (12 meses, cláusula 8)
      // marcada como estimada. Quién aprueba no cambia por la estimada.
      const g = GarantiaEquipo.garantia(e);
      const txt = GarantiaEquipo.textoGarantia(g);
      if (!GarantiaEquipo.requiereExcepcion(g)) {
        return { ok: true, code: 'propio_garantia', label: `Propio · ${txt}` };
      }
      return { ok: true, code: 'propio_excepcion', label: `Propio · ${txt || 'sin garantía'}`,
               why: 'Se permite por servicio al cliente — requiere aprobación de administración.' };
    }
    return { ok: true, code: 'alquiler', label: e.propiedad === 'desconocida' ? 'Alquiler (propiedad por confirmar)' : 'Alquiler' };
  },

  // Seriales declarados a mano en el wizard de reemplazo: radios que el
  // cliente tiene y el sistema no conoce (2026-09-09). Viven junto a
  // `this.equipos` en la misma tabla; el índice de las filas sigue después.
  _wrExtras: [],
  _wrUnidad(ix) { return this.equipos[ix] || this._wrExtras[ix - this.equipos.length] || null; },

  async wizReemplazo() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarModelos();
    this._wrExtras = [];
    const filas = this._wrFilasHtml();
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Nueva solicitud de reemplazo — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Marca los seriales a reemplazar (pueden ser de contratos distintos) e indica motivo y modelo.
        Todo reemplazo pasa por aprobación de administración antes de que bodega lo prepare.</p>
      <div class="cg-twrap" style="max-height:44vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th><th>Elegibilidad</th>
        </tr></thead><tbody id="wrCuerpo">${filas}</tbody></table></div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;">
        <input class="form-input" id="wrSerialNuevo" style="max-width:230px;" aria-label="Serial a declarar"
          placeholder="Serial dañado que no aparece…"
          onkeydown="if(event.key==='Enter'){event.preventDefault();Centro._wrAgregarSerial();}">
        ${this._selModelo('id="wrModeloNuevo" style="max-width:200px;" aria-label="Modelo del serial a declarar"')}
        <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wrAgregarSerial()">+ Declarar serial</button>
        <span style="font-size:12px; color:var(--fg-4); flex:1; min-width:220px;">Si el sistema no lo conoce, queda declarado
          en la cuenta del cliente al enviar la solicitud — sin contrato, así que la cuenta seguirá pidiendo regularización.</span>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearReemplazo(this)">Enviar solicitud</button>
      </div>`);
  },

  // Cuerpo de la tabla del wizard: la flota del pool + los seriales que el
  // vendedor declaró a mano. Los índices son estables (los extras van al
  // final), así que lo ya tecleado se restaura tal cual al re-pintar.
  _wrFilasHtml() {
    const unidades = [...this.equipos, ...this._wrExtras];
    const filas = unidades.map((e, ix) => {
      const extra = ix >= this.equipos.length;
      const el = extra ? { ok: true, code: 'alquiler', label: 'Declarado por ti', why: 'El sistema no lo conocía: la ficha nace con esta solicitud, en campo y sin contrato.' } : this._eleg(e);
      return `<tr style="${el.ok ? '' : 'opacity:.5;'}">
        <td>${el.ok ? `<input type="checkbox" data-wsel="${ix}" ${extra ? 'checked' : ''} onchange="Centro._wizFila(${ix}, this.checked)">` : ''}</td>
        <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
        <td>${this.esc(e.modelo_label || '—')}</td>
        <td class="cg-mono" style="font-size:12px;">${extra ? '<span style="color:var(--fg-4);">sin contrato</span>' : this.esc(e.asignacion?.contrato_id || '—')}</td>
        <td style="font-size:12.5px;">${this.esc(el.label)}${el.why ? `<br><span style="color:var(--fg-4);font-size:11.5px;">${this.esc(el.why)}</span>` : ''}
          ${extra ? `<button type="button" class="btn btn-ghost" style="padding:1px 7px; margin-left:6px;" title="Quitar"
            onclick="Centro._wrQuitarSerial(${ix - this.equipos.length})">✕</button>` : ''}</td>
      </tr>
      <tr id="wcfg-${ix}" class="${extra ? '' : 'hidden'}"><td></td><td colspan="4" style="background:var(--surface-sunken, #EEF2F6);">
        <div style="display:flex; gap:10px; flex-wrap:wrap; padding:4px 0;">
          <select class="form-select" data-wmot="${ix}" style="max-width:280px;">
            <option value="">— Motivo —</option>
            ${this.MOTIVOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
          ${this._selModelo(`data-wmod="${ix}" style="max-width:220px;"`, e.modelo_id, e.modelo_label)}
          <input class="form-input" data-wdet="${ix}" style="flex:1; min-width:180px;" placeholder="Detalle (opcional)">
        </div></td></tr>`;
    }).join('');
    return filas || '<tr><td colspan="5" class="cg-empty">El cliente no tiene equipos en campo — declara abajo el serial dañado.</td></tr>';
  },

  _wrRepintar() {
    const prev = [...document.querySelectorAll('#wrCuerpo [data-wsel]')].map(i => ({
      ix: Number(i.dataset.wsel), on: i.checked,
      mot: document.querySelector(`select[data-wmot="${i.dataset.wsel}"]`)?.value || '',
      mod: document.querySelector(`select[data-wmod="${i.dataset.wsel}"]`)?.value || '',
      det: document.querySelector(`input[data-wdet="${i.dataset.wsel}"]`)?.value || '',
    }));
    const cont = document.getElementById('wrCuerpo');
    if (!cont) return;
    cont.innerHTML = this._wrFilasHtml();
    for (const p of prev) {
      const chk = document.querySelector(`input[data-wsel="${p.ix}"]`);
      if (chk) { chk.checked = p.on; this._wizFila(p.ix, p.on); }
      const mot = document.querySelector(`select[data-wmot="${p.ix}"]`); if (mot && p.mot) mot.value = p.mot;
      const mod = document.querySelector(`select[data-wmod="${p.ix}"]`); if (mod && p.mod) mod.value = p.mod;
      const det = document.querySelector(`input[data-wdet="${p.ix}"]`); if (det) det.value = p.det;
    }
  },

  _wrQuitarSerial(i) {
    this._wrExtras.splice(i, 1);
    this._wrRepintar();
  },

  // Declarar un serial dañado que el sistema no conoce (Alberto 2026-09-09:
  // "otro caso: hay que reemplazar un equipo que no está en el sistema").
  // La ficha NO se crea desde aquí —las reglas no dejan a un vendedor crear
  // fichas del pool, y con razón— sino en el trigger al enviar la solicitud.
  async _wrAgregarSerial() {
    const inp = document.getElementById('wrSerialNuevo');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (!EquiposPoolService.esSerialValido(norm)) { Toast.show('Ese serial no parece válido', 'warn'); return; }
    const yaEnLista = [...this.equipos, ...this._wrExtras]
      .some(e => EquiposPoolService.normalizarSerial(e.serial || e.id) === norm);
    if (yaEnLista) { Toast.show(`${norm} ya está en la lista de arriba`, 'warn'); return; }
    let ficha = null;
    try { ficha = await EquiposPoolService.findBySerial(raw); } catch (_) { /* sin red: se declara igual */ }
    if (ficha) {
      // Existe pero no salió en la lista: está en bodega, en taller, con otro
      // cliente… Eso no se arregla declarándolo — se dice qué pasa.
      const L = EquiposPoolService.ESTADO_LABELS || {};
      const otro = ficha.asignacion?.cliente_id && ficha.asignacion.cliente_id !== this.cliente.id
        ? ` y figura con ${ficha.asignacion.cliente_nombre || 'otro cliente'}` : '';
      Toast.show(`${norm} sí está en el sistema (${L[ficha.estado] || ficha.estado}${otro}) — revísalo en Inventario antes de reemplazarlo`, 'warn');
      return;
    }
    const m = this._modeloDeSelect(document.getElementById('wrModeloNuevo'));
    if (!m) { Toast.show('Elige el modelo del serial que estás declarando', 'warn'); return; }
    this._wrExtras.push({ id: norm, serial: raw, serial_norm: norm, modelo_id: m.id, modelo_label: m.label,
      estado: 'en_cliente', propiedad: 'desconocida', asignacion: null, sin_ficha: true });
    if (inp) inp.value = '';
    this._wrRepintar();
    inp?.focus();
  },

  _wizFila(ix, on) {
    document.getElementById(`wcfg-${ix}`)?.classList.toggle('hidden', !on);
  },

  // Candado contra el doble submit (auditoría UX 2026-09-28, P0 #10): cada
  // click consumía un correlativo y mandaba un correo de aprobación.
  crearReemplazo(btn) {
    return withBusy(btn || null, () => this._crearReemplazo(), { key: 'crearReemplazo', label: 'Enviando…', rethrow: false });
  },
  async _crearReemplazo() {
    const seleccion = [...document.querySelectorAll('input[data-wsel]:checked')].map(i => Number(i.dataset.wsel));
    if (!seleccion.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const items = [];
    for (const ix of seleccion) {
      const e = this._wrUnidad(ix);
      if (!e) continue;
      // Declarado a mano: no hay ficha todavía, la crea el trigger al enviar.
      const el = e.sin_ficha ? { code: 'alquiler' } : this._eleg(e);
      const motivo = document.querySelector(`select[data-wmot="${ix}"]`)?.value || '';
      if (!motivo) { Toast.show(`Indica el motivo del serial ${e.serial}`, 'warn'); return; }
      const contrato = this.contratos.find(c => c.id === e.asignacion?.contrato_doc_id);
      const modeloSel = this._modeloDeSelect(document.querySelector(`select[data-wmod="${ix}"]`));
      if (!modeloSel) { Toast.show(`Elige el modelo de reemplazo del serial ${e.serial} (lista de modelos)`, 'warn'); return; }
      items.push({
        serial_saliente: e.serial || e.id,
        pool_doc_id_saliente: e.sin_ficha ? null : e.id,
        ...(e.sin_ficha ? { saliente_sin_ficha: true } : {}),
        modelo: e.modelo_label || '',
        modelo_id: e.modelo_id || null,
        contrato_doc_id: e.asignacion?.contrato_doc_id || null,
        contrato_id: e.asignacion?.contrato_id || contrato?.contrato_id || null,
        elegibilidad: el.code || 'alquiler',
        motivo_codigo: motivo,
        motivo_detalle: document.querySelector(`input[data-wdet="${ix}"]`)?.value.trim() || '',
        modelo_solicitado: modeloSel.label,
        modelo_solicitado_id: modeloSel.id,
        serial_nuevo: null, pool_doc_id_nuevo: null,
      });
    }
    // TODO reemplazo pasa por administración (Alberto 2026-09-10) — el buzón
    // se llama ventas@cecomunica.com pero le llega a los admin de la empresa.
    // Antes solo se frenaba la excepción (equipo propio sin garantía) y el
    // resto —que es la mayoría: alquiler— salía derecho a Bodega:
    // administración se enteraba del reemplazo cuando el radio ya estaba
    // asignado. Un reemplazo es un equipo
    // que sale del estante y una devolución que hay que ir a buscar; eso se
    // decide, no se avisa. La excepción sigue distinguida en el correo porque
    // lo que se aprueba ahí es otra cosa (cortesía sobre un equipo del cliente).
    const excepcion = items.some(it => it.elegibilidad === 'propio_excepcion');
    try {
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
        tipo: 'reemplazo',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_aprobacion',
        origen: { tipo: 'vendedor' },
        items,
        aprobacion: { requiere: true, motivo: excepcion ? 'propio_excepcion' : 'reemplazo' },
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(excepcion
        ? `Solicitud ${gid} creada — excepción: espera la aprobación de administración`
        : `Solicitud ${gid} creada — administración la aprueba y ahí Bodega recibe el aviso`, 'ok');
      await this.recargarGestiones();
      // El JSON para recepción se ofrece AQUÍ, que es cuando el vendedor tiene
      // el caso fresco. Era un confirm que cortaba el flujo justo al terminar
      // (auditoría UX 2026-09-28): ahora es un botón en el aviso, y sigue a
      // mano en el expediente ("JSON para recepción").
      this._toastAccion(`JSON para recepción: nombre, grupos y GPS de ${items.length === 1 ? 'el radio que sale' : `los ${items.length} radios que salen`}.`,
        'Descargar', () => this.jsonReemplazoRecepcion(gid), '', 12000);
    } catch (e) { console.error(e); Toast.show('No se pudo crear la solicitud', 'bad'); }
  },

  // ── JSON del reemplazo para recepción (vendedores, 2026-09-10) ───────────
  // Lo que el radio nuevo tiene que heredar del que sustituye —nombre, grupos
  // y GPS—, en el mismo formato que el lote de POC ya sabe leer. Sale de la
  // ficha POC del saliente: la misma fuente que ese lote jala solo, pero
  // descargable, para que el vendedor se lo pueda mandar a recepción por
  // adelantado o por fuera del sistema.
  //
  // No lleva seriales ni Unit ID a propósito: el serial del que entra lo pone
  // bodega al asignar, y el Unit ID lo asigna el lote (consecutivo propio). El
  // orden de las filas es el de los ítems de la gestión.
  async jsonReemplazoRecepcion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.tipo !== 'reemplazo') { Toast.show('No se encontró la gestión.', 'bad'); return; }
    const items = (g.items || []).filter(it => String(it.serial_saliente || '').trim());
    if (!items.length) { Toast.show('Esta gestión no tiene seriales salientes declarados.', 'warn'); return; }
    if (typeof PocService === 'undefined') { Toast.show('No se pudo consultar POC desde esta pantalla.', 'bad'); return; }

    try {
      const cfgs = await PocService.configDelSaliente({
        clienteId: g.cliente_id || this.cliente?.id || null,
        clienteNombre: g.cliente_nombre || this.cliente?.nombre || '',
        salientes: items.map(it => it.serial_saliente),
        fresh: true,
      });

      const filas = items.map(it => {
        const cfg = cfgs.get(Serial.clave(it.serial_saliente)) || null;
        return {
          // cliente_id/cliente_nombre los usa el lote para auto-elegir cliente.
          cliente_id: g.cliente_id || '',
          cliente_nombre: g.cliente_nombre || '',
          radio_name: cfg?.radio_name || '',
          gps: cfg?.gps || false,
          grupos: cfg ? cfg.grupos : [],
          // El modelo que ENTRA: el de la ficha del radio asignado y, si aún
          // no lo hay, el solicitado — nunca el del saliente.
          modelo_id: it.modelo_id_nuevo || it.modelo_solicitado_id || it.modelo_id || '',
          modelo_label: it.modelo_nuevo || it.modelo_solicitado || it.modelo || '',
          // Referencia para quien lo lea; el lote de POC ignora estos dos.
          serial_saliente: it.serial_saliente,
          ficha_saliente: cfg ? (cfg.cerrada ? 'cerrada' : 'viva') : 'sin ficha en POC',
        };
      });

      const sin = filas.filter(f => !f.radio_name && !(f.grupos || []).length).length;
      if (sin && !await Modal.confirm({
        title: 'Salientes sin ficha en POC',
        confirmLabel: 'Descargar de todos modos',
        message: `${sin} de ${filas.length} radio(s) que salen no tienen ficha en POC con este cliente: van sin nombre ni grupos y recepción tendrá que llenarlos a mano.`,
      })) return;

      const blob = new Blob([JSON.stringify(filas, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `reemplazo-${gid}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      Toast.show(`JSON de ${filas.length} radio(s) descargado${sin ? ` — ${sin} sin datos del saliente` : ''}.`, sin ? 'warn' : 'ok');
    } catch (e) {
      console.error('[centro] JSON de reemplazo para recepción:', e);
      Toast.show('No se pudo leer la configuración de los radios salientes.', 'bad');
    }
  },
});
