// Catálogo de modelos cacheado por instancia + carga de ModeloFamilia.
//
// Los triggers que parean modelos (amarre, plan por serial, cobros,
// sustitución, devolución) llaman `await catalogo()` antes de decidir: así
// ModeloFamilia resuelve por catálogo (variante_de) y no por texto. La caché
// evita leer los ~110 docs en cada invocación; `force` la refresca.
"use strict";

const { db } = require("../lib/admin");
const ModeloFamilia = require("./modeloFamilia");

const TTL_MS = 10 * 60 * 1000;
let _cache = null;      // { lista, porId, at }
let _enCurso = null;    // Promise en vuelo (dedupe de cargas concurrentes)

async function catalogo({ force = false } = {}) {
  if (!force && _cache && (Date.now() - _cache.at) < TTL_MS) return _cache;
  if (_enCurso) return _enCurso;
  _enCurso = (async () => {
    const snap = await db.collection("modelos").get();
    const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ModeloFamilia.cargar(lista);
    const porId = new Map(lista.map((m) => [m.id, m]));
    _cache = { lista, porId, at: Date.now() };
    return _cache;
  })();
  try { return await _enCurso; } finally { _enCurso = null; }
}

// Para tests: inyectar un catálogo sin red.
function _setCatalogo(lista) {
  ModeloFamilia.cargar(lista || []);
  _cache = { lista: lista || [], porId: new Map((lista || []).map((m) => [m.id, m])), at: Date.now() };
}

module.exports = { catalogo, _setCatalogo, ModeloFamilia };
