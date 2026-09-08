// Regularización de cuentas — ÚNICA regla de "¿qué le falta a esta cuenta para
// estar bien registrada?" (plan docs/plans/PLAN_REGULARIZACION_CUENTAS.md,
// 2026-09-08). Principio: nunca trabar, siempre estampar, cada gestión puntual
// paga parte de la deuda.
//
// Este archivo existe DUPLICADO a propósito (no hay build step):
//   · functions/src/domain/regularizacion.js  (Admin SDK: job diario + sweep)
//   · public/js/domain/regularizacion.js       (navegador, window.Regularizacion)
// functions/test/regularizacionCuentas.test.js exige que sean byte a byte iguales.
// No confundir con functions/src/lib/regularizacion.js (planAmarre): ese decide
// qué custodia se amarra a qué línea al ACTIVARSE una renovación; este mide la
// DEUDA de la cuenta antes y después de eso.
//
// El back CALCULA y escribe `clientes/{id}.regularizacion`; el front LEE ese
// campo y usa este módulo solo para explicar "por qué" con la misma regla y
// para pintar el chip. Nunca se calcula dos veces con reglas distintas.
//
// Componentes de la deuda (puntos):
//   D1 radios en campo sin contrato interno      (pool en_cliente sin contrato_doc_id)
//   D2 contratos vigentes sin seriales declarados (seriales_estado = 'legacy')
//   D3 contrato marco en papel                    (origen_tipo 'legacy' / origen_legacy_ref)
//   D4 adenda a contrato en papel                 (gestión aumento contrato_papel sin contrato interno)
//   D5 reemplazo sin serial saliente              (REEMP vigente con reemplaza_seriales = [])
//   D6 sobrantes de conciliación                  (contratos.regularizacion.sobrantes)
//   D7 "no lo tiene" sin clasificar               (pool por_clasificar de esta cuenta)
// NO es deuda: seriales_estado 'pendiente' (bodega), pendiente_devolucion,
// DEMO y TEMP (terminan por devolución y no cuentan para la cuenta).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Regularizacion = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VIGENTES = ["activo", "aprobado"];
  const CON_VENCIMIENTO = ["SERV", "ALQ", "PROP", "REEMP"];
  const GESTION_CERRADA = ["anulada", "rechazada", "cancelada"];

  // Umbrales (espejo de empresa/config; el job los pasa por `opts`).
  const DEFAULTS = {
    leve_max_d1: 2,          // D1 ≤ 2 (y D2 = 0) sigue siendo "leve"
    critica_min_d1: 20,      // D1 ≥ 20 → crítica
    max_puntuales: 3,        // escalera: gestiones puntuales sin regularizar
    max_dias: 90,            // escalera: días desde la primera marca
  };

  const NIVELES = ["al_dia", "leve", "por_regularizar", "critica"];
  const NIVEL_LABEL = {
    al_dia: "Al día",
    leve: "Detalle por regularizar",
    por_regularizar: "Por regularizar",
    critica: "Cuenta sin regularizar",
  };
  const COMPONENTES = {
    d1: { label: "radio(s) en campo sin contrato", singular: "radio en campo sin contrato" },
    d2: { label: "contrato(s) sin seriales declarados", singular: "contrato sin seriales declarados" },
    d3: { label: "contrato(s) con el marco en papel", singular: "contrato con el marco en papel" },
    d4: { label: "adenda(s) a contrato en papel", singular: "adenda a contrato en papel" },
    d5: { label: "reemplazo(s) sin serial saliente", singular: "reemplazo sin serial saliente" },
    d6: { label: "sobrante(s) de conciliación", singular: "sobrante de conciliación" },
    d7: { label: "radio(s) por clasificar", singular: "radio por clasificar" },
  };

  function codigoTipo(c) {
    const x = c || {};
    if (x.codigo_tipo) return x.codigo_tipo;
    const porNombre = { Servicio: "SERV", Alquiler: "ALQ", Propio: "PROP", Reemplazo: "REEMP", Demo: "DEMO", Temporal: "TEMP" };
    if (porNombre[x.tipo_contrato]) return porNombre[x.tipo_contrato];
    const m = String(x.contrato_id || "").match(/^[A-Z]+/);
    return m ? m[0] : null;
  }
  function esVigente(c) { return !!c && !c.deleted && VIGENTES.includes(c.estado); }
  function cuentaParaVencimiento(c) { return CON_VENCIMIENTO.includes(codigoTipo(c)); }
  function tieneLineas(c) { return (c?.equipos || []).some(l => Number(l?.cantidad) > 0); }

  // ¿Esta gestión / contrato cuenta como "puntual" sobre una cuenta con
  // deuda? DEMO y TEMP se estampan pero NO cuentan (decisión del plan §9.4).
  function esPuntual(doc) {
    const d = doc || {};
    if (!d.cuenta_regularizacion || d.cuenta_regularizacion.nivel === "al_dia") return false;
    if (d.deleted || GESTION_CERRADA.includes(d.estado)) return false;
    if (d.tipo === "demo") return false;
    const ct = d.codigo_tipo || d.tipo_contrato ? codigoTipo(d) : null;
    if (ct === "DEMO" || ct === "TEMP") return false;
    return true;
  }

  // Entrada: lo que la cuenta tiene HOY.
  //   contratos: docs de `contratos` de la cuenta (cualquier estado)
  //   unidades:  docs de `equipos_pool` cuya asignacion/ultima_asignacion es la cuenta
  //   gestiones: docs de `gestiones` de la cuenta
  //   opts:      umbrales (DEFAULTS) y `ahora` (Date) para la escalera
  // Salida: el objeto que se guarda en clientes/{id}.regularizacion (sin
  // vendedor ni calculado_at — eso lo pone quien escribe).
  function calcular({ contratos = [], unidades = [], gestiones = [], opts = {} } = {}) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const vig = contratos.filter(esVigente);
    const renovables = vig.filter(cuentaParaVencimiento);

    const d1_ids = unidades
      .filter(u => u && u.estado === "en_cliente" && !u.pendiente_devolucion && !(u.asignacion && u.asignacion.contrato_doc_id))
      .map(u => u.serial || u.id).filter(Boolean);
    const d2_ids = renovables.filter(c => tieneLineas(c) && c.seriales_estado === "legacy")
      .map(c => c.contrato_id || c.id);
    const d3_ids = vig.filter(c => c.origen_tipo === "legacy" || !!c.origen_legacy_ref)
      .map(c => c.contrato_id || c.id);
    const d4_ids = gestiones
      .filter(g => g && g.tipo === "aumento" && !g.deleted && !GESTION_CERRADA.includes(g.estado)
        && g.aumento && g.aumento.contrato_papel && !g.aumento.contrato_doc_id)
      .map(g => g.id).filter(Boolean);
    const d5_ids = vig.filter(c => codigoTipo(c) === "REEMP" && Array.isArray(c.reemplaza_seriales) && c.reemplaza_seriales.length === 0)
      .map(c => c.contrato_id || c.id);
    const d6 = vig.reduce((s, c) => s + Math.max(0, Number(c.regularizacion && c.regularizacion.sobrantes || 0)), 0);
    const d7_ids = unidades.filter(u => u && u.estado === "por_clasificar").map(u => u.serial || u.id).filter(Boolean);

    const d1 = d1_ids.length, d2 = d2_ids.length, d3 = d3_ids.length, d4 = d4_ids.length, d5 = d5_ids.length, d7 = d7_ids.length;
    const puntos = d1 + d2 + d3 + d4 + d5 + d6 + d7;
    const sinContratoVigente = !renovables.length && d1 > 0;

    let nivel = "al_dia";
    if (puntos > 0) {
      if (d1 >= o.critica_min_d1 || sinContratoVigente) nivel = "critica";
      else if (d1 >= o.leve_max_d1 + 1 || d2 >= 1) nivel = "por_regularizar";
      else nivel = "leve";
    }
    // Etiqueta: 'migracion' = deuda que no depende del vendedor (D2/D3 del
    // cutover y D7, que es la cola de bodega) — no sube la escalera;
    // 'operativa' = hay D1/D4/D5/D6, que sí se cierran con gestiones.
    const etiqueta = puntos === 0 ? null : (d1 + d4 + d5 + d6 === 0 ? "migracion" : "operativa");

    // Escalera: gestiones y contratos estampados como puntuales.
    const puntuales = gestiones.filter(esPuntual).concat(contratos.filter(esPuntual));
    const ahora = o.ahora instanceof Date ? o.ahora : new Date();
    const fechas = puntuales.map(p => _fecha(p.cuenta_regularizacion && p.cuenta_regularizacion.at) || _fecha(p.fecha_solicitud) || _fecha(p.fecha_creacion)).filter(Boolean);
    const primera = fechas.length ? new Date(Math.min.apply(null, fechas.map(f => f.getTime()))) : null;
    const ultima = fechas.length ? new Date(Math.max.apply(null, fechas.map(f => f.getTime()))) : null;
    const diasDesdePrimera = primera ? Math.floor((ahora - primera) / 86400000) : 0;
    const excede = puntos > 0 && etiqueta === "operativa"
      && (puntuales.length > o.max_puntuales || diasDesdePrimera > o.max_dias);

    // Solo D7 = la cuenta no tiene contrato vigente ni radios en campo; lo
    // único que le cuelga son fichas "por clasificar" (migración POC). Es
    // cola de BODEGA, no una cuenta que un vendedor deba tomar: la bandeja y
    // el home la esconden por defecto (verificación 2026-09-08: 58 de las
    // 112 "sin vendedor" eran esto).
    const soloBodega = puntos > 0 && puntos === d7;

    return {
      nivel, puntos, etiqueta, solo_bodega: soloBodega,
      d1, d2, d3, d4, d5, d6, d7,
      d1_ids: d1_ids.slice(0, 200), d2_ids, d3_ids, d4_ids, d5_ids, d7_ids: d7_ids.slice(0, 200),
      sin_contrato_vigente: sinContratoVigente,
      gestiones_puntuales: puntuales.length,
      primera_marca_at: primera, ultima_gestion_puntual_at: ultima,
      excede_margen: excede,
    };
  }

  function _fecha(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v.toDate === "function") { const d = v.toDate(); return isNaN(d) ? null : d; }
    if (typeof v === "object" && typeof v.seconds === "number") return new Date(v.seconds * 1000);
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  // Lo que se ESTAMPA en una gestión o contrato al crearse sobre la cuenta.
  function estampa(reg, { ahora } = {}) {
    const r = reg || {};
    if (!r.nivel || r.nivel === "al_dia" || !(r.puntos > 0)) return null;
    return {
      nivel: r.nivel, puntos: Number(r.puntos) || 0, etiqueta: r.etiqueta || null,
      puntual_n: (Number(r.gestiones_puntuales) || 0) + 1,
      excede_margen: !!r.excede_margen,
      at: ahora instanceof Date ? ahora : new Date(),
    };
  }

  // Texto corto del chip: "Por regularizar · 131".
  function chip(reg) {
    const r = reg || {};
    if (!r.nivel || r.nivel === "al_dia" || !(r.puntos > 0)) return null;
    const tono = r.nivel === "critica" ? "bad" : r.nivel === "por_regularizar" ? "warn" : "muted";
    return { tono, texto: `${NIVEL_LABEL[r.nivel] || r.nivel} · ${r.puntos}` };
  }

  // Desglose legible por componente, en orden de peso.
  function desglose(reg) {
    const r = reg || {};
    return Object.keys(COMPONENTES)
      .map(k => ({ codigo: k, n: Number(r[k]) || 0, ids: Array.isArray(r[k + "_ids"]) ? r[k + "_ids"] : [],
        label: Number(r[k]) === 1 ? COMPONENTES[k].singular : COMPONENTES[k].label }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n);
  }

  // Resumen en una frase para correos y expedientes.
  function resumen(reg) {
    const r = reg || {};
    if (!r.nivel || r.nivel === "al_dia") return "";
    const partes = desglose(r).map(x => `${x.n} ${x.label}`);
    return `${NIVEL_LABEL[r.nivel] || r.nivel} (${r.puntos}): ${partes.join(" · ")}`;
  }

  // ¿Cambió lo que importa? Evita reescribir el doc del cliente cada barrido.
  function igual(a, b) {
    const ka = ["nivel", "puntos", "etiqueta", "solo_bodega", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "gestiones_puntuales", "excede_margen", "sin_contrato_vigente"];
    const x = a || {}, y = b || {};
    return ka.every(k => (x[k] === undefined ? null : x[k]) === (y[k] === undefined ? null : y[k]));
  }

  return { DEFAULTS, NIVELES, NIVEL_LABEL, COMPONENTES, codigoTipo, esVigente, esPuntual, calcular, estampa, chip, desglose, resumen, igual };
});
