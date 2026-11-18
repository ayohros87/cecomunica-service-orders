// @ts-nocheck
// Centro de gestión de clientes — Formalización por ORDEN DE COMPRA
// (2026-11-18, Alberto). Sección del Centro: centro-core.js define
// window.Centro y aquí se le suman estos métodos; el orden lo fija
// js/entry/clientes-centro.js.
//
// Clientes de gobierno y corporativos que no firman nuestro contrato: lo
// formalizan con su OC (o un contrato hecho por la entidad), y en gobierno esa
// OC se REFRENDA en la Contraloría. Para ellos:
//   · "Subir la orden de compra" ocupa el lugar de "Enviar para firma" y de
//     "Subir el contrato firmado". Registrar la OC es la MISMA vía que subir el
//     firmado (firmado=true + firmado_url → activo; rules::esActivacionPorFirmado),
//     así que el candado de la entrega, la facturación y la comisión no cambian.
//   · El monto de la OC debe CUADRAR con el contrato (ContratoFirma.cuadraOC).
//     Si no cuadra, el vendedor no sigue; administración puede, con motivo.
//   · Gobierno: se entrega con la OC aunque el refrendo no haya llegado. El
//     refrendo se registra después ("Registrar el refrendo"): la OC refrendada
//     pasa a ser el documento del expediente y la anterior queda archivada.
//   · Nuestro contrato sigue a la vista como términos estándar de referencia.
// La regla de negocio vive en js/domain/contratoFirma.js.
Object.assign(window.Centro, {

  _puedeSubirOC() { return [ROLES.ADMIN, 'admin', ROLES.VENDEDOR].includes(this.rol); },
  _esAdminOC() { return [ROLES.ADMIN, 'admin'].includes(this.rol); },
  _hoyISO() {
    const d = new Date(Date.now() - 5 * 3600000); // Panamá
    return d.toISOString().slice(0, 10);
  },

  // Fila "Firmado" de la vista previa para un contrato con OC.
  _ocTxt(c) {
    const oc = c?.orden_compra;
    if (!oc) return '';
    const doc = c.firmado_url
      ? `<a href="${this.esc(c.firmado_url)}" target="_blank" rel="noopener">OC ${this.esc(oc.numero || '')}</a>`
      : `OC ${this.esc(oc.numero || '')}`;
    const monto = Number(oc.monto) > 0 ? ` · $${Number(oc.monto).toFixed(2)}` : '';
    const ref = !ContratoFirma.esGobierno(c) ? ''
      : oc.refrendo
        ? ` · refrendada${oc.refrendo.numero ? ` (${this.esc(oc.refrendo.numero)})` : ''}${oc.refrendo.fecha ? ` el ${this.esc(oc.refrendo.fecha)}` : ''}`
        : ' · <span class="cg-venc por_vencer">refrendo pendiente</span>';
    return `${doc}${monto}${ref}`;
  },

  // Convierte lo que eligió el usuario en UN PDF (storage.rules exige PDF en
  // contratos_firmados/). Mismo criterio que el firmado: un PDF, o solo fotos.
  async _ocArchivoPdf(files, prefijo) {
    const esPdf = (f) => f.type === 'application/pdf' || (f.name.split('.').pop() || '').toLowerCase() === 'pdf';
    const esImg = (f) => /^image\//.test(f.type);
    if (!files.length) throw new Error('Falta el archivo de la orden de compra.');
    let file;
    if (files.length === 1 && esPdf(files[0])) file = files[0];
    else if (files.every(esImg)) {
      if (!window.ContratosFirmado?._fotosAPdf) throw new Error('el conversor de fotos no está cargado');
      Toast.show(`Armando un PDF con ${files.length} foto(s)…`, '');
      const blob = await ContratosFirmado._fotosAPdf(files);
      file = new File([blob], `${prefijo}_${files.length}fotos.pdf`, { type: 'application/pdf' });
    } else throw new Error('Sube UN PDF, o solo fotos (varias a la vez) — no mezclados.');
    if (file.size >= 10 * 1024 * 1024) {
      throw new Error(`El archivo pesa ${(file.size / 1048576).toFixed(1)} MB; el máximo es 10 MB. Comprímelo o escanéalo a menor resolución.`);
    }
    return file;
  },

  async _ocSubirStorage(c, file, sufijo) {
    const legible = c.contrato_id || c.id;
    const path = `contratos_firmados/${legible}_${sufijo}_${Date.now()}.pdf`;
    const snap = await firebase.storage().ref(path).put(file, {
      contentType: 'application/pdf',
      customMetadata: { contrato_doc_id: c.id, contrato_id: legible, documento: sufijo },
    });
    return { path, url: await snap.ref.getDownloadURL() };
  },

  /* ───────── Subir la orden de compra ───────── */

  subirOrdenCompra(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    if (!ContratoFirma.esOC(c)) { Toast.show('Este contrato se formaliza con la firma del cliente, no con orden de compra', 'warn'); return; }
    if (c.estado !== 'aprobado' || c.firmado) { Toast.show('La orden de compra se sube a un contrato APROBADO que todavía no la tiene', 'warn'); return; }
    if (ContratoFirma.dormido(c)) { Toast.show('El contrato está dormido: reactívalo primero', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('La orden de compra la sube el vendedor o administración', 'warn'); return; }
    const gob = ContratoFirma.esGobierno(c);
    const esp = ContratoFirma.montoEsperadoOC(c);
    const legible = c.contrato_id || c.id;
    this._abrirModalA({
      banda: false,
      titulo: `Orden de compra — <span class="cg-mono">${this.esc(legible)}</span>`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          ${gob ? 'Cliente de <b>gobierno</b>' : 'Cliente <b>corporativo</b>'}: la orden de compra ocupa el lugar de la firma
          del contrato. Al registrarla el contrato queda <b>ACTIVO</b> (arranca la facturación y la comisión) y la
          entrega de los equipos queda habilitada.${gob ? ' Si el refrendo de la Contraloría todavía no llega, regístralo después: <b>no frena la entrega</b>.' : ''}
          Nuestro contrato queda como términos estándar de referencia.</p>
        <div class="form-grid-2">
          <div class="form-field"><label class="form-label" for="ocNumero">Número de la orden de compra</label>
            <input class="form-input" id="ocNumero" autocomplete="off" placeholder="p. ej. 2026-000123"></div>
          <div class="form-field"><label class="form-label" for="ocFecha">Fecha de la orden</label>
            <input class="form-input" id="ocFecha" type="date" value="${this._hoyISO()}"></div>
          <div class="form-field"><label class="form-label" for="ocMonto">Monto total de la OC (con ITBMS)</label>
            <input class="form-input num" id="ocMonto" type="number" min="0" step="0.01" inputmode="decimal"
              oninput="Centro._ocRevisarMonto('${this.esc(c.id)}')">
            <span class="form-hint">${esp
              ? `El contrato suma <b class="num">$${esp.monto.toFixed(2)}</b> (${this.esc(esp.detalle)}).`
              : 'No se pudo calcular el total del contrato (sin plazo en meses): revisa el monto a mano.'}</span></div>
          <div class="form-field"><label class="form-label" for="ocArchivo">Archivo de la OC</label>
            <input class="form-input" id="ocArchivo" type="file" multiple accept="application/pdf,image/*">
            <span class="form-hint">PDF, o fotos que se arman en un solo PDF.</span></div>
        </div>
        <div id="ocAvisoMonto" style="display:none; margin:4px 0 10px; font-size:13px;"></div>
        <div class="form-field" id="ocMotivoWrap" style="display:none;">
          <label class="form-label" for="ocMotivo">Motivo para aceptar la diferencia (administración)</label>
          <input class="form-input" id="ocMotivo" placeholder="p. ej. la OC cubre solo el año fiscal 2026">
        </div>
        ${gob ? `
        <label style="display:flex; gap:8px; align-items:center; margin:8px 0; font-size:13.5px;">
          <input type="checkbox" id="ocYaRefrendada" onchange="document.getElementById('ocRefWrap').style.display=this.checked?'':'none'">
          La orden ya viene <b>refrendada</b> por la Contraloría</label>
        <div class="form-grid-2" id="ocRefWrap" style="display:none;">
          <div class="form-field"><label class="form-label" for="ocRefNumero">Número de refrendo</label>
            <input class="form-input" id="ocRefNumero" autocomplete="off"></div>
          <div class="form-field"><label class="form-label" for="ocRefFecha">Fecha del refrendo</label>
            <input class="form-input" id="ocRefFecha" type="date" value="${this._hoyISO()}"></div>
        </div>` : ''}`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="ocGuardar" onclick="Centro.guardarOrdenCompra('${this.esc(c.id)}')">Registrar la OC y activar</button>`,
    });
  },

  // Aviso en vivo: cuadra / no cuadra. El motivo solo se le pide a
  // administración — el vendedor no puede seguir con una OC que no cuadra.
  _ocRevisarMonto(id) {
    const c = this.contratos.find(x => x.id === id);
    const v = document.getElementById('ocMonto')?.value;
    const aviso = document.getElementById('ocAvisoMonto');
    const wrap = document.getElementById('ocMotivoWrap');
    if (!c || !aviso) return;
    if (v === '' || v == null) { aviso.style.display = 'none'; if (wrap) wrap.style.display = 'none'; return; }
    const r = ContratoFirma.cuadraOC(c, Number(v));
    if (r.ok === null) { aviso.style.display = 'none'; if (wrap) wrap.style.display = 'none'; return; }
    aviso.style.display = '';
    if (r.ok) {
      aviso.innerHTML = '<span style="color:var(--cg-ok-deep, #166534);">✓ Cuadra con el contrato.</span>';
      if (wrap) wrap.style.display = 'none';
      return;
    }
    const dif = `${r.diferencia > 0 ? '+' : '−'}$${Math.abs(r.diferencia).toFixed(2)}`;
    aviso.innerHTML = `<span style="color:var(--cg-bad-deep, #991B1B);"><b>No cuadra:</b> la OC difiere ${dif} del contrato
      ($${r.esperado.toFixed(2)}). ${this._esAdminOC() ? 'Para seguir, escribe el motivo.' : 'Corrige el contrato (o pide a la entidad que corrija la OC) antes de registrarla; si hay un motivo válido, lo registra administración.'}</span>`;
    if (wrap) wrap.style.display = this._esAdminOC() ? '' : 'none';
  },

  guardarOrdenCompra(id) {
    return this._candado('guardarOC:' + id, () => this._guardarOrdenCompra(id), 'Subiendo…');
  },
  async _guardarOrdenCompra(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    if (!ContratoFirma.esOC(c) || c.estado !== 'aprobado' || c.firmado) { Toast.show('Este contrato ya no espera la orden de compra', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('La orden de compra la sube el vendedor o administración', 'warn'); return; }
    const g = (k) => document.getElementById(k);
    const numero = (g('ocNumero')?.value || '').trim();
    const fecha = g('ocFecha')?.value || '';
    const montoTxt = g('ocMonto')?.value;
    const monto = Number(montoTxt);
    const files = [...(g('ocArchivo')?.files || [])];
    if (!numero) { Toast.show('Falta el número de la orden de compra', 'warn'); g('ocNumero')?.focus(); return; }
    if (!fecha) { Toast.show('Falta la fecha de la orden', 'warn'); return; }
    if (montoTxt === '' || !(monto > 0)) { Toast.show('Falta el monto de la orden de compra', 'warn'); g('ocMonto')?.focus(); return; }
    const cuadre = ContratoFirma.cuadraOC(c, monto);
    let motivoDif = '';
    if (cuadre.ok === false) {
      if (!this._esAdminOC()) {
        Toast.show(`La OC no cuadra con el contrato ($${cuadre.esperado.toFixed(2)}). Corrige antes de registrarla, o pide a administración que la registre con el motivo.`, 'bad', 8000);
        return;
      }
      motivoDif = (g('ocMotivo')?.value || '').trim();
      if (!motivoDif) { Toast.show('La OC no cuadra: escribe el motivo para aceptarla', 'warn'); g('ocMotivo')?.focus(); return; }
    }
    const gob = ContratoFirma.esGobierno(c);
    const yaRef = gob && g('ocYaRefrendada')?.checked;
    const refNumero = yaRef ? (g('ocRefNumero')?.value || '').trim() : '';
    const refFecha = yaRef ? (g('ocRefFecha')?.value || '') : '';
    if (yaRef && !refNumero) { Toast.show('Falta el número de refrendo', 'warn'); g('ocRefNumero')?.focus(); return; }

    let file;
    try { file = await this._ocArchivoPdf(files, 'orden_compra'); }
    catch (e) { Toast.show(e?.message || String(e), 'warn', 7000); return; }

    const legible = c.contrato_id || id;
    const ok = await Modal.confirm({
      title: 'Registrar la OC y activar', confirmLabel: 'Registrar y activar',
      message: `OC <b>${this.esc(numero)}</b> por <b>$${monto.toFixed(2)}</b> para el contrato <b class="cg-mono">${this.esc(legible)}</b>.
        <br><br><b>Esto ACTIVA el contrato y arranca la facturación y la comisión.</b>
        ${gob && !yaRef ? '<br><br>El refrendo queda pendiente: regístralo cuando llegue (no frena la entrega).' : ''}
        ${this._serialesListos(c) ? '' : '<br><br>Ojo: bodega todavía no asignó los seriales de este contrato.'}`,
    });
    if (!ok) return;
    try {
      Toast.show('Subiendo la orden de compra…', '');
      const { path, url } = await this._ocSubirStorage(c, file, 'OC');
      const ahora = firebase.firestore.Timestamp.now();
      const email = firebase.auth().currentUser?.email || null;
      const orden_compra = {
        numero, fecha, monto: Math.round(monto * 100) / 100,
        monto_contrato: cuadre.esperado,
        ...(motivoDif ? { diferencia: cuadre.diferencia, diferencia_motivo: motivoDif } : {}),
        sector: gob ? 'gobierno' : 'corporativo',
        url, storage_path: path, nombre: file.name,
        registrada_at: ahora, registrada_por_uid: this.uid || null, registrada_por_email: email,
        refrendo: yaRef ? {
          numero: refNumero, fecha: refFecha, en_la_misma_oc: true,
          at: ahora, por_uid: this.uid || null, por_email: email,
        } : null,
      };
      // La misma vía que el firmado (rules::esActivacionPorFirmado): firmado +
      // firmado_url desde 'aprobado' → 'activo', admin o vendedor.
      await ContratosService.updateContrato(id, {
        firmado: true, firmado_tipo: 'orden_compra',
        firmado_url: url, firmado_nombre: file.name, firmado_storage_path: path,
        firmado_fecha: ahora, firmado_por_uid: this.uid || null,
        orden_compra,
        estado_previo: c.estado, estado: 'activo', fecha_activacion: ahora,
      });
      this._cerrarModal();
      Toast.show(`Contrato ${legible} ACTIVO con la OC ${numero}${gob && !yaRef ? ' — falta el refrendo' : ''}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar la orden de compra: ' + (e?.message || e), 'bad', 8000);
    }
  },

  /* ───────── Registrar el refrendo (gobierno) ───────── */

  registrarRefrendo(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.refrendoPendiente(c)) { Toast.show('Este contrato no tiene un refrendo pendiente', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('El refrendo lo registra el vendedor o administración', 'warn'); return; }
    this._abrirModalA({
      banda: false,
      titulo: `Refrendo de la OC ${this.esc(c.orden_compra?.numero || '')} — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          Sube la orden de compra con el <b>sello de refrendo de la Contraloría</b>. Pasa a ser el documento del
          expediente; la OC sin refrendo queda archivada en el historial (no se borra).</p>
        <div class="form-grid-2">
          <div class="form-field"><label class="form-label" for="refNumero">Número de refrendo</label>
            <input class="form-input" id="refNumero" autocomplete="off"></div>
          <div class="form-field"><label class="form-label" for="refFecha">Fecha del refrendo</label>
            <input class="form-input" id="refFecha" type="date" value="${this._hoyISO()}"></div>
          <div class="form-field" style="grid-column:1 / -1;"><label class="form-label" for="refArchivo">OC refrendada</label>
            <input class="form-input" id="refArchivo" type="file" multiple accept="application/pdf,image/*">
            <span class="form-hint">PDF, o fotos que se arman en un solo PDF.</span></div>
        </div>`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarRefrendo('${this.esc(c.id)}')">Registrar el refrendo</button>`,
    });
  },

  guardarRefrendo(id) {
    return this._candado('guardarRefrendo:' + id, () => this._guardarRefrendo(id), 'Subiendo…');
  },
  async _guardarRefrendo(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.refrendoPendiente(c)) { Toast.show('Este contrato ya no tiene el refrendo pendiente', 'warn'); return; }
    const g = (k) => document.getElementById(k);
    const numero = (g('refNumero')?.value || '').trim();
    const fecha = g('refFecha')?.value || '';
    if (!numero) { Toast.show('Falta el número de refrendo', 'warn'); g('refNumero')?.focus(); return; }
    if (!fecha) { Toast.show('Falta la fecha del refrendo', 'warn'); return; }
    let file;
    try { file = await this._ocArchivoPdf([...(g('refArchivo')?.files || [])], 'oc_refrendada'); }
    catch (e) { Toast.show(e?.message || String(e), 'warn', 7000); return; }
    try {
      Toast.show('Subiendo la OC refrendada…', '');
      const { path, url } = await this._ocSubirStorage(c, file, 'OC_refrendada');
      const ahora = firebase.firestore.Timestamp.now();
      const update = {
        'orden_compra.refrendo': {
          numero, fecha, url, storage_path: path, nombre: file.name,
          at: ahora, por_uid: this.uid || null, por_email: firebase.auth().currentUser?.email || null,
        },
        firmado_url: url, firmado_nombre: file.name, firmado_storage_path: path,
      };
      // La OC sin refrendo queda en el historial (append-only en rules).
      if (c.firmado_url) {
        update.firmado_historial = firebase.firestore.FieldValue.arrayUnion({
          firmado_url: c.firmado_url || null, firmado_nombre: c.firmado_nombre || null,
          firmado_storage_path: c.firmado_storage_path || null, firmado_fecha: c.firmado_fecha || null,
          firmado_por_uid: c.firmado_por_uid || null,
          reemplazado_at: ahora, reemplazado_por_uid: this.uid || null, reemplazado_por: url,
          motivo: 'refrendo de la orden de compra',
        });
      }
      await ContratosService.updateContrato(id, update);
      this._cerrarModal();
      Toast.show(`Refrendo ${numero} registrado en ${c.contrato_id || id}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar el refrendo: ' + (e?.message || e), 'bad', 8000);
    }
  },

  /* ───────── Cambio puntual: firma ↔ orden de compra ───────── */

  // El cliente manda por defecto (clientes.formalizacion_contrato); esto es
  // la excepción en UN contrato, con motivo. Solo mientras no se haya
  // formalizado: un contrato firmado o con OC ya registrada no cambia.
  _puedeCambiarFormalizacion(c) {
    return !!c && ContratoFirma.lleva(c) && ['pendiente_aprobacion', 'aprobado'].includes(c.estado)
      && !c.firmado && !c.firmado_pendiente_validacion && c.deleted !== true;
  },

  cambiarFormalizacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!this._puedeCambiarFormalizacion(c)) { Toast.show('Solo se cambia en un contrato que todavía no se ha formalizado', 'warn'); return; }
    const actual = ContratoFirma.claveFormalizacion(c);
    const delCliente = this.cliente?.formalizacion_contrato || 'firma';
    const op = (k, label) => `<option value="${k}" ${k === actual ? 'selected' : ''}>${label}${k === delCliente ? ' — la del cliente' : ''}</option>`;
    this._abrirModalA({
      banda: false,
      titulo: `Cómo se formaliza <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          Por defecto cada contrato se formaliza como dice la ficha del cliente. Aquí se cambia <b>solo este contrato</b>.
          ${c.firma_solicitud_estado === 'pendiente' ? '<br><br><b>Ojo:</b> tiene un enlace de firma pendiente; si pasa a orden de compra, el enlace se retira.' : ''}</p>
        <div class="form-field"><label class="form-label" for="fzTipo">Se formaliza con</label>
          <select class="form-select" id="fzTipo">
            ${op('firma', 'Firma del cliente (nuestro contrato)')}
            ${op('oc_gobierno', ContratoFirma.FORMALIZACION.oc_gobierno.label)}
            ${op('oc_corporativo', ContratoFirma.FORMALIZACION.oc_corporativo.label)}
          </select></div>
        <div class="form-field"><label class="form-label" for="fzMotivo">Motivo</label>
          <input class="form-input" id="fzMotivo" placeholder="p. ej. esta compra la tramita la entidad con su propio contrato"></div>`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarFormalizacion('${this.esc(c.id)}')">Guardar</button>`,
    });
  },

  guardarFormalizacion(id) {
    return this._candado('formalizacion:' + id, () => this._guardarFormalizacion(id));
  },
  async _guardarFormalizacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!this._puedeCambiarFormalizacion(c)) { Toast.show('Este contrato ya no se puede cambiar', 'warn'); return; }
    const clave = document.getElementById('fzTipo')?.value || 'firma';
    const motivo = (document.getElementById('fzMotivo')?.value || '').trim();
    if (clave === ContratoFirma.claveFormalizacion(c)) { this._cerrarModal(); return; }
    if (!motivo) { Toast.show('Escribe el motivo del cambio', 'warn'); document.getElementById('fzMotivo')?.focus(); return; }
    const f = ContratoFirma.FORMALIZACION[clave];
    const formalizacion = {
      tipo: f ? f.tipo : 'firma', ...(f ? { sector: f.sector } : {}),
      origen: 'contrato', motivo,
      por_uid: this.uid || null, por_email: firebase.auth().currentUser?.email || null,
      at: firebase.firestore.Timestamp.now(),
    };
    try {
      // Pasar a OC retira el enlace de firma pendiente: ya no se espera esa firma.
      if (f && c.firma_solicitud_estado === 'pendiente' && c.firma_solicitud_id) {
        await firebase.firestore().collection('firma_solicitudes').doc(c.firma_solicitud_id).update({ estado: 'cancelado' });
      }
      await ContratosService.updateContrato(id, {
        formalizacion,
        ...(f && c.firma_solicitud_estado === 'pendiente' ? { firma_solicitud_estado: 'cancelado' } : {}),
      });
      Object.assign(c, { formalizacion });
      if (f && c.firma_solicitud_estado === 'pendiente') c.firma_solicitud_estado = 'cancelado';
      this._cerrarModal();
      Toast.show(`${c.contrato_id || id}: se formaliza con ${f ? f.label.toLowerCase() : 'la firma del cliente'}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cambiar: ' + (e?.message || e), 'bad');
    }
  },
});
