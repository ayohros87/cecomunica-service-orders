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
 * ni si se cobra. Eso es de administración, y por eso pasa por aprobación
 * SIEMPRE, tenga garantía o no.
 *
 * DOS CAUSAS, DOS CAMINOS (2026-09-25, Alberto). Lo PRIMERO que se decide es
 * por qué hay que reemplazarlo, y lo decide quien tiene el radio en la mano:
 *   · FALLA DEL EQUIPO (garantía, desgaste, falla recurrente) → sin cargo, el
 *     camino de siempre.
 *   · DAÑO CAUSADO POR EL CLIENTE (golpe, líquido, carcasa rota…) → se cotiza
 *     y se factura. Exige fotos del daño (las reglas no dejan crearlo sin
 *     ellas) y solo aplica a radios de ALQUILER: un radio propio dañado por
 *     su dueño no tiene reemplazo — se le ofrece un equipo nuevo, con
 *     descuento especial si ventas lo decide, o la reparación.
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
  // `dano_no_reparable` se conserva como clave (el histórico la usa) pero se
  // lee como FALLA: "dañado" a secas no decía por culpa de quién, y el daño
  // del cliente ahora es su propia causa, con cobro.
  const MOTIVOS = [
    ['garantia_fabrica', 'Garantía de fábrica'],
    ['dano_no_reparable', 'Falla que no tiene arreglo'],
    ['falla_recurrente', 'Falla recurrente'],
    ['otro', 'Otro'],
  ];

  // Tipos de daño causado por el cliente (mismas claves que
  // functions/src/lib/reposicionDano.TIPOS_DANO y Centro.TIPOS_DANO).
  const TIPOS_DANO = [
    ['golpe', 'Golpe o caída'],
    ['liquido', 'Líquido o humedad'],
    ['carcasa', 'Carcasa, pantalla o antena rota'],
    ['manipulacion', 'Manipulación o sellos violados'],
    ['otro', 'Otro daño físico'],
  ];
  const MAX_FOTOS = 4;

  // Foto a JPEG de 1600 px: un celular saca fotos de 4–8 MB y el expediente
  // solo necesita que se vea el daño.
  async function comprimir(file, maxWidth = 1600, quality = 0.78) {
    const url = await new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
    });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const esc = Math.min(1, maxWidth / (img.width || maxWidth));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se pudo comprimir la foto')), 'image/jpeg', quality));
  }

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
              ? 'La fecha de garantía es estimada (no está capturada la factura): administración confirma si va sin cargo.'
              : 'Fuera de garantía: si procede, será por servicio al cliente — lo decide administración.',
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
  function construirItem(equipo, ficha, sit, { motivo, diagnostico, salienteEnCasa, causa }) {
    return {
      serial_saliente: serialDe(equipo),
      pool_doc_id_saliente: ficha?.id || null,
      modelo: ficha?.modelo_label || equipo.modelo || '',
      modelo_id: ficha?.modelo_id || null,
      contrato_doc_id: ficha?.asignacion?.contrato_doc_id || null,
      contrato_id: ficha?.asignacion?.contrato_id || null,
      elegibilidad: sit.code === 'propio_garantia' ? 'propio_garantia'
        : sit.code === 'propio_excepcion' ? 'propio_excepcion' : 'alquiler',
      motivo_codigo: causa === 'dano_cliente' ? 'dano_cliente' : motivo,
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

    // Un radio PROPIO dañado por su dueño no tiene reemplazo por daño
    // (Alberto, 2026-09-25): la tarjeta se ve, apagada, diciendo qué sí se
    // puede hacer. Esconderla haría pensar que el sistema no contempla el caso.
    const esPropio = sit.code === 'propio_garantia' || sit.code === 'propio_excepcion';

    // Una tarjeta por causa. Es lo primero que se elige y cambia todo lo de
    // abajo: el color, lo que se pide y a dónde va.
    const tarjeta = (val, titulo, sub, pie, color, deshabilitada, porQue) => `
      <label class="rp-causa" data-causa="${val}" style="flex:1 1 220px; display:block; cursor:${deshabilitada ? 'not-allowed' : 'pointer'};
             border:2px solid var(--border-default, #D5DDE5); border-radius:10px; padding:12px; ${deshabilitada ? 'opacity:.6;' : ''}">
        <input type="radio" name="rpCausa" value="${val}" ${deshabilitada ? 'disabled' : ''} style="margin:0 6px 0 0;">
        <b style="font-size:14px;">${titulo}</b>
        <div style="font-size:12.5px;color:var(--fg-3);margin:4px 0 8px;">${sub}</div>
        <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${color};">${pie}</div>
        ${porQue ? `<div style="font-size:12px;color:var(--fg-3);margin-top:6px;">${porQue}</div>` : ''}
      </label>`;

    let enviando = false;
    return Modal.sheet({
      title: `Proponer reemplazo — ${serial}`,
      icon: 'shield-check',
      size: 'md',
      closable: () => !enviando,
      html: `
        <div style="padding:10px 12px;border:1px solid var(--border-default, #D5DDE5);border-radius:8px;margin-bottom:12px;">
          <div style="font-family:var(--font-mono,monospace);font-size:14px;font-weight:600;">${esc(serial)}</div>
          <div style="font-size:13px;color:var(--fg-2);">${esc(modelo)}</div>
          <div style="font-size:12.5px;color:var(--fg-3);margin-top:4px;">${esc(sit.label)}${sit.why ? ` — ${esc(sit.why)}` : ''}</div>
          ${ficha?.asignacion?.contrato_id
            ? `<div style="font-size:12px;color:var(--fg-3);margin-top:2px;">Contrato ${esc(ficha.asignacion.contrato_id)}</div>` : ''}
        </div>
        <div class="form-label" style="margin-bottom:6px;">¿Por qué hay que reemplazarlo?</div>
        <div id="rpCausas" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
          ${tarjeta('falla', 'Falla del equipo', 'Garantía, desgaste o una falla que se repite', 'Sin cargo al cliente', 'var(--ok-deep, #17714B)', false, '')}
          ${tarjeta('dano_cliente', 'Daño causado por el cliente', 'Golpe, líquido, carcasa o pantalla rota, sellos violados', 'Se cotiza y se factura', 'var(--warn-deep, #92400E)',
            esPropio, esPropio ? 'Este radio es del cliente: no hay reemplazo por daño. Ofrécele un equipo nuevo (ventas puede darle un descuento especial) o cotiza la reparación.' : '')}
        </div>
        <div id="rpCuerpo" style="display:none;">
          <div id="rpFalla" style="display:none;" class="form-field">
            <label class="form-label" for="rpMotivo">Motivo</label>
            <select id="rpMotivo" class="form-select" style="margin-bottom:10px;">
              ${MOTIVOS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
            </select>
          </div>
          <div id="rpDano" style="display:none;">
            <div class="form-field" style="margin-bottom:10px;">
              <label class="form-label" for="rpTipoDano">¿Qué daño tiene?</label>
              <select id="rpTipoDano" class="form-select">
                <option value="">— elige —</option>
                ${TIPOS_DANO.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
              </select>
            </div>
            <div class="form-field" style="margin-bottom:10px;">
              <label class="form-label" for="rpFotos">Fotos del daño <span style="color:var(--bad,#991B1B);">(al menos una)</span></label>
              <input type="file" id="rpFotos" accept="image/*" capture="environment" multiple class="form-input">
              <div id="rpFotosInfo" class="form-hint" style="font-size:12px;color:var(--fg-3);margin-top:4px;">
                Hasta ${MAX_FOTOS}. Es la prueba con la que administración decide el cobro.</div>
            </div>
            <p style="margin:0 0 10px;font-size:12.5px;color:var(--fg-3);">
              El monto lo fija administración partiendo del <b>valor de reposición del catálogo</b>. Si lo aprueba con cargo,
              el sistema arma la cotización y la jefatura de taller se la envía al cliente. Bodega no asigna el radio nuevo
              hasta que el cliente acepte.</p>
          </div>
          <div class="form-field" style="margin-bottom:10px;">
            <label class="form-label" for="rpDiag">Diagnóstico de este radio</label>
            <textarea id="rpDiag" class="form-input" rows="3"
              placeholder="Qué le pasa y por qué no tiene arreglo. Es lo que administración va a leer para decidir.">${esc(diagPrevio)}</textarea>
            ${diagPrevio ? '<div class="form-hint" style="font-size:12px;color:var(--fg-3);margin-top:4px;">Traído de la intervención — corrígelo si hace falta.</div>' : ''}
          </div>
          <label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--fg-2);">
            <input type="checkbox" id="rpEnCasa" ${esVisita ? '' : 'checked'} style="margin-top:3px;">
            <span>El radio <b>ya está aquí</b> (entró por el mostrador con esta orden).
              <span style="color:var(--fg-3);">Si lo marcas, el sistema no abre una devolución para ir a buscarlo.</span></span>
          </label>
          <p id="rpDestino" style="margin:12px 0 0;font-size:12.5px;color:var(--fg-3);"></p>
        </div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'enviar', label: 'Enviar propuesta', primary: true, icon: 'send' },
      ],
      onMount: (root) => {
        const destino = root.querySelector('#rpDestino');
        const infoFotos = root.querySelector('#rpFotosInfo');
        const pintar = () => {
          const causa = root.querySelector('input[name="rpCausa"]:checked')?.value || '';
          root.querySelectorAll('.rp-causa').forEach(t => {
            const on = t.dataset.causa === causa;
            t.style.borderColor = on ? (causa === 'dano_cliente' ? 'var(--warn-deep, #92400E)' : 'var(--ok-deep, #17714B)') : 'var(--border-default, #D5DDE5)';
            t.style.background = on ? (causa === 'dano_cliente' ? 'var(--warn-soft, #FFF7E6)' : 'var(--ok-soft, #E7F6EE)') : '';
          });
          root.querySelector('#rpCuerpo').style.display = causa ? '' : 'none';
          root.querySelector('#rpFalla').style.display = causa === 'falla' ? '' : 'none';
          root.querySelector('#rpDano').style.display = causa === 'dano_cliente' ? '' : 'none';
          destino.innerHTML = causa === 'dano_cliente'
            ? `Va a <b>administración</b> (ventas@cecomunica.com) como reemplazo <b>con cargo</b>, con el vendedor de
               <b>${esc(orden.cliente_nombre || orden.cliente || 'el cliente')}</b> en copia.`
            : `Va a <b>administración</b> (ventas@cecomunica.com) para aprobación, con el vendedor de
               <b>${esc(orden.cliente_nombre || orden.cliente || 'el cliente')}</b> en copia. Bodega repone el <b>mismo modelo</b>, sin cargo.`;
        };
        root.querySelectorAll('input[name="rpCausa"]').forEach(r => r.addEventListener('change', pintar));
        root.querySelector('#rpFotos').addEventListener('change', (e) => {
          const n = e.target.files?.length || 0;
          infoFotos.textContent = n > MAX_FOTOS
            ? `Elegiste ${n}: solo se suben las primeras ${MAX_FOTOS}.`
            : n ? `${n} foto(s) lista(s) para subir.` : `Hasta ${MAX_FOTOS}. Es la prueba con la que administración decide el cobro.`;
        });
        pintar();
      },
      onAction: async (action, root, api) => {
        if (action !== 'enviar') return null;
        const causa = root.querySelector('input[name="rpCausa"]:checked')?.value || '';
        if (!causa) { Toast.show('Elige primero por qué hay que reemplazarlo.', 'warn'); return false; }
        const motivo = root.querySelector('#rpMotivo').value;
        const diagnostico = (root.querySelector('#rpDiag').value || '').trim();
        const tipoDano = root.querySelector('#rpTipoDano').value;
        const fotos = [...(root.querySelector('#rpFotos').files || [])].slice(0, MAX_FOTOS);
        if (causa === 'dano_cliente') {
          if (!tipoDano) { Toast.show('Elige qué daño tiene el radio.', 'warn'); root.querySelector('#rpTipoDano').focus(); return false; }
          if (!fotos.length) { Toast.show('Agrega al menos una foto del daño — sin ella no se puede decidir el cobro.', 'warn'); return false; }
        }
        if (diagnostico.length < 10) {
          Toast.show('Escribe el diagnóstico — es lo que administración lee para decidir.', 'warn');
          root.querySelector('#rpDiag')?.focus();
          return false;
        }
        const salienteEnCasa = !!root.querySelector('#rpEnCasa').checked;

        enviando = true;
        root.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const gid = await enviar(orden, ordenId, { equipo, ficha, sit },
            { motivo, diagnostico, salienteEnCasa, causa, tipoDano, fotos });
          Toast.show(causa === 'dano_cliente'
            ? `✅ ${serial}: reemplazo por daño ${gid} enviado a administración`
            : `✅ ${serial}: propuesta ${gid} enviada a administración`, 'ok');
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
    const esDano = opts.causa === 'dano_cliente';
    // Por DAÑO: las fotos se suben ANTES de crear el expediente, con el
    // número ya reservado — las reglas no dejan nacer una propuesta por daño
    // sin fotos, y el correo a administración (trigger de creación) ya las ve.
    let gidReservado = null;
    const fotos = [];
    if (esDano) {
      gidReservado = await GestionesService.reservarId('reemplazo');
      if (typeof CargaDiferida !== 'undefined') await CargaDiferida.storage();
      for (let i = 0; i < (opts.fotos || []).length; i++) {
        const blob = await comprimir(opts.fotos[i]);
        const path = `gestiones_anexos/${gidReservado}/dano-${i + 1}-${Date.now()}.jpg`;
        await firebase.storage().ref(path).put(blob, { contentType: 'image/jpeg' });
        fotos.push(path);
      }
    }
    const gid = await GestionesService.crear({
      tipo: 'reemplazo',
      cliente_id: orden.cliente_id,
      cliente_nombre: orden.cliente_nombre || orden.cliente || '',
      // SIEMPRE por aprobación: el taller propone, administración decide.
      estado: 'pendiente_aprobacion',
      ...(esDano ? {
        causa: 'dano_cliente',
        dano: {
          tipo: opts.tipoDano,
          tipo_label: (TIPOS_DANO.find(([k]) => k === opts.tipoDano) || [null, ''])[1],
          fotos,
        },
        // El monto de referencia (valor de reposición del catálogo) lo pone
        // el servidor al crearse: el técnico no decide el precio.
        cobro: { requiere: true, fuente: 'valor_reposicion', estado: 'por_aprobar' },
      } : { causa: 'falla' }),
      origen: {
        tipo: 'taller',
        ref_id: ordenId,
        orden_id: ordenId,
        equipo_id: equipo.id || null,
        serial: item.serial_saliente,
        diagnostico: opts.diagnostico,
        motivo_codigo: esDano ? 'dano_cliente' : opts.motivo,
        causa: esDano ? 'dano_cliente' : 'falla',
        saliente_en_casa: !!opts.salienteEnCasa,
        tecnico_uid: user?.uid || null,
        tecnico_email: user?.email || null,
        tecnico_nombre: orden.tecnico_asignado || '',
      },
      aprobacion: { requiere: true, motivo: esDano ? 'dano_cliente' : 'propuesta_taller' },
      items: [item],
    }, { id: gidReservado });

    const clave = normSerial(item.serial_saliente);
    const marca = {
      gestion_id: gid,
      serial: item.serial_saliente,
      equipo_id: equipo.id || null,
      // La pantalla de cotizar la orden lo lee para no cobrar la reparación
      // de un radio que ya se va a cobrar como reposición.
      causa: esDano ? 'dano_cliente' : 'falla',
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

  window.OrdenesReemplazo = { abrir, situacion, puedeProponer, construirItem, propuestaDe, MOTIVOS, TIPOS_DANO, ROLES_PROPONEN };
  window.abrirProponerReemplazo = abrir;
})();
