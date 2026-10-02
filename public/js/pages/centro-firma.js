// @ts-nocheck
// Centro de gestión de clientes — Firma digital del contrato (2026-08-28).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Firma digital del contrato (2026-08-28) ═════════ */

  // Genera (o reusa) el enlace portador de firma y lo muestra: copiar para
  // WhatsApp o enviar por correo. El enlace se puede REENVIAR — quien debe
  // firmar es el representante legal, pero puede llegarle por el contacto.
  async enviarFirma(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || c.estado !== 'aprobado') { Toast.show('Solo contratos APROBADOS se envían a firma', 'warn'); return; }
    // Candado, no solo el botón escondido: un reemplazo no se manda a firmar.
    if (!ContratoFirma.lleva(c)) { Toast.show(`Este contrato no lleva firma: ${ContratoFirma.porQue(c)}`, 'warn'); return; }
    let sid = (c.firma_solicitud_id && c.firma_solicitud_estado === 'pendiente') ? c.firma_solicitud_id : null;
    // El enlace congela el Anexo A con lo que haya en el pool: sin seriales
    // asignados el cliente firmaría un contrato sin equipos (auditoría UX
    // 2026-09-28, P0 #11). Un enlace ya enviado se deja ver/reenviar.
    if (!sid && !this._serialesListos(c)) {
      Toast.show('Bodega todavía no asignó los seriales; el anexo saldría vacío. Se habilita al quedar asignados en Almacén · Asignar.', 'warn', 7000);
      return;
    }
    this._cerrarModal();
    try {
      if (!sid) {
        const t = (window.ContractTotals?.fromDoc) ? ContractTotals.fromDoc(c) : {};
        // Snapshot para que el firmante VEA el contrato completo en /firmar/
        // (pedido 2026-08-28): la página pública no puede leer contratos ni el
        // pool, así que el enlace carga su propia copia (partes + Anexo A).
        const enCampo = await (window.EquiposPoolService?.listarPorContrato
          ? EquiposPoolService.listarPorContrato(c.id).catch(() => []) : []);
        const rucdv = (c.cliente_rucdv && String(c.cliente_rucdv).trim())
          || ((c.cliente_ruc || this.cliente.ruc || '') + (c.cliente_dv || this.cliente.dv ? ` DV ${c.cliente_dv || this.cliente.dv}` : '')).trim();
        const ref = await firebase.firestore().collection('firma_solicitudes').add({
          estado: 'pendiente',
          contrato_doc_id: c.id,
          contrato_id: c.contrato_id || c.id,
          cliente_id: c.cliente_id || this.cliente.id,
          cliente_nombre: c.cliente_nombre || this.cliente.nombre || '',
          representante: {
            nombre: c.representante || this.cliente.representante || '',
            cedula: c.representante_cedula || this.cliente.representante_cedula || '',
            doc_tipo: c.representante_doc_tipo || this.cliente.representante_doc_tipo || '',
          },
          // El TEXTO ÍNTEGRO queda CONGELADO en la solicitud (2026-08-31,
          // reclamo de Alberto: la firma no puede caer sobre un texto que el
          // cliente no vio — ni cambiar después de firmado). /firmar/ muestra
          // ESTA copia y el documento firmado se reconstruye desde aquí.
          documento: {
            cliente_rucdv: rucdv || '',
            observaciones: c.observaciones || '',
            // Cada serial con SU TARIFA (2026-09-02): línea del contrato por
            // modelo+modalidad + servicios amarrados al serial. Lo que el
            // cliente firma es exactamente esto — congelado.
            anexo: (enCampo || []).slice(0, 300).map(u => {
              // Línea por FAMILIA de modelo (PNC360S ≡ PNC360S-R) y modalidad
              // — antes era exacta y dejaba radios "sin tarifa" en el anexo
              // que firma el cliente (caso Chino Panameño, 2026-09-07).
              const linea = this._lineaDeEquipo(u, c);
              let extras = 0;
              (c.cargos || []).forEach(cg => {
                if (cg.recurrente && Array.isArray(cg.seriales) && cg.seriales.includes(u.serial || u.id)) extras += Number(cg.monto || 0);
              });
              return {
                serial: u.serial || u.id, modelo: u.modelo_label || '',
                propiedad: u.propiedad === 'cliente' ? 'Del cliente' : 'C COMUNICA',
                ...(linea || extras ? { tarifa_mensual: Number(((linea ? Number(linea.precio || 0) : 0) + extras).toFixed(2)) } : {}),
              };
            }),
            ...(window.ContratoV2Texto ? {
              texto_version: ContratoV2Texto.version,
              inventario_html: ContratoV2Texto.inventarioHtml,
              vigencia_html: ContratoV2Texto.vigenciaHtml(
                `<b>${this.esc(this._durTxt(c) || '____ meses')}</b>`),
              clausulas_html: ContratoV2Texto.clausulasHtml,
            } : {}),
          },
          declaracion: `Declaro que he leído el contrato ${c.contrato_id || c.id} COMPLETO en esta página (secciones 1–4 y cláusulas 5–18) y acepto sus términos y condiciones en nombre de ${c.cliente_nombre || this.cliente.nombre || 'la empresa'}.`,
          resumen: {
            tipo_contrato: c.tipo_contrato || '', duracion: this._durTxt(c),
            equipos: (c.equipos || []).map(l => ({ modelo: l.modelo || '', cantidad: Number(l.cantidad || 0), precio: Number(l.precio || 0), ...(l.modalidad ? { modalidad: l.modalidad } : {}) })),
            cargos: (c.cargos || []).map(x => ({ concepto: x.concepto || '', cantidad: Number(x.cantidad || 1), monto: Number(x.monto || 0), recurrente: !!x.recurrente })),
            total_mensual: Number(t.totalMensual || c.total_mensual || 0),
            primer_pago: Number(t.primerPago || c.primer_pago || 0),
            itbms_label: t.itbmsLabel || '',
          },
          creado_por_uid: this.uid,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        sid = ref.id;
        // firma_solicitud_creada_at: desde cuándo espera el enlace — lo leen
        // la señal del home, el paso "Firma del cliente" y el cron de los 45 días.
        await ContratosService.updateContrato(c.id, {
          firma_solicitud_id: sid, firma_solicitud_estado: 'pendiente',
          firma_solicitud_creada_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        c.firma_solicitud_id = sid; c.firma_solicitud_estado = 'pendiente'; c.firma_solicitud_creada_at = new Date();
      }
      const url = `${location.origin}/firmar/?s=${sid}`;
      const rep = c.representante || this.cliente.representante || '—';
      this._abrirModal(`
        <h3 style="margin:0 0 6px;">Enviar para firma — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span></h3>
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          El cliente abre este enlace en su celular, lee el <b>contrato completo</b> (queda una copia
          congelada del texto en la solicitud) y <b>firma con el dedo</b> — la aceptación solo se
          habilita después de abrir el documento.
          Debe firmarlo <b>${this.esc(rep)}</b> (representante legal) — el enlace se puede <b>reenviar</b>
          por WhatsApp si te lo recibe otro contacto. Si firma otra persona, la firma queda registrada
          y administración valida al firmante antes de activar. Al coincidir, el contrato se <b>activa solo</b>.</p>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input class="form-input" id="wfLink" value="${this.esc(url)}" readonly style="flex:1; font-size:12.5px;">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('wfLink').value).then(()=>Toast.show('Enlace copiado — pégalo en WhatsApp','ok'))">Copiar</button>
        </div>
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="form-field" style="margin:0; flex:1; min-width:220px;">
            <label class="form-label">Enviar por correo a</label>
            <input class="form-input" id="wfEmail" type="email" value="${this.esc(this.cliente.representante_email || this.cliente.email || '')}" placeholder="correo del cliente"></div>
          <button class="btn btn-ghost" onclick="Centro._enviarFirmaCorreo('${this.esc(c.id)}','${this.esc(sid)}')">Enviar correo</button>
        </div>
        <p style="margin:12px 0 0; font-size:12.5px; color:var(--fg-3);">
          ¿Prefieres <b>papel</b>? Imprime el <b>Documento completo</b> (menú ⋯ del contrato), recoge la firma y
          sube el firmado desde ese mismo menú: eso también activa el contrato. En la tablet de recepción no se firman contratos.</p>
        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>
        </div>`);
    } catch (e) { console.error(e); Toast.show('No se pudo generar el enlace de firma', 'bad'); }
  },

  // Reactivar un contrato DORMIDO (decisión 7 de Alberto, 1-oct-2026): el
  // cron lo durmió a los 45 días sin firma y caducó su enlace. El vendedor (o
  // administración) lo despierta y en el mismo acto genera un enlace nuevo —
  // la solicitud vieja sigue caducada, con su rastro.
  async reactivarContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.dormido(c)) { Toast.show('Este contrato no está dormido', 'warn'); return; }
    if (![ROLES.ADMIN, 'admin', ROLES.GERENTE, ROLES.VENDEDOR].includes(this.rol)) {
      Toast.show('Lo reactiva el vendedor o administración', 'warn'); return;
    }
    this._cerrarModal();
    const dias = c.dormido_dias ? `${c.dormido_dias} días sin firma` : 'más de 45 días sin firma';
    const ok = await Modal.confirm({
      title: 'Reactivar la solicitud de firma', confirmLabel: 'Reactivar y generar enlace',
      message: `El contrato <b class="cg-mono">${this.esc(c.contrato_id || c.id)}</b> quedó dormido por ${this.esc(dias)}.
        Vuelve a ser un trámite vivo (cuenta otra vez en "Contratos por firmar") y se genera un
        <b>enlace de firma nuevo</b>; el anterior sigue caducado. Si en 45 días no firma, se vuelve a dormir.`,
    });
    if (!ok) { this.abrirGestion(`ct-${c.id}`); return; }
    try {
      await ContratosService.updateContrato(c.id, {
        dormido: false,
        dormido_reactivado_at: firebase.firestore.FieldValue.serverTimestamp(),
        dormido_reactivado_por_uid: this.uid || null,
      });
      c.dormido = false; c.dormido_reactivado_at = new Date();
      Toast.show('Contrato reactivado — ahora genera el enlace', 'ok');
    } catch (e) { console.error(e); Toast.show('No se pudo reactivar: ' + (e.message || e), 'bad'); return; }
    this.pintarContratos?.(); this.pintarGestiones?.(); this.pintarSenales?.(); this.armarMenu?.();
    await this.enviarFirma(c.id);
  },

  async _enviarFirmaCorreo(contratoDocId, sid) {
    const email = (document.getElementById('wfEmail')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Toast.show('Escribe un correo válido', 'warn'); return; }
    const c = this.contratos.find(x => x.id === contratoDocId);
    const url = `${location.origin}/firmar/?s=${sid}`;
    try {
      await MailService.enqueue({
        to: email,
        cc: firebase.auth().currentUser?.email || null,
        subject: `Contrato ${c?.contrato_id || ''} listo para su firma — C Comunica`,
        preheader: 'Firme su contrato desde el celular en un minuto',
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Su contrato está listo para firma</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Estimado cliente: el contrato <b>${FMT.esc(c?.contrato_id || '')}</b> de
            <b>${FMT.esc(c?.cliente_nombre || '')}</b> está listo. Ábralo con el botón, lea el contrato
            completo y firme con el dedo desde su celular. Debe firmarlo el <b>representante legal</b>
            (${FMT.esc(c?.representante || '—')}); si lo recibe otra persona, puede reenviarle este correo.</p>`,
        ctaUrl: url,
        ctaLabel: 'Revisar y firmar el contrato',
        meta: { created_at: firebase.firestore.FieldValue.serverTimestamp(), created_by: this.uid, source: 'firma-contrato', firma_solicitud: sid },
        status: 'queued',
      });
      Toast.show(`Enlace de firma enviado a ${email}`, 'ok');
      // A quién y cuándo: lo pinta el paso "Firma del cliente" (P5). Best-effort.
      try {
        await ContratosService.updateContrato(contratoDocId, { firma_enviada_a: email, firma_enviada_at: firebase.firestore.FieldValue.serverTimestamp() });
        if (c) { c.firma_enviada_a = email; c.firma_enviada_at = new Date(); }
      } catch (_) { /* el correo ya salió */ }
    } catch (e) { console.error(e); Toast.show('No se pudo enviar el correo', 'bad'); }
  },

  // Ventas acepta a un firmante distinto del representante registrado.
  async aceptarFirmante(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c?.firma_solicitud_id) { Toast.show('El contrato no tiene solicitud de firma vinculada', 'warn'); return; }
    this._abrirValidacionFirma(c.firma_solicitud_id, c.contrato_id || c.id);
  },
  // Igual pero para el ANEXO de aumento (la solicitud vive en la gestión).
  aceptarFirmanteGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g?.firma_solicitud_id) { Toast.show('La gestión no tiene solicitud de firma vinculada', 'warn'); return; }
    this._abrirValidacionFirma(g.firma_solicitud_id, gid);
  },
  // "Ver la firma" (2026-09-24, pedido de Alberto): la misma ventana en solo
  // lectura. Un anexo digital cuyo firmante coincidía se aplicaba solo y el
  // trazo quedaba guardado en la solicitud sin ninguna pantalla que lo mostrara.
  verFirmaGestion(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    const sid = g?.anexo_firma_digital?.solicitud_id || g?.firma_solicitud_id;
    if (!sid) { Toast.show('La gestión no tiene firma digital registrada', 'warn'); return; }
    this._abrirValidacionFirma(sid, gid, { soloLectura: true });
  },
  verFirmaContrato(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c?.firma_solicitud_id) { Toast.show('El contrato no tiene solicitud de firma vinculada', 'warn'); return; }
    this._abrirValidacionFirma(c.firma_solicitud_id, c.contrato_id || c.id, { soloLectura: true });
  },
  async _abrirValidacionFirma(sid, etiqueta, { soloLectura = false } = {}) {
    this._cerrarModal();
    try {
      const snap = await firebase.firestore().collection('firma_solicitudes').doc(sid).get();
      const s = snap.exists ? snap.data() : null;
      if (soloLectura) {
        if (!s?.firma) { Toast.show('La solicitud todavía no tiene firma', 'warn'); return; }
      } else if (!s || s.estado !== 'validacion') { Toast.show('La solicitud no está pendiente de validación', 'warn'); return; }
      const f = s.firma || {};
      // La evidencia de identidad la sirve un callable solo admin/gerente
      // (getFirmaIdentidadUrl): a los demás ni se les pide.
      const veIdentidad = [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol);
      // El trazo lo escribe el firmante desde /firmar/ (página pública) y va
      // crudo al src: solo se pinta si es de verdad un PNG en base64.
      const pngOk = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(f.png || ''));
      // Poder / Registro Público / acta que sube quien firma sin ser el
      // representante (obligatorio en /firmar/ desde el 2026-09-24).
      const hayAut = !!f.autorizacion_path;
      const esPdfAut = f.autorizacion_content_type === 'application/pdf';
      const labelAut = (t) => window.Firmante?.labelAutorizacion ? Firmante.labelAutorizacion(t) : 'Documento de autorización';
      // El veredicto lo estampó onFirmaContrato (lib/firmas.firmanteCoincide):
      // se lee, no se recalcula aquí con otra regla.
      const veredicto = s.firmante_coincide === true
        ? 'El sistema lo comparó con el representante legal registrado: <b>coincide</b>.'
        // Tras aceptar, el trigger la lleva a 'activado': la marca que queda es validado_at.
        : (s.estado === 'aceptado' || s.validado_at)
        ? `El firmante <b>no coincidía</b> con el representante registrado y administración lo aceptó el ${this.esc(this._histCuando(s.validado_at))}.`
        : s.estado === 'validacion'
        ? '<b>El firmante no coincide</b> con el representante registrado — está pendiente de validar (<b>Acciones › Aceptar al firmante</b>).'
        : 'Compara el nombre y la cédula con el representante legal registrado.';
      this._abrirModal(`
        <h3 style="margin:0 0 6px;">${soloLectura ? 'Firma del cliente' : 'Validar firmante'} — <span class="cg-mono">${this.esc(etiqueta)}</span></h3>
        ${soloLectura
          ? `<p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
              Firmado el ${this.esc(this._histCuando(f.firmado_at))}. ${veredicto}</p>`
          : `<p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          La firma quedó registrada con su rastro completo, pero el firmante no coincide con el
          representante legal registrado. Al aceptar, el documento <b>se aplica</b> (contrato → activo;
          anexo → las líneas entran y bodega asigna).</p>`}
        <table class="cg-tabla" style="margin-bottom:10px;"><thead><tr><th></th><th>Registrado</th><th>Firmó</th></tr></thead><tbody>
          <tr><td>Nombre</td><td>${this.esc(s.representante?.nombre || '—')}</td><td><b>${this.esc(f.nombre || '—')}</b></td></tr>
          <tr><td>${f.doc_tipo === 'pasaporte' ? 'Cédula / pasaporte' : 'Cédula'}</td><td class="cg-mono">${this.esc(s.representante?.cedula || '—')}</td><td class="cg-mono"><b>${this.esc(f.cedula || '—')}</b></td></tr>
          <tr><td>Cargo</td><td>representante legal</td><td>${this.esc(f.cargo || '—')}</td></tr>
        </tbody></table>
        ${pngOk ? `<div style="border:1px solid var(--border-subtle); border-radius:10px; padding:6px; margin-bottom:10px; background:#fff;">
          <img src="${f.png}" alt="firma" style="max-height:110px; display:block; margin:0 auto;"></div>`
          : '<p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">La solicitud no trae el trazo de la firma.</p>'}
        ${f.cedula_path && !veIdentidad
          ? '<p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">La foto de la cédula y la selfie del firmante las ven administración y gerencia.</p>'
          : f.cedula_path ? `
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1; text-align:center;"><div class="form-label" style="margin-bottom:4px;">Cédula del firmante</div>
            <img id="wvCed" style="max-width:100%; max-height:170px; border:1px solid var(--border-subtle); border-radius:8px;" alt="cargando…"></div>
          <div style="flex:1; text-align:center;"><div class="form-label" style="margin-bottom:4px;">Selfie</div>
            <img id="wvSelfie" style="max-width:100%; max-height:170px; border:1px solid var(--border-subtle); border-radius:8px;" alt="cargando…"></div>
        </div>
        <p style="font-size:11px; color:var(--fg-4); margin:0 0 10px;">Evidencia de identidad — dato sensible (Ley 81):
          cada vista queda auditada; los enlaces expiran en 5 minutos.</p>`
        : '<p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">Sin evidencia de identidad adjunta (firma anterior a la actualización).</p>'}
        ${hayAut || s.firmante_coincide !== true ? `
        <div class="form-label" style="margin:4px 0 4px;">Documento que lo autoriza a firmar</div>
        ${!hayAut
          ? `<div class="cg-senal warn" style="margin:0 0 10px;"><span>El firmante <b>no subió</b> documento de autorización
              (firma anterior al 2026-09-24). Revisa el expediente del cliente${soloLectura ? '' : '; si no hay respaldo, el motivo es obligatorio'}.</span></div>`
          : !veIdentidad
          ? `<p style="font-size:12px; color:var(--fg-4); margin:0 0 10px;">Subió: <b>${this.esc(labelAut(f.autorizacion_tipo))}</b> — lo ven administración y gerencia.</p>`
          : `<p style="font-size:13px; margin:0 0 6px;">Subió: <b>${this.esc(labelAut(f.autorizacion_tipo))}</b>
              <button type="button" class="btn btn-ghost cg-act" onclick="Centro._abrirAutorizacion('${this.esc(sid)}', this)">Abrir el documento</button></p>
             ${esPdfAut ? '' : '<img id="wvAut" style="max-width:100%; max-height:260px; border:1px solid var(--border-subtle); border-radius:8px; display:block; margin:0 auto 10px;" alt="cargando…">'}`}` : ''}
        ${this._puedeVerDocs() && s.firmante_coincide !== true ? `
        <div class="form-label" style="margin:4px 0 4px;">Expediente del cliente</div>
        <div id="wvDocs" style="margin-bottom:10px;"><p style="font-size:12px; color:var(--fg-4); margin:0;">Cargando documentos…</p></div>` : ''}
        ${s.validacion_motivo ? `<p style="font-size:12.5px; margin:0 0 10px;"><b>Motivo de la aceptación:</b> ${this.esc(s.validacion_motivo)}</p>` : ''}
        ${soloLectura ? `
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>
        </div>` : `
        <label class="form-label" for="wfMotivo" style="margin:4px 0 4px;">Motivo de la aceptación${hayAut ? ' (opcional)' : ' — <b>obligatorio</b>: no hay documento que lo autorice'}</label>
        <textarea id="wfMotivo" class="form-input" rows="2" style="width:100%; margin-bottom:10px;"
          placeholder="${hayAut ? 'Ej.: el poder está vigente y lo faculta para firmar contratos' : 'Ej.: consta como presidente en el registro público del expediente'}"></textarea>
        <label class="cg-toggle" style="margin-bottom:12px;">
          <input type="checkbox" id="wfActualizar" checked>
          Actualizar la ficha del cliente con este representante (el directorio se corrige solo)
        </label>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
          <button class="btn btn-primary" onclick="Centro._aceptarFirmanteConfirmar('${this.esc(sid)}', ${hayAut})">Aceptar firmante y activar</button>
        </div>`}`);
      // Evidencia de identidad: URLs firmadas de 5 min vía callable (los
      // bytes viven con read:false — dato sensible, cada vista se audita).
      if (f.cedula_path && veIdentidad && firebase.functions) {
        const fn = firebase.functions().httpsCallable('getFirmaIdentidadUrl');
        [['cedula', 'wvCed'], ['selfie', 'wvSelfie']].forEach(([cual, imgId]) => {
          fn({ sid, cual }).then(r => {
            const img = document.getElementById(imgId);
            if (img) { if (r.data?.url) img.src = r.data.url; else img.alt = 'no disponible'; }
          }).catch((e) => {
            console.warn('[centro] evidencia no disponible:', e?.message || e);
            const img = document.getElementById(imgId);
            if (img) img.alt = 'no disponible';
          });
        });
      }
      if (hayAut && !esPdfAut && veIdentidad && firebase.functions) {
        firebase.functions().httpsCallable('getFirmaIdentidadUrl')({ sid, cual: 'autorizacion' }).then(r => {
          const img = document.getElementById('wvAut');
          if (img) { if (r.data?.url) img.src = r.data.url; else img.alt = 'no disponible'; }
        }).catch(() => { const img = document.getElementById('wvAut'); if (img) img.alt = 'no disponible'; });
      }
      if (document.getElementById('wvDocs')) this._pintarDocsValidacion(s.cliente_id || this.cliente?.id);
    } catch (e) { console.error(e); Toast.show('No se pudo cargar la solicitud de firma', 'bad'); }
  },
  // El expediente legal del cliente dentro de la ventana de validar: quien
  // acepta a un firmante ve de una vez si hay registro público o poder.
  async _pintarDocsValidacion(clienteId) {
    const cont = document.getElementById('wvDocs');
    if (!cont || !clienteId || !window.ClienteDocumentosService) { if (cont) cont.innerHTML = ''; return; }
    try {
      const docs = await ClienteDocumentosService.list(clienteId);
      if (!document.getElementById('wvDocs')) return;
      const urlSubir = `./ficha.html?id=${encodeURIComponent(clienteId)}&from=centro&seccion=documentos`;
      cont.innerHTML = docs.length
        ? `<table class="cg-tabla"><tbody>${docs.map(d => `<tr>
            <td>${this.esc(ClienteDocumentosService.labelFor(d.tipo))}</td>
            <td style="color:var(--fg-3); font-size:12px;">${this.esc(d.nombre_archivo || '')}</td>
            <td style="text-align:right;"><button type="button" class="btn btn-ghost cg-act" onclick="Centro.verDocumento('${this.esc(d.id)}', this)">Ver</button></td>
          </tr>`).join('')}</tbody></table>`
        : `<p style="font-size:12.5px; color:var(--fg-3); margin:0;">El cliente no tiene documentos en el expediente.
            <a href="${urlSubir}" target="_blank" rel="noopener">Cargar uno ›</a></p>`;
    } catch (e) {
      console.warn('[centro] expediente no disponible', e?.message || e);
      cont.innerHTML = '<p style="font-size:12px; color:var(--fg-4); margin:0;">No se pudo cargar el expediente.</p>';
    }
  },
  // Abre el documento de autorización (PDF o foto) en pestaña nueva. La
  // pestaña se abre con el CLIC y recibe la URL firmada después: abrirla ya
  // firmada la trataría como popup (mismo patrón que verDocumento).
  async _abrirAutorizacion(sid, btn) {
    const tab = window.open('about:blank', '_blank');
    if (tab) { try { tab.opener = null; } catch (_) {} }
    if (btn) btn.disabled = true;
    try {
      const r = await firebase.functions().httpsCallable('getFirmaIdentidadUrl')({ sid, cual: 'autorizacion' });
      if (!r.data?.url) throw new Error('El documento no está disponible.');
      if (tab) tab.location.href = r.data.url; else window.open(r.data.url, '_blank', 'noopener');
    } catch (e) {
      if (tab) tab.close();
      Toast.show(e?.message || 'No se pudo abrir el documento.', 'bad');
    } finally { if (btn) btn.disabled = false; }
  },

  // Enlace de firma digital para el ANEXO de aumento (pendiente_firma): la
  // misma página /firmar/ y el mismo trigger; al firmar (y coincidir o ser
  // validado) el anexo pasa solo a pendiente_bodega — cero papel, cero fotos.
  async enviarFirmaAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || g.estado !== 'pendiente_firma') { Toast.show('El anexo debe estar aprobado y pendiente de firma', 'warn'); return; }
    const a = g.aumento || {};
    this._cerrarModal();
    let sid = (g.firma_solicitud_id && g.firma_solicitud_estado === 'pendiente') ? g.firma_solicitud_id : null;
    try {
      if (!sid) {
        const t = a.totales || {};
        const ref = await firebase.firestore().collection('firma_solicitudes').add({
          estado: 'pendiente',
          tipo: 'anexo_aumento',
          gestion_id: gid,
          contrato_doc_id: a.contrato_doc_id || '',
          contrato_id: a.contrato_id || '',
          cliente_id: g.cliente_id,
          cliente_nombre: g.cliente_nombre || '',
          // Adenda a contrato en papel: la solicitud lo declara para que la
          // página de firma diga que el contrato marco está en papel.
          ...(a.contrato_papel && !a.contrato_doc_id ? { contrato_papel: true } : {}),
          titulo: a.es_ajuste
            ? `Anexo de ajuste de tarifa ${gid} — contrato ${a.contrato_id || ''}`
            : a.es_regularizacion
            ? `Anexo de regularización ${gid} — contrato ${a.contrato_id || ''}`
            : a.contrato_papel && !a.contrato_doc_id
            ? `Anexo de aumento ${gid} — contrato en papel ${a.contrato_id || ''}`
            : `Anexo de aumento ${gid} — contrato ${a.contrato_id || ''}`,
          declaracion: a.es_ajuste
            ? `Declaro que acepto ${[
                (a.cargos || []).length ? `los cargos del anexo ${gid} (${(a.cargos || []).map(c => `${c.concepto} $${Number(c.monto || 0).toFixed(2)}${c.recurrente ? '/mes' : ''} × ${c.cantidad}`).join('; ')})` : '',
                (a.ajustes_precio || []).length ? `el ajuste de tarifa de ${a.ajustes_precio.length} línea(s): ${a.ajustes_precio.map(x => `${x.modelo} de $${Number(x.precio_anterior).toFixed(2)} a $${Number(x.precio_nuevo).toFixed(2)}/mes`).join('; ')}` : '',
              ].filter(Boolean).join(' y ')} al contrato ${a.contrato_id || ''} en nombre de ${g.cliente_nombre || 'la empresa'}.`
            : a.es_regularizacion
            ? `Declaro que los equipos del anexo ${gid} (${(a.regulariza_seriales || []).map(s => s.serial).join(', ')}) están en poder de ${g.cliente_nombre || 'la empresa'} y acepto su incorporación al contrato ${a.contrato_id || ''} con las tarifas indicadas.`
            : `Declaro que he leído el anexo de aumento ${gid} al contrato ${a.contrato_id || ''} y acepto sus términos y condiciones en nombre de ${g.cliente_nombre || 'la empresa'}.`,
          representante: {
            nombre: this.cliente.representante || '',
            cedula: this.cliente.representante_cedula || '',
            doc_tipo: this.cliente.representante_doc_tipo || '',
          },
          ...(a.es_ajuste ? { es_ajuste: true,
            ...(Array.isArray(a.ajustes_precio) && a.ajustes_precio.length
              ? { ajustes_precio: a.ajustes_precio } : {}) } : {}),
          ...(a.es_regularizacion ? { es_regularizacion: true,
            // La modalidad viaja en el congelado (2026-09-09): el cliente que
            // firma tiene que ver de quién es cada radio que se le amarra.
            regulariza_seriales: (a.regulariza_seriales || []).map(s => ({
              serial: s.serial || '', modelo: s.modelo || '',
              ...(s.modalidad ? { modalidad: s.modalidad } : {}) })) } : {}),
          // Texto del anexo CONGELADO con su versión (misma regla que el
          // contrato: la firma cae sobre lo que el cliente leyó, inmutable) +
          // las cláusulas del marco que el anexo cita, para leerlas ahí mismo.
          ...(window.ContratoV2Texto ? { documento: {
            texto_version: ContratoV2Texto.version,
            intro_html: ContratoV2Texto.anexoIntro(a.es_regularizacion === true),
            marco_html: ContratoV2Texto.anexoMarco,
            clausulas_html: ContratoV2Texto.clausulasHtml,
          } } : {}),
          resumen: {
            tipo_contrato: a.es_regularizacion ? 'Anexo de regularización' : 'Anexo de aumento',
            duracion: a.es_ajuste
              ? `Rige con el contrato${a.duracion_meses ? ` (${a.duracion_meses} meses)` : ''}`
              : a.es_regularizacion
              ? `${a.duracion_meses || '?'} meses (desde la firma — equipos ya entregados)`
              : `${a.duracion_meses || '?'} meses (tramo del anexo, desde la entrega)`,
            equipos: (a.lineas || []).map(l => ({ modelo: l.modelo || '', cantidad: Number(l.cantidad || 0), precio: Number(l.precio || 0), ...(l.modalidad ? { modalidad: l.modalidad } : {}) })),
            cargos: (a.cargos || []).map(x => ({ concepto: x.concepto || '', cantidad: Number(x.cantidad || 1), monto: Number(x.monto || 0), recurrente: !!x.recurrente,
              ...(Array.isArray(x.seriales) && x.seriales.length ? { seriales: x.seriales } : {}) })),
            total_mensual: Number(t.total_mensual || 0),
            primer_pago: Number(t.primer_pago || 0),
            itbms_label: t.itbms_aplica ? `ITBMS (${Math.round((t.itbms_porcentaje || 0.07) * 100)}%)` : 'ITBMS EXENTO',
          },
          creado_por_uid: this.uid,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        sid = ref.id;
        await firebase.firestore().collection('gestiones').doc(gid).update({
          firma_solicitud_id: sid, firma_solicitud_estado: 'pendiente',
        });
        g.firma_solicitud_id = sid; g.firma_solicitud_estado = 'pendiente';
      }
      const url = `${location.origin}/firmar/?s=${sid}`;
      const rep = this.cliente.representante || '—';
      this._abrirModal(`
        <h3 style="margin:0 0 6px;">Enviar anexo para firma — <span class="cg-mono">${this.esc(gid)}</span></h3>
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          El cliente abre el enlace en su celular, revisa el anexo (${this.esc(this._resumenAnexoTxt(a))})
          y <b>firma con el dedo</b>. Debe firmarlo <b>${this.esc(rep)}</b> (representante legal) — el enlace se puede
          <b>reenviar</b>. Al firmar, las líneas entran al contrato y bodega recibe la asignación, todo solo.</p>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input class="form-input" id="wfLink" value="${this.esc(url)}" readonly style="flex:1; font-size:12.5px;">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('wfLink').value).then(()=>Toast.show('Enlace copiado — pégalo en WhatsApp','ok'))">Copiar</button>
        </div>
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="form-field" style="margin:0; flex:1; min-width:220px;">
            <label class="form-label">Enviar por correo a</label>
            <input class="form-input" id="wfEmail" type="email" value="${this.esc(this.cliente.representante_email || this.cliente.email || '')}" placeholder="correo del cliente"></div>
          <button class="btn btn-ghost" onclick="Centro._enviarFirmaAnexoCorreo('${this.esc(gid)}','${this.esc(sid)}')">Enviar correo</button>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>
        </div>`);
    } catch (e) { console.error(e); Toast.show('No se pudo generar el enlace de firma del anexo', 'bad'); }
  },

  // Resumen en texto de lo que trae el anexo (líneas + cargos + tarifas
  // renegociadas) — para correos y modales: nunca "(vacío)" en un ajuste.
  _resumenAnexoTxt(a = {}) {
    return [
      ...(a.lineas || []).map(l => `${l.cantidad} × ${l.modelo}`),
      ...(a.cargos || []).map(c => `${c.cantidad} × ${c.concepto} $${Number(c.monto || 0).toFixed(2)}${c.recurrente ? '/mes' : ''}`),
      ...(a.ajustes_precio || []).map(x => `${x.modelo} $${Number(x.precio_anterior).toFixed(2)}→$${Number(x.precio_nuevo).toFixed(2)}`),
    ].join(', ') || '—';
  },
  async _enviarFirmaAnexoCorreo(gid, sid) {
    const email = (document.getElementById('wfEmail')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Toast.show('Escribe un correo válido', 'warn'); return; }
    const g = (this.gestiones || []).find(x => x.id === gid);
    const a = g?.aumento || {};
    const url = `${location.origin}/firmar/?s=${sid}`;
    try {
      await MailService.enqueue({
        to: email,
        cc: firebase.auth().currentUser?.email || null,
        subject: `Anexo de aumento al contrato ${a.contrato_id || ''} listo para su firma — C Comunica`,
        preheader: 'Firme el anexo desde su celular en un minuto',
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Anexo de aumento listo para firma</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Estimado cliente: el anexo al contrato <b>${FMT.esc(a.contrato_id || '')}</b> de
            <b>${FMT.esc(g?.cliente_nombre || '')}</b> está listo
            (${FMT.esc(this._resumenAnexoTxt(a))}).
            Ábralo con el botón, revise el detalle y firme con el dedo desde su celular. Debe firmarlo el
            <b>representante legal</b>; si lo recibe otra persona, puede reenviarle este correo.</p>`,
        ctaUrl: url,
        ctaLabel: 'Revisar y firmar el anexo',
        meta: { created_at: firebase.firestore.FieldValue.serverTimestamp(), created_by: this.uid, source: 'firma-anexo', firma_solicitud: sid },
        status: 'queued',
      });
      Toast.show(`Enlace de firma del anexo enviado a ${email}`, 'ok');
    } catch (e) { console.error(e); Toast.show('No se pudo enviar el correo', 'bad'); }
  },

  async _aceptarFirmanteConfirmar(sid, hayAut = false) {
    // Sin documento que autorice al firmante, solo con motivo escrito (el
    // mismo candado vive en rules: validacion_motivo >= 10 caracteres).
    const motivo = (document.getElementById('wfMotivo')?.value || '').trim();
    if (!hayAut && motivo.length < 10) {
      Toast.show('Escribe por qué aceptas al firmante sin documento que lo autorice', 'warn');
      document.getElementById('wfMotivo')?.focus();
      return;
    }
    try {
      await firebase.firestore().collection('firma_solicitudes').doc(sid).update({
        estado: 'aceptado',
        validado_por_uid: this.uid,
        validado_at: firebase.firestore.Timestamp.now(),
        actualizar_ficha: document.getElementById('wfActualizar')?.checked === true,
        ...(motivo ? { validacion_motivo: motivo.slice(0, 500) } : {}),
      });
      this._cerrarModal();
      Toast.show('Firmante aceptado — el contrato se activa en segundos', 'ok');
      setTimeout(() => this.abrir(this.cliente.id, { push: false }), 1800);
    } catch (e) { console.error(e); Toast.show('No se pudo aceptar al firmante', 'bad'); }
  },

  pintarContratos() {
    const cont = document.getElementById('fContratos');
    if (!this.contratos.length) { cont.innerHTML = '<div class="cg-empty">Sin contratos registrados.</div>'; return; }
    // El overhang (caso SEPROSA, 2026-08-28) en dos capas: (1) lo NO operativo
    // (renovado/vencido/anulado) se pliega en "Histórico"; (2) de lo operativo,
    // los contratos MENORES — sin facturación y sin urgencia (REEMPs de 1 radio,
    // adiciones $0) — se pliegan en su propia línea. La función manda, no el
    // tamaño: un $0 que entra en ventana de vencimiento sube solo.
    // Los contratos EN TRÁMITE (pendiente de aprobación / aprobado sin firmar
    // reciente) NO van en esta tabla: decir "aprobado" aquí los hacía parecer
    // contratos andando (reclamo 2026-08-28). Viven en "Requiere tu acción" y
    // en Gestiones con su pipeline.
    // Solo los trámites NO activos salen de la tabla: una renovación ya
    // ACTIVA es un contrato andando (va en la tabla) aunque su pipeline siga
    // visible en Gestiones hasta regularizar.
    const tramiteIds = this._idsEnTramite();
    const operativos = this.contratos.filter(c => this._esOperativo(c, tramiteIds));
    const historico = this.contratos.filter(c => !operativos.includes(c) && !tramiteIds.has(c.id));
    const mensualDe = (c) => Number(c.total_mensual ?? c.total_con_itbms ?? 0);
    const esMenor = (c) => mensualDe(c) <= 0 && !this._wcEnVentana(c);
    const principales = operativos.filter(c => !esMenor(c));
    const menores = operativos.filter(esMenor);

    // Encabezado de cuenta: el resumen que le da sentido al botón consolidador.
    const enCampo = this.equipos.filter(e => ['en_cliente', 'asignado_contrato'].includes(e.estado)).length;
    const mensualTot = operativos.reduce((s, c) => s + mensualDe(c), 0);
    // Vencimiento de la cuenta: si algo YA venció se dice como tal (decir
    // "próximo vencimiento" con una fecha pasada confunde); el "próximo" solo
    // considera fechas futuras.
    const hoy = new Date();
    let vencidos = 0, masViejo = null, proxima = null;
    for (const c of operativos) {
      if (!this._aplicaVenc(c) || !c.fecha_vencimiento) continue;
      const d = c.fecha_vencimiento.toDate ? c.fecha_vencimiento.toDate() : new Date(c.fecha_vencimiento);
      if (isNaN(d)) continue;
      if (d < hoy) { vencidos++; if (!masViejo || d < masViejo) masViejo = d; }
      else if (!proxima || d < proxima) proxima = d;
    }
    const vencHtml = vencidos
      ? `<span>·</span><span class="cg-venc vencido">${vencidos} vencido${vencidos === 1 ? '' : 's'} — desde ${this._fmtFecha(masViejo)}</span>`
      : proxima ? `<span>·</span><span>próximo vencimiento <b>${this._fmtFecha(proxima)}</b></span>` : '';
    const cuenta = operativos.length ? `
      <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:9px 13px; margin-bottom:10px;
                  background:var(--surface-sunken, #EEF2F6); border-radius:10px; font-size:13px; color:var(--fg-2);">
        <span><b>${operativos.length}</b> contrato${operativos.length === 1 ? '' : 's'}</span>
        <span>·</span><span><b>${enCampo}</b> radio${enCampo === 1 ? '' : 's'} en campo</span>
        <span>·</span><span class="num"><b>$${mensualTot.toFixed(2)}</b>/mes</span>
        ${vencHtml}
        ${(() => {
          const tram = this._renovacionEnTramite();
          if (tram) return `<button class="btn btn-ghost cg-act cg-senal-cta"
            onclick="Centro.abrirGestion('ct-${this.esc(tram.id)}')">Renovación en trámite ›</button>`;
          return this.puedeCrearGestion() && (operativos.length > 1 || this._wcCustodia().length)
            ? `<button class="btn btn-primary cg-act cg-senal-cta"
                 title="Consolida los contratos de la cuenta en uno solo"
                 onclick="Centro.wizContrato({renovarCuenta:true})">Renovar cuenta</button>` : '';
        })()}
      </div>` : '';

    const filas = principales.map(c => this._filaContrato(c)).join('');
    const nReemp = menores.filter(c => this._codigoTipo(c) === 'REEMP').length;
    const nOtros = menores.length - nReemp;
    const menoresLabel = [
      nReemp ? `${nReemp} reemplazo${nReemp === 1 ? '' : 's'} de equipo` : '',
      nOtros ? `${nOtros} sin facturación` : '',
    ].filter(Boolean).join(' y ');
    const menoresUnid = menores.reduce((s, c) => s + this._unidadesActivas(c), 0);
    const histFilas = historico.map(c => {
      const renovador = this._renovadoPor(c);
      const estadoTxt = renovador
        ? `renovado por <span class="cg-mono">${this.esc(renovador.contrato_id || renovador.id)}</span>`
        : this.esc(this._estadoLabel(c));
      return `<tr style="color:var(--fg-3);">
        <td class="cg-mono"><a href="#" onclick="Centro.verContrato('${this.esc(c.id)}'); return false;">${this.esc(c.contrato_id || c.id)}</a></td>
        <td>${this._compChipHtml(c)}</td>
        <td>${estadoTxt}</td>
        <td style="text-align:right;">${this._unidadesActivas(c)}</td></tr>`;
    }).join('');
    const THEAD = `<thead><tr>
      <th>Contrato</th><th>Tipo</th><th>Estado</th><th style="text-align:right;">Unid.</th><th>Vence</th><th></th>
      </tr></thead>`;
    cont.innerHTML = `
      ${cuenta}
      ${tramiteIds.size ? `<p style="font-size:12px; color:var(--fg-4); margin:0 0 8px;">
        ${tramiteIds.size} contrato(s) <b>en trámite</b> (aprobación, seriales o firma) — atiéndelos arriba en “Ahora” o en Gestiones.</p>` : ''}
      ${principales.length ? `<table class="cg-tabla">${THEAD}<tbody>${filas}</tbody></table>`
        : operativos.length ? '' : '<div class="cg-empty">Sin contratos operativos.</div>'}
      ${menores.length ? `<details style="margin-top:10px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--fg-3); font-weight:600;">Contratos menores (${menores.length}) — ${menoresLabel} · ${menoresUnid} unid.</summary>
        <table class="cg-tabla" style="margin-top:8px;">${THEAD}<tbody>${menores.map(c => this._filaContrato(c)).join('')}</tbody></table>
      </details>` : ''}
      ${historico.length ? `<details style="margin-top:10px;">
        <summary style="cursor:pointer; font-size:13px; color:var(--fg-3); font-weight:600;">Histórico (${historico.length}) — renovados, vencidos, anulados</summary>
        <table class="cg-tabla" style="margin-top:8px;"><thead><tr>
          <th>Contrato</th><th>Tipo</th><th>Estado</th><th style="text-align:right;">Unid.</th>
          </tr></thead><tbody>${histFilas}</tbody></table>
      </details>` : ''}`;
  },

  // Chip de vencimiento POR EQUIPO (mismo semáforo): usa el tramo que le
  // aplica — la línea del aumento (vigencia propia) si su modelo la tiene,
  // si no el vencimiento del contrato. DEMO/TEMP y custodia sin contrato: —.
  _vencChipEquipo(e) {
    const c = this.contratos.find(x => x.id === e.asignacion?.contrato_doc_id);
    if (!c || !this._esVigente(c) || !this._aplicaVenc(c)) {
      // Custodia con vigencia propia estampada desde la evidencia de órdenes
      // (asigna-custodia-por-ordenes, 2026-08-28): el semáforo corre aunque no
      // haya contrato — la salida es la renovación/regularización de la cuenta.
      const fvU = e.vigencia?.fecha_vencimiento;
      if (fvU) {
        const dias = this._diasA(fvU);
        if (dias !== null) {
          const cls = dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente');
          const label = dias < 0 ? `vencido ${-dias} d` : `${dias} d`;
          const refPapel = e.vigencia?.contrato_papel_ref ? `anexo al contrato en papel ${this.esc(e.vigencia.contrato_papel_ref)} · ` : '';
          return `<span class="cg-venc ${cls} num" title="Vence ${this._fmtFecha(fvU)} · ${refPapel}período estampado desde la orden de entrega — sin contrato formal (regularizar al renovar)">${label} *</span>`;
        }
      }
      return '<span style="color:var(--fg-4);">—</span>';
    }
    if (this._renovadoPor(c)) return '<span class="cg-venc vigente">renovado</span>';
    const linea = (c.equipos || []).find(l => l?.vigencia?.fecha_vencimiento && this._mismoModeloLinea(l, e));
    const fv = linea?.vigencia?.fecha_vencimiento || c.fecha_vencimiento;
    const dias = this._diasA(fv);
    if (dias === null) return '<span class="cg-venc por_vencer" title="El contrato no tiene duración fijada">sin duración</span>';
    const cls = dias < 0 ? 'vencido' : (dias <= this.AVISO_DIAS ? 'por_vencer' : 'vigente');
    const label = dias < 0 ? `vencido ${-dias} d` : `${dias} d`;
    return `<span class="cg-venc ${cls} num" title="Vence ${this._fmtFecha(fv)}${linea ? ' · tramo del aumento' : ''}">${label}</span>`;
  },

  // Matching tolerante de modelo (caso Feduro 2026-08-27): la línea del
  // contrato dice "PNC360S" con un modelo_id del catálogo y la ficha del pool
  // dice "HYTERA PNC360S" (marca incluida) con OTRO id — id exacto y label
  // exacto fallaban. Se normaliza a alfanumérico y se acepta contención por
  // sufijo/prefijo (marca por delante, "-R" por detrás).
  // "Una familia, dos filas" (2026-09-07): la decisión vive en ModeloFamilia
  // (misma fila del catálogo primero, luego misma familia N/R; la modalidad
  // filtra y una línea sin modalidad es legacy). El texto de aquí abajo solo
  // corre si el módulo no cargó.
  _normModelo(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  _mismoModeloLinea(l, e) {
    if (window.ModeloFamilia) return ModeloFamilia.lineasCompatibles(this._refEquipo(e), [l]).length > 0;
    if (l.modelo_id && e.modelo_id && l.modelo_id === e.modelo_id) return true;
    const a = this._normModelo(l.modelo), b = this._normModelo(e.modelo_label);
    if (!a || !b) return false;
    return a === b || a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
  },
  _refEquipo(e) {
    return { modelo_id: e.modelo_id || null, modelo: e.modelo_label || e.modelo || '', propiedad: e.propiedad, modalidad: e.modalidad };
  },

  // Línea del contrato que le corresponde a la unidad — la que define su
  // tarifa y su tramo. Exacta primero; si no, la de su familia.
  _lineaDeEquipo(e, c) {
    const ls = c?.equipos || [];
    if (window.ModeloFamilia) { const i = ModeloFamilia.lineaPara(this._refEquipo(e), ls); return i >= 0 ? ls[i] : undefined; }
    return ls.find(l => this._mismoModeloLinea(l, e));
  },

  // Tarifa mensual del equipo según la línea de su contrato.
  _tarifaEquipo(e) {
    const c = this.contratos.find(x => x.id === e.asignacion?.contrato_doc_id);
    if (!c) return '<span style="color:var(--fg-4);">—</span>';
    const p = Number(this._lineaDeEquipo(e, c)?.precio || 0);
    return p > 0
      ? `<span class="num">$${p.toFixed(2)}<span style="font-size:11px;color:var(--fg-4);">/mes</span></span>`
      : '<span style="color:var(--fg-4);" title="La línea del contrato no tiene precio">—</span>';
  },

  pintarEquipos() {
    const cont = document.getElementById('fEquipos');
    if (!cont) return;
    const q = (document.getElementById('fEqFiltro')?.value || '').trim().toUpperCase();
    const chip = (e) => (window.EquiposPoolService?.chipEstadoHtml)
      ? EquiposPoolService.chipEstadoHtml(e.estado)
      : this.esc(e.estado || '—');
    // "De quién es" por serial (2026-09-09): la propiedad de CADA unidad, que
    // es la que manda desde que la cuenta se maneja por serial y no por el
    // tipo del contrato.
    const chipProp = (e) => (window.EquiposPoolService?.chipPropiedadHtml)
      ? EquiposPoolService.chipPropiedadHtml(e)
      : this.esc(e.propiedad || '—');
    // "Sustituye a X · entregado con la orden Y": el contrato firmado conserva
    // el serial original, así que sin esta línea el radio que el cliente tiene
    // hoy no cuadra con el papel y nadie sabe por qué (SilverKing 2026-09-17).
    const origen = (e) => (window.EquiposPoolService?.origenReemplazoHtml)
      ? EquiposPoolService.origenReemplazoHtml(e) : '';
    const fila = (e) => `<tr>
      <td class="cg-mono">${this.esc(e.serial || e.id)}${origen(e)}</td>
      <td>${this.esc(e.modelo_label || '—')}</td>
      <td>${chipProp(e)}</td>
      <td>${chip(e)}${e.pendiente_devolucion ? ' <span class="cg-venc por_vencer">pend. devolución</span>' : ''}</td>
      <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || '—')}</td>
      <td style="text-align:right;">${this._tarifaEquipo(e)}</td>
      <td>${this._vencChipEquipo(e)}</td>
      <td style="text-align:right;"><button class="btn btn-ghost cg-act"
        title="Historia completa de esta unidad" onclick="Centro.verKardex('${this.esc(e.id)}')">Kardex ›</button></td></tr>`;
    const tabla = (rows) => `<div class="cg-twrap"><table class="cg-tabla"><thead><tr>
      <th>Serial</th><th>Modelo</th><th>De quién es</th><th>Situación</th><th>Contrato</th><th style="text-align:right;">Tarifa</th><th>Vence</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    const resProp = (items) => (window.EquiposPoolService?.resumenPropiedadTexto)
      ? EquiposPoolService.resumenPropiedadTexto(items) : '';
    if (!this.equipos.length) { cont.innerHTML = '<div class="cg-empty">Sin equipos asignados en el inventario.</div>'; return; }
    // Buscar un serial lo abre directo: con filtro, lista plana.
    if (q) {
      const lista = this.equipos.filter(e => `${e.serial || ''} ${e.modelo_label || ''} ${e.asignacion?.contrato_id || ''}`.toUpperCase().includes(q));
      cont.innerHTML = lista.length ? tabla(lista.map(fila).join('')) : '<div class="cg-empty">Ningún equipo coincide con la búsqueda.</div>';
      return;
    }
    // Sin filtro: GRUPOS (2026-09-08). Antes eran 52 filas abiertas con los
    // "por clasificar" primero — el 67 % de la ficha. Un grupo por contrato,
    // con conteo, modelos y vencimiento; "sin contrato" y "por clasificar"
    // aparte con su salida; los seriales aparecen al abrir el grupo.
    // …pero agrupar tiene sentido cuando hay MUCHO que ordenar. En una cuenta
    // chica (Alberto 2026-09-09, caso FORTUNATO MANGRAVITA: 13 radios, todos
    // del mismo contrato) el grupo es un clic de más para ver la lista que
    // cabe entera: hasta 15 equipos, o cuando todo cae en un solo grupo, la
    // tabla va plana. La columna "Contrato" ya dice de dónde viene cada uno.
    const grupos = new Map();
    for (const e of this.equipos) {
      let k, orden;
      if (['en_taller', 'devuelto_revision'].includes(e.estado)) { k = 'taller'; orden = 3; }
      else if (e.estado === 'por_clasificar') { k = 'por_clasificar'; orden = 4; }
      else if (['en_cliente', 'asignado_contrato'].includes(e.estado)) {
        k = e.asignacion?.contrato_doc_id ? `c:${e.asignacion.contrato_doc_id}` : 'sin_contrato';
        orden = e.asignacion?.contrato_doc_id ? 1 : 2;
      } else { k = `otros:${e.estado}`; orden = 5; }
      if (!grupos.has(k)) grupos.set(k, { k, orden, items: [] });
      grupos.get(k).items.push(e);
    }
    // Cuenta chica o de un solo grupo: la lista entera, sin clics de por medio.
    if (this.equipos.length <= 15 || grupos.size === 1) {
      const sinContrato = (grupos.get('sin_contrato')?.items || []).length;
      const porClasificar = (grupos.get('por_clasificar')?.items || []).length;
      const aviso = (sinContrato || porClasificar) && this.puedeCrearGestion()
        ? `<div class="cg-senal warn" style="margin-bottom:8px; align-items:center;">
            <span>${[sinContrato ? `<b>${sinContrato}</b> en campo sin contrato` : '',
                     porClasificar ? `<b>${porClasificar}</b> por clasificar` : ''].filter(Boolean).join(' · ')}
              — cuentan como deuda de la cuenta.</span>
            <button class="btn btn-ghost" style="margin-left:auto; flex:none; padding:3px 11px; font-size:12px;"
              onclick="event.preventDefault(); Centro.verRegularizacion()">Qué falta</button></div>`
        : '';
      const orden = (e) => (['en_cliente', 'asignado_contrato'].includes(e.estado) ? 0 : 1);
      const todos = [...this.equipos].sort((a, b) => orden(a) - orden(b)
        || String(a.asignacion?.contrato_id || 'zzz').localeCompare(String(b.asignacion?.contrato_id || 'zzz'))
        || String(a.serial || a.id).localeCompare(String(b.serial || b.id)));
      const resumen = resProp(todos);
      cont.innerHTML = `${aviso}${resumen ? `<div style="font-size:12.5px; color:var(--fg-3); margin-bottom:6px;">${this.esc(resumen)}</div>` : ''}${tabla(todos.map(fila).join(''))}`;
      return;
    }
    const venceDe = (c) => { const d = c?.fecha_vencimiento?.toDate ? c.fecha_vencimiento.toDate() : (c?.fecha_vencimiento ? new Date(c.fecha_vencimiento) : null); return d && !isNaN(d) ? d.getTime() : Infinity; };
    const lista = [...grupos.values()].sort((a, b) => a.orden - b.orden
      || (a.k.startsWith('c:') && b.k.startsWith('c:') ? venceDe(this.contratos.find(c => c.id === a.k.slice(2))) - venceDe(this.contratos.find(c => c.id === b.k.slice(2))) : 0));
    const modelos = (items) => { const m = [...new Set(items.map(e => e.modelo_label).filter(Boolean))]; return m.length ? this.esc(m.slice(0, 2).join(', ')) + (m.length > 2 ? ` +${m.length - 2}` : '') : '<span style="color:var(--fg-4);">sin modelo</span>'; };
    const abiertos = this._eqGruposAbiertos || new Set();
    this._eqGruposAbiertos = abiertos;
    const html = lista.map(g => {
      const n = g.items.length;
      let titulo = '', k2 = '', tono = '', accion = '';
      if (g.k.startsWith('c:')) {
        const c = this.contratos.find(x => x.id === g.k.slice(2));
        titulo = `<span class="cg-mono">${this.esc(c?.contrato_id || g.items[0].asignacion?.contrato_id || '—')}</span> · ${modelos(g.items)}`;
        k2 = c ? `${this._tarifaEquipo(g.items[0])} · ${this._vencChipEquipo(g.items[0])}` : '';
      } else if (g.k === 'sin_contrato') {
        titulo = `<b>En campo sin contrato</b> · ${modelos(g.items)}`; tono = 'warn';
        k2 = 'cuentan como deuda de la cuenta';
        accion = this.puedeCrearGestion() ? `<button class="btn btn-ghost cg-act" onclick="event.preventDefault(); Centro.verRegularizacion()">Qué falta</button>` : '';
      } else if (g.k === 'por_clasificar') {
        titulo = `<b>Por clasificar</b> · ubicación desconocida`; tono = 'warn';
        k2 = 'cola de bodega';
        accion = `<a class="btn btn-ghost cg-act" href="../almacen/index.html?tab=serial&estado=por_clasificar" onclick="event.stopPropagation()">Ver por clasificar</a>`;
      } else if (g.k === 'taller') {
        titulo = `<b>En taller / revisión</b> · ${modelos(g.items)}`;
        k2 = 'vuelven al cliente al entregarse la orden';
      } else {
        titulo = `<b>${this.esc((window.EquiposPoolService?.ESTADO_LABELS || {})[g.items[0].estado] || g.items[0].estado)}</b> · ${modelos(g.items)}`;
      }
      const open = abiertos.has(g.k) || (lista.length === 1);
      // El desglose de propiedad va en el MISMO span del conteo: la rejilla
      // del summary tiene 5 celdas fijas y en móvil se oculta la segunda .k.
      const rp = resProp(g.items);
      return `<details class="cg-eqgrp ${tono}" data-grp="${this.esc(g.k)}" ${open ? 'open' : ''} ontoggle="Centro._eqToggle(this)">
        <summary><span>${titulo}</span><span class="k">${n} equipo${n === 1 ? '' : 's'}${rp ? ` · ${rp}` : ''}</span><span class="k">${k2}</span><span>${accion}</span><span class="chev">›</span></summary>
        <div style="padding:6px 8px 8px;">${tabla(g.items.map(fila).join(''))}</div>
      </details>`;
    }).join('');
    cont.innerHTML = html;
  },
  _eqGruposAbiertos: null,
  _eqToggle(d) {
    const s = this._eqGruposAbiertos || (this._eqGruposAbiertos = new Set());
    if (d.open) s.add(d.dataset.grp); else s.delete(d.dataset.grp);
  },

  // Kardex en un modal (pedido 2026-08-28): la historia de la unidad se ve
  // AQUÍ mismo — igual que en la página de equipos — y el salto a Seriales
  // queda como link al pie, no como destino del botón.
  async verKardex(id) {
    const e = this.equipos.find(x => x.id === id);
    const serial = e?.serial || id;
    const urlSeriales = `../almacen/index.html?tab=existencias&serial=${encodeURIComponent(serial)}`;
    this._abrirModal(`
      <h3 style="margin:0 0 2px;">Historia — <span class="cg-mono">${this.esc(serial)}</span></h3>
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3);">
        ${this.esc(e?.modelo_label || '')} · ${this.esc((window.EquiposPoolService?.ESTADO_LABELS || {})[e?.estado] || e?.estado || '')}
        ${e?.asignacion?.contrato_id ? ` · <span class="cg-mono">${this.esc(e.asignacion.contrato_id)}</span>` : ''}</p>
      <div id="wkMovs" style="max-height:55vh; overflow:auto;">
        <p style="color:var(--fg-3); font-size:13px;">Cargando movimientos…</p></div>
      <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
        <a href="${urlSeriales}" style="font-size:12.5px;">Abrir en Seriales (pool de equipos) ›</a>
        <button class="btn btn-ghost" style="margin-left:auto;" onclick="Centro._cerrarModal()">Cerrar</button>
      </div>`);
    try {
      const movs = await EquiposPoolService.getMovimientos(id);
      const cont = document.getElementById('wkMovs');
      if (!cont) return;
      if (!movs.length) { cont.innerHTML = '<p style="color:var(--fg-3); font-size:13px;">Sin movimientos registrados.</p>'; return; }
      const L = (window.EquiposPoolService?.ESTADO_LABELS) || {};
      cont.innerHTML = movs.map(m => {
        const fecha = this._fmtFechaHora(m.at);
        const trans = (m.de_estado || m.a_estado)
          ? ` <span style="color:var(--fg-3);">${this.esc(L[m.de_estado] || m.de_estado || '·')} → ${this.esc(L[m.a_estado] || m.a_estado || '·')}</span>` : '';
        const ref = m.ref ? ` · <span style="color:var(--fg-3);">${this.esc(m.ref.tipo || '')}: ${this.esc(m.ref.label || m.ref.id || '')}</span>` : '';
        return `<div style="display:flex; gap:10px; padding:8px 2px; border-bottom:1px solid var(--border-subtle);">
          <div style="flex:none; width:8px; height:8px; border-radius:50%; background:var(--accent); margin-top:6px;"></div>
          <div style="font-size:13px; line-height:1.45;">
            <strong>${this.esc((m.tipo || '').replace(/_/g, ' '))}</strong>${trans}
            ${m.notas ? `<div>${this.esc(m.notas)}</div>` : ''}
            <div style="font-size:12px; color:var(--fg-4);">${this.esc(fecha)}${ref}${m.por_email ? ` · ${this.esc(m.por_email)}` : (m.por === 'system' ? ' · sistema' : '')}</div>
          </div></div>`;
      }).join('');
    } catch (err) {
      const cont = document.getElementById('wkMovs');
      if (cont) cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">Error al cargar la historia: ${this.esc(err?.message || err)}</p>`;
    }
  },
});
