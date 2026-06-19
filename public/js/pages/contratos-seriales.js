// @ts-nocheck
// Seriales del contrato (uso interno). Acción MANUAL del ejecutivo: tras registrar
// los equipos en POC, abre este modal y "Busca en POC" para que el sistema PROPONGA
// los seriales del cliente por modelo; el vendedor/recepción confirma y guarda.
// Muestra el nombre del cliente de POC en cada propuesta para verificar que el serial
// corresponde al cliente del contrato. Doc-por-serial: semilla del registro de equipos.
window.ContratosSeriales = {
  _ctx: null,
  _pocMeta: {},   // serialNorm -> { cliente, modelo }

  _puedeEditar() {
    return AUTH.is(ROLES.ADMIN) || AUTH.is(ROLES.RECEPCION) ||
           AUTH.is(ROLES.VENDEDOR) || AUTH.is(ROLES.GERENTE);
  },

  _norm(s) { return String(s || '').trim().toLowerCase(); },

  async abrir(id) {
    const esc = CS.esc.bind(CS);
    try {
      const contrato = await ContratosService.getContrato(id);
      if (!contrato) { Toast.show('Contrato no encontrado.', 'bad'); return; }
      const contratoIdVisible = contrato.contrato_id || id;
      const equipos = Array.isArray(contrato.equipos) ? contrato.equipos : [];
      const seriales = await ContratosService.getSerialesManual(id);
      const cancelado = contrato.baja_cancelado || {};

      // Seriales presentes en órdenes vinculadas (fuente secundaria; modelo por nombre).
      const ordenSerialSet = new Set();
      const ordenByName = {};
      const ordenMeta = {};   // serialNorm -> { numero_orden, fecha }
      try {
        const docs = await ContratosService.getOrdenesDeContratoCompleto(id);
        for (const d of (docs || [])) {
          const numero = d.numero_orden || d.id || '';
          const fecha = d.fecha_creacion || d.updated_at || null;
          (d.equipos || []).forEach(e => {
            const s = String(e?.serial || e?.numero_de_serie || '').trim();
            if (!s) return;
            const n = this._norm(s);
            ordenSerialSet.add(n);
            if (!ordenMeta[n]) ordenMeta[n] = { numero_orden: numero, fecha };
            const nm = this._norm(e?.modelo);
            if (nm) (ordenByName[nm] = ordenByName[nm] || []).push(s);
          });
        }
      } catch (e) { /* sin órdenes: ok */ }

      this._pocMeta = {};
      this._ctx = {
        id, contratoIdVisible,
        clienteNombre: contrato.cliente_nombre || '',
        clienteId: contrato.cliente_id || '',
        ordenSerialSet, ordenByName, ordenMeta,
      };

      const puedeEditar = this._puedeEditar();
      const dis = puedeEditar ? '' : 'disabled';

      // Seriales guardados en cola por modelo (prellenado).
      const guardadosPorModelo = {};
      seriales.forEach(s => {
        const k = this._norm(s?.modelo);
        (guardadosPorModelo[k] = guardadosPorModelo[k] || []).push(String(s?.serial || '').trim());
      });

      const rowHtml = (modelo, modeloId, i, val) => `
        <div class="serial-row" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:6px;">
          <span style="width:22px; text-align:right; color:var(--fg-3); font-size:12px;">${i}.</span>
          <input class="serial-input form-input" data-modelo="${esc(modelo)}" data-modelo-id="${esc(modeloId)}"
                 value="${esc(val || '')}" placeholder="Número de serie" ${dis}
                 style="height:34px; flex:1; min-width:160px; font-family:var(--font-mono, monospace);">
          <span class="serial-tag" style="flex-basis:100%; padding-left:28px; font-size:11px; color:var(--fg-3);"></span>
        </div>`;

      const gruposHtml = equipos.map((eq) => {
        const modelo = String(eq?.modelo || '-').trim() || '-';
        const modeloId = eq?.modelo_id || '';
        const key = String(modeloId || modelo);
        const contratados = Number(eq?.cantidad || 0);
        const activos = Math.max(0, contratados - Number(cancelado[key] || 0));
        if (activos === 0) return ''; // modelo totalmente dado de baja
        const k = this._norm(modelo);
        const cola = (guardadosPorModelo[k] || []).slice();
        const puestos = cola.filter(Boolean).length;

        const filas = [];
        for (let i = 0; i < activos; i++) filas.push(rowHtml(modelo, modeloId, i + 1, cola.shift()));
        // Seriales guardados por encima de las unidades activas (no perderlos).
        cola.forEach((val, j) => filas.push(rowHtml(modelo, modeloId, '+' + (j + 1), val)));

        return `
          <div class="serial-group" data-modelo="${esc(modelo)}" data-modelo-id="${esc(modeloId)}"
               style="border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
              <div style="font-weight:600;">${esc(modelo)}
                <span class="grupo-progreso" style="color:var(--fg-3); font-weight:400;">· ${puestos}/${activos}</span>
              </div>
              ${puedeEditar ? `<button class="btn btn-ghost btn-sm" onclick="ContratosSeriales.agregarFila(this)" title="Agregar otro serial"><i data-lucide="plus"></i></button>` : ''}
            </div>
            <div class="serial-rows">${filas.join('')}</div>
          </div>`;
      }).join('');

      document.getElementById('serialesBody').innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
          <div>
            <div style="font-weight:700; font-size:15px;">${esc(this._ctx.clienteNombre || '—')}</div>
            <div style="font-size:12px; color:var(--fg-3);">Contrato ${esc(contratoIdVisible)}</div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${puedeEditar ? `<button class="btn btn-primary btn-sm" onclick="ContratosSeriales.buscarPoc()" title="Proponer seriales desde POC del cliente"><i data-lucide="search"></i> Buscar en POC</button>` : ''}
            ${puedeEditar ? `<button class="btn btn-ghost btn-sm" onclick="ContratosSeriales.importarDeOrdenes()" title="Rellenar desde órdenes vinculadas"><i data-lucide="download"></i> De órdenes</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="ContratosSeriales.copiar()" title="Copiar lista"><i data-lucide="clipboard"></i> Copiar</button>
            <button class="btn btn-ghost btn-sm" onclick="ContratosSeriales.exportar()" title="Exportar CSV"><i data-lucide="file-down"></i> CSV</button>
          </div>
        </div>
        <p style="margin:0 0 12px; font-size:12px; color:var(--fg-3);">
          <i data-lucide="info" style="width:13px;height:13px;vertical-align:-2px;"></i>
          Pulsa <b>Buscar en POC</b> para proponer los seriales del cliente; verifica el cliente mostrado y guarda. Uso interno, no sale en el PDF.
        </p>
        ${gruposHtml || `<p style="color:var(--fg-3);">Este contrato no tiene unidades activas que serializar.</p>`}`;

      const footBtn = document.getElementById('btnGuardarSeriales');
      if (footBtn) footBtn.style.display = (puedeEditar && gruposHtml) ? '' : 'none';

      // Refresca etiquetas/progreso al teclear (delegado, una sola vez).
      if (!this._wired) {
        document.getElementById('serialesBody').addEventListener('input', (e) => {
          if (e.target && e.target.classList && e.target.classList.contains('serial-input')) {
            this._refreshTags(); this._refreshProgreso();
          }
        });
        this._wired = true;
      }

      if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('overlaySeriales')] });
      Modal.open('overlaySeriales');
    } catch (err) {
      console.error('Error abriendo seriales:', err);
      Toast.show('No se pudieron cargar los seriales.', 'bad');
    }
  },

  // Propone seriales desde los equipos del cliente en POC (acción manual).
  async buscarPoc() {
    const ctx = this._ctx; if (!ctx) return;
    if (typeof PocService === 'undefined') { Toast.show('POC no disponible aquí.', 'bad'); return; }
    let devices = [];
    try {
      devices = await PocService.getByCliente({ clienteId: ctx.clienteId, clienteNombre: ctx.clienteNombre });
    } catch (e) { console.error(e); Toast.show('No se pudo consultar POC.', 'bad'); return; }
    devices = (devices || []).filter(d => d.deleted !== true && String(d.serial || '').trim());
    if (!devices.length) { Toast.show('No hay equipos en POC para este cliente.', 'warn'); return; }

    // Índices por modelo (id y nombre) + meta por serial (incluye cliente POC).
    const byId = {}, byName = {};
    devices.forEach(d => {
      const serial = String(d.serial).trim();
      this._pocMeta[this._norm(serial)] = {
        cliente: d.cliente || d.cliente_nombre || '',
        modelo: d.modelo_label || d.modelo || '',
        unit_id: String(d.unit_id || '').trim(),
        created_at: d.created_at || d.fecha_creacion || null,
      };
      if (d.modelo_id) (byId[String(d.modelo_id)] = byId[String(d.modelo_id)] || []).push(serial);
      const nm = this._norm(d.modelo_label || d.modelo || '');
      if (nm) (byName[nm] = byName[nm] || []).push(serial);
    });

    const usados = new Set([...document.querySelectorAll('#serialesBody .serial-input')].map(i => i.value.trim()).filter(Boolean));
    let filled = 0;
    document.querySelectorAll('#serialesBody .serial-group').forEach(grupo => {
      const mid = grupo.getAttribute('data-modelo-id');
      const mname = this._norm(grupo.getAttribute('data-modelo'));
      let pool = [];
      if (mid && byId[mid]) pool = pool.concat(byId[mid]);
      if (byName[mname]) pool = pool.concat(byName[mname]);
      pool = [...new Set(pool)].filter(s => !usados.has(s));
      let di = 0;
      grupo.querySelectorAll('.serial-input').forEach(inp => {
        if (di >= pool.length) return;
        if (!inp.value.trim()) { inp.value = pool[di++]; usados.add(inp.value); filled++; }
      });
    });
    this._refreshTags();
    this._refreshProgreso();
    Toast.show(filled ? `${filled} serial(es) propuestos desde POC. Verifica el cliente y guarda.` : 'No se encontraron seriales nuevos para estos modelos en POC.', filled ? 'ok' : 'warn');
  },

  importarDeOrdenes() {
    const ctx = this._ctx; if (!ctx) return;
    const byName = ctx.ordenByName || {};
    const usados = new Set([...document.querySelectorAll('#serialesBody .serial-input')].map(i => i.value.trim()).filter(Boolean));
    let filled = 0;
    document.querySelectorAll('#serialesBody .serial-group').forEach(grupo => {
      const mname = this._norm(grupo.getAttribute('data-modelo'));
      const pool = [...new Set(byName[mname] || [])].filter(s => !usados.has(s));
      let di = 0;
      grupo.querySelectorAll('.serial-input').forEach(inp => {
        if (di >= pool.length) return;
        if (!inp.value.trim()) { inp.value = pool[di++]; usados.add(inp.value); filled++; }
      });
    });
    this._refreshTags();
    this._refreshProgreso();
    Toast.show(filled ? `${filled} serial(es) desde órdenes.` : 'No hay seriales nuevos en órdenes para estos modelos.', filled ? 'ok' : 'warn');
  },

  _fdate(ts) {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
    return (d && !isNaN(d)) ? d.toLocaleDateString('es-PA') : '';
  },

  // Anota cada serial: si viene de POC → cliente (✓/⚠ vs contrato) + ID unidad + fecha;
  // si viene de una orden → origen (N° de orden) + fecha. Sirve para verificar.
  _refreshTags() {
    const esc = CS.esc.bind(CS);
    const contractCli = this._norm(this._ctx?.clienteNombre);
    const ordenMeta = (this._ctx && this._ctx.ordenMeta) || {};
    document.querySelectorAll('#serialesBody .serial-input').forEach(inp => {
      const tag = inp.parentElement.querySelector('.serial-tag');
      if (!tag) return;
      const n = this._norm(inp.value);
      const poc = this._pocMeta[n];
      const ord = ordenMeta[n];
      if (poc) {
        const match = this._norm(poc.cliente) === contractCli;
        const partes = [`<span style="color:${match ? '#065F46' : '#92400E'};" title="Cliente en POC">${match ? '✓' : '⚠'} ${esc(poc.cliente || '—')}</span>`];
        if (poc.unit_id) partes.push(`ID ${esc(poc.unit_id)}`);
        const f = this._fdate(poc.created_at); if (f) partes.push(`POC ${f}`);
        tag.innerHTML = partes.join(' · ');
      } else if (ord) {
        const partes = [];
        if (ord.numero_orden) partes.push(`OS ${esc(ord.numero_orden)}`);
        const f = this._fdate(ord.fecha); if (f) partes.push(f);
        tag.innerHTML = partes.length ? `<span style="color:var(--fg-3);">${partes.join(' · ')}</span>` : '';
      } else {
        tag.textContent = '';
      }
    });
  },

  _refreshProgreso() {
    document.querySelectorAll('#serialesBody .serial-group').forEach(grupo => {
      const inputs = [...grupo.querySelectorAll('.serial-input')];
      const total = inputs.length;
      const puestos = inputs.filter(i => i.value.trim()).length;
      const el = grupo.querySelector('.grupo-progreso');
      if (el) el.textContent = `· ${puestos}/${total}`;
    });
  },

  agregarFila(btn) {
    const grupo = btn.closest('.serial-group');
    if (!grupo) return;
    const cont = grupo.querySelector('.serial-rows');
    const modelo = grupo.getAttribute('data-modelo') || '';
    const modeloId = grupo.getAttribute('data-modelo-id') || '';
    const row = document.createElement('div');
    row.className = 'serial-row';
    row.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:6px;';
    row.innerHTML = `
      <span style="width:22px; text-align:right; color:var(--fg-3); font-size:12px;">+</span>
      <input class="serial-input form-input" data-modelo="${CS.esc(modelo)}" data-modelo-id="${CS.esc(modeloId)}"
             placeholder="Número de serie" style="height:34px; flex:1; min-width:160px; font-family:var(--font-mono, monospace);">
      <span class="serial-tag" style="flex-basis:100%; padding-left:28px; font-size:11px; color:var(--fg-3);"></span>`;
    cont.appendChild(row);
    row.querySelector('input').focus();
  },

  _recolectar() {
    const ordenSet = (this._ctx && this._ctx.ordenSerialSet) || new Set();
    return [...document.querySelectorAll('#serialesBody .serial-input')]
      .map(inp => {
        const serial = inp.value.trim();
        const n = this._norm(serial);
        const source = this._pocMeta[n] ? 'poc' : ordenSet.has(n) ? 'orden' : 'manual';
        return {
          modelo_id: inp.getAttribute('data-modelo-id') || '',
          modelo: inp.getAttribute('data-modelo') || '',
          serial,
          source,
        };
      })
      .filter(x => x.serial);
  },

  async guardar() {
    if (!this._ctx || !this._puedeEditar()) return;
    const seriales = this._recolectar();
    const btn = document.getElementById('btnGuardarSeriales');
    if (btn) btn.disabled = true;
    try {
      const uid = firebase.auth().currentUser?.uid || null;
      await ContratosService.saveSerialesManual(this._ctx.id, seriales, {
        uid,
        contrato_id: this._ctx.contratoIdVisible || '',
        cliente_id: this._ctx.clienteId || '',
        cliente_nombre: this._ctx.clienteNombre || '',
      });
      Toast.show(`Seriales guardados (${seriales.length}).`, 'ok');
      Modal.close('overlaySeriales');
    } catch (e) {
      console.error('Error guardando seriales:', e);
      Toast.show('No se pudieron guardar los seriales.', 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  _texto() {
    const seriales = this._recolectar();
    return seriales.length ? seriales.map(s => `${s.modelo}\t${s.serial}`).join('\n') : '';
  },

  async copiar() {
    const texto = this._texto();
    if (!texto) { Toast.show('No hay seriales para copiar.', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(texto);
      Toast.show('Seriales copiados al portapapeles.', 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = texto; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      Toast.show('Seriales copiados al portapapeles.', 'ok');
    }
  },

  exportar() {
    const seriales = this._recolectar();
    if (!seriales.length) { Toast.show('No hay seriales para exportar.', 'warn'); return; }
    const ctx = this._ctx || {};
    const esc = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
    const lineas = [['Contrato', 'Cliente', 'Modelo', 'Serial'].map(esc).join(',')];
    seriales.forEach(s => lineas.push([ctx.contratoIdVisible, ctx.clienteNombre, s.modelo, s.serial].map(esc).join(',')));
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `seriales_${(ctx.contratoIdVisible || 'contrato')}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  cerrar() { Modal.close('overlaySeriales'); },
};
