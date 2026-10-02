// Backfill de `searchTokens` en clientes (auditoría de módulos 2026-09-30, R1).
//
// Desde el 2026-10-02 ClientesService.buildSearchTokens agrega los PREFIJOS
// del RUC (con y sin letras) para que un RUC a medias o copiado con guiones
// encuentre la ficha. Las fichas existentes traen los tokens viejos: este
// script los recalcula con la MISMA función del app (carga el archivo del
// servicio en Node) y escribe solo los que cambian.
//
// Uso (siempre primero en el emulador):
//   cd functions
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../tools/clientes-backfill-search-tokens.js
//   … --aplicar     escribe (sin la bandera solo cuenta e imprime una muestra)
//
// Contra producción lo corre Alberto con GOOGLE_APPLICATION_CREDENTIALS y
// --aplicar, con el conteo del emulador a la vista. No toca ningún otro campo
// (ni updated_at: no es una edición de negocio y el historial no la registra).
"use strict";
const path = require("node:path");
const admin = require("firebase-admin");

const APLICAR = process.argv.includes("--aplicar");
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("Sin FIRESTORE_EMULATOR_HOST ni GOOGLE_APPLICATION_CREDENTIALS: no corro a ciegas.");
  process.exit(2);
}

// El servicio del navegador, tal cual: publica window.ClientesService y solo
// toca `firebase` dentro de los métodos que no usamos aquí.
global.window = global;
global.firebase = { firestore: { FieldValue: { serverTimestamp: () => null } } };
require(path.join(__dirname, "..", "public", "js", "services", "clientesService.js"));
const CS = global.window.ClientesService;

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "cecomunica-service-orders" });
const db = admin.firestore();

const mismos = (a, b) => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
};

(async () => {
  const snap = await db.collection("clientes").get();
  let vivos = 0, cambian = 0, escritos = 0, tokensAntes = 0, tokensDespues = 0;
  const muestra = [];
  let batch = db.batch(), enBatch = 0;
  for (const d of snap.docs) {
    const c = d.data();
    if (c.deleted === true) continue;
    vivos++;
    const antes = Array.isArray(c.searchTokens) ? c.searchTokens : [];
    const despues = CS.buildSearchTokens(c);
    tokensAntes += antes.length; tokensDespues += despues.length;
    if (mismos(antes, despues)) continue;
    cambian++;
    if (muestra.length < 5) muestra.push({ id: d.id, nombre: c.nombre, ruc: c.ruc || null, antes: antes.length, despues: despues.length,
      nuevos: despues.filter(t => !antes.includes(t)).slice(0, 8) });
    if (!APLICAR) continue;
    batch.update(d.ref, { searchTokens: despues });
    if (++enBatch >= 400) { await batch.commit(); escritos += enBatch; batch = db.batch(); enBatch = 0; }
  }
  if (APLICAR && enBatch) { await batch.commit(); escritos += enBatch; }
  console.log(JSON.stringify({
    modo: APLICAR ? "APLICADO" : "solo conteo",
    clientes_vivos: vivos, cambian, escritos,
    tokens_promedio_antes: vivos ? +(tokensAntes / vivos).toFixed(1) : 0,
    tokens_promedio_despues: vivos ? +(tokensDespues / vivos).toFixed(1) : 0,
    muestra,
  }, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
