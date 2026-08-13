// firebase-init.js — init del SDK + caché de sesión (rol/nombre/config)

if (!firebase.apps.length) {
  const firebaseConfig = {
        apiKey: "AIzaSyDN1ErV5svRGPtx5tCi_FU_Vei6Dl-J_ng",
        authDomain: "cecomunica-service-orders.firebaseapp.com",
        projectId: "cecomunica-service-orders",
        messagingSenderId: "615730883223",
        appId: "1:615730883223:web:8cf1941241657bd08ad7d2",
        storageBucket: "cecomunica-service-orders.firebasestorage.app"
      };

  firebase.initializeApp(firebaseConfig);

  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
}
// enablePersistence is deprecated in SDK 10.x but not removed — the replacement
// (persistentLocalCache) is only available via the modular SDK, not the compat CDN build.
// Revisit when migrating off the compat SDK.
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(async (err) => {
  console.warn("Persistence no habilitada:", err.code || err);
  // Auto-reparación: si el IndexedDB quedó escrito por un SDK más nuevo que el
  // actual, la persistencia queda deshabilitada para siempre (todas las lecturas
  // van a la red). Se limpia el caché una única vez por pestaña y se recarga;
  // al volver, enablePersistence crea el caché con el formato de este SDK.
  const esDowngrade = err.code === "failed-precondition" && /newer version/i.test(err.message || "");
  if (esDowngrade && !sessionStorage.getItem("fsCacheReset")) {
    sessionStorage.setItem("fsCacheReset", "1");
    try {
      await firebase.firestore().terminate();
      await firebase.firestore().clearPersistence();
      location.reload();
    } catch (e) {
      // p.ej. otra pestaña abierta impide clearPersistence — se sigue con
      // caché en memoria y se reintentará en la próxima sesión.
      console.warn("No se pudo limpiar el caché de Firestore:", e?.code || e);
    }
  }
});
const db = firebase.firestore();

/* =============================================================
   Sesion — caché de sesión del perfil (rol + nombre) por uid.

   Problema que resuelve: cada página releía usuarios/{uid} de
   Firestore (2-4 veces por carga, entre firebase-init, initRail y
   el guard de cada página) ANTES de pintar nada. Con esto:
   - single-flight: UNA lectura de usuarios/{uid} por carga de
     página, compartida entre todos los consumidores;
   - sessionStorage (TTL 30 min): en navegaciones siguientes el rol
     se entrega SIN red y la página pinta de inmediato;
   - revalidación en background: si el rol real difiere del
     cacheado, la página se recarga UNA vez (guard anti-loop).

   El rol cacheado es solo UI: firestore.rules sigue siendo el piso
   real de autorización (ver js/core/modulos.js). "Ver como" (?as=)
   no pasa por aquí — se cachea siempre el rol REAL y MODULOS.
   rolEfectivo() se aplica aguas abajo en cada página.
   ============================================================= */
