// @ts-nocheck
// Centro de gestión de clientes — Ficha reordenada (2026-09-08, "cada pieza en su lugar").
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Ficha v3 (2026-10-08): cabecera sin badges, barra de verbos
   * fija, pestañas en vez de acordeones, "Qué está esperando" en la columna
   * derecha y panel "Más acciones" por intención. Lo que decide QUÉ se
   * muestra (_itemsAhora, _accionPrimaria, _cuentaEstado, armarMenu) no
   * cambió: cambió el envase. Los pintores viejos quedan como alias porque
   * los llaman la recarga y el listener. */
  pintarAcciones() { this.pintarAhora(); },
  pintarSenales() { /* fundido en pintarAhora */ },
  pintarKpis() { this.pintarResumen(); },

  // "Le toca a" ya no se adivina con regex sobre el texto: cada fila trae su
  // {rol} desde la fuente (_itemsAccion, _itemsSenal) y TOCA le pone nombre.
  _ahoraTodo: false,
  // Las filas de "Qué está esperando", ya fundidas y ordenadas (bad → warn →
  // info). La primera es lo que la cuenta pide primero: de ahí sale también
  // la acción sugerida (_accionPrimaria).
  _itemsAhora() {
    const acc = this._itemsAccion().map(x => ({ tono: x.tono === 'info' ? 'info' : 'warn', t: x.t, s: x.s, btns: x.btns, rol: x.rol }));
    const sen = this._itemsSenal().map(x => ({ tono: x.tipo, t: this.esc(x.txt), s: '', btns: x.extra || '', rol: x.rol }));
    const peso = { bad: 0, warn: 1, info: 2 };
    return [...acc, ...sen].sort((a, b) => (peso[a.tono] ?? 3) - (peso[b.tono] ?? 3));
  },
  // El botón primario de una fila ({label, onclick}), o null si la fila no
  // tiene uno (solo "Ver contrato", o es de bodega/cliente).
  _primariaDe(btns) {
    const m = String(btns || '').match(/<(button|a)\b([^>]*\bbtn-primary\b[^>]*)>([^<]*)<\/\1>/);
    if (!m) return null;
    const attrs = m[2], label = m[3].trim();
    const on = attrs.match(/\bonclick="([^"]*)"/);
    const href = attrs.match(/\bhref="([^"]*)"/);
    if (on && on[1]) return { label, onclick: on[1] };
    if (href && href[1]) return { label, onclick: `location.href='${href[1].replace(/'/g, '')}'` };
    return null;
  },
  // "Qué está esperando": tarjeta de la columna derecha. Una fila por cosa
  // pendiente, con quién le toca y sus botones; hasta MAX a la vista.
  pintarAhora() {
    const cont = document.getElementById('fAhora');
    if (!cont) return;
    const items = this._itemsAhora();
    const hayBad = items.some(x => x.tono === 'bad');
    const hd = `<div class="hd"><h2 class="cg-h2">Qué está esperando</h2>
      ${items.length ? `<span class="cg-chip ${hayBad ? 'cg-chip--bad' : 'cg-chip--warn'}">${items.length}</span>` : ''}
      ${items.length > 5 ? `<button type="button" class="mas" onclick="Centro._ahoraTodo=!Centro._ahoraTodo; Centro.pintarAhora(); if(window.lucide) lucide.createIcons()">${this._ahoraTodo ? 'Ver menos' : `Ver ${items.length - 5} más`}</button>` : ''}
    </div>`;
    if (!items.length) {
      cont.innerHTML = `${hd}<div class="ok"><i data-lucide="check-circle-2" style="width:15px;height:15px;"></i> Nada pendiente en esta cuenta.</div>`;
      return;
    }
    const MAX = 5;
    const vis = this._ahoraTodo ? items : items.slice(0, MAX);
    const fila = (x) => {
      const toca = this._tocaLabel(x.rol);
      return `<div class="row ${x.tono}">
        <div class="top"><span class="dot"></span>
          <span class="t"><b>${x.t}</b><span class="s">${x.s}${x.s && toca ? ' · ' : ''}${toca ? `le toca a <span class="toca">${this.esc(toca)}</span>` : ''}</span></span></div>
        <div class="btns">${x.btns || ''}</div></div>`;
    };
    cont.innerHTML = hd + vis.map(fila).join('');
  },
  irAEsperando() {
    const el = document.getElementById('fAhora');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.outline = '2px solid var(--accent)';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 1600);
  },

  // Los números de la cuenta que usan la cabecera, las pestañas y la tarjeta
  // "La cuenta": calculados UNA vez por pintado.
  _numerosCuenta() {
    const enTram = this._idsEnTramite();
    const vig = this.contratos.filter(c => this._esOperativo(c, enTram));
    const mensual = vig.reduce((s, c) => s + Number(c.total_mensual ?? c.total_con_itbms ?? 0), 0);
    const enCampoL = this.equipos.filter(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    const enContrato = enCampoL.filter(e => e.asignacion?.contrato_doc_id).length;
    const sinContrato = enCampoL.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    const porClasificar = this.equipos.filter(e => e.estado === 'por_clasificar').length;
    const taller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    const abiertas = (this.gestiones || []).filter(g => GestionesService.enTramite(g)).length + this._tramitesContrato().length;
    let vencidos = 0, proxima = null, proximaC = null;
    const hoy = new Date();
    for (const c of vig) {
      if (!this._aplicaVenc(c) || !c.fecha_vencimiento) continue;
      const d = c.fecha_vencimiento.toDate ? c.fecha_vencimiento.toDate() : new Date(c.fecha_vencimiento);
      if (isNaN(d)) continue;
      if (d < hoy) vencidos++; else if (!proxima || d < proxima) { proxima = d; proximaC = c; }
    }
    const diasProx = proxima ? Math.ceil((proxima - hoy) / 86400000) : null;
    return { vig, mensual, enCampo: enCampoL.length, enContrato, sinContrato, porClasificar, taller, abiertas, vencidos, proxima, proximaC, diasProx };
  },

  // Tarjeta "La cuenta" (columna derecha) + línea meta de la cabecera +
  // estado en palabras + conteos de las pestañas + barra de verbos.
  pintarResumen() {
    const N = this._numerosCuenta();
    const cont = document.getElementById('fResumen');
    const c = this.cliente || {};
    if (cont) {
      const T = (l, v, { tab = '', tono = '', sm = false, icono = '' } = {}) => {
        const cuerpo = `<div class="l">${l}${icono ? `<i data-lucide="${icono}" style="width:11px;height:11px;"></i>` : ''}</div><div class="v${sm ? ' sm' : ''}${tono ? ` ${tono}` : ''}">${v}</div>`;
        return `<div class="cg-tile">${tab ? `<button type="button" onclick="Centro.mostrarTab('${tab}')" title="Abrir la pestaña">${cuerpo}</button>` : cuerpo}</div>`;
      };
      const venc = N.vencidos
        ? T('Vencimiento', `${N.vencidos} vencido${N.vencidos === 1 ? '' : 's'}`, { tab: 'blkContratos', tono: 'bad', sm: true })
        : N.proxima
          ? T('Próximo vencimiento', this._fmtFecha(N.proxima), { tab: 'blkContratos', tono: N.diasProx != null && N.diasProx <= this.AVISO_DIAS ? 'warn' : '', sm: true })
          : T('Próximo vencimiento', '—', { sm: true });
      // El monto mensual lo ven quienes trabajan la cuenta; bodega no lo
      // necesita (entra solo a asignar seriales).
      const verMensual = this.rol !== ROLES.INVENTARIO;
      const extras = [
        N.abiertas ? `<button type="button" onclick="Centro.mostrarTab('blkGestiones')">En trámite <b>${N.abiertas}</b></button>` : '',
        N.sinContrato ? `<button type="button" onclick="Centro.mostrarTab('blkEquipos')">Sin contrato <b>${N.sinContrato}</b></button>` : '',
        // "Por clasificar" es cola de BODEGA, no deuda de la cuenta (decisión 8, 1-oct-2026).
        N.porClasificar ? `<button type="button" onclick="Centro.mostrarTab('blkEquipos')" title="${N.porClasificar} radio(s) por clasificar: los revisa bodega, no cuentan como deuda de la cuenta">Bodega <b>${N.porClasificar}</b></button>` : '',
        N.taller ? `<button type="button" onclick="Centro.mostrarTab('blkEquipos')">En taller <b>${N.taller}</b></button>` : '',
        (this.ordenesAbiertas || []).length
          ? `<a href="../ordenes/index.html?ids=${this.ordenesAbiertas.slice(0, 60).map(o => encodeURIComponent(o.id)).join(',')}" title="${this.ordenesAbiertas.slice(0, 6).map(o => `${o.id} · ${o.estado_reparacion || ''}`).join('\n')}">Órdenes abiertas <b>${this.ordenesAbiertas.length}</b></a>` : '',
      ].filter(Boolean);
      cont.innerHTML = `<div class="cg-cardhd"><h2 class="cg-h2">La cuenta</h2></div>
        <div class="cg-tiles">
          ${T('Contratos vigentes', N.vig.length, { tab: 'blkContratos' })}
          ${T('Radios con el cliente', N.enCampo, { tab: 'blkEquipos' })}
          ${venc}
          ${verMensual ? T('Mensual', `<span class="num">$${N.mensual.toFixed(2)}</span>`, { sm: true }) : T('En trámite', N.abiertas, { tab: 'blkGestiones' })}
        </div>
        ${extras.length ? `<div style="display:flex; flex-wrap:wrap; gap:6px 16px; padding:0 16px 14px; font-size:12.5px; color:var(--fg-3);">${extras.map(x => x.replace('<button type="button"', '<button type="button" style="background:none; border:0; padding:0; font:inherit; color:inherit; cursor:pointer; border-bottom:1px dotted var(--accent-line, #66BCE7);"').replace('<a href', '<a style="color:inherit; text-decoration:none; border-bottom:1px dotted var(--accent-line, #66BCE7);" href')).join('')}</div>` : ''}`;
    }
    // La línea bajo el nombre es IDENTIDAD (RUC, teléfono, correo, vendedor:
    // la pinta _pintarEncabezado); los números viven en "La cuenta".
    this._pintarChipReg(c);
    this._pintarSumarios(N);
    this._pintarPrimario();
    this.pintarContacto();
    this.pintarResumenTab();
  },

  // Conteos en las pestañas (antes: resúmenes de una línea en los acordeones).
  _pintarSumarios(N) {
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('nContratos', N.vig.length ? String(N.vig.length) : '');
    set('nEquipos', this.equipos.length ? String(this.equipos.length) : '');
    set('nGestiones', N.abiertas ? String(N.abiertas) : '');
    set('fEqResumen', this.equipos.length
      ? [`${this.equipos.length} radio${this.equipos.length === 1 ? '' : 's'}`, `${N.enContrato} en contrato`, N.sinContrato ? `${N.sinContrato} sin contrato` : '', N.porClasificar ? `${N.porClasificar} por clasificar` : '', N.taller ? `${N.taller} en taller` : ''].filter(Boolean).join(' · ')
      : '');
  },

  // Estado de la cuenta EN PALABRAS bajo el nombre (antes: chips clicables
  // junto al nombre, que parecían etiquetas y escondían funciones). Nada aquí
  // se aprieta salvo el enlace a "Qué está esperando". Conserva el nombre
  // porque lo llaman _pintarEncabezado y el listener del cliente.
  _pintarChipReg(c) {
    const el = document.getElementById('fEstado');
    if (!el) return;
    const items = this._itemsAhora();
    const enTram = this._idsEnTramite();
    const vig = (this.contratos || []).filter(x => this._esOperativo(x, enTram));
    const vencidos = vig.filter(x => this._vencInfo(x)?.estado === 'vencido').length;
    const tram = (this.gestiones || []).filter(g => GestionesService.enTramite(g)).length + this._tramitesContrato().length;
    const chip = (typeof Regularizacion !== 'undefined') ? Regularizacion.chip(c?.regularizacion) : null;
    // Deuda SIN D7 (por clasificar es cola de bodega, decisión 8, 1-oct-2026).
    const puntos = (typeof Regularizacion !== 'undefined') ? Regularizacion.puntosCuenta(c?.regularizacion) : 0;
    const partes = [];
    if (vencidos) partes.push(`${vencidos} contrato${vencidos === 1 ? '' : 's'} vencido${vencidos === 1 ? '' : 's'}`);
    if (tram) partes.push(`${tram} trámite${tram === 1 ? '' : 's'} en curso`);
    if (puntos > 0) partes.push(`${c?.regularizacion?.nivel === 'critica' ? 'cuenta sin regularizar' : 'por regularizar'} (${puntos} punto${puntos === 1 ? '' : 's'})`);
    const hayBad = vencidos > 0 || items.some(x => x.tono === 'bad') || chip?.tono === 'bad';
    const link = `<a href="#esperando" onclick="event.preventDefault(); Centro.irAEsperando()">Ver qué está esperando</a>`;
    let tono, icono, html;
    if (!items.length && !partes.length) {
      if (this.contratos.length) { tono = 'ok'; icono = 'check-circle-2'; html = '<b>Cuenta al día.</b> Nada espera una acción.'; }
      else { tono = 'info'; icono = 'info'; html = '<b>Cuenta nueva.</b> Sin contratos todavía: el primer paso es un contrato nuevo o un demo.'; }
    } else if (!partes.length) {
      tono = hayBad ? 'bad' : 'warn'; icono = 'alert-circle';
      html = `<b>${items.length === 1 ? 'Una cosa espera' : `${items.length} cosas esperan`} una acción.</b> ${link}`;
    } else {
      tono = hayBad ? 'bad' : 'warn'; icono = 'alert-circle';
      html = `<b>La cuenta pide atención:</b> ${this.esc(partes.join(' · '))}. ${link}`;
    }
    el.className = `cg-estado ${tono}`;
    el.innerHTML = `<i data-lucide="${icono}"></i><span>${html}</span>`;
  },

  // La acción que la cuenta pide primero — marca "Sugerido" en la barra de
  // verbos, encabeza el panel "Más acciones" y va en el dock móvil (una regla).
  _accionPrimaria() {
    if (!this.puedeCrearGestion()) return null;
    // Lo primero de "Qué está esperando" manda (auditoría de módulos
    // 2026-09-30, R3): si la cuenta tiene algo esperando a alguien, ESA es la
    // sugerida — no una renovación de 16 contratos por 2 radios sin contrato.
    // Si la fila no trae botón primario (le toca a bodega o al cliente), se
    // sigue abajo.
    const primera = this._itemsAhora()[0];
    const deAhora = primera ? this._primariaDe(primera.btns) : null;
    if (deAhora) return { ...deAhora, hint: String(primera.t || '').replace(/<[^>]+>/g, '') };
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const reg = this._reg();
    // Deuda SIN D7: "por clasificar" es de bodega (decisión 8, 1-oct-2026).
    const puntos = (typeof Regularizacion !== 'undefined') ? Regularizacion.puntosCuenta(reg) : Number(reg?.puntos || 0);
    const deuda = puntos > 0;
    if (tram) return { onclick: `Centro.abrirGestion('ct-${this.esc(tram.id)}')`, label: `Ver renovación en trámite`, hint: `${this.esc(tram.contrato_id || '')} — abre el expediente para ver en qué paso va` };
    if (est.tipo === 'nueva') return { onclick: 'Centro.wizContrato()', label: 'Nuevo contrato', hint: '' };
    if (est.tipo === 'sin_contrato') return { onclick: 'Centro.wizContrato({renovarCuenta:true})', label: 'Regularizar: contrato nuevo', hint: `cubre los ${est.custodia} radio${est.custodia === 1 ? '' : 's'} que el cliente aún tiene` };
    // Ojo con el nombre: "Regularizar cuenta" a secas se confundía con el
    // anexo del menú ("Regularizar lo que el cliente tiene"). Este camino
    // hace un CONTRATO NUEVO; el otro cuelga un anexo del contrato vigente.
    if (deuda) return { onclick: 'Centro.wizContrato({renovarCuenta:true})', label: 'Regularizar con contrato nuevo', hint: `${puntos} punto${puntos === 1 ? '' : 's'} — renovación consolidadora con el plan por serial` };
    if (est.tipo === 'fragmentada') return { onclick: 'Centro.wizContrato({renovarCuenta:true})', label: 'Renovar cuenta', hint: `consolida ${est.renovables.length} contratos en uno` };
    if (est.tipo === 'consolidada' && this._wcEnVentana(est.maestro)) return { onclick: `Centro.wizContrato('${this.esc(est.maestro.id)}')`, label: 'Renovar cuenta', hint: 'entra en ventana de renovación' };
    return null;
  },

  // El verbo de la CUENTA (quinto de la barra): su posición es fija y su
  // nombre depende solo del estado de la cuenta (tres casos). Devuelve el
  // mismo descriptor que los demás verbos.
  _verboCuenta(est, tram, puedeG) {
    if (!puedeG) return null;
    if (tram) return { id: 'cuenta', icono: 'refresh-cw', label: 'Ver renovación en trámite', onclick: `Centro.abrirGestion('ct-${this.esc(tram.id)}')`, hint: `${tram.contrato_id || ''} — abre el expediente` };
    if (est.tipo === 'nueva') return { id: 'cuenta', icono: 'file-plus', label: 'Nuevo contrato', onclick: 'Centro.wizContrato()', hint: 'el primer contrato de la cuenta' };
    if (est.tipo === 'sin_contrato') return { id: 'cuenta', icono: 'file-plus', label: 'Nuevo contrato', onclick: 'Centro.wizContrato({renovarCuenta:true})', hint: `cubre los ${est.custodia} radio${est.custodia === 1 ? '' : 's'} que el cliente aún tiene` };
    if (est.tipo === 'fragmentada') return { id: 'cuenta', icono: 'refresh-cw', label: 'Renovar cuenta', onclick: 'Centro.wizContrato({renovarCuenta:true})', hint: `consolida ${est.renovables.length} contratos en uno` };
    // Consolidada: un solo contrato. Se renueva cuando entra en ventana o
    // cuando hay radios sueltos que cubrir; si no, se dice desde cuándo.
    const m = est.maestro;
    const enVentana = this._wcEnVentana(m);
    const custodia = this._wcCustodia().length;
    if (enVentana || custodia) return { id: 'cuenta', icono: 'refresh-cw', label: 'Renovar cuenta', onclick: `Centro.wizContrato('${this.esc(m.id)}')`, hint: enVentana ? 'entra en ventana de renovación' : `cubre ${custodia} radio(s) sin contrato` };
    const v = this._vencInfo(m);
    return { id: 'cuenta', icono: 'refresh-cw', label: 'Renovar cuenta', onclick: `Centro.wizContrato('${this.esc(m.id)}')`, ok: false,
      motivo: `${m.contrato_id || 'El contrato'} todavía no entra en ventana de renovación${v && v.dias != null ? ` (vence en ${v.dias} días)` : ''}. Para agregar radios usa Agregar equipos.` };
  },

  // Barra de verbos: Cotizar · Agregar equipos · Reemplazar · Demo · [cuenta]
  // · Más acciones. SIEMPRE los mismos, en el mismo orden; lo que no aplica
  // sale en gris con el motivo (title y toast), nunca escondido. La sugerida
  // se marca, no se mueve. Quien no inicia gestiones (bodega, contabilidad)
  // ve solo Cotizar (si puede) y Más acciones.
  pintarVerbos() {
    const cont = document.getElementById('cgVerbos');
    const c = this.cliente;
    if (!cont || !c) return;
    const puedeG = this.puedeCrearGestion();
    const est = this._cuentaEstado();
    const tram = this._renovacionEnTramite();
    const hayRadios = this.equipos.some(e => ['en_cliente', 'asignado_contrato'].includes(e.estado));
    const hayContrato = est.renovables.length > 0;
    const P = this._accionPrimaria();
    const id = encodeURIComponent(c.id);
    const V = (d) => {
      if (!d) return '';
      const sug = P && d.onclick && P.onclick === d.onclick;
      if (d.ok === false) {
        return `<button type="button" class="cg-verbo off${d.cls ? ` ${d.cls}` : ''}" data-verbo="${d.id}" aria-disabled="true" title="${this.esc(d.motivo)}"
          onclick="Toast.show(${this.esc(JSON.stringify(d.motivo))}, 'warn')"><i data-lucide="${d.icono}"></i>${this.esc(d.label)}</button>`;
      }
      return `<button type="button" class="cg-verbo${sug ? ' is-sug' : ''}${d.cls ? ` ${d.cls}` : ''}" data-verbo="${d.id}" title="${this.esc(d.hint || '')}"
        onclick="${d.onclick}"><i data-lucide="${d.icono}"></i>${this.esc(d.label)}${sug ? `<span class="sug">Sugerido</span>` : ''}</button>`;
    };
    const verbos = [
      this._puedeCotizar()
        ? { id: 'cotizar', icono: 'receipt', label: 'Cotizar', onclick: `location.href='../cotizaciones/nueva-cotizacion.html?cliente_id=${id}&from=centro'`, hint: 'abre el editor con este cliente ya elegido' }
        : null,
      puedeG ? { id: 'agregar', icono: 'plus', label: 'Agregar equipos', onclick: 'Centro.wizAgregarEquipos()', hint: 'radios nuevos por anexo al contrato de la cuenta',
        ok: hayContrato && !tram,
        motivo: tram ? 'Hay una renovación en trámite: los equipos nuevos entran por ahí.' : 'La cuenta no tiene contrato vigente donde colgar el anexo: empieza por Nuevo contrato.' } : null,
      puedeG ? { id: 'reemplazar', icono: 'repeat', label: 'Reemplazar', onclick: 'Centro.wizReemplazo()', hint: 'un radio dañado por otro; el taller propone y administración aprueba',
        ok: hayRadios, motivo: 'El cliente no tiene radios en campo que reemplazar.' } : null,
      puedeG ? { id: 'demo', icono: 'radio', label: 'Demo', onclick: 'Centro.wizDemo()', hint: 'prueba sin cargo, termina con la devolución' } : null,
      this._verboCuenta(est, tram, puedeG),
      { id: 'mas', icono: 'more-horizontal', label: 'Más acciones', onclick: 'Centro.abrirMenu()', hint: 'todas las acciones de la cuenta', cls: 'cg-verbo--mas' },
    ];
    cont.innerHTML = `<span class="lbl">Acciones</span>${verbos.map(V).join('')}`;
    // Editar / ver datos: arriba a la derecha, siempre en el mismo sitio.
    const ed = document.getElementById('fEditar');
    if (ed) ed.innerHTML = `<a class="btn btn-ghost" href="./ficha.html?id=${id}&from=centro" title="${this._puedeEditarCliente() ? 'RUC, representante, contacto, vendedor' : 'Solo lectura: los cambios los hace cobros'}">
      <i data-lucide="${this._puedeEditarCliente() ? 'pencil' : 'eye'}"></i> ${this._puedeEditarCliente() ? 'Editar datos' : 'Ver datos'}</a>`;
    // Dock móvil: Acciones + la sugerida.
    const dock = document.getElementById('cgDock');
    if (dock) dock.innerHTML = !puedeG && !this._puedeCotizar() ? '' : `<span aria-hidden="true"></span>
      <button class="btn" onclick="Centro.abrirMenu()">Acciones <i data-lucide="chevron-down"></i></button>
      ${P ? `<button class="btn btn-primary" onclick="${P.onclick}">${this.esc(P.label)}</button>` : `<span></span>`}`;
  },
  _pintarPrimario() { this.pintarVerbos(); },

  // Tarjeta "Contacto": representante, contacto, dirección, documentos.
  pintarContacto() {
    const el = document.getElementById('fContacto');
    const c = this.cliente;
    if (!el || !c) return;
    const id = encodeURIComponent(c.id);
    const fila = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
    const rep = c.representante
      ? `${this.esc(c.representante)}${c.representante_cedula ? ` · ${c.representante_doc_tipo === 'pasaporte' ? 'pasaporte' : 'cédula'} <span class="cg-mono">${this.esc(c.representante_cedula)}</span>` : ''}${c.representante_email ? `<br><span style="color:var(--fg-3);">${this.esc(c.representante_email)}</span>` : ''}`
      : '';
    const tel = [c.telefono, c.email].filter(Boolean).map(x => this.esc(x)).join(' · ');
    const docs = this._puedeVerDocs()
      ? `<a href="#documentos" onclick="event.preventDefault(); Centro.mostrarTab('blkDocumentos')">${this._docsN == null ? 'Ver el expediente' : `${this._docsN} archivo${this._docsN === 1 ? '' : 's'}`}</a> · registro público, cédula, poderes`
      : '';
    const filas = fila('Representante', rep) + fila('Contacto', tel) + fila('Acuses', c.email_acuses ? this.esc(c.email_acuses) : '')
      + fila('Dirección', c.direccion ? this.esc(c.direccion) : '') + fila('Documentos', docs);
    el.innerHTML = `<div class="cg-cardhd"><h2 class="cg-h2">Contacto</h2>
        <a class="mas" href="./ficha.html?id=${id}&from=centro">${this._puedeEditarCliente() ? 'Editar ›' : 'Ver ficha ›'}</a></div>
      ${filas ? `<dl class="cg-dl">${filas}</dl>` : `<p style="margin:0; padding:0 16px 14px; font-size:13px; color:var(--fg-3);">Sin datos de contacto registrados.</p>`}`;
  },

  // ── Pestañas ──────────────────────────────────────────────────────────
  _tabActiva: 'blkResumen',
  mostrarTab(id) {
    document.querySelectorAll('#cgTabs .cg-tab').forEach(b => {
      const on = b.dataset.tab === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#vistaFicha .cg-panel').forEach(p => { p.hidden = p.id !== id; });
    this._tabActiva = id;
    if (id === 'blkActividad') this.cargarActividad();
    if (id === 'blkDocumentos') this.pintarDocumentos();
    if (window.lucide?.createIcons) lucide.createIcons();
  },
  // Compatibilidad: muchos botones dicen abrirBloque('blkContratos'); ahora
  // es la pestaña, y se lleva la vista hasta ella.
  abrirBloque(id) {
    this.mostrarTab(id);
    document.getElementById('cgTabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  // Qué pestaña se abre al entrar: Gestiones si se llega por deep-link a un
  // expediente (?g=); si no, Resumen. Una vez por cliente (el listener en
  // vivo repinta sin mover la pestaña).
  _bloquesDe: null,
  _abrirBloques(clienteId) {
    if (this._bloquesDe === clienteId) return;
    this._bloquesDe = clienteId;
    this._eqSel = new Set();
    this._docsN = null; this._docsDe = null;
    this._actividadDe = null;
    const act = document.getElementById('fActividad');
    if (act) act.innerHTML = '<div class="cg-vacio">Cargando el historial…</div>';
    const tabDocs = document.getElementById('tabDocumentos');
    if (tabDocs) tabDocs.classList.toggle('hidden', !this._puedeVerDocs());
    this.mostrarTab(this.gSel ? 'blkGestiones' : 'blkResumen');
    if (this._puedeVerDocs()) this.pintarDocumentos().catch(() => {});
  },

  // ── Pestaña Resumen: equipos por contrato + últimos movimientos ───────
  pintarResumenTab() {
    const cont = document.getElementById('fResumenTab');
    if (!cont) return;
    const esc = (v) => this.esc(v);
    const enTram = this._idsEnTramite();
    const operativos = this.contratos.filter(c => this._esOperativo(c, enTram));
    if (!this.equipos.length && !this.contratos.length) {
      cont.innerHTML = `<div class="cg-empty">Cuenta nueva: sin contratos ni equipos todavía.
        ${this.puedeCrearGestion() ? `<div class="cta"><button class="btn btn-primary cg-act" onclick="Centro.wizContrato()">Nuevo contrato</button>
        <button class="btn btn-ghost cg-act" onclick="Centro.wizDemo()">Demo</button></div>` : ''}</div>`;
      return;
    }
    // Grupos: un contrato por fila, luego sin contrato, taller y bodega.
    const grupos = new Map();
    const add = (k, e) => { if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(e); };
    for (const e of this.equipos) {
      if (['en_taller', 'devuelto_revision'].includes(e.estado)) add('__taller', e);
      else if (e.estado === 'por_clasificar') add('__bodega', e);
      else if (['en_cliente', 'asignado_contrato'].includes(e.estado)) add(e.asignacion?.contrato_doc_id ? `c:${e.asignacion.contrato_doc_id}` : '__sin', e);
    }
    const PAL = ['#0B2A47', '#0074AC', '#66BCE7', '#0F3A5F', '#005781', '#99D3EF', '#1D4ED8', '#334155'];
    const modelos = (items) => { const m = {}; items.forEach(e => { const k = e.modelo_label || 'sin modelo'; m[k] = (m[k] || 0) + 1; });
      const xs = Object.entries(m).sort((a, b) => b[1] - a[1]); return esc(xs.slice(0, 2).map(([k, n]) => `${k} ×${n}`).join(', ')) + (xs.length > 2 ? ` <span style="color:var(--fg-3);">+${xs.length - 2}</span>` : ''); };
    const venceDe = (c) => { const d = c?.fecha_vencimiento?.toDate ? c.fecha_vencimiento.toDate() : (c?.fecha_vencimiento ? new Date(c.fecha_vencimiento) : null); return d && !isNaN(d) ? d.getTime() : Infinity; };
    const contratosConRadios = [...grupos.keys()].filter(k => k.startsWith('c:')).map(k => ({ k, c: this.contratos.find(x => x.id === k.slice(2)) }))
      .sort((a, b) => venceDe(a.c) - venceDe(b.c));
    const filas = []; const segs = [];
    let col = 0;
    const chipVenc = (c) => {
      if (!c) return '';
      if (!this._aplicaVenc(c)) return `<span class="cg-chip cg-chip--muted">${esc(this._estadoLabel(c))}</span>`;
      const v = this._vencInfo(c);
      if (!v) return `<span class="cg-chip cg-chip--ok">Vigente</span>`;
      if (v.estado === 'vencido') return `<span class="cg-chip cg-chip--bad">Venció hace ${-v.dias} día${-v.dias === 1 ? '' : 's'}</span>`;
      if (v.estado === 'por_vencer') return `<span class="cg-chip cg-chip--warn">Vence en ${v.dias} día${v.dias === 1 ? '' : 's'}</span>`;
      return `<span class="cg-chip cg-chip--ok">Vigente</span>`;
    };
    for (const { k, c } of contratosConRadios) {
      const items = grupos.get(k); const color = PAL[col++ % PAL.length];
      segs.push({ n: items.length, color });
      filas.push(`<tr>
        <td style="white-space:nowrap;"><span class="cg-sw" style="background:${color};"></span>${c ? `<a class="cg-mono" href="#" onclick="Centro.verContrato('${esc(c.id)}'); return false;">${esc(c.contrato_id || c.id)}</a>` : `<span class="cg-mono">${esc(items[0].asignacion?.contrato_id || '—')}</span>`}</td>
        <td>${modelos(items)}${items.some(e => e.propiedad === 'cliente') ? ` <span style="color:var(--fg-3);">· ${items.filter(e => e.propiedad === 'cliente').length} del cliente</span>` : ''}</td>
        <td style="text-align:right;"><b>${items.length}</b></td>
        <td style="white-space:nowrap;">${c?.fecha_vencimiento && this._aplicaVenc(c) ? this._fmtFecha(c.fecha_vencimiento) : '—'}</td>
        <td>${chipVenc(c)}</td></tr>`);
    }
    const puedeG = this.puedeCrearGestion();
    const sin = grupos.get('__sin');
    if (sin) {
      segs.push({ n: sin.length, color: '#E0A93A' });
      const tram = this._renovacionEnTramite();
      const salida = !puedeG ? '' : tram
        ? `<a href="#" onclick="Centro.abrirGestion('ct-${esc(tram.id)}'); return false;" style="font-weight:600;">Los cubre la renovación en trámite ›</a>`
        : operativos.some(c => this._aplicaVenc(c))
          ? `<a href="#" onclick="Centro.wizRegularizarCuenta(); return false;" style="font-weight:600;">Actualizar seriales ›</a>`
          : `<a href="#" onclick="Centro.wizContrato({renovarCuenta:true}); return false;" style="font-weight:600;">Nuevo contrato que los cubra ›</a>`;
      filas.push(`<tr><td><span class="cg-sw" style="background:#E0A93A;"></span><b>Sin contrato</b></td><td>${modelos(sin)}</td><td style="text-align:right;"><b>${sin.length}</b></td><td>—</td><td>${salida || '<span class="cg-chip cg-chip--warn">Por regularizar</span>'}</td></tr>`);
    }
    const tal = grupos.get('__taller');
    if (tal) {
      segs.push({ n: tal.length, color: '#9AA7B4' });
      const ids = [...new Set(tal.map(e => e.orden_actual_id).filter(Boolean))].slice(0, 60);
      filas.push(`<tr><td><span class="cg-sw" style="background:#9AA7B4;"></span><b>En taller</b></td><td>${modelos(tal)}</td><td style="text-align:right;"><b>${tal.length}</b></td><td>—</td>
        <td>${ids.length ? `<a class="cg-mono" href="../ordenes/index.html?ids=${ids.map(encodeURIComponent).join(',')}" style="font-size:12.5px;">${ids.length === 1 ? ids[0] : `${ids.length} órdenes`}</a>` : '<span style="color:var(--fg-3);">vuelven al entregarse la orden</span>'}</td></tr>`);
    }
    const bod = grupos.get('__bodega');
    if (bod) {
      segs.push({ n: bod.length, color: '#C9D6E3' });
      filas.push(`<tr><td><span class="cg-sw" style="background:#C9D6E3;"></span><b>Por clasificar</b></td><td>${modelos(bod)}</td><td style="text-align:right;"><b>${bod.length}</b></td><td>—</td><td><span style="color:var(--fg-3);">cola de bodega, no es deuda de la cuenta</span></td></tr>`);
    }
    const total = segs.reduce((s, x) => s + x.n, 0);
    const sinRadios = operativos.filter(c => !grupos.has(`c:${c.id}`)).length;
    const N = this._numerosCuenta();
    const sub = [`${this.equipos.length} radio${this.equipos.length === 1 ? '' : 's'}`, `${N.enContrato} en contrato`, N.sinContrato ? `${N.sinContrato} sin contrato` : '', N.taller ? `${N.taller} en taller` : '', N.porClasificar ? `${N.porClasificar} por clasificar` : ''].filter(Boolean).join(' · ');
    const equiposHtml = `
      <div class="cg-sechd"><h2 class="cg-h2">Equipos por contrato</h2><span class="sub">${sub}</span>
        <a class="mas" href="#" onclick="Centro.mostrarTab('blkContratos'); return false;">Ver contratos ›</a></div>
      ${total ? `<div class="cg-barra" aria-hidden="true">${segs.map(s => `<span style="flex:${s.n}; background:${s.color};"></span>`).join('')}</div>` : ''}
      ${filas.length ? `<div class="cg-twrap"><table class="cg-tabla"><thead><tr><th>Contrato</th><th>Modelos</th><th style="text-align:right;">Radios</th><th>Vence</th><th>Estado</th></tr></thead><tbody>${filas.join('')}</tbody></table></div>`
        : `<div class="cg-empty">Sin equipos en el inventario de esta cuenta.</div>`}
      ${sinRadios ? `<p style="margin:10px 0 0; font-size:12.5px; color:var(--fg-3);">${sinRadios === 1 ? 'Otro contrato vigente no tiene' : `Otros ${sinRadios} contratos vigentes no tienen`} radios en campo (consola, servicios o pendiente de entrega). ${sinRadios === 1 ? 'Está' : 'Están'} en la pestaña Contratos.</p>` : ''}`;
    // Últimos movimientos: contratos, gestiones y órdenes abiertas en una
    // sola línea de tiempo (lo que ya está cargado; nada se consulta de más).
    const ev = this._eventosRecientes().slice(0, 8);
    const movHtml = `
      <div class="cg-sechd" style="margin-top:22px;"><h2 class="cg-h2">Últimos movimientos</h2><span class="sub">contratos, gestiones y órdenes</span>
        <a class="mas" href="#" onclick="Centro.mostrarTab('blkActividad'); return false;">Historial de la ficha ›</a></div>
      ${ev.length ? `<ol class="cg-tl">${ev.map(x => `<li><span class="cu">${esc(this._cuandoCorto(x.at))}</span><span class="ic ${x.tono || ''}"><i data-lucide="${x.icono}"></i></span><span class="tx">${x.html}</span></li>`).join('')}</ol>`
        : `<p style="margin:0; font-size:13px; color:var(--fg-3);">Sin movimientos registrados en esta cuenta.</p>`}`;
    cont.innerHTML = equiposHtml + movHtml;
  },
  _cuandoCorto(d) {
    if (!d || isNaN(d)) return '—';
    const hoy = new Date();
    const mismo = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (mismo(d, hoy)) return 'Hoy';
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    if (mismo(d, ayer)) return 'Ayer';
    return d.getFullYear() === hoy.getFullYear() ? (this._fmtFechaCorta(d) || '—') : this._fmtFecha(d);
  },
  _eventosRecientes() {
    const out = [];
    const fecha = (v) => { const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null); return d && !isNaN(d) ? d : null; };
    const esc = (v) => this.esc(v);
    const mono = (t) => `<span class="cg-mono">${esc(t)}</span>`;
    const push = (at, icono, tono, html) => { const d = fecha(at); if (d) out.push({ at: d, icono, tono, html }); };
    for (const c of this.contratos || []) {
      if (c.deleted) continue;
      const id = c.contrato_id || c.id;
      const link = `<a href="#" onclick="Centro.verContrato('${esc(c.id)}'); return false;">${mono(id)}</a>`;
      const nombre = c.accion === 'Renovación' ? 'La renovación' : this._codigoTipo(c) === 'DEMO' ? 'El demo' : this._codigoTipo(c) === 'TEMP' ? 'El contrato temporal' : this._codigoTipo(c) === 'REEMP' ? 'El reemplazo' : 'El contrato';
      push(c.fecha_creacion, 'file-text', '', `${nombre} ${link} se creó${c.creado_por_email ? ` <span class="quien">· ${esc(String(c.creado_por_email).split('@')[0])}</span>` : ''}.`);
      push(c.fecha_aprobacion, 'check-circle-2', 'info', `Administración aprobó ${nombre.toLowerCase()} ${link}.`);
      push(c.firmado_fecha, 'pen-line', 'ok', `${nombre} ${link} quedó firmado${c.firmado_tipo === 'digital' ? ' por enlace' : ''}.`);
      push(c.fecha_activacion, 'check-circle-2', 'ok', `${nombre} ${link} se activó.`);
      push(c.fecha_entrega_ultima, 'truck', 'ok', `Entrega de equipos de ${link}.`);
      push(c.vencido_at, 'x-circle', 'warn', `${nombre} ${link} se cerró${c.vencido_motivo ? ` — ${esc(c.vencido_motivo)}` : ''}.`);
      push(c.anulado_at || c.fecha_anulacion, 'x-circle', 'warn', `${nombre} ${link} se anuló${c.anulacion_motivo ? ` — ${esc(c.anulacion_motivo)}` : ''}.`);
    }
    for (const g of this.gestiones || []) {
      const tipo = (typeof GestionesService !== 'undefined' && GestionesService.tipoLabel) ? GestionesService.tipoLabel(g.tipo) : (g.tipo || 'Gestión');
      const link = `<a href="#" onclick="Centro.abrirGestion('${esc(g.id)}'); return false;">${mono(g.id)}</a>`;
      push(g.fecha_solicitud, 'refresh-cw', '', `Gestión ${link} (${esc(tipo.toLowerCase())}) creada${g.responsable_email ? ` <span class="quien">· ${esc(String(g.responsable_email).split('@')[0])}</span>` : ''}.`);
      push(g.anulada_at, 'x-circle', 'warn', `Gestión ${link} (${esc(tipo.toLowerCase())}) anulada${g.anulada_motivo ? ` — ${esc(g.anulada_motivo)}` : ''}.`);
      push(g.cerrada_at || g.cierre?.at, 'check-circle-2', 'ok', `Gestión ${link} (${esc(tipo.toLowerCase())}) cerrada.`);
    }
    for (const o of this.ordenesAbiertas || []) {
      push(o.fecha_creacion || o.creado_en, 'wrench', '', `Orden <a class="cg-mono" href="../ordenes/index.html?ids=${encodeURIComponent(o.id)}">${esc(o.id)}</a> (${esc(o.tipo_de_servicio || 'servicio')}) · ${esc(o.estado_reparacion || '')}${(o.equipos || []).length ? ` · ${o.equipos.length} equipo${o.equipos.length === 1 ? '' : 's'}` : ''}.`);
    }
    return out.sort((a, b) => b.at - a.at);
  },

  // ── Pestaña Documentos (expediente legal, PII): la misma lista que antes
  // abría un modal desde el "⋯". Solo quien puede verlos tiene la pestaña. ──
  _docsDe: null,
  _docsN: null,
  async pintarDocumentos() {
    const cont = document.getElementById('fDocumentos');
    const c = this.cliente;
    if (!cont || !c || !this._puedeVerDocs()) return;
    if (this._docsDe === c.id) return;
    this._docsDe = c.id;
    const urlSubir = `./ficha.html?id=${encodeURIComponent(c.id)}&from=centro&seccion=documentos`;
    cont.innerHTML = `<p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">Expediente legal de <b>${this.esc(c.nombre || '')}</b>. Cada archivo se abre con un enlace que vence a los 5 minutos y queda registrado en la auditoría de PII.</p>
      <div id="cgDocsList"><div class="cg-vacio">Cargando documentos…</div></div>
      <p style="margin:12px 0 0; font-size:12.5px;"><a href="${urlSubir}">Cargar un documento ›</a></p>`;
    try {
      const docs = await ClienteDocumentosService.list(c.id);
      if (this.cliente?.id !== c.id) return;
      this._docsN = docs.length;
      const n = document.getElementById('nDocumentos'); if (n) n.textContent = docs.length ? String(docs.length) : '';
      const lista = document.getElementById('cgDocsList');
      if (lista) lista.innerHTML = docs.length ? docs.map(d => this._docFilaHtml(d)).join('') : `<div class="cg-vacio">No hay documentos cargados para este cliente.</div>`;
      this.pintarContacto();
      if (window.lucide?.createIcons) lucide.createIcons();
    } catch (err) {
      const lista = document.getElementById('cgDocsList');
      if (lista) lista.innerHTML = `<p style="color:#b91c1c; font-size:13px;">No se pudieron cargar los documentos: ${this.esc(err?.message || err)}</p>`;
    }
  },

  // ── Selección en Equipos: la gestión sale de lo marcado ──────────────
  _eqSel: null,
  _eqSelIds() { return [...(this._eqSel || [])]; },
  _eqSeleccionable(e) { return ['en_cliente', 'asignado_contrato'].includes(e.estado); },
  _eqMarcar(id, on) {
    const s = this._eqSel || (this._eqSel = new Set());
    if (on) s.add(id); else s.delete(id);
    document.querySelector(`#fEquipos tr[data-eq="${CSS.escape(id)}"]`)?.classList.toggle('is-sel', !!on);
    this._pintarSelBar();
  },
  _eqMarcarGrupo(k, on) {
    const s = this._eqSel || (this._eqSel = new Set());
    for (const e of this.equipos) {
      if (!this._eqSeleccionable(e)) continue;
      const ke = e.asignacion?.contrato_doc_id ? `c:${e.asignacion.contrato_doc_id}` : 'sin_contrato';
      if (ke !== k) continue;
      if (on) s.add(e.id); else s.delete(e.id);
    }
    this.pintarEquipos();
    if (window.lucide?.createIcons) lucide.createIcons();
  },
  _eqLimpiarSel() {
    this._eqSel = new Set();
    this.pintarEquipos();
    if (window.lucide?.createIcons) lucide.createIcons();
  },
  _pintarSelBar() {
    const bar = document.getElementById('cgSelBar');
    if (!bar) return;
    const sel = this._eqSelIds().map(id => this.equipos.find(e => e.id === id)).filter(Boolean);
    if (!sel.length) { bar.innerHTML = ''; return; }
    const n = sel.length;
    const contratos = new Set(sel.map(e => e.asignacion?.contrato_id || 'sin contrato'));
    const puedeG = this.puedeCrearGestion();
    const bajables = sel.filter(e => e.asignacion?.contrato_doc_id).length;
    const corregibles = sel.filter(e => !e.pendiente_devolucion && !(e.asignacion?.gestion_doc_id && !e.asignacion?.contrato_doc_id)).length;
    const off = (ok, motivo) => ok ? '' : ` disabled aria-disabled="true" title="${this.esc(motivo)}"`;
    bar.innerHTML = `<span class="n">${n} seleccionado${n === 1 ? '' : 's'}</span>
      <span class="s">${contratos.size === 1 ? `de <span class="cg-mono">${this.esc([...contratos][0])}</span>` : `de ${contratos.size} contratos`}</span>
      <div class="btns">
        ${puedeG ? `<button type="button" class="btn btn-primary" onclick="Centro.wizReemplazo({pre: Centro._eqSelIds()})"><i data-lucide="repeat"></i> Reemplazar ${n === 1 ? 'este' : `estos ${n}`}</button>` : ''}
        ${puedeG ? `<button type="button" class="btn" onclick="Centro.wizBaja({pre: Centro._eqSelIds()})"${off(bajables > 0, 'La baja es de radios con contrato; los sueltos se corrigen con Actualizar seriales')}><i data-lucide="undo-2"></i> Dar de baja</button>` : ''}
        ${puedeG ? `<button type="button" class="btn" onclick="Centro.wizCambioSerial({pre: Centro._eqSelIds()})"${off(corregibles > 0, 'Los radios de un demo o pendientes de devolución no se corrigen por aquí')}><i data-lucide="arrow-left-right"></i> Corregir serial</button>` : ''}
        <button type="button" class="btn btn-dark" aria-label="Quitar la selección" onclick="Centro._eqLimpiarSel()"><i data-lucide="x"></i></button>
      </div>`;
    if (window.lucide?.createIcons) lucide.createIcons();
  },
  _actividadDe: null,
  async cargarActividad() {
    if (!this.cliente || this._actividadDe === this.cliente.id) return;
    this._actividadDe = this.cliente.id;
    const cont = document.getElementById('fActividad');
    if (!cont) return;
    cont.innerHTML = '<div class="cg-vacio">Cargando…</div>';
    let filas = [];
    try {
      const snap = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(50).get();
      filas = snap.docs.map(d => d.data());
    } catch (e) { console.warn('[centro] historial no disponible:', e?.message || e); }
    cont.innerHTML = filas.length ? filas.map(h => this._histFilaHtml(h)).join('')
      : `<div class="cg-vacio">Sin cambios registrados. El historial arrancó el 2&nbsp;sep&nbsp;2026.</div>`;
    const sum = document.getElementById('sumActividad');
    if (sum && filas[0]) sum.textContent = `último cambio ${this._histCuando(filas[0].at)} · ${(filas[0].por_email || 'sistema').split('@')[0]}`;
  },
  _histFilaHtml(h) {
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
  },

  _itemsSenal() {
    const out = [];
    // Contratos que el sistema pide cerrar: el equipo volvió y el papel sigue
    // vivo (2026-09-14). Este aviso existía SOLO en el home, para admin y
    // gerente, y su botón llevaba al módulo viejo de contratos, que ya no
    // cancela nada. Aquí sale donde se trabaja la cuenta y con el botón que sí
    // lo resuelve.
    for (const c of this.contratos) {
      if (!this._esVigente(c) || !c.cancelacion_pendiente) continue;
      out.unshift({
        tipo: 'warn', rol: 'administracion',
        txt: `El contrato ${c.contrato_id || c.id} sigue vigente aunque el equipo ya volvió — ${ContratoCierre.porQue(c)}`,
        extra: [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol)
          ? `<button class="btn btn-primary cg-act cg-senal-cta" onclick="Centro.cerrarContrato('${this.esc(c.id)}')">Cerrar el contrato</button>`
          : `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.verContrato('${this.esc(c.id)}')">Ver contrato</button>`,
      });
    }
    for (const c of this.contratos) {
      if (!this._esVigente(c) || !this._aplicaVenc(c) || this._renovadoPor(c)) continue;
      const v = this._vencInfo(c);
      if (!v) continue;
      // La fila de la cola "Ahora" lleva su botón: renovar (o ver el trámite).
      const tram = this._renovacionEnTramite();
      const cta = !this.puedeCrearGestion() ? '' : tram
        ? `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.abrirGestion('ct-${this.esc(tram.id)}')">Ver trámite</button>`
        : `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta</button>`;
      if (v.estado === 'vencido') {
        out.push({ tipo: 'bad', rol: 'cuenta', txt: `El contrato ${c.contrato_id || c.id} venció hace ${-v.dias} día(s) — coordinar renovación o terminación.`, extra: cta });
      } else if (v.estado === 'por_vencer') {
        out.push({ tipo: 'warn', rol: 'cuenta', txt: `El contrato ${c.contrato_id || c.id} vence en ${v.dias} día(s) — iniciar renovación.`, extra: cta });
      }
    }
    // Regla 2026-08-27: una cuenta con equipos FUERA de contrato formal ya
    // requiere renovación/regularización (el documento marco los formaliza).
    const sinContrato = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    // Con el campo regularizacion ya calculado por el job, la deuda tiene UNA
    // voz: el chip de la cabecera + esta señal que abre "Qué falta". La señal
    // vieja de custodia (abajo) queda solo mientras el job no haya pasado.
    const reg = this._reg();
    const puntosCuenta = reg ? Regularizacion.puntosCuenta(reg) : 0;
    if (reg && puntosCuenta > 0) {
      const tram = this._renovacionEnTramite();
      out.unshift({
        tipo: reg.nivel === 'critica' ? 'bad' : reg.nivel === 'leve' ? 'info' : 'warn', rol: 'cuenta',
        txt: `${Regularizacion.resumen(reg)}${tram ? ` — la renovación en trámite (${tram.contrato_id || ''}) cubre la custodia al activarse.` : '.'}`,
        extra: `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.verRegularizacion()">Qué falta</button>`,
      });
      if (reg.d7 > 0) out.push({ tipo: 'info', rol: 'bodega', txt: `${reg.d7} radio(s) por clasificar — cola de bodega, no cuentan como deuda de la cuenta.` });
    } else if (reg && reg.d7 > 0) {
      // Solo D7 (decisión 8, 1-oct-2026): se informa, le toca a bodega y no
      // empuja ninguna gestión de la cuenta.
      out.push({ tipo: 'info', rol: 'bodega', txt: `${reg.d7} radio(s) por clasificar — cola de bodega, no cuentan como deuda de la cuenta.`,
        extra: `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.verRegularizacion()">Cuáles</button>` });
    } else if (sinContrato) {
      const tram = this._renovacionEnTramite();
      out.unshift(tram ? {
        tipo: 'info', rol: 'cuenta',
        txt: `${sinContrato} equipo(s) sin contrato formal — la renovación en trámite (${tram.contrato_id || ''}) los cubrirá al activarse y entregarse.`,
        extra: `<button class="btn btn-ghost cg-act cg-senal-cta" onclick="Centro.abrirGestion('ct-${this.esc(tram.id)}')">Ver trámite</button>`,
      } : (() => {
        // Sin contratos vigentes no hay nada que "renovar": la salida es un
        // contrato NUEVO que cubra esos equipos (2026-09-01, C COMUNICA).
        const sinVigentes = this._cuentaEstado().tipo === 'sin_contrato';
        return {
          tipo: 'warn', rol: 'cuenta',
          txt: sinVigentes
            ? `${sinContrato} equipo(s) con el cliente y la cuenta SIN contrato vigente — créale un contrato nuevo que los cubra.`
            : `${sinContrato} equipo(s) sin contrato formal — la cuenta requiere renovación / regularización.`,
          extra: this.puedeCrearGestion()
            ? `<button class="btn btn-primary cg-act cg-senal-cta"
                 onclick="Centro.wizContrato({renovarCuenta:true})">${sinVigentes ? 'Nuevo contrato' : 'Renovar cuenta'}</button>` : '',
        };
      })());
    }
    const pendDev = this.equipos.filter(e => e.pendiente_devolucion).length;
    if (pendDev) out.push({ tipo: 'warn', rol: 'cliente', txt: `${pendDev} equipo(s) pendiente(s) de devolución.` });
    const eqTaller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado));
    if (eqTaller.length) {
      // Las órdenes donde están esos radios, enlazadas (08 P8).
      const ids = [...new Set(eqTaller.map(e => e.orden_actual_id).filter(Boolean))].slice(0, 60);
      out.push({ tipo: 'info', rol: 'taller', txt: `${eqTaller.length} equipo(s) en taller o en revisión.`,
        extra: ids.length ? `<a class="btn btn-ghost cg-act" href="../ordenes/index.html?ids=${ids.map(encodeURIComponent).join(',')}">Ver ${ids.length === 1 ? 'la orden' : `las ${ids.length} órdenes`}</a>` : '' });
    }
    // Las gestiones abiertas NO se repiten aquí: ya viven en el KPI, en
    // "Requiere tu acción" y en la lista de Gestiones con su fila accionable.
    return out;
  },

  _unidadesActivas(c) {
    const total = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
    return Math.max(0, total - Number(c.baja_cancelado_total || 0));
  },

  // Composición del contrato (2026-09-28): desde septiembre todo contrato
  // nuevo es "Servicio" y la propiedad va por línea, así que el tipo ya no
  // dice si es alquiler o propio. Chip pequeño junto al número: Alquiler /
  // Propio / Mixto · N alq / M prop; DEMO/TEMP/REEMP conservan su nombre.
  // Regla en js/domain/contratoComposicion.js.
  _compChipHtml(c) {
    const CC = (typeof ContratoComposicion !== 'undefined') ? ContratoComposicion : null;
    if (!CC || !c) return this.esc(c?.tipo_contrato || c?.codigo_tipo || '—');
    return `<span class="${CC.chipClass(c)}" title="${this.esc(CC.resumen(c))}">${this.esc(CC.etiqueta(c))}</span>`;
  },

  // Fila estándar de un contrato operativo (la comparten la tabla principal
  // y el pliegue de "menores"). SIN acciones por contrato (decisión
  // 2026-08-28): renovar/aumentar/terminar son actos de la CUENTA y viven en
  // el encabezado y el menú — la fila solo informa (el semáforo es la señal).
  // "Ver" abre la vista previa EN LA PÁGINA (regla 2026-08-28: no sacar a la
  // persona de donde está — el salto a la página del contrato es un link
  // explícito dentro del modal).
  _filaContrato(c) {
    return `<tr>
      <td class="cg-mono"><a href="#" onclick="Centro.verContrato('${this.esc(c.id)}'); return false;">${this.esc(c.contrato_id || c.id)}</a></td>
      <td>${this._compChipHtml(c)}</td>
      <td>${this.esc(this._estadoLabel(c))}${c.cancelacion_pendiente && this._esVigente(c)
        ? ` <span class="cg-venc por_vencer" title="El equipo ya volvió y el contrato sigue vigente — hay que cerrarlo">por cerrar</span>` : ''}</td>
      <td style="text-align:right;">${this._unidadesActivas(c)}</td>
      <td>${this._vidaHtml(c)}</td>
      <td style="text-align:right; white-space:nowrap;">
        ${this._masFila('tc-' + c.id, this._accionesContrato(c), c.contrato_id || c.id)}</td></tr>`;
  },

  // Vista previa del contrato en un modal: todo lo esencial sin navegar.
  async verContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    this._cerrarModal();
    await this._cargarOsContrato(id).catch(() => {});
    const t = (window.ContractTotals?.fromDoc) ? ContractTotals.fromDoc(c) : null;
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id);
    const renovador = this._renovadoPor(c);
    const dato = (l, v) => v ? `<div style="display:flex; gap:8px; font-size:13px; padding:2px 0;">
      <span style="color:var(--fg-3); min-width:120px;">${l}</span><span>${v}</span></div>` : '';
    // Modalidad de la línea: de quién es el equipo (2026-09-09). Sin esto el
    // contrato no decía por ningún lado si el radio es de alquiler o del
    // cliente — antes se leía del tipo ALQ/PROP, que ya no existe.
    const modLinea = (l) => l.modalidad === 'propio'
      ? '<span class="eqpool-prop eqpool-prop-cliente" title="Equipo propiedad del cliente — la línea es tarifa de servicio">Del cliente</span>'
      : l.modalidad === 'alquiler'
        ? '<span class="eqpool-prop eqpool-prop-cecomunica" title="Equipo de la flota de CECOMUNICA en renta">Alquiler</span>'
        : '<span class="eqpool-prop eqpool-prop-desconocida" title="Contrato anterior a la modalidad por línea — la propiedad real es la de cada serial, abajo">Sin declarar</span>';
    const lineas = (c.equipos || []).map(l => `<tr>
      <td>${this.esc(l.modelo || '—')}</td>
      <td>${modLinea(l)}</td>
      <td style="text-align:right;">${Number(l.cantidad || 0)}</td>
      <td style="text-align:right;" class="num">$${Number(l.precio || 0).toFixed(2)}</td>
      <td style="text-align:right;" class="num">$${(Number(l.cantidad || 0) * Number(l.precio || 0)).toFixed(2)}</td></tr>`).join('');
    const cargos = (c.cargos || []).map(x => `<tr>
      <td>${this.esc(x.concepto || '—')} <span style="color:var(--fg-4); font-size:11px;">${x.recurrente ? 'mensual' : 'único'}</span></td>
      <td></td>
      <td style="text-align:right;">${Number(x.cantidad || 1)}</td>
      <td style="text-align:right;" class="num">$${Number(x.monto || 0).toFixed(2)}</td>
      <td style="text-align:right;" class="num">$${(Number(x.cantidad || 1) * Number(x.monto || 0)).toFixed(2)}</td></tr>`).join('');
    // Los equipos en campo, con la propiedad de CADA serial: es la que manda
    // (la devolución nunca reclama un radio del cliente). Los del cliente van
    // primero — son la excepción que hay que notar.
    const P = window.EquiposPoolService;
    const enCampoOrd = [...enCampo].sort((a, b) =>
      (b.propiedad === 'cliente' ? 1 : 0) - (a.propiedad === 'cliente' ? 1 : 0)
      || String(a.serial || '').localeCompare(String(b.serial || '')));
    // Cada serial también abre en Almacén (ficha sobre Existencias) para quien
    // puede entrar ahí (08 P8): el kardex del Centro es la vista rápida.
    const aAlmacen = [ROLES.ADMIN, ROLES.GERENTE, ROLES.INVENTARIO].includes(this.rol)
      || (typeof canRole === 'function' && canRole(this.rol, 'gestionar-seriales'));
    const lnkAlmacen = (e) => aAlmacen
      ? ` <a href="../almacen/index.html?tab=existencias&serial=${encodeURIComponent(e.serial || e.id)}" title="Abrir ${this.esc(e.serial || e.id)} en Almacén" style="color:var(--fg-4); text-decoration:none; font-size:11px;">Almacén ↗</a>`
      : '';
    const filasCampo = enCampoOrd.map(e => `<tr>
      <td class="cg-mono"><a href="#" onclick="Centro.verKardex('${this.esc(e.id)}'); return false;">${this.esc(e.serial || e.id)}</a>${P?.origenReemplazoHtml ? P.origenReemplazoHtml(e) : ''}${lnkAlmacen(e)}</td>
      <td>${this.esc(e.modelo_label || '—')}</td>
      <td>${P?.chipPropiedadHtml ? P.chipPropiedadHtml(e) : this.esc(e.propiedad || '')}</td>
      <td>${P?.chipEstadoHtml ? P.chipEstadoHtml(e.estado) : this.esc(e.estado || '')}</td></tr>`).join('');
    const resumenCampo = P?.resumenPropiedadTexto ? P.resumenPropiedadTexto(enCampo) : '';
    const reg = c.regularizacion;
    this._abrirModalA({
      titulo: `<span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>
        <span style="font-weight:400; color:var(--fg-3); font-size:13.5px;"> · ${this._compChipHtml(c)} · ${this.esc(this._estadoLabel(c))}</span>`,
      cuerpo: `
      <div style="margin:0 0 10px;">${this._vidaHtml(c)}</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0 24px; margin-bottom:10px;">
        ${dato('Acción', this.esc(c.accion || ''))}
        ${dato('Duración', this.esc(this._durTxt(c)))}
        ${dato('Creado', this._fmtFecha(c.fecha_creacion))}
        ${dato('Aprobado', c.fecha_aprobacion ? this._fmtFecha(c.fecha_aprobacion) : '')}
        ${dato('Origen', (c.contrato_origen_refs || []).map(r => `<span class="cg-mono">${this.esc(r)}</span>`).join(', ')
          || (c.origen_legacy_ref ? `papel: ${this.esc(c.origen_legacy_ref)}` : ''))}
        ${dato('Renovado por', renovador ? `<span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span>` : '')}
        ${dato('Contrato aparte (no anexo)', c.motivo_contrato_nuevo ? `<i>${this.esc(c.motivo_contrato_nuevo)}</i>` : '')}
        ${dato('Firmado', this._firmadoTxt(c)
          || (!ContratoFirma.lleva(c) ? `<span style="color:var(--fg-3);">no lleva firma — ${ContratoFirma.porQue(c)}</span>` : ''))}
        ${dato('Entregado', this._entregaTxt(c))}
        ${dato('Firma por enlace', c.firmado_pendiente_validacion
          ? '<span class="cg-venc por_vencer">recibida — validar firmante</span>'
          : (!c.firmado && c.firma_solicitud_estado === 'pendiente' ? 'enlace enviado — esperando firma' : ''))}
      </div>
      ${lineas || cargos ? `<div class="cg-twrap" style="max-height:30vh; overflow:auto;">
        <table class="cg-tabla"><thead><tr><th>Línea</th><th>De quién es</th><th style="text-align:right;">Cant.</th>
          <th style="text-align:right;">Precio</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${lineas}${cargos}</tbody></table></div>` : ''}
      ${t ? `<div style="display:flex; gap:18px; font-size:13.5px; margin-top:8px; flex-wrap:wrap;">
        <span>${this.esc(t.itbmsLabel || '')}</span>
        <span style="margin-left:auto;"><b>Mensual: <span class="num">$${Number(t.totalMensual || 0).toFixed(2)}</span></b></span>
        ${t.tieneCargosUnicos ? `<span><b>Primer pago: <span class="num">$${Number(t.primerPago || 0).toFixed(2)}</span></b></span>` : ''}
      </div>` : ''}
      ${enCampo.length ? `<div style="margin:12px 0 0;">
        <div style="display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; font-size:12.5px; margin-bottom:6px;">
          <b>${enCampo.length} equipo${enCampo.length === 1 ? '' : 's'} en campo bajo este contrato</b>
          ${resumenCampo ? `<span style="color:var(--fg-3);">${resumenCampo}</span>` : ''}</div>
        <div class="cg-twrap" style="max-height:26vh; overflow:auto;">
          <table class="cg-tabla"><thead><tr><th>Serial</th><th>Modelo</th><th>De quién es</th><th>Situación</th></tr></thead>
          <tbody>${filasCampo}</tbody></table></div></div>` : ''}
      ${reg?.amarradas != null ? `<p style="font-size:12.5px; color:var(--fg-3); margin:6px 0 0;">
        Regularización: ${reg.amarradas} radio(s) amarrados${reg.sin_cupo ? ` · <b style="color:var(--warn-deep, #92400E);">${reg.sin_cupo} sin cupo</b>` : ''}${reg.sin_linea ? ` · <b style="color:var(--warn-deep, #92400E);">${reg.sin_linea} sin línea: ${(reg.sin_linea_seriales || []).join(', ')}</b>` : ''}.</p>` : ''}
      ${c.transicion_plan?.nivel === 'serial' && window.TransicionPlan ? `<p style="font-size:12.5px; color:var(--fg-3); margin:6px 0 0;">
        Seriales declarados en la venta: ${this.esc(TransicionPlan.resumen(c.transicion_plan))}${c.plan_aplicado?.at ? ' — aplicado' : ''}.
        ${(c.transicion_plan.unidades || []).filter(u => u.destino === 'no_tiene').length
          ? `<br><b style="color:var(--warn-deep, #92400E);">No los tiene:</b> ${(c.transicion_plan.unidades || []).filter(u => u.destino === 'no_tiene').map(u => `<span class="cg-mono">${this.esc(u.serial)}</span>`).join(', ')}` : ''}
        ${c.accion === 'Renovación' && c.estado === 'aprobado' && !c.firmado && this.puedeCrearGestion()
          ? `<button class="btn btn-ghost cg-act" style="margin-left:8px;" onclick="Centro.wizSerialesRenovacion('${this.esc(c.id)}')">Corregir seriales</button>` : ''}</p>`
        : (c.accion === 'Renovación' && c.estado === 'aprobado' && !c.firmado && this.puedeCrearGestion()
          ? `<p style="font-size:12.5px; margin:6px 0 0;"><span style="color:var(--warn-deep, #92400E);">Esta renovación no declara qué seriales siguen con el cliente.</span>
             <button class="btn btn-ghost cg-act" style="margin-left:8px;" onclick="Centro.wizSerialesRenovacion('${this.esc(c.id)}')">Seriales de la cuenta</button></p>` : '')}
      ${this._osCache[id] && !this._osCache[id].loading && this._osCache[id].os.length ? this._osTramiteHtml(c) : ''}
      ${c.observaciones ? `<p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0; max-width:72ch;">${this.esc(c.observaciones)}</p>` : ''}`,
      // MISMA lista de acciones que el "⋯" de la fila: el footer dejó de ser
      // una botonera propia (2026-09-09) — "Ver el contrato" sale de la lista
      // porque es esta misma pantalla.
      footer: `<span class="sep"></span>
        <button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal()">Cerrar</button>
        ${this._pieAcciones('vc-' + c.id, this._accionesContrato(c).filter(a => a.id !== 'ver'))}`,
    });
  },

  // Cierre del contrato (2026-09-14, caso FANLYC/TEMP20260902-01). CERRAR no
  // es ANULAR: el acuerdo se cumplió y terminó, el equipo ya volvió y no se
  // mueve ningún radio. Es la única salida de un TEMP o un DEMO —"Terminar la
  // cuenta" solo alcanza a los renovables— y la respuesta a la bandeja
  // "Contratos por cancelar" del home, que hasta hoy no tenía dónde aterrizar.
  cerrarContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    if (![ROLES.ADMIN, ROLES.GERENTE].includes(this.rol)) { Toast.show('Solo administración o gerencia cierra contratos.', 'bad'); return; }
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id).length;
    const ev = ContratoCierre.evaluar(c, enCampo);
    if (!ev.ok) { Toast.show(ev.motivo, 'bad'); return; }
    const porQue = ContratoCierre.porQue(c);
    this._cerrarModal();
    this._abrirModalA({
      titulo: `Cerrar <span class="cg-mono">${this.esc(c.contrato_id || id)}</span>`,
      cuerpo: `
        ${porQue ? `<p style="font-size:13px; margin:0 0 10px; padding:9px 11px; border-radius:8px;
          background:var(--soft-warn); color:var(--warn-deep, #92400E); border:1px solid var(--warn);">
          <b>El sistema lo está pidiendo:</b> ${porQue}</p>` : ''}
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 12px; max-width:70ch;">
          El contrato queda <b>vencido</b>: deja de contar para vencimientos, renovaciones y facturación.
          No se abre ninguna orden y <b>no se mueve ningún equipo</b> — si hace falta recuperar radios,
          eso es una baja. Si lo que quieres es deshacer el papel porque estaba mal, usa <b>Anular</b>.</p>
        ${ev.aviso ? `<p style="font-size:13px; margin:0 0 12px; padding:9px 11px; border-radius:8px;
          background:var(--soft-bad); color:var(--bad); border:1px solid var(--bad);">${ev.aviso}</p>` : ''}
        <label style="display:block; font-weight:600; font-size:13px; margin-bottom:4px;">Motivo</label>
        <textarea class="form-input" id="cieMotivo" rows="3" style="width:100%; resize:vertical;"
          placeholder="Ej: el evento terminó y los 12 radios volvieron en la entrada 2026090810">${
            this.esc(porQue ? `El equipo ya volvió. ${porQue}` : '')}</textarea>`,
      footer: `
        <button class="btn btn-ghost cg-act" onclick="Centro.verContrato('${this.esc(id)}')">Volver</button>
        <span class="sep"></span>
        <button class="btn btn-primary cg-act" onclick="Centro._cerrarContratoConfirmar('${this.esc(id)}')">Cerrar el contrato</button>`,
    });
  },

  async _cerrarContratoConfirmar(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const motivo = (document.getElementById('cieMotivo')?.value || '').trim();
    if (!motivo) { document.getElementById('cieMotivo')?.focus(); Toast.show('Debes indicar un motivo.', 'bad'); return; }
    try {
      await ContratosService.updateContrato(id, ContratoCierre.buildUpdate(c, { motivo, uid: this.uid }));
      this._cerrarModal();
      Toast.show('✅ Contrato CERRADO — ningún equipo se movió.', 'ok');
      if (this.cliente) this.abrir(this.cliente.id, { push: false });
    } catch (e) { console.error(e); Toast.show('No se pudo cerrar el contrato.', 'bad'); }
  },

  // Anulación SIN salir del Centro (2026-09-04: Alberto y Zuleika buscaban
  // "Anular contrato" en la ficha — solo existía en el menú ⋯ del módulo
  // Contratos, al que el Centro ya no enlaza). Misma escritura que
  // ContratosLista.anular: js/domain/contratoAnulacion.js. La pregunta que
  // importa es QUÉ PASA CON LOS EQUIPOS, no el motivo.
  // Declarar DESPUÉS de anular cuál contrato sustituye al anulado (2026-10-07,
  // B3). El servidor (callable declararSustitutoContrato) hace el traspaso que
  // onAnnulment habría hecho con el sustituto indicado a tiempo: seriales,
  // señal de asignados, Base PoC, órdenes señaladas y la marca pendiente.
  declararSustituto(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    if (![ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION].includes(this.rol)) { Toast.show('Tu rol no declara sustitutos de contrato.', 'bad'); return; }
    if (c.estado !== 'anulado') { Toast.show('Solo un contrato anulado tiene sustituto.', 'warn'); return; }
    const cands = ContratoAnulacion.candidatos(this.contratos, id);
    const colgando = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id).length;
    const pend = Array.isArray(c.sustitucion_pendientes) ? c.sustitucion_pendientes : [];
    this._cerrarModal();
    this._abrirModalA({
      titulo: `Sustituto de <span class="cg-mono">${this.esc(c.contrato_id || id)}</span>`,
      cuerpo: `
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 12px;">
          Este contrato está <b>anulado</b>${c.anulado_motivo ? ` (${this.esc(String(c.anulado_motivo).slice(0, 100))})` : ''}${c.sustituido_por_contrato_id ? ` y dice que lo sustituye <span class="cg-mono">${this.esc(c.sustituido_por_contrato_id)}</span>` : ' y no dice qué contrato lo reemplazó'}.
          ${colgando ? `<b>${colgando}</b> radio(s) siguen amarrados a él en el inventario.` : 'Ningún radio sigue amarrado a él en el inventario.'}
          Al declarar el sustituto, los seriales, la Base PoC y las órdenes que quedaron sin contrato pasan al nuevo; el radio no se mueve de sitio.</p>
        ${pend.length ? `<p style="font-size:12.5px; color:var(--warn-deep,#92400E); margin:0 0 12px;">Quedó pendiente: ${this.esc(c.sustitucion_vinculo_motivo || '')} — ${pend.slice(0, 6).map(p => `${this.esc(p.serial)} (${this.esc(p.motivo || '')})`).join('; ')}${pend.length > 6 ? '…' : ''}</p>` : ''}
        <label style="display:block; font-weight:600; font-size:13px; margin-bottom:4px;">Contrato que lo sustituye</label>
        <select class="form-input" id="dsSustituto" style="width:100%;">
          <option value="">Elige el contrato vivo de esta cuenta…</option>
          ${cands.map(x => `<option value="${this.esc(x.id)}" ${x.id === c.sustituido_por_id ? 'selected' : ''}>${this.esc(x.contrato_id || x.id)} · ${this.esc(this._estadoLabel(x))}${x.total_mensual ? ` — $${Number(x.total_mensual).toFixed(2)}/mes` : ''}${x.seriales_estado === 'asignados' ? ' · seriales ya asignados' : ''}</option>`).join('')}
        </select>
        ${cands.length ? '' : '<small style="color:var(--warn-deep,#92400E);">La cuenta no tiene ningún contrato aprobado o activo. Crea primero el contrato correcto.</small>'}
        <label style="display:block; font-weight:600; font-size:13px; margin:12px 0 4px;">¿Por qué no se indicó al anular? <small style="font-weight:400; color:var(--fg-3);">(opcional)</small></label>
        <textarea class="form-input" id="dsMotivo" rows="2" style="width:100%; resize:vertical;" placeholder="Ej.: el contrato nuevo se creó después de anular el viejo"></textarea>`,
      footer: `
        <button class="btn btn-ghost cg-act" onclick="Centro.verContrato('${this.esc(id)}')">Volver</button>
        <span class="sep"></span>
        <button class="btn btn-primary cg-act" onclick="Centro._declararSustitutoConfirmar('${this.esc(id)}')" ${cands.length ? '' : 'disabled'}>Declarar sustituto</button>`,
    });
  },
  async _declararSustitutoConfirmar(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const sustId = document.getElementById('dsSustituto')?.value || '';
    if (!sustId) { Toast.show('Elige el contrato sustituto.', 'warn'); return; }
    const s = this.contratos.find(x => x.id === sustId);
    const motivo = (document.getElementById('dsMotivo')?.value || '').trim();
    const ok = await Modal.confirm({
      title: 'Declarar el sustituto',
      message: `<span class="cg-mono">${this.esc(c.contrato_id || id)}</span> (anulado) → <span class="cg-mono">${this.esc(s?.contrato_id || sustId)}</span>. Los seriales que sigan amarrados al anulado pasan al sustituto${s?.seriales_estado === 'asignados' ? ' (ya tiene los suyos asignados: solo se confirma el vínculo y se reapunta la Base PoC)' : ' y, si queda completo, sale el PDF a activaciones'}. ¿Seguir?`,
      confirmLabel: 'Declarar sustituto',
    });
    if (!ok) return;
    const btn = document.querySelector('#cgModal .btn-primary'); if (btn) { btn.disabled = true; btn.textContent = 'Declarando…'; }
    try {
      const r = await firebase.functions().httpsCallable('declararSustitutoContrato')({ origenId: id, sustitutoId: sustId, motivo });
      const d = r.data || {};
      this._cerrarModal();
      const partes = [`${d.copiados || 0} serial(es) pasaron a ${d.sustituto || ''}`];
      if (d.ya_en_sustituto) partes.push(`${d.ya_en_sustituto} ya estaban`);
      if (d.poc_reapuntados) partes.push(`${d.poc_reapuntados} ficha(s) PoC reapuntadas`);
      if ((d.ordenes_repuntadas || []).length) partes.push(`${d.ordenes_repuntadas.length} orden(es) pasaron al sustituto`);
      if ((d.pendientes || []).length) partes.push(`${d.pendientes.length} sin resolver: ${d.pendientes.slice(0, 3).map(p => `${p.serial} (${p.motivo})`).join('; ')}`);
      Toast.show(partes.join(' · '), (d.pendientes || []).length ? 'warn' : 'ok', 9000);
      setTimeout(() => { if (this.cliente) this.abrir(this.cliente.id, { push: false }); }, 1200);
    } catch (e) {
      console.error(e);
      if (btn) { btn.disabled = false; btn.textContent = 'Declarar sustituto'; }
      Toast.show(e?.message || 'No se pudo declarar el sustituto.', 'bad', 8000);
    }
  },

  // ── Traslados a otra ficha (2026-10-07, P3) ──────────────────────────
  // Buscador de clientes propio (el Centro no trae entity-combo): lista de
  // Clientes en caché, filtro sin acentos, clic para elegir. Excluye la
  // ficha actual, las borradas, las fusionadas y las inactivas.
  async _montarBuscadorCliente(root, { onSelect }) {
    const input = root.querySelector('#trCliente');
    const lista = root.querySelector('#trClienteLista');
    if (!input || !lista) return;
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    let clientes = [];
    try {
      const cs = await ClientesService.getAllClientes({ fresh: false });
      clientes = cs.filter(c => c && c.id !== this.cliente?.id && !c.deleted && !c.merged_into && c.activo !== false && !c.trasladado_a)
        .map(c => ({ id: c.id, nombre: String(c.nombre || ''), ruc: c.ruc || '', norm: norm(`${c.nombre} ${c.ruc || ''}`) }));
    } catch (e) { console.warn('[centro] clientes para traslado:', e); }
    const pintar = () => {
      const q = norm(input.value);
      const toks = q.split(/\s+/).filter(Boolean);
      const hits = toks.length ? clientes.filter(c => toks.every(t => c.norm.includes(t))).slice(0, 12) : [];
      lista.innerHTML = hits.length
        ? hits.map(c => `<button type="button" class="tr-hit" data-id="${this.esc(c.id)}" style="display:block;width:100%;text-align:left;padding:7px 10px;border:0;border-bottom:1px solid var(--border-subtle,#eee);background:transparent;cursor:pointer;font-size:13px;">${this.esc(c.nombre)}${c.ruc ? ` <span style="color:var(--fg-3);font-size:12px;">· RUC ${this.esc(c.ruc)}</span>` : ''}</button>`).join('')
        : (toks.length ? '<div style="padding:8px 10px;font-size:12.5px;color:var(--fg-3);">No hay una ficha activa con ese nombre. Tiene que existir en Clientes.</div>' : '');
      lista.style.display = lista.innerHTML ? '' : 'none';
    };
    input.addEventListener('input', () => { onSelect(null); pintar(); });
    lista.addEventListener('click', (e) => {
      const b = e.target.closest('.tr-hit'); if (!b) return;
      const c = clientes.find(x => x.id === b.dataset.id); if (!c) return;
      input.value = c.nombre; lista.style.display = 'none'; onSelect(c);
    });
  },
  _trasladoHtml({ intro, extraHtml = '' }) {
    return `
      ${intro}
      <label style="display:block; font-weight:600; font-size:13px; margin:12px 0 4px;">Ficha de cliente destino</label>
      <input type="text" class="form-input" id="trCliente" placeholder="Nombre o RUC (tiene que existir en Clientes)" autocomplete="off" style="width:100%;">
      <div id="trClienteLista" style="display:none; max-height:220px; overflow:auto; border:1px solid var(--border-subtle,#e5e7eb); border-radius:8px; margin-top:4px;"></div>
      ${extraHtml}
      <label style="display:block; font-weight:600; font-size:13px; margin:12px 0 4px;">Motivo</label>
      <textarea class="form-input" id="trMotivo" rows="2" style="width:100%; resize:vertical;" placeholder="Ej.: el contrato se hizo a la ficha de la sigla; el cliente es la razón social completa"></textarea>`;
  },

  // B2 · Un contrato a otra ficha (ACODECO → APC). Mismo número, mismos
  // equipos; cambia el cliente y todo lo que cuelga del contrato.
  trasladarContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    if (![ROLES.ADMIN, 'admin', ROLES.GERENTE].includes(this.rol)) { Toast.show('Trasladar un contrato lo hace administración o gerencia.', 'bad'); return; }
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id).length;
    this._trDestino = null;
    this._cerrarModal();
    this._abrirModalA({
      titulo: `Trasladar <span class="cg-mono">${this.esc(c.contrato_id || id)}</span> a otra ficha`,
      cuerpo: this._trasladoHtml({ intro: `
        <p style="font-size:13px; color:var(--fg-3); margin:0;">
          El contrato conserva su número, sus líneas y su estado (<b>${this.esc(this._estadoLabel(c))}</b>); cambia el cliente al que pertenece y al que se factura.
          Se van con él: sus seriales${enCampo ? ` (<b>${enCampo}</b> radio(s) en el inventario)` : ''}, la Base PoC, las órdenes y gestiones abiertas y los avisos de facturación. El representante que firmó no cambia.
          Activaciones recibe un correo con el cambio.</p>
        <p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">
          Si la ficha destino ya tiene un contrato con estos mismos radios, después de trasladar anula el sobrante como <b>sustitución</b> (ya estarán en la misma cuenta).</p>` }),
      footer: `
        <button class="btn btn-ghost cg-act" onclick="Centro.verContrato('${this.esc(id)}')">Volver</button>
        <span class="sep"></span>
        <button class="btn btn-primary cg-act" id="trBtn" onclick="Centro._trasladarContratoConfirmar('${this.esc(id)}')">Trasladar contrato</button>`,
    });
    this._montarBuscadorCliente(document.getElementById('cgModal'), { onSelect: (c2) => { this._trDestino = c2; } });
  },
  async _trasladarContratoConfirmar(id) {
    const c = this.contratos.find(x => x.id === id);
    const dest = this._trDestino;
    if (!c) return;
    if (!dest) { Toast.show('Elige la ficha destino de la lista.', 'warn'); document.getElementById('trCliente')?.focus(); return; }
    const motivo = (document.getElementById('trMotivo')?.value || '').trim();
    if (motivo.length < 8) { Toast.show('Escribe el motivo.', 'warn'); document.getElementById('trMotivo')?.focus(); return; }
    const ok = await Modal.confirm({
      title: 'Trasladar el contrato',
      message: `<span class="cg-mono">${this.esc(c.contrato_id || id)}</span> pasa de <b>${this.esc(this.cliente?.nombre || '')}</b> a <b>${this.esc(dest.nombre)}</b>. A partir de ahora se factura a ${this.esc(dest.nombre)}. ¿Seguir?`,
      confirmLabel: 'Trasladar',
    });
    if (!ok) return;
    const btn = document.getElementById('trBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Trasladando…'; }
    try {
      const r = await firebase.functions().httpsCallable('trasladarContratoCliente')({ contratoId: id, destinoClienteId: dest.id, motivo });
      const d = r.data || {};
      this._cerrarModal();
      Toast.show(`${d.contrato || c.contrato_id} → ${d.destino || dest.nombre}: ${d.seriales || 0} serial(es), ${d.pool || 0} radio(s), ${d.poc || 0} PoC, ${d.ordenes || 0} orden(es)`, 'ok', 9000);
      setTimeout(() => this.abrir(dest.id, { push: true }), 900);
    } catch (e) {
      console.error(e);
      if (btn) { btn.disabled = false; btn.textContent = 'Trasladar contrato'; }
      Toast.show(e?.message || 'No se pudo trasladar el contrato.', 'bad', 8000);
    }
  },

  // C1 · Cambio de razón social / traslado de cuenta (MORENO → ASESORÍA).
  trasladarCuenta() {
    if (!this.cliente) return;
    if (![ROLES.ADMIN, 'admin', ROLES.GERENTE].includes(this.rol)) { Toast.show('Trasladar una cuenta lo hace administración o gerencia.', 'bad'); return; }
    const vivos = (this.contratos || []).filter(c => ['pendiente_aprobacion', 'aprobado', 'activo'].includes(c.estado) && !c.deleted);
    const custodia = (this.equipos || []).filter(e => e.asignacion?.cliente_id === this.cliente.id);
    this._trDestino = null;
    this._cerrarModal();
    this._abrirModalA({
      titulo: `Trasladar la cuenta de <span class="cg-mono">${this.esc(this.cliente.nombre || '')}</span>`,
      cuerpo: this._trasladoHtml({ intro: `
        <p style="font-size:13px; color:var(--fg-3); margin:0;">
          Para un <b>cambio de razón social</b> o una cuenta abierta en la ficha equivocada. Todo lo <b>vivo</b> pasa a la ficha destino
          (que ya tiene que existir en Clientes, con su RUC): <b>${vivos.length}</b> contrato(s) vigente(s) con sus seriales, las fichas PoC <b>activas</b>,
          la custodia del inventario que esas fichas respaldan${custodia.length ? ` (hoy <b>${custodia.length}</b> radio(s) a nombre de esta cuenta)` : ''}, las gestiones y avisos abiertos y el catálogo de grupos PoC.
          Esta ficha queda <b>inactiva</b> apuntando a la nueva.</p>
        <p style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;">
          No se mueve: la historia (órdenes cerradas, facturas, contratos anulados o vencidos) ni lo que no se puede afirmar —fichas PoC inactivas y radios en custodia sin ficha activa ni contrato—; eso vuelve como lista <b>por confirmar</b> con bodega.
          No es una fusión de duplicados: para dos fichas del mismo RUC usa Admin · Clientes duplicados.</p>` }),
      footer: `
        <button class="btn btn-ghost cg-act" onclick="Centro._cerrarModal()">Cancelar</button>
        <span class="sep"></span>
        <button class="btn btn-primary cg-act" id="trBtn" onclick="Centro._trasladarCuentaConfirmar()">Trasladar la cuenta</button>`,
    });
    this._montarBuscadorCliente(document.getElementById('cgModal'), { onSelect: (c2) => { this._trDestino = c2; } });
  },
  async _trasladarCuentaConfirmar() {
    const dest = this._trDestino;
    if (!this.cliente) return;
    if (!dest) { Toast.show('Elige la ficha destino de la lista.', 'warn'); document.getElementById('trCliente')?.focus(); return; }
    const motivo = (document.getElementById('trMotivo')?.value || '').trim();
    if (motivo.length < 8) { Toast.show('Escribe el motivo.', 'warn'); document.getElementById('trMotivo')?.focus(); return; }
    const ok = await Modal.confirm({
      title: 'Trasladar la cuenta', danger: true,
      message: `<b>${this.esc(this.cliente.nombre || '')}</b> → <b>${this.esc(dest.nombre)}</b>. Esta ficha queda inactiva y todo lo vivo pasa a la otra. No se puede deshacer con un clic. ¿Seguir?`,
      confirmLabel: 'Sí, trasladar',
    });
    if (!ok) return;
    const btn = document.getElementById('trBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Trasladando…'; }
    try {
      const r = await firebase.functions().httpsCallable('trasladarCuentaCliente')({ origenClienteId: this.cliente.id, destinoClienteId: dest.id, motivo });
      const d = r.data || {};
      this._cerrarModal();
      const pc = Array.isArray(d.por_confirmar) ? d.por_confirmar : [];
      Toast.show(`Cuenta trasladada a ${d.destino || dest.nombre}: ${(d.contratos || []).length} contrato(s), ${d.poc || 0} ficha(s) PoC, ${d.pool || 0} radio(s) en custodia${pc.length ? ` · ${pc.length} por confirmar con bodega` : ''}`, pc.length ? 'warn' : 'ok', 10000);
      if (pc.length) {
        await Modal.alert({ title: 'Por confirmar con bodega', icon: 'alert-triangle',
          message: 'No se movieron (no hay con qué afirmar que la cuenta nueva los tiene):<br>' + pc.slice(0, 20).map(p => `<b style="font-family:var(--mono,monospace);">${this.esc(p.serial)}</b> · ${this.esc(p.motivo)}`).join('<br>') + (pc.length > 20 ? `<br>… y ${pc.length - 20} más` : '') + '<br><br>Bodega los corrige desde la ficha del radio ("Corregir ubicación") cuando sepa dónde están.' });
      }
      setTimeout(() => this.abrir(dest.id, { push: true }), 600);
    } catch (e) {
      console.error(e);
      if (btn) { btn.disabled = false; btn.textContent = 'Trasladar la cuenta'; }
      Toast.show(e?.message || 'No se pudo trasladar la cuenta.', 'bad', 8000);
    }
  },

  anularContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    if (![ROLES.ADMIN, ROLES.GERENTE].includes(this.rol)) { Toast.show('Solo administración o gerencia puede anular contratos.', 'bad'); return; }
    if (!ContratoAnulacion.esAnulable(c)) { Toast.show('Solo se puede anular un contrato ACTIVO, APROBADO o pendiente de aprobación.', 'bad'); return; }
    const cands = ContratoAnulacion.candidatos(this.contratos, id);
    const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === id).length;
    // Un contrato EN TRÁMITE (pendiente de aprobación) nunca movió equipo: la
    // pregunta de los equipos sobra — solo el motivo.
    const conEquipos = ContratoAnulacion.preguntaEquipos(c);
    const opcion = (valor, checked, titulo, sub) => `
      <label style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border:1px solid var(--border-default); border-radius:10px; cursor:pointer;">
        <input type="radio" name="anulTipo" value="${valor}" ${checked ? 'checked' : ''} style="margin-top:3px;" onchange="Centro._anulSync()">
        <span><b>${titulo}</b><br><small style="color:var(--fg-3);">${sub}</small></span></label>`;
    this._cerrarModal();
    this._abrirModalA({
      titulo: `Anular <span class="cg-mono">${this.esc(c.contrato_id || id)}</span>`,
      cuerpo: `
        ${conEquipos ? `
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 12px;">¿Qué pasa con los equipos${enCampo ? ` (<b>${enCampo}</b> en campo bajo este contrato)` : ''}?
          De eso depende que el sistema abra o no una orden para recuperarlos.</p>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
          ${opcion('sustitucion', true, 'Se rehace el contrato — el cliente conserva los equipos.', 'Error de precio, de representante, de modelo… El equipo no se mueve.')}
          ${opcion('terminacion', false, 'Termina el acuerdo — el cliente devuelve los equipos.', 'Se abrirá una orden de DEVOLUCIÓN para recuperarlos.')}
        </div>` : `
        <p style="font-size:13px; color:var(--fg-3); margin:0 0 12px;">El contrato está <b>en trámite</b> (todavía no se aprobó): se anula sin mover ningún equipo
          y queda en el historial con el motivo. Si hace falta, crea el contrato correcto después.</p>`}
        <div id="anulBloqueSust" style="margin-bottom:12px;${conEquipos ? '' : ' display:none;'}">
          <label style="display:block; font-weight:600; font-size:13px; margin-bottom:4px;">Contrato que lo sustituye <small style="font-weight:400; color:var(--fg-3);">(opcional)</small></label>
          <select class="form-input" id="anulSustituto" style="width:100%;">
            <option value="">Todavía no lo he creado</option>
            ${cands.map(x => `<option value="${this.esc(x.id)}">${this.esc(x.contrato_id || x.id)}${x.total_mensual ? ` — $${Number(x.total_mensual).toFixed(2)}/mes` : ''}</option>`).join('')}
          </select>
          <small style="color:var(--fg-3);">Si lo indicas, los equipos pasan solos al contrato nuevo.</small>
        </div>
        <label style="display:block; font-weight:600; font-size:13px; margin-bottom:4px;">Motivo</label>
        <textarea class="form-input" id="anulMotivo" rows="3" style="width:100%; resize:vertical;"
          placeholder="Ej: el precio no incluyó el ajuste del micrófono"></textarea>`,
      footer: `
        <button class="btn btn-ghost cg-act" onclick="Centro.verContrato('${this.esc(id)}')">Volver</button>
        <span class="sep"></span>
        <button class="btn-danger cg-act" onclick="Centro._anularContratoConfirmar('${this.esc(id)}')">Anular contrato</button>`,
    });
  },
  _anulSync() {
    const tipo = document.querySelector('#cgModal input[name="anulTipo"]:checked')?.value;
    document.getElementById('anulBloqueSust')?.classList.toggle('hidden', tipo !== 'sustitucion');
  },
  async _anularContratoConfirmar(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const motivo = (document.getElementById('anulMotivo')?.value || '').trim();
    if (!motivo) { document.getElementById('anulMotivo')?.focus(); Toast.show('Debes indicar un motivo.', 'bad'); return; }
    const conEquipos = ContratoAnulacion.preguntaEquipos(c);
    const tipo = conEquipos
      ? (document.querySelector('#cgModal input[name="anulTipo"]:checked')?.value || 'sustitucion')
      : 'sustitucion';   // en trámite: nada se mueve
    const sustId = conEquipos && tipo === 'sustitucion' ? (document.getElementById('anulSustituto')?.value || '') : '';
    const sustituto = sustId ? this.contratos.find(x => x.id === sustId) : null;
    const update = ContratoAnulacion.buildUpdate(c, { motivo, tipo, sustituto, uid: this.uid }, id);
    try {
      await ContratosService.updateContrato(id, update);
      this._cerrarModal();
      Toast.show(ContratoAnulacion.mensaje(update, c), 'ok');
      // onAnnulment corre en ~1-2s (devolución / traspaso de equipos): la ficha
      // se recarga completa para que contratos, equipos y señales lo reflejen.
      setTimeout(() => { if (this.cliente) this.abrir(this.cliente.id, { push: false }); }, 1500);
    } catch (e) { console.error(e); Toast.show('No se pudo anular el contrato.', 'bad'); }
  },

  // Aprobación del contrato SIN salir del Centro (2026-08-28: el correo de
  // "contrato creado" mandaba al módulo viejo para aprobar). Mismos campos
  // que contratos-approval.js; las rules solo guardan el salto a 'activo'.
  // ── Contrato en papel: imprimir y subir el firmado desde el Centro ──
  // (Alberto 2026-09-07: el anexo de aumento tenía imprimir + subir firmado a
  // la vista y el contrato/renovación no — "Subir firmado" vivía solo en el
  // módulo viejo de /contratos/.) Misma vía que contratos-upload.js: subir el
  // PDF de un contrato APROBADO lo activa en el mismo write
  // (rules::esActivacionPorFirmado, admin/vendedor); sobre un contrato ACTIVO
  // repunta el archivo y archiva el anterior en firmado_historial[].
  _puedeSubirFirmado() { return [ROLES.ADMIN, 'admin', ROLES.VENDEDOR].includes(this.rol); },
  // Un contrato ACTIVO firmado DIGITALMENTE no tiene `firmado_url` y no le
  // falta nada: la firma vive dentro del documento. Sin esta excepción, al
  // volverse alcanzable esa rama (2026-09-10) le ofrecíamos "adjuntar el
  // firmado" a contratos que ya están completos.
  // Un REEMPLAZO queda fuera (2026-09-15): no solo no lleva firma — subirle
  // una lo pasa a `activo`, y una activación le crea un aviso de facturación
  // con su comisión por unos radios que solo cambiaron de número de serie.
  _aceptaFirmado(c) {
    if (!ContratoFirma.lleva(c)) return false;
    // Un dormido se reactiva primero (la firma reabre el trámite).
    if (ContratoFirma.dormido(c)) return false;
    return (c?.estado === 'aprobado' && !c.firmado)
      || (c?.estado === 'activo' && !c.firmado_url && c.firmado_tipo !== 'digital');
  },

  // ── El firmado, visible desde el Centro (2026-09-10) ──────────────────────
  // Un contrato firmado tiene el papel en Storage (`firmado_url`) o la firma
  // digital dentro del propio documento (`firmado_tipo === 'digital'`, sin
  // PDF: /firmar/ congela la copia y documento.html la reconstruye). Las dos
  // formas se abren igual de fácil o no se abre ninguna.
  _accFirmado(c) {
    if (!c?.firmado) return null;
    const cuando = c.firmado_fecha ? `firmado ${this._fmtFecha(c.firmado_fecha)}` : '';
    if (c.firmado_url) {
      // _menuAccionesHtml mete `href` crudo en el atributo: se escapa aquí.
      return this._acc({ id: 'firmado', grupo: 'Documentos', label: 'Ver el firmado (PDF)',
        blank: true, hint: cuando, href: this.esc(c.firmado_url) });
    }
    if (c.firmado_tipo === 'digital') {
      return this._acc({ id: 'firmado', grupo: 'Documentos', label: 'Ver el firmado (por enlace)',
        blank: true, hint: cuando ? `${cuando} — no hay PDF: el documento trae la firma` : 'no hay PDF: el documento trae la firma',
        href: `../contratos/documento.html?id=${encodeURIComponent(c.id)}` });
    }
    return null;
  },
  // Fila "Firmado" de la vista previa. Antes decía "sí ✓" y ahí se acababa.
  _firmadoTxt(c) {
    if (!c?.firmado) return '';
    const cuando = c.firmado_fecha ? ` · ${this._fmtFecha(c.firmado_fecha)}` : '';
    if (c.firmado_url) {
      return `<a href="${this.esc(c.firmado_url)}" target="_blank" rel="noopener">Ver el PDF firmado</a>${cuando}`;
    }
    if (c.firmado_tipo === 'digital') {
      // Una sola palabra para esa firma en todo el app: "por enlace" (C9).
      return `<a href="../contratos/documento.html?id=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Ver el documento firmado</a>${cuando} (firmado por enlace)`;
    }
    return `sí ✓${cuando}`;
  },
  // Fila "Entregado" de la vista previa: dos de los tres requisitos de comisión
  // (firma y entrega) quedan a la vista donde Zuleika ya está parada.
  // Un "—" a secas se lee como "falta", y una RENOVACIÓN no entrega nada nunca
  // — por eso el motivo va escrito (caso R. Smith Coronado, ALQ20260601-02).
  _entregaTxt(c) {
    if (!c || c.estado !== 'activo') return '';
    if (c.entrega_confirmada === true) {
      return `sí ✓${c.fecha_entrega_ultima ? ` · ${this._fmtFecha(c.fecha_entrega_ultima)}` : ''}`;
    }
    if (!this._entregaAplica(c)) {
      return '<span style="color:var(--fg-3);">no aplica — los equipos ya están en el cliente</span>';
    }
    return '<span class="cg-venc por_vencer">pendiente</span>';
  },
  // Copia en el navegador del predicado `esperando` de
  // functions/src/triggers/contratos/onApproval.js:287. Consciente: hoy no hay
  // dónde compartirla entre front y back. La F2 de docs/plans/PLAN_COMISIONES.md
  // la unifica en lib/facturacionAvisos.entregaAplica() — si cambias una,
  // cambia la otra.
  _entregaAplica(c) {
    if (!c) return false;
    if (c.accion === 'Renovación' || c.renovacion_sin_equipo) return false;
    return (c.equipos || []).some(e => Number(e.cantidad || 0) > 0);
  },
  // "Editar" del expediente: el editor rechaza un contrato ACTIVO y uno con
  // enlace de firma abierto (rebotaba al Centro sin decir por qué — Cerdas,
  // 2026-09-09). Aquí se dice de frente y, si es el enlace, se ofrece retirarlo.
  // Retirar un enlace de firma pendiente: pendiente → cancelado en la
  // solicitud (la página pública lo muestra como "no válido"; la regla lo
  // permite a admin/gerente/vendedor) y el contrato vuelve a editarse. Al
  // reenviar se genera un enlace nuevo con la copia actualizada.
  async retirarEnlaceFirma(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.firma_solicitud_estado !== 'pendiente' || !c.firma_solicitud_id) { Toast.show('Este contrato no tiene un enlace de firma pendiente', 'warn'); return; }
    this._cerrarModal();
    const ok = await Modal.confirm({
      title: 'Retirar el enlace de firma', danger: true, confirmLabel: 'Retirar enlace',
      message: `El enlace que se le envió al cliente deja de servir (verá "enlace no válido"). El contrato
        <b class="cg-mono">${this.esc(c.contrato_id || c.id)}</b> vuelve a poder editarse; para firmar habrá que enviar un enlace nuevo.`,
    });
    if (!ok) { this.abrirGestion(`ct-${c.id}`); return; }
    try {
      await firebase.firestore().collection('firma_solicitudes').doc(c.firma_solicitud_id).update({ estado: 'cancelado' });
      await ContratosService.updateContrato(c.id, { firma_solicitud_estado: 'cancelado' });
      c.firma_solicitud_estado = 'cancelado';
      Toast.show('Enlace retirado — el contrato ya se puede editar', 'ok');
    } catch (e) { console.error(e); Toast.show('No se pudo retirar el enlace: ' + (e.message || e), 'bad'); }
    this.abrirGestion(`ct-${c.id}`);
  },

  subirFirmadoContrato(id, fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return undefined;
    return withBusy(null, () => this._subirFirmadoContrato(id, files), { key: 'subirFirmado:' + id, rethrow: false });
  },
  async _subirFirmadoContrato(id, files) {
    if (!this._puedeSubirFirmado()) { Toast.show('Solo administración o el vendedor suben el contrato firmado', 'warn'); return; }
    const c = this.contratos.find(x => x.id === id);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    // Candado, no solo el menú escondido (ver _aceptaFirmado): subirle un
    // firmado a un reemplazo lo activaría, y una activación arranca a facturar.
    if (!ContratoFirma.lleva(c)) { Toast.show(`Este contrato no lleva firma: ${ContratoFirma.porQue(c)}`, 'warn'); return; }
    const modo = c.estado === 'aprobado' ? 'activacion' : c.estado === 'activo' ? 'reemplazo' : null;
    if (!modo) { Toast.show('Solo se sube el firmado a contratos aprobados o activos', 'warn'); return; }
    const legible = c.contrato_id || id;
    if (modo === 'reemplazo' && c.firmado_url && !(await Modal.confirm({
      title: 'Sustituir el archivo firmado', confirmLabel: 'Sustituir',
      message: `Vas a sustituir el archivo firmado de <b class="cg-mono">${this.esc(legible)}</b>. El actual queda
        archivado en el historial (no se borra); el estado y la fecha de activación no cambian.`,
    }))) return;
    // storage.rules exige application/pdf en contratos_firmados/: un PDF pasa
    // directo; las FOTOS (WhatsApp) se arman en un solo PDF con el conversor
    // de contratos-upload.js. Mezclar PDF con fotos no tiene orden: se rechaza.
    const esPdf = (f) => f.type === 'application/pdf' || (f.name.split('.').pop() || '').toLowerCase() === 'pdf';
    const esImg = (f) => /^image\//.test(f.type);
    let file;
    try {
      if (files.length === 1 && esPdf(files[0])) file = files[0];
      else if (files.every(esImg)) {
        if (!window.ContratosFirmado?._fotosAPdf) throw new Error('el conversor de fotos no está cargado');
        Toast.show(`Armando un PDF con ${files.length} foto(s)…`, '');
        const blob = await ContratosFirmado._fotosAPdf(files);
        file = new File([blob], `firmado_${files.length}fotos.pdf`, { type: 'application/pdf' });
      } else { Toast.show('Sube UN PDF, o solo fotos (varias a la vez) — no mezclados', 'warn'); return; }
    } catch (e) { console.error(e); Toast.show('No se pudo preparar el archivo: ' + (e?.message || e), 'bad'); return; }
    // storage.rules corta en 10 MiB y responde un 403 mudo: se avisa antes.
    if (file.size >= 10 * 1024 * 1024) { Toast.show(`El archivo pesa ${(file.size / 1048576).toFixed(1)} MB; el máximo es 10 MB. Comprímelo o escanéalo a menor resolución.`, 'warn'); return; }
    // Subir el firmado activa el contrato EN EL MISMO write, y la activación
    // dispara facturación y comisión: se confirma con el nombre del archivo
    // (auditoría UX 2026-09-28, P1).
    if (modo === 'activacion' && !(await Modal.confirm({
      title: 'Subir el firmado y activar', confirmLabel: 'Subir y activar',
      message: `Archivo: <b>${this.esc(file.name)}</b> para el contrato <b class="cg-mono">${this.esc(legible)}</b>.
        <br><br><b>Esto ACTIVA el contrato y arranca la facturación y la comisión.</b>
        ${this._serialesListos(c) ? '' : '<br><br>Ojo: bodega todavía no asignó los seriales de este contrato.'}
        Revisa que sea el documento firmado correcto antes de seguir.`,
    }))) return;
    try {
      Toast.show('Subiendo contrato firmado…', '');
      // Siempre PDF a esta altura (ver arriba). El tipo se fija a mano: un PDF de
      // WhatsApp o del escáner llega con file.type vacío u octet-stream, y la
      // regla de contentType lo rechazaba con 403 (2026-09-30, ALQ20260721-01).
      const path = `contratos_firmados/${legible}_${Date.now()}.pdf`;
      const snap = await firebase.storage().ref(path).put(file, {
        contentType: 'application/pdf',
        customMetadata: { contrato_doc_id: id, contrato_id: legible },
      });
      const url = await snap.ref.getDownloadURL();
      const ahora = firebase.firestore.Timestamp.now();
      const update = {
        firmado: true, firmado_url: url, firmado_nombre: file.name,
        firmado_storage_path: path, firmado_fecha: ahora, firmado_por_uid: this.uid,
      };
      if (modo === 'activacion') {
        update.estado_previo = c.estado;
        update.estado = 'activo';
        update.fecha_activacion = ahora;
      } else if (c.firmado_url) {
        // Timestamp.now() y no serverTimestamp(): arrayUnion no acepta sentinels.
        update.firmado_historial = firebase.firestore.FieldValue.arrayUnion({
          firmado_url: c.firmado_url || null, firmado_nombre: c.firmado_nombre || null,
          firmado_storage_path: c.firmado_storage_path || null, firmado_fecha: c.firmado_fecha || null,
          firmado_por_uid: c.firmado_por_uid || null,
          reemplazado_at: ahora, reemplazado_por_uid: this.uid, reemplazado_por: url,
        });
      }
      await ContratosService.updateContrato(id, update);
      this._cerrarModal();
      Toast.show(modo === 'activacion'
        ? `Contrato ${legible} firmado y ACTIVO — ${c.accion === 'Renovación' ? 'la cuenta queda consolidada; ' : ''}la custodia se amarra al entregarse`
        : `Contrato ${legible}: firmado reemplazado — el anterior quedó archivado`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo subir el contrato firmado: ' + (e?.message || e), 'bad', 8000);
    }
  },

  aprobarContrato(id) {
    return this._candado('aprobarContrato:' + id, () => this._aprobarContrato(id), 'Aprobando…');
  },
  // Resumen de lo que se aprueba (auditoría de módulos 2026-09-30, C7): un
  // clic aprobaba sin ver líneas ni total: un TEMP con el modelo equivocado
  // pasaba a bodega sin que nadie lo notara. Cuatro líneas y confirmación.
  _resumenAprobacionHtml(c) {
    const esc = (v) => this.esc(v);
    const tipoTxt = c.accion === 'Renovación' ? 'Renovación de cuenta'
      : this._codigoTipo(c) === 'TEMP' ? 'Contrato temporal'
      : this._codigoTipo(c) === 'DEMO' ? 'Demo' : this._codigoTipo(c) === 'REEMP' ? 'Reemplazo' : 'Contrato nuevo';
    const lineas = (c.equipos || []).map(l =>
      `${esc(l.modelo || '—')} × ${Number(l.cantidad || 0)}${Number(l.precio) > 0 ? ` · $${Number(l.precio).toFixed(2)}/mes` : ''}${l.modalidad === 'propio' ? ' (del cliente)' : ''}`);
    const unid = (c.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
    const dur = this._durTxt(c);
    const seriales = this._serialesListos(c)
      ? (c.accion === 'Renovación' && c.renovacion_sin_equipo ? 'renovación sin equipo: no pide seriales a bodega' : 'sin seriales que asignar')
      : `bodega asigna ${unid} serial${unid === 1 ? '' : 'es'} después de aprobar`;
    const plan = c.transicion_plan && window.TransicionPlan?.resumen ? TransicionPlan.resumen(c.transicion_plan) : '';
    const despues = ContratoFirma.lleva(c) ? 'luego el cliente firma' : 'luego sigue la entrega de los equipos (sin firma)';
    // Spans en bloque: Modal.confirm pinta el mensaje dentro de un <p>.
    const fila = (k, v) => `<span style="display:flex; gap:10px; padding:3px 0; border-bottom:1px solid var(--border-subtle);"><span style="min-width:92px; flex:none; color:var(--fg-3);">${k}</span><span>${v}</span></span>`;
    return `<span style="display:block; font-size:13.5px; line-height:1.45;">
      ${fila('Contrato', `<b class="cg-mono">${esc(c.contrato_id || c.id)}</b> · ${esc(tipoTxt)}${dur ? ` · ${esc(dur)}` : ''}<br><span style="color:var(--fg-3);">${esc(c.cliente_nombre || this.cliente?.nombre || '')}${c.motivo_contrato_nuevo ? ` · motivo: ${esc(c.motivo_contrato_nuevo)}` : ''}</span>`)}
      ${fila('Equipos', lineas.length ? lineas.join('<br>') : '<span style="color:var(--warn-deep, #92400E);">sin líneas de equipo</span>')}
      ${fila('Mensual', `<b class="num">$${Number(c.total_mensual ?? c.total_con_itbms ?? 0).toFixed(2)}</b>${c.itbms_aplica === false ? ' · sin ITBMS' : ' con ITBMS'}${Number(c.subtotal_cargos_unicos || 0) > 0 ? ` · cargos únicos $${Number(c.subtotal_cargos_unicos).toFixed(2)}` : ''}`)}
      ${fila('Seriales', `${esc(seriales)}${plan ? `<br><span style="color:var(--fg-3);">${esc(plan)}</span>` : ''}`)}
      ${c.sustituye_a_pendiente_id ? fila('Sustituye a', `<b class="cg-mono">${esc(c.sustituye_a_pendiente_contrato_id || c.sustituye_a_pendiente_id)}</b> — al aprobar se anula por sustitución y sus equipos pasan a este contrato`) : ''}
      <span style="display:block; margin:10px 0 0; font-size:12.5px; color:var(--fg-3);">Al aprobar: ${seriales.startsWith('bodega') ? 'bodega recibe el aviso para asignar; ' : ''}${despues}.</span>
    </span>`;
  },
  async _aprobarContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.estado !== 'pendiente_aprobacion') { Toast.show('El contrato no está pendiente de aprobación', 'warn'); return; }
    const ok = await Modal.confirm({
      title: 'Aprobar el contrato',
      message: this._resumenAprobacionHtml(c),
      confirmLabel: 'Aprobar contrato',
    });
    if (!ok) return;
    try {
      await ContratosService.updateContrato(id, {
        estado: 'aprobado',
        fecha_aprobacion: firebase.firestore.Timestamp.now(),
        aprobado_por_uid: this.uid,
        fecha_modificacion: new Date(),
      });
      // El vendedor dijo al crearlo que ESTE contrato sustituye a otro vivo
      // (B1, 2026-10-07): se anula aquel por sustitución con este como
      // sustituto, y onAnnulment traspasa sus seriales. Lo hace quien aprueba
      // (administración), que es quien puede anular.
      let sustituido = '';
      const viejoId = c.sustituye_a_pendiente_id;
      const viejo = viejoId ? this.contratos.find(x => x.id === viejoId) : null;
      if (viejo && ['activo', 'aprobado'].includes(viejo.estado)) {
        try {
          const upd = ContratoAnulacion.buildUpdate(viejo, {
            motivo: `Sustituido por ${c.contrato_id || id} (declarado al crear el contrato nuevo)`,
            tipo: 'sustitucion', sustituto: { id, contrato_id: c.contrato_id || '' }, uid: this.uid,
          }, viejoId);
          await ContratosService.updateContrato(viejoId, upd);
          await ContratosService.updateContrato(id, { sustituye_a_pendiente_id: firebase.firestore.FieldValue.delete(), sustituye_a_pendiente_contrato_id: firebase.firestore.FieldValue.delete(), sustituye_a_id: viejoId, sustituye_a_contrato_id: viejo.contrato_id || '' });
          sustituido = ` · ${viejo.contrato_id || viejoId} queda anulado y sus equipos pasan a este`;
        } catch (e) { console.error('[centro] anular el sustituido', e); Toast.show(`Aprobado, pero no se pudo anular ${viejo.contrato_id || viejoId}: anúlalo a mano como sustitución.`, 'warn', 8000); }
      }
      this._cerrarModal();
      Toast.show(`Contrato ${c.contrato_id || id} aprobado — ${ContratoFirma.lleva(c) ? 'bodega asigna los seriales y luego sigue la firma del cliente' : 'sigue la entrega de los equipos'}${sustituido}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar el contrato', 'bad'); }
  },
});
