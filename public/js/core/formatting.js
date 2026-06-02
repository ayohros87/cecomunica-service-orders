// Shared formatting utilities — single source of truth for money, dates, ITBMS
window.FMT = {
  ITBMS_RATE: 0.07,

  // "$1,234.56" — Panama locale, USD
  money(n) {
    return Number(n || 0).toLocaleString('es-PA', { style: 'currency', currency: 'USD' });
  },

  // Round to 2 decimal places
  round2(n) {
    return Math.round(Number(n || 0) * 100) / 100;
  },

  // Firestore Timestamp or Date → "DD/MM/YYYY"
  date(ts) {
    if (!ts) return '—';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('es-PA', { day: '2-digit', month: '2-digit', year: 'numeric' });
  },

  // Firestore Timestamp or Date → "DD/MM/YYYY, HH:MM:SS"
  datetime(ts) {
    if (!ts) return '—';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-PA');
  },

  // Calculate ITBMS breakdown from a subtotal
  // Returns { subtotal, itbms, total, rate }
  calcITBMS(subtotal, rate) {
    const r = (rate !== undefined && rate !== null) ? Number(rate) : FMT.ITBMS_RATE;
    const itbms = FMT.round2(subtotal * r);
    const total = FMT.round2(subtotal + itbms);
    return { subtotal: FMT.round2(subtotal), itbms, total, rate: r };
  },

  // Strip diacritics and lowercase — for text search normalization
  normalize(s) {
    return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  },

  // PoC group names: trim + collapse internal whitespace. Case stays as typed
  // so admin/grupos.html can suggest casing fixes after the fact.
  normalizeGrupo(s) {
    return (s || "").toString().trim().replace(/\s+/g, " ");
  },

  // Accent + case insensitive dedup. Keeps the first occurrence so user-typed
  // casing wins over later duplicates entered with a different case.
  dedupGrupos(arr) {
    const seen = new Set();
    const out = [];
    for (const g of (arr || [])) {
      const norm = FMT.normalizeGrupo(g);
      if (!norm) continue;
      const k = FMT.normalize(norm);
      if (seen.has(k)) continue;
      seen.add(k); out.push(norm);
    }
    return out;
  }
};
