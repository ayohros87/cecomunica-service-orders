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
      const aLabel = (m) => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim() });
      this.modelos = (todos || [])
        .filter(m => m.activo !== false)
        .map(aLabel)
        .filter(m => m.label)
        .sort((a, b) => a.label.localeCompare(b.label));
      // Retirados del catálogo (activo:false): no se ofrecen, pero una línea
      // que ya los trae (contrato viejo, serial de la cuenta) los conserva
      // como opción elegida en vez de quedar en "— Modelo —" y perder el dato.
      this._modelosRetirados = new Map((todos || []).filter(m => m.activo === false).map(aLabel).map(m => [m.id, m]));
    } catch (e) {
      console.warn('[centro] catálogo de modelos no disponible:', e?.message || e);
      this.modelos = [];
    }
    return this.modelos;
  },
  // <select> del catálogo. Preselecciona por id del catálogo o por label;
  // sin dato, arranca en "— Modelo —" (auditoría de módulos 2026-09-30, B3:
  // nunca un modelo por defecto). El label parcial solo cuenta si apunta a UN
  // modelo: "AP32X" casaba con "HYTERA AP32X" y "Hytera AP32X R" y se quedaba
  // con el primero del orden alfabético.
  _selModelo(attrs, selId, selLabel) {
    const up = String(selLabel || '').trim().toUpperCase();
    const lista = this.modelos || [];
    const retirado = selId && !lista.some(m => m.id === selId) ? this._modelosRetirados?.get(selId) : null;
    let elegido = selId && (lista.some(m => m.id === selId) || retirado) ? selId : null;
    if (!elegido && !selId && up) {
      const exacto = lista.find(m => m.label.toUpperCase() === up);
      const parciales = exacto ? [] : lista.filter(m => m.label.toUpperCase().includes(up));
      elegido = exacto ? exacto.id : (parciales.length === 1 ? parciales[0].id : null);
    }
    const opts = (retirado ? `<option value="${this.esc(retirado.id)}" selected>${this.esc(retirado.label)} (retirado)</option>` : '')
      + lista.map(m =>
      `<option value="${this.esc(m.id)}" ${m.id === elegido ? 'selected' : ''}>${this.esc(m.label)}</option>`).join('');
    return `<select class="form-select" ${attrs}><option value="" ${elegido ? '' : 'selected'}>— Modelo —</option>${opts}</select>`;
  },
  _modeloDeSelect(sel) {
    const id = sel?.value || '';
    if (!id) return null;
    const m = (this.modelos || []).find(x => x.id === id) || this._modelosRetirados?.get(id);
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
  //
  // El ESTADO del pool ya no bloquea (Alberto 2026-10-06, CONCORD): 13 de sus
  // 15 radios seguían "en taller" porque la entrega de la programación nunca
  // se registró, y el vendedor no podía marcar el dañado. El vendedor es quien
  // habla con el cliente: si dice que lo tiene, se le cree. La fila avisa el
  // desfase, el ítem lo lleva en `estado_en_sistema` y administración lo ve
  // al aprobar. La devolución/ENTRADA del saliente termina de limpiar el dato.
  _eleg(e) {
    const r = this._elegBase(e);
    if (!r.ok || ['en_cliente', 'asignado_contrato'].includes(e.estado) || e.sin_ficha) return r;
    const L = (window.EquiposPoolService && EquiposPoolService.ESTADO_LABELS) || {};
    const aviso = `El sistema lo tiene "${L[e.estado] || e.estado || 'sin estado'}" — al marcarlo confirmas que el cliente lo tiene.`;
    return { ...r, desfase: e.estado || 'sin_estado', why: r.why ? `${r.why} ${aviso}` : aviso };
  },
  _elegBase(e) {
    // Un radio que cuelga de un contrato de ALQUILER es nuestro, diga lo que
    // diga `propiedad` (2026-10-06, CONCORD 25725A0547: la migración lo marcó
    // "del cliente" cuando estaba con otro cliente y bodega lo volvió a
    // alquilar). El contrato manda; la propiedad queda por confirmar.
    const ctr = e.asignacion?.contrato_doc_id && (this.contratos || []).find(c => c.id === e.asignacion.contrato_doc_id);
    const enAlquiler = /alquiler/i.test(String(ctr?.tipo || ctr?.tipo_contrato || ''))
      || /^ALQ/i.test(String(e.asignacion?.contrato_id || ''));
    if (e.propiedad === 'cliente' && !e.venta && enAlquiler) {
      return { ok: true, code: 'alquiler', label: 'Alquiler (propiedad por confirmar)',
        why: `Figuraba como del cliente, pero está en el contrato de alquiler ${e.asignacion.contrato_id || ''}.`.replace(' .', '.') };
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

  // opts.pre: ids del pool marcados en la pestaña Equipos de la ficha
  // (2026-10-08): llegan ya marcados, con su fila de motivo/modelo abierta.
  async wizReemplazo(opts = {}) {
    this._cerrarModal();
    this.cerrarMenu?.();
    await this._cargarModelos();
    this._wrExtras = [];
    this._ssReset('wr');
    const filas = this._wrFilasHtml();
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Nueva solicitud de reemplazo — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        Busca el serial (o abre su contrato) y márcalo; pueden ser de contratos distintos. Indica motivo y modelo.
        Todo reemplazo pasa por aprobación de administración antes de que bodega lo prepare.</p>
      ${this._wrBarra}
      <div class="cg-twrap" style="max-height:44vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th><th>Elegibilidad</th>
        </tr></thead><tbody id="wrCuerpo" data-sscuerpo="wr">${filas}</tbody></table></div>
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
    this._ssMontar('wr');
    if (Array.isArray(opts.pre) && opts.pre.length) {
      this._ssPreMarcar('wr', opts.pre.map(pid => {
        const ix = this.equipos.findIndex(e => e.id === pid);
        return { inp: ix >= 0 ? document.querySelector(`#cgModal input[data-wsel="${ix}"]`) : null, on: () => this._wizFila(ix, true) };
      }));
    }
  },

  // Cuerpo de la tabla del wizard: la flota del pool + los seriales que el
  // vendedor declaró a mano. Los índices son estables (los extras van al
  // final), así que lo ya tecleado se restaura tal cual al re-pintar.
  // Las filas van por el selector compartido (centro-selector-seriales.js):
  // buscador, un grupo por contrato, "No disponible" al final y cerrado.
  _wrBarra: '',
  _wrFilasHtml() {
    const unidades = [...this.equipos, ...this._wrExtras];
    const filas = unidades.map((e, ix) => {
      const extra = ix >= this.equipos.length;
      const el = !extra ? this._eleg(e)
        : e.sin_ficha ? { ok: true, code: 'alquiler', label: 'Declarado por ti', why: 'El sistema no lo conocía: la ficha nace con esta solicitud, en campo y sin contrato.' }
        : { ...this._eleg(e), label: 'Declarado por ti' };
      const contrato = extra ? '' : (e.asignacion?.contrato_id || '');
      return {
        grupo: extra ? '__declarados' : (e.asignacion?.contrato_doc_id || '__sin'),
        grupoLabel: extra ? 'Declarados por ti' : (contrato || 'Sin contrato'),
        orden: extra ? -1 : undefined, grupoAbierto: extra, ok: el.ok,
        busca: `${e.serial || e.id} ${e.modelo_label || ''} ${contrato}`,
        trAttrs: el.ok ? '' : 'style="opacity:.5;"',
        celdas: `
        <td>${el.ok ? `<input type="checkbox" data-wsel="${ix}" ${extra ? 'checked' : ''} onchange="Centro._wizFila(${ix}, this.checked)">` : ''}</td>
        <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
        <td>${this.esc(e.modelo_label || '—')}</td>
        <td class="cg-mono" style="font-size:12px;">${extra ? '<span style="color:var(--fg-4);">sin contrato</span>' : this.esc(contrato || '—')}</td>
        <td style="font-size:12.5px;">${this.esc(el.label)}${el.why ? `<br><span style="color:var(--fg-4);font-size:11.5px;">${this.esc(el.why)}</span>` : ''}
          ${extra ? `<button type="button" class="btn btn-ghost" style="padding:1px 7px; margin-left:6px;" title="Quitar"
            onclick="Centro._wrQuitarSerial(${ix - this.equipos.length})">✕</button>` : ''}</td>`,
        cfgAttrs: `id="wcfg-${ix}" class="${extra ? '' : 'hidden'}"`,
        cfg: `<td></td><td colspan="4" style="background:var(--surface-sunken, #EEF2F6);">
        <div style="display:flex; gap:10px; flex-wrap:wrap; padding:4px 0;">
          <select class="form-select" data-wmot="${ix}" style="max-width:280px;">
            <option value="">— Motivo —</option>
            ${this.MOTIVOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
          </select>
          ${this._selModelo(`data-wmod="${ix}" style="max-width:220px;"`, e.modelo_id, e.modelo_label)}
          <input class="form-input" data-wdet="${ix}" style="flex:1; min-width:180px;" placeholder="Detalle (opcional)">
        </div></td>`,
      };
    });
    const { barra, cuerpo } = this._ssHtml('wr', filas, { colspan: 5, placeholder: 'Serial dañado, modelo o contrato…' });
    this._wrBarra = barra;
    return cuerpo || '<tr><td colspan="5" class="cg-empty">El cliente no tiene equipos en campo — declara abajo el serial dañado.</td></tr>';
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
    this._ssMontar('wr');
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
      // cliente… Antes esto cortaba ("revísalo en Inventario"); ahora se deja
      // seguir con el aviso a la vista (2026-10-06): el vendedor declara que
      // el cliente lo tiene y administración lo ve al aprobar. El contrato de
      // OTRO cliente no se arrastra a esta solicitud.
      const L = EquiposPoolService.ESTADO_LABELS || {};
      const ajena = ficha.asignacion?.cliente_id && ficha.asignacion.cliente_id !== this.cliente.id;
      const otro = ajena ? ` y figura con ${ficha.asignacion.cliente_nombre || 'otro cliente'}` : '';
      this._wrExtras.push({ ...ficha, asignacion: ajena ? null : ficha.asignacion,
        estado: ficha.estado || 'sin_estado', cliente_ajeno: ajena ? (ficha.asignacion.cliente_nombre || 'otro cliente') : null });
      Toast.show(`${norm} está en el sistema como "${L[ficha.estado] || ficha.estado}"${otro} — queda marcado para que administración lo vea al aprobar`, 'warn');
      if (inp) inp.value = '';
      this._wrRepintar();
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
    return withBusy(btn || null, () => this._crearReemplazo(), { key: 'crearReemplazo', label: 'Enviando…', rethrow: false, intento: this._intento('crearReemplazo', 'Reemplazo') });
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
        ...(el.desfase ? { estado_en_sistema: el.desfase } : {}),
        ...(e.cliente_ajeno ? { figuraba_con: e.cliente_ajeno } : {}),
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
    await this._descargarJsonRecepcion({
      clienteId: g.cliente_id || this.cliente?.id || '',
      clienteNombre: g.cliente_nombre || this.cliente?.nombre || '',
      // El modelo que ENTRA: el de la ficha del radio asignado y, si aún no lo
      // hay, el solicitado — nunca el del saliente.
      pares: items.map(it => ({
        saliente: it.serial_saliente,
        modelo_id: it.modelo_id_nuevo || it.modelo_solicitado_id || it.modelo_id || '',
        modelo_label: it.modelo_nuevo || it.modelo_solicitado || it.modelo || '',
      })),
      archivo: `reemplazo-${gid}.json`,
    });
  },

  // ── JSON de la renovación para recepción (Zuleika, 2026-10-21) ──────────
  // Una renovación que cambia radios ('se reemplaza' en el plan por serial)
  // necesita lo mismo que un REEMP: el vendedor no sabe cómo estaban
  // programados los que salen. Sale del mismo plan que bodega ya usa para
  // asignar: un renglón por saliente, con el modelo ENTRANTE (el declarado
  // "por otro modelo" o, si no, el mismo). Los que continúan no se cambian.
  //
  // Los NUEVOS de más (la línea trae más radios que continúan + reemplazos)
  // van también, en blanco y marcados con `falta`: nunca tuvieron
  // programación y nadie más que el cliente la sabe. Así el archivo cubre
  // TODOS los radios que entran y el hueco se ve, en vez de esconderse en un
  // archivo con menos renglones (Alberto, 2026-10-21).
  //
  // Los que 'se devuelven' también cuentan si entran radios nuevos: ASESORÍA
  // EN PROTECCIÓN (SERV20261008-01) devuelve sus 21 PNC360S y recibe 21
  // PNC360S-R — en el plan quedaron como "se devuelve", no "se reemplaza", y
  // Zuleika no veía la opción. Cada nuevo hereda la programación de un
  // devuelto (mismo modelo primero, luego en orden); los devueltos que
  // sobran no van, porque no hay radio que la reciba.
  async jsonRenovacionRecepcion(id) {
    const c = (this.contratos || []).find(x => x.id === id);
    if (!c) { Toast.show('No se encontró el contrato.', 'bad'); return; }
    const { pares, nuevos } = this._salientesDeRenovacion(c);
    if (!pares.length) { Toast.show('Esta renovación no declara radios que salen y se cambian por otros.', 'warn'); return; }
    await this._descargarJsonRecepcion({
      clienteId: c.cliente_id || this.cliente?.id || '',
      clienteNombre: c.cliente_nombre || this.cliente?.nombre || '',
      pares, nuevos,
      archivo: `renovacion-${c.contrato_id || c.id}.json`,
    });
  },

  // { pares: [{ saliente, modelo_id, modelo_label }], nuevos: [{ modelo_id, modelo_label }] }
  // Pares = los 'reemplaza' + los 'devuelve' que caen en un nuevo de más.
  _salientesDeRenovacion(c) {
    const us = (c.transicion_plan?.nivel === 'serial' ? c.transicion_plan.unidades || [] : [])
      .filter(u => String(u.serial || '').trim());
    const pares = us.filter(u => u.destino === 'reemplaza').map(u => ({
      saliente: u.serial,
      modelo_id: u.reemplazo_modelo_id || u.modelo_id || '',
      modelo_label: u.reemplazo_modelo || u.modelo || '',
    }));
    const clave = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/R$/, '');
    const dev = us.filter(u => u.destino === 'devuelve')
      .map(u => ({ serial: u.serial, id: u.modelo_id || '', txt: clave(u.modelo), usado: false }));
    const nuevos = [];
    for (const n of this._nuevosDeRenovacion(c)) {
      const t = clave(n.modelo_label);
      const d = dev.find(x => !x.usado && x.id && x.id === n.modelo_id)
        || dev.find(x => !x.usado && x.txt && t && (x.txt === t || x.txt.includes(t) || t.includes(x.txt)))
        || dev.find(x => !x.usado);
      if (d) { d.usado = true; pares.push({ saliente: d.serial, modelo_id: n.modelo_id, modelo_label: n.modelo_label }); }
      else nuevos.push(n);
    }
    return { pares, nuevos };
  },

  // Radios nuevos de más, por línea: cantidad − (continúan + reemplazos que
  // caen en esa línea). Mismo pareo que "Cuadrar cantidades" del wizard.
  _nuevosDeRenovacion(c) {
    const lineas = (c.equipos || []).filter(l => Number(l.cantidad || 0) > 0);
    if (!lineas.length || typeof TransicionPlan === 'undefined') return [];
    const r = TransicionPlan.conciliarLineas(c.transicion_plan, lineas);
    const out = [];
    r.porLinea.forEach(({ idx, continuan, reemplazan }) => {
      const l = lineas[idx];
      const n = Math.max(0, Number(l.cantidad || 0) - continuan - reemplazan);
      for (let i = 0; i < n; i++) out.push({ modelo_id: l.modelo_id || '', modelo_label: l.modelo || '' });
    });
    return out;
  },

  // Común a los dos: nombre, grupos y GPS de cada saliente, en el formato que
  // lee el lote de POC. `pares` = [{ saliente, modelo_id, modelo_label }] en el
  // orden en que deben salir las filas; `nuevos` = [{ modelo_id, modelo_label }]
  // van al final, en blanco.
  async _descargarJsonRecepcion({ clienteId, clienteNombre, pares, nuevos = [], archivo }) {
    if (typeof PocService === 'undefined') { Toast.show('No se pudo consultar POC desde esta pantalla.', 'bad'); return; }

    try {
      const cfgs = await PocService.configDelSaliente({
        clienteId: clienteId || null,
        clienteNombre: clienteNombre || '',
        salientes: pares.map(p => p.saliente),
        fresh: true,
      });

      const FALTA_SIN_FICHA = 'SIN FICHA DEL RADIO QUE SALE — el vendedor debe enviar nombre, grupos y GPS';
      const FALTA_NUEVO = 'RADIO NUEVO — el vendedor debe enviar nombre, grupos y GPS';
      const filas = pares.map(p => {
        const cfg = cfgs.get(Serial.clave(p.saliente)) || null;
        return {
          // cliente_id/cliente_nombre los usa el lote para auto-elegir cliente.
          cliente_id: clienteId || '',
          cliente_nombre: clienteNombre || '',
          radio_name: cfg?.radio_name || '',
          gps: cfg?.gps || false,
          grupos: cfg ? cfg.grupos : [],
          modelo_id: p.modelo_id,
          modelo_label: p.modelo_label,
          // Referencia para quien lo lea; el lote de POC ignora estos dos.
          serial_saliente: p.saliente,
          ficha_saliente: cfg ? (cfg.cerrada ? 'cerrada' : 'viva') : 'sin ficha en POC',
          // `falta` lo pinta el lote en la fila: qué hay que pedirle al vendedor.
          ...(cfg ? {} : { falta: FALTA_SIN_FICHA }),
        };
      });
      for (const n of nuevos) {
        filas.push({
          cliente_id: clienteId || '', cliente_nombre: clienteNombre || '',
          radio_name: '', gps: false, grupos: [],
          modelo_id: n.modelo_id, modelo_label: n.modelo_label,
          serial_saliente: null, falta: FALTA_NUEVO,
        });
      }

      const sin = filas.filter(f => f.falta === FALTA_SIN_FICHA).length;
      const nNuevos = nuevos.length;
      if (sin || nNuevos) {
        const partes = [];
        if (nNuevos) partes.push(`<b>${nNuevos} radio(s) nuevo(s)</b>: nunca tuvieron programación`);
        if (sin) partes.push(`<b>${sin} de ${pares.length} radio(s) que salen</b> no tienen ficha en POC con este cliente`);
        const ok = await Modal.confirm({
          title: nNuevos ? 'Faltan datos de programación' : 'Salientes sin ficha en POC',
          confirmLabel: 'Descargar y pedir lo que falta',
          message: (nuevos.length && window.Beta ? `${Beta.chip('programacion_renovacion')} ${Beta.FUNCIONES.programacion_renovacion.nota}<br><br>` : '') +
            `${partes.join('; ')}.<br><br>` +
            `Van en el archivo <b>en blanco y marcados</b>. <b>El vendedor tiene que conseguir con el cliente ` +
            `el nombre, los grupos y el GPS de esos ${sin + nNuevos} radio(s) y enviárselos a recepción</b>; ` +
            `recepción los completa en el lote antes de guardar.`,
        });
        if (!ok) return;
      }

      const blob = new Blob([JSON.stringify(filas, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = archivo;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const faltan = sin + nNuevos;
      Toast.show(`JSON de ${filas.length} radio(s) descargado${faltan ? ` — a ${faltan} les falta la programación: envíasela a recepción` : ''}.`, faltan ? 'warn' : 'ok');
    } catch (e) {
      console.error('[centro] JSON para recepción:', e);
      Toast.show('No se pudo leer la configuración de los radios salientes.', 'bad');
    }
  },
});
