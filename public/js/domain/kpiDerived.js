// Cálculos derivados del reporte de KPIs a la junta (sin DOM, sin Firestore).
// Opera sobre docs de kpi_reports: { id:"YYYY-MM", recurrente, kenwood, hytera,
// ventas, otros, ajustes, total_ingresos, act_brutas, bajas, total_subs, churn }.
// Convención: `docs` es la lista completa; internamente se indexa por id.
const KpiDerived = {

  round2(x) { return Math.round(x * 100) / 100; },

  // ── claves de mes ──────────────────────────────────────────────────────
  mesKey(y, m) { return `${y}-${String(m).padStart(2, '0')}`; },
  parseKey(key) { const [y, m] = key.split('-').map(Number); return { y, m }; },
  addMonths(key, delta) {
    const { y, m } = this.parseKey(key);
    const t = y * 12 + (m - 1) + delta;
    return this.mesKey(Math.floor(t / 12), (t % 12) + 1);
  },
  prevYearKey(key) { return this.addMonths(key, -12); },

  MESES_CORTO: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  MESES_LARGO: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
                'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  labelCorto(key) { const { m } = this.parseKey(key); return this.MESES_CORTO[m - 1]; },
  labelLargo(key) { const { y, m } = this.parseKey(key); return `${this.MESES_LARGO[m - 1]} ${y}`; },
  // Último día del mes, formateado corto (30-jun-2026) para el "Corte:".
  corteLabel(key) {
    const { y, m } = this.parseKey(key);
    const dias = new Date(y, m, 0).getDate();
    return `${dias}-${this.MESES_CORTO[m - 1]}-${y}`;
  },

  // ── métricas por doc ───────────────────────────────────────────────────
  actNetas(d) { return (d.act_brutas ?? 0) - (d.bajas ?? 0); },
  arpu(d) { return d.total_subs ? (d.recurrente ?? 0) / d.total_subs : null; },
  // total_ingresos declarado vs suma de componentes (tolerancia $1)
  concilia(d) {
    if (d.total_ingresos == null) return false;
    const suma = (d.recurrente ?? 0) + (d.ventas ?? 0) + (d.otros ?? 0) - (d.ajustes ?? 0);
    return Math.abs(suma - d.total_ingresos) <= 1;
  },

  // ── agregados ──────────────────────────────────────────────────────────
  byId(docs) {
    const map = {};
    for (const d of docs) map[d.id] = d;
    return map;
  },

  // Suma ene..mes-de-corte del año de `upToKey`. `field` métrica base o
  // 'act_netas' (derivada). Devuelve null si NINGÚN mes del rango existe.
  ytd(docs, upToKey, field) {
    const map = this.byId(docs);
    const { y, m } = this.parseKey(upToKey);
    let sum = 0, found = false;
    for (let i = 1; i <= m; i++) {
      const d = map[this.mesKey(y, i)];
      if (!d) continue;
      found = true;
      sum += field === 'act_netas' ? this.actNetas(d) : (d[field] ?? 0);
    }
    return found ? this.round2(sum) : null;
  },

  // Variación % (null si no hay base). Con base negativa no tiene lectura útil → null.
  varPct(cur, prev) {
    if (cur == null || prev == null || prev <= 0) return null;
    return (cur - prev) / prev * 100;
  },

  // Serie de n meses consecutivos terminando en upToKey.
  // → { keys, labels, values } (null en meses faltantes).
  series(docs, upToKey, field, n) {
    const map = this.byId(docs);
    const keys = [];
    for (let i = n - 1; i >= 0; i--) keys.push(this.addMonths(upToKey, -i));
    const values = keys.map(k => {
      const d = map[k];
      if (!d) return null;
      return field === 'act_netas' ? this.actNetas(d) : (d[field] ?? null);
    });
    return { keys, labels: keys.map(k => this.labelCorto(k)), values };
  },

  // ── formato (el reporte usa US$ sin decimales, signo − tipográfico) ─────
  fmtMoney(v, dec = 0) {
    if (v == null) return '—';
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return (v < 0 ? '−' : '') + s;
  },
  fmtMoney$(v, dec = 0) { return v == null ? '—' : (v < 0 ? '−$' : '$') + this.fmtMoney(Math.abs(v), dec); },
  fmtInt(v) {
    if (v == null) return '—';
    return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US');
  },
  fmtVar(pct) {
    if (pct == null) return '—';
    const s = Math.abs(pct).toFixed(1) + '%';
    return pct >= 0 ? '+' + s : '−' + s;
  },
};

window.KpiDerived = KpiDerived;
