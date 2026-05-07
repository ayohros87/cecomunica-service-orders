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
    if (reachedMax)    btn.textContent = '🔒 Límite de consulta alcanzado';
    else if (noMore)   btn.textContent = 'Sin más resultados';
    else               btn.textContent = CS.isLoading ? '⏳ Cargando...' : '⬇️ Cargar más contratos';
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
      data.estado === 'activo'               ? 'estado-activo'   :
      data.estado === 'aprobado'             ? 'estado-aprobado' :
      data.estado === 'pendiente_aprobacion' ? 'estado-pendiente':
      data.estado === 'anulado'              ? 'estado-anulado'  :
      'estado-inactivo';

    const estadoTexto =
      data.estado === 'pendiente_aprobacion' ? 'Pendiente Aprobación' :
      data.estado === 'aprobado'             ? 'Aprobado'             :
      data.estado === 'activo'               ? 'Activo'               :
      data.estado === 'anulado'              ? 'Anulado'              :
      'Inactivo';

    const iconoComision = data.listo_para_comision
      ? `<span title="Listo para Comisión" aria-label="Listo para comisión" style="margin-left:6px;">✔️</span>`
      : '';

    const tot = ContractTotals.fromDoc(data);

    const btnImprimir = data.contrato_id
      ? `<button class="btn" onclick="ContratosLista.ver('${data.contrato_id}')" title="Imprimir/Ver">🖨️</button>`
      : '';
    const btnEditar = editable
      ? `<button class="btn" onclick="ContratosLista.editar('${id}')" title="Editar">✏️</button>`
      : '';

    let btnBorrar = '';
    if (!['activo','aprobado','anulado'].includes(data.estado) && (esAdmin || AUTH.is(ROLES.VENDEDOR))) {
      btnBorrar = `<button class="btn danger" onclick="ContratosLista.borrar('${id}')" title="Eliminar">🗑️</button>`;
    }

    let bloqueFirmado = '';
    const puedeSubirFirmado = data.estado === 'aprobado' && puedeEditar;
    if (yaFirmado) {
      bloqueFirmado = `<a class="btn" href="${data.firmado_url}" target="_blank" rel="noopener" title="Ver firmado">📄</a>`;
      if (puedeSubirFirmado)
        bloqueFirmado += ` <button class="btn" onclick="ContratosFirmado.subir('${id}')" title="Reemplazar firmado">🔁</button>`;
    } else if (puedeSubirFirmado) {
      bloqueFirmado = `<button class="btn" onclick="ContratosFirmado.subir('${id}')" title="Subir contrato firmado">📤</button>`;
    }

    const btnAnular = (['activo','aprobado'].includes(data.estado) && esAdmin)
      ? `<button class="btn danger" onclick="ContratosLista.anular('${id}')" title="Anular contrato">🚫</button>`
      : '';
    const btnDuplicar = (puedeEditar && ['anulado','inactivo'].includes(data.estado))
      ? `<button class="btn" onclick="ContratosLista.duplicar('${id}')" title="Duplicar contrato">📄</button>`
      : '';
    const btnComisionAgregar = esAdmin && !data.listo_para_comision
      ? `<button class="btn" onclick="ContratosLista.marcarComision('${id}')" title="Marcar listo para comisión">💰</button>`
      : '';
    const btnComisionQuitar = esAdmin && data.listo_para_comision
      ? `<button class="btn danger" onclick="ContratosLista.quitarComision('${id}')" title="Quitar marca de comisión">🧹</button>`
      : '';

    const accionesHtml = esRecepcion
      ? `${btnImprimir}${puedePanelTrabajo ? `<button class="btn" onclick="ContratosEquipos.abrirPanel('${id}')" title="Panel de trabajo">🗂️</button>` : ''}`
      : `${btnImprimir}
         ${puedePanelTrabajo ? `<button class="btn" onclick="ContratosEquipos.abrirPanel('${id}')" title="Panel de trabajo">🗂️</button>` : ''}
         ${btnEditar}
         ${btnBorrar}
         ${bloqueFirmado}
         ${esAdmin && data.estado === 'pendiente_aprobacion' ? `<button class="btn" onclick="ContratosAprobacion.abrir('${id}')" title="Aprobar">✅</button>` : ''}
         ${btnComisionAgregar}
         ${btnComisionQuitar}
         ${btnAnular}
         ${btnDuplicar}`;

    const fila = document.createElement('tr');
    fila.setAttribute('data-contrato-doc-id', id);
    fila.innerHTML = `
      <td>${data.contrato_id || '-'} ${iconoComision}</td>
      <td>${esc(data.cliente_nombre || '-')}</td>
      <td>${esc(data.tipo_contrato || '-')}</td>
      <td>${esc(data.accion || '-')}</td>
      <td style="text-align:center;" data-contrato-equipos="${id}"><span style="opacity:0.3;">⏳</span></td>
      <td class="estado-cell">
        <span class="estado ${estadoClase}">
          <span class="estado-dot" aria-hidden="true"></span>
          ${estadoTexto}
        </span>
      </td>
      <td>${data.fecha_creacion?.toDate ? data.fecha_creacion.toDate().toLocaleDateString() : '-'}</td>
      <td>${esc(CS.mapaUsuarios[data.creado_por_uid] || '-')}</td>
      <td>${FMT.money(tot.totalConITBMS)}</td>
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
      data.estado === 'activo'               ? 'estado-activo'   :
      data.estado === 'aprobado'             ? 'estado-aprobado' :
      data.estado === 'pendiente_aprobacion' ? 'estado-pendiente':
      data.estado === 'anulado'              ? 'estado-anulado'  :
      'estado-inactivo';

    const estadoTexto =
      data.estado === 'pendiente_aprobacion' ? 'Pendiente' :
      data.estado === 'aprobado'             ? 'Aprobado'  :
      data.estado === 'activo'               ? 'Activo'    :
      data.estado === 'anulado'              ? 'Anulado'   :
      'Inactivo';

    let bloqueFirmado = '';
    if (data.firmado_url) {
      bloqueFirmado = `<a class="btn" href="${data.firmado_url}" target="_blank" rel="noopener" title="Ver firmado">📄</a>`;
      if (data.estado === 'aprobado' && puedeEditar)
        bloqueFirmado += ` <button class="btn" onclick="ContratosFirmado.subir('${data.id}')" title="Reemplazar firmado">🔁</button>`;
    } else if (data.estado === 'aprobado' && puedeEditar) {
      bloqueFirmado = `<button class="btn" onclick="ContratosFirmado.subir('${data.id}')" title="Subir firmado">📤</button>`;
    }

    const accionesMovilHtml = esRecepcion
      ? `${data.contrato_id ? `<button class="btn" onclick="ContratosLista.ver('${data.contrato_id}')" title="Ver/Imprimir">🖨️ Ver</button>` : ''}
         ${puedePanelTrabajo ? `<button class="btn" onclick="ContratosEquipos.abrirPanel('${data.id}')" title="Panel de trabajo">🗂️ Panel</button>` : ''}`
      : `${data.contrato_id ? `<button class="btn" onclick="ContratosLista.ver('${data.contrato_id}')" title="Ver/Imprimir">🖨️ Ver</button>` : ''}
         ${puedePanelTrabajo ? `<button class="btn" onclick="ContratosEquipos.abrirPanel('${data.id}')" title="Panel de trabajo">🗂️ Panel</button>` : ''}
         ${editable ? `<button class="btn" onclick="ContratosLista.editar('${data.id}')" title="Editar">✏️ Editar</button>` : ''}
         ${puedeAprobar ? `<button class="btn ok block" onclick="ContratosAprobacion.abrir('${data.id}')" title="Aprobar ahora">✅ Aprobar</button>` : ''}
         ${bloqueFirmado}
         ${esAdmin && !data.listo_para_comision
           ? `<button class="btn" onclick="ContratosLista.marcarComision('${data.id}')" title="Marcar listo para comisión">💰 Comisión</button>`
           : ''}
         ${esAdmin && data.listo_para_comision
           ? `<button class="btn danger" onclick="ContratosLista.quitarComision('${data.id}')" title="Quitar marca de comisión">🧹 Quitar</button>`
           : ''}`;

    const card = document.createElement('div');
    card.className = 'card-contrato';
    card.innerHTML = `
      <div class="row">
        <div>
          <div class="t1">
            ${esc(data.contrato_id || '-')}
            ${data.listo_para_comision ? '<span title="Listo para Comisión" aria-label="Listo para comisión" style="margin-left:6px;">✔️</span>' : ''}
          </div>
          <div class="t2">${esc(data.cliente_nombre || '-')}</div>
        </div>
        <div class="${estadoClase}">${estadoTexto}</div>
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
        return String(c?.cliente_nombre_lower || c?.cliente_nombre || '').toLowerCase().includes(clienteSearchLower);
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
        const wrap = document.querySelector('.table-wrap');
        if (wrap) wrap.style.display = 'none';
        if (listaMovil) listaMovil.style.display = 'grid';
        filtrados.forEach(data => {
          if (data.estado === 'pendiente_aprobacion') pendientes++;
          if (data.estado === 'aprobado') aprobados++;
          if (data.estado === 'activo')   activos++;
          if (listaMovil) listaMovil.appendChild(this.crearCard(data));
        });
      } else {
        const wrap = document.querySelector('.table-wrap');
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
      const wrap = document.querySelector('.table-wrap');
      if (wrap) wrap.style.display = 'none';
      if (listaMovil) listaMovil.style.display = 'grid';
      filtrados.forEach(data => {
        if (data.estado === 'pendiente_aprobacion') pendientes++;
        if (data.estado === 'aprobado') aprobados++;
        if (data.estado === 'activo')   activos++;
        if (listaMovil) listaMovil.appendChild(this.crearCard(data));
      });
    } else {
      const wrap = document.querySelector('.table-wrap');
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
      if (!c) return alert('Contrato no encontrado.');
      if (!AUTH.is(ROLES.ADMIN)) return alert('Solo el administrador puede anular contratos.');
      if (!['activo','aprobado'].includes(c.estado))
        return alert('Solo se puede anular un contrato ACTIVO o APROBADO.');

      const motivo = prompt('Motivo de anulación (ej: envío errado, datos incorrectos):');
      if (motivo === null) return;
      const motivoTrim = (motivo || '').trim();
      if (!motivoTrim) return alert('Debes indicar un motivo.');

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
      alert('No se pudo anular el contrato.');
    }
  },

  async duplicar(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) return alert('Contrato no encontrado.');

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
      alert('No se pudo preparar el borrador para duplicar.');
    }
  },

  async editar(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) return alert('Contrato no encontrado.');
      if (c.estado === 'activo' || c.estado === 'aprobado')
        return alert('Este contrato ya fue aprobado y no se puede editar.');
      if (c.estado === 'anulado')
        return alert("Este contrato fue ANULADO y no se puede editar. Usa 'Duplicar' para rehacerlo.");
      window.location.href = `editar-contrato.html?id=${id}`;
    } catch (e) {
      console.error(e);
      alert('No se pudo validar el estado del contrato.');
    }
  },

  async borrar(id) {
    try {
      const c = await ContratosService.getContrato(id);
      if (!c) return alert('Contrato no encontrado.');
      if (['activo','aprobado','anulado'].includes(c.estado))
        return alert('Un contrato APROBADO/ACTIVO/ANULADO no se puede eliminar. Use ANULAR si corresponde.');
      if (AUTH.is(ROLES.VENDEDOR) && c.creado_por_uid && c.creado_por_uid !== (firebase.auth().currentUser?.uid || ''))
        return alert('Solo el creador o un administrador pueden eliminar este contrato.');
      if (!confirm('¿Seguro que deseas eliminar este contrato?')) return;

      await ContratosService.updateContrato(id, { deleted: true, fecha_modificacion: new Date() });
      Toast.show('✅ Contrato eliminado', 'ok');
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      console.error(e);
      alert('No se pudo eliminar el contrato.');
    }
  },

  async marcarComision(id) {
    try {
      if (!AUTH.is(ROLES.ADMIN)) return alert('Solo el administrador puede cambiar este estado.');
      if (!confirm("¿Marcar este contrato como 'Listo para Comisión'?")) return;
      await ContratosService.updateContrato(id, {
        listo_para_comision:  true,
        fecha_envio_comision: firebase.firestore.Timestamp.now(),
        enviado_por_uid:      firebase.auth().currentUser?.uid || null,
        fecha_modificacion:   new Date()
      });
      Toast.show('💼 Marcado como listo para comisión.', 'ok');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      console.error(e);
      alert('No se pudo marcar como listo para comisión.');
    }
  },

  async quitarComision(id) {
    try {
      if (!AUTH.is(ROLES.ADMIN)) return alert('Solo el administrador puede cambiar este estado.');
      if (!confirm("¿Quitar la marca de 'Listo para Comisión'?")) return;
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
      alert('No se pudo quitar la marca de comisión.');
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
