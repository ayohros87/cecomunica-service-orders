// @ts-nocheck
// POC · Nueva consola de despacho.
//
// Por qué existe (recepción, 26-ago-2026, P.H. PLAZA DEL ESTE): "el cliente
// tiene contempladas 2 consolas además de los 18 radios; al cargar el JSON el
// batch únicamente reconoce los 18". Y así es por diseño: una consola NO es un
// radio — no tiene serial, no tiene modelo, y en el contrato no va como equipo
// sino como CARGO ("Consola" ×2). Por eso nunca aparece en el archivo del
// vendedor ni en contratos/{id}/seriales, y "Jalar seriales" jamás la va a
// traer. El batch, además, pide un Unit ID numérico consecutivo y una línea de
// serial por equipo: para meter dos consolas había que inventarles seriales de
// relleno y después corregir cada ficha a mano.
//
// Esta pantalla las crea como lo que son, respetando la convención de las ~55
// consolas que ya viven en poc_devices:
//   · serial   = "CONSOLA" (cajón de sastre para lo que no es radio)
//   · unit_id  = el que le asigna la plataforma, casi siempre TEXTO (ANATI1,
//                FEMSA1, MACHETAZO C4) — de ahí que unit_id_num sea null
//   · sin modelo (las consolas del POC viven sin modelo; ver el incidente de la
//     consola Site One, que se rompió justamente por asignarle uno)
//   · grupos: los que va a monitorear, normalmente TODOS los del cliente

// ── Estado de la pantalla ──────────────────────────────────────────────────
let _clientesDocs = [];
let _contratos = [];              // contratos vigentes del cliente elegido
let _devicesCliente = [];         // poc_devices del cliente (para unit_id y conteo)
let _catalogoGrupos = [];         // catálogo de grupos del cliente
let _grupos = [];                 // grupos elegidos para ESTA consola
let _guardando = false;

const _normTxt = (s) => String(s ?? "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const el = (id) => document.getElementById(id);

// ── Helpers puros (los cubre functions/test/pocNuevaConsola.test.js) ────────
// El criterio de "qué es una consola" y "cuántas trae el contrato" vive en
// js/domain/consolasContrato.js — compartido con el batch, que avisa allá.
const consolasContratadas = (contrato) => ConsolasContrato.contratadas(contrato);
const consolasCreadas = (devices, contratoDocId = null) => ConsolasContrato.creadas(devices, contratoDocId);

// El Unit ID es la llave real de la consola en la plataforma: no puede chocar
// con otro equipo del mismo cliente (el batch valida lo mismo para los radios).
function unitIdEnUso(unitId, devices) {
  const u = String(unitId ?? "").trim().toUpperCase();
  if (!u) return false;
  return (devices || []).some(d => d.deleted !== true
    && String(d.unit_id ?? "").trim().toUpperCase() === u);
}

// Sugerencia de nombre con la convención de las consolas que ya existen
// ("CONSOLA ANATI", "FEMSA CONSOLA 1"): CONSOLA + cliente, numerada si ya hay.
function nombreSugerido(clienteNombre, yaCreadas = 0) {
  const base = `CONSOLA ${String(clienteNombre ?? "").trim()}`.trim();
  return yaCreadas > 0 ? `${base} ${yaCreadas + 1}` : base;
}

// Todos los grupos del cliente: catálogo + los que de hecho usan sus equipos
// (hay clientes sin catálogo cargado, y grupos vivos que nunca entraron a él).
// Una consola de despacho normalmente los necesita todos.
function gruposDelCliente(catalogo, devices) {
  const vistos = new Map();  // normalizado → etiqueta tal cual se escribió
  const sumar = (g) => {
    const txt = String(g ?? "").trim();
    if (txt && !vistos.has(_normTxt(txt))) vistos.set(_normTxt(txt), txt);
  };
  (catalogo || []).forEach(sumar);
  (devices || []).forEach(d => { if (d.deleted !== true) (d.grupos || []).forEach(sumar); });
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
}

// El documento tal cual se guarda. `ts` entra por parámetro para que el
// constructor sea puro y testeable (en la pantalla es serverTimestamp()).
function construirDocConsola({
  clienteId, clienteNombre, contratoDocId = null, contratoRef = null,
  ip = "", unitId, nombre, grupos = [], notas = "", uid = "", email = "", ts = null,
}) {
  return {
    cliente_id: clienteId,
    cliente_nombre: clienteNombre,
    contrato_doc_id: contratoDocId || null,
    contrato_id: contratoRef || null,
    ip: ip || "",
    serial: ConsolasContrato.SERIAL,
    unit_id: String(unitId ?? "").trim(),
    unit_id_num: PocService.unitIdNum(unitId),
    radio_name: String(nombre ?? "").trim(),
    gps: false,
    // Sin modelo, a propósito: no hay ficha de catálogo para una consola y
    // asignarle una la saca del inventario de radios.
    modelo: "",
    modelo_id: "",
    modelo_label: "",
    grupos: [...grupos],
    notas: String(notas ?? "").trim(),
    activo: true,
    deleted: false,
    creado_por_uid: uid,
    creado_por_email: email,
    created_at: ts,
    updated_at: ts,
  };
}

// ── Carga de catálogos ─────────────────────────────────────────────────────
async function cargarClientes() {
  const { docs } = await ClientesService.listClientes({ limit: 2000 });
  _clientesDocs = docs;
  pintarClientes();
  el("clienteFiltro")?.addEventListener("input", (e) => pintarClientes(e.target.value));
}

function pintarClientes(filtro = "") {
  const select = el("cliente");
  if (!select) return;
  const q = _normTxt(filtro);
  const actual = select.value;
  const lista = q ? _clientesDocs.filter(c => _normTxt(c.nombre).includes(q)) : _clientesDocs;
  select.innerHTML = '<option value="">Seleccione un cliente</option>';
  lista.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nombre;
    opt.dataset.ip = c.ip || "";
    select.appendChild(opt);
  });
  if (actual && lista.some(c => c.id === actual)) select.value = actual;
  else if (q && lista.length === 1) { select.value = lista[0].id; onClienteChange(); }
}

