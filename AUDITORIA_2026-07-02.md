# Auditoría completa — cecomunica-service-orders

**Fecha:** 2026-07-02
**Rama auditada:** `feat/cliente-id-link`
**Alcance:** reglas de Firestore/Storage, Cloud Functions, frontend (`public/`), configuración e higiene del repo.
**Método:** cuatro auditorías en paralelo (seguridad, backend, frontend, higiene) + verificación manual de los cinco hallazgos más graves leyendo el código real.

---

## Veredicto general

La arquitectura es sólida: backend bien modularizado (`index.js` son 45 líneas de puros exports), callables con verificación de rol server-side, PII con URLs firmadas, webhook de QuickBooks con HMAC. El problema no es el diseño, es que **la capa de autorización real —las reglas de Firestore— está muy por detrás de la UI**, y hay dos fugas concretas que hay que tapar de inmediato.

---

## 🔴 Críticos — ✅ RESUELTOS (commit `c3bd887`, 2026-07-02)

> C1, C2 y C3 corregidos y commiteados. Falta **desplegar** (`firebase deploy --only firestore:rules,functions,hosting`) y validar las reglas contra el emulador antes de subirlas a producción.

### C1. Fuga de la API key de correo a Cloud Logging
- **Archivo:** `functions/src/http/sendContractPdf.js:29`
- `console.log(">>> sendContractPdf invoked", { headers: req.headers, ... })` vuelca el header `x-api-key` (valor de `SENDMAIL_KEY`) en texto claro en cada invocación. Cualquiera con lectura de logs se lleva la llave del relay de correo.
- **Fix:** borrar el log (o filtrar headers). Una línea.

### C2. XSS almacenado en grillas de clientes/órdenes → toma de sesión de admin
Renderers que interpolan texto de Firestore directo en `innerHTML` sin escapar:
- `public/js/pages/clientes-index.js:519` — `value="${c.nombre||''}"`, `ruc`, `representante`, `telefono`, `email`, `direccion`. (Delator: 18 líneas abajo, `itbms_motivo_exencion` sí escapa con `.replace(/"/g,'&quot;')` — el riesgo se conocía.)
- `public/js/pages/ordenes-render.js:109,113,135` — `nombreClienteDe(...)`, `tecnico_asignado` (contenido y atributo `title`).
- `public/js/pages/cotizaciones-index.js:169-170,174` — `cliente_nombre`, `cliente_email`, `ejecutivo_nombre`.
- `public/js/pages/poc-list.js:84,124` (duplicado en 442-445, 476).
- `public/verificar-contrato.html:100` — **página pública sin login**, el peor vector.
- **Explotación:** como las colecciones son escribibles por cualquier autenticado (C3/A1), un técnico pone `"><img src=x onerror=...>` en el nombre de un cliente; el payload corre en la sesión del admin que abre el directorio → puede llamar a `manageUser` y crearse un admin. No hay CSP que lo frene.
- **Fix:** helper `esc()` único en `js/core/formatting.js`; pasar por los 4 renders + páginas públicas. Añadir CSP.

### C3. `mail_queue` escribible por cualquier autenticado → relay de phishing + SSRF/LFI
- **Regla:** `firestore.rules:265` → `allow read, write: if isSignedIn()`.
- **Passthrough:** `functions/src/lib/mail.js:19` pasa `attachments` del documento tal cual a nodemailer.
- **Explotación:** cualquier usuario (incluso `vista`) encola correo con `to`/`html` arbitrarios desde el dominio corporativo; con `attachments: [{ path: '/ruta/local' }]` nodemailer lee archivos del contenedor (LFI) o dispara requests salientes (SSRF).
- **Fix:** `write:false` en la regla; encolar solo desde CF; nunca pasar `attachments` provistos por el cliente.

---

## 🟠 Altos — ✅ RESUELTOS (commits `bd80d98` + `bb63f16`, 2026-07-03)

