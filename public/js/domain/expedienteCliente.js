// @ts-nocheck
// Expediente legal del cliente — qué documentos se piden y en qué estado está
// cada uno. Lógica PURA (sin Firestore).
//
// El problema (Zuleika, 2026-11-25): los documentos de un cliente nuevo llegan
// por correo al vendedor y ahí se quedan; nadie los sube. Censo de ese día: de
// 278 clientes activos, 20 tenían algún documento y 8 los tres. Nada en el
// sistema decía QUÉ falta, así que tampoco había a quién pedírselo.
//
// Los tres que pide administración:
//   · Aviso de Operación o Registro Público (cualquiera de los dos cumple)
//   · Cédula del representante legal
//   · Recibo de luz, agua o teléfono (verifica la dirección)
//
// Estado de cada requisito, a partir de los documentos NO eliminados:
//   'ok'          hay uno revisado, o subido por el personal (quien lo sube
//                 desde la ficha ya lo vio: no lleva revisión aparte)
//   'por_revisar' lo subió el CLIENTE desde su enlace y Cobros aún no lo abre
//   'falta'       no hay ninguno
//
// Espejo en functions/src/domain/expedienteCliente.js (sin build compartido);
// functions/test/expedienteCliente.test.js vigila que no se separen.
(function () {
  const REQUISITOS = [
    {
      id: "constitucion",
      label: "Aviso de Operación o Registro Público",
      corto: "Aviso de Operación / Registro Público",
      ayuda: "El Aviso de Operación de la empresa o su certificado del Registro Público. Cualquiera de los dos.",
      tipos: ["aviso_operacion", "registro_publico"],
    },
    {
      id: "cedula",
      label: "Cédula del representante legal",
      corto: "Cédula del representante",
      ayuda: "Foto o copia de la cédula (o pasaporte) del representante legal, donde se lean bien los datos.",
      tipos: ["cedula_representante"],
    },
    {
      id: "direccion",
      label: "Recibo de luz, agua o teléfono",
      corto: "Recibo de servicio",
      ayuda: "Un recibo reciente de luz, agua o teléfono, para verificar la dirección.",
      tipos: ["comprobante_direccion"],
    },
  ];

  const IDS = REQUISITOS.map((r) => r.id);

  function requisito(id) {
    return REQUISITOS.find((r) => r.id === id) || null;
  }

  // A qué requisito responde un tipo de documento (null = no es de los tres:
  // poderes, "otro").
  function requisitoDeTipo(tipo) {
    const r = REQUISITOS.find((x) => x.tipos.includes(tipo));
    return r ? r.id : null;
  }

  function vivo(d) {
    return !!d && d.deleted !== true;
  }

  // ¿Espera la revisión de Cobros? Solo lo que entró por el cliente.
  function porRevisar(d) {
    return vivo(d) && !!d.revision && d.revision.estado === "pendiente";
  }

  function estadoRequisito(docs, id) {
    const r = requisito(id);
    if (!r) return "falta";
    const suyos = (docs || []).filter((d) => vivo(d) && r.tipos.includes(d.tipo));
    if (!suyos.length) return "falta";
    return suyos.some((d) => !porRevisar(d)) ? "ok" : "por_revisar";
  }

  // Lo que se guarda en clientes/{id}.expediente (más la fecha, que la pone
  // quien escribe). Un cliente sin el campo es un cliente sin documentos.
  function resumen(docs) {
    const out = { por_revisar: 0, faltan: [], completo: false };
    for (const id of IDS) {
      out[id] = estadoRequisito(docs, id);
      if (out[id] === "falta") out.faltan.push(id);
    }
    out.por_revisar = (docs || []).filter(porRevisar).length;
    out.completo = IDS.every((id) => out[id] === "ok");
    return out;
  }

  // Lectura tolerante del campo guardado: sin campo = faltan los tres.
  function leer(expediente) {
    const e = expediente && typeof expediente === "object" ? expediente : null;
    const out = { por_revisar: Number((e && e.por_revisar) || 0), faltan: [], completo: false };
    for (const id of IDS) {
      const v = e && ["ok", "por_revisar", "falta"].includes(e[id]) ? e[id] : "falta";
      out[id] = v;
      if (v === "falta") out.faltan.push(id);
    }
    out.completo = IDS.every((id) => out[id] === "ok");
    return out;
  }

  function mismoResumen(a, b) {
    const x = leer(a), y = leer(b);
    return x.por_revisar === y.por_revisar && IDS.every((id) => x[id] === y[id]);
  }

  // "Aviso de Operación / Registro Público y Recibo de servicio"
  function fraseFaltan(ids) {
    const xs = (ids || []).map((id) => (requisito(id) || {}).corto).filter(Boolean);
    if (!xs.length) return "";
    if (xs.length === 1) return xs[0];
    return xs.slice(0, -1).join(", ") + " y " + xs[xs.length - 1];
  }

  // Qué se le pide al cliente en un enlace: lo que el personal marcó o, si no
  // marcó nada, lo que falta. Siempre en el orden canónico y sin repetidos.
  function pedidos(marcados, expediente) {
    const m = Array.isArray(marcados) ? marcados.filter((id) => IDS.includes(id)) : [];
    const base = m.length ? m : leer(expediente).faltan;
    return IDS.filter((id) => base.includes(id));
  }

  // Días de vida del enlace de carga.
  const DIAS_ENLACE = 30;

  const API = {
    REQUISITOS, IDS, DIAS_ENLACE,
    requisito, requisitoDeTipo, porRevisar, estadoRequisito,
    resumen, leer, mismoResumen, fraseFaltan, pedidos,
  };

  if (typeof window !== "undefined") window.ExpedienteCliente = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
