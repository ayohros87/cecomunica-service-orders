/**
 * corrige-modelos-poc-brenda-2026-10-27.js — Segunda pasada sobre los modelos
 * del PoC con el archivo de Brenda "modelos-poc_automaticos_completados.xlsx".
 *
 * En la pestaña "Automáticos" Brenda llenó "Corrección" arrastrando la celda:
 * los valores con número corrido (MNC361/362/363, SC581) y los que copian la
 * fila de arriba se descartan (el sistema ya tiene la propuesta). Aquí van solo
 * las correcciones que no se explican por el arrastre, más los 2 radios de
 * "Por revisar" cuyo serial se corrigió en el PoC y cuya ficha del pool (con el
 * serial bueno) ya dice el mismo modelo que Brenda confirmó.
 *
 * Candados: el device y la ficha deben estar como se leyeron el 2026-10-27
 * (modelo_id esperado); si alguien los tocó desde entonces, no se pisa.
 * Cada cambio deja poc_log y movimiento en el kardex.
 *
 * USAGE (desde functions/):
 *   node scripts/corrige-modelos-poc-brenda-2026-10-27.js [--write] [--email=..]
 * Idempotente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const WRITE = process.argv.includes("--write");
const EMAIL = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:corrige-modelos-poc-brenda-2026-10-27";
const MOTIVO = "Corrección de Brenda 2026-10-27 (modelos-poc_automaticos_completados.xlsx)";

const M = {
  "HYTERA MNC360":      "9wBWZIPgdY9im5dPDBh4",
  "HYTERA MNC360-R":    "NGJEfGVugJ66epMc4RSH",
  "HYTERA PNC360S":     "bZUknGOIEnQ7IkUgZSdv",
  "HYTERA PNC360S-R":   "x7hlVuYhyf22JhzR4hqz",
  "INRICO TM-7PLUSS-R": "l6Dr2w7IvZ4TgOdI5guX",
};

// device/ficha: id del doc y modelo_id que tiene hoy ("" = vacío); null = no se toca.
const CAMBIOS = [
  { serial: "24704A1211", cliente: "BRINKS PANAMA", a: "HYTERA MNC360-R", base: "Automáticos fila 328",
    device: ["stoYeAeaWY0R8uN9zc9Y", M["HYTERA MNC360"]], ficha: ["24704A1211", M["HYTERA MNC360"]] },
  { serial: "24704A1219", cliente: "CEMENTO BAYANO CONCRETO", a: "HYTERA MNC360-R",
    base: "Automáticos fila 347; el PoC ya lo tenía como -R",
    device: null, ficha: ["24704A1219", M["HYTERA MNC360"]] },
  { serial: "24523A0397", cliente: "EXOLUM PANAMA", a: "HYTERA PNC360S", base: "Automáticos fila 495 (cruzado con 24523A0402)",
    device: ["00pjguGJMu9y2V7GSwpO", M["HYTERA PNC360S-R"]], ficha: ["24523A0397", M["HYTERA PNC360S-R"]] },
  { serial: "24523A0402", cliente: "EXOLUM PANAMA", a: "HYTERA PNC360S-R", base: "Automáticos fila 496 (cruzado con 24523A0397)",
    device: ["PssVNmtu09ruQVqs6tQA", M["HYTERA PNC360S"]], ficha: ["24523A0402", M["HYTERA PNC360S"]] },
  { serial: "23706A0371", cliente: "COPASECUVA", a: "HYTERA PNC360S-R",
    base: "Por revisar fila 742 (serial corregido 27306A0371 → 23706A0371; la ficha ya dice PNC360S-R)",
    device: ["1PJcJwxFI7SrhsqebV47", ""], ficha: null },
  { serial: "7TM27PA3483", cliente: "MAS SEGURIDAD", a: "INRICO TM-7PLUSS-R",
    base: "Por revisar fila 776 (serial corregido TM27PA3483 → 7TM27PA3483; la ficha ya dice TM-7PLUSS-R)",
    device: ["QOn1UVlqCihs6bYHbEEY", ""], ficha: null },
];

(async () => {
  console.log(WRITE ? "*** ESCRIBIENDO ***" : "*** DRY-RUN — no se escribe nada ***");
  const modelos = new Map();
  for (const s of await db.getAll(...Object.values(M).map((id) => db.collection("modelos").doc(id)))) {
    const m = s.data();
    modelos.set(s.id, { label: `${m.marca || ""} ${m.modelo || ""}`.trim(),
      cond: (m.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo" });
  }
  const label = (id) => modelos.get(id)?.label || "";

  for (const c of CAMBIOS) {
    const toId = M[c.a], to = modelos.get(toId);
    const tag = `${c.cliente} · ${c.serial} → ${to.label}`;
    const ts = admin.firestore.FieldValue.serverTimestamp();

    if (c.device) {
      const ref = db.collection("poc_devices").doc(c.device[0]);
      const d = (await ref.get()).data() || {};
      const actual = d.modelo_id || "";
      if (actual === toId) console.log(`  device ya igual   ${tag}`);
      else if (actual !== c.device[1] || d.deleted === true || d.activo === false) {
        console.log(`  SALTADO device    ${tag} (hoy "${d.modelo_label || actual}", activo ${d.activo})`);
      } else {
        console.log(`  device            ${tag} (antes "${d.modelo_label || "sin modelo"}")`);
        if (WRITE) {
          await ref.update({ modelo_id: toId, modelo_label: to.label,
            updated_at: ts, updated_by: null, updated_by_email: EMAIL });
          await db.collection("poc_logs").add({ equipo_id: ref.id, fecha: ts, usuario: EMAIL,
            accion: "correccion_modelo", motivo: `${MOTIVO} — ${c.base}`,
            cambios: { antes: { modelo_id: actual || null, modelo_label: d.modelo_label || "" },
              despues: { modelo_id: toId, modelo_label: to.label } } });
        }
      }
    }

    if (c.ficha) {
      const ref = db.collection("equipos_pool").doc(c.ficha[0]);
      const f = (await ref.get()).data() || {};
      const actual = f.modelo_id || "";
      if (actual === toId) console.log(`  ficha ya igual    ${tag}`);
      else if (actual !== c.ficha[1]) console.log(`  SALTADO ficha     ${tag} (hoy "${f.modelo_label || actual}")`);
      else {
        console.log(`  ficha             ${tag} (antes "${label(actual)}" ${f.condicion} → ${to.cond})`);
        if (WRITE) {
          await ref.set({ modelo_id: toId, modelo_label: to.label, condicion: to.cond,
            updated_at: ts, updated_by_email: EMAIL }, { merge: true });
          await ref.collection("movimientos").doc().set({ at: ts, por: "system", por_email: EMAIL,
            tipo: "correccion_modelo", de_estado: f.estado || null, a_estado: f.estado || null, ref: null,
            notas: `Modelo corregido: ${f.modelo_label || "sin modelo"} (${f.condicion}) → ${to.label} (${to.cond}). ${MOTIVO} — ${c.base}` });
        }
      }
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
