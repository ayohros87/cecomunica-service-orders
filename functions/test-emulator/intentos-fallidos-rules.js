// Reglas de intentos_fallidos (2026-10-05, caso GOLY): cada quien registra los
// suyos tal como los escribe public/js/ui/intento.js; solo admin lee; nadie
// edita ni borra.
//
// Corre con:
//   firebase emulators:exec --only firestore --project demo-intentos \
//     "node functions/test-emulator/intentos-fallidos-rules.js"
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, addDoc, serverTimestamp } = require("firebase/firestore");

const reg = (uid, extra = {}) => ({
  uid, email: `${uid}@test`, accion: "crearAumento", etiqueta: "Aumento de equipos",
  resultado: "frenado", mensajes: ["Cada línea necesita su precio mensual"], error: null,
  pagina: "/clientes/centro.html", cliente_id: "goly", cliente_nombre: "COMPAÑÍA GOLY, S.A",
  fecha: "2026-10-05", at: serverTimestamp(), ...extra,
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-intentos",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ["administrador", "vendedor", "recepcion"]) await setDoc(doc(db, `usuarios/${r}`), { rol: r, email: `${r}@test` });
    await setDoc(doc(db, "intentos_fallidos/viejo"), { ...reg("vendedor"), at: new Date() });
  });
  const as = (u) => testEnv.authenticatedContext(u).firestore();
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

  await assertSucceeds(addDoc(collection(as("vendedor"), "intentos_fallidos"), reg("vendedor")));
  ok("el vendedor registra su intento frenado");
  await assertSucceeds(addDoc(collection(as("recepcion"), "intentos_fallidos"),
    reg("recepcion", { resultado: "error", error: "permission-denied: x" })));
  ok("recepción registra un error");
  await assertFails(addDoc(collection(as("vendedor"), "intentos_fallidos"), reg("recepcion")));
  ok("nadie registra a nombre de otro");
  await assertFails(addDoc(collection(testEnv.unauthenticatedContext().firestore(), "intentos_fallidos"), reg("vendedor")));
  ok("sin sesión no se registra");
  await assertFails(addDoc(collection(as("vendedor"), "intentos_fallidos"), reg("vendedor", { extra: 1 })));
  ok("campos fuera de la lista no pasan");
  await assertFails(addDoc(collection(as("vendedor"), "intentos_fallidos"), reg("vendedor", { resultado: "otro" })));
  ok("resultado solo frenado|error");
  await assertFails(addDoc(collection(as("vendedor"), "intentos_fallidos"), reg("vendedor", { at: new Date(0) })));
  ok("la hora la pone el servidor");
  await assertFails(getDoc(doc(as("vendedor"), "intentos_fallidos/viejo")));
  ok("el vendedor no lee el registro");
  await assertSucceeds(getDoc(doc(as("administrador"), "intentos_fallidos/viejo")));
  ok("admin lee");
  await assertFails(updateDoc(doc(as("administrador"), "intentos_fallidos/viejo"), { mensajes: [] }));
  await assertFails(deleteDoc(doc(as("administrador"), "intentos_fallidos/viejo")));
  ok("nadie edita ni borra, ni admin");

  await testEnv.cleanup();
  console.log(`\n${n} comprobaciones OK`);
}
main().catch((e) => { console.error(e); process.exit(1); });
