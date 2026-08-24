/* global document */
// (`document` global: los callbacks de waitForFunction/$eval se ejecutan en
//  la PÁGINA, donde sí existe — ESLint los ve como código Node. Nota: con
//  flat config (ESLint 9) `eslint-env` se ignora; `global` sí se honra.)
// Revisión visual/conductual de la bandeja de pendientes con Chrome headless.
// Carga el harness (código de producción + Firestore de mentira), interactúa
// como lo haría una persona y captura pantallas + errores de consola.
const path = require("path");
const puppeteer = require("puppeteer-core");

const os = require("os");
const fs = require("fs");

const URL_BASE = "file:///" + path.join(__dirname, "harness-pendientes.html").replace(/\\/g, "/");
// Chrome local: CHROME_PATH del entorno o las rutas típicas de Windows.
const CHROME = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error("No se encontró Chrome. Define CHROME_PATH."); process.exit(2); }
// Las capturas van a un directorio temporal — NUNCA junto al script, que se
// versiona (la primera versión escribía aquí y 8 PNGs terminaron en un
// commit). La salida imprime la ruta para abrirlas.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "pendientes-"));
const shot = (n) => path.join(OUT, n + ".png");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--allow-file-access-from-files", "--disable-gpu"],
    defaultViewport: { width: 1240, height: 860, deviceScaleFactor: 1.5 },
  });
  const errores = [];
  let fallos = 0;
  const check = (cond, msg) => { console.log((cond ? "  OK  " : "  FALLO ") + msg); if (!cond) fallos++; };

  async function abrir(rol) {
    const page = await browser.newPage();
    page.on("console", (m) => {
      // Las fuentes self-hosted (/brand/fonts) no existen bajo file:// — ruido
      // del harness, no del producto. Todo lo demás sí cuenta.
      if (m.type() === "error" && !m.text().includes("ERR_FILE_NOT_FOUND")) errores.push(`[${rol}] ${m.text()}`);
    });
    page.on("pageerror", (e) => errores.push(`[${rol}] pageerror: ${e.message}`));
    await page.goto(`${URL_BASE}?rol=${rol}`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".kpi:not(.is-loading)", { timeout: 8000 });
    await new Promise(r => setTimeout(r, 300));
    return page;
  }

  // ── RECEPCIÓN: fila de señales + ENT expandida + posponer ──────────────
  let p = await abrir("recepcion");
  await p.screenshot({ path: shot("1-recepcion-fila") });

  const entVal = await p.$eval('[data-signal-val="ENT"]', el => el.textContent);
  check(entVal === "4", `ENT cuenta 4 (o1-o4; excluye pospuesta o5, joven o6, ENTRADA o7, QC o8) — vale ${entVal}`);
  const s1Val = await p.$eval('[data-signal-val="S1"]', el => el.textContent);
  check(s1Val === "1", `S1 excluye la orden borrada o14 (solo o10 viva) — vale ${s1Val}`);

  await p.click('[data-signal="ENT"]');
  await p.waitForSelector(".pend-panel .pend-fila", { timeout: 5000 });
  await new Promise(r => setTimeout(r, 200));
  await p.screenshot({ path: shot("2-recepcion-ent-abierta"), fullPage: true });

  const filas = await p.$$eval(".pend-panel .pend-fila", els => els.map(e => ({
    txt: e.querySelector(".pend-txt")?.textContent || "",
    pospuesta: e.classList.contains("pend-pospuesto"),
    cta: e.querySelector(".pend-cta")?.getAttribute("href") || "",
  })));
  check(filas.length === 5, `panel: 5 filas (4 activas + 1 pospuesta) — hay ${filas.length}`);
  check(filas[0].txt.includes("APMT"), `orden más vieja primero (APMT 37d) — "${filas[0].txt.slice(0, 40)}"`);
  check(filas.filter(f => f.pospuesta).length === 1, "la pospuesta va gris al final");
  check(filas[0].cta.includes("?entrega=o2"), `CTA = deep-link del modal de entrega — ${filas[0].cta}`);
  check(!filas.some(f => f.txt.includes("NO DEBE SALIR") || f.txt.includes("JOVEN")), "ENTRADA y joven quedan fuera");

  // Posponer la primera fila: formulario inline, motivo obligatorio
  await p.click(".pend-panel [data-snz]");
  await p.waitForSelector(".pend-snz-form");
  await p.click(".pend-snz-form .ok");                       // sin motivo → debe negarse
  await new Promise(r => setTimeout(r, 250));
  const sigueForm = await p.$(".pend-snz-form");
  check(!!sigueForm, "sin motivo NO pospone (el motivo es lo que lee la siguiente persona)");
  await p.type(".pend-snz-form input[type=text]", "cliente confirma recepción el lunes");
  await p.screenshot({ path: shot("3-recepcion-posponer-form"), fullPage: true });
  await p.click(".pend-snz-form .ok");
  await p.waitForFunction(() => !document.querySelector(".pend-snz-form"), { timeout: 5000 });
  await new Promise(r => setTimeout(r, 300));
  await p.screenshot({ path: shot("4-recepcion-tras-posponer"), fullPage: true });

  const entVal2 = await p.$eval('[data-signal-val="ENT"]', el => el.textContent);
  check(entVal2 === "3", `tras posponer, el tile baja a 3 — vale ${entVal2}`);
  const pospuestas2 = await p.$$eval(".pend-panel .pend-pospuesto", els => els.length);
  check(pospuestas2 === 2, `ahora hay 2 pospuestas en el panel — hay ${pospuestas2}`);

  // Reactivar la que acabamos de posponer
  await p.click(".pend-panel [data-react]");
  await p.waitForFunction(
    () => document.querySelectorAll(".pend-panel .pend-pospuesto").length === 1, { timeout: 5000 });
  const entVal3 = await p.$eval('[data-signal-val="ENT"]', el => el.textContent);
  check(entVal3 === "4", `reactivar la devuelve: tile en 4 — vale ${entVal3}`);

  // Tomar / soltar: "en curso" es coordinación del ROL, no exclusividad.
  await p.click(".pend-panel [data-tomar]");
  await p.waitForSelector(".pend-curso-tag", { timeout: 5000 });
  const cursoTxt = await p.$eval(".pend-curso-tag", el => el.textContent);
  check(cursoTxt.includes("solangel.hosang"), `tomar marca "en curso" con quién — "${cursoTxt}"`);
  const entTrasTomar = await p.$eval('[data-signal-val="ENT"]', el => el.textContent);
  check(entTrasTomar === "4", `tomar NO baja el conteo (en curso sigue pendiente) — vale ${entTrasTomar}`);
  await p.screenshot({ path: shot("8-recepcion-en-curso"), fullPage: true });
  await p.click(".pend-panel [data-soltar]");
  await p.waitForFunction(() => !document.querySelector(".pend-curso-tag"), { timeout: 5000 });
  check(true, "soltar libera el pendiente (cualquiera del rol puede)");

  // Segundo clic en el tile cierra el panel
  await p.click('[data-signal="ENT"]');
  await new Promise(r => setTimeout(r, 200));
  check(!(await p.$(".pend-panel .pend-fila")), "segundo clic en la señal cierra el panel");
  await p.close();

  // ── JEFE DE TALLER: EST (estancadas) y S4Q (cola de QC) ────────────────
  p = await abrir("jefe_taller");
  const estVal = await p.$eval('[data-signal-val="EST"]', el => el.textContent);
  check(estVal === "3", `EST cuenta 3 (o9-o11; excluye legacy 60d y fresca 2d) — vale ${estVal}`);
  await p.click('[data-signal="EST"]');
  await p.waitForSelector(".pend-panel .pend-fila");
  await new Promise(r => setTimeout(r, 200));
  await p.screenshot({ path: shot("5-taller-estancadas"), fullPage: true });

  await p.click('[data-signal="S4Q"]');   // cambiar de panel sin cerrar antes
  await p.waitForFunction(() =>
    document.querySelector(".pend-panel .pend-head")?.textContent.includes("control de calidad"),
    { timeout: 5000 });
  await new Promise(r => setTimeout(r, 200));
  await p.screenshot({ path: shot("6-taller-cola-qc"), fullPage: true });
  const qcTxt = await p.$eval(".pend-panel", el => el.textContent);
  check(qcTxt.includes("SEINTEGRA"), "la cola de QC lista la orden rechazada (o8)");
  await p.close();

  // ── INVENTARIO: S13 cuarentena — el panel lista LO MISMO que el número ─
  p = await abrir("inventario");
  const s13 = await p.$eval('[data-signal-val="S13"]', el => el.textContent);
  await p.click('[data-signal="S13"]');
  await p.waitForSelector(".pend-panel .pend-fila");
  await new Promise(r => setTimeout(r, 200));
  const s13filas = await p.$$eval(".pend-panel .pend-fila", els => els.length);
  check(s13 === "3" && s13filas === 3, `S13: tile ${s13} == ${s13filas} filas (la promesa del número se cumple)`);
  await p.screenshot({ path: shot("7-inventario-cuarentena"), fullPage: true });
  await p.close();

  await browser.close();
  console.log("\nErrores de consola: " + (errores.length ? "\n  " + errores.join("\n  ") : "ninguno"));
  console.log(fallos === 0 && errores.length === 0
    ? "\n=== REVISIÓN OK — capturas en " + OUT + " ==="
    : `\n=== ${fallos} comprobaciones fallidas / ${errores.length} errores de consola ===`);
  process.exit(fallos || errores.length ? 1 : 0);
})().catch((e) => { console.error("ERROR HARNESS:", e.message); process.exit(1); });
