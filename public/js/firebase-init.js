// firebase-init.js — init del SDK (npm: compat + modular) + caché de sesión (rol/nombre/config)
//
// F3 (docs/plans/PLAN_MIGRACION_MODULAR.md): el SDK ya no viene de gstatic por
// <script>; lo empaqueta Vite desde `firebase` (package.json). Se cargan las
// DOS caras del mismo SDK, que comparten app, auth y Firestore:
//   · compat → window.firebase, para los 134 archivos que usan firebase.*
//   · modular → exports de este módulo y window.CecoFirebase, para código
//     nuevo (política §8 del plan: archivo nuevo nace modular).
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import "firebase/compat/functions";
import "firebase/compat/storage";
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

// Puente: el namespace compat como global, igual que lo dejaba el <script> de gstatic.
window.firebase = firebase;

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

  // Caché persistente multi-pestaña, con la API modular pero aplicada a la
  // instancia de compat (settings() antes del primer uso). Reemplaza al
  // enablePersistence({synchronizeTabs:true}) deprecado: con
  // persistentMultipleTabManager todas las pestañas comparten la caché y
  // cualquiera puede hablar con el servidor (antes solo la "primaria", y una
  // pestaña secundaria abierta por deep-link servía datos viejos).
  // OJO: getFirestore(app) modular devuelve OTRA instancia (identificador
  // distinto) sin esta caché — por eso el handle modular de abajo es el
  // delegado de compat, no getFirestore(). Probado 2026-09-25 con Chrome:
  // IndexedDB firestore/[DEFAULT]/… creado, dos pestañas sin advertencias.
  try {
    firebase.firestore().settings({
      merge: true, // sin esto compat avisa "overriding the original host"
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn("[firebase-init] caché persistente no disponible:", err?.code || err);
  }

  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
}
const db = firebase.firestore();

// Vigía de la caché local. El día que cambia la versión del SDK, IndexedDB
// tiene que migrar de esquema, y esa migración queda BLOQUEADA mientras otra
// pestaña del app (con la versión anterior) tenga la base abierta: Firestore
// encola todo y la página se queda "cargando" sin decir nada (reproducido
// 2026-09-28 con SDK 10 → 12). Una lectura solo-caché no cuesta red ni rules;
// si no responde en 4 s, se avisa qué hacer; cuando responde, se quita.
(function vigiaCacheLocal() {
  let aviso = null;
  let listo = false;
  const mostrar = () => {
    if (listo || aviso) return;
    aviso = document.createElement("div");
    aviso.id = "ccAvisoCacheLocal";
    aviso.setAttribute("role", "alert");
    aviso.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#b45309;color:#fff;padding:10px 16px;font:14px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)";
    aviso.textContent = "Hay otra pestaña de la app abierta con una versión anterior. Ciérrala (o cierra el navegador y vuelve a entrar) para continuar.";
    (document.body || document.documentElement).appendChild(aviso);
  };
  const quitar = () => { listo = true; if (aviso) { aviso.remove(); aviso = null; } };
  const t = setTimeout(mostrar, 4000);
  db.collection("__vigia").doc("cache").get({ source: "cache" })
    .then(quitar, quitar)
    .finally(() => clearTimeout(t));
})();

// Handles modulares (misma app, misma sesión, misma caché que compat).
// db._delegate ES la instancia modular (Firestore) que envuelve compat: sirve
// para collection()/getDoc()/getCountFromServer() y comparte caché y conexión.
export const app = getApp();
export const auth = getAuth(app);
export const dbModular = db._delegate || getFirestore(app);
export const fns = getFunctions(app);
export const storage = getStorage(app);
window.CecoFirebase = { app, auth, db: dbModular, fns, storage };

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

  // Perfil PROPIO con la forma que devolvía UsuariosService.getUsuario(uid)
  // ({ id, rol, nombre }) pero desde la caché de sesión: sin red en
  // navegaciones tibias y, en frío, compartiendo la única lectura con el
  // rail. Para páginas que solo gatean por rol (arranque rápido 2026-09-29):
  // antes cada una pagaba un viaje al servidor en serie ANTES de pedir sus
  // datos. Si el doc no existe llega { rol: null }, que los gates tratan
  // igual que el null de antes. Quien necesite más campos (activo, email…)
  // sigue con UsuariosService.getUsuario.
  async function miPerfil(user) {
    const uid = typeof user === "string" ? user : (user && user.uid);
    if (!uid) return null;
    const c = cache(uid);
    if (c && c.rol) {
      _revalidar(uid, c.rol);
      return { id: uid, rol: c.rol, nombre: c.nombre || "" };
    }
    const p = await perfil(uid);
    return { id: uid, rol: p.rol, nombre: p.nombre || "" };
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

  // Sesión cacheada de ESTA pestaña sin conocer el uid todavía (Auth aún no
  // restauró desde IndexedDB). Para el pintado optimista del rail: escanea
  // las claves ccSesion:v1:* — tras limpiar() en logout solo puede haber una
  // válida. Devuelve {uid, rol, nombre} o null (TTL vencido incluido).
  function cacheAnonima() {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("ccSesion:v1:")) {
          const c = cache(k.slice("ccSesion:v1:".length));
          if (c && c.rol) return c;
        }
      }
    } catch { /* sin storage */ }
    return null;
  }

  // Logout / sesión expirada: no heredar rol ni nombre al siguiente usuario.
  function limpiar() {
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("ccSesion") || k.startsWith("ccUserName:"))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch { /* sin storage: nada que limpiar */ }
  }

  return { cache, cacheAnonima, perfil, miPerfil, rol, nombre, limpiar };
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
      // Ruta absoluta (desde /contratos/ o /admin/ el relativo daba 404) y
      // motivo visible en el login en vez de cerrar la sesión en silencio.
      window.location.href = "/login.html?motivo=perfil";
    }
  });
};

// --- Puente window (F1, docs/plans/PLAN_MIGRACION_MODULAR.md) ---
// Estos nombres los usan otros archivos o el HTML (onclick / inline). Hoy son
// globales porque el archivo es un <script> clásico; al empaquetarse como
// módulo ES dejarían de serlo. El puente los publica de forma explícita.
Object.assign(window, {
  db
});
