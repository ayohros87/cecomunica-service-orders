// @ts-nocheck
/* =============================================================
   Pestaña GESTIONES del archivo (2026-09-09).

   El hueco que llena: hasta hoy `GestionesService.listar()` solo devolvía las
   abiertas y `listarPorCliente()` exigía saber el cliente de antemano. Nadie
   podía contestar "¿en qué gestión salió el serial 8J4K02245?" ni "dame todas
   las bajas de agosto" sin abrir cliente por cliente en el Centro.

   Solo lectura, igual que la pestaña de contratos: la fila abre el expediente
   (ArchivoExpediente) y salta a la ficha; el trabajo se hace en el Centro.
   ============================================================= */
window.ArchivoGestiones = {
  filas: [],
  _cargando: false,

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  tipoActivo() {
    return document.querySelector('#filtroTipoGestionChips .filter-chip.active')?.dataset.tipo || '';
  },

  // Chip de estado. Cerrada = verde, anulada = roja, todo lo abierto = ámbar:
  // en un archivo lo que importa a simple vista es si el expediente todavía
  // está vivo, no en qué peldaño exacto va.
  estadoChip(g) {
    const e = g.estado;
    const css = e === 'cerrada' ? 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;'
      : e === 'anulada' ? 'background:#FEF2F2;color:#991B1B;border:1px solid #FECACA;'
        : 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
    return `<span class="chip-estado" style="${css}">${this.esc(GestionesService.estadoLabel(e))}</span>`;
  },

  // FMT.date fija 'es-PA' (DD/MM/YYYY). Sin locale, el mismo archivo salia
  // 9/9/2026 en una maquina y 09/09/2026 en otra — y en el CSV, que es lo que
  // se manda por correo, 3/12 se lee como marzo o como diciembre segun quien
  // abra.
  fecha(ts) { return ts?.toDate ? FMT.date(ts) : '—'; },

  // ¿Está el documento del cliente en el expediente? (Zuleika, 2026-10-08:
  // "si el documento firmado ya esté subido" — hasta hoy había que abrir
  // cliente por cliente en el Centro para saberlo.)
  //
  // Cada tipo lleva un papel distinto, o ninguno:
  //   aumento  → el anexo firmado (enlace digital o PDF en papel). La
  //              actualización de seriales se aplica SIN firma por diseño.
  //   baja     → la carta de solicitud del cliente.
  //   reemplazo, demo, cambio de serial → no llevan firma del cliente: no
  //              pactan nada nuevo, sustituyen o corrigen bajo el contrato ya
  //              firmado. Se dice "No lleva", no "Falta".
  //
  // `falta` = el documento se espera y no está: es lo que filtra "Falta
  // documento". Una gestión anulada no espera nada.
  documento(g) {
    const ok = (texto, path = null, title = '') => ({ nivel: 'ok', texto, path, title, falta: false });
    const nulo = (texto, title = '') => ({ nivel: 'nulo', texto, path: null, title, falta: false });
    const falta = (texto, title = '') => ({ nivel: 'falta', texto, path: null, title, falta: true });

    if (g.tipo === 'aumento') {
      const a = g.aumento || {};
      // Lo que ya está en el expediente manda, aunque la gestión se haya anulado después.
      if (g.anexo_firma_digital) {
        const quien = g.anexo_firma_digital.firmante_nombre || '';
        return ok('Firmado por enlace', null, `Firma digital${quien ? ` de ${quien}` : ''}. El trazo se ve en la ficha del cliente (Acciones → Ver la firma del cliente).`);
      }
      if (g.anexo_firmado_path) return ok('Firmado en papel', g.anexo_firmado_path, `Anexo firmado subido${g.anexo_firmado_por ? ` por ${g.anexo_firmado_por}` : ''}.`);
      if (g.estado === 'anulada') return nulo('—', 'Gestión anulada');
      if (g.sin_firma || a.es_regularizacion) {
        return nulo('No lleva', 'Actualización de seriales: se aplica sin firma del cliente, autorizada por administración.');
      }
      if (g.firma_solicitud_estado === 'validacion') return falta('Firmó · falta validar', 'El cliente firmó por enlace y falta validar al firmante en la ficha.');
      if (g.estado === 'pendiente_aprobacion') return nulo('Por aprobar', 'El anexo se manda a firmar cuando administración lo apruebe.');
      if (g.firma_solicitud_estado === 'pendiente') {
        return falta(GestionesService.dormida(g) ? 'Enlace dormido' : 'Enlace enviado, sin firmar', 'El cliente tiene el enlace de firma y todavía no firma.');
      }
      return falta('Falta el anexo firmado', 'Ni firma digital ni anexo en papel subido.');
    }

    if (g.tipo === 'baja') {
      if (g.carta_path) return ok('Carta cargada', g.carta_path, `Carta de solicitud del cliente${g.carta_por ? `, subida por ${g.carta_por}` : ''}.`);
      if (g.estado === 'anulada') return nulo('—', 'Gestión anulada');
      return falta('Falta la carta', 'La carta de solicitud del cliente no está subida.');
    }

    return nulo('No lleva', 'Este tipo de gestión no lleva documento firmado por el cliente.');
  },

  documentoHtml(g) {
    const d = this.documento(g);
    const E = this.esc.bind(this);
    if (d.nivel === 'nulo') return `<span class="td-muted" title="${E(d.title)}">${E(d.texto)}</span>`;
    const css = d.nivel === 'ok'
      ? 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;'
      : 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;';
    const chip = `<span class="chip-estado" style="${css}" title="${E(d.title)}">${E(d.texto)}</span>`;
    const ver = d.path
      ? ` <button type="button" class="btn btn-ghost btn-sm" style="padding:2px 6px;" title="Abrir el documento" aria-label="Abrir el documento"
           data-path="${E(d.path)}" onclick="ArchivoGestiones.verDocumento(this.dataset.path)"><i data-lucide="eye" style="width:13px;height:13px;"></i></button>`
      : '';
    return chip + ver;
  },

  async verDocumento(path) {
    try {
      window.open(await GestionesService.urlAnexo(path), '_blank', 'noopener');
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo abrir el documento.', 'bad');
    }
  },

  soloFaltantes() { return !!document.getElementById('chkGestionesSinDocumento')?.checked; },

  fila(g) {
    const E = this.esc.bind(this);
    const contratos = (g.contratos_afectados || []).filter(Boolean);
    const contratoCell = contratos.length
      ? `<a href="documento.html?id=${encodeURIComponent(contratos[0])}" style="font-family:var(--font-mono,monospace); font-size:12.5px;">${E(contratos[0])}</a>${contratos.length > 1 ? ` <span class="td-muted">+${contratos.length - 1}</span>` : ''}`
      : '<span class="td-muted">—</span>';
    const urlFicha = `../clientes/centro.html?id=${encodeURIComponent(g.cliente_id || '')}`;
    const nSeriales = (g.seriales_norm || []).length;

    return `<tr data-gestion-id="${E(g.id)}">
      <td>${ArchivoExpediente.botonHtml('gestion', g.id)}</td>
      <td class="td-primary"><span class="contrato-id">${E(g.id)}</span></td>
      <td><strong style="color:var(--fg-1); font-weight:600;">${E(g.cliente_nombre || '—')}</strong></td>
      <td>${E(GestionesService.tipoLabel(g.tipo))}</td>
      <td style="text-align:center;">${nSeriales || '<span class="td-muted">—</span>'}</td>
      <td>${this.estadoChip(g)}</td>
      <td style="white-space:nowrap;">${this.documentoHtml(g)}</td>
      <td>${contratoCell}</td>
      <td class="td-muted">${E(g.responsable_email || '—')}</td>
      <td class="td-muted">${this.fecha(g.fecha_solicitud)}</td>
      <td class="acciones">
        <a class="btn btn-sm" href="${urlFicha}" target="_blank" rel="noopener" title="Abrir la ficha del cliente en el Centro"><i data-lucide="user" style="width:14px;height:14px;"></i> Ficha</a>
      </td>
    </tr>${ArchivoExpediente.filaHtml(g.id, 11)}`;
  },

  async cargar() {
    if (this._cargando) return;
    this._cargando = true;
    const tbody = document.getElementById('tablaGestiones');
    if (tbody) tbody.innerHTML = `<tr><td colspan="11" style="padding:22px; color:var(--fg-3); font-size:13px;">Buscando en el archivo…</td></tr>`;

    const desdeStr = document.getElementById('filtroDesde')?.value;
    const hastaStr = document.getElementById('filtroHasta')?.value;

    try {
      this.filas = await GestionesService.buscar({
        texto: document.getElementById('filtroCliente')?.value || '',
        tipo: this.tipoActivo() || null,
        soloAbiertas: !!document.getElementById('chkGestionesAbiertas')?.checked,
        // El <input type="date"> da 'YYYY-MM-DD', que `new Date()` interpreta
        // como UTC — en Panamá eso corre el día hacia atrás. Se arma local.
        desde: desdeStr ? new Date(`${desdeStr}T00:00:00`) : null,
        hasta: hastaStr ? new Date(`${hastaStr}T00:00:00`) : null,
      });
      this.pintar();
    } catch (e) {
      console.error(e);
      // El caso real: falta el índice compuesto. El mensaje de Firestore trae
      // el enlace para crearlo, así que se muestra en vez de tragárselo.
      const falta = /index/i.test(e?.message || '');
      tbody.innerHTML = `<tr><td colspan="11" style="padding:22px; color:var(--bad); font-size:13px;">
        No se pudo buscar: ${this.esc(e?.message || e)}
        ${falta ? '<br><span style="color:var(--fg-3);">Falta desplegar los índices: <code>firebase deploy --only firestore:indexes</code></span>' : ''}
      </td></tr>`;
    } finally {
      this._cargando = false;
    }
  },

  // "Falta documento" filtra lo ya cargado: no es un campo consultable (sale
  // de campos distintos según el tipo) y el archivo entero cabe en la página.
  visibles() {
    return this.soloFaltantes() ? this.filas.filter((g) => this.documento(g).falta) : this.filas;
  },

  pintar() {
    const tbody = document.getElementById('tablaGestiones');
    const resumen = document.getElementById('resumenGestiones');
    if (!tbody) return;
    ArchivoExpediente.reset();
    const filas = this.visibles();
    if (!filas.length) {
      tbody.innerHTML = `<tr><td colspan="11" style="padding:22px; color:var(--fg-3); font-size:13px;">${this.soloFaltantes() && this.filas.length
        ? 'Todas las gestiones de esta búsqueda tienen su documento, o no lo llevan.'
        : 'Ninguna gestión coincide. Prueba con el número (GR20260909-02), un serial, o quita el rango de fechas.'}</td></tr>`;
    } else {
      tbody.innerHTML = filas.map((g) => this.fila(g)).join('');
    }
    if (resumen) {
      const abiertas = filas.filter((g) => GestionesService.ABIERTAS.includes(g.estado)).length;
      const faltan = this.filas.filter((g) => this.documento(g).falta).length;
      resumen.innerHTML = `<strong>${filas.length}</strong> gestión(es)${abiertas ? ` · <span class="badge pendiente">${abiertas} abierta(s)</span>` : ''}${faltan && !this.soloFaltantes() ? ` · ${faltan} sin documento` : ''}`;
    }
    if (window.Icons) Icons.pintar(tbody);
  },

  // CSV de lo que está en pantalla, con los filtros puestos. Un archivo sin
  // exportar obliga a copiar a mano.
  exportarCsv() {
    const visibles = this.visibles();
    if (!visibles.length) { Toast.show('No hay nada que exportar.', 'warn'); return; }
    const cab = ['Gestion', 'Tipo', 'Cliente', 'Estado', 'Documento', 'Seriales', 'Contratos', 'Responsable', 'Solicitud'];
    const filas = visibles.map((g) => [
      g.id,
      GestionesService.tipoLabel(g.tipo),
      g.cliente_nombre || '',
      GestionesService.estadoLabel(g.estado),
      this.documento(g).texto,
      (g.seriales_norm || []).join(' '),
      (g.contratos_afectados || []).join(' '),
      g.responsable_email || '',
      this.fecha(g.fecha_solicitud),
    ]);
    Archivo.bajarCsv('gestiones', cab, filas);
  },

  init() {
    document.querySelectorAll('#filtroTipoGestionChips .filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#filtroTipoGestionChips .filter-chip')
          .forEach((c) => c.classList.toggle('active', c === chip));
        this.cargar();
      });
    });
    document.getElementById('chkGestionesAbiertas')?.addEventListener('change', () => this.cargar());
    document.getElementById('chkGestionesSinDocumento')?.addEventListener('change', () => this.pintar());
  },
};
