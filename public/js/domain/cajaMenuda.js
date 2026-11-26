// @ts-nocheck
/* global window */
// Caja menuda — estados, quién puede hacer qué y validación del formulario.
// Lógica PURA (sin Firestore). La comparten la pantalla de quien pide
// (caja/index.html), la bandeja de contabilidad (caja/contabilidad.html), el
// servidor y las pruebas (functions/test/cajaMenuda.test.js).
//
// OJO: functions/src/domain/cajaMenuda.js es COPIA EXACTA de este archivo (la
// usan el trigger y la callable de reposición). Si cambias uno, copia el otro:
// la prueba F6 falla si se separan.
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
    // Las columnas del informe de caja menuda que Cheila lleva en Excel
    // (muestra del 2026-11-26), en su mismo orden.
    categorias: ["Vales y viáticos", "Transporte y estacionamiento", "Taller", "Mantenimiento de auto",
      "Correo y timbres", "Peaje", "Misceláneo", "Combustible"],
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

  // ── Fondo, reposición y arqueo (2026-11-26) ────────────────────────────
  // Cómo lo lleva Cheila (su "Informe de caja menuda y arqueo"): el fondo es
  // fijo ($200). Cuando se va acabando junta los recibos pagados desde la
  // última reposición, cuenta el efectivo por denominación y pide un cheque
  // por el total de los recibos. El informe es POR REPOSICIÓN, no por mes.
  //
  //   en caja debe haber = fondo − recibos pagados sin reponer
  //                              − anticipos que andan en la calle
  //                              − reposiciones pedidas cuyo cheque no ha vuelto
  //
  // Las cuentas van en centavos: 147 monedas de un centavo no pueden dar
  // 1.4700000000000002.
  const DENOMINACIONES = [
    { id: "m1", tipo: "moneda", valor: 0.01 },
    { id: "m5", tipo: "moneda", valor: 0.05 },
    { id: "m10", tipo: "moneda", valor: 0.1 },
    { id: "m25", tipo: "moneda", valor: 0.25 },
    { id: "m50", tipo: "moneda", valor: 0.5 },
    { id: "m100", tipo: "moneda", valor: 1 },
    { id: "b1", tipo: "billete", valor: 1 },
    { id: "b5", tipo: "billete", valor: 5 },
    { id: "b10", tipo: "billete", valor: 10 },
    { id: "b20", tipo: "billete", valor: 20 },
  ];
  const centavos = (v) => Math.round((Number(v) || 0) * 100);
  const deCentavos = (c) => Math.round(c) / 100;
  const msDe = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : (t instanceof Date ? t.getTime() : Number(t) || 0));
  // Panamá es UTC−5 todo el año.
  const fechaPanama = (ms) => (ms ? new Date(ms - 5 * 3600000).toISOString().slice(0, 10) : "");

  // El gasto ya sacó efectivo del fondo para siempre (reembolso pagado, o
  // anticipo cerrado con algo gastado) y todavía no entró en una reposición.
  function porReponer(g) {
    return !!g && !g.reposicion_id && g.via !== "ach"
      && (g.estado === "pagado" || g.estado === "cerrado") && efectivoFuera(g) > 0;
  }

  // Efectivo de un anticipo que sigue en manos de la persona.
  function enLaCalle(g) {
    if (!g || g.tipo !== "anticipo" || (g.estado !== "entregado" && g.estado !== "rendido")) return 0;
    return num(g.entrega && g.entrega.monto) || 0;
  }

  // El conteo es { m1: 147, b5: 2, … }: enteros, y solo denominaciones de la lista.
  function conteoValido(conteo) {
    if (!conteo || typeof conteo !== "object" || Array.isArray(conteo)) return false;
    const ids = DENOMINACIONES.map((d) => d.id);
    return Object.keys(conteo).every((k) => ids.includes(k)
      && Number.isInteger(conteo[k]) && conteo[k] >= 0 && conteo[k] <= 9999);
  }

  function arqueo(conteo) {
    const c = conteo || {};
    let total = 0;
    const lineas = DENOMINACIONES.map((d) => {
      const n = Number(c[d.id]);
      const cant = Number.isInteger(n) && n > 0 ? n : 0;
      const monto = cant * centavos(d.valor);
      total += monto;
      return { id: d.id, tipo: d.tipo, valor: d.valor, cant, monto: deCentavos(monto) };
    });
    return { lineas, efectivo: deCentavos(total) };
  }

  // El cuadre del fondo. `gastos` puede traer de todo: aquí se separa lo que
  // está por reponer de lo que anda en la calle. Con `conteo`, además dice
  // cuánto se contó y la diferencia (+ sobra, − falta).
  function cuadre({ fondo, gastos = [], reposiciones = [], conteo = null } = {}) {
    const f = centavos(fondo);
    const porRep = gastos.filter(porReponer);
    const gastado = porRep.reduce((n, g) => n + centavos(efectivoFuera(g)), 0);
    const anticipos = gastos.reduce((n, g) => n + centavos(enLaCalle(g)), 0);
    const porCobrar = reposiciones
      .filter((r) => r && r.tipo === "reposicion" && r.estado === "preparada")
      .reduce((n, r) => n + centavos(r.total), 0);
    const esperado = f - gastado - anticipos - porCobrar;
    const out = {
      fondo: deCentavos(f), n: porRep.length, gastado: deCentavos(gastado), anticipos: deCentavos(anticipos),
      por_cobrar: deCentavos(porCobrar), esperado: deCentavos(esperado),
    };
    if (conteo) {
      const a = arqueo(conteo);
      out.efectivo = a.efectivo;
      out.diferencia = deCentavos(centavos(a.efectivo) - esperado);
    }
    return out;
  }

  // Las filas del informe: un recibo por gasto, en orden de número. La fecha
  // es la del día en que salió el efectivo (pago del reembolso o cierre del
  // anticipo), como en el informe de Cheila.
  function itemsInforme(gastos) {
    return (gastos || []).filter(porReponer).map((g) => ({
      id: g.id,
      numero: g.numero || "",
      fecha: fechaPanama(msDe((g.cierre && g.cierre.at) || (g.entrega && g.entrega.at))),
      beneficiario: g.solicitante_nombre || "",
      categoria: g.categoria || "",
      concepto: g.concepto || "",
      monto: efectivoFuera(g),
    })).sort((a, b) => String(a.numero).localeCompare(String(b.numero)) || a.fecha.localeCompare(b.fecha));
  }

  const numeroReposicion = (tipo, n) => `${tipo === "arqueo" ? "ARQ" : "REP"}-${String(n).padStart(4, "0")}`;

  // El informe en el formato del Excel de Cheila, como filas (arreglo de
  // arreglos) listas para la hoja: COMP · FECHA · BENEFICIARIO · una columna
  // por categoría · DESCRIPCIÓN · TOTAL, los totales, el cuadre del fondo y
  // el arqueo por denominación. `rep` es el doc de caja_menuda_reposiciones.
  function informe(rep, categorias) {
    const r = rep || {};
    const items = Array.isArray(r.items) ? r.items : [];
    const cats = (categorias || []).slice();
    for (const it of items) if (it.categoria && !cats.includes(it.categoria)) cats.push(it.categoria);
    const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.split("-").reverse().join("/") : "");
    const filas = [];
    filas.push(["C COMUNICA, S.A. — INFORME DE CAJA MENUDA"]);
    filas.push([[r.tipo === "arqueo" ? "Arqueo" : "Reposición", r.numero || "",
      items.length ? `· comprobantes ${r.desde || ""} al ${r.hasta || ""}` : "", r.fecha ? `· ${dmy(r.fecha)}` : ""]
      .filter(Boolean).join(" ")]);
    filas.push([]);
    const porCat = cats.map(() => 0);
    let total = 0;
    // Un arqueo suelto no trae la lista de recibos (siguen por reponer):
    // solo el cuadre y el conteo.
    if (items.length) {
      filas.push(["COMP", "FECHA", "BENEFICIARIO", ...cats.map((c) => c.toUpperCase()), "DESCRIPCIÓN", "TOTAL"]);
      for (const it of items) {
        const m = centavos(it.monto);
        const i = cats.indexOf(it.categoria);
        if (i >= 0) porCat[i] += m;
        total += m;
        filas.push([it.numero || "", dmy(it.fecha), it.beneficiario || "",
          ...cats.map((c, j) => (j === i ? deCentavos(m) : "")), it.concepto || "", deCentavos(m)]);
      }
      filas.push(["", "", "", ...porCat.map(deCentavos), "", deCentavos(total)]);
      filas.push([]);
    }
    filas.push(["", "", "FONDO DE CAJA", num(r.fondo) || 0]);
    filas.push(["", "", r.tipo === "arqueo" ? "RECIBOS SIN REPONER:" : "REEMBOLSO:",
      items.length ? deCentavos(total) : (num(r.total) || 0)]);
    if (num(r.anticipos) > 0) filas.push(["", "", "ANTICIPOS POR RENDIR:", num(r.anticipos)]);
    if (num(r.por_cobrar) > 0) filas.push(["", "", "REPOSICIONES POR COBRAR:", num(r.por_cobrar)]);
    filas.push(["", "", "TOTAL EN CAJA:", num(r.esperado) || 0]);
    filas.push([]);
    const a = arqueo(r.arqueo && r.arqueo.conteo);
    const linea = (l) => ["", l.cant, l.valor, l.monto];
    filas.push(["Monedas", "Cant", "Denominación", "Monto"]);
    for (const l of a.lineas.filter((x) => x.tipo === "moneda")) filas.push(linea(l));
    filas.push(["Billetes"]);
    for (const l of a.lineas.filter((x) => x.tipo === "billete")) filas.push(linea(l));
    filas.push(["Efectivo en Caja", "", "", a.efectivo]);
    const dif = deCentavos(centavos(a.efectivo) - centavos(r.esperado));
    if (dif) filas.push([dif > 0 ? "Sobrante" : "Faltante", "", "", Math.abs(dif)]);
    if (r.nota) filas.push([`Nota: ${r.nota}`]);
    filas.push([]);
    filas.push([`Preparado por: ${r.created_by_nombre || "______________________________"}`]);
    filas.push(["Revisado por: _______________________________"]);
    return { filas, columnas: 3 + cats.length + 2 };
  }

  const API = {
    CONFIG_DEFECTO, TIPOS, ESTADOS, ABIERTOS, ROLES_CUSTODIO, MAX_RECIBOS, MONTO_MAXIMO, DENOMINACIONES,
    num, config, via, esCustodio, esAprobador, acciones, esperaA, diasSinRendir,
    validar, rendicion, efectivoFuera, dinero,
    porReponer, enLaCalle, conteoValido, arqueo, cuadre, itemsInforme, numeroReposicion, informe, fechaPanama,
  };

  if (typeof window !== "undefined") window.CajaMenuda = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
