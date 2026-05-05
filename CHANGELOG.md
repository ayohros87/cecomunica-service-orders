# Changelog

## [Phase 2] — 2026-05-05

### Refactor
- Created `public/js/core/roles.js` — canonical `ROLES` enum and `canRole(rol, accion)` predicate; single source of truth for all role names
- Created `public/js/core/formatting.js` — `FMT` global with `ITBMS_RATE`, `money()`, `round2()`, `date()`, `datetime()`, `calcITBMS()`
- Created `public/js/core/auth.js` — `AUTH` global with `is()`, `isAny()`, `getRole()`, `getUser()`, `requireAccess()`
- Migrated `contratos/index.html` to core modules: loads all three core scripts, replaced `function round2()` with `FMT.round2`, replaced `0.07` ITBMS fallback with `FMT.ITBMS_RATE`, replaced all `window.userRole ===` and role string literals with `AUTH.is()` and `ROLES.*`
- Migrated `ordenes/index.html` + `ordenes-index.js` to core modules: loads all three core scripts, removed `CONFIG.ROLES` from `ordenes.state.js` (superseded by `window.ROLES`), replaced all role string literals in `ordenes-index.js` with `ROLES.*`
- Migrated `clientes/index.html` to core modules: loads all three core scripts, replaced `'administrador'`, `'recepcion'`, `'vendedor'`, `'vista'` literals with `ROLES.*`; legacy `'admin'` and `'editor'` values left intact (undocumented roles live in Firestore)
- Migrated `POC/index.html` to core modules: loads all three core scripts, replaced all role literals with `ROLES.*`

## [Phase 1] — 2026-05-05

### Bug Fixes
- Fixed `onContratoOrdenWrite` using wrong trigger type (`onDocumentUpdated` → `onDocumentWritten`) — CREATE and DELETE branches were unreachable, causing `os_count` and `equipos_total` to never update when an order was first linked or deleted from a contract (root cause of phantom 📦 icon bug)
- Removed `syncContratoCacheFromOrden` from `nueva-orden.html` — duplicate frontend cache writer that raced with the Cloud Function doing the same write
- Ran `rebuild-all-contratos-cache.js` post-deploy to repair drift in 63 contracts / 67 orders accumulated before the fix
- Added `--dry-run` CLI flag to `rebuild-all-contratos-cache.js` (was previously a hardcoded constant)

### Security
- Tightened Firestore rules: extracted `touchesCFOwnedFields()` helper blocking frontend writes to `firma_*`, `os_*`, `equipos_total`, and `tiene_os` fields on contracts
- Added `contratos/{id}/ordenes/{ordenId}` read-only rule — cache subcollection is now exclusively writable by Cloud Functions via admin SDK

## [Phase 0] — 2026-05-05

### Security
- Deleted `firebase config firma secret.txt` and `api- sendgrid.txt` (plaintext credentials were untracked but on disk)
- Added `.gitignore` rules to permanently exclude secret files, credential files, and backup archives

### Infrastructure
- Initialized git repository and pushed to GitHub (private, `ayohros87/cecomunica-service-orders`)
- Added `pre-refactor-2026-05` tag as a clean rollback point
- Added `.gitattributes` to normalize all line endings to LF
- Added `firestore.rules` to version control (previously only existed in the live Firebase project)
- Added `firestore.indexes.json` to version control (pulled from live project via CLI)
- Wired `firestore` section in `firebase.json` so rules and indexes deploy from the repo via `firebase deploy`

### Cleanup
- Moved migration and dev-only pages out of the deployed hosting root into `public/tools/`:
  - `contratos/migrar-contratos.html`
  - `contratos/migrar-cliente-nombre-lower.html`
  - `ordenes/migrar-fechas.html`
  - `clientes/fix-deleted-clientes.html`
  - `before-after.html`
  - `demo-improvements.html`
- Added `tools/**` to `firebase.json` `hosting.ignore` so these pages are never deployed
- Deleted `public/verify/firebase-init.js` (byte-for-byte duplicate of `public/js/firebase-init.js`; `verify/index.html` already loaded the canonical path)
