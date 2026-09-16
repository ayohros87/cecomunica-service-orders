// @ts-nocheck
/* ========================================
 * EL TALLER AVISA: "este radio no se puede usar en esta gestión".
 *
 * POR QUÉ (Zuleika, 2026-09-16, caso R. SMITH ALTA PLAZA). Hubo que cambiar
 * tres seriales porque *por la versión de los equipos no podían ser
 * programados*. Quien lo descubre es el técnico, con el radio delante y la
 * orden abierta — pero no tenía dónde decirlo. Así que la orden se cerró con
 * los seriales que estaban, recepción los dio por entregados, y para entonces
 * los radios ya figuraban con el cliente: el sistema decía que no estaban
 * disponibles y no se podía avanzar. La salida fue crear un demo nuevo.
 *
 * QUÉ HACE. Marca ESE serial en la gestión de la que salió la orden
 * (`correccion_solicitada`) y avisa a bodega, que entra a *Almacén · Asignar →
 * Corregir seriales* y pone el bueno. La corrección de verdad —gestión,
 * órdenes y pool— la hace onGestionWrite; aquí solo se levanta la mano.
 *
 * LO QUE EL TÉCNICO NO DECIDE: cuál es el radio de reemplazo. Eso es de
 * bodega, que tiene el estante. El técnico dice cuál NO sirve y por qué.
 *
 * NO ES UN REEMPLAZO. El reemplazo (ordenes-reemplazo.js) es para el radio
 * DEL CLIENTE que se dañó: abre expediente propio y una devolución para ir a
 * buscarlo. Aquí el radio nunca salió — está en el mostrador, y lo único que
 * pasa es que se va otro en su lugar.
 *
 * Módulo diferido: lo carga CargaDiferida.cambioSerialTaller() al primer uso.
 * ======================================== */

