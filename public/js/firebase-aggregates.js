// firebase-aggregates.js — conteos server-side con getCountFromServer (2026-09-02).
//
// Por qué existe: el SDK compat (10.10.0) NO trae los agregados — verificado
// byte a byte en el bundle: los dos ".count=" que contiene son internos del
// filtro bloom, y Google nunca llevó count() a compat. Sin agregados, cada
// conteo del home BAJA los documentos enteros (hasta _COUNT_TOPE+1 docs de
// ~8KB) para pintar un número — el grueso del egreso de la factura de agosto.
//
// Este módulo carga el SDK MODULAR de la MISMA versión, solo para contar:
//   · misma config y mismo nombre de app "[DEFAULT]" (los registries del
//     bundle compat y del modular son independientes, no chocan) → la
//     instancia modular de Auth lee la MISMA credencial persistida en
//     IndexedDB (la clave incluye apiKey + nombre de app): cero segundo login.
//   · publica window.FbAgg; senalesService lo usa si está `disponible` y cae
//     al scan de siempre si no (módulo bloqueado, sin sesión, error).
//   · los conteos son solo queries de igualdad/in → índices de un campo con
//     merge, sin índices compuestos nuevos.
//
// El truco "vivas": las órdenes no tienen backfill de `eliminado:false` (los
// docs viejos NO traen el campo y `!=` los excluiría). Se cuenta en dos
// agregados: total(filtros) − eliminadas(filtros + eliminado==true). Dos
// lecturas facturadas en vez de ~50 documentos.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFirestore, collection, query, where, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

// La config vive en firebase-init.js (compat). Se espera a que ese script
// inicialice y se toma de firebase.app().options — una sola fuente de verdad.
function esperarConfigCompat(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const desde = Date.now();
    const t = setInterval(() => {
      try {
        if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
          clearInterval(t);
          resolve(window.firebase.app().options);
          return;
        }
      } catch (e) { /* seguir esperando */ }
      if (Date.now() - desde > timeoutMs) { clearInterval(t); resolve(null); }
    }, 50);
  });
}

window.FbAgg = { disponible: false, count: null };

const cfg = await esperarConfigCompat();
if (cfg) {
  try {
    const app  = initializeApp(cfg); // registry modular propio: "[DEFAULT]" libre
    const auth = getAuth(app);
    const db   = getFirestore(app);

    // spec.wheres = [[campo, op, valor], ...] — solo igualdad/in/<=/>= simples.
    window.FbAgg.count = async function (col, wheres) {
      const clauses = (wheres || []).map(([f, op, v]) => where(f, op, v));
      const snap = await getCountFromServer(query(collection(db, col), ...clauses));
      return snap.data().count;
    };

    // Los agregados pasan por rules: solo sirven con sesión restaurada.
    onAuthStateChanged(auth, (user) => { window.FbAgg.disponible = !!user; });
  } catch (e) {
    console.warn("[FbAgg] agregados no disponibles, los conteos usan scan:", e);
  }
} else {
  console.warn("[FbAgg] firebase compat no inicializó a tiempo — conteos por scan");
}
