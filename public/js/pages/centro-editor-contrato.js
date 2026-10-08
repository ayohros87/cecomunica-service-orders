// @ts-nocheck
// Centro de gestión de clientes — Editor de contrato (2026-09-10).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Editor de contrato (2026-09-10) ═════════
     Vivía en contratos/editar-contrato.html, fuera del Centro: la ficha
     ofrecía "Editar…" y saltaba a otro módulo. Peor que la incomodidad: el
     editor aprendía de segundo y a mano todo lo que el wizard ya sabía (la
     modalidad por línea, el plan por serial), y ahí es donde salía el bug —
     un contrato editado hacia una forma que el wizard nunca habría producido.

     Comparte con el wizard los COMPONENTES (líneas de modelo, cargos, la
     aritmética de ContratoTarifario, el tarifario) pero NO su narrativa: crear
     habla de consolidación, custodia y plan por serial; editar es un formulario
     corto. Lo que se edita es lo mismo que editaba la página vieja: tipo,
     duración, líneas, cargos, ITBMS y observaciones.

     Lo que NO se toca al editar, a propósito:
       · la acción (Nuevo / Renovación) — se decide al crear;
       · el plan por serial — se corrige en "Seriales de la cuenta";
       · el correlativo, el cliente y el origen.
  */
  _weC: null,          // contrato en edición
  _weGuardando: false,

  async editarContrato(contratoDocId) {
    if (!canRole(this.rol, 'editar-contrato')) { Toast.show('Tu rol no edita contratos', 'warn'); return; }
    const c = this.contratos.find(x => x.id === contratoDocId)
      || await ContratosService.getContrato(contratoDocId);
    // Mismo criterio que aplicaba la página vieja al abrirse
    // (js/domain/contratoEdicion.js).
    const ed = ContratoEdicion.puedeEditarse(c);
    if (!ed.ok) { Toast.show(ed.texto, 'warn'); return; }

    this._cerrarModal();
    this.cerrarMenu?.();
    await Promise.all([this._cargarModelos(), this._cargarCargos()]);
    this._weC = c;

    // Tipo: el select ofrece Servicio y Temporal, pero un contrato viejo
    // (ALQ, PROP, REEMP…) conserva el suyo como opción "actual". Sin esto, un
    // tipo que no casaba caía en la primera opción y al guardar el contrato
    // cambiaba de tipo en silencio — el mismo cuidado que tenía la página vieja.
    const tipoActual = c.codigo_tipo || '';
    const tipos = ['SERV', 'TEMP'];
    const opcTipo = (tipoActual && !tipos.includes(tipoActual)
      ? `<option value="${this.esc(tipoActual)}" selected>${this.esc(this.TIPOS_CONTRATO[tipoActual] || c.tipo_contrato || tipoActual)} (actual)</option>` : '')
      + tipos.map(k => `<option value="${k}" ${k === tipoActual ? 'selected' : ''}>${this.TIPOS_CONTRATO[k]}</option>`).join('');

    const enDias = Number(c.duracion_dias) > 0;
    const durN = enDias ? Number(c.duracion_dias)
      : (Number(c.duracion_meses) > 0 ? Number(c.duracion_meses)
        : (parseInt(String(c.duracion || '').replace(/\D/g, ''), 10) || 12));

    // Modalidad por línea: los contratos anteriores al 2026-09-09 no la traen,
    // y como es obligatoria para guardar, editar un ALQ viejo para corregir una
    // observación obligaba a declararla en cada línea a mano — invitando a
    // marcar cualquier cosa con tal de pasar. Se DERIVA del tipo del contrato,
    // la misma inferencia que ya hace el wizard al copiar líneas de un origen:
    // un contrato entero ALQ era alquiler y uno PROP, equipo del cliente. Un
    // SERV (mixto por línea) sin modalidad sí se queda en blanco: ahí no hay
    // nada que inferir y el vendedor tiene que decirlo.
    const tipoC = this._codigoTipo(c);
    const modPorTipo = tipoC === 'PROP' ? 'propio' : tipoC === 'ALQ' ? 'alquiler' : null;
    const lineas = (c.equipos || []).map(l => ({
      modelo_id: l.modelo_id, modelo: l.modelo,
      cantidad: l.cantidad, precio: l.precio, modalidad: l.modalidad || modPorTipo,
    }));
    if (!lineas.length) lineas.push(null);

    // Plan por serial: no se edita aquí, pero SÍ manda sobre la modalidad de
    // la renovación (sin equipo / refurbished). Se muestra lo derivado.
    const esRenov = c.accion === 'Renovación';
    const plan = (c.transicion_plan?.nivel === 'serial' && Array.isArray(c.transicion_plan.unidades))
      ? c.transicion_plan : null;

    // Editar un contrato ya APROBADO en lo económico o el plazo lo devuelve a
    // pendiente de aprobación (Alberto 2026-09-04). Se avisa ANTES, no después.
    const avisoReap = ContratoEdicion.aplicaReaprobacion(c)
      ? `<div class="cg-nota" style="margin:0 0 14px; padding:10px 12px; border-left:3px solid var(--warn, #E0A93A); background:var(--soft-warn, #fdf4e1); font-size:13px;">
           Este contrato <b>ya está aprobado</b>. Si cambias precios, cargos, plazo o ITBMS vuelve a
           <b>pendiente de aprobación</b> y se le avisa a ventas. Corregir solo las observaciones no lo mueve.
         </div>` : '';

    this._abrirModalA({
      titulo: `Editar ${this.esc(c.contrato_id || c.id)} — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      ${avisoReap}
      <p style="margin:0 0 14px; font-size:13px; color:var(--fg-3); max-width:72ch;">
        Se corrigen tipo, duración, equipos, cargos y observaciones. La <b>acción</b>
        (${this.esc(c.accion || '—')}) se define al crear el contrato y no se cambia aquí; los
        <b>seriales</b> se corrigen en «Seriales de la cuenta».
      </p>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">1</span> Datos del contrato <span class="hint">tipo · duración</span></div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
          <div class="form-field" style="margin:0; max-width:190px;">
            <label class="form-label" for="weTipo">Tipo</label>
            <select class="form-select" id="weTipo">${opcTipo}</select></div>
          <div class="form-field" style="margin:0; max-width:210px;">
            <label class="form-label" for="weMeses">Duración</label>
            <div style="display:flex; gap:6px;">
              <input class="form-input" type="number" id="weMeses" min="1" value="${durN}" style="width:90px;">
              <select class="form-select" id="weDurUnidad" style="width:100px;">
                <option value="meses" ${enDias ? '' : 'selected'}>meses</option>
                <option value="dias" ${enDias ? 'selected' : ''}>días</option>
              </select>
            </div></div>
        </div>
        ${esRenov ? `<div id="weModalidad" style="margin-top:8px; font-size:12.5px; color:var(--fg-3);"></div>` : ''}
      </div>

      <div oninput="Centro._wePreview()">
      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">2</span> Equipos y tarifas</div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Equipos (modelo · cantidad · precio mensual)</label>
          <div id="weLineas">${lineas.map(l => this._lineaModeloPre('wem', true, l)).join('')}</div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('weLineas').insertAdjacentHTML('beforeend', Centro._lineaModeloPre('wem', true)); Centro._wePreview()">+ Agregar otro modelo</button></div>
        <div class="form-field" style="margin-bottom:10px;">
          <label class="form-label">Otros conceptos (cargos del catálogo — únicos o mensuales)</label>
          <div id="weCargos">${(c.cargos || []).map(x => this._cargoLineaHtml(x)).join('')}</div>
          <button class="btn btn-ghost cg-act"
            onclick="document.getElementById('weCargos').insertAdjacentHTML('beforeend', Centro._cargoLineaHtml()); Centro._wePreview()">+ Agregar cargo</button></div>
        <label class="cg-toggle">
          <input type="checkbox" id="weItbms" ${c.itbms_aplica !== false ? 'checked' : ''} onchange="Centro._wePreview()">
          Aplica ITBMS${this.cliente?.itbms_exento === true ? ' <span style="color:var(--fg-4);">(cliente exento)</span>' : ''}
        </label>
        <div id="weTot" class="ds-card" style="padding:10px 14px; max-width:380px; margin-top:10px;"></div>
      </div>

      <div class="cg-paso">
        <div class="cg-paso-t"><span class="n">3</span> Observaciones <span class="hint">opcional</span></div>
        <textarea class="form-input" id="weObs" rows="2" style="resize:vertical;" aria-label="Observaciones">${this.esc(c.observaciones || '')}</textarea>
      </div>
      </div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="weGuardar" onclick="Centro.guardarContratoEditado()">Guardar cambios</button>`,
    });
    this._wePlan = plan;
    this._wePreview();
  },

  // Modalidad derivada del plan por serial — misma regla que el wizard
  // (TransicionPlan.derivarModalidad); aquí solo se MUESTRA.
  _weModalidadDerivada(lineas) {
    if (!this._wePlan || !window.TransicionPlan) return null;
    return TransicionPlan.derivarModalidad(this._wePlan, lineas || []);
  },

  _wePreview() {
    const cont = document.getElementById('weTot');
    if (!cont) return;
    const lineas = this._lineasModelo('wem');
    const t = this._totAumento(lineas, this._aumCargos(),
      document.getElementById('weItbms')?.checked !== false);
    cont.innerHTML = this._tarifarioHtml(t);

    const m = document.getElementById('weModalidad');
    if (m) {
      const d = this._weModalidadDerivada(lineas);
      m.innerHTML = d
        ? `<b>${d.sin_equipo ? 'Renovación sin equipo' : 'Renovación con equipo'}</b> — derivado del plan por serial:
           ${d.continuan} continúa${d.continuan === 1 ? '' : 'n'}${d.reemplazos ? ` · ${d.reemplazos} reemplazo${d.reemplazos === 1 ? '' : 's'}` : ''}${d.nuevos ? ` · ${d.nuevos} nuevo${d.nuevos === 1 ? '' : 's'}` : ''}
           · refurbished: ${d.refurbished ? `sí (${d.refurbished_n})` : 'no'}.
           Los seriales se corrigen en «Seriales de la cuenta».`
        : 'La modalidad de la renovación sale del plan por serial de la cuenta.';
    }
  },

  async guardarContratoEditado() {
    if (this._weGuardando) return;
    const c = this._weC;
    if (!c) return;

    // Segundo candado: el criterio se re-evalúa contra el contrato en vivo.
    // Entre abrir el modal y guardar, alguien pudo mandarle el enlace de firma
    // o activarlo.
    const fresco = await ContratosService.getContrato(c.id);
    const ed = ContratoEdicion.puedeEditarse(fresco);
    if (!ed.ok) { Toast.show(ed.texto, 'bad'); this._cerrarModal(); await this.abrir(this.cliente.id, { push: false }); return; }

    const lineas = this._lineasModelo('wem');
    if (!lineas.length) { Toast.show('⚠️ El contrato necesita al menos una línea de equipos', 'warn'); return; }
    if (this._lineasSinModalidad(lineas)) { Toast.show(`⚠️ ${this.MSG_SIN_MODALIDAD}`, 'warn'); return; }

    // Se valida ANTES de redondear: el Math.max(1, …) convertía una duración
    // vacía en "1 mes" sin avisar, en un documento legal (auditoría UX
    // 2026-09-28, P0 #13 — el P0 #12 de agosto, reaparecido al editar).
    const durRaw = Number(document.getElementById('weMeses')?.value || 0);
    if (!(durRaw > 0)) { Toast.show('⚠️ Indica la duración del contrato (mayor que cero)', 'warn'); document.getElementById('weMeses')?.focus(); return; }
    const durN = Math.max(1, durRaw);
    const durUnidad = document.getElementById('weDurUnidad')?.value === 'dias' ? 'dias' : 'meses';
    const meses = durUnidad === 'dias' ? Math.max(1, Math.round(durN / 30)) : durN;

    const tipo = document.getElementById('weTipo')?.value || c.codigo_tipo || '';
    const tipoNombre = this.TIPOS_CONTRATO[tipo] || c.tipo_contrato || tipo;
    const itbmsAplica = document.getElementById('weItbms')?.checked !== false;
    const cargos = this._aumCargos();
    const t = ContratoTarifario.totales(lineas, cargos, itbmsAplica);

    // Modalidad de la renovación: con plan por serial se DERIVA; sin plan se
    // conserva lo que el contrato ya decía (aquí no se pregunta).
    const esRenov = c.accion === 'Renovación';
    const d = esRenov ? this._weModalidadDerivada(lineas) : null;
    const sinEquipo = esRenov ? (d ? d.sin_equipo : !!c.renovacion_sin_equipo) : false;
    const refurb = esRenov ? (d ? d.refurbished : !!c.renovacion_refurbished_componentes) : false;

    // La duración, en la MISMA forma en que se va a guardar. La página vieja
    // mandaba solo el string a requiereReaprobacion y dejaba fuera
    // duracion_meses/duracion_dias: como el comparador mira los tres, un
    // contrato del Centro (que sí trae duracion_meses) SIEMPRE salía con
    // "cambió la duración" — y corregir una observación mandaba el contrato de
    // vuelta a aprobación con correo a ventas. Aquí se comparan iguales.
    const durCampos = {
      duracion: durUnidad === 'dias' ? `${durN} día${durN === 1 ? '' : 's'}` : `${durN} meses`,
      duracion_meses: meses,
      ...(durUnidad === 'dias' ? { duracion_dias: durN } : {}),
    };

    // ¿Vuelve a aprobación? Misma pregunta y mismo dominio que la página vieja.
    const re = (ContratoEdicion.aplicaReaprobacion(fresco) && ContratoTarifario.requiereReaprobacion)
      ? ContratoTarifario.requiereReaprobacion(fresco, { equipos: lineas, cargos, ...durCampos, itbms_aplica: itbmsAplica })
      : { requiere: false, cambios: [] };

    this._weGuardando = true;
    const btn = document.getElementById('weGuardar');
    if (btn) btn.disabled = true;
    try {
      await ContratosService.updateContrato(c.id, {
        ...(re.requiere ? {
          estado: 'pendiente_aprobacion',
          reaprobacion: {
            motivo: `Edición tras aprobar: ${re.cambios.join(', ')}`,
            at: new Date(),
            por_uid: this.uid || null,
            aprobado_antes_por_uid: fresco.aprobado_por_uid || null,
            fecha_aprobacion_anterior: fresco.fecha_aprobacion || null,
            total_mensual_anterior: Number(fresco.total_mensual || 0),
          },
        } : {}),
        codigo_tipo: tipo,
        tipo_contrato: tipoNombre,
        renovacion_sin_equipo: sinEquipo,
        renovacion_refurbished_componentes: refurb,
        renovacion_modalidad: esRenov ? (sinEquipo ? 'Renovación sin equipo' : 'Renovación con equipo') : '',
        ...durCampos,
        observaciones: (document.getElementById('weObs')?.value || '').trim(),
        equipos: lineas.map(l => ({
          modelo_id: l.modelo_id, modelo: l.modelo, descripcion: 'Equipos de Comunicación',
          cantidad: l.cantidad, precio: l.precio, modalidad: l.modalidad,
        })),
        total_equipos: lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0),
        cargos,
        subtotal_equipos: t.equiposSub,
        cargos_recurrente: t.cargosRec,
        cargos_unico: t.cargosUni,
        subtotal: t.subtotal,
        itbms_aplica: t.itbmsAplica,
        itbms_porcentaje: t.itbmsPorc,
        itbms_monto: t.itbmsMonto,
        total_con_itbms: t.totalConITBMS,
        total: t.totalConITBMS,
        total_mensual: t.totalConITBMS,
        primer_pago: t.primerPago,
        fecha_modificacion: new Date(),
      });

      if (re.requiere) {
        // Aviso al aprobador — mismo buzón y mismo CTA que la página vieja.
        try {
          const filas = lineas.map(l => `<li>${this.esc(l.modelo)} – ${l.cantidad} × $${Number(l.precio || 0).toFixed(2)}</li>`).join('');
          await firebase.firestore().collection('mail_queue').add({
            to: 'ventas@cecomunica.com',
            cc: this.email || null,
            subject: `Contrato ${fresco.contrato_id || c.id} editado tras aprobar — requiere nueva aprobación`,
            preheader: `${fresco.cliente_nombre || ''}: cambió ${re.cambios.join(', ')}`,
            bodyContent: `
              <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Contrato editado después de aprobado</h2>
              <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
                El contrato <b>${this.esc(fresco.contrato_id || c.id)}</b> de <b>${this.esc(fresco.cliente_nombre || '—')}</b>
                ya estaba aprobado y se editó: cambió <b>${this.esc(re.cambios.join(', '))}</b>.
                Volvió a <b>pendiente de aprobación</b>. Mensual anterior: $${Number(fresco.total_mensual || 0).toFixed(2)} →
                nuevo: <b>$${Number(t.totalConITBMS || 0).toFixed(2)}</b>.</p>
              <ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${filas}</ul>`,
            ctaUrl: `${location.origin}/clientes/centro.html?id=${encodeURIComponent(fresco.cliente_id || '')}`,
            ctaLabel: 'Revisar y aprobar en el Centro',
            meta: { source: 'centro-editar-contrato-reaprobacion', contrato_id: fresco.contrato_id || c.id, created_at: firebase.firestore.FieldValue.serverTimestamp() },
            status: 'queued',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
        } catch (e) { console.warn('No se pudo encolar el aviso de reaprobación:', e); }
      }

      this._cerrarModal();
      Toast.show(re.requiere
        ? 'Cambios guardados — el contrato vuelve a pendiente de aprobación (se avisó a ventas)'
        : 'Cambios guardados', re.requiere ? 'warn' : 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo guardar: ' + ((e && e.message) || e), 'bad');
    } finally {
      this._weGuardando = false;
      const b = document.getElementById('weGuardar');
      if (b) b.disabled = false;
    }
  },
});
