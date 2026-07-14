# Plan — Rediseño "Command Center, en claro"

> **Estado:** aprobado en dirección (2026-07-13). Maquetas navegables en
> `design-system/archivo/rediseno-command-center/propuesta/`
> (`home.html`, `ordenes.html`, `detalle-orden.html` + `ceco-command.css` + `LEEME.md`).
> Este plan lleva esa propuesta a `public/` por fases, sin big-bang.

---

## 1. Decisiones de diseño (cerradas)

1. **Espacio de trabajo claro** en todas las pantallas; navy solo en el rail de
   navegación, la franja de marca del home y acentos. Motivo: uso de 8 h/día.
2. **Estado como señal**: chips `sig--*` para los 5 estados reales de orden
   (`POR ASIGNAR`, `RECIBIDO EN MOSTRADOR`, `ASIGNADO`, `COMPLETADO (EN OFICINA)`,
   `ENTREGADO AL CLIENTE`). Pulso animado SOLO en estados que piden acción.
3. **Rail de navegación** persistente en páginas internas; en móvil, drawer.
4. **El home deja de ser solo un menú**: fila de señales accionables arriba,
   **estrictamente limitada a lo que el rol puede ver** (ver §3).
5. No se rediseña ninguna pantalla muerta: el patrón de taller es el detalle de
   orden (`editar-orden.html`) con su modal de intervención — no «Trabajar orden».

## 2. Fases

### F0 — Fundaciones (sin cambio visible)
- `public/css/ceco-command.css`: tokens + shell (rail/topbar) + componentes
  (`sig`, `chip`, `kpi`, `flow`, `tile`, `mcard`). Convive con `ceco-ui.css`;
  las páginas migran una a una añadiendo el link.
- `js/core/layout.js`: nuevo `Layout.renderShell(opts)` (rail + topbar) junto al
  `renderTopbar` existente — **no se toca** lo que ya usan las ~24 páginas.
  El rail lee el mismo mapa de módulos por rol que el home (ver abajo).
- **Extraer `visiblesPorRol` de `public/index.html` a `js/core/modulos.js`**
  (`window.MODULOS`): fuente única para (a) tarjetas del home, (b) items del
  rail, (c) gating de señales/KPIs. Añadir el rol `gerente`, hoy ausente del mapa.
- Fuentes: Barlow + IBM Plex ya son las del DS; verificar carga (self-host o
  Google Fonts) en las páginas migradas.

### F1 — Home (`public/index.html`) ⭐ señales por rol
- Reemplazar layout por el de `propuesta/home.html`: franja navy compacta +
  fila de señales + buscador + grupos por área (Operación / Comercial /
  Almacén y finanzas / Personal). Conservar: skeletons, atajos de teclado,
  buscador, banner "Ver como" (impersonation).
- Nuevo `js/pages/home-signals.js` con catálogo de señales (§3):
  - Cada señal declara `modulo` requerido + query.
  - Se renderizan solo las señales cuyo módulo está en `MODULOS[rolEfectivo]`
    (mismo rol efectivo del "Ver como": si el admin impersona, ve las señales
    del rol impersonado).
  - Conteos con **agregados `count()`** del SDK (1 lectura por cada 1,000
    contados — no descarga documentos).
  - Cache en `sessionStorage` con TTL 5 min para no repetir conteos en cada
    visita al home dentro de la sesión.
  - Cada tile enlaza a la vista filtrada correspondiente.

### F2 — Bandeja de órdenes (`ordenes/index.html`)
- Reskin según `propuesta/ordenes.html`: shell con rail, KPIs de cabecera
  (mismo catálogo/gating de F1), chips de estado con el nuevo estilo, tabla.
- **No se toca la lógica** (`ordenes-*.js` siguen igual); solo clases/markup y
  `ordenes-index.css` → estilos nuevos. La vista de tarjetas móvil se conserva.

### F3 — Detalle de orden (`editar-orden.html` + modal de intervención)
- Stepper del ciclo de vida real, tarjetas laterales (cliente, cotización con
  candado, historial), restyle del modal de intervención con materiales.

### F4 — Resto de familias (una por PR, en este orden sugerido)
1. Cotizaciones (bandeja + nueva/editar + detalle) — incluye umbral de
   auto-envío y aprobación por tipo ya en producción.
2. Contratos + seriales (patrón "vista con candado" tras `asignados`).
3. Clientes, Inventario (radios y piezas), PoC + SIM cards, Facturación.
4. Panel admin (17 páginas) y vistas de impresión (base común `print-base.css`).
5. Verificación pública QR (mobile-first, sin rail).

## 3. Señales del home — matriz de acceso por rol

