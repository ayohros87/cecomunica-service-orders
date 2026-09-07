// ModeloFamilia — ÚNICA fuente de "¿es el mismo modelo?" para lo comercial y
// operativo (líneas de contrato, plan por serial, amarre, tarifa, Anexo A,
// devoluciones, sustituciones, cobros).
//
// Regla "una familia, dos filas" (2026-09-07): el catálogo modela el
// refurbished como OTRA fila (estado R, nombre con sufijo -R) porque el stock
// y QuickBooks necesitan dos buckets. Pero para el negocio PNC360S y PNC360S-R
// son el MISMO radio: la FAMILIA es el modelo base (`variante_de` o la propia
// fila). La familia se resuelve POR CATÁLOGO, nunca adivinando por texto; el
// texto queda como último recurso para filas legacy sin id.
//
// Este archivo existe DUPLICADO a propósito (no hay build step):
//   · functions/src/domain/modeloFamilia.js   (Admin SDK, triggers)
//   · public/js/domain/modeloFamilia.js        (navegador, window.ModeloFamilia)
// functions/test/modeloFamilia.test.js exige que sean byte a byte iguales.
// El catálogo lo carga quien lo usa: en el back `domain/modeloCatalogo.js`
// (caché por instancia) y en el front `ModelosService.catalogo()`.
//
// Vocabulario de referencias: cualquier objeto con { modelo_id, modelo } o
// { modelo_id, modelo_label } (fichas del pool, líneas, filas de seriales,
// unidades del plan). `modalidad` opcional ('alquiler' | 'propio'); una
// ficha con propiedad 'cliente' es 'propio'.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ModeloFamilia = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Solo el sufijo EXPLÍCITO "-R" / " R" es refurbished. Quitar "cualquier R
  // final" (lo que hacían los comparadores viejos) toca modelos que terminan
  // en R de fábrica.
  const SUFIJO_R = /[\s-]R$/i;
  const tight = (s) => String(s == null ? "" : s).normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const sinR = (s) => String(s == null ? "" : s).trim().replace(SUFIJO_R, "");
  const esTextoR = (s) => SUFIJO_R.test(String(s == null ? "" : s).trim());
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

  let _porId = new Map();      // id → fila
  let _porTexto = new Map();   // tight(texto) → fila (prefiere activas)
  let _hijosR = new Map();     // id base → [filas R]
  let _marcas = [];            // tight(marca), largas primero
  let _cargado = false;

  function cargar(modelos) {
    _porId = new Map(); _porTexto = new Map(); _hijosR = new Map(); _marcas = [];
    const lista = Array.isArray(modelos) ? modelos : [];
    const marcas = new Set();
    for (const m of lista) {
      if (!m || !m.id) continue;
      const fila = Object.assign({}, m, {
        modelo: String(m.modelo || "").trim(),
        marca: String(m.marca || "").trim(),
        estado: String(m.estado || "N").toUpperCase() === "R" ? "R" : "N",
      });
      _porId.set(fila.id, fila);
      if (fila.marca) marcas.add(tight(fila.marca));
    }
    _marcas = [...marcas].filter(Boolean).sort((a, b) => b.length - a.length);
    const indexar = (k, fila) => {
      if (!k) return;
      const prev = _porTexto.get(k);
      // Una fila activa gana a una inactiva (duplicados desactivados, caso SC780).
      if (!prev || (prev.activo === false && fila.activo !== false)) _porTexto.set(k, fila);
    };
    for (const fila of _porId.values()) {
      indexar(tight(fila.modelo), fila);
      indexar(tight(`${fila.marca} ${fila.modelo}`), fila);
      for (const a of (Array.isArray(fila.aliases) ? fila.aliases : [])) {
        indexar(tight(a), fila);
        indexar(tight(`${fila.marca} ${a}`), fila);
      }
    }
    for (const fila of _porId.values()) {
      if (fila.estado !== "R") continue;
      const base = _baseDe(fila);
      if (!base || base.id === fila.id) continue;
      const arr = _hijosR.get(base.id) || [];
      arr.push(fila);
      _hijosR.set(base.id, arr);
    }
    _cargado = true;
    return lista.length;
  }
  const listo = () => _cargado;

  // Quita la marca por delante ("HYTERA PNC360S" → "PNC360S") si es una marca
  // conocida del catálogo. Sin catálogo no hay marcas: no se adivina.
  function sinMarca(label) {
    const t = tight(label);
    for (const m of _marcas) {
      if (t.length > m.length && t.startsWith(m)) return t.slice(m.length);
    }
    return t;
  }
  // Clave de texto de una etiqueta: sin marca, sin sufijo -R, apretada.
  const claveTexto = (label) => sinMarca(sinR(label));

  const filaPorId = (id) => (id && _porId.get(String(id))) || null;

  function filaPorTexto(label) {
    const raw = String(label == null ? "" : label).trim();
    if (!raw) return null;
    const candidatos = [tight(raw), sinMarca(raw)];
    for (const k of candidatos) { const f = k && _porTexto.get(k); if (f) return f; }
    return null;
  }
  // Fila base de una fila R: variante_de si existe; si no, la fila N con el
  // mismo nombre sin -R (para las R que nadie vinculó — el panel las marca).
  function _baseDe(fila) {
    if (!fila) return null;
    if (fila.estado !== "R") return fila;
    if (fila.variante_de) { const b = _porId.get(String(fila.variante_de)); if (b) return b; }
    const base = filaPorTexto(sinR(fila.modelo)) || filaPorTexto(sinR(`${fila.marca} ${fila.modelo}`));
    return (base && base.id !== fila.id && base.estado === "N") ? base : fila;
  }

  const _label = (ref) => (ref && (ref.modelo_label != null && String(ref.modelo_label).trim() !== ""
    ? ref.modelo_label : ref.modelo)) || "";

  // Fila del catálogo de una referencia (id primero, texto después).
  function resolver(ref) {
    if (!ref) return null;
    if (typeof ref === "string") return filaPorId(ref) || filaPorTexto(ref);
    return filaPorId(ref.modelo_id) || filaPorTexto(_label(ref));
  }

  // Identidad de familia: id del modelo base, o "~texto" para lo que no está
  // en el catálogo. null si no hay ningún dato de modelo.
  function familiaDe(ref) {
    const fila = resolver(ref);
    if (fila) return _baseDe(fila).id;
    const k = claveTexto(typeof ref === "string" ? ref : _label(ref));
    return k ? `~${k}` : null;
  }
  const familiaLabel = (familiaId) => {
    const f = filaPorId(familiaId);
    if (f) return `${f.marca} ${f.modelo}`.trim();
    return String(familiaId || "").replace(/^~/, "");
  };

  function mismaFamilia(a, b) {
    const fa = familiaDe(a), fb = familiaDe(b);
    if (fa && fb && !fa.startsWith("~") && !fb.startsWith("~")) return fa === fb;
    // Al menos un lado no está en el catálogo: texto contra texto. Contención
    // (≥4) cubre textos truncados o con marca cuando no hay catálogo cargado.
    const ta = claveTexto(typeof a === "string" ? a : _label(a));
    const tb = claveTexto(typeof b === "string" ? b : _label(b));
    if (!ta || !tb) return false;
    if (ta === tb) return true;
    const [corto, largo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    return corto.length >= 4 && largo.includes(corto);
  }

  // Condición según la FILA del catálogo: 'reuso' | 'nuevo' | null (sin fila).
  function condicionDe(ref) {
    const fila = resolver(ref);
    return fila ? (fila.estado === "R" ? "reuso" : "nuevo") : null;
  }
  // Con caída al texto (sufijo -R) y luego a 'nuevo' — para crear fichas.
  function condicionDerivada(ref) {
    const c = condicionDe(ref);
    if (c) return c;
    return esTextoR(typeof ref === "string" ? ref : _label(ref)) ? "reuso" : "nuevo";
  }
  const esRefurbished = (ref) => condicionDerivada(ref) === "reuso";

  // Fila concreta de una familia para una condición. 'reuso' → la fila R
  // vinculada (o la propia si la familia solo existe refurbished); 'nuevo' →
  // la base si es N. null si la familia no tiene esa fila.
  function filaDe(familiaId, condicion) {
    const base = filaPorId(familiaId);
    if (!base) return null;
    if (condicion === "reuso") {
      if (base.estado === "R") return base;
      const hijos = (_hijosR.get(base.id) || []);
      return hijos.find((h) => h.activo !== false) || hijos[0] || null;
    }
    return base.estado === "N" ? base : null;
  }
  // Fila R de la familia de una referencia (para marcar refurbished).
  const filaRefurbishedDe = (ref) => { const f = familiaDe(ref); return f && !f.startsWith("~") ? filaDe(f, "reuso") : null; };

  // Valor numérico de un campo (precio_venta, precio_alquiler, qbo_*): el de
  // la fila, y si no lo tiene, el de la base de su familia.
  function precioReferencia(ref, campo) {
    const fila = resolver(ref);
    if (!fila) return { valor: null, origen: null, fila: null };
    const propio = num(fila[campo]);
    if (propio) return { valor: propio, origen: "fila", fila };
    const base = _baseDe(fila);
    const deBase = base && base.id !== fila.id ? num(base[campo]) : null;
    return deBase ? { valor: deBase, origen: "base", fila: base } : { valor: null, origen: null, fila };
  }
  // Campo cualquiera (ids de QBO son strings) con la misma caída a la base.
  function campoReferencia(ref, campo) {
    const fila = resolver(ref);
    if (!fila) return { valor: null, origen: null, fila: null };
    if (fila[campo]) return { valor: fila[campo], origen: "fila", fila };
    const base = _baseDe(fila);
    if (base && base.id !== fila.id && base[campo]) return { valor: base[campo], origen: "base", fila: base };
    return { valor: null, origen: null, fila };
  }

  const modalidadDe = (u) => (u && u.modalidad) || (u && u.propiedad === "cliente" ? "propio" : "alquiler");

  // Líneas del contrato compatibles con una unidad, exactas primero
  // (misma fila del catálogo) y luego por familia. Una línea sin modalidad es
  // legacy y acepta cualquiera.
  function lineasCompatibles(unidad, lineas) {
    const ls = Array.isArray(lineas) ? lineas : [];
    const modU = modalidadDe(unidad);
    const out = [];
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (!l) continue;
      if (l.modalidad && l.modalidad !== modU) continue;
      const exacto = !!(unidad && unidad.modelo_id && l.modelo_id && unidad.modelo_id === l.modelo_id);
      if (exacto || mismaFamilia(unidad, l)) out.push({ idx: i, exacto });
    }
    out.sort((a, b) => (b.exacto ? 1 : 0) - (a.exacto ? 1 : 0));
    return out;
  }
  // Índice de la línea que le toca a la unidad (-1 si ninguna). Con `cupo`
  // (array paralelo a `lineas`) salta las líneas llenas.
  function lineaPara(unidad, lineas, cupo) {
    const cands = lineasCompatibles(unidad, lineas);
    if (!cands.length) return -1;
    if (!Array.isArray(cupo)) return cands[0].idx;
    const c = cands.find((x) => Number(cupo[x.idx] || 0) > 0);
    return c ? c.idx : -1;
  }
  // Clave para agrupar/contar por modelo en lo comercial: la familia.
  const claveFamilia = (ref) => familiaDe(ref) || "";

  function etiqueta(ref) {
    const fila = resolver(ref);
    if (fila) return `${fila.marca} ${fila.modelo}`.trim();
    return String(typeof ref === "string" ? ref : _label(ref)).trim();
  }

  return {
    cargar, listo, tight, sinR, esTextoR, sinMarca, claveTexto,
    filaPorId, filaPorTexto, resolver, familiaDe, familiaLabel, mismaFamilia,
    condicionDe, condicionDerivada, esRefurbished, filaDe, filaRefurbishedDe,
    precioReferencia, campoReferencia, modalidadDe, lineasCompatibles, lineaPara,
    claveFamilia, etiqueta,
  };
});
