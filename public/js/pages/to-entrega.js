// @ts-nocheck
// Panel "Datos de entrega" — surfaces the delivery receptor info that the
// entrega flow captures but no screen showed before.
//
// Two tiers of visibility:
//   • Receptor + signature + date → visible to anyone who can see the order.
//     The signature is legal-adjacent proof of delivery, low sensitivity, and
//     never purged.
//   • Customer ID photo → ADMIN ONLY. The photo is sensitive PII; the order
//     doc stores only `identificacion_path` (no tokenized URL). We fetch a
//     short-lived signed URL on demand via the getIdentificacionUrl callable.
window.TOEntrega = {
  _esc(v) {
    if (v == null) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  _fecha(ts) {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
      if (!d || isNaN(d)) return null;
      return d.toLocaleDateString('es-PA', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch { return null; }
  },

  render() {
    const mount = TO.byId('panelEntrega');
    if (!mount) return;
    const o = TO.ordenData || {};

    const tieneEntrega = !!(o.firma_url || o.receptor_nombre || o.identificacion_path ||
                            o.identificacion_url || o.fecha_entrega || o.sin_id);
    if (!tieneEntrega) { mount.innerHTML = ''; return; }

    const esAdmin = TO.rolUsuario === (window.ROLES ? ROLES.ADMIN : 'administrador');
    const esc = this._esc;
    const fecha = this._fecha(o.fecha_entrega);

    const filas = [];
    if (o.receptor_nombre) filas.push(['Recibido por', esc(o.receptor_nombre)]);
    if (fecha)             filas.push(['Fecha de entrega', esc(fecha)]);
    // Contrato / Observaciones de la OS — mismo dato que la nota impresa y el
    // correo que firma el cliente. Permite identificar contrato/sucursal aquí
    // sin abrir la nota. Se omite la fila si la OS no trae observaciones.
    if (o.observaciones)   filas.push(['Contrato / Observaciones', esc(o.observaciones)]);
    const filasHtml = filas.map(([k, v]) =>
      `<div style="display:flex;gap:8px;padding:4px 0;"><span class="muted" style="min-width:140px;">${k}</span><strong>${v}</strong></div>`
    ).join('');

    const firmaHtml = o.firma_url
      ? `<div style="margin-top:10px;">
           <div class="muted" style="margin-bottom:4px;">Firma del receptor</div>
           <img src="${esc(o.firma_url)}" alt="Firma del receptor"
                style="max-width:260px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:#fff;display:block;">
         </div>`
      : '';

    // ID section — admin only.
    let idHtml = '';
    if (esAdmin) {
      if (o.sin_id) {
        idHtml = `<div class="muted" style="margin-top:10px;">
            <i data-lucide="badge-alert"></i> Cliente no presentó identificación${o.sin_id_motivo ? ' — ' + esc(o.sin_id_motivo) : ''}.
          </div>`;
      } else if (o.identificacion_purged_at) {
        idHtml = `<div class="muted" style="margin-top:10px;">
            <i data-lucide="trash-2"></i> Foto de identificación purgada por política de retención.
          </div>`;
      } else if (o.identificacion_path || o.identificacion_url) {
        idHtml = `<div style="margin-top:10px;">
            <button class="btn" id="btnVerIdentificacion"><i data-lucide="id-card"></i> Ver identificación</button>
            <span class="muted" style="margin-left:8px;font-size:12px;">Solo administradores · enlace temporal</span>
          </div>`;
      } else {
        idHtml = `<div class="muted" style="margin-top:10px;"><i data-lucide="image-off"></i> Sin foto de identificación registrada.</div>`;
      }
    }

    mount.innerHTML = `
      <div class="header-card" style="margin-top:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <i data-lucide="package-check"></i>
          <strong>Datos de entrega</strong>
        </div>
        ${filasHtml}
        ${firmaHtml}
        ${idHtml}
      </div>`;

    if (esAdmin && TO.byId('btnVerIdentificacion')) {
      TO.byId('btnVerIdentificacion').addEventListener('click', () => this._verIdentificacion());
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async _verIdentificacion() {
    const btn = TO.byId('btnVerIdentificacion');
    if (btn) { btn.disabled = true; btn.dataset.prev = btn.innerHTML; btn.innerHTML = 'Cargando…'; }
    try {
      const fn = firebase.functions().httpsCallable('getIdentificacionUrl');
      const { data } = await fn({ ordenId: TO.ordenId });

      if (data.status === 'ok' && data.url) {
        this._lightbox(data.url);
      } else if (data.status === 'sin_id') {
        Toast.show('El cliente no presentó identificación' + (data.motivo ? `: ${data.motivo}` : ''), 'warn');
      } else if (data.status === 'purged') {
        Toast.show('La foto fue purgada por política de retención', 'warn');
      } else {
        Toast.show('No hay foto de identificación para esta orden', 'warn');
      }
    } catch (err) {
      console.error('[TOEntrega] getIdentificacionUrl', err);
      Toast.show('No se pudo obtener la identificación: ' + (err.message || err.code || 'error'), 'bad');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.prev || '<i data-lucide="id-card"></i> Ver identificación';
                 if (typeof lucide !== 'undefined') lucide.createIcons(); }
    }
  },

  // Minimal image lightbox — dynamic overlay, closes on backdrop/Escape/✕.
  _lightbox(url) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:90vw;max-height:90vh;padding:8px;">
        <div style="display:flex;justify-content:flex-end;">
          <button class="btn btn-ghost" data-action="close" aria-label="Cerrar">✕</button>
        </div>
        <img src="${this._esc(url)}" alt="Identificación del receptor"
             style="max-width:86vw;max-height:78vh;object-fit:contain;display:block;border-radius:6px;">
      </div>`;
    const cleanup = () => {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', kb);
    };
    const kb = e => { if (e.key === 'Escape') cleanup(); };
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-action="close"]')) cleanup();
    });
    document.addEventListener('keydown', kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  },
};