async function cargarIPs() {
  const snap = await EmpresaService.getDoc("IPs");
  const select = el("ip");
  select.innerHTML = '<option value="">Seleccione…</option>';
  ((snap && snap.list) || []).slice().sort().forEach(ip => {
    const opt = document.createElement("option");
    opt.value = ip; opt.textContent = ip;
    select.appendChild(opt);
  });
}

// Cambio de cliente: IP + contratos + equipos + catálogo de grupos, y con eso
// el nombre sugerido y el aviso de cuántas consolas faltan.
async function onClienteChange() {
  const clienteId = el("cliente").value;
  _contratos = []; _devicesCliente = []; _catalogoGrupos = []; _grupos = [];
  el("contrato").innerHTML = '<option value="">Sin vincular a contrato</option>';
  renderGrupos();
  if (!clienteId) { renderAvisoContrato(); return; }

  aplicarIpDelCliente();
  el("cargando").hidden = false;
  try {
    const [contratos, devices, catalogo] = await Promise.all([
      ContratosService.getContratosActivosPorCliente(clienteId),
      PocService.getByCliente({ clienteId, fresh: true }),
      PocService.getCatalogoGrupos(clienteId),
    ]);
    _contratos = contratos || [];
    _devicesCliente = devices || [];
    _catalogoGrupos = Array.isArray(catalogo) ? catalogo : [];
  } catch (e) {
    console.warn("[nueva-consola] no se pudo cargar el cliente:", e);
    Toast.show("No se pudieron cargar los datos del cliente. Revisa la conexión.", "bad");
  } finally {
    el("cargando").hidden = true;
  }

  pintarContratos();
  sugerirNombre();
  renderAvisoContrato();
  renderSugerenciasGrupos();
}

function pintarContratos() {
  const select = el("contrato");
  select.innerHTML = '<option value="">Sin vincular a contrato</option>';
  _contratos.forEach(c => {
    const n = consolasContratadas(c);
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.dataset.ref = c.contrato_id || c.id;
    opt.textContent = `${c.contrato_id || c.id} · ${c.tipo_contrato || ""} · ${c.estado || ""}` +
      (n ? ` — ${n} consola(s)` : "");
    select.appendChild(opt);
  });
  // Si un solo contrato del cliente contempla consolas, se elige solo: es el
  // caso normal y ahorra el paso que más se olvida (vincular al contrato).
  const conConsolas = _contratos.filter(c => consolasContratadas(c) > 0);
  if (conConsolas.length === 1) select.value = conConsolas[0].id;
}

