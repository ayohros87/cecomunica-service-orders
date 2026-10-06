// Cierre de la ficha de POC cuando el radio deja de estar con el cliente.
//
// POC es la PLATAFORMA de airtime: mientras el radio está con el cliente tiene
// una ficha viva (`poc_devices`), y cuando el radio vuelve esa ficha tiene que
// cerrarse. Nunca se cerraba: al 2026-09-09 había 1,263 fichas abiertas de
// radios que ya no están con el cliente (770 en bodega, 398 en taller, 77 en
// revisión) y 817 seriales con más de una ficha viva. El costo lo pagaba
// recepción: al cargar un lote nuevo, el batch veía el serial "ya registrado
// con este cliente" y se paraba en seco (Municipio de Arraiján, 2026-09-09 —
// 20 radios de un evento trancados por 3 fichas del evento del año anterior).
//
// REGLAS
//   · Solo se cierran las fichas del MISMO cliente que devuelve. Las de otros
//     clientes se dejan quietas: un serial puede estar repetido entre modelos
//     (serial_compartido) y un cierre en cascada borraría el registro de un
//     radio ajeno. Esas se limpian donde hay un humano mirando (el batch de POC
//     las lista y ofrece cerrarlas).
//   · El SIM del registro viejo vuelve al pool como disponible SOLO si el pool
//     todavía lo tiene en esta misma ficha; si ya se reasignó a otro radio, el
//     pool no se toca y se limpia únicamente la ficha (mismo criterio que
//     SimCardsService.liberarDeEquipo en el navegador). Hoy la invariante
//     "SIM asignado ⇒ ficha viva" se cumple al 100% (338/338) y este cierre la
//     tiene que mantener. Si el pool no lo conoce (SIM tecleado directo en la
//     ficha), se da de alta disponible — salvo que otra ficha viva lo tenga.
//   · Cerrar NO es borrar: la ficha queda con `cierre` (motivo, orden, y la
//     foto del SIM/operador que tenía). La lista de POC la sigue encontrando
//     con "Incluir cerradas", que es como recepción pide la desconexión del
//     airtime después de la devolución (Brenda, 2026-09-16).
//   · Todo queda en `poc_logs` con `origen`, igual que un borrado a mano.
//   · Best-effort para el llamador: devuelve lo que hizo, no tumba el flujo.
const { admin, db: dbReal } = require("./admin");

