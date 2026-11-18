// @ts-nocheck
// Baja de radios en la Base PoC (Brenda, 2026-10-16).
//
// Al quitarle "Activo" a 16 radios de UNIDAD MOVIL (desconexión por falta de
// pago) se mezclaron con los 31 que el cliente ya tenía inactivos y no hubo
// forma de volver a encontrarlos para copiar los seriales y pedir la
// desconexión. La ficha solo cambiaba `activo:false`; la fecha quedaba en
// poc_logs, que la lista no enseña.
//
// Desde ahora toda baja (ficha, edición en masa o "Dar de baja" del menú Más)
// deja un SELLO en la ficha:
//   inactivo_desde   Date     cuándo pasó a inactivo
//   inactivo_por     string   quién
//   inactivo_motivo  string   falta_pago | devolucion | cambio_equipo | otro
//   inactivo_detalle string   texto libre opcional
// Reactivar el radio borra el sello. La lista lo pinta bajo "Inactivo"
// ("desde 14/10 · Falta de pago") y el chip "Baja reciente" deja solos los
// radios dados de baja en los últimos DIAS_RECIENTE días, del más nuevo al
// más viejo: seleccionar todos → Copiar seriales → correo. Cuando el cliente
// paga, el mismo chip sirve para reactivarlos.
//
// La fecha se escribe con la hora del navegador (new Date()), no con
// serverTimestamp: el eco local de la suscripción viva trae null mientras el
// servidor confirma, y el chip dejaría de ver el radio recién dado de baja.
window.PocBaja = {
  DIAS_RECIENTE: 60,
  CAMPOS: ['inactivo_desde', 'inactivo_por', 'inactivo_motivo', 'inactivo_detalle'],
  MOTIVOS: [
    { v: 'falta_pago',    t: 'Falta de pago' },
    { v: 'devolucion',    t: 'Devolución o cierre del servicio' },
    { v: 'cambio_equipo', t: 'Cambio de equipo' },
    { v: 'otro',          t: 'Otro' },
  ],

  textoMotivo(v) {
    return (this.MOTIVOS.find(m => m.v === v) || {}).t || '';
  },

  // Campos que se suman al update cuando un radio PASA a inactivo.
  sello(user, { motivo = 'otro', detalle = '' } = {}) {
    return {
      inactivo_desde:   new Date(),
      inactivo_por:     user?.email || null,
      inactivo_motivo:  motivo || 'otro',
      inactivo_detalle: String(detalle || '').trim(),
    };
  },

  // Campos que se suman al update cuando un radio VUELVE a activo.
  limpieza(d = {}) {
    const out = {};
    this.CAMPOS.forEach(k => { if (k in d) out[k] = firebase.firestore.FieldValue.delete(); });
    return out;
  },

  // Quita el sello de un snapshot en memoria (lo que la pantalla repinta).
  sinSello(d = {}) {
    const out = { ...d };
    this.CAMPOS.forEach(k => { delete out[k]; });
    return out;
  },

  fechaMs(d) {
    const t = d?.inactivo_desde;
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    const n = new Date(t).getTime();
    return isNaN(n) ? 0 : n;
  },

  // Radio vivo, inactivo y con baja dentro de la ventana.
  esReciente(d, ahora = Date.now()) {
    if (!d || d.deleted === true || d.activo) return false;
    const ms = this.fechaMs(d);
    return ms > 0 && (ahora - ms) <= this.DIAS_RECIENTE * 24 * 60 * 60 * 1000;
  },

  // Sub-línea de la celda "Inactivo": "desde 14/10/2026 · Falta de pago".
  subtextoHtml(d) {
    const ms = this.fechaMs(d);
    if (!ms) return '';
    const fecha  = FMT.date(new Date(ms));
    const motivo = this.textoMotivo(d.inactivo_motivo);
    const titulo = [
      `Dado de baja el ${fecha}`,
      d.inactivo_por ? `por ${d.inactivo_por}` : '',
      motivo ? `· ${motivo}` : '',
      d.inactivo_detalle ? `· ${d.inactivo_detalle}` : '',
    ].filter(Boolean).join(' ');
    return `<span class="poc-inactivo-sub" title="${FMT.esc(titulo)}">desde ${FMT.esc(fecha)}${motivo ? ' · ' + FMT.esc(motivo) : ''}</span>`;
  },

  // Hoja única para pedir el motivo. Sirve también de confirmación (la
  // edición en masa ya preguntaba "¿Confirmas?"; con bajas de por medio la
  // pregunta es esta). Devuelve { motivo, detalle, copiar, correo } o null.
  //   n           cuántos radios pasan a inactivo
  //   extraHtml   texto arriba del selector (la página escapa lo suyo)
  //   opciones    true → casillas "copiar seriales" y "abrir correo"
  pedirMotivo({ n = 1, titulo = '', extraHtml = '', confirmLabel = 'Confirmar', opciones = false } = {}) {
    const esc = FMT.esc;
    const opts = this.MOTIVOS.map(m => `<option value="${esc(m.v)}">${esc(m.t)}</option>`).join('');
    const html = `
      ${extraHtml ? `<p style="margin:0 0 12px;font-size:14.5px;line-height:1.5;">${extraHtml}</p>` : ''}
      <div class="form-field">
        <label class="form-label" for="pocBajaMotivo">Motivo de la baja</label>
        <select class="form-select" id="pocBajaMotivo">${opts}</select>
      </div>
      <div class="form-field" style="margin-top:10px;">
        <label class="form-label" for="pocBajaDetalle">Detalle <span style="font-weight:400;color:var(--fg-3);">(opcional)</span></label>
        <input class="form-input" id="pocBajaDetalle" type="text" maxlength="120" placeholder="Ej.: factura 11234 vencida">
      </div>
      ${opciones ? `
      <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="pocBajaCopiar" checked> Copiar los seriales al portapapeles al terminar</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="pocBajaCorreo"> Abrir un correo con los radios para pedir la desconexión</label>
      </div>` : ''}
      <p style="margin:12px 0 0;font-size:12.5px;color:var(--fg-3);line-height:1.4;">
        ${n === 1 ? 'El radio queda' : `Los ${n} radios quedan`} con la fecha de baja y salen en el chip <b>Baja reciente</b> durante ${this.DIAS_RECIENTE} días, separados de los que ya estaban inactivos.
      </p>`;
    return Modal.sheet({
      title: titulo || (n === 1 ? 'Dar de baja el radio' : `Dar de baja ${n} radios`),
      icon: 'power-off',
      size: 'sm',
      html,
      buttons: [
        { action: 'cancel',    label: 'Cancelar' },
        { action: 'confirmar', label: confirmLabel, primary: true },
      ],
      onMount: (root) => { root.querySelector('#pocBajaMotivo')?.focus(); },
      onAction: (action, root) => {
        if (action !== 'confirmar') return null;
        return {
          motivo:  root.querySelector('#pocBajaMotivo')?.value || 'otro',
          detalle: root.querySelector('#pocBajaDetalle')?.value || '',
          copiar:  !!root.querySelector('#pocBajaCopiar')?.checked,
          correo:  !!root.querySelector('#pocBajaCorreo')?.checked,
        };
      },
    });
  },

  // ── Acción del menú Más: "Dar de baja (pedir desconexión)" ──────────
  // Lo que Brenda hacía en tres pasos (desmarcar Activo uno por uno en la
  // edición masiva, copiar seriales, escribir el correo) en uno, sin el tope
  // de 25 de la edición en masa. Solo toca los radios ACTIVOS seleccionados.
  async darDeBaja() {
    if (PocState.esLectura()) { Toast.show('Solo administración o recepción dan de baja radios.', 'bad'); return; }
    if (window.PocBulk?._modo) { Toast.show('Termina o cancela la edición en masa primero.', 'bad'); return; }
    const sel = PocList.obtenerSeleccionados();
    if (!sel.length) { Toast.show('Selecciona los radios que vas a dar de baja.', 'bad'); return; }
    const docs = sel.map(s => PocList._docsPorId.get(s.id)).filter(Boolean);
    const activos = docs.filter(d => d.activo !== false && d.deleted !== true);
    if (!activos.length) { Toast.show('Ninguno de los seleccionados está activo.', 'warn'); return; }
    const omitidos = sel.length - activos.length;

    const esc = FMT.esc;
    const clientes = [...new Set(activos.map(d => PocState.nombreClienteDe(d) || '—'))];
    const quien = clientes.length === 1 ? `de <b>${esc(clientes[0])}</b>` : `de ${clientes.length} clientes`;
    const extra = `${activos.length === 1 ? 'Un radio' : `<b>${activos.length}</b> radios`} ${quien} ${activos.length === 1 ? 'pasa' : 'pasan'} a <b>inactivo</b>. `
      + 'La ficha no se cierra ni se borra: el radio sigue con el cliente y se puede reactivar.'
      + (omitidos ? `<br><span style="color:var(--fg-3);font-size:13px;">${omitidos} de los seleccionados ya ${omitidos === 1 ? 'estaba' : 'estaban'} inactivo${omitidos === 1 ? '' : 's'} y no se toca${omitidos === 1 ? '' : 'n'}.</span>` : '');
    const r = await this.pedirMotivo({ n: activos.length, extraHtml: extra, confirmLabel: 'Dar de baja', opciones: true });
    if (!r) return;

    const user  = firebase.auth().currentUser;
    const sello = this.sello(user, r);
    const db    = firebase.firestore();
    const cambios = [];
    let hechos = 0;
    const TANDA = 200;   // 2 escrituras por radio; el batch admite 500
    try {
      for (let i = 0; i < activos.length; i += TANDA) {
        const batch = db.batch();
        for (const d of activos.slice(i, i + TANDA)) {
          const despues = { ...d, activo: false, ...sello };
          batch.update(db.collection('poc_devices').doc(d.id), {
            activo: false, ...sello,
            updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
            updated_by:       user?.uid   || null,
            updated_by_email: user?.email || null,
          });
          batch.set(db.collection('poc_logs').doc(), {
            equipo_id: d.id,
            fecha:     firebase.firestore.FieldValue.serverTimestamp(),
            usuario:   user?.email || null,
            accion:    'baja',
            origen:    'poc-lista',
            motivo:    this.textoMotivo(r.motivo) + (r.detalle ? ` — ${String(r.detalle).trim()}` : ''),
            cambios:   { antes: PocService.stripSentinels(d), despues: PocService.stripSentinels(despues) },
          });
          cambios.push({ id: d.id, antes: d, despues });
        }
        await batch.commit();
        hechos += Math.min(TANDA, activos.length - i);
      }
    } catch (e) {
      console.error('[PocBaja] dar de baja', e);
      Toast.show(`Se dieron de baja ${hechos} de ${activos.length}. Error: ${e.message || e}`, 'bad');
      PocList.refresh();
      return;
    }

    // SIM de los radios que quedaron inactivos: la misma pregunta de siempre
    // (poner disponibles en el pool o conservarlos). Por falta de pago lo
    // normal es conservarlos: el radio vuelve cuando el cliente paga.
    try { await SimLiberar.procesarDesactivados(cambios); }
    catch (e) { console.warn('[PocBaja] liberar SIM falló (no crítico):', e); }

    const seriales = activos.map(d => String(d.serial || '').trim()).filter(Boolean);
    if (r.copiar && seriales.length) {
      try { await navigator.clipboard.writeText(seriales.join('\n')); }
      catch (_) { Toast.show('No se pudieron copiar los seriales (permiso del portapapeles).', 'warn'); }
    }
    if (r.correo) this.abrirCorreo(activos, r, clientes);

    Toast.show(`${hechos} radio${hechos === 1 ? '' : 's'} dado${hechos === 1 ? '' : 's'} de baja${r.copiar && seriales.length ? ' · seriales copiados' : ''}.`, 'ok');

    // La lista se queda en lo que acaba de pasar: solo las bajas recientes.
    const chip = document.getElementById('soloRecientes');
    if (chip && !chip.checked) { chip.checked = true; PocList.manejarCambioRecientes(); }
    else PocList.refresh();
  },

  // ── Acción del menú Más: "Reconectar…" (Brenda, 2026-11-18) ─────────
  // El camino de vuelta de darDeBaja: el cliente se puso al día y los mismos
  // radios vuelven a activo en una sola gestión, sin el tope de 25 de la
  // edición en masa. Solo toca los INACTIVOS seleccionados; les quita el
  // sello de baja y deja un poc_log con accion 'reconexion'. Flujo: chip
  // "Baja reciente" → seleccionar todos → Más → Reconectar.
  async reconectar() {
    if (PocState.esLectura()) { Toast.show('Solo administración o recepción reconectan radios.', 'bad'); return; }
    if (window.PocBulk?._modo) { Toast.show('Termina o cancela la edición en masa primero.', 'bad'); return; }
    const sel = PocList.obtenerSeleccionados();
    if (!sel.length) { Toast.show('Selecciona los radios que vas a reconectar.', 'bad'); return; }
    const docs = sel.map(s => PocList._docsPorId.get(s.id)).filter(Boolean);
    // Una ficha CERRADA (deleted) no se reconecta: el radio ya no está con el
    // cliente; se reabre desde su ficha, que es otra decisión.
    const inactivos = docs.filter(d => d.activo === false && d.deleted !== true);
    if (!inactivos.length) { Toast.show('Ninguno de los seleccionados está inactivo.', 'warn'); return; }
    const omitidos = sel.length - inactivos.length;

    const esc = FMT.esc;
    const clientes = [...new Set(inactivos.map(d => PocState.nombreClienteDe(d) || '—'))];
    const quien = clientes.length === 1 ? `de <b>${esc(clientes[0])}</b>` : `de ${clientes.length} clientes`;
    const n = inactivos.length;
    // Lo que conviene mirar antes de reconectar: radios cuya baja NO fue por
    // falta de pago (devolución, cambio de equipo) y radios que quedaron sin
    // SIM porque se devolvió al pool al darlos de baja.
    const otroMotivo = inactivos.filter(d => d.inactivo_motivo && d.inactivo_motivo !== 'falta_pago');
    const sinSim     = inactivos.filter(d => !String(d.sim_number || '').trim());
    const lista = (arr, extra) => arr.slice(0, 6).map(d =>
      `${esc(String(d.serial || d.unit_id || d.id))}${extra ? extra(d) : ''}`).join(', ') + (arr.length > 6 ? `… (+${arr.length - 6})` : '');
    const avisos = [];
    if (otroMotivo.length) {
      avisos.push(`<b>${otroMotivo.length}</b> no ${otroMotivo.length === 1 ? 'se dio' : 'se dieron'} de baja por falta de pago: `
        + lista(otroMotivo, d => ` (${esc(this.textoMotivo(d.inactivo_motivo))})`) + '.');
    }
    if (sinSim.length) {
      avisos.push(`<b>${sinSim.length}</b> ${sinSim.length === 1 ? 'quedó' : 'quedaron'} sin SIM en la ficha: ${lista(sinSim)}. Asígnale${sinSim.length === 1 ? '' : 's'} SIM después de reconectar.`);
    }
    const html = `
      <p style="margin:0 0 12px;font-size:14.5px;line-height:1.5;">
        ${n === 1 ? 'Un radio' : `<b>${n}</b> radios`} ${quien} ${n === 1 ? 'vuelve' : 'vuelven'} a <b>activo</b> y ${n === 1 ? 'pierde' : 'pierden'} la fecha y el motivo de baja.
        ${omitidos ? `<br><span style="color:var(--fg-3);font-size:13px;">${omitidos} de los seleccionados no ${omitidos === 1 ? 'está inactivo' : 'están inactivos'} y no se toca${omitidos === 1 ? '' : 'n'}.</span>` : ''}
      </p>
      ${avisos.length ? `<div id="pocReconAvisos" style="margin:0 0 12px;padding:10px 12px;border-radius:8px;background:#fef9c3;color:#713f12;font-size:13px;line-height:1.45;">${avisos.map(a => `<div>${a}</div>`).join('')}</div>` : ''}
      <div style="display:flex;flex-direction:column;gap:6px;font-size:13.5px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="pocReconCopiar" checked> Copiar los seriales al portapapeles al terminar</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="pocReconCorreo"> Abrir un correo con los radios para pedir la reconexión</label>
      </div>`;
    const r = await Modal.sheet({
      title: n === 1 ? 'Reconectar el radio' : `Reconectar ${n} radios`,
      icon: 'power',
      size: 'sm',
      html,
      buttons: [
        { action: 'cancel',    label: 'Cancelar' },
        { action: 'confirmar', label: 'Reconectar', primary: true },
      ],
      onAction: (action, root) => {
        if (action !== 'confirmar') return null;
        return {
          copiar: !!root.querySelector('#pocReconCopiar')?.checked,
          correo: !!root.querySelector('#pocReconCorreo')?.checked,
        };
      },
    });
    if (!r) return;

    const user = firebase.auth().currentUser;
    const db   = firebase.firestore();
    let hechos = 0;
    const TANDA = 200;   // 2 escrituras por radio; el batch admite 500
    try {
      for (let i = 0; i < inactivos.length; i += TANDA) {
        const batch = db.batch();
        for (const d of inactivos.slice(i, i + TANDA)) {
          const motivoBaja = this.textoMotivo(d.inactivo_motivo) + (d.inactivo_detalle ? ` — ${String(d.inactivo_detalle).trim()}` : '');
          batch.update(db.collection('poc_devices').doc(d.id), {
            activo: true, ...this.limpieza(d),
            updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
            updated_by:       user?.uid   || null,
            updated_by_email: user?.email || null,
          });
          batch.set(db.collection('poc_logs').doc(), {
            equipo_id: d.id,
            fecha:     firebase.firestore.FieldValue.serverTimestamp(),
            usuario:   user?.email || null,
            accion:    'reconexion',
            origen:    'poc-lista',
            motivo:    motivoBaja ? `Reconexión (baja previa: ${motivoBaja})` : 'Reconexión',
            cambios:   { antes: PocService.stripSentinels(d), despues: PocService.stripSentinels(this.sinSello({ ...d, activo: true })) },
          });
        }
        await batch.commit();
        hechos += Math.min(TANDA, inactivos.length - i);
      }
    } catch (e) {
      console.error('[PocBaja] reconectar', e);
      Toast.show(`Se reconectaron ${hechos} de ${inactivos.length}. Error: ${e.message || e}`, 'bad');
      PocList.refresh();
      return;
    }

    const seriales = inactivos.map(d => String(d.serial || '').trim()).filter(Boolean);
    if (r.copiar && seriales.length) {
      try { await navigator.clipboard.writeText(seriales.join('\n')); }
      catch (_) { Toast.show('No se pudieron copiar los seriales (permiso del portapapeles).', 'warn'); }
    }
    if (r.correo) this.abrirCorreo(inactivos, null, clientes, { reconexion: true });

    Toast.show(`${hechos} radio${hechos === 1 ? '' : 's'} reconectado${hechos === 1 ? '' : 's'}${r.copiar && seriales.length ? ' · seriales copiados' : ''}.`, 'ok');

    // Con "Baja reciente" o "Inactivos" prendidos los reconectados saldrían de
    // la lista en el acto y no habría cómo ver qué pasó: la lista vuelve a
    // "Todos" (con el cliente que esté en el buscador) y los enseña en verde.
    const chip = document.getElementById('soloRecientes');
    if (chip) chip.checked = false;
    const seg = document.querySelector('input[name="pocEstadoActivo"][value="todos"]');
    if (seg) seg.checked = true;
    PocList.cambiarEstadoActivo('todos');
  },

  // Correo listo para Mariche: serial, Unit ID y nombre del radio (la
  // desconexión del airtime se pide con el Unit ID y el nombre; el serial
  // es lo que Brenda archiva). Sin destinatario: ella lo pone.
  // `reconexion:true` arma el mismo correo para el camino de vuelta.
  abrirCorreo(radios, r, clientes, { reconexion = false } = {}) {
    const cliente = clientes.length === 1 ? clientes[0] : clientes.join(', ');
    if (reconexion) {
      const asuntoR = `Reconexión de ${radios.length} radio${radios.length === 1 ? '' : 's'} — ${cliente}`;
      const lineasR = radios.map(d => {
        const partes = [String(d.serial || '').trim() || '(sin serial)'];
        if (d.unit_id)    partes.push(`Unit ID ${d.unit_id}`);
        if (d.radio_name) partes.push(String(d.radio_name));
        if (d.sim_number) partes.push(`SIM ${d.sim_number}`);
        return '- ' + partes.join(' · ');
      });
      const cuerpoR = [
        'Buen día,',
        '',
        `Favor gestionar la reconexión de ${radios.length === 1 ? 'este radio' : `estos ${radios.length} radios`} de ${cliente}:`,
        '',
        ...lineasR,
        '',
        'Gracias.',
      ].join('\r\n');
      const urlR = `mailto:?subject=${encodeURIComponent(asuntoR)}&body=${encodeURIComponent(cuerpoR)}`;
      try { window.open(urlR, '_self'); } catch (_) { location.href = urlR; }
      return;
    }
    const asunto  = `Desconexión de ${radios.length} radio${radios.length === 1 ? '' : 's'} — ${cliente}`;
    const lineas  = radios.map(d => {
      const partes = [String(d.serial || '').trim() || '(sin serial)'];
      if (d.unit_id)    partes.push(`Unit ID ${d.unit_id}`);
      if (d.radio_name) partes.push(String(d.radio_name));
      if (d.sim_number) partes.push(`SIM ${d.sim_number}`);
      return '- ' + partes.join(' · ');
    });
    const cuerpo = [
      'Buen día,',
      '',
      `Favor gestionar la desconexión de ${radios.length === 1 ? 'este radio' : `estos ${radios.length} radios`} de ${cliente}`
        + ` (${this.textoMotivo(r.motivo).toLowerCase()}${r.detalle ? ': ' + String(r.detalle).trim() : ''}):`,
      '',
      ...lineas,
      '',
      'Gracias.',
    ].join('\r\n');
    const url = `mailto:?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    try { window.open(url, '_self'); } catch (_) { location.href = url; }
  },
};
