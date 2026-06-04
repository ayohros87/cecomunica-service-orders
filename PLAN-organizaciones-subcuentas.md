# Plan de trabajo — Organizaciones y subcuentas de clientes

> Objetivo: permitir que un cliente real con **varias cuentas** se modele como una
> **Organización** (matriz) con **subcuentas** (los `clientes` actuales), de forma
> **explícita y administrable**, sin afectar contratos, órdenes de servicio ni equipos POC.

Estado: **Fases 0–4 implementadas** (Fase 5 opcional pendiente). Fecha: 2026-06-04.

> Avance: ✅ Fase 0 (cimientos) · ✅ Fase 1 (picker + form) · ✅ Fase 2 (lista) ·
> ✅ Fase 3 (admin) · ✅ Fase 4 (backfill + revisión) · ⬜ Fase 5 (pulido opcional).
> Pendiente operativo: desplegar `firestore:indexes`, `firestore:rules` y `functions`
> antes de usar la lista agrupada y el backfill en producción.

---

## 0. Modelo v2 — la organización como entidad fiscal (rehaul)

> El modelo v1 (Fases 0–4) trata la organización como una **etiqueta** que agrupa
> clientes. Se sentía "crudo" porque la entidad real (RUC, razón social, representante,
> ITBMS) vivía duplicada en cada cuenta y la org no poseía nada. v2 **invierte la
> propiedad de los datos**.

**Decisiones (confirmadas):** una organización = **una entidad legal = un RUC**.
Rehacer el modelo (no solo herencia al crear).

**Quién posee qué:**

| Dato | Dueño (fuente de verdad) |
|---|---|
| RUC, DV, razón social, representante legal + cédula, régimen ITBMS | **Organización** |
| Alias/nombre de sede, dirección, dirección de facturación, contacto local | **Cuenta** (`clientes`) |

**Compatibilidad (no romper contratos/órdenes/POC):** la org es la fuente de verdad;
los campos fiscales siguen existiendo en cada `clientes` como **espejo sincronizado
hacia abajo** (org → cuentas). Contratos/órdenes/POC leen `cliente.ruc`, etc. igual que
hoy, ahora siempre consistente. La sincronización corre al editar la ficha fiscal de la
org y al asignar una cuenta.

**Identidad de la cuenta (decisión delicada — pendiente de confirmar):**
¿`cliente.nombre` de una sede pasa a ser la **razón social** de la org (y la sede se
distingue con `cuenta_alias`), o conserva su propio nombre? Recomendado: `cliente.nombre`
= razón social (espejo) + `cuenta_alias` = sede. No afecta contratos existentes (guardan
su propio snapshot de `cliente_nombre`). **Hasta confirmar, el rehaul NO sobrescribe
`cliente.nombre`.**

**Slices del rehaul:**
- **v2-A** ✅/🔨 Org posee ficha fiscal: `buildOrgPayload` + campos; `actualizarFichaFiscal`
  (edita org y sincroniza cuentas); form fiscal editable en la página admin.
- **v2-B** ⬜ Trigger `onWrite organizaciones` → re-sync de cuentas (hardening del sync).
- **v2-C** ⬜ Form de cliente: al elegir org (o RUC conocido) hereda y **bloquea** los
  campos fiscales; solo se editan los de sede.
- **v2-D** ⬜ Backfill v2: la org absorbe la ficha fiscal canónica del grupo de RUC.
- **v2-E** ⬜ Confirmar identidad de la cuenta (`nombre` = razón social) y aplicarlo.

---

## 1. Decisiones ya tomadas

- **Modelo explícito** (colección `organizaciones` + `clientes.organizacionId`), no agrupación implícita por RUC.
- **Página admin dedicada** para crear / renombrar / fusionar / asignar (estilo `admin/grupos.html`).
- **Backfill + revisión**: script que propone organizaciones por RUC compartido y genera un **reporte (dry-run)** antes de aplicar.
- **Creación reutilizable**: poder crear/asignar la organización desde el form de cliente que ya comparten todos los módulos (clientes, contratos, cotizaciones), para no duplicar trabajo.
- **No impacto** en contratos, órdenes de servicio y equipos POC.

---

## 2. Garantía de no-impacto (contratos / órdenes / POC)

Estos módulos referencian al cliente por **`clienteId` (id del doc)** y guardan un *snapshot*
de campos (`nombre`, `ruc`, `dv`, `direccion`, `itbms_*`, etc.).

