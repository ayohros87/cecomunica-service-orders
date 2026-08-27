/**
 * parea-huerfanas-contrato.js — Liga fichas HUÉRFANAS del pool (con cliente,
 * sin contrato) a los renglones sin serial de los contratos vigentes de ESE
 * mismo cliente. Es la mitad de escritorio del hueco de seriales: 410 de los
 * 1,626 equipos sin serial ya están en el sistema y solo les falta el vínculo.
 *
 * CÓMO ESCRIBE — por la puerta de siempre, no a mano
 *   Agrega la fila a `contratos/{cid}/seriales` y deja que el trigger
 *   onSerialWrite haga el resto: upsertContacto pone la asignación, ajusta el
 *   estado (en_cliente si el contrato tiene entrega confirmada o es legacy) y
 *   escribe el movimiento en el kardex. Escribir `equipos_pool.asignacion`
 *   directamente dejaría el historial mudo y el conteo del contrato desfasado
 *   — mismo criterio que lib/sustitucionContrato.js.
 *
 * CANDADOS
 *   · Nunca cruza clientes: una huérfana solo puede llenar un hueco de SU
 *     cliente. El pareo por modelo es tolerante (la fila "-R" refurbished casa
 *     con la normal), así que la barrera del cliente es la que sostiene todo.
 *   · Los contratos con `seriales_estado: 'asignados'` se SALTAN por defecto:
 *     ese estado es el candado de solo-lectura que puso la auditoría de
 *     seriales, y forzarlo desde un script lo vaciaría de sentido.
 *     `--incluir-asignados` para los casos revisados a mano.
 *   · Una huérfana ya ligada por otra corrida no se vuelve a ofrecer (se
 *     releen los datos en cada ejecución).
 *
 * REVISA ANTES DE ESCRIBIR: el dry-run imprime pareja por pareja. El pareo por
 * modelo es una PROPUESTA — que el radio quepa en el renglón no prueba que sea
 * ese radio. Para un cliente con un solo modelo da igual; para uno con varios,
 * míralo.
 *
 * USAGE (desde functions/):
 *   node scripts/parea-huerfanas-contrato.js --cliente <cliente_id>
 *   node scripts/parea-huerfanas-contrato.js --cliente <cliente_id> --write
 *   node scripts/parea-huerfanas-contrato.js --solo-completos          # los 12
 *   node scripts/parea-huerfanas-contrato.js --solo-completos --write
 * Idempotente: lo ya ligado deja de ser hueco y de ser huérfana.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const P = require("./_pareo-huecos");

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || null) : null; };
const dryRun = !args.includes("--write");
const CLIENTE = flag("--cliente");
const SOLO_COMPLETOS = args.includes("--solo-completos");
const INCLUIR_ASIGNADOS = args.includes("--incluir-asignados");
const AUTOR = "script:parea-huerfanas-contrato";

(async () => {
  if (!CLIENTE && !SOLO_COMPLETOS) {
    console.error("Falta --cliente <cliente_id> o --solo-completos. "
      + "Corre antes `node scripts/analiza-huecos-seriales.js` para ver a quién le aplica.");
    process.exit(1);
  }

  const [cSnap, pSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("equipos_pool").get(),
  ]);
  const vigentes = P.contratosVigentes(cSnap);
  const porDocId = new Map(vigentes.map((c) => [c.id, c]));
  const { asignadas, huerfanas, nombre } = P.leerPool(pSnap);
  const huecos = P.huecosPorCliente(vigentes, asignadas, nombre);

  console.log(`\n=== parea-huerfanas-contrato ${dryRun ? "(DRY-RUN)" : "(WRITE)"} ===`);

  const escrituras = [];
  let saltadosPorCandado = 0;
  for (const [cli, items] of huecos) {
    if (CLIENTE && cli !== CLIENTE) continue;
    const disp = huerfanas.get(cli) || [];
    P.parear(items, disp);

    const pareados = items.filter((it) => it.candidato);
    if (!pareados.length) continue;
    // --solo-completos: únicamente los clientes cuyo hueco se cierra ENTERO
    // desde el escritorio. Son los que no dejan trabajo a medias.
    if (SOLO_COMPLETOS && pareados.length !== items.length) continue;

    console.log(`\n── ${nombre.get(cli) || cli} — ${pareados.length}/${items.length} pareables ──`);
    for (const it of pareados) {
      const c = porDocId.get(it.contrato_doc_id);
      const bloqueado = c && c.seriales_estado === "asignados" && !INCLUIR_ASIGNADOS;
      const marca = bloqueado ? "[CANDADO]" : "        ";
      console.log(`  ${marca} ${it.contrato.padEnd(18)} ${it.modelo.padEnd(24)} ← ${it.candidato.serial.padEnd(14)} ${it.candidato.modelo}`);
      if (bloqueado) { saltadosPorCandado++; continue; }
      escrituras.push({ cli, it, c });
    }
    const sobran = disp.filter((x) => !x.usada).length;
    if (sobran) console.log(`  · quedan ${sobran} huérfana(s) sin renglón que llenar`);
  }

  if (saltadosPorCandado) {
    console.log(`\n${saltadosPorCandado} pareo(s) saltados por el candado de seriales 'asignados' `
      + "(--incluir-asignados para forzarlos, tras revisarlos).");
  }
  console.log(`\n${escrituras.length} vínculo(s) a escribir.`);
  if (!escrituras.length) { process.exit(0); }
  if (dryRun) { console.log("Dry-run: nada escrito. --write para aplicar.\n"); process.exit(0); }

  let ok = 0;
  for (const { it, c } of escrituras) {
    try {
      await db.collection("contratos").doc(it.contrato_doc_id).collection("seriales").add({
        serial: it.candidato.serial,
        // El modelo de la FICHA, no el del renglón — igual que hace el traspaso
        // en lib/sustitucionContrato.js. Dos razones:
        //   1. onSerialWrite se lo pasa a `resolver`, que decide A QUÉ ficha del
        //      pool apunta el serial. Mandar el modelo del contrato cuando la
        //      ficha tiene otro es pedirle que no la encuentre: `mismoModelo`
        //      tolera el sufijo -R por contención, pero no hay por qué apostar
        //      — fallar ahí crearía una ficha sufijada duplicada (mecanismo
        //      anti-colisión Kenwood NX420/NX920).
        //   2. El renglón dice qué se facturó; la ficha dice qué radio es. Un
        //      contrato que pide "PNC360S-R" se cumple con una ficha "PNC360S"
        //      que vuelve del cliente — el "-R" lo gana el radio al regresar,
        //      no al contratarse.
        modelo: it.candidato.modelo || it.modelo || "",
        modelo_id: it.candidato.mid || it.mid || null,
        contrato_doc_id: it.contrato_doc_id,
        contrato_id: c ? (c.contrato_id || "") : "",
        cliente_id: c ? (c.cliente_id || "") : "",
        cliente_nombre: c ? (c.cliente_nombre || "") : "",
        source: "pareo_huerfanas",
        pareo_motivo: "ficha del pool con el cliente pero sin contrato (migración)",
        created_by: AUTOR,
        updated_by: AUTOR,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      ok++; process.stdout.write(".");
    } catch (e) {
      console.error(`\n  ! ${it.candidato.serial} → ${it.contrato}: ${e.message}`);
    }
  }
  console.log(`\n\nListo: ${ok}/${escrituras.length} vínculos escritos. `
    + "onSerialWrite aplica la asignación al pool y el kardex en segundos.\n");
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
