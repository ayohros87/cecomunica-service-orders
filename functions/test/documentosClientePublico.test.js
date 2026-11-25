// documentosClientePublico (2026-11-25): el cliente sube los documentos de su
// expediente desde un enlace, sin sesión. Se prueba el handler con un
// Firestore y un bucket falsos: qué enlaces sirven, qué archivos entran, que
// nada del expediente sale por aquí y que a Cobros se le avisa una vez.
const { test } = require("node:test");
const assert = require("node:assert/strict");

// lib/admin.js pide la app por defecto al cargarse: se crea una de mentira (el
// handler recibe db, bucket y admin por parámetro; esta nunca se conecta).
require("firebase-admin").initializeApp({ projectId: "demo-documentos-cliente" });
const { _interno } = require("../src/callable/documentosClientePublico");
const { handler, evaluarPortador, listaPedidos, pathValido, firmaDeArchivo, limpiarInput } = _interno;

const AHORA = new Date("2026-11-25T15:00:00Z");
const ts = (d) => ({ toDate: () => d, toMillis: () => d.getTime() });
const dias = (n) => new Date(AHORA.getTime() + n * 864e5);

// ── Firestore falso: colecciones planas por ruta ──
function fakeDb(seed = {}) {
  const data = new Map(Object.entries(seed).map(([k, v]) => [k, { ...v }]));
  let auto = 0;
  const docRef = (ruta) => ({
    id: ruta.split("/").pop(),
    path: ruta,
    async get() { const v = data.get(ruta); return { exists: !!v, id: ruta.split("/").pop(), data: () => (v ? { ...v } : undefined) }; },
    async set(v) { data.set(ruta, { ...v }); },
    async update(v) { if (!data.has(ruta)) throw new Error("no existe " + ruta); data.set(ruta, { ...data.get(ruta), ...v }); },
    collection: (sub) => colRef(`${ruta}/${sub}`),
  });
  const colRef = (ruta) => ({
    doc: (id) => docRef(`${ruta}/${id || "auto" + (++auto)}`),
    async add(v) { const r = docRef(`${ruta}/auto${++auto}`); await r.set(v); return r; },
    async get() {
      const docs = [...data.entries()]
        .filter(([k]) => k.startsWith(ruta + "/") && !k.slice(ruta.length + 1).includes("/"))
        .map(([k, v]) => ({ id: k.split("/").pop(), data: () => ({ ...v }) }));
      return { docs, size: docs.length };
    },
  });
  return { collection: colRef, _data: data };
}

// ── Bucket falso ──
const PDF = Buffer.from("%PDF-1.7 contenido");
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
function fakeBucket(archivos = {}) {
  const files = new Map(Object.entries(archivos));
  const movidos = [];
  const borrados = [];
  return {
    _files: files, movidos, borrados,
    file: (name) => ({
      name,
      async getMetadata() {
        const f = files.get(name);
        if (!f) throw new Error("No such object: " + name);
        return [{ contentType: f.contentType, size: String(f.size ?? f.bytes.length) }];
      },
      async download({ start, end }) { return [files.get(name).bytes.subarray(start, end + 1)]; },
      async move(dest) { files.set(dest, files.get(name)); files.delete(name); movidos.push([name, dest]); },
      async delete() { files.delete(name); borrados.push(name); },
    }),
    async getFiles({ prefix }) {
      return [[...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => this.file(k))];
    },
  };
}

const fakeAdmin = {
  firestore: Object.assign(() => ({}), {
    Timestamp: { now: () => ts(AHORA) },
    FieldValue: { serverTimestamp: () => "__ahora__" },
  }),
};