> A1–A5 corregidos y commiteados (2 commits, sin pushear aún). Validado local: reglas compilan en emulador, `node -c` OK, firebase-admin 13 + nodemailer 9 cargan sin romper imports. **Falta desplegar** (`firebase deploy --only firestore:rules,functions,hosting`) — la prueba de integración real del bump de dependencias es el deploy. Notas por ítem:
> - **A1** scoping quirúrgico: `empresa/config`→admin; `delete` de `ordenes_de_servicio`→admin/gerente y de `poc_devices`→admin (el cliente nunca hace hard-delete). El resto de colecciones sigue en `auth read+write` (endurecer requiere análisis de flujo por colección — pendiente, riesgo de romper el flujo core de órdenes).
> - **A4** dependencias: 26→8 vulnerabilidades (0 críticas, 0 altas). Las 8 residuales son moderadas transitivas de google-cloud sin fix salvo degradar storage a 5.x.

### A1. Escritura sin scoping en casi todas las colecciones de negocio
- `firestore.rules:229-269`: `ordenes_de_servicio`, `poc_devices`, `inventario_*`, `contratos`, etc. son `auth read/write` para cualquier rol → un `vista`/`tecnico` puede modificar o borrar datos de toda la empresa. Es también el vector de escritura de C2.
- **Caso alto impacto:** `firestore.rules:259` hace `empresa/{docId}` escribible por cualquiera. Ahí viven `cotizacion_descuento_max_pct`, `cotizacion_total_max`, `seriales_editores_extra` e `itbms_rate` → un vendedor sube su umbral de auto-envío, se mete en la allowlist de seriales o altera la tasa fiscal.
- **Fix:** separar read/write por rol; `empresa/*` write solo admin.

### A2. Correo duplicado en reintentos de trigger
- `functions/src/triggers/contratos/onApproval.js:395` — `onSerialesAsignadasSendPdf` envía por SMTP directo sin marcador de idempotencia. Los triggers son at-least-once → una re-entrega reenvía el PDF a activaciones.
- **Fix:** estampar `pdf_enviado_at` y chequearlo, o encolar en `mail_queue` (que sí tiene guard `sent_at`).

### A3. Puppeteer sin `finally` → OOM
- `functions/src/http/sendContractPdf.js:86` y dos sitios de `onApproval.js`: `browser.close()` no está en `finally`; si `page.pdf()` falla, Chromium (1-2 GiB) queda vivo en la instancia caliente.
- **Fix:** `try/finally { await browser.close(); }`.

### A4. 26 vulnerabilidades en dependencias (3 críticas, 9 altas)
- Todas transitivas, todas con `npm audit fix` sin `--force`: `fast-xml-parser` y `basic-ftp` (críticas), `form-data`, `ws`, `@grpc/grpc-js`.
- **Fix:** `npm audit fix` en `functions/` + subir `firebase-admin` a 13.x.

### A5. `estado_reparacion.html` sin guard de auth
- `public/ordenes/estado_reparacion.html` — única página sin `requireAccess` ni `onAuthStateChanged`; combinado con A1, cualquiera edita estados de reparación.
- **Fix:** añadir guard + restringir writes en reglas.

---

## 🟡 Medios

- **Batch reutilizado tras commit** — `functions/rebuild-all-contratos-cache.js:157`: hace `batch.set()` sobre un batch ya commiteado; explota con contratos de >500 órdenes. Y `functions/migrate-add-cliente-nombre-lower.js:20` usa un solo batch sin chunking a 500.
- **Doble dueño del contador `os_count`/`equipos_total`** — delta transaccional vs recálculo no-transaccional con carrera; `recalcularCacheContrato` nunca recalcula `equipos_total` → deriva silenciosa. Definir un solo dueño.
- **Read-modify-write del array `equipos` sin transacción** — `functions/src/callable/gestionarFacturacion.js:45` → lost update si alguien edita el contrato en paralelo.
- **Carrera al refrescar tokens de QuickBooks** — `functions/src/lib/quickbooks/client.js:19`: dos callables concurrentes pueden persistir un refresh_token ya rotado por Intuit → desconexión. Serializar con lock/transacción.
- **Sin headers de seguridad ni CSP** — `firebase.json` solo tiene `Cache-Control`, lo que amplifica C2. Ese `Cache-Control: no-cache, no-store` sobre todo js/css/html desactiva el caché por completo (~332 KB de JS re-descargados por vista).
- **`notes.txt` se despliega público** en `https://<sitio>/notes.txt` (changelog interno). Mover fuera de `public/` o al `ignore`.
- **Sin CI/lint/tests** — cero `.github/`, sin ESLint, ni un test (`firebase-functions-test` está en devDependencies sin usarse). Deploy manual sin validación.

