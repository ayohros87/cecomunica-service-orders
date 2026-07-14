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

  // Botón de seriales con estado: pendiente (resaltado) / parcial / completo (verde).
  // Se muestra en contratos activos/aprobados con unidades activas.
  serialesBtn(id, data, { movil = false } = {}) {
    if (!['activo', 'aprobado'].includes(data.estado)) return '';
    // Contratos históricos (corte legacy): fuera del flujo automático. Chip GRIS
    // (no es un CTA pendiente como el ámbar) pero SÍ clickeable: abre la página de
    // seriales en modo "registro histórico" por si más adelante se quieren
    // registrar los seriales en el contrato. Eso NO reenvía a activaciones (la
    // página oculta "Confirmar" y el trigger backstop bloquea el correo).
    // Ver backfill `marcarSerialesLegacy`.
    if (data.seriales_estado === 'legacy') {
      return `<button class="btn btn-sm" style="background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;" onclick="location.href='seriales.html?id=${id}'" title="Contrato histórico — registrar seriales para referencia (no se envía a activaciones)"><i data-lucide="archive" style="width:14px;height:14px;"></i> Seriales · histórico</button>`;
    }
    // Renovación sin equipo: los renglones de equipos son solo de alquiler
    // (no se entrega equipo físico) — no hay seriales que asignar.
    if (data.accion === 'Renovación' && data.renovacion_sin_equipo) return '';
    const total = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    const activos = Math.max(0, total - Number(data.baja_cancelado_total || 0));
    if (activos === 0) return '';
    // Unidades resueltas = seriales reales + unidades marcadas "sin serial" (omitidas).
    const count = Number(data.seriales_count || 0) + Number(data.seriales_omitidos_count || 0);

    let css, icon, label, title;
    if (count === 0) {
      css = 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
      icon = 'scan-barcode'; label = 'Seriales pendientes'; title = `Faltan seriales (0 de ${activos})`;
    } else if (count >= activos) {
      css = 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;';
      icon = 'check'; label = 'Seriales'; title = `Seriales completos (${count} de ${activos})`;
    } else {
      css = 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
      icon = 'scan-barcode'; label = `Seriales ${count}/${activos}`; title = `Seriales incompletos (${count} de ${activos})`;
    }
    const cls = movil ? 'btn btn-sm' : 'btn btn-sm';
    return `<button class="${cls}" style="${css}" onclick="location.href='seriales.html?id=${id}'" title="${title}"><i data-lucide="${icon}" style="width:14px;height:14px;"></i> ${label}</button>`;
  },

  // Indicador de enmienda sobre el contrato (derivado por el trigger onCancelacionWrite).
  // La baja PENDIENTE ya no se muestra aquí: vive como CTA prominente en la
  // columna de acciones (ver buildAcciones). Aquí quedan solo los estados
  // informativos/históricos (terminado, baja aprobada).
  bajaPill(data) {
    const finTerm = data.terminacion_fin?.toDate ? data.terminacion_fin.toDate().toLocaleDateString()
      : (data.baja_fecha_fin?.toDate ? data.baja_fecha_fin.toDate().toLocaleDateString() : '');
    if (data.terminacion_total) {
      return `<span class="chip-estado chip-cancelada" title="Terminación total${finTerm ? ' · factura hasta ' + finTerm : ''}"><i data-lucide="file-minus-2" style="width:12px;height:12px;"></i> Terminado</span>`;
    }
    if (data.baja_estado === 'aprobada') {
      const orig = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
      const activos = Math.max(0, orig - Number(data.baja_cancelado_total || 0));
      return `<span class="chip-estado chip-cancelada" title="Baja parcial aprobada · ${activos} de ${orig} activos${finTerm ? ' · factura hasta ' + finTerm : ''}"><i data-lucide="package-minus" style="width:12px;height:12px;"></i> Baja · ${activos}/${orig}</span>`;
    }
    return '';
  },

  // Chip informativo: hay una solicitud de cambio de serial PENDIENTE de que
  // inventario introduzca los reemplazos. El flag lo mantiene el trigger
  // onSerialCambio en el contrato (seriales_cambio_pendiente).
  cambioSerialPill(data) {
    if (!data.seriales_cambio_pendiente) return '';
    return `<span class="chip-estado" style="background:#EFF6FF;color:#1E3A8A;border:1px solid #93C5FD;" title="Solicitud de cambio de serial pendiente de reemplazo por inventario"><i data-lucide="replace" style="width:12px;height:12px;"></i> Cambio de serial</span>`;
  },

  // ── Acciones (CTA inline + menú ⋯) ───────────────────────────────
  // Construye el área de acciones de una fila/card: el pill de Seriales
  // (indicador de estado) + una sola CTA contextual + un menú overflow
  // con el resto. Comparte la lógica entre tabla y cards móviles.
  buildAcciones(id, data, { movil = false } = {}) {
    const esAdmin     = AUTH.is(ROLES.ADMIN);
    const esGerente   = AUTH.is(ROLES.GERENTE);
    const esRecepcion = AUTH.is(ROLES.RECEPCION);
    const esVendedor  = AUTH.is(ROLES.VENDEDOR);
    const puedeEditar = esAdmin || esVendedor;
    const puedePanelTrabajo = esAdmin || esRecepcion;
    const editable    = puedeEditar && !['activo','aprobado','anulado'].includes(data.estado);
    const yaFirmado   = !!data.firmado_url;
    const puedeSubirFirmado = data.estado === 'aprobado' && puedeEditar;
    const esActivoOAprobado = ['activo','aprobado'].includes(data.estado);

    const bajaPendiente   = data.baja_estado === 'pendiente' && esActivoOAprobado && !data.terminacion_total;
    const esAprobadorBaja = esAdmin || esGerente;
    const puedeSolicitarBaja = esActivoOAprobado && (esAdmin || esVendedor || esRecepcion || esGerente);

    const ctaCls = 'btn btn-sm';

    // ── CTA primaria (precedencia) ──────────────────────────────────
    // 1) baja pendiente (lo más urgente) → 2) aprobar contrato →
    // 3) subir firmado → 4) ver/imprimir.
    let primaryHtml = '';
    let primaryKind = '';
    if (bajaPendiente) {
      primaryKind = 'baja';
      const amber = 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;text-decoration:none;';
      // Ambos van a la cola (default: filtro 'pendiente'); el aprobador ve los
      // botones Aprobar/Rechazar, el solicitante solo el estado. No usamos
      // ?contrato= porque eso abre el formulario de nueva solicitud, no la cola.
      primaryHtml = esAprobadorBaja
        ? `<a class="${ctaCls}" style="${amber}" href="cancelaciones.html" title="Aprobar baja pendiente"><i data-lucide="clock" style="width:14px;height:14px;"></i> Aprobar baja</a>`
        : `<a class="${ctaCls}" style="${amber}" href="cancelaciones.html" title="Baja en revisión por administración"><i data-lucide="clock" style="width:14px;height:14px;"></i> Baja en revisión</a>`;
    } else if (esAdmin && data.estado === 'pendiente_aprobacion') {
      primaryKind = 'aprobar';
      primaryHtml = `<button class="${ctaCls} btn-accent" onclick="ContratosAprobacion.abrir('${id}')" title="Aprobar contrato"><i data-lucide="check-circle" style="width:14px;height:14px;"></i> Aprobar</button>`;
    } else if (puedeSubirFirmado && !yaFirmado) {
      primaryKind = 'subir-firmado';
      primaryHtml = `<button class="${ctaCls}" onclick="ContratosFirmado.subir('${id}')" title="Subir contrato firmado"><i data-lucide="upload" style="width:14px;height:14px;"></i> Subir firmado</button>`;
    } else if (data.contrato_id) {
      primaryKind = 'ver';
      primaryHtml = `<button class="${ctaCls}" onclick="ContratosLista.ver('${data.contrato_id}')" title="Ver / Imprimir"><i data-lucide="printer" style="width:14px;height:14px;"></i> Ver</button>`;
    }

    // ── Pill de Seriales (indicador de estado, queda inline) ─────────
    const serialesHtml = ContratosLista.serialesBtn(id, data, { movil });

    // ── Menú overflow: todo lo demás, con texto + icono ──────────────
    const items = [];
    const I = (icon, label, onclick, cls = '') =>
      `<button class="overflow-menu-item ${cls}" onclick="${onclick}"><i data-lucide="${icon}"></i> ${label}</button>`;
    const A = (icon, label, href, cls = '') =>
      `<a class="overflow-menu-item ${cls}" href="${href}" target="_blank" rel="noopener"><i data-lucide="${icon}"></i> ${label}</a>`;

    if (primaryKind !== 'ver' && data.contrato_id)
      items.push(I('printer', 'Ver / Imprimir', `ContratosLista.ver('${data.contrato_id}')`));
    if (puedePanelTrabajo)
      items.push(I('folder-open', 'Panel de trabajo', `ContratosEquipos.abrirPanel('${id}')`));
    if (editable)
      items.push(I('pencil', 'Editar', `ContratosLista.editar('${id}')`));
    // Aprobar contrato — en el menú solo si NO es ya la CTA primaria (p.ej.
    // cuando una baja pendiente desplazó la CTA).
    if (primaryKind !== 'aprobar' && esAdmin && data.estado === 'pendiente_aprobacion')
      items.push(I('check-circle', 'Aprobar contrato', `ContratosAprobacion.abrir('${id}')`, 'highlighted'));
    // Solicitar baja — solo cuando no hay una baja pendiente (si la hay, vive en la CTA).
    if (puedeSolicitarBaja && !bajaPendiente)
      items.push(I('package-minus', 'Solicitar baja', `window.location.href='cancelaciones.html?contrato=${id}'`));
    // Solicitar cambio/corrección de serial — recepción/admin, SOLO mientras el
    // contrato está 'aprobado' (antes de activarse) y ya tiene seriales asignados.
    if ((esAdmin || esRecepcion) && data.estado === 'aprobado'
        && data.seriales_estado !== 'legacy' && Number(data.seriales_count || 0) > 0)
      items.push(I('scan-barcode', 'Solicitar cambio de serial', `ContratosSerialCambio.abrir('${id}')`));
    // Firmado
    if (yaFirmado) {
      items.push(A('file-text', 'Ver firmado', data.firmado_url));
      if (puedeSubirFirmado)
        items.push(I('refresh-cw', 'Reemplazar firmado', `ContratosFirmado.subir('${id}')`));
    } else if (puedeSubirFirmado && primaryKind !== 'subir-firmado') {
      items.push(I('upload', 'Subir firmado', `ContratosFirmado.subir('${id}')`));
    }
    // Comisión (admin)
    if (esAdmin && !data.listo_para_comision)
      items.push(I('dollar-sign', 'Marcar comisión', `ContratosLista.marcarComision('${id}')`));
    if (esAdmin && data.listo_para_comision)
      items.push(I('x-circle', 'Quitar comisión', `ContratosLista.quitarComision('${id}')`));
    // Duplicar
    if (puedeEditar && ['anulado','inactivo'].includes(data.estado))
      items.push(I('copy', 'Duplicar', `ContratosLista.duplicar('${id}')`));
    // Destructivas (al final, separadas, en rojo)
    const danger = [];
    if (esActivoOAprobado && esAdmin)
      danger.push(I('ban', 'Anular contrato', `ContratosLista.anular('${id}')`, 'danger'));
    if (!['activo','aprobado','anulado'].includes(data.estado) && (esAdmin || esVendedor))
      danger.push(I('trash-2', 'Eliminar', `ContratosLista.borrar('${id}')`, 'danger'));
    if (danger.length) {
      items.push('<div class="overflow-menu-divider"></div>');
      items.push(...danger);
    }

    const menuHtml = items.length
      ? `<div class="overflow-menu">
           <button class="overflow-menu-btn" onclick="ContratosLista.toggleMenu('${id}')" title="Más acciones" aria-label="Más acciones" aria-haspopup="true">⋯</button>
           <div class="overflow-menu-dropdown" id="acc-menu-${id}">${items.join('')}</div>
         </div>`
      : '';

    return `${serialesHtml}${primaryHtml}${menuHtml}`;
  },

  // Abre/cierra el menú overflow de una fila (cierra los demás primero).
  toggleMenu(id) {
    const menu = document.getElementById(`acc-menu-${id}`);
    if (!menu) return;
    const abierto = menu.classList.contains('open');
    ContratosLista.closeMenus();
    if (!abierto) menu.classList.add('open');
  },

  closeMenus() {
    document.querySelectorAll('.overflow-menu-dropdown.open[id^="acc-menu-"]')
      .forEach(m => m.classList.remove('open'));
  },

  // ── Row / card builders ──────────────────────────────────────────
  crearFila(id, data) {
    const esc = CS.esc.bind(CS);

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

    const accionesHtml = ContratosLista.buildAcciones(id, data);

    const fila = document.createElement('tr');
    fila.setAttribute('data-contrato-doc-id', id);
    fila.innerHTML = `
      <td class="td-primary">${data.contrato_id || '-'} ${iconoComision}</td>
      <td><strong style="color:var(--fg-1); font-weight:600;">${esc(data.cliente_nombre || '-')}</strong></td>
      <td>${esc(data.tipo_contrato || '-')}</td>
      <td>${esc(data.accion || '-')}</td>
      <td style="text-align:center;" data-contrato-equipos="${id}"><span style="opacity:0.3;"><i data-lucide="loader"></i></span></td>
      <td class="estado-cell">
        <div style="display:inline-flex; flex-direction:column; align-items:flex-start; gap:4px;">
          <span class="chip-estado ${estadoClase}">${estadoTexto}</span>
          ${ContratosLista.bajaPill(data)}
          ${ContratosLista.cambioSerialPill(data)}
        </div>
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

    const accionesMovilHtml = ContratosLista.buildAcciones(data.id, data, { movil: true });

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
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          <div class="chip-estado ${estadoClase}">${estadoTexto}</div>
          ${ContratosLista.bajaPill(data)}
          ${ContratosLista.cambioSerialPill(data)}
        </div>
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
        CS.contratos = [];
        CS.lastDoc   = null;
      }

      // NOTE: we intentionally don't clear the table or strip the skeleton
      // rows here. The skeleton (or the previous results) stays until the
      // single `tabla.innerHTML = ''` swap just before the rows are appended
      // below, so the table never flashes blank during the network load.

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

    // Cierre del menú overflow: al hacer click en un item (tras ejecutar su
    // acción), al hacer click fuera de cualquier menú, o con ESC.
    document.addEventListener('click', (e) => {
      if (e.target.closest('.overflow-menu-item')) { self.closeMenus(); return; }
      if (!e.target.closest('.overflow-menu')) self.closeMenus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') self.closeMenus();
    });
  }
};

ContratosLista.init();
