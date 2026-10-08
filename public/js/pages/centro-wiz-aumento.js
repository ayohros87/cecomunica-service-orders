// @ts-nocheck
// Centro de gestión de clientes — Wizard: aumento por enmienda firmada (Ola 4).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Wizard: aumento por enmienda firmada (Ola 4) ═════════ */

  // Catálogo de cargos (colección `cargos`, el mismo del contrato).
  cargosCat: null,
  async _cargarCargos() {
    if (this.cargosCat) return this.cargosCat;
    try {
      const all = (typeof CargosService !== 'undefined') ? await CargosService.getCargos() : [];
      this.cargosCat = (all || []).filter(c => c.activo !== false)
        .sort((a, b) => String(a.concepto || '').localeCompare(String(b.concepto || ''), 'es'));
    } catch (e) { console.warn('[centro] catálogo de cargos no disponible:', e?.message || e); this.cargosCat = []; }
    return this.cargosCat;
  },

  // `val` prellena la fila con un cargo YA guardado (edición del expediente).
  // Los seriales amarrados viajan en el data-attr para no perderse al releer:
  // un cargo de GPS pegado a 3 radios sigue pegado a esos 3 radios.
  _cargoLineaHtml(val = null) {
    const v = val || {};
    const opts = (this.cargosCat || []).map(c =>
      `<option value="${this.esc(c.id)}" ${v.cargo_id === c.id ? 'selected' : ''} data-monto="${Number(c.monto_default) || 0}" data-rec="${c.recurrente ? 1 : 0}">${this.esc(c.concepto || '')}</option>`).join('');
    const ser = Array.isArray(v.seriales) && v.seriales.length
      ? ` data-wac-seriales="${this.esc(JSON.stringify(v.seriales))}"` : '';
    return `<div class="wa-cargo" style="display:flex; gap:8px; margin-bottom:8px; align-items:center;"${ser}>
      <select class="form-select" data-wac-sel style="flex:1;" onchange="Centro._cargoSelChange(this)">
        <option value="">— cargo del catálogo —</option>${opts}</select>
      <input class="form-input" data-wac-cant type="number" min="1" value="${Math.max(1, Number(v.cantidad || 1))}" style="width:70px;" title="Cantidad" onchange="Centro._previewTarifario()">
      <input class="form-input" data-wac-monto type="number" min="0" step="1" placeholder="$" value="${v.monto != null && v.monto !== '' ? Number(v.monto) : ''}" style="width:100px;" onchange="Centro._previewTarifario()">
      <select class="form-select" data-wac-tipo style="width:110px;" onchange="Centro._previewTarifario()">
        <option value="unico" ${v.recurrente ? '' : 'selected'}>Único</option><option value="recurrente" ${v.recurrente ? 'selected' : ''}>Mensual</option></select>
      <button type="button" class="btn btn-ghost" style="padding:4px 8px;" title="Quitar"
        onclick="this.parentElement.remove(); Centro._previewTarifario()">✕</button>
    </div>`;
  },
  _cargoSelChange(sel) {
    const opt = sel.selectedOptions[0];
    const fila = sel.parentElement;
    if (opt && opt.value) {
      const m = Number(opt.dataset.monto) || 0;
      const monto = fila.querySelector('[data-wac-monto]');
      if (m && !monto.value) monto.value = m;
      fila.querySelector('[data-wac-tipo]').value = opt.dataset.rec === '1' ? 'recurrente' : 'unico';
    }
    this._previewTarifario();
  },
  // Las filas de cargos las comparten el aumento (#waTot) y el wizard de
  // contrato (#wcTot); cada preview no-opea si su contenedor no está.
  _previewTarifario() { this._aumPreview(); this._wcPreview(); this._wjPreview?.(); this._wePreview?.(); },

  // Lector genérico de líneas modelo·cantidad·precio (los data-attrs que
  // pinta _lineaModeloHtml). Lo comparten el aumento (wau) y el contrato (wcm).
  _lineasModelo(pref) {
    const selects = [...document.querySelectorAll(`select[data-${pref}-modelo]`)];
    const cants = [...document.querySelectorAll(`input[data-${pref}-cant]`)];
    const precios = [...document.querySelectorAll(`input[data-${pref}-precio]`)];
    const modalidades = [...document.querySelectorAll(`select[data-${pref}-modalidad]`)];
    return selects.map((s, i) => {
      const m = this._modeloDeSelect(s);
      // Modalidad por línea: 'propio' = equipo del cliente (tarifa de
      // servicio); 'alquiler' = equipo de CECOMUNICA en renta; null = el
      // vendedor todavía no dijo (los wizards lo exigen antes de guardar).
      const mod = modalidades[i]?.value;
      return m ? { modelo: m.label, modelo_id: m.id,
        cantidad: Math.max(1, Number(cants[i]?.value || 1)), precio: Number(precios[i]?.value || 0),
        modalidad: (mod === 'propio' || mod === 'alquiler') ? mod : null } : null;
    }).filter(Boolean);
  },
  _lineasSinModalidad(lineas) { return (lineas || []).filter(l => !l.modalidad).length; },
  MSG_SIN_MODALIDAD: 'Indica en cada línea si el equipo es alquiler o del cliente',
  _aumLineas() { return this._lineasModelo('wau'); },
  _aumCargos() {
    return [...document.querySelectorAll('.wa-cargo')].map(f => {
      const sel = f.querySelector('[data-wac-sel]');
      const opt = sel?.selectedOptions[0];
      // Seriales amarrados de un cargo ya guardado (solo en la edición del
      // expediente; en los wizards el data-attr no existe y no se escribe).
      let seriales = null;
      try { seriales = f.dataset.wacSeriales ? JSON.parse(f.dataset.wacSeriales) : null; } catch (e) { seriales = null; }
      return {
        cargo_id: sel?.value || '',
        concepto: opt ? (opt.textContent || '').trim() : '',
        cantidad: Math.max(1, Math.round(Number(f.querySelector('[data-wac-cant]')?.value)) || 1),
        monto: Math.max(0, Number(f.querySelector('[data-wac-monto]')?.value || 0)),
        recurrente: f.querySelector('[data-wac-tipo]')?.value === 'recurrente',
        ...(Array.isArray(seriales) && seriales.length ? { seriales } : {}),
      };
    }).filter(c => c.cargo_id && c.monto > 0);
  },

  // Aritmética del contrato — delega en js/domain/contratoTarifario.js (la
  // misma que usa nc-form y el wizard de contrato). Este adaptador conserva
  // la forma snake_case que ya persiste `gestiones.aumento.totales`.
  _totAumento(lineas, cargos, itbmsAplica) {
    const t = ContratoTarifario.totales(lineas, cargos, !!itbmsAplica);
    return {
      equipos_sub: t.equiposSub, cargos_rec: t.cargosRec, cargos_uni: t.cargosUni,
      itbms_aplica: t.itbmsAplica, itbms_porcentaje: t.itbmsPorc,
      itbms_mensual: t.itbmsMonto, total_mensual: t.totalConITBMS,
      itbms_unico: t.itbmsUni, primer_pago: t.primerPago,
    };
  },

  // Render del bloque tarifario (t en la forma snake_case de _totAumento).
  _tarifarioHtml(t) {
    const f = (n) => `$${Number(n || 0).toFixed(2)}`;
    const fila = (l, v, b) => `<div style="display:flex; font-size:13px; padding:2px 0;">
      <span${b ? ' style="font-weight:700;"' : ''}>${l}</span><span class="num" style="margin-left:auto;${b ? 'font-weight:700;' : ''}">${v}</span></div>`;
    return fila('Equipos (mensual)', f(t.equipos_sub))
      + (t.cargos_rec ? fila('Cargos mensuales', f(t.cargos_rec)) : '')
      + (t.itbms_aplica ? fila(`ITBMS (${(t.itbms_porcentaje * 100).toFixed(0)}%)`, f(t.itbms_mensual)) : fila('ITBMS', 'Exento'))
      + fila('TOTAL MENSUAL', f(t.total_mensual), true)
      + (t.cargos_uni ? (
          `<div style="border-top:1px solid var(--border-subtle); margin-top:4px; padding-top:4px;"></div>`
          + fila('Cargos únicos', f(t.cargos_uni))
          + (t.itbms_aplica ? fila('ITBMS únicos', f(t.itbms_unico)) : '')
          + fila('PRIMER PAGO (mes 1 + únicos)', f(t.primer_pago), true)) : '');
  },

  _aumPreview() {
    const cont = document.getElementById('waTot');
    if (!cont) return;
    const t = this._totAumento(this._aumLineas(), this._aumCargos(),
      document.getElementById('waItbms')?.checked !== false);
    cont.innerHTML = this._tarifarioHtml(t);
  },

  async wizAumento(preselId, opts = {}) {
    this._cerrarModal();
    this.cerrarMenu?.();
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);
    const activos = this.contratos.filter(c => this._esVigente(c));
    // Adenda a contrato EN PAPEL (opts.papel): no hay contrato interno que
    // elegir — el número va escrito a mano y la gestión vive sola.
    const esPapel = opts.papel === true;
    this._aumPapel = esPapel;
    if (!activos.length && !esPapel) { Toast.show('El cliente no tiene contratos vigentes', 'warn'); return; }
    // ITBMS por defecto: hereda del contrato destino; cliente exento manda.
    const cBase = esPapel ? null : (activos.find(c => c.id === preselId) || activos[0]);
    const itbmsDefault = this.cliente?.itbms_exento === true ? false : (cBase?.itbms_aplica !== false);
    // Modo REGULARIZACIÓN (2026-08-31, caso C COMUNICA: el flujo normal mandó
    // a Alberto a bodega por equipos que el cliente YA tenía): el anexo amarra
    // los sobrantes de la conciliación — prellenado con sus modelos, y B3 lo
    // aplica y CIERRA al firmarse, sin bodega, sin OS y sin entrega.
    this._aumRegulariza = null;
    // Dos fuentes de "equipos que el cliente YA tiene" (plan 2026-09-08 §4.3):
    //   · opts.regularizar   → sobrantes de la conciliación de ESE contrato.
    //   · opts.regularizarD1 → radios en campo sin contrato interno (D1 de la
    //     deuda de la cuenta); se amarran al contrato destino al firmarse.
    // En ambos casos el anexo es SOLO de regularización: sin bodega, sin OS,
    // sin entrega — por eso NO admite radios nuevos (candado en las líneas y
    // en crearAumento). Los nuevos van en un aumento normal aparte.
    if (opts.regularizar || opts.regularizarD1) {
      const sobr = opts.regularizarD1 ? [] : [...(cBase.regularizacion?.sin_linea_seriales || []),
                    ...(cBase.regularizacion?.sin_cupo_seriales || [])];
      const unidades = opts.regularizarD1
        ? this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion)
        : sobr.map(s => this.equipos.find(e => (e.serial || e.id) === s)).filter(Boolean);
      // Sin radios sueltos NO se cierra la puerta (2026-09-09): la lista abre
      // vacía y el vendedor declara los seriales que el sistema no conoce.
      // Lo que sí necesita algo que mostrar es el camino por sobrantes de UN
      // contrato, que se entra desde su expediente.
      if (!unidades.length && !opts.regularizarD1) { Toast.show('Este contrato no tiene sobrantes de regularización', 'warn'); return; }
      this._aumRegulariza = unidades.map(u => ({
        pool_doc_id: u.id, serial: u.serial || u.id,
        modelo_id: u.modelo_id || null, modelo: u.modelo_label || u.modelo || '',
        modalidad: u.propiedad === 'cliente' ? 'propio' : 'alquiler',
      }));
    }
    // Ancla automática (cuenta fragmentada): el destino NO se pregunta — se
    // informa. Y la consolidación se OFRECE cuando conviene, sin imponerla.
    const est = this._cuentaEstado();
    // Aviso (plan 2026-09-08 §4.3, corregido tras la verificación): un aumento
    // NO mezcla radios que el cliente ya tiene con radios nuevos — el anexo de
    // regularización cierra sin bodega y los nuevos se quedarían sin OS. Se
    // ofrece el anexo aparte, precargado con los D1 de la cuenta.
    const d1 = esPapel || this._aumRegulariza ? [] : this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id && !e.pendiente_devolucion);
    const nudgeReg = d1.length
      ? `<div class="cg-senal warn" style="margin-bottom:10px; align-items:center;">
          <span><b>${d1.length} radio${d1.length === 1 ? '' : 's'}</b> ya está${d1.length === 1 ? '' : 'n'} con el cliente sin contrato
            (<span class="cg-mono">${d1.slice(0, 6).map(e => this.esc(e.serial || e.id)).join(', ')}${d1.length > 6 ? '…' : ''}</span>).
            Aquí van <b>solo los radios nuevos</b>; esos se regularizan con un anexo aparte, sin bodega.</span>
          <button class="btn btn-ghost" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
            onclick="Centro.wizRegularizarCuenta()">Regularizar esos radios</button></div>`
      : '';
    const nudgeConsol = this._aumRegulariza ? '' : est.tipo === 'fragmentada' && !this._renovacionEnTramite()
      && (est.custodia || est.renovables.some(c => this._wcEnVentana(c)))
      ? `<div class="cg-senal warn" style="margin-bottom:10px; align-items:center;">
          <span>Esta cuenta tiene <b>${est.renovables.length} contrato(s)</b>${est.custodia ? ` y <b>${est.custodia} radio(s) sin contrato formal</b>` : ''} —
          si el cliente está por renovar, este es el momento de consolidarla.</span>
          <button class="btn btn-primary" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
            onclick="Centro.wizContrato({renovarCuenta:true, agregar:true})">Mejor renovar la cuenta</button></div>` : '';
    // El aviso de consolidación baja al pie del formulario (2026-09-08): es
    // secundario y antes era la tercera caja antes del primer campo.
    const nudge = nudgeReg;
    const destinoHtml = esPapel
      ? `<div class="form-field" style="margin-bottom:10px; max-width:420px;">
          <label class="form-label" for="waContratoPapel">Número del contrato en papel</label>
          <input class="form-input cg-mono" id="waContratoPapel" maxlength="40" autocomplete="off"
            placeholder="p. ej. ALQ 2019-044 — tal cual está en el papel">
          <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Se escribe a mano porque el contrato marco
            <b>no está en el sistema</b>. El anexo cita este número y no crea ningún contrato.</p>
          <select id="waContrato" class="hidden"><option value="" selected></option></select></div>`
      : this._aumRegulariza
      ? `<div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Seriales de la CUENTA</label>
          <p style="margin:0 0 6px; font-size:13px;">Cubre <b>${this._aumRegulariza.length} radio(s)</b> que el cliente
            tiene en campo sin contrato — <b>toda la cuenta</b>, no un contrato en particular.</p>
          ${activos.length > 1
            ? `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <span style="font-size:12.5px; color:var(--fg-3);">Las líneas entran en el contrato:</span>
                <select class="form-select" id="waContrato" style="max-width:300px;">
                  ${activos.map(c => `<option value="${this.esc(c.id)}" ${c.id === cBase.id ? 'selected' : ''}>${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
                </select>
                <span style="font-size:12px; color:var(--fg-4);">sale el de mayor facturación; cámbialo si prefieres otro</span>
              </div>`
            : `<p style="margin:0; font-size:13px;"><span style="color:var(--fg-3); font-size:12.5px;">Las líneas entran en el contrato</span>
                <span class="cg-mono">${this.esc(cBase.contrato_id || cBase.id)}</span></p>
               <select id="waContrato" class="hidden"><option value="${this.esc(cBase.id)}" selected></option></select>`}</div>`
      : opts.ancla
      ? `<div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Anexo a la cuenta</label>
          <p style="margin:0; font-size:13px;">Se cuelga del contrato ancla
            <span class="cg-mono">${this.esc(cBase.contrato_id || cBase.id)}</span>
            <span style="color:var(--fg-4);">(el de mayor facturación — se elige solo; el tramo tiene vigencia propia)</span></p>
          <select id="waContrato" class="hidden"><option value="${this.esc(cBase.id)}" selected></option></select></div>`
      : `<div class="form-field" style="margin-bottom:10px; max-width:340px;">
          <label class="form-label">Contrato destino</label>
          <select class="form-select" id="waContrato">
            ${activos.map(c => `<option value="${this.esc(c.id)}" ${c.id === preselId ? 'selected' : ''}>${this.esc(c.contrato_id || c.id)} · ${this.esc(c.tipo_contrato || '')}</option>`).join('')}
          </select></div>`;
    // Prellenado de líneas: en regularización, los modelos de los sobrantes.
    // Líneas FIJAS: modelo y cantidad salen de los seriales MARCADOS; solo se
    // pone precio. Un anexo de regularización no lleva radios nuevos (no pasa
    // por bodega ni genera OS — verificación 2026-09-08).
    this._aumRegularizaTodos = this._aumRegulariza ? [...this._aumRegulariza] : null;
    this._aumRegDestino = {};
    (this._aumRegularizaTodos || []).forEach(u => { this._aumRegDestino[u.serial] = 'entra'; });
    const lineasIni = this._aumRegulariza ? this._aumLineasFijasHtml({}) : this._lineaModeloHtml('wau', true);
    // El vendedor declara la cuenta COMPLETA aquí (Alberto 2026-09-09: "el
    // vendedor quiere regularizar sin mandar al cliente a firma, para que
    // quede documentado qué tiene y la cuenta esté lista para el próximo
    // trámite"). Antes solo se podía desmarcar —el serial seguía colgado del
    // cliente como deuda— y lo que faltaba obligaba a irse a Regularizar
    // cuenta. Ahora: destino por serial y "+ Agregar serial" (con o sin ficha
    // en el sistema). La cuenta que motivó todo esto: FORTUNATO MANGRAVITA.
    const regSenal = this._aumRegulariza ? `<div class="cg-senal warn" style="margin-bottom:10px; display:block;">
          <div>Declara la cuenta COMPLETA: lo que el cliente <b>YA tiene</b> queda amarrado al contrato con el
            tramo desde <b>hoy</b> —<b>sin firma, sin bodega, sin orden de servicio y sin entrega</b>— y lo marcado
            <b>“no lo tiene”</b> sale de la cuenta (queda por clasificar).</div>
          <div id="waRegSeriales" style="margin-top:8px;">${this._aumRegSerialesHtml()}</div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px;">
            <input class="form-input" id="waRegSerialNuevo" placeholder="Serial que el cliente tiene y no aparece…"
              style="max-width:250px;" aria-label="Serial a agregar"
              onkeydown="if(event.key==='Enter'){event.preventDefault();Centro._aumRegAgregarSerial();}">
            ${this._selModelo('id="waRegModeloNuevo" style="max-width:210px;" aria-label="Modelo del serial a agregar"')}
            <button type="button" class="btn btn-ghost cg-act" onclick="Centro._aumRegAgregarSerial()">+ Agregar serial</button>
          </div>
          <div style="margin-top:6px; font-size:12px; color:var(--fg-3);"><span id="waRegN">${this._aumRegulariza.length}</span>
            de ${this._aumRegularizaTodos.length} entran al contrato. El modelo solo hace falta si el serial no está en el sistema.</div></div>` : '';
    const papelSenal = esPapel
      ? `<div class="cg-senal warn" style="margin-bottom:10px;">
          <span><b>Salida para seguir sin regularizar hoy.</b> El anexo agrega equipos al contrato viejo
          citando su número; no crea ningún contrato en el sistema. Al entregarse, cada equipo queda en
          <b>custodia con su tramo propio</b> y la cuenta sigue marcada <b>sin contrato formal</b>: hay que
          regularizarla con un contrato nuevo cuando se pueda.</span></div>` : '';
    this._abrirModalA({
      titulo: `${this._aumRegulariza ? 'Actualizar seriales del cliente' : esPapel ? 'Anexo a contrato en papel' : 'Aumento de equipos (anexo)'} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        ${this._aumRegulariza
          ? `Pone el sistema al día con los equipos que el cliente <b>ya tiene</b>: al aprobarse se amarran al
             contrato y las líneas entran con tarifa desde hoy. <b>Al cliente no se le envía nada a firmar</b> —
             si hiciera falta su firma, el camino es un contrato.`
          : esPapel
          ? `El anexo agrega equipos <b>con vigencia propia</b> a un contrato que solo existe <b>en papel</b>:
             el período corre desde la entrega, el documento cita el número del contrato viejo y
             <b>requiere la firma del cliente</b> antes de salir a bodega.`
          : `El anexo agrega líneas <b>con vigencia propia</b>: el período del equipo
             nuevo corre desde su entrega y vence más tarde que el resto — el anexo lo deja explícito y
             <b>requiere la firma del cliente</b> antes de aplicarse.`}</p>
      ${regSenal}${papelSenal}${nudge}
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Destino del anexo</div>
        ${destinoHtml}
      </div>
      <div oninput="Centro._aumPreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Equipos y conceptos</div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="waLineas">${lineasIni}</div>
          ${this._aumRegulariza
            ? `<p style="margin:4px 0 0; font-size:12px; color:var(--fg-3);">Solo los ${this._aumRegulariza.length} equipo(s) que ya están con el cliente. ¿Radios nuevos? Van en <b>Agregar equipos</b>, que sí pasa por bodega y entrega.</p>`
            : `<button class="btn btn-ghost cg-act"
            onclick="Centro._addLineaModelo('waLineas','wau',true); Centro._aumPreview()">+ Agregar otro modelo</button>`}</div>
        <div class="form-field" style="margin-bottom:4px;">
          <label class="form-label">Otros conceptos (cargos del catálogo — únicos o mensuales)</label>
          <div id="waCargos"></div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('waCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml())">+ Agregar cargo</button></div>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Vigencia y totales</div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px;">
          <div class="form-field" style="margin:0; max-width:180px;">
            <label class="form-label" for="waMeses">Vigencia del tramo (meses)</label>
            <input class="form-input" type="number" id="waMeses" min="1" value="18"></div>
          <label class="cg-toggle" style="margin-bottom:2px;">
            <input type="checkbox" id="waItbms" ${itbmsDefault ? 'checked' : ''} onchange="Centro._aumPreview()">
            Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}
          </label>
        </div>
        <div id="waTot" class="ds-card" style="padding:10px 14px; max-width:380px;"></div>
        ${nudgeConsol ? `<div style="margin-top:12px;">${nudgeConsol}</div>` : ''}
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearAumento(this)">Enviar a aprobación</button>`,
    });
    this._aumPreview();
  },

  // Número manual del contrato en papel — espejo de
  // functions/src/lib/adendaPapel.normalizarRefPapel (sin comillas, espacios
  // colapsados, mayúsculas) para que lo guardado sea lo mismo que se lee.
  _normRefPapel(texto) {
    return String(texto == null ? '' : texto).replace(/["'`]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  },

  // Candado contra el doble submit (auditoría UX 2026-09-28, P0 #10): cada
  // click consumía un correlativo y mandaba un correo de aprobación.
  crearAumento(btn) {
    return withBusy(btn || null, () => this._crearAumento(), { key: 'crearAumento', label: 'Enviando…', rethrow: false, intento: this._intento('crearAumento', 'Aumento de equipos') });
  },
  async _crearAumento() {
    const esPapel = this._aumPapel === true;
    const contratoDocId = document.getElementById('waContrato')?.value || '';
    const contrato = esPapel ? null : this.contratos.find(c => c.id === contratoDocId);
    const refPapel = esPapel ? this._normRefPapel(document.getElementById('waContratoPapel')?.value) : '';
    if (esPapel && !refPapel) { Toast.show('Escribe el número del contrato en papel', 'warn'); document.getElementById('waContratoPapel')?.focus(); return; }
    if (!esPapel && !contrato) { Toast.show('Elige el contrato destino', 'warn'); return; }
    const lineas = this._aumLineas();
    // Cargo elegido SIN monto (2026-10-02, COMPAÑÍA GOLY: "Consola" trae $0 en
    // el catálogo): _aumCargos lo descarta y el vendedor recibía "indica al
    // menos un modelo", que no dice nada de lo que le falta.
    const sinMonto = !lineas.length && !this._aumCargos().length
      && [...document.querySelectorAll('.wa-cargo [data-wac-sel]')].find(s => s.value);
    if (sinMonto) {
      Toast.show(`Pon el monto de «${(sinMonto.selectedOptions[0]?.textContent || 'el cargo').trim()}»`, 'warn');
      sinMonto.closest('.wa-cargo')?.querySelector('[data-wac-monto]')?.focus();
      return;
    }
    // Sin equipos pero CON cargos = un AJUSTE DE TARIFA (2026-09-02): en vez
    // de regañar, se redirige al wizard correcto — ahí se amarran los cargos
    // por serial y el flujo cierra sin bodega. En papel no hay contrato que
    // ajustar: la adenda necesita al menos un equipo.
    // Los cargos viajan al ajuste ya cargados (2026-10-02, GOLY): el wizard
    // abría en blanco, la vendedora creía haber fallado y lo intentó dos
    // veces más por "Agregar equipos" sin que nada se guardara.
    const cargosSolos = this._aumCargos();
    if (!lineas.length && cargosSolos.length) {
      if (esPapel) { Toast.show('El anexo a contrato en papel necesita al menos un equipo — los cargos solos no tienen contrato al que aplicarse', 'warn'); return; }
      Toast.show(`${cargosSolos.map(c => c.concepto).join(', ')} no es un radio: va como cargo del contrato. Te paso al anexo de consola o servicio, también lleva aprobación y firma del cliente`, 'ok');
      this.wizAjuste(contratoDocId, { cargos: cargosSolos });
      return;
    }
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (lineas.some(l => !(l.precio > 0))) { Toast.show('Cada línea necesita su precio mensual', 'warn'); return; }
    if (this._lineasSinModalidad(lineas)) {
      Toast.show(this.MSG_SIN_MODALIDAD, 'warn');
      document.querySelector('select[data-wau-modalidad]:not([disabled])')?.focus();
      return;
    }
    // Candado (verificación 2026-09-08): un anexo de regularización cierra
    // sin bodega, OS ni entrega — si llevara radios nuevos, esos radios
    // nunca saldrían. Las cantidades tienen que ser exactamente los seriales.
    if (this._aumRegulariza) {
      if (!this._aumRegulariza.length) { Toast.show('Marca al menos un serial que el cliente sí tiene — si no tiene ninguno, decláralo en Regularizar cuenta', 'warn'); return; }
      const sinModelo = this._aumRegulariza.filter(u => !u.modelo_id && !u.modelo);
      if (sinModelo.length) { Toast.show(`Elige el modelo de ${sinModelo.map(u => u.serial).join(', ')}`, 'warn'); return; }
      const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
      if (total !== this._aumRegulariza.length) {
        Toast.show(`El anexo de regularización cubre exactamente ${this._aumRegulariza.length} equipo(s) que ya están con el cliente — los radios nuevos van en un aumento aparte`, 'warn');
        return;
      }
    }
    const meses = Number(document.getElementById('waMeses')?.value || 0);
    if (!(meses > 0)) { Toast.show('Indica la vigencia del tramo en meses', 'warn'); return; }
    const cargos = this._aumCargos();
    const itbmsAplica = document.getElementById('waItbms')?.checked !== false;
    const totales = this._totAumento(lineas, cargos, itbmsAplica);
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
          // Adenda a contrato en papel: sin contrato interno (null) y el
          // número manual como etiqueta; el flag lo leen los triggers.
          contrato_doc_id: contrato ? contrato.id : null,
          contrato_id: contrato ? (contrato.contrato_id || contrato.id) : refPapel,
          ...(esPapel ? { contrato_papel: true } : {}),
          lineas,
          cargos,
          itbms: { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
          totales,
          duracion_meses: meses,
          seriales_asignados: [],
          // Regularización: B3 amarra estos seriales (ya en campo) al
          // firmarse el anexo y cierra la gestión — sin bodega ni entrega.
          ...(this._aumRegulariza
            ? { es_regularizacion: true,
                regulariza_seriales: this._aumRegulariza.map(u => ({
                  pool_doc_id: u.pool_doc_id || null, serial: u.serial,
                  modelo_id: u.modelo_id || null, modelo: u.modelo || '',
                  ...(u.modalidad ? { modalidad: u.modalidad } : {}) })),
                // Los que el cliente NO tiene: al aplicarse el anexo salen de
                // la cuenta (por clasificar), igual que el destino 'no_tiene'
                // del plan por serial de una renovación.
                ...(this._aumRegNoTiene().length
                  ? { regulariza_no_tiene: this._aumRegNoTiene().map(u => ({
                      serial: u.serial, ...(u.pool_doc_id ? { pool_doc_id: u.pool_doc_id } : {}),
                      modelo_id: u.modelo_id || null, modelo: u.modelo || '' })) } : {}) } : {}),
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      const nNoTiene = this._aumRegulariza ? this._aumRegNoTiene().length : 0;
      Toast.show(this._aumRegulariza
        ? `Actualización de seriales ${gid} enviada a aprobación — al aprobarse amarra ${this._aumRegulariza.length} equipo(s)${nNoTiene ? ` y suelta ${nNoTiene} de la cuenta` : ''}, sin firma del cliente`
        : esPapel
        ? `Anexo ${gid} al contrato en papel ${refPapel} enviado a aprobación de administración — la cuenta sigue pendiente de regularizar`
        : `Aumento ${gid} enviado a aprobación de administración`, 'ok');
      this._aumRegulariza = null;
      this._aumRegularizaTodos = null;
      this._aumRegDestino = {};
      this._aumPapel = false;
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear el aumento', 'bad'); }
  },
});