---

## 🟢 Bajos / higiene

- `functions/src/callable/manageUser.js:109` genera password temporal con `Math.random()` (usar `crypto.randomBytes`).
- nodemailer crea transporter en cada envío (mover a module scope).
- Ninguna función define `maxInstances`.
- Destinatarios de correo hardcodeados en 3 sitios (`onApproval.js:390`, `onSerialCambio.js:22`, `onComplete.js:101`) → mover a `empresa/config`.
- Borrado de adjuntos de taller por cualquier autenticado — `storage.rules:59,69`.
- **Duplicación:** `escapeHtml` definido 14+ veces; `fmtFechaCorta` copiado 5 veces pese a existir `FMT`; `poc-list.js` se duplica a sí mismo (716 líneas → ~450); paginación por cursor reimplementada en 4 páginas. Consolidar en `core/`.
- **Código muerto desplegado:** `public/js/pages/editar-cotizacion.js` (409 líneas) y `nueva-cotizacion.js` (318) sin referencias.
- **CDNs sin pin:** `lucide@latest` en 74 páginas (supply-chain); Firebase compat en 3 versiones a la vez.
- **Scripts de migración en `functions/`** se suben con cada deploy; `serviceAccountKey.json` no está en `.gitignore` de functions (bomba latente). Mover a `functions/scripts/` + excluir en `.gcloudignore`.
- **Ramas:** `feat/clientes-dedup`, `feat/entrega-pii-hardening`, `feat/mobile-ordenes-kit` están 0 ahead → borrables. `feat/cliente-id-link` (actual) lleva 114 commits ahead de main → aterrizarla.
- **Docs:** 14 `.md` en la raíz sin README, con solapamiento (3 QuickBooks, 2 facturación), varios ya ejecutados. Mover a `docs/` con `activos/` y `archivo/`.

---

## Lo que está bien hecho

- **No hay escalada de rol vía reglas:** `usuarios`/`usuarios_audit` son `write:false`; toda mutación pasa por `manageUser` con guardas anti-lockout (bloquea auto-degradación, auto-desactivación y quedarse sin admins).
- **Callables:** todas verifican rol server-side, sin IDOR.
- **Tokens QuickBooks:** en `integraciones/quickbooks` con reglas deny-all; no se loguean.
- **Getters de PII:** rol-gated, URLs firmadas v4 de 5 min sobre paths `read:false`.
- **Webhook QuickBooks:** valida HMAC-SHA256 con `timingSafeEqual`, persiste raw antes de parsear, responde 200 ante body malformado.
- **Sin secretos versionados:** los `qbo-*.local.json` están correctamente ignorados.
- **Renderer público de cotización y hojas de impresión** sí escapan todos los campos.

---

## Orden de ataque recomendado

**Hoy (~30 min, alto impacto):**
1. Borrar el `console.log` de headers (C1).
2. `write:false` en `mail_queue` (C3).
3. `empresa/*` write solo admin (A1 parcial).
4. `npm audit fix` (A4).

**Esta semana:**
5. Escape centralizado + 4 tablas y páginas públicas (C2).
6. Scoping de rol en el resto de `firestore.rules` (A1).
7. `try/finally` en Puppeteer (A3).
8. Idempotencia en el envío de PDF (A2).

**Después:**
9. CSP y headers + arreglar Cache-Control.
10. ESLint + GitHub Action de validación.
11. Consolidar duplicación.
12. Aterrizar `feat/cliente-id-link` en main; borrar ramas mergeadas.
