// @ts-nocheck
// Caja menuda — estados, quién puede hacer qué y validación del formulario.
// Lógica PURA (sin Firestore). La comparten la pantalla de quien pide
// (caja/index.html), la bandeja de contabilidad (caja/contabilidad.html) y las
// pruebas (functions/test/cajaMenuda.test.js).
//
// De dónde salen las reglas: del cuestionario que llenó Cheila (contabilidad)
// el 2026-11-26. En corto:
//   · pide cualquier colaborador; APRUEBA su jefe inmediato; el efectivo lo
//     entrega quien custodia el fondo (contabilidad);
//   · un solo fondo de $200; se repone cuando quedan $50;
//   · tope de $20 por recibo: si un reembolso lo pasa, no sale del fondo, se
//     devuelve por ACH;
//   · se usan los dos caminos: reembolso (ya pagué) y anticipo (necesito
//     efectivo y luego rindo con la factura, en 1 o 2 días);
//   · todo gasto lleva factura fiscal de compra.
//
// Los números viven en empresa/caja_menuda y se pueden cambiar sin desplegar;
// CONFIG_DEFECTO vale mientras ese documento no exista.
//
// Recorrido de un gasto (campo `estado`):
//   reembolso: solicitado → aprobado → pagado
//   anticipo:  solicitado → aprobado → entregado → rendido → cerrado
//   salidas:   rechazado (el jefe, o contabilidad si la factura no sirve)
//              anulado   (quien lo pidió, mientras nadie lo ha aprobado)
(function () {
  const CONFIG_DEFECTO = {
    fondo: 200,
    tope_recibo: 20,
    minimo_reposicion: 50,
    dias_rendir: 2,
    categorias: ["Viático", "Estacionamiento", "Peaje", "Combustible", "Mantenimiento de auto", "Varios"],
  };

  const TIPOS = {
    reembolso: { label: "Reembolso", corto: "Ya lo pagué", ayuda: "Pagaste de tu bolsillo y tienes la factura." },
    anticipo: { label: "Anticipo", corto: "Necesito efectivo", ayuda: "Te entregan el efectivo y después traes la factura." },
  };

  // tono = el del kit de bandejas (aviso · info · alerta · listo · neutro).
  const ESTADOS = {
    solicitado: { label: "Por aprobar", tono: "aviso" },
    aprobado: { label: "Aprobado", tono: "info" },
    entregado: { label: "Por rendir", tono: "aviso" },
    rendido: { label: "Rendido", tono: "info" },
    pagado: { label: "Pagado", tono: "listo" },
    cerrado: { label: "Cerrado", tono: "listo" },
    rechazado: { label: "Rechazado", tono: "alerta" },
    anulado: { label: "Anulado", tono: "neutro" },
  };
  const ABIERTOS = ["solicitado", "aprobado", "entregado", "rendido"];
  const ROLES_CUSTODIO = ["administrador", "contabilidad"];
  const MAX_RECIBOS = 4;
  const MONTO_MAXIMO = 5000;

  const num = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  };

  function config(doc) {
    const d = doc || {};
    const positivo = (v, def) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
    const cats = Array.isArray(d.categorias) ? d.categorias.map((c) => String(c || "").trim()).filter(Boolean) : [];
    return {
      fondo: positivo(d.fondo, CONFIG_DEFECTO.fondo),
      tope_recibo: positivo(d.tope_recibo, CONFIG_DEFECTO.tope_recibo),
      minimo_reposicion: positivo(d.minimo_reposicion, CONFIG_DEFECTO.minimo_reposicion),
      dias_rendir: positivo(d.dias_rendir, CONFIG_DEFECTO.dias_rendir),
      categorias: cats.length ? cats : CONFIG_DEFECTO.categorias.slice(),
    };
  }

  // Por dónde se devuelve la plata. Solo el reembolso puede irse por ACH: un
  // anticipo siempre es efectivo del fondo.
  function via(tipo, monto, cfg) {
    const c = config(cfg);
    return tipo === "reembolso" && num(monto) > c.tope_recibo ? "ach" : "efectivo";
  }

  function esCustodio(rol) { return ROLES_CUSTODIO.includes(rol); }

  // Aprueba el jefe asignado al momento de pedir. Administración puede
  // aprobar cualquiera (suplencia, y los que no tienen jefe asignado). Nadie
  // aprueba lo suyo.
  function esAprobador(g, yo) {
    if (!g || !yo || !yo.uid || g.solicitante_uid === yo.uid) return false;
    return g.aprobador_uid === yo.uid || yo.rol === "administrador";
  }

  // Qué puede hacer `yo` ({uid, rol}) con el gasto. Espejo de firestore.rules
  // (match /caja_menuda): si esto y las reglas se separan, el botón sale y la
  // escritura rebota.
  function acciones(g, yo) {
    const out = [];
    if (!g || !yo) return out;
    const mio = g.solicitante_uid === yo.uid;
    const custodio = esCustodio(yo.rol);
    if (g.estado === "solicitado") {
      if (mio) out.push("editar", "anular");
      if (esAprobador(g, yo)) out.push("aprobar", "rechazar");
    }
    if (g.estado === "aprobado" && custodio) {
      out.push(g.tipo === "anticipo" ? "entregar" : "pagar", "rechazar");
    }
    if (g.estado === "entregado" && g.tipo === "anticipo" && mio) out.push("rendir");
    if (g.estado === "rendido" && custodio) out.push("cerrar", "devolver_rendicion");
    return out;
  }

  // Quién tiene la pelota: una frase para la fila de "mis gastos".
  function esperaA(g) {
    switch (g && g.estado) {
      case "solicitado": return g.aprobador_nombre ? `Espera a ${g.aprobador_nombre}` : "Espera a administración";
      case "aprobado": return g.via === "ach" ? "Contabilidad te lo paga por ACH" : (g.tipo === "anticipo" ? "Pasa por contabilidad a retirar el efectivo" : "Pasa por contabilidad a cobrarlo");
      case "entregado": return "Falta que traigas la factura";
      case "rendido": return "Contabilidad revisa tu factura";
      default: return "";
    }
  }

  // Días que lleva un anticipo entregado sin rendir (null si no aplica).
  function diasSinRendir(g, ahoraMs) {
    if (!g || g.tipo !== "anticipo" || g.estado !== "entregado") return null;
    const at = g.entrega && g.entrega.at;
    const ms = at && typeof at.toMillis === "function" ? at.toMillis() : (at instanceof Date ? at.getTime() : Number(at) || 0);
    if (!ms) return null;
    return Math.max(0, Math.floor(((ahoraMs || Date.now()) - ms) / 86400000));
  }

  // Valida lo que escribió la persona. Devuelve la lista de problemas en
  // palabras de ella; vacía = se puede enviar.
  function validar(f, cfg, { hoyISO = "" } = {}) {
    const c = config(cfg);
    const e = [];
    const monto = num(f && f.monto);
    if (!f || !TIPOS[f.tipo]) e.push("Elige si ya lo pagaste o si necesitas el efectivo.");
    if (!(monto > 0)) e.push("Escribe el monto.");
    else if (monto > MONTO_MAXIMO) e.push(`El monto no puede pasar de $${MONTO_MAXIMO}.`);
    if (!f || !c.categorias.includes(f.categoria)) e.push("Elige la categoría.");
    if (!f || String(f.concepto || "").trim().length < 3) e.push("Escribe para qué fue el gasto.");
    const nRecibos = (f && Array.isArray(f.recibos) ? f.recibos : []).length;
    if (nRecibos > MAX_RECIBOS) e.push(`Máximo ${MAX_RECIBOS} fotos.`);
    if (f && f.tipo === "reembolso") {
      if (!nRecibos) e.push("Falta la foto de la factura.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha_gasto || ""))) e.push("Pon la fecha de la factura.");
      else if (hoyISO && f.fecha_gasto > hoyISO) e.push("La fecha de la factura no puede ser futura.");
    }
    return e;
  }

  // Rendición de un anticipo: lo gastado contra lo entregado.
  //   vuelto > 0  → la persona devuelve efectivo al fondo
  //   vuelto < 0  → gastó de más; se le debe la diferencia
  function rendicion(entregado, gastado) {
    const e = num(entregado), g = num(gastado);
    if (!(e >= 0) || !(g >= 0)) return null;
    return { monto_gastado: g, vuelto: Math.round((e - g) * 100) / 100 };
  }

  // Efectivo que cada gasto sacó del fondo y todavía no ha vuelto por una
  // reposición. Lo pagado por ACH nunca toca el fondo.
  function efectivoFuera(g) {
    if (!g || g.via === "ach") return 0;
    const entregado = num(g.entrega && g.entrega.monto) || 0;
    if (g.estado === "pagado" || g.estado === "entregado" || g.estado === "rendido") return entregado;
    if (g.estado === "cerrado") {
      // Al cerrar: vuelve el vuelto, o sale la diferencia si gastó de más.
      const devuelto = num(g.cierre && g.cierre.vuelto_recibido) || 0;
      const diferencia = num(g.cierre && g.cierre.diferencia_pagada) || 0;
      return Math.round((entregado - devuelto + diferencia) * 100) / 100;
    }
    return 0;
  }

  const dinero = (n) => `$${(Number(n) || 0).toFixed(2)}`;

  const API = {
    CONFIG_DEFECTO, TIPOS, ESTADOS, ABIERTOS, ROLES_CUSTODIO, MAX_RECIBOS, MONTO_MAXIMO,
    num, config, via, esCustodio, esAprobador, acciones, esperaA, diasSinRendir,
    validar, rendicion, efectivoFuera, dinero,
  };

  if (typeof window !== "undefined") window.CajaMenuda = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
