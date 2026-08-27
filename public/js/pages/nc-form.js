// @ts-nocheck
// nuevo-contrato form logic: badges, equipment table, totals, renewal UI
window.NCForm = {

  updateContratoBadges() {
    const clienteId = document.getElementById('cliente').value;
    const badgeCliente = document.getElementById('badgeCliente');
    if (clienteId) { badgeCliente.textContent = 'Listo';    badgeCliente.className = 'badge ready'; }
    else           { badgeCliente.textContent = 'Pendiente'; badgeCliente.className = 'badge pending'; }

    const tipoContrato = document.getElementById('tipo_contrato').value;
    const accion       = document.getElementById('accion').value;
    const duracion     = document.getElementById('duracion').value;
    const badgeDetalles = document.getElementById('badgeDetalles');
    if (tipoContrato && accion && duracion) { badgeDetalles.textContent = 'Listo';    badgeDetalles.className = 'badge ready'; }
    else                                    { badgeDetalles.textContent = 'Pendiente'; badgeDetalles.className = 'badge pending'; }

    const filas       = document.querySelectorAll('#tablaEquipos tbody tr');
    const badgeEquipos = document.getElementById('badgeEquipos');
    if (filas.length > 0) { badgeEquipos.textContent = `${filas.length} equipo${filas.length !== 1 ? 's' : ''}`; badgeEquipos.className = 'badge info'; }
    else                  { badgeEquipos.textContent = 'Pendiente'; badgeEquipos.className = 'badge pending'; }
  },

  syncAccionForTipoContrato() {
    const tipoContrato = document.getElementById('tipo_contrato').value;
    const accionSel    = document.getElementById('accion');
    if (!accionSel) return;

    const isDemoOrTemp = tipoContrato === 'DEMO' || tipoContrato === 'TEMP';
    if (isDemoOrTemp) {
      if (!accionSel.dataset.prevValue) accionSel.dataset.prevValue = accionSel.value || '';
      accionSel.value = 'No Aplica';
      accionSel.disabled = true;
      accionSel.classList.add('is-locked');
    } else {
      if (accionSel.disabled) {
        accionSel.disabled = false;
        accionSel.classList.remove('is-locked');
        if (accionSel.dataset.prevValue !== undefined) accionSel.value = accionSel.dataset.prevValue;
      }
    }
    this.refreshRenovacionModeUI();
    this.refreshOrigenUI();
    this.updateContratoBadges();
  },

  refreshRenovacionModeUI() {
    const accion            = document.getElementById('accion')?.value;
    const box               = document.getElementById('renovacionModeBox');
    const checkbox          = document.getElementById('renovacion_sin_equipo');
    const refurbishedBox    = document.getElementById('renovacionRefurbishedBox');
    const refurbishedCb     = document.getElementById('renovacion_refurbished_componentes');
    const badge             = document.getElementById('badgeRenovacionModo');
    if (!box || !checkbox || !badge || !refurbishedBox || !refurbishedCb) return;

    const esRenovacion = accion === 'Renovación';
    if (!esRenovacion) {
      box.style.display = 'none';
      checkbox.checked = false; checkbox.disabled = true;
      refurbishedBox.style.display = 'none';
      refurbishedCb.checked = false; refurbishedCb.disabled = true;
      badge.textContent = 'Renovación con equipo'; badge.className = 'badge info';
      return;
    }

    box.style.display = 'block'; checkbox.disabled = false;
    if (checkbox.checked) {
      refurbishedBox.style.display = 'block'; refurbishedCb.disabled = false;
      badge.textContent = 'Renovación sin equipo'; badge.className = 'badge ready';
    } else {
      refurbishedBox.style.display = 'none';
      refurbishedCb.checked = false; refurbishedCb.disabled = true;
      badge.textContent = 'Renovación con equipo'; badge.className = 'badge info';
    }
  },

  toggleOtraDuracion(valor) {
    document.getElementById('otraDuracionLabel').style.display = (valor === 'Otro') ? 'block' : 'none';
  },

  // ── Vínculo al contrato original (Renovación / Adición / Reemplazo) ────
  // PLAN_CICLO_VIDA_EQUIPOS.md C.1. El enlace nació SUAVE y nadie lo llenaba
  // (0 de 25 renovaciones), lo que dejaba sin origen a toda la cadena de la
  // devolución. Desde 2026-08-11 es OBLIGATORIO en Renovación y Reemplazo, con
  // el escape explícito "es de papel / no está en el sistema". El criterio vive
  // en js/domain/origenContrato.js — aquí solo se lee el DOM y se pinta.

  // Estado del bloque tal como lo dejó el vendedor, en la forma que espera el
  // dominio. Un solo lector para pintar, validar y guardar.
  leerOrigen() {
    const accion      = document.getElementById('accion')?.value || '';
    const codigo_tipo = document.getElementById('tipo_contrato')?.value || '';
    const legacy      = !!document.getElementById('origenLegacyChk')?.checked;
    const chks        = [...document.querySelectorAll('#origenContratosList .origen-chk')];
    const marcados    = legacy ? [] : chks.filter(c => c.checked);
    return {
      accion, codigo_tipo, legacy,
      origen_ids:  marcados.map(c => c.value),
      origen_refs: marcados.map(c => c.getAttribute('data-ref') || c.value),
      legacy_ref:  (document.getElementById('origenLegacyRef')?.value || '').trim(),
      candidatos:  chks.length,
    };
  },

  // Valida y avisa. `silencioso` para el repintado (no molestar mientras el
  // vendedor todavía está llenando), ruidoso al intentar guardar.
  validarOrigen({ silencioso = false } = {}) {
    const sel = this.leerOrigen();
    // La lista vacía significa dos cosas distintas y solo una manda al escape
    // de papel. Si todavía no cargó (o falló), decirle "este cliente no tiene
    // contratos" sería mentira — y empujaría a marcar legacy de más.
    const estado = document.getElementById('origenContratosList')?.dataset.estado;
    if (OrigenContrato.obligatorio(sel) && !sel.legacy && !sel.origen_ids.length
        && (estado === 'cargando' || estado === 'error')) {
      const r = { ok: false, motivo: 'lista_no_cargada', foco: 'lista',
        mensaje: estado === 'cargando'
          ? 'Espera a que carguen los contratos del cliente para elegir el original.'
          : 'No se pudieron cargar los contratos del cliente. Vuelve a elegir la acción para reintentar.' };
      if (!silencioso) Toast.show(`⚠️ ${r.mensaje}`, 'warn');
      return r;
    }
    const r = OrigenContrato.validar(sel);
    if (r.ok || silencioso) return r;
    Toast.show(`⚠️ ${r.mensaje}`, 'warn');
    const foco = { lista: 'origenContratosList', legacy: 'origenLegacyChk', ref: 'origenLegacyRef' }[r.foco];
    const el = foco && document.getElementById(foco);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (el.focus) try { el.focus(); } catch (_) { /* el div de la lista no enfoca */ }
    }
    return r;
  },

  refreshOrigenUI() {
    const box = document.getElementById('origenBox');
    if (!box) return;
    const sel    = this.leerOrigen();
    const aplica = OrigenContrato.aplica(sel);
    box.style.display = aplica ? 'block' : 'none';
    const chk  = document.getElementById('origenLegacyChk');
    const list = document.getElementById('origenContratosList');
    const ref  = document.getElementById('origenLegacyRef');
    if (chk && list && ref) {
      list.style.opacity = chk.checked ? '0.45' : '';
      list.querySelectorAll('.origen-chk').forEach(c => { c.disabled = chk.checked; });
      ref.style.display = chk.checked ? 'block' : 'none';
    }

    // La exigencia se ve: asterisco y texto de ayuda cambian según el caso, en
    // vez de descubrirse recién al intentar guardar.
    const obliga = OrigenContrato.obligatorio(sel);
    const req  = document.getElementById('origenReq');
    if (req) req.style.display = obliga ? '' : 'none';
    const hint = document.getElementById('origenHint');
    if (hint) {
      hint.textContent = !obliga
        ? 'Conecta este contrato con el original para la transición de equipos. En una adición es opcional: el cliente conserva lo que ya tenía.'
        : (chk?.checked
            ? 'Anota la referencia del contrato en papel — es el único rastro que quedará del original.'
            : 'Obligatorio: de este vínculo salen los equipos que el cliente debe devolver. Si el original no está en el sistema, márcalo abajo.');
    }

    if (aplica) this.cargarContratosOrigen();
    this.refreshReempUI();
    this.refreshPlanUI();
  },

  // ── Equipo saliente del REEMPLAZO (2026-08-27) ─────────────────────────
  // El criterio vive en js/domain/reemplazoSalientes.js; aquí solo se lee el
  // DOM y se pinta. Es independiente del contrato original a propósito: el
  // radio dañado puede venir de un contrato de papel, y aun así está en el pool.

  leerReemp() {
    const chks = [...document.querySelectorAll('#reempList .reemp-chk')];
    const marcados = chks.filter(c => c.checked);
    return {
      codigo_tipo: document.getElementById('tipo_contrato')?.value || '',
      sin_identificar: !!document.getElementById('reempSinIdentificarChk')?.checked,
      seriales: marcados.map(c => c.value),
      candidatos: chks.length,
    };
  },

  // Las unidades marcadas, en la forma que guarda nc-guardar.
  unidadesReempSeleccionadas() {
    const ids = new Set(this.leerReemp().seriales);
    if (!ids.size) return [];
    return ReemplazoSalientes.candidatas(this._unidadesCliente || [])
      .filter(u => ids.has(String(u.serial || u.serial_norm)));
  },

  refreshReempUI() {
    const box = document.getElementById('reempBox');
    if (!box) return;
    const sel = this.leerReemp();
    if (!ReemplazoSalientes.aplica(sel)) { box.style.display = 'none'; return; }
    box.style.display = 'block';

    const list = document.getElementById('reempList');
    const chk  = document.getElementById('reempSinIdentificarChk');
    const hint = document.getElementById('reempHint');
    if (!list) return;
    list.style.opacity = chk?.checked ? '0.45' : '';

    const clienteId = document.getElementById('cliente')?.value || '';
    if (!clienteId) {
      list.innerHTML = '<span style="color:var(--fg-3,#6b7280);">Selecciona el cliente primero…</span>';
      return;
    }
    // `_unidadesCliente` lo carga cargarContratosOrigen (mismo cliente, misma
    // consulta): si aún no llegó, esta pasada pinta "cargando" y el repintado
    // que hace esa función al terminar rellena la lista.
    if (!this._unidadesCliente) {
      list.innerHTML = '<span style="color:var(--fg-3,#6b7280);">Cargando equipos del cliente…</span>';
      return;
    }

    const cands = ReemplazoSalientes.candidatas(this._unidadesCliente);
    if (!cands.length) {
      list.innerHTML = '<span style="color:var(--fg-3,#6b7280);">Este cliente no tiene equipos nuestros registrados en el pool.</span>';
      if (hint) hint.textContent = 'Sin equipos que ofrecer — marca «No se identifica el equipo saliente».';
      return;
    }

    // Conservar lo marcado al repintar (cambiar de acción no debe borrar la
    // elección del vendedor).
    const previos = new Set(this.leerReemp().seriales);
    const esc = NC.escapeHtml;
    list.innerHTML = cands.map(u => {
      const s = String(u.serial || u.serial_norm);
      const ctr = u.asignacion?.contrato_id ? ` · ${esc(u.asignacion.contrato_id)}` : ' · sin contrato';
      const taller = u.estado === 'en_taller' ? ' <b style="color:#92400e;">· en taller</b>' : '';
      return `
        <label class="form-check" style="margin:0;">
          <input type="checkbox" class="reemp-chk" value="${esc(s)}" ${previos.has(s) ? 'checked' : ''} ${chk?.checked ? 'disabled' : ''}>
          <span><span class="form-check-label"><span style="font-family:var(--font-mono,monospace);">${esc(s)}</span> · ${esc(u.modelo_label || '—')}${ctr}${taller}</span></span>
        </label>`;
    }).join('');
    if (hint) {
      hint.textContent = chk?.checked
        ? 'Recepción define el equipo saliente al entregar. No se abrirá devolución automática.'
        : `De aquí sale el equipo que el cliente debe entregar. ${cands.length} equipo(s) del cliente — marca solo el que se sustituye.`;
    }
  },

  // Valida y avisa. Mismo contrato que validarOrigen.
  validarReemp({ silencioso = false } = {}) {
    const r = ReemplazoSalientes.validar(this.leerReemp());
    if (r.ok || silencioso) return r;
    Toast.show(`⚠️ ${r.mensaje}`, 'warn');
    const el = document.getElementById(r.motivo === 'sin_candidatos' ? 'reempSinIdentificarChk' : 'reempList');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (el.focus) try { el.focus(); } catch (_) { /* el div de la lista no enfoca */ }
    }
    return r;
  },

  // ── Plan de transición (P1 del informe tracking 2026-08-12) ─────────────
  // Al elegir el/los originales, el vendedor decide QUÉ pasa con cada unidad:
  // continúa / se devuelve / se reemplaza. Si no sabe seriales, cambia a
  // "por cantidades" y decide por modelo. El criterio vive en
  // js/domain/transicionPlan.js; aquí solo se pinta y se lee el DOM.

  _selPlan() {
    return {
      accion:      document.getElementById('accion')?.value,
      codigo_tipo: document.getElementById('tipo_contrato')?.value,
    };
  },

  // Unidades del pool de los orígenes marcados (alquiler; los propios del
  // cliente no entran al plan — no se devuelven ni se sustituyen).
  _unidadesDeOrigenes() {
    const ids = new Set(this.leerOrigen().origen_ids);
    if (!ids.size) return { alquiler: [], propios: 0 };
    let propios = 0;
    const alquiler = [];
    for (const u of (this._unidadesCliente || [])) {
      if (!ids.has(u.asignacion?.contrato_doc_id)) continue;
      if (!['asignado_contrato', 'en_cliente', 'en_taller'].includes(u.estado)) continue;
      if (u.propiedad === 'cliente') { propios++; continue; }
      alquiler.push(u);
    }
    alquiler.sort((a, b) => String(a.modelo_label || '').localeCompare(String(b.modelo_label || ''))
      || String(a.serial || '').localeCompare(String(b.serial || '')));
    return { alquiler, propios };
  },

  refreshPlanUI() {
    const box = document.getElementById('planBox');
    if (!box) return;
    const sel = this._selPlan();
    const origen = this.leerOrigen();
    const aplica = TransicionPlan.aplica(sel) && !origen.legacy && origen.origen_ids.length > 0;
    if (!aplica) { box.style.display = 'none'; return; }

    const { alquiler, propios } = this._unidadesDeOrigenes();
    box.style.display = 'block';
    const body = document.getElementById('planBody');
    const hint = document.getElementById('planHint');
    const esc = NC.escapeHtml;

    if (!alquiler.length) {
      body.innerHTML = `<span style="color:var(--fg-3,#6b7280);">El original no tiene unidades de alquiler en el pool${propios ? ` (${propios} son propiedad del cliente)` : ''} — la transición se registrará con recepción cuando el equipo aparezca.</span>`;
      if (hint) hint.textContent = 'Sin unidades que planear. El contrato se crea normal.';
      return;
    }

    // Conservar lo ya elegido al re-pintar (cambiar orígenes no debe borrar
    // las decisiones del vendedor sobre los que siguen presentes).
    const previoSerial = new Map();
    body.querySelectorAll('.plan-destino').forEach(s => previoSerial.set(s.dataset.serial, s.value));
    const previoCant = new Map();
    body.querySelectorAll('.plan-cant-row').forEach(r => previoCant.set(r.dataset.modelo, {
      continuan: r.querySelector('.plan-c')?.value, devuelven: r.querySelector('.plan-d')?.value,
      reemplazan: r.querySelector('.plan-r')?.value,
    }));
    const porCantidad = !!document.getElementById('planPorCantidad')?.checked;

    const def = TransicionPlan.destinoDefault(sel);
    const OPT = [['continua', 'Continúa'], ['devuelve', 'Se devuelve'], ['reemplaza', 'Se reemplaza']];
    const grupos = new Map();
    alquiler.forEach(u => {
      const k = `${u.modelo_id || ''}|${u.modelo_label || 'sin modelo'}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(u);
    });

    let html = '';
    if (!porCantidad) {
      for (const [k, us] of grupos) {
        const modelo = k.split('|')[1];
        html += `
          <div style="margin:8px 0 4px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <b style="font-size:13px;">${esc(modelo)}</b>
            <span style="font-size:12px; color:var(--fg-3);">${us.length} unidad${us.length === 1 ? '' : 'es'}</span>
            <select class="form-select plan-bulk" data-grupo="${esc(k)}" style="height:26px; font-size:12px; width:auto;" title="Aplicar a todas las unidades del modelo">
              <option value="">todas →</option>${OPT.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:4px 12px;">
            ${us.map(u => {
              const dest = previoSerial.get(u.serial || u.serial_norm) || def;
              return `
              <label style="display:flex; align-items:center; gap:6px; font-size:12.5px;">
                <span style="font-family:var(--font-mono,monospace); min-width:110px;">${esc(u.serial || u.serial_norm)}</span>
                <select class="form-select plan-destino" data-grupo="${esc(k)}" data-serial="${esc(u.serial || u.serial_norm)}"
                        data-pool-id="${esc(u.id)}" data-modelo-id="${esc(u.modelo_id || '')}" data-modelo="${esc(u.modelo_label || '')}"
                        style="height:26px; font-size:12px; flex:1;">
                  ${OPT.map(([v, l]) => `<option value="${v}" ${v === dest ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </label>`;
            }).join('')}
          </div>`;
      }
    } else {
      html += `<table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead><tr style="text-align:left; color:var(--fg-3); font-size:12px;">
          <th style="padding:4px 6px;">Modelo</th><th style="padding:4px 6px;">Total</th>
          <th style="padding:4px 6px;">Continúan</th><th style="padding:4px 6px;">Se devuelven</th><th style="padding:4px 6px;">Se reemplazan</th>
        </tr></thead><tbody>`;
      for (const [k, us] of grupos) {
        const modelo = k.split('|')[1];
        const p = previoCant.get(k);
        const c = p ? Number(p.continuan || 0) : (def === 'continua' ? us.length : 0);
        const r = p ? Number(p.reemplazan || 0) : (def === 'reemplaza' ? us.length : 0);
        const d = p ? Number(p.devuelven || 0) : (us.length - c - r);
        html += `
          <tr class="plan-cant-row" data-modelo="${esc(k)}" data-modelo-id="${esc(us[0].modelo_id || '')}" data-modelo-label="${esc(modelo)}" data-total="${us.length}">
            <td style="padding:4px 6px;">${esc(modelo)}</td>
            <td style="padding:4px 6px;"><b>${us.length}</b></td>
            <td style="padding:4px 6px;"><input type="number" class="form-input plan-c" min="0" max="${us.length}" value="${c}" style="width:70px; height:28px;"></td>
            <td style="padding:4px 6px;"><input type="number" class="form-input plan-d" min="0" max="${us.length}" value="${Math.max(0, d)}" style="width:70px; height:28px;"></td>
            <td style="padding:4px 6px;"><input type="number" class="form-input plan-r" min="0" max="${us.length}" value="${r}" style="width:70px; height:28px;"></td>
          </tr>`;
      }
      html += '</tbody></table>';
    }
    if (propios) {
      html += `<div style="margin-top:8px; font-size:12px; color:var(--fg-3);">${propios} unidad${propios === 1 ? '' : 'es'} propiedad del cliente queda${propios === 1 ? '' : 'n'} fuera: no se devuelve${propios === 1 ? '' : 'n'} ni se sustituye${propios === 1 ? '' : 'n'}.</div>`;
    }
    body.innerHTML = html;
    if (hint) {
      hint.textContent = porCantidad
        ? 'Decide por cantidades — recepción resuelve los seriales concretos contra este plan al asignarlos.'
        : (def === 'reemplaza'
            ? 'Un reemplazo sustituye: todas parten en "se reemplaza"; marca las excepciones.'
            : 'Una renovación extiende el servicio: todas parten en "continúa"; marca las que se devuelven o reemplazan.');
    }
    body.querySelectorAll('.plan-bulk').forEach(sel2 => sel2.addEventListener('change', () => {
      if (!sel2.value) return;
      body.querySelectorAll(`.plan-destino[data-grupo="${CSS.escape(sel2.dataset.grupo)}"]`)
        .forEach(s => { s.value = sel2.value; });
      sel2.value = '';
    }));
  },

  // Plan tal como quedó en el DOM → objeto de dominio, o null si no aplica.
  leerPlan() {
    const box = document.getElementById('planBox');
    const sel = this._selPlan();
    const origen = this.leerOrigen();
    if (!box || box.style.display === 'none') return null;
    if (!TransicionPlan.aplica(sel) || origen.legacy || !origen.origen_ids.length) return null;

    const porCantidad = !!document.getElementById('planPorCantidad')?.checked;
    if (!porCantidad) {
      const unidades = [...document.querySelectorAll('#planBody .plan-destino')].map(s => ({
        pool_id: s.dataset.poolId || null,
        serial: s.dataset.serial,
        serial_norm: s.dataset.serial,
        modelo_id: s.dataset.modeloId || null,
        modelo: s.dataset.modelo || '',
        destino: s.value,
      }));
      if (!unidades.length) return null;
      return TransicionPlan.construirSerial(unidades, origen.origen_ids);
    }
    const filas = [...document.querySelectorAll('#planBody .plan-cant-row')].map(r => ({
      modelo_id: r.dataset.modeloId || null,
      modelo: r.dataset.modeloLabel || '',
      total: Number(r.dataset.total || 0),
      continuan: Number(r.querySelector('.plan-c')?.value || 0),
      devuelven: Number(r.querySelector('.plan-d')?.value || 0),
      reemplazan: Number(r.querySelector('.plan-r')?.value || 0),
    }));
    if (!filas.length) return null;
    return TransicionPlan.construirCantidad(filas, origen.origen_ids);
  },

  _origenClienteCargado: null,
  // Lista de CHECKBOXES (una renovación puede consolidar varios contratos
  // viejos — multi-selección).
  async cargarContratosOrigen() {
    const clienteId = document.getElementById('cliente')?.value || '';
    const list = document.getElementById('origenContratosList');
    if (!list) return;
    const hint = (msg) => { list.innerHTML = `<span style="color:var(--fg-3,#6b7280);">${NC.escapeHtml(msg)}</span>`; };
    // `estado` distingue "el cliente no tiene contratos" de "todavía no cargan":
    // en los dos casos la lista está vacía, pero solo el primero justifica
    // mandar al vendedor al escape de papel (validarOrigen lo consulta).
    if (!clienteId) {
      list.dataset.estado = 'sin-cliente';
      hint('Selecciona el cliente primero…'); this._origenClienteCargado = null; return;
    }
    if (this._origenClienteCargado === clienteId) return; // ya cargado para este cliente
    this._origenClienteCargado = clienteId;
    list.dataset.estado = 'cargando';
    hint('Cargando contratos del cliente…');
    try {
      const contratos = await ContratosService.getContratosActivosPorCliente(clienteId);

      // Unidades del pool por contrato — para que el vendedor NO elija el
      // original a ciegas entre varios contratos (informe tracking 2026-08-12,
      // P4.2: GOLY tiene 17 y solo algunos tienen equipo colgando). Best-effort:
      // sin el servicio o sin permiso, la lista sale sin conteos.
      // La lista completa se guarda: el plan de transición (P1) la reusa para
      // ofrecer las unidades del origen elegido sin otra consulta.
      const unidadesPor = new Map();
      this._unidadesCliente = [];
      try {
        if (typeof EquiposPoolService !== 'undefined') {
          this._unidadesCliente = await EquiposPoolService.listarPorCliente(clienteId);
          this._unidadesCliente.forEach(u => {
            const cid = u.asignacion?.contrato_doc_id;
            if (!cid) return;
            if (!['asignado_contrato', 'en_cliente', 'en_taller'].includes(u.estado)) return;
            unidadesPor.set(cid, (unidadesPor.get(cid) || 0) + 1);
          });
        }
      } catch (e) { /* sin conteos */ }
      const conteoHtml = (id) => {
        if (!unidadesPor.size) return '';
        const n = unidadesPor.get(id) || 0;
        return n
          ? ` <span style="color:var(--fg-3,#6b7280);">· <b style="color:inherit;">${n}</b> equipo${n === 1 ? '' : 's'} en el pool</span>`
          : ' <span style="color:var(--fg-3,#6b7280);">· sin equipos en el pool</span>';
      };

      list.innerHTML = contratos.length
        ? contratos.map(c => `
            <label class="form-check" style="margin:0;">
              <input type="checkbox" class="origen-chk" value="${NC.escapeHtml(c.id)}" data-ref="${NC.escapeHtml(c.contrato_id || c.id)}">
              <span><span class="form-check-label">${NC.escapeHtml(c.contrato_id || c.id)} · ${NC.escapeHtml(c.tipo_contrato || '')} · ${NC.escapeHtml(c.estado || '')}${conteoHtml(c.id)}</span></span>
            </label>`).join('')
        : '';
      list.dataset.estado = 'listo';
      if (!contratos.length) hint('El cliente no tiene contratos vigentes en el sistema');
      // Preselección del origen (CTA "Renovar" de la lista): el contrato que
      // se está renovando llega en NC.origenPreseleccion vía el prefill —
      // marca su checkbox ANTES del repintado para que leerOrigen lo vea.
      if (Array.isArray(NC.origenPreseleccion) && NC.origenPreseleccion.length) {
        const pre = new Set(NC.origenPreseleccion);
        list.querySelectorAll('.origen-chk').forEach(ch => { if (pre.has(ch.value)) ch.checked = true; });
        NC.origenPreseleccion = null;
      }
      // Repintar con la lista ya cargada (la cache del cliente hace que esta
      // vuelta NO vuelva a consultar, así que no hay recursión).
      this.refreshOrigenUI();
    } catch (e) {
      console.warn('No se pudieron cargar los contratos del cliente', e);
      list.dataset.estado = 'error';
      hint('No se pudieron cargar los contratos');
      // Se suelta la marca para que el próximo refresh (cambiar cliente,
      // acción o tipo) reintente. NO se repinta aquí: refreshOrigenUI volvería
      // a llamar a esta función y un fallo persistente giraría en seco.
      this._origenClienteCargado = null;
    }
  },

  agregarFilaEquipo() {
    const tbody = document.querySelector('#tablaEquipos tbody');
    const fila  = document.createElement('tr');
    fila.classList.add('fila-equipo', 'highlight');

    const modeloSelect = NC.modelosDisponibles.map(m =>
      `<option value="${m.modelo_id}">${NC.escapeHtml(m.modelo)}</option>`
    ).join('');

    fila.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <select class="modelo">${modeloSelect}</select>
        </div>
      </td>
      <td><input type="text" class="descripcion" value="Equipos de Comunicación"></td>
      <td><input type="number" class="cantidad input-cantidad" min="1" value="1"></td>
      <td><span class="minput"><input type="number" class="precio input-precio" step="any" min="0" value="0"></span></td>
      <td class="totalFila">$0.00</td>
      <td><button type="button" class="btn-del-fila">❌</button></td>
    `;
    tbody.appendChild(fila);
    setTimeout(() => fila.classList.remove('highlight'), 600);

    const self = this;
    const onChangeFila = () => { self.actualizarTotalDeFila(fila); self.recalcularTotalesContrato(); self.updateContratoBadges(); };
    fila.querySelectorAll('.input-cantidad, .input-precio').forEach(i => {
      i.addEventListener('input', onChangeFila);
      i.addEventListener('change', onChangeFila);
    });
    fila.querySelector('.btn-del-fila').addEventListener('click', () => {
      fila.remove(); self.recalcularTotalesContrato(); self.updateContratoBadges();
    });

    this.actualizarTotalDeFila(fila);
    setTimeout(() => { const c = fila.querySelector('.input-cantidad'); if (c) { c.focus(); c.select(); } }, 100);
    this.updateContratoBadges();
  },

  actualizarTotalDeFila(tr) {
    const cant   = parseFloat(tr.querySelector('.input-cantidad')?.value || 0);
    const precio = parseFloat(tr.querySelector('.input-precio')?.value   || 0);
    const celda  = tr.querySelector('.totalFila');
    if (celda) celda.textContent = `$${FMT.round2(cant * precio).toFixed(2)}`;
  },

  calcularSubtotalDesdeFilas() {
    let sub = 0;
    document.querySelectorAll('.fila-equipo').forEach(row => {
      sub += Number(row.querySelector('.input-cantidad')?.value || 0) *
             Number(row.querySelector('.input-precio')?.value   || 0);
    });
    return FMT.round2(sub);
  },

  recalcularTotalesContrato() {
    const equiposSub  = this.calcularSubtotalDesdeFilas();
    const itbmsAplica = (document.getElementById('itbms_aplica')?.value ?? 'true') === 'true';

    // Otros conceptos (cargos): recurrentes suman al mensual; únicos al primer pago.
    const cargos = (window.NCCargos ? NCCargos.leer() : []);
    let cargosRec = 0, cargosUni = 0;
    cargos.forEach(c => { const t = (Number(c.monto) || 0) * (Number(c.cantidad) || 1); if (c.recurrente) cargosRec += t; else cargosUni += t; });
    cargosRec = FMT.round2(cargosRec); cargosUni = FMT.round2(cargosUni);

    const mensual = ContractTotals.compute(FMT.round2(equiposSub + cargosRec), itbmsAplica);
    const inicial = ContractTotals.compute(FMT.round2(equiposSub + cargosRec + cargosUni), itbmsAplica);

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setShow = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    setTxt('itbms_label', mensual.itbmsLabel);
    setTxt('subtotal_view', FMT.money(equiposSub));
    setTxt('cargos_rec_view', FMT.money(cargosRec));
    setTxt('itbms_view', FMT.money(mensual.itbmsMonto));
    setTxt('total_con_itbms_view', FMT.money(mensual.totalConITBMS));
    setTxt('cargos_uni_view', FMT.money(cargosUni));
    const itbmsUni = Math.max(0, FMT.round2(inicial.itbmsMonto - mensual.itbmsMonto));
    setTxt('itbms_uni_view', FMT.money(itbmsUni));
    setTxt('primer_pago_view', FMT.money(inicial.totalConITBMS));
    setShow('row-cargos-rec', cargosRec > 0);
    setShow('row-cargos-uni', cargosUni > 0);
    setShow('row-itbms-uni', cargosUni > 0 && itbmsUni > 0);
    setShow('row-primer-pago', cargosUni > 0);

    return {
      // Compat: estos campos ahora reflejan el MENSUAL (equipos + cargos recurrentes).
      subtotal: mensual.subtotal, itbmsAplica, itbmsPorc: mensual.itbmsPorc,
      itbmsMonto: mensual.itbmsMonto, totalConITBMS: mensual.totalConITBMS, itbmsLabel: mensual.itbmsLabel,
      // Detalle adicional:
      equiposSub, cargosRec, cargosUni,
      subtotalInicial: inicial.subtotal, itbmsInicial: inicial.itbmsMonto, primerPago: inicial.totalConITBMS,
    };
  },

  calcularTotal() {
    document.querySelectorAll('#tablaEquipos tbody tr.fila-equipo').forEach(r => this.actualizarTotalDeFila(r));
    this.recalcularTotalesContrato();
  },

  init() {
    const self = this;
    window.addEventListener('DOMContentLoaded', () => {
      self.recalcularTotalesContrato();
      self.updateContratoBadges();
      self.syncAccionForTipoContrato();

      document.getElementById('tipo_contrato')?.addEventListener('change', () => self.syncAccionForTipoContrato());
      document.getElementById('accion')?.addEventListener('change', () => {
        const sel = document.getElementById('accion');
        if (sel && !sel.disabled) sel.dataset.prevValue = sel.value || '';
        self.refreshRenovacionModeUI();
        self.refreshOrigenUI();
        self.updateContratoBadges();
      });
      document.getElementById('origenLegacyChk')?.addEventListener('change', () => self.refreshOrigenUI());
      // Marcar/desmarcar orígenes redefine el universo del plan de transición.
      document.getElementById('origenContratosList')?.addEventListener('change', (e) => {
        if (e.target?.classList?.contains('origen-chk')) self.refreshPlanUI();
      });
      document.getElementById('reempSinIdentificarChk')?.addEventListener('change', () => self.refreshReempUI());
      document.getElementById('planPorCantidad')?.addEventListener('change', () => self.refreshPlanUI());
      document.getElementById('renovacion_sin_equipo')?.addEventListener('change', () => self.refreshRenovacionModeUI());
      document.getElementById('renovacion_refurbished_componentes')?.addEventListener('change', () => self.refreshRenovacionModeUI());
      document.getElementById('duracion')?.addEventListener('change', () => self.updateContratoBadges());
      document.getElementById('itbms_aplica')?.addEventListener('change', () => self.recalcularTotalesContrato());
    });

    document.addEventListener('input', e => {
      if (!e.target.matches('.input-cantidad, .input-precio')) return;
      const tr = e.target.closest('tr.fila-equipo');
      if (tr) self.actualizarTotalDeFila(tr);
      self.recalcularTotalesContrato();
    });
  }
};

NCForm.init();