const SOL = (extra = {}) => ({
  cliente_id: "cli-1", cliente_nombre: "ACME, S.A.", pide: [], estado: "pendiente",
  creado_por_uid: "u-vend", creado_por_email: "vendedora@cecomunica.com",
  creado_at: ts(dias(-2)), vence_at: ts(dias(28)), ...extra,
});
const CLIENTE = { nombre: "ACME, S.A.", vendedor_asignado: "u-vend", deleted: false };
const BASE = () => ({
  "documentos_solicitudes/sol1": SOL(),
  "clientes/cli-1": { ...CLIENTE },
  "usuarios/u-vend": { email: "vendedora@cecomunica.com", rol: "vendedor" },
});
const entrada = (pid, nombre) => `clientes_docs_entrada/${pid}/${nombre}`;
const M = "1795618800000"; // 13 dígitos

function correr(data, { db, bucket } = {}) {
  return handler({ data }, {
    db, bucket: bucket || fakeBucket(), admin: fakeAdmin,
    expedienteEmailTo: async () => "cobros@cecomunica.com, zuleika.diaz@cecomunica.com",
  });
}
const docsDe = (db, cid = "cli-1") => [...db._data.entries()]
  .filter(([k]) => k.startsWith(`clientes/${cid}/documentos/`)).map(([, v]) => v);
const correos = (db) => [...db._data.entries()].filter(([k]) => k.startsWith("mail_queue/")).map(([, v]) => v);

// ── Entrada ──
test("input: un enlace trae UN portador y solo ids limpios", () => {
  assert.throws(() => limpiarInput({ accion: "ver" }), /Enlace inválido/);
  assert.throws(() => limpiarInput({ accion: "ver", s: "a", f: "b" }), /Enlace inválido/);
  assert.throws(() => limpiarInput({ accion: "ver", s: "../otro" }), /Enlace inválido/);
  assert.throws(() => limpiarInput({ accion: "borrar", s: "abc" }), /Acción inválida/);
  assert.deepEqual(limpiarInput({ accion: "ver", s: " abc123 " }), { accion: "ver", s: "abc123", f: null });
});

test("input: registrar exige el nombre de quien entrega y al menos un archivo", () => {
  assert.throws(() => limpiarInput({ accion: "registrar", s: "abc", archivos: [{}] }), /nombre completo/);
  assert.throws(() => limpiarInput({ accion: "registrar", s: "abc", nombre: "Ana Pérez", archivos: [] }), /No hay archivos/);
  assert.throws(() => limpiarInput({ accion: "registrar", s: "abc", nombre: "Ana Pérez", archivos: new Array(13).fill({}) }), /Demasiados/);
});

// ── Qué enlaces sirven ──
test("portador: la solicitud pendiente y sin vencer sirve; cancelada, vencida o completada no", () => {
  assert.equal(evaluarPortador("solicitud", SOL(), AHORA).status, "ok");
  assert.equal(evaluarPortador("solicitud", SOL({ estado: "cancelado" }), AHORA).status, "no_disponible");
  assert.equal(evaluarPortador("solicitud", SOL({ estado: "completada" }), AHORA).status, "completo");
  assert.equal(evaluarPortador("solicitud", SOL({ vence_at: ts(dias(-1)) }), AHORA).status, "vencido");
  assert.equal(evaluarPortador("solicitud", null, AHORA).status, "no_disponible");
  assert.equal(evaluarPortador("solicitud", SOL({ cliente_id: "" }), AHORA).status, "no_disponible");
});

test("portador: un vence_at inflado no pasa del tope de 31 días desde que se creó", () => {
  const trampa = SOL({ creado_at: ts(dias(-40)), vence_at: ts(dias(300)) });
  assert.equal(evaluarPortador("solicitud", trampa, AHORA).status, "vencido");
});

test("portador: el enlace de firma sirve 60 días; cancelado o caducado no", () => {
  const f = (extra) => ({ cliente_id: "cli-1", estado: "activado", created_at: ts(dias(-10)), ...extra });
  assert.equal(evaluarPortador("firma", f(), AHORA).status, "ok");
  assert.equal(evaluarPortador("firma", f({ estado: "pendiente" }), AHORA).status, "ok");
  assert.equal(evaluarPortador("firma", f({ estado: "cancelado" }), AHORA).status, "no_disponible");
  assert.equal(evaluarPortador("firma", f({ estado: "caducado" }), AHORA).status, "no_disponible");
  assert.equal(evaluarPortador("firma", f({ created_at: ts(dias(-61)) }), AHORA).status, "vencido");
  assert.equal(evaluarPortador("firma", f({ created_at: null }), AHORA).status, "no_disponible");
});

