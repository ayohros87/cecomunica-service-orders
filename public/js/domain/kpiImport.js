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
    const s = String(v).trim().toLowerCase();
    // Formato ISO de la plantilla: "2026-06" (también "2026/06" o "2026-6").
    const iso = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (iso && +iso[2] >= 1 && +iso[2] <= 12) return `${iso[1]}-${String(+iso[2]).padStart(2, '0')}`;
    // "Jun-26", "Ago-25", "junio 2026", …
    const m = s.match(/^([a-záéí]{3,12})[-\s]?(\d{2,4})$/i);
    if (!m) return null;
    const mon = this.MESES[m[1].slice(0, 3)];
    if (!mon) return null;
    let y = +m[2]; if (y < 100) y += 2000;
    return `${y}-${String(mon).padStart(2, '0')}`;
  },

  // Columnas del formato PLANTILLA (tabular: una fila por mes). Se identifican
  // por regex sobre el header normalizado (minúsculas, sin acentos).
  COL_MAP: [
    { key: 'mes',            re: /^mes/ },
    { key: 'kenwood',        re: /kenwood/ },
    { key: 'hytera',         re: /hytera/ },
    { key: 'recurrente',     re: /recurrente/ },          // tras kenwood/hytera
    { key: 'ventas',         re: /ventas/ },
    { key: 'ajustes',        re: /ajuste/ },
    { key: 'otros',          re: /^otros/ },              // tras ajustes ("Otros - Ajustes")
    { key: 'total_ingresos', re: /^total/ },
    { key: 'act_brutas',     re: /bruta|activacion/ },
    { key: 'bajas',          re: /^bajas/ },
    { key: 'total_subs',     re: /suscriptor|^subs/ },
    { key: 'churn',          re: /churn/ },
  ],

  _norm(s) {
    return String(s ?? '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');   // sin acentos
  },

  // Validación compartida: conciliación + consistencia de netas.
  _validar(mes, d, netasSrc, avisos) {
    const r2 = (x) => Math.round(x * 100) / 100;
    const suma = r2((d.recurrente ?? 0) + d.ventas + d.otros - d.ajustes);
    if (d.total_ingresos == null) {
      // La plantilla permite omitir el total: se calcula de los componentes.
      d.total_ingresos = suma;
      d.concilia = true;
    } else {
      d.concilia = Math.abs(suma - d.total_ingresos) <= 1;
      if (!d.concilia) avisos.push(`${mes}: NO concilia — componentes suman ${suma} vs total ${d.total_ingresos}`);
    }
    if (netasSrc != null && (d.act_brutas - d.bajas) !== netasSrc) {
      avisos.push(`${mes}: netas de la fuente (${netasSrc}) ≠ brutas−bajas (${d.act_brutas - d.bajas})`);
    }
  },

  // rows → { meses: {"YYYY-MM": {métricas..., concilia}}, avisos: [string] }
  // Detecta el formato: PLANTILLA (header "Mes | Ingreso recurrente | …", una
  // fila por mes) o LEGACY (Financial Report: meses como columnas, métricas
  // como filas). Lanza Error si la hoja no tiene ninguna de las dos estructuras.
  parse(rows) {
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const cells = (rows[i] || []).map((c) => this._norm(c));
      if (cells.some((c) => /^mes/.test(c)) && cells.some((c) => /recurrente/.test(c))) {
        return this.parseTabular(rows, i);
      }
    }
    return this.parseLegacy(rows);
  },

  // ── formato PLANTILLA ────────────────────────────────────────────────────
  parseTabular(rows, headerIdx) {
    const avisos = [];
    const cols = {};
    (rows[headerIdx] || []).forEach((h, c) => {
      const n = this._norm(h);
      if (!n) return;
      for (const { key, re } of this.COL_MAP) {
        if (cols[key] == null && re.test(n)) { cols[key] = c; break; }
      }
    });
    for (const req of ['mes', 'recurrente', 'total_subs']) {
      if (cols[req] == null) throw new Error(`Falta la columna "${req}" en la plantilla`);
    }

    const num = (row, key) => {
      if (cols[key] == null) return null;
      const v = row[cols[key]];
      return typeof v === 'number' && isFinite(v) ? v : null;
    };

    const meses = {};
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.every((c) => c == null || c === '')) continue;
      const mes = this.parseMonthLabel(row[cols.mes]);
      if (!mes) {
        avisos.push(`Fila ${i + 1}: mes no reconocido ("${row[cols.mes] ?? ''}") — se omite`);
        continue;
      }
      if (mes < this.DESDE) { avisos.push(`${mes}: anterior a ${this.DESDE} — se omite`); continue; }
      if (meses[mes]) { avisos.push(`${mes}: fila duplicada — se usa la última`); }
      const d = {
        recurrente: num(row, 'recurrente'),
        kenwood: num(row, 'kenwood'),
        hytera: num(row, 'hytera'),
        ventas: num(row, 'ventas') ?? 0,
        otros: num(row, 'otros') ?? 0,
        ajustes: num(row, 'ajustes') ?? 0,
        total_ingresos: num(row, 'total_ingresos'),
        act_brutas: num(row, 'act_brutas') ?? 0,
        bajas: num(row, 'bajas') ?? 0,
        total_subs: num(row, 'total_subs'),
        churn: num(row, 'churn'),
      };
      if (d.recurrente == null || d.total_subs == null) {
        avisos.push(`${mes}: falta ingreso recurrente o suscriptores — se omite`);
        continue;
      }
      this._validar(mes, d, null, avisos);
      meses[mes] = d;
    }
    if (!Object.keys(meses).length) throw new Error('La plantilla no tiene filas de meses válidas');
    return { meses, avisos };
  },

  // ── formato LEGACY (Financial Report) ────────────────────────────────────
  parseLegacy(rows) {
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
