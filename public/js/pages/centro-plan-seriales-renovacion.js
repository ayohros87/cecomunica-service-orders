// @ts-nocheck
// Centro de gestión de clientes — Plan de seriales de la renovación (2026-09-04).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Plan de seriales de la renovación (2026-09-04) ═════════
   * Reclamo de Alberto (caso CENTRO CULTURAL CHINO PANAMEÑO): la renovación
   * no aclaraba QUÉ seriales siguen con el cliente. La tabla solo listaba las
   * fichas colgadas de un contrato de origen del sistema — y los contratos
   * viejos (legacy) no tienen seriales, así que salía vacía mientras el pool
   * tenía 22 fichas amarradas al cliente por la migración POC, sin verificar.
   *
   * Ahora la tabla es LA CUENTA COMPLETA: todo lo que el pool dice que el
   * cliente tiene (contrato de origen, custodia sin contrato, migración sin
   * verificar), con destino por serial — continúa / se devuelve / se
   * reemplaza / el cliente NO lo tiene — más los seriales que el vendedor
   * AGREGA porque el cliente sí los tiene y el sistema no lo sabía. Al
   * aprobarse, functions/src/lib/planRenovacion.js lo aplica: los
   * 'continúa' entran como filas del contrato (→ Anexo A), los 'no lo
   * tiene' se sueltan del cliente (→ por clasificar). */

  // Unidades del pool que el sistema le atribuye al cliente. `fuente` dice
  // de dónde viene la atribución (rastro para el aprobador y el kardex).
  _wcUnidadesCuenta(origenIds) {
    const ids = origenIds || [];
    return this.equipos
      .filter(e => ['en_cliente', 'asignado_contrato', 'por_clasificar'].includes(e.estado))
      .map(e => {
        const cid = e.asignacion?.contrato_doc_id || null;
        const fuente = e.estado === 'por_clasificar' || e.verificado === false && e.origen === 'migracion_poc' && !cid
          ? 'migracion' : cid ? 'origen' : 'custodia';
        return { u: e, fuente, deOrigen: !!cid && ids.includes(cid) };
      })
      // Primero las del origen que se renueva, luego custodia, luego migración.
      .sort((a, b) => (['origen', 'custodia', 'migracion'].indexOf(a.fuente) - ['origen', 'custodia', 'migracion'].indexOf(b.fuente))
        || String(a.u.serial || a.u.id).localeCompare(String(b.u.serial || b.u.id)));
  },

  _wcFuenteHtml(fuente, u) {
    if (fuente === 'origen') return `<span class="cg-mono">${this.esc(u.asignacion?.contrato_id || 'contrato')}</span>`;
    if (fuente === 'custodia') return '<span style="color:var(--fg-3);">en campo · sin contrato</span>';
    if (fuente === 'agregado') return '<span style="color:var(--ok-deep, #065F46);">agregado por ti</span>';
    return '<span style="color:var(--warn-deep, #92400E);" title="La ficha llegó de la migración POC y nadie la verificó con el cliente">migración · sin verificar</span>';
  },

  // Celda de destino de un serial: el destino es OBLIGATORIO (arranca en
  // "— elige —"; Alberto 2026-09-04: "este paso tiene que ser obligatorio
  // para el vendedor"). 'Se reemplaza' siempre está y pregunta POR QUÉ: uno
  // nuevo del mismo modelo o de OTRO modelo del catálogo. 'Continúa' ofrece
  // el check de refurbished por serial.
  _wcDestinoCelda(id, st = {}) {
    const opts = [['', '— elige —'], ['continua', 'Continúa'], ['reemplaza', 'Se reemplaza'], ['devuelve', 'Se devuelve'], ['no_tiene', 'El cliente no lo tiene']];
    const d = opts.some(o => o[0] === st.destino) ? st.destino : '';
    const modelos = (this.modelos || []).map(m => `<option value="${this.esc(m.id)}" ${st.reemplazo === m.id ? 'selected' : ''}>${this.esc(m.label)}</option>`).join('');
    return `<div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
      <select class="form-select" data-wcp="${this.esc(id)}" onchange="Centro._wcDestinoChange(this)" style="min-width:170px; ${d ? '' : 'border-color:var(--warn, #F59E0B);'}">
        ${opts.map(([v, l]) => `<option value="${v}" ${v === d ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select class="form-select" data-wcpr="${this.esc(id)}" onchange="Centro._wcConciliar()" title="Por qué se reemplaza" style="min-width:190px; ${d === 'reemplaza' ? '' : 'display:none;'}">
        <option value="">por uno nuevo del mismo modelo</option>${modelos}</select>
      <label class="cg-toggle" data-wcpf-wrap="${this.esc(id)}" style="font-size:12px; padding:3px 8px; ${d === 'continua' ? '' : 'display:none;'}" title="Refurbished de batería, antena, clip y piezas para este radio">
        <input type="checkbox" data-wcpf="${this.esc(id)}" ${st.refurbished ? 'checked' : ''} onchange="Centro._wcConciliar()"> refurbished</label>
    </div>`;
  },
  // Los ids del pool son alfanuméricos (serial normalizado); el escape es
  // solo por si un doc sufijado (colisión __modelo) o un jsdom sin CSS.escape.
  _cssEsc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); },
  _wcDestinoChange(sel) {
    const id = sel.dataset.wcp;
    const q = (attr) => document.querySelector(`[${attr}="${this._cssEsc(id)}"]`);
    const r = q('data-wcpr'); if (r) r.style.display = sel.value === 'reemplaza' ? '' : 'none';
    const f = q('data-wcpf-wrap'); if (f) f.style.display = sel.value === 'continua' ? '' : 'none';
    sel.style.borderColor = sel.value ? '' : 'var(--warn, #F59E0B)';
    this._wcConciliar();
    this._ssContar('wcp');
  },

  // Estado vivo del plan mientras el wizard está abierto: destino, modelo de
  // reemplazo y refurbished por pool_id (sobreviven a re-pintados) y seriales
  // agregados a mano.
  _wcPlanState: { destinos: {}, reemplazos: {}, refurb: {}, agregados: [] },
  _wcCapturarEstado() {
    const S = this._wcPlanState;
    document.querySelectorAll('select[data-wcp]').forEach(s => { S.destinos[s.dataset.wcp] = s.value; });
    document.querySelectorAll('select[data-wcpr]').forEach(s => { S.reemplazos[s.dataset.wcpr] = s.value; });
    document.querySelectorAll('input[data-wcpf]').forEach(i => { S.refurb[i.dataset.wcpf] = i.checked; });
    document.querySelectorAll('input[data-wcpaf]').forEach(i => { const a = S.agregados[Number(i.dataset.wcpaf)]; if (a) a.refurbished = i.checked; });
  },

  _wcSyncPlan() {
    const cont = document.getElementById('wcPlan');
    if (!cont) return;
    const sel = { accion: document.getElementById('wcAccion')?.value, codigo_tipo: document.getElementById('wcTipo')?.value };
    if (!TransicionPlan.aplica(sel)) { cont.innerHTML = ''; return; }
    // Recoge lo elegido antes de re-pintar (cambio de origen, de modalidad…).
    this._wcCapturarEstado();
    const S = this._wcPlanState;
    const ids = this._wcOrigenIds();
    const unidades = this._wcUnidadesCuenta(ids);
    const agregados = S.agregados;
    // Selector compartido (P4): buscador, un grupo por contrato de origen,
    // luego custodia y migración; "Todos continúan" también por grupo. Con
    // 273 radios el modal medía 18,956 px y nadie revisaba 273 destinos.
    const grupoDe = (fuente, u) => fuente === 'origen'
      ? { grupo: u.asignacion?.contrato_doc_id || '__sin', grupoLabel: `Contrato ${u.asignacion?.contrato_id || ''}`.trim(), orden: 0 }
      : fuente === 'custodia' ? { grupo: '__custodia', grupoLabel: 'En campo · sin contrato', orden: 8e8 }
      : { grupo: '__migracion', grupoLabel: 'Migración · sin verificar', orden: 8.5e8 };
    const filas = [
      ...unidades.map(({ u, fuente }) => ({
        ...grupoDe(fuente, u), ok: true,
        busca: `${u.serial || u.id} ${u.modelo_label || ''} ${u.asignacion?.contrato_id || ''}`,
        celdas: `
        <td class="cg-mono">${this.esc(u.serial || u.id)}</td>
        <td>${this.esc(u.modelo_label || '—')}${u.propiedad === 'cliente' ? ' <span style="color:var(--fg-4); font-size:11px;">del cliente</span>' : ''}</td>
        <td style="font-size:12.5px;">${this._wcFuenteHtml(fuente, u)}</td>
        <td>${this._wcDestinoCelda(u.id, { destino: S.destinos[u.id] || '', reemplazo: S.reemplazos[u.id] || '', refurbished: !!S.refurb[u.id] })}</td>`,
      })),
      ...agregados.map((a, i) => ({
        grupo: '__agregados', grupoLabel: 'Agregados por ti', orden: -1, grupoAbierto: true, ok: true,
        busca: `${a.serial} ${a.modelo || ''}`,
        celdas: `
        <td class="cg-mono">${this.esc(a.serial)}</td>
        <td>${a.pool ? this.esc(a.modelo || '—') : this._selModelo(`data-wcpa-modelo="${i}" onchange="Centro._wcConciliar()" style="min-width:180px;"`, a.modelo_id, a.modelo)}
          ${a.aviso ? `<div style="font-size:11.5px; color:var(--warn-deep, #92400E);">${this.esc(a.aviso)}</div>` : ''}</td>
        <td style="font-size:12.5px;">${this._wcFuenteHtml('agregado', a)}</td>
        <td style="white-space:nowrap;"><span style="font-size:12.5px;">Continúa</span>
          <label class="cg-toggle" style="font-size:12px; padding:3px 8px; margin-left:6px;" title="Refurbished de batería, antena, clip y piezas para este radio">
            <input type="checkbox" data-wcpaf="${i}" ${a.refurbished ? 'checked' : ''} onchange="Centro._wcConciliar()"> refurbished</label>
          <button type="button" class="btn btn-ghost" style="padding:2px 8px; margin-left:6px;" title="Quitar"
            onclick="Centro._wcQuitarAgregado(${i})">✕</button></td>`,
      })),
    ];
    const vacio = !filas.length;
    const ss = vacio ? { barra: '', cuerpo: '' } : this._ssHtml('wcp', filas, { colspan: 4, modo: 'destinos', placeholder: 'Serial, modelo o contrato…',
      accionesGrupo: (k) => k === '__agregados' ? '' : `
        <button type="button" class="btn btn-ghost cg-act" style="padding:1px 8px; font-size:12px;" onclick="Centro._wcMarcarGrupo('${this.esc(k)}','continua')">Todos continúan</button>
        <button type="button" class="btn btn-ghost cg-act" style="padding:1px 8px; font-size:12px;" onclick="Centro._wcMarcarGrupo('${this.esc(k)}','no_tiene')">Ninguno lo tiene</button>` });
    cont.innerHTML = `
      ${vacio ? `<p style="font-size:12.5px; color:var(--fg-3); margin:0 0 8px;">El sistema no le atribuye ningún serial a este cliente. Agrega abajo los que tiene, o confirma que la cuenta no tiene equipos con serial.</p>
          <label class="cg-toggle" style="margin-bottom:8px;"><input type="checkbox" id="wcSinSeriales" ${S.sinSeriales ? 'checked' : ''} onchange="Centro._wcPlanState.sinSeriales=this.checked; Centro._wcConciliar()"> Confirmo que el cliente no tiene equipos con serial que declarar</label>`
        : `${ss.barra}<table class="cg-tabla"><thead><tr>
            <th>Serial</th><th>Modelo</th><th>Según el sistema</th><th>Destino <span style="font-weight:400; text-transform:none; letter-spacing:0;">(obligatorio en cada serial)</span></th></tr></thead>
          <tbody data-sscuerpo="wcp">${ss.cuerpo}</tbody></table>`}
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px;">
        <input class="form-input" id="wcSerialNuevo" placeholder="Serial que el cliente tiene y no aparece…" style="max-width:280px;"
          aria-label="Serial a agregar" onkeydown="if(event.key==='Enter'){event.preventDefault();Centro._wcAgregarSerial();}">
        <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcAgregarSerial()">+ Agregar serial</button>
        ${unidades.length ? `<span style="flex:1;"></span>
          <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcMarcarTodos('continua')">Todos continúan</button>
          <button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcMarcarTodos('no_tiene')">Ninguno lo tiene</button>` : ''}
      </div>
      <div id="wcPlanConc" style="margin-top:8px;"></div>`;
    if (!vacio) this._ssMontar('wcp');
    this._wcConciliar();
  },

  _wcMarcarTodos(destino) {
    document.querySelectorAll('select[data-wcp]').forEach(s => {
      if ([...s.options].some(o => o.value === destino)) { s.value = destino; this._wcDestinoChange(s); }
    });
    this._wcConciliar();
    this._ssContar('wcp');
  },
  // Lo mismo, para un solo grupo del selector (un contrato de origen, la custodia…).
  _wcMarcarGrupo(k, destino) {
    document.querySelectorAll(`[data-sscuerpo="wcp"] tr[data-ssg="${this._cssEsc(k)}"] select[data-wcp]`).forEach(s => {
      if ([...s.options].some(o => o.value === destino)) { s.value = destino; this._wcDestinoChange(s); }
    });
    this._wcConciliar();
    this._ssContar('wcp');
  },

  _wcQuitarAgregado(i) {
    this._wcPlanState.agregados.splice(i, 1);
    this._wcSyncPlan();
  },

  // Agrega un serial que el cliente tiene y el sistema no le atribuye. Se
  // busca en el pool: si existe, se toma su modelo y se AVISA dónde dice el
  // sistema que está (otro cliente, bodega, taller…) — se permite igual,
  // porque regularizar es justamente corregir eso, pero el aprobador lo ve.
  async _wcAgregarSerial() {
    const inp = document.getElementById('wcSerialNuevo');
    const raw = (inp?.value || '').trim();
    if (!raw) return;
    const norm = EquiposPoolService.normalizarSerial(raw);
    if (!EquiposPoolService.esSerialValido(norm)) { Toast.show('Ese serial no parece válido', 'warn'); return; }
    const ya = this._wcPlanState.agregados.some(a => a.serial_norm === norm)
      || this.equipos.some(e => e.id === norm || EquiposPoolService.normalizarSerial(e.serial) === norm);
    if (ya) { Toast.show(`${norm} ya está en la lista`, 'warn'); return; }
    let ficha = null;
    try { ficha = await EquiposPoolService.findBySerial(raw); } catch (_) { /* sin red: se agrega sin ficha */ }
    const L = EquiposPoolService.ESTADO_LABELS || {};
    let aviso = '';
    if (ficha) {
      const otro = ficha.asignacion?.cliente_id && ficha.asignacion.cliente_id !== this.cliente.id
        ? ` · asignado a ${ficha.asignacion.cliente_nombre || 'otro cliente'}${ficha.asignacion.contrato_id ? ` (${ficha.asignacion.contrato_id})` : ''}` : '';
      aviso = `Según el sistema: ${L[ficha.estado] || ficha.estado || '—'}${otro}`;
      if (ficha.estado === 'baja') { Toast.show(`${norm} está dado de BAJA — no se puede reactivar desde aquí`, 'bad'); return; }
    } else {
      aviso = 'Sin ficha en el pool: nace con este contrato — elige el modelo';
    }
    this._wcPlanState.agregados.push({
      serial: ficha ? (ficha.serial || raw) : raw, serial_norm: norm, pool: !!ficha, pool_id: ficha ? ficha.id : null,
      modelo_id: ficha?.modelo_id || null, modelo: ficha?.modelo_label || '',
      propiedad: ficha?.propiedad || null, aviso,
    });
    this._wcSyncPlan();
    document.getElementById('wcSerialNuevo')?.focus();
  },

  // Lee el plan tal como está en pantalla (o null si no aplica / vacío).
  _wcLeerPlan(origenIds) {
    const unidades = [...document.querySelectorAll('select[data-wcp]')].map(s => {
      const e = this.equipos.find(x => x.id === s.dataset.wcp);
      if (!e) return null;
      const cid = e.asignacion?.contrato_doc_id || null;
      const fuente = e.estado === 'por_clasificar' ? 'migracion' : cid ? 'origen' : 'custodia';
      const idSel = this._cssEsc(e.id);
      const rSel = document.querySelector(`select[data-wcpr="${idSel}"]`);
      const rm = s.value === 'reemplaza' && rSel?.value ? this._modeloDeSelect(rSel) : null;
      const refurbished = s.value === 'continua' && !!document.querySelector(`input[data-wcpf="${idSel}"]`)?.checked;
      return { pool_id: e.id, serial: e.serial || e.id, serial_norm: e.id,
        modelo_id: e.modelo_id || null, modelo: e.modelo_label || '', destino: s.value, fuente,
        modalidad: e.propiedad === 'cliente' ? 'propio' : 'alquiler',
        ...(rm ? { reemplazo_modelo_id: rm.id, reemplazo_modelo: rm.label } : {}),
        ...(refurbished ? { refurbished: true } : {}) };
    }).filter(Boolean);
    // Destino obligatorio: se cuenta lo que falta y esas filas NO entran al
    // plan (construirSerial las convertiría en 'devuelve' por defecto).
    this._wcSinDestino = unidades.filter(u => !u.destino).length;
    const conDestino = unidades.filter(u => u.destino);
    this._wcPlanState.agregados.forEach((a, i) => {
      let modelo_id = a.modelo_id, modelo = a.modelo;
      if (!a.pool) {
        const m = this._modeloDeSelect(document.querySelector(`select[data-wcpa-modelo="${i}"]`));
        modelo_id = m?.id || null; modelo = m?.label || '';
      }
      const refurbished = !!document.querySelector(`input[data-wcpaf="${i}"]`)?.checked;
      conDestino.push({ pool_id: a.pool_id, serial: a.serial, serial_norm: a.serial_norm, modelo_id, modelo,
        destino: 'continua', fuente: 'agregado', modalidad: a.propiedad === 'cliente' ? 'propio' : 'alquiler',
        ...(refurbished ? { refurbished: true } : {}) });
    });
    if (!conDestino.length) return null;
    return TransicionPlan.construirSerial(conDestino, origenIds || []);
  },

  // Aviso vivo: por línea, cuántos continúan + cuántos entran por reemplazo
  // vs. la cantidad de la línea. La línea tiene que cubrir al menos esos
  // (si no, la cuenta no cuadra — "Cuadrar" la iguala); lo que sobre son
  // radios NUEVOS (venta dentro de la renovación). De ahí se DERIVA la
  // modalidad: sin equipo / con reemplazos / con radios nuevos / refurbished.
  _wcConciliar() {
    const box = document.getElementById('wcPlanConc');
    if (!box) return { ok: true, sinDestino: 0 };
    const plan = this._wcLeerPlan(this._wcOrigenIds());
    const sinDestino = this._wcSinDestino || 0;
    const modBox = document.getElementById('wcModalidad');
    if (!plan) {
      box.innerHTML = sinDestino ? `<div style="color:var(--warn-deep, #92400E); font-size:12.5px;">Elige el destino de los ${sinDestino} serial(es).</div>` : '';
      if (modBox) modBox.textContent = 'La modalidad (sin equipo / con reemplazos / refurbished) sale de lo que declares por serial en el paso 2.';
      return { ok: !sinDestino, sinDestino, plan: null, sinLinea: [], faltaModelo: false, desajuste: false, modalidad: null, otraModalidad: [] };
    }
    const lineas = this._lineasModelo('wcm');
    const r = TransicionPlan.conciliarLineas(plan, lineas);
    const partes = [];
    let desajuste = false;
    r.porLinea.forEach(({ idx, continuan, reemplazan }) => {
      const l = lineas[idx];
      const cant = Number(l.cantidad || 0);
      const min = continuan + reemplazan;
      const ok = cant >= min;
      if (!ok) desajuste = true;
      const nuevos = Math.max(0, cant - min);
      partes.push(`<span style="${ok ? '' : 'color:var(--warn-deep, #92400E); font-weight:600;'}">${this.esc(l.modelo)}${l.modalidad === 'propio' ? ' (del cliente)' : ''}: ${continuan} continúa${continuan === 1 ? '' : 'n'}${reemplazan ? ` + ${reemplazan} reemplazo${reemplazan === 1 ? '' : 's'}` : ''}${nuevos ? ` + ${nuevos} nuevo${nuevos === 1 ? '' : 's'}` : ''} · línea ${cant}</span>`);
    });
    const faltaModelo = plan.unidades.some(u => u.fuente === 'agregado' && !u.modelo && !u.modelo_id);
    const sinLinea = r.sinLinea.length
      ? `<div style="color:var(--warn-deep, #92400E); font-size:12.5px; margin-top:4px;"><b>${r.sinLinea.length} serial(es) sin línea en el contrato</b>: ${r.sinLinea.map(u => this.esc(u.serial)).join(', ')} — agrega su modelo${r.sinLinea.some(u => u.destino === 'reemplaza') ? ' (el del reemplazo)' : ''} en “Equipos y tarifas” o cámbiales el destino.</div>` : '';
    // Seriales que entraron en una línea de OTRA modalidad (segundo pase de
    // conciliarLineas): se dice, no se bloquea. La ficha del pool suele venir
    // de una migración sin verificar y la línea es lo que el vendedor declara.
    const otraMod = this._wcOtraModalidadHtml(r.otraModalidad);
    const modalidad = TransicionPlan.derivarModalidad(plan, lineas);
    if (modBox) {
      modBox.innerHTML = `<b>${modalidad.sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo'}</b> — ${modalidad.continuan} continúa${modalidad.continuan === 1 ? '' : 'n'}${modalidad.reemplazos ? ` · ${modalidad.reemplazos} reemplazo${modalidad.reemplazos === 1 ? '' : 's'}` : ''}${modalidad.nuevos ? ` · ${modalidad.nuevos} radio${modalidad.nuevos === 1 ? '' : 's'} nuevo${modalidad.nuevos === 1 ? '' : 's'}` : ''} · refurbished: ${modalidad.refurbished ? `<b>sí</b> (${modalidad.refurbished_n})` : 'no'}`;
    }
    box.innerHTML = `
      ${sinDestino ? `<div style="color:var(--warn-deep, #92400E); font-size:12.5px; margin-bottom:4px;"><b>Faltan ${sinDestino} serial(es) por decidir</b> — cada uno necesita destino.</div>` : ''}
      <div style="font-size:12.5px; color:var(--fg-3);">${this.esc(TransicionPlan.resumen(plan))}</div>
      ${partes.length ? `<div style="display:flex; gap:14px; flex-wrap:wrap; font-size:12.5px; margin-top:4px;">${partes.join('')}
        ${desajuste && !this._wcSoloPlan ? `<button type="button" class="btn btn-ghost cg-act" onclick="Centro._wcCuadrar()">Cuadrar cantidades con los seriales</button>` : ''}</div>` : ''}
      ${sinLinea}${otraMod}
      ${faltaModelo ? '<div style="color:var(--warn-deep, #92400E); font-size:12.5px; margin-top:4px;">Elige el modelo de cada serial agregado sin ficha.</div>' : ''}`;
    return { ok: !sinDestino && !desajuste && !r.sinLinea.length && !faltaModelo, plan, desajuste, sinLinea: r.sinLinea, faltaModelo, sinDestino, modalidad, otraModalidad: r.otraModalidad || [] };
  },

  // Aviso (nunca bloqueo) de los seriales que cayeron en una línea de otra
  // modalidad: qué dice la ficha del pool, qué dice la línea y qué manda.
  _wcOtraModalidadHtml(lista) {
    if (!Array.isArray(lista) || !lista.length) return '';
    const como = (m) => m === 'propio' ? 'del cliente' : 'de alquiler';
    const grupos = new Map();
    for (const x of lista) {
      const k = `${x.ficha}→${x.linea}`;
      const g = grupos.get(k) || { ficha: x.ficha, linea: x.linea, seriales: [] };
      g.seriales.push(x.unidad.serial || x.unidad.serial_norm || '');
      grupos.set(k, g);
    }
    return [...grupos.values()].map(g => `<div style="color:var(--fg-3); font-size:12.5px; margin-top:4px;">
      <b>${g.seriales.length} serial(es) que el sistema tiene como equipo ${como(g.ficha)}</b> entran en una línea
      ${como(g.linea)}: ${this.esc(g.seriales.join(', '))}. Manda la línea del contrato — casi siempre la ficha viene
      de una migración que nadie verificó. Si de verdad son ${como(g.ficha)}, agrégales una línea con esa modalidad.</div>`).join('');
  },

  // ── Corregir los seriales de una renovación YA APROBADA, antes de la firma
  // (caso SERV20260904-01, Chino Panameño: se aprobó sin plan). Misma tabla
  // del wizard; solo se guarda `transicion_plan` — el trigger onPlanRenovacion
  // aplica la diferencia (filas del Anexo A, fichas que se sueltan). Tras la
  // firma no se ofrece: el Anexo A firmado queda congelado y cualquier cambio
  // va por anexo. Las líneas se muestran para conciliar, no se editan aquí. ──
  async wizSerialesRenovacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.accion !== 'Renovación') return;
    if (c.estado !== 'aprobado' || c.firmado) { Toast.show('Los seriales se corrigen con el contrato aprobado y antes de la firma', 'warn'); return; }
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no edita contratos desde aquí', 'warn'); return; }
    this._cerrarModal();
    await this._cargarModelos();
    const origenIds = Array.isArray(c.contrato_origen_ids) ? c.contrato_origen_ids : (c.contrato_origen_id ? [c.contrato_origen_id] : []);
    // Prefill desde el plan guardado.
    const plan = c.transicion_plan?.nivel === 'serial' ? c.transicion_plan : null;
    const destinos = {}; const reemplazos = {}; const refurb = {}; const agregados = [];
    (plan?.unidades || []).forEach(u => {
      if (u.fuente === 'agregado' || (u.pool_id && !this.equipos.some(e => e.id === u.pool_id))) {
        agregados.push({ serial: u.serial, serial_norm: u.serial_norm, pool: !!u.pool_id, pool_id: u.pool_id || null,
          modelo_id: u.modelo_id || null, modelo: u.modelo || '', propiedad: u.modalidad === 'propio' ? 'cliente' : null, aviso: '',
          refurbished: u.refurbished === true });
      } else if (u.pool_id) {
        destinos[u.pool_id] = u.destino;
        if (u.reemplazo_modelo_id) reemplazos[u.pool_id] = u.reemplazo_modelo_id;
        if (u.refurbished) refurb[u.pool_id] = true;
      }
    });
    this._wcPlanState = { destinos, reemplazos, refurb, agregados };
    this._ssReset('wcp');
    this._wcSoloPlan = true;
    this._abrirModalA({
      titulo: `Seriales de la cuenta — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        Renovación aprobada y sin firmar. Decide cada serial: continúa (con refurbished o no), se reemplaza
        (por uno nuevo igual o de otro modelo), se devuelve, o el cliente <b>no lo tiene</b> (sale de la cuenta y queda
        por clasificar); agrega los que le faltan al sistema. Al guardar, los que continúan pasan al Anexo A que el
        cliente firma. La modalidad de la renovación se deriva de aquí.</p>
      <div id="wcModalidad" style="font-size:12.5px; color:var(--fg-3); margin:0 0 10px;"></div>
      <select id="wcAccion" class="hidden" aria-hidden="true"><option value="Renovación" selected>Renovación</option></select>
      <select id="wcTipo" class="hidden" aria-hidden="true"><option value="${this.esc(c.codigo_tipo || 'SERV')}" selected></option></select>
      ${origenIds.map(o => `<input type="checkbox" data-wco value="${this.esc(o)}" checked class="hidden" aria-hidden="true">`).join('')}
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Líneas del contrato <span class="hint">solo lectura — para conciliar</span></div>
        <div id="wcLineas">${(c.equipos || []).map(l => this._lineaModeloPre('wcm', true, l)).join('')}</div>
      </div>
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Seriales de la cuenta</div>
        <div id="wcPlan" class="cg-twrap"></div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._wcSoloPlan=false; Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="wcGuardarPlan" onclick="Centro.guardarPlanRenovacion('${this.esc(c.id)}')">Guardar seriales</button>`,
    });
    // Las líneas no se editan aquí (el contrato ya está aprobado).
    document.querySelectorAll('#wcLineas input, #wcLineas select, #wcLineas button').forEach(el => { el.disabled = true; });
    this._wcSyncPlan();
  },

  async guardarPlanRenovacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const conc = this._wcConciliar();
    const plan = conc.plan || null;
    if (conc.sinDestino) { Toast.show(`⚠️ Faltan ${conc.sinDestino} serial(es) por decidir — elige el destino de cada uno`, 'warn'); return; }
    if (!plan) { Toast.show('Declara al menos un serial (o agrega los que el cliente tiene)', 'warn'); return; }
    const v = TransicionPlan.validar(plan);
    if (!v.ok) { Toast.show(`⚠️ ${v.mensaje}`, 'warn'); return; }
    if (conc.faltaModelo) { Toast.show('⚠️ Elige el modelo de cada serial agregado sin ficha', 'warn'); return; }
    if (conc.sinLinea.length) { Toast.show(`⚠️ ${conc.sinLinea.length} serial(es) sin línea en el contrato — cámbiales el destino o pide editar el contrato`, 'warn'); return; }
    const btn = document.getElementById('wcGuardarPlan');
    if (btn) btn.disabled = true;
    const m = conc.modalidad;
    // Un contrato aprobado "sin equipo" al que ahora se le declaran
    // reemplazos: bodega tiene que enterarse (la solicitud de seriales salió
    // al aprobar sin nada que pedir). Se avisa; el ajuste fino va por Almacén.
    const nuevoConEquipo = !!(c.renovacion_sin_equipo && m && !m.sin_equipo);
    try {
      await ContratosService.updateContrato(id, {
        transicion_plan: plan,
        renovacion_refurbished_componentes: !!(m && m.refurbished),
        ...(m && c.renovacion_sin_equipo !== m.sin_equipo ? {
          renovacion_sin_equipo: m.sin_equipo,
          renovacion_modalidad: m.sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo',
        } : {}),
        transicion_plan_actualizado_at: firebase.firestore.FieldValue.serverTimestamp(),
        transicion_plan_actualizado_por_uid: this.uid,
        fecha_modificacion: new Date(),
      });
      this._wcSoloPlan = false;
      this._cerrarModal();
      Toast.show(nuevoConEquipo
        ? 'Seriales guardados — la renovación pasa a CON equipo (reemplazos/nuevos): avisa a bodega que asigne esos seriales en Almacén · Asignar'
        : conc.desajuste
          ? 'Seriales guardados — ojo: alguna línea trae menos unidades que los seriales que continúan más los reemplazos (edita el contrato si aplica)'
          : 'Seriales guardados — el Anexo A se actualiza solo', (nuevoConEquipo || conc.desajuste) ? 'warn' : 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e); Toast.show('No se pudieron guardar los seriales', 'bad');
      if (btn) btn.disabled = false;
    }
  },

  _wcCuadrar() {
    const plan = this._wcLeerPlan(this._wcOrigenIds());
    if (!plan) return;
    const lineas = this._lineasModelo('wcm');
    const r = TransicionPlan.conciliarLineas(plan, lineas);
    const cants = [...document.querySelectorAll('input[data-wcm-cant]')];
    const selects = [...document.querySelectorAll('select[data-wcm-modelo]')];
    // _lineasModelo salta los selects sin modelo: mapea idx → input real.
    const reales = selects.map((s, i) => this._modeloDeSelect(s) ? i : -1).filter(i => i >= 0);
    r.porLinea.forEach(({ idx, continuan, reemplazan }) => {
      const inp = cants[reales[idx]];
      const min = continuan + reemplazan;
      if (inp && min > 0) inp.value = min;
    });
    this._wcPreview();
    this._wcConciliar();
  },

  _wcPreview() {
    const cont = document.getElementById('wcTot');
    if (!cont) return;
    const cargos = [...document.querySelectorAll('#wcCargos .wa-cargo')].length
      ? this._aumCargos() : [];
    const t = this._totAumento(this._lineasModelo('wcm'), cargos,
      document.getElementById('wcItbms')?.checked !== false);
    cont.innerHTML = this._tarifarioHtml(t);
  },

  // ── Validación del representante legal (Zuleika, 2026-09-03) ─────────────
  // Se pedía solo en el formulario clásico; al retirarse nuevo-contrato.html
  // (2026-09-09) el control se habría perdido, así que vive aquí. Mismo
  // criterio y mismo módulo de dominio (js/domain/repValidacion.js): sin el
  // check, "Guardar contrato" queda deshabilitado.
  //
  // El problema que resuelve: contratos confeccionados y luego ANULADOS porque
  // el representante de la ficha ya no era el vigente.
  _wcRepHtml() {
    const c = this.cliente || {};
    const rep = (c.representante || '').trim();
    const ficha = `../clientes/centro.html?id=${encodeURIComponent(c.id || '')}`;
    return rep
      ? `<div>${this.esc(rep)}${c.representante_cedula ? ` — ${this.esc(window.DocIdentidad
           ? DocIdentidad.frase(c.representante_cedula, c.representante_doc_tipo) : 'céd. ' + c.representante_cedula)}` : ''}</div>
         <div id="wcRepCtx" class="hint" style="margin:4px 0 8px;">Consultando la ficha…</div>
         <label class="cg-toggle">
           <input type="checkbox" id="wcRepValidado" onchange="Centro._wcRepGate()">
           Validé con el cliente que <b>${this.esc(rep)}</b> sigue siendo el representante legal.
         </label>`
      : `<div><b>⚠️ Este cliente no tiene representante legal registrado</b> — el contrato se imprime con ese espacio en blanco.</div>
         <label class="cg-toggle" style="margin-top:8px;">
           <input type="checkbox" id="wcRepValidado" onchange="Centro._wcRepGate()">
           Confirmé con el cliente quién es el representante legal vigente.
         </label>
         <div class="hint" style="margin-top:6px;"><a href="${ficha}">Completar la ficha</a></div>`;
  },

  _wcRepGate() {
    const btn = document.getElementById('wcGuardar');
    const chk = document.getElementById('wcRepValidado');
    if (!btn) return;
    btn.disabled = !(chk && chk.checked);
    btn.title = btn.disabled ? 'Marca la validación del representante legal para continuar' : '';
  },

  // Contexto que hace útil el check: la última validación estampada en la
  // ficha o el último cambio del representante en el historial. Best-effort:
  // sin dato legible, la línea queda en el texto neutro del dominio.
  async _wcRepMontar() {
    this._wcRepGate();
    const n = document.getElementById('wcRepCtx');
    if (!n) return;
    let hist = [];
    try {
      const qs = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(30).get();
      hist = qs.docs.map((d) => d.data());
    } catch (_) { /* sin historial legible, la validación previa aún aplica */ }
    const r = RepValidacion.resumen(this.cliente, hist, Date.now());
    const nodo = document.getElementById('wcRepCtx');
    if (!nodo) return;                      // el modal se cerró o re-renderizó
    nodo.textContent = r.texto;
    nodo.dataset.tono = r.tono;
  },

  async crearContrato() {
    if (this._wcGuardando) return;
    // Segundo candado del check (el botón ya sale deshabilitado): esta función
    // es la única vía de creación y no debe depender de que la llamen bien.
    const chkRep = document.getElementById('wcRepValidado');
    if (!chkRep || !chkRep.checked) {
      Toast.show('⚠️ Valida el representante legal con el cliente antes de guardar.', 'warn');
      return;
    }
    const tipo = document.getElementById('wcTipo')?.value || '';
    const tipoNombre = this.TIPOS_CONTRATO[tipo] || tipo;
    const accion = document.getElementById('wcAccion')?.value || 'Nuevo';
    const durN = parseInt(document.getElementById('wcMeses')?.value || '0', 10);
    const durUnidad = (tipo === 'TEMP' && document.getElementById('wcDurUnidad')?.value === 'dias') ? 'dias' : 'meses';
    const meses = durUnidad === 'meses' ? durN : 0;
    if (!tipo) { Toast.show('Elige el tipo de contrato', 'warn'); return; }
    if (!(durN > 0)) { Toast.show(`Indica la duración en ${durUnidad === 'dias' ? 'días' : 'meses'}`, 'warn'); return; }
    // Contrato nuevo con cuenta vigente (decisión 6, 1-oct-2026): la razón de
    // no hacerlo por anexo o renovación es obligatoria y queda en el contrato.
    const nuevoConVigente = !!this._wcOpts?.nuevoConVigente;
    const motivoNuevo = (document.getElementById('wcMotivoNuevo')?.value || '').trim();
    if (nuevoConVigente && motivoNuevo.length < 10) {
      Toast.show('Escribe por qué va un contrato nuevo y no un anexo o renovación (mínimo 10 caracteres)', 'warn');
      document.getElementById('wcMotivoNuevo')?.focus();
      return;
    }

    const lineas = this._lineasModelo('wcm');
    if (!lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
    if (['SERV', 'ALQ', 'PROP'].includes(tipo) && lineas.some(l => !(l.precio > 0))) {
      Toast.show('Cada línea necesita su precio mensual', 'warn'); return;
    }
    if (['SERV', 'ALQ', 'PROP'].includes(tipo) && this._lineasSinModalidad(lineas)) {
      Toast.show(this.MSG_SIN_MODALIDAD, 'warn');
      document.querySelector('select[data-wcm-modalidad]:not([disabled])')?.focus();
      return;
    }

    const candidatos = this._wcCandidatos();
    const origenIds = this._wcOrigenIds();
    const origenSel = {
      accion, codigo_tipo: tipo,
      legacy: !!document.getElementById('wcLegacy')?.checked,
      legacy_ref: (document.getElementById('wcLegacyRef')?.value || '').trim(),
      origen_ids: origenIds,
      origen_refs: origenIds.map(id => {
        const c = candidatos.find(x => x.id === id);
        return c ? (c.contrato_id || c.id) : id;
      }),
      candidatos: candidatos.length,
    };
    const vOrigen = OrigenContrato.validar(origenSel);
    if (!vOrigen.ok) { Toast.show(`⚠️ ${vOrigen.mensaje}`, 'warn'); return; }

    let plan = null;
    let modalidad = null;
    if (TransicionPlan.aplica(origenSel)) {
      // Paso OBLIGATORIO en toda renovación (Alberto 2026-09-04): cada
      // serial con destino, o la confirmación explícita de que no hay.
      const conc = this._wcConciliar();
      plan = conc.plan || null;
      if (conc.sinDestino) { Toast.show(`⚠️ Faltan ${conc.sinDestino} serial(es) por decidir — elige el destino de cada uno`, 'warn'); return; }
      if (!plan && !this._wcPlanState.sinSeriales) { Toast.show('⚠️ Declara los seriales de la cuenta (o confirma que el cliente no tiene equipos con serial)', 'warn'); return; }
      if (plan) {
        const vPlan = TransicionPlan.validar(plan);
        if (!vPlan.ok) { Toast.show(`⚠️ ${vPlan.mensaje}`, 'warn'); return; }
        if (conc.faltaModelo) { Toast.show('⚠️ Elige el modelo de cada serial agregado sin ficha', 'warn'); return; }
        if (conc.sinLinea.length) { Toast.show(`⚠️ ${conc.sinLinea.length} serial(es) sin línea en el contrato — agrega su modelo (o el del reemplazo) o cámbiales el destino`, 'warn'); return; }
        if (conc.desajuste) { Toast.show('⚠️ Alguna línea trae menos unidades que los seriales que continúan más los reemplazos — usa “Cuadrar cantidades”', 'warn'); return; }
        modalidad = conc.modalidad;
      }
    }

    this._wcGuardando = true;
    const btn = document.getElementById('wcGuardar');
    if (btn) btn.disabled = true;
    try {
      // Correlativo {TIPO}{YYYYMMDD}-{NN}: mismo doble mecanismo del
      // formulario clásico (piso best-effort + reserva atómica en contadores/).
      const hoy = new Date();
      const fechaStr = ContratosService.fechaStrLocal(hoy);
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
      const fin = new Date(inicio); fin.setDate(fin.getDate() + 1);
      let piso = 0;
      try { piso = await ContratosService.maxSufijoPorTipoYFecha(tipo, inicio, fin); } catch (_) { /* piso 0 */ }
      const seq = await ContratosService.reservarSufijo(tipo, fechaStr, piso);
      const contrato_id = tipo + fechaStr + '-' + String(seq).padStart(2, '0');

      const cli = this.cliente;
      const contrato = ContratoTarifario.construirDoc({
        contrato_id,
        searchTokens: ContratosService.buildSearchTokens({ cliente_nombre: cli.nombre || '', contrato_id }),
        cliente: {
          id: cli.id, nombre: cli.nombre || '', direccion: cli.direccion || '',
          telefono: cli.telefono || '', ruc: cli.ruc || '', dv: cli.dv || '',
          representante: cli.representante || '', representante_cedula: cli.representante_cedula || '',
          representante_doc_tipo: cli.representante_doc_tipo || '',
        },
        codigo_tipo: tipo,
        tipo_contrato: tipoNombre,
        accion,
        // Derivadas del plan por serial (ya no se preguntan). Sin plan (la
        // cuenta no tiene seriales que declarar) es una renovación sin equipo
        // salvo que las líneas traigan unidades.
        renovacion_sin_equipo: accion === 'Renovación' && (modalidad ? modalidad.sin_equipo
          : !lineas.some(l => Number(l.cantidad) > 0)),
        renovacion_refurbished_componentes: !!(modalidad && modalidad.refurbished),
        origenSel,
        transicion_plan: plan,
        // El Centro produce el documento v2 (Anexo A por serial, firma
        // digital): el correo a activaciones enlaza a ese documento y no
        // adjunta el PDF del formato anterior (functions/lib/documentoContrato).
        documento_version: 'v2',
        // Quién validó con el cliente qué nombre al confeccionar (Zuleika
        // 2026-09-03). construirDoc le pone el `at`.
        representante_validacion: RepValidacion.construir(cli, { uid: this.uid, email: this.email || null }),
        reemplaza_seriales: null,
        duracion: durUnidad === 'dias' ? `${durN} día${durN === 1 ? '' : 's'}` : `${durN} meses`,
        duracion_meses: meses,
        ...(durUnidad === 'dias' ? { duracion_dias: durN } : {}),
        observaciones: document.getElementById('wcObs')?.value || '',
        equipos: lineas,
        cargos: [...document.querySelectorAll('#wcCargos .wa-cargo')].length ? this._aumCargos() : [],
        itbms_aplica: document.getElementById('wcItbms')?.checked !== false,
        creado_por_uid: this.uid,
      });

      // Estampa de regularización (plan 2026-09-08): el contrato nace sobre
      // una cuenta con deuda → queda dicho; DEMO/TEMP se estampan pero no
      // cuentan como puntuales (Regularizacion.esPuntual).
      Object.assign(contrato, Centro._estampaReg());
      if (nuevoConVigente) {
        Object.assign(contrato, { motivo_contrato_nuevo: motivoNuevo, motivo_contrato_nuevo_por_uid: this.uid || null });
      }
      const docRef = await ContratosService.addContrato(contrato);

      // La ficha recuerda la validación: el próximo contrato de este cliente
      // muestra "Validado por última vez hace N" en vez de pedir fe ciega.
      // Best-effort — el contrato ya quedó guardado y esto no debe estorbar.
      try {
        await firebase.firestore().collection('clientes').doc(cli.id).update({
          representante_validacion: {
            ...RepValidacion.construir(cli, { uid: this.uid, email: this.email || null }),
            at: firebase.firestore.FieldValue.serverTimestamp(),
          },
        });
      } catch (e) { console.warn('No se pudo estampar la validación del representante:', e); }

      try {
        const equiposHtml = contrato.equipos.map(e =>
          `<li>${e.modelo} – ${e.cantidad} × $${Number(e.precio || 0).toFixed(2)}</li>`).join('');
        const obsEsc = (contrato.observaciones || '-').replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
        await MailService.enqueue({
          to: 'ventas@cecomunica.com',
          cc: firebase.auth().currentUser?.email || null,
          subject: `Nuevo contrato creado: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
          preheader: `Contrato pendiente de aprobación: ${contrato.cliente_nombre}`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Nuevo contrato creado</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Se ha registrado un nuevo contrato con el ID <b>${contrato.contrato_id}</b> desde el Centro de gestión.
            </p>
            ${contrato.accion === 'Renovación' ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #0074AC;border-radius:10px;background:#E6F4FB;font:700 15px Arial,sans-serif;color:#0B2A47;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? 'RENOVACIÓN SIN EQUIPO' : 'RENOVACIÓN CON EQUIPO'}</div>` : ''}
            <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.cliente_nombre}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.tipo_contrato}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.accion}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Duración</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${contrato.duracion || '-'}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${obsEsc}</td></tr>
              <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">$${Number(contrato.total_con_itbms || 0).toFixed(2)}</td></tr>
            </table>
            ${equiposHtml ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Equipos</h4><ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${equiposHtml}</ul>` : ''}
          `,
          // CTA al CENTRO (2026-08-28): el correo mandaba al módulo viejo a
          // aprobar; ahora aterriza en la ficha del cliente, donde "Ver" del
          // contrato ofrece "Aprobar contrato" y luego "Enviar para firma".
          ctaUrl: `${location.origin}/clientes/centro.html?id=${encodeURIComponent(contrato.cliente_id)}`,
          ctaLabel: 'Revisar y aprobar en el Centro',
          meta: {
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            created_by: this.uid,
            source: 'centro-gestion',
          },
          status: 'queued',
        });
      } catch (e) { console.warn('No se pudo encolar el correo:', e); }

      this._cerrarModal();
      // CTA "Ver documento" en el aviso (auditoría UX 2026-09-28): para
      // revisarlo o imprimirlo sin buscar el contrato en la ficha.
      const urlDoc = this._urlDocumento({ ...contrato, id: docRef.id, fecha_creacion: new Date() });
      this._toastAccion(`✅ Contrato ${contrato_id} creado — pendiente de aprobación`, 'Ver documento',
        () => window.open(urlDoc, '_blank', 'noopener'), 'ok', 10000);
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo crear el contrato', 'bad');
    } finally {
      this._wcGuardando = false;
      const b = document.getElementById('wcGuardar');
      if (b) b.disabled = false;
    }
  },
});
