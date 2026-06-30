// firebase-init.js (versión final correcta)

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
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Persistence no habilitada:", err.code || err);
});
const db = firebase.firestore();

  // Apply admin-tunable config from empresa/config to runtime globals.
  // Feature-detected: pages that don't load EmpresaService just skip this.
  // Consumers MUST keep their literal default — this is an override layer,
  // not a hard dependency (see PLAN_ADMIN_PANEL.md §12.1).
  async function _applyEmpresaConfig() {
    if (typeof window.EmpresaService === "undefined") return;
    try {
      const cfg = await window.EmpresaService.getConfig();
      window.EMPRESA_CONFIG = cfg;
      if (window.FMT && typeof cfg.itbms_rate === "number") {
        window.FMT.ITBMS_RATE = cfg.itbms_rate;
      }
    } catch (err) {
      // Defaults already returned by getConfig on error; just log.
      console.warn("[firebase-init] empresa/config not applied:", err?.code || err);
    }
  }

  window.verificarAccesoYAplicarVisibilidad = async function (callback) {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
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

    try {
      const doc = await db.collection("usuarios").doc(user.uid).get();
      const rol = doc.exists ? doc.data().rol : null;

      window.userRole = rol;

      // Best-effort config apply — never blocks the page if it fails.
      await _applyEmpresaConfig();

      if (typeof callback === "function") {
        callback(rol); // Aplica lógica personalizada en cada página
      }
    } catch (error) {
      console.error("❌ Error obteniendo rol:", error);
      firebase.auth().signOut();
      window.location.href = "login.html";
    }
  });
};