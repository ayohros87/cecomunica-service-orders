// Caja menuda — a quién se le avisa por correo cada vez que un gasto cambia
// de manos (2026-11-26). Lógica PURA: el trigger onCajaMenudaWrite resuelve
// las direcciones y encola.
//
// La regla: el correo le llega a quien tiene que HACER algo, o a quien pidió
// cuando la respuesta ya está. No se avisa de lo que ocurre cara a cara (la
// entrega del efectivo: la persona lo está recibiendo en la mano).
//
//   se pide                → al jefe que aprueba (o a administración)
//   se aprueba             → a contabilidad (paga) y a quien pidió
//   se rechaza             → a quien pidió, con el motivo
//   se paga por ACH        → a quien pidió, con la referencia
//   se rinde el anticipo   → a contabilidad (cierra)
//   se devuelve la rendición → a quien pidió, con lo que falta

const TIPO = { reembolso: "reembolso", anticipo: "anticipo" };

const dinero = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function filasBase(g) {
  const f = [
    ["Monto", dinero(g.monto)],
    ["Para qué", g.concepto || ""],
    ["Categoría", g.categoria || ""],
  ];
  if (g.proveedor) f.push(["Proveedor", g.proveedor]);
  if (g.fecha_gasto) f.push(["Fecha de la factura", g.fecha_gasto]);
  return f;
}

/**
 * @param {object|null} antes   doc antes de la escritura (null al crear)
 * @param {object|null} despues doc después (null si se borró)
 * @param {string} id
 * @returns {Array<{para:'aprobador'|'custodios'|'solicitante', asunto, intro, filas, cta}>}
 */
function avisos(antes, despues, id) {
  if (!despues) return [];
  const g = despues;
  const de = antes ? antes.estado : null;
  const a = g.estado;
  if (de === a) return [];
  const quien = g.solicitante_nombre || g.solicitante_email || "Alguien";
  const tipo = TIPO[g.tipo] || "gasto";
  const num = g.numero ? ` ${g.numero}` : "";
  const ach = g.via === "ach";
  const verMio = { path: `/caja/index.html?g=${id}`, label: "Ver mi gasto" };
  const out = [];

  if (!antes && a === "solicitado") {
    out.push({
      para: "aprobador",
      asunto: `Caja menuda: ${quien} pide ${dinero(g.monto)} (${tipo})`,
      intro: `${quien} pidió un ${tipo} de caja menuda y espera tu aprobación.`,
      filas: filasBase(g),
      cta: { path: `/caja/index.html?g=${id}`, label: "Aprobar o rechazar" },
    });
  } else if (de === "solicitado" && a === "aprobado") {
    const aprobo = (g.aprobacion && g.aprobacion.por_nombre) || "Su jefe";
    out.push({
      para: "custodios",
      asunto: `Caja menuda${num}: ${dinero(g.monto)} de ${quien}, aprobado`,
      intro: ach
        ? `${aprobo} aprobó un reembolso de ${quien} que pasa del tope de caja menuda: se paga por ACH.`
        : (g.tipo === "anticipo"
          ? `${aprobo} aprobó un anticipo de ${quien}: hay que entregarle el efectivo.`
          : `${aprobo} aprobó un reembolso de ${quien}: hay que pagárselo en efectivo contra la factura.`),
      filas: filasBase(g),
      cta: { path: `/caja/contabilidad.html?g=${id}`, label: "Abrir en la bandeja" },
    });
    out.push({
      para: "solicitante",
      asunto: `Caja menuda${num}: aprobaron tus ${dinero(g.monto)}`,
      intro: ach
        ? `${aprobo} aprobó tu reembolso. Como pasa del tope de caja menuda, contabilidad te lo paga por ACH.`
        : (g.tipo === "anticipo"
          ? `${aprobo} aprobó tu anticipo. Pasa por contabilidad a retirar el efectivo; después trae la factura fiscal y el vuelto.`
          : `${aprobo} aprobó tu reembolso. Pasa por contabilidad con la factura fiscal original para cobrarlo.`),
      filas: filasBase(g),
      cta: verMio,
    });
  } else if (a === "rechazado" && (de === "solicitado" || de === "aprobado")) {
    const r = g.rechazo || {};
    out.push({
      para: "solicitante",
      asunto: `Caja menuda${num}: rechazaron tus ${dinero(g.monto)}`,
      intro: `${r.por_nombre || "Se"} rechazó tu ${tipo} de caja menuda.`,
      filas: [["Motivo", r.motivo || ""], ...filasBase(g)],
      cta: verMio,
    });
  } else if (de === "aprobado" && a === "pagado" && ach) {
    const e = g.entrega || {};
    out.push({
      para: "solicitante",
      asunto: `Caja menuda${num}: te pagaron ${dinero(e.monto)} por ACH`,
      intro: "Contabilidad registró el pago de tu reembolso por ACH.",
      filas: [["Pagado", dinero(e.monto)], ["Referencia", e.referencia || ""], ["Para qué", g.concepto || ""]],
      cta: verMio,
    });
  } else if (de === "entregado" && a === "rendido") {
    const r = g.rendicion || {};
    const vuelto = Number(r.vuelto) || 0;
    out.push({
      para: "custodios",
      asunto: `Caja menuda${num}: ${quien} rindió su anticipo`,
      intro: `${quien} subió la factura de su anticipo. Falta que la revises y cierres.`,
      filas: [
        ["Entregado", dinero(g.entrega && g.entrega.monto)],
        ["Gastado", dinero(r.monto_gastado)],
        [vuelto >= 0 ? "Vuelto a recibir" : "Diferencia a pagarle", dinero(Math.abs(vuelto))],
        ["Para qué", g.concepto || ""],
      ],
      cta: { path: `/caja/contabilidad.html?g=${id}`, label: "Revisar y cerrar" },
    });
  } else if (de === "rendido" && a === "entregado") {
    const d = g.rendicion_devuelta || {};
    out.push({
      para: "solicitante",
      asunto: `Caja menuda${num}: falta algo en tu rendición`,
      intro: "Contabilidad revisó la rendición de tu anticipo y la devolvió para que la completes.",
      filas: [["Qué falta", d.motivo || ""], ["Para qué", g.concepto || ""]],
      cta: { path: `/caja/index.html?g=${id}`, label: "Completar la rendición" },
    });
  }
  return out;
}

/** CM-0001, CM-0002… (crece a 5 cifras solo). */
function numero(n) {
  return `CM-${String(Number(n) || 0).padStart(4, "0")}`;
}

module.exports = { avisos, numero, dinero };