El cambio es **100% aditivo**:
- Se **agregan** campos nuevos a `clientes` (`organizacionId`, `organizacion_norm`) y una **colección nueva** (`organizaciones`).
- **No** se cambian ids de documentos, **no** se renombran ni eliminan campos existentes.
- `organizacionId` **nunca** es leído ni requerido por contratos/órdenes/POC.

Reglas de oro durante la implementación:
- **No tocar** `ordenesService.js`, `contratosService.js`, `pocService.js` ni sus flujos de creación.
- El "grupos" de POC (`admin-grupos.js`, grupos de **equipos** dentro de un cliente) es un concepto **distinto** y no se mezcla con organizaciones de clientes.

---

## 3. Modelo de datos

### 3.1 Nueva colección `organizaciones`
```
organizaciones/{orgId}
  nombre            string
  nombre_norm       string        // lower + sin acentos
  ruc               string?       // opcional (si las subcuentas comparten RUC)
  ruc_norm          string?
  searchTokens      string[]      // mismo esquema que clientes
  activo            bool
  deleted           bool
  created_at/by, updated_at/by
  // Espacio para crecer (no en v1): vendedor_asignado, contacto, notas…
```

### 3.2 Campos nuevos en `clientes`
```
organizacionId     string|null   // null = cuenta suelta (comportamiento actual)
organizacion_norm  string        // nombre de la org denormalizado (display/búsqueda sin join)
cuenta_alias       string        // YA EXISTE — etiqueta de la subcuenta ("Sucursal Colón")
```
- `organizacion_norm` se denormaliza para listar/buscar sin leer la org; se re-sincroniza si la org se renombra (en el merge/rename del admin).
- Clientes existentes: `organizacionId = null` → se muestran sueltos como hoy.

---

## 4. Reutilización de lo ya hecho (rama `feat/mobile-ordenes-kit`)

Ya está implementado y se **conserva**:
- `cuenta_alias` en `buildClientePayload` + `searchTokens` ([clientesService.js](public/js/services/clientesService.js)).
- Campo "Alias de cuenta" en el form ([contratos/nuevo-cliente.html](public/contratos/nuevo-cliente.html), [nuevo-cliente.js](public/js/pages/nuevo-cliente.js)).
- Relajación de RUC duplicado para permitir cuentas adicionales.
- Cabecera colapsable + CSS + `renderRowsGrouped` en la lista ([clientes-index.js](public/js/pages/clientes-index.js), [clientes/index.html](public/clientes/index.html)).

**Cambio respecto a lo actual**: la llave de agrupación de la lista pasa de `ruc_norm` → **`organizacionId`**.
La heurística "mismo RUC" deja de ser el agrupador en runtime y pasa a ser el criterio del **backfill**.

---

## 5. Fases de trabajo

### Fase 0 — Cimientos (sin UI)
1. `OrganizacionesService` (nuevo) espejando patrones de `ClientesService`:
   `norm`, `tokensFrom`, `buildOrgPayload`, `createOrg`, `updateOrg`, `softDelete`,
   `listOrgsPage`, `searchByToken`, `getOrg`, `existsByNorm`.
2. `firestore.rules`: reglas para `organizaciones` con los mismos roles que `clientes`.
3. `firestore.indexes.json`: índices compuestos
   - `clientes` por `organizacionId` + `nombre` (para listar/ordenar subcuentas juntas).
   - `organizaciones` por `searchTokens` + `deleted` (+ `activo`).
4. `buildClientePayload`: aceptar y persistir `organizacionId` + `organizacion_norm`.

**Criterio de hecho**: servicio probado en aislamiento; reglas/índices desplegados; cero cambios de UI.

### Fase 1 — Selector de organización reutilizable (anti doble-trabajo)
1. Componente compartido `organizacionPicker.js` (+ CSS mínimo): combobox que
   (a) busca organizaciones existentes por token, (b) permite **"crear nueva"** inline.
2. Integrarlo en el **form compartido** `contratos/nuevo-cliente.html`
   → cubre automáticamente **clientes, contratos y cotizaciones** (todos abren ese form).
