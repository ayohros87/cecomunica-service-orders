// Los seriales que toca una gestión, en una sola lista plana (2026-09-09).
//
// Para qué: el archivo (/contratos/, pestaña Gestiones) tiene que contestar
// "¿en qué gestión salió el serial 8J4K02245?". Firestore no busca dentro de
// objetos anidados, y los seriales de una gestión viven repartidos en cuatro
// sitios distintos según el tipo:
//   · items[].serial / .serial_norm         (cambio de serial, devolución)
//   · items[].serial_saliente / .serial_nuevo (reemplazo: los DOS cuentan —
//     buscar por el que salió es tan válido como por el que entró)
//   · demo.seriales_asignados[].serial
//   · aumento.seriales_asignados[].serial
//
// Esta función los junta, los normaliza igual que el pool y los deduplica.
// El resultado se denormaliza en `gestiones/{gid}.seriales_norm` (array) para
// poder consultarlo con array-contains. Lo mantiene onGestionArchivo y lo
// sembró scripts/backfill-gestiones-archivo.js. Pura: test/gestionSeriales.test.js.
"use strict";

// normSerial/esSerialValido van COPIADOS, no importados: equiposPool.js arrastra
// lib/admin (initializeApp) y este módulo tiene que poder correr en una prueba a
// secas y en un script sin credenciales. Si cambia la identidad del serial en
// equiposPool.js, cámbiala aquí — test/gestionSeriales.test.js lo cubre.
const normSerial = (raw) => (raw ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const esSerialValido = (n) => /^[A-Z0-9]{3,30}$/.test(n) && /\d/.test(n);

function serialesDe(g) {
  if (!g) return [];
  const crudos = [];
  const push = (v) => { if (v) crudos.push(v); };

  for (const it of g.items || []) {
    if (!it) continue;
    push(it.serial_norm);
    push(it.serial);
    push(it.serial_saliente);
    push(it.serial_nuevo);
  }
  for (const s of g.demo?.seriales_asignados || []) push(s?.serial_norm || s?.serial);
  for (const s of g.aumento?.seriales_asignados || []) push(s?.serial_norm || s?.serial);

  const out = [];
  const vistos = new Set();
  for (const raw of crudos) {
    const n = normSerial(raw);
    // esSerialValido filtra el cajón de sastre ("CONSOLA", "GPS", "DEMO"…):
    // sin él, buscar "DEMO" en el archivo devolvería medio histórico.
    if (!n || vistos.has(n) || !esSerialValido(n)) continue;
    vistos.add(n);
    out.push(n);
  }
  return out;
}

// ¿Cambió respecto a lo que ya está guardado? Compara como CONJUNTO: el orden
// de los ítems cambia con cada edición y no es información.
function mismoConjunto(a, b) {
  const A = a || [], B = b || [];
  if (A.length !== B.length) return false;
  const s = new Set(A);
  return B.every((x) => s.has(x));
}

module.exports = { serialesDe, mismoConjunto };
