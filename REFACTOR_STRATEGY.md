# Cecomunica Service Orders — Refactor Strategy

> Senior architect review based on direct inspection of the codebase, not on `ARQUITECTURA_CECOMUNICA.md` alone. Where the document and the code diverge, the code is treated as the source of truth.

---

## 1. How the System Actually Works

### 1.1 Runtime topology (verified)

- **Hosting:** Firebase Hosting serves a static SPA from `public/`. There is no build step — pages are hand-written HTML files, one per screen, that load Firebase compat SDKs from `gstatic.com`.
- **Auth & data:** Firebase Auth (email/password, persistence `LOCAL`) plus Firestore in compat mode. Each page does its own `firebase.initializeApp` indirectly via `js/firebase-init.js` and then calls `db.collection(...)` directly inline.
- **Backend:** A single Node 22 Cloud Functions codebase (`functions/index.js`, ~1800 lines, 11 exports). Two HTTP endpoints (`sendMail`, `sendContractPdf`) and nine Firestore triggers.
- **Public verification:** `/c/{docId}?v={code}` is rewritten by Hosting to `public/verify/index.html`, which reads `verificaciones/{docId}` anonymously.

### 1.2 The real "frontend architecture"

It is not an SPA in any meaningful sense. Each `.html` file is a standalone page with its own inline `<style>` block (often hundreds of lines), its own inline `<script>` block (frequently 1k–2.4k lines), and its own copy of business logic. A handful of large pages dominate complexity:

| File | Lines |
|---|---|
| [public/POC/index.html](public/POC/index.html) | 2480 |
| [public/contratos/index.html](public/contratos/index.html) | 2442 |
| [public/contratos/nuevo-contrato.html](public/contratos/nuevo-contrato.html) | 1961 |
| [public/ordenes/trabajar-orden.html](public/ordenes/trabajar-orden.html) | 1547 |
| [public/POC/vendedores-batch.html](public/POC/vendedores-batch.html) | 1409 |
| [public/inventario/piezas.html](public/inventario/piezas.html) | 1287 |

A partial service layer was introduced for the orders module ([public/js/services/ordenesService.js](public/js/services/ordenesService.js), [public/js/services/clientesService.js](public/js/services/clientesService.js), [public/js/ordenes-index.js](public/js/ordenes-index.js), [public/js/ordenes.state.js](public/js/ordenes.state.js)). It is currently used by `ordenes/index.html` only. Every other page still talks to Firestore directly: 188 raw `db.collection(...)` calls across 40 files.

### 1.3 The real data flow for a contract

The contract lifecycle, as actually implemented, is more complex than the architecture document suggests. The state machine is:

```
pendiente_aprobacion  →  aprobado  →  activo
       (frontend)        (frontend)    (frontend, after firmado upload)
```

Each transition fans out to multiple Cloud Functions:

1. **`pendiente_aprobacion → aprobado`** ([public/contratos/index.html:867](public/contratos/index.html#L867)): admin presses "approve". Two CFs fire on the same `onDocumentUpdated`:
   - `onContratoActivado` generates `firma_codigo`, `firma_hash` (HMAC-SHA256), `firma_url`, and **mirrors** the verification record to `verificaciones/{docId}` ([functions/index.js:595](functions/index.js#L595)).
   - `onContratoActivadoSendPdf` renders a Puppeteer PDF and emails it to `activaciones@cecomunica.com` + creator ([functions/index.js:699](functions/index.js#L699)).
2. **`aprobado → activo`** ([public/contratos/index.html:1458](public/contratos/index.html#L1458)): user uploads a signed PDF to Storage. `onContratoActivado` fires again because `["activo","aprobado"].includes(estadoAfter)` is true and runs an idempotent merge so verification stays consistent.
3. **`* → anulado`** ([functions/index.js:910](functions/index.js#L910)): `onContratoAnuladoNotify` enqueues a notification.

### 1.4 The real data flow for an order ↔ contract link

This is where the system is most fragile. Three independent paths can write to the contract's "summary fields" (`os_count`, `equipos_total`, `os_linked`, `os_serials_preview`, etc.):

1. **Frontend cache writer** in [public/ordenes/nueva-orden.html:414](public/ordenes/nueva-orden.html#L414) (`syncContratoCacheFromOrden`) — still present despite being marked as deprecated by `CONFIG.enableContratoFallbackSync = false` in [public/js/ordenes.state.js:65](public/js/ordenes.state.js#L65).
2. **`onOrdenWriteSyncContratoCache`** ([functions/index.js:1486](functions/index.js#L1486)) — fires on every order write and writes to both `contratos/{id}/ordenes/{orderId}` (cache subdoc) and the parent contract's summary fields (`os_linked`, `os_last_orden_id`, `os_serials_preview`, `os_has_equipos`, `os_equipos_count_last`).
3. **`onContratoOrdenWrite`** ([functions/index.js:1166](functions/index.js#L1166)) — supposed to apply deltas to `os_count` and `equipos_total` whenever the cache subdoc changes.
4. **`recalcularCacheContrato`** helper ([functions/index.js:1286](functions/index.js#L1286)) — full recompute, called on soft-delete, hard-delete, and contract-change.

These four paths overlap and are not coherent (see §3.1).

### 1.5 Email pipeline

There are **three** ways email is sent. The architecture doc only mentions one.

- **`sendMail`** HTTP function — referenced by `firebase.json` rewrite `/api/sendMail`, but no frontend code calls `/api/sendMail` (verified by grep). It is effectively dead from the client side.
- **`sendContractPdf`** HTTP function — protected by `x-api-key`, but again no frontend caller in `public/`. Dead from the client side; the live path is the trigger-based PDF flow.
- **`mail_queue` collection** — actively used. Five client locations enqueue documents (`nuevo-contrato.html`, `nueva-orden.html`, `firmar-entrega.html` x2, `trabajar-orden.html`), and the `onMailQueued` trigger picks them up. Server-side triggers (`onContratoActivadoSendPdf`, `onOrdenCompletada`, `onContratoAnuladoNotify`) also enqueue.

### 1.6 Authentication model

`verificarAccesoYAplicarVisibilidad` ([public/js/firebase-init.js:23](public/js/firebase-init.js#L23)) is the only access-control primitive on the frontend. It reads `usuarios/{uid}.rol` and passes the role string to a per-page callback. Every page reimplements its own role-to-UI mapping. There are **at least eight role names in active use**: `administrador`, `vendedor`, `tecnico`, `tecnico_operativo`, `recepcion`, `vista`, `inventario`, `jefe_taller`, plus the doc-mentioned `readonly` and `gerente` referenced in the security rules. There is no canonical list.

---

## 2. Documentation vs. Implementation — Inconsistencies

| Documented in `ARQUITECTURA_CECOMUNICA.md` | Actual repository state |
|---|---|
| 11 Cloud Functions: 2 HTTP + 9 triggers | **10 functions** in `index.js`; the doc misses `onContratoAnuladoNotify` and double-counts. The function list at the top of the doc differs from the section-by-section detail. |
| Firestore rules shown with `userRole()` helper, granular per-collection rules | No `firestore.rules` file exists in the repo. Rules are only deployed live; they are not in version control. The doc shows two contradictory versions of the rules block (lines 1162–1232 vs. 1289–1331). |
| `firestore.indexes.json` implied by architectural patterns | Not present. Composite-index errors are caught with a `failed-precondition` fallback in [public/js/services/ordenesService.js:332](public/js/services/ordenesService.js#L332). |
| Roles: `administrador / vendedor / tecnico / jefe_taller / readonly` | Code uses at least 8 roles; some are referenced only in rules, others only in UI. There is no authoritative enum. |
| "Cache always synchronized without manual intervention" via CFs | Frontend `syncContratoCacheFromOrden` is still alive in `nueva-orden.html` and writes the same cache subdoc the CF writes. |
| `sendMail` and `sendContractPdf` HTTP endpoints are how emails are sent from the UI | No frontend calls them; the live path is the `mail_queue` collection plus background triggers. |
| Contract states: `pendiente_aprobacion / activo / vencido / anulado` | Code uses `pendiente_aprobacion / aprobado / activo / anulado / inactivo`. The intermediate `aprobado` state and the "firmado upload activates contract" rule are not documented. |
| Module: "Cotizaciones" not in the architecture doc | `public/cotizaciones/` exists with four pages (~1900 LoC). |
| `equipos_meta` and `consumos` subcollections | Not used in current code; orders store equipment as an inline `equipos[]` array on the parent doc. |

---

## 3. Technical Debt, Duplication, and Fragile Areas

### 3.1 The contract-cache pipeline has a real correctness bug

[functions/index.js:1166](functions/index.js#L1166) declares `onContratoOrdenWrite` with `onDocumentUpdated`, but its body branches on `CREATE`, `UPDATE`, and `DELETE`. **`onDocumentUpdated` only fires on update**, never on create or delete, so the CREATE and DELETE branches are unreachable. Consequences:

- When the first order is linked to a contract, the cache subdoc is created, `onContratoOrdenWrite` does **not** fire, and `os_count` / `equipos_total` stay at their previous values.
- When `onOrdenHardDelete` removes a cache subdoc directly, `onContratoOrdenWrite` does not fire either; `recalcularCacheContrato` is the only thing that fixes the count.
- `os_linked`, `os_serials_preview`, `os_has_equipos`, `os_last_orden_id` are kept fresh by `onOrdenWriteSyncContratoCache`, but `os_count` and `equipos_total` drift until a soft-delete or cross-contract move forces `recalcularCacheContrato`. This explains the existence of the `os_dirty` flag, the `backfill-contract-summaries.js` script, and the `rebuild-all-contratos-cache.js` script — they are all there to repair the drift.

This single trigger choice is the root cause of "phantom 📦 icons" the doc alludes to.

### 3.2 Two competing cache-update strategies on the same fields

`onContratoOrdenWrite` does **delta** updates. `recalcularCacheContrato` does **full recompute** and is invoked from three different places. They write the same fields. There is no per-document lock; concurrent firings can race. With the bug above, recompute is the only path that ever produces a correct `os_count`, so the delta path is largely cosmetic.

### 3.3 Frontend cache writer that "should be" deprecated still runs

`CONFIG.enableContratoFallbackSync = false` is a flag in `ordenes.state.js`, but it is never checked. The `syncContratoCacheFromOrden` function in `nueva-orden.html` is unconditionally callable. Two clients writing the same cache fields means write order is undefined.

### 3.4 Service layer is half-built

[public/js/services/ordenesService.js](public/js/services/ordenesService.js) and [public/js/services/clientesService.js](public/js/services/clientesService.js) exist and are clean. They are loaded **only** by `ordenes/index.html`. Every other order, contract, client, inventory, PoC, and quotation page bypasses them. There is **no contract service**, **no inventory service**, **no PoC service**, **no email service**, **no auth/role service**.

### 3.5 Inline CSS and inline scripts

CSS is duplicated across pages. `contratos/index.html`, `nuevo-contrato.html`, `editar-contrato.html`, `clientes/index.html`, `inventario/index.html`, `POC/index.html` each carry their own variant of the "unified design system" rules. There is a shared `css/ceco-ui.css`, but most pages override it with inline styles.

### 3.6 Inconsistent number/totals model on contracts

Contracts persist both `total` and `total_con_itbms`. `sendContractPdf` reads `(after.total_con_itbms ?? after.total)`. `nuevo-contrato.html:1533` writes `total: tot.subtotal` (i.e. `total` and `subtotal` are the same number, while `total_con_itbms` is real). Consumers that read `total` get the wrong value. ITBMS rate `0.07` is hard-coded in 10 places.

### 3.7 Equipment field naming chaos

The CF `extractCacheData` already documents the problem in code: it tries `serial || SERIAL || numero_de_serie`, `modelo || MODEL || modelo_nombre`, and `descripcion || nombre || observaciones`. Each writer in the frontend chose a different convention. The CF normalizes on read; the writers do not normalize on write.

### 3.8 Migration tools live in the public site

[public/contratos/migrar-contratos.html](public/contratos/migrar-contratos.html), [public/contratos/migrar-cliente-nombre-lower.html](public/contratos/migrar-cliente-nombre-lower.html), [public/ordenes/migrar-fechas.html](public/ordenes/migrar-fechas.html), [public/clientes/fix-deleted-clientes.html](public/clientes/fix-deleted-clientes.html) are deployed alongside the production app. Anyone with a session and the URL can run them. They perform bulk writes.

### 3.9 Verification page has a duplicate `firebase-init.js`

[public/verify/firebase-init.js](public/verify/firebase-init.js) is a byte-for-byte clone of [public/js/firebase-init.js](public/js/firebase-init.js) but `verify/index.html` loads the absolute path `/js/firebase-init.js` — so the duplicate is dead code that will silently drift.

### 3.10 Public verification uses authenticated init

`verify/index.html` is supposed to work without login (this is the entire reason `verificaciones` exists with `allow read: if true`). But it loads `firebase-init.js`, which calls `setPersistence(LOCAL)` and `enablePersistence`. It does not call `verificarAccesoYAplicarVisibilidad`, so it will not redirect, but unrelated browser-storage failures (Safari ITP, third-party cookie blocks) still affect a public page that has no need for auth at all.

### 3.11 Secrets in repo

[firebase config firma secret.txt](firebase%20config%20firma%20secret.txt) contains the plaintext `FIRMA_SECRET` (the HMAC key used to sign every contract verification URL). [api- sendgrid.txt](api-%20sendgrid.txt) likewise. Neither is in `.gitignore`. **If this repository is or ever becomes public, every existing contract verification can be forged.** Even in private repos, this is a credential-rotation concern — every contributor with read access has the signing key.

### 3.12 Roles are not centralized

Role names are duplicated (and slightly different) in: per-page `verificarAccesoYAplicarVisibilidad` callbacks; the `visiblesPorRol` map in `index.html`; the `userRole()` helper in security rules; `OrdenesService.loadOrders` and `loadTechnicians`; and the `CONFIG.ROLES` enum in `ordenes.state.js`. The `ROLES` enum in `ordenes.state.js` is the most complete attempt, but it is not used outside the orders module.

### 3.13 Documentation that is stale, contradictory, or misleading

The repo carries seven Markdown docs (`CONTRACT_SUMMARIES_OPTIMIZATION.md`, `DEEP_IMPROVEMENTS_ALL_PAGES.md`, `FIRESTORE_SECURITY_RULES_CONTRATOS.md`, `IMPLEMENTATION_GUIDE_CONTRATOS_CACHE.md`, `ORDENES_CSS_CLEANING_PLAN.md`, `ORDEN_ELIMINACION_IMPLEMENTATION.md`, `QUICKSTART_CONTRACT_SUMMARIES.md`, `SEARCH_IMPLEMENTATION.md`, `VISUAL_IMPROVEMENTS_SUMMARY.md`, `ARQUITECTURA_CECOMUNICA.md`). Several describe future plans that were partially implemented; the architecture doc itself has internal contradictions (two different security-rule blocks; a function list that doesn't match the per-function detail). Future contributors will be misled.

### 3.14 No tests, no CI, no linting

`functions/package.json` declares `firebase-functions-test` but has no test scripts. `jsconfig.json` exists but no type checking is enforced. There is no CI configuration. Every change is shipped on faith.

---

## 4. Highest-Risk Parts of the System

Ranked by **(probability of breakage) × (cost when it breaks)**:

1. **Contract verification signature (`firma_hash`, `verificaciones/{docId}`).** Forgeable if `FIRMA_SECRET` leaks; the secret is in a tracked text file. The verification flow is the only thing that lets a customer trust the contract; a forged URL undermines the legal value of the digital signature.
2. **Contract approval cascade (`onContratoActivado`, `onContratoActivadoSendPdf`, `onContratoAnuladoNotify`).** Three triggers on the same document. If any one fails after the user clicks "approve", the doc moves to `aprobado` but downstream effects (PDF email, signature mirror) silently don't happen. There is no compensating action.
3. **Order ↔ contract cache pipeline.** Documented as the system's core invariant; in practice driven by an `onDocumentUpdated` trigger that misses CREATE and DELETE events (see §3.1). The visible UI cell on the contracts list (📦 icon, equipment count) depends on it.
4. **`mail_queue` collection.** The single channel for all client-facing email. A single misformed enqueue can stall the queue (no retry, no DLQ). Writers across five files compose HTML by string concatenation.
5. **PDF generation.** Puppeteer + headless Chromium running inside a Cloud Function, 1 GiB / 120 s budget. Cold starts and Chromium upgrades break PDFs first; the contract approval flow is the only consumer and there is no fallback.
6. **Migration pages on the live site.** `fix-deleted-clientes.html`, `migrar-*.html` — any logged-in user with the URL can mass-update production data.
7. **Inline 1.5k–2.5k-line scripts.** Every change to `contratos/index.html`, `POC/index.html`, `trabajar-orden.html`, or `nuevo-contrato.html` is a high-blast-radius change. There are no tests; regressions land in production.

---

## 5. Target Architecture

The goal is **structural** improvement, not a rewrite. The shape is:

```
public/
  index.html, login.html, perfil.html
  /modules/<module>/<page>.html      // thin shells, ≤300 lines
  /css/                              // single design system
    ceco-ui.css                      // already exists, expand
    components/                      // table, form, modal, chip, etc.
  /js/
    core/
      firebaseClient.js              // single Firebase init + db, auth
      auth.js                        // currentUser, role, session helpers
      roles.js                       // CONST ROLES + canRole(rol, action)
      errors.js                      // toast, logger
      formatting.js                  // ITBMS, money, dates
    services/                        // one per collection, all read+write
      contratosService.js
      ordenesService.js              // exists, expand
      clientesService.js             // exists, expand
      inventarioService.js
      piezasService.js
      pocService.js
      cotizacionesService.js
      mailService.js                 // wraps mail_queue.add()
      usuariosService.js
    domain/
      contratoState.js               // approval/cancel/activate state machine
      ordenState.js
      totales.js                     // ITBMS, totals
      equipoNormalize.js             // serial/modelo normalization
    pages/
      contratos-index.js             // glue per page
      contratos-nuevo.js
      ordenes-index.js               // exists
      ...
firestore.rules                      // tracked, code-reviewed
firestore.indexes.json               // tracked
functions/
  src/
    http/   sendMail.js, sendContractPdf.js
    triggers/
      contratos/
        onApproval.js                // signature mirror + send PDF, idempotent
        onAnnulment.js
      ordenes/
        onComplete.js                // technician stats + notify
        onWriteCacheSync.js          // single source of cache writes
      mail/
        onMailQueued.js
    domain/
      contractCache.js               // ONE function: rebuildContractCache(id)
      pdfRenderer.js                 // contract HTML→PDF
      emailRenderer.js               // mail_queue body builder
      verification.js                // HMAC, mirror write
    lib/
      firestore.js, mail.js, errors.js
  index.js                           // re-exports for Functions
```

### 5.1 Architectural rules of thumb

- **One way to do each thing.** One Firebase init. One mail-sending channel (`mail_queue`). One cache rebuilder. One ITBMS constant. One role enum. One contract approval implementation.
- **Cloud Functions own writes for sensitive fields.** Frontend never writes `firma_*`, `os_count`, `equipos_total`, `os_serials_preview`, etc. Rules enforce this.
- **Services own all Firestore I/O.** Pages render and dispatch; services read/write. No `db.collection(...)` in any HTML file or page-level script.
- **Domain modules own business rules.** State transitions, totals, normalization live in `js/domain/*` and `functions/src/domain/*`. Pages and CFs both call them.
- **No build step yet.** Stay on plain ES modules + compat SDKs to avoid forcing a bundler in this iteration. The reorganization is achievable without webpack/vite.

### 5.2 Single source of truth for the contract-↔-orders cache

Replace the current four-path system with **one** trigger and **one** rebuild function:

- `onOrdenWritten` (use `onDocumentWritten`, not Updated) → calls `rebuildContractCache(contratoId)` for both the old and new contract (when applicable). Idempotent. Writes the cache subdoc and all `os_*` summary fields together inside a single transaction.
- Delete `onContratoOrdenWrite`. Delete `onOrdenHardDelete` (covered by `onDocumentWritten` — the "after = null" case is the delete). Delete `recalcularCacheContrato` as a separate helper; fold it into `rebuildContractCache`.
- Delete `syncContratoCacheFromOrden` from `nueva-orden.html`. Lock down the cache subcollection in rules (already documented).

This eliminates §3.1, §3.2, and §3.3 in one move.

### 5.3 Contract state machine, formalized

Move the `pendiente_aprobacion → aprobado → activo → anulado` transitions into a single `domain/contratoState.js` module on both ends. Each transition exposes:

- a frontend method that enforces preconditions and calls a `contratosService.transition(id, action)`
- a backend invariant in rules (only admins move to `aprobado`/`activo`; only the system writes `firma_*`)
- a backend side-effect set (sign + mirror + email PDF) wired to **one** trigger that owns the whole "approval finished" event, idempotent.

The current split between `onContratoActivado` and `onContratoActivadoSendPdf` should remain split for memory/timeout isolation (PDF generation needs 1 GiB), but both should consume the same canonical "approved" event so a failure in one doesn't desynchronize the other.

### 5.4 Public verification page must be auth-free

`verify/` should load a separate, minimal `firebase-public.js` that initializes only Firestore (no Auth, no persistence). Hosting should serve it under a different cache header policy (long-cache static, no `no-store`). The duplicate `verify/firebase-init.js` is removed.

---

## 6. Phased Refactor Plan

The phasing is ordered so each phase **stands alone**, can be shipped independently, and reduces risk for the next phase. No phase requires a "big bang".

### Phase 0 — Stop the bleeding (1–2 days, no behavior change)

The cheapest, highest-ROI work. Do this before anything else.

1. **Rotate `FIRMA_SECRET` and `SENDGRID_API_KEY` immediately**, then delete `firebase config firma secret.txt` and `api- sendgrid.txt`, add `*.txt` and explicit names to `.gitignore`, and rewrite git history (`git filter-repo`) to scrub them from the history. Without rotation, scrubbing history alone is meaningless.
2. **Track `firestore.rules` and `firestore.indexes.json`** in the repo. Pull current rules from the live project (`firebase firestore:rules:get` / console export), commit, and add to `firebase.json` so they are deployed from the repo. This is non-disruptive and instantly brings rules under code review.
3. **Move migration pages out of `public/`** to a `tools/` directory that is not deployed (add to `firebase.json` `hosting.ignore`). They remain runnable locally for the admin who needs them.
4. **Delete the duplicate `public/verify/firebase-init.js`** (`verify/index.html` already loads the canonical path).
5. **Add a minimal CI step** (GitHub Actions or similar) running `eslint`, `firebase deploy --only firestore:rules --dry-run`, and a `node -c` syntax check on `functions/index.js`. Even a smoke-level CI catches the kind of typos that already escape into production.

These steps do not touch product code. They are safe to ship the same day.

### Phase 1 — Fix the cache trigger bug (3–5 days)

The single most important behavioral fix. Owner: backend.

1. Replace `onContratoOrdenWrite` (`onDocumentUpdated`) with the unified `onOrdenWritten` (`onDocumentWritten`) in §5.2. Until the unification lands, a one-line fix is to change `onContratoOrdenWrite` to `onDocumentWritten` so the `CREATE`/`DELETE` branches actually run. This is a hotfix; the unification can follow.
2. Run the existing `rebuild-all-contratos-cache.js` once, post-deploy, to clear drift accumulated since the bug was introduced.
3. Remove `syncContratoCacheFromOrden` from `nueva-orden.html`.
4. Tighten Firestore rules so `os_*` fields and the cache subcollection are write-only by Functions (the doc claims this; verify and enforce).

Safety: every step is reversible — the rebuild script is idempotent, and the deprecated frontend code being removed is already dead under `CONFIG.enableContratoFallbackSync = false`.

### Phase 2 — Centralize core primitives (1 week)

Create `public/js/core/` with `firebaseClient.js`, `auth.js`, `roles.js`, `formatting.js`. Rewrite the four most-touched pages to load these instead of inline equivalents:

- `contratos/index.html`
- `ordenes/index.html` (already partially done)
- `clientes/index.html`
- `POC/index.html`

This phase introduces the conventions the rest of the migration will use, on the four pages that drive the most traffic.

### Phase 3 — Service layer for contracts and orders (1–2 weeks)

Build `contratosService.js` (mirror the pattern of `ordenesService.js`) and a `mailService.js` that wraps every `mail_queue.add(...)` call. Migrate the contract approval flow and all `mail_queue.add` callsites to use these services. After this phase, no HTML file should contain `db.collection("contratos")` or `db.collection("mail_queue")`.

### Phase 4 — Remaining services (PoC, inventario, piezas, cotizaciones, clientes write paths) (2–3 weeks)

Same pattern, lower priority pages. Done page-by-page; each migration is small and reviewable.

### Phase 5 — Script decomposition *(complete through 5e — 2026-05-08)*

Phase 5 has five distinct sub-goals, all completed. A Phase 5f for the remaining smaller page scripts is optional and lower-priority.

#### Phase 5a — Script extraction from HTML *(done — 2026-05-06)*

Move inline `<script>` blocks out of HTML into `js/pages/<name>.js`, loaded with `<script src defer>`. Pages should reach ≤300 lines of HTML.

**Done (6 files):**

| File | Inline lines extracted | JS file |
|---|---|---|
| `contratos/index.html` | ~1 690 | `js/pages/contratos-index.js` |
| `contratos/nuevo-contrato.html` | ~1 161 | `js/pages/nuevo-contrato.js` |
| `POC/index.html` | ~1 600 | `js/pages/poc-index.js` |
| `ordenes/trabajar-orden.html` | ~1 174 | `js/pages/trabajar-orden.js` |
| `POC/vendedores-batch.html` | ~890 | `js/pages/vendedores-batch.js` |
| `inventario/piezas.html` | ~751 | `js/pages/piezas.js` |

**Remaining — Tier 1 (> 300 lines inline, extract next):**

| File | Inline lines |
|---|---|
| `clientes/index.html` | 628 |
| `ordenes/fotos-taller.html` | 535 |
| `ordenes/editar-orden.html` | 471 |
| `cotizaciones/editar-cotizacion.html` | 407 |
| `contratos/imprimir-contrato.html` | 396 |
| `ordenes/nueva-orden.html` | 390 |
| `ordenes/agregar-equipo.html` | 354 |
| `inventario/index.html` | 329 |
| `cotizaciones/nueva-cotizacion.html` | 316 |
| `inventario/modelos.html` | 314 |
| `cotizaciones/index.html` | 269 |

**Remaining — Tier 2 (150–300 lines, extract when touching the file anyway):**

`ordenes/firmar-entrega.html` (249), `contratos/nuevo-cliente.html` (241), `ordenes/progreso-tecnicos.html` (221), `contratos/editar-contrato.html` (192), `POC/nuevo-batch.html` (192 + 126), `ordenes/importar-exportar.html` (191), `ordenes/cotizar-orden.html` (188), `ordenes/cotizar-orden-formal.html` (181), `POC/nuevo-equipo.html` (168), `ordenes/imprimir-orden.html` (161)

**Remaining — Tier 3 (< 150 lines, leave inline):**

`POC/editar-batch.html`, `clientes/editar.html`, `POC/imprimir-equipos.html`, `ordenes/modelo-de-radio.html`, `cotizaciones/imprimir-cotizacion.html`, `ordenes/reporte-pendientes.html`, `ordenes/estado_reparacion.html`, `POC/importar-poc.html`, `ordenes/tecnicos.html`, `inventario/vista-correo.html`, and 4 more small pages.

---

#### Phase 5b — Eliminate local duplicates of core utilities *(done — 2026-05-06/08)*

The extracted page scripts redefine utilities that already exist in `js/core/`. These local copies should be deleted and calls routed to the canonical modules. No new files needed — this is pure cleanup inside the `js/pages/` files.

| Duplicate pattern | Files affected | Fix |
|---|---|---|
| Local `fmt(n)` / `fmtMoney(n)` | `contratos-index.js`, `nuevo-contrato.js`, `trabajar-orden.js` | Delete; use `FMT.money(n)` |
| Local `round2(n)` | `contratos-index.js`, `nuevo-contrato.js` | Delete; use `FMT.round2(n)` |
| Local `normalizar(s)` / `norm(s)` | `nuevo-contrato.js`, `vendedores-batch.js` | Add `FMT.normalize(s)` to `formatting.js`; replace local copies |
| Local role checks (`rolActual === "administrador"`) | `contratos-index.js`, `poc-index.js` | Replace with `AUTH.is(ROLES.ADMIN)` |
| Local `getCurrentRole()` | `contratos-index.js` | Delete; use `AUTH.getRole()` |

---

#### Phase 5c — Shared UI primitives *(done — 2026-05-07)*

Four different toast/notification implementations exist across the page scripts. Eight modal open/close pairs use identical patterns. Both can be replaced with a single module each.

**`js/ui/toast.js`**

Replaces: `mostrarMensaje()` in `contratos-index.js`, `showToast()` in `nuevo-contrato.js` and `trabajar-orden.js`, `toast()` in `vendedores-batch.js` and `piezas.js`.

Single API: `Toast.show(message, type)` where `type` is `"ok" | "bad" | "warn" | "info"`. Auto-removes after configurable timeout. Exposes `Toast.persist(message, type)` for messages that require manual dismissal.

**`js/ui/modal.js`**

Replaces 8 modal open/close pairs across `contratos-index.js`, `nuevo-contrato.js`, `poc-index.js`, `trabajar-orden.js`, `piezas.js`. All use the same pattern: set `display`, optionally add `lock-scroll` to body, wire/unwire an Escape key handler.

Single API: `Modal.open(id, options?)` / `Modal.close(id)`. Options: `{ lockScroll, onEscape }`.

---

#### Phase 5d — Domain logic extraction *(done — 2026-05-07)*

Business rules that have no DOM dependency and are currently duplicated or buried inside page scripts. Extracting them makes them testable and shared across pages.

**`js/domain/totales.js`**

Replaces: `resolverTotalesContrato()` in `contratos-index.js` and `recalcularTotalesContrato()` in `nuevo-contrato.js`. Both compute `subtotal → ITBMS → total` with a 7% fallback. One canonical function with the signature:

```js
// Returns { subtotal, itbms, total }
ContractTotals.calculate(equipos, itbmsRate = FMT.ITBMS_RATE)
```

**`js/domain/scoring.js`**

Extracts: `scorePieza(pieza, query)` and `filtrarPiezas(piezas, query)` from `trabajar-orden.js`. Pure ranking logic for the parts recommendation system — no DOM dependency, directly testable.

**Target after 5b–5d:** Each `js/pages/` file shrinks by ~150–300 lines (mostly removed duplicates and extracted logic). The six existing page scripts should all reach ≤ 900 lines; the largest ones (`contratos-index.js`, `poc-index.js`) should reach ≤ 1 100 lines before any further structural split.

---

#### Phase 5e — Namespace split of large page scripts *(done — 2026-05-08)*

Split the five largest extracted page scripts from global-function soup into proper `window.Namespace` objects so each file has a single responsibility and the global scope stays clean.

**Done:**

| Original file | Lines | Result |
|---|---|---|
| `contratos-index.js` | ~1 075 | `contratos-state.js` · `contratos-approval.js` · `contratos-upload.js` · `contratos-equipos.js` · `contratos-list.js` + thin coordinator |
| `poc-index.js` | ~550 | `poc-state.js` · `poc-list.js` · `poc-bulk.js` · `poc-edit.js` · `poc-sim.js` + thin coordinator |
| `trabajar-orden.js` | ~1 174 | `to-state.js` · `to-cotizacion.js` · `to-servicio.js` · `to-equipos.js` · `to-pieza.js` + ~89-line coordinator |
| `nuevo-contrato.js` | 1 075 | `nc-state.js` · `nc-form.js` · `nc-combo.js` · `nc-preview.js` · `nc-guardar.js` + ~32-line coordinator |
| `vendedores-batch.js` | 872 | `window.VB` single namespace + ~20-line coordinator |

**Remaining (optional Phase 5f — lower priority):**

| File | Lines | Notes |
|---|---|---|
| `piezas.js` | 747 | Still global functions; good candidate for `window.Piezas` |
| `clientes-index.js` | 628 | Still global functions |
| `fotos-taller.js` | 535 | Still global functions |
| `editar-orden.js` | 471 | Still global functions |
| `contratos-list.js` | 667 | Already a namespace (`ContratosLista`) — large but single-concern; leave as-is |
| `poc-list.js` | 552 | Already a namespace (`PocList`) — leave as-is |

---

### Phase 6 — Backend modularization (1–2 weeks)

Split `functions/index.js` into the structure shown in §5. No behavior change, but changes to the email pipeline or contract triggers stop touching an 1800-line file.

### Phase 7 — Domain hardening (ongoing)

- Canonical equipment normalization on **write** (currently only on read).
- Single ITBMS constant, single totals function, used by frontend and backend.
- Canonical contract state machine, with all transitions guarded server-side.
- Canonical role enum and a `can(action, role)` predicate.

### Phase 8 — Tests, observability, and runbook (ongoing)

- Unit tests for `contratosService`, `ordenesService`, `domain/totales`, `domain/contratoState`, the cache rebuilder.
- An integration test for the contract approval cascade against the Firebase emulator.
- A small ops dashboard that surfaces `mail_queue.status === "error"` and CF error rates.

---

## 7. What Must NOT Be Changed Early — Critical Paths

Refactoring these in early phases will break the business. Touch them only after services and tests are in place.

1. **The contract verification flow (`/c/{docId}?v={code}` and the `verificaciones` collection schema).** It is consumed by URLs already issued to customers and printed on PDFs that have already left the building. Any change to the document ID, code generation, or HMAC payload format **invalidates all existing signed contracts**. Treat the schema as a compatibility contract.
2. **`firma_hash` payload format** (`${contratoId}|${aprobadorUid}`). Same reasoning. If this needs to change, it must change additively (compute a new field, leave the old one).
3. **`mail_queue` document shape.** Multiple writers and one reader. Change adds, never removes.
4. **The `usuarios/{uid}` document shape**, especially the `rol` field. Every page reads it. Add new role values cautiously and only after every consumer accepts them.
5. **Order/contract document IDs.** Several places use the Firestore docId as the verification ID. The auto-incremented `contrato_id` (`CT-YYYY-NNN`) and `numero_orden` strings are user-facing identifiers that show up in emails, PDFs, and external communications. Don't renumber.
6. **The PDF template (`functions/templates/imprimir-contrato.html`).** It is the legal document delivered to customers. Visual changes risk confusing customers who cross-reference old PDFs. Prefer additive edits (new sections) over restructuring.
7. **The set of Cloud Function names.** Changing names triggers a CF rebuild and a brief gap during which old triggers detach before new ones attach. For triggers on hot paths (`onMailQueued`, `onOrdenWriteSyncContratoCache`), schedule the rename during a low-traffic window.

---

## 8. Where Standardization Will Have the Biggest Impact

In order of expected ROI:

1. **Single Firestore-access layer.** Eliminates ~188 inline `db.collection(...)` calls. Prerequisite for any serious testing, role-based access enforcement, or future schema migration.
2. **Single role enum + `can()` predicate.** Eight role names, three role mappings, no canonical source. Wrong role checks already produce subtle bugs (the orders service distinguishes `tecnico` vs. `tecnico_operativo` while other pages do not).
3. **Single email pipeline.** Move all callers to `mailService.enqueue(...)`. Stops people from inventing new HTML-by-string-concat blobs in each page.
4. **Single totals/ITBMS module.** ITBMS rate hard-coded in 10 places. Any tax change today is a 10-place edit that nobody will fully complete.
5. **Single equipment normalization.** Currently the CF normalizes on read, writers do not. Move normalization to the write path (in services) so reads can trust the data.
6. **Single design system.** Consolidate inline `<style>` blocks into `ceco-ui.css` components. Reduces the per-page size by 200–600 lines.
7. **Single Cloud Function file structure.** Split `index.js`. Cuts the cost of every backend edit.

---

## 9. Reducing Risk During the Refactor

### 9.1 Process

- **Ship one module at a time.** Each phase, each service, each page is independently deployable. A Phase 3 contract-service rollout doesn't depend on Phase 4 inventory work being done.
- **Run old and new in parallel where possible.** When introducing `contratosService.transition(id, "approve")`, leave the page's old direct write path under a feature flag so a rollback is one config change. The pattern already used (`enableContratoFallbackSync`) is fine — but **flags must actually be checked**; today's flag is dead.
- **Branch hygiene.** No "big rename" PRs. Each PR addresses one page or one CF and has a focused diff.
- **Migration scripts run from a local machine, never the deployed site.** Move them out of `public/`. Include a `--dry-run` for every script (the `backfill-contract-summaries.js` script already does this; mirror that).
- **Keep schema additive.** Never rename a Firestore field in a refactor PR. Add the new field, dual-write, migrate readers, then a separate PR removes the old field months later.

### 9.2 Technical safeguards

- **Stage rules changes.** Whenever rules tighten, deploy with `firestore:rules` first and observe the Firebase console rule-deny rate for at least 24 hours before tightening further. Most rule changes are reversible only with another deploy, and a 5-minute outage from a too-strict rule is plausible.
- **Idempotent triggers.** Every trigger refactor preserves idempotency. The CF `onContratoActivado` already does this correctly (checks `needsRepair`); use it as the pattern.
- **Dual-write for cache during the cache-pipeline rewrite.** Ship the new `rebuildContractCache` alongside the old code, write the same fields with both paths, compare via Cloud Logging for a week, then remove the old code.
- **Smoke test the contract approval flow on every backend deploy.** A scripted approval of a test contract in a non-prod project + assert that `verificaciones/{id}` exists and `firma_hash` validates. This single test would have caught the `onContratoOrdenWrite` bug.
- **Emulator-based regression tests** for the highest-risk triggers (`onContratoActivado`, the cache pipeline, `onMailQueued`). The dependency on `firebase-functions-test` is already declared in `package.json`; nothing currently uses it.

### 9.3 Communication

- **Document the *real* state machine** (states, transitions, who can move them, what each transition triggers) and put it next to the code. Replace `ARQUITECTURA_CECOMUNICA.md` rather than adding more docs alongside it.
- **Maintain a CHANGELOG** at the root. Each refactor PR adds an entry. Future contributors can see the order in which things changed.
- **Tag the start of the refactor.** A `pre-refactor-2026-05` git tag gives a clean rollback point.

---

## 10. Summary

The system works today because of careful manual operations and several rebuild scripts that paper over a fragile cache pipeline, not because the architecture is sound. The diagram in `ARQUITECTURA_CECOMUNICA.md` is approximately accurate, but the real system is messier in three structurally important ways: (1) frontend pages own too much logic and duplicate it; (2) Cloud Functions own correct writes but with a real correctness bug in the cache trigger; (3) a signing secret is in the repo.

A pragmatic refactor that fixes the secret leak and the trigger bug first (Phase 0–1, ~1 week), then introduces a real service layer page-by-page (Phases 2–4, ~6 weeks), then modularizes the backend (Phase 6, ~2 weeks), will leave the system measurably more reliable without ever requiring a feature freeze or a rewrite. The critical-path constraints in §7 should bound every PR.
