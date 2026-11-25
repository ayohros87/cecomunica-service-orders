// @ts-nocheck
// documentos/index.html — el CLIENTE sube los documentos de su expediente
// desde un enlace, sin sesión (2026-11-25, pedido de Zuleika).
//
// El enlace trae UN portador: ?s= (documentos_solicitudes, lo pide el
// personal desde la ficha) o ?f= (firma_solicitudes, el enlace de firma de su
// contrato). Todo pasa por la callable documentosClientePublico:
//   ver        → qué se le pide a este cliente y qué ya se recibió
//   registrar  → "subí estos archivos": los valida y los pasa al expediente
// Los archivos suben primero a Storage, a clientes_docs_entrada/{portador}/,
// una carpeta donde se puede crear y no se puede leer.
//
// Las fotos se reducen y se pasan a JPEG en el teléfono (igual que la cédula
// de /firmar/): la de la cámara pesa varios MB y un HEIC no lo abre Chrome.
// El PDF sube tal cual, hasta 10 MB.
(function () {
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_POR_DOCUMENTO = 4;
  const $ = (id) => document.getElementById(id);

  const DocsCliente = {
    portador: null,        // { s } o { f }
    pid: null,
    pide: [],              // [{ id, label, ayuda, tipos, estado }]
    elegidos: {},          // requisito → [{ blob, contentType, ext, nombre }]
    _enviando: false,

    esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

    ver(id) {
      ['cargando', 'noValido', 'vencido', 'sinRed', 'completo', 'form'].forEach(x => $(x).classList.toggle('hidden', x !== id));
    },

    llamar(datos) {
      return firebase.functions().httpsCallable('documentosClientePublico')({ ...this.portador, ...datos })
        .then(r => r.data || {});
    },

    async init() {
      const q = new URLSearchParams(location.search);
      const s = q.get('s'), f = q.get('f');
      if ((s && f) || (!s && !f)) { this.ver('noValido'); return; }
      this.portador = s ? { s } : { f };
      this.pid = s || f;
      try {
        const r = await this.llamar({ accion: 'ver' });
        this.aplicar(r);
      } catch (e) {
        console.error(e);
        // Un enlace mal copiado llega como invalid-argument; lo demás es red.
        this.ver(e?.code === 'functions/invalid-argument' || e?.code === 'invalid-argument' ? 'noValido' : 'sinRed');
      }
    },

    // Pinta el estado que devuelve la callable (al entrar y después de enviar).
    aplicar(r) {
      if (r.status === 'no_disponible') { this.ver('noValido'); return; }
      if (r.status === 'vencido') { this.ver('vencido'); return; }
      if (r.status === 'completo') {
        if (r.cliente) $('cpCliente').textContent = r.cliente;
        this.ver('completo');
        window.scrollTo(0, 0);
        return;
      }
      this.pide = Array.isArray(r.pide) ? r.pide : this.pide;
      if (r.cliente) $('fCliente').textContent = r.cliente;
      if (r.vence) {
        const d = new Date(r.vence);
        if (!isNaN(d.getTime())) $('fVence').textContent = `Este enlace funciona hasta el ${d.toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
      }
      this.elegidos = {};
      this.pintarPedidos();
      this.ver('form');
    },

    pintarPedidos() {
      $('fPedidos').innerHTML = this.pide.map((p, i) => {
        const recibido = p.estado === 'recibido';
        const tipos = (p.tipos || []).length > 1
          ? `<label for="tipo-${p.id}">¿Cuál de los dos va a subir?</label>
             <select id="tipo-${p.id}">${p.tipos.map(t => `<option value="${this.esc(t.value)}">${this.esc(t.label)}</option>`).join('')}</select>`
          : '';
        return `<div class="card" data-req="${this.esc(p.id)}">
          <h3>${i + 1}. ${this.esc(p.label)}${recibido ? ' <span class="chip">✓ Recibido</span>' : ''}</h3>
          <p class="nota">${recibido ? 'Ya lo recibimos y está en revisión. Si necesita enviar otro (una foto más clara, el reverso), puede subirlo aquí.' : this.esc(p.ayuda || '')}</p>
          ${tipos}
          <ul class="archivos" id="lista-${p.id}"></ul>
          <label class="foto-btn" id="btn-${p.id}">📎 ${recibido ? 'Subir otro archivo' : 'Subir foto o PDF'}
            <input type="file" accept="image/*,application/pdf" class="hidden" data-archivo="${this.esc(p.id)}"></label>
        </div>`;
      }).join('');
      document.querySelectorAll('#fPedidos input[data-archivo]').forEach(inp => {
        inp.addEventListener('change', (ev) => this.agregar(inp.dataset.archivo, ev.target));
      });
    },

    async agregar(req, input) {
      const file = input.files && input.files[0];
      input.value = '';   // elegir el mismo archivo otra vez vuelve a disparar el change
      if (!file) return;
      this.aviso('');
      const lista = this.elegidos[req] || (this.elegidos[req] = []);
      if (lista.length >= MAX_POR_DOCUMENTO) { this.aviso(`Puede subir hasta ${MAX_POR_DOCUMENTO} archivos por documento.`); return; }
      try {
        const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
        if (esPdf) {
          if (file.size > MAX_BYTES) { this.aviso('El PDF pesa más de 10 MB. Envíe uno más liviano o tome fotos de las páginas.'); return; }
          lista.push({ blob: file, contentType: 'application/pdf', ext: 'pdf', nombre: file.name || 'documento.pdf' });
        } else if ((file.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name || '')) {
          const blob = await this._comprimir(file, 2200);
          lista.push({ blob, contentType: 'image/jpeg', ext: 'jpg', nombre: (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg' });
        } else {
          this.aviso('El archivo debe ser una foto o un PDF.');
          return;
        }
      } catch (e) {
        console.error(e);
        this.aviso('No se pudo leer esa foto. Intente tomarla de nuevo o envíela como PDF.');
        return;
      }
      this.pintarLista(req);
    },

    quitar(req, i) {
      (this.elegidos[req] || []).splice(i, 1);
      this.pintarLista(req);
    },

    pintarLista(req) {
      const ul = $(`lista-${req}`);
      if (!ul) return;
      const xs = this.elegidos[req] || [];
      ul.innerHTML = xs.map((a, i) => {
        const kb = Math.max(1, Math.round((a.blob.size || 0) / 1024));
        return `<li><span>✓ ${this.esc(a.nombre)}</span><small>${kb < 1024 ? kb + ' KB' : (kb / 1024).toFixed(1) + ' MB'}</small>
          <button type="button" class="btn-x" aria-label="Quitar ${this.esc(a.nombre)}" onclick="DocsCliente.quitar('${this.esc(req)}', ${i})">Quitar</button></li>`;
      }).join('');
    },

    // Reduce a máx. 2200 px y comprime a JPEG: un documento queda legible y
    // la subida pesa cientos de KB en vez de varios MB de la cámara.
    _comprimir(file, maxDim) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
          const esc = Math.min(1, maxDim / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * esc);
          cv.height = Math.round(img.height * esc);
          const ctx = cv.getContext('2d');
          // Un PNG con transparencia saldría con fondo negro en JPEG.
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob((b) => b ? res(b) : rej(new Error('sin blob')), 'image/jpeg', 0.85);
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => rej(new Error('imagen ilegible'));
        img.src = URL.createObjectURL(file);
      });
    },

    // Mensaje de validación inline: visible, con foco y a la vista — sin alert().
    aviso(msg) {
      const el = $('fMsg');
      if (!el) return;
      el.textContent = msg;
      el.hidden = !msg;
      if (msg) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
    },

    async enviar() {
      if (this._enviando) return;
      this.aviso('');
      $('fResultado').classList.add('hidden');
      const cola = [];
      for (const p of this.pide) {
        const tipo = $(`tipo-${p.id}`)?.value || (p.tipos && p.tipos[0] && p.tipos[0].value) || '';
        (this.elegidos[p.id] || []).forEach(a => cola.push({ ...a, requisito: p.id, tipo }));
      }
      if (!cola.length) { this.aviso('Suba al menos un documento antes de enviar.'); return; }
      const nombre = $('fNombre').value.replace(/\s+/g, ' ').trim();
      if (nombre.length < 3) { this.aviso('Escriba su nombre completo.'); return; }
      const btn = $('btnEnviar');
      this._enviando = true;
      btn.disabled = true;
      try {
        const st = firebase.storage();
        const marca = Date.now();
        const archivos = [];
        for (let i = 0; i < cola.length; i++) {
          const a = cola[i];
          btn.textContent = `Subiendo ${i + 1} de ${cola.length}…`;
          // Nombre con marca de tiempo: Storage no deja sobrescribir y un
          // reintento tras una subida a medias no debe chocar con el anterior.
          const path = `clientes_docs_entrada/${this.pid}/${a.requisito}-${marca}-${i}.${a.ext}`;
          await st.ref(path).put(a.blob, { contentType: a.contentType });
          archivos.push({ requisito: a.requisito, tipo: a.tipo, path, nombre: a.nombre });
        }
        btn.textContent = 'Registrando…';
        const r = await this.llamar({ accion: 'registrar', nombre, archivos });
        const malos = (r.rechazados || []).length;
        if (r.status === 'completo' && !malos) { this.aplicar(r); return; }
        if (r.status === 'no_disponible' || r.status === 'vencido') { this.aplicar(r); return; }
        this.aplicar({ ...r, status: 'ok' });
        const res = $('fResultado');
        const faltan = this.pide.filter(p => p.estado !== 'recibido').map(p => p.label);
        res.textContent = (r.registrados ? `Recibimos ${r.registrados} archivo${r.registrados === 1 ? '' : 's'}. ` : '')
          + (faltan.length ? `Todavía falta: ${faltan.join('; ')}.` : '');
        res.classList.toggle('hidden', !res.textContent);
        if (malos) this.aviso(`${malos} archivo${malos === 1 ? ' no se pudo' : 's no se pudieron'} leer. Súbalo${malos === 1 ? '' : 's'} de nuevo como foto o PDF.`);
        else window.scrollTo(0, 0);
      } catch (e) {
        console.error(e);
        const m = e?.message && /nombre|archivos|enlace/i.test(e.message) ? e.message
          : 'No se pudieron enviar los documentos. Revise su conexión e intente de nuevo; si sigue fallando, contacte a su asesor.';
        this.aviso(m);
      } finally {
        this._enviando = false;
        btn.disabled = false;
        btn.textContent = 'Enviar documentos';
      }
    },
  };

  window.DocsCliente = DocsCliente;
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => DocsCliente.init());
  else DocsCliente.init();
})();
