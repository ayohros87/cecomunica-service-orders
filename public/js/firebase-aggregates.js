// firebase-aggregates.js — conteos server-side con getCountFromServer (2026-09-02).
//
// Por qué existe: el SDK compat NO trae los agregados (Google nunca llevó
// count() a compat). Sin agregados, cada conteo del home BAJA los documentos
// enteros (hasta _COUNT_TOPE+1 docs de ~8KB) para pintar un número — el
// grueso del egreso de la factura de agosto.
//
// F3 (docs/plans/PLAN_MIGRACION_MODULAR.md): antes cargaba por URL un segundo
// SDK modular desde gstatic con su propio registry. Ahora usa los handles
// modulares de firebase-init (misma app, misma sesión): cero segundo login,
// cero copia extra del SDK. Lo importa el entry de cada página que lo usa.
//   · publica window.FbAgg; senalesService lo usa si está `disponible` y cae
//     al scan de siempre si no (sin sesión, error).
//   · los conteos son solo queries de igualdad/in → índices de un campo con
//     merge, sin índices compuestos nuevos.
//
// El truco "vivas": las órdenes no tienen backfill de `eliminado:false` (los
// docs viejos NO traen el campo y `!=` los excluiría). Se cuenta en dos
// agregados: total(filtros) − eliminadas(filtros + eliminado==true). Dos
// lecturas facturadas en vez de ~50 documentos.

import { auth, dbModular as db } from "/js/firebase-init.js";
import { onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getCountFromServer } from "firebase/firestore";

window.FbAgg = { disponible: false, count: null };

try {
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
