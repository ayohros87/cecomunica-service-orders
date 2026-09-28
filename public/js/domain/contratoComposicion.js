// Composición del contrato — ¿qué hay adentro: alquiler, propio o mixto?
//
// Por qué existe (Alberto, 2026-09-28): antes el TIPO decía de qué era el
// contrato (ALQ = todo alquilado, PROP = equipo del cliente) y la gente leía
// el archivo por esa nomenclatura. Desde septiembre todo contrato nuevo es
// "Servicio" (SERV) y la propiedad va POR LÍNEA (`equipos[].modalidad`:
// 'alquiler' | 'propio', ver contratoTarifario.construirDoc). Resultado: la
// columna "Tipo" del archivo dice "Servicio" en todos y se perdió la lectura
// rápida. Este módulo la devuelve como etiqueta DERIVADA de las líneas; los
// ALQ/PROP viejos siguen leyéndose por su tipo (legacy) porque sus líneas no
// traen modalidad.
//
// Es SOLO lectura: no escribe nada en el doc, no decide precios ni firma.
// Se usa en el archivo (columna Tipo + filtro "Composición"), en el Centro
// (chip junto al número) y donde haga falta nombrar el contrato.
(function (root, factory) {
  // Publicar en window SIEMPRE (mismo patrón que regularizacion.js): al
  // empaquetar, Rolldown ve `module.exports` y envuelve el archivo como
  // CommonJS, así que un `else` nunca correría en el navegador.
  const api = factory();
  root.ContratoComposicion = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Tipos que NO se leen por composición: se llaman por su nombre.
  const NOMBRE_OTRO = { DEMO: "Demo", TEMP: "Temporal", REEMP: "Reemplazo" };
  const NOMBRE_A_CODIGO = { Servicio: "SERV", Alquiler: "ALQ", Propio: "PROP", Reemplazo: "REEMP", Demo: "DEMO", Temporal: "TEMP" };

  // Mismo criterio que ContratoFirma.codigoTipo / Centro._codigoTipo: el
  // campo manda, el nombre es el respaldo, el prefijo del número es el último
  // recurso (REEMP20251024 se numeró ALQ20251024-01 por error).
  function codigoTipo(c) {
    if (c?.codigo_tipo) return String(c.codigo_tipo).toUpperCase();
    if (NOMBRE_A_CODIGO[c?.tipo_contrato]) return NOMBRE_A_CODIGO[c.tipo_contrato];
    const x = String(c?.contrato_id || "").match(/^[A-Z]+/);
    return x ? x[0] : null;
  }

  // Las líneas viven en `equipos[]` (contratoTarifario.construirDoc); se
  // acepta `lineas[]` por si un doc llega ya normalizado (detalle de correos).
  function lineas(c) {
    if (Array.isArray(c?.equipos)) return c.equipos;
    if (Array.isArray(c?.lineas)) return c.lineas;
    return [];
  }

  function cantidadDe(l) {
    // Sin cantidad → cuenta 1 (una línea es al menos un equipo). Con cantidad
    // explícita se respeta, incluso 0 (renovación sin equipo, línea vacía).
    if (l.cantidad === undefined || l.cantidad === null || l.cantidad === "") return 1;
    const n = Number(l.cantidad);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** {alquiler, propio, sin_modalidad, total} sumando `cantidad` por línea. */
  function contar(c) {
    const r = { alquiler: 0, propio: 0, sin_modalidad: 0, total: 0 };
    for (const l of lineas(c)) {
      if (!l || typeof l !== "object") continue;
      const n = cantidadDe(l);
      const m = String(l.modalidad || "").toLowerCase();
      if (m === "propio") r.propio += n;
      else if (m === "alquiler") r.alquiler += n;
      else r.sin_modalidad += n;
      r.total += n;
    }
    return r;
  }

  /**
   * 'alquiler' | 'propio' | 'mixto' | 'legacy_alq' | 'legacy_prop' | 'otro'.
   * legacy_*: ALQ/PROP cuyas líneas no traen modalidad (el tipo lo dice).
   * 'otro': DEMO/TEMP/REEMP (se nombran por tipo) o sin líneas que leer.
   */
  function codigo(c) {
    const tipo = codigoTipo(c);
    if (NOMBRE_OTRO[tipo]) return "otro";
    const n = contar(c);
    const conModalidad = n.alquiler + n.propio > 0;
    if (!conModalidad) {
      if (tipo === "ALQ") return "legacy_alq";
      if (tipo === "PROP") return "legacy_prop";
      // SERV con líneas sin modalidad: el resto del sistema las lee como
      // alquiler (`l.modalidad || 'alquiler'`); aquí igual. Sin líneas no hay
      // composición que declarar.
      if (n.sin_modalidad > 0) return "alquiler";
      return "otro";
    }
    // Línea sin modalidad en un contrato que sí las trae: se lee como el
    // resto del sistema (`l.modalidad || 'alquiler'`, salvo en un PROP).
    const alq = n.alquiler + (tipo === "PROP" ? 0 : n.sin_modalidad);
    const pro = n.propio + (tipo === "PROP" ? n.sin_modalidad : 0);
    if (alq > 0 && pro > 0) return "mixto";
    return pro > 0 ? "propio" : "alquiler";
  }

  // Cifras efectivas para la etiqueta "Mixto · 12 alq / 3 prop".
  function cifras(c) {
    const n = contar(c);
    const esProp = codigoTipo(c) === "PROP";
    return { alq: n.alquiler + (esProp ? 0 : n.sin_modalidad), prop: n.propio + (esProp ? n.sin_modalidad : 0) };
  }

  /** Nombre del tipo para los que no se leen por composición. */
  function nombreTipo(c) {
    const tipo = codigoTipo(c);
    return NOMBRE_OTRO[tipo] || c?.tipo_contrato || tipo || "—";
  }

  /** "Alquiler", "Propio", "Mixto · 12 alq / 3 prop", "Demo", "Temporal", "Reemplazo". */
  function etiqueta(c) {
    switch (codigo(c)) {
      case "alquiler":
      case "legacy_alq": return "Alquiler";
      case "propio":
      case "legacy_prop": return "Propio";
      case "mixto": { const { alq, prop } = cifras(c); return `Mixto · ${alq} alq / ${prop} prop`; }
      default: return nombreTipo(c);
    }
  }

  /** Frase para tooltips y letra pequeña: "12 equipos en alquiler · 3 propios". */
  function resumen(c) {
    const k = codigo(c);
    if (k === "otro") return nombreTipo(c);
    if (k === "legacy_alq") return "Contrato de alquiler (formato anterior): todo el equipo es de C COMUNICA";
    if (k === "legacy_prop") return "Contrato propio (formato anterior): todo el equipo es del cliente";
    const { alq, prop } = cifras(c);
    const eq = (n) => `${n} equipo${n === 1 ? "" : "s"}`;
    if (k === "alquiler") return `${eq(alq)} en alquiler`;
    if (k === "propio") return `${eq(prop)} del cliente (propio${prop === 1 ? "" : "s"})`;
    return `${eq(alq)} en alquiler · ${prop} propio${prop === 1 ? "" : "s"} del cliente`;
  }

  /** Grupo del filtro: 'alquiler' | 'propio' | 'mixto' | '' (los "otro" no filtran). */
  function grupo(c) {
    const k = codigo(c);
    if (k === "alquiler" || k === "legacy_alq") return "alquiler";
    if (k === "propio" || k === "legacy_prop") return "propio";
    if (k === "mixto") return "mixto";
    return "";
  }

  /** ¿Pasa el filtro? '' o 'todas' = no filtra. */
  function coincide(c, filtro) {
    const f = String(filtro || "").toLowerCase();
    if (!f || f === "todas") return true;
    return grupo(c) === f;
  }

  // "alq" / "prop" / "mixto" tecleados en el buscador son el filtro, no una
  // búsqueda: nadie se llama "alq". Devuelve el grupo o '' si no es sinónimo.
  const SINONIMOS = [
    [/^(alq|alqu|alquiler|alquilado|alquilados|alquileres)$/i, "alquiler"],
    [/^(prop|propio|propios|propiedad)$/i, "propio"],
    [/^(mix|mixto|mixtos)$/i, "mixto"],
  ];
  function sinonimoFiltro(texto) {
    const t = String(texto || "").trim();
    if (!t) return "";
    for (const [re, g] of SINONIMOS) if (re.test(t)) return g;
    return "";
  }

  /** Clases CSS del chip (ceco-ui.css: .chip-comp + .chip-comp-<grupo|otro>). */
  function chipClass(c) {
    return `chip-comp chip-comp-${grupo(c) || "otro"}`;
  }

  return { codigoTipo, lineas, contar, codigo, etiqueta, resumen, grupo, coincide, sinonimoFiltro, chipClass, NOMBRE_OTRO };
});
