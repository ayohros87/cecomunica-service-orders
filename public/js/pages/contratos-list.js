// @ts-nocheck
// Lista section — table/cards rendering, filtering, sorting, CRUD actions
window.ContratosLista = {
  _searchTimeout: null,
  _lastWidth:     window.innerWidth,

  // ── Button state ─────────────────────────────────────────────────
  updateBtnCargarMas(forceNoMore = false) {
    const btn = document.getElementById('btnCargarMas');
    if (!btn) return;
    const reachedMax = CS.contratos.length >= CS.maxRows();
    const noMore = !!forceNoMore || !CS.lastDoc || reachedMax;
    btn.disabled = CS.isLoading || noMore;
    if (reachedMax)    btn.innerHTML = '<i data-lucide="lock"></i> Límite de consulta alcanzado';
    else if (noMore)   btn.textContent = 'Sin más resultados';
    else               btn.innerHTML = CS.isLoading ? '<i data-lucide="loader"></i> Cargando...' : '<i data-lucide="chevron-down"></i> Cargar más contratos';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  limpiarTabla() {
    document.getElementById('tablaContratos').innerHTML = '';
    document.getElementById('resumenContratos').innerHTML =
      '<div class="loader" style="width:24px;height:24px;border-width:3px;"></div>';
  },

  // ── Row / card builders ──────────────────────────────────────────
  crearFila(id, data) {
    const esc = CS.esc.bind(CS);
    const puedeEditar     = AUTH.is(ROLES.ADMIN) || AUTH.is(ROLES.VENDEDOR);
    const esAdmin         = AUTH.is(ROLES.ADMIN);
    const esRecepcion     = AUTH.is(ROLES.RECEPCION);
    const puedePanelTrabajo = esAdmin || esRecepcion;
    const editable        = puedeEditar && !['activo','aprobado','anulado'].includes(data.estado);
    const yaFirmado       = !!data.firmado_url;

    const estadoClase =
      data.estado === 'activo'               ? 'chip-aprobada'    :  // verde
      data.estado === 'aprobado'             ? 'chip-recibida'    :  // azul
      data.estado === 'pendiente_aprobacion' ? 'chip-diagnostico' :
      data.estado === 'anulado'              ? 'chip-cancelada'   :
      'chip-espera';

    const estadoTexto =
      data.estado === 'pendiente_aprobacion' ? 'Pendiente Aprobación' :
      data.estado === 'aprobado'             ? 'Aprobado'             :
      data.estado === 'activo'               ? 'Activo'               :
      data.estado === 'anulado'              ? 'Anulado'              :
      'Inactivo';

    const iconoComision = data.listo_para_comision
      ? `<span title="Listo para Comisión" aria-label="Listo para comisión" style="margin-left:6px;"><i data-lucide="check"></i></span>`
      : '';

    const tot = ContractTotals.fromDoc(data);

    const ICON_BTN     = 'btn btn-ghost btn-icon btn-sm';
    const ICON_BTN_DEL = 'btn btn-danger btn-icon btn-sm';

    const btnImprimir = data.contrato_id
      ? `<button class="${ICON_BTN}" onclick="ContratosLista.ver('${data.contrato_id}')" title="Imprimir/Ver" aria-label="Imprimir/Ver"><i data-lucide="printer"></i></button>`
      : '';
    const btnEditar = editable
      ? `<button class="${ICON_BTN}" onclick="ContratosLista.editar('${id}')" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>`
      : '';

    let btnBorrar = '';
    if (!['activo','aprobado','anulado'].includes(data.estado) && (esAdmin || AUTH.is(ROLES.VENDEDOR))) {
      btnBorrar = `<button class="${ICON_BTN_DEL}" onclick="ContratosLista.borrar('${id}')" title="Eliminar" aria-label="Eliminar"><i data-lucide="trash-2"></i></button>`;
    }

    let bloqueFirmado = '';
    const puedeSubirFirmado = data.estado === 'aprobado' && puedeEditar;
    if (yaFirmado) {
      bloqueFirmado = `<a class="${ICON_BTN}" href="${data.firmado_url}" target="_blank" rel="noopener" title="Ver firmado" aria-label="Ver firmado"><i data-lucide="file-text"></i></a>`;
      if (puedeSubirFirmado)
        bloqueFirmado += ` <button class="${ICON_BTN}" onclick="ContratosFirmado.subir('${id}')" title="Reemplazar firmado" aria-label="Reemplazar firmado"><i data-lucide="refresh-cw"></i></button>`;
    } else if (puedeSubirFirmado) {
      bloqueFirmado = `<button class="${ICON_BTN}" onclick="ContratosFirmado.subir('${id}')" title="Subir contrato firmado" aria-label="Subir firmado"><i data-lucide="upload"></i></button>`;
    }

    const btnAnular = (['activo','aprobado'].includes(data.estado) && esAdmin)
      ? `<button class="${ICON_BTN_DEL}" onclick="ContratosLista.anular('${id}')" title="Anular contrato" aria-label="Anular"><i data-lucide="ban"></i></button>`
      : '';
    const btnDuplicar = (puedeEditar && ['anulado','inactivo'].includes(data.estado))
      ? `<button class="${ICON_BTN}" onclick="ContratosLista.duplicar('${id}')" title="Duplicar contrato" aria-label="Duplicar"><i data-lucide="copy"></i></button>`
      : '';
    const btnComisionAgregar = esAdmin && !data.listo_para_comision
      ? `<button class="${ICON_BTN}" onclick="ContratosLista.marcarComision('${id}')" title="Marcar listo para comisión" aria-label="Marcar comisión"><i data-lucide="dollar-sign"></i></button>`
      : '';
    const btnComisionQuitar = esAdmin && data.listo_para_comision
      ? `<button class="${ICON_BTN_DEL}" onclick="ContratosLista.quitarComision('${id}')" title="Quitar marca de comisión" aria-label="Quitar comisión"><i data-lucide="x-circle"></i></button>`
      : '';

    const accionesHtml = esRecepcion
      ? `${btnImprimir}${puedePanelTrabajo ? `<button class="${ICON_BTN}" onclick="ContratosEquipos.abrirPanel('${id}')" title="Panel de trabajo" aria-label="Panel de trabajo"><i data-lucide="folder-open"></i></button>` : ''}`
      : `${btnImprimir}
         ${puedePanelTrabajo ? `<button class="${ICON_BTN}" onclick="ContratosEquipos.abrirPanel('${id}')" title="Panel de trabajo" aria-label="Panel de trabajo"><i data-lucide="folder-open"></i></button>` : ''}
         ${btnEditar}
         ${btnBorrar}
         ${bloqueFirmado}
         ${esAdmin && data.estado === 'pendiente_aprobacion' ? `<button class="${ICON_BTN}" onclick="ContratosAprobacion.abrir('${id}')" title="Aprobar" aria-label="Aprobar"><i data-lucide="check-circle"></i></button>` : ''}
         ${btnComisionAgregar}
         ${btnComisionQuitar}
         ${btnAnular}
         ${btnDuplicar}`;

    const fila = document.createElement('tr');
    fila.setAttribute('data-contrato-doc-id', id);
    fila.innerHTML = `
      <td class="td-primary">${data.contrato_id || '-'} ${iconoComision}</td>
      <td><strong style="color:var(--fg-1); font-weight:600;">${esc(data.cliente_nombre || '-')}</strong></td>
      <td>${esc(data.tipo_contrato || '-')}</td>
      <td>${esc(data.accion || '-')}</td>
      <td style="text-align:center;" data-contrato-equipos="${id}"><span style="opacity:0.3;"><i data-lucide="loader"></i></span></td>
      <td class="estado-cell">
        <span class="chip-estado ${estadoClase}">${estadoTexto}</span>
      </td>
      <td class="td-muted">${data.fecha_creacion?.toDate ? data.fecha_creacion.toDate().toLocaleDateString() : '-'}</td>
      <td class="td-muted">${esc(CS.mapaUsuarios[data.creado_por_uid] || '-')}</td>
      <td class="td-mono" style="text-align:right; color:var(--fg-1); font-weight:600;">${FMT.money(tot.totalConITBMS)}</td>
      <td class="acciones">${accionesHtml}</td>
    `;
    return fila;
  },

  crearCard(data) {
    const esc = CS.esc.bind(CS);
    const esAdmin         = AUTH.is(ROLES.ADMIN);
    const esRecepcion     = AUTH.is(ROLES.RECEPCION);
    const puedeEditar     = AUTH.is(ROLES.ADMIN) || AUTH.is(ROLES.VENDEDOR);
    const puedePanelTrabajo = esAdmin || esRecepcion;
    const editable        = puedeEditar && !['activo','aprobado','anulado'].includes(data.estado);
    const puedeAprobar    = esAdmin && data.estado === 'pendiente_aprobacion';

    const tot = ContractTotals.fromDoc(data);
    const totalStr = FMT.money(tot.totalConITBMS);

    const estadoClase =
      data.estado === 'activo'               ? 'chip-aprobada'    :  // verde
      data.estado === 'aprobado'             ? 'chip-recibida'    :  // azul
      data.estado === 'pendiente_aprobacion' ? 'chip-diagnostico' :
      data.estado === 'anulado'              ? 'chip-cancelada'   :
      'chip-espera';

    const estadoTexto =
      data.estado === 'pendiente_aprobacion' ? 'Pendiente' :
      data.estado === 'aprobado'             ? 'Aprobado'  :
      data.estado === 'activo'               ? 'Activo'    :
      data.estado === 'anulado'              ? 'Anulado'   :
      'Inactivo';

    let bloqueFirmado = '';
    if (data.firmado_url) {
      bloqueFirmado = `<a class="btn" href="${data.firmado_url}" target="_blank" rel="noopener" title="Ver firmado"><i data-lucide="file-text"></i></a>`;
      if (data.estado === 'aprobado' && puedeEditar)
        bloqueFirmado += ` <button class="btn" onclick="ContratosFirmado.subir('${data.id}')" title="Reemplazar firmado"><i data-lucide="refresh-cw"></i></button>`;
    } else if (data.estado === 'aprobado' && puedeEditar) {
      bloqueFirmado = `<button class="btn" onclick="ContratosFirmado.subir('${data.id}')" title="Subir firmado"><i data-lucide="upload"></i></button>`;
    }

    const accionesMovilHtml = esRecepcion
      ? `${data.contrato_id ? `<button class="btn" onclick="ContratosLista.ver('${data.contrato_id}')" title="Ver/Imprimir"><i data-lucide="printer"></i> Ver</button>` : ''}
         ${puedePanelTrabajo ? `<button class="btn" onclick="ContratosEquipos.abrirPanel('${data.id}')" title="Panel de trabajo"><i data-lucide="folder-open"></i> Panel</button>` : ''}`
      : `${data.contrato_id ? `<button class="btn" onclick="ContratosLista.ver('${data.contrato_id}')" title="Ver/Imprimir"><i data-lucide="printer"></i> Ver</button>` : ''}
         ${puedePanelTrabajo ? `<button class="btn" onclick="ContratosEquipos.abrirPanel('${data.id}')" title="Panel de trabajo"><i data-lucide="folder-open"></i> Panel</button>` : ''}
         ${editable ? `<button class="btn" onclick="ContratosLista.editar('${data.id}')" title="Editar"><i data-lucide="pencil"></i> Editar</button>` : ''}
         ${puedeAprobar ? `<button class="btn btn-accent block" onclick="ContratosAprobacion.abrir('${data.id}')" title="Aprobar ahora"><i data-lucide="check-circle"></i> Aprobar</button>` : ''}
         ${bloqueFirmado}
         ${esAdmin && !data.listo_para_comision
           ? `<button class="btn" onclick="ContratosLista.marcarComision('${data.id}')" title="Marcar listo para comisión"><i data-lucide="dollar-sign"></i> Comisión</button>`
           : ''}
         ${esAdmin && data.listo_para_comision
           ? `<button class="btn btn-danger" onclick="ContratosLista.quitarComision('${data.id}')" title="Quitar marca de comisión"><i data-lucide="x-circle"></i> Quitar</button>`
           : ''}`;

    const card = document.createElement('div');
    card.className = 'card-contrato';
    card.innerHTML = `
      <div class="row">
        <div>
          <div class="t1">
            ${esc(data.contrato_id || '-')}
            ${data.listo_para_comision ? '<span title="Listo para Comisión" aria-label="Listo para comisión" style="margin-left:6px;"><i data-lucide="check"></i></span>' : ''}
          </div>
          <div class="t2">${esc(data.cliente_nombre || '-')}</div>
        </div>
        <div class="chip-estado ${estadoClase}">${estadoTexto}</div>
      </div>
      <div class="row">
        <div class="t2">${esc(data.tipo_contrato || '-')} · ${esc(data.accion || '-')}</div>
        <div class="t1">${totalStr}</div>
      </div>
      <div class="acciones">${accionesMovilHtml}</div>
    `;
    return card;
  },

  // ── Filtering / sorting helpers ──────────────────────────────────
  filtrarLocal(data) {
    const mostrarInactivos = document.getElementById('chkMostrarInactivos')?.checked;
    return data.filter(doc =>
      mostrarInactivos ? true : !['inactivo','anulado'].includes(doc.estado)
    );
  },

  getSearchRange(searchText) {
    if (!searchText) return null;
    const lower = searchText.toLowerCase();
    const upper = lower.slice(0, -1) + String.fromCharCode(lower.charCodeAt(lower.length - 1) + 1);
    return { lower, upper };
  },

  comparable(v) {
    if (v == null) return '';
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') return v.toLowerCase();
    return v;
  },

  getSortValue(row, key) {
    if (key === 'total') return ContractTotals.fromDoc(row).totalConITBMS;
    return row[key];
  },

  ordenar(data) {
    return data.sort((a, b) => {
      const A = this.comparable(this.getSortValue(a, CS.campoOrden));
      const B = this.comparable(this.getSortValue(b, CS.campoOrden));
      if (A < B) return CS.direccionAsc ? -1 : 1;
      if (A > B) return CS.direccionAsc ?  1 : -1;
      return 0;
    });
  },

  // ── Main data loader ─────────────────────────────────────────────
  async cargar(reset = false) {
    const now = Date.now();
    if (CS.isLoading) return;

    if (!reset && (now - CS.lastQueryAt) < CS.MIN_QUERY_INTERVAL_MS) {
      Toast.show('⚠️ Espera un momento antes de consultar de nuevo.', 'warn', 2500);
      return;
    }
    if (!reset && CS.contratos.length >= CS.maxRows()) {
      Toast.show('⚠️ Límite de consulta alcanzado para tu rol.', 'warn');
      this.updateBtnCargarMas(true);
      return;
    }

    CS.isLoading  = true;
    CS.lastQueryAt = now;
    this.updateBtnCargarMas(false);

    try {
      const tabla      = document.getElementById('tablaContratos');
      const listaMovil = document.getElementById('listaContratosMovil');
      const estadoSel  = document.getElementById('filtroEstado')?.value || '';
      const clienteSearch      = document.getElementById('filtroCliente')?.value.trim() || '';
      const clienteSearchLower = clienteSearch.toLowerCase();
      const matchesCliente     = c => {
        if (!clienteSearchLower) return true;
        const nombre = String(c?.cliente_nombre_lower || c?.cliente_nombre || '').toLowerCase();
        const cid    = String(c?.contrato_id || '').toLowerCase();
        return nombre.includes(clienteSearchLower) || cid.includes(clienteSearchLower);
      };

      if (reset) {
        this.limpiarTabla();
        CS.contratos = [];
        CS.lastDoc   = null;
      }

      document.querySelectorAll('.skeleton-row').forEach(el => el.remove());

      const role = String(window.userRole || '').toLowerCase();
      if (role === ROLES.VENDEDOR && !CS.currentUser) return;
      const creadoPorUid = role === ROLES.VENDEDOR ? CS.currentUser.uid : null;

      const searchRange = this.getSearchRange(clienteSearch);
      const cursor      = CS.lastDoc && !reset ? CS.lastDoc : null;

      const { docs: newDocs, lastDoc: newCursor } = await ContratosService.listContratos({
        estadoSel:    estadoSel || null,
        creadoPorUid,
        searchRange,
        campoOrden:   CS.campoOrden,
        direccionAsc: CS.direccionAsc,
        lastDoc:      cursor,
        limit:        CS.pageLimit(),
      });

      if (newDocs.length > 0) {
        CS.lastDoc = newCursor;
        newDocs.forEach(data => CS.contratos.push(data));
      } else if (reset) {
        CS.contratos = [];
        CS.lastDoc   = null;
      }

      const maxRows = CS.maxRows();
      if (clienteSearchLower && newDocs.length === 0) {
        let fallbackLastDoc = cursor;
        let fallbackPages   = 0;
        while (CS.contratos.length < maxRows && fallbackPages < 8) {
          const { docs: fbDocs, lastDoc: fbCursor } = await ContratosService.listContratosFallback({
            estadoSel:    estadoSel || null,
            creadoPorUid,
            campoOrden:   CS.campoOrden,
            direccionAsc: CS.direccionAsc,
            lastDoc:      fallbackLastDoc,
            limit:        CS.pageLimit(),
          });
          if (fbDocs.length === 0) { CS.lastDoc = null; break; }
          fallbackLastDoc = fbCursor;
          fbDocs.forEach(data => CS.contratos.push(data));
          fallbackPages++;
        }
        if (fallbackPages > 0) CS.lastDoc = fallbackLastDoc;
      }

      // Safety net: exact contract-ID lookup so any contract is findable by
      // its ID even when it lives beyond the fallback's page reach. Only
      // attempted for ID-like input (has a digit or hyphen) that isn't
      // already loaded.
      const yaCargadoPorId = CS.contratos.some(
        c => String(c?.contrato_id || '').toLowerCase() === clienteSearchLower
      );
      if (clienteSearchLower && !yaCargadoPorId && /[\d-]/.test(clienteSearch)) {
        try {
          const exacto = await ContratosService.getByContratoId(clienteSearch)
                      || await ContratosService.getByContratoId(clienteSearch.toUpperCase());
          if (exacto && !exacto.deleted && !CS.contratos.some(c => c.id === exacto.id)) {
            CS.contratos.unshift(exacto);
          }
        } catch (_) { /* not a valid ID — ignore */ }
      }

      if (CS.contratos.length > maxRows) {
        CS.contratos = CS.contratos.slice(0, maxRows);
        CS.lastDoc   = null;
      }

      await CS.precargarUsuarios(CS.contratos);

      const filtrados = this.ordenar(
        this.filtrarLocal([...CS.contratos]).filter(matchesCliente)
      );

      if (tabla)      tabla.innerHTML      = '';
      if (listaMovil) listaMovil.innerHTML = '';

      let pendientes = 0, aprobados = 0, activos = 0;

      if (CS.esMovil()) {
        const wrap = document.querySelector('.app-table-wrap');
        if (wrap) wrap.style.display = 'none';
        if (listaMovil) listaMovil.style.display = 'grid';
        filtrados.forEach(data => {
          if (data.estado === 'pendiente_aprobacion') pendientes++;
          if (data.estado === 'aprobado') aprobados++;
          if (data.estado === 'activo')   activos++;
          if (listaMovil) listaMovil.appendChild(this.crearCard(data));
        });
      } else {
        const wrap = document.querySelector('.app-table-wrap');
        if (wrap) wrap.style.display = '';
        if (listaMovil) listaMovil.style.display = 'none';
        filtrados.forEach(data => {
          if (data.estado === 'pendiente_aprobacion') pendientes++;
          if (data.estado === 'aprobado') aprobados++;
          if (data.estado === 'activo')   activos++;
          if (tabla) tabla.appendChild(this.crearFila(data.id, data));
        });
        this.actualizarFlechitas();
      }

      const resumen = document.getElementById('resumenContratos');
      if (resumen) {
        resumen.innerHTML = `
          <strong title="Total de contratos">${filtrados.length}</strong> contratos ·
          <span class="badge pendiente" title="Pendientes">${pendientes}</span>
          <span class="badge aprobado" title="Aprobados">${aprobados}</span>
          <span class="badge completo" title="Activos">${activos}</span>
        `;
      }

      ContratosEquipos.cargarIconos();
      this.updateBtnCargarMas(!CS.lastDoc);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } finally {
      CS.isLoading = false;
      this.updateBtnCargarMas(false);
    }
  },

  renderDesdeCache() {
    const tabla      = document.getElementById('tablaContratos');
    const listaMovil = document.getElementById('listaContratosMovil');
    const filtrados  = this.ordenar(this.filtrarLocal([...CS.contratos]));

    tabla.innerHTML = '';
    if (listaMovil) listaMovil.innerHTML = '';

    let pendientes = 0, aprobados = 0, activos = 0;

    if (CS.esMovil()) {
      const wrap = document.querySelector('.app-table-wrap');
      if (wrap) wrap.style.display = 'none';
      if (listaMovil) listaMovil.style.display = 'grid';
      filtrados.forEach(data => {
        if (data.estado === 'pendiente_aprobacion') pendientes++;
        if (data.estado === 'aprobado') aprobados++;
        if (data.estado === 'activo')   activos++;
        if (listaMovil) listaMovil.appendChild(this.crearCard(data));
      });
    } else {
      const wrap = document.querySelector('.app-table-wrap');
      if (wrap) wrap.style.display = '';
      if (listaMovil) listaMovil.style.display = 'none';
      filtrados.forEach(data => {
        if (data.estado === 'pendiente_aprobacion') pendientes++;
        if (data.estado === 'aprobado') aprobados++;
        if (data.estado === 'activo')   activos++;
        tabla.appendChild(this.crearFila(data.id, data));
      });
      this.actualizarFlechitas();
    }

    const resumen = document.getElementById('resumenContratos');
    if (resumen) {
      resumen.innerHTML = `
        <strong title="Total de contratos">${filtrados.length}</strong> contratos ·
        <span class="badge pendiente" title="Pendientes">${pendientes}</span>
        <span class="badge aprobado" title="Aprobados">${aprobados}</span>
        <span class="badge completo" title="Activos">${activos}</span>
      `;
    }
    this.updateBtnCargarMas(false);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  actualizarFlechitas() {
    const row = document.getElementById('encabezadoContratos');
    if (!row) return;
    [...row.children].forEach(th => {
      const m = th.getAttribute('onclick')?.match(/'(.+)'/);
      if (!m) return;
      const campo = m[1];
      th.classList.remove('ordenado-asc', 'ordenado-desc', 'sortable');
      if (campo === CS.campoOrden) th.classList.add(CS.direccionAsc ? 'ordenado-asc' : 'ordenado-desc');
      else th.classList.add('sortable');
    });
  },

  ver(idContrato) {
    window.open(`imprimir-contrato.html?id=${idContrato}`, '_blank');
  },

  ordenarPor(campo) {
    if (CS.campoOrden === campo) CS.direccionAsc = !CS.direccionAsc;
    else { CS.campoOrden = campo; CS.direccionAsc = true; }
    this.cargar(true);
  },

  // ── CRUD actions ─────────────────────────────────────────────────
  async anular(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) { Toast.show('Contrato no encontrado.', 'bad'); return; }
      if (!AUTH.is(ROLES.ADMIN)) { Toast.show('Solo el administrador puede anular contratos.', 'bad'); return; }
      if (!['activo','aprobado'].includes(c.estado)) {
        Toast.show('Solo se puede anular un contrato ACTIVO o APROBADO.', 'bad'); return;
      }

      const motivo = prompt('Motivo de anulación (ej: envío errado, datos incorrectos):');
      if (motivo === null) return;
      const motivoTrim = (motivo || '').trim();
      if (!motivoTrim) { Toast.show('Debes indicar un motivo.', 'bad'); return; }

      const update = {
        estado:           'anulado',
        anulado:          true,
        anulado_motivo:   motivoTrim,
        anulado_fecha:    firebase.firestore.Timestamp.now(),
        anulado_por_uid:  firebase.auth().currentUser?.uid || null,
        anulado_ref:      c.contrato_id || id,
        fecha_modificacion: new Date()
      };

      if (c.firmado || c.firmado_url) {
        Object.assign(update, {
          firmado_anulado:              true,
          firmado_url_anulado:          c.firmado_url || null,
          firmado_nombre_anulado:       c.firmado_nombre || null,
          firmado_storage_path_anulado: c.firmado_storage_path || null,
          firmado_fecha_anulado:        c.firmado_fecha || null,
          firmado:              false,
          firmado_url:          null,
          firmado_nombre:       null,
          firmado_storage_path: null,
          firmado_fecha:        null,
          firmado_por_uid:      null
        });
      }

      await ContratosService.updateContrato(id, update);
      Toast.show('✅ Contrato ANULADO correctamente.', 'ok');
      setTimeout(() => location.reload(), 1000);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo anular el contrato.', 'bad');
    }
  },

  async duplicar(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) { Toast.show('Contrato no encontrado.', 'bad'); return; }

      const draft = {
        cliente_id:                      c.cliente_id || '',
        codigo_tipo:                     c.codigo_tipo || '',
        accion:                          c.accion || '',
        renovacion_sin_equipo:           !!c.renovacion_sin_equipo,
        renovacion_refurbished_componentes: !!c.renovacion_refurbished_componentes,
        duracion:                        c.duracion || '',
        observaciones:                   c.observaciones || '',
        equipos: (c.equipos || []).map(e => ({
          modelo_id:   e.modelo_id || null,
          modelo:      e.modelo || '',
          descripcion: e.descripcion || 'Equipos de Comunicación',
          cantidad:    Number(e.cantidad || 0),
          precio:      Number(e.precio || 0)
        }))
      };

      sessionStorage.setItem('contrato_prefill', JSON.stringify(draft));
      delete draft.estado;
      const q = draft.cliente_id ? `?prefill=1&cliente_id=${encodeURIComponent(draft.cliente_id)}` : '?prefill=1';
      window.location.href = `nuevo-contrato.html${q}`;
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo preparar el borrador para duplicar.', 'bad');
    }
  },

  async editar(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) { Toast.show('Contrato no encontrado.', 'bad'); return; }
      if (c.estado === 'activo' || c.estado === 'aprobado') {
        Toast.show('Este contrato ya fue aprobado y no se puede editar.', 'bad'); return;
      }
      if (c.estado === 'anulado') {
        Toast.show("Este contrato fue ANULADO y no se puede editar. Usa 'Duplicar' para rehacerlo.", 'bad'); return;
      }
      window.location.href = `editar-contrato.html?id=${id}`;
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo validar el estado del contrato.', 'bad');
    }
  },

  async borrar(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) { Toast.show('Contrato no encontrado.', 'bad'); return; }
      if (['activo','aprobado','anulado'].includes(c.estado)) {
        Toast.show('Un contrato APROBADO/ACTIVO/ANULADO no se puede eliminar. Use ANULAR si corresponde.', 'bad'); return;
      }
      if (AUTH.is(ROLES.VENDEDOR) && c.creado_por_uid && c.creado_por_uid !== (firebase.auth().currentUser?.uid || '')) {
        Toast.show('Solo el creador o un administrador pueden eliminar este contrato.', 'bad'); return;
      }
      if (!await Modal.confirm({ message: '¿Seguro que deseas eliminar este contrato?', danger: true })) return;

      await ContratosService.updateContrato(id, { deleted: true, fecha_modificacion: new Date() });
      Toast.show('Contrato eliminado', 'ok');
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo eliminar el contrato.', 'bad');
    }
  },

  async marcarComision(id) {
    try {
      if (!AUTH.is(ROLES.ADMIN)) { Toast.show('Solo el administrador puede cambiar este estado.', 'bad'); return; }
      if (!await Modal.confirm({ message: "¿Marcar este contrato como 'Listo para Comisión'?" })) return;
      await ContratosService.updateContrato(id, {
        listo_para_comision:  true,
        fecha_envio_comision: firebase.firestore.Timestamp.now(),
        enviado_por_uid:      firebase.auth().currentUser?.uid || null,
        fecha_modificacion:   new Date()
      });
      Toast.show('Marcado como listo para comisión.', 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo marcar como listo para comisión.', 'bad');
    }
  },

  async quitarComision(id) {
    try {
      if (!AUTH.is(ROLES.ADMIN)) { Toast.show('Solo el administrador puede cambiar este estado.', 'bad'); return; }
      if (!await Modal.confirm({ message: "¿Quitar la marca de 'Listo para Comisión'?" })) return;
      await ContratosService.updateContrato(id, {
        listo_para_comision:  false,
        fecha_envio_comision: null,
        enviado_por_uid:      null,
        fecha_modificacion:   new Date()
      });
      Toast.show('Etiqueta de comisión retirada.', 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo quitar la marca de comisión.', 'bad');
    }
  },

  // ── Event wiring ─────────────────────────────────────────────────
  init() {
    const self = this;

    const btnCargarMas = document.getElementById('btnCargarMas');
    if (btnCargarMas) {
      btnCargarMas.addEventListener('click', async () => {
        if (CS.isLoading) return;
        if (CS.contratos.length >= CS.maxRows()) {
          Toast.show('⚠️ Límite de consulta alcanzado para tu rol.', 'warn');
          self.updateBtnCargarMas(true);
          return;
        }
        await self.cargar(false);
      });
    }

    const chkSoloPendientes = document.getElementById('chkSoloPendientes');
    if (chkSoloPendientes) {
      chkSoloPendientes.addEventListener('change', () => {
        const sel = document.getElementById('filtroEstado');
        if (!sel) return;
        sel.value = chkSoloPendientes.checked ? 'pendiente_aprobacion' : '';
        self.cargar(true);
      });
      const sel = document.getElementById('filtroEstado');
      chkSoloPendientes.checked = !!(sel && sel.value === 'pendiente_aprobacion');
    }

    const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusqueda');
    if (btnLimpiarBusqueda) {
      btnLimpiarBusqueda.addEventListener('click', () => {
        const inp    = document.getElementById('filtroCliente');
        const sel    = document.getElementById('filtroEstado');
        const chkPnd = document.getElementById('chkSoloPendientes');
        const chkIna = document.getElementById('chkMostrarInactivos');
        if (inp)    inp.value    = '';
        if (sel)    sel.value    = '';
        if (chkPnd) chkPnd.checked = false;
        if (chkIna) chkIna.checked = false;
        self.cargar(true);
      });
    }

    const chkMostrarInactivos = document.getElementById('chkMostrarInactivos');
    if (chkMostrarInactivos) {
      chkMostrarInactivos.addEventListener('change', () => self.cargar(true));
    }

    const filtroClienteInput = document.getElementById('filtroCliente');
    if (filtroClienteInput) {
      filtroClienteInput.addEventListener('input', () => {
        clearTimeout(self._searchTimeout);
        self._searchTimeout = setTimeout(() => self.cargar(true), 500);
      });
      filtroClienteInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') { clearTimeout(self._searchTimeout); self.cargar(true); }
      });
    }

    const btnFiltrar = document.getElementById('btnFiltrar');
    if (btnFiltrar) btnFiltrar.addEventListener('click', () => self.cargar(true));

    window.addEventListener('resize', () => {
      if (Math.abs(window.innerWidth - self._lastWidth) > 50) {
        self._lastWidth = window.innerWidth;
        self.renderDesdeCache();
      }
    });
  }
};

ContratosLista.init();
