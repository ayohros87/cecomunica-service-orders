/**
 * admin-kpi-reportes.js — archivo del reporte ejecutivo de KPIs a la junta.
 *
 * - Lista los meses de `kpi_reports` (más reciente primero) con conciliación
 *   y estado de publicación.
 * - Importa el "Financial Report MM-YYYY.xlsx" (SheetJS + KpiImport): preview
 *   con diff nuevo/cambiado/igual, escribe solo lo que cambió, conserva
 *   comentarios y estado. Idempotente: re-importar el mismo archivo = 0 cambios.
 * - Captura/edición manual de un mes + comentarios de gerencia por sección.
 * - Publicar/despublicar: `publicado` = versión presentada a la junta
 *   (el reporte deja de marcar BORRADOR).
 */
(function () {
  'use strict';

  const METRICAS = ['recurrente', 'kenwood', 'hytera', 'ventas', 'otros', 'ajustes',
                    'total_ingresos', 'act_brutas', 'bajas', 'total_subs', 'churn'];

  const state = {
    docs: [],        // kpi_reports completos, orden ascendente
    wb: null,        // workbook cargado en el modal de import
    fileBuffer: null, // bytes del archivo para respaldo en Storage
    fileName: '',
    parsed: null,    // { meses, avisos } de la hoja seleccionada
    diff: [],        // [{ mes, data, status }]
    editingMes: null // null = captura nueva
  };

  const $ = (id) => document.getElementById(id);
  const K = () => window.KpiDerived;

  function refreshIcons() { if (window.lucide?.createIcons) lucide.createIcons(); }

  // ── lista ────────────────────────────────────────────────────────────────
  async function loadAll() {
    state.docs = await KpiReportsService.listAll();
    renderTable();
  }

  function renderTable() {
    const tbody = $('tbodyMeses');
    if (!state.docs.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--fg-3);padding:24px;">' +
        'Sin datos aún. Usa <strong>Importar Excel</strong> para cargar el histórico.</td></tr>';
      $('countLabel').textContent = '0 meses';
      return;
    }
    const rows = [...state.docs].reverse().map((d) => {
      const netas = K().actNetas(d);
      const concilia = d.concilia !== false;
      const publicado = d.estado === 'publicado';
      const upd = d.updated_at?.toDate ? d.updated_at.toDate().toLocaleDateString('es-PA') : '—';
      return `<tr data-mes="${d.id}">
        <td style="font-weight:600;white-space:nowrap;">${K().labelLargo(d.id)}</td>
        <td class="num">${K().fmtMoney$(d.total_ingresos)}</td>
        <td class="num">${K().fmtMoney$(d.recurrente)}</td>
        <td class="num">${K().fmtMoney$(d.ventas)}</td>
        <td class="num">${K().fmtInt(d.total_subs)}</td>
        <td class="num" style="color:${netas < 0 ? '#D24545' : '#1FA56B'};font-weight:600;">${netas > 0 ? '+' : ''}${K().fmtInt(netas)}</td>
        <td>${concilia
          ? '<span class="kpi-badge ok">✓</span>'
          : '<span class="kpi-badge warn" title="El total declarado no coincide con la suma de componentes">⚠</span>'}</td>
        <td><span class="kpi-badge ${publicado ? 'publicado' : 'borrador'}">${publicado ? 'Publicado' : 'Borrador'}</span></td>
        <td class="ts">${upd}</td>
        <td style="text-align:right;white-space:nowrap;">
          <a class="btn btn-ghost btn-sm" href="kpi-reporte-print.html?mes=${d.id}" title="Ver reporte ejecutivo">
            <i data-lucide="file-text"></i> Ver
          </a>
          <button class="btn btn-ghost btn-sm" data-act="edit" title="Editar métricas y comentarios">
            <i data-lucide="pencil"></i>
          </button>
          ${d.pdf_path ? `<button class="btn btn-ghost btn-sm" data-act="pdf" title="Abrir el PDF archivado (snapshot)">
            <i data-lucide="file-check"></i>
          </button>` : ''}
          <button class="btn btn-ghost btn-sm" data-act="toggle-estado" title="${publicado ? 'Volver a borrador' : 'Marcar como publicado'}">
            <i data-lucide="${publicado ? 'undo-2' : 'check-circle'}"></i>
          </button>
        </td>
      </tr>`;
    });
    tbody.innerHTML = rows.join('');
    $('countLabel').textContent = `${state.docs.length} meses · ${state.docs[0].id} → ${state.docs[state.docs.length - 1].id}`;
    refreshIcons();
  }

  async function onTableClick(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const mes = btn.closest('tr')?.dataset.mes;
    const doc = state.docs.find((d) => d.id === mes);
    if (!doc) return;

    if (btn.dataset.act === 'edit') { openEdit(doc); return; }

    if (btn.dataset.act === 'pdf') {
      btn.disabled = true;
      try {
        const { data } = await firebase.functions().httpsCallable('kpiReportSnapshot')({ action: 'url', mes });
        // Misma pestaña: window.open tras el await sería bloqueado como popup.
        location.href = data.url;
      } catch (err) {
        console.error(err);
        Toast.show('No pude obtener el PDF: ' + (err.message || err), 'bad');
        btn.disabled = false;
      }
      return;
    }

    if (btn.dataset.act === 'toggle-estado') {
      const publicar = doc.estado !== 'publicado';
      const ok = await Modal.confirm({
        title: publicar ? 'Publicar mes' : 'Volver a borrador',
        message: publicar
          ? `¿Marcar ${K().labelLargo(mes)} como publicado? Se abrirá el reporte para archivar el PDF (snapshot de lo presentado a la junta).`
          : `¿Regresar ${K().labelLargo(mes)} a borrador?`,
      });
      if (!ok) return;
      await KpiReportsService.setEstado(mes, publicar ? 'publicado' : 'borrador');
      if (publicar) {
        // El snapshot se genera desde la página del reporte (dueña del render).
        location.href = `kpi-reporte-print.html?mes=${mes}&archivar=1`;
        return;
      }
      Toast.show('Mes en borrador.', 'ok');
      loadAll();
    }
  }

  // ── importación ──────────────────────────────────────────────────────────
  function onFileChosen(e) {
    const file = e.target.files[0];
    e.target.value = ''; // permitir re-elegir el mismo archivo
    if (!file) return;
    state.fileName = file.name;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        state.fileBuffer = ev.target.result;   // para respaldar la fuente en Storage
        state.wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        populateSheetSelect();
        parseSelectedSheet();
        Modal.open('modalImport');
      } catch (err) {
        console.error(err);
        Toast.show('No pude leer el archivo: ' + err.message, 'bad');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Default: la "CC Executive Report (N)" con N más alto.
  function populateSheetSelect() {
    const names = state.wb.SheetNames;
    const candidates = names.filter((n) => /^CC Executive Report/i.test(n))
      .sort((a, b) => (+(b.match(/\((\d+)\)/) || [0, 0])[1]) - (+(a.match(/\((\d+)\)/) || [0, 0])[1]));
    const def = candidates[0] || names[0];
    $('selSheet').innerHTML = names
      .map((n) => `<option value="${n}" ${n === def ? 'selected' : ''}>${n}</option>`).join('');
  }

  function parseSelectedSheet() {
    const name = $('selSheet').value;
    const tbody = $('importTbody');
    try {
      const rows = XLSX.utils.sheet_to_json(state.wb.Sheets[name], { header: 1, raw: true, defval: null });
      state.parsed = KpiImport.parse(rows);
    } catch (err) {
      state.parsed = null;
      state.diff = [];
      tbody.innerHTML = `<tr><td colspan="5" style="color:#D24545;padding:14px;">${err.message}</td></tr>`;
      $('importResumen').textContent = '';
      $('importAvisos').style.display = 'none';
      $('btnConfirmImport').disabled = true;
      return;
    }

    // Diff contra lo existente — solo métricas (comentarios/estado se conservan).
    const byId = K().byId(state.docs);
    state.diff = Object.entries(state.parsed.meses).map(([mes, data]) => {
      const cur = byId[mes];
      let status = 'nuevo';
      if (cur) {
        const igual = METRICAS.every((f) => {
          const a = data[f] ?? null, b = cur[f] ?? null;
          if (a == null || b == null) return a === b;
          return Math.abs(a - b) < 0.005;
        });
        status = igual ? 'igual' : 'cambiado';
      }
      return { mes, data, status, publicado: cur?.estado === 'publicado' };
    }).sort((a, b) => a.mes.localeCompare(b.mes));

    const nuevos = state.diff.filter((d) => d.status === 'nuevo').length;
    const cambiados = state.diff.filter((d) => d.status === 'cambiado').length;
    const pubCambiados = state.diff.filter((d) => d.status === 'cambiado' && d.publicado).length;
    $('importResumen').textContent =
      `${state.diff.length} meses · ${nuevos} nuevos · ${cambiados} cambiados`;

    const avisos = [...state.parsed.avisos];
    if (pubCambiados) avisos.unshift(`⚠ ${pubCambiados} mes(es) ya PUBLICADOS cambiarían de cifras.`);
    $('importAvisos').style.display = avisos.length ? '' : 'none';
    $('importAvisos').innerHTML = avisos.map((a) => `<div>· ${a}</div>`).join('');

    tbody.innerHTML = state.diff.map(({ mes, data, status, publicado }) => {
      const badge = status === 'nuevo' ? '<span class="kpi-badge publicado">nuevo</span>'
        : status === 'cambiado' ? `<span class="kpi-badge borrador">cambiado${publicado ? ' (publicado)' : ''}</span>`
        : '<span class="ts">sin cambios</span>';
      return `<tr>
        <td>${mes}</td>
        <td class="num">${K().fmtMoney$(data.total_ingresos)}</td>
        <td class="num">${K().fmtInt(data.total_subs)}</td>
        <td>${data.concilia ? '✓' : '⚠'}</td>
        <td>${badge}</td>
      </tr>`;
    }).join('');
    $('btnConfirmImport').disabled = !(nuevos + cambiados);
    $('btnConfirmImport').textContent = (nuevos + cambiados)
      ? `Importar ${nuevos + cambiados} mes(es)` : 'Nada que importar';
  }

  async function confirmImport() {
    const items = state.diff
      .filter((d) => d.status !== 'igual')
      .map(({ mes, data, status }) => ({
        mes,
        data: {
          ...data,
          fuente: 'import',
          source_file: state.fileName,
          // Solo los meses nuevos nacen en borrador; en los cambiados el merge
          // conserva el estado (y los comentarios) existentes.
          ...(status === 'nuevo' ? { estado: 'borrador', comentarios: {} } : {}),
        },
      }));
    if (!items.length) return;
    $('btnConfirmImport').disabled = true;
    try {
      await KpiReportsService.upsertBatch(items);
      Modal.close('modalImport');
      Toast.show(`Importados ${items.length} mes(es).`, 'ok');
      loadAll();
      archivarFuente();   // respaldo best-effort, no bloquea el import
    } catch (err) {
      console.error(err);
      Toast.show('Error al importar: ' + err.message, 'bad');
      $('btnConfirmImport').disabled = false;
    }
  }

  // Respalda el workbook fuente en Storage (kpi_reports_fuentes/, vía callable
  // admin-only). Best-effort: la data ya quedó en Firestore; si el respaldo
  // falla solo se avisa.
  async function archivarFuente() {
    if (!state.fileBuffer) return;
    try {
      const bytes = new Uint8Array(state.fileBuffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      await firebase.functions().httpsCallable('kpiReportSnapshot')({
        action: 'archiveSource', fileName: state.fileName, dataBase64: btoa(bin),
      });
      Toast.show('Excel fuente respaldado en Storage.', 'ok');
    } catch (err) {
      console.error(err);
      Toast.show('Meses importados, pero no pude respaldar el Excel fuente: ' + (err.message || err), 'warn');
    } finally {
      state.fileBuffer = null;
    }
  }

  // ── plantilla descargable ────────────────────────────────────────────────
  // Formato tabular cómodo (una fila por mes) que KpiImport.parseTabular
  // acepta además del Financial Report legacy. Los headers deben seguir
  // matcheando KpiImport.COL_MAP si se editan.
  function descargarPlantilla() {
    const headers = ['Mes', 'Ingreso recurrente', 'Recurrente Kenwood', 'Recurrente Hytera / LTE',
      'Ventas de equipos', 'Otros ingresos', 'Ajustes', 'Total ingresos (opcional)',
      'Activaciones brutas', 'Bajas', 'Suscriptores totales', 'Churn (opcional)'];

    // Filas de ejemplo: los últimos 2 meses archivados (o dummy si aún no hay).
    const ejemplo = state.docs.slice(-2);
    const filas = ejemplo.length
      ? ejemplo.map((d) => [d.id, d.recurrente, d.kenwood, d.hytera, d.ventas, d.otros,
          d.ajustes, d.total_ingresos, d.act_brutas, d.bajas, d.total_subs, d.churn])
      : [['2026-06', 74575.35, 20007.45, 54567.90, 250653.79, 11361.79, 105.00, 336485.93, 73, 113, 3957, 0.0289]];

    const wsKpis = XLSX.utils.aoa_to_sheet([headers, ...filas]);
    wsKpis['!cols'] = [{ wch: 10 }, ...headers.slice(1).map((h) => ({ wch: Math.max(h.length + 2, 14) }))];

    const wsInfo = XLSX.utils.aoa_to_sheet([
      ['Plantilla de carga — Reporte KPIs Junta (Cecomunica)'],
      [],
      ['Cómo llenarla:'],
      ['• Una fila por mes. Puedes incluir un solo mes o varios: al importar solo se escriben los meses nuevos o cambiados.'],
      ['• Mes: en formato AAAA-MM (ej. 2026-07). También se aceptan "jul-26" o una celda con fecha.'],
      ['• Cifras en US$, solo números (sin "$" ni separadores de miles escritos a mano).'],
      ['• Ajustes: en positivo — el sistema lo RESTA del total.'],
      ['• Total ingresos es opcional: si se deja vacío se calcula como recurrente + ventas + otros − ajustes.'],
      ['  Si se llena, el sistema valida que concilie con los componentes (tolerancia $1).'],
      ['• Churn es opcional, en fracción (0.029 = 2.9%).'],
      ['• Obligatorios por mes: Mes, Ingreso recurrente y Suscriptores totales. El resto vacío cuenta como 0.'],
      ['• Solo se aceptan meses desde 2022-01.'],
      [],
      ['Al importar en Admin → Reporte KPIs Junta verás un preview con lo que se va a crear/cambiar antes de guardar.'],
      ['Los comentarios de gerencia y el estado publicado/borrador NO se tocan al importar: se editan en el módulo.'],
      ['También se acepta el "Financial Report" original (hoja CC Executive Report) — el sistema detecta el formato.'],
    ]);
    wsInfo['!cols'] = [{ wch: 110 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsKpis, 'KPIs');
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Instrucciones');
    XLSX.writeFile(wb, 'Plantilla KPIs Junta.xlsx');
  }

  // Exporta TODO el histórico archivado en el formato de la plantilla (re-importable)
  // + columnas informativas (estado, comentarios — el import las ignora).
  function exportarHistorico() {
    if (!state.docs.length) { Toast.show('No hay meses archivados aún.', 'warn'); return; }
    const headers = ['Mes', 'Ingreso recurrente', 'Recurrente Kenwood', 'Recurrente Hytera / LTE',
      'Ventas de equipos', 'Otros ingresos', 'Ajustes', 'Total ingresos',
      'Activaciones brutas', 'Bajas', 'Suscriptores totales', 'Churn',
      'Estado', 'Comentario ingresos', 'Comentario recurrente', 'Comentario suscriptores'];
    const filas = state.docs.map((d) => [d.id, d.recurrente, d.kenwood, d.hytera, d.ventas,
      d.otros, d.ajustes, d.total_ingresos, d.act_brutas, d.bajas, d.total_subs, d.churn,
      d.estado ?? '', d.comentarios?.ingresos ?? '', d.comentarios?.recurrente ?? '', d.comentarios?.suscriptores ?? '']);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...filas]);
    ws['!cols'] = headers.map((h, i) => ({ wch: i === 0 ? 10 : Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'KPIs');
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Historico KPIs Junta ${hoy}.xlsx`);
  }

  // ── captura / edición manual ─────────────────────────────────────────────
  function openEdit(doc) {
    state.editingMes = doc ? doc.id : null;
    $('editTitle').innerHTML = doc
      ? `<i data-lucide="pencil"></i> Editar — ${K().labelLargo(doc.id)}`
      : '<i data-lucide="plus"></i> Capturar mes';
    $('editMesRow').style.display = doc ? 'none' : '';
    $('editMes').value = doc ? doc.id : '';
    for (const f of METRICAS) $('f_' + f).value = doc?.[f] ?? '';
    $('c_ingresos').value = doc?.comentarios?.ingresos ?? '';
    $('c_recurrente').value = doc?.comentarios?.recurrente ?? '';
    $('c_suscriptores').value = doc?.comentarios?.suscriptores ?? '';
    updateConciliaHint();
    Modal.open('modalEdit');
    refreshIcons();
  }

  function readForm() {
    const num = (id) => { const v = $(id).value.trim(); return v === '' ? null : Number(v); };
    const d = {};
    for (const f of METRICAS) d[f] = num('f_' + f);
    return d;
  }

  function updateConciliaHint() {
    const d = readForm();
    const el = $('editConcilia');
    if (d.total_ingresos == null || d.recurrente == null) { el.textContent = ''; return; }
    const suma = K().round2((d.recurrente ?? 0) + (d.ventas ?? 0) + (d.otros ?? 0) - (d.ajustes ?? 0));
    const ok = Math.abs(suma - d.total_ingresos) <= 1;
    el.innerHTML = ok
      ? `<span style="color:#1FA56B;font-weight:600;">✓ Concilia</span> — componentes suman ${K().fmtMoney$(suma, 2)}`
      : `<span style="color:#D24545;font-weight:600;">⚠ No concilia</span> — componentes suman ${K().fmtMoney$(suma, 2)} vs total ${K().fmtMoney$(d.total_ingresos, 2)}`;
  }

  async function saveEdit() {
    const mes = state.editingMes || $('editMes').value;
    if (!/^\d{4}-\d{2}$/.test(mes)) { Toast.show('Selecciona el mes.', 'warn'); return; }
    const d = readForm();
    if (d.recurrente == null || d.total_ingresos == null || d.total_subs == null) {
      Toast.show('Recurrente, total de ingresos y suscriptores son obligatorios.', 'warn');
      return;
    }
    const suma = K().round2((d.recurrente ?? 0) + (d.ventas ?? 0) + (d.otros ?? 0) - (d.ajustes ?? 0));
    const data = {
      ...d,
      concilia: Math.abs(suma - d.total_ingresos) <= 1,
      comentarios: {
        ingresos: $('c_ingresos').value.trim(),
        recurrente: $('c_recurrente').value.trim(),
        suscriptores: $('c_suscriptores').value.trim(),
      },
      ...(state.editingMes ? {} : { fuente: 'manual', estado: 'borrador' }),
    };
    $('btnSaveEdit').disabled = true;
    try {
      await KpiReportsService.upsertMes(mes, data);
      Modal.close('modalEdit');
      Toast.show('Mes guardado.', 'ok');
      loadAll();
    } catch (err) {
      console.error(err);
      Toast.show('Error al guardar: ' + err.message, 'bad');
    } finally {
      $('btnSaveEdit').disabled = false;
    }
  }

  // ── init ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      $('btnImport').addEventListener('click', () => $('fileImport').click());
      $('fileImport').addEventListener('change', onFileChosen);
      $('selSheet').addEventListener('change', parseSelectedSheet);
      $('btnConfirmImport').addEventListener('click', confirmImport);
      $('btnCapturar').addEventListener('click', () => openEdit(null));
      $('btnPlantilla').addEventListener('click', descargarPlantilla);
      $('btnExportar').addEventListener('click', exportarHistorico);
      $('btnSaveEdit').addEventListener('click', saveEdit);
      $('tbodyMeses').addEventListener('click', onTableClick);
      document.querySelectorAll('.form-grid-kpi input')
        .forEach((i) => i.addEventListener('input', updateConciliaHint));
      loadAll().catch((err) => {
        console.error(err);
        Toast.show('Error al cargar: ' + err.message, 'bad');
      });
      refreshIcons();
    });
  });
})();