const normSerial = (s) => (s ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const normNombre = (s) => (s ?? "").toString().trim().toUpperCase();
const soloDigitos = (s) => (s ?? "").toString().replace(/\D/g, "");
// Mismo rango que SimCardsService.esSimValido en el navegador.
const SIM_VALIDO = /^\d{10,22}$/;

// ¿Otra ficha viva tiene este SIM tecleado? Se busca por el texto tal como
// está en la ficha y por solo dígitos (las fichas viejas traen espacios).
async function simEnOtraFichaViva(tx, db, ficha) {
  const formas = [...new Set([(ficha.sim_number || "").toString(), soloDigitos(ficha.sim_number)])].filter(Boolean);
  for (const forma of formas) {
    const snap = await tx.get(db.collection("poc_devices").where("sim_number", "==", forma));
    if (snap.docs.some((d) => d.id !== ficha.id && d.data().deleted !== true)) return true;
  }
  return false;
}

// PURA: de las fichas vivas de ese serial, ¿cuáles cierra esta devolución?
// Las del mismo cliente — por `cliente_id` cuando la ficha lo tiene (legacy no
// siempre), y si no por nombre. Una ficha sin cliente no se toca: no hay con
// qué afirmar que es de este.
function fichasDelCliente(fichas, { clienteId = null, clienteNombre = "" } = {}) {
  const nombre = normNombre(clienteNombre);
  return (fichas || []).filter((f) => {
    if (f.deleted === true) return false;
    if (f.cliente_id) return !!clienteId && f.cliente_id === clienteId;
    const suyo = normNombre(f.cliente_nombre || f.cliente || "");
    return !!nombre && suyo === nombre;
  });
}

// Fichas vivas del serial. Además de la consulta por serial exacto (que es como
// se guardan), se sigue el enlace del pool: si el serial se tecleó distinto
// (guiones, minúsculas) la consulta no lo encuentra y `poc_device_id` sí. Ojo
// que ese enlace puede apuntar a la ficha de OTRO cliente — el filtro de
// arriba es el que decide.
async function buscarFichasVivas({ serial, poolDocId = null }, db = dbReal) {
  const porId = new Map();
  const s = (serial ?? "").toString().trim();
  if (s) {
    const snap = await db.collection("poc_devices").where("serial", "==", s).get();
    snap.forEach((d) => porId.set(d.id, { id: d.id, ...d.data() }));
  }
  if (poolDocId) {
    const unidad = await db.collection("equipos_pool").doc(poolDocId).get();
    const pocId = unidad.exists ? unidad.data().poc_device_id : null;
    if (pocId && !porId.has(pocId)) {
      const ficha = await db.collection("poc_devices").doc(pocId).get();
      if (ficha.exists) porId.set(ficha.id, { id: ficha.id, ...ficha.data() });
    }
  }
  return [...porId.values()].filter((f) => f.deleted !== true);
}

// Cierra UNA ficha: baja lógica + SIM (con el guard del pool) + log.
// Retorna 'cerrada' | 'cerrada-sim-ajeno' | 'cerrada-sin-sim'.
async function cerrarUna(ficha, { motivo, ref, usuario }, db = dbReal) {
  const FV = admin.firestore.FieldValue;
  const devRef = db.collection("poc_devices").doc(ficha.id);
  const sim = soloDigitos(ficha.sim_number);
  const baja = {
    deleted: true,
    // El radio ya no está en servicio con ese cliente: la ficha se cierra Y
    // queda inactiva (si alguien la restaura, no revive "activa").
    activo: false,
    // Foto de lo que la ficha tenía al cerrarse (Brenda, 2026-09-16). El SIM
    // vuelve al pool y los campos vivos se limpian, pero recepción necesita
    // ese dato DESPUÉS del cierre: con el serial, el Unit ID y el SIM se pide
    // la desconexión del airtime. Antes se perdía y había que capturar la
    // pantalla de POC con el cliente esperando en recepción.
    cierre: {
      at: FV.serverTimestamp(),
      motivo,
      ref: ref || null,
      sim_number: ficha.sim_number || "",
      sim_phone: ficha.sim_phone || "",
      operador: ficha.operador || "",
    },
    updated_at: FV.serverTimestamp(),
    updated_by: null,
    updated_by_email: usuario,
  };

  let resultado = "cerrada-sin-sim";
  if (!sim) {
    await devRef.update(baja);
  } else {
    const simRef = db.collection("sim_cards").doc(sim);
    resultado = await db.runTransaction(async (tx) => {
      // Todas las lecturas antes de la primera escritura (regla de Firestore).
      const simSnap = await tx.get(simRef);
      const s = simSnap.exists ? simSnap.data() : null;
      const ajeno = s && s.estado === "asignado" && s.asignado_a
        && s.asignado_a.device_id !== ficha.id;
      // SIM que nunca se registró en el pool (tecleado directo en la ficha: al
      // 2026-10-06, 3,178 fichas vivas). Antes el cierre lo dejaba fuera y
      // recepción tenía que buscarlo a mano para reusarlo (Brenda, GANDER →
      // GOLY). Ahora entra al pool como disponible, igual que
      // SimCardsService.liberarDeEquipo en el navegador — salvo que otra ficha
      // viva ya lo tenga tecleado: el SIM está en otro radio y ofrecerlo como
      // libre sería mentir.
      const enOtra = !simSnap.exists && await simEnOtraFichaViva(tx, db, ficha);

      tx.update(devRef, { ...baja, sim_number: "", sim_phone: "", operador: "" });
      if (ajeno || enOtra) return "cerrada-sim-ajeno";
      const liberadoDe = { device_id: ficha.id, serial: ficha.serial || "", cliente_nombre: ficha.cliente_nombre || "", motivo };
      if (simSnap.exists) {
        tx.set(simRef, {
          estado: "disponible",
          asignado_a: null,
          liberado_de: liberadoDe,
          updated_at: FV.serverTimestamp(),
          updated_by: null,
          updated_by_email: usuario,
        }, { merge: true });
      } else if (SIM_VALIDO.test(sim)) {
        tx.set(simRef, {
          sim_number: sim,
          sim_phone: (ficha.sim_phone || "").toString().trim(),
          operador: (ficha.operador || "").toString().trim(),
          estado: "disponible",
          origen: "liberado",
          asignado_a: null,
          liberado_de: liberadoDe,
          created_at: FV.serverTimestamp(),
          creado_por_uid: null,
          creado_por_email: usuario,
          updated_at: FV.serverTimestamp(),
          updated_by: null,
          updated_by_email: usuario,
        });
      }
      return "cerrada";
    });
  }

  // El log nunca tumba el cierre (mismo criterio que PocService._logBorrado).
  await db.collection("poc_logs").add({
    equipo_id: ficha.id,
    fecha: FV.serverTimestamp(),
    usuario,
    accion: "eliminar",
    origen: ref?.tipo === "orden" ? "devolucion" : "sistema",
    motivo,
    ref: ref || null,
    cambios: { antes: ficha, despues: { deleted: true, activo: false } },
  }).catch(() => {});

  return resultado;
}

// Cierra las fichas de POC de un serial que volvió. Ver reglas arriba.
// `ref` = { tipo, id, label } — de dónde vino el cierre (la orden de devolución).
async function cerrarFichasPoc({
  serial, poolDocId = null, clienteId = null, clienteNombre = "",
  motivo = "El radio volvió", ref = null, usuario = "sistema",
}, db = dbReal) {
  const vivas = await buscarFichasVivas({ serial, poolDocId }, db);
  const aCerrar = fichasDelCliente(vivas, { clienteId, clienteNombre });
  const cerradas = [];
  const simsAjenos = [];
  for (const ficha of aCerrar) {
    const r = await cerrarUna(ficha, { motivo, ref, usuario }, db);
    cerradas.push({
      id: ficha.id, serial: ficha.serial, unit_id: ficha.unit_id || null,
      sim: soloDigitos(ficha.sim_number) || null,
      // La desconexión del airtime se pide con el Unit ID y el NOMBRE del radio
      // (Brenda/Mariche, 2026-09-17); el SIM y el operador viajan igual porque
      // son el rastro de lo que la ficha tenía (ver onOrdenDevolucionWrite).
      radio_name: ficha.radio_name || "",
      sim_number: ficha.sim_number || "", sim_phone: ficha.sim_phone || "",
      operador: ficha.operador || "", ip: ficha.ip || "",
    });
    if (r === "cerrada-sim-ajeno") simsAjenos.push(soloDigitos(ficha.sim_number));
  }
  // Fichas del serial que quedan abiertas con OTRO cliente: no se tocan, pero
  // el llamador puede reportarlas (son el arrastre que limpia el batch).
  const deOtros = vivas.length - aCerrar.length;
  return { cerradas, simsAjenos, deOtros };
}

module.exports = { cerrarFichasPoc, cerrarFicha: cerrarUna, fichasDelCliente, buscarFichasVivas, normSerial };
