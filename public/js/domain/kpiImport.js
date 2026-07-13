// Parser del workbook "Financial Report MM-YYYY.xlsx" (hoja CC Executive Report)
// a docs de kpi_reports. Puro: recibe filas (array de arrays, SheetJS header:1
// raw:true) y devuelve { meses, avisos }. Validado contra el archivo 06-2026.
//
// Estructura de la hoja: fila 1 = "Financial Report" + un label de mes por
// columna (Jan-16 .. corte, con formato sucio: "JuL-25", "Ago-25", "oct-22",
// a veces serial de Excel). Filas = métricas, identificadas por su label en la
// columna A. Solo se importa desde 2022-01: las series 2016–2021 tienen
// inconsistencias de captura (ver nota metodológica del reporte).
const KpiImport = {

  DESDE: '2022-01',

  MESES: { jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6,
           jul: 7, aug: 8, ago: 8, sep: 9, oct: 10, nov: 11, dec: 12, dic: 12 },

  // Orden importa: labels más específicos primero. OJO: la fila que alimenta el
  // total es "Otros" (no "Otros Ingresos", que está vacía en la fuente).
  ROW_MAP: [
    { key: 'kenwood',        re: /^ingresos?\s+recurrente\s+kenwood/i },
    { key: 'hytera',         re: /^ingresos?\s+recurrente\s+hytera/i },
    { key: 'recurrente',     re: /^ingresos?\s+recurrentes?\s*$/i },
    { key: 'ventas',         re: /^ingresos?\s+por\s+ventas/i },
    { key: 'otros',          re: /^otros\s*$/i },
    { key: 'ajustes',        re: /^otros\s*-\s*ajustes/i },
    { key: 'total_ingresos', re: /^total\s+ingresos/i },
    { key: 'act_brutas',     re: /^activaciones\s+brutas/i },
    { key: 'bajas',          re: /^bajas\s*$/i },
    { key: 'churn',          re: /^churn\s*$/i },
    { key: '_netas_src',     re: /^activaciones\s+netas/i },
    { key: 'total_subs',     re: /^total\s+suscriptores/i },
  ],

  // "Jan-22" | "Ago-25" | serial Excel → "YYYY-MM" | null
  parseMonthLabel(v) {
    if (v == null) return null;
    if (typeof v === 'number') {
      // Serial date de Excel (época 1900): días desde 1899-12-30.
      if (v < 20000 || v > 80000) return null;
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      const y = d.getUTCFullYear();
      if (y < 2000) return null;
      return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    const m = String(v).trim().toLowerCase().match(/^([a-záéí]{3,4})[-\s]?(\d{2,4})$/i);
    if (!m) return null;
    const mon = this.MESES[m[1].slice(0, 3)];
    if (!mon) return null;
    let y = +m[2]; if (y < 100) y += 2000;
    return `${y}-${String(mon).padStart(2, '0')}`;
  },

  // rows → { meses: {"YYYY-MM": {métricas..., concilia}}, avisos: [string] }
  // Lanza Error si la hoja no tiene la estructura esperada.
  parse(rows) {
    const avisos = [];

    // Fila de encabezado: la primera (entre las 10 primeras) con >20 labels de mes.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const n = (rows[i] || []).filter(v => this.parseMonthLabel(v)).length;
      if (n > 20) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('No encontré la fila de meses (¿hoja equivocada?)');

    const cols = [];
    (rows[headerIdx] || []).forEach((v, c) => {
      const mes = this.parseMonthLabel(v);
      if (mes) cols.push({ col: c, mes });
    });

    // Localizar cada métrica por su label en columna A.
    const found = {};
    rows.forEach((row, i) => {
      const label = row && row[0] != null ? String(row[0]).trim() : '';
      if (!label) return;
      for (const { key, re } of this.ROW_MAP) {
        if (found[key] == null && re.test(label)) { found[key] = i; break; }
      }
    });
    for (const req of ['recurrente', 'total_ingresos', 'total_subs']) {
      if (found[req] == null) throw new Error(`No encontré la fila "${req}" en la hoja`);
    }

    const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
    const val = (key, col) => (found[key] != null ? num(rows[found[key]][col]) : null);
    const r2 = x => Math.round(x * 100) / 100;

    const meses = {};
    for (const { col, mes } of cols) {
      if (mes < this.DESDE) continue;
      const d = {
        recurrente: val('recurrente', col),
        kenwood: val('kenwood', col),
        hytera: val('hytera', col),
        ventas: val('ventas', col) ?? 0,
        otros: val('otros', col) ?? 0,
        ajustes: val('ajustes', col) ?? 0,
        total_ingresos: val('total_ingresos', col),
        act_brutas: val('act_brutas', col) ?? 0,
        bajas: val('bajas', col) ?? 0,
        total_subs: val('total_subs', col),
        churn: val('churn', col),
      };
      // Mes sin datos (columnas futuras del template) → se salta.
      if (d.recurrente == null && d.total_ingresos == null && d.total_subs == null) continue;

      // Fuente incompleta: brutas vacía pero netas presente (caso Mar-2025) → derivar.
      const netasSrc = val('_netas_src', col);
      if (val('act_brutas', col) == null && netasSrc != null) {
        d.act_brutas = netasSrc + d.bajas;
        avisos.push(`${mes}: activaciones brutas vacía en la fuente; derivada = netas (${netasSrc}) + bajas (${d.bajas}) = ${d.act_brutas}`);
      }

      const suma = r2((d.recurrente ?? 0) + d.ventas + d.otros - d.ajustes);
      d.concilia = d.total_ingresos != null && Math.abs(suma - d.total_ingresos) <= 1;
      if (!d.concilia) avisos.push(`${mes}: NO concilia — componentes suman ${suma} vs total ${d.total_ingresos}`);
      if (netasSrc != null && (d.act_brutas - d.bajas) !== netasSrc) {
        avisos.push(`${mes}: netas de la fuente (${netasSrc}) ≠ brutas−bajas (${d.act_brutas - d.bajas})`);
      }
      meses[mes] = d;
    }
    if (!Object.keys(meses).length) throw new Error(`La hoja no tiene meses desde ${this.DESDE}`);
    return { meses, avisos };
  },
};

window.KpiImport = KpiImport;
