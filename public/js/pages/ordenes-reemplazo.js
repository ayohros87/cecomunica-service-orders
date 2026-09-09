// @ts-nocheck
/* ========================================
 * ORDENES REEMPLAZO — el taller PROPONE, ventas aprueba. UN RADIO, UNA PROPUESTA.
 *
 * POR QUÉ. El reemplazo solo se podía pedir desde el Centro de gestión, al
 * que el técnico ni entra. Quien VE que el radio no tiene arreglo es él, con
 * el equipo en la mano.
 *
 * POR SERIAL, NO POR ORDEN (Alberto, 2026-09-09). El técnico diagnostica
 * radio por radio: el que no enciende, el que se moja, el que ya van tres
 * veces que vuelve. Cada uno tiene su historia, su garantía y su decisión.
 * Por eso la acción vive en la FILA DEL RADIO —al lado de su intervención—
 * y cada propuesta es su propio expediente GR: ventas aprueba uno y rechaza
 * otro sin arrastrar a los demás, y bodega asigna lo que se aprobó.
 *
 * QUÉ HACE. Nace la misma gestión GR de siempre, con UN ítem, en
 * `pendiente_aprobacion` y con `origen: {tipo:'taller'}`: la aprobación se le
 * pide a ventas@cecomunica.com con el vendedor del cliente y el técnico en
 * copia. De ahí en adelante no hay nada nuevo — bodega asigna, sale la OS de
 * programación, se entrega y la gestión cierra sola.
 *
 * Lo que el técnico NO decide: el modelo de reposición (se repone el mismo)
 * ni si se cobra. Eso es de ventas, y por eso pasa por aprobación SIEMPRE,
 * tenga garantía o no.
 *
 * Módulo diferido: lo carga CargaDiferida.reemplazo() al primer uso.
 * ======================================== */

