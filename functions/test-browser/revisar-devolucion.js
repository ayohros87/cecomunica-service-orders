/* global window */
// Revisión con Chrome real del check-in de devolución: que la firma se
// imponga sola, que el motivo estructurado valide y que salir sin acuse pase
// por la pregunta.
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer-core");

const URL = "file:///" + path.join(__dirname, "harness-devolucion.html").replace(/\\/g, "/");
const CHROME = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error("No se encontró Chrome. Define CHROME_PATH."); process.exit(2); }
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "devolucion-"));

let fallos = 0;
const check = (cond, msg) => { console.log((cond ? "  OK    " : "  FALLO ") + msg); if (!cond) fallos++; };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--allow-file-access-from-files", "--disable-gpu"],
    defaultViewport: { width: 1100, height: 900, deviceScaleFactor: 1.2 },
  });
  const page = await browser.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(URL, { waitUntil: "networkidle0" });

  await page.click("#ir");
  await page.waitForSelector(".overlay", { visible: true });
  await page.screenshot({ path: path.join(OUT, "1-abierto.png") });
  check(await page.$(".overlay") !== null, "el check-in abre");

  // Sin nada recibido: el pie NO debe reclamar acuse todavía.
  check(await page.$("#devIrAFirma") === null, "sin unidades recibidas el pie no molesta");

  // Recibir la primera unidad.
  const btnRecibir = await page.$(".dev-recibido");
  check(!!btnRecibir, "hay botón de recibir");
  if (btnRecibir) {
    await btnRecibir.click();
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: path.join(OUT, "2-checklist.png") });
    const confirmar = await page.$("#devRecibidoConfirm");
    check(!!confirmar, "el mini-checklist abre con su confirmar");
    if (confirmar) {
      await confirmar.click();
      await new Promise(r => setTimeout(r, 600));
    }
  }
  await page.screenshot({ path: path.join(OUT, "3-tras-recibir.png") });

  // Ahora sí: bloque de acuse presente y pie reclamando.
  check(await page.$("#devAcuseBloque") !== null, "el bloque del acuse aparece");
  check(await page.$("#devIrAFirma") !== null, "el pie reclama el acuse");

  // Cerrar con una unidad sin acuse: tiene que preguntar, no cerrarse solo.
  await page.click("#devCerrarModal");
  await new Promise(r => setTimeout(r, 400));
  const hoja = await page.$(".modal-backdrop");
  check(!!hoja, "salir con unidades sin acuse abre la pregunta");
  await page.screenshot({ path: path.join(OUT, "3b-candado.png") });
  const txt = hoja ? await page.evaluate(el => el.innerText, hoja) : "";
  check(/Falta el acuse/.test(txt), "la pregunta dice qué falta");
  check(/Salir sin el acuse/.test(txt) && /Ir a la firma/.test(txt), "ofrece las dos salidas");
  // "Ir a la firma" devuelve al check-in, que sigue abierto.
  const btns = await page.$$(".modal-backdrop button");
  for (const b of btns) {
    const t = await page.evaluate(el => el.textContent.trim(), b);
    if (/Ir a la firma/.test(t)) { await b.click(); break; }
  }
  await new Promise(r => setTimeout(r, 500));
  check(await page.$(".overlay") !== null, "tras «Ir a la firma» el check-in sigue abierto");
  check(await page.$(".modal-backdrop") === null, "y la pregunta se cerró");

  // El camino sin firma: motivos de lista.
  const hayCheck = await page.$("#acuseSinFirma");
  check(!!hayCheck, "existe «El cliente no puede firmar ahora»");
  if (hayCheck) {
    await page.click("#acuseSinFirma");
    await new Promise(r => setTimeout(r, 150));
    const opciones = await page.$$eval("#acuseSinFirmaCodigo option", (os2) => os2.map(o => o.value));
    check(opciones.includes("vendedor_trajo"), "el motivo del vendedor está en la lista");
    check(opciones.length >= 6, `la lista trae los motivos (${opciones.length})`);
    await page.screenshot({ path: path.join(OUT, "4-sin-firma.png") });

    // Guardar sin elegir motivo → debe reclamar.
    await page.click("#acuseGuardarBtn");
    await new Promise(r => setTimeout(r, 200));
    let toasts = await page.evaluate(() => window.__toasts.map(t => t[1]));
    check(toasts.some(t => /Elige por qué/.test(t)), "sin motivo no guarda");

    // Elegir un motivo que pide persona, sin escribirla → debe reclamar.
    await page.select("#acuseSinFirmaCodigo", "vendedor_trajo");
    await new Promise(r => setTimeout(r, 150));
    const quienVisible = await page.$eval("#acuseQuienBloque", el => !el.classList.contains("hidden"));
    check(quienVisible, "al elegir «lo trajo un vendedor» pide quién");
    await page.click("#acuseGuardarBtn");
    await new Promise(r => setTimeout(r, 200));
    toasts = await page.evaluate(() => window.__toasts.map(t => t[1]));
    check(toasts.some(t => /Indica quién hizo la entrega/.test(t)), "sin la persona no guarda");

    // Completo → guarda.
    await page.type("#acuseSinFirmaQuien", "Elvia Onodera");
    await page.click("#acuseGuardarBtn");
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, "5-guardado.png") });
    const acuse = await page.evaluate(() => (window.__orden.devolucion.acuses || [])[0] || null);
    check(!!acuse, "el acuse se guardó");
    if (acuse) {
      check(acuse.sin_firma_codigo === "vendedor_trajo", `código guardado (${acuse.sin_firma_codigo})`);
      check(acuse.sin_firma_quien === "Elvia Onodera", `persona guardada (${acuse.sin_firma_quien})`);
      check(/Entregó: Elvia Onodera/.test(acuse.sin_firma_motivo || ""),
        `el texto impreso se compone (${acuse.sin_firma_motivo})`);
    }
  }

  // Los 404 de recursos que el CSS pide (fuentes, iconos) no existen bajo
  // file:// y no dicen nada de la pantalla: solo cuentan los errores de JS.
  const deJs = errores.filter(e => !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(e));
  console.log("\nerrores de JS:", deJs.length);
  deJs.slice(0, 10).forEach(e => console.log("   ", e.slice(0, 200)));
  if (deJs.length) fallos++;
  console.log("capturas en:", OUT);
  await browser.close();
  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
  process.exit(fallos ? 1 : 0);
})();