// ── Qué se pide ──
test("pedidos: sin marcar nada se pide lo que falta; lo ya recibido por el enlace sigue a la vista", () => {
  const docs = [{ tipo: "registro_publico", deleted: false }];
  const p = listaPedidos({ marcados: [], recibidos: {} }, docs);
  assert.deepEqual(p.map((x) => [x.id, x.estado]), [["cedula", "pedir"], ["direccion", "pedir"]]);
  const docs2 = [...docs, { tipo: "cedula_representante", deleted: false, revision: { estado: "pendiente" } }];
  const p2 = listaPedidos({ marcados: [], recibidos: { cedula: { n: 1 } } }, docs2);
  assert.deepEqual(p2.map((x) => [x.id, x.estado]), [["cedula", "recibido"], ["direccion", "pedir"]]);
});

test("pedidos: lo que el personal marcó se pide aunque ya haya uno en el expediente", () => {
  const docs = [{ tipo: "cedula_representante", deleted: false }];
  const p = listaPedidos({ marcados: ["cedula"], recibidos: {} }, docs);
  assert.deepEqual(p.map((x) => [x.id, x.estado]), [["cedula", "pedir"]]);
});

test("pedidos: el requisito de constitución ofrece los dos tipos", () => {
  const p = listaPedidos({ marcados: [], recibidos: {} }, []);
  assert.deepEqual(p[0].tipos.map((t) => t.value), ["aviso_operacion", "registro_publico"]);
});

// ── Validación de archivos ──
test("ruta: solo la carpeta del propio enlace y el nombre que fija la página", () => {
  assert.equal(pathValido(entrada("sol1", `cedula-${M}-0.jpg`), "sol1", "cedula"), true);
  assert.equal(pathValido(entrada("otro", `cedula-${M}-0.jpg`), "sol1", "cedula"), false);
  assert.equal(pathValido(entrada("sol1", `direccion-${M}-0.jpg`), "sol1", "cedula"), false);
  assert.equal(pathValido(`clientes_documentos/cli-2/x.pdf`, "sol1", "cedula"), false);
  assert.equal(pathValido(entrada("sol1", `cedula-${M}-0.exe`), "sol1", "cedula"), false);
  assert.equal(pathValido(entrada("sol1", `cedula-${M}-0.jpg/../../x`), "sol1", "cedula"), false);
});

test("firma del archivo: PDF y JPEG por sus primeros bytes", () => {
  assert.equal(firmaDeArchivo(PDF), "pdf");
  assert.equal(firmaDeArchivo(JPG), "jpg");
  assert.equal(firmaDeArchivo(Buffer.from("<html>hola</html>")), null);
  assert.equal(firmaDeArchivo(Buffer.from("MZ")), null);
});

// ── ver ──
test("ver: devuelve el nombre del cliente y lo que se pide — nada del expediente", async () => {
  const db = fakeDb({ ...BASE(), "clientes/cli-1/documentos/d0": { tipo: "registro_publico", deleted: false, nombre_archivo: "secreto.pdf", storage_path: "clientes_documentos/cli-1/d0.pdf" } });
  const r = await correr({ accion: "ver", s: "sol1" }, { db });
  assert.equal(r.status, "ok");
  assert.equal(r.cliente, "ACME, S.A.");
  assert.deepEqual(r.pide.map((p) => p.id), ["cedula", "direccion"]);
  assert.doesNotMatch(JSON.stringify(r), /secreto|storage_path|clientes_documentos/);
});

