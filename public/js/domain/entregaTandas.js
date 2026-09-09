// Entrega parcial por TANDAS — predicados puros.
//
// Una orden de REPARACIÓN puede entregarse por partes: el cliente se lleva
// los radios que ya están listos y el resto se queda en el taller. Cada tanda
// es una entrega real, con su receptor y su firma, y vive en
// `entrega.tandas[]` — espejo exacto de `devolucion.acuses[]`, que resuelve
// el mismo problema al revés (la devolución también llega por tandas).
//
// LA ORDEN NO CAMBIA DE ESTADO por una tanda: sigue en COMPLETADO (EN
// OFICINA) mientras quede algo pendiente. Inventar un "ENTREGADO PARCIAL"
// habría obligado a ~15 consumidores de estado_reparacion a aprender un
// estado más. La ÚLTIMA entrega no es una tanda: es la entrega de siempre
// (confirmarEntrega), que es el único camino que cierra la orden.
//
// Consumidores: ordenes-render (contador de la fila), ordenes-flujo (candados
// y despacho al modal), ordenes-entrega-parcial (la hoja), ordenesService
// (la escritura).
window.EntregaTandas = (() => {

  // Solo REPARACIÓN (decisión del usuario 2026-09-09). PROGRAMACIÓN queda
  // fuera a propósito: ahí la entrega arranca la facturación del contrato
  // (onOrdenEntregada) y una entrega a medias dejaría esa señal ambigua.
  // ENTRADA no entrega, VISITA cierra en sitio, DEVOLUCIÓN tiene su circuito.
  //
  // Sin tildes y en minúsculas porque el tipo sale de empresa/tipo_de_servicio,
  // que los guarda ACENTUADOS ("REPARACIÓN") — comparar el string crudo dejaba
  // la subrutina invisible en toda la bandeja. Mismo criterio que esOrdenEntrada.
  function admiteTandas(orden) {
    const tipo = String((orden && orden.tipo_de_servicio) || "")
      .trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return tipo.includes("reparacion");
  }

  function equiposActivos(orden) {
    return (Array.isArray(orden && orden.equipos) ? orden.equipos : [])
      .filter((e) => e && !e.eliminado);
  }

  function tandas(orden) {
    const t = orden && orden.entrega && orden.entrega.tandas;
    return Array.isArray(t) ? t : [];
  }

  // Los equipos ya entregados en tandas anteriores. Se casa por `id` (el
  // uuid del equipo dentro de la orden) y, como red, por serial: los equipos
  // legacy pueden no traer id, y el serial es lo que el cliente firmó.
  function idsEntregados(orden) {
    const ids = new Set();
    for (const t of tandas(orden)) {
      for (const e of (Array.isArray(t.equipos) ? t.equipos : [])) {
        if (e && e.id) ids.add(String(e.id));
        const s = String((e && e.serial) || "").trim().toUpperCase();
        if (s) ids.add("serial:" + s);
      }
    }
    return ids;
  }

  function claveEquipo(e) {
    if (e && e.id) return String(e.id);
    const s = String((e && (e.numero_de_serie || e.serial)) || "").trim().toUpperCase();
    return s ? "serial:" + s : "";
  }

  function yaEntregado(orden, equipo) {
    const entregados = idsEntregados(orden);
    if (equipo && equipo.id && entregados.has(String(equipo.id))) return true;
    const s = String((equipo && (equipo.numero_de_serie || equipo.serial)) || "")
      .trim().toUpperCase();
    return !!s && entregados.has("serial:" + s);
  }

  // Lo que todavía está en el taller esperando que el cliente lo recoja.
  function equiposPendientes(orden) {
    const entregados = idsEntregados(orden);
    return equiposActivos(orden).filter((e) => {
      if (e.id && entregados.has(String(e.id))) return false;
      const s = String((e.numero_de_serie || e.serial) || "").trim().toUpperCase();
      return !(s && entregados.has("serial:" + s));
    });
  }

  // Resumen para pintar "6 de 10 entregados" sin recorrer el array tres veces.
  function resumen(orden) {
    const total = equiposActivos(orden).length;
    const pendientes = equiposPendientes(orden).length;
    return {
      total,
      pendientes,
      entregados: total - pendientes,
      tandas: tandas(orden).length,
      parcial: total > 0 && pendientes > 0 && pendientes < total,
    };
  }

  // Número de la tanda que viene. Correlativo POR ORDEN, no global: el
  // cliente recibe "2026090812-E2" y sabe que es la segunda entrega de SU
  // orden. Misma convención que el acuse de devolución ({ordenId}-A{n}).
  function siguienteTanda(orden, ordenId) {
    const n = tandas(orden).length + 1;
    return { n, numero: `${ordenId}-E${n}` };
  }

  // ¿Tiene sentido ofrecer "entregar solo algunos"? Hace falta que queden al
  // menos DOS pendientes: con uno solo, la entrega parcial ES la entrega
  // completa y el camino correcto es el botón de siempre.
  function puedeEntregarParcial(orden) {
    return admiteTandas(orden) && equiposPendientes(orden).length >= 2;
  }

  return {
    admiteTandas, equiposActivos, tandas, idsEntregados, claveEquipo,
    yaEntregado, equiposPendientes, resumen, siguienteTanda,
    puedeEntregarParcial,
  };
})();
