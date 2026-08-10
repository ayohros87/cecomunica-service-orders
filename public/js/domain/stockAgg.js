// ÚNICA fuente del join conteo físico (inventario_actual) ↔ pool en bodega.
// Antes vivía triplicado — inventario-index.js, el modal de conciliación de
// inventario-equipos.js y vista-correo.html — y las copias ya habían divergido:
// el modal no casaba por label y vista-correo no filtraba modelos inactivos.
//
// Convención de signo en TODA la app: dif = seriales (pool) − conteo.
// Positivo = el pool tiene unidades que el conteo no vio; negativo = el conteo
// vio unidades que faltan en el pool (capturar con "Recibir · toma física").
//
// Depende de EquiposPoolService (modeloKey/_tightLabel) en tiempo de llamada,
// no de carga: cargar ambos scripts con defer en cualquier orden es seguro.
const StockAgg = {

  // Agrupa docs del pool por modelo — mismo criterio que
  // EquiposPoolService.contarBodegaPorModelo (modeloKey), para poder agrupar
  // un subconjunto ya cargado en memoria sin re-consultar Firestore.
  // Retorna Map<modeloKey, {modelo_id, modelo_label, n}>.
  agruparPool(docs) {
    const porModelo = new Map();
    for (const d of (docs || [])) {
      const key = EquiposPoolService.modeloKey(d.modelo_id, d.modelo_label);
      const cur = porModelo.get(key) || { modelo_id: d.modelo_id || null, modelo_label: d.modelo_label || '', n: 0 };
      cur.n++;
      porModelo.set(key, cur);
    }
    return porModelo;
  },

  // Join genérico conteos ↔ pool. Casa primero por modelo_id y como fallback
  // por label normalizado (grupos del pool sin id de catálogo).
  // conteos: docs de inventario_actual ({id = modelo_id, cantidad, ...}).
  // labelDeModelo: (modeloId) => label del catálogo ('' si no se conoce).
  // Retorna filas { modelo_id, label, data, conteo, seriales, dif, sinConteo }.
  join({ conteos, poolMap, labelDeModelo }) {
    const porId = new Map(), porLabel = new Map();
    (poolMap || new Map()).forEach(g => {
      if (g.modelo_id) porId.set(g.modelo_id, g);
      const tl = EquiposPoolService._tightLabel(g.modelo_label);
      if (tl && !porLabel.has(tl)) porLabel.set(tl, g);
    });

    const filas = [];
    const usados = new Set();
    for (const c of (conteos || [])) {
      const label = labelDeModelo(c.id) || '';
      const g = porId.get(c.id)
        || (label ? porLabel.get(EquiposPoolService._tightLabel(label)) : null) || null;
      if (g) usados.add(g);
      filas.push({
        modelo_id: c.id, label: label || c.id, data: c,
        conteo: c.cantidad ?? 0, seriales: g ? g.n : 0, sinConteo: false,
      });
    }
    // Modelos con unidades en el pool que el conteo físico aún no lista.
    (poolMap || new Map()).forEach(g => {
      if (usados.has(g)) return;
      filas.push({
        modelo_id: g.modelo_id || null,
        label: (g.modelo_id && labelDeModelo(g.modelo_id)) || g.modelo_label || '(sin modelo)',
        data: { modelo_id: g.modelo_id || null, cantidad: null },
        conteo: null, seriales: g.n, sinConteo: true,
      });
    });

    for (const f of filas) {
      f.dif = f.conteo == null ? null : Number(f.seriales) - Number(f.conteo);
    }
    return filas;
  },

  // Join decorado con el doc del modelo, para el tablero y el reporte.
  // Filtra modelos inactivos (fila perdedora de un dedup — caso HYTERA SC780)
  // y conteos cuyo modelo ya no está en el catálogo activo.
  build({ modelos, conteos, poolMap }) {
    const map = {};
    (modelos || []).filter(m => m.activo !== false).forEach(m => { map[m.id] = m; });
    const filas = this.join({
      conteos: (conteos || []).filter(c => map[c.id]),
      poolMap,
      labelDeModelo: id => (id && map[id] && map[id].modelo) || '',
    });
    for (const f of filas) {
      f.modelo = (f.modelo_id && map[f.modelo_id]) || { modelo: f.label };
    }
    this.ordenar(filas);
    return filas;
  },

  // Orden canónico del reporte: alto movimiento primero, luego marca/tipo/modelo.
  ordenar(filas) {
    filas.sort((a, b) => {
      const amA = a.modelo?.alto_movimiento === true ? 1 : 0;
      const amB = b.modelo?.alto_movimiento === true ? 1 : 0;
      if (amA !== amB) return amB - amA;
      const ma = (a.modelo?.marca || '').toLowerCase(), mb = (b.modelo?.marca || '').toLowerCase();
      if (ma !== mb) return ma.localeCompare(mb);
      const ta = (a.modelo?.tipo || '').toLowerCase(), tb = (b.modelo?.tipo || '').toLowerCase();
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.modelo?.modelo || '').toLowerCase().localeCompare((b.modelo?.modelo || '').toLowerCase());
    });
    return filas;
  },

  // Filas con conteo registrado y diferencia ≠ 0 — alimentan la bandeja de
  // trabajo de Almacén ("revisar diferencia de conteo").
  diferencias(filas) {
    return (filas || []).filter(f => f.dif != null && f.dif !== 0);
  },

  tipoTexto(t) { return t === 'P' ? 'Portátil' : t === 'C' ? 'Cámara' : t === 'B' ? 'Base' : '-'; },
  estadoTexto(e) { return e === 'N' ? 'Nuevo' : e === 'R' ? 'Refurbished' : '-'; },

  // Reporte para pegar en un correo. Estilos INTENCIONALMENTE inline: deben
  // sobrevivir el copy-paste a Outlook/Gmail (reemplaza a vista-correo.html).
  emailHtml(filas) {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const td = 'padding:6px 10px;border:1px solid #ccc;text-align:center;';
    const th = td + 'background-color:#f0f0f0;';
    const cuerpo = (filas || []).map(f => {
      const m = f.modelo || {};
      const difTxt = f.dif == null ? '-'
        : f.dif === 0 ? '0'
        : `<span style="color:${f.dif > 0 ? '#92400e' : '#b91c1c'};font-weight:bold;">${f.dif > 0 ? '+' : ''}${f.dif}</span>`;
      const ua = f.data?.ultima_actualizacion?.toDate ? f.data.ultima_actualizacion.toDate().toLocaleString() : '-';
      return `<tr>
        <td style="${td}">${esc(m.marca || '-')}</td>
        <td style="${td}">${esc(m.modelo || '-')}</td>
        <td style="${td}">${this.tipoTexto(m.tipo)}</td>
        <td style="${td}">${this.estadoTexto(m.estado)}</td>
        <td style="${td}">${m.alto_movimiento ? 'Sí' : 'No'}</td>
        <td style="${td}font-weight:bold;">${Number(f.seriales ?? 0)}</td>
        <td style="${td}">${f.conteo ?? '-'}</td>
        <td style="${td}">${difTxt}</td>
        <td style="${td}">${esc(ua)}</td>
      </tr>`;
    }).join('');
    return `<div style="font-family:Arial,sans-serif;color:#111;">
      <h2 style="font-family:Arial,sans-serif;margin:0 0 8px;">Inventario de radios — ${new Date().toLocaleDateString('es-PA')}</h2>
      <p style="font-size:13px;color:#555;margin:4px 0 10px;">Unidades = seriales en bodega (pool de equipos, reporte principal) · Conteo físico = verificación manual · Dif. = seriales − conteo (meta 0).</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead><tr>
          <th style="${th}">Marca</th><th style="${th}">Modelo</th><th style="${th}">Tipo</th>
          <th style="${th}">Estado</th><th style="${th}">Alto Movimiento</th>
          <th style="${th}">Unidades (seriales)</th><th style="${th}">Conteo físico</th>
          <th style="${th}">Dif.</th><th style="${th}">Último conteo</th>
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
    </div>`;
  },
};

window.StockAgg = StockAgg;