test("ver: enlace inexistente, cancelado o de un cliente eliminado no dice por qué", async () => {
  assert.deepEqual(await correr({ accion: "ver", s: "nada" }, { db: fakeDb(BASE()) }), { status: "no_disponible" });
  const cancelada = fakeDb({ ...BASE(), "documentos_solicitudes/sol1": SOL({ estado: "cancelado" }) });
  assert.deepEqual(await correr({ accion: "ver", s: "sol1" }, { db: cancelada }), { status: "no_disponible" });
  const sinCliente = fakeDb({ ...BASE(), "clientes/cli-1": { ...CLIENTE, deleted: true } });
  assert.deepEqual(await correr({ accion: "ver", s: "sol1" }, { db: sinCliente }), { status: "no_disponible" });
});

test("ver por el enlace de firma: si no falta nada, 'completo' (la página de firma no muestra el aviso)", async () => {
  const db = fakeDb({
    "firma_solicitudes/f1": { cliente_id: "cli-1", estado: "activado", created_at: ts(dias(-1)) },
    "clientes/cli-1": { ...CLIENTE },
    "clientes/cli-1/documentos/a": { tipo: "aviso_operacion", deleted: false },
    "clientes/cli-1/documentos/b": { tipo: "cedula_representante", deleted: false },
    "clientes/cli-1/documentos/c": { tipo: "comprobante_direccion", deleted: false },
  });
  assert.equal((await correr({ accion: "ver", f: "f1" }, { db })).status, "completo");
});

// ── registrar ──
test("registrar: el archivo se mueve al expediente, queda 'por revisar' y se avisa a Cobros una vez", async () => {
  const db = fakeDb(BASE());
  const bucket = fakeBucket({
    [entrada("sol1", `cedula-${M}-0.jpg`)]: { contentType: "image/jpeg", bytes: JPG },
    [entrada("sol1", `constitucion-${M}-1.pdf`)]: { contentType: "application/pdf", bytes: PDF },
  });
  const r = await correr({
    accion: "registrar", s: "sol1", nombre: "  Ana   Pérez ",
    archivos: [
      { requisito: "cedula", tipo: "cedula_representante", path: entrada("sol1", `cedula-${M}-0.jpg`), nombre: "IMG_001.jpg" },
      { requisito: "constitucion", tipo: "registro_publico", path: entrada("sol1", `constitucion-${M}-1.pdf`), nombre: "registro.pdf" },
    ],
  }, { db, bucket });

  assert.equal(r.registrados, 2);
  assert.deepEqual(r.rechazados, []);
  assert.equal(r.status, "ok", "todavía falta el recibo");
  assert.deepEqual(r.pide.map((p) => [p.id, p.estado]), [["constitucion", "recibido"], ["cedula", "recibido"], ["direccion", "pedir"]]);

  const docs = docsDe(db);
  assert.equal(docs.length, 2);
  for (const d of docs) {
    assert.deepEqual(d.revision, { estado: "pendiente" });
    assert.equal(d.subido_por, null);
    assert.equal(d.deleted, false);
    assert.deepEqual(d.origen, { cliente: true, solicitud: "sol1", nombre: "Ana Pérez" });
    assert.match(d.storage_path, /^clientes_documentos\/cli-1\/[\w-]+\.(jpg|pdf)$/);
  }
  assert.deepEqual(docs.map((d) => d.tipo).sort(), ["cedula_representante", "registro_publico"]);
  // La carpeta de entrada queda vacía y los archivos viven en el expediente.
  assert.deepEqual([...bucket._files.keys()].filter((k) => k.startsWith("clientes_docs_entrada/")), []);
  assert.equal(bucket.movidos.length, 2);

  const sol = db._data.get("documentos_solicitudes/sol1");
  assert.equal(sol.estado, "pendiente");
  assert.deepEqual(Object.keys(sol.recibidos).sort(), ["cedula", "constitucion"]);
  assert.equal(sol.ultimo_recibido_por, "Ana Pérez");

  const mails = correos(db);
  assert.equal(mails.length, 1, "un correo por envío, no uno por archivo");
  assert.equal(mails[0].to, "cobros@cecomunica.com, zuleika.diaz@cecomunica.com");
  assert.equal(mails[0].cc, "vendedora@cecomunica.com", "quien pidió el enlace y la vendedora asignada, sin repetir");
  assert.match(mails[0].subject, /Documentos recibidos — ACME, S\.A\./);
  assert.match(mails[0].bodyContent, /Ana Pérez/);
  assert.match(mails[0].bodyContent, /Todavía falta: <b>Recibo de servicio<\/b>/);
  assert.match(mails[0].ctaUrl, /clientes\/centro\.html\?id=cli-1&docs=1$/);
  assert.equal(mails[0].meta.tipo, "expediente_documentos_recibidos");
});

