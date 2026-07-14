# Modelos nuevo/refurbished — Plan de unificación por patrón variante

> 2026-07-03 · rama `feat/cliente-id-link`
> Decisión documentada en `QUICKBOOKS_INTEGRATION_PLAN.md` §3 (2026-07-03)
> Relacionado: Fase 1–2 del plan QBO (registro de unidades facturables)

## 1. Contexto y decisión

Hoy cada equipo refurbished existe como un **segundo modelo** en el catálogo, con
sufijo "R" en el nombre (ej. `PD78X` y `PD78X R`). La razón es contable y es válida:
en QuickBooks el ítem refurbished lleva **costo 0** (su costo landed ya se absorbió
en la primera vida) y el nuevo lleva su **costo landed**. El costo es un atributo del
ítem en QBO, así que ahí **sí** se necesitan dos ítems.

El problema es que esa dualidad se propagó a la app como identidad del modelo:
duplica catálogo, tarifas y mapeos, se confunde con variantes de fábrica (la "G" de
GPS en Hytera es del fabricante; la "R" es nuestra), y rompe la trazabilidad — un
radio que pasa de nuevo a reacondicionado "cambiaría de modelo".

**Decisión:**
- **En QBO no cambia nada**: se conservan los dos ítems/bundles con sus dos costos.
- **En la app el modelo es UNO** y la condición (`nuevo` | `refurbished`) es un
  **atributo del equipo/unidad**, no del modelo.
- El puente entre ambas capas es el **patrón variante** en el catálogo + resolución
  al crear la unidad facturable.
- **Sin backfill de datos históricos** (contratos, seriales, poc_devices,
  cotizaciones, inventario quedan tal cual — el legacy no se factura).

## 2. Estado actual (verificado en código)

- Colección `modelos`: docs con `marca, modelo, tipo(P/B/C), estado(N/R), minimo,
  es_alquiler, alto, activo, aliases[]` + campos de facturación `precio_alquiler,
  precio_frecuencia, qbo_item_alquiler_id, qbo_bundle_id`
  (panel: `inventario/modelos.html` + `inventario-modelos.js`, gate admin+contabilidad).
- Los refurbished ya son **docs separados** (nombre con "R", `estado: "R"`).
- La UI etiqueta `estado R` como **"Reuso"** en 4 vistas: `modelos.html`,
  `inventario-index.js`, `cargar-inventario.js`, `vista-correo.html` — mientras el
  equipo humano dice "refurbished". Inconsistencia de vocabulario.
- `modelo_id` se referencia en ~15 módulos: `contratos.equipos[]`,
  `contratos/{id}/seriales/*`, `poc_devices`, inventario (stock + historial),
  cotizaciones, batches de órdenes, cancelaciones, `facturacion-activacion.js`
  (readiness de mapeo: `precio_alquiler>0 && qbo_item_alquiler_id && qbo_bundle_id`).

**Por qué NO fusionar los docs del catálogo:** inventario necesita los dos buckets
(el stock físico de nuevos y de refurbished se cuenta aparte, con mínimos de alerta
propios). Fusionar obligaría a inventar stock-por-condición dentro del doc — más
trabajo para volver al mismo lugar.

## 3. Diseño

### 3.1 Catálogo: campo `variante_de`

Al doc del modelo refurbished se le agrega:

```
modelos/{id_refurb}
  variante_de: <id del modelo base>   ← lo convierte en "variante refurbished de X"
  estado: "R"                          ← ya existe; sigue siendo la marca de condición
```

- El modelo base NO cambia.
- Un doc con `variante_de` **hereda la identidad** del base (para trazabilidad y
  agrupación) pero **conserva sus propios** `precio_alquiler`, `qbo_item_alquiler_id`
  y `qbo_bundle_id` (la tarifa refurb y el ítem "R" de QBO con costo 0).
- Validaciones: `variante_de` no puede apuntar a otro doc que a su vez tenga
  `variante_de` (sin cadenas), ni a sí mismo; el destino debe existir y tener
  `estado: "N"`.

### 3.2 Resolución al nacer la unidad facturable (Fase 2 QBO)

Único punto de traducción — cuando bodega asigna el equipo y se crea el núcleo de
facturación en `poc_devices`:

```
elegido = modelos/{modelo_id seleccionado}
si elegido.variante_de existe:
    unidad.modelo_id  = elegido.variante_de      (el base)
    unidad.condicion  = "refurbished"
si no:
    unidad.modelo_id  = elegido.id
    unidad.condicion  = "nuevo"
```

La unidad guarda además `modelo_id_catalogo` (el doc realmente elegido) para no
perder de qué ficha salió (auditoría + resolver tarifa/bundle sin re-derivar).

### 3.3 Facturación: mapeo (modelo, condición) → ítem QBO

