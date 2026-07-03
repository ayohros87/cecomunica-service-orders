// @ts-nocheck
// Solicitud de cambio de serial (corrección por error humano o equipo
// defectuoso). Disponible para recepción/admin SOLO mientras el contrato está
// 'aprobado' (antes de activarse al subir el firmado). Recepción marca cuáles
// seriales reemplazar + motivo → crea la solicitud en
// contratos/{id}/seriales_cambios; el trigger onSerialCambio notifica a
// inventario, que introduce los reemplazos en la página de seriales.
window.ContratosSerialCambio = {
  _id: null,
  _contrato: null,

  esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, s => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]
    ));
  },

  async abrir(contratoDocId) {
    let contrato, seriales;
    try {
      contrato = await ContratosService.getContrato(contratoDocId);
      seriales = await ContratosService.getSerialesManual(contratoDocId);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cargar el contrato.', 'bad');
      return;
    }
    if (!contrato) { Toast.show('Contrato no encontrado.', 'bad'); return; }
    if (contrato.estado !== 'aprobado') {
      Toast.show('El cambio de serial solo se puede solicitar mientras el contrato está APROBADO (antes de activarse).', 'warn');
      return;
    }
    seriales = (seriales || []).filter(s => String(s.serial || '').trim());
    if (!seriales.length) {
      Toast.show('Este contrato no tiene seriales asignados para reemplazar.', 'warn');
      return;
    }
    this._id = contratoDocId;
    this._contrato = contrato;
    this._render(contrato, seriales);
  },

  _render(contrato, seriales) {
    const esc = this.esc;
    // Agrupa por modelo.
    const porModelo = {};
    seriales.forEach(s => {
      const m = String(s.modelo || '—');
      (porModelo[m] = porModelo[m] || []).push(s);
    });

    const grupos = Object.keys(porModelo).sort().map(modelo => {
      const filas = porModelo[modelo].map(s => `
        <label class="scmb-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);cursor:pointer;font-size:13px;">
          <input type="checkbox" class="scmb-check" value="${esc(s.serial)}" data-modelo="${esc(s.modelo || '')}" data-modelo-id="${esc(s.modelo_id || '')}" style="width:16px;height:16px;">
          <span style="font-family:var(--font-mono,monospace);">${esc(s.serial)}</span>
        </label>`).join('');
      return `<div style="margin-bottom:10px;">
          <div style="font-weight:600;margin:4px 0;">${esc(modelo)}</div>
          <div style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:8px;overflow:hidden;">${filas}</div>
        </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'overlaySerialCambio';
    overlay.className = 'modal-backdrop';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px;">
        <div class="modal-header">
          <h3 class="modal-title"><i data-lucide="scan-barcode"></i> Solicitar cambio de serial</h3>
          <button class="modal-close" onclick="ContratosSerialCambio.cerrar()" aria-label="Cerrar"><i data-lucide="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="modal-body">
          <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
            Contrato <b>${esc(contrato.contrato_id || this._id)}</b> · ${esc(contrato.cliente_nombre || '')}.
            Marca los seriales a reemplazar; se enviará una solicitud a inventario para que introduzca los seriales de reemplazo.
          </p>
          <div style="margin-bottom:12px;">
            <label class="form-label">Motivo</label>
            <select id="scmbTipo" class="form-input" style="width:100%;margin-bottom:8px;">
              <option value="Error de captura">Error de captura (serial mal digitado)</option>
              <option value="Equipo defectuoso">Equipo salió defectuoso</option>
              <option value="Otro">Otro</option>
            </select>
            <textarea id="scmbNota" class="form-input" rows="2" placeholder="Nota (opcional)" style="width:100%;font-family:inherit;font-size:13px;"></textarea>
          </div>
          <label class="form-label">Seriales a reemplazar</label>
          <div id="scmbLista">${grupos}</div>
          <div id="scmbCount" class="ts" style="margin-top:8px;">Sin selección</div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="ContratosSerialCambio.cerrar()">Cancelar</button>
          <button class="btn btn-primary" id="scmbEnviar" onclick="ContratosSerialCambio.enviar()"><i data-lucide="send"></i> Enviar solicitud a inventario</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    const count = () => {
      const n = overlay.querySelectorAll('.scmb-check:checked').length;
      const el = overlay.querySelector('#scmbCount');
      if (el) el.textContent = n ? `${n} serial(es) seleccionado(s)` : 'Sin selección';
    };
    overlay.addEventListener('change', e => { if (e.target.classList.contains('scmb-check')) count(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) this.cerrar(); });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  cerrar() {
    const o = document.getElementById('overlaySerialCambio');
    if (o) o.remove();
    this._id = null;
    this._contrato = null;
  },

  async enviar() {
    const overlay = document.getElementById('overlaySerialCambio');
    if (!overlay || !this._id) return;
    const checks = [...overlay.querySelectorAll('.scmb-check:checked')];
    if (!checks.length) { Toast.show('Marca al menos un serial a reemplazar.', 'warn'); return; }

    const items = checks.map(c => ({
      serial: c.value.trim(),
      modelo: c.getAttribute('data-modelo') || '',
      modelo_id: c.getAttribute('data-modelo-id') || '',
    }));
    const tipo = overlay.querySelector('#scmbTipo')?.value || '';
    const nota = (overlay.querySelector('#scmbNota')?.value || '').trim();

    const btn = overlay.querySelector('#scmbEnviar');
    if (btn) btn.disabled = true;
    try {
      const uid = firebase.auth().currentUser?.uid || null;
      await firebase.firestore()
        .collection('contratos').doc(this._id)
        .collection('seriales_cambios').add({
          estado: 'pendiente',
          items,
          motivo_tipo: tipo,
          motivo: nota,
          solicitado_por: uid,
          solicitado_por_email: firebase.auth().currentUser?.email || null,
          solicitado_at: firebase.firestore.FieldValue.serverTimestamp(),
          contrato_id: this._contrato?.contrato_id || this._id,
          cliente_id: this._contrato?.cliente_id || '',
          cliente_nombre: this._contrato?.cliente_nombre || '',
        });
      Toast.show(`Solicitud enviada a inventario (${items.length} serial(es)).`, 'ok');
      this.cerrar();
    } catch (e) {
      console.error('Error creando solicitud de cambio de serial:', e);
      Toast.show('No se pudo enviar la solicitud.', 'bad');
      if (btn) btn.disabled = false;
    }
  },
};
