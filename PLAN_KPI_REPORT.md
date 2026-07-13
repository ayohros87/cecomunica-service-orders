# Plan — Módulo "Reporte KPIs Junta Directiva" (solo admin)

> **Estado:** EJECUTADO COMPLETO (F1–F4) el 2026-07-13 — commits `5e791d5` (módulo + backfill),
> `ccc8077` (plantilla + import tabular), `44d1db6` (snapshot PDF + respaldos + export).
> Ver CHANGELOG.md para el detalle de lo entregado; este documento queda como registro del diseño.
> **Insumos:** nuevo diseño en `public/brand/kpi report/Rediseño reporte KPIs ejecutivo/Reporte Ejecutivo KPIs.dc.html`;
> reporte viejo `public/brand/kpi report/Financial Report 06-2026.xlsx` (hoja `CC Executive Report (9)`).

---

## 1. Objetivo

Convertir el reporte mensual a la junta (hoy: Excel mantenido a mano + rediseño HTML one-off con data quemada)
en un módulo del panel de administración donde:

1. La data mensual queda **archivada en Firestore** (histórico completo, un doc por mes).
2. Desde el módulo se puede **ver** el reporte ejecutivo con el nuevo diseño para cualquier mes de corte.
3. Se puede **descargar** (PDF vía imprimir del navegador en v1; snapshot server-side en v2).
4. **Solo visible y accesible para admin** — en UI *y* en reglas de Firestore (la data de junta es sensible;
   no repetir el patrón "protección solo UI" de clientes).

## 2. Hallazgos que condicionan el diseño

- **El Excel es la fuente, no el app.** Las series (recurrente Kenwood/Hytera, ventas, suscriptores, churn)
  salen de QBO/registros de finanzas que el sistema no calcula hoy. El módulo archiva la data importándola
  del Excel, no la deriva de las colecciones existentes. Cada workbook mensual trae el histórico completo
  (Jan-16 → mes de corte), así que **una sola importación backfillea todo** y la del mes siguiente solo agrega/actualiza.
- **Solo 2022+ es confiable.** La nota metodológica del rediseño excluye 2016–2021 por inconsistencias de captura
  (verificado: filas con basura tipo `2445 | 2133 | -4606...` repetida). El importador corta en `Jan-22`.
- **La hoja es sucia**: labels duplicados, filas huérfanas, meses con formato mixto (`JuL-25`, `Ago-25`, `oct-22`,
  `Abr-17`). El importador necesita mapeo por regex tolerante + **preview obligatorio antes de guardar**.
- **El rediseño concilia con el Excel** (verificado: total jun-26 $336,486, YTD $1,038,045, subs 3,957 coinciden
  con la fila extraída). El port puede tomar el dc.html como referencia 1:1.
- **El dc.html no corre en el app tal cual**: usa runtime `doc-page.js` + React (`React.createElement` para las
  gráficas). Los 4 charts son SVG simples (barras, líneas 1–2 series) → se portan a vanilla JS generando SVG
  strings, siguiendo el precedente de print-templates con estilos inline intencionales.

## 3. Modelo de datos

### 3.1 Colección `kpi_reports` — un doc por mes, ID `YYYY-MM`

```js
kpi_reports/2026-06 = {
  // Métricas base del mes (todo lo derivable se calcula, no se guarda)
  recurrente: 74575.35,          // ingreso recurrente total
  kenwood: 20007.45,
  hytera: 54567.90,              // Hytera / LTE
  ventas: 250653.79,             // ventas de equipos
  otros: 11361.79,
  ajustes: 105.00,               // se guarda positivo; resta en el total
  total_ingresos: 336485.93,     // se guarda para conciliar contra la fuente
  act_brutas: 73,
  bajas: 113,
  total_subs: 3957,
  churn: 0.03,                   // como viene en la fuente

  // Comentarios de gerencia (uno por sección del reporte; editables en el app)
  comentarios: {
    ingresos: "...",
    recurrente: "...",
    suscriptores: "..."
  },

  // Metadatos
  estado: "borrador" | "publicado",   // publicado = versión presentada a la junta
  fuente: "import" | "manual",
  concilia: true,                     // total ≈ recurrente+ventas+otros−ajustes (tolerancia $1)
  source_file: "Financial Report 06-2026.xlsx",
  created_at, updated_at, updated_by  // serverTimestamp + uid
}
```

