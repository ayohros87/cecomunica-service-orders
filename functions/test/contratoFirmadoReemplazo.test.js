// Subir el contrato equivocado tiene que ser corregible.
//
// Reporte de ventas (17-ago-2026, TEMP20260817-01): "Por error subí el contrato
// sin firmar. Ahora el sistema no me permite eliminar el archivo incorrecto".
// Subir el firmado ACTIVA el contrato ('aprobado' → 'activo') y todos los gates
// pedían 'aprobado', así que "Reemplazar firmado" no se podía renderizar nunca:
// el único camino era tocar Firestore a mano.
//
// Lo que fija este test:
//   · aprobado → sube y ACTIVA (estado + fecha_activacion en el mismo write);
//   · activo   → repunta el archivo SIN tocar estado ni fecha_activacion, y
//     archiva el anterior en firmado_historial[] (el PDF viejo no se borra:
//     storage.rules niega delete en contratos_firmados/);
//   · el resto de estados sigue cerrado.
//
// Corre con `npm test` (node --test). Sin navegador ni red: el módulo se evalúa
// en un vm con window/document/firebase de mentira.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(
  path.join(RAIZ, "public", "js", "pages", "contratos-upload.js"), "utf8");

const PDF = { name: "contrato-firmado.pdf", type: "application/pdf" };

