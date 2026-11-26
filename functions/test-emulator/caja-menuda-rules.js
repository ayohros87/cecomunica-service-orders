// Reglas de caja_menuda (2026-11-26). Lo que protegen, en palabras de Cheila
// (contabilidad): pide cualquier colaborador, aprueba SU jefe, paga quien
// custodia el fondo, y nadie aprueba lo suyo.
//
// Corre con:
//   firebase emulators:exec --only firestore --project demo-caja \
//     "node functions/test-emulator/caja-menuda-rules.js"
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, addDoc, query, where, serverTimestamp } = require("firebase/firestore");

// Usuarios: el técnico reporta a la jefa de taller; el vendedor no tiene jefe
// asignado (aprueba administración); la contadora reporta a un admin.
const USUARIOS = {
  tecnico: { rol: "tecnico", nombre: "Marcos", jefe_uid: "jefa" },
  otroTecnico: { rol: "tecnico", nombre: "Jesús", jefe_uid: "jefa" },
  jefa: { rol: "jefe_taller", nombre: "Solangel", jefe_uid: "admin" },
  vendedor: { rol: "vendedor", nombre: "Karla" },
  conta: { rol: "contabilidad", nombre: "Cheila", jefe_uid: "admin" },
  admin: { rol: "administrador", nombre: "Zuleika" },
  admin2: { rol: "administrador", nombre: "Alberto" },
  recepcion: { rol: "recepcion", nombre: "Brenda", jefe_uid: "admin" },
};

const paso = (uid, accion, extra = {}) => ({ at: new Date(), por_uid: uid, por_nombre: USUARIOS[uid].nombre, accion, ...extra });

const gasto = (uid, extra = {}) => ({
  solicitante_uid: uid, solicitante_nombre: USUARIOS[uid].nombre, solicitante_email: `${uid}@test`,
  aprobador_uid: USUARIOS[uid].jefe_uid || null, aprobador_nombre: USUARIOS[uid].jefe_uid ? USUARIOS[USUARIOS[uid].jefe_uid].nombre : null,
  tipo: "reembolso", via: "efectivo", estado: "solicitado", monto: 12.5, concepto: "Peaje corredor sur",
  categoria: "Peaje", proveedor: "ENA", fecha_gasto: "2026-11-25", factura_numero: "",
  recibos: [{ path: `caja_menuda_recibos/${uid}/1-a.jpg`, tipo: "image/jpeg" }],
  historial: [paso(uid, "solicitado")], created_at: serverTimestamp(), updated_at: serverTimestamp(),
  ...extra,
});

