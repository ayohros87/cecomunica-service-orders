// @ts-nocheck
// Centro de gestión de clientes — Expediente legal del cliente (2026-11-25).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
//
// El problema (Zuleika, 2026-11-25): los documentos del cliente llegan por
// correo al vendedor y nadie los sube; la pestaña Documentos era una lista de
// archivos que no decía qué falta. Censo de ese día: 20 de 278 clientes
// activos con algún documento, 8 con los tres.
//
// Qué hace este archivo:
//   · La pestaña Documentos abre con los TRES que pide administración y el
//     estado de cada uno (js/domain/expedienteCliente.js), y debajo los archivos.
//   · "Pedir documentos al cliente": genera un enlace (/documentos/?s=…) para
//     copiar a WhatsApp o enviar por correo. El cliente sube sin usuario y el
//     archivo cae aquí como "por revisar".
//   · Cobros (rol recepción) abre lo que subió el cliente y lo marca revisado
//     o lo rechaza con motivo.
//   · No tranca nada: es un aviso. El contrato se aprueba, se firma y se
//     activa igual con el expediente incompleto (decisión de Alberto).
Object.assign(window.Centro, {
  // Mismos roles que la regla de documentos_solicitudes. El vendedor no puede
  // ABRIR los documentos (getClienteDocUrl), pero es quien se los pide al
  // cliente: sí genera el enlace y ve qué falta.
  _puedePedirDocs() { return [ROLES.ADMIN, 'admin', ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION].includes(this.rol); },

  // Estado del expediente del cliente abierto. Con la pestaña ya cargada manda
  // lo que se acaba de leer; si no, el resumen que el trigger deja en la ficha.
  _expediente() {
    const c = this.cliente;
    if (!c || !window.ExpedienteCliente) return null;
    if (this._docsResumen && this._docsResumenDe === c.id) return this._docsResumen;
    return ExpedienteCliente.leer(c.expediente);
  },

  // "Faltan 2: Aviso de Operación / Registro Público y Recibo de servicio"
  _expedienteFrase(e) {
    if (!e) return '';
    if (e.completo) return 'Completo';
    const partes = [];
    if (e.faltan.length) partes.push(`Falta${e.faltan.length === 1 ? '' : 'n'} ${e.faltan.length} de 3: ${ExpedienteCliente.fraseFaltan(e.faltan)}`);
    if (e.por_revisar) partes.push(`${e.por_revisar} por revisar`);
    return partes.join(' · ');
  },

  // Renglón "Documentos" de la tarjeta Contacto (pintarContacto). Todos los
  // roles ven el estado; solo quien puede abrir el expediente tiene la pestaña.
  _docsContactoHtml() {
    const e = this._expediente();
    if (!e) return '';
    const frase = this.esc(this._expedienteFrase(e));
    const tono = e.completo ? 'var(--cg-ok-deep, #065F46)' : 'var(--cg-warn-deep, #92400E)';
    const estado = `<span style="color:${tono};">${frase}</span>`;
    const ver = this._puedeVerDocs()
      ? ` · <a href="#documentos" onclick="event.preventDefault(); Centro.abrirBloque('blkDocumentos')">${this._docsN ? `ver ${this._docsN} archivo${this._docsN === 1 ? '' : 's'}` : 'ver el expediente'}</a>`
      : '';
    const pedir = !e.completo && e.faltan.length && this._puedePedirDocs()
      ? ` · <a href="#pedir" onclick="event.preventDefault(); Centro.pedirDocumentos()">pedirlos al cliente</a>`
      : '';
    return estado + ver + pedir;
  },

  // Aviso en "Enviar para firma" (centro-firma.js). No tranca: el contrato
  // se firma igual; al terminar de firmar, la misma página le ofrece al
  // cliente subir lo que falta.
  _avisoExpedienteFirmaHtml() {
    const e = this._expediente();
    if (!e || !e.faltan.length) return '';
    return `<p style="margin:12px 0 0; padding:9px 12px; border-radius:8px; font-size:12.5px; line-height:1.45; background:var(--cg-warn-soft); color:var(--cg-warn-deep);">
      <b>Al expediente le falta${e.faltan.length === 1 ? '' : 'n'}:</b> ${this.esc(ExpedienteCliente.fraseFaltan(e.faltan))}.
      No frena la firma: al terminar de firmar, esta misma página le ofrece al cliente subir${e.faltan.length === 1 ? 'lo' : 'los'}.</p>`;
  },

  // ── Pestaña Documentos ────────────────────────────────────────────────
  _docsDe: null,
  _docsN: null,
  _docs: null,
  _docsSol: null,
  _docsResumen: null,
  _docsResumenDe: null,

  async pintarDocumentos(forzar = false) {
    const cont = document.getElementById('fDocumentos');
    const c = this.cliente;
    if (!cont || !c || !this._puedeVerDocs()) return;
    if (!forzar && this._docsDe === c.id) return;
    this._docsDe = c.id;
    if (!forzar) cont.innerHTML = `<div class="cg-vacio">Cargando documentos…</div>`;
    try {
      const [docs, sol] = await Promise.all([
        ClienteDocumentosService.list(c.id),
        this._puedePedirDocs() ? ClienteDocumentosService.solicitudVigente(c.id).catch(() => null) : null,
      ]);
      if (this.cliente?.id !== c.id) return;
      this._docs = docs;
      this._docsSol = sol;
      this._docsN = docs.length;
      this._docsResumen = ExpedienteCliente.resumen(docs);
      this._docsResumenDe = c.id;
      this._docsRender();
    } catch (err) {
      console.error('[centro] documentos:', err);
      cont.innerHTML = `<p style="color:#b91c1c; font-size:13px;">No se pudieron cargar los documentos: ${this.esc(err?.message || err)}</p>`;
    }
  },

  _docsRender() {
    const cont = document.getElementById('fDocumentos');
    const c = this.cliente;
    if (!cont || !c) return;
    const docs = this._docs || [];
    const e = this._docsResumen || ExpedienteCliente.resumen(docs);
    const n = document.getElementById('nDocumentos');
    if (n) n.textContent = docs.length ? String(docs.length) : '';
    const urlSubir = `./ficha.html?id=${encodeURIComponent(c.id)}&from=centro&seccion=documentos`;
    const ICONO = { ok: 'check-circle', por_revisar: 'clock', falta: 'circle' };
    const TEXTO = { ok: 'En el expediente', por_revisar: 'Lo subió el cliente — falta revisarlo', falta: 'Falta' };
    const requisitos = ExpedienteCliente.REQUISITOS.map(q => `
      <div class="cg-req cg-req--${e[q.id]}">
        <i data-lucide="${ICONO[e[q.id]]}"></i>
        <div class="t"><b>${this.esc(q.label)}</b><span>${TEXTO[e[q.id]]}</span></div>
      </div>`).join('');
    const pedir = this._puedePedirDocs();
    const aviso = e.completo
      ? `<div class="cg-docs-aviso is-ok"><span><b>Expediente completo.</b> Están los tres documentos que pide administración.</span>
          ${pedir ? `<button type="button" class="btn btn-ghost cg-act" onclick="Centro.pedirDocumentos()">Pedir uno actualizado</button>` : ''}</div>`
      : `<div class="cg-docs-aviso"><span><b>${this.esc(this._expedienteFrase(e))}.</b>
            ${e.faltan.length ? 'El cliente los puede subir desde su celular con un enlace; no hace falta que los mande por correo.' : 'Ábrelos y márcalos como revisados.'}</span>
          ${pedir && e.faltan.length ? `<button type="button" class="btn btn-primary cg-act" onclick="Centro.pedirDocumentos()"><i data-lucide="link"></i> Pedir documentos al cliente</button>` : ''}</div>`;
    const sol = this._docsSol;
    const enlace = sol ? `<div class="cg-docs-enlace">
        <i data-lucide="link"></i>
        <span>Hay un <b>enlace de carga abierto</b>${sol.creado_por_email ? `, lo pidió ${this.esc(String(sol.creado_por_email).split('@')[0])}` : ''}${sol.creado_at ? ` el ${this.esc(this._fmtFecha(sol.creado_at))}` : ''}
          · vence el ${this.esc(this._fmtFecha(sol.vence_at))}${sol.enviado_a ? ` · enviado a ${this.esc(sol.enviado_a)}` : ''}${this._solRecibidosTxt(sol)}</span>
        <button type="button" class="btn btn-ghost cg-act" onclick="Centro.pedirDocumentos()">Ver el enlace</button>
      </div>` : '';
    cont.innerHTML = `
      ${aviso}
      <div class="cg-reqs">${requisitos}</div>
      ${enlace}
      <h3 class="cg-docs-h">Archivos${docs.length ? ` <span>${docs.length}</span>` : ''}</h3>
      <p class="cg-docs-nota">Cada archivo se abre con un enlace que vence a los 5 minutos y queda registrado en la auditoría de PII.</p>
      <div id="cgDocsList">${docs.length ? docs.map(d => this._docFilaExpHtml(d)).join('') : `<div class="cg-vacio">No hay documentos cargados para este cliente.</div>`}</div>
      <p style="margin:12px 0 0; font-size:12.5px;"><a href="${urlSubir}">Cargar un documento que ya tienes ›</a></p>`;
    this.pintarContacto();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  _solRecibidosTxt(sol) {
    const ids = Object.keys(sol?.recibidos || {});
    if (!ids.length) return '';
    return ` · ya recibió: ${this.esc(ExpedienteCliente.fraseFaltan(ids))}`;
  },

  // Fila de un archivo con su procedencia y, si lo subió el cliente y nadie lo
  // ha abierto, las dos salidas: revisado o rechazado.
  _docFilaExpHtml(d) {
    const kb = Number(d.size) || 0;
    const tam = !kb ? '' : kb < 1024 * 1024 ? `${Math.round(kb / 1024)} KB` : `${(kb / 1024 / 1024).toFixed(1)} MB`;
    const f = d.subido_en ? this._fmtFechaHora(d.subido_en) : '';
    const o = d.origen || {};
    const rev = d.revision || null;
    const porRevisar = rev?.estado === 'pendiente';
    let procedencia = '';
    if (o.cedula_de_firma) procedencia = `Tomada al firmar${o.nombre ? `, por ${o.nombre}` : ''}`;
    else if (o.cliente) procedencia = `Subido por el cliente${o.nombre ? ` (${o.nombre})` : ''}`;
    else if (o.firma_solicitud) procedencia = `Adjunto a la firma${o.firmante ? ` de ${o.firmante}` : ''}`;
    const revisado = rev?.estado === 'ok'
      ? `Revisado${rev.por_email ? ` por ${String(rev.por_email).split('@')[0]}` : ''}${rev.at ? ` el ${this._fmtFecha(rev.at)}` : ''}` : '';
    const meta = [d.nombre_archivo || '', tam, f, procedencia, revisado].filter(Boolean).map(x => this.esc(x)).join(' · ');
    const id = this.esc(d.id);
    return `<div class="cg-doc${porRevisar ? ' is-rev' : ''}">
      <i data-lucide="${(d.content_type || '').includes('pdf') ? 'file-text' : 'camera'}"></i>
      <div class="t">
        <div class="n">${this.esc(ClienteDocumentosService.labelFor(d.tipo))}${porRevisar ? ` <span class="cg-chip cg-chip--warn">Por revisar</span>` : ''}</div>
        <div class="m">${meta}</div>
      </div>
      <div class="a">
        <button type="button" class="btn btn-ghost cg-act" onclick="Centro.verDocumento('${id}', this)">Ver</button>
        ${porRevisar ? `<button type="button" class="btn btn-primary cg-act" onclick="Centro.revisarDocumento('${id}', this)">Marcar revisado</button>
        <button type="button" class="btn btn-ghost cg-act" style="color:var(--cg-bad-deep, #991B1B);" onclick="Centro.rechazarDocumento('${id}')">Rechazar</button>` : ''}
      </div>
    </div>`;
  },

  async revisarDocumento(docId, btn) {
    if (!this.cliente || !this._puedeVerDocs()) return;
    if (btn) btn.disabled = true;
    try {
      await ClienteDocumentosService.marcarRevisado(this.cliente.id, docId);
      Toast.show('Documento revisado: ya cuenta para el expediente.', 'ok');
      await this.pintarDocumentos(true);
    } catch (e) {
      console.error(e);
      if (btn) btn.disabled = false;
      Toast.show('No se pudo marcar: ' + (e?.message || e), 'bad');
    }
  },

  async rechazarDocumento(docId) {
    if (!this.cliente || !this._puedeVerDocs()) return;
    const d = (this._docs || []).find(x => x.id === docId);
    const motivo = await Modal.prompt({
      title: 'Rechazar el documento', confirmLabel: 'Rechazar', multiline: true,
      message: `"${d?.nombre_archivo || ClienteDocumentosService.labelFor(d?.tipo)}" sale del expediente y ese documento vuelve a quedar en falta; el archivo se conserva para auditoría. Después pídeselo de nuevo al cliente con el enlace. Motivo (queda registrado):`,
    });
    if (motivo === null || motivo === undefined) return;
    if (String(motivo).trim().length < 5) { Toast.show('Escribe el motivo (5 letras o más).', 'warn'); return; }
    try {
      await ClienteDocumentosService.rechazar(this.cliente.id, docId, motivo);
      Toast.show('Documento rechazado. Pídeselo de nuevo al cliente.', 'ok');
      await this.pintarDocumentos(true);
    } catch (e) { console.error(e); Toast.show('No se pudo rechazar: ' + (e?.message || e), 'bad'); }
  },

  // ── Pedir documentos al cliente ───────────────────────────────────────
  // Con un enlace vivo se muestra ese (uno por cliente: dos enlaces abiertos
  // son dos correos distintos que el cliente no sabe cuál usar). Sin enlace,
  // primero se elige qué pedir.
  async pedirDocumentos() {
    const c = this.cliente;
    if (!c) return;
    if (!this._puedePedirDocs()) { Toast.show('El enlace lo pide el vendedor, Cobros o administración.', 'warn'); return; }
    this._cerrarAcciones?.();
    let sol = null;
    try { sol = await ClienteDocumentosService.solicitudVigente(c.id); }
    catch (e) { console.error(e); Toast.show('No se pudo consultar el enlace: ' + (e?.message || e), 'bad'); return; }
    if (this.cliente?.id !== c.id) return;
    this._docsSol = sol;
    if (sol) { this._modalEnlaceDocs(sol); return; }
    const e = this._expediente();
    const NOTA = {
      ok: 'ya está en el expediente — márcalo solo si necesitas uno actualizado',
      por_revisar: 'el cliente ya lo subió y falta revisarlo',
      falta: 'falta',
    };
    const filas = ExpedienteCliente.REQUISITOS.map(q => `
      <label class="cg-pedir">
        <input type="checkbox" name="cgPide" value="${q.id}"${e[q.id] === 'falta' ? ' checked' : ''}>
        <span><b>${this.esc(q.label)}</b><small>${NOTA[e[q.id]]}</small></span>
      </label>`).join('');
    this._abrirModalA({
      titulo: 'Pedir documentos al cliente',
      banda: false,
      size: 'md',
      cuerpo: `<p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:62ch;">
          Se genera un enlace para <b>${this.esc(c.nombre || '')}</b>. Quien lo abra sube una foto o un PDF de cada
          documento desde el celular, <b>sin usuario</b>. El enlace solo sirve para cargar (no deja ver nada del
          expediente) y vence a los ${ExpedienteCliente.DIAS_ENLACE} días. Lo que suba queda <b>por revisar</b> y se le avisa a Cobros.</p>
        <div class="cg-pedir-lista">${filas}</div>`,
      footer: `<button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <span class="sep"></span>
        <button class="btn btn-primary" id="cgPedirBtn" onclick="Centro._crearEnlaceDocs()">Generar el enlace</button>`,
    });
  },

  async _crearEnlaceDocs() {
    const c = this.cliente;
    if (!c) return;
    const pide = [...document.querySelectorAll('#cgModal input[name="cgPide"]:checked')].map(x => x.value);
    if (!pide.length) { Toast.show('Marca al menos un documento.', 'warn'); return; }
    const btn = document.getElementById('cgPedirBtn');
    if (btn) btn.disabled = true;
    try {
      const sid = await ClienteDocumentosService.crearSolicitud({ clienteId: c.id, clienteNombre: c.nombre || '', pide });
      const sol = {
        id: sid, cliente_id: c.id, pide, estado: 'pendiente',
        creado_por_email: firebase.auth().currentUser?.email || null,
        creado_at: new Date(),
        vence_at: new Date(Date.now() + ExpedienteCliente.DIAS_ENLACE * 864e5),
      };
      this._docsSol = sol;
      this._modalEnlaceDocs(sol);
      if (this._docsDe === c.id && this._puedeVerDocs()) this._docsRender();
    } catch (e) {
      console.error(e);
      if (btn) btn.disabled = false;
      Toast.show('No se pudo generar el enlace: ' + (e?.message || e), 'bad');
    }
  },

  _modalEnlaceDocs(sol) {
    const c = this.cliente;
    const url = ClienteDocumentosService.urlSolicitud(sol.id);
    const pide = ExpedienteCliente.pedidos(sol.pide, c?.expediente);
    const recibidos = sol.recibidos || {};
    const lista = pide.map(id => `<li>${this.esc(ExpedienteCliente.requisito(id).label)}${recibidos[id] ? ` <span class="cg-chip cg-chip--ok">recibido</span>` : ''}</li>`).join('');
    this._abrirModalA({
      titulo: 'Enlace para subir documentos',
      banda: false,
      size: 'md',
      cuerpo: `<p style="margin:0 0 10px; font-size:13px; color:var(--fg-3); max-width:62ch;">
          Mándaselo a <b>${this.esc(c?.nombre || '')}</b> por WhatsApp o por correo. Lo abre en el celular, sin usuario,
          y sube una foto o un PDF de cada documento. Vence el <b>${this.esc(this._fmtFecha(sol.vence_at))}</b>.</p>
        <ul style="margin:0 0 12px 18px; padding:0; font-size:13px; line-height:1.7;">${lista}</ul>
        <div style="display:flex; gap:8px; margin-bottom:12px;">
          <input class="form-input" id="wdLink" value="${this.esc(url)}" readonly style="flex:1; font-size:12.5px;" aria-label="Enlace de carga">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText(document.getElementById('wdLink').value).then(()=>Toast.show('Enlace copiado — pégalo en WhatsApp','ok'))">Copiar</button>
        </div>
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="form-field" style="margin:0; flex:1; min-width:220px;">
            <label class="form-label" for="wdEmail">Enviar por correo a</label>
            <input class="form-input" id="wdEmail" type="email" value="${this.esc(sol.enviado_a || c?.representante_email || c?.email || '')}" placeholder="correo del cliente"></div>
          <button class="btn btn-ghost" id="wdEnviar" onclick="Centro._enviarDocsCorreo('${this.esc(sol.id)}')">Enviar correo</button>
        </div>
        ${sol.enviado_a ? `<p style="margin:10px 0 0; font-size:12.5px; color:var(--fg-3);">Ya se envió a ${this.esc(sol.enviado_a)}${sol.enviado_at ? ` el ${this.esc(this._fmtFecha(sol.enviado_at))}` : ''}.</p>` : ''}`,
      footer: `<button class="btn btn-ghost" style="color:var(--cg-bad-deep, #991B1B);" onclick="Centro._retirarEnlaceDocs('${this.esc(sol.id)}')">Retirar el enlace</button>
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cerrar</button>`,
    });
  },

  async _enviarDocsCorreo(sid) {
    const c = this.cliente;
    const sol = this._docsSol;
    const email = (document.getElementById('wdEmail')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { Toast.show('Escribe un correo válido', 'warn'); return; }
    if (!c || !sol || sol.id !== sid) return;
    const btn = document.getElementById('wdEnviar');
    if (btn) btn.disabled = true;
    const pide = ExpedienteCliente.pedidos(sol.pide, c.expediente).filter(id => !(sol.recibidos || {})[id]);
    const lista = pide.map(id => `<li>${FMT.esc(ExpedienteCliente.requisito(id).label)}</li>`).join('');
    try {
      await MailService.enqueue({
        to: email,
        cc: firebase.auth().currentUser?.email || null,
        subject: `Documentos de ${c.nombre || 'su empresa'} — C Comunica`,
        preheader: 'Súbalos desde su celular en un par de minutos',
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">Documentos para su expediente</h2>
          <p style="margin:0 0 10px;font:14px/1.5 Arial,sans-serif;">
            Estimado cliente: para mantener al día el expediente de <b>${FMT.esc(c.nombre || '')}</b> con
            <b>C COMUNICA, S.A.</b> necesitamos los siguientes documentos:</p>
          <ul style="margin:0 0 12px 18px;padding:0;font:14px/1.6 Arial,sans-serif;">${lista}</ul>
          <p style="margin:0 0 10px;font:14px/1.5 Arial,sans-serif;">
            Puede subirlos con el botón, desde su celular o computadora: una foto o un PDF de cada uno.
            No necesita usuario ni contraseña. Si los tiene otra persona de su empresa, puede reenviarle este correo.</p>
          <p style="margin:0;font:13px/1.5 Arial,sans-serif;color:#64748B;">
            El enlace es solo para cargar documentos y vence el ${FMT.esc(this._fmtFecha(sol.vence_at))}.</p>`,
        ctaUrl: ClienteDocumentosService.urlSolicitud(sid),
        ctaLabel: 'Subir los documentos',
        meta: { created_at: firebase.firestore.FieldValue.serverTimestamp(), created_by: this.uid, source: 'expediente-documentos', documentos_solicitud: sid, cliente_id: c.id },
        status: 'queued',
      });
      Toast.show(`Enlace enviado a ${email}`, 'ok');
      // A quién y cuándo: lo muestra la pestaña Documentos. Best-effort.
      try {
        await ClienteDocumentosService.anotarEnvio(sid, email);
        sol.enviado_a = email; sol.enviado_at = new Date();
        if (this._docsDe === c.id && this._puedeVerDocs()) this._docsRender();
      } catch (e) { console.warn('[centro] envío no anotado:', e?.message || e); }
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo enviar el correo: ' + (e?.message || e), 'bad');
    } finally { if (btn) btn.disabled = false; }
  },

  async _retirarEnlaceDocs(sid) {
    const ok = await Modal.confirm({
      title: 'Retirar el enlace', confirmLabel: 'Retirar', danger: true,
      message: 'El enlace deja de funcionar: quien lo abra verá que ya no es válido. Lo que el cliente ya subió se queda en el expediente.',
    });
    if (!ok) { if (this._docsSol?.id === sid) this._modalEnlaceDocs(this._docsSol); return; }
    try {
      await ClienteDocumentosService.retirarSolicitud(sid);
      this._docsSol = null;
      Toast.show('Enlace retirado.', 'ok');
      if (this.cliente && this._docsDe === this.cliente.id && this._puedeVerDocs()) this._docsRender();
    } catch (e) { console.error(e); Toast.show('No se pudo retirar: ' + (e?.message || e), 'bad'); }
  },

  // ── Directorio: los dos filtros de Cobros ─────────────────────────────
  // "Docs por revisar" sale del resumen que ya trae cada ficha (cero
  // lecturas). "Expediente incompleto" es de clientes con CONTRATO VIVO: esa
  // lista se pide solo al tocar el chip.
  _docsVivos: null,
  _docsVivosCargando: false,
  _docsPorRevisarDe(c) { return Number(c?.expediente?.por_revisar || 0) > 0; },
  _docsIncompleto(c) { return !ExpedienteCliente.leer(c?.expediente).completo; },
  // Chip de la fila cuando se mira el directorio por expediente.
  _docsChipFila(c) {
    const e = ExpedienteCliente.leer(c?.expediente);
    const partes = [];
    if (e.faltan.length) partes.push(`<span class="cg-chip cg-chip--warn" title="${this.esc(ExpedienteCliente.fraseFaltan(e.faltan))}">Falta${e.faltan.length === 1 ? '' : 'n'} ${e.faltan.length} de 3</span>`);
    if (e.por_revisar) partes.push(`<span class="cg-chip cg-chip--info" title="Lo subió el cliente: falta abrirlo y marcarlo">${e.por_revisar} por revisar</span>`);
    return partes.join('');
  },
  _cargarDocsVivos() {
    if (this._docsVivos || this._docsVivosCargando) return;
    this._docsVivosCargando = true;
    ClienteDocumentosService.clientesConContratoVivo()
      .then(set => { this._docsVivos = set; })
      .catch(e => { console.error('[centro] contratos vivos:', e); this._docsVivos = new Set(); Toast.show('No se pudo cargar la lista de contratos vivos', 'bad'); })
      .finally(() => { this._docsVivosCargando = false; this.pintarInicio(); });
  },
});
