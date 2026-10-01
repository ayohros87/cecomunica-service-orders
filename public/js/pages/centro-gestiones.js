// @ts-nocheck
// Centro de gestión de clientes — Gestiones: lista + expediente.
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Gestiones: lista + expediente ═════════ */

  // Cada paso es [clave, título, detalle, rol]: el rol (claves de TOCA) es a
  // quién le toca — dato, no deducción del texto (auditoría UX 2026-09-28).
  CIERRE_DEFS: {
    reemplazo: [
      ['asignacion', 'Asignación del nuevo serial', 'Bodega elige la unidad que sustituye', 'bodega'],
      ['programacion', 'Programación del nuevo equipo', 'Referencia: la configuración del radio reemplazado', 'bodega'],
      ['entrega', 'Entrega / sustitución', 'Se registra sola al entregar la OS', 'bodega'],
      ['entrada', 'Entrada del radio reemplazado', 'Vía orden de devolución — avanza sin el equipo físico', 'recepcion'],
    ],
    demo: [
      ['asignacion', 'Asignación de seriales', 'Bodega asigna (stock nuevo o refurbished)', 'bodega'],
      ['programacion', 'Programación de los equipos', 'OS de programación confirmada', 'bodega'],
      ['entrega', 'Entrega al cliente', 'Se registra sola al entregar la OS', 'bodega'],
      ['entrada', 'Retorno y recepción', 'Check-in del retorno; inspección antes de Disponible', 'recepcion'],
    ],
    baja: [
      ['aprobacion', 'Aprobación de la baja', 'Una sola aprobación, con desglose por contrato', 'administracion'],
      ['derivacion', 'Fin de facturación registrado', 'Placeholder: la facturación aún no corre en la plataforma — no bloquea el cierre', 'sistema'],
      ['entrada', 'Entrada de los equipos', 'Check-in de la devolución (los propios del cliente no se recuperan)', 'recepcion'],
    ],
    aumento: [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia', 'administracion'],
      ['firma', 'Anexo firmado por el cliente', 'El período propio del equipo nuevo queda explícito', 'cliente_enlace'],
      ['derivacion', 'Líneas aplicadas al contrato', 'Con vigencia propia del tramo (corre desde la entrega)', 'sistema'],
      ['asignacion', 'Asignación de seriales', 'Bodega', 'bodega'],
      ['programacion', 'Programación', 'OS de programación confirmada', 'bodega'],
      ['entrega', 'Entrega al cliente', 'Arranca el tramo: inicio y vencimiento propios', 'bodega'],
    ],
    // Cambio de serial: corregir el papel, no mover equipo. Dos pasos y ya —
    // sin OS, sin entrega y sin entrada, porque el radio ya está donde tiene
    // que estar. Un checklist de cuatro pasos aquí mentiría.
    cambio_serial: [
      ['asignacion', 'Serial confirmado por bodega', 'Contra el radio: cuál es el serial de verdad', 'bodega'],
      ['derivacion', 'Corrección aplicada', 'Contrato y pool corregidos; activaciones avisada', 'sistema'],
    ],
  },

  puedeAsignar() { return [ROLES.ADMIN, ROLES.INVENTARIO].includes(this.rol); },
  // Aprobar una gestión es de administración o gerencia — es lo que dicen las
  // reglas (esAprobacionGestion) y lo que dice el botón cuando está en gris.
  // Aquí pedía ADMIN a secas: a un gerente se le apagaba el botón con el
  // motivo "solo administración o gerencia aprueba", que él sí cumplía.
  puedeAprobar() { return [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol); },
  puedeAprobarBaja() { return [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol); },
  puedeCrearGestion() { return [ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION].includes(this.rol); },

  async recargarGestiones() {
    window.AprobacionesService?.invalidarHome();
    this.gestiones = await GestionesService.listarPorCliente(this.cliente.id).catch(() => this.gestiones || []);
    this.pintarAcciones();
    this.pintarKpis();
    this.pintarSenales();
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // ── Escucha en vivo de las gestiones de la ficha (2026-08-31) ──
  // Los triggers escriben el avance segundos después de cada acción; el
  // listener repinta con el estado real en vez de adivinar con timeouts.
  _unsubGestiones: null,
  _repintarPend: false,
  _escucharGestiones(clienteId) {
    this._pararEscucha();
    try {
      this._unsubGestiones = firebase.firestore().collection('gestiones')
        .where('cliente_id', '==', clienteId)
        .onSnapshot((snap) => {
          if (!this.cliente || this.cliente.id !== clienteId) return;
          const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          out.sort((a, b) => (b.fecha_solicitud?.toMillis?.() || 0) - (a.fecha_solicitud?.toMillis?.() || 0));
          // Una gestión que CAMBIA DE ESTADO casi siempre movió la cuenta:
          // amarró seriales, soltó radios, agregó líneas a un contrato. Antes
          // solo se repintaba el expediente y el resto de la ficha (flota,
          // contratos, chip de regularización, menú de acciones) se quedaba
          // con lo que se leyó al entrar — el reporte de Alberto 2026-09-09:
          // "los menús se quedan estáticos". Ahora se relee lo de verdad.
          const estados = out.map(g => `${g.id}:${g.estado}`).join('|');
          const movio = this._gEstados !== null && this._gEstados !== estados;
          this._gEstados = estados;
          this.gestiones = out;
          this._repintarGestiones();
          if (movio) this._revalidarPronto(clienteId);
        }, (e) => console.warn('[centro] escucha de gestiones no disponible:', e?.message || e));
    } catch (e) { console.warn('[centro] escucha de gestiones no disponible:', e?.message || e); }
  },
  // Los triggers escriben en cadena (pool → contrato → cuenta): se relee un
  // par de veces, no una, para no pintar a medio camino.
  _gEstados: null,
  _revalTimers: [],
  _revalidarPronto(clienteId) {
    this._revalTimers.forEach(t => clearTimeout(t));
    this._revalTimers = [1200, 6000].map(ms => setTimeout(() => {
      if (this.cliente && this.cliente.id === clienteId) this._revalidarFicha(clienteId);
    }, ms));
  },

  // ── Escucha en vivo del cliente (2026-09-09) ──
  // `clientes/{id}.regularizacion` lo escribe el back (al aplicar el anexo y
  // en el barrido). Sin esta escucha, el chip "Por regularizar" y el menú se
  // quedaban con el número viejo hasta el F5.
  _unsubCliente: null,
  _escucharCliente(clienteId) {
    try {
      this._unsubCliente = firebase.firestore().collection('clientes').doc(clienteId)
        .onSnapshot((snap) => {
          if (!snap.exists || !this.cliente || this.cliente.id !== clienteId) return;
          const antes = this.cliente.regularizacion || null;
          this.cliente = { id: snap.id, ...snap.data() };
          const ahora = this.cliente.regularizacion || null;
          this._pintarEncabezado(this.cliente);
          this.pintarSenales();
          this.pintarAcciones();
          this.armarMenu();
          if (window.lucide?.createIcons) lucide.createIcons();
          const pa = Number(antes?.puntos || 0), pd = Number(ahora?.puntos || 0);
          if (antes && pa !== pd) {
            Toast.show(pd === 0
              ? 'La cuenta quedó al día — ya no pide regularización'
              : `La cuenta bajó de ${pa} a ${pd} punto${pd === 1 ? '' : 's'} por regularizar`, pd === 0 ? 'ok' : '');
          }
        }, (e) => console.warn('[centro] escucha del cliente no disponible:', e?.message || e));
    } catch (e) { console.warn('[centro] escucha del cliente no disponible:', e?.message || e); }
  },
  _pararEscucha() {
    if (this._unsubGestiones) {
      try { this._unsubGestiones(); } catch (e) { /* nada */ }
      this._unsubGestiones = null;
    }
    if (this._unsubCliente) {
      try { this._unsubCliente(); } catch (e) { /* nada */ }
      this._unsubCliente = null;
    }
    this._revalTimers.forEach(t => clearTimeout(t));
    this._revalTimers = [];
    this._gEstados = null;
  },
  _repintarGestiones() {
    // Con el foco en un campo del expediente (bodega tecleando seriales) el
    // repintado se pospone al blur — si no, le borra lo escrito a mitad.
    const act = document.activeElement;
    const enExp = act && document.getElementById('fGestiones')?.contains(act)
      && ['INPUT', 'SELECT', 'TEXTAREA'].includes(act.tagName);
    if (enExp) {
      if (!this._repintarPend) {
        this._repintarPend = true;
        act.addEventListener('blur', () => {
          this._repintarPend = false;
          setTimeout(() => this._repintarGestiones(), 120);
        }, { once: true });
      }
      return;
    }
    this.pintarAcciones();
    this.pintarKpis();
    this.pintarSenales();
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  toggleGestion(gid) {
    this.gSel = this.gSel === gid ? null : gid;
    this.pintarGestiones();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // Contratos EN TRÁMITE (renovación de cuenta / contrato nuevo) como
  // expedientes de esta sección (pedido 2026-08-28: la renovación no aparecía
  // en Gestiones y solo se podía aprobar en el módulo viejo). El contrato ES
  // el expediente: pipeline aprobación → seriales → firma → activación → regularización,
  // con las acciones aquí mismo.
  _tramitesContrato() {
    const dias = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? (Date.now() - d) / 86400000 : null; };
    // Un contrato que lleva firma sigue en trámite hasta que el cliente firma;
    // uno que NO la lleva (REEMPLAZO), hasta que los equipos se entregan
    // (2026-09-15): antes se quedaba para siempre en "Esperando firma", que es
    // justo lo que mandó a Brenda a perseguir una firma inexistente.
    const abierto = (c) => ContratoFirma.lleva(c) ? !c.firmado : c.entrega_confirmada !== true;
    // Los 45 días ya no ESCONDEN el trámite (C3: la ficha decía "nada
    // pendiente" mientras el home contaba el contrato). Con seriales
    // asignados, el cron lo DUERME a los 45 días (decisión 7, 1-oct-2026) y el
    // dormido se pinta aparte (pintarGestiones); mientras tanto sigue aquí con
    // su edad. El corte de 45 días queda solo como válvula para lo que el cron
    // no alcanza (histórico sin circuito de seriales).
    const sigueVivo = (c) => c.dormido !== true
      && (c.seriales_estado === 'asignados' || c.seriales_estado === 'pendiente' || (dias(c.fecha_creacion) ?? 999) < 45);
    return (this.contratos || []).filter(c => !c.deleted && (
      c.estado === 'pendiente_aprobacion'
      || (c.estado === 'aprobado' && abierto(c) && sigueVivo(c))
      // Renovación ACTIVA pero con la regularización PENDIENTE o PARCIAL
      // (caso C COMUNICA 2026-08-28: el trigger amarró 2 y dejó 2 sin línea,
      // y el check se daba por listo con solo regularizacion.at): el trámite
      // no termina hasta que la conciliación queda EN CERO.
      || (c.accion === 'Renovación' && c.estado === 'activo' && !!this._regPendiente(c)
          && (dias(c.fecha_creacion) ?? 999) < 45)));
  },
  // La regularización solo está completa cuando CORRIÓ y quedó en cero.
  // Devuelve null si está lista; {motivo:'pendiente'} si aún no corre (la
  // custodia se amarra al entregarse la OS); {motivo:'sobrantes', seriales}
  // si corrió pero dejó equipos sin línea o sin cupo en el contrato.
  _regPendiente(c) {
    if (c.estado !== 'activo') return null;
    const r = c.regularizacion;
    if (!r?.at) return { motivo: 'pendiente' };
    const sob = Number(r.sin_linea || 0) + Number(r.sin_cupo || 0);
    if (!sob) return null;
    return { motivo: 'sobrantes', sob,
      seriales: [...(r.sin_linea_seriales || []), ...(r.sin_cupo_seriales || [])] };
  },
  // Una renovación EN CURSO apaga todos los botones de "Renovar cuenta"
  // (reclamo 2026-08-28: mil botones de renovación con una ya en trámite).
  _renovacionEnTramite() {
    return this._tramitesContrato().find(c => c.accion === 'Renovación') || null;
  },
  // Progreso de la fila: mini barra verde + "hechos/total" (2026-09-28).
  _progHtml(done, total) {
    const pct = total > 0 ? Math.round(Math.min(1, Math.max(0, done / total)) * 100) : 0;
    return `<span class="cg-prog" title="${done} de ${total} pasos" aria-label="${done} de ${total} pasos">
      <span class="bar" aria-hidden="true"><i style="width:${pct}%;"></i></span><span class="num">${done}/${total}</span></span>`;
  },
  // Un paso de la línea de tiempo (gestión y contrato comparten la anatomía):
  // hecho ✓ en verde; SIGUIENTE destacado con etiqueta y "le toca a X" como
  // chip; futuro, tenue. El título ya viene escapado/armado por quien llama.
  _tlItem({ titulo, sub, done, next, toca }) {
    return `<div class="cg-tl-item ${done ? 'done' : next ? 'next' : 'todo'}">
        <span class="cg-tl-dot">${done ? '✓' : ''}</span>
        <span class="cg-tl-t">${next ? '<span class="cg-tl-lbl">Siguiente</span>' : ''}<b>${titulo}</b><span class="s">${sub}</span>${toca
          ? `<span class="cg-tl-toca"><span class="cg-chip cg-chip--warn">le toca a ${this.esc(toca)}</span></span>` : ''}</span>
      </div>`;
  },
  _tramiteHtml(c) {
    const abierta = this.gSel === 'ct-' + c.id;
    const reg = this._regPendiente(c);
    const r = c.regularizacion;
    const regSub = reg?.motivo === 'sobrantes'
      ? `${Number(r?.amarradas || 0)} amarrado(s) · ${reg.sob} SIN resolver: ${reg.seriales.slice(0, 4).join(', ')}${reg.seriales.length > 4 ? '…' : ''} — agrégalos por anexo o libéralos`
      : (r?.at && !reg) ? `${Number(r.amarradas || 0)} radio(s) amarrados — conciliación en cero`
      : 'la custodia se amarra sola al entregarse la orden de servicio';
    // Un contrato sin firma (reemplazo, demo) no firma ni se activa: su camino
    // es aprobar → programar → entregar (2026-09-15). Pintarle "Firma del
    // cliente" y "Activación" era ponerle dos pasos que nunca iba a dar. El
    // retorno del demo NO es un paso de este expediente: lo cierra su propia
    // orden de devolución (ContratoCierre / la ENTRADA).
    const llevaFirma = ContratoFirma.lleva(c);
    // Programación y entrega salen de las ÓRDENES del contrato (auditoría UX
    // 2026-09-28, §4.3 #13): antes la línea del contrato con firma terminaba
    // en "Activación" y el vendedor no veía si bodega ya programó ni si el
    // radio llegó al cliente. Cada paso es [título, hecho, detalle, rol]: el
    // rol (claves de TOCA) dice a quién le toca el paso que sigue.
    const cch = this._osCache[c.id];
    if (!cch) this._cargarOsContrato(c.id);
    const osProg = (cch?.os || []).filter(o => /PROGRAMACI/i.test(String(o.tipo_de_servicio || '')));
    const programada = osProg.length > 0;
    const entregada = c.entrega_confirmada === true || osProg.some(o => !!o.fecha_entrega);
    const pasoProg = ['Programación de los equipos', programada,
      programada ? `${osProg.length} orden${osProg.length === 1 ? '' : 'es'} de programación`
        : (!cch || cch.loading) ? 'consultando las órdenes del contrato…'
        : 'bodega crea la orden de programación al preparar los equipos', 'bodega'];
    const pasoEntrega = ['Entrega al cliente', entregada,
      entregada ? 'los equipos quedaron en manos del cliente'
        : llevaFirma ? 'se cierra en la orden de servicio, con el acuse firmado' : ContratoFirma.porQue(c), 'bodega'];
    const pasos = llevaFirma ? [
      // Paso de bodega (auditoría UX 2026-09-28): el wizard y el expediente
      // prometían "aprobación → seriales → firma" y la línea no lo pintaba.
      ['Aprobación de administración', c.estado !== 'pendiente_aprobacion', 'la aprueba administración o gerencia', 'administracion'],
      ['Seriales de bodega', c.estado !== 'pendiente_aprobacion' && this._serialesListos(c),
        c.seriales_estado === 'asignados' ? 'bodega asignó los seriales'
          : this._serialesListos(c) ? 'no hay equipo que asignar'
          : 'bodega los asigna en Almacén · Asignar — sin eso no se envía a firma', 'bodega'],
      ['Firma del cliente', !!c.firmado, c.firma_solicitud_estado === 'pendiente' ? 'enlace de firma enviado — esperando' : 'enlace digital, o subir el firmado', 'cliente_enlace'],
      ['Activación', c.estado === 'activo', 'automática al validarse la firma', 'sistema'],
      pasoProg,
      pasoEntrega,
      ['Regularización de la cuenta', c.estado === 'activo' && !reg, regSub, reg?.motivo === 'sobrantes' ? 'cuenta' : 'sistema'],
    ] : [
      ['Aprobación de administración', c.estado !== 'pendiente_aprobacion', 'la aprueba administración o gerencia', 'administracion'],
      pasoProg,
      pasoEntrega,
    ];
    const done = pasos.filter(p => p[1]).length;
    const dormido = ContratoFirma.dormido(c);
    const [chipCls, chipTxt] = dormido ? ['cg-chip--warn', `Dormido · ${c.dormido_dias || ContratoFirma.DIAS_DORMIDO}+ días sin firma`]
      : c.estado === 'pendiente_aprobacion' ? ['cg-chip--warn', 'Esperando aprobación']
      : !llevaFirma ? (c.entrega_confirmada === true ? ['cg-chip--ok', 'Entregado'] : ['cg-chip--info', 'Aprobado — por entregar'])
      : !c.firmado && !this._serialesListos(c) ? ['cg-chip--info', 'Esperando seriales']
      : !c.firmado ? ['cg-chip--warn', 'Esperando firma']
      : c.estado === 'activo' && reg?.motivo === 'sobrantes' ? ['cg-chip--warn', 'Activo — regularización parcial']
      : c.estado === 'activo' && reg ? ['cg-chip--info', 'Activo — regularización pendiente']
      : c.estado === 'activo' ? ['cg-chip--ok', 'Activo'] : ['cg-chip--info', 'En trámite'];
    const unid = (c.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const esRenov = c.accion === 'Renovación';
    const timeline = `<div class="cg-tl">` + pasos.map(([t, ok, s, rol], i) => {
      const next = !ok && pasos.slice(0, i).every(p => p[1]);
      return this._tlItem({ titulo: t, sub: s, done: ok, next, toca: next ? this._tocaLabel(rol) : '' });
    }).join('') + `</div>`;
    // Las acciones ya NO se pintan aquí sueltas: viven en el "⋯" de la fila y
    // en el pie del detalle, la misma lista y en el mismo orden que la de una
    // gestión (2026-09-09). Se deja el atajo al siguiente paso, que sale de
    // esa misma lista — no es una botonera aparte.
    const acc = this._accionesContrato(c);
    const acciones = this._pieAcciones('dct-' + c.id, acc);
    return `
      <div class="cg-row cg-row--g" id="grow-ct-${this.esc(c.id)}" role="button" tabindex="0" onclick="Centro.toggleGestion('ct-${this.esc(c.id)}')"
           onkeydown="if(event.key==='Enter')this.click()" style="${abierta ? 'border-color:var(--accent);' : ''}">
        <div class="cg-gmain"><div class="n cg-mono" style="font-size:13px;">${this.esc(c.contrato_id || c.id)}</div>
          <div class="s">${dormido ? `Borrador de solicitud · dormido desde ${this._fmtFecha(c.dormido_at)} · ` : ''}${esRenov ? 'Renovación de cuenta' : 'Contrato nuevo'} · ${unid} unid. · $${Number(c.total_mensual || 0).toFixed(2)}/mes</div></div>
        <div class="cg-gside">
          ${this._progHtml(done, pasos.length)}
          <span class="cg-chip ${chipCls}" style="flex:none;">${chipTxt}</span>
          ${this._masFila('ct-' + c.id, this._accionesContrato(c), c.contrato_id || c.id)}
          <span class="arr">${abierta ? '▾' : '›'}</span>
        </div>
      </div>
      ${abierta ? `<div class="ds-card" style="padding:var(--sp-4); margin:-4px 0 10px; border-top:none;">
        <div class="cg-exp">
          <div>
            <p style="font-size:13px; margin:0 0 8px;">${dormido
              ? `<b>Dormido:</b> pasaron ${this.esc(String(c.dormido_dias || ContratoFirma.DIAS_DORMIDO))} días aprobado sin la firma del cliente; la solicitud y el enlace caducaron.
                 No cuenta en "Contratos por firmar" ni frena otros trámites de la cuenta. <b>Reactivar</b> genera un enlace nuevo.`
              : esRenov
              ? `Renueva y <b>consolida la cuenta</b>: sus orígenes quedan marcados como renovados al activarse.`
              : `Contrato nuevo pendiente del ciclo aprobación → seriales de bodega → firma → activo.`}
              <b>Duración:</b> ${this.esc(this._durTxt(c) || '—')}</p>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">${acciones}</div>
            ${this._osTramiteHtml(c)}
          </div>
          <div>${timeline}</div>
        </div>
      </div>` : ''}`;
  },

  // ── Flujo de las órdenes de servicio del contrato (pedido 2026-08-28: el
  // vendedor debe VER el equipo avanzar por bodega/taller sin salir de la
  // ficha). El vínculo vive en ordenes_de_servicio.contrato.contrato_doc_id
  // (mapa estampado al crear la orden); las fechas del doc son las etapas.
  _osCache: {},
  async _cargarOsContrato(cid) {
    if (this._osCache[cid]) return;
    this._osCache[cid] = { loading: true };
    try {
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('contrato.contrato_doc_id', '==', cid).limit(20).get();
      const os = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(o => o.eliminado !== true)
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
      this._osCache[cid] = { os };
    } catch (e) {
      console.warn('[centro] órdenes del contrato no legibles:', e?.message || e);
      this._osCache[cid] = { os: [], error: true };
    }
    if (this.gSel === 'ct-' + cid || this._tramitesContrato().some(t => t.id === cid)) {
      this.pintarGestiones(); if (window.lucide?.createIcons) lucide.createIcons();
    }
  },

  // ── Órdenes que quedaron sin contrato al anularlo (2026-09-15) ────────────
  // Cerrar el lazo donde el dato POR FIN existe. Al anular no se sabe cuál es
  // el contrato nuevo —casi siempre se anula primero y se rehace después, por
  // eso el sustituto del modal es opcional—, así que el trigger no puede
  // repuntar solo y deja la orden SEÑALADA. El único sitio donde alguien ya
  // está mirando al cliente y sus contratos es esta ficha: aquí se le
  // recuerda, con el número de radios en juego, y el CTA lleva a la orden,
  // donde viven las dos puertas (no se duplica la decisión en dos pantallas).
  //
  // Sin índice ni query nueva: reusa el mismo `contrato.contrato_doc_id` que
  // ya usa `_cargarOsContrato`, y solo sobre los contratos ANULADOS del
  // cliente — que son 0 en la inmensa mayoría de las fichas. Tope de 6, los
  // más recientes: más atrás ya no es una decisión pendiente, es arqueología.
  async _cargarOrdenesPorDecidir() {
    const anulados = (this.contratos || [])
      .filter(c => c.estado === 'anulado' && !c.deleted)
      .sort((a, b) => (b.anulado_fecha?.seconds || 0) - (a.anulado_fecha?.seconds || 0))
      .slice(0, 6);
    if (!anulados.length) { this.ordenesPorDecidir = []; return; }
    const out = [];
    for (const c of anulados) {
      await this._cargarOsContrato(c.id).catch(() => {});
      for (const o of (this._osCache[c.id]?.os || [])) {
        if (o.contrato_anulado_revisar) {
          out.push({ id: o.id, equipos_n: Number(o.contrato_anulado_revisar.equipos_n || 0),
            contrato: c.contrato_id || c.id, motivo: c.anulado_motivo || '' });
        }
      }
    }
    this.ordenesPorDecidir = out;
    if (out.length) { this.pintarAcciones(); if (window.lucide?.createIcons) lucide.createIcons(); }
  },
  _osPasos(o) {
    const f = (ts) => { const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null); return d && !isNaN(d) ? d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit' }) : null; };
    return [
      ['Creada', f(o.fecha_creacion || o.creado_en)],
      ['Recibida', f(o.fecha_recepcion)],
      [o.tecnico_asignado ? `Asignada (${o.tecnico_asignado})` : 'Asignada', f(o.fecha_asignacion)],
      ['Completada', f(o.fecha_completado)],
      ['Entregada', f(o.fecha_entrega)],
    ];
  },
  _osTramiteHtml(c) {
    const cch = this._osCache[c.id];
    if (!cch || cch.loading) {
      if (!cch) this._cargarOsContrato(c.id);
      return `<div class="cg-skel" style="height:34px; margin-top:10px;" aria-label="Cargando órdenes…"></div>`;
    }
    if (!cch.os.length) return `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">
      Aún sin órdenes de servicio de este contrato — bodega crea la orden al preparar los equipos.</p>`;
    return `<div style="margin-top:10px;">` + cch.os.map(o => {
      const pasos = this._osPasos(o);
      const idxNext = pasos.findIndex(p => !p[1]);
      const flujo = pasos.map((p, i) => {
        const ok = !!p[1];
        const estilo = ok ? '' : (i === idxNext ? 'color:var(--warn-deep, #92400E); font-weight:600;' : 'color:var(--fg-4);');
        return `<span style="white-space:nowrap; ${estilo}">${ok ? '✓ ' : '○ '}${this.esc(p[0])}${p[1] ? ` <span style="color:var(--fg-4); font-weight:400;">${p[1]}</span>` : ''}</span>`;
      }).join('<span style="color:var(--fg-4);"> › </span>');
      const nSer = (o.equipos || []).length;
      return `<div class="cg-os" style="margin-bottom:6px;">
        <a href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">
          <b>${this.esc(o.tipo_de_servicio || 'ORDEN')}</b>&nbsp;<span class="cg-mono">${this.esc(o.id)}</span></a>
        <span style="font-size:12px; color:var(--fg-3);">${nSer} equipo(s) · ${this.esc(o.estado_reparacion || '—')}</span>
        <div style="flex-basis:100%; font-size:12px; margin-top:3px; display:flex; flex-wrap:wrap; gap:2px 4px;">${flujo}</div>
      </div>`;
    }).join('') + `</div>`;
  },

  pintarGestiones() {
    const cont = document.getElementById('fGestiones');
    const tramites = this._tramitesContrato();
    const tramHtml = tramites.map(c => this._tramiteHtml(c)).join('');
    // Borradores DORMIDOS (decisión 7, 1-oct-2026): aprobados sin firma a los
    // 45 días. No son trámites —no cuentan ni bloquean—, pero se ven, con
    // "Reactivar" en su menú, para que no se pierdan en el histórico.
    const dormidos = (this.contratos || []).filter(c => !c.deleted && c.estado === 'aprobado' && ContratoFirma.dormido(c));
    const dormAbierto = dormidos.some(c => this.gSel === 'ct-' + c.id);
    const dormHtml = dormidos.length ? `
        <details ${dormAbierto ? 'open' : ''} style="margin-top:10px;">
          <summary style="cursor:pointer; font-size:12.5px; color:var(--fg-3); padding:4px 2px; user-select:none;">
            Borradores dormidos — ${dormidos.length} contrato${dormidos.length === 1 ? '' : 's'} aprobado${dormidos.length === 1 ? '' : 's'} sin firma a los 45 días · se reactivan desde su menú</summary>
          <div style="margin-top:8px;">${dormidos.map(c => this._tramiteHtml(c)).join('')}</div>
        </details>` : '';
    if (!(this.gestiones || []).length && !tramites.length && !dormidos.length) {
      cont.innerHTML = `<div class="cg-empty">Sin gestiones registradas todavía.
        ${this.puedeCrearGestion() ? `<div class="cta"><button class="btn btn-primary cg-act"
          onclick="event.stopPropagation(); document.getElementById('btnGestion')?.scrollIntoView({block:'center'}); document.getElementById('btnGestion')?.click()">Nueva gestión</button></div>` : ''}</div>`;
      return;
    }
    const filaG = (g, atenuada) => {
      // Progreso con LOS PASOS DEL TIPO (el 4 fijo de reemplazo/demo pintaba
      // "3/4" en un aumento cerrado con sus 6 pasos completos).
      const defsG = this._defsGestion(g);
      const done = defsG.filter(([k]) => this._pasoDone(g, k)).length;
      const fecha = g.fecha_solicitud?.toDate ? g.fecha_solicitud.toDate().toLocaleDateString('es-PA') : '—';
      const abierta = this.gSel === g.id;
      return `
      <div class="cg-row cg-row--g${atenuada && !abierta ? ' cg-tenue' : ''}" id="grow-${this.esc(g.id)}" role="button" tabindex="0" onclick="Centro.toggleGestion('${this.esc(g.id)}')"
           onkeydown="if(event.key==='Enter')this.click()"
           style="${abierta ? 'border-color:var(--accent);' : ''}">
        <div class="cg-gmain"><div class="n cg-mono" style="font-size:13px;${g.estado === 'anulada' ? ' text-decoration:line-through; color:var(--fg-3);' : ''}">${this.esc(g.id)}</div>
          <div class="s">${g.tipo === 'aumento' && g.aumento?.es_regularizacion ? 'Regularización por anexo'
            : g.tipo === 'aumento' && g.aumento?.es_ajuste ? 'Ajuste de tarifa / servicios'
            : g.tipo === 'aumento' && g.aumento?.contrato_papel && !g.aumento?.contrato_doc_id ? `Anexo a contrato en papel <span class="cg-mono">${this.esc(g.aumento.contrato_id || '')}</span>`
            : this.esc(GestionesService.tipoLabel(g.tipo))} · ${g.tipo === 'demo'
            ? this.esc((g.demo?.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`).join(', ') || '—')
            : g.tipo === 'aumento'
            ? this.esc([...(g.aumento?.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`),
                        ...(g.aumento?.cargos || []).map(c => `${c.cantidad} × ${c.concepto}`)].join(', ') || '—')
            : `${(g.items || []).length} serial(es)`} · ${fecha}${g.estado === 'anulada' && g.anulada_motivo ? ` · <i>${this.esc(g.anulada_motivo)}</i>` : ''}</div></div>
        <div class="cg-gside">
          ${atenuada ? '' : this._progHtml(done, defsG.length)}
          ${g.regularizacion_bloqueada ? `<span class="cg-chip cg-chip--bad" style="flex:none;" title="Las cantidades del anexo no coinciden con los seriales — no se aplicó">No aplicado</span>` : ''}
          ${this._chipCobro(g)}
          <span class="cg-chip cg-chip--estado-${this.esc(g.estado)}" style="flex:none;">${this.esc(
            // Las actualizaciones de seriales ya no se firman (2026-09-09): no
            // "esperan firma" (auditoría UX 2026-09-28).
            g.estado === 'pendiente_firma' && g.tipo === 'aumento' && g.aumento?.es_regularizacion
              ? 'Por aplicar (sin firma)' : GestionesService.estadoLabel(g.estado))}</span>
          ${this._masFila(g.id, this._accionesGestion(g), g.id)}
          <span class="arr">${abierta ? '▾' : '›'}</span>
        </div>
      </div>
      ${abierta ? this._detalleGestion(g) : ''}`;
    };

    // Jerarquía (2026-09-02, pedido de Alberto: "las anuladas toman casi la
    // misma precedencia que las pendientes"): lo VIVO arriba — ordenado por
    // urgencia (quién espera una acción) — y cerradas/anuladas plegadas como
    // historial atenuado, igual que el Histórico de contratos.
    const PESO = { pendiente_aprobacion: 0, pendiente_cliente: 1, pendiente_firma: 1, pendiente_bodega: 2, en_proceso: 3, retorno: 4, en_demo: 5 };
    const ts = (g) => (g.fecha_solicitud?.toDate ? g.fecha_solicitud.toDate().getTime() : 0);
    const todas = this.gestiones || [];
    const vivas = todas.filter(g => !['cerrada', 'anulada'].includes(g.estado))
      .sort((a, b) => ((PESO[a.estado] ?? 9) - (PESO[b.estado] ?? 9)) || (ts(b) - ts(a)));
    const historial = todas.filter(g => ['cerrada', 'anulada'].includes(g.estado))
      .sort((a, b) => (a.estado === 'anulada' ? 1 : 0) - (b.estado === 'anulada' ? 1 : 0) || (ts(b) - ts(a)));
    const cerradasN = historial.filter(g => g.estado === 'cerrada').length;
    const anuladasN = historial.length - cerradasN;
    const histAbierto = historial.some(g => g.id === this.gSel);
    cont.innerHTML = tramHtml
      + vivas.map(g => filaG(g, false)).join('')
      + dormHtml
      + (historial.length ? `
        <details ${histAbierto ? 'open' : ''} style="margin-top:10px;">
          <summary style="cursor:pointer; font-size:12.5px; color:var(--fg-3); padding:4px 2px; user-select:none;">
            Historial — ${cerradasN} cerrada${cerradasN === 1 ? '' : 's'}${anuladasN ? ` · ${anuladasN} anulada${anuladasN === 1 ? '' : 's'}` : ''}</summary>
          <div style="margin-top:8px;">${historial.map(g => filaG(g, true)).join('')}</div>
        </details>` : '');
  },

  // La asignación de seriales de bodega (aumento/demo/reemplazo) se hace en
  // Almacén · Asignar desde 2026-09-03 (propuesta "Asignar desde Almacén"):
  // mismo formulario que los contratos, picker del estante y política dura.
  // El expediente solo la MUESTRA y, a quien puede asignar, le da el enlace
  // desde el menú de acciones (_accionesGestion → "Asignar seriales en Almacén").

  // ¿Ese paso del checklist ya se cumplió? Normalmente lo dice `cierre`, pero
  // la APROBACIÓN de reemplazo/demo no se estampaba ahí (no es condición de
  // cierre: es la compuerta de entrada). Para las gestiones aprobadas antes de
  // 2026-09-10 el flag no existe y el estado es la prueba: si salió de
  // 'pendiente_aprobacion' sin anularse, alguien la aprobó.
  _pasoDone(g, k) {
    if (g.cierre?.[k] === true) return true;
    return k === 'aprobacion' && !['pendiente_aprobacion', 'anulada'].includes(g.estado);
  },

  // Chip de DINERO de un reemplazo (2026-09-25): la diferencia entre "se repone
  // gratis" y "se le cobra al cliente" tiene que verse sin abrir nada.
  _chipCobro(g) {
    if (g.tipo !== 'reemplazo') return '';
    // Antes de que administración decida, el cobro NO está decidido: decir
    // "Con cargo" ahí es adelantar una decisión que no se ha tomado.
    if (GestionesService.esReposicionDano(g) && g.estado === 'pendiente_aprobacion') {
      const ref = Number(g.cobro?.monto_referencia || 0);
      return `<span class="cg-chip cg-chip--warn" style="flex:none;" title="El taller reporta daño causado por el cliente: administración decide si se cobra">Daño · por decidir${ref ? ` (ref. $${ref.toFixed(2)})` : ''}</span>`;
    }
    if (GestionesService.cobraCargo(g)) {
      const m = Number(g.cobro?.monto || g.cobro?.monto_referencia || 0);
      const txt = g.cobro?.estado === 'cobranza' ? 'En cobranza' : `Con cargo${m ? ` $${m.toFixed(2)}` : ''}`;
      return `<span class="cg-chip cg-chip--warn" style="flex:none;" title="Reemplazo por daño causado por el cliente: se cotiza y se factura">${this.esc(txt)}</span>`;
    }
    if (GestionesService.esReposicionDano(g) && g.cobro?.estado === 'cortesia') {
      return `<span class="cg-chip" style="flex:none;" title="${this.esc(g.cobro?.cortesia?.motivo || 'Aprobado sin cargo')}">Daño · cortesía</span>`;
    }
    if (GestionesService.esReposicionDano(g)) {
      return `<span class="cg-chip cg-chip--warn" style="flex:none;" title="El taller reporta daño causado por el cliente">Daño · por decidir</span>`;
    }
    return `<span class="cg-chip" style="flex:none;" title="Reemplazo por garantía o falla: no se le cobra al cliente">Sin cargo</span>`;
  },

  // Los pasos que le tocan a ESTA gestión. El tipo manda, con las variantes
  // del aumento; y el paso de aprobación se pinta solo si la gestión lo lleva
  // (`aprobacion.requiere`), para no dejar un paso eternamente pendiente en
  // los reemplazos viejos que nacieron sin él.
  _defsGestion(g) {
    let defs = this.CIERRE_DEFS[g.tipo] || this.CIERRE_DEFS.reemplazo;
    // La regularización comparte flags con el aumento pero su historia es
    // otra: sin bodega, sin OS, tramo desde la firma.
    if (g.tipo === 'aumento' && g.aumento?.es_ajuste) defs = [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia', 'administracion'],
      ['firma', 'Anexo firmado por el cliente', 'Acepta los cargos / servicios nuevos', 'cliente_enlace'],
      ['derivacion', 'Cargos aplicados al contrato', 'Amarrados por serial cuando aplica', 'sistema'],
      ['asignacion', 'Sin bodega', 'No aplica: no hay equipos nuevos', 'sistema'],
      ['programacion', 'Sin orden de servicio', 'No aplica', 'sistema'],
      ['entrega', 'Ajuste completo', 'La tarifa mensual del contrato queda actualizada', 'sistema'],
    ];
    else if (g.tipo === 'aumento' && g.aumento?.es_regularizacion) defs = [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia', 'administracion'],
      ['firma', 'Aplicada sin firma del cliente', 'Los equipos ya estaban en su poder — no se le envía nada a firmar', 'cuenta'],
      ['derivacion', 'Líneas aplicadas al contrato', 'El tramo corre desde que se aplica', 'sistema'],
      ['asignacion', 'Seriales amarrados al contrato', 'Ya estaban en campo — sin pasar por bodega', 'sistema'],
      ['programacion', 'Sin orden de servicio', 'No aplica: nada que programar', 'sistema'],
      ['entrega', 'Regularización completa', 'Los sobrantes de la conciliación bajan a cero', 'sistema'],
    ];
    // Adenda a contrato EN PAPEL: mismo circuito del aumento, pero no hay
    // contrato interno al que aplicarle líneas — el tramo va a cada equipo.
    else if (g.tipo === 'aumento' && g.aumento?.contrato_papel && !g.aumento?.contrato_doc_id) defs = [
      ['aprobacion', 'Aprobación comercial', 'Administración / gerencia', 'administracion'],
      ['firma', 'Anexo firmado por el cliente', 'Cita el número del contrato en papel', 'cliente_enlace'],
      ['derivacion', 'Anexo registrado', 'Sin contrato en el sistema: nada que aplicar — la cuenta sigue por regularizar', 'sistema'],
      ['asignacion', 'Asignación de seriales', 'Bodega', 'bodega'],
      ['programacion', 'Programación', 'OS de programación confirmada', 'bodega'],
      ['entrega', 'Entrega al cliente', 'El tramo se estampa en cada equipo (custodia con vigencia propia)', 'bodega'],
    ];
    // Reemplazo / demo: la aprobación va DELANTE de todo. Sus CIERRE_DEFS no
    // la traen porque no es condición de cierre — es la compuerta antes de
    // bodega —, pero el vendedor tiene que ver que existe y dónde está parada.
    //
    // Dice ADMINISTRACIÓN, no "ventas" (Alberto 2026-09-10: *"ventas no es el
    // vendedor... el correo ventas le llega a los admin de la empresa, solo
    // tiene el nombre ventas"*). `ventas@cecomunica.com` es la dirección del
    // buzón; quien aprueba es administración. Un vendedor que lea "aprobación
    // de ventas" entiende que se la aprueba otro vendedor — que es él mismo.
    if (!defs.some(([k]) => k === 'aprobacion') && g.aprobacion?.requiere === true) {
      defs = [['aprobacion', 'Aprobación',
        GestionesService.esReposicionDano(g) ? 'Administración decide si se cobra y cuánto'
        : g.origen?.tipo === 'taller' ? 'El taller propone; administración decide'
          : 'Administración — antes de que Bodega asigne', 'administracion'], ...defs];
    }
    // Reposición por DAÑO con cargo: el cliente acepta el cobro ANTES de que
    // bodega asigne. Es un paso más, y va justo donde ocurre.
    if (GestionesService.cobraCargo(g)) {
      const i = defs.findIndex(([k]) => k === 'aprobacion');
      defs = [...defs.slice(0, i + 1),
        ['cotizacion', 'El cliente acepta el cobro', g.estado === 'pendiente_aprobacion'
          ? 'Solo si administración aprueba con cargo'
          : `Cotización ${g.cobro?.cotizacion_id || 'de la reposición'} — la anota el taller`, 'cliente'],
        ...defs.slice(i + 1)];
    }
    return defs;
  },

  _detalleGestion(g) {
    // Checklist como timeline del kit: done = completado; next = el paso que
    // sigue (todos los anteriores completos) — el ojo sabe dónde está parado.
    const defs = this._defsGestion(g);
    const check = `<div class="cg-tl">` + defs.map(([k, t, s, rol], i) => {
      const done = this._pasoDone(g, k);
      const next = !done && defs.slice(0, i).every(([kk]) => this._pasoDone(g, kk));
      const toca = next ? this._tocaLabel(rol) : '';
      // El paso de la firma se rotula con el expediente, no con la plantilla
      // (2026-09-10, caso GA20260909-03): una actualización de seriales se
      // aplica SIN firma y el checklist la daba por "Anexo firmado".
      const titulo = k === 'firma' && typeof GestionAutorizacion !== 'undefined'
        ? GestionAutorizacion.pasoFirma(g, !done) : t;
      const sub = k === 'firma' && done && typeof GestionAutorizacion !== 'undefined'
        && !GestionAutorizacion.texto(g).firmado
        ? 'Al cliente no se le envió nada a firmar' : s;
      return this._tlItem({ titulo, sub, done, next, toca });
    }).join('') + `</div>`;

    const ordenes = [
      ...((g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : []))
        .map(id => ({ id, tipo: 'PROGRAMACIÓN' }))),
      ...(g.ordenes?.devolucion_id ? [{ id: g.ordenes.devolucion_id, tipo: 'DEVOLUCIÓN' }] : []),
      ...(g.ordenes?.entrada_id ? [{ id: g.ordenes.entrada_id, tipo: 'ENTRADA' }] : []),
    ];
    const osHtml = ordenes.length
      ? `<div class="cg-os">${ordenes.map(o =>
          `<a href="../ordenes/editar-orden.html?id=${encodeURIComponent(o.id)}">
             <b>${o.tipo}</b>&nbsp;<span class="cg-mono">${this.esc(o.id)}</span></a>`).join('')}</div>`
      : '';

    let cuerpo = '';
    if (g.tipo === 'aumento') {
      const a = g.aumento || {};
      const total = (a.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = a.seriales_asignados || [];
      // Pre-asignación durante la firma (2026-09-03, planteamiento de Zuleika:
      // la firma no debe frenar la preparación): bodega puede asignar los
      // seriales del aumento desde que se aprueba comercialmente — la OS solo
      // sale cuando el anexo quede firmado (el trigger exige cierre.derivacion).
      // Con la OS ya creada (sale apenas la asignación se completa, aunque el
      // anexo siga en firma — 2026-09-03) los seriales dejan de editarse aquí:
      // pool y orden ya los tienen amarrados.
      const preAsignando = g.estado === 'pendiente_firma' && !a.es_ajuste && !a.es_regularizacion
        && !g.ordenes?.programacion_id;
      const asignando = this.puedeAsignar() && !g.ordenes?.programacion_id
        && (g.estado === 'pendiente_bodega' || preAsignando);
      cuerpo = `
        ${a.es_ajuste ? `<p style="font-size:12.5px; margin:0 0 8px; color:var(--fg-3);">
          <b>Anexo de ajuste de tarifa / servicios</b> — sin equipos nuevos;
          al firmarse se aplica al contrato y cierra solo, sin bodega ni entrega.</p>
          ${(a.ajustes_precio || []).length ? `<p style="font-size:12.5px; margin:0 0 8px;">
            <b>Tarifas renegociadas:</b> ${a.ajustes_precio.map(x =>
              `${this.esc(x.modelo)} <span class="num">$${Number(x.precio_anterior).toFixed(2)} → $${Number(x.precio_nuevo).toFixed(2)}</span>`).join(' · ')}</p>` : ''}` : ''}
        ${g.regularizacion_bloqueada ? `<div class="cg-senal bad" style="margin-bottom:10px;">
          <span><b>El anexo no se aplicó:</b> ${this.esc(g.regularizacion_bloqueada.motivo || 'las cantidades no coinciden con los seriales')}.
          Un anexo de regularización solo cubre equipos que el cliente ya tiene; los radios nuevos van en un aumento aparte.
          Anula esta gestión y créala de nuevo desde "Nueva gestión".</span></div>` : ''}
        ${a.es_regularizacion ? `<p style="font-size:12.5px; margin:0 0 8px; color:var(--fg-3);">
          <b>Anexo de regularización</b> — amarra equipos que el cliente ya tiene
          (<span class="cg-mono">${(a.regulariza_seriales || []).map(s => this.esc(s.serial)).join(', ')}</span>);
          al firmarse se aplica y cierra solo, sin bodega ni entrega.</p>` : ''}
        ${a.contrato_papel && !a.contrato_doc_id ? `<div class="cg-senal warn" style="margin:0 0 8px;">
          <span><b>Anexo a contrato en papel</b> — el contrato marco <span class="cg-mono">${this.esc(a.contrato_id || '—')}</span>
          no está en el sistema. Al entregarse, cada equipo queda en <b>custodia con su tramo propio</b>;
          la cuenta sigue <b>pendiente de regularizar</b> (contrato nuevo cuando se pueda).</span></div>` : ''}
        <p style="font-size:13px; margin:0 0 8px;"><b>${a.contrato_papel && !a.contrato_doc_id ? 'Contrato en papel' : 'Contrato destino'}:</b>
          <span class="cg-mono">${this.esc(a.contrato_id || '—')}</span> ·
          <b>Vigencia:</b> ${a.es_ajuste
            ? `rige con el contrato${a.duracion_meses ? ` (${this.esc(String(a.duracion_meses))} meses)` : ''}`
            : `tramo de ${this.esc(String(a.duracion_meses || '?'))} meses ${a.es_regularizacion ? 'desde la firma' : 'desde la entrega'}`}</p>
        <div class="cg-twrap"><table class="cg-tabla"><thead><tr>
          <th>Cant.</th><th>Modelo</th><th>Precio/mes</th></tr></thead><tbody>
          ${(a.lineas || []).map(l => `<tr><td class="num">${Number(l.cantidad || 0)}</td>
            <td>${this.esc(l.modelo || '—')}</td><td class="num">$${Number(l.precio || 0).toFixed(2)}</td></tr>`).join('')}
          ${(a.cargos || []).map(c => `<tr><td class="num">${Number(c.cantidad || 0)}</td>
            <td style="color:var(--fg-3);">${this.esc(c.concepto || '—')} <span class="cg-venc ${c.recurrente ? 'vigente' : 'por_vencer'}" style="font-size:10.5px;">${c.recurrente ? 'mensual' : 'único'}</span>
              ${(c.seriales || []).length ? `<div class="cg-mono" style="font-size:11px; color:var(--fg-4);">${c.seriales.map(s => this.esc(s)).join(', ')}</div>` : ''}</td>
            <td class="num">$${Number(c.monto || 0).toFixed(2)}</td></tr>`).join('')}
        </tbody></table></div>
        ${a.totales ? `<p style="font-size:13px; margin:8px 0 0;">
          <b>Total mensual:</b> <span class="num">$${Number(a.totales.total_mensual || 0).toFixed(2)}</span>
          ${a.totales.itbms_aplica ? `<span style="color:var(--fg-4);">(inc. ITBMS ${(a.totales.itbms_porcentaje * 100).toFixed(0)}%)</span>` : '<span style="color:var(--fg-4);">(ITBMS exento)</span>'}
          ${a.totales.cargos_uni ? ` · <b>Primer pago:</b> <span class="num">$${Number(a.totales.primer_pago || 0).toFixed(2)}</span>` : ''}</p>` : ''}
        ${g.anexo_firmado_path ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:8px 0 0;">✓ Anexo firmado registrado (${this.esc(g.anexo_firmado_por || '')})
          <button class="btn btn-ghost cg-act" onclick="Centro.verAnexo('${this.esc(g.anexo_firmado_path)}')">Ver anexo</button></p>` : ''}
        ${g.anexo_firma_digital ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:8px 0 0;">
          ✓ Anexo firmado <b>digitalmente</b> por ${this.esc(g.anexo_firma_digital.firmante_nombre || '—')}
          (cédula ${this.esc(g.anexo_firma_digital.firmante_cedula || '—')})
          <button class="btn btn-ghost cg-act" onclick="Centro.verFirmaGestion('${this.esc(g.id)}')">Ver la firma</button></p>` : ''}
        ${g.sin_firma ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">✓ Regularización cerrada
          <b>sin firma del cliente</b> por ${this.esc(g.sin_firma.por_email || '—')}${g.sin_firma.motivo ? ` — ${this.esc(g.sin_firma.motivo)}` : ''}</p>` : ''}
        ${g.firma_solicitud_estado === 'pendiente' ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">
          Enlace de firma enviado — esperando al cliente. Se reenvía o se retira desde <b>Acciones</b>.</p>` : ''}
        ${g.firma_pendiente_validacion ? `
          <div class="cg-senal warn" style="margin-top:8px;">
            <span>Anexo firmado por persona <b>distinta al representante</b> — falta validar al firmante
              (<b>Acciones › Aceptar al firmante</b>).</span></div>` : ''}
        ${asignados.length ? `<p style="font-size:13px; margin:8px 0 0;"><b>Seriales:</b>
              ${asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')}
              ${total > asignados.length ? `<span style="color:var(--fg-3);">· ${asignados.length} de ${total}</span>` : ''}</p>` : ''}
        ${asignando
          ? `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">Bodega asigna los seriales desde
               <b>Almacén · Asignar</b> (Acciones ›).${preAsignando ? ' La firma del anexo corre <b>en paralelo</b> — la orden de programación saldrá sola al firmarse.' : ''}</p>`
          : ''}`;
    } else if (g.tipo === 'baja') {
      const pen = g.penalidad_estimada;
      const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
      const cartaHtml = g.carta_path
        ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:0 0 8px;">✓ Carta del cliente adjunta${g.fecha_nota_cliente ? ` (nota del ${this.esc(g.fecha_nota_cliente)})` : ''}
             <button class="btn btn-ghost cg-act" onclick="Centro.verAnexo('${this.esc(g.carta_path)}')">Ver carta</button></p>`
        : `<div class="cg-senal warn" style="margin:0 0 8px;">
             <span><b>Falta la carta de solicitud del cliente</b> — la aprobación queda bloqueada hasta adjuntarla
               (<b>Acciones › Subir la carta del cliente</b>).</span></div>`;
      cuerpo = (esTerm ? `<div class="cg-senal bad" style="margin:0 0 8px;"><span><b>TERMINACIÓN TOTAL</b> — se desconectan todos los seriales del contrato.</span></div>` : '')
        + cartaHtml
        + `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Serial</th><th>Modelo</th><th>Contrato</th><th>Motivo</th><th>Fin de facturación</th>
        </tr></thead><tbody>
        ${(g.items || []).map(it => `<tr>
          <td class="cg-mono">${this.esc(it.serial_saliente || it.serial || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td>
          <td style="font-size:12.5px;">${this.esc(it.motivo_detalle || it.motivo_codigo || '—')}</td>
          <td class="num" style="font-size:12.5px;">${this.esc(it.fecha_fin_facturacion || g.fecha_fin_facturacion || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
        ${pen?.por_contrato?.length ? `
          <p style="font-size:13px; margin:10px 0 4px;"><b>Liquidación estimada por contrato — 3 meses en cualquier caso</b>
            <span style="color:var(--fg-4);">(vencido: 60 días de preaviso con servicio activo + 30 de penalidad · cobro inmediato)</span></p>
          ${pen.por_contrato.map(p => `<div style="display:flex; gap:10px; font-size:13px; padding:3px 0;">
            <span class="cg-mono">${this.esc(p.contrato_id || '—')}</span>
            <span style="color:var(--fg-3);">${this.esc(p.detalle || '')}</span>
            <b style="margin-left:auto;" class="num">$${Number(p.monto || 0).toFixed(2)}</b></div>`).join('')}
          <div style="display:flex; font-size:13.5px; border-top:1px solid var(--border-subtle); padding-top:5px; margin-top:3px;">
            <b>Total estimado</b><b style="margin-left:auto;" class="num">$${Number(pen.total || 0).toFixed(2)}</b></div>` : ''}`;
    } else if (g.tipo === 'reemplazo') {
      const asignando = this.puedeAsignar() && g.estado === 'pendiente_bodega';
      // DAÑO causado por el cliente (2026-09-25): qué se rompió, las fotos y
      // el dinero — es lo que administración mira para decidir si se cobra.
      const esDano = GestionesService.esReposicionDano(g);
      const cb = g.cobro || {};
      const EST_COBRO = {
        por_aprobar: 'Por decidir (administración)', por_cotizar: 'Armando la cotización…',
        cotizada: 'Cotización con el cliente', aceptada: 'El cliente aceptó — en facturación',
        cobranza: 'El cliente no aceptó — en cobranza', cortesia: 'Sin cargo (cortesía)',
      };
      const danoBox = esDano ? `
        <div class="cg-senal warn" style="margin:0 0 10px; display:block;">
          <div style="font-size:12.5px; font-weight:700;">Daño causado por el cliente · ${this.esc(this.TIPOS_DANO[g.dano?.tipo] || g.dano?.tipo || 'daño físico')}</div>
          <div style="display:flex; flex-wrap:wrap; gap:6px 16px; font-size:13px; margin-top:6px;">
            <span>Valor de reposición (catálogo): <b class="num">${cb.monto_referencia ? '$' + Number(cb.monto_referencia).toFixed(2) : 'sin precio'}</b></span>
            ${cb.monto ? `<span>Se cobra: <b class="num">$${Number(cb.monto).toFixed(2)}</b> + ITBMS</span>` : ''}
            <span>Cobro: <b>${this.esc(EST_COBRO[cb.estado] || cb.estado || '—')}</b></span>
            ${cb.cotizacion_doc_id ? `<a href="../cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(cb.cotizacion_doc_id)}">Cotización ${this.esc(cb.cotizacion_id || '')}</a>` : ''}
          </div>
          ${cb.cortesia?.motivo ? `<div style="font-size:12.5px; margin-top:4px;">Cortesía: ${this.esc(cb.cortesia.motivo)}</div>` : ''}
          ${(g.dano?.fotos || []).length ? `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
            ${(g.dano.fotos || []).map((p, i) => `<button class="btn btn-ghost btn-sm cg-act" onclick="event.stopPropagation(); Centro.verAnexo('${this.esc(p)}')"><i data-lucide="camera"></i> Foto ${i + 1}</button>`).join('')}
          </div>` : ''}
        </div>` : '';
      // Propuesta del TALLER (2026-09-09): el diagnóstico va PRIMERO — es lo
      // que se lee para decidir. Sin esto, ventas aprobaría a ciegas.
      const taller = g.origen?.tipo === 'taller' ? `
        <div class="cg-senal info" style="margin:0 0 10px; display:block;">
          <div style="font-size:12.5px; color:var(--fg-3);">Propuesta del taller ·
            ${this.esc(g.origen.tecnico_email || g.responsable_email || '—')} ·
            orden <span class="cg-mono">${this.esc(g.origen.orden_id || '—')}</span></div>
          <div style="font-size:13.5px; margin-top:4px;">${this.esc(g.origen.diagnostico || '—')}</div>
          <div style="font-size:12.5px; color:var(--fg-3); margin-top:4px;">
            ${(g.items || []).every(it => it.saliente_en_casa)
              ? 'Los radios ya están en CECOMUNICA — no se abrirá orden de devolución.'
              : 'Los radios siguen donde el cliente — al entregar el reemplazo se abre sola la devolución.'}</div>
        </div>` : '';
      cuerpo = taller + danoBox + `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
        <th>Sale</th><th>Modelo</th><th>Entra</th><th>Modelo solicitado</th><th>Motivo</th><th>Contrato</th>
        </tr></thead><tbody>
        ${(g.items || []).map((it, ix) => `<tr>
          <td class="cg-mono">${this.esc(it.serial_saliente || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td><span class="cg-mono">${this.esc(it.serial_nuevo || 'pendiente')}</span>${this._modeloEntroHtml(g, it)}</td>
          <td>${this.esc(it.modelo_solicitado || it.modelo || '—')}</td>
          <td style="font-size:12.5px;">${this.esc(it.motivo_detalle || it.motivo_codigo || '—')}
            ${it.elegibilidad === 'propio_excepcion' ? '<br><span class="cg-venc por_vencer">excepción serv. cliente</span>' : ''}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td>
        </tr>`).join('')}</tbody></table></div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0 0;">
          <button class="btn btn-ghost cg-act" onclick="Centro.jsonReemplazoRecepcion('${this.esc(g.id)}')"
            title="Descarga el nombre, los grupos y el GPS de cada radio que sale, en el formato que carga el lote de POC">
            <i data-lucide="download"></i> JSON para recepción</button>
          <span style="font-size:12px; color:var(--fg-3);">Lo que cada radio nuevo debe heredar del que sustituye.
            Recepción también puede jalarlo sola desde el lote de POC — esto es para mandárselo por adelantado.</span>
        </div>
        ${asignando ? `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">Bodega elige en
          <b>Almacén · Asignar</b> (Acciones ›) la unidad que sustituye a cada radio.
          Al completar todos, el sistema crea la OS de programación y avisa a Recepción.</p>` : ''}`;
    } else if (g.tipo === 'cambio_serial') {
      // Lo primero que hay que dejar claro es lo que NO es: nadie tiene que ir
      // a buscar un radio. El equipo está donde tiene que estar; lo que está
      // mal es el registro. Sin esta línea, bodega lo lee como un reemplazo.
      const enBodega = this.puedeAsignar() && g.estado === 'pendiente_bodega';
      const props = (g.items || []).filter(it => it.serial_nuevo && !g.cierre?.derivacion).length;
      cuerpo = `
        <div class="cg-senal info" style="margin:0 0 10px;">
          <span><b>Corrección de registro.</b> El equipo ya está donde tiene que estar —
          lo que está mal es el serial anotado. No sale nada del estante ni hay que recoger ningún radio.</span></div>
        <div class="cg-twrap"><table class="cg-tabla"><thead><tr>
          <th>Figura en el sistema</th><th>Modelo</th><th>Serial real</th><th>Contrato</th><th>Motivo</th>
          </tr></thead><tbody>
          ${(g.items || []).map(it => `<tr>
            <td class="cg-mono" style="${g.cierre?.derivacion ? 'color:var(--fg-3); text-decoration:line-through;' : ''}">${this.esc(it.serial || '—')}</td>
            <td>${this.esc(it.modelo || '—')}</td>
            <td class="cg-mono">${it.serial_nuevo
              ? `${this.esc(it.serial_nuevo)}${g.cierre?.derivacion ? '' : ' <span style="color:var(--fg-4); font-family:inherit; font-size:11.5px;">(por confirmar)</span>'}`
              : '<span style="color:var(--fg-3); font-family:inherit;">pendiente de bodega</span>'}</td>
            <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || 'sin contrato')}</td>
            <td style="font-size:12.5px;">${this.esc(it.motivo_detalle || this.MOTIVOS_CAMBIO_SERIAL_LABEL[it.motivo_codigo] || it.motivo_codigo || '—')}</td>
          </tr>`).join('')}</tbody></table></div>
        ${g.cierre?.derivacion ? `<p style="font-size:12.5px; color:var(--ok-deep, #17714B); margin:10px 0 0;">
          ✓ Corrección aplicada al contrato y al pool. El serial que estaba mal volvió al estante marcado
          <b>verificar físicamente</b>, y activaciones recibió el aviso.</p>` : ''}
        ${enBodega ? `<p style="font-size:12.5px; color:var(--fg-3); margin:10px 0 0;">
          Bodega confirma el serial contra el radio en <b>Almacén · Asignar</b> (Acciones ›)${props
    ? ` — ${props === 1 ? 'ya viene propuesto' : `ya vienen ${props} propuestos`}, solo hay que verificarlo.` : '.'}
          Al guardarlo, la corrección se aplica sola y la gestión cierra.</p>` : ''}`;
    } else {
      const total = (g.demo?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = g.demo?.seriales_asignados || [];
      const asignando = this.puedeAsignar() && g.estado === 'pendiente_bodega';
      cuerpo = `
        <p style="font-size:13px; margin:0 0 8px;"><b>Finalidad:</b> ${this.esc(g.demo?.finalidad || '—')} ·
          <b>Salida:</b> ${this.esc(g.demo?.fecha_salida || '—')} ·
          <b>Devolución estimada:</b> ${this.esc(g.demo?.fecha_devolucion_estimada || 'sin fecha')}</p>
        <p style="font-size:13px; margin:0;"><b>Seriales:</b> ${asignados.length
              ? asignados.map(s => `<span class="cg-mono">${this.esc(s.serial)}</span>`).join(', ')
                + (total > asignados.length ? ` <span style="color:var(--fg-3);">· ${asignados.length} de ${total}</span>` : '')
              : 'pendiente de bodega'}</p>
        ${asignando
          ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">Stock nuevo o refurbished, de bodega —
               se asigna en <b>Almacén · Asignar</b> (Acciones ›).</p>`
          : ''}`;
    }

    let aprobacion = '';
    if (g.estado === 'pendiente_aprobacion') {
      const esBaja = g.tipo === 'baja';
      const esAumento = g.tipo === 'aumento';
      // Actualización de seriales (antes "anexo de regularización"): NO pasa
      // por firma — Alberto 2026-09-09: "ese camino vamos a hacerlo sin firma
      // solamente, ya que si vamos a firmar será un contrato". Se aplica al
      // aprobarse: el contrato gana las líneas y los seriales se amarran.
      const esActSeriales = esAumento && g.aumento?.es_regularizacion === true;
      const puede = (esBaja || esAumento) ? this.puedeAprobarBaja() : this.puedeAprobar();
      const fnAprobar = esBaja ? 'aprobarBajaGestion'
        : esActSeriales ? 'aprobarActualizacionSeriales'
        : esAumento ? 'aprobarAumentoGestion' : 'aprobarGestion';
      // La baja no se aprueba sin la carta del cliente (pedido 2026-08-27).
      const sinCarta = esBaja && !g.carta_path;
      const cambiosModelo = GestionesService.cambiosModeloPendientes(g);
      aprobacion = cambiosModelo.length ? `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span><b>Bodega asignó otro modelo.</b> El reemplazo se aprobó con
             ${cambiosModelo.map(p => `<b>${this.esc(p.de || '—')}</b> y entró <b>${this.esc(p.a || '—')}</b> <span class="cg-mono">${this.esc(p.serial || '')}</span>`).join('; ')}.
             No se programa hasta que administración decida en Acciones si lo acepta y si la tarifa del cliente se mantiene.</span>
           </div>` : `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span>${esBaja
             ? 'Baja esperando aprobación (una sola, con el desglose por contrato a la izquierda).'
             : esActSeriales
               ? 'Actualización de seriales esperando aprobación — al aprobar se aplica de una vez: el contrato gana las líneas, los seriales se amarran y no se le envía nada al cliente.'
             : esAumento
               ? 'Aumento esperando aprobación de administración — al aprobar, se imprime el anexo para la firma del cliente.'
               : GestionesService.esReposicionDano(g)
                 ? 'El taller reporta DAÑO CAUSADO POR EL CLIENTE. Decide en Acciones: con cargo (fijas el monto; se arma la cotización y Bodega espera a que el cliente acepte), sin cargo como cortesía (con motivo), o anular para rechazar.'
               : g.origen?.tipo === 'taller'
                 ? 'El taller propone este reemplazo y espera la decisión de administración. Al aprobar, Bodega recibe el aviso para asignar el equipo que sustituye a cada radio (mismo modelo).'
                 : g.aprobacion?.motivo === 'propio_excepcion' || (g.items || []).some(it => it.elegibilidad === 'propio_excepcion')
                   ? 'Excepción por servicio al cliente (equipo propio sin garantía) — la decide administración antes de que Bodega asigne.'
                   : 'Reemplazo esperando la aprobación de administración. Al aprobar, Bodega recibe el aviso para asignar el equipo que sustituye a cada radio.'}</span>
           </div>`;
      void puede; void fnAprobar; void sinCarta;
    } else if (g.estado === 'pendiente_cliente') {
      aprobacion = `<div class="cg-senal info" style="margin:10px 0 0;">
           <span><b>Esperando la respuesta del cliente.</b> La cotización de la reposición
             ${g.cobro?.cotizacion_id ? `<b>${this.esc(g.cobro.cotizacion_id)}</b> ` : ''}la envía la jefatura de taller.
             Cuando el cliente conteste —por correo o de palabra— se anota en la cotización con
             <b>Respuesta del cliente</b>: si acepta, Bodega recibe el aviso; si no, el caso se cierra y pasa a cobranza.
             Si no contesta, administración lo pasa a cobranza desde Acciones.</span></div>`;
    } else if (g.estado === 'cerrada' && g.resultado === 'sin_reemplazo_cobranza') {
      aprobacion = `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span><b>Cerrada sin reemplazo.</b> El cliente no aceptó la reposición: el daño quedó en cobranza
             ($${Number(g.cobro?.monto || 0).toFixed(2)} + ITBMS).${g.cerrada_motivo ? ` ${this.esc(g.cerrada_motivo)}` : ''}</span></div>`;
    } else if (g.estado === 'pendiente_firma' && g.tipo === 'aumento' && g.aumento?.es_regularizacion === true) {
      aprobacion = `<div class="cg-senal warn" style="margin:10px 0 0;">
           <span><b>Quedó esperando firma de antes.</b> Las actualizaciones de seriales ya no se firman
             (2026-09-09): dale <b>Aplicar sin firma</b> y el contrato gana las líneas de una vez.</span></div>`;
    } else if (g.estado === 'pendiente_firma' && g.tipo === 'aumento') {
      aprobacion = `<div class="cg-senal info" style="margin:10px 0 0;">
           <span><b>Esperando la firma del cliente.</b> Imprime el anexo (deja explícito el período propio
             del equipo nuevo), recoge la firma y sube el archivo firmado. La preparación corre
             <b>en paralelo</b>: bodega asigna y la orden de programación sale sola — la firma solo
             frena la <b>entrega</b>.</span>
           </div>`;
    }
    // Pie del expediente: el siguiente paso y "Acciones ⋯" — la MISMA lista
    // del "⋯" de la fila. Nada de botoneras por estado repartidas por el
    // cuerpo (M.A.M. PROTECTION, 2026-09-09).
    const fEd = g.editada?.at?.toDate ? g.editada.at.toDate().toLocaleDateString('es-PA') : '';
    const editada = g.editada
      ? `<span style="font-size:12px; color:var(--fg-3);">✎ Corregida por ${this.esc(g.editada.por_email || '—')}${fEd ? ` el ${fEd}` : ''}</span>` : '';
    const pie = `<div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:10px;">
           <span style="margin-right:auto;">${editada}</span>
           ${this._pieAcciones('dg-' + g.id, this._accionesGestion(g))}</div>`;

    return `<div class="ds-card" style="padding:var(--sp-4); margin:-4px 0 10px; border-top:none;">
      <div class="cg-exp">
        <div>${cuerpo}${osHtml}</div>
        <div>${check}${aprobacion}</div>
      </div>
      ${pie}
    </div>`;
  },

  /* ── Acciones sobre el expediente ── */

  // Reemplazo por DAÑO — con cargo: el monto parte del valor de reposición del
  // catálogo (decisión de Alberto, 2026-09-25) y administración lo puede
  // ajustar. Sin precio en el catálogo, lo escribe.
  aprobarConCargoGestion(gid) {
    return this._candado('aprobarConCargoGestion:' + gid, () => this._aprobarConCargoGestion(gid), 'Aprobando…');
  },
  async _aprobarConCargoGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid) || await GestionesService.get(gid);
    const ref = Number(g?.cobro?.monto_referencia || 0);
    const it = (g?.items || [])[0] || {};
    const v = await Modal.prompt({
      title: 'Aprobar con cargo',
      // Modal.prompt escapa el mensaje: texto plano.
      message: `Reposición del radio ${it.serial_saliente || '—'} (${it.modelo || '—'}). `
        + (ref ? `Valor de reposición del catálogo: $${ref.toFixed(2)}. ` : 'El modelo no tiene precio en el catálogo: escribe el monto. ')
        + 'Monto a cobrar SIN ITBMS (la cotización lo suma si aplica):',
      defaultValue: ref ? ref.toFixed(2) : '',
      confirmLabel: 'Aprobar con este monto',
    });
    if (v === null || v === undefined) return;
    const monto = Number(String(v).replace(/[^0-9.]/g, ''));
    if (!(monto > 0)) { Toast.show('Escribe un monto mayor que cero', 'warn'); return; }
    try {
      await GestionesService.aprobarConCargo(gid, monto);
      Toast.show('Aprobada con cargo — se arma la cotización para la jefatura de taller', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar: ' + (e?.message || e), 'bad'); }
  },

  // Bajo el serial que entró: su modelo real si no es el solicitado, y lo que
  // administración decidió (la tarifa) — lo que queda para leer meses después.
  _modeloEntroHtml(g, it) {
    if (!it.serial_nuevo || !it.modelo_nuevo) return '';
    const pedido = it.modelo_solicitado || it.modelo || '';
    // Mismo criterio que el asignador y el servidor: N/R de una familia es el mismo modelo.
    if (EquiposPoolService._mismoModelo({ modelo_id: it.modelo_id_nuevo, modelo_label: it.modelo_nuevo },
      it.modelo_solicitado_id || it.modelo_id || null, pedido)) return '';
    const clave = EquiposPoolService.normalizarSerial(it.serial_nuevo);
    const d = (g.cambio_modelo || {})[clave];
    const dec = !d ? '' : d.estado === 'aprobado'
      ? ` · aprobado${d.decidido_por_email ? ` por ${this.esc(d.decidido_por_email.split('@')[0])}` : ''} · tarifa ${d.tarifa === 'se_ajusta' ? 'se ajusta' : 'se mantiene'}`
      : d.estado === 'rechazado' ? ' · rechazado' : d.estado === 'pendiente' ? ' · por aprobar' : '';
    return `<div style="font-size:12px; color:#92400E;">es ${this.esc(it.modelo_nuevo)}${dec}</div>`;
  },

  // CAMBIO DE MODELO (2026-09-29): bodega puso un radio de otro modelo y la
  // gestión volvió aquí. Aprobar pide qué pasa con la tarifa del cliente —es
  // la pregunta que nadie se hacía—; rechazar pide el motivo y bodega recibe
  // el aviso de poner otro radio.
  aprobarCambioModelo(gid) {
    return this._candado('cambioModelo:' + gid, () => this._decidirCambioModelo(gid, true), 'Aprobando…');
  },
  rechazarCambioModelo(gid) {
    return this._candado('cambioModelo:' + gid, () => this._decidirCambioModelo(gid, false), 'Rechazando…');
  },
  _tablaCambioModelo(pend) {
    const t = (n) => (n == null ? '<span style="color:var(--fg-3);">sin línea en el contrato</span>' : `$${Number(n).toFixed(2)}/mes`);
    return `<div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; margin:0 0 12px;">
      <table style="border-collapse:collapse; width:100%; font-size:13px;">
        <thead><tr style="text-align:left; color:var(--fg-3);">
          <th style="padding:6px 10px;">Aprobado</th><th style="padding:6px 10px;">Asignado por bodega</th><th style="padding:6px 10px;">Tarifa hoy</th></tr></thead>
        <tbody>${pend.map(p => `<tr>
          <td style="padding:6px 10px; border-top:1px solid var(--border);">${this.esc(p.de || '—')}
            ${p.saliente ? `<div class="cg-mono" style="color:var(--fg-3); font-size:12px;">sale ${this.esc(p.saliente)}</div>` : ''}</td>
          <td style="padding:6px 10px; border-top:1px solid var(--border);"><b>${this.esc(p.a || '—')}</b>
            <div class="cg-mono" style="font-size:12px;">${this.esc(p.serial || '')}</div>
            ${p.motivo ? `<div style="color:var(--fg-3); font-size:12px;">Bodega: ${this.esc(p.motivo)}</div>` : ''}</td>
          <td style="padding:6px 10px; border-top:1px solid var(--border); font-size:12.5px;">
            ${this.esc(p.de || '')}: ${t(p.tarifa_de)}<br>${this.esc(p.a || '')}: ${t(p.tarifa_a)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  },
  async _decidirCambioModelo(gid, aprobar) {
    const g = await GestionesService.get(gid);
    const pend = GestionesService.cambiosModeloPendientes(g);
    if (!pend.length) { Toast.show('Esta gestión ya no tiene un cambio de modelo esperando', 'warn'); await this.recargarGestiones(); return; }
    const r = await Modal.sheet({
      title: aprobar ? 'Aprobar el cambio de modelo' : 'Rechazar el cambio de modelo',
      icon: aprobar ? 'check' : 'x', size: 'md',
      html: `${this._tablaCambioModelo(pend)}
        ${aprobar ? `
        <p style="margin:0 0 6px; font-size:13px;"><b>¿Qué pasa con la tarifa del cliente?</b></p>
        <label style="display:flex; gap:8px; align-items:flex-start; font-size:13px; margin:0 0 6px;">
          <input type="radio" name="cmTarifa" value="se_mantiene" checked> <span><b>Se mantiene</b> — el cliente sigue pagando lo mismo.</span></label>
        <label style="display:flex; gap:8px; align-items:flex-start; font-size:13px; margin:0 0 10px;">
          <input type="radio" name="cmTarifa" value="se_ajusta"> <span><b>Se ajusta</b> — el cambio de precio se hace aparte, con una gestión de <b>Ajuste de tarifa</b>.</span></label>
        <textarea id="cmNota" class="form-input" rows="2" style="width:100%;" placeholder="Nota (obligatoria si se ajusta)"></textarea>
        <p style="margin:8px 0 0; font-size:12.5px; color:var(--fg-3);">Al aprobar, la OS de programación sale sola.</p>`
        : `<textarea id="cmNota" class="form-input" rows="2" style="width:100%;" placeholder="Motivo del rechazo (obligatorio) — lo recibe bodega"></textarea>
        <p style="margin:8px 0 0; font-size:12.5px; color:var(--fg-3);">Bodega recibe el aviso de asignar un radio del modelo aprobado.</p>`}`,
      buttons: [
        { action: 'cancel', label: 'Volver' },
        { action: 'confirm', label: aprobar ? 'Aprobar' : 'Rechazar', primary: true, danger: !aprobar },
      ],
      onAction: (action, root) => {
        if (action !== 'confirm') return null;
        const tarifa = aprobar ? (root.querySelector('input[name="cmTarifa"]:checked')?.value || null) : null;
        const nota = root.querySelector('#cmNota')?.value.trim() || '';
        if ((!aprobar || tarifa === 'se_ajusta') && nota.length < 5) {
          Toast.show(aprobar ? 'Escribe la nota del ajuste' : 'Escribe el motivo del rechazo', 'warn');
          return false;
        }
        return { tarifa, nota };
      },
    });
    if (!r || typeof r !== 'object') return;
    try {
      await GestionesService.decidirCambioModelo(gid, { aprobar, tarifa: r.tarifa, nota: r.nota });
      Toast.show(aprobar ? 'Cambio de modelo aprobado — la OS de programación sale sola' : 'Rechazado — bodega recibirá el aviso', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo guardar la decisión: ' + (e?.message || e), 'bad'); }
  },

  aprobarSinCargoGestion(gid) {
    return this._candado('aprobarSinCargoGestion:' + gid, () => this._aprobarSinCargoGestion(gid), 'Aprobando…');
  },
  async _aprobarSinCargoGestion(gid) {
    const motivo = await Modal.prompt({
      title: 'Aprobar sin cargo (cortesía)',
      message: 'El radio se repone GRATIS aunque el daño lo causó el cliente. ¿Por qué? Queda en el expediente.',
      placeholder: 'Ej.: cliente grande en renovación; primer incidente en 3 años',
      multiline: true,
      confirmLabel: 'Aprobar sin cargo',
    });
    if (motivo === null || motivo === undefined) return;
    if (String(motivo).trim().length < 5) { Toast.show('Escribe el motivo de la cortesía', 'warn'); return; }
    try {
      await GestionesService.aprobarSinCargo(gid, motivo);
      Toast.show('Aprobada sin cargo — Bodega recibirá el aviso para asignar', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar: ' + (e?.message || e), 'bad'); }
  },

  // La salida para que el caso no quede colgando (Alberto, 2026-09-25): el
  // cliente no contesta o no va a pagar. Se registra como la respuesta de la
  // cotización ("no aceptó") — el MISMO camino que si lo anotara el taller —
  // y el trigger cierra la gestión y abre la deuda en cobranza.
  async cobranzaReposicion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid) || await GestionesService.get(gid);
    const cot = g?.cobro?.cotizacion_doc_id;
    if (!cot) { Toast.show('La cotización todavía se está armando', 'warn'); return; }
    const motivo = await Modal.prompt({
      title: 'Pasar a cobranza',
      message: `No se repone el radio. La gestión se cierra y el daño ($${Number(g.cobro?.monto || 0).toFixed(2)} + ITBMS) queda abierto en cobranza. ¿Qué pasó?`,
      placeholder: 'Ej.: sin respuesta en 15 días; el cliente dice que no va a pagar',
      multiline: true,
      confirmLabel: 'Pasar a cobranza',
    });
    if (motivo === null || motivo === undefined) return;
    if (String(motivo).trim().length < 5) { Toast.show('Escribe qué pasó — queda en el expediente', 'warn'); return; }
    try {
      await firebase.firestore().collection('cotizaciones').doc(cot).update({
        estado: 'rechazada',
        fecha_rechazo: firebase.firestore.Timestamp.now(),
        rechazado_por_uid: firebase.auth().currentUser?.uid || null,
        cierre_motivo: String(motivo).trim().slice(0, 300),
      });
      await GestionesService.registrarEvento(gid, 'cobranza_manual', `Pasado a cobranza por administración: ${String(motivo).trim()}`);
      Toast.show('Pasa a cobranza — la gestión se cierra en unos segundos', 'ok');
      setTimeout(() => this.recargarGestiones(), 2500);
    } catch (e) { console.error(e); Toast.show('No se pudo: ' + (e?.message || e), 'bad'); }
  },

  aprobarGestion(gid) {
    return this._candado('aprobarGestion:' + gid, () => this._aprobarGestion(gid), 'Aprobando…');
  },
  async _aprobarGestion(gid) {
    try {
      await GestionesService.aprobar(gid);
      Toast.show('Aprobada — Bodega recibirá el aviso para asignar', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar', 'bad'); }
  },

  async verAnexo(path) {
    try {
      const url = await GestionesService.urlAnexo(path);
      window.open(url, '_blank');
    } catch (e) { console.error(e); Toast.show('No se pudo abrir el anexo', 'bad'); }
  },

  async subirCarta(gid, file) {
    if (!file) return;
    try {
      Toast.show('Subiendo carta…', '');
      await GestionesService.subirCartaBaja(gid, file);
      Toast.show('Carta adjuntada', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo subir la carta', 'bad'); }
  },

  // Aprobar la ACTUALIZACIÓN DE SERIALES = aplicarla. No hay paso de firma
  // (2026-09-09): se dice qué va a pasar y se hace.
  aprobarActualizacionSeriales(gid) {
    return this._candado('aprobarActualizacionSeriales:' + gid, () => this._aprobarActualizacionSeriales(gid), 'Aprobando…');
  },
  async _aprobarActualizacionSeriales(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const a = g?.aumento || {};
    if (!g || a.es_regularizacion !== true) { Toast.show('Esta gestión no es una actualización de seriales', 'warn'); return; }
    const nEntran = (a.regulariza_seriales || []).length;
    const nFuera = (a.regulariza_no_tiene || []).length;
    const ok = await Modal.confirm({
      title: 'Aprobar y aplicar', confirmLabel: 'Aprobar y aplicar',
      message: `Al contrato <b class="cg-mono">${this.esc(a.contrato_id || '')}</b> se le agregan las líneas del
        expediente y <b>${nEntran} serial(es)</b> quedan amarrados${nFuera ? `; <b>${nFuera}</b> que el cliente no tiene salen de la cuenta` : ''}.
        <br><br><b>Al cliente no se le envía nada</b>: esto solo pone el sistema al día. Si hiciera falta que
        el cliente firme, el camino es un contrato.`,
    });
    if (!ok) { this.abrirGestion(gid); return; }
    try {
      await GestionesService.aprobarActualizacionSeriales(gid);
      Toast.show('Aprobada y aplicada — el sistema amarra los seriales al contrato', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar: ' + (e.message || e), 'bad'); }
  },

  aprobarAumentoGestion(gid) {
    return this._candado('aprobarAumentoGestion:' + gid, () => this._aprobarAumentoGestion(gid), 'Aprobando…');
  },
  async _aprobarAumentoGestion(gid) {
    // Resumen antes de aprobar, con la misma plantilla que la actualización
    // de seriales (auditoría UX 2026-09-28): aprobar compromete precio y plazo.
    const g = (this.gestiones || []).find(x => x.id === gid);
    const a = g?.aumento || {};
    const unid = (a.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const mensual = Number(a.totales?.total_mensual ?? a.totales?.totalMensual ?? 0);
    const ok = await Modal.confirm({
      title: 'Aprobar el aumento', confirmLabel: 'Aprobar aumento',
      message: `Al contrato <b class="cg-mono">${this.esc(a.contrato_id || '—')}</b> se le agregan
        <b>${(a.lineas || []).length} línea(s)</b> (${unid} unid.)${mensual ? ` por <b>$${mensual.toFixed(2)}/mes</b>` : ''}${a.duracion_meses ? ` a ${Number(a.duracion_meses)} mes(es)` : ''}.
        <br><br>Bodega recibe el aviso para asignar los seriales desde ya, mientras se imprime el anexo y el cliente lo firma; la entrega espera la firma.`,
    });
    if (!ok) { this.abrirGestion(gid); return; }
    try {
      await GestionesService.aprobarAumento(gid);
      Toast.show('Aumento aprobado — imprime el anexo y recoge la firma del cliente', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar el aumento', 'bad'); }
  },

  async subirAnexo(gid, file) {
    if (!file) return;
    try {
      Toast.show('Subiendo anexo firmado…', '');
      await GestionesService.registrarFirmaAumento(gid, file);
      Toast.show('Anexo firmado registrado — el sistema aplica las líneas y avisa a Bodega', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega solo por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo subir el anexo', 'bad'); }
  },

  // Cerrar la regularización sin mandarla a firmar (2026-09-09, Alberto): son
  // radios que el cliente tiene desde hace años y el anexo solo pone al día el
  // sistema. Se pide el motivo porque queda en el expediente para siempre: es
  // la única constancia de por qué ese anexo no lleva firma.
  async cerrarRegSinFirma(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.aumento?.es_regularizacion !== true) { Toast.show('Solo los anexos de regularización se cierran sin firma', 'warn'); return; }
    const motivo = await Modal.prompt({
      title: 'Cerrar sin firma del cliente',
      confirmLabel: 'Cerrar y aplicar', multiline: true,
      message: `Las líneas se aplican al contrato <b class="cg-mono">${this.esc(g.aumento.contrato_id || '')}</b> igual que
        con un anexo firmado, pero <b>al cliente no se le envía nada</b>. Queda en el expediente quién lo cerró y por qué.
        <br><br>Motivo (por ejemplo: “equipos en campo desde 2021, se pone al día el sistema”):`,
    });
    if (motivo === null) return;
    try {
      await GestionesService.cerrarRegularizacionSinFirma(gid, motivo);
      Toast.show('Regularización cerrada — el sistema aplica las líneas al contrato', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo cerrar la regularización: ' + (e.message || e), 'bad'); }
  },

  // Retirar el enlace de firma del ANEXO — el mismo gesto que en el contrato
  // (2026-09-09, Alberto: "si se envió para firma y el cliente aún no ha
  // firmado igual se debe poder retirar"). Sin esto, mandar el enlace dejaba
  // el anexo trancado: no se corregía, y el cliente seguía teniendo en la mano
  // un enlace con la copia vieja.
  async retirarFirmaAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.firma_solicitud_estado !== 'pendiente' || !g.firma_solicitud_id) {
      Toast.show('Este anexo no tiene un enlace de firma pendiente', 'warn'); return;
    }
    this._cerrarModal();
    const ok = await Modal.confirm({
      title: 'Retirar el enlace de firma', danger: true, confirmLabel: 'Retirar enlace',
      message: `El enlace que se le envió al cliente deja de servir (verá “enlace no válido”). El anexo
        <b class="cg-mono">${this.esc(gid)}</b> se queda esperando firma y <b>vuelve a poder corregirse</b>;
        para firmar habrá que enviar un enlace nuevo, con la copia al día.`,
    });
    if (!ok) { this.abrirGestion(gid); return; }
    try {
      await GestionesService.retirarEnlaceFirma(gid);
      Toast.show('Enlace retirado — el anexo ya se puede corregir', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo retirar el enlace: ' + (e.message || e), 'bad'); }
    this.abrirGestion(gid);
  },

  aprobarBajaGestion(gid) {
    return this._candado('aprobarBajaGestion:' + gid, () => this._aprobarBajaGestion(gid), 'Aprobando…');
  },
  async _aprobarBajaGestion(gid) {
    // Resumen antes de aprobar (auditoría UX 2026-09-28): la aprobación deriva
    // la facturación y crea la orden de DEVOLUCIÓN; antes salía de un click.
    const g = (this.gestiones || []).find(x => x.id === gid);
    const esTerm = Array.isArray(g?.terminacion_total_de) && g.terminacion_total_de.length;
    const nSer = (g?.items || []).length;
    const pen = Number(g?.penalidad_estimada?.total || 0);
    const contratos = [...new Set((g?.items || []).map(it => it.contrato_id).filter(Boolean))];
    const ok = await Modal.confirm({
      title: esTerm ? 'Aprobar la terminación' : 'Aprobar la baja', danger: !!esTerm,
      confirmLabel: esTerm ? 'Aprobar terminación' : 'Aprobar baja',
      message: `${esTerm ? '<b>TERMINACIÓN TOTAL</b>: se desconectan todos los seriales del contrato. ' : ''}Salen
        <b>${nSer} serial(es)</b>${contratos.length ? ` de <b class="cg-mono">${this.esc(contratos.join(', '))}</b>` : ''}${g?.fecha_fin_facturacion ? `; la facturación termina el <b>${this.esc(g.fecha_fin_facturacion)}</b>` : ''}.
        ${pen ? `<br>Liquidación estimada: <b>$${pen.toFixed(2)}</b>.` : ''}
        <br><br>Al aprobar, el sistema deriva la facturación y crea la <b>orden de DEVOLUCIÓN</b> por serial para recoger los equipos.`,
    });
    if (!ok) { this.abrirGestion(gid); return; }
    try {
      await GestionesService.aprobarBaja(gid);
      Toast.show('Baja aprobada — el sistema deriva la facturación y crea la devolución por serial', 'ok');
      await this.recargarGestiones();   // el avance del trigger llega solo por la escucha en vivo
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar la baja', 'bad'); }
  },

  anularGestion(gid) {
    return this._candado('anularGestion:' + gid, () => this._anularGestion(gid), 'Anulando…');
  },
  async _anularGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const perm = GestionesService.puedeAnularse(g, { rol: this.rol, uid: firebase.auth().currentUser?.uid });
    if (!perm.ok) { Toast.show(perm.motivo, 'warn'); return; }
    const enlaceVivo = g?.firma_solicitud_estado === 'pendiente' && !!g?.firma_solicitud_id;
    const motivo = await Modal.prompt({ title: 'Anular gestión', confirmLabel: 'Anular', multiline: true,
      message: `${enlaceVivo ? 'El <b>enlace de firma</b> que tiene el cliente se retira con la anulación: verá “enlace no válido”.<br><br>' : ''}Motivo de la anulación (obligatorio, queda en el expediente):` });
    if (motivo === null || motivo === undefined) return;
    // Motivo obligatorio, igual que al anular un contrato (auditoría UX
    // 2026-09-28): antes se guardaba '' y el expediente no decía por qué.
    if (!String(motivo).trim()) { Toast.show('Debes indicar un motivo.', 'bad'); return; }
    try {
      // El enlace vivo se retira ANTES: una gestión anulada con el enlace en
      // la calle se puede firmar igual, y el cliente recibiría la constancia
      // de un anexo que ya no existe.
      if (enlaceVivo) {
        try { await GestionesService.retirarEnlaceFirma(gid); }
        catch (e) { console.error(e); Toast.show('Ojo: el enlace de firma NO se retiró — ' + (e.message || e), 'warn'); }
      }
      await GestionesService.anular(gid, motivo);
      Toast.show('Gestión anulada — el sistema revierte sus efectos (órdenes, flags del pool)…', 'ok');
      // La limpieza corre en el trigger (~1-2s): refrescar la FICHA COMPLETA
      // para que equipos y señales dejen de mostrar los flags viejos.
      setTimeout(() => { if (this.cliente) this.abrir(this.cliente.id, { push: false }); }, 1800);
    } catch (e) { console.error(e); Toast.show('No se pudo anular', 'bad'); }
  },

  /* ── Editar el expediente antes de que surta efecto (2026-09-09) ──────
     Hasta hoy, un dedo mal puesto al crear la gestión (una cantidad, un
     precio, una fecha, el motivo) solo se arreglaba anulando y volviendo a
     crearla: correlativo nuevo, otro correo de aprobación y el historial
     lleno de anuladas. Aquí se corrige en el sitio, mientras nadie haya
     actuado sobre ella — GestionesService.puedeEditarse dice hasta cuándo, y
     por qué no cuando ya no se puede. El estado NUNCA cambia al editar. */

  async editarGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const perm = GestionesService.puedeEditarse(g);
    if (!perm.ok) { Toast.show(perm.motivo, 'warn'); return; }
    if (!this.puedeCrearGestion()) { Toast.show('Tu rol no edita gestiones', 'warn'); return; }
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);
    const cuerpo = g.tipo === 'aumento' ? this._edAumentoHtml(g)
      : g.tipo === 'baja' ? this._edBajaHtml(g)
      : g.tipo === 'reemplazo' ? this._edReemplazoHtml(g)
      : g.tipo === 'cambio_serial' ? this._edCambioSerialHtml(g)
      : this._edDemoHtml(g);
    this._abrirModalA({
      banda: false,
      titulo: `Corregir ${this.esc(GestionesService.tipoLabel(g.tipo).toLowerCase())} — <span class="cg-mono">${this.esc(g.id)}</span>`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        ${g.estado === 'pendiente_aprobacion'
          ? 'Sigue esperando aprobación: quien la apruebe verá ya los datos corregidos (el correo de aprobación no se reenvía).'
          : `La gestión se queda en <b>${this.esc(GestionesService.estadoLabel(g.estado).toLowerCase())}</b> — solo cambia lo que dice el expediente.`}
        Queda en la bitácora quién corrigió y qué.</p>
      ${cuerpo}
      <div class="form-field" style="margin:12px 0 0;">
        <label class="form-label" for="geNotas">Notas del expediente</label>
        <textarea class="form-input" id="geNotas" rows="2" placeholder="Opcional">${this.esc(g.notas || '')}</textarea></div>`,
      footer: `<span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarEdicionGestion('${this.esc(g.id)}')">Guardar cambios</button>`,
    });
    if (g.tipo === 'aumento') this._aumPreview();
  },

  // Aumento / adenda / regularización / ajuste: mismas filas del wizard, ya
  // prellenadas (por eso reusa los prefijos `wau`/`wac` y #waTot).
  _edAumentoHtml(g) {
    const a = g.aumento || {};
    const esReg = a.es_regularizacion === true;
    const itbms = a.totales?.itbms_aplica !== false;
    // La regularización trabaja sobre seriales concretos: se rehidrata el
    // estado del wizard para que cambiar "de quién es" baje a los seriales
    // (es lo que B3 lee al aplicar el anexo) y no se quede solo en la línea.
    this._aumRegulariza = esReg ? (a.regulariza_seriales || []).map(s => ({ ...s })) : null;
    this._aumRegularizaTodos = esReg ? [...this._aumRegulariza] : null;
    const lineas = esReg
      ? this._aumLineasFijasHtml(Object.fromEntries((a.lineas || []).map(l =>
          [(l.modelo_id || l.modelo) + '|' + (l.modalidad || 'alquiler'), l.precio ?? ''])))
      : (a.lineas || []).map(l => this._lineaModeloPre('wau', true, l)).join('');
    return `
      ${esReg ? `<div class="cg-senal warn" style="margin-bottom:10px;"><span>Anexo de <b>regularización</b>: el modelo y la
        cantidad los mandan los ${(a.regulariza_seriales || []).length} serial(es) que el cliente ya tiene — aquí se corrige el
        <b>precio</b> y <b>de quién es</b> cada equipo. Para cambiar qué seriales entran, anula el anexo y créalo de nuevo.</span></div>` : ''}
      <div ${esReg ? '' : 'oninput="Centro._aumPreview()" onchange="Centro._aumPreview()"'}>
      ${a.es_ajuste ? '' : `<div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
        <div id="waLineas" ${esReg ? 'oninput="Centro._aumPreview()"' : ''}>${lineas}</div>
        ${esReg ? '' : `<button class="btn btn-ghost cg-act"
          onclick="Centro._addLineaModelo('waLineas','wau',true); Centro._aumPreview()">+ Agregar otro modelo</button>`}</div>`}
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Otros conceptos (cargos del catálogo)</label>
        <div id="waCargos">${(a.cargos || []).map(c => this._cargoLineaHtml(c)).join('')}</div>
        <button class="btn btn-ghost cg-act"
          onclick="document.getElementById('waCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml()); Centro._aumPreview()">+ Agregar cargo</button></div>
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px;">
        <div class="form-field" style="margin:0; max-width:200px;">
          <label class="form-label" for="waMeses">Vigencia del tramo (meses)</label>
          <input class="form-input" type="number" id="waMeses" min="1" value="${Number(a.duracion_meses || 0) || ''}"></div>
        <label class="cg-toggle" style="margin-bottom:2px;">
          <input type="checkbox" id="waItbms" ${itbms ? 'checked' : ''} onchange="Centro._aumPreview()">
          Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}</label>
      </div>
      <div id="waTot" class="ds-card" style="padding:10px 14px; max-width:380px;"></div>
      </div>`;
  },

  // Baja: qué seriales entran, el motivo y las dos fechas que decide la nota
  // del cliente. La terminación total no deja quitar seriales — es del
  // contrato entero.
  _edBajaHtml(g) {
    const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
    const it0 = (g.items || [])[0] || {};
    return `
      ${esTerm ? `<div class="cg-senal bad" style="margin-bottom:10px;"><span><b>Terminación total</b>: entran todos los
        seriales del contrato — aquí solo se corrigen el motivo y las fechas.</span></div>` : ''}
      <div class="cg-twrap" style="max-height:30vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th></tr></thead><tbody>
        ${(g.items || []).map((it, i) => `<tr>
          <td><input type="checkbox" data-gesel="${i}" checked ${esTerm ? 'disabled' : ''}></td>
          <td class="cg-mono">${this.esc(it.serial_saliente || it.serial || '—')}</td>
          <td>${this.esc(it.modelo || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(it.contrato_id || '—')}</td></tr>`).join('')}
      </tbody></table></div>
      ${esTerm ? '' : '<p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Desmarca los seriales que no van en esta baja.</p>'}
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
        <select class="form-select" id="geMotivo" style="max-width:260px;">
          <option value="">— Motivo —</option>
          ${this.MOTIVOS_BAJA.map(([k, l]) => `<option value="${k}" ${k === (g.motivo_codigo || it0.motivo_codigo) ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <input class="form-input" id="geDet" style="flex:1; min-width:160px;" placeholder="Detalle (opcional)" value="${this.esc(it0.motivo_detalle || '')}">
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:10px;">
        <div class="form-field" style="margin:0;"><label class="form-label" for="geNota">Fecha de la nota del cliente</label>
          <input class="form-input" type="date" id="geNota" style="width:165px;" value="${this.esc(g.fecha_nota_cliente || '')}"></div>
        <div class="form-field" style="margin:0;"><label class="form-label" for="geFin">Fin de facturación</label>
          <input class="form-input" type="date" id="geFin" style="width:165px;" value="${this.esc(g.fecha_fin_facturacion || '')}"></div>
      </div>
      <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">La liquidación estimada se recalcula sola con los seriales que queden.</p>`;
  },

  // Reemplazo: qué radios salen, con qué modelo se piden y por qué. El serial
  // que ENTRA no se toca aquí — eso lo declara bodega en Almacén · Asignar.
  _edReemplazoHtml(g) {
    return `
      <div class="cg-twrap" style="max-height:38vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Sale</th><th>Modelo solicitado</th><th>Motivo</th><th>Detalle</th>
        </tr></thead><tbody>
        ${(g.items || []).map((it, i) => `<tr>
          <td><input type="checkbox" data-gesel="${i}" checked></td>
          <td class="cg-mono">${this.esc(it.serial_saliente || '—')}<div style="font-size:11.5px; color:var(--fg-4);">${this.esc(it.modelo || '')}</div></td>
          <td>${this._selModelo(`data-gemod="${i}" style="min-width:170px;"`, it.modelo_solicitado_id, it.modelo_solicitado)}</td>
          <td><select class="form-select" data-gemot="${i}" style="min-width:170px;">
            <option value="">— Motivo —</option>
            ${this.MOTIVOS.map(([k, l]) => `<option value="${k}" ${k === it.motivo_codigo ? 'selected' : ''}>${l}</option>`).join('')}
          </select></td>
          <td><input class="form-input" data-gedet="${i}" style="min-width:150px;" value="${this.esc(it.motivo_detalle || '')}" placeholder="Opcional"></td>
        </tr>`).join('')}
      </tbody></table></div>
      <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Desmarca los radios que no van en esta solicitud.
        El serial que <b>entra</b> lo declara bodega en Almacén · Asignar.</p>`;
  },

  // Cambio de serial: qué seriales se corrigen, por qué y —si se sabe— cuál
  // es el de verdad. Se puede corregir hasta que bodega aplique la corrección
  // (puedeEditarse la cierra al estamparse cierre.asignacion/derivacion).
  _edCambioSerialHtml(g) {
    return `
      <div class="cg-twrap" style="max-height:38vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Figura en el sistema</th><th>Qué pasó</th><th>Serial real</th><th>Detalle</th>
        </tr></thead><tbody>
        ${(g.items || []).map((it, i) => `<tr>
          <td><input type="checkbox" data-gesel="${i}" checked></td>
          <td class="cg-mono">${this.esc(it.serial || '—')}<div style="font-size:11.5px; color:var(--fg-4);">${this.esc(it.modelo || '')}</div></td>
          <td><select class="form-select" data-gemot="${i}" style="min-width:200px;">
            <option value="">— Qué pasó —</option>
            ${this.MOTIVOS_CAMBIO_SERIAL.map(([k, l]) => `<option value="${k}" ${k === it.motivo_codigo ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}
          </select></td>
          <td><input class="form-input" data-gereal="${i}" style="min-width:150px; font-family:var(--font-mono, monospace);"
            value="${this.esc(it.serial_nuevo || '')}" placeholder="Si lo sabes"></td>
          <td><input class="form-input" data-gedet="${i}" style="min-width:140px;" value="${this.esc(it.motivo_detalle || '')}" placeholder="Opcional"></td>
        </tr>`).join('')}
      </tbody></table></div>
      <p style="margin:6px 0 0; font-size:12px; color:var(--fg-3);">Desmarca los que no van en esta corrección.
        Lo que dejes en <b>Serial real</b> le llega a bodega como propuesta: lo verifica contra el radio antes de aplicarlo.</p>`;
  },

  _edDemoHtml(g) {
    const d = g.demo || {};
    return `
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Equipos (modelo · cantidad)</label>
        <div id="wdLineas">${(d.lineas || []).map(l => this._lineaModeloPre('wdl', false, l)).join('')}</div>
        <button class="btn btn-ghost cg-act" onclick="Centro._addLineaModelo('wdLineas','wdl')">+ Agregar otro modelo</button></div>
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label" for="wdFin">Finalidad del demo</label>
        <input class="form-input" id="wdFin" value="${this.esc(d.finalidad || '')}" placeholder="Para qué lo quiere el cliente"></div>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        <div class="form-field" style="margin:0;"><label class="form-label" for="wdSalida">Salida</label>
          <input class="form-input" type="date" id="wdSalida" style="width:165px;" value="${this.esc(d.fecha_salida || '')}"></div>
        <div class="form-field" style="margin:0;"><label class="form-label" for="wdDevol">Devolución estimada</label>
          <input class="form-input" type="date" id="wdDevol" style="width:165px;" value="${this.esc(d.fecha_devolucion_estimada || '')}"></div>
      </div>`;
  },

  // Lee el formulario, arma el parche del tipo y lo escribe. Cada rama valida
  // lo mismo que su wizard: una gestión corregida no puede quedar peor que
  // una recién creada.
  async guardarEdicionGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g) { Toast.show('Expediente no encontrado', 'bad'); return; }
    const notas = document.getElementById('geNotas')?.value.trim() || '';
    const cambios = { notas };
    const dicho = [];
    if (notas !== (g.notas || '')) dicho.push('notas');

    if (g.tipo === 'aumento') {
      const a = g.aumento || {};
      const lineas = a.es_ajuste ? [] : this._aumLineas();
      const cargos = this._aumCargos();
      if (!a.es_ajuste && !lineas.length) { Toast.show('Indica al menos un modelo (de la lista)', 'warn'); return; }
      if (lineas.some(l => !(l.precio > 0))) { Toast.show('Cada línea necesita su precio mensual', 'warn'); return; }
      if (this._lineasSinModalidad(lineas)) { Toast.show(this.MSG_SIN_MODALIDAD, 'warn'); return; }
      if (a.es_ajuste && !cargos.length) { Toast.show('Un ajuste de tarifa necesita al menos un cargo', 'warn'); return; }
      // Un anexo de regularización cubre EXACTAMENTE los seriales que ya
      // están con el cliente: cierra sin bodega, y un radio de más nunca
      // saldría (mismo candado que crearAumento).
      if (a.es_regularizacion) {
        const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0);
        const n = (this._aumRegulariza || []).length;
        if (total !== n) { Toast.show(`El anexo cubre exactamente ${n} equipo(s) que el cliente ya tiene`, 'warn'); return; }
      }
      const meses = Number(document.getElementById('waMeses')?.value || 0);
      if (!(meses > 0)) { Toast.show('Indica la vigencia del tramo en meses', 'warn'); return; }
      const itbmsAplica = document.getElementById('waItbms')?.checked !== false;
      const totales = this._totAumento(lineas, cargos, itbmsAplica);
      Object.assign(cambios, {
        'aumento.lineas': lineas,
        'aumento.cargos': cargos,
        'aumento.duracion_meses': meses,
        'aumento.itbms': { aplica: itbmsAplica, porcentaje: totales.itbms_porcentaje },
        'aumento.totales': totales,
        ...(a.es_regularizacion ? { 'aumento.regulariza_seriales': this._aumRegulariza || [] } : {}),
      });
      dicho.push(`${lineas.length} línea(s), ${cargos.length} cargo(s), ${meses} meses, total $${Number(totales.total_mensual || 0).toFixed(2)}/mes`);

    } else if (g.tipo === 'baja') {
      const sel = new Set([...document.querySelectorAll('input[data-gesel]:checked')].map(i => Number(i.dataset.gesel)));
      const esTerm = Array.isArray(g.terminacion_total_de) && g.terminacion_total_de.length;
      const items = (g.items || []).filter((_, i) => esTerm || sel.has(i));
      if (!items.length) { Toast.show('Deja al menos un serial en la baja', 'warn'); return; }
      const motivo = document.getElementById('geMotivo')?.value || '';
      if (!motivo) { Toast.show('Indica el motivo de la baja', 'warn'); return; }
      const detalle = document.getElementById('geDet')?.value.trim() || '';
      const fin = document.getElementById('geFin')?.value || null;
      const nuevos = items.map(it => ({ ...it, motivo_codigo: motivo, motivo_detalle: detalle, fecha_fin_facturacion: fin || null }));
      Object.assign(cambios, {
        items: nuevos,
        motivo_codigo: motivo,
        fecha_fin_facturacion: fin,
        fecha_nota_cliente: document.getElementById('geNota')?.value || null,
        penalidad_estimada: this._penalidadBaja(nuevos),
        contratos_afectados: Array.from(new Set([
          ...nuevos.map(i => i.contrato_doc_id).filter(Boolean),
          ...(Array.isArray(g.terminacion_total_de) ? g.terminacion_total_de : []),
        ])),
      });
      dicho.push(`${nuevos.length} serial(es), motivo "${motivo}"${fin ? `, fin de facturación ${fin}` : ''}`);

    } else if (g.tipo === 'reemplazo') {
      const sel = [...document.querySelectorAll('input[data-gesel]:checked')].map(i => Number(i.dataset.gesel));
      if (!sel.length) { Toast.show('Deja al menos un radio en la solicitud', 'warn'); return; }
      const nuevos = [];
      for (const i of sel) {
        const it = g.items[i];
        const motivo = document.querySelector(`select[data-gemot="${i}"]`)?.value || '';
        if (!motivo) { Toast.show(`Indica el motivo del serial ${it.serial_saliente}`, 'warn'); return; }
        const m = this._modeloDeSelect(document.querySelector(`select[data-gemod="${i}"]`));
        if (!m) { Toast.show(`Elige el modelo de reemplazo del serial ${it.serial_saliente}`, 'warn'); return; }
        nuevos.push({ ...it,
          motivo_codigo: motivo,
          motivo_detalle: document.querySelector(`input[data-gedet="${i}"]`)?.value.trim() || '',
          modelo_solicitado: m.label, modelo_solicitado_id: m.id,
        });
      }
      Object.assign(cambios, {
        items: nuevos,
        contratos_afectados: Array.from(new Set(nuevos.map(i => i.contrato_doc_id).filter(Boolean))),
      });
      dicho.push(`${nuevos.length} radio(s): ${nuevos.map(i => `${i.serial_saliente}→${i.modelo_solicitado}`).join(', ')}`);

    } else if (g.tipo === 'cambio_serial') {
      const sel = [...document.querySelectorAll('input[data-gesel]:checked')].map(i => Number(i.dataset.gesel));
      if (!sel.length) { Toast.show('Deja al menos un serial en la corrección', 'warn'); return; }
      const nuevos = [];
      const propuestos = new Set();
      for (const i of sel) {
        const it = g.items[i];
        const motivo = document.querySelector(`select[data-gemot="${i}"]`)?.value || '';
        if (!motivo) { Toast.show(`Indica qué pasó con el serial ${it.serial}`, 'warn'); return; }
        const real = (document.querySelector(`input[data-gereal="${i}"]`)?.value || '').trim();
        let serialNuevo = null;
        if (real) {
          const norm = EquiposPoolService.normalizarSerial(real);
          if (!EquiposPoolService.esSerialValido(norm)) { Toast.show(`"${real}" no parece un serial válido`, 'warn'); return; }
          if (norm === EquiposPoolService.normalizarSerial(it.serial)) {
            Toast.show(`El serial real de ${it.serial} es el mismo que ya figura`, 'warn'); return;
          }
          if (propuestos.has(norm)) { Toast.show(`${real} está propuesto dos veces`, 'warn'); return; }
          propuestos.add(norm);
          serialNuevo = real;
        }
        nuevos.push({ ...it,
          motivo_codigo: motivo,
          motivo_detalle: document.querySelector(`input[data-gedet="${i}"]`)?.value.trim() || '',
          serial_nuevo: serialNuevo,
          ...(serialNuevo ? { serial_nuevo_propuesto: true } : {}),
        });
      }
      Object.assign(cambios, {
        items: nuevos,
        contratos_afectados: Array.from(new Set(nuevos.map(i => i.contrato_doc_id).filter(Boolean))),
      });
      dicho.push(`${nuevos.length} serial(es): ${nuevos.map(i => `${i.serial}→${i.serial_nuevo || 'por confirmar'}`).join(', ')}`);

    } else {
      const lineas = this._lineasModelo('wdl').map(l => ({ modelo: l.modelo, modelo_id: l.modelo_id, cantidad: l.cantidad }));
      const finalidad = document.getElementById('wdFin')?.value.trim() || '';
      if (!lineas.length) { Toast.show('Indica al menos un modelo', 'warn'); return; }
      if (!finalidad) { Toast.show('Indica la finalidad del demo', 'warn'); return; }
      Object.assign(cambios, {
        'demo.lineas': lineas,
        'demo.finalidad': finalidad,
        'demo.fecha_salida': document.getElementById('wdSalida')?.value || '',
        'demo.fecha_devolucion_estimada': document.getElementById('wdDevol')?.value || null,
      });
      dicho.push(`${lineas.reduce((s, l) => s + l.cantidad, 0)} equipo(s), "${finalidad}"`);
    }

    try {
      await GestionesService.editar(gid, cambios, `Expediente corregido — ${dicho.join(' · ')}.`);
      this._aumRegulariza = null;
      this._aumRegularizaTodos = null;
      this._cerrarModal();
      Toast.show('Gestión corregida', 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo guardar: ' + (e.message || e), 'bad'); }
  },
});
