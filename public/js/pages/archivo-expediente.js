// @ts-nocheck
/* =============================================================
   EXPEDIENTE del archivo (2026-09-09) — la fila que se abre.

   El pedido detrás de esto: hoy, para contestar "¿qué le pasó a este
   contrato?" o "¿en qué anda esta gestión?", hay que abrir tres pantallas. El
   expediente junta en un solo sitio lo que YA está escrito — no inventa dato
   nuevo, no calcula nada que no calcule alguien más:

     · la línea de tiempo (campos del contrato / bitácora de la gestión),
     · los seriales (subcolección del contrato / seriales_norm de la gestión),
     · las gestiones que tocaron el contrato (contratos_afectados).

   Todo de LECTURA. Nada de aquí escribe en Firestore.
   ============================================================= */
window.ArchivoExpediente = {
  _abiertos: new Set(),
  _cache: new Map(),

  esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  fecha(ts, { hora = false } = {}) {
    const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    if (!d || isNaN(d)) return '';
    // 'es-PA' explicito (FMT.date): sin locale la misma fecha se lee distinto
    // segun la maquina que abra el archivo.
    return hora ? `${FMT.date(d)} · ${d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit' })}`
      : FMT.date(d);
  },

  // Un hito de la línea de tiempo. `estado`: 'hecho' | 'ahora' | 'pendiente'.
  hito(estado, titulo, cuando, extra = '') {
    const color = estado === 'hecho' ? '#1FA56B' : estado === 'ahora' ? '#E0A93A' : '#C2CCD6';
    const relleno = estado === 'pendiente' ? '#fff' : color;
    return `<li style="position:relative; padding-left:20px; margin-bottom:12px;">
      <span style="position:absolute; left:0; top:5px; width:9px; height:9px; border-radius:50%; background:${relleno}; border:2px solid ${color};"></span>
      <div style="font-size:13.5px; color:var(--fg-1);"><strong style="font-weight:600;">${titulo}</strong>${extra ? ` ${extra}` : ''}</div>
      ${cuando ? `<div style="font-family:var(--font-mono,monospace); font-size:11.5px; color:var(--fg-4); margin-top:2px;">${this.esc(cuando)}</div>` : ''}
    </li>`;
  },

  cuadro(titulo, cuerpo) {
    return `<div style="min-width:0;">
      <div style="font-family:var(--font-mono,monospace); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--fg-3); margin-bottom:10px;">${titulo}</div>
      ${cuerpo}
    </div>`;
  },

  vacio(texto) {
    return `<p style="font-size:13px; color:var(--fg-3); margin:0;">${this.esc(texto)}</p>`;
  },

  // ── Contrato ───────────────────────────────────────────────────────
  async contenidoContrato(id, data) {
    const E = this.esc.bind(this);
    const hitos = [];

    hitos.push(this.hito('hecho', 'Contrato creado', this.fecha(data.fecha_creacion, { hora: true }),
      data.creado_por_uid ? `<span style="color:var(--fg-3);">por ${E(CS.mapaUsuarios[data.creado_por_uid] || '—')}</span>` : ''));

    if (['aprobado', 'activo'].includes(data.estado) || data.fecha_aprobacion) {
      hitos.push(this.hito('hecho', 'Aprobado', this.fecha(data.fecha_aprobacion, { hora: true }),
        '<span style="color:var(--fg-3);">correo a activaciones con el Anexo A</span>'));
    } else if (data.estado === 'pendiente_aprobacion') {
      hitos.push(this.hito('ahora', 'Pendiente de aprobación', '',
        '<span style="color:var(--fg-3);">se aprueba en el Centro de gestión</span>'));
    }

    if (data.firmado_url || data.firmado_tipo) {
      const comoFirmo = data.firmado_tipo === 'digital' ? 'Firmado en tablet'
        : data.firmado_tipo === 'no_recibido' ? 'Firmado en papel (sin copia digital)'
          : 'Firmado';
      hitos.push(this.hito('hecho', comoFirmo, this.fecha(data.firmado_at || data.fecha_firma, { hora: true })));
    } else if (data.firma_solicitud_id) {
      hitos.push(this.hito('ahora', 'Enlace de firma enviado', '',
        '<span style="color:var(--fg-3);">esperando al cliente</span>'));
    }

    if (data.entrega_confirmada) {
      hitos.push(this.hito('hecho', 'Entrega confirmada', this.fecha(data.entrega_confirmada_at)));
    }

    const dev = window.DevolucionContrato ? DevolucionContrato.estado(data) : null;
    if (dev === 'pendiente') {
      hitos.push(this.hito('ahora', 'Devolución abierta', '',
        `<span style="color:var(--fg-3);">faltan ${DevolucionContrato.pendientes(data)} de ${DevolucionContrato.esperados(data)}</span>`));
    } else if (dev === 'completa') {
      hitos.push(this.hito('hecho', 'Devolución cerrada', ''));
    } else if (dev === 'cerrada_con_faltantes') {
      hitos.push(this.hito('hecho', 'Devolución cerrada con faltantes', '',
        `<span style="color:var(--bad);">${DevolucionContrato.pendientes(data)} sin devolver</span>`));
    }

    if (data.terminacion_total) {
      hitos.push(this.hito('hecho', 'Terminado', this.fecha(data.terminacion_fin),
        '<span style="color:var(--fg-3);">baja total del cliente</span>'));
    }
    if (data.estado === 'anulado') {
      hitos.push(this.hito('hecho', 'Anulado', this.fecha(data.anulado_at),
        data.anulado_motivo ? `<span style="color:var(--fg-3);">${E(data.anulado_motivo)}</span>` : ''));
    }

    // Lo que vino después: la renovación que lo reemplazó.
    for (const rid of (data.renovado_por_ids || [])) {
      hitos.push(this.hito('hecho', 'Renovado', '',
        `<a href="?buscar=${encodeURIComponent(rid)}" style="font-weight:600;">${E(rid)}</a>`));
    }

    // Las dos consultas del expediente, en paralelo.
    const [seriales, gestiones] = await Promise.all([
      ContratosService.getSerialesManual(id).catch(() => []),
      firebase.firestore().collection('gestiones')
        .where('contratos_afectados', 'array-contains', id).limit(25).get()
        .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
        .catch(() => []),
    ]);

    gestiones.sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
    for (const g of gestiones) {
      const abierta = GestionesService.ABIERTAS.includes(g.estado);
      hitos.push(this.hito(abierta ? 'ahora' : 'hecho',
        `${GestionesService.tipoLabel(g.tipo)} <a href="?tab=gestiones&buscar=${encodeURIComponent(g.id)}" style="font-weight:600;">${E(g.id)}</a>`,
        `${this.fecha(g.fecha_solicitud)} · ${GestionesService.estadoLabel(g.estado)}`));
    }

    const filasSeriales = seriales.length
      ? `<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.6px;">
          <thead><tr>
            <th style="text-align:left; font:600 10px/1.4 var(--font-mono,monospace); letter-spacing:.07em; text-transform:uppercase; color:var(--fg-3); padding:0 8px 7px 0; border-bottom:1px solid var(--border-default);">Serial</th>
            <th style="text-align:left; font:600 10px/1.4 var(--font-mono,monospace); letter-spacing:.07em; text-transform:uppercase; color:var(--fg-3); padding:0 8px 7px 0; border-bottom:1px solid var(--border-default);">Modelo</th>
          </tr></thead>
          <tbody>${seriales.slice(0, 40).map((s) => `<tr>
            <td style="padding:7px 8px 7px 0; border-bottom:1px solid var(--border-subtle); font-family:var(--font-mono,monospace); color:var(--fg-1);">${E(s.serial)}</td>
            <td style="padding:7px 8px 7px 0; border-bottom:1px solid var(--border-subtle); color:var(--fg-2);">${E(s.modelo || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${seriales.length > 40 ? `<p style="font-size:12px; color:var(--fg-3); margin:10px 0 0;">y ${seriales.length - 40} más</p>` : ''}`
      : this.vacio(data.seriales_estado === 'legacy'
        ? 'Contrato histórico: sus seriales nunca se registraron en la plataforma.'
        : 'Todavía no hay seriales registrados en este contrato.');

    return `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:26px; padding:20px 22px;">
      ${this.cuadro('Expediente', `<ul style="list-style:none; margin:0; padding:0 0 0 4px; border-left:1px solid var(--border-default); padding-left:14px;">${hitos.join('')}</ul>`)}
      ${this.cuadro(`Anexo A · ${seriales.length} serial(es)`, filasSeriales)}
    </div>`;
  },

  // ── Gestión ────────────────────────────────────────────────────────
  async contenidoGestion(id, g) {
    const E = this.esc.bind(this);
    const eventos = await GestionesService.eventos(id).catch(() => []);

    const abierta = GestionesService.ABIERTAS.includes(g.estado);
    const hitos = eventos.map((ev, i) => this.hito(
      (abierta && i === eventos.length - 1) ? 'ahora' : 'hecho',
      E(ev.detalle || ev.accion || '—'),
      [this.fecha(ev.at, { hora: true }), ev.por_email].filter(Boolean).join(' · ')));

    if (!hitos.length) {
      hitos.push(this.hito('hecho', 'Gestión creada', this.fecha(g.fecha_solicitud, { hora: true }),
        g.responsable_email ? `<span style="color:var(--fg-3);">${E(g.responsable_email)}</span>` : ''));
    }
    if (abierta) {
      hitos.push(this.hito('ahora', GestionesService.estadoLabel(g.estado), '',
        '<span style="color:var(--fg-3);">el expediente sigue abierto</span>'));
    }

    const seriales = g.seriales_norm || [];
    const cuerpoSeriales = seriales.length
      ? `<div style="display:flex; flex-wrap:wrap; gap:6px;">${seriales.map((s) =>
        `<a href="../equipos/index.html?buscar=${encodeURIComponent(s)}" style="font-family:var(--font-mono,monospace); font-size:12.2px; padding:4px 8px; border-radius:3px; border:1px solid var(--border-default); background:var(--surface-card); color:var(--fg-1); text-decoration:none;">${E(s)}</a>`).join('')}</div>`
      : this.vacio(g.seriales_norm
        ? 'Esta gestión no toca ningún serial (p.ej. una renovación sin equipo).'
        : 'Sin índice de seriales todavía — corre scripts/backfill-gestiones-archivo.js.');

    const contratos = (g.contratos_afectados || []).filter(Boolean);
    // "No afecta ningún contrato" a secas se lee como "es inofensiva", y en un
    // reemplazo pendiente de bodega eso es engañoso: lo que pasa es que el
    // serial todavía no está amarrado a ningún contrato. Se dice cuál de las
    // dos cosas es.
    const cuerpoContratos = contratos.length
      ? `<div style="display:flex; flex-direction:column; gap:6px;">${contratos.map((c) =>
        `<a href="documento.html?id=${encodeURIComponent(c)}" style="font-family:var(--font-mono,monospace); font-size:12.4px;">${E(c)}</a>`).join('')}</div>`
      : this.vacio((g.items || []).length
        ? 'Ningún serial de esta gestión está amarrado a un contrato.'
        : 'No afecta ningún contrato.');

    const notas = g.notas
      ? `<div style="margin-top:16px; font-size:13px; color:var(--fg-2); border-left:2px solid var(--border-default); padding-left:12px;">${E(g.notas)}</div>`
      : '';

    return `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:26px; padding:20px 22px;">
      ${this.cuadro('Bitácora', `<ul style="list-style:none; margin:0; padding:0 0 0 4px; border-left:1px solid var(--border-default); padding-left:14px;">${hitos.join('')}</ul>${notas}`)}
      ${this.cuadro(`Seriales · ${seriales.length}`, `${cuerpoSeriales}
        <div style="margin-top:18px;">${this.cuadro('Contratos afectados', cuerpoContratos)}</div>`)}
    </div>`;
  },

  // ── Abrir / cerrar ─────────────────────────────────────────────────
  // La fila del expediente es una <tr> hermana que se inserta bajo la fila.
  // Se carga la primera vez y queda cacheada: reabrir no vuelve a leer.
  async alternar(clase, id, btn) {
    const fila = document.getElementById(`exp-${id}`);
    if (!fila) return;
    const abierto = !fila.hidden;
    fila.hidden = abierto;
    btn.setAttribute('aria-expanded', abierto ? 'false' : 'true');
    btn.textContent = abierto ? '+' : '−';
    if (abierto) { this._abiertos.delete(id); return; }
    this._abiertos.add(id);

    const celda = fila.firstElementChild;
    if (this._cache.has(id)) { celda.innerHTML = this._cache.get(id); Icons.pintar?.(celda); return; }

    celda.innerHTML = `<div style="padding:18px 22px; font-size:13px; color:var(--fg-3);">Cargando el expediente…</div>`;
    try {
      const data = clase === 'contrato'
        ? CS.contratos.find((c) => c.id === id)
        : ArchivoGestiones.filas.find((g) => g.id === id);
      const html = clase === 'contrato'
        ? await this.contenidoContrato(id, data || {})
        : await this.contenidoGestion(id, data || {});
      this._cache.set(id, html);
      celda.innerHTML = html;
      if (window.Icons) Icons.pintar(celda);
    } catch (e) {
      console.error(e);
      celda.innerHTML = `<div style="padding:18px 22px; font-size:13px; color:var(--bad);">No se pudo cargar el expediente: ${this.esc(e?.message || e)}</div>`;
    }
  },

  // Botón + y la fila hermana vacía que lo acompaña.
  botonHtml(clase, id) {
    return `<button class="btn btn-ghost btn-sm" style="width:24px;height:24px;padding:0;justify-content:center;font-family:var(--font-mono,monospace);"
      onclick="ArchivoExpediente.alternar('${clase}','${id}',this)" aria-expanded="false" aria-controls="exp-${id}"
      title="Ver el expediente">+</button>`;
  },

  filaHtml(id, columnas) {
    return `<tr id="exp-${id}" hidden><td colspan="${columnas}" style="background:var(--bg-page); padding:0; border-bottom:1px solid var(--border-default);"></td></tr>`;
  },

  // Al recargar la lista, las filas se rehacen: olvida lo abierto.
  reset() { this._abiertos.clear(); },
};
