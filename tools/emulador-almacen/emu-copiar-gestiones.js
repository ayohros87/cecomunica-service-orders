// Copia la colección `gestiones` de producción (solo lectura) al emulador ya
// sembrado, para probar la pestaña Gestiones del archivo con el estado de hoy.
//   (desde functions/) NODE_PATH=./node_modules node ../tools/emulador-almacen/emu-copiar-gestiones.js
const admin = require("firebase-admin");
// OJO: el cliente lee FIRESTORE_EMULATOR_HOST al primer firestore(); la
// lectura de producción tiene que terminar ANTES de encenderlo.
delete process.env.FIRESTORE_EMULATOR_HOST;
const prod = admin.initializeApp({ projectId: "cecomunica-service-orders" }, "prod");
(async () => {
  const snap = await prod.firestore().collection("gestiones").get();
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  const emu = admin.initializeApp({ projectId: "cecomunica-service-orders" }, "emu");
  const b = emu.firestore().batch();
  snap.docs.forEach(d => b.set(emu.firestore().collection("gestiones").doc(d.id), d.data()));
  await b.commit();
  console.log(`${snap.size} gestiones copiadas al emulador`);
})();