function contratoElegido() {
  return _contratos.find(c => c.id === el("contrato").value) || null;
}

// Aviso de cobertura: cuántas contempla el contrato y cuántas van creadas.
function renderAvisoContrato() {
  const caja = el("avisoContrato");
  if (!caja) return;
  const c = contratoElegido();
  if (!el("cliente").value) { caja.hidden = true; return; }
  if (!c) {
    const total = consolasCreadas(_devicesCliente);
    caja.className = "consola-aviso info";
    caja.innerHTML = `Sin contrato vinculado. Este cliente tiene <b>${total}</b> consola(s) creada(s).` +
      ` Vincúlala al contrato si corresponde — es lo que la conecta con la facturación.`;
    caja.hidden = false;
    return;
  }
  const contempladas = consolasContratadas(c);
  const creadas = consolasCreadas(_devicesCliente, c.id);
  const ref = c.contrato_id || c.id;
  if (!contempladas) {
    caja.className = "consola-aviso warn";
    caja.innerHTML = `⚠ ${ref} no tiene consolas entre sus cargos. Si el cliente sí las tiene, revisa el contrato antes de crearla.`;
  } else if (creadas >= contempladas) {
    caja.className = "consola-aviso warn";
    caja.innerHTML = `⚠ ${ref} contempla <b>${contempladas}</b> consola(s) y ya hay <b>${creadas}</b> creada(s). Verifica que no sea una repetida.`;
  } else {
    caja.className = "consola-aviso ok";
    caja.innerHTML = `${ref} contempla <b>${contempladas}</b> consola(s): <b>${creadas}</b> creada(s), ` +
      `faltan <b>${contempladas - creadas}</b>.`;
  }
  caja.hidden = false;
}

function aplicarIpDelCliente() {
  const ipCliente = (el("cliente").selectedOptions[0]?.dataset.ip || "").trim();
  const select = el("ip");
  if (!ipCliente) { select.value = ""; return; }
  if (![...select.options].some(o => o.value === ipCliente)) {
    const opt = document.createElement("option");
    opt.value = ipCliente; opt.textContent = ipCliente;
    select.appendChild(opt);
  }
  select.value = ipCliente;
}

function sugerirNombre() {
  const input = el("nombre");
  if (!input || input.value.trim()) return;   // no pisa lo que ya escribieron
  const nombreCliente = el("cliente").selectedOptions[0]?.textContent || "";
  input.value = nombreSugerido(nombreCliente, consolasCreadas(_devicesCliente));
}

// ── Grupos ─────────────────────────────────────────────────────────────────
function renderSugerenciasGrupos() {
  const datalist = el("gruposCatalogo");
  const todos = gruposDelCliente(_catalogoGrupos, _devicesCliente);
  datalist.innerHTML = todos.map(g => `<option value="${g.replace(/"/g, "&quot;")}">`).join("");
  const btn = el("btnTodosGrupos");
  btn.hidden = todos.length === 0;
  btn.textContent = `Agregar los ${todos.length} grupos del cliente`;
}

function renderGrupos() {
  const caja = el("grupos");
  if (!caja) return;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  caja.innerHTML = _grupos.length
    ? _grupos.map((g, i) => `<span class="gchip" title="${esc(g)}"><span class="gchip-txt">${esc(g)}</span>` +
        `<button type="button" class="gchip-x" data-i="${i}" aria-label="Quitar ${esc(g)}">×</button></span>`).join("")
    : '<span class="grupos-vacio">— sin grupos —</span>';
  el("gruposCuenta").textContent = _grupos.length ? `${_grupos.length} grupo(s)` : "";
}

function agregarGrupo(texto) {
  const val = String(texto ?? "").trim();
  if (!val) return;
  if (!_grupos.some(g => _normTxt(g) === _normTxt(val))) _grupos.push(val);
  renderGrupos();
}

function agregarTodosLosGrupos() {
  const todos = gruposDelCliente(_catalogoGrupos, _devicesCliente);
  const antes = _grupos.length;
  todos.forEach(g => { if (!_grupos.some(x => _normTxt(x) === _normTxt(g))) _grupos.push(g); });
  renderGrupos();
  Toast.show(`${_grupos.length - antes} grupo(s) agregados.`, "ok");
}