**Regla de oro:** una señal solo se muestra si (a) el módulo de origen está en
`MODULOS[rolEfectivo]` **y** (b) `firestore.rules` permite la consulta al rol
real. (b) ya se cumple hoy para todo lo listado — no se requiere ningún cambio
de rules:

| Colección | Lectura según rules |
|---|---|
| `ordenes_de_servicio` | cualquier autenticado (`allow read: if isSignedIn()`) |
| `contratos` | cualquier autenticado |
| `inventario_actual`, `inventario_piezas` | cualquier autenticado |
| `cotizaciones` | `list` solo `puedeCotizar` (admin, vendedor, jefe_taller, recepcion, gerente) + técnicos taller + supervisores allowlist |

Catálogo de señales (queries con `count()`):

| ID | Señal | Query | Acción al clic |
|---|---|---|---|
| S1 | Órdenes por asignar (alerta roja) | `estado_reparacion == 'POR ASIGNAR'` | bandeja filtrada |
| S2 | Recibidas en mostrador | `== 'RECIBIDO EN MOSTRADOR'` | bandeja filtrada |
| S3 | En taller (asignadas) | `== 'ASIGNADO'` | bandeja filtrada |
| S4 | Completadas (en oficina) | `== 'COMPLETADO (EN OFICINA)'` | bandeja filtrada |
| S5 | Mis órdenes asignadas | `tecnico_uid == uid && == 'ASIGNADO'` | bandeja (ya filtra por técnico) |
| S6 | Cotizaciones enviadas sin respuesta | `estado == 'enviada'` | bandeja cotizaciones |
| S7 | Mis cotizaciones activas | `creado_por_uid == uid && estado in ['borrador','enviada']` | bandeja cotizaciones |
| S8 | Contratos aprobados por activar | `estado == 'aprobado'` | bandeja contratos |
| S9 | Piezas sin stock | `inventario_piezas.cantidad <= 0` | inventario de piezas |

Asignación por rol (4 tiles máx.; roles con menos señales muestran menos):

| Rol | Señales |
|---|---|
| `administrador` | S1 · S3 · S4 · S6 |
| `gerente` | S1 · S3 · S4 · S6 *(aprueba comerciales)* |
| `jefe_taller` | S1 · S3 · S4 · S6 *(aprueba servicio)* |
| `recepcion` | S1 · S2 · S4 · S8 *(sin cotizaciones: módulo oculto para el rol, aunque rules lo permitan)* |
| `vendedor` | S7 · S8 · S1 · S4 |
| `tecnico` / `tecnico_operativo` | S5 · S4-propia (`tecnico_uid == uid && COMPLETADO`) — 2 tiles |
| `inventario` | S9 (+ S8 si aplica el flujo de seriales) — sin datos de órdenes en fila |
| `vista` | S1 · S3 · S4 (solo lectura, sin cotizaciones) |
| `contabilidad` | v1 sin fila de señales (candidata futura: activaciones QBO pendientes) |

Notas:
- S6/S7 nunca se muestran a roles fuera de `puedeCotizar` — coincide con rules.
- "Por aprobar (fuera de umbral)" para jefe_taller/gerente queda para una
  segunda pasada: requiere confirmar el campo que marca `requiere_aprobacion`
  en el doc de cotización antes de poder contarlo server-side.
- El delta "▲ desde ayer" de la maqueta se pospone (requeriría snapshot diario);
  v1 muestra solo el conteo y un subtítulo estático útil.

## 4. Riesgos y salvaguardas

- **Sin build step**: todo es HTML/CSS/JS estático; cada fase es desplegable
  por sí sola con `firebase deploy --only hosting`.
- **No se despliegan rules** en ninguna fase de este plan (cero cambios).
- Commit del trabajo funcionando **antes** de cada reescritura grande de página
  (aprendido en Phase 5), y stagear solo los archivos de la fase — nunca
  bundlear cambios ajenos del working tree.
- `count()` con SDK compat 10.10: verificado disponible; si alguna consulta
  compuesta exigiera índice, Firestore lo indica en consola → añadir a
  `firestore.indexes.json` en la misma PR.
- El rail cambia la geometría de páginas densas (tablas anchas): F2 valida el
  patrón en la página más exigente antes de replicarlo.

## 5. Entregables por fase (checklist)

- [ ] F0: `ceco-command.css` + `Layout.renderShell` + `js/core/modulos.js`
- [ ] F1: home nuevo + `home-signals.js` con matriz §3
- [ ] F2: bandeja de órdenes reskin
- [ ] F3: detalle de orden + modal intervención
- [ ] F4.1–F4.5: familias restantes (una PR por familia)