3. Guardado: el form pasa `organizacionId`/`organizacion_norm` a `buildClientePayload`.
4. (Secundario, opcional) creadores **inline** que no usan el form:
   - [nueva-orden.js:235](public/js/pages/nueva-orden.js#L235) (alta rápida por `prompt`).
   - [nuevo-batch.js:310](public/js/pages/nuevo-batch.js#L310) (import POC).
   Decisión: en v1 estos crean cuentas **sueltas** (sin org) y se asignan luego desde el admin;
   se les puede añadir el picker en una iteración posterior.

**Criterio de hecho**: crear un cliente desde contratos/cotizaciones permite elegir o crear su organización sin ir a otra pantalla.

### Fase 2 — Lista de clientes agrupada por organización
1. Cambiar la llave de `renderRowsGrouped` de `ruc_norm` → `organizacionId`.
2. Cabecera = nombre de la organización + Nº de cuentas; subcuentas indentadas con `cuenta_alias`.
3. Consulta/orden por `organizacionId` para que las subcuentas **no se separen entre páginas**
   (resuelve la debilidad del agrupar-por-RUC dentro de página).
4. Clientes sin `organizacionId` → fila suelta como hoy.

**Criterio de hecho**: organizaciones con ≥2 cuentas se ven colapsables y estables a través de la paginación.

### Fase 3 — Página admin de organizaciones
1. `public/admin/organizaciones.html` + `admin-organizaciones.js` (modelo: [admin-grupos.js](public/js/pages/admin-grupos.js)).
2. Acciones: listar orgs con conteo de cuentas; crear; renombrar (re-sincroniza `organizacion_norm` en sus clientes); **fusionar** (reasigna `organizacionId` de las cuentas); soft-delete; **asignar/quitar** cuentas a una organización.
3. Guard de rol admin (igual que admin-grupos).

**Criterio de hecho**: un admin puede gestionar el ciclo de vida completo de organizaciones y su membresía.

### Fase 4 — Backfill con revisión
1. **Dry-run / reporte**: script que recorre `clientes`, agrupa por `ruc_norm` (no vacío) con >1 miembro,
   y emite un reporte (CSV/JSON o vista en `admin/backfills.html`) con las organizaciones propuestas y sus cuentas.
2. **Revisión manual** del reporte por el usuario.
3. **Apply**: crea las `organizaciones` aprobadas y setea `organizacionId`/`organizacion_norm`
   en cada cuenta. Idempotente, por lotes (≤450), salta `deleted`.
4. **Commit previo obligatorio** antes de correr el apply (ver `memory/feedback_commit_before_risky_edits.md`).

**Criterio de hecho**: el usuario revisa el reporte, aprueba, y el apply deja la estructura armada sin tocar otros módulos.

### Fase 5 — (Opcional) Pulido
- Picker de organización en los creadores inline (Fase 1.4).
- Mostrar la organización en selectores de cliente de órdenes/cotizaciones (solo display).
- Reportes consolidados por organización.

---

## 6. Seguridad y reversibilidad

- Todo es **aditivo** e **invisible** hasta que existan organizaciones (`organizacionId = null` = comportamiento actual).
- El backfill corre primero en **dry-run**; nada se escribe sin aprobación.
- Cada fase es desplegable y reversible de forma independiente.
- Probar siempre en `firebase serve` (local) antes de `firebase deploy`; recordar que auth/Firestore son de **producción**.

---

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Romper contratos/órdenes/POC | Cambio aditivo; no se tocan sus servicios ni se leen campos nuevos. Sección 2. |
| Doble trabajo al crear clientes en varios módulos | Cablear el **form compartido** + componente único de picker. Fase 1. |
| Subcuentas separadas por paginación | Consultar/ordenar por `organizacionId`. Fase 2. |
| Backfill agrupa mal por RUC | Dry-run + revisión manual antes de aplicar. Fase 4. |
| `organizacion_norm` desincronizado al renombrar | Re-sincronización por lotes en rename/merge del admin. Fase 3. |
| Confusión con "grupos" de POC | Son conceptos distintos; no se mezclan. Sección 2. |

---

## 8. Archivos afectados (resumen)

**Nuevos**
- `public/js/services/organizacionesService.js`
- `public/js/ui/organizacionPicker.js` (+ estilos)
- `public/admin/organizaciones.html`, `public/js/pages/admin-organizaciones.js`
- Script de backfill (Node o acción en `public/admin/backfills.html`)

**Modificados**
- `public/js/services/clientesService.js` (payload con `organizacionId`/`organizacion_norm`)
- `public/contratos/nuevo-cliente.html`, `public/js/pages/nuevo-cliente.js` (picker)
- `public/js/pages/clientes-index.js`, `public/clientes/index.html` (agrupar por `organizacionId`)
- `firestore.rules`, `firestore.indexes.json`
- (Opcional) `public/js/pages/nueva-orden.js`, `public/js/pages/nuevo-batch.js`

**Intencionalmente NO modificados**
- `ordenesService.js`, `contratosService.js`, `pocService.js` y sus flujos de creación.