// ── Guardado ───────────────────────────────────────────────────────────────
async function guardarConsola(crearOtra) {
  if (_guardando) return;
  const clienteId = el("cliente").value;
  const clienteNombre = el("cliente").selectedOptions[0]?.textContent || "";
  const unitId = el("unit_id").value.trim();
  const nombre = el("nombre").value.trim();

  if (!clienteId) { Toast.show("Elige el cliente.", "bad"); return; }
  if (!unitId)    { Toast.show("Falta el Unit ID — es el que le asignó la plataforma.", "bad"); return; }
  if (!nombre)    { Toast.show("Ponle un nombre a la consola.", "bad"); return; }
  if (unitIdEnUso(unitId, _devicesCliente)) {
    Toast.show(`El Unit ID ${unitId} ya lo usa otro equipo de este cliente.`, "bad");
    return;
  }
  if (!_grupos.length) {
    const ok = await Modal.confirm({
      message: "La consola se guardará SIN grupos: no va a monitorear a nadie. ¿Guardar así?",
    });
    if (!ok) return;
  }

  const c = contratoElegido();
  _guardando = true;
  const btns = [el("btnGuardar"), el("btnGuardarOtra")];
  btns.forEach(b => { if (b) b.disabled = true; });
  try {
    const user = firebase.auth().currentUser;
    await PocService.addPocDevice(construirDocConsola({
      clienteId, clienteNombre,
      contratoDocId: c ? c.id : null,
      contratoRef: c ? (c.contrato_id || c.id) : null,
      ip: el("ip").value,
      unitId, nombre, grupos: _grupos,
      notas: el("notas").value,
      uid: user?.uid || "", email: user?.email || "",
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    }));
    Toast.show(`Consola ${nombre} creada.`, "ok");
    if (!crearOtra) { window.location.href = "index.html"; return; }
    // "Guardar y crear otra": el caso típico son 2 consolas por contrato. Se
    // recargan los equipos del cliente para que el aviso y el nombre sugerido
    // cuenten la que se acaba de crear.
    el("unit_id").value = "";
    el("nombre").value = "";
    _devicesCliente = await PocService.getByCliente({ clienteId, fresh: true });
    sugerirNombre();
    renderAvisoContrato();
    el("unit_id").focus();
  } catch (e) {
    console.error("[nueva-consola] error creando la consola:", e);
    Toast.show("No se pudo crear la consola. Revisa la conexión e intenta de nuevo.", "bad");
  } finally {
    _guardando = false;
    btns.forEach(b => { if (b) b.disabled = false; });
  }
}

// ── Arranque ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) return void (window.location.href = "/login.html");

    await cargarIPs();
    await cargarClientes();
    renderGrupos();

    el("cliente").addEventListener("change", onClienteChange);
    el("contrato").addEventListener("change", renderAvisoContrato);
    el("btnTodosGrupos").addEventListener("click", agregarTodosLosGrupos);
    el("grupoNuevo").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();                 // Enter dentro del form enviaría
      agregarGrupo(e.target.value);
      e.target.value = "";
    });
    el("btnAgregarGrupo").addEventListener("click", () => {
      agregarGrupo(el("grupoNuevo").value);
      el("grupoNuevo").value = "";
      el("grupoNuevo").focus();
    });
    el("grupos").addEventListener("click", (e) => {
      const btn = e.target.closest(".gchip-x");
      if (!btn) return;
      _grupos.splice(Number(btn.dataset.i), 1);
      renderGrupos();
    });
    el("consolaForm").addEventListener("submit", (e) => { e.preventDefault(); guardarConsola(false); });
    el("btnGuardarOtra").addEventListener("click", () => guardarConsola(true));

    // Precarga desde el batch (?cliente_id=&contrato_doc_id=): se llega aquí
    // desde el aviso "este contrato incluye N consolas".
    const p = new URLSearchParams(window.location.search);
    const cid = p.get("cliente_id");
    if (cid && [...el("cliente").options].some(o => o.value === cid)) {
      el("cliente").value = cid;
      await onClienteChange();
      const contratoDocId = p.get("contrato_doc_id");
      if (contratoDocId && [...el("contrato").options].some(o => o.value === contratoDocId)) {
        el("contrato").value = contratoDocId;
        renderAvisoContrato();
      }
    }
  });
});
