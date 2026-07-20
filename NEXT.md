# Next

> The actionable backlog: items with a clear next step that someone could pick up
> today. Anything deferred for a future refactor, build step, or external trigger
> isn't here — it lives in commit history. Items below are ordered roughly by
> leverage × cost: top items have the biggest payoff for the least effort.
>
> **Shipped work:** `CHANGELOG.md`
> **Architecture as-is:** `ARQUITECTURA_CECOMUNICA.md`
> **Critical paths to touch carefully:** see end of this file.
>
> **Last refreshed:** 2026-05-19.

---

## 1. Minimum CI — *~1 hour, highest leverage* — ✅ HECHO

> **2026-07-20:** `.github/workflows/ci.yml` corre en cada push/PR: sintaxis de
> todo `public/js` y `functions` (`node --check`), carga de `functions/index.js`,
> lint + unit tests de functions, y reglas + contador contra el emulador de
> Firestore. Primer run disparado con el push de 3da9c29.

<details><summary>Propuesta original</summary>

The repo has no automated guard. Recent weeks have shipped hundreds of edits with no syntax/lint check; the only protection has been careful manual review.

A minimal GitHub Actions workflow that runs on every PR:
- `node --check` over every JS file under `public/js/` and `functions/`
- `eslint` with a baseline config (existing `jsconfig.json` is a starting point)
- `firebase deploy --only firestore:rules --dry-run` against `firestore.rules`

That much would catch typos, missing semicolons, syntax breakage, and rules regressions — the failure modes that have actually bitten this codebase. Unit tests and emulator-integration tests (`firebase-functions-test` is already a `functions/package.json` dependency) are a follow-on, not a prerequisite.

---

## 2. Extract `firebase-public.js` for `verify/index.html` — *~30 min, affects external customers*

`verify/index.html` is the public contract-verification page consumed by URLs already in customers' inboxes and printed on PDFs. It's supposed to work without login (the whole reason `verificaciones` has `allow read: if true` in `firestore.rules`).

It currently loads `js/firebase-init.js`, which calls `setPersistence(LOCAL)` and `enablePersistence`. Both fail silently in:
- Safari with ITP storage restrictions
- Any private/incognito browsing window
- Browsers blocking third-party cookies

The page doesn't redirect (no auth check), so the auth init isn't strictly needed — but `enablePersistence`'s IndexedDB failure can prevent the Firestore read from completing.

**Fix:** extract a minimal `public/js/firebase-public.js` that initializes the app + Firestore only (skip auth, skip persistence). Update `verify/index.html` to load it instead of `firebase-init.js`.

---

## 3. Verify `enablePersistence` actually applies on Safari — *~15 min smoke test*

Companion to the item above, but for the *authenticated* app pages (which also load `firebase-init.js`). Open the app in Safari (and in Chrome incognito) while DevTools → Application → IndexedDB is open. Confirm `firestore/firestoreClientPersistence` shows up as an active database. If it doesn't, persistence is silently disabled and offline-on-the-lot field-tech behaviour quietly breaks.

If it's working: close this item with a note. If it's not: file a follow-up to either (a) add a service-worker-based cache for the last 100 orders + static assets, or (b) document the limitation and switch the affected pages to network-only.

---

</details>

## 4. PII retention customer notice — *DECISIÓN 2026-07-20: EN PAUSA*

> El negocio decidió **mantener los archivos de identificación — no se borra
> nada por ahora**. `purgePIIRetention` sigue siendo callable manual y NO debe
> convertirse a cron ni ejecutarse. Re-evaluar cuando el negocio lo pida.

<details><summary>Contexto original (para cuando se retome)</summary>

The `purgePIIRetention` Cloud Function clears `identificacion_url` from delivery records after 90 days. It's currently a **manual callable** rather than `onSchedule` because stakeholders want a customer-visible retention notice in place before the first automated run.

**Action (not code):** coordinate with whoever writes the legal/customer-facing copy. A short note in the customer portal / contract confirmation email along the lines of "We store ID-photo evidence of delivery for 90 days, then auto-delete it. Contact us to request earlier deletion." closes this out.

Once the notice exists, revert the CF to `onSchedule` (was the original design — see commit history for the conversion).

---

## Critical paths — touch only with care

These are *not* refactor candidates — they are operational guardrails for any future change.

1. **Contract verification flow** — `/c/{docId}?v={code}` and `verificaciones/{docId}`. Consumed by URLs already issued to customers and printed on PDFs that have left the building. Any change to docId, code generation, or HMAC payload **invalidates existing signed contracts**.
2. **`firma_hash` payload format** — `${contratoId}|${aprobadorUid}`. Same reasoning. Add new fields; never change the existing one.
3. **`mail_queue` document shape** — multiple writers, one reader. Add fields; never remove.
4. **`usuarios/{uid}.rol` field** — every page reads it. New role values added cautiously, only after every consumer accepts them.
5. **Order / contract document IDs** — used as verification IDs in some places. `contrato_id` (`CT-YYYY-NNN`) and `numero_orden` are user-facing in emails and PDFs.
6. **PDF template `functions/templates/imprimir-contrato.html`** — legal document. Additive edits only.
7. **Cloud Function names** — renaming triggers a CF rebuild with a brief gap between detach + attach. Hot triggers (`onMailQueued`, `onOrdenWriteSyncContratoCache`) rename only in low-traffic windows.

---

## Decisions on file — explicitly not pursuing

| Item | Decision | Reason |
|---|---|---|
| Bulk operations on órdenes | Not pursuing (2026-05-18) | Orders managed one at a time today. Re-evaluate if sustained 10+/day batch flow appears. |
| SVG signature on entrega | Not pursuing (2026-05-18) | PNG with DPR scaling is sufficient. Re-evaluate only if entrega becomes legally critical (notarized receipts, court-admissible delivery proof). |
| Scheduled cron for PII retention | Converted to manual callable (2026-05-18) | Stakeholders want to review before any first run. Revert to `onSchedule` once item §4 above is closed. |
