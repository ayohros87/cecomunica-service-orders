// Reglas del enlace para que el CLIENTE suba los documentos de su expediente
// (2026-11-25): Firestore (documentos_solicitudes) y Storage
// (clientes_docs_entrada).
//
// Corre con:
//   firebase emulators:exec --only firestore,storage --project demo-docs-rules \
//     "node functions/test-emulator/documentos-cliente-rules.js"
//
// Congela:
//   1) el enlace lo crea el personal que trata con el cliente (vendedor,
//      recepción/Cobros, gerencia, admin), a su nombre, pendiente y con
//      vencimiento a no más de 31 días — nadie más, y nunca "ya recibido";
//   2) NADA es público en Firestore: sin sesión no se lee ni se escribe la
//      solicitud (la página del cliente pasa por la callable);
//   3) el personal solo puede retirarlo o anotar a quién lo envió; `recibidos`
//      y `completada` son de la callable;
//   4) Storage: sin sesión se puede CREAR en la carpeta de entrada un PDF o
//      JPEG de menos de 10 MB con el nombre que fija la página, y nada más:
//      ni leer, ni pisar, ni borrar, ni otro tipo, ni otra carpeta.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, Timestamp } = require("firebase/firestore");
const { ref, uploadBytes, getBytes, deleteObject } = require("firebase/storage");

