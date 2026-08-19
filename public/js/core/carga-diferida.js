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
    devolucion: "/js/pages/ordenes-devolucion.js?v=dev10",
    visita:     "/js/pages/ordenes-visita.js?v=f1",
    fotos:      "/js/pages/ordenes-fotos.js?v=1",
    notas:      "/js/pages/ordenes-notas.js?v=1",
  };

  return {
    script,
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
        : this.storage().then(() => script(MODULOS.firmaPad)).then(() => script(MODULOS.devolucion));
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
  };
})();
