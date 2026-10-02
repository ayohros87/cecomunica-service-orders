// @ts-nocheck
// Centro de gestión de clientes — Ficha reordenada (2026-09-08, "cada pieza en su lugar").
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Ficha reordenada (2026-09-08, "cada pieza en su lugar") ═════════
   * Verificado con emulador: la ficha medía 3,558 px (5,056 en móvil), los
   * equipos eran el 67 % y las gestiones quedaban al final. Ahora: cabecera
   * con estado y UN botón primario, una sola cola "Ahora", una franja de
   * números y bloques plegables con su resumen. Los pintores viejos quedan
   * como alias porque los llaman la recarga y el listener. */
  pintarAcciones() { this.pintarAhora(); },
  pintarSenales() { /* fundido en pintarAhora */ },
  pintarKpis() { this.pintarResumen(); },

  // "Le toca a" ya no se adivina con regex sobre el texto: cada fila trae su
  // {rol} desde la fuente (_itemsAccion, _itemsSenal) y TOCA le pone nombre.
  _ahoraTodo: false,
  // Las filas de "Ahora", ya fundidas y ordenadas (bad → warn → info). La
  // primera es lo que la cuenta pide primero: de ahí sale también el botón
  // primario de la cabecera (_accionPrimaria).
  _itemsAhora() {
    const acc = this._itemsAccion().map(x => ({ tono: x.tono === 'info' ? 'info' : 'warn', t: x.t, s: x.s, btns: x.btns, rol: x.rol }));
    const sen = this._itemsSenal().map(x => ({ tono: x.tipo, t: this.esc(x.txt), s: '', btns: x.extra || '', rol: x.rol }));
    const peso = { bad: 0, warn: 1, info: 2 };
    return [...acc, ...sen].sort((a, b) => (peso[a.tono] ?? 3) - (peso[b.tono] ?? 3));
  },
  // El botón primario de una fila de "Ahora" ({label, onclick}), o null si
  // la fila no tiene uno (solo "Ver contrato", o es de bodega/cliente).
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
  pintarAhora() {
    const cont = document.getElementById('fAhora');
    if (!cont) return;
    const items = this._itemsAhora();
    if (!items.length) {
      cont.innerHTML = `<div class="ok"><i data-lucide="check-circle-2" style="width:15px;height:15px;"></i> Nada pendiente en esta cuenta.</div>`;
      return;
    }
    const MAX = 3;
    const vis = this._ahoraTodo ? items : items.slice(0, MAX);
    const fila = (x) => {
      const toca = this._tocaLabel(x.rol);
      return `<div class="row ${x.tono}"><span class="dot"></span>
        <span class="t"><b>${x.t}</b><span class="s">${x.s}${x.s && toca ? ' · ' : ''}${toca ? `le toca a <span class="toca">${this.esc(toca)}</span>` : ''}</span></span>
        <span class="btns">${x.btns}</span></div>`;
    };
    cont.innerHTML = `<div class="hd">Ahora · ${items.length}
        ${items.length > MAX ? `<button type="button" class="mas" onclick="Centro._ahoraTodo=!Centro._ahoraTodo; Centro.pintarAhora(); if(window.lucide) lucide.createIcons()">${this._ahoraTodo ? 'Ver menos' : `Ver ${items.length - MAX} más`}</button>` : ''}</div>
      ${vis.map(fila).join('')}`;
  },

  // Franja de números con enlace al bloque (reemplaza los cuatro tiles).
  pintarResumen() {
    const cont = document.getElementById('fResumen');
    if (!cont) return;
    const enTram = this._idsEnTramite();
    const vig = this.contratos.filter(c => this._esOperativo(c, enTram));
    const mensual = vig.reduce((s, c) => s + Number(c.total_mensual ?? c.total_con_itbms ?? 0), 0);
    const enContrato = this.equipos.filter(e => ['en_cliente', 'asignado_contrato'].includes(e.estado) && e.asignacion?.contrato_doc_id).length;
    const sinContrato = this.equipos.filter(e => e.estado === 'en_cliente' && !e.asignacion?.contrato_doc_id).length;
    const porClasificar = this.equipos.filter(e => e.estado === 'por_clasificar').length;
    const taller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    const abiertas = (this.gestiones || []).filter(g => GestionesService.ABIERTAS.includes(g.estado)).length + this._tramitesContrato().length;
    const L = (blk, html) => `<button type="button" onclick="Centro.abrirBloque('${blk}')">${html}</button>`;
    cont.innerHTML = [
      L('blkContratos', `Vigentes <b>${vig.length}</b>`),
      `<span>Mensual <b class="num">$${mensual.toFixed(2)}</b></span>`,
      L('blkEquipos', `En contrato <b>${enContrato}</b>`),
      sinContrato ? L('blkEquipos', `Sin contrato <b>${sinContrato}</b>`) : '',
      // "Por clasificar" es cola de BODEGA, no deuda de la cuenta (decisión 8,
      // 1-oct-2026): se dice como tal y no dispara nada.
      porClasificar ? `<button type="button" onclick="Centro.abrirBloque('blkEquipos')" title="${porClasificar} radio(s) por clasificar: los revisa bodega, no cuentan como deuda de la cuenta">Bodega <b>${porClasificar}</b></button>` : '',
      L('blkGestiones', `En trámite <b>${abiertas}</b>`),
      taller ? L('blkEquipos', `En taller <b>${taller}</b>`) : '',
    ].filter(Boolean).join('');
    // La cabecera resume la cuenta en una línea y los chips dicen el estado.
    const meta = document.getElementById('fMeta');
    const c = this.cliente || {};
    if (meta) meta.textContent = [
      `${vig.length} contrato${vig.length === 1 ? '' : 's'} vigente${vig.length === 1 ? '' : 's'}`,
      `${this.equipos.length} radio${this.equipos.length === 1 ? '' : 's'}`,
      c.vendedor_email ? `Vendedor: ${c.vendedor_email.split('@')[0]}` : null,
      this._rucLegible(c),
      c.telefono || null,
    ].filter(Boolean).join(' · ');
    this._pintarChipReg(c);
    this._pintarSumarios({ vig, enContrato, sinContrato, porClasificar, taller, abiertas });
    this._pintarPrimario();
  },

  // Resúmenes de una línea en la cabecera de cada bloque.
  _pintarSumarios({ vig, enContrato, sinContrato, porClasificar, taller, abiertas }) {
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    const cerradas = (this.gestiones || []).filter(g => ['cerrada', 'anulada'].includes(g.estado)).length;
    set('sumGestiones', abiertas ? `${abiertas} en trámite · ${cerradas} en historial` : (cerradas ? `nada en trámite · ${cerradas} en historial` : 'nada en trámite'));
    let vencidos = 0, proxima = null;
    const hoy = new Date();
    for (const c of vig) {
      if (!this._aplicaVenc(c) || !c.fecha_vencimiento) continue;
      const d = c.fecha_vencimiento.toDate ? c.fecha_vencimiento.toDate() : new Date(c.fecha_vencimiento);
      if (isNaN(d)) continue;
      if (d < hoy) vencidos++; else if (!proxima || d < proxima) proxima = d;
    }
    set('sumContratos', vig.length
      ? `${vig.length} vigente${vig.length === 1 ? '' : 's'}${proxima ? ` · próximo vence ${this._fmtFecha(proxima)}` : ''}${vencidos ? ` · ${vencidos} vencido${vencidos === 1 ? '' : 's'}` : ''}`
      : 'sin contratos vigentes');
    set('sumEquipos', this.equipos.length
      ? [`${this.equipos.length}`, `${enContrato} en contrato`, sinContrato ? `${sinContrato} sin contrato` : '', porClasificar ? `${porClasificar} por clasificar` : '', taller ? `${taller} en taller` : ''].filter(Boolean).join(' · ')
      : 'sin equipos en el inventario');
  },

  // Chips de estado junto al nombre: vencidos, en trámite, regularización.
  _pintarChipReg(c) {
    const el = document.getElementById('fRegChip');
    if (!el) return;
    const chips = [];
    const enTram = this._idsEnTramite();
    const vig = (this.contratos || []).filter(x => this._esOperativo(x, enTram));
    const vencidos = vig.filter(x => this._vencInfo(x)?.estado === 'vencido').length;
    if (vencidos) chips.push(`<button type="button" class="cg-chip cg-chip--bad" style="border:0; cursor:pointer; font:inherit; font-size:12px;" onclick="Centro.abrirBloque('blkContratos')">${vencidos} contrato${vencidos === 1 ? '' : 's'} vencido${vencidos === 1 ? '' : 's'}</button>`);
    const chip = (typeof Regularizacion !== 'undefined') ? Regularizacion.chip(c?.regularizacion) : null;
    if (chip) {
      const cls = chip.tono === 'bad' ? 'cg-chip--bad' : chip.tono === 'warn' ? 'cg-chip--warn' : 'cg-chip--muted';
      chips.push(`<button type="button" class="cg-chip ${cls}" onclick="Centro.verRegularizacion()"
        style="border:0; cursor:pointer; font:inherit; font-size:12px;" title="Qué le falta a esta cuenta para estar bien registrada">${this.esc(chip.texto)}</button>`);
    }
    const tram = (this.gestiones || []).filter(g => GestionesService.ABIERTAS.includes(g.estado)).length + this._tramitesContrato().length;
    if (tram) chips.push(`<button type="button" class="cg-chip cg-chip--info" style="border:0; cursor:pointer; font:inherit; font-size:12px;" onclick="Centro.abrirBloque('blkGestiones')">${tram} en trámite</button>`);
    if (!chips.length && this.contratos.length) chips.push(`<span class="cg-chip cg-chip--ok" style="font-size:12px;">Al día</span>`);
    el.innerHTML = chips.join(' ');
  },

  // La acción que la cuenta pide primero — el botón primario de la cabecera,
  // el destacado del menú y el dock móvil salen de aquí (una sola regla).
  _accionPrimaria() {
    if (!this.puedeCrearGestion()) return null;
    // Lo primero de "Ahora" manda (auditoría de módulos 2026-09-30, R3): si la
    // cuenta tiene algo esperando a alguien, ESE botón es el primario — no
    // una renovación de 16 contratos por 2 radios sin contrato. Si la fila no
    // trae botón primario (le toca a bodega o al cliente), se sigue abajo.
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
  _pintarPrimario() {
    const P = this._accionPrimaria();
    const btn = document.getElementById('btnPrimario');
    if (btn) {
      btn.classList.toggle('hidden', !P);
      if (P) { btn.textContent = P.label; btn.setAttribute('onclick', P.onclick); btn.title = P.hint || ''; }
    }
    // El "Nueva gestión" de la cabecera sigue la misma regla que el del dock:
    // quien no crea gestiones (bodega, contabilidad) no ve el botón (D17).
    document.getElementById('btnGestion')?.classList.toggle('hidden', !this.puedeCrearGestion());
    const dock = document.getElementById('cgDock');
    if (dock) dock.innerHTML = !this.puedeCrearGestion() ? '' : `<span aria-hidden="true"></span>
      <button class="btn" onclick="Centro.abrirMenuDesdeDock()">Nueva gestión ▾</button>
      ${P ? `<button class="btn btn-primary" onclick="${P.onclick}">${P.label}</button>` : ''}`;
  },
  abrirMenuDesdeDock() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => document.getElementById('cgMenu')?.classList.remove('hidden'), 250);
  },
  toggleMas(e) {
    e.stopPropagation();
    document.getElementById('cgMenu')?.classList.add('hidden');
    const m = document.getElementById('cgMasMenu');
    if (!m) return;
    m.classList.toggle('hidden');
    if (!m.classList.contains('hidden')) {
      document.addEventListener('click', () => m.classList.add('hidden'), { once: true });
    }
  },
  abrirBloque(id) {
    const d = document.getElementById(id);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  // Qué bloque abre solo al entrar: el que tenga trabajo vivo; si no, Contratos.
  _bloquesDe: null,
  _abrirBloques(clienteId) {
    if (this._bloquesDe === clienteId) return;
    this._bloquesDe = clienteId;
    const vivas = (this.gestiones || []).some(g => GestionesService.ABIERTAS.includes(g.estado)) || this._tramitesContrato().length > 0;
    const ids = ['blkGestiones', 'blkContratos', 'blkEquipos', 'blkActividad'];
    const abrir = this.gSel ? 'blkGestiones' : vivas ? 'blkGestiones' : 'blkContratos';
    ids.forEach(id => { const d = document.getElementById(id); if (d) d.open = id === abrir; });
    const act = document.getElementById('fActividad');
    if (act) act.innerHTML = '<div class="cg-vacio">Ábrelo para cargar el historial.</div>';
    this._actividadDe = null;
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
    const enTaller = this.equipos.filter(e => ['en_taller', 'devuelto_revision'].includes(e.estado)).length;
    if (enTaller) out.push({ tipo: 'info', rol: 'taller', txt: `${enTaller} equipo(s) en taller o en revisión.` });
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
    const filasCampo = enCampoOrd.map(e => `<tr>
      <td class="cg-mono"><a href="#" onclick="Centro.verKardex('${this.esc(e.id)}'); return false;">${this.esc(e.serial || e.id)}</a>${P?.origenReemplazoHtml ? P.origenReemplazoHtml(e) : ''}</td>
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
      this._cerrarModal();
      Toast.show(`Contrato ${c.contrato_id || id} aprobado — ${ContratoFirma.lleva(c) ? 'bodega asigna los seriales y luego sigue la firma del cliente' : 'sigue la entrega de los equipos'}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) { console.error(e); Toast.show('No se pudo aprobar el contrato', 'bad'); }
  },
});
