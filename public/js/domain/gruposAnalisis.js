/**
 * gruposAnalisis.js — pure helpers para detectar duplicados de grupos PoC.
 *
 * Dos modos:
 *   1. EXACTOS — nombres que tras normalizar (lowercase + sin acentos +
 *      whitespace colapsado) son idénticos. Auto-mergeables con un click:
 *      "Ventas" ↔ "ventas", "Operación" ↔ "Operacion ", "  VENTAS" ↔ "Ventas".
 *   2. FUZZY — Levenshtein distance ≤ 2 con guardas anti-falsos-positivos
 *      (longitud mínima del más corto, share de chars iniciales). NUNCA
 *      auto-merge: solo señala candidatos para revisión humana.
 *
 * Cada función retorna `buckets`: array de arrays (cada bucket es un grupo
 * de nombres considerados duplicados entre sí). Buckets con 1 solo elemento
 * se filtran out (no son duplicados).
 *
 * Sin DOM, sin Firestore. Reusable desde el servicio (scan batch) y la
 * página (análisis del cliente seleccionado).
 */
(function () {
  'use strict';

  function normalizar(s) {
    return (s || '').toString()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Levenshtein distance estándar (DP iterativo, O(n*m)).
  function levenshtein(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (!al) return bl;
    if (!bl) return al;
    let prev = new Array(bl + 1);
    for (let i = 0; i <= bl; i++) prev[i] = i;
    for (let i = 1; i <= al; i++) {
      const curr = new Array(bl + 1);
      curr[0] = i;
      for (let j = 1; j <= bl; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = curr;
    }
    return prev[bl];
  }

  // Buckets de duplicados exactos: misma forma normalizada.
  // Input: array de strings (nombres de grupo crudos, posiblemente duplicados).
  // Output: array de arrays, cada uno con los nombres crudos que comparten
  //         forma normalizada. Solo buckets con > 1 nombre crudo distinto.
  function bucketsExactos(grupos) {
    const byNorm = new Map();
    for (const g of grupos || []) {
      const raw = (g || '').toString();
      if (!raw.trim()) continue;
      const k = normalizar(raw);
      if (!k) continue;
      if (!byNorm.has(k)) byNorm.set(k, new Set());
      byNorm.get(k).add(raw.trim());
    }
    return Array.from(byNorm.values())
      .map(s => Array.from(s))
      .filter(arr => arr.length > 1);
  }

  // Buckets fuzzy. Une nombres que satisfacen:
  //   - levenshtein(norm(a), norm(b)) ≤ 2
  //   - longitud del más corto ≥ 3 + dist (descarta "AB" vs "AC")
  //   - O bien: uno es prefijo del otro Y el prefijo compartido ≥ 4 chars
  // Excluye buckets cuyos miembros tienen TODOS la misma forma normalizada
  // (esos ya son "exactos" y aparecen en bucketsExactos).
  function bucketsFuzzy(grupos) {
    // Trabaja con nombres únicos por forma cruda; dedup case-sensitive primero.
    const uniqRaw = Array.from(new Set((grupos || [])
      .map(g => (g || '').toString().trim())
      .filter(Boolean)));
    const norms = uniqRaw.map(normalizar);

    // Union-find sobre índices.
    const parent = uniqRaw.map((_, i) => i);
    const find = (x) => parent[x] === x ? x : (parent[x] = find(parent[x]));
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

    for (let i = 0; i < norms.length; i++) {
      const ni = norms[i];
      if (!ni || ni.length < 3) continue;
      for (let j = i + 1; j < norms.length; j++) {
        const nj = norms[j];
        if (!nj || nj.length < 3) continue;
        const dist = levenshtein(ni, nj);
        const minLen = Math.min(ni.length, nj.length);

        let similar = false;
        // Regla 1: distancia pequeña con longitud suficiente.
        if (dist <= 2 && minLen >= 3 + dist) similar = true;
        // Regla 2: prefijo compartido largo (catches "Op" vs "Operaciones" si
        // share ≥ 4 chars). Solo aplica si uno es prefijo del otro.
        if (!similar && (ni.startsWith(nj) || nj.startsWith(ni))) {
          if (minLen >= 4) similar = true;
        }
        if (similar) union(i, j);
      }
    }

    // Agrupa por root.
    const byRoot = new Map();
    for (let i = 0; i < uniqRaw.length; i++) {
      if (!norms[i]) continue;
      const r = find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push(uniqRaw[i]);
    }

    // Filtra buckets con > 1 elemento Y al menos dos formas normalizadas
    // distintas (los pure-exact ya están cubiertos por bucketsExactos).
    return Array.from(byRoot.values()).filter(arr => {
      if (arr.length < 2) return false;
      const normSet = new Set(arr.map(normalizar));
      return normSet.size > 1;
    });
  }

  // Cuenta solo: cuántos buckets distintos hay (no cuenta nombres totales).
  function contarBuckets(grupos, modo) {
    const buckets = modo === 'fuzzy' ? bucketsFuzzy(grupos) : bucketsExactos(grupos);
    return buckets.length;
  }

  window.GruposAnalisis = {
    normalizar,
    levenshtein,
    bucketsExactos,
    bucketsFuzzy,
    contarBuckets,
  };
})();
