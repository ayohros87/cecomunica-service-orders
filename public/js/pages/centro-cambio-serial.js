// @ts-nocheck
// Centro de gestión de clientes — Cambio de serial (corrección de registro).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Cambio de serial (corrección de registro) ═════════
     El sistema dice que el cliente tiene el serial X y en realidad tiene el Y:
     un dígito mal tecleado al asignar, o bodega cambió el radio en el mostrador
     y el papel se quedó con el primero. NO es un reemplazo — no sale nada del
     estante ni hay que recoger un radio; lo que está mal es el registro.

     Sustituye al canal viejo (`contratos/{cid}/seriales_cambios`, un modal
     colgado de la lista de contratos que exigía el contrato en 'aprobado' y
     que se quedó sin puerta el 2026-09-09, cuando /contratos/ pasó a ser
     archivo). Ahora es una gestión más del expediente del cliente: Ola 5 de
     docs/ARQUITECTURA_GESTIONES_POR_CLIENTE_2026-08-25.md.

     Va DIRECTO a bodega, sin aprobación (Alberto 2026-09-15): corregir un typo
     no saca equipo del estante ni cambia la facturación — hacerlo esperar una
     firma de administración es trancar el trámite corto con el largo. */
  async wizCambioSerial() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    const flota = this._flotaCorregible();
    const enDemo = this._enDemo();
    this._ssReset('cs');
    if (!flota.length) {
      Toast.show(enDemo.length
        ? 'Los equipos que este cliente tiene salieron en un demo: para cambiarlos, anula el demo y ábrelo con los radios correctos.'
        : 'Este cliente no tiene equipos registrados en campo que corregir.', 'warn');
      return;
    }
    const cuerpoCs = this._csFilasHtml(flota);
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Corregir un serial mal registrado — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        Para cuando el sistema tiene anotado un serial y el cliente en realidad tiene otro.
        <b>No mueve equipo</b>: el radio ya está donde tiene que estar. Si el radio que el cliente
        tiene se dañó y hay que sustituirlo, eso es un <b>reemplazo</b>, no esto.</p>
      ${enDemo.length ? `<div class="cg-senal warn" style="margin:0 0 12px;">
        <span><b>${enDemo.length} equipo(s) no salen en esta lista porque están en un demo</b>
        (<span class="cg-mono">${enDemo.map(e => this.esc(e.serial || e.id)).join(', ')}</span>).
        Un demo no tiene contrato, así que corregirlo aquí dejaría el expediente del demo y su orden
        diciendo los seriales viejos. Para cambiar los radios de un demo: <b>anula el demo y ábrelo
        con los correctos</b>.</span></div>` : ''}
      ${this._csBarra}
      <div class="cg-twrap" style="max-height:44vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Figura en el sistema</th><th>Modelo</th><th>Contrato</th>
        </tr></thead><tbody data-sscuerpo="cs">${cuerpoCs}</tbody></table></div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearCambioSerial(this)">Enviar a bodega</button>
      </div>`);
    this._ssMontar('cs');
  },

  // Lo que se puede corregir: lo que el sistema dice que el cliente tiene.
  // Un radio en taller o ya devuelto no se corrige por aquí — su serial ya
  // dejó de colgar de la cuenta y tocarlo enredaría la orden que lo mueve.
  //
  // FUERA los radios que salieron en un DEMO (caso R. SMITH ALTA PLAZA,
  // 2026-09-15): un demo no tiene contrato, así que la corrección no tendría
  // fila de seriales que reescribir y dejaría el expediente del demo y su OS
  // diciendo los seriales viejos. Media corrección es peor que ninguna. Ahí el
  // camino es otro: anular el demo y abrirlo con los radios correctos.
  // Se reconocen por colgar de una gestión SIN contrato; el entrante de un
  // reemplazo también trae `gestion_doc_id` pero hereda el contrato del que
  // sustituye, y ese sí se corrige normal.
  _flotaCorregible() {
    return (this.equipos || []).filter(e =>
      ['en_cliente', 'asignado_contrato'].includes(e.estado) && !e.pendiente_devolucion
      && !(e.asignacion?.gestion_doc_id && !e.asignacion?.contrato_doc_id));
  },

  // Los que quedaron fuera por estar en un demo — se dicen, no se esconden:
  // quien vino a corregir ese serial tiene que saber por dónde va.
  _enDemo() {
    return (this.equipos || []).filter(e =>
      ['en_cliente', 'asignado_contrato'].includes(e.estado) && !e.pendiente_devolucion
      && e.asignacion?.gestion_doc_id && !e.asignacion?.contrato_doc_id);
  },

  // Filas por el selector compartido (P4): buscador y un grupo por contrato.
  _csBarra: '',
  _csFilasHtml(flota) {
    const filas = flota.map((e, ix) => ({
      grupo: e.asignacion?.contrato_doc_id || '__sin', grupoLabel: e.asignacion?.contrato_id || 'Sin contrato',
      ok: true, busca: `${e.serial || e.id} ${e.modelo_label || ''} ${e.asignacion?.contrato_id || ''}`,
      celdas: `
      <td><input type="checkbox" data-cssel="${ix}" onchange="Centro._csFila(${ix}, this.checked)"></td>
      <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
      <td>${this.esc(e.modelo_label || '—')}</td>
      <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || '')
        || '<span style="color:var(--fg-4); font-family:inherit;">sin contrato</span>'}</td>`,
      cfgAttrs: `id="cscfg-${ix}" class="hidden"`,
      cfg: `<td></td><td colspan="3" style="background:var(--surface-sunken, #EEF2F6);">
      <div style="display:flex; gap:10px; flex-wrap:wrap; padding:4px 0;">
        <select class="form-select" data-csmot="${ix}" style="max-width:300px;">
          <option value="">— Qué pasó —</option>
          ${this.MOTIVOS_CAMBIO_SERIAL.map(([k, l]) => `<option value="${k}">${this.esc(l)}</option>`).join('')}
        </select>
        <input class="form-input" data-csreal="${ix}" style="max-width:200px; font-family:var(--font-mono, monospace);"
          placeholder="Serial real (si lo sabes)" aria-label="Serial real">
        <input class="form-input" data-csdet="${ix}" style="flex:1; min-width:180px;" placeholder="Detalle (opcional)">
      </div>
      <div style="font-size:11.5px; color:var(--fg-4); padding-bottom:4px;">
        Si no tienes el serial real a mano, déjalo en blanco: bodega lo confirma contra el radio.</div>
    </td>`,
    }));
    const { barra, cuerpo } = this._ssHtml('cs', filas, { colspan: 4, placeholder: 'Serial que figura mal, modelo o contrato…' });
    this._csBarra = barra;
    return cuerpo;
  },

  _csFila(ix, on) {
    document.getElementById(`cscfg-${ix}`)?.classList.toggle('hidden', !on);
  },

  // Candado contra el doble submit (auditoría UX 2026-09-28, P0 #10): cada
  // click consumía un correlativo y mandaba un correo de aprobación.
  crearCambioSerial(btn) {
    return withBusy(btn || null, () => this._crearCambioSerial(), { key: 'crearCambioSerial', label: 'Enviando…', rethrow: false });
  },
  async _crearCambioSerial() {
    const flota = this._flotaCorregible();
    const seleccion = [...document.querySelectorAll('input[data-cssel]:checked')].map(i => Number(i.dataset.cssel));
    if (!seleccion.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const items = [];
    const propuestos = new Set();
    for (const ix of seleccion) {
      const e = flota[ix];
      if (!e) continue;
      const motivo = document.querySelector(`select[data-csmot="${ix}"]`)?.value || '';
      if (!motivo) { Toast.show(`Indica qué pasó con el serial ${e.serial || e.id}`, 'warn'); return; }
      const real = (document.querySelector(`input[data-csreal="${ix}"]`)?.value || '').trim();
      let serialNuevo = null;
      if (real) {
        const norm = EquiposPoolService.normalizarSerial(real);
        if (!EquiposPoolService.esSerialValido(norm)) {
          Toast.show(`"${real}" no parece un serial válido — déjalo en blanco y bodega lo confirma`, 'warn');
          return;
        }
        if (norm === EquiposPoolService.normalizarSerial(e.serial || e.id)) {
          Toast.show(`El serial real de ${e.serial || e.id} es el mismo que ya figura — no hay nada que corregir`, 'warn');
          return;
        }
        if (propuestos.has(norm)) { Toast.show(`${real} está propuesto dos veces`, 'warn'); return; }
        propuestos.add(norm);
        serialNuevo = real;
      }
      items.push({
        serial: e.serial || e.id,
        serial_norm: EquiposPoolService.normalizarSerial(e.serial || e.id),
        pool_doc_id: e.id || null,
        modelo: e.modelo_label || '',
        modelo_id: e.modelo_id || null,
        contrato_doc_id: e.asignacion?.contrato_doc_id || null,
        contrato_id: e.asignacion?.contrato_id || null,
        motivo_codigo: motivo,
        motivo_detalle: document.querySelector(`input[data-csdet="${ix}"]`)?.value.trim() || '',
        // Propuesto por quien abre la gestión; bodega confirma o corrige.
        serial_nuevo: serialNuevo,
        pool_doc_id_nuevo: null,
        ...(serialNuevo ? { serial_nuevo_propuesto: true } : {}),
      });
    }
    try {
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
        tipo: 'cambio_serial',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_bodega',
        origen: { tipo: 'vendedor' },
        items,
      });
      this._cerrarModal();
      this.gSel = gid;
      const n = items.filter(i => i.serial_nuevo).length;
      Toast.show(n === items.length
        ? `Corrección ${gid} enviada — bodega verifica ${items.length === 1 ? 'el serial' : 'los seriales'} y se aplica sola`
        : `Corrección ${gid} enviada — bodega confirma cuál es el serial de verdad`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la corrección', 'bad'); }
  },

  // Modalidad de la línea: de quién es el equipo. Antes era un ganchito
  // "del cliente" que nadie marcaba y TODO salía como alquiler (Cerdas,
  // 2026-09-09): ahora es una elección obligatoria sin valor por defecto —
  // _lineasModelo devuelve modalidad null si no se eligió y los wizards
  // no dejan crear/aumentar hasta que cada línea la tenga.
  _selModalidad(pref, val, extra = '') {
    const v = (val === 'propio' || val === 'alquiler') ? val : '';
    return `<select class="form-select" data-${pref}-modalidad ${extra} style="width:150px; flex:none;"
        title="Alquiler = equipo de CECOMUNICA en renta · Del cliente = equipo propiedad del cliente (tarifa de servicio)">
        <option value="" ${v ? '' : 'selected'}>¿De quién es?</option>
        <option value="alquiler" ${v === 'alquiler' ? 'selected' : ''}>Alquiler</option>
        <option value="propio" ${v === 'propio' ? 'selected' : ''}>Del cliente</option>
      </select>`;
  },
  // Fila de línea modelo (+cantidad, +precio opcional) con el SELECT del catálogo.
  _lineaModeloHtml(pref, conPrecio) {
    return `<div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
      ${this._selModelo(`data-${pref}-modelo style="flex:1;"`)}
      <input class="form-input" data-${pref}-cant type="number" min="1" value="1" style="width:86px;" title="Cantidad">
      ${conPrecio ? `<input class="form-input" data-${pref}-precio type="number" min="0" step="1" placeholder="$/mes" style="width:110px;" title="Precio mensual">
      ${this._selModalidad(pref)}` : ''}
    </div>`;
  },
  _addLineaModelo(contId, pref, conPrecio) {
    document.getElementById(contId)?.insertAdjacentHTML('beforeend', this._lineaModeloHtml(pref, conPrecio));
  },

  async wizDemo() {
    this._cerrarModal();
    document.getElementById('cgMenu')?.classList.add('hidden');
    await this._cargarModelos();
    const hoy = new Date().toISOString().slice(0, 10);
    this._abrirModal(`
      <h3 style="margin:0 0 6px;">Nueva solicitud de demo — ${this.esc(this.cliente.nombre)}</h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
        Bodega asigna los seriales (stock nuevo o refurbished), el sistema crea la OS de programación
        y al retorno los equipos pasan por inspección antes de volver a Disponible.</p>
      <div id="wdLineas">${this._lineaModeloHtml('wdl')}</div>
      <button class="btn btn-ghost" style="padding:4px 10px; font-size:12.5px; margin-bottom:12px;"
        onclick="Centro._addLineaModelo('wdLineas','wdl')">+ Agregar otro modelo</button>
      <div class="form-field" style="margin-bottom:10px;">
        <label class="form-label">Motivo o finalidad del demo</label>
        <textarea class="form-input form-textarea" id="wdFin" placeholder="Ej.: prueba de cobertura previa a alquiler…"></textarea>
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:4px;">
        <div class="form-field"><label class="form-label">Fecha de salida</label>
          <input class="form-input" type="date" id="wdSalida" value="${hoy}"></div>
        <div class="form-field"><label class="form-label">Devolución estimada (opcional)</label>
          <input class="form-input" type="date" id="wdDevol"></div>
      </div>
      <p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">Sin fecha estimada, el recordatorio
        al responsable sale a los 15 días de la salida; con fecha, al vencerse.</p>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.crearDemo(this)">Enviar solicitud</button>
      </div>`);
  },

  // Candado contra el doble submit (auditoría UX 2026-09-28, P0 #10): cada
  // click consumía un correlativo y mandaba un correo de aprobación.
  crearDemo(btn) {
    return withBusy(btn || null, () => this._crearDemo(), { key: 'crearDemo', label: 'Enviando…', rethrow: false });
  },
  async _crearDemo() {
    const selects = [...document.querySelectorAll('select[data-wdl-modelo]')];
    const cants = [...document.querySelectorAll('input[data-wdl-cant]')];
    const lineas = selects.map((s, i) => {
      const m = this._modeloDeSelect(s);
      return m ? { modelo: m.label, modelo_id: m.id, cantidad: Math.max(1, Number(cants[i]?.value || 1)) } : null;
    }).filter(Boolean);
    const finalidad = document.getElementById('wdFin')?.value.trim() || '';
    const salida = document.getElementById('wdSalida')?.value || '';
    if (!lineas.length) { Toast.show('Indica al menos un modelo', 'warn'); return; }
    if (!finalidad) { Toast.show('Indica la finalidad del demo', 'warn'); return; }
    try {
      const gid = await GestionesService.crear({ ...Centro._estampaReg(),
        tipo: 'demo',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_bodega',
        origen: { tipo: 'vendedor' },
        items: [],
        demo: {
          lineas, finalidad,
          fecha_salida: salida,
          fecha_devolucion_estimada: document.getElementById('wdDevol')?.value || null,
          seriales_asignados: [],
        },
      });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`Solicitud ${gid} enviada — Bodega recibirá el aviso`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la solicitud', 'bad'); }
  },
});
