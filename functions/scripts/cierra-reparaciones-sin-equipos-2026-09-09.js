/**
 * cierra-reparaciones-sin-equipos-2026-09-09.js — cierra las DOS reparaciones
 * que quedaron completadas sin una sola línea de equipo.
 *
 * DE DÓNDE SALEN. Las encontró analiza-casos-viejos.js: llevaban 62 y 54 días
 * en COMPLETADO sonando en la señal "lista para entregar", pero no tienen nada
 * que entregar — el array `equipos` está vacío, no vacío-de-activos: vacío.
 * No son casos de la válvula de "Casos viejos" (no hay radio que decidir), así
 * que se cierran a mano y por la puerta que dice la verdad de cada una.
 *
 * POR QUÉ CADA UNA CIERRA DISTINTO
 *   2026070807 · COPASECUVA — "AUDIFONOS DAÑADOS SOLICITAN CAMBIO". El cliente
 *     trajo unos audífonos al mostrador y nunca se registró el modelo (la nota
 *     técnica lo dice). Hubo un servicio y hubo un cliente al que devolverlos:
 *     el terminal honesto es ENTREGADO AL CLIENTE. Va por la rama sin firma
 *     digital (`no_recibido`), que es la que el sistema ya ofrece cuando no se
 *     puede recoger una firma — y el motivo dice EXACTAMENTE que es una
 *     regularización de escritorio, no que alguien firmó un papel.
 *   2026071607 · C COMUNICA — "VERIFICACION DE REPETIDORES Y PROGRAMACION DE
 *     ROUTERS", trabajo en sitio de la propia empresa. Es una visita técnica
 *     abierta como reparación: su terminal es CERRADA (VISITA), el mismo
 *     camino COMPLETADO → CERRADA (VISITA) que ya existe para regularizar
 *     visitas viejas cerradas sin firma.
 *
 * NO se borran: el trabajo se hizo y es historial del cliente (los saneos
 * cierran, no eliminan). Ninguna mueve inventario — sin equipos, el trigger
 * del pool no tiene nada que tocar.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/cierra-reparaciones-sin-equipos-2026-09-09.js
 *   node scripts/cierra-reparaciones-sin-equipos-2026-09-09.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const AUTOR = "regularizacion 2026-09-09 (script)";

const CASOS = [
  {
    id: "2026070807",
    cliente: "COPASECUVA",
    terminal: "ENTREGADO AL CLIENTE",
    porque: "audífonos del cliente, sin modelo registrado — hubo servicio y hubo a quién devolverlos",
    patch: {
      estado_reparacion: "ENTREGADO AL CLIENTE",
      no_recibido: true,
      no_recibido_motivo:
        "Regularización de escritorio 2026-09-09: la orden se cerró sin firma. " +
        "No tiene equipos registrados (el cliente trajo audífonos y nunca se " +
        "capturó el modelo), así que no hay nada en custodia ni en inventario. " +
        "No consta firma del cliente en el sistema.",
      entrega_persona_interna: AUTOR,
      notas_entrega:
        "Cerrada a mano porque llevaba 62 días en COMPLETADO sin equipos que entregar.",
    },
  },
  {
    id: "2026071607",
    cliente: "C COMUNICA, S.A.",
    terminal: "CERRADA (VISITA)",
    porque: "verificación de repetidores propios: es una visita abierta como reparación",
    patch: {
      estado_reparacion: "CERRADA (VISITA)",
      visita_sin_firma: true,
      visita_sin_firma_motivo:
        "Regularización de escritorio 2026-09-09: trabajo en sitio de la propia " +
        "C Comunica (repetidores y routers), abierto como REPARACIÓN. No hay " +
        "cliente externo que firme ni equipos que entregar.",
    },
  },
];

async function main() {
  console.log(EXECUTE ? "\n=== EJECUTANDO ===\n" : "\n=== SIMULACIÓN (agrega --execute para escribir) ===\n");
  for (const c of CASOS) {
    const ref = db.collection("ordenes_de_servicio").doc(c.id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`${c.id}  NO EXISTE — se omite`); continue; }
    const d = snap.data();

    // Guardias: solo lo que se midió. Si alguien tocó la orden entre la
    // medición y ahora, mejor no escribir y volver a mirar.
    const equipos = Array.isArray(d.equipos) ? d.equipos : [];
    if (d.estado_reparacion !== "COMPLETADO (EN OFICINA)") {
      console.log(`${c.id}  ya NO está en COMPLETADO (está en "${d.estado_reparacion}") — se omite`);
      continue;
    }
    if (equipos.length) {
      console.log(`${c.id}  ahora tiene ${equipos.length} equipo(s): ya no es este caso — se omite`);
      continue;
    }
    if (d.eliminado === true) { console.log(`${c.id}  está eliminada — se omite`); continue; }

    console.log(`${c.id}  ${c.cliente}`);
    console.log(`   ${String(d.observaciones || "").slice(0, 90)}`);
    console.log(`   → ${c.terminal}  (${c.porque})`);

    if (!EXECUTE) continue;
    await ref.update({
      ...c.patch,
      fecha_entrega: c.terminal === "ENTREGADO AL CLIENTE"
        ? admin.firestore.FieldValue.serverTimestamp() : d.fecha_entrega || null,
      ...(c.terminal === "CERRADA (VISITA)"
        ? { fecha_cierre_visita: admin.firestore.FieldValue.serverTimestamp() } : {}),
      entrega_por_email: c.terminal === "ENTREGADO AL CLIENTE" ? AUTOR : (d.entrega_por_email || null),
      fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: c.terminal === "ENTREGADO AL CLIENTE" ? "ENTREGAR" : "CERRAR_VISITA",
        by: AUTOR,
        motivo: "regularización: orden sin equipos registrados",
        at: admin.firestore.Timestamp.now(),
      }),
    });
    console.log(`   ESCRITO`);
  }
  console.log(EXECUTE ? "\nListo.\n" : "\nNada escrito.\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
