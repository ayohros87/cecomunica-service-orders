// Carga diferida de módulos de acción (auditoría órdenes P3.15).
//
// POR QUÉ. La página de órdenes cargaba en el arranque ~90-100 KB gz que solo
// se usan en acciones puntuales: los módulos de devolución / informe de
// visita / fotos / notas, etc. Con esto se pagan al PRIMER uso.
//
// CÓMO (desde 2026-09-28, F2+deuda). Cada módulo se trae con `import()`:
// Vite lo empaqueta en su propio chunk con hash en el nombre, así que ya no
// hay `?v=` que bumpear a mano y el navegador nunca sirve una versión vieja.
// Los módulos siguen publicando sus globales en window (puente F1), igual que
// cuando se inyectaban como <script>. El navegador cachea el import() por
// URL: pedirlo dos veces no lo ejecuta dos veces.
//
// storage y functions compat (F3) ya vienen en el bundle de firebase-init:
// storage() y functions() se conservan por compatibilidad y resuelven de una.
window.CargaDiferida = (() => {
  // Los import() llevan la ruta literal a propósito: Vite solo empaqueta lo
  // que puede ver en tiempo de build.
  const MODULOS = {
    firmaPad:   () => import("/js/ui/firmaPad.js"),
    // Protocolo de la tablet de firmas. En /ordenes/ ya viene del entry
    // (ordenes-flujo lo usa y no es diferido); esto cubre a quien cargue
    // un módulo de firma desde otra página.
    firmaTablet: () => import("/js/ui/firmaTablet.js"),
    devolucion: () => import("/js/pages/ordenes-devolucion.js"),
    // Solo lo necesita el cierre de una devolución con faltantes (itemizar lo
    // que el cliente no devolvió) — no tiene por qué pesar en cada orden.
    cobros:     () => import("/js/services/cobrosEquiposService.js"),
    visita:     () => import("/js/pages/ordenes-visita.js"),
    fotos:      () => import("/js/pages/ordenes-fotos.js"),
    notas:      () => import("/js/pages/ordenes-notas.js"),
    // Dividir una ENTRADA grande entre varias órdenes (Brenda, 2026-09-08).
    dividir:    () => import("/js/pages/ordenes-dividir.js"),
    // Entrega parcial de una REPARACIÓN: el cliente se lleva solo una tanda.
    entregaParcial: () => import("/js/pages/ordenes-entrega-parcial.js"),
    // Válvula de casos viejos: cerrar reparaciones que llevan ≥30 días.
    // Necesita el kit de bandeja (fila + semáforo) y su hoja, que /ordenes/
    // no carga. El import() de un .css lo inyecta Vite como <link>.
    casosViejos: () => import("/js/pages/ordenes-casos-viejos.js"),
    bandejaKit: () => import("/js/ui/bandeja.js"),
    bandejaCss: () => import("/css/bandeja.css"),
    // Propuesta de reemplazo desde el taller: el módulo + lo que necesita
    // (expedientes de gestión y la garantía de la unidad), que no se cargan
    // en /ordenes/ para nada más.
    reemplazo:  () => import("/js/pages/ordenes-reemplazo.js"),
    // El taller avisa que un radio no sirve para la gestion (Zuleika 2026-09-16).
    cambioSerialTaller: () => import("/js/pages/ordenes-cambio-serial.js"),
    gestiones:  () => import("/js/services/gestionesService.js"),
    // Venta facturada: recepción le pide los seriales a bodega (Brenda,
    // 2026-10-07). El combo de cliente no viene en /ordenes/.
    ventaFacturada: () => Promise.all([
      import("/js/ui/entity-combo.js"),
      import("/js/services/pedidosVentaService.js"),
      import("/js/ui/venta-facturada.js"),
    ]),
    garantia:   () => import("/js/domain/garantiaEquipo.js"),
  };

  // Un módulo que falló al cargar (red) se puede reintentar: import() no
  // cachea los rechazos.
  const traer = (clave) => MODULOS[clave]().then(() => {});

  // Carga por URL para quien la necesite fuera del censo (no la usa nadie del
  // app hoy; se deja por compatibilidad de la API pública).
  function script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("No se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }
  function css(href) {
    return new Promise((resolve) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = () => resolve();
      l.onerror = () => resolve();
      document.head.appendChild(l);
    });
  }

  return {
    script, css,
    // F3: storage y functions compat vienen en el bundle de firebase-init.
    storage() { return Promise.resolve(); },
    functions() { return Promise.resolve(); },
    // Módulos de acción de órdenes. Cada uno garantiza sus dependencias:
    // el check-in de devolución necesita el pad de firma; el informe/cierre
    // de visita y las fotos suben archivos a storage (ya en el bundle).
    // El protocolo de la tablet: ya cargado, no se vuelve a traer.
    firmaTablet() {
      return window.FirmaTablet ? Promise.resolve() : traer("firmaTablet");
    },
    devolucion() {
      return window.OrdenesDevolucion ? Promise.resolve()
        : traer("firmaPad")
            .then(() => this.firmaTablet())
            .then(() => traer("cobros"))
            .then(() => traer("devolucion"));
    },
    visita() {
      return window.abrirInformeVisita ? Promise.resolve() : traer("visita");
    },
    ventaFacturada() {
      return window.VentaFacturada && window.EntityCombo ? Promise.resolve() : traer("ventaFacturada");
    },
    fotos() {
      return window.abrirFotosOrden ? Promise.resolve() : traer("fotos");
    },
    notas() {
      return window.gestionarNotasTecnicas ? Promise.resolve() : traer("notas");
    },
    dividir() {
      return window.abrirDividirOrden ? Promise.resolve() : traer("dividir");
    },
    // La hoja captura la firma de quien recibe y la sube a Storage.
    entregaParcial() {
      return window.abrirEntregaParcial ? Promise.resolve()
        : traer("firmaPad")
            .then(() => this.firmaTablet())
            .then(() => traer("entregaParcial"));
    },
    casosViejos() {
      return window.abrirCasosViejos ? Promise.resolve()
        : Promise.all([traer("bandejaKit"), traer("bandejaCss")])
            .then(() => traer("casosViejos"));
    },
    reemplazo() {
      return window.OrdenesReemplazo ? Promise.resolve()
        : Promise.all([traer("gestiones"), traer("garantia")])
            .then(() => traer("reemplazo"));
    },
    // Solo necesita los expedientes de gestion: no mira garantia (el radio no
    // es del cliente, esta en el mostrador y no salio a ningun lado).
    cambioSerialTaller() {
      return window.OrdenesCambioSerial ? Promise.resolve()
        : traer("gestiones").then(() => traer("cambioSerialTaller"));
    },
  };
})();
