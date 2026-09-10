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
      <td>${contratoCell}</td>
      <td class="td-muted">${E(g.responsable_email || '—')}</td>
      <td class="td-muted">${this.fecha(g.fecha_solicitud)}</td>
      <td class="acciones">
        <a class="btn btn-sm" href="${urlFicha}" target="_blank" rel="noopener" title="Abrir la ficha del cliente en el Centro"><i data-lucide="user" style="width:14px;height:14px;"></i> Ficha</a>
      </td>
    </tr>${ArchivoExpediente.filaHtml(g.id, 10)}`;
  },

  async cargar() {
    if (this._cargando) return;
    this._cargando = true;
    const tbody = document.getElementById('tablaGestiones');
    const resumen = document.getElementById('resumenGestiones');
    if (tbody) tbody.innerHTML = `<tr><td colspan="10" style="padding:22px; color:var(--fg-3); font-size:13px;">Buscando en el archivo…</td></tr>`;

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
      ArchivoExpediente.reset();

      if (!this.filas.length) {
        tbody.innerHTML = `<tr><td colspan="10" style="padding:22px; color:var(--fg-3); font-size:13px;">Ninguna gestión coincide. Prueba con el número (GR20260909-02), un serial, o quita el rango de fechas.</td></tr>`;
      } else {
        tbody.innerHTML = this.filas.map((g) => this.fila(g)).join('');
      }
      if (resumen) {
        const abiertas = this.filas.filter((g) => GestionesService.ABIERTAS.includes(g.estado)).length;
        resumen.innerHTML = `<strong>${this.filas.length}</strong> gestión(es)${abiertas ? ` · <span class="badge pendiente">${abiertas} abierta(s)</span>` : ''}`;
      }
      if (window.Icons) Icons.pintar(tbody);
    } catch (e) {
      console.error(e);
      // El caso real: falta el índice compuesto. El mensaje de Firestore trae
      // el enlace para crearlo, así que se muestra en vez de tragárselo.
      const falta = /index/i.test(e?.message || '');
      tbody.innerHTML = `<tr><td colspan="10" style="padding:22px; color:var(--bad); font-size:13px;">
        No se pudo buscar: ${this.esc(e?.message || e)}
        ${falta ? '<br><span style="color:var(--fg-3);">Falta desplegar los índices: <code>firebase deploy --only firestore:indexes</code></span>' : ''}
      </td></tr>`;
    } finally {
      this._cargando = false;
    }
  },

  // CSV de lo que está en pantalla, con los filtros puestos. Un archivo sin
  // exportar obliga a copiar a mano.
  exportarCsv() {
    if (!this.filas.length) { Toast.show('No hay nada que exportar.', 'warn'); return; }
    const cab = ['Gestion', 'Tipo', 'Cliente', 'Estado', 'Seriales', 'Contratos', 'Responsable', 'Solicitud'];
    const filas = this.filas.map((g) => [
      g.id,
      GestionesService.tipoLabel(g.tipo),
      g.cliente_nombre || '',
      GestionesService.estadoLabel(g.estado),
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
  },
};