**Derivados (nunca almacenados; `js/domain/kpiDerived.js`):** act_netas (brutas−bajas), ARPU (recurrente/subs),
YTD del año y del año anterior, variaciones %, % Hytera sobre recurrente, series trailing 12 meses.
Cargar la colección completa es trivial (~54 docs hoy, +12/año).

### 3.2 Reglas Firestore (protección real, no solo UI)

```
match /kpi_reports/{mes} {
  allow read, write: if isAdmin();
}
```

### 3.3 Storage (v1.1, opcional)

`kpi_reports/{YYYY-MM}/Financial Report MM-YYYY.xlsx` — archivar el workbook original importado
(procedencia/auditoría). `storage.rules`: read/write solo admin.

## 4. Páginas y archivos nuevos

Sigue el patrón del panel admin existente (§4.4 de ARQUITECTURA): página en `public/admin/`,
`AUTH.requireAccess([ROLES.ADMIN])`, script en `js/pages/`, servicio en `js/services/`.

| Archivo | Rol |
|---|---|
| `public/admin/kpi-reportes.html` + `js/pages/admin-kpi-reportes.js` | **Archivo del módulo**: tabla de meses (mes, total, subs, estado, concilia, fuente, updated) + acciones Ver / Editar / Publicar. Toolbar: "Importar Excel" y "Capturar mes". |
| `public/admin/kpi-reporte-print.html` + `js/pages/admin-kpi-reporte-print.js` | **El reporte ejecutivo** parametrizado `?mes=YYYY-MM`: port fiel del nuevo diseño, render desde Firestore, botón Imprimir/Guardar PDF. |
| `public/js/services/kpiReportsService.js` | `getMes`, `listAll`, `upsertMes`, `upsertBatch` (import), `setEstado`, `updateComentarios`. Único punto de I/O. |
| `public/js/domain/kpiDerived.js` | Cálculos puros (sin DOM/Firestore): YTD, var %, netas, ARPU, series, `concilia()`. |
| `firestore.rules` | Bloque `kpi_reports` admin-only. **Deploy aislado y consciente** (ver memoria: stagear solo lo intencionado). |
| `public/admin/index.html` | Launcher card "Reporte KPIs Junta" (icono `presentation` o `bar-chart-3`). |

Assets: el logo lockup del diseño ya existe en `public/brand/`; el snapshot `_ds/` del dc.html **no** se copia —
la página print lleva estilos inline autónomos (mismo criterio que `imprimir-orden.html` y demás print templates).

## 5. Flujos

### 5.1 Importar Excel (mensual y backfill inicial)

1. Admin sube el `.xlsx` (SheetJS 0.18.5 desde cdnjs, ya estandarizado en el stack).
2. Selector de hoja con default a la `CC Executive Report (N)` de mayor N.
3. Parser: fila 1 = meses (parser tolerante a `JuL-25`/`Ago-25`/`Abr-17`/`oct-22`); mapeo de filas por regex:
   `Ingresos Recurrente→recurrente`, `...Kenwood→kenwood`, `...Hytera // LTE→hytera`,
   `Ingresos por Ventas→ventas`, `Otros Ingresos→otros`, `Otros - Ajustes→ajustes`,
   `Total Ingresos→total_ingresos`, `Activaciones Brutas`, `Bajas`, `Churn`, `Total Suscriptores`.
   Corte duro en `Jan-22`.