(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
  const serialDe = (equipo) => String(equipo?.numero_de_serie || equipo?.serial || '').trim();
  const normSerial = (s) => (window.Serial?.norm ? Serial.norm(s) : String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));

  // Los motivos por los que un radio no sirve para la gestión. Todos son
  // "este equipo no, manden otro" — ninguno es un daño del cliente.
  const MOTIVOS = [
    ['version_incompatible', 'La versión del equipo no permite programarlo'],
    ['no_programa', 'No se deja programar (falla en el equipo)'],
    ['serial_no_coincide', 'El serial de la orden no es el del radio que tengo'],
    ['otro', 'Otro'],
  ];

  // Sin `inventario`: bodega no marca, bodega CORRIGE (Almacén · Asignar →
  // Corregir seriales). Y las reglas de órdenes tampoco la dejan escribir aquí.
  const ROLES_MARCAN = ['tecnico', 'tecnico_operativo', 'jefe_taller', 'administrador'];

  // ¿Se puede marcar ESTE radio? Hace falta que la orden venga de una gestión
  // (es a ella a la que se le corrige el serial), que el radio tenga serial, y
  // que la gestión siga viva. Sobre una orden suelta —una ENTRADA, una visita,
  // una programación de contrato— no hay gestión que corregir: ahí el camino
  // es la gestión de cambio de serial desde el Centro.
  function puedeMarcar(orden, equipo, rol) {
    if (!orden || !equipo || !ROLES_MARCAN.includes(rol)) return false;
    if (!orden.gestion?.id) return false;
    if (equipo.eliminado || !serialDe(equipo)) return false;
    return true;
  }

  // La marca que ya existe para un serial de esta orden (o null).
  function marcaDe(orden, serial) {
    const k = normSerial(serial);
    return (k && orden?.correcciones_solicitadas?.[k]) || null;
  }

  async function abrir(ordenId, equipoId) {
    let orden = null;
    try { orden = await OrdenesService.getOrder(ordenId); } catch (_) { /* abajo */ }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    const equipo = (orden.equipos || []).find(e => e && String(e.id) === String(equipoId));
    if (!equipo) { Toast.show('Equipo no encontrado en la orden', 'bad'); return; }

    const rol = APP?.state?.userRole || '';
    if (!puedeMarcar(orden, equipo, rol)) {
      Toast.show(orden.gestion?.id
        ? 'Solo se marca un radio con serial.'
        : 'Esta orden no salió de una gestión: el cambio de serial se pide desde el Centro de gestión.', 'warn');
      return;
    }

    const serial = serialDe(equipo);
    const gid = orden.gestion.id;

    // El estado de la gestión decide si todavía hay algo que corregir.
    let gestion = null;
    try { gestion = await GestionesService.get(gid); } catch (_) { /* se avisa abajo */ }
    if (gestion && ['cerrada', 'anulada'].includes(gestion.estado)) {
      await Modal.alert({
        title: `La gestión ${gid} ya está ${gestion.estado}`,
        message: 'Una gestión cerrada ya no se corrige — sus equipos ya pasaron por facturación y devoluciones. '
          + 'Avísale a administración para que decida cómo seguir.',
        icon: 'lock',
      });
      return;
    }

    const previa = marcaDe(orden, serial);
    if (previa) {
      const seguir = await Modal.confirm({
        title: 'Este radio ya está marcado',
        message: `El serial <b>${esc(serial)}</b> ya lo marcó <b>${esc(previa.por_email || 'el taller')}</b>`
          + `${previa.motivo_detalle ? `: “${esc(previa.motivo_detalle)}”` : ''}. Bodega todavía no lo ha cambiado. ¿Marcarlo otra vez?`,
        confirmLabel: 'Marcar otra vez',
      });
      if (!seguir) return;
    }

    const diagPrevio = (equipo.trabajo_tecnico || '').trim();
    let enviando = false;
    return Modal.sheet({
      title: `No se puede usar este radio — ${serial}`,
      icon: 'replace',
      size: 'md',
      closable: () => !enviando,
      html: `
        <div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">
          <div style="font-family:var(--font-mono,monospace);font-size:14px;font-weight:600;">${esc(serial)}</div>
          <div style="font-size:13px;color:var(--fg-2);">${esc(equipo.modelo || '—')}</div>
          <div style="font-size:12.5px;color:var(--fg-3);margin-top:4px;">Gestión ${esc(gid)} · ${esc(orden.cliente_nombre || 'Cliente')}</div>
        </div>
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
          Esto le avisa a <b>bodega</b> que este radio no sirve para esta gestión, para que ponga otro.
          <b>No es un reemplazo</b>: el radio no salió a ningún lado, simplemente se va otro en su lugar.
          Bodega elige cuál — tú dices cuál no y por qué.
        </p>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label" for="csMotivo">Qué pasa con este radio</label>
          <select id="csMotivo" class="form-select">
            ${MOTIVOS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="form-field" style="margin-bottom:4px;">
          <label class="form-label" for="csDet">Detalle</label>
          <textarea id="csDet" class="form-input" rows="3"
            placeholder="Qué viste. Es lo que bodega va a leer para saber qué radio mandar.">${esc(diagPrevio)}</textarea>
          ${diagPrevio ? '<div class="form-hint" style="font-size:12px;color:var(--fg-3);margin-top:4px;">Traído de la intervención — corrígelo si hace falta.</div>' : ''}
        </div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'enviar', label: 'Avisar a bodega', primary: true, icon: 'send' },
      ],
      onAction: async (action, root, api) => {
        if (action !== 'enviar') return null;
        const motivo = root.querySelector('#csMotivo').value;
        const detalle = (root.querySelector('#csDet').value || '').trim();
        if (detalle.length < 5) {
          Toast.show('Escribe qué viste — es lo que bodega lee para saber qué mandar.', 'warn');
          root.querySelector('#csDet')?.focus();
          return false;
        }
        enviando = true;
        root.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          await marcar(orden, ordenId, equipo, { motivo, detalle });
          Toast.show(`✅ ${serial}: bodega avisada — cambiará el serial en la gestión ${gid}`, 'ok');
          api.close(true);
          return false;
        } catch (err) {
          console.error('[ordenes-cambio-serial]', err);
          Toast.show('No se pudo avisar: ' + (err?.message || err), 'bad');
          enviando = false;
          root.querySelectorAll('button').forEach(b => { b.disabled = false; });
          return false;
        }
      },
    });
  }

  // Marca el serial en la GESTIÓN (que es a quien hay que corregirle el dato)
  // y deja copia en la orden para que la fila lo diga sin ir a buscarla.
  async function marcar(orden, ordenId, equipo, { motivo, detalle }) {
    const user = firebase.auth().currentUser;
    const serial = serialDe(equipo);
    const clave = normSerial(serial);
    const marca = {
      serial,
      modelo: equipo.modelo || '',
      modelo_id: equipo.modelo_id || null,
      motivo_codigo: motivo,
      motivo_detalle: detalle,
      orden_id: ordenId,
      equipo_id: equipo.id || null,
      por_uid: user?.uid || null,
      por_email: user?.email || null,
      at_iso: new Date().toISOString(),
    };

    // set+merge (no update con ruta de puntos): fusiona el mapa sin pisar lo
    // que otro técnico marcó de otro radio de la misma gestión.
    await firebase.firestore().collection('gestiones').doc(orden.gestion.id)
      .set({ correccion_solicitada: { [clave]: marca } }, { merge: true });

    try {
      await firebase.firestore().collection('ordenes_de_servicio').doc(ordenId)
        .set({ correcciones_solicitadas: { [clave]: marca } }, { merge: true });
      const cache = (APP?.state?.orders || []).find(o => o.ordenId === ordenId);
      if (cache) {
        cache.correcciones_solicitadas = { ...(cache.correcciones_solicitadas || {}), [clave]: marca };
        if (typeof refrescarEquiposDeOrden === 'function') { try { refrescarEquiposDeOrden(ordenId); } catch (_) { /* no crítico */ } }
      }
    } catch (e) {
      // La marca en la gestión ya está, que es la que mueve el proceso: la de
      // la orden es comodidad de lectura y no puede tumbar el aviso.
      console.warn('[ordenes-cambio-serial] marca en la orden no guardada', e?.message || e);
    }
  }

  window.OrdenesCambioSerial = { abrir, puedeMarcar, marcaDe, MOTIVOS, ROLES_MARCAN };
  window.abrirCambioSerialTaller = abrir;
})();
