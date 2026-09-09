// @ts-nocheck
/* ========================================
 * ORDENES REEMPLAZO — el taller PROPONE, ventas aprueba
 *
 * POR QUÉ. El reemplazo de un radio solo se podía pedir desde el Centro de
 * gestión de clientes, al que el técnico ni entra (acceso restringido a
 * admin/gerencia/ventas/recepción/inventario). Quien VE que el radio no
 * tiene arreglo es el técnico, con el equipo en la mano; hasta hoy tenía
 * que contárselo a alguien para que ese alguien abriera la solicitud.
 *
 * QUÉ HACE. Desde el ⋯ de la orden, el técnico marca los radios que hay
 * que reemplazar, deja su diagnóstico y envía la PROPUESTA. Nace la misma
 * gestión GR de siempre, pero en `pendiente_aprobacion` y con
 * `origen: {tipo:'taller'}`: la aprobación se le pide a
 * ventas@cecomunica.com (buzón de aprobaciones) con el vendedor del
 * cliente y el técnico EN COPIA. De la aprobación en adelante no hay nada
 * nuevo — bodega asigna, sale la OS de programación, se entrega y la
 * gestión cierra sola, igual que una solicitud del vendedor.
 *
 * Lo que el técnico NO decide: el modelo de reposición (se repone el mismo
 * modelo) ni si se cobra. Eso es de ventas, y por eso pasa por aprobación
 * SIEMPRE, tenga garantía o no.
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

  // ¿Se puede proponer desde esta orden? Hace falta cliente (la gestión es
  // POR CLIENTE), al menos un equipo con serial, y que la orden siga viva:
  // sobre una entregada/cerrada el reemplazo se pide desde el Centro.
  function puedeProponer(orden, rol) {
    if (!orden || !ROLES_PROPONEN.includes(rol)) return false;
    if (!orden.cliente_id) return false;
    const estado = String(orden.estado_reparacion || 'POR ASIGNAR').toUpperCase();
    if (estado.includes('ENTREGAD') || estado.startsWith('CERRADA')) return false;
    return (orden.equipos || []).some(e => e && !e.eliminado && (e.numero_de_serie || e.serial));
  }

  // Ítems de la gestión, con el MISMO contrato de datos que los del Centro
  // (crearReemplazo) para que bodega y los triggers no distingan de dónde
  // salió la propuesta. Lo propio del taller viaja en dos campos extra:
  // `saliente_en_casa` (el radio ya está aquí: no hay que ir a buscarlo) y
  // `garantia` (lo que se vio al proponer, para que ventas decida con dato).
  function construirItems(seleccion, { motivo, diagnostico, salienteEnCasa }) {
    return seleccion.map(({ equipo, ficha, sit }) => ({
      serial_saliente: (equipo.numero_de_serie || equipo.serial || '').trim(),
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
    }));
  }

  // Ficha del pool de un serial. Con colisión entre modelos (failsafe
  // Kenwood) desempata por el modelo que dice la orden.
  async function fichaDe(equipo) {
    const serial = (equipo.numero_de_serie || equipo.serial || '').trim();
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

  async function abrir(ordenId) {
    let orden = null;
    try { orden = await OrdenesService.getOrder(ordenId); } catch (_) { /* abajo */ }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    const rol = APP?.state?.userRole || '';
    if (!puedeProponer(orden, rol)) {
      Toast.show(orden.cliente_id
        ? 'Solo se propone desde una orden viva con equipos serializados.'
        : 'Esta orden no tiene cliente ligado — el reemplazo se pide desde el Centro de gestión.', 'warn');
      return;
    }
    if (orden.reemplazo_propuesto?.gestion_id) {
      const seguir = await Modal.confirm({
        title: 'Ya hay una propuesta',
        message: `Esta orden ya generó la solicitud <b>${esc(orden.reemplazo_propuesto.gestion_id)}</b>
          (${esc(orden.reemplazo_propuesto.por_email || 'taller')}). ¿Proponer otra de todos modos?`,
        confirmLabel: 'Proponer otra',
      });
      if (!seguir) return;
    }

    const equipos = (orden.equipos || []).filter(e => e && !e.eliminado && (e.numero_de_serie || e.serial));
    const fichas = await Promise.all(equipos.map(fichaDe));
    const filas = equipos.map((e, i) => {
      const sit = situacion(fichas[i], { clienteId: orden.cliente_id });
      const serial = (e.numero_de_serie || e.serial || '').trim();
      const modelo = fichas[i]?.modelo_label || e.modelo || '—';
      return `
        <label class="rp-fila" style="display:flex;align-items:flex-start;gap:10px;padding:8px;border-bottom:1px solid var(--border-subtle,#EEF2F6);${sit.ok ? 'cursor:pointer;' : 'opacity:.55;'}">
          <input type="checkbox" class="rp-check" value="${i}" ${sit.ok ? '' : 'disabled'} style="margin-top:3px;">
          <span style="flex:1;min-width:0;">
            <span style="font-family:var(--font-mono,monospace);font-size:13px;">${esc(serial)}</span>
            <span style="font-size:13px;color:var(--fg-2);"> · ${esc(modelo)}</span>
            <br><span style="font-size:12px;color:var(--fg-3);">${esc(sit.label)}${sit.why ? ` — ${esc(sit.why)}` : ''}</span>
          </span>
        </label>`;
    }).join('');

    const hayElegibles = equipos.some((e, i) => situacion(fichas[i], { clienteId: orden.cliente_id }).ok);
    // Un radio que entró por el mostrador YA está aquí; en una visita de
    // campo, no. Es lo que decide si el sistema tiene que abrir además una
    // orden de devolución para ir a buscarlo.
    const esVisita = typeof esOrdenVisita === 'function' && esOrdenVisita(orden);

    let enviando = false;
    const resultado = await Modal.sheet({
      title: 'Proponer reemplazo por garantía',
      icon: 'shield-check',
      size: 'lg',
      closable: () => !enviando,
      html: `
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
          Marca los radios que hay que reemplazar y deja tu diagnóstico. La solicitud se le manda a
          <b>ventas@cecomunica.com</b> para aprobación, con el vendedor del cliente en copia. Bodega
          repone el <b>mismo modelo</b>; si va con cargo o no, lo decide ventas.
        </p>
        <div style="font-size:12.5px;color:var(--fg-3);margin-bottom:8px;">
          Cliente: <b>${esc(orden.cliente_nombre || orden.cliente || '—')}</b> · Orden ${esc(ordenId)}
        </div>
        <div id="rpLista" style="border:1px solid var(--border);border-radius:8px;max-height:260px;overflow-y:auto;margin-bottom:12px;">
          ${filas || '<div style="padding:14px;font-size:13px;color:var(--fg-3);">Esta orden no tiene equipos con serial.</div>'}
        </div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label" for="rpMotivo">Motivo</label>
          <select id="rpMotivo" class="form-select">
            ${MOTIVOS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label" for="rpDiag">Diagnóstico</label>
          <textarea id="rpDiag" class="form-input" rows="3"
            placeholder="Qué le pasa al radio y por qué no tiene arreglo. Es lo que ventas va a leer para aprobar."></textarea>
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
      onMount: (root) => {
        const btn = root.querySelector('.modal-footer .btn-primary');
        if (btn && !hayElegibles) { btn.disabled = true; btn.title = 'Ningún equipo de esta orden se puede proponer'; }
      },
      onAction: async (action, root, api) => {
        if (action !== 'enviar') return null;
        const marcados = [...root.querySelectorAll('.rp-check:checked')].map(c => Number(c.value));
        if (!marcados.length) { Toast.show('Marca al menos un radio', 'warn'); return false; }
        const motivo = root.querySelector('#rpMotivo').value;
        const diagnostico = (root.querySelector('#rpDiag').value || '').trim();
        if (diagnostico.length < 10) {
          Toast.show('Escribe el diagnóstico — es lo que ventas lee para aprobar.', 'warn');
          root.querySelector('#rpDiag')?.focus();
          return false;
        }
        const salienteEnCasa = !!root.querySelector('#rpEnCasa').checked;
        const seleccion = marcados.map(i => ({
          equipo: equipos[i], ficha: fichas[i],
          sit: situacion(fichas[i], { clienteId: orden.cliente_id }),
        }));

        enviando = true;
        root.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const gid = await enviar(orden, ordenId, seleccion, { motivo, diagnostico, salienteEnCasa });
          Toast.show(`✅ Propuesta ${gid} enviada a ventas@cecomunica.com para aprobación`, 'ok');
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
    return resultado;
  }

  // Crea la gestión y deja la marca en la orden (para que la bandeja diga
  // que este trabajo ya está pedido y nadie lo pida dos veces).
  async function enviar(orden, ordenId, seleccion, opts) {
    const user = firebase.auth().currentUser;
    const items = construirItems(seleccion, opts);
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
        diagnostico: opts.diagnostico,
        motivo_codigo: opts.motivo,
        saliente_en_casa: !!opts.salienteEnCasa,
        tecnico_uid: user?.uid || null,
        tecnico_email: user?.email || null,
        tecnico_nombre: orden.tecnico_asignado || '',
      },
      aprobacion: { requiere: true, motivo: 'propuesta_taller' },
      items,
    });

    try {
      await firebase.firestore().collection('ordenes_de_servicio').doc(ordenId).set({
        reemplazo_propuesto: {
          gestion_id: gid,
          at: firebase.firestore.FieldValue.serverTimestamp(),
          por_uid: user?.uid || null,
          por_email: user?.email || null,
          seriales: items.map(it => it.serial_saliente),
        },
      }, { merge: true });
      const cache = (APP?.state?.orders || []).find(o => o.ordenId === ordenId);
      if (cache) cache.reemplazo_propuesto = { gestion_id: gid, por_email: user?.email || null };
    } catch (e) {
      // La gestión ya existe: la marca es comodidad, no puede tumbar el envío.
      console.warn('[ordenes-reemplazo] marca en la orden no guardada', e?.message || e);
    }
    return gid;
  }

  window.OrdenesReemplazo = { abrir, situacion, puedeProponer, construirItems, MOTIVOS, ROLES_PROPONEN };
  window.abrirProponerReemplazo = abrir;
})();