4. **Preview con diff**: tabla meses nuevos / cambiados / sin cambio + flag de conciliación por mes. Nada se
   escribe sin confirmar.
5. Upsert idempotente por mes (`upsertBatch`). Los meses existentes conservan `comentarios` y `estado`
   (el import solo pisa métricas). Import nunca degrada `publicado` → `borrador`; si cambia un mes publicado, warning explícito.

### 5.2 Capturar / editar mes

Form con las ~11 métricas base + 3 comentarios de gerencia. Validación inline de conciliación
(total vs suma de componentes, tolerancia $1) con warning no bloqueante. Guardado estampa `updated_by`.
Es también donde se reemplazan los placeholders `[detallar proyecto]` / `[Agregar plan de migración...]`
del rediseño antes de publicar.

### 5.3 Ver / descargar reporte

1. Desde el archivo → "Ver" abre `kpi-reporte-print.html?mes=2026-06`.
2. La página carga `kpi_reports` completo, calcula derivados y series (últimos 12 meses hasta el corte,
   YTD vs mismo período año anterior) y renderiza las 4 secciones del diseño: masthead + resumen (6 tiles),
   ingresos (tabla + barras mensuales), recurrente Kenwood vs Hytera (líneas + 3 tiles), suscriptores
   (2 charts + tabla actividad), nota metodológica con `source_file`.
3. Toggle "mostrar comentarios" (equivalente al prop `mostrarComentarios` del dc.html).
4. **Descargar = imprimir** (`@page letter portrait`, `break-inside: avoid` en tiles/tablas/charts, ya previsto
   en el diseño). Precedente: todos los print templates del app funcionan así.
5. Si el mes está `borrador`, marca de agua/banner "BORRADOR" en pantalla e impresión.

## 6. Fases de entrega

| Fase | Alcance | Criterio de done |
|---|---|---|
| **F1 — Datos** | Reglas + `kpiReportsService` + `kpiDerived` + importador con preview. Backfill 2022→jun-2026 desde el archivo real. | 54 meses en Firestore, todos conciliando; import re-ejecutado = 0 cambios (idempotente). |
| **F2 — Archivo** | `kpi-reportes.html`: lista, editar mes, comentarios, publicar. Launcher en admin. | Admin edita comentarios de jun-2026 y publica. |
| **F3 — Reporte** | `kpi-reporte-print.html`: port vanilla del diseño (charts SVG sin React), print CSS. | PDF impreso de jun-2026 visualmente equivalente al dc.html; cifras = Excel. |
| **F4 — Opcional (v2)** | Snapshot PDF server-side con `pdfRenderer` (Puppeteer ya en functions) archivado en Storage al publicar; guardar xlsx original en Storage; export XLSX del histórico. | Cada mes publicado tiene PDF inmutable en Storage. |

Commit por fase (memoria: commitear antes de ediciones estructurales grandes). El deploy de `firestore.rules`
va solo, verificando `git status` antes.

## 7. Riesgos y decisiones abiertas

- **Hoja sucia**: el mapeo por regex puede fallar en workbooks futuros si finanzas renombra filas → el preview
  obligatorio + validación de conciliación son la red de seguridad; el selector de hoja cubre el caso "(10)".
- **Churn**: la fuente trae valores redondeados a 2 decimales (0.03 = 3%); mostrar como % y aceptar que la
  precisión viene limitada por la fuente, o recalcular churn = bajas / subs mes anterior (decidir en F1; el
  recálculo es más honesto y ya tenemos los insumos).
- **¿Quién captura a futuro?** V1 asume que finanzas sigue manteniendo su Excel y admin importa cada mes
  (cero fricción para finanzas). Si luego se quiere captura directa en el app, el form de 5.2 ya lo permite.
- **Serie pre-2022** queda fuera de Firestore a propósito; el Excel original archivado en Storage preserva el
  histórico completo si algún día se necesita.
