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
//   · OC PARCIAL: la entidad emite una OC por año fiscal. La OC dice cuántos
//     meses cubre; el cuadre se hace contra esos meses y, antes de que venza,
//     se registra la OC SIGUIENTE (solo mensualidades).
//   · Gobierno: se entrega con la OC aunque el refrendo no haya llegado. El
//     refrendo se registra después; la OC refrendada pasa a ser el documento
//     del expediente y la anterior queda archivada.
//   · ANEXO DE AUMENTO: el cliente con OC formaliza el anexo con una OC nueva
//     (cuadra contra los totales del anexo). Cumple el mismo paso que el anexo
//     firmado (pendiente_firma → pendiente_bodega + cierre.firma).
//   · El cliente se marca desde su ficha o desde aquí ("Cómo formaliza sus
//     contratos…", abierto al vendedor). Solo cambian los contratos EN TRÁMITE:
//     lo firmado, lo activo y el histórico no se tocan (ClientesService.planFormalizacion).
//   · Nuestro contrato sigue a la vista como términos estándar de referencia.
// La regla de negocio vive en js/domain/contratoFirma.js.
Object.assign(window.Centro, {

  _puedeSubirOC() { return [ROLES.ADMIN, 'admin', ROLES.VENDEDOR].includes(this.rol); },
  _esAdminOC() { return [ROLES.ADMIN, 'admin'].includes(this.rol); },
  _hoyISO() {
    const d = new Date(Date.now() - 5 * 3600000); // Panamá
    return d.toISOString().slice(0, 10);
  },
  _fechaCorta(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(iso);
  },

  // Fila "Orden de compra" de la vista previa.
  _ocTxt(c) {
    const oc = c?.orden_compra;
    if (!oc) return '';
    const doc = c.firmado_url
      ? `<a href="${this.esc(c.firmado_url)}" target="_blank" rel="noopener">OC ${this.esc(oc.numero || '')}</a>`
      : `OC ${this.esc(oc.numero || '')}`;
    const monto = Number(oc.monto) > 0 ? ` · $${Number(oc.monto).toFixed(2)}` : '';
    const plazo = ContratoFirma.mesesContrato(c);
    const cub = ContratoFirma.mesesCubiertosOC(c);
    const cobertura = plazo && cub && cub < plazo
      ? ` · cubre ${cub} de ${plazo} meses${oc.cubre_hasta ? ` (hasta ${this._fechaCorta(oc.cubre_hasta)})` : ''}` : '';
    const ref = !ContratoFirma.esGobierno(c) ? ''
      : oc.refrendo
        ? ` · refrendada${oc.refrendo.numero ? ` (${this.esc(oc.refrendo.numero)})` : ''}${oc.refrendo.fecha ? ` el ${this.esc(this._fechaCorta(oc.refrendo.fecha))}` : ''}`
        : ' · <span class="cg-venc por_vencer">refrendo pendiente</span>';
    const ant = (c.ordenes_compra_anteriores || []).length;
    return `${doc}${monto}${cobertura}${ref}${ant ? ` · ${ant} OC anterior(es) en el historial` : ''}`;
  },

  // Convierte lo que eligió el usuario en UN PDF. Mismo criterio que el
  // firmado: un PDF, o solo fotos (se arman en un PDF).
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

  // contratos_firmados/ (PDF) para el contrato; gestiones_anexos/{gid}/ para el anexo.
  async _ocSubirStorage({ carpeta, legible, file, sufijo, meta = {} }) {
    const path = `${carpeta}/${legible}_${sufijo}_${Date.now()}.pdf`;
    const snap = await firebase.storage().ref(path).put(file, {
      contentType: 'application/pdf', customMetadata: { documento: sufijo, ...meta },
    });
    return { path, url: await snap.ref.getDownloadURL() };
  },

  // Formulario común de una OC (contrato, OC siguiente o anexo).
  //   pfx: prefijo de ids · esp: {monto, detalle}|null · conMeses: plazo total
  //   (para "meses que cubre") · gob: muestra el refrendo.
  _ocFormHtml({ pfx, esp, plazo = null, mesesDefault = null, gob = false, onMonto, notaMeses = '' }) {
    return `
        <div class="form-grid-2">
          <div class="form-field"><label class="form-label" for="${pfx}Numero">Número de la orden de compra</label>
            <input class="form-input" id="${pfx}Numero" autocomplete="off" placeholder="p. ej. 2026-000123"></div>
          <div class="form-field"><label class="form-label" for="${pfx}Fecha">Fecha de la orden</label>
            <input class="form-input" id="${pfx}Fecha" type="date" value="${this._hoyISO()}"></div>
          ${plazo ? `<div class="form-field"><label class="form-label" for="${pfx}Meses">Meses que cubre la OC</label>
            <input class="form-input num" id="${pfx}Meses" type="number" min="1" max="${plazo}" step="1" value="${mesesDefault || plazo}" oninput="${onMonto}">
            <span class="form-hint">${notaMeses || `El contrato es a ${plazo} meses. Si la entidad emite una OC por año fiscal, pon los meses que cubre esta.`}</span></div>` : ''}
          <div class="form-field"><label class="form-label" for="${pfx}Monto">Monto total de la OC (con ITBMS)</label>
            <input class="form-input num" id="${pfx}Monto" type="number" min="0" step="0.01" inputmode="decimal" oninput="${onMonto}">
            <span class="form-hint" id="${pfx}Esperado">${esp
              ? `Debe sumar <b class="num">$${esp.monto.toFixed(2)}</b> (${this.esc(esp.detalle)}).`
              : 'No se pudo calcular el total esperado (sin plazo en meses): revisa el monto a mano.'}</span></div>
          <div class="form-field" ${plazo ? '' : 'style="grid-column:1 / -1;"'}><label class="form-label" for="${pfx}Archivo">Archivo de la OC</label>
            <input class="form-input" id="${pfx}Archivo" type="file" multiple accept="application/pdf,image/*">
            <span class="form-hint">PDF, o fotos que se arman en un solo PDF.</span></div>
        </div>
        <div id="${pfx}AvisoMonto" style="display:none; margin:4px 0 10px; font-size:13px;"></div>
        <div class="form-field" id="${pfx}MotivoWrap" style="display:none;">
          <label class="form-label" for="${pfx}Motivo">Motivo para aceptar la diferencia (administración)</label>
          <input class="form-input" id="${pfx}Motivo" placeholder="p. ej. la entidad redondeó el ITBMS por línea">
        </div>
        ${gob ? `
        <label style="display:flex; gap:8px; align-items:center; margin:8px 0; font-size:13.5px;">
          <input type="checkbox" id="${pfx}YaRefrendada" onchange="document.getElementById('${pfx}RefWrap').style.display=this.checked?'':'none'">
          La orden ya viene <b>refrendada</b> por la Contraloría</label>
        <div class="form-grid-2" id="${pfx}RefWrap" style="display:none;">
          <div class="form-field"><label class="form-label" for="${pfx}RefNumero">Número de refrendo</label>
            <input class="form-input" id="${pfx}RefNumero" autocomplete="off"></div>
          <div class="form-field"><label class="form-label" for="${pfx}RefFecha">Fecha del refrendo</label>
            <input class="form-input" id="${pfx}RefFecha" type="date" value="${this._hoyISO()}"></div>
        </div>` : ''}`;
  },

  // Aviso en vivo: cuadra / no cuadra. El motivo solo se le pide a
  // administración — el vendedor no puede seguir con una OC que no cuadra.
  _ocPintarCuadre(pfx, r, esp) {
    const aviso = document.getElementById(`${pfx}AvisoMonto`);
    const wrap = document.getElementById(`${pfx}MotivoWrap`);
    const hint = document.getElementById(`${pfx}Esperado`);
    if (hint && esp) hint.innerHTML = `Debe sumar <b class="num">$${esp.monto.toFixed(2)}</b> (${this.esc(esp.detalle)}).`;
    if (!aviso) return;
    if (!r || r.ok === null) { aviso.style.display = 'none'; if (wrap) wrap.style.display = 'none'; return; }
    aviso.style.display = '';
    if (r.ok) {
      aviso.innerHTML = '<span style="color:var(--cg-ok-deep, #166534);">✓ Cuadra.</span>';
      if (wrap) wrap.style.display = 'none';
      return;
    }
    const dif = `${r.diferencia > 0 ? '+' : '−'}$${Math.abs(r.diferencia).toFixed(2)}`;
    aviso.innerHTML = `<span style="color:var(--cg-bad-deep, #991B1B);"><b>No cuadra:</b> la OC difiere ${dif}
      ($${r.esperado.toFixed(2)} esperado). ${this._esAdminOC() ? 'Para seguir, escribe el motivo.' : 'Corrige el contrato (o pide a la entidad que corrija la OC) antes de registrarla; si hay un motivo válido, la registra administración.'}</span>`;
    if (wrap) wrap.style.display = this._esAdminOC() ? '' : 'none';
  },

  // Lee y valida el formulario. Devuelve los datos o null (ya avisó).
  async _ocLeerForm(pfx, cuadreDe) {
    const g = (k) => document.getElementById(`${pfx}${k}`);
    const numero = (g('Numero')?.value || '').trim();
    const fecha = g('Fecha')?.value || '';
    const montoTxt = g('Monto')?.value;
    const monto = Number(montoTxt);
    const meses = g('Meses') ? Number(g('Meses').value) : null;
    if (!numero) { Toast.show('Falta el número de la orden de compra', 'warn'); g('Numero')?.focus(); return null; }
    if (!fecha) { Toast.show('Falta la fecha de la orden', 'warn'); return null; }
    if (g('Meses') && !(meses >= 1)) { Toast.show('Indica cuántos meses cubre la OC', 'warn'); g('Meses')?.focus(); return null; }
    if (montoTxt === '' || !(monto > 0)) { Toast.show('Falta el monto de la orden de compra', 'warn'); g('Monto')?.focus(); return null; }
    const cuadre = cuadreDe(monto, meses);
    let motivoDif = '';
    if (cuadre.ok === false) {
      if (!this._esAdminOC()) {
        Toast.show(`La OC no cuadra ($${cuadre.esperado.toFixed(2)} esperado). Corrige antes de registrarla, o pide a administración que la registre con el motivo.`, 'bad', 8000);
        return null;
      }
      motivoDif = (g('Motivo')?.value || '').trim();
      if (!motivoDif) { Toast.show('La OC no cuadra: escribe el motivo para aceptarla', 'warn'); g('Motivo')?.focus(); return null; }
    }
    const yaRef = !!g('YaRefrendada')?.checked;
    const refNumero = yaRef ? (g('RefNumero')?.value || '').trim() : '';
    const refFecha = yaRef ? (g('RefFecha')?.value || '') : '';
    if (yaRef && !refNumero) { Toast.show('Falta el número de refrendo', 'warn'); g('RefNumero')?.focus(); return null; }
    let file;
    try { file = await this._ocArchivoPdf([...(g('Archivo')?.files || [])], 'orden_compra'); }
    catch (e) { Toast.show(e?.message || String(e), 'warn', 7000); return null; }
    return { numero, fecha, monto: Math.round(monto * 100) / 100, meses, cuadre, motivoDif, yaRef, refNumero, refFecha, file };
  },

  _ocDoc(f, { url, path, sector, meses = null, cubreHasta = null, ahora }) {
    const email = firebase.auth().currentUser?.email || null;
    return {
      numero: f.numero, fecha: f.fecha, monto: f.monto,
      monto_esperado: f.cuadre.esperado,
      ...(f.motivoDif ? { diferencia: f.cuadre.diferencia, diferencia_motivo: f.motivoDif } : {}),
      ...(meses ? { meses_cubiertos: meses } : {}),
      ...(cubreHasta ? { cubre_hasta: cubreHasta } : {}),
      sector, url, storage_path: path, nombre: f.file.name,
      registrada_at: ahora, registrada_por_uid: this.uid || null, registrada_por_email: email,
      refrendo: f.yaRef ? { numero: f.refNumero, fecha: f.refFecha, en_la_misma_oc: true,
        at: ahora, por_uid: this.uid || null, por_email: email } : null,
    };
  },

  /* ───────── Subir la orden de compra del contrato ───────── */

  subirOrdenCompra(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    if (!ContratoFirma.esOC(c)) { Toast.show('Este contrato se formaliza con la firma del cliente, no con orden de compra', 'warn'); return; }
    if (c.estado !== 'aprobado' || c.firmado) { Toast.show('La orden de compra se sube a un contrato APROBADO que todavía no la tiene', 'warn'); return; }
    if (ContratoFirma.dormido(c)) { Toast.show('El contrato está dormido: reactívalo primero', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('La orden de compra la sube el vendedor o administración', 'warn'); return; }
    const gob = ContratoFirma.esGobierno(c);
    const plazo = ContratoFirma.mesesContrato(c);
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
        ${this._ocFormHtml({ pfx: 'oc', esp: ContratoFirma.montoEsperadoOC(c), plazo, gob,
          onMonto: `Centro._ocRevisar('${this.esc(c.id)}')` })}`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarOrdenCompra('${this.esc(c.id)}')">Registrar la OC y activar</button>`,
    });
  },

  _ocRevisar(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const meses = Number(document.getElementById('ocMeses')?.value) || null;
    const esp = ContratoFirma.montoEsperadoOC(c, { meses });
    const v = document.getElementById('ocMonto')?.value;
    this._ocPintarCuadre('oc', v === '' || v == null ? null : ContratoFirma.cuadraOC(c, Number(v), { meses }), esp);
  },

  guardarOrdenCompra(id) {
    return this._candado('guardarOC:' + id, () => this._guardarOrdenCompra(id), 'Subiendo…');
  },
  async _guardarOrdenCompra(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    if (!ContratoFirma.esOC(c) || c.estado !== 'aprobado' || c.firmado) { Toast.show('Este contrato ya no espera la orden de compra', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('La orden de compra la sube el vendedor o administración', 'warn'); return; }
    const f = await this._ocLeerForm('oc', (monto, meses) => ContratoFirma.cuadraOC(c, monto, { meses }));
    if (!f) return;
    const gob = ContratoFirma.esGobierno(c);
    const plazo = ContratoFirma.mesesContrato(c);
    const parcial = plazo && f.meses && f.meses < plazo;
    const legible = c.contrato_id || id;
    const ok = await Modal.confirm({
      title: 'Registrar la OC y activar', confirmLabel: 'Registrar y activar',
      message: `OC <b>${this.esc(f.numero)}</b> por <b>$${f.monto.toFixed(2)}</b> para el contrato <b class="cg-mono">${this.esc(legible)}</b>.
        <br><br><b>Esto ACTIVA el contrato y arranca la facturación y la comisión.</b>
        ${parcial ? `<br><br>La OC cubre <b>${f.meses} de ${plazo} meses</b>: antes de que venza, el Centro te pedirá la OC siguiente.` : ''}
        ${gob && !f.yaRef ? '<br><br>El refrendo queda pendiente: regístralo cuando llegue (no frena la entrega).' : ''}
        ${this._serialesListos(c) ? '' : '<br><br>Ojo: bodega todavía no asignó los seriales de este contrato.'}`,
    });
    if (!ok) return;
    try {
      Toast.show('Subiendo la orden de compra…', '');
      const { path, url } = await this._ocSubirStorage({ carpeta: 'contratos_firmados', legible, file: f.file, sufijo: 'OC',
        meta: { contrato_doc_id: c.id, contrato_id: legible } });
      const ahora = firebase.firestore.Timestamp.now();
      const meses = plazo ? (f.meses || plazo) : null;
      const cubreHasta = meses ? ContratoFirma.sumarMeses(new Date(), meses) : null;
      // La misma vía que el firmado (rules::esActivacionPorFirmado): firmado +
      // firmado_url desde 'aprobado' → 'activo', admin o vendedor.
      await ContratosService.updateContrato(id, {
        firmado: true, firmado_tipo: 'orden_compra',
        firmado_url: url, firmado_nombre: f.file.name, firmado_storage_path: path,
        firmado_fecha: ahora, firmado_por_uid: this.uid || null,
        orden_compra: this._ocDoc(f, { url, path, sector: gob ? 'gobierno' : 'corporativo', meses, cubreHasta, ahora }),
        ...(meses ? { oc_meses_cubiertos: meses } : {}),
        estado_previo: c.estado, estado: 'activo', fecha_activacion: ahora,
      });
      this._cerrarModal();
      Toast.show(`Contrato ${legible} ACTIVO con la OC ${f.numero}${gob && !f.yaRef ? ' — falta el refrendo' : ''}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar la orden de compra: ' + (e?.message || e), 'bad', 8000);
    }
  },

  /* ───────── OC SIGUIENTE (la anterior cubría solo parte del plazo) ───────── */

  registrarOCSiguiente(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.ocParcial(c)) { Toast.show('Este contrato no tiene meses sin orden de compra', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('La orden de compra la sube el vendedor o administración', 'warn'); return; }
    const plazo = ContratoFirma.mesesContrato(c);
    const resto = plazo - ContratoFirma.mesesCubiertosOC(c);
    const gob = ContratoFirma.esGobierno(c);
    this._abrirModalA({
      banda: false,
      titulo: `OC siguiente — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          La OC vigente (<b>${this.esc(c.orden_compra?.numero || '')}</b>) cubre ${ContratoFirma.mesesCubiertosOC(c)} de ${plazo} meses
          ${c.orden_compra?.cubre_hasta ? `— hasta el <b>${this.esc(this._fechaCorta(c.orden_compra.cubre_hasta))}</b>` : ''}.
          Faltan <b>${resto} mes(es)</b>. La OC siguiente se cuadra solo contra mensualidades; la anterior queda en el historial.</p>
        ${this._ocFormHtml({ pfx: 'ocs', esp: ContratoFirma.montoEsperadoOC(c, { meses: resto, siguiente: true }),
          plazo: resto, mesesDefault: Math.min(12, resto), gob, notaMeses: `Quedan ${resto} mes(es) del contrato.`,
          onMonto: `Centro._ocsRevisar('${this.esc(c.id)}')` })}`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarOCSiguiente('${this.esc(c.id)}')">Registrar la OC siguiente</button>`,
    });
    setTimeout(() => this._ocsRevisar(c.id), 80);
  },

  _ocsRevisar(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c) return;
    const meses = Number(document.getElementById('ocsMeses')?.value) || null;
    const esp = ContratoFirma.montoEsperadoOC(c, { meses, siguiente: true });
    const v = document.getElementById('ocsMonto')?.value;
    this._ocPintarCuadre('ocs', v === '' || v == null ? null : ContratoFirma.cuadraOC(c, Number(v), { meses, siguiente: true }), esp);
  },

  guardarOCSiguiente(id) {
    return this._candado('guardarOCs:' + id, () => this._guardarOCSiguiente(id), 'Subiendo…');
  },
  async _guardarOCSiguiente(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.ocParcial(c)) { Toast.show('Este contrato ya no tiene meses sin orden de compra', 'warn'); return; }
    const f = await this._ocLeerForm('ocs', (monto, meses) => ContratoFirma.cuadraOC(c, monto, { meses, siguiente: true }));
    if (!f) return;
    const plazo = ContratoFirma.mesesContrato(c);
    const resto = plazo - ContratoFirma.mesesCubiertosOC(c);
    const meses = Math.min(f.meses || resto, resto);
    try {
      Toast.show('Subiendo la OC siguiente…', '');
      const legible = c.contrato_id || id;
      const { path, url } = await this._ocSubirStorage({ carpeta: 'contratos_firmados', legible, file: f.file, sufijo: 'OC',
        meta: { contrato_doc_id: c.id, contrato_id: legible } });
      const ahora = firebase.firestore.Timestamp.now();
      // La nueva arranca donde terminaba la anterior (o hoy, si ya venció).
      const finAnt = c.orden_compra?.cubre_hasta ? new Date(`${c.orden_compra.cubre_hasta}T12:00:00-05:00`) : new Date();
      const desde = finAnt > new Date() ? finAnt : new Date();
      const gob = ContratoFirma.esGobierno(c);
      await ContratosService.updateContrato(id, {
        orden_compra: this._ocDoc(f, { url, path, sector: gob ? 'gobierno' : 'corporativo', meses,
          cubreHasta: ContratoFirma.sumarMeses(desde, meses), ahora }),
        oc_meses_cubiertos: ContratoFirma.mesesCubiertosOC(c) + meses,
        ordenes_compra_anteriores: firebase.firestore.FieldValue.arrayUnion({ ...c.orden_compra, archivada_at: ahora }),
        firmado_url: url, firmado_nombre: f.file.name, firmado_storage_path: path,
        ...(c.firmado_url ? { firmado_historial: firebase.firestore.FieldValue.arrayUnion({
          firmado_url: c.firmado_url || null, firmado_nombre: c.firmado_nombre || null,
          firmado_storage_path: c.firmado_storage_path || null, firmado_fecha: c.firmado_fecha || null,
          firmado_por_uid: c.firmado_por_uid || null,
          reemplazado_at: ahora, reemplazado_por_uid: this.uid || null, reemplazado_por: url,
          motivo: 'orden de compra siguiente',
        }) } : {}),
      });
      this._cerrarModal();
      Toast.show(`OC ${f.numero} registrada — cubre ${meses} mes(es) más`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar la OC siguiente: ' + (e?.message || e), 'bad', 8000);
    }
  },

  /* ───────── Registrar el refrendo (gobierno) — contrato o anexo ───────── */

  _refrendoModal({ titulo, nota, onGuardar }) {
    this._abrirModalA({
      banda: false, titulo,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">${nota}</p>
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
        <button class="btn btn-primary" onclick="${onGuardar}">Registrar el refrendo</button>`,
    });
  },

  async _refrendoLeer() {
    const g = (k) => document.getElementById(k);
    const numero = (g('refNumero')?.value || '').trim();
    const fecha = g('refFecha')?.value || '';
    if (!numero) { Toast.show('Falta el número de refrendo', 'warn'); g('refNumero')?.focus(); return null; }
    if (!fecha) { Toast.show('Falta la fecha del refrendo', 'warn'); return null; }
    try { return { numero, fecha, file: await this._ocArchivoPdf([...(g('refArchivo')?.files || [])], 'oc_refrendada') }; }
    catch (e) { Toast.show(e?.message || String(e), 'warn', 7000); return null; }
  },

  registrarRefrendo(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.refrendoPendiente(c)) { Toast.show('Este contrato no tiene un refrendo pendiente', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('El refrendo lo registra el vendedor o administración', 'warn'); return; }
    this._refrendoModal({
      titulo: `Refrendo de la OC ${this.esc(c.orden_compra?.numero || '')} — <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      nota: `Sube la orden de compra con el <b>sello de refrendo de la Contraloría</b>. Pasa a ser el documento del
          expediente; la OC sin refrendo queda archivada en el historial (no se borra).`,
      onGuardar: `Centro.guardarRefrendo('${this.esc(c.id)}')`,
    });
  },

  guardarRefrendo(id) {
    return this._candado('guardarRefrendo:' + id, () => this._guardarRefrendo(id), 'Subiendo…');
  },
  async _guardarRefrendo(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!c || !ContratoFirma.refrendoPendiente(c)) { Toast.show('Este contrato ya no tiene el refrendo pendiente', 'warn'); return; }
    const r = await this._refrendoLeer();
    if (!r) return;
    try {
      Toast.show('Subiendo la OC refrendada…', '');
      const legible = c.contrato_id || id;
      const { path, url } = await this._ocSubirStorage({ carpeta: 'contratos_firmados', legible, file: r.file, sufijo: 'OC_refrendada',
        meta: { contrato_doc_id: c.id, contrato_id: legible } });
      const ahora = firebase.firestore.Timestamp.now();
      const update = {
        'orden_compra.refrendo': {
          numero: r.numero, fecha: r.fecha, url, storage_path: path, nombre: r.file.name,
          at: ahora, por_uid: this.uid || null, por_email: firebase.auth().currentUser?.email || null,
        },
        firmado_url: url, firmado_nombre: r.file.name, firmado_storage_path: path,
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
      Toast.show(`Refrendo ${r.numero} registrado en ${legible}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar el refrendo: ' + (e?.message || e), 'bad', 8000);
    }
  },

  /* ───────── ANEXO DE AUMENTO con orden de compra ───────── */

  subirOCAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || !ContratoFirma.anexoEsOC(g) || g.estado !== 'pendiente_firma') { Toast.show('Este anexo no espera una orden de compra', 'warn'); return; }
    if (g.dormido === true) { Toast.show('El anexo está dormido: reactívalo primero', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('La orden de compra la sube el vendedor o administración', 'warn'); return; }
    const gob = ContratoFirma.anexoEsGobierno(g);
    const a = g.aumento || {};
    this._abrirModalA({
      banda: false,
      titulo: `OC del anexo — <span class="cg-mono">${this.esc(a.contrato_id || '')}</span>`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          ${gob ? 'Cliente de <b>gobierno</b>' : 'Cliente <b>corporativo</b>'}: la orden de compra del aumento ocupa el lugar
          del anexo firmado. Al registrarla, el sistema aplica las líneas al contrato y avisa a bodega; la entrega queda habilitada.
          ${gob ? 'El refrendo puede llegar después y no frena la entrega.' : ''}</p>
        ${this._ocFormHtml({ pfx: 'oca', esp: ContratoFirma.montoEsperadoAnexoOC(g), plazo: Number(a.duracion_meses) || null, gob,
          notaMeses: `El anexo es a ${Number(a.duracion_meses) || '—'} meses. Si la OC cubre menos (año fiscal), pon los que cubre.`,
          onMonto: `Centro._ocaRevisar('${this.esc(g.id)}')` })}`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarOCAnexo('${this.esc(g.id)}')">Registrar la OC del anexo</button>`,
    });
  },

  _ocaRevisar(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g) return;
    const meses = Number(document.getElementById('ocaMeses')?.value) || null;
    const esp = ContratoFirma.montoEsperadoAnexoOC(g, { meses });
    const v = document.getElementById('ocaMonto')?.value;
    this._ocPintarCuadre('oca', v === '' || v == null ? null : ContratoFirma.cuadraAnexoOC(g, Number(v), { meses }), esp);
  },

  guardarOCAnexo(gid) {
    return this._candado('guardarOCAnexo:' + gid, () => this._guardarOCAnexo(gid), 'Subiendo…');
  },
  async _guardarOCAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || !ContratoFirma.anexoEsOC(g) || g.estado !== 'pendiente_firma') { Toast.show('Este anexo ya no espera la orden de compra', 'warn'); return; }
    const f = await this._ocLeerForm('oca', (monto, meses) => ContratoFirma.cuadraAnexoOC(g, monto, { meses }));
    if (!f) return;
    try {
      Toast.show('Subiendo la OC del anexo…', '');
      const { path, url } = await this._ocSubirStorage({ carpeta: `gestiones_anexos/${gid}`, legible: 'anexo', file: f.file, sufijo: 'OC',
        meta: { gestion_id: gid } });
      const ahora = firebase.firestore.Timestamp.now();
      const email = firebase.auth().currentUser?.email || null;
      // Misma transición que el anexo firmado (rules::esFirmaAnexoGestion):
      // pendiente_firma → pendiente_bodega + cierre.firma — B3 aplica las líneas.
      await firebase.firestore().collection('gestiones').doc(gid).update({
        estado: 'pendiente_bodega',
        'cierre.firma': true,
        anexo_firmado_path: path,
        anexo_firmado_at: firebase.firestore.FieldValue.serverTimestamp(),
        anexo_firmado_por: email,
        anexo_firmado_tipo: 'orden_compra',
        orden_compra: this._ocDoc(f, { url, path, sector: ContratoFirma.anexoEsGobierno(g) ? 'gobierno' : 'corporativo',
          meses: f.meses || null, ahora }),
      });
      await GestionesService.registrarEvento(gid, 'firma',
        `Orden de compra ${f.numero} ($${f.monto.toFixed(2)}) registrada en lugar del anexo firmado — el sistema aplica las líneas al contrato y avisa a Bodega.`);
      this._cerrarModal();
      Toast.show(`OC ${f.numero} registrada — el sistema aplica las líneas y avisa a Bodega`, 'ok');
      await this.recargarGestiones();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar la OC del anexo: ' + (e?.message || e), 'bad', 8000);
    }
  },

  registrarRefrendoAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || !ContratoFirma.anexoRefrendoPendiente(g)) { Toast.show('Este anexo no tiene un refrendo pendiente', 'warn'); return; }
    if (!this._puedeSubirOC()) { Toast.show('El refrendo lo registra el vendedor o administración', 'warn'); return; }
    this._refrendoModal({
      titulo: `Refrendo de la OC ${this.esc(g.orden_compra?.numero || '')} — anexo`,
      nota: 'Sube la orden de compra del anexo con el <b>sello de refrendo de la Contraloría</b>. La OC sin refrendo queda en el expediente.',
      onGuardar: `Centro.guardarRefrendoAnexo('${this.esc(g.id)}')`,
    });
  },

  guardarRefrendoAnexo(gid) {
    return this._candado('guardarRefrendoAnexo:' + gid, () => this._guardarRefrendoAnexo(gid), 'Subiendo…');
  },
  async _guardarRefrendoAnexo(gid) {
    const g = (this.gestiones || []).find(x => x.id === gid);
    if (!g || !ContratoFirma.anexoRefrendoPendiente(g)) { Toast.show('Este anexo ya no tiene el refrendo pendiente', 'warn'); return; }
    const r = await this._refrendoLeer();
    if (!r) return;
    try {
      Toast.show('Subiendo la OC refrendada…', '');
      const { path, url } = await this._ocSubirStorage({ carpeta: `gestiones_anexos/${gid}`, legible: 'anexo', file: r.file,
        sufijo: 'OC_refrendada', meta: { gestion_id: gid } });
      // Solo orden_compra.refrendo (rules::esRefrendoAnexoGestion).
      await firebase.firestore().collection('gestiones').doc(gid).update({
        'orden_compra.refrendo': {
          numero: r.numero, fecha: r.fecha, url, storage_path: path, nombre: r.file.name,
          at: firebase.firestore.Timestamp.now(), por_uid: this.uid || null, por_email: firebase.auth().currentUser?.email || null,
        },
      });
      await GestionesService.registrarEvento(gid, 'firma', `Refrendo ${r.numero} de la OC ${g.orden_compra?.numero || ''} registrado.`);
      this._cerrarModal();
      Toast.show(`Refrendo ${r.numero} registrado`, 'ok');
      await this.recargarGestiones();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo registrar el refrendo: ' + (e?.message || e), 'bad', 8000);
    }
  },

  /* ───────── Cambio puntual en UN contrato: firma ↔ orden de compra ───────── */

  // Solo contratos EN TRÁMITE (ContratoFirma.enTramiteFormalizacion): el
  // histórico 'aprobado' sin firma no se toca — ofrecerle OC lo activaría.
  _puedeCambiarFormalizacion(c) { return ContratoFirma.enTramiteFormalizacion(c); },

  cambiarFormalizacion(id) {
    const c = this.contratos.find(x => x.id === id);
    if (!this._puedeCambiarFormalizacion(c)) { Toast.show('Solo se cambia en un contrato que todavía está en trámite', 'warn'); return; }
    const actual = ContratoFirma.claveFormalizacion(c);
    const delCliente = this.cliente?.formalizacion_contrato || 'firma';
    const op = (k, label) => `<option value="${k}" ${k === actual ? 'selected' : ''}>${label}${k === delCliente ? ' — la del cliente' : ''}</option>`;
    this._abrirModalA({
      banda: false,
      titulo: `Cómo se formaliza <span class="cg-mono">${this.esc(c.contrato_id || c.id)}</span>`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          Por defecto cada contrato se formaliza como dice el perfil del cliente. Aquí se cambia <b>solo este contrato</b>.
          ${c.firma_solicitud_estado === 'pendiente' ? '<br><br><b>Ojo:</b> tiene un enlace de firma enviado; si pasa a orden de compra, el enlace se retira.' : ''}</p>
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
      const retirar = !!f && c.firma_solicitud_estado === 'pendiente' && !!c.firma_solicitud_id;
      if (retirar) {
        await firebase.firestore().collection('firma_solicitudes').doc(c.firma_solicitud_id).update({ estado: 'cancelado' });
      }
      await ContratosService.updateContrato(id, {
        formalizacion, ...(retirar ? { firma_solicitud_estado: 'cancelado' } : {}),
      });
      this._cerrarModal();
      Toast.show(`${c.contrato_id || id}: se formaliza con ${f ? f.label.toLowerCase() : 'la firma del cliente'}`, 'ok');
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cambiar: ' + (e?.message || e), 'bad');
    }
  },

  /* ───────── Perfil del cliente: cómo formaliza sus contratos ───────── */

  // Abierto al VENDEDOR (2026-11-18): es quien conoce si la entidad trabaja con
  // OC. Toca un solo campo de la ficha (no es de identidad: rules lo dejan) y
  // queda en el historial. Antes de guardar dice qué contratos cambian y
  // cuáles no se tocan — el cambio nunca daña lo que ya existe.
  _puedeFormalizacionCliente() { return [ROLES.ADMIN, 'admin', ROLES.GERENTE, ROLES.RECEPCION, ROLES.VENDEDOR].includes(this.rol); },

  formalizacionCliente() {
    if (!this._puedeFormalizacionCliente()) { Toast.show('Lo cambia ventas, recepción o administración', 'warn'); return; }
    const actual = this.cliente?.formalizacion_contrato || 'firma';
    const F = ClientesService.FORMALIZACIONES;
    this._abrirModalA({
      banda: false,
      titulo: `Cómo formaliza sus contratos — ${this.esc(this.cliente?.nombre || '')}`,
      cuerpo: `
        <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:66ch;">
          Con <b>orden de compra</b>, en lugar de mandar el contrato a firmar se sube la OC de la entidad
          (en gobierno, refrendada por la Contraloría; el refrendo puede llegar después). Aplica a los contratos,
          renovaciones y anexos <b>nuevos</b>, y a los que están en trámite. Lo firmado, lo activo y lo histórico <b>no se tocan</b>.</p>
        <div class="form-field"><label class="form-label" for="fcTipo">Formaliza los contratos con</label>
          <select class="form-select" id="fcTipo" onchange="Centro._fcPlan()">
            ${Object.entries(F).map(([k, l]) => `<option value="${k}" ${k === actual ? 'selected' : ''}>${this.esc(l)}</option>`).join('')}
          </select></div>
        <div id="fcPlan" style="font-size:13px; margin-top:8px;"></div>`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="Centro.guardarFormalizacionCliente()">Guardar</button>`,
    });
    setTimeout(() => this._fcPlan(), 60);
  },

  _fcPlan() {
    const el = document.getElementById('fcPlan');
    const clave = document.getElementById('fcTipo')?.value;
    if (!el || !clave) return;
    if (clave === (this.cliente?.formalizacion_contrato || 'firma')) { el.innerHTML = '<span style="color:var(--fg-3);">Es lo que tiene hoy.</span>'; return; }
    el.innerHTML = ClientesService.planFormalizacionHtml(ClientesService.planFormalizacion(this.contratos, clave), (v) => this.esc(v));
  },

  guardarFormalizacionCliente() {
    return this._candado('formalizacionCliente', () => this._guardarFormalizacionCliente());
  },
  async _guardarFormalizacionCliente() {
    const clave = document.getElementById('fcTipo')?.value || 'firma';
    if (clave === (this.cliente?.formalizacion_contrato || 'firma')) { this._cerrarModal(); return; }
    try {
      // El plan se rehace contra el servidor: lo que hay en pantalla puede ser viejo.
      const contratos = await ClientesService.contratosDeCliente(this.cliente.id);
      const plan = ClientesService.planFormalizacion(contratos, clave);
      const k = await ClientesService.aplicarFormalizacion(this.cliente.id, clave, plan);
      this.cliente.formalizacion_contrato = clave;
      this._cerrarModal();
      Toast.show(`${this.cliente.nombre || 'Cliente'}: ${ClientesService.FORMALIZACIONES[clave].toLowerCase()}${k ? ` · ${k} contrato(s) en trámite cambiaron` : ''}`, 'ok', 7000);
      await this.abrir(this.cliente.id, { push: false });
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo guardar: ' + (e?.message || e), 'bad');
    }
  },
});
