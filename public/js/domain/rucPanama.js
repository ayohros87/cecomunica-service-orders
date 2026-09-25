// @ts-nocheck
// RUC panameño — lógica PURA: las partes, cómo se escribe y el DV.
//
// El problema (Karla, 2026-09-25): el PNUD tiene RUC 8-NT-2-39271 y la casilla
// solo aceptaba números y guiones; se quedó en blanco para poder cotizar. El
// barrido de los 457 clientes de producción mostró que el problema era más
// grande que las letras:
//   · 7 entidades (ministerios, municipios, P.H., un consorcio) están guardadas
//     SIN el NT — 8-1-12607 por 8-NT-1-12607 — y su DV solo cuadra con el NT.
//   · 100+ traen el DV metido en el RUC ("8-496-731:84", "3-87-2598 DV 53").
//   · ~15 tienen el DV con dígitos cambiados (03 por 30) o un año de más.
// Por eso el RUC se captura POR PARTES, como en e-Tax de la DGI (tipo de
// contribuyente → provincia → letras, en blanco si no lleva → tomo → asiento),
// y el DV se VERIFICA contra el que calcula la DGI.
//
// Formatos (DGI, "Algoritmo para el cálculo del DV", versión 201805):
//   Natural            8-712-1043         provincia-tomo-asiento
//   Natural E / N / PE E-8-127702         letras-tomo-asiento (sin provincia)
//   Natural AV / PI    8AV-130-765        provincia+letras-tomo-asiento
//   Natural NT         8-NT-1-24          provincia-NT-tomo-asiento
//   Jurídica           155612345-2-2015   tomo/ficha-folio/rollo-asiento/imagen
//   Jurídica NT        8-NT-2-39271       provincia-NT-tomo-asiento (Estado,
//                      organismos internacionales, P.H., asociaciones sin fines
//                      de lucro, consorcios)
// Natural NT y jurídica NT se escriben IGUAL y dan DV distinto: por eso el tipo
// de contribuyente se pregunta y se guarda (`ruc_tipo`), no se deduce.
//
// El cálculo del DV es un port de github.com/juancorradine/Panama-RUC-DV-Calculator
// (implementa el documento de la DGI) y se probó contra sus 81 casos y contra
// esa misma implementación con los RUC de producción (functions/test/rucPanama.test.js).
(function () {
  "use strict";

  const TIPOS = ["juridica", "natural", "otro"];

  const PROVINCIAS = [
    ["1", "Bocas del Toro"], ["2", "Coclé"], ["3", "Colón"], ["4", "Chiriquí"],
    ["5", "Darién"], ["6", "Herrera"], ["7", "Los Santos"], ["8", "Panamá"],
    ["9", "Veraguas"], ["10", "Guna Yala"], ["11", "Emberá-Wounaan"],
    ["12", "Ngäbe-Buglé"], ["13", "Panamá Oeste"],
  ];

  // Letras de la cédula. "" = sin letras (el caso normal).
  const LETRAS = {
    natural: [
      ["", "Sin letras"],
      ["E", "E — extranjero"],
      ["N", "N — naturalizado"],
      ["PE", "PE — nacido afuera"],
      ["AV", "AV — antes de la vigencia"],
      ["PI", "PI — indígena"],
      ["NT", "NT — número tributario"],
    ],
    juridica: [
      ["", "Sin letras"],
      ["NT", "NT — número tributario"],
    ],
  };

  // Las letras que van SIN provincia delante.
  const SIN_PROVINCIA = ["E", "N", "PE"];

  // Largo máximo de cada parte (el de la DGI; más largo, la DGI lo rechaza).
  function limites(tipo, letra) {
    if (letra === "NT") return { tomo: 3, asiento: tipo === "juridica" ? 7 : 6 };
    if (tipo === "juridica") return { p1: 9, p2: 4, p3: 6 };
    if (letra === "AV" || letra === "PI") return { tomo: 4, asiento: 8 };
    return { tomo: 4, asiento: 9 };
  }

  // ── Escribir ────────────────────────────────────────────────────────
  // Los dígitos tal cual, ceros a la izquierda incluidos: para la DGI el LARGO
  // de la parte cuenta (un asiento de 6 dígitos de una E o N se calcula por
  // otra rama que uno de 5), así que quitarlos puede cambiar el DV.
  const num = (s) => String(s == null ? "" : s).replace(/\D/g, "");

  // Las partes → el RUC como se escribe. "" si falta alguna parte.
  function componer(p) {
    const tipo = p && p.tipo;
    if (tipo === "otro") return String(p.texto || "").trim().toUpperCase().replace(/\s+/g, "");
    const letra = (p.letra || "").toUpperCase();
    const prov = num(p.provincia);
    if (tipo === "juridica" && letra !== "NT") {
      const a = num(p.p1), b = num(p.p2), c = num(p.p3);
      return a && b && c ? `${a}-${b}-${c}` : "";
    }
    if (tipo !== "juridica" && tipo !== "natural") return "";
    const tomo = num(p.tomo), asiento = num(p.asiento);
    if (!tomo || !asiento) return "";
    if (SIN_PROVINCIA.includes(letra)) return tipo === "natural" ? `${letra}-${tomo}-${asiento}` : "";
    if (!prov) return "";
    if (letra === "NT") return `${prov}-NT-${tomo}-${asiento}`;
    if (letra === "AV" || letra === "PI") return tipo === "natural" ? `${prov}${letra}-${tomo}-${asiento}` : "";
    if (letra) return "";
    return `${prov}-${tomo}-${asiento}`;
  }

  // ¿Qué parte falta o sobra? null si el RUC está completo y en sus límites.
  function problemaPartes(p) {
    if (!p || !TIPOS.includes(p.tipo)) return "Elige el tipo de contribuyente.";
    if (p.tipo === "otro") {
      const t = componer(p);
      if (!t) return "Escribe el número.";
      return /^(?=[A-Z0-9-]*\d)[A-Z0-9-]{4,20}$/.test(t) ? null
        : "El número lleva letras, números y guiones (de 4 a 20).";
    }
    const letra = (p.letra || "").toUpperCase();
    const lim = limites(p.tipo, letra);
    const falta = [], largo = [];
    const chk = (k, nombre) => {
      const v = num(p[k]);
      if (!v) falta.push(nombre);
      else if (lim[k] && v.length > lim[k]) largo.push(`${nombre} (máx. ${lim[k]} dígitos)`);
    };
    if (p.tipo === "juridica" && letra !== "NT") {
      chk("p1", "el tomo o ficha"); chk("p2", "el folio o rollo"); chk("p3", "el asiento o imagen");
    } else {
      if (!SIN_PROVINCIA.includes(letra)) {
        const pr = num(p.provincia);
        if (!pr) falta.push("la provincia");
        else if (!PROVINCIAS.some(([c]) => c === pr)) largo.push("la provincia");
      }
      chk("tomo", "el tomo"); chk("asiento", "el asiento");
    }
    if (falta.length) return "Falta " + _lista(falta) + ".";
    if (largo.length) return "Revisa " + _lista(largo) + ".";
    return null;
  }
  const _lista = (xs) => xs.length < 2 ? xs[0] : xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1];

  // ── Leer ────────────────────────────────────────────────────────────
  // El DV que la gente pega dentro del RUC: "…:84", "… DV 53", "… D.V.9", "….9".
  const RE_DV_PEGADO = /^(.*?)\s*(?::|\bD\.?\s*V\.?|\.(?=\d{1,2}$))\s*(\d{1,2})$/;

  // Un RUC escrito (el guardado, o uno pegado) → sus partes. Tolera lo que hay
  // en producción: DV pegado, espacios, minúsculas, "8NT-1-14694". Lo que no
  // encaja en ningún formato vuelve como tipo "otro" con el texto tal cual.
  // `tipoGuardado` decide entre natural y jurídica cuando la forma no alcanza
  // (el NT, y la cédula de 3 partes contra la jurídica corta); sin él, el DV
  // desempata si lo hay.
  function descomponer(valor, { tipo: tipoGuardado = "", dv = "" } = {}) {
    let s = String(valor == null ? "" : valor).toUpperCase().trim();
    let dvPegado = "";
    const m = s.match(RE_DV_PEGADO);
    if (m && /\d-/.test(m[1])) { s = m[1]; dvPegado = m[2]; }
    s = s.replace(/\s+/g, "").replace(/^-+|-+$/g, "");
    const dvTxt = String(dv || dvPegado || "").replace(/\D/g, "");
    const base = { dvPegado };
    if (!s) return { ...base, tipo: TIPOS.includes(tipoGuardado) ? tipoGuardado : "", vacio: true };
    if (tipoGuardado === "otro") return { ...base, tipo: "otro", texto: s };

    const partes = s.split("-");
    const esNum = (x) => /^\d+$/.test(x);
    const candidatos = [];

    // P-NT-T-A (y "PNT-T-A" sin el guion)
    let nt = null;
    if (partes.length === 4 && partes[1] === "NT" && esNum(partes[0]) && esNum(partes[2]) && esNum(partes[3])) {
      nt = { provincia: partes[0], tomo: partes[2], asiento: partes[3] };
    } else if (partes.length === 3 && /^\d{1,2}NT$/.test(partes[0]) && esNum(partes[1]) && esNum(partes[2])) {
      nt = { provincia: partes[0].slice(0, -2), tomo: partes[1], asiento: partes[2] };
    }
    if (nt) {
      candidatos.push({ tipo: "juridica", letra: "NT", ...nt });
      candidatos.push({ tipo: "natural", letra: "NT", ...nt });
    } else if (partes.length === 3 && esNum(partes[1]) && esNum(partes[2])) {
      const [a, b, c] = partes;
      if (SIN_PROVINCIA.includes(a)) candidatos.push({ tipo: "natural", letra: a, tomo: b, asiento: c });
      else if (/^\d{1,2}(AV|PI)$/.test(a)) candidatos.push({ tipo: "natural", letra: a.slice(-2), provincia: a.slice(0, -2), tomo: b, asiento: c });
      else if (esNum(a)) {
        const cedula = { tipo: "natural", letra: "", provincia: a, tomo: b, asiento: c };
        const jur = { tipo: "juridica", letra: "", p1: a, p2: b, p3: c };
        const pv = Number(a);
        // Una provincia (1–13) delante con tomo corto es cédula; lo demás, sociedad.
        if (a.length <= 2 && pv >= 1 && pv <= 13 && b.length <= 4) candidatos.push(cedula, jur);
        else candidatos.push(jur);
      }
    }
    if (!candidatos.length) return { ...base, tipo: "otro", texto: s };

    // Elegir: el tipo guardado manda; si no, el que haga cuadrar el DV; si no, el primero.
    let elegido = candidatos.find((c) => c.tipo === tipoGuardado);
    if (!elegido && dvTxt) elegido = candidatos.find((c) => calcularDV(c) === dvTxt.padStart(2, "0"));
    if (!elegido) elegido = candidatos[0];
    return { ...base, ...elegido };
  }

  // ── DV (algoritmo DGI) ──────────────────────────────────────────────
  const CRUCE_ANTIGUO = {
    "00": "00", "10": "01", "11": "02", "12": "03", "13": "04", "14": "05", "15": "06", "16": "07",
    "17": "08", "18": "09", "19": "01", "20": "02", "21": "03", "22": "04", "23": "07", "24": "08",
    "25": "09", "26": "02", "27": "03", "28": "04", "29": "05", "30": "06", "31": "07", "32": "08",
    "33": "09", "34": "01", "35": "02", "36": "03", "37": "04", "38": "05", "39": "06", "40": "07",
    "41": "08", "42": "09", "43": "01", "44": "02", "45": "03", "46": "04", "47": "05", "48": "06",
    "49": "07",
  };
  // Letra → [código, código de validación] (tabla de la DGI).
  const COD_LETRA = { E: ["5", "66"], PE: ["75", "82"], N: ["4", "92"], AV: ["15", "9595"], PI: ["79", "9595"] };

  const z = (s, n) => String(s).padStart(n, "0");
  const zr = (s, n) => String(s).padEnd(n, "0");

  function _digito(antiguo, s) {
    let j = 2, suma = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      if (antiguo && j === 12) { antiguo = false; j -= 1; }
      suma += j * (s.charCodeAt(i) - 48);
      j += 1;
    }
    const r = suma % 11;
    return r > 1 ? String(11 - r) : "0";
  }

  // Las partes → la tira de 20 posiciones de la DGI (y si es RUC antiguo).
  function _tira(p) {
    const letra = (p.letra || "").toUpperCase();
    const prov = num(p.provincia), tomo = num(p.tomo), asiento = num(p.asiento);
    if (letra === "NT") {
      if (p.tipo === "juridica") {
        return asiento.length === 6
          ? { s: "0000000" + z(prov, 2) + "43" + z(tomo, 3) + asiento }
          : { s: "00000000" + z(prov, 2) + "43" + z(tomo, 3) + z(asiento.slice(0, 5), 5) };
      }
      return asiento.length <= 5
        ? { s: "0000000" + "5" + z(prov, 2) + "43" + z(tomo, 3) + z(asiento, 5) }
        : { s: "000000" + "5" + z(prov, 2) + "43" + z(tomo, 3) + z(asiento, 6) };
    }
    if (p.tipo === "juridica") {
      let s = z(num(p.p1), 10) + z(num(p.p2), 4) + z(num(p.p3), 6);
      const antiguo = s[3] === "0" && s[4] === "0" && s[5] < "5";
      if (antiguo) s = s.slice(0, 5) + (CRUCE_ANTIGUO[s.slice(5, 7)] || s.slice(5, 7)) + s.slice(7);
      return { s, antiguo };
    }
    const a5 = z(asiento.slice(0, 5), 5);
    if (letra === "AV" || letra === "PI") {
      const [cod, val] = COD_LETRA[letra];
      return { s: z(tomo.length < 4 ? "5" + z(prov, 2) + cod + z(tomo, 3) + a5 : "5" + val + z(tomo, 4) + a5, 20) };
    }
    if (SIN_PROVINCIA.includes(letra)) {
      const [cod, val] = COD_LETRA[letra];
      const seis = asiento.length === 6 && (letra === "E" || letra === "N");
      const cola = seis ? asiento : a5;
      if (tomo.length < 4) return { s: z("5" + "00" + zr(cod, 2) + z(tomo, 3) + cola, 20) };
      return { s: z("5" + val + (seis ? zr(cod, 2) : cod) + z(tomo, 4) + cola, 20) };
    }
    return { s: z("5" + z(prov, 2) + "00" + z(tomo, 3) + a5, 20) };
  }

  // El DV que asigna la DGI a esas partes ("00".."99"), o "" si no aplica
  // (tipo "otro", partes incompletas).
  function calcularDV(p) {
    if (!p || p.tipo === "otro" || problemaPartes(p)) return "";
    const { s, antiguo = false } = _tira(p);
    const d1 = _digito(antiguo, s);
    const d2 = _digito(antiguo, s + d1);
    return d1 + d2;
  }

  // ¿El DV escrito es el de la DGI?
  //   'ok' | 'no_cuadra' (con `esperado`) | 'sin_dv' (con `esperado`) | 'no_aplica'
  function verificarDV(p, dv) {
    const esperado = calcularDV(p);
    if (!esperado) return { estado: "no_aplica", esperado: "" };
    const d = String(dv == null ? "" : dv).replace(/\D/g, "");
    if (!d) return { estado: "sin_dv", esperado };
    return { estado: d.padStart(2, "0") === esperado ? "ok" : "no_cuadra", esperado };
  }

  // Cuando el DV no cuadra, ¿hay UNA lectura vecina del mismo número con la
  // que sí? Es el caso de producción: 8-1-12607 (Ministerio de Trabajo) con DV
  // 01 es 8-NT-1-12607 — la casilla no aceptaba letras y el NT se cayó. Solo
  // se propone; lo acepta quien tiene el documento delante.
  function sugerirCorreccion(p, dv) {
    const d = String(dv == null ? "" : dv).replace(/\D/g, "");
    // "00" no cuenta: es el relleno de quien no tenía el DV (en producción,
    // 1-721-966 DV 00 de una persona natural "cuadraba" con un NT inventado).
    if (!p || !d || /^0+$/.test(d) || verificarDV(p, d).estado !== "no_cuadra") return null;
    const meta = d.padStart(2, "0");
    const letra = (p.letra || "").toUpperCase();
    const alt = [];
    const tomo = p.tipo === "juridica" && !letra ? p.p2 : p.tomo;
    const asiento = p.tipo === "juridica" && !letra ? p.p3 : p.asiento;
    const prov = p.tipo === "juridica" && !letra ? p.p1 : p.provincia;
    if (!letra) {
      alt.push({ tipo: "juridica", letra: "NT", provincia: prov, tomo, asiento, motivo: "le falta el NT" });
      alt.push({ tipo: "natural", letra: "NT", provincia: prov, tomo, asiento, motivo: "le falta el NT" });
    }
    if (letra === "NT") {
      alt.push({ ...p, tipo: p.tipo === "juridica" ? "natural" : "juridica",
        motivo: p.tipo === "juridica" ? "es NT de persona natural" : "es NT de persona jurídica" });
    }
    if (p.tipo === "natural" && !letra) alt.push({ tipo: "juridica", letra: "", p1: prov, p2: tomo, p3: asiento, motivo: "es de persona jurídica" });
    if (p.tipo === "juridica" && !letra) alt.push({ tipo: "natural", letra: "", provincia: prov, tomo, asiento, motivo: "es una cédula" });
    const buenas = alt.filter((a) => calcularDV(a) === meta);
    if (buenas.length !== 1 && !(buenas.length === 2 && buenas.every((b) => b.letra === "NT"))) return null;
    // Las dos NT cuadran a la vez casi nunca; si pasa, se propone la jurídica
    // (la que tiene la gente del Estado y los P.H.).
    const b = buenas[0];
    const { motivo, ...partes } = b;
    return { partes, ruc: componer(partes), motivo };
  }

  // Regla de formato para el kit de formularios: ¿es un RUC que se puede
  // escribir? (lo que no encaja en un formato DGI pasa como "otro" si parece
  // un identificador — pasaporte, ID fiscal extranjero). El DV pegado de las
  // fichas viejas no la reprueba: el componente nunca lo escribe, y marcar en
  // rojo un dato que nadie tocó solo asusta (el componente ofrece acomodarlo).
  function esValido(valor) {
    const s = String(valor == null ? "" : valor).trim();
    if (!s) return true;
    return !problemaPartes(descomponer(s));
  }

  const API = {
    TIPOS, PROVINCIAS, LETRAS, SIN_PROVINCIA,
    limites, componer, problemaPartes, descomponer, calcularDV, verificarDV, sugerirCorreccion, esValido,
  };

  if (typeof window !== "undefined") window.RucPanama = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
