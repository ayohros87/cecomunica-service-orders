// Shared formatting utilities — single source of truth for money, dates, ITBMS
window.FMT = {
  ITBMS_RATE: 0.07,

  // Escapa texto para interpolar de forma segura dentro de innerHTML (contenido
  // y atributos entrecomillados). Única fuente de verdad para escape HTML —
  // reemplaza las 14+ copias locales de escapeHtml/esc repartidas por el código.
  esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

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

  // ISO date string ("YYYY-MM-DD") → fecha corta legible "7 Jul 2026".
  // Fuente única para las cotizaciones (antes: fmtFechaCorta copiada 5 veces).
  dateShort(iso) {
    if (!iso) return '—';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
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
  },

  // ── Prefijo de grupo PoC (3 letras por empresa) ───────────────────────
  // Todos los grupos de un cliente llevan un prefijo único "AAA-Nombre".
  PREFIJO_SEP: "-",

  // Normaliza un candidato a prefijo: solo A-Z, mayúsculas, máx 3 letras.
  normalizePrefijo(p) {
    return (p || "").toString().normalize("NFD").replace(/\p{Diacritic}/gu, "")
      .toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  },

  // Aplica el prefijo al nombre del grupo → "AAA-Nombre". Idempotente: si el
  // nombre ya empieza con este prefijo (o con `prefijoAnterior`, para cambios
  // de prefijo), reemplaza solo esa parte sin duplicar. Conserva bases como
  // "GPS-Tracker" cuando NO coinciden con el prefijo del cliente.
  aplicarPrefijoGrupo(prefijo, nombre, prefijoAnterior) {
    const pfx = FMT.normalizePrefijo(prefijo);
    let base = FMT.normalizeGrupo(nombre);
    if (!pfx) return base;
    const old = FMT.normalizePrefijo(prefijoAnterior);
    const up = base.toUpperCase();
    if (old && up.startsWith(old + FMT.PREFIJO_SEP)) {
      base = FMT.normalizeGrupo(base.slice(old.length + 1));
    } else if (up.startsWith(pfx + FMT.PREFIJO_SEP)) {
      base = FMT.normalizeGrupo(base.slice(pfx.length + 1));
    }
    return base ? (pfx + FMT.PREFIJO_SEP + base) : "";
  },

  // ¿El nombre ya empieza con un prefijo "AAA-"?
  tienePrefijo(nombre) {
    return /^[A-Za-z]{3}-/.test((nombre || "").toString().trim());
  }
};