(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  // Los motivos con los que un taller propone (subconjunto de los del
  // Centro — el técnico no propone "actualización de modelo" ni
  // "servicio al cliente": esos son comerciales).
  const MOTIVOS = [
    ['garantia_fabrica', 'Garantía de fábrica'],
    ['dano_no_reparable', 'Dañado — no reparable'],
    ['falla_recurrente', 'Falla recurrente'],
    ['otro', 'Otro'],
  ];

  const ROLES_PROPONEN = ['tecnico', 'tecnico_operativo', 'jefe_taller', 'administrador'];

  const serialDe = (equipo) => String(equipo?.numero_de_serie || equipo?.serial || '').trim();
  const normSerial = (s) => (window.Serial?.norm ? Serial.norm(s) : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));

  /* ── Situación de una unidad para proponer su reemplazo ────────────────
     Prima hermana de Centro._eleg, con UNA diferencia deliberada: allá el
     radio está con el cliente y un estado distinto lo descalifica; aquí el
     radio está —o estuvo— en el mostrador, así que `en_taller` /
     `devuelto_revision` son lo NORMAL y no bloquean nada.
     Bloquea solo lo que de verdad impide el trámite: sin ficha en el pool,
     dado de baja, comprado fuera de CECOMUNICA, o de otro cliente.        */
  function situacion(ficha, { clienteId = '', hoy = new Date() } = {}) {
    if (!ficha) {
      return { ok: false, code: 'sin_ficha', label: 'Sin ficha en el pool',
               why: 'Este serial no existe en el inventario: regístralo antes de proponer el reemplazo.' };
    }
    if (ficha.estado === 'baja') {
      return { ok: false, code: 'baja', label: 'Dado de baja',
               why: 'La unidad ya está de baja en el pool — no hay nada que reemplazar.' };
    }
    const duenoPool = ficha.asignacion?.cliente_id || ficha.venta?.cliente_id || '';
    if (clienteId && duenoPool && duenoPool !== clienteId) {
      return { ok: false, code: 'otro_cliente', label: 'Figura con otro cliente',
               why: `En el pool esta unidad está con ${ficha.asignacion?.cliente_nombre || ficha.venta?.cliente_nombre || 'otro cliente'} — verifica el serial antes de proponer.` };
    }
    if (ficha.propiedad === 'cliente') {
      if (!ficha.venta) {
        return { ok: false, code: 'fuera', label: 'No adquirido en CECOMUNICA',
                 why: 'Equipo del cliente comprado fuera — el reemplazo no aplica.' };
      }
      const g = window.GarantiaEquipo.garantia(ficha, { hoy });
      const txt = window.GarantiaEquipo.textoGarantia(g);
      return window.GarantiaEquipo.requiereExcepcion(g)
        ? { ok: true, code: 'propio_excepcion', label: `Del cliente · ${txt || 'sin garantía'}`,
            why: g.vigente
              ? 'La fecha de garantía es estimada (no está capturada la factura): ventas confirma si va sin cargo.'
              : 'Fuera de garantía: si procede, será por servicio al cliente — lo decide ventas.',
            garantia: g }
        : { ok: true, code: 'propio_garantia', label: `Del cliente · ${txt}`, garantia: g };
    }
    return { ok: true, code: 'alquiler',
             label: ficha.propiedad === 'desconocida' ? 'Alquiler (propiedad por confirmar)' : 'Alquiler' };
  }

  // ¿Se puede proponer el reemplazo de ESTE radio? Hace falta cliente (la
  // gestión es POR CLIENTE), que el radio tenga serial y que la orden siga
  // viva: sobre una entregada o cerrada el reemplazo se pide desde el Centro.
  function puedeProponer(orden, equipo, rol) {
    if (!orden || !equipo || !ROLES_PROPONEN.includes(rol)) return false;
    if (!orden.cliente_id) return false;
    if (equipo.eliminado || !serialDe(equipo)) return false;
    const estado = String(orden.estado_reparacion || orden.estado || 'POR ASIGNAR').toUpperCase();
    return !(estado.includes('ENTREGAD') || estado.startsWith('CERRADA'));
  }

  // La propuesta que ya existe para un serial de esta orden (o null). El mapa
  // va por serial normalizado; `reemplazo_propuesto` es el formato viejo de
  // cuando la propuesta era de la orden entera (2026-09-09, mismo día).
  function propuestaDe(orden, serial) {
    const k = normSerial(serial);
    if (!k) return null;
    const m = orden?.reemplazos_propuestos;
    if (m && m[k]) return m[k];
    const legacy = orden?.reemplazo_propuesto;
    if (legacy?.gestion_id && (legacy.seriales || []).some(s => normSerial(s) === k)) return legacy;
    return null;
  }

  // El ítem de la gestión, con el MISMO contrato de datos que los del Centro
  // (crearReemplazo) para que bodega y los triggers no distingan de dónde
  // salió la propuesta. Lo propio del taller viaja en dos campos extra:
  // `saliente_en_casa` (el radio ya está aquí: no hay que ir a buscarlo) y
  // `garantia` (lo que se vio al proponer, para que ventas decida con dato).
  function construirItem(equipo, ficha, sit, { motivo, diagnostico, salienteEnCasa }) {
    return {
      serial_saliente: serialDe(equipo),
      pool_doc_id_saliente: ficha?.id || null,
      modelo: ficha?.modelo_label || equipo.modelo || '',
      modelo_id: ficha?.modelo_id || null,
      contrato_doc_id: ficha?.asignacion?.contrato_doc_id || null,
      contrato_id: ficha?.asignacion?.contrato_id || null,
      elegibilidad: sit.code === 'propio_garantia' ? 'propio_garantia'
        : sit.code === 'propio_excepcion' ? 'propio_excepcion' : 'alquiler',
      motivo_codigo: motivo,
      motivo_detalle: diagnostico,
      // Se repone el MISMO modelo: el técnico no elige catálogo.
      modelo_solicitado: ficha?.modelo_label || equipo.modelo || '',
      modelo_solicitado_id: ficha?.modelo_id || null,
      serial_nuevo: null,
      pool_doc_id_nuevo: null,
      saliente_en_casa: !!salienteEnCasa,
      ...(sit.garantia ? {
        garantia: {
          vigente: !!sit.garantia.vigente,
          vence: sit.garantia.vence ? sit.garantia.vence.toISOString() : null,
          derivada: !!sit.garantia.derivada,
        },
      } : {}),
    };
  }

  // Ficha del pool de un serial. Con colisión entre modelos (failsafe
  // Kenwood) desempata por el modelo que dice la orden.
  async function fichaDe(equipo) {
    const serial = serialDe(equipo);
    if (!serial) return null;
    try {
      const docs = await EquiposPoolService.findBySerial(serial);
      if (!docs.length) return null;
      if (docs.length === 1) return docs[0];
      return EquiposPoolService.resolver(serial, null, equipo.modelo || '');
    } catch (e) {
      console.warn('[ordenes-reemplazo] ficha del pool ilegible', serial, e?.message || e);
      return null;
    }
  }

  // `equipoId` es el id del equipo DENTRO de la orden (e.id), el mismo que
  // usan las acciones de intervención.
  async function abrir(ordenId, equipoId) {
    let orden = null;
    try { orden = await OrdenesService.getOrder(ordenId); } catch (_) { /* abajo */ }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    const equipo = (orden.equipos || []).find(e => e && String(e.id) === String(equipoId));
    if (!equipo) { Toast.show('Equipo no encontrado en la orden', 'bad'); return; }

    const rol = APP?.state?.userRole || '';
    if (!puedeProponer(orden, equipo, rol)) {
      Toast.show(orden.cliente_id
        ? 'Solo se propone desde una orden viva y sobre un radio con serial.'
        : 'Esta orden no tiene cliente ligado — el reemplazo se pide desde el Centro de gestión.', 'warn');
      return;
    }

    const serial = serialDe(equipo);
    const previa = propuestaDe(orden, serial);
    if (previa?.gestion_id) {
      const seguir = await Modal.confirm({
        title: 'Este radio ya tiene propuesta',
        message: `El serial <b>${esc(serial)}</b> ya salió en la solicitud <b>${esc(previa.gestion_id)}</b>
          (${esc(previa.por_email || 'taller')}). ¿Proponer otra de todos modos?`,
        confirmLabel: 'Proponer otra',
      });
      if (!seguir) return;
    }

    const ficha = await fichaDe(equipo);
    const sit = situacion(ficha, { clienteId: orden.cliente_id });
    if (!sit.ok) {
      await Modal.alert({
        title: `No se puede proponer ${serial}`,
        message: `<b>${esc(sit.label)}</b><br>${esc(sit.why || '')}`,
        icon: 'shield-off',
      });
      return;
    }

    // Un radio que entró por el mostrador YA está aquí; en una visita de
    // campo, no. Es lo que decide si el sistema tiene que abrir además una
    // orden de devolución para ir a buscarlo.
    const esVisita = typeof esOrdenVisita === 'function' && esOrdenVisita(orden);
    // El diagnóstico arranca con lo que el técnico ya escribió en la
    // intervención de ESTE radio: es exactamente lo que ventas necesita leer.
    const diagPrevio = (equipo.trabajo_tecnico || '').trim();
    const modelo = ficha?.modelo_label || equipo.modelo || '—';

    let enviando = false;
    return Modal.sheet({
      title: `Proponer reemplazo — ${serial}`,
      icon: 'shield-check',
      size: 'md',
      closable: () => !enviando,
      html: `
        <div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">
          <div style="font-family:var(--font-mono,monospace);font-size:14px;font-weight:600;">${esc(serial)}</div>
          <div style="font-size:13px;color:var(--fg-2);">${esc(modelo)}</div>
          <div style="font-size:12.5px;color:var(--fg-3);margin-top:4px;">${esc(sit.label)}${sit.why ? ` — ${esc(sit.why)}` : ''}</div>
          ${ficha?.asignacion?.contrato_id
            ? `<div style="font-size:12px;color:var(--fg-3);margin-top:2px;">Contrato ${esc(ficha.asignacion.contrato_id)}</div>` : ''}
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
          Esta solicitud es <b>solo de este radio</b>. Va a <b>ventas@cecomunica.com</b> para aprobación,
          con el vendedor de <b>${esc(orden.cliente_nombre || orden.cliente || 'el cliente')}</b> en copia.
          Bodega repone el <b>mismo modelo</b>; si va con cargo o no, lo decide ventas.
        </p>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label" for="rpMotivo">Motivo</label>
          <select id="rpMotivo" class="form-select">
            ${MOTIVOS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label" for="rpDiag">Diagnóstico de este radio</label>
          <textarea id="rpDiag" class="form-input" rows="3"
            placeholder="Qué le pasa y por qué no tiene arreglo. Es lo que ventas va a leer para aprobar.">${esc(diagPrevio)}</textarea>
          ${diagPrevio ? '<div class="form-hint" style="font-size:12px;color:var(--fg-3);margin-top:4px;">Traído de la intervención — corrígelo si hace falta.</div>' : ''}
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--fg-2);">
          <input type="checkbox" id="rpEnCasa" ${esVisita ? '' : 'checked'} style="margin-top:3px;">
          <span>El radio <b>ya está aquí</b> (entró por el mostrador con esta orden).
            <span style="color:var(--fg-3);">Si lo marcas, el sistema no abre una devolución para ir a buscarlo.</span></span>
        </label>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'enviar', label: 'Enviar propuesta', primary: true, icon: 'send' },
      ],
      onAction: async (action, root, api) => {
        if (action !== 'enviar') return null;
        const motivo = root.querySelector('#rpMotivo').value;
        const diagnostico = (root.querySelector('#rpDiag').value || '').trim();
        if (diagnostico.length < 10) {
          Toast.show('Escribe el diagnóstico — es lo que ventas lee para aprobar.', 'warn');
          root.querySelector('#rpDiag')?.focus();
          return false;
        }
        const salienteEnCasa = !!root.querySelector('#rpEnCasa').checked;

        enviando = true;
        root.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const gid = await enviar(orden, ordenId, { equipo, ficha, sit }, { motivo, diagnostico, salienteEnCasa });
          Toast.show(`✅ ${serial}: propuesta ${gid} enviada a ventas@cecomunica.com`, 'ok');
          api.close(gid);
          return false;
        } catch (err) {
          console.error('[ordenes-reemplazo]', err);
          Toast.show(`❌ ${err?.message || 'No se pudo enviar la propuesta'}`, 'bad');
          enviando = false;
          root.querySelectorAll('button').forEach(b => { b.disabled = false; });
          return false;
        }
      },
    });
  }

  // Crea la gestión de ESE radio y deja la marca en la orden, por serial, para
  // que la fila lo diga y nadie lo proponga dos veces.
  async function enviar(orden, ordenId, { equipo, ficha, sit }, opts) {
    const user = firebase.auth().currentUser;
    const item = construirItem(equipo, ficha, sit, opts);
    const gid = await GestionesService.crear({
      tipo: 'reemplazo',
      cliente_id: orden.cliente_id,
      cliente_nombre: orden.cliente_nombre || orden.cliente || '',
      // SIEMPRE por aprobación: el taller propone, ventas decide.
      estado: 'pendiente_aprobacion',
      origen: {
        tipo: 'taller',
        ref_id: ordenId,
        orden_id: ordenId,
        equipo_id: equipo.id || null,
        serial: item.serial_saliente,
        diagnostico: opts.diagnostico,
        motivo_codigo: opts.motivo,
        saliente_en_casa: !!opts.salienteEnCasa,
        tecnico_uid: user?.uid || null,
        tecnico_email: user?.email || null,
        tecnico_nombre: orden.tecnico_asignado || '',
      },
      aprobacion: { requiere: true, motivo: 'propuesta_taller' },
      items: [item],
    });

    const clave = normSerial(item.serial_saliente);
    const marca = {
      gestion_id: gid,
      serial: item.serial_saliente,
      equipo_id: equipo.id || null,
      at: firebase.firestore.FieldValue.serverTimestamp(),
      por_uid: user?.uid || null,
      por_email: user?.email || null,
    };
    try {
      // set+merge (no update con ruta con puntos): fusiona el mapa sin pisar
      // las propuestas de los otros radios de la misma orden.
      await firebase.firestore().collection('ordenes_de_servicio').doc(ordenId)
        .set({ reemplazos_propuestos: { [clave]: marca } }, { merge: true });
      const cache = (APP?.state?.orders || []).find(o => o.ordenId === ordenId);
      if (cache) {
        cache.reemplazos_propuestos = { ...(cache.reemplazos_propuestos || {}), [clave]: { ...marca, at: new Date() } };
        if (typeof refrescarEquiposDeOrden === 'function') { try { refrescarEquiposDeOrden(ordenId); } catch (_) { /* no crítico */ } }
      }
    } catch (e) {
      // La gestión ya existe: la marca es comodidad, no puede tumbar el envío.
      console.warn('[ordenes-reemplazo] marca en la orden no guardada', e?.message || e);
    }
    return gid;
  }

  window.OrdenesReemplazo = { abrir, situacion, puedeProponer, construirItem, propuestaDe, MOTIVOS, ROLES_PROPONEN };
  window.abrirProponerReemplazo = abrir;
})();