/** Monta ContratosFirmado con dobles de todo lo global que toca. */
function montar(contrato) {
  const reg = {
    toasts: [], confirms: [], update: null, subidas: [],
    clicks: 0, recargas: 0, confirmar: true,
  };

  const input = {
    value: "x",
    _onChange: null,
    files: [],
    addEventListener(_e, cb) { this._onChange = cb; },
    click() { reg.clicks++; },
  };

  const sandbox = {
    console,
    location: { reload() { reg.recargas++; } },
    document: {
      _onReady: null,
      addEventListener(_e, cb) { this._onReady = cb; },
      getElementById(id) {
        if (id === "fileFirmado") return input;
        if (id === "uploadStatus") return { style: {} };
        if (id === "uploadPct") return { textContent: "" };
        return null;
      },
    },
    ROLES: { ADMIN: "administrador", VENDEDOR: "vendedor" },
    AUTH: { is: () => true },
    Toast: { show: (msg, tipo) => reg.toasts.push({ msg, tipo }) },
    Modal: {
      confirm: async (opts) => { reg.confirms.push(opts); return reg.confirmar; },
    },
    FMT: { esc: (v) => String(v ?? "") },
    ContratosService: {
      getContrato: async () => ({ ...contrato }),
      updateContrato: async (id, fields) => { reg.update = { id, fields }; },
    },
    firebase: {
      auth: () => ({ currentUser: { uid: "uid-vendedor" } }),
      firestore: {
        Timestamp: { now: () => "TS" },
        FieldValue: { arrayUnion: (v) => ({ __arrayUnion: v }) },
      },
      storage: () => ({
        ref: (p) => ({
          put(file) {
            reg.subidas.push({ path: p, file });
            const task = {
              snapshot: { ref: { getDownloadURL: async () => "https://x/nuevo.pdf" } },
              async on(_evt, _prog, _err, done) { await done(); },
            };
            return task;
          },
        }),
      }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.document._onReady();   // registra el listener del input

  return {
    reg, input, sandbox,
    /** Simula el ciclo completo: clic en el CTA + elección de archivo. */
    async subirArchivo(file = PDF) {
      await sandbox.ContratosFirmado.subir("doc1");
      if (!reg.clicks) return;            // el guard cortó antes del selector
      input.files = [file];
      await input._onChange({ target: input });
    },
  };
}

const APROBADO = { id: "doc1", contrato_id: "TEMP20260817-01", estado: "aprobado" };
const ACTIVO_FIRMADO = {
  id: "doc1", contrato_id: "TEMP20260817-01", estado: "activo",
  firmado: true, firmado_url: "https://x/sin-firmar.pdf",
  firmado_nombre: "sin-firmar.pdf", firmado_storage_path: "contratos_firmados/a_1.pdf",
  firmado_fecha: "TS_VIEJO", firmado_por_uid: "uid-otro",
};

test("A1 · contrato APROBADO: subir el firmado lo activa", async () => {
  const h = montar(APROBADO);
  await h.subirArchivo();

  const f = h.reg.update.fields;
  assert.equal(f.estado, "activo", "subir el firmado es el acto que activa");
  assert.equal(f.fecha_activacion, "TS");
  assert.equal(f.estado_previo, "aprobado");
  assert.equal(f.firmado_url, "https://x/nuevo.pdf");
  assert.ok(!("firmado_historial" in f), "la primera subida no archiva nada");
  assert.equal(h.reg.confirms.length, 0, "la subida inicial no pide confirmación");
});

test("A2 · contrato ACTIVO: el archivo se reemplaza sin tocar la activación", async () => {
  const h = montar(ACTIVO_FIRMADO);
  await h.subirArchivo();

  const f = h.reg.update.fields;
  assert.equal(f.firmado_url, "https://x/nuevo.pdf");
  assert.equal(f.firmado_nombre, PDF.name);
  // Lo que rompía el registro: pisar estado/fecha_activacion en la corrección.
  assert.ok(!("estado" in f), "un reemplazo no re-activa el contrato");
  assert.ok(!("fecha_activacion" in f), "la fecha de activación original se conserva");
  assert.ok(!("estado_previo" in f), "estado_previo quedaría en 'activo' (basura)");

  const archivado = f.firmado_historial.__arrayUnion;
  assert.equal(archivado.firmado_url, "https://x/sin-firmar.pdf");
  assert.equal(archivado.firmado_storage_path, "contratos_firmados/a_1.pdf");
  assert.equal(archivado.reemplazado_por_uid, "uid-vendedor");
  assert.equal(archivado.reemplazado_at, "TS", "sin fecha, la auditoría no lo lista");
});

test("A3 · reemplazar sobre contrato vivo se confirma y dice que se archiva", async () => {
  const h = montar(ACTIVO_FIRMADO);
  await h.subirArchivo();

  assert.equal(h.reg.confirms.length, 1, "sustituir el papel de un contrato vivo se confirma");
  assert.match(h.reg.confirms[0].message, /no se borra/i,
    "el mensaje no puede prometer un borrado que storage.rules impide");
});

test("A4 · cancelar la confirmación no abre el selector ni escribe", async () => {
  const h = montar(ACTIVO_FIRMADO);
  h.reg.confirmar = false;
  await h.subirArchivo();

  assert.equal(h.reg.clicks, 0);
  assert.equal(h.reg.update, null);
});

test("A5 · los demás estados siguen cerrados", async () => {
  for (const estado of ["pendiente_aprobacion", "anulado", "borrador"]) {
    const h = montar({ ...APROBADO, estado });
    await h.subirArchivo();
    assert.equal(h.reg.clicks, 0, `${estado} no debe abrir el selector`);
    assert.equal(h.reg.update, null, `${estado} no debe escribir`);
    assert.match(h.reg.toasts.at(-1).msg, /APROBADOS o ACTIVOS/);
  }
});

test("A6 · solo PDF: storage.rules rechaza cualquier otro contentType", async () => {
  const h = montar(APROBADO);
  await h.subirArchivo({ name: "foto.jpg", type: "image/jpeg" });

  assert.equal(h.reg.subidas.length, 0, "no se sube algo que las reglas van a rechazar");
  assert.equal(h.reg.update, null);
  assert.match(h.reg.toasts.at(-1).msg, /PDF/);
});

test("A7 · la validación de estado corre ANTES de abrir el selector", () => {
  const guard = SRC.indexOf("Solo se puede subir el firmado");
  const click = SRC.indexOf("fileEl.click()");
  assert.ok(guard > 0 && click > guard,
    "abrir el diálogo antes de validar deja elegir archivo mientras el guard resuelve");
});
