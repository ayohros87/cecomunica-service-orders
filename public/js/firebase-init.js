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
// Habilita persistencia offline para que los .get({source:'cache'}) funcionen
firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Persistence no habilitada:", err.code || err);
});
const db = firebase.firestore();

  window.verificarAccesoYAplicarVisibilidad = async function (callback) {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    try {
      const doc = await db.collection("usuarios").doc(user.uid).get();
      const rol = doc.exists ? doc.data().rol : null;

      window.userRole = rol;

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