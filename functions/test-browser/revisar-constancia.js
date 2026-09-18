/* global document */
// Revisión con Chrome real de la CONSTANCIA de equipos del Centro: que liste
// solo lo que está con el cliente, agrupado por contrato, con la fecha y la
// orden que respaldan cada entrega.
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer-core");

const URL = "file:///" + path.join(__dirname, "harness-constancia.html").replace(/\\/g, "/");
const CHROME = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error("No se encontró Chrome. Define CHROME_PATH."); process.exit(2); }
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "constancia-"));

let fallos = 0;
const check = (cond, msg) => { console.log((cond ? "  OK    " : "  FALLO ") + msg); if (!cond) fallos++; };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--allow-file-access-from-files", "--disable-gpu"],
    defaultViewport: { width: 1000, height: 1200, deviceScaleFactor: 1.2 },
  });
  const page = await browser.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });
  await page.goto(URL, { waitUntil: "networkidle0" });

  // La constancia se abre en pestaña nueva.
  const [doc] = await Promise.all([
    new Promise((res) => browser.once("targetcreated", async (t) => res(await t.page()))),
    page.click("#ir"),
  ]);
  await new Promise((r) => setTimeout(r, 800));
  await doc.screenshot({ path: path.join(OUT, "constancia.png"), fullPage: true });
  const texto = await doc.evaluate(() => document.body.innerText);

  check(/Constancia de equipos en poder del cliente/.test(texto), "el documento se genera");
  check(/CLIENTE DE PRUEBA, S\.A\./.test(texto) && /1135843-1-568374/.test(texto), "identifica al cliente y su RUC");
  check(/ALQ20260902-01/.test(texto) && /PROP20260202-01/.test(texto), "agrupa por contrato");
  check(/Equipos sin contrato registrado/.test(texto), "y no esconde los que no tienen contrato");

  // El de taller NO está con el cliente: no puede aparecer.
  check(!/ENTALLER1/.test(texto), "el equipo en taller queda fuera");
  check(/22806A0230/.test(texto) && /SINCONTRATO1/.test(texto), "los que sí están con el cliente aparecen");
  check(/4 equipo/.test(texto), "el conteo cuadra con lo listado");

  // Kardex: toma la salida MÁS RECIENTE, no la primera.
  check(/2026081402/.test(texto), "nombra la orden que respalda la entrega");
  check(!/2026020301/.test(texto), "y usa la última salida, no la vieja");
  check(/14 de agosto de 2026/.test(texto), "con su fecha en español de Panamá");

  check(/Del cliente/.test(texto) && /En alquiler/.test(texto), "distingue de quién es cada equipo");

  const deJs = errores.filter((e) => !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(e));
  console.log("\nerrores de JS:", deJs.length);
  deJs.slice(0, 10).forEach((e) => console.log("   ", e.slice(0, 200)));
  if (deJs.length) fallos++;
  console.log("captura en:", OUT);
  await browser.close();
  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODO OK");
  process.exit(fallos ? 1 : 0);
})();