El facturador resuelve la partida así:

```
si unidad.condicion == "refurbished":
    bundle = modelos/{modelo_id_catalogo}.qbo_bundle_id     ("Mensualidad - <modelo> R", costo 0)
    tarifa = modelos/{modelo_id_catalogo}.precio_alquiler   (alquiler refurb)
si no:
    bundle/tarifa del modelo base
```

- Contabilidad sigue viendo en QBO exactamente las partidas que usa hoy.
- El readiness de `facturacion-activacion.js` no cambia de lógica: cada doc de
  catálogo (base o variante) debe tener su propio mapeo completo.

### 3.4 Operación diaria: no cambia

Ventas/inventario/POC/cotizaciones siguen eligiendo "PD78X R" de la lista como hoy.
La traducción es invisible y ocurre solo al crear el registro facturable.

## 4. Plan de trabajo

### Etapa 1 — Catálogo y vocabulario (independiente, se puede hacer ya)

1. **Campo `variante_de` en el panel Modelos y Tarifas** (`inventario/modelos.html`
   + `inventario-modelos.js`): selector "Variante refurbished de…" visible solo si
   `estado == "R"`, listando modelos base (`estado == "N"`, mismo tipo). Con las
   validaciones de §3.1.
2. **Vincular las variantes existentes**: pasada manual desde el panel (o script
   `migrate-*` con dry-run si son muchas) emparejando cada "X R" con su base "X".
   Es el único "backfill" del plan y toca solo el catálogo (~decenas de docs).
3. **Unificar etiqueta**: "Reuso" → **"Refurbished"** en las 4 vistas (§2). Los
   valores almacenados `N`/`R` NO cambian.
4. **Badge visual**: en el panel, la fila variante muestra chip "R → <base>" para
   que se vea el vínculo (y detectar las que falten por vincular).

### Etapa 2 — Nacimiento de la unidad (dentro de Fase 2 del plan QBO)

5. La creación del núcleo de facturación en `poc_devices` aplica la resolución de
   §3.2 (`modelo_id` base + `condicion` + `modelo_id_catalogo`). Es código nuevo de
   la Fase 2, no modificación de flujos existentes.
6. Reglas Firestore: `condicion` y `modelo_id` forman parte del núcleo protegido
   (patrón `touchesCFOwnedFields`, condicional a `facturable` — ya decidido en v5).

### Etapa 3 — Facturador y panel (dentro de Fases 3–5 del plan QBO)

7. El cálculo/emisión usa el mapeo de §3.3.
8. **Agrupación opcional en el panel de tarifas**: vista "por modelo real" — una
   fila por base con sus dos tarifas (nuevo / refurb) usando `variante_de`. Cosmético;
   puede posponerse.
9. **Reconciliación acordado vs. real** (alerta v5): compara contra el modelo BASE,
   de modo que 3 unidades PD78X (2 nuevas + 1 refurb) cuadran con
   `contrato.equipos[] = { PD78X, cantidad: 3 }` si así se vendió. Si el contrato
   distingue precio por condición, se registran como líneas de acuerdo separadas
   (el desglose por `mensualidad_unit` distinta ya lo permite).

## 5. Qué NO se hace

- ❌ Backfill de `modelo_id` en contratos, seriales, poc_devices, cotizaciones,
  órdenes ni historial de inventario.
- ❌ Fusionar/eliminar los docs "R" del catálogo (inventario los necesita).
- ❌ Cambios en QBO (ítems, bundles y costos quedan tal cual).
- ❌ Cambios de flujo para ventas/bodega/POC.
- ❌ Renombrar los valores `N`/`R` almacenados (solo la etiqueta visible).

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Variante sin vincular al llegar la Fase 2 (unidad nacería como "modelo aparte") | El badge del panel (paso 4) lista las R sin `variante_de`; la creación de unidad alerta si `estado=="R"` sin variante (crea igual, marca para corregir — no bloquea la operación) |
| Emparejar mal una variante (X R → base equivocado) | Selector filtra por mismo `tipo`; confirmación visible del vínculo; corregir el vínculo NO toca unidades ya creadas (guardan `modelo_id` resuelto al momento) |
| Nombres con grafías distintas ("PD78X-R", "PD78XR") | `aliases[]` ya existe en el catálogo; el vínculo es por id, no por nombre |
| Doble tarifa mal cargada (refurb más cara que nuevo, etc.) | Vista agrupada (paso 8) hace evidente la comparación lado a lado |

## 7. Orden sugerido

La **Etapa 1 completa (pasos 1–4)** es autónoma, de bajo riesgo y deja el catálogo
listo antes de que exista la primera unidad facturable. Las Etapas 2–3 no son trabajo
adicional: son requisitos que se incorporan al alcance de las Fases 2–5 del plan QBO
que ya está aprobado.
