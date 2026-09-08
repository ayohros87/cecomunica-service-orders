// @ts-nocheck
// Solicitud de cambio de serial (corrección por error humano o equipo
// defectuoso). Disponible para recepción/admin SOLO mientras el contrato está
// 'aprobado' (antes de activarse al subir el firmado). Recepción marca cuáles
// seriales reemplazar + motivo → crea la solicitud en
// contratos/{id}/seriales_cambios; el trigger onSerialCambio notifica a
// bodega, que introduce los reemplazos en Almacén · Asignar.
//
// Desde 2026-09-08 (F3 de "Bandejas y pickers") la lista es EntityPicker:
// mismo picker que "Tomar del estante", con buscador por identidad de serial
// (Serial.norm — antes este archivo normalizaba en minúsculas, distinto al
// resto) y el formulario del motivo encima de la lista.
window.ContratosSerialCambio = {
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

    const esc = this.esc;
    const porModelo = {};
    seriales.forEach(s => { const m = String(s.modelo || '—'); (porModelo[m] = porModelo[m] || []).push(s); });
    const grupos = Object.keys(porModelo).sort().map(modelo => ({
      id: modelo, titulo: modelo,
      items: porModelo[modelo].map(s => ({ id: Serial.clave(s.serial), label: s.serial, data: { serial: s.serial, modelo: s.modelo || '', modelo_id: s.modelo_id || '' } })),
    }));

    const r = await EntityPicker.abrir({
      titulo: 'Solicitar cambio de serial', icono: 'scan-barcode', size: 'md',
      descripcion: `Contrato <b>${esc(contrato.contrato_id || contratoDocId)}</b> · ${esc(contrato.cliente_nombre || '')}.
        Marca los seriales a reemplazar; bodega recibe la solicitud y pone los seriales de reemplazo en Almacén · Asignar.`,
      extraHtml: `
        <div style="margin-bottom:12px;">
          <label class="form-label">Motivo</label>
          <select id="scmbTipo" class="form-input" style="width:100%;margin-bottom:8px;">
            <option value="Error de captura">Error de captura (serial mal digitado)</option>
            <option value="Equipo defectuoso">Equipo salió defectuoso</option>
            <option value="Otro">Otro</option>
          </select>
          <textarea id="scmbNota" class="form-input" rows="2" placeholder="Nota (opcional)" style="width:100%;font-family:inherit;font-size:13px;"></textarea>
        </div>
        <label class="form-label">Seriales a reemplazar</label>`,
      leerExtra: (root) => ({
        tipo: root.querySelector('#scmbTipo')?.value || '',
        nota: (root.querySelector('#scmbNota')?.value || '').trim(),
      }),
      placeholderBuscar: 'Buscar serial… (pega el que indicó bodega)',
      normalizar: (s) => Serial.norm(s),
      grupos, confirmar: 'Enviar solicitud a bodega', iconoConfirmar: 'send',
    });
    if (!r) return;

    const items = r.seleccion.map(x => ({ serial: String(x.data.serial).trim(), modelo: x.data.modelo, modelo_id: x.data.modelo_id }));
    try {
      const user = firebase.auth().currentUser;
      await firebase.firestore()
        .collection('contratos').doc(contratoDocId)
        .collection('seriales_cambios').add({
          estado: 'pendiente',
          items,
          motivo_tipo: r.extra?.tipo || '',
          motivo: r.extra?.nota || '',
          solicitado_por: user?.uid || null,
          solicitado_por_email: user?.email || null,
          solicitado_at: firebase.firestore.FieldValue.serverTimestamp(),
          contrato_id: contrato.contrato_id || contratoDocId,
          cliente_id: contrato.cliente_id || '',
          cliente_nombre: contrato.cliente_nombre || '',
        });
      Toast.show(`Solicitud enviada a bodega (${items.length} serial(es)).`, 'ok');
    } catch (e) {
      console.error('Error creando solicitud de cambio de serial:', e);
      Toast.show('No se pudo enviar la solicitud.', 'bad');
    }
  },
};