test("registrar: con todo lo pedido recibido, la solicitud se completa y el enlace deja de pedir", async () => {
  const db = fakeDb({ ...BASE(), "documentos_solicitudes/sol1": SOL({ pide: ["direccion"] }) });
  const bucket = fakeBucket({ [entrada("sol1", `direccion-${M}-0.pdf`)]: { contentType: "application/pdf", bytes: PDF } });
  const r = await correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [{ requisito: "direccion", tipo: "comprobante_direccion", path: entrada("sol1", `direccion-${M}-0.pdf`), nombre: "luz.pdf" }],
  }, { db, bucket });
  assert.equal(r.status, "completo");
  assert.equal(db._data.get("documentos_solicitudes/sol1").estado, "completada");
  assert.deepEqual(await correr({ accion: "ver", s: "sol1" }, { db }), { status: "completo" });
});

test("registrar: un archivo que no es lo que dice ser se borra y no entra al expediente", async () => {
  const db = fakeDb(BASE());
  const html = Buffer.from("<script>alert(1)</script>");
  const bucket = fakeBucket({ [entrada("sol1", `cedula-${M}-0.jpg`)]: { contentType: "image/jpeg", bytes: html } });
  const r = await correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [{ requisito: "cedula", tipo: "cedula_representante", path: entrada("sol1", `cedula-${M}-0.jpg`), nombre: "x.jpg" }],
  }, { db, bucket });
  assert.equal(r.registrados, 0);
  assert.deepEqual(r.rechazados, [{ path: entrada("sol1", `cedula-${M}-0.jpg`), motivo: "formato" }]);
  assert.equal(docsDe(db).length, 0);
  assert.equal(bucket._files.size, 0);
  assert.equal(correos(db).length, 0, "sin nada registrado no se avisa a nadie");
});

test("registrar: no acepta rutas de otro enlace ni del expediente de otro cliente", async () => {
  const db = fakeDb(BASE());
  const ajeno = "clientes_documentos/cli-2/secreto.pdf";
  const bucket = fakeBucket({
    [ajeno]: { contentType: "application/pdf", bytes: PDF },
    [entrada("sol9", `cedula-${M}-0.jpg`)]: { contentType: "image/jpeg", bytes: JPG },
  });
  const r = await correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [
      { requisito: "cedula", tipo: "cedula_representante", path: ajeno, nombre: "a" },
      { requisito: "cedula", tipo: "cedula_representante", path: entrada("sol9", `cedula-${M}-0.jpg`), nombre: "b" },
    ],
  }, { db, bucket });
  assert.equal(r.registrados, 0);
  assert.deepEqual(r.rechazados.map((x) => x.motivo), ["ruta", "ruta"]);
  assert.equal(bucket._files.has(ajeno), true, "el archivo ajeno no se toca");
  assert.equal(bucket._files.has(entrada("sol9", `cedula-${M}-0.jpg`)), true);
  assert.equal(bucket.movidos.length, 0);
});

test("registrar: un tipo que no es del requisito cae al primero del requisito", async () => {
  const db = fakeDb(BASE());
  const bucket = fakeBucket({ [entrada("sol1", `constitucion-${M}-0.pdf`)]: { contentType: "application/pdf", bytes: PDF } });
  await correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [{ requisito: "constitucion", tipo: "poder", path: entrada("sol1", `constitucion-${M}-0.pdf`), nombre: "" }],
  }, { db, bucket });
  const [d] = docsDe(db);
  assert.equal(d.tipo, "aviso_operacion");
  assert.equal(d.nombre_archivo, "Aviso de Operación.pdf", "sin nombre de archivo se usa la etiqueta");
});

