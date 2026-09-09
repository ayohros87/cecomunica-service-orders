// Carga diferida de SDKs y módulos de acción (auditoría órdenes P3.15).
//
// POR QUÉ. La página de órdenes cargaba en el arranque ~90-100 KB gz que solo
// se usan en acciones puntuales: firebase-storage (subir una firma/foto),
// firebase-functions (un callable de admin), y los módulos de devolución /
// informe de visita / fotos / notas. Con esto se pagan al PRIMER uso.
//
// CÓMO. Los SDK compat de Firebase se registran solos sobre la app ya
// inicializada, así que cargarlos tarde es seguro. Cada script se inyecta
// UNA vez (cache de promesas); reintento posible si falló (se borra del cache).
//
// ⚠️ VERSIONES: los ?v= de los módulos diferidos viven AQUÍ (ya no hay tag en
// el HTML). Al tocar ordenes-devolucion/visita/fotos/notas o firmaPad, bumpea
// la constante MODULOS de abajo y el ?v= de ESTE archivo en el HTML.
window.CargaDiferida = (() => {
  const _cargas = new Map(); // src -> Promise

  // Hoja de estilos diferida — misma idea que script(): una sola inyección,
  // y no bloquea (la hoja ya está pintada cuando el CSS aterriza).
  function css(href) {
    if (_cargas.has(href)) return _cargas.get(href);
    const p = new Promise((resolve) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      // Resolver también en error: un módulo no se cae por falta de estilos.
      l.onload = () => resolve();
      l.onerror = () => resolve();
      document.head.appendChild(l);
    });
    _cargas.set(href, p);
    return p;
  }

  function script(src) {
    if (_cargas.has(src)) return _cargas.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { _cargas.delete(src); reject(new Error("No se pudo cargar " + src)); };
      document.head.appendChild(s);
    });
    _cargas.set(src, p);
    return p;
  }

  const GSTATIC = "https://www.gstatic.com/firebasejs/10.10.0/";
  const MODULOS = {
    firmaPad:   "/js/ui/firmaPad.js?v=dev3",
    devolucion: "/js/pages/ordenes-devolucion.js?v=dev19",
    // Solo lo necesita el cierre de una devolución con faltantes (itemizar lo
    // que el cliente no devolvió) — no tiene por qué pesar en cada orden.
    cobros:     "/js/services/cobrosEquiposService.js?v=nd1",
    visita:     "/js/pages/ordenes-visita.js?v=f3",
    fotos:      "/js/pages/ordenes-fotos.js?v=1",
    notas:      "/js/pages/ordenes-notas.js?v=1",
    // Dividir una ENTRADA grande entre varias órdenes (Brenda, 2026-09-08).
    dividir:    "/js/pages/ordenes-dividir.js?v=1",
    // Entrega parcial de una REPARACIÓN: el cliente se lleva solo una tanda.
    entregaParcial: "/js/pages/ordenes-entrega-parcial.js?v=1",
    // Válvula de casos viejos: cerrar reparaciones que llevan ≥30 días.
    // Necesita el kit de bandeja (fila + semáforo), que /ordenes/ no carga.
    casosViejos: "/js/pages/ordenes-casos-viejos.js?v=1",
    bandejaKit: "/js/ui/bandeja.js?v=1",
    bandejaCss: "/css/bandeja.css?v=1",
    // Propuesta de reemplazo desde el taller: el módulo + lo que necesita
    // (expedientes de gestión y la garantía de la unidad), que no se cargan
    // en /ordenes/ para nada más.
    reemplazo:  "/js/pages/ordenes-reemplazo.js?v=1",
    gestiones:  "/js/services/gestionesService.js?v=cg13",
    garantia:   "/js/domain/garantiaEquipo.js?v=1",
  };

  return {
    script, css,
    storage() {
      return firebase.storage ? Promise.resolve() : script(GSTATIC + "firebase-storage-compat.js");
    },
    functions() {
      return firebase.functions ? Promise.resolve() : script(GSTATIC + "firebase-functions-compat.js");
    },
    // Módulos de acción de órdenes. Cada uno garantiza sus dependencias:
    // el check-in de devolución necesita el pad de firma y storage; el
    // informe/cierre de visita y las fotos suben archivos a storage.
    devolucion() {
      return window.OrdenesDevolucion ? Promise.resolve()
        : this.storage()
            .then(() => script(MODULOS.firmaPad))
            .then(() => script(MODULOS.cobros))
            .then(() => script(MODULOS.devolucion));
    },
    visita() {
      return window.abrirInformeVisita ? Promise.resolve()
        : this.storage().then(() => script(MODULOS.visita));
    },
    fotos() {
      return window.abrirFotosOrden ? Promise.resolve()
        : this.storage().then(() => script(MODULOS.fotos));
    },
    notas() {
      return window.gestionarNotasTecnicas ? Promise.resolve() : script(MODULOS.notas);
    },
    dividir() {
      return window.abrirDividirOrden ? Promise.resolve() : script(MODULOS.dividir);
    },
    // La hoja captura la firma de quien recibe y la sube a Storage.
    entregaParcial() {
      return window.abrirEntregaParcial ? Promise.resolve()
        : this.storage()
            .then(() => script(MODULOS.firmaPad))
            .then(() => script(MODULOS.entregaParcial));
    },
    casosViejos() {
      return window.abrirCasosViejos ? Promise.resolve()
        : Promise.all([script(MODULOS.bandejaKit), css(MODULOS.bandejaCss)])
            .then(() => script(MODULOS.casosViejos));
    },
    reemplazo() {
      return window.OrdenesReemplazo ? Promise.resolve()
        : Promise.all([script(MODULOS.gestiones), script(MODULOS.garantia)])
            .then(() => script(MODULOS.reemplazo));
    },
  };
})();
