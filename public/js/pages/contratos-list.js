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
    // Scoped al botón: el barrido full-document corría en cada actualización.
    if (window.Icons) Icons.pintar(btn);
    else if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  // Chip de seriales — INFORMATIVO (archivo, 2026-09-09). Antes era un botón
  // que llevaba a completar seriales; asignar seriales es trabajo y el trabajo
  // vive en el Centro. Aquí solo dice cuántos quedaron registrados. La única
  // excepción clickeable son los contratos 'legacy' (corte histórico, fuera del
  // flujo automático), que sí se pueden completar para referencia — y ese
  // enlace vive en el menú ⋯, no como CTA.
  serialesChip(data) {
    if (!['activo', 'aprobado'].includes(data.estado)) return '';
    if (data.seriales_estado === 'legacy') {
      return `<span class="chip-estado" style="background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;" title="Contrato histórico — fuera del flujo automático de seriales"><i data-lucide="archive" style="width:12px;height:12px;"></i> Histórico</span>`;
    }
    if (data.accion === 'Renovación' && data.renovacion_sin_equipo) return '';
    const total = (data.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    const activos = Math.max(0, total - Number(data.baja_cancelado_total || 0));
    if (activos === 0) return '';
    const count = Number(data.seriales_count || 0) + Number(data.seriales_omitidos_count || 0);

    let css, icon, label, title;
    if (count === 0) {
      css = 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
      icon = 'scan-barcode'; label = 'Sin seriales'; title = `El contrato no tiene seriales registrados (0 de ${activos})`;
    } else if (count >= activos) {
      css = 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;';
      icon = 'check'; label = `${count} seriales`; title = `Seriales completos (${count} de ${activos})`;
    } else {
      css = 'background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;';
      icon = 'scan-barcode'; label = `${count}/${activos}`; title = `Seriales parciales (${count} de ${activos})`;
    }
    return `<span class="chip-estado" style="${css}" title="${title}"><i data-lucide="${icon}" style="width:12px;height:12px;"></i> ${label}</span>`;
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

  // Columna "Devolución": ¿el cliente todavía tiene equipos de este contrato?
  // Los conteos los denormaliza onOrdenDevolucionWrite desde la orden de
  // DEVOLUCIÓN; el predicado vive en js/domain/devolucionContrato.js.
  //
  // Va en columna propia y no apilado en Estado a propósito: la fila ya puede
  // llevar 3 chips (estado + baja + cambio de serial) y el pedido del equipo
  // es escanear la lista en vertical buscando quién debe equipos.
  devolucionPill(data, id) {
    const estado = DevolucionContrato.estado(data);
    if (!estado) return '';
    const cid = id || data.id || '';

    const faltan = DevolucionContrato.pendientes(data);
    const total  = DevolucionContrato.esperados(data);
    const ordenId = DevolucionContrato.ordenUnica(data);

    let css, icon, label, title, href = '';
    if (estado === 'pendiente') {
      css = 'background:#FFFBEB;color:#92400E;border:1px solid #FDE68A;';
      icon = 'package-minus';
      label = `Faltan ${faltan} de ${total}`;
      title = `Devolución abierta · ${faltan} de ${total} equipo(s) siguen con el cliente`;
      if (ordenId) href = `../ordenes/index.html?buscar=${encodeURIComponent(ordenId)}`;
    } else if (estado === 'completa') {
      css = 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;';
      icon = 'check';
      label = `Devuelto${total ? ` (${total})` : ''}`;
      title = `Devolución cerrada · ${total || 'todos los'} equipo(s) regresaron`;
      if (ordenId) href = `../ordenes/index.html?buscar=${encodeURIComponent(ordenId)}`;
    } else if (estado === 'cerrada_con_faltantes') {
      css = 'background:#FEF2F2;color:#991B1B;border:1px solid #FECACA;';
      icon = 'alert-triangle';
      label = `${faltan} sin devolver`;
      title = `Devolución cerrada con faltantes · ${faltan} de ${total} equipo(s) no regresaron`;
      if (ordenId) href = `../ordenes/index.html?buscar=${encodeURIComponent(ordenId)}`;
    } else if (estado === 'no_aplica') {
      css = 'background:#EEF2F6;color:#4A5560;border:1px solid #DDE4EB;';
      icon = 'minus-circle';
      label = 'No aplica';
      // Dos causas distintas, las dos verificadas contra el pool — no es un
      // "no sé" disfrazado, por eso no lleva el borde punteado del gris.
      title = data.devolucion_no_aplica_motivo === 'sin_unidades'
        ? 'Se revisó el pool al entregarse la renovación: no queda ningún equipo de CeComunica por recuperar'
        : 'Contrato Propio — los equipos son del cliente, no hay nada que recuperar';
    } else { // sin_registro
      css = 'background:#F8FAFC;color:#6B7884;border:1px dashed #C2CCD6;';
      icon = 'help-circle';
      label = 'Sin registro';
      title = 'El contrato terminó teniendo equipo afuera, pero nunca se registró la devolución — el sistema no sabe si los equipos regresaron';
      href = `transicion.html?id=${cid}`;
    }

    const chip = `<span class="chip-estado" style="${css}" title="${title}"><i data-lucide="${icon}" style="width:12px;height:12px;"></i> ${label}</span>`;
    return href
      ? `<a href="${href}" style="text-decoration:none;" title="${title}">${chip}</a>`
      : chip;
  },

  // Chip informativo: hay una solicitud de cambio de serial PENDIENTE de que
  // inventario introduzca los reemplazos. El flag lo mantiene el trigger
  // onSerialCambio en el contrato (seriales_cambio_pendiente).
  // Chip de alerta: se anuló por SUSTITUCIÓN pero el equipo no llegó entero al
  // contrato sustituto (no se indicó cuál, el modelo no tiene renglón allá, o
  // alguna ficha no se pudo resolver). Lo estampa onAnnulment.
  //
  // Sin esto el fallo era invisible: MAGEN DAVID anuló REEMP20260811-01 hacia
  // ALQ20260812-01, los 5 T338 se quedaron colgando del contrato muerto y la
  // única huella fue una línea de log que nadie mira.
  sustitucionPill(data) {
    if (!data.sustitucion_vinculo_pendiente) return '';
    const n = Number(data.sustitucion_unidades_en_cliente || 0);
    const motivo = data.sustitucion_vinculo_motivo || 'no se pudo vincular el contrato sustituto';
    const title = `Anulado por sustitución, pero el equipo no pasó al contrato nuevo: ${motivo}`
      + (n ? ` · ${n} unidad(es) siguen ligadas a este contrato` : '');
    return `<span class="chip-estado" style="background:#FEF2F2;color:#991B1B;border:1px solid #FECACA;" title="${CS.esc(title)}"><i data-lucide="unlink" style="width:12px;height:12px;"></i> Sustitución sin vincular</span>`;
  },

  cambioSerialPill(data) {
    if (!data.seriales_cambio_pendiente) return '';
    return `<span class="chip-estado" style="background:#EFF6FF;color:#1E3A8A;border:1px solid #93C5FD;" title="Solicitud de cambio de serial pendiente de reemplazo por inventario"><i data-lucide="replace" style="width:12px;height:12px;"></i> Cambio de serial</span>`;
  },

  // ¿Este usuario ve los montos? El archivo lo consultan también recepción y
  // vendedores, y el total del contrato es información financiera
  // (need-to-know). La columna se OMITE, no se tacha: una columna vacía
  // invita a preguntar quién sí la ve.
  verMontos() {
    return canRole(AUTH.rol, 'ver-montos-contrato');
  },

  // Columna "Papel": qué documento le toca a este contrato. Es la misma regla
  // que usa el trigger para decidir qué PDF adjunta el correo a activaciones
  // (js/domain/documentoContrato.js, espejo de functions/src/lib/). Verla en
  // la lista es lo que hace obvio, de un vistazo, que un contrato viejo
  // imprime el formato anterior a propósito y no por un error.
  papelChip(data) {
    const v2 = DocumentoContrato.esV2(data);
    const css = v2
      ? 'background:#E6F4FB;color:#00648F;border:1px solid #9BD2EE;'
      : 'background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;';
    const title = v2
      ? 'Documento v2 — secciones numeradas, Anexo A por serial y firma digital'
      : 'Formato anterior — es el papel que el cliente tiene firmado (contrato previo al corte del 2026-09-09)';
    return `<span class="chip-estado" style="${css}" title="${title}">${v2 ? 'v2' : 'clásico'}</span>`;
  },

  // ── Acciones del ARCHIVO (2026-09-09) ────────────────────────────
  // Este módulo dejó de ser una herramienta de trabajo: las 14 acciones que
  // vivían aquí (aprobar, subir firmado, seriales, panel de trabajo,
  // transición, baja, cambio de serial, orden de programación, renovar,
  // duplicar, comisión, anular, eliminar) ya existen en el Centro de gestión,
  // que es donde viven el plan por serial y el expediente de la gestión. Dos
  // puertas para lo mismo es una puerta que se queda desactualizada.
  //
  // Lo que queda es de LECTURA: ver el documento que corresponde (el corte
  // decide si v2 o clásico — DocumentoContrato), abrir la ficha del cliente y
  // bajar el PDF firmado.
  buildAcciones(id, data, { movil = false } = {}) {
    const ctaCls = 'btn btn-sm';
    const urlFicha = `../clientes/centro.html?id=${encodeURIComponent(data.cliente_id || '')}&contrato=${encodeURIComponent(id)}`;

    // CTA primaria: el documento. Sin contrato_id (borrador sin numerar) no
    // hay papel que ver todavía.
    const primaryHtml = data.contrato_id
      ? `<button class="${ctaCls} btn-accent" onclick="ContratosLista.ver('${id}')" title="Ver el documento del contrato"><i data-lucide="file-text" style="width:14px;height:14px;"></i> Documento</button>`
      : '';

    const items = [];
    const I = (icon, label, onclick, cls = '') =>
      `<button class="overflow-menu-item ${cls}" onclick="${onclick}"><i data-lucide="${icon}"></i> ${label}</button>`;
    const A = (icon, label, href, cls = '') =>
      `<a class="overflow-menu-item ${cls}" href="${href}" target="_blank" rel="noopener"><i data-lucide="${icon}"></i> ${label}</a>`;

    items.push(A('user', 'Ficha del cliente', urlFicha));
    if (data.firmado_url) items.push(A('file-check', 'Ver el firmado (PDF)', data.firmado_url));
    if ((data.equipos || []).length) items.push(I('package', 'Equipos del contrato', `ContratosEquipos.abrirModal('${id}')`));
    // Contratos del corte histórico ('legacy'): fuera del flujo automático.
    // Registrar sus seriales para referencia sigue siendo válido y NO reenvía
    // a activaciones (la página oculta "Confirmar").
    if (data.seriales_estado === 'legacy')
      items.push(I('archive', 'Registrar seriales (histórico)', `location.href='seriales.html?id=${id}'`));
    items.push(I('link', 'Copiar el enlace', `ContratosLista.copiarEnlace('${id}')`));

    const menuHtml = `<div class="overflow-menu">
           <button class="overflow-menu-btn" onclick="ContratosLista.toggleMenu('${id}')" title="Más" aria-label="Más" aria-haspopup="true">⋯</button>
           <div class="overflow-menu-dropdown" id="acc-menu-${id}">${items.join('')}</div>
         </div>`;

    return `${primaryHtml}${menuHtml}`;
  },

  // CSV de lo que está en pantalla, con los filtros puestos. Los montos solo
  // salen si el rol los puede ver: exportar no es una puerta trasera.
  exportarCsv() {
    const filas = this.ordenar(this.filtrarLocal([...CS.contratos]));
    if (!filas.length) { Toast.show('No hay nada que exportar.', 'warn'); return; }
    const montos = this.verMontos();
    const cab = ['Contrato', 'Cliente', 'RUC', 'Tipo', 'Accion', 'Equipos', 'Estado', 'Papel',
      'Seriales', 'Fecha', 'Creado por', ...(montos ? ['Total'] : [])];
    const cuerpo = filas.map((d) => {
      const tot = ContractTotals.fromDoc(d);
      return [
        d.contrato_id || d.id,
        d.cliente_nombre || '',
        d.cliente_rucdv || d.cliente_ruc || '',
        d.tipo_contrato || '',
        d.accion || '',
        (d.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0),
        d.estado || '',
        DocumentoContrato.papel(d),
        Number(d.seriales_count || 0),
        d.fecha_creacion?.toDate ? d.fecha_creacion.toDate().toLocaleDateString() : '',
        CS.mapaUsuarios[d.creado_por_uid] || '',
        ...(montos ? [FMT.round2(tot.totalConITBMS)] : []),
      ];
    });
    Archivo.bajarCsv('contratos', cab, cuerpo);
  },

  // Enlace directo a la fila del archivo — el pedido real es pegarlo en un
  // correo o un chat, así que se copia el enlace del DOCUMENTO, no el de la
  // lista filtrada.
  async copiarEnlace(id) {
    const data = CS.contratos.find((c) => c.id === id) || {};
    const url = new URL(DocumentoContrato.urlDocumento(id, data), window.location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      Toast.show('Enlace copiado.', 'ok');
    } catch {
      // Sin permiso de portapapeles (http, o el usuario lo negó): mostrarlo
      // para que se pueda copiar a mano en vez de fallar en silencio.
      Toast.show(url, 'info');
    }
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
  crearFila(id, data, indice = 0) {
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
    // La cebra ya no puede salir de :nth-child: entre fila y fila va la del
    // expediente (oculta, pero cuenta para el selector). Se marca a mano.
    if (indice % 2 === 1) fila.classList.add('fila-par');
    fila.innerHTML = `
      <td style="width:34px;">${ArchivoExpediente.botonHtml('contrato', id)}</td>
      <td class="td-primary"><span class="contrato-id">${data.contrato_id || '-'}</span> ${iconoComision}</td>
      <td><strong style="color:var(--fg-1); font-weight:600;">${esc(data.cliente_nombre || '-')}</strong></td>
      <td>${esc(data.tipo_contrato || '-')}</td>
      <td>${esc(data.accion || '-')}</td>
      <td style="text-align:center;" data-contrato-equipos="${id}"><span style="opacity:0.3;"><i data-lucide="loader"></i></span></td>
      <td class="estado-cell">
        <div style="display:inline-flex; flex-direction:column; align-items:flex-start; gap:4px;">
          <span class="chip-estado ${estadoClase}">${estadoTexto}</span>
          ${ContratosLista.serialesChip(data)}
          ${ContratosLista.bajaPill(data)}
          ${ContratosLista.cambioSerialPill(data)}
          ${ContratosLista.sustitucionPill(data)}
        </div>
      </td>
      <td>${ContratosLista.papelChip(data)}</td>
      <td>${ContratosLista.devolucionPill(data, id)}</td>
      <td class="td-muted">${data.fecha_creacion?.toDate ? data.fecha_creacion.toDate().toLocaleDateString() : '-'}</td>
      <td class="td-muted" data-creador-uid="${esc(data.creado_por_uid || '')}">${esc(CS.mapaUsuarios[data.creado_por_uid] || (data.creado_por_uid ? '…' : '-'))}</td>
      ${ContratosLista.verMontos()
        ? `<td class="td-mono" style="text-align:right; color:var(--fg-1); font-weight:600;">${FMT.money(tot.totalConITBMS)}</td>`
        : ''}
      <td class="acciones">${accionesHtml}</td>
    `;
    // La fila del expediente viaja pegada a la suya: se devuelven las dos en un
    // fragmento para que el caller siga haciendo un solo appendChild.
    const frag = document.createDocumentFragment();
    frag.appendChild(fila);
    const cols = ContratosLista.verMontos() ? 13 : 12;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = ArchivoExpediente.filaHtml(id, cols);
    frag.appendChild(tmp.firstElementChild);
    return frag;
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
          ${ContratosLista.papelChip(data)}
          ${ContratosLista.serialesChip(data)}
          ${ContratosLista.bajaPill(data)}
          ${ContratosLista.cambioSerialPill(data)}
          ${ContratosLista.sustitucionPill(data)}
          ${ContratosLista.devolucionPill(data, data.id)}
        </div>
      </div>
      <div class="row">
        <div class="t2">${esc(data.tipo_contrato || '-')} · ${esc(data.accion || '-')}</div>
        ${ContratosLista.verMontos() ? `<div class="t1">${totalStr}</div>` : ''}
      </div>
      <div class="acciones">${accionesMovilHtml}</div>
    `;
    return card;
  },

  // ── Filtering / sorting helpers ──────────────────────────────────
  filtrarLocal(data) {
    const mostrarInactivos = document.getElementById('chkMostrarInactivos')?.checked;
    const soloDevolucion   = document.getElementById('chkSoloDevolucion')?.checked;

    return data.filter(doc => {
      if (soloDevolucion) {
        // Los anulados son justo donde más duele un equipo olvidado, así que
        // este filtro ignora "Mostrar inactivos": esconderlos vaciaría la
        // bandeja de los casos que más importan.
        const estado = DevolucionContrato.estado(doc);
        return estado === 'pendiente'
            || estado === 'cerrada_con_faltantes'
            || estado === 'sin_registro';
      }
      return mostrarInactivos ? true : !['inactivo','anulado'].includes(doc.estado);
    });
  },

  // El filtro de devolución corre sobre lo YA CARGADO, no sobre la colección:
  // "sin registro" es la AUSENCIA de devolucion_estado, y Firestore no puede
  // consultar por un campo que no existe. Decirlo evita que la bandeja se lea
  // como "estos son todos" cuando solo son los de las páginas cargadas.
  avisoAlcanceDevolucion() {
    if (!document.getElementById('chkSoloDevolucion')?.checked) return '';
    return ` · <span class="td-muted" title="El filtro se aplica a los contratos ya cargados. Usa «Cargar más» para ampliar el alcance.">de ${CS.contratos.length} cargado(s)</span>`;
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

      // Búsqueda por TOKENS primero (auditoría A8): el prefijo daba falsos
      // negativos con palabras interiores ("israelita" ∉ prefijo de "Sociedad
      // Israelita") y el fallback paginaba a ciegas hasta 8 páginas. Si hay
      // hits, el resultado es COMPLETO (sin "Cargar más"); si la query falla
      // (docs sin backfillear, sin índice), siguen el prefijo y el fallback
      // de siempre.
      const maxRows = CS.maxRows();
      let tokenHit = false;
      if (clienteSearchLower && reset) {
        try {
          const tokDocs = await ContratosService.searchByToken(clienteSearch, { creadoPorUid });
          const filtrados = tokDocs
            .filter(c => c.deleted !== true)
            .filter(matchesCliente)
            .filter(c => !estadoSel || c.estado === estadoSel);
          if (filtrados.length) {
            tokenHit = true;
            filtrados.sort((a, b) => (b.fecha_creacion?.seconds || 0) - (a.fecha_creacion?.seconds || 0));
            CS.contratos = filtrados;
            CS.lastDoc = null;
          }
        } catch (e) { console.warn('Búsqueda por tokens no disponible aún:', e?.code || e); }
      }
      if (!tokenHit) {

      // Cache-first (solo carga inicial limpia, sin filtros ni búsqueda):
      // pinta al instante lo que haya en la persistencia local de Firestore
      // y el pase de servidor de abajo repinta con la verdad. CS.contratos se
      // vacía después del paint para que el pase de servidor no duplique, y
      // CS.lastDoc jamás se toma del caché (el cursor del servidor manda).
      if (reset && !estadoSel && !clienteSearch) {
        try {
          const { docs: cacheDocs } = await ContratosService.listContratos({
            estadoSel: null, creadoPorUid, searchRange: null,
            campoOrden: CS.campoOrden, direccionAsc: CS.direccionAsc,
            lastDoc: null, limit: CS.pageLimit(), source: 'cache',
          });
          if (cacheDocs.length) {
            CS.contratos = cacheDocs;
            this.renderDesdeCache();
            CS.contratos = [];
          }
        } catch (_) { /* caché frío (primera visita): sigue el pase normal */ }
      }

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
      } // fin if (!tokenHit): con hits de tokens no se pagina ni se hace fallback

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

      // Los nombres de creador NO retienen el primer paint: las filas salen
      // con '…' en esa celda y se rellenan cuando la precarga resuelva.
      const pNombres = CS.precargarUsuarios(CS.contratos);

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
        filtrados.forEach((data, i) => {
          if (data.estado === 'pendiente_aprobacion') pendientes++;
          if (data.estado === 'aprobado') aprobados++;
          if (data.estado === 'activo')   activos++;
          if (tabla) tabla.appendChild(this.crearFila(data.id, data, i));
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
          ${this.avisoAlcanceDevolucion()}
        `;
      }

      ContratosEquipos.cargarIconos();
      this.updateBtnCargarMas(!CS.lastDoc);
      // Scoped: el barrido full-document (~40 filas × varios iconos + todo el
      // shell) era una de las fuentes del parpadeo de iconos.
      if (window.Icons) Icons.pintar([tabla, listaMovil]);
      else if (typeof lucide !== 'undefined') lucide.createIcons();
      pNombres.then(() => this.rellenarNombresCreador()).catch(() => { /* la celda queda '…' */ });
    } finally {
      CS.isLoading = false;
      this.updateBtnCargarMas(false);
    }
  },

  // Rellena la celda "creado por" cuando la precarga de nombres (que ya no
  // bloquea el primer paint) resuelve. Ignora filas de otros renders.
  rellenarNombresCreador() {
    document.querySelectorAll('[data-creador-uid]').forEach(el => {
      const uid = el.getAttribute('data-creador-uid');
      if (!uid) return;
      const n = CS.mapaUsuarios[uid];
      if (n) el.textContent = n;
    });
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
      filtrados.forEach((data, i) => {
        if (data.estado === 'pendiente_aprobacion') pendientes++;
        if (data.estado === 'aprobado') aprobados++;
        if (data.estado === 'activo')   activos++;
        tabla.appendChild(this.crearFila(data.id, data, i));
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
        ${this.avisoAlcanceDevolucion()}
      `;
    }
    // Sin esto las celdas de equipos quedaban vacías al re-render (resize y
    // ahora también el paint cache-first).
    ContratosEquipos.cargarIconos();
    this.updateBtnCargarMas(false);
    if (window.Icons) Icons.pintar([tabla, listaMovil]);
    else if (typeof lucide !== 'undefined') lucide.createIcons();
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

  // Recibe el DOC ID, no el número: el número es mutable y no fue único hasta
  // el 2026-07-28, así que un enlace por número puede abrir otro contrato.
  ver(docId) {
    // El corte (2026-09-09) decide el papel: v2 → documento.html, lo anterior
    // → imprimir-contrato.html. Misma regla que el trigger, o el archivo abre
    // un documento distinto al que se le mandó a activaciones.
    const data = CS.contratos.find((c) => c.id === docId) || {};
    window.open(DocumentoContrato.urlDocumento(docId, data), '_blank');
  },

  ordenarPor(campo) {
    if (CS.campoOrden === campo) CS.direccionAsc = !CS.direccionAsc;
    else { CS.campoOrden = campo; CS.direccionAsc = true; }
    this.cargar(true);
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
        const chkDev = document.getElementById('chkSoloDevolucion');
        if (inp)    inp.value    = '';
        if (sel)    sel.value    = '';
        if (chkPnd) chkPnd.checked = false;
        if (chkIna) chkIna.checked = false;
        if (chkDev) chkDev.checked = false;
        self.cargar(true);
      });
    }

    const chkMostrarInactivos = document.getElementById('chkMostrarInactivos');
    if (chkMostrarInactivos) {
      chkMostrarInactivos.addEventListener('change', () => self.cargar(true));
    }

    const chkSoloDevolucion = document.getElementById('chkSoloDevolucion');
    if (chkSoloDevolucion) {
      chkSoloDevolucion.addEventListener('change', () => self.cargar(true));
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
