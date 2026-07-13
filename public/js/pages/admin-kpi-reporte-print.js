/**
 * admin-kpi-reporte-print.js — reporte ejecutivo de KPIs a la junta directiva.
 *
 * Render del rediseño (Reporte Ejecutivo KPIs.dc.html) desde kpi_reports:
 * ?mes=YYYY-MM elige el corte (default: último mes archivado). Las gráficas
 * son SVG generado en vanilla JS, port 1:1 de las del diseño original.
 * Descarga = Imprimir/PDF del navegador (@page letter portrait).
 */
(function () {
  'use strict';

  const K = () => window.KpiDerived;
  const state = { docs: [], byId: {}, mes: null };
  const $ = (id) => document.getElementById(id);

  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const fmtK = (v) => '$' + Math.round(v / 1000) + 'k';

  // ── charts (port del dc.html: barChart / lineChart) ──────────────────────
  const MONO = 'font-family="IBM Plex Mono, monospace" font-size="9.5"';

  function barChart(vals, labels, W, H, opts = {}) {
    const max = Math.max(...vals, 0);
    const min = Math.min(...vals, 0);
    const padT = 16, padB = 18, padL = 4, padR = 4;
    const ih = H - padT - padB;
    const y = (v) => padT + (max - v) / (max - min || 1) * ih;
    const bw = (W - padL - padR) / vals.length;
    const p = [];
    p.push(`<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" stroke="#C2CCD6" stroke-width="1"/>`);
    vals.forEach((v, i) => {
      const x = padL + i * bw + bw * 0.14;
      const last = i === vals.length - 1;
      const neg = v < 0;
      const fill = opts.signed ? (neg ? '#D24545' : '#1FA56B') : (last ? '#0B2A47' : '#A1D5F7');
      p.push(`<rect x="${x}" width="${bw * 0.72}" y="${neg ? y(0) : y(v)}" height="${Math.max(Math.abs(y(v) - y(0)), 1)}" rx="2" fill="${fill}"/>`);
      p.push(`<text x="${padL + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle" ${MONO} fill="#6B7884">${labels[i]}</text>`);
      if (opts.valueLabels || last) {
        p.push(`<text x="${padL + i * bw + bw / 2}" y="${neg ? y(v) + 12 : y(v) - 4}" text-anchor="middle" ${MONO} fill="${last ? '#0E1418' : '#6B7884'}" font-weight="${last ? 600 : 400}">${opts.fmt ? opts.fmt(v) : v}</text>`);
      }
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">${p.join('')}</svg>`;
  }

  function lineChart(seriesList, labels, W, H, opts = {}) {
    const n = labels.length;
    const all = seriesList.flatMap((s) => s.data);
    const max = Math.max(...all), min = Math.min(...all);
    const span = max - min || 1;
    const padT = 16, padB = 18, padL = 14, padR = opts.padR ?? 40;
    const ih = H - padT - padB;
    const y = (v) => padT + (max - v) / span * ih * 0.92 + ih * 0.04;
    const step = (W - padL - padR) / (n - 1 || 1);
    const p = [];
    p.push(`<line x1="${padL}" x2="${W - padR}" y1="${H - padB}" y2="${H - padB}" stroke="#DDE4EB" stroke-width="1"/>`);
    labels.forEach((m, i) => {
      if (n <= 6 || i % 2 === 0 || i === n - 1) {
        p.push(`<text x="${padL + i * step}" y="${H - 4}" text-anchor="middle" ${MONO} fill="#6B7884">${m}</text>`);
      }
    });
    seriesList.forEach((s) => {
      const pts = s.data.map((v, i) => `${padL + i * step},${y(v)}`).join(' ');
      p.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);
      const lv = s.data[s.data.length - 1];
      p.push(`<circle cx="${padL + (n - 1) * step}" cy="${y(lv)}" r="3" fill="${s.color}"/>`);
      p.push(`<text x="${padL + (n - 1) * step + 6}" y="${y(lv) + 3.5}" ${MONO} fill="#0E1418" font-weight="600">${opts.fmt ? opts.fmt(lv) : lv.toLocaleString('en-US')}</text>`);
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;">${p.join('')}</svg>`;
  }

  // ── helpers de presentación ──────────────────────────────────────────────
  function deltaHtml(pct, ctx) {
    if (pct == null) return `<div class="delta flat">— <span class="ctx">${ctx}</span></div>`;
    const cls = pct >= 0 ? 'up' : 'down';
    return `<div class="delta ${cls}">${K().fmtVar(pct)} <span class="ctx">${ctx}</span></div>`;
  }

  function varCell(pct) {
    if (pct == null) return '<td class="var-flat">—</td>';
    return `<td class="${pct >= 0 ? 'var-pos' : 'var-neg'}">${K().fmtVar(pct)}</td>`;
  }

  function comentario(texto) {
    if (!texto) return '';
    return `<div class="comment-box">
      <div class="tag">Comentario de gerencia</div>
      <p>${esc(texto)}</p>
    </div>`;
  }

  // Serie 12m recortando meses sin datos al inicio (cortes tempranos de 2022).
  function serie12(field, mes) {
    const s = K().series(state.docs, mes, field, 12);
    let start = 0;
    while (start < s.values.length && s.values[start] == null) start++;
    return { labels: s.labels.slice(start), values: s.values.slice(start).map((v) => v ?? 0), keys: s.keys.slice(start) };
  }

  // ── render principal ─────────────────────────────────────────────────────
  function render(mes) {
    state.mes = mes;
    const d = state.byId[mes];
    const { y } = K().parseKey(mes);
    const yPrev = y - 1;
    const mesCortoCap = K().labelCorto(mes);
    const prevKey = K().prevYearKey(mes);
    const dPrev = state.byId[prevKey];

    const ytd = (f) => K().ytd(state.docs, mes, f);
    const ytdPrev = (f) => (state.byId[`${yPrev}-01`] || state.byId[prevKey]) ? K().ytd(state.docs, prevKey, f) : null;

    const F = K().fmtMoney$.bind(K());
    const I = K().fmtInt.bind(K());

    // agregados
    const totYtd = ytd('total_ingresos'), totYtdPrev = ytdPrev('total_ingresos');
    const recYtd = ytd('recurrente'),     recYtdPrev = ytdPrev('recurrente');
    const venYtd = ytd('ventas'),         venYtdPrev = ytdPrev('ventas');
    const otrYtd = ytd('otros'),          otrYtdPrev = ytdPrev('otros');
    const ajuYtd = ytd('ajustes'),        ajuYtdPrev = ytdPrev('ajustes');
    const kenYtd = ytd('kenwood'),        kenYtdPrev = ytdPrev('kenwood');
    const hytYtd = ytd('hytera'),         hytYtdPrev = ytdPrev('hytera');
    const netasYtd = ytd('act_netas'),    netasYtdPrev = ytdPrev('act_netas');
    const netasMes = K().actNetas(d);
    const arpuMes = K().arpu(d);
    const arpuPrev = dPrev ? K().arpu(dPrev) : null;

    const rangoYtd = `enero–${K().MESES_LARGO[K().parseKey(mes).m - 1].toLowerCase()}`;

    // series 12 meses
    const sTot = serie12('total_ingresos', mes);
    const sHyt = serie12('hytera', mes);
    const sKen = serie12('kenwood', mes);
    const sSub = serie12('total_subs', mes);
    const sNet = serie12('act_netas', mes);
    const rangoSerie = sTot.labels.length > 1
      ? `${sTot.labels[0]} ${K().parseKey(sTot.keys[0]).y} – ${sTot.labels[sTot.labels.length - 1]} ${y}` : '';

    const hoy = new Date();
    const emitido = `${hoy.getDate()}-${K().MESES_CORTO[hoy.getMonth()]}-${hoy.getFullYear()}`;

    const parts = [];

    // ── masthead + título ──
    parts.push(`
      <div class="masthead">
        <div>
          <img src="../brand/logo-lockup-horizontal.svg" alt="CeComunica">
          <div class="kicker">Reporte a la Junta Directiva · Confidencial</div>
        </div>
        <div class="fechas">
          <div>Corte: ${K().corteLabel(mes)}</div>
          <div>Emitido: ${emitido}</div>
        </div>
      </div>
      <h1>Reporte ejecutivo de KPIs — ${K().labelLargo(mes)}</h1>
      <p class="subtitle">Resultados del mes y acumulado ${rangoYtd} ${y}, comparados contra el mismo período de ${yPrev}. Cifras en US$.</p>`);

    // ── 1 · resumen ──
    parts.push(`<div class="section-label">1 · Resumen del período</div>
      <div class="tile-grid">
        <div class="kpi-tile">
          <div class="lbl">Ingreso total · YTD</div>
          <div class="val">${F(totYtd)}</div>
          ${deltaHtml(K().varPct(totYtd, totYtdPrev), totYtdPrev != null ? `vs ${yPrev} (${F(totYtdPrev)})` : 'sin comparativo')}
        </div>
        <div class="kpi-tile">
          <div class="lbl">Ingreso recurrente · YTD</div>
          <div class="val">${F(recYtd)}</div>
          ${deltaHtml(K().varPct(recYtd, recYtdPrev), recYtdPrev != null ? `vs ${yPrev} (${F(recYtdPrev)})` : 'sin comparativo')}
        </div>
        <div class="kpi-tile">
          <div class="lbl">Ventas de equipos · YTD</div>
          <div class="val">${F(venYtd)}</div>
          ${deltaHtml(K().varPct(venYtd, venYtdPrev), venYtdPrev != null ? `vs ${yPrev} (${F(venYtdPrev)})` : 'sin comparativo')}
        </div>
      </div>
      <div class="tile-grid" style="margin-bottom:18px;">
        <div class="kpi-tile">
          <div class="lbl">Suscriptores · ${mesCortoCap} ${y}</div>
          <div class="val">${I(d.total_subs)}</div>
          ${deltaHtml(K().varPct(d.total_subs, dPrev?.total_subs), dPrev ? `vs ${mesCortoCap} ${yPrev} (${I(dPrev.total_subs)})` : 'sin comparativo')}
        </div>
        <div class="kpi-tile">
          <div class="lbl">Activaciones netas · YTD</div>
          <div class="val" style="${netasYtd < 0 ? 'color:#D24545;' : ''}">${netasYtd > 0 ? '+' : ''}${I(netasYtd)}</div>
          <div class="delta ${netasYtdPrev == null ? 'flat' : (netasYtdPrev >= 0 ? 'up' : 'down')}">${netasYtdPrev != null ? `vs ${netasYtdPrev > 0 ? '+' : ''}${I(netasYtdPrev)} <span class="ctx">en ${yPrev}</span>` : '<span class="ctx">sin comparativo</span>'}</div>
        </div>
        <div class="kpi-tile">
          <div class="lbl">Ingreso total · ${K().MESES_LARGO[K().parseKey(mes).m - 1]}</div>
          <div class="val">${F(d.total_ingresos)}</div>
          <div class="delta flat"><span class="ctx">${d.ventas ? `incluye venta de equipos por ${F(d.ventas)}` : 'sin ventas de equipos en el mes'}</span></div>
        </div>
      </div>`);

    // ── 2 · ingresos ──
    const row = (nombre, mesV, ytdV, ytdPrevV, opts = {}) => {
      const cls = opts.sub ? 'sub' : 'strong';
      const vcls = opts.sub ? 'subval' : '';
      const neg = opts.negativo ? -1 : 1;
      const fmt = (v) => v == null ? '—' : K().fmtMoney(neg * v);
      return `<tr>
        <td class="${cls}">${nombre}</td>
        <td class="${vcls}">${fmt(mesV)}</td>
        <td class="${vcls}">${fmt(ytdV)}</td>
        <td class="${vcls}">${fmt(ytdPrevV)}</td>
        ${opts.negativo ? '<td class="var-flat">—</td>' : varCell(K().varPct(ytdV, ytdPrevV))}
      </tr>`;
    };
    parts.push(`<div class="section-label">2 · Ingresos</div>
      <table class="rpt">
        <thead><tr>
          <th>Concepto</th><th>${mesCortoCap.charAt(0).toUpperCase() + mesCortoCap.slice(1)} ${y}</th>
          <th>YTD ${y}</th><th>YTD ${yPrev}</th><th>Var. %</th>
        </tr></thead>
        <tbody>
          ${row('Ingreso recurrente', d.recurrente, recYtd, recYtdPrev)}
          ${row('Kenwood', d.kenwood, kenYtd, kenYtdPrev, { sub: true })}
          ${row('Hytera / LTE', d.hytera, hytYtd, hytYtdPrev, { sub: true })}
          ${row('Ventas de equipos', d.ventas, venYtd, venYtdPrev)}
          ${row('Otros ingresos', d.otros, otrYtd, otrYtdPrev)}
          ${row('Ajustes', d.ajustes, ajuYtd, ajuYtdPrev, { negativo: true })}
          <tr class="total">
            <td>Total ingresos</td>
            <td>${K().fmtMoney(d.total_ingresos)}</td>
            <td>${K().fmtMoney(totYtd)}</td>
            <td>${totYtdPrev == null ? '—' : K().fmtMoney(totYtdPrev)}</td>
            ${varCell(K().varPct(totYtd, totYtdPrev))}
          </tr>
        </tbody>
      </table>`);
    if (sTot.values.length > 1) {
      parts.push(`<div class="chart-block">
        <div class="chart-title">Ingreso total mensual · ${rangoSerie}</div>
        ${barChart(sTot.values, sTot.labels, 660, 130, { valueLabels: true, fmt: fmtK })}
      </div>`);
    }
    parts.push(comentario(d.comentarios?.ingresos));

    // ── 3 · recurrente ──
    const hytShare = recYtd ? hytYtd / recYtd * 100 : null;
    const hytSharePrev = (recYtdPrev && hytYtdPrev != null) ? hytYtdPrev / recYtdPrev * 100 : null;
    const kenDelta = (kenYtd != null && kenYtdPrev != null) ? kenYtd - kenYtdPrev : null;
    const hytDelta = (hytYtd != null && hytYtdPrev != null) ? hytYtd - hytYtdPrev : null;
    parts.push(`<div class="section-label">3 · Ingreso recurrente — Kenwood vs Hytera</div>`);
    if (sHyt.values.length > 1) {
      parts.push(`<div class="chart-block">
        <div class="chart-head">
          <div class="chart-title" style="margin:0;">Recurrente mensual por línea · ${rangoSerie}</div>
          <div class="legend">
            <span><i style="background:#00B4D8;"></i>Hytera / LTE</span>
            <span><i style="background:#9AA7B4;"></i>Kenwood</span>
          </div>
        </div>
        ${lineChart([{ data: sHyt.values, color: '#00B4D8' }, { data: sKen.values, color: '#9AA7B4' }], sHyt.labels, 660, 130, { fmt: fmtK })}
      </div>`);
    }
    parts.push(`<div class="tile-grid" style="margin-bottom:14px;">
        <div class="kpi-tile" style="padding:12px 16px;">
          <div class="lbl">Hytera sobre el recurrente</div>
          <div class="val sm">${hytShare == null ? '—' : hytShare.toFixed(1) + '%'}</div>
          <div class="note">${hytSharePrev == null ? '&nbsp;' : hytSharePrev.toFixed(1) + '% en ' + yPrev}</div>
        </div>
        <div class="kpi-tile" style="padding:12px 16px;">
          <div class="lbl">ARPU recurrente · ${mesCortoCap} ${y}</div>
          <div class="val sm">${arpuMes == null ? '—' : '$' + arpuMes.toFixed(2)}</div>
          <div class="note">${arpuPrev == null ? '&nbsp;' : '$' + arpuPrev.toFixed(2) + ' en ' + mesCortoCap + ' ' + yPrev}</div>
        </div>
        <div class="kpi-tile" style="padding:12px 16px;">
          <div class="lbl">Kenwood · variación YTD</div>
          <div class="val sm" style="color:${kenDelta == null ? '#0E1418' : (kenDelta < 0 ? '#D24545' : '#1FA56B')};">${kenDelta == null ? '—' : F(K().round2(kenDelta))}</div>
          <div class="note">${hytDelta == null ? '&nbsp;'
            : (hytDelta >= 0 ? `compensado por Hytera (+${F(K().round2(hytDelta))})` : `Hytera también varía (${F(K().round2(hytDelta))})`)}</div>
        </div>
      </div>`);
    parts.push(comentario(d.comentarios?.recurrente));

    // ── 4 · suscriptores ──
    const bruYtd = ytd('act_brutas'), bruYtdPrev = ytdPrev('act_brutas');
    const bajYtd = ytd('bajas'), bajYtdPrev = ytdPrev('bajas');
    parts.push(`<div class="section-label">4 · Suscriptores y actividad</div>`);
    if (sSub.values.length > 1) {
      parts.push(`<div class="two-col">
        <div class="chart-block" style="margin-bottom:0;">
          <div class="chart-title">Suscriptores totales</div>
          ${lineChart([{ data: sSub.values, color: '#0B2A47' }], sSub.labels, 320, 120, {})}
        </div>
        <div class="chart-block" style="margin-bottom:0;">
          <div class="chart-title">Activaciones netas por mes</div>
          ${barChart(sNet.values, sNet.labels, 320, 120, { signed: true })}
        </div>
      </div>`);
    }
    const netasCell = (v) => v == null ? '—' : `<span style="color:${v < 0 ? '#D24545' : '#0E1418'};">${v > 0 ? '+' : ''}${I(v)}</span>`;
    parts.push(`<table class="rpt">
        <thead><tr>
          <th>Actividad</th><th>${mesCortoCap.charAt(0).toUpperCase() + mesCortoCap.slice(1)} ${y}</th>
          <th>YTD ${y}</th><th>YTD ${yPrev}</th>
        </tr></thead>
        <tbody>
          <tr><td>Activaciones brutas</td><td>${I(d.act_brutas)}</td><td>${I(bruYtd)}</td><td>${bruYtdPrev == null ? '—' : I(bruYtdPrev)}</td></tr>
          <tr><td>Bajas</td><td>${I(d.bajas)}</td><td>${I(bajYtd)}</td><td>${bajYtdPrev == null ? '—' : I(bajYtdPrev)}</td></tr>
          <tr class="total">
            <td>Activaciones netas</td>
            <td>${netasCell(netasMes)}</td>
            <td>${netasCell(netasYtd)}</td>
            <td>${netasCell(netasYtdPrev)}</td>
          </tr>
        </tbody>
      </table>`);
    parts.push(comentario(d.comentarios?.suscriptores));

    // ── nota metodológica ──
    const fuente = d.source_file ? ` Fuente: ${esc(d.source_file)}.` : '';
    parts.push(`<div class="nota">
      <p>Nota metodológica: series 2022–${y} del archivo de KPIs (módulo Reporte KPIs Junta), conciliadas
      contra los componentes de ingreso (recurrente + ventas + otros − ajustes)${d.concilia === false ? ' — este mes presenta una diferencia de conciliación en la fuente' : ''}.
      Se excluyen series históricas 2016–2021 con inconsistencias de captura.${fuente}</p>
    </div>`);

    $('reporte').innerHTML = parts.join('');

    // estado / watermark
    const publicado = d.estado === 'publicado';
    $('watermark').style.display = publicado ? 'none' : '';
    $('badgeEstado').innerHTML = publicado ? '' : '<span class="badge-borrador">BORRADOR</span>';
    document.title = `Reporte Ejecutivo KPIs — ${K().labelLargo(mes)} — Cecomunica`;
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function populateSelect() {
    $('selMes').innerHTML = [...state.docs].reverse()
      .map((d) => `<option value="${d.id}" ${d.id === state.mes ? 'selected' : ''}>${K().labelLargo(d.id)}</option>`)
      .join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      if (rol !== ROLES.ADMIN) { location.href = '../index.html'; return; }
      try {
        state.docs = await KpiReportsService.listAll();
      } catch (err) {
        console.error(err);
        $('estadoVacio').style.display = '';
        $('estadoVacio').textContent = 'Error al cargar los datos: ' + err.message;
        return;
      }
      if (!state.docs.length) {
        $('estadoVacio').style.display = '';
        $('estadoVacio').innerHTML = 'Sin datos archivados aún. Importa el Financial Report desde <a href="kpi-reportes.html">el archivo de KPIs</a>.';
        return;
      }
      state.byId = K().byId(state.docs);
      const param = new URLSearchParams(location.search).get('mes');
      state.mes = state.byId[param] ? param : state.docs[state.docs.length - 1].id;

      $('sheet').style.display = '';
      populateSelect();
      render(state.mes);

      $('selMes').addEventListener('change', (e) => {
        history.replaceState(null, '', `?mes=${e.target.value}`);
        render(e.target.value);
      });
      $('chkComentarios').addEventListener('change', (e) => {
        document.body.classList.toggle('sin-comentarios', !e.target.checked);
      });
    });
  });
})();
