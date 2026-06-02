/**
 * admin-email-preview.js — render templates with dummy data, no real send.
 *
 * Invokes previewEmail callable and renders the HTML in an iframe sandbox.
 */
(function () {
  'use strict';

  // Per-template default JSON. Pre-filled so admin sees something on load.
  const SAMPLES = {
    nota_entrega: {
      ordenId: 'OS-2025-0042',
      orden: {
        cliente_nombre:   'ACME Telecom S.A.',
        tecnico_asignado: 'Juan Pérez',
        tipo_de_servicio: 'Reparación',
        equipos: [
          { nombre: 'Radio Motorola DGP-8550', modelo: 'DGP-8550', numero_de_serie: '912AGW1234', trabajo_tecnico: 'Cambio de batería + diagnóstico' },
          { nombre: 'Radio Motorola XPR-7550', modelo: 'XPR-7550', numero_de_serie: '914AKZ5678', trabajo_tecnico: 'Reprogramación' },
        ],
      },
      opts: {
        receptorNombre: 'María González (Recepción)',
        firmaUrl:       '',
        sinId:          false,
        fechaISO:       new Date().toISOString(),
      },
    },
    orden_completada: {
      orden_id:          'OS-2025-0042',
      cliente_nombre:    'ACME Telecom S.A.',
      tecnico_nombre:    'Juan Pérez',
      costo_estimado:    125.50,
      estado_reparacion: 'COMPLETADO',
      equipos: [
        { serial: '912AGW1234', modelo: 'Motorola DGP-8550' },
        { serial: '914AKZ5678', modelo: 'Motorola XPR-7550', gps: true },
      ],
    },
  };

  const TEMPLATE_VARIANTS = {
    nota_entrega: {
      Normal: SAMPLES.nota_entrega,
      'No recibido': (() => {
        const v = JSON.parse(JSON.stringify(SAMPLES.nota_entrega));
        v.opts = { noRecibido: true, motivo: 'Cliente ausente, agendamos reenvío', personaInterna: 'Carlos Ruiz', fechaISO: v.opts.fechaISO };
        return v;
      })(),
    },
    orden_completada: {
      Por defecto: SAMPLES.orden_completada,
    },
  };

  function $(id) { return document.getElementById(id); }

  function populateTemplateSelect() {
    const sel = $('selTemplate');
    if (!sel) return;
    sel.innerHTML = Object.keys(SAMPLES).map(t => `<option value="${t}">${t}</option>`).join('');
    sel.addEventListener('change', applyVariantOptions);
    applyVariantOptions();
  }

  function applyVariantOptions() {
    const tpl = $('selTemplate').value;
    const sel = $('selVariant');
    if (!sel) return;
    const variants = Object.keys(TEMPLATE_VARIANTS[tpl] || {});
    sel.innerHTML = variants.map(v => `<option value="${v}">${v}</option>`).join('');
    loadSampleForCurrent();
  }

  function loadSampleForCurrent() {
    const tpl = $('selTemplate').value;
    const variant = $('selVariant').value || Object.keys(TEMPLATE_VARIANTS[tpl] || {})[0];
    const sample = TEMPLATE_VARIANTS[tpl]?.[variant] || SAMPLES[tpl];
    $('jsonData').value = JSON.stringify(sample, null, 2);
  }

  async function doRender() {
    const tpl = $('selTemplate').value;
    let data;
    try {
      data = JSON.parse($('jsonData').value);
    } catch (err) {
      Toast.show('JSON inválido: ' + err.message, 'bad');
      return;
    }
    const btn = $('btnRender');
    if (btn) btn.disabled = true;
    const status = $('renderStatus');
    if (status) status.textContent = 'Renderizando…';
    try {
      const fn = firebase.functions().httpsCallable('previewEmail');
      const res = await fn({ template: tpl, data });
      const html = res.data?.html || '';
      const frame = $('previewFrame');
      if (frame) {
        // Use srcdoc so the iframe is sandboxed and doesn't make requests
        // outside what the template itself references (firmaUrl, etc.).
        frame.srcdoc = html;
      }
      if (status) status.textContent = `Renderizado (${res.data?.length || 0} chars)`;
    } catch (err) {
      console.error('[email-preview]', err);
      Toast.show('Error: ' + (err.message || err.code), 'bad');
      if (status) status.textContent = 'Error.';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function wireUI() {
    populateTemplateSelect();
    $('selVariant')?.addEventListener('change', loadSampleForCurrent);
    $('btnReset')?.addEventListener('click', loadSampleForCurrent);
    $('btnRender')?.addEventListener('click', doRender);
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      wireUI();
    });
  });
})();
