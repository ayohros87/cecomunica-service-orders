// Chips de estado de la bandeja de órdenes — lo que filtra cada uno.
//
// 2026-09-30: los chips filtraban por el estado GUARDADO y las filas muestran
// el nombre de PANTALLA (estadoCompacto, ordenes-state.js). Resultado: una
// ENTRADA en POR ASIGNAR decía "Por asignar" en la fila pero caía bajo el chip
// "Por recibir", y el chip "Por asignar" (RECIBIDO EN MOSTRADOR) marcaba 0 con
// 45 filas que decían "Por asignar". Ahora dos chips son VISTAS sobre el
// estado guardado:
//   por_recibir → POR ASIGNAR de los tipos que pasan por mostrador (el
//                 cliente todavía no trae el equipo).
//   por_asignar → RECIBIDO EN MOSTRADOR + POR ASIGNAR de los tipos que no
//                 pasan por mostrador (PROGRAMACIÓN, ENTRADA, VISITA): todo lo
//                 que espera técnico.
// Las DEVOLUCIÓN quedan fuera de las dos (circuito propio, nunca se asignan).
// El resto de valores (ASIGNADO, COMPLETADO…, y los crudos que traen los
// enlaces del home) se filtran tal cual.
//
// functions/test/estadosBandeja.test.js exige que coincide() y la etiqueta de
// la fila (estadoCompacto) digan lo mismo para cada orden.
window.EstadosBandeja = (() => {
  const POR_ASIGNAR = "POR ASIGNAR";
  const RECIBIDO = "RECIBIDO EN MOSTRADOR";

  // Valores EXACTOS de tipo_de_servicio sin paso por mostrador, para los
  // conteos del servidor (count() solo sabe de igualdad). Medido en producción
  // el 2026-09-30; sinPasoMostrador() es la regla, esta lista su espejo.
  const TIPOS_SIN_MOSTRADOR = ["PROGRAMACIÓN", "PROGRAMACION", "ENTRADA", "Entrada", "VISITA TECNICA", "VISITA TÉCNICA"];
  const TIPOS_FUERA_DE_COLA = ["DEVOLUCION"];

  const VISTAS = {
    por_recibir: { estados: [POR_ASIGNAR], etiqueta: "Por recibir" },
    por_asignar: { estados: [RECIBIDO, POR_ASIGNAR], etiqueta: "Por asignar" },
  };

  const norm = (s) => String(s || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Misma regla que estadoCompacto: PROGRAMACIÓN, ENTRADA y VISITA arrancan
  // en Asignar.
  function sinPasoMostrador(orden) {
    const t = norm(orden && orden.tipo_de_servicio);
    return t.includes("programacion") || t.includes("entrada") || t.includes("visita");
  }
  function esDevolucion(orden) {
    return norm(orden && orden.tipo_de_servicio).includes("devolucion");
  }
  function estadoDe(orden) {
    return String((orden && orden.estado_reparacion) || POR_ASIGNAR).trim().toUpperCase();
  }

  // Las claves de vista no distinguen mayúsculas: el filtro de la bandeja
  // pasa el valor por toUpperCase() en varios caminos (URL, búsqueda).
  function vistaDe(clave) {
    const k = String(clave || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(VISTAS, k) ? k : null;
  }
  function esVista(clave) { return vistaDe(clave) !== null; }

  // Estados guardados que hay que consultar para una clave de chip.
  function estadosDe(clave) {
    const v = vistaDe(clave);
    return v ? VISTAS[v].estados.slice() : [String(clave || "").trim().toUpperCase()];
  }

  // ¿La orden entra en el chip/filtro `clave`?
  function coincide(orden, clave) {
    if (!clave) return true;
    const e = estadoDe(orden);
    const v = vistaDe(clave);
    if (v === "por_recibir") return e === POR_ASIGNAR && !esDevolucion(orden) && !sinPasoMostrador(orden);
    if (v === "por_asignar") {
      return e === RECIBIDO || (e === POR_ASIGNAR && !esDevolucion(orden) && sinPasoMostrador(orden));
    }
    const k = String(clave).trim().toUpperCase();
    // POR ASIGNAR crudo (enlace del home): la cola de taller, sin DEVOLUCIÓN.
    if (k === POR_ASIGNAR) return e === POR_ASIGNAR && !esDevolucion(orden);
    return e === k;
  }

  return {
    VISTAS, TIPOS_SIN_MOSTRADOR, TIPOS_FUERA_DE_COLA,
    esVista, vistaDe, estadosDe, coincide, sinPasoMostrador,
  };
})();