window.Sesion = (() => {
  const KEY = (uid) => "ccSesion:v1:" + uid;
  const TTL_MS = 30 * 60 * 1000; // pasado esto se vuelve al camino frío (red)
  let _perfilPromise = null;     // single-flight por carga de página

  // Lectura sync del caché; null si no hay, está corrupto o expiró.
  function cache(uid) {
    try {
      const raw = sessionStorage.getItem(KEY(uid));
      if (!raw) return null;
      const d = JSON.parse(raw);
      return (Date.now() - (d.t || 0) > TTL_MS) ? null : d;
    } catch { return null; }
  }

  // Única lectura Firestore de usuarios/{uid} por carga, compartida.
  function perfil(uid) {
    if (!_perfilPromise) {
      _perfilPromise = db.collection("usuarios").doc(uid).get()
        .then((doc) => {
          const d = doc.exists ? doc.data() : {};
          const p = { uid, rol: d.rol || null, nombre: d.nombre || d.name || "" };
          try {
            sessionStorage.setItem(KEY(uid), JSON.stringify({ ...p, t: Date.now() }));
            // Compat: el nombre también se publica en la clave histórica que
            // leen el home inline y páginas aún no migradas a Sesion.
            if (p.nombre) sessionStorage.setItem("ccUserName:" + uid, p.nombre);
          } catch { /* storage lleno/bloqueado: se sigue sin caché */ }
          return p;
        });
      // Un fallo (offline) no debe envenenar la single-flight: permitir reintento.
      _perfilPromise.catch(() => { _perfilPromise = null; });
    }
    return _perfilPromise;
  }

  // Rol con caché: entrega inmediata si hay caché (y revalida en background);
  // red solo en el camino frío.
  async function rol(uid) {
    const c = cache(uid);
    if (c && c.rol) { _revalidar(uid, c.rol); return c.rol; }
    return (await perfil(uid)).rol;
  }

  // Nombre para saludo/rail. Nunca lanza.
  async function nombre(user) {
    const c = cache(user.uid);
    if (c && c.nombre) return c.nombre;
    try {
      const p = await perfil(user.uid);
      if (p.nombre) return p.nombre;
    } catch { /* offline: cae al fallback */ }
    return user.displayName || (user.email || "").split("@")[0];
  }

  // Si el rol real difiere del entregado, recarga UNA vez por sesión para
  // que la página re-arranque con el rol nuevo. Nunca re-invoca callbacks.
  async function _revalidar(uid, rolEntregado) {
    try {
      const p = await perfil(uid);
      const k = "ccSesionReload:" + uid;
      if (p.rol !== rolEntregado) {
        if (!sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, "1");
          location.reload();
        }
      } else {
        sessionStorage.removeItem(k);
      }
    } catch { /* red intermitente: manda el rol cacheado; rules es el piso */ }
  }

  // Logout / sesión expirada: no heredar rol ni nombre al siguiente usuario.
  function limpiar() {
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("ccSesion") || k.startsWith("ccUserName:"))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch { /* sin storage: nada que limpiar */ }
  }

  return { cache, perfil, rol, nombre, limpiar };
})();

  // Apply admin-tunable config from empresa/config to runtime globals.
  // Feature-detected: pages that don't load EmpresaService just skip this.
  // Consumers MUST keep their literal default — this is an override layer,
  // not a hard dependency (see PLAN_ADMIN_PANEL.md §12.1).
  // Cacheada en sessionStorage (TTL 30 min): el camino caliente la aplica
  // sync y revalida en background, igual que el rol.
  const _CFG_KEY = "ccSesionCfg:v1";
  const _CFG_TTL_MS = 30 * 60 * 1000;

  function _aplicarCfg(cfg) {
    window.EMPRESA_CONFIG = cfg;
    if (window.FMT && typeof cfg.itbms_rate === "number") {
      window.FMT.ITBMS_RATE = cfg.itbms_rate;
    }
  }

  async function _leerYCachearCfg() {
    const cfg = await window.EmpresaService.getConfig();
    try { sessionStorage.setItem(_CFG_KEY, JSON.stringify({ d: cfg, t: Date.now() })); } catch { /* sin storage */ }
    _aplicarCfg(cfg);
  }

  async function _applyEmpresaConfig() {
    if (typeof window.EmpresaService === "undefined") return;
    try {
      const raw = sessionStorage.getItem(_CFG_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.d && Date.now() - (c.t || 0) <= _CFG_TTL_MS) {
          _aplicarCfg(c.d);                       // aplicada sync desde caché
          _leerYCachearCfg().catch(() => {});     // refresco en background
          return;
        }
      }
    } catch { /* caché corrupto: sigue al camino frío */ }
    try {
      await _leerYCachearCfg();
    } catch (err) {
      // Defaults already returned by getConfig on error; just log.
      console.warn("[firebase-init] empresa/config not applied:", err?.code || err);
    }
  }

  /* CONTRATO: el callback se invoca EXACTAMENTE UNA VEZ por carga de página
     (los callbacks de las páginas NO son idempotentes). Camino caliente: rol
     desde sessionStorage → pinta ya; la revalidación corre en background y si
     el rol cambió RECARGA la página una vez (nunca re-invoca el callback). */
  window.verificarAccesoYAplicarVisibilidad = async function (callback) {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      Sesion.limpiar();
      // Preserva el destino (deep-link) para volver tras el login. Ruta
      // absoluta porque esta función la usan páginas en subcarpetas
      // (/contratos/…, /admin/…), donde "login.html" relativo no resuelve.
      const onLogin = /\/login\.html$/.test(window.location.pathname);
      if (onLogin) {
        window.location.href = "/login.html";
      } else {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login.html?next=" + encodeURIComponent(next);
      }
      return;
    }

    let entregado = false;
    const entregar = (rol) => {
      if (entregado) return;
      entregado = true;
      window.userRole = rol;
      if (typeof callback === "function") {
        callback(rol); // Aplica lógica personalizada en cada página
      }
    };

    // Camino caliente: rol cacheado → la página pinta sin esperar Firestore.
    const c = Sesion.cache(user.uid);
    if (c && c.rol) {
      entregar(c.rol);
      Sesion.rol(user.uid);      // dispara la revalidación en background
      _applyEmpresaConfig();     // best-effort (sync desde caché si existe)
      return;
    }

    // Camino frío (primer arranque de la sesión): comportamiento original —
    // rol y config de empresa en paralelo, un solo round-trip a Firestore.
    try {
      const [p] = await Promise.all([
        Sesion.perfil(user.uid),
        _applyEmpresaConfig(),
      ]);
      entregar(p.rol);
    } catch (error) {
      console.error("❌ Error obteniendo rol:", error);
      firebase.auth().signOut();
      window.location.href = "login.html";
    }
  });
};
