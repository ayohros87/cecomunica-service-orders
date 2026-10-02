// @ts-nocheck
// Centro de gestión de clientes — Regularización de la cuenta (plan 2026-09-08).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Regularización de la cuenta (plan 2026-09-08) ═════════
   * La deuda D1–D7 la CALCULA el job (clientes.regularizacion); aquí solo se
   * lee y se explica con la misma regla (Regularizacion, módulo compartido).
   * Principio: nunca trabar, siempre estampar, cada gestión puntual paga. */
  _reg() { return this.cliente?.regularizacion || null; },
  // Lo que se pega a cada gestión/contrato creado desde aquí ({} si al día).
  _estampaReg() {
    const st = (typeof Regularizacion !== 'undefined') ? Regularizacion.estampa(this._reg()) : null;
    return st ? { cuenta_regularizacion: st } : {};
  },
  // _pintarChipReg vive más abajo (chips de la cabecera): había dos y el
  // objeto literal se quedaba con el segundo (auditoría UX 2026-09-28).
  // Panel "Qué falta": una fila por componente con la acción que lo cierra.
  verRegularizacion() {
    const r = this._reg();
    if (!r || !(r.puntos > 0)) { Toast.show('La cuenta está al día', 'ok'); return; }
    const filas = Regularizacion.desglose(r);
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const puede = this.puedeCrearGestion();
    const regularizarBtn = !puede ? '' : tram
      ? `<button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal(); Centro.abrirGestion('ct-${this.esc(tram.id)}')">Ver la renovación en trámite</button>`
      : `<button class="btn btn-primary cg-act" onclick="Centro._cerrarModal(); Centro.wizContrato({renovarCuenta:true})">${est.tipo === 'sin_contrato' || est.tipo === 'nueva' ? 'Regularizar: contrato nuevo' : 'Regularizar con contrato nuevo'}</button>`;
    const accion = (f) => {
      // D1: la renovación consolidadora los cubre; con un contrato vigente
      // también sirve el anexo de regularización (sin bodega, sin OS).
      if (f.codigo === 'd1') return regularizarBtn + (puede && !tram && est.renovables.length
        ? ` <button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal(); Centro.wizRegularizarCuenta()">Actualizar seriales del cliente</button>` : '');
      if (f.codigo === 'd2') return f.ids.map(id => {
        const c = this.contratos.find(x => (x.contrato_id || x.id) === id);
        return c && this.puedeAsignar()
          ? `<a class="btn btn-ghost cg-act" href="../almacen/index.html?tab=asignar&contrato=${encodeURIComponent(c.id)}">Declarar seriales · <span class="cg-mono">${this.esc(id)}</span></a>`
          : `<span class="cg-mono" style="font-size:12px;">${this.esc(id)}</span>`;
      }).join(' ') + (this.puedeAsignar() ? '' : `<div style="font-size:12px; color:var(--fg-3); margin-top:4px;">Los seriales los declara bodega en Almacén · Asignar; si tú los tienes, mándaselos.</div>`);
      if (f.codigo === 'd5') return f.ids.map(id => {
        const c = this.contratos.find(x => (x.contrato_id || x.id) === id);
        return c ? `<button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal(); Centro.abrirGestion('ct-${this.esc(c.id)}')">Confirmar serial saliente · <span class="cg-mono">${this.esc(id)}</span></button>` : this.esc(id);
      }).join(' ');
      if (f.codigo === 'd7') return `<a class="btn btn-ghost cg-act" href="../almacen/index.html?tab=serial&estado=por_clasificar">Ver por clasificar</a>`;
      if (f.codigo === 'd3' || f.codigo === 'd4') return `<span style="font-size:12.5px; color:var(--fg-3);">Se cierra al regularizar la cuenta.</span>`;
      if (f.codigo === 'd6') return `<span style="font-size:12.5px; color:var(--fg-3);">Agrégalos por anexo o libéralos desde el expediente del contrato.</span>`;
      return '';
    };
    const ids = (f) => (f.codigo === 'd1' || f.codigo === 'd7') && f.ids.length
      ? `<div class="cg-mono" style="font-size:11.5px; color:var(--fg-4); margin-top:4px; word-break:break-word;">${f.ids.slice(0, 40).map(s => this.esc(s)).join(', ')}${f.ids.length > 40 ? ` … +${f.ids.length - 40}` : ''}</div>` : '';
    const puntuales = Number(r.gestiones_puntuales || 0);
    this._abrirModalA({
      titulo: `Qué falta para regularizar — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:72ch;">
          <b>${this.esc(Regularizacion.NIVEL_LABEL[r.nivel] || r.nivel)} · ${r.puntos} punto${r.puntos === 1 ? '' : 's'}</b>
          ${r.etiqueta === 'migracion' ? ' · deuda de migración (contratos anteriores al sistema)' : ''}.
          Ninguna gestión se frena por esto: cada gestión que declare seriales baja la deuda.
          <b>Actualizar seriales del cliente</b> (también en el menú) amarra al contrato lo que el cliente ya
          tiene: sin renovar, sin bodega y <b>sin mandarle nada a firmar</b>. Si hay que firmar algo, el camino
          es <b>Regularizar con contrato nuevo</b>, que abre la renovación con el plan por serial precargado.
          ${puntuales ? `<br>Gestiones puntuales hechas sobre esta deuda: <b>${puntuales}</b>${r.excede_margen ? ' — <span style="color:var(--cg-bad-deep, #991B1B);">excede el margen sin regularizar</span>' : ''}.` : ''}
        </p>
        <div class="cg-twrap"><table class="cg-table">
          <thead><tr><th>Qué falta</th><th>Cómo se cierra</th></tr></thead>
          <tbody>${filas.map(f => `<tr>
            <td style="white-space:normal;"><b>${f.n}</b> ${this.esc(f.label)}${ids(f)}</td>
            <td style="white-space:normal;">${accion(f)}</td></tr>`).join('')}</tbody>
        </table></div>`,
      footer: `<span class="sep"></span><button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>${r.d1 > 0 ? '' : regularizarBtn}`,
      banda: false,
    });
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // ── Historial de cambios de la ficha (2026-09-02) ──────────────────────
  // Lo escribe el trigger onClienteHistorial (server-side, inmutable por
  // rules): captura TODO escritor — grid, formulario, fusiones, scripts.
  // Se lee BAJO DEMANDA (botón) para no sumar lecturas a cada apertura.
  HIST_LABELS: {
    nombre: 'Nombre', ruc: 'RUC', ruc_tipo: 'Tipo de contribuyente', dv: 'DV',
    representante: 'Representante legal', representante_cedula: 'Documento del representante',
    representante_doc_tipo: 'Tipo de documento',
    representante_email: 'Correo del representante',
    telefono: 'Teléfono', email: 'Correo', email_acuses: 'Correo de acuses',
    direccion: 'Dirección', direccion_facturacion: 'Dirección de facturación',
    itbms_exento: 'ITBMS exento', itbms_motivo_exencion: 'Motivo de exención',
    tags: 'Etiquetas', vendedor_asignado: 'Vendedor (uid)', vendedor_email: 'Vendedor',
    activo: 'Activo', deleted: 'Eliminado', ip: 'IP',
    qbo_customer_id: 'QuickBooks (id)', qbo_customer_name: 'QuickBooks (cliente)',
  },
  _histVal(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (v === true) return 'Sí';
    if (v === false) return 'No';
    if (Array.isArray(v)) return v.join(', ') || '—';
    return String(v);
  },
  _histCuando(fv) {
    return this._fmtFechaHora(fv);
  },
  async verHistorial() {
    if (!this.cliente) return;
    this._abrirModalA({
      titulo: `Historial de la ficha — ${this.esc(this.cliente.nombre || '')}`,
      cuerpo: '<div class="cg-vacio">Cargando…</div>',
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>`,
    });
    let filas = [];
    try {
      const snap = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(50).get();
      filas = snap.docs.map(d => d.data());
    } catch (e) { console.warn('[centro] historial no disponible:', e?.message || e); }
    const bd = document.querySelector('#cgModal .modal-body');
    if (!bd) return;
    if (!filas.length) {
      bd.innerHTML = `<div class="cg-vacio">Sin cambios registrados. El historial arrancó el
        2&nbsp;sep&nbsp;2026 — los cambios anteriores a esa fecha no quedaron guardados.</div>`;
      return;
    }
    bd.innerHTML = filas.map(h => {
      const quien = this.esc(h.por_email || h.por_uid || 'sistema / script');
      const cuando = this.esc(this._histCuando(h.at));
      let cuerpo = '';
      if (h.tipo === 'alta') {
        cuerpo = `<div style="font-size:13px;">Alta del cliente${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
      } else if (h.tipo === 'borrado_fisico') {
        cuerpo = `<div style="font-size:13px; color:#A03030;">Borrado físico del documento${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
      } else {
        cuerpo = `<ul style="margin:4px 0 0; padding-left:18px; font-size:13px;">` +
          Object.entries(h.cambios || {}).map(([campo, c]) => `
            <li style="margin:2px 0;"><b>${this.esc(this.HIST_LABELS[campo] || campo)}</b>:
              <span style="color:#A03030; text-decoration:line-through;">${this.esc(this._histVal(c?.antes))}</span>
              <span style="color:var(--fg-4);">→</span>
              <span style="color:#17714B; font-weight:600;">${this.esc(this._histVal(c?.despues))}</span></li>`).join('') +
          `</ul>`;
      }
      return `<div style="border-bottom:1px solid var(--border-subtle); padding:10px 2px;">
        <div style="font-size:12px; color:var(--fg-3);">${cuando} · ${quien}</div>
        ${cuerpo}
      </div>`;
    }).join('');
  },

  _mapContratos(snap) {
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(x => !x.deleted)
      .sort((a, b) => (b.fecha_creacion?.toMillis?.() || 0) - (a.fecha_creacion?.toMillis?.() || 0));
  },

  // ── Revalidación contra el servidor ──
  // firebase-init activa enablePersistence({synchronizeTabs:true}) y en ese
  // modo solo la pestaña primaria habla con el servidor. {source:'server'}
  // espera a que esta pestaña tome el liderazgo (la primaria congelada pierde
  // el lease en segundos) y trae lo fresco. Las gestiones no se releen aquí:
  // su onSnapshot ya repinta con la emisión del servidor cuando llega.
  async _revalidarFicha(clienteId) {
    try {
      const db = firebase.firestore();
      const [cliSnap, conSnap, equipos] = await Promise.all([
        db.collection('clientes').doc(clienteId).get({ source: 'server' }),
        db.collection('contratos').where('cliente_id', '==', clienteId).get({ source: 'server' }),
        EquiposPoolService.listarPorCliente(clienteId, { fresh: true }),
      ]);
      if (!this.cliente || this.cliente.id !== clienteId) return; // ya navegó a otra vista
      if (cliSnap.exists) {
        const c = { id: cliSnap.id, ...cliSnap.data() };
        // El candado de cartera se re-aplica sobre el dato real del servidor.
        if (this.esVendedor() && c.vendedor_asignado !== this.uid) {
          Toast.show('Este cliente no está en tu cartera', 'bad');
          this.volver({ push: true });
          return;
        }
        this.cliente = c;
        this._pintarEncabezado(c);
      }
      this.contratos = this._mapContratos(conSnap);
      this.equipos = Array.isArray(equipos) ? equipos : [];
      this.pintarKpis();
      this.pintarSenales();
      this.pintarAcciones();
      this.pintarContratos();
      this.pintarEquipos();
      this.armarMenu();
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (e) {
      // Sin red de verdad (offline) el caché es lo mejor que hay: se queda.
      console.warn('[centro] revalidación con el servidor no disponible:', e?.message || e);
    }
  },

  _diasA(fv) {
    const d = fv?.toDate ? fv.toDate() : (fv ? new Date(fv) : null);
    if (!d || isNaN(d)) return null;
    return Math.ceil((d - new Date()) / 86400000);
  },
  // UN formato de fecha en todo el Centro (auditoría de módulos 2026-09-30,
  // C6: convivían "09/30/2026", "2026-09-30" y "29 mar 2027"). Es el mismo
  // de Órdenes (formatFecha / formatFechaHora, f56de9f): "30 sep 2026" y
  // "30 sep 2026, 4:16 p. m.", en hora de Panamá y armado aquí para no
  // depender del locale del navegador. Acepta Timestamp, Date, ISO y
  // "YYYY-MM-DD"; la fecha sola es un día de calendario, no un instante:
  // new Date("2026-09-30") es medianoche UTC y en Panamá saldría el 29.
  _MESES_CORTOS: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  _partesFecha(fv) {
    if (!fv) return null;
    if (typeof fv === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fv)) {
      const [y, m, d] = fv.split('-').map(Number);
      return { year: String(y), month: m, day: String(d), soloDia: true };
    }
    let d;
    try { d = fv?.toDate ? fv.toDate() : (fv instanceof Date ? fv : new Date(fv)); } catch { return null; }
    if (!d || isNaN(d.getTime())) return null;
    const p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Panama', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return { ...p, month: Number(p.month) };
  },
  _fmtFecha(fv) {
    const p = this._partesFecha(fv);
    return p ? `${p.day} ${this._MESES_CORTOS[p.month - 1]} ${p.year}` : '—';
  },
  _fmtFechaCorta(fv) {
    const p = this._partesFecha(fv);
    return p ? `${p.day} ${this._MESES_CORTOS[p.month - 1]}` : null;
  },
  _fmtFechaHora(fv) {
    const p = this._partesFecha(fv);
    if (!p) return '—';
    const dia = `${p.day} ${this._MESES_CORTOS[p.month - 1]} ${p.year}`;
    if (p.soloDia) return dia;
    return `${dia}, ${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase() === 'PM' ? 'p. m.' : 'a. m.'}`;
  },
  _vencInfo(c) {
    // Preferir el estado estampado por el cron; derivar solo si aún no existe.
    const dias = this._diasA(c.fecha_vencimiento);
    if (dias == null) return null;
    const estado = c.vencimiento_estado ||
      (dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente'));
    return { dias, estado };
  },

  // 'aprobado' también opera (la mayoría del histórico nunca pasa a 'activo').
  // Un DORMIDO (aprobado sin firmar a los 45 días, decisión 7 de Alberto) no
  // es vigente: no bloquea otros trámites ni cuenta para el estado de la cuenta.
  _esVigente(c) { return ['activo', 'aprobado'].includes(c?.estado) && c?.dormido !== true; },
  // Candado de las acciones que se disparan desde onclick en texto (Ahora,
  // menú ⋯, pie del expediente): el mismo gesto sale de varios botones, así
  // que el candado va por CLAVE y el botón que se tocó solo muestra el
  // "Guardando…" (auditoría UX 2026-09-28, T3).
  _candado(key, fn, label = 'Guardando…') {
    const ae = document.activeElement;
    const btn = ae && ae.tagName === 'BUTTON' ? ae : null;
    return withBusy(null, () => (btn ? withBusy(btn, fn, { label, rethrow: false }) : fn()),
      { key, rethrow: false });
  },

  // ¿Bodega ya asignó los seriales? Sin eso el Anexo A del enlace de firma
  // sale VACÍO (auditoría UX 2026-09-28, P0 #11). 'legacy' es el histórico
  // que no pasa por bodega; la renovación sin equipo y el contrato sin
  // unidades no piden seriales (onApproval los da por asignados solo).
  _serialesListos(c) {
    if (!c) return false;
    if (['asignados', 'legacy'].includes(c.seriales_estado)) return true;
    if (c.accion === 'Renovación' && c.renovacion_sin_equipo) return true;
    return !(c.equipos || []).some(l => Number(l.cantidad || 0) > 0);
  },
  // Etiqueta legible del estado del contrato: la clave cruda
  // (pendiente_aprobacion) salía en títulos e Histórico (auditoría UX
  // 2026-09-28, T1). 'aprobado' sin activar ni firmar es el que espera firma.
  _estadoLabel(c) {
    const e = c?.estado || '';
    if (e === 'aprobado' && c.dormido === true) return 'Dormido (sin firma)';
    // Histórico que opera sin firma en el sistema (legacy o ya entregado):
    // "sin firma" sonaba a falta en contratos de 2024-2025 con radios en el
    // cliente (auditoría de módulos 2026-09-30, C6; igual que el archivo).
    if (e === 'aprobado' && (c.seriales_estado === 'legacy' || c.entrega_confirmada === true) && !c.firmado) return 'Aprobado · histórico';
    if (e === 'aprobado') return (c.fecha_activacion || c.firmado) ? 'Aprobado' : 'Aprobado (sin firma)';
    return ({ pendiente_aprobacion: 'Pendiente de aprobación', activo: 'Activo', vencido: 'Vencido',
      anulado: 'Anulado', inactivo: 'Inactivo' })[e] || e || '—';
  },
  // Toast con un botón (Toast.show solo pinta texto): para ofrecer el paso
  // siguiente sin un confirm que corta el flujo (auditoría UX 2026-09-28).
  _toastAccion(msg, label, onClick, tipo = 'ok', ms = 9000) {
    if (!window.Toast?.persist) { Toast.show(msg, tipo); return; }
    const el = Toast.persist(msg, tipo);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost cg-act'; b.textContent = label;
    b.style.marginLeft = '10px';
    b.addEventListener('click', () => { el.remove(); onClick(); });
    el.appendChild(b);
    setTimeout(() => el.remove(), ms);
  },
  // "Documento completo" respeta el papel del contrato (v2 o clásico).
  _urlDocumento(c) {
    return window.DocumentoContrato
      ? DocumentoContrato.urlDocumento(c.id, c, { base: '../contratos/' })
      : `../contratos/documento.html?id=${encodeURIComponent(c.id)}`;
  },

  // Contratos en trámite que todavía NO operan (pendiente de aprobación o
  // aprobados sin firmar): una renovación ya ACTIVA sigue en _tramitesContrato
  // por su regularización, pero opera — no va aquí.
  _idsEnTramite() {
    return new Set(this._tramitesContrato().filter(c => c.estado !== 'activo').map(c => c.id));
  },
  // Operativo = vigente, no renovado y fuera del trámite. Una sola regla para
  // la franja, los chips, la tabla y el estado de la cuenta (auditoría UX
  // 2026-09-28, P0 #9: la franja contaba la renovación sin firmar).
  _esOperativo(c, enTramite = this._idsEnTramite()) {
    return this._esVigente(c) && !enTramite.has(c.id) && !this._renovadoPor(c);
  },

  // Duración legible: duracion_dias MANDA sobre el texto (2026-09-02, caso
  // FANLYC: el formulario viejo pisó "4 días" con "1 meses" — su select no
  // conoce los días; el numérico sobrevive y las vistas no se dejan mentir).
  _durTxt(c) {
    const d = Number(c?.duracion_dias || 0);
    if (d > 0) return `${d} día${d === 1 ? '' : 's'}`;
    return c?.duracion || '';
  },

  _codigoTipo(c) {
    if (c?.codigo_tipo) return c.codigo_tipo;
    const m = { 'Servicio': 'SERV', 'Alquiler': 'ALQ', 'Propio': 'PROP', 'Reemplazo': 'REEMP', 'Demo': 'DEMO', 'Temporal': 'TEMP' };
    if (m[c?.tipo_contrato]) return m[c.tipo_contrato];
    const x = String(c?.contrato_id || '').match(/^[A-Z]+/);
    return x ? x[0] : null;
  },
  // Señal de vencimiento/renovación: solo ALQ/PROP/REEMP (DEMO/TEMP terminan).
  _aplicaVenc(c) { return ['SERV', 'ALQ', 'PROP', 'REEMP'].includes(this._codigoTipo(c)); },
  // Renovación REAL vigente que ya cubre a este contrato (un REEMP amarrado
  // como origen NO cuenta: solo sustituye equipos, no renueva el período).
  // Auditoría UX 2026-09-28 (P0 #9): una renovación EN TRÁMITE (pendiente de
  // aprobación, o aprobada y sin firmar) todavía NO renueva: renovado_por_ids
  // se escribe al crearla, y contarla ya marcaba "renovado ✓" a los orígenes y
  // dejaba la ficha en "Sin contratos operativos" antes de que el cliente
  // firmara. Solo consume a sus orígenes cuando sale del trámite (firmada,
  // activa, o un aprobado viejo del histórico que opera sin firma).
  _renovadoPor(c) {
    const enTramite = this._idsEnTramite();
    for (const id of (c?.renovado_por_ids || [])) {
      const r = this.contratos.find(x => x.id === id);
      if (!r || r.deleted || this._codigoTipo(r) === 'REEMP') continue;
      if (this._esVigente(r) && !enTramite.has(r.id)) return r;
      // 2026-08-31 (caso C COMUNICA): la renovación TERMINÓ (vencido tras la
      // terminación total) y su origen 'aprobado' de junio RESUCITÓ como
      // operativo. Una renovación que llegó a vivir consume a sus orígenes
      // para siempre — solo una ANULADA (o borrada) los libera.
      if (r.estado !== 'anulado' && (r.fecha_activacion || r.estado_previo === 'activo')) return r;
    }
    return null;
  },

  // Vida del contrato al estilo del prototipo: "vence en N días" con semáforo,
  // fecha, y barra de vida transcurrida (vigencia.fecha_inicio → vencimiento).
  // Vigencia PROYECTADA de un contrato que todavía no arranca (auditoría de
  // módulos 2026-09-30, C1/P4): fecha_vencimiento no existe hasta activar, y
  // la fila decía "sin duración" junto a "Duración 18 meses" (o "—" en el
  // pendiente de aprobación). Null si no aplica.
  _vidaProyectadaHtml(c) {
    if (!['pendiente_aprobacion', 'aprobado'].includes(c?.estado) || c.fecha_vencimiento || c.dormido === true) return null;
    if (!this._aplicaVenc(c)) return null;
    const diasDur = Number(c.duracion_dias || 0);
    const meses = diasDur > 0 ? 0 : (Number(c.duracion_meses || 0) || parseInt(String(c.duracion || '').match(/(\d+)\s*mes/)?.[1] || '0', 10));
    if (!(meses > 0 || diasDur > 0)) return null;
    const fin = new Date();
    if (meses > 0) fin.setMonth(fin.getMonth() + meses); else fin.setDate(fin.getDate() + diasDur);
    const dur = meses > 0 ? `${meses} meses` : `${diasDur} día${diasDur === 1 ? '' : 's'}`;
    const arranca = c.estado === 'pendiente_aprobacion' ? 'empieza al aprobar y firmar' : 'empieza al firmar';
    return `<div class="cg-vida"><span class="cg-venc vigente" title="La vigencia arranca con la firma; la fecha es si se firmara hoy">${arranca}</span>
      <span class="sub">${this.esc(dur)} · vencería ~ ${fin.toLocaleDateString('es-PA', { month: 'short', year: 'numeric' })} si se firma hoy</span></div>`;
  },
  _vidaHtml(c) {
    const proyectada = this._vidaProyectadaHtml(c);
    if (proyectada) return proyectada;
    if (!this._esVigente(c)) return '—';
    if (!this._aplicaVenc(c)) {
      return `<span style="color:var(--fg-4);" title="Los DEMO y TEMP terminan por su propio flujo de devolución — no renuevan">n/a</span>`;
    }
    const renovador = this._renovadoPor(c);
    if (renovador) {
      return `<div class="cg-vida"><span class="cg-venc vigente">renovado ✓</span>
        <span class="sub">por <span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span></span></div>`;
    }
    const dias = this._diasA(c.fecha_vencimiento);
    if (dias === null) {
      return this._codigoTipo(c) === 'REEMP'
        ? `<span class="cg-venc por_vencer" title="Un REEMP sin duración hereda la vigencia de su contrato de origen — falta amarrar el linaje">sin origen</span>`
        : `<span class="cg-venc por_vencer" title="Fija la duración del contrato para calcular su vencimiento">sin duración</span>`;
    }
    const ini = c.vigencia?.fecha_inicio;
    const iniD = ini?.toDate ? ini.toDate() : (ini ? new Date(ini) : null);
    const fv = c.fecha_vencimiento;
    const fvD = fv?.toDate ? fv.toDate() : new Date(fv);
    let pct = null;
    if (iniD && fvD && fvD > iniD) {
      pct = Math.min(100, Math.max(0, Math.round(((Date.now() - iniD.getTime()) / (fvD - iniD)) * 100)));
    }
    const estado = dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente');
    const color = estado === 'vencido' ? '#D24545' : estado === 'por_vencer' ? '#E0A93A' : '#1FA56B';
    const tcolor = estado === 'vencido' ? '#A03030' : estado === 'por_vencer' ? '#8A6415' : '#17714B';
    const label = dias < 0 ? `vencido hace ${-dias} día${-dias === 1 ? '' : 's'}` : `vence en ${dias} día${dias === 1 ? '' : 's'}`;
    return `<div class="cg-vida">
      <span class="lbl num" style="color:${tcolor};">${label}</span>
      <span class="sub num">${this._fmtFecha(c.fecha_vencimiento)}</span>
      ${pct !== null ? `<div class="bar"><i style="width:${pct}%;background:${color};"></i></div>` : ''}
    </div>`;
  },

  // Bandeja "REQUIERE TU ACCIÓN" — lo primero de la ficha (pedido 2026-08-28:
  // al entrar, incluso por el link del correo, lo pendiente de MI acción tiene
  // que ser lo primero, con el botón exacto y la evidencia al lado).
  abrirGestion(gid) {
    this.gSel = gid;
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
    setTimeout(() => document.getElementById(`grow-${gid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  },
  // Lo que espera una acción de alguien (contratos en trámite, gestiones
  // vivas). Devuelve filas {tono, t, s, btns, rol}; pintarAhora las funde
  // con las señales. `rol` es a quién le toca (claves de TOCA).
  _itemsAccion() {
    const items = [];
    const esAprobador = [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol);
    const it = (tono, t, s, btns, rol) => items.push({ tono, t, s, btns, rol });
    const B = (label, fn, primario = false) =>
      `<button class="${primario ? 'btn btn-primary' : 'btn btn-ghost'} cg-act" onclick="${fn}">${label}</button>`;

    // Contratos con trabajo pendiente.
    const vistos = new Set();
    for (const c of this._tramitesContrato()) {
      vistos.add(c.id);
      const id = `<span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`;
      const tipoTxt = c.accion === 'Renovación' ? 'Renovación de cuenta'
        : this._codigoTipo(c) === 'REEMP' ? 'Reemplazo de equipos'
        : this._codigoTipo(c) === 'DEMO' ? 'Demo de equipos' : 'Contrato nuevo';
      const unid = (c.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      if (c.estado === 'pendiente_aprobacion') {
        if (esAprobador) it('warn', `Aprobar el contrato ${id}`,
          `${tipoTxt} · ${unid} unid. · $${Number(c.total_mensual || 0).toFixed(2)}/mes — revisa el detalle antes de aprobar`,
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`) + B('Aprobar', `Centro.aprobarContrato('${this.esc(c.id)}')`, true), 'administracion');
        else it('info', `El contrato ${id} espera aprobación de administración`, tipoTxt,
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`), 'administracion');
      } else if (c.firmado_pendiente_validacion) {
        if (esAprobador) it('warn', `Validar al firmante del contrato ${id}`,
          'Firmó una persona distinta al representante registrado — revisa la cédula, el selfie y la firma',
          B('Validar firmante…', `Centro.aceptarFirmante('${this.esc(c.id)}')`, true), 'administracion');
      } else if (ContratoFirma.esperando(c) && !this._serialesListos(c) && !c.firma_solicitud_id) {
        // Sin seriales no se firma: el anexo saldría vacío (auditoría UX 2026-09-28).
        it('info', `El contrato ${id} espera que bodega asigne los seriales`,
          'Se asignan en Almacén · Asignar; al quedar asignados se habilita el envío para firma',
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`), 'bodega');
      } else if (ContratoFirma.esperando(c) && this.puedeCrearGestion()) {
        it('warn', `El contrato ${id} espera la firma del cliente`,
          c.firma_solicitud_estado === 'pendiente' ? 'El enlace de firma ya se envió — se puede reenviar' : 'Envíale el enlace de firma digital, o imprime el contrato y sube el firmado desde el expediente',
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`) + B('Enviar para firma', `Centro.enviarFirma('${this.esc(c.id)}')`, true), 'cliente_enlace');
      // Un contrato sin firma (reemplazo, demo) no le pide nada al cliente: lo
      // único que falta es poner los radios en su mano (2026-09-15, caso
      // MACELLO). Decirlo aquí evita que se quede en el limbo — la OS es la
      // que termina el trámite.
      } else if (!ContratoFirma.lleva(c) && c.estado === 'aprobado') {
        it('info', `El ${ContratoFirma.nombre(c)} ${id} espera la entrega de los equipos`,
          `${unid} unid. — ${ContratoFirma.porQue(c)}. La entrega se cierra en la orden de servicio.`,
          B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`), 'bodega');
      } else if (c.estado === 'activo') {
        const reg = this._regPendiente(c);
        if (reg?.motivo === 'sobrantes' && this.puedeCrearGestion()) {
          it('warn', `Resolver la regularización parcial de ${id}`,
            `${reg.sob} equipo(s) en custodia quedaron sin línea en el contrato (${reg.seriales.slice(0, 4).join(', ')}${reg.seriales.length > 4 ? '…' : ''}) — agrégalos por anexo o libéralos de la cuenta`,
            B('Ver expediente', `Centro.abrirGestion('ct-${this.esc(c.id)}')`) + B('Actualizar seriales', `Centro.wizAumento('${this.esc(c.id)}',{regularizar:true})`, true), 'cuenta');
        }
      }
    }
    // Órdenes que se quedaron sin contrato cuando se anuló el suyo. Van aquí
    // y no en el expediente del contrato anulado porque nadie abre un contrato
    // muerto a ver qué dejó pendiente (2026-09-15).
    for (const o of (this.ordenesPorDecidir || [])) {
      it('warn', `La orden <span class="cg-mono">${this.esc(o.id)}</span> se quedó sin contrato`,
        `${o.equipos_n} equipo(s) preparados bajo <span class="cg-mono">${this.esc(o.contrato)}</span>, que se anuló`
        + `${o.motivo ? ` (${this.esc(String(o.motivo).slice(0, 80))})` : ''}. `
        + `Si el cliente ya tiene contrato nuevo, la orden pasa a ese contrato y se entrega; si no, se anula.`,
        // ?ids= y no ?orden=: la bandeja carga las 40 mas recientes y estas
        // son de julio/agosto — ?orden= solo filtra lo ya cargado y la persona
        // aterrizaria en una lista vacia. ?ids= las trae del servidor.
        `<a class="btn btn-primary cg-act" href="../ordenes/index.html?ids=${encodeURIComponent(o.id)}">Resolver la orden</a>`, 'cuenta');
    }

    // Validaciones de firma fuera de la ventana de trámite.
    for (const c of (this.contratos || [])) {
      if (vistos.has(c.id) || !c.firmado_pendiente_validacion || !esAprobador) continue;
      it('warn', `Validar al firmante del contrato <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
        'Firmó una persona distinta al representante — revisa la cédula, el selfie y la firma',
        B('Validar firmante…', `Centro.aceptarFirmante('${this.esc(c.id)}')`, true), 'administracion');
    }

    // Aprobado y sin firmar pasados los 45 días: salía del trámite sin aviso
    // (auditoría UX 2026-09-28). Solo contratos del flujo nuevo (con
    // seriales_estado y no 'legacy'): el histórico 'aprobado' opera sin firma.
    for (const c of (this.contratos || [])) {
      if (vistos.has(c.id) || c.deleted || !ContratoFirma.esperando(c)) continue;
      if (!c.seriales_estado || c.seriales_estado === 'legacy') continue;
      const ref = c.fecha_aprobacion || c.fecha_creacion;
      const d = ref?.toDate ? ref.toDate() : (ref ? new Date(ref) : null);
      const n = d && !isNaN(d) ? Math.floor((Date.now() - d) / 86400000) : null;
      if (n == null || n < 45) continue;
      it('warn', `El contrato <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span> fue aprobado hace ${n} días y sigue sin firma`,
        'Envíale el enlace de firma o sube el firmado; si ya no va, anúlalo',
        B('Ver contrato', `Centro.verContrato('${this.esc(c.id)}')`)
        + (this.puedeCrearGestion() ? B('Enviar para firma', `Centro.enviarFirma('${this.esc(c.id)}')`, true) : ''), 'cliente_enlace');
    }

    // Gestiones con trabajo pendiente.
    for (const g of (this.gestiones || [])) {
      const gid = `<span class="cg-mono">${this.esc(g.id)}</span>`;
      const ver = B('Ver expediente', `Centro.abrirGestion('${this.esc(g.id)}')`);
      if (g.estado === 'pendiente_aprobacion') {
        const esBaja = g.tipo === 'baja';
        const esAum = g.tipo === 'aumento';
        const puede = (esBaja || esAum) ? this.puedeAprobarBaja() : this.puedeAprobar();
        const carta = esBaja && g.carta_path ? B('Ver carta', `Centro.verAnexo('${this.esc(g.carta_path)}')`) : '';
        if (puede) {
          const sinCarta = esBaja && !g.carta_path;
          const esTaller = g.origen?.tipo === 'taller';
          const esDano = GestionesService.esReposicionDano(g);
          it('warn', `Aprobar ${esBaja ? (g.terminacion_total_de?.length ? 'la TERMINACIÓN de la cuenta' : 'la baja de equipos') : esAum ? 'el aumento (anexo)' : esDano ? 'el reemplazo POR DAÑO (con o sin cargo)' : esTaller ? 'el reemplazo que propuso el taller' : 'la excepción de garantía'} ${gid}`,
            sinCarta ? 'FALTA la carta del cliente — la aprobación está bloqueada hasta adjuntarla'
              : esTaller ? `Diagnóstico del taller (orden ${this.esc(g.origen?.orden_id || '—')}): ${this.esc(g.origen?.diagnostico || '—')}`
              : `${(g.items || []).length || (g.aumento?.lineas || []).length} renglón(es) — revisa la evidencia antes de aprobar`,
            carta + ver + (sinCarta ? '' : B('Revisar y aprobar', `Centro.abrirGestion('${this.esc(g.id)}')`, true)), 'administracion');
        } else if (esBaja && !g.carta_path && this.puedeCrearGestion()) {
          it('warn', `La baja ${gid} necesita la carta del cliente`, 'Adjúntala desde el expediente para desbloquear la aprobación', ver, 'cuenta_carta');
        }
      } else if (g.estado === 'pendiente_cliente') {
        // Reposición por daño: la cotización está con el cliente. Lo único que
        // falta es su respuesta, y la anota el taller en la cotización.
        const cot = g.cobro?.cotizacion_doc_id;
        it('info', `Esperando que el cliente acepte el cobro de la reposición ${gid}`,
          `Cotización ${this.esc(g.cobro?.cotizacion_id || 'en preparación')} · $${Number(g.cobro?.monto || 0).toFixed(2)} + ITBMS — Bodega asigna cuando el cliente acepte`,
          ver + (cot ? `<a class="btn btn-primary cg-act" href="../cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(cot)}">Abrir la cotización</a>` : ''), 'cliente');
      } else if (g.tipo === 'aumento' && g.estado === 'pendiente_firma' && !g.firma_pendiente_validacion && this.puedeCrearGestion()) {
        it('warn', `El anexo de aumento ${gid} espera la firma del cliente`,
          g.firma_solicitud_estado === 'pendiente' ? 'El enlace de firma ya se envió — se puede reenviar' : 'Envíale el enlace de firma digital (o imprime y sube el firmado)',
          ver + B('Enviar anexo para firma', `Centro.enviarFirmaAnexo('${this.esc(g.id)}')`, true), 'cliente_enlace');
      } else if (g.firma_pendiente_validacion && esAprobador) {
        it('warn', `Validar al firmante del anexo ${gid}`,
          'Firmó una persona distinta al representante — revisa la cédula, el selfie y la firma',
          B('Validar firmante…', `Centro.aceptarFirmanteGestion('${this.esc(g.id)}')`, true), 'administracion');
      } else if (g.estado === 'pendiente_bodega' && this.puedeAsignar()) {
        // Bodega asigna desde Almacén · Asignar (2026-09-03); aquí solo se señala.
        it('info', `Bodega debe asignar los seriales de ${gid}`,
          `${GestionesService.tipoLabel(g.tipo)} — se asignan en Almacén · Asignar`,
          `<a class="btn btn-primary cg-act" href="../almacen/index.html?tab=asignar&g=${encodeURIComponent(g.id)}">Asignar en Almacén</a>`, 'bodega');
      }
    }

    return items;
  },
});