const dias = (n) => Timestamp.fromMillis(Date.now() + n * 864e5);
const solicitud = (uid, extra = {}) => ({
  cliente_id: "cli-1", cliente_nombre: "ACME, S.A.", pide: ["cedula"], estado: "pendiente",
  creado_por_uid: uid, creado_por_email: `${uid}@test`, creado_at: serverTimestamp(), vence_at: dias(30), ...extra,
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-docs-rules",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
    storage: { rules: fs.readFileSync(path.join(__dirname, "../../storage.rules"), "utf8"), host: "127.0.0.1", port: 9199 },
  });
  const ROLES = ["administrador", "gerente", "vendedor", "recepcion", "tecnico", "inventario", "contabilidad"];
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const r of ROLES) await setDoc(doc(db, `usuarios/${r}`), { rol: r, email: `${r}@test` });
    await setDoc(doc(db, "documentos_solicitudes/viva"), { ...solicitud("vendedor"), creado_at: new Date() });
    await setDoc(doc(db, "documentos_solicitudes/viva2"), { ...solicitud("vendedor"), creado_at: new Date() });
    await setDoc(doc(db, "documentos_solicitudes/hecha"), { ...solicitud("vendedor"), creado_at: new Date(), estado: "completada" });
  });
  const as = (rol) => testEnv.authenticatedContext(rol).firestore();
  const anon = testEnv.unauthenticatedContext();
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };
  const col = (db) => collection(db, "documentos_solicitudes");

  // ── 1) Crear ──
  for (const r of ["administrador", "gerente", "vendedor", "recepcion"]) {
    await assertSucceeds(addDoc(col(as(r)), solicitud(r)));
  }
  ok("admin, gerencia, vendedor y recepción (Cobros) crean el enlace");
  for (const r of ["tecnico", "inventario", "contabilidad"]) {
    await assertFails(addDoc(col(as(r)), solicitud(r)));
  }
  ok("taller, bodega y contabilidad no");
  await assertFails(addDoc(col(as("vendedor")), solicitud("administrador")));
  ok("no se crea a nombre de otro");
  await assertFails(addDoc(col(as("vendedor")), solicitud("vendedor", { estado: "completada" })));
  await assertFails(addDoc(col(as("vendedor")), solicitud("vendedor", { recibidos: { cedula: { n: 1 } } })));
  ok("nace pendiente y sin nada recibido");
  await assertFails(addDoc(col(as("vendedor")), solicitud("vendedor", { vence_at: dias(90) })));
  await assertFails(addDoc(col(as("vendedor")), solicitud("vendedor", { vence_at: "2099-01-01" })));
  ok("el vencimiento no pasa de 31 días");
  await assertFails(addDoc(col(as("vendedor")), solicitud("vendedor", { creado_at: new Date(Date.now() - 40 * 864e5) })));
  ok("creado_at es la hora del servidor (no se puede antedatar)");
  await assertFails(addDoc(col(as("vendedor")), solicitud("vendedor", { cliente_id: null })));
  ok("sin cliente no hay enlace");

  // ── 2) Nada público ──
  await assertFails(getDoc(doc(anon.firestore(), "documentos_solicitudes/viva")));
  await assertFails(addDoc(col(anon.firestore()), solicitud("x")));
  await assertFails(updateDoc(doc(anon.firestore(), "documentos_solicitudes/viva"), { estado: "cancelado" }));
  ok("sin sesión: ni leer, ni crear, ni cancelar");
  await assertSucceeds(getDoc(doc(as("tecnico"), "documentos_solicitudes/viva")));
  ok("el personal con sesión la lee");

  // ── 3) Lo que el personal puede cambiar ──
  await assertFails(updateDoc(doc(as("vendedor"), "documentos_solicitudes/viva"), { recibidos: { cedula: { n: 1 } } }));
  await assertFails(updateDoc(doc(as("vendedor"), "documentos_solicitudes/viva"), { estado: "completada" }));
  await assertFails(updateDoc(doc(as("vendedor"), "documentos_solicitudes/viva"), { cliente_id: "cli-2" }));
  await assertFails(updateDoc(doc(as("vendedor"), "documentos_solicitudes/viva"), { vence_at: dias(300) }));
  await assertFails(updateDoc(doc(as("vendedor"), "documentos_solicitudes/viva"), { pide: ["cedula", "direccion"] }));
  ok("no se marca recibido/completada, ni se cambia de cliente, de fecha o de lo pedido");
  await assertSucceeds(updateDoc(doc(as("vendedor"), "documentos_solicitudes/viva"), { enviado_a: "cliente@x.com", enviado_at: serverTimestamp() }));
  ok("anotar a quién se envió");
  await assertFails(updateDoc(doc(as("tecnico"), "documentos_solicitudes/viva"), { estado: "cancelado", cancelado_por_uid: "tecnico", cancelado_at: serverTimestamp() }));
  ok("el taller no retira enlaces");
  await assertSucceeds(updateDoc(doc(as("recepcion"), "documentos_solicitudes/viva"), { estado: "cancelado", cancelado_por_uid: "recepcion", cancelado_at: serverTimestamp() }));
  ok("Cobros retira el enlace");
  await assertFails(updateDoc(doc(as("administrador"), "documentos_solicitudes/viva"), { estado: "pendiente" }));
  await assertFails(updateDoc(doc(as("administrador"), "documentos_solicitudes/hecha"), { estado: "cancelado" }));
  await assertFails(updateDoc(doc(as("administrador"), "documentos_solicitudes/hecha"), { enviado_a: "x@x.com" }));
  ok("un enlace retirado o completado no se revive ni se toca");
  await assertFails(deleteDoc(doc(as("administrador"), "documentos_solicitudes/viva2")));
  ok("no se borra: es el rastro");

  // ── 4) Storage: la carpeta de entrada ──
  const st = anon.storage();
  const jpg = { contentType: "image/jpeg" }, pdf = { contentType: "application/pdf" };
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const M = Date.now();
  await assertSucceeds(uploadBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-0.jpg`), bytes, jpg));
  await assertSucceeds(uploadBytes(ref(st, `clientes_docs_entrada/sol1/constitucion-${M}-1.pdf`), bytes, pdf));
  await assertSucceeds(uploadBytes(ref(st, `clientes_docs_entrada/sol1/direccion-${M}-2.jpg`), bytes, jpg));
  ok("sin sesión se crea el JPEG o el PDF con el nombre que fija la página");
  await assertFails(getBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-0.jpg`)));
  await assertFails(getBytes(ref(testEnv.authenticatedContext("administrador").storage(), `clientes_docs_entrada/sol1/cedula-${M}-0.jpg`)));
  ok("nadie lee la carpeta de entrada, ni el admin");
  // "Un nombre ya usado no se pisa" (allow update: if false) NO se puede probar
  // aquí: el emulador de Storage valida toda subida como `create`, exista o no
  // el objeto (firebase-tools, emulator/storage/files.js); producción sí la
  // evalúa como `update`. Nada depende de eso: la página nombra cada archivo
  // con marca de tiempo y la callable saca de la carpeta lo que registra.
  await assertFails(deleteObject(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-0.jpg`)));
  ok("ni se borra desde el navegador");
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-3.jpg`), bytes, { contentType: "text/html" }));
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-4.jpg`), bytes, { contentType: "image/svg+xml" }));
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-5.jpg`), bytes, { contentType: "image/png" }));
  ok("solo image/jpeg y application/pdf (ni HTML, ni SVG, ni PNG)");
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/virus.exe`), bytes, pdf));
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/poder-${M}-0.pdf`), bytes, pdf));
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-0.jpg.html`), bytes, jpg));
  ok("solo el nombre {requisito}-{marca}-{n}.pdf|jpg");
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/sub/cedula-${M}-6.jpg`), bytes, jpg));
  ok("sin subcarpetas");
  await assertFails(uploadBytes(ref(st, `clientes_docs_entrada/sol1/cedula-${M}-7.jpg`), new Uint8Array(10 * 1024 * 1024 + 1), jpg));
  ok("10 MB o más no entra");
  // El expediente sigue cerrado a quien no tiene sesión.
  await assertFails(uploadBytes(ref(st, `clientes_documentos/cli-1/x.pdf`), bytes, pdf));
  await assertFails(getBytes(ref(st, `clientes_documentos/cli-1/x.pdf`)));
  ok("sin sesión no se escribe ni se lee el expediente (clientes_documentos)");

  await testEnv.cleanup();
  console.log(`\n${n} comprobaciones OK`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