async function main() {
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || "demo-caja",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8"), host: "127.0.0.1", port: 8080 },
  });
  await testEnv.clearFirestore();
  const sembrar = async (id, data) => testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `caja_menuda/${id}`), { ...data, created_at: new Date(), updated_at: new Date() });
  });
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, u] of Object.entries(USUARIOS)) await setDoc(doc(db, `usuarios/${uid}`), { ...u, email: `${uid}@test` });
  });
  const as = (u) => testEnv.authenticatedContext(u).firestore();
  const g = (u, id) => doc(as(u), `caja_menuda/${id}`);
  const hist = async (id) => {
    let h = [];
    await testEnv.withSecurityRulesDisabled(async (ctx) => { h = (await getDoc(doc(ctx.firestore(), `caja_menuda/${id}`))).data().historial; });
    return h;
  };
  // Escritura como la hace el servicio: campos + una entrada más de historial.
  const mover = async (u, id, campos, accion) => updateDoc(g(u, id), { ...campos, historial: [...await hist(id), paso(u, accion)], updated_at: serverTimestamp() });
  let n = 0; const ok = (m) => { n++; console.log("  PASS", m); };

  // ── Crear ────────────────────────────────────────────────────────────
  await assertSucceeds(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico")));
  await assertSucceeds(addDoc(collection(as("vendedor"), "caja_menuda"), gasto("vendedor")));
  await assertSucceeds(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { tipo: "anticipo", recibos: [], monto: 15 })));
  ok("cualquier colaborador pide: con jefe asignado, sin jefe, y un anticipo sin factura");

  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("otroTecnico")));
  ok("nadie pide a nombre de otro");
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { aprobador_uid: "otroTecnico" })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { aprobador_uid: null })));
  await assertFails(addDoc(collection(as("vendedor"), "caja_menuda"), gasto("vendedor", { aprobador_uid: "vendedor" })));
  ok("el aprobador no se elige: es el jefe asignado (o nadie, y aprueba administración)");
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { estado: "aprobado" })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { numero: "CM-0001" })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { aprobacion: { por_uid: "jefa" } })));
  ok("nace solicitado, sin número y sin aprobación puesta");
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { monto: 0 })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { monto: "12" })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { monto: 5001 })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { concepto: "x" })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { tipo: "anticipo", via: "ach", recibos: [] })));
  await assertFails(addDoc(collection(as("tecnico"), "caja_menuda"), gasto("tecnico", { created_at: new Date(0) })));
  ok("monto numérico y positivo, concepto escrito, un anticipo nunca va por ACH, la hora la pone el servidor");
  await assertFails(addDoc(collection(testEnv.unauthenticatedContext().firestore(), "caja_menuda"), gasto("tecnico")));
  ok("sin sesión no se pide");

  // ── Leer ─────────────────────────────────────────────────────────────
  await sembrar("r1", gasto("tecnico"));
  await sembrar("v1", gasto("vendedor"));
  await assertSucceeds(getDoc(g("tecnico", "r1")));
  await assertSucceeds(getDoc(g("jefa", "r1")));
  await assertSucceeds(getDoc(g("conta", "r1")));
  await assertSucceeds(getDoc(g("admin", "r1")));
  await assertFails(getDoc(g("otroTecnico", "r1")));
  await assertFails(getDoc(g("recepcion", "r1")));
  await assertFails(getDoc(g("jefa", "v1")));
  ok("lo ve quien lo pidió, su jefe y el custodio; un compañero no, ni un jefe ajeno");
  await assertSucceeds(getDocs(query(collection(as("tecnico"), "caja_menuda"), where("solicitante_uid", "==", "tecnico"))));
  await assertSucceeds(getDocs(query(collection(as("jefa"), "caja_menuda"), where("aprobador_uid", "==", "jefa"), where("estado", "==", "solicitado"))));
  await assertSucceeds(getDocs(query(collection(as("conta"), "caja_menuda"), where("estado", "in", ["aprobado", "rendido"]))));
  await assertFails(getDocs(collection(as("tecnico"), "caja_menuda")));
  await assertFails(getDocs(query(collection(as("tecnico"), "caja_menuda"), where("solicitante_uid", "==", "otroTecnico"))));
  ok("las listas: lo mío, lo que apruebo y todo para el custodio; nadie más lista la colección");

  // ── Quien pidió corrige o anula mientras siga solicitado ─────────────
  await assertSucceeds(mover("tecnico", "r1", { monto: 14, concepto: "Peaje ida y vuelta" }, "editado"));
  await assertFails(mover("tecnico", "r1", { aprobador_uid: "admin" }, "editado"));
  await assertFails(mover("tecnico", "r1", { tipo: "anticipo" }, "editado"));
  await assertFails(mover("tecnico", "r1", { estado: "aprobado", aprobacion: { por_uid: "tecnico" } }, "aprobado"));
  await assertFails(mover("otroTecnico", "r1", { monto: 1 }, "editado"));
  ok("quien pidió corrige el monto; no cambia de jefe, ni de tipo, ni se aprueba solo");
  await assertFails(updateDoc(g("tecnico", "r1"), { monto: 15 }));
  await assertFails(updateDoc(g("tecnico", "r1"), { monto: 15, historial: [paso("tecnico", "borrón")] }));
  await assertFails(updateDoc(g("tecnico", "r1"), { monto: 15, historial: [...await hist("r1"), paso("jefa", "editado")] }));
  ok("el historial crece de a una entrada, firmada por quien escribe, sin tocar lo anterior");
  await sembrar("r2", gasto("tecnico"));
  await assertSucceeds(mover("tecnico", "r2", { estado: "anulado" }, "anulado"));
  await assertFails(mover("tecnico", "r2", { estado: "solicitado" }, "reabierto"));
  ok("quien pidió anula; lo anulado no revive");

  // ── Aprobar ──────────────────────────────────────────────────────────
  const aprob = (u) => ({ estado: "aprobado", aprobacion: { por_uid: u, por_nombre: USUARIOS[u].nombre, at: new Date() } });
  const rech = (u, motivo = "No corresponde a la empresa") => ({ estado: "rechazado", rechazo: { por_uid: u, por_nombre: USUARIOS[u].nombre, at: new Date(), motivo } });
  await assertFails(mover("conta", "r1", aprob("conta"), "aprobado"));
  await assertFails(mover("otroTecnico", "r1", aprob("otroTecnico"), "aprobado"));
  await assertFails(mover("jefa", "r1", { ...aprob("jefa"), monto: 99 }, "aprobado"));
  await assertFails(mover("jefa", "r1", aprob("admin"), "aprobado"));
  ok("no aprueba contabilidad ni un compañero; el jefe no cambia el monto ni firma por otro");
  await assertSucceeds(mover("jefa", "r1", aprob("jefa"), "aprobado"));
  ok("el jefe asignado aprueba");
  await assertFails(mover("tecnico", "r1", { monto: 50 }, "editado"));
  await assertFails(mover("tecnico", "r1", { estado: "anulado" }, "anulado"));
  ok("aprobado ya no se edita ni se anula");

  await assertFails(mover("jefa", "v1", aprob("jefa"), "aprobado"));
  await assertSucceeds(mover("admin", "v1", aprob("admin"), "aprobado"));
  ok("sin jefe asignado aprueba administración (y un jefe ajeno no)");

  await sembrar("r3", gasto("tecnico"));
  await assertFails(mover("jefa", "r3", rech("jefa", ""), "rechazado"));
  await assertSucceeds(mover("jefa", "r3", rech("jefa"), "rechazado"));
  await assertFails(mover("jefa", "r3", aprob("jefa"), "aprobado"));
  ok("el rechazo lleva motivo y es final");

  await sembrar("r4", gasto("tecnico"));
  await assertSucceeds(mover("admin2", "r4", aprob("admin2"), "aprobado"));
  ok("administración suple al jefe");
  await sembrar("a1", gasto("admin"));
  await assertFails(mover("admin", "a1", aprob("admin"), "aprobado"));
  await assertSucceeds(mover("admin2", "a1", aprob("admin2"), "aprobado"));
  ok("nadie aprueba lo suyo, ni administración: lo aprueba el otro administrador");

  // ── Pagar el reembolso ───────────────────────────────────────────────
  const entrega = (u, monto = 14, extra = {}) => ({ entrega: { por_uid: u, por_nombre: USUARIOS[u].nombre, at: new Date(), monto, metodo: "efectivo", ...extra } });
  await sembrar("s1", gasto("tecnico"));
  await assertFails(mover("conta", "s1", { estado: "pagado", ...entrega("conta") }, "pagado"));
  ok("contabilidad no paga lo que el jefe no ha aprobado");
  await assertFails(mover("jefa", "r1", { estado: "pagado", ...entrega("jefa") }, "pagado"));
  await assertFails(mover("tecnico", "r1", { estado: "pagado", ...entrega("tecnico") }, "pagado"));
  await assertFails(mover("conta", "r1", { estado: "entregado", ...entrega("conta") }, "entregado"));
  await assertFails(mover("conta", "r1", { estado: "pagado", ...entrega("conta", 0) }, "pagado"));
  await assertFails(mover("conta", "r1", { estado: "pagado", ...entrega("conta"), monto: 1 }, "pagado"));
  ok("paga solo el custodio, con monto, sin tocar lo pedido; un reembolso no queda 'por rendir'");
  await assertSucceeds(mover("conta", "r1", { estado: "pagado", ...entrega("conta") }, "pagado"));
  await assertFails(mover("conta", "r1", { estado: "aprobado" }, "reabierto"));
  ok("contabilidad paga el reembolso aprobado; pagado es final");
  await assertSucceeds(mover("conta", "r1", { categoria: "Combustible" }, "reclasificado"));
  await assertFails(mover("conta", "r1", { categoria: "Combustible", monto: 1 }, "reclasificado"));
  await assertFails(mover("jefa", "r1", { categoria: "Varios" }, "reclasificado"));
  ok("el custodio reclasifica la categoría de lo cerrado; nada más, y nadie más");
  await assertSucceeds(mover("conta", "r4", rech("conta", "La factura no es fiscal"), "rechazado"));
  ok("el custodio devuelve un aprobado si la factura no sirve");

  // ── Anticipo: entregar, rendir, cerrar ───────────────────────────────
  await sembrar("n1", gasto("tecnico", { tipo: "anticipo", recibos: [], monto: 20, estado: "aprobado" }));
  await assertFails(mover("conta", "n1", { estado: "pagado", ...entrega("conta", 20) }, "pagado"));
  await assertSucceeds(mover("conta", "n1", { estado: "entregado", ...entrega("conta", 20) }, "entregado"));
  ok("el anticipo aprobado se entrega (no se 'paga')");
  const rinde = { estado: "rendido", rendicion: { monto_gastado: 17.25, vuelto: 2.75, at: new Date() }, recibos: [{ path: "caja_menuda_recibos/tecnico/2-b.jpg", tipo: "image/jpeg" }] };
  await assertFails(mover("otroTecnico", "n1", rinde, "rendido"));
  await assertFails(mover("conta", "n1", rinde, "rendido"));
  await assertFails(mover("tecnico", "n1", { ...rinde, recibos: [] }, "rendido"));
  await assertFails(mover("tecnico", "n1", { ...rinde, entrega: { monto: 99 } }, "rendido"));
  await assertSucceeds(mover("tecnico", "n1", rinde, "rendido"));
  ok("rinde quien recibió el anticipo, con factura, sin tocar lo entregado");
  await assertFails(mover("tecnico", "n1", { estado: "cerrado", cierre: { por_uid: "tecnico" } }, "cerrado"));
  await assertSucceeds(mover("conta", "n1", { estado: "entregado", rendicion_devuelta: { por_uid: "conta", at: new Date(), motivo: "Falta la factura del peaje" } }, "rendición devuelta"));
  await assertSucceeds(mover("tecnico", "n1", rinde, "rendido"));
  await assertSucceeds(mover("conta", "n1", { estado: "cerrado", cierre: { por_uid: "conta", por_nombre: "Cheila", at: new Date(), vuelto_recibido: 2.75 } }, "cerrado"));
  await assertFails(mover("conta", "n1", { estado: "rendido" }, "reabierto"));
  ok("el custodio devuelve la rendición o la cierra; cerrado es final");

  // ── Nada se borra; la configuración es de contabilidad ───────────────
  await assertFails(deleteDoc(g("admin", "r1")));
  await assertFails(deleteDoc(g("tecnico", "r2")));
  ok("nadie borra un gasto, ni administración");
  await assertSucceeds(setDoc(doc(as("conta"), "empresa/caja_menuda"), { fondo: 200, tope_recibo: 20 }));
  await assertSucceeds(setDoc(doc(as("admin"), "empresa/caja_menuda"), { fondo: 250, tope_recibo: 20 }));
  await assertFails(setDoc(doc(as("jefa"), "empresa/caja_menuda"), { fondo: 9999 }));
  await assertFails(setDoc(doc(as("conta"), "empresa/config"), { itbms_rate: 0 }));
  await assertSucceeds(getDoc(doc(as("tecnico"), "empresa/caja_menuda")));
  ok("el fondo y el tope los fijan contabilidad y administración; todos los leen");

  await testEnv.cleanup();
  console.log(`\nCAJA MENUDA: ${n} grupos de reglas OK`);
}
main().catch((e) => { console.error("FALLO:", e.message || e); process.exit(1); });