test("registrar: lo que no se pidió no entra (requisito fuera de la solicitud)", async () => {
  const db = fakeDb({ ...BASE(), "documentos_solicitudes/sol1": SOL({ pide: ["direccion"] }) });
  const bucket = fakeBucket({ [entrada("sol1", `cedula-${M}-0.jpg`)]: { contentType: "image/jpeg", bytes: JPG } });
  const r = await correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [{ requisito: "cedula", tipo: "cedula_representante", path: entrada("sol1", `cedula-${M}-0.jpg`), nombre: "c.jpg" }],
  }, { db, bucket });
  assert.equal(r.registrados, 0);
  assert.deepEqual(r.rechazados.map((x) => x.motivo), ["no_pedido"]);
  assert.equal(bucket._files.size, 0, "la carpeta de entrada se limpia igual");
});

test("registrar: enlace vencido o retirado no registra nada ni toca Storage", async () => {
  const db = fakeDb({ ...BASE(), "documentos_solicitudes/sol1": SOL({ estado: "cancelado" }) });
  const bucket = fakeBucket({ [entrada("sol1", `cedula-${M}-0.jpg`)]: { contentType: "image/jpeg", bytes: JPG } });
  const r = await correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [{ requisito: "cedula", tipo: "cedula_representante", path: entrada("sol1", `cedula-${M}-0.jpg`), nombre: "c.jpg" }],
  }, { db, bucket });
  assert.deepEqual(r, { status: "no_disponible" });
  assert.equal(docsDe(db).length, 0);
  assert.equal(bucket.movidos.length, 0);
});

test("registrar: un enlace no puede dejar más de 30 archivos en un expediente", async () => {
  const seed = BASE();
  for (let i = 0; i < 30; i++) seed[`clientes/cli-1/documentos/p${i}`] = { tipo: "otro", deleted: true, origen: { cliente: true, solicitud: "sol1" } };
  const db = fakeDb(seed);
  await assert.rejects(() => correr({
    accion: "registrar", s: "sol1", nombre: "Ana Pérez",
    archivos: [{ requisito: "cedula", tipo: "cedula_representante", path: entrada("sol1", `cedula-${M}-0.jpg`), nombre: "c.jpg" }],
  }, { db }), /demasiados archivos/);
});

test("registrar por el enlace de firma: entra con origen firma_solicitud y no toca la solicitud de firma", async () => {
  const firma = { cliente_id: "cli-1", estado: "activado", created_at: ts(dias(-1)), firma: { nombre: "Rep" } };
  const db = fakeDb({ "firma_solicitudes/f1": firma, "clientes/cli-1": { ...CLIENTE }, "usuarios/u-vend": { email: "vendedora@cecomunica.com" } });
  const bucket = fakeBucket({ [entrada("f1", `direccion-${M}-0.jpg`)]: { contentType: "image/jpeg", bytes: JPG } });
  const r = await correr({
    accion: "registrar", f: "f1", nombre: "Rep Legal",
    archivos: [{ requisito: "direccion", tipo: "comprobante_direccion", path: entrada("f1", `direccion-${M}-0.jpg`), nombre: "recibo.jpg" }],
  }, { db, bucket });
  assert.equal(r.registrados, 1);
  const [d] = docsDe(db);
  assert.deepEqual(d.origen, { cliente: true, firma_solicitud: "f1", nombre: "Rep Legal" });
  assert.deepEqual(db._data.get("firma_solicitudes/f1"), firma, "la solicitud de firma no se escribe: su trigger no debe dispararse");
  const [mail] = correos(db);
  assert.match(mail.bodyContent, /enlace de firma de su contrato/);
  assert.equal(mail.cc, "vendedora@cecomunica.com");
});
