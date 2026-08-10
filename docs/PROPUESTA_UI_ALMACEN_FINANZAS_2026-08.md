# Propuesta de UI — Almacén y Finanzas (consolidación de módulos)

> **Fecha:** 2026-08-10 · **Alcance:** auditoría de procesos de los módulos del grupo "Almacén y finanzas"
> del home (inventario + facturación) y propuesta de rediseño de UI partiendo de cero.
> Complementa a `SISTEMA_TOP_DOWN.md` (arquitectura) y `FACTURACION_COMO_FUNCIONA.md` (desactualizado en sub-clientes).

## Estado de implementación (2026-08-10, misma fecha — commits 812ba95…e6b0046)

| Etapa | Estado | Notas |
|---|---|---|
| E0 — cálculo único de stock + retiro de vista-correo | ✅ HECHO | `js/domain/stockAgg.js`; "Copiar reporte (correo)" en el tablero; conciliación con el mismo join y signo |
| E1 — Almacén · Hoy + home a 2 tarjetas | ✅ HECHO | `/almacen/` con bandeja unificada; `pendientes.html` → redirect; rail/señales actualizados |
| E2 — Almacén · Existencias | ✅ HECHO (vista) | Grid modelo→serial→ficha con drawer y búsqueda; las MUTACIONES siguen en `equipos.html` a un clic (asistentes vía `?accion=`) — absorberlas es trabajo posterior |
| E3 — Piezas + Catálogo | ⚙️ PARCIAL | Anclaje a espacios (barra Finanzas en modelos/piezas-tarifas/cargos, barra Almacén en piezas), rail coherente, avisos de visibilidad cruzada. **Pendiente: el grid único parametrizado con permisos por columna** |
| E4 — Finanzas completo | ✅ HECHO | Pestañas en todo el espacio; hub → redirect a Activación; `emision.html` placeholder honesto; tarjeta de estado QBO (callable `qboStatus`); Panorama con fuente etiquetada + acceso contabilidad |
| Transversal — reglas H8 | ✅ HECHO | 4 candados validados en emulador (60 grupos); hallazgo extra: wildcard v2 `/{sub=**}` alcanzaba el doc padre |
| **Deploy** | ⏳ PENDIENTE | hosting + functions (`qboStatus`) + firestore.rules — nada de esto está en producción aún |

Pendientes de diseño que siguen abiertos: F14 "corrección en drawer sin salir de Activación"
(hoy los CTA siguen navegando a la página del catálogo, ya con pestañas), y la absorción
plena de los asistentes de equipos.html dentro de Existencias.

---

## 1. Diagnóstico

### 1.1 Lo que hay hoy: 5 tarjetas que esconden 13 páginas

El grupo "Almacén y finanzas" del home tiene 5 tarjetas, pero el trabajo real está repartido
en **13 páginas** con tres roles distintos (inventario, contabilidad, admin/gerente):

| Página | Naturaleza real | Rol | Observación |
|---|---|---|---|
| `inventario/pendientes.html` | **Trabajo** (3 colas de contratos) | inventario, admin | 1 de las 3 colas apagada (`COLA_TRANSICIONES_ACTIVA:false`) |
| `inventario/equipos.html` | **Trabajo** (4 colas) + **Estado** (pool) + **Acciones** | inventario, admin (gerente lee) | 2,111 líneas de JS; hace de todo |
| `inventario/index.html` | **Estado** (stock por modelo) | inventario, admin, gerente | Solo lectura + drill-down a equipos |
| `inventario/cargar-inventario.html` | **Acción** (conteo físico) | inventario, admin | Solo se llega desde un CTA de index |
| `inventario/vista-correo.html` | **Reporte** | ⚠️ sin gate | 3ª copia del cálculo de stock, inline |
| `inventario/piezas.html` | **Estado + catálogo** (repuestos) | inventario, admin | Misma colección que la siguiente |
| `inventario/piezas-tarifas.html` | **Catálogo** (precios + QBO de piezas) | contabilidad, admin | Edita `inventario_piezas` igual que piezas.html |
| `inventario/modelos.html` | **Catálogo** (identidad + tarifas + QBO) | contabilidad, admin | Vive en /inventario/ pero navega a /facturacion/ |
| `inventario/cargos.html` | **Catálogo** (cargos + QBO) | contabilidad, admin | Ídem; hasta pinta el rail de facturación |
| `facturacion/index.html` | **Launcher** (5 enlaces + 1 muerto) | contabilidad, admin | Una página entera para navegar |
| `facturacion/activacion.html` | **Decisión** (pipeline activación) | contabilidad, admin | El corazón de finanzas; sólido |
| `facturacion/clientes-qbo.html` | **Decisión** (match QBO) | contabilidad, admin | El vínculo que guarda hoy no lo lee nadie |
| `admin/financiero.html` | **Panorama** (dashboard) | solo admin | Fuente de datos paralela al motor de facturación |

### 1.2 Hallazgos principales

**H1 — "¿Qué tengo que hacer hoy?" está repartido en 2 páginas + 6 señales del home.**
Las colas del pool (por clasificar, por inspeccionar, conflictos, sin verificar) viven como
tarjetas dentro de `equipos.html`; las colas nacidas en contratos (seriales por asignar,
cambios de serial, transiciones) viven en `pendientes.html`. Son la misma pregunta partida
en dos pantallas, con CSS duplicado a propósito (`.eq-cola` vs `.pi-cola`).

**H2 — Dos módulos para el mismo dato en dos niveles de zoom.**
"Inventario de Radios" (agregado por modelo) y "Equipos por serial" (unidad) son la misma
información. El drill-down que ya existe (`?tab=en_bodega&modelo=`) prueba que es una sola
pantalla partida en dos tarjetas del home.

**H3 — El catálogo está partido en 4 páginas, 2 carpetas y 2 roles que se pisan.**
`modelos.html`, `piezas.html`, `piezas-tarifas.html` y `cargos.html` comparten el mismo patrón
de hoja de cálculo con auto-guardado (CSS triplicado por copy-paste). `piezas.html` y
`piezas-tarifas.html` editan **la misma colección** (`inventario_piezas`) con roles disjuntos:
inventario y contabilidad pueden pisarse `precio_venta`/`costo`/`activo` sin verse.

**H4 — La carpeta miente.** Tres páginas de `/inventario/` pertenecen funcionalmente a
Facturación (back → `/facturacion/`, roles contabilidad, `cargos.html` pinta rail de
facturación). El rol contabilidad ve rails que resaltan módulos que no tiene.

**H5 — Un mismo número se calcula 3 veces.** La conciliación pool-vs-conteo existe como
columna "Dif." en `index.html` y como modal en `equipos.html`, con lógica de agrupación
distinta (riesgo de divergencia numérica). `vista-correo.html` es una tercera copia inline
del mismo join — y además es la única página del módulo **sin gate de rol**.

**H6 — Facturación termina en la nada (por ahora, a propósito).** La activación es sólida
(explícita, fechada, auditada) pero su único consumidor es la vista previa. No hay emisor
(cero escrituras a QBO), el match de clientes escribe un campo que nadie lee todavía
(`clientes.qbo_customer_id`), la tarjeta "Emisión de facturas" es un `<span>` muerto, y
`admin/financiero.html` calcula "facturado del mes" con **otra definición** (cotizaciones
aprobadas + contratos) que no habla con el motor.

**H7 — El precio del contrato no viene del catálogo.** `equipos[].precio` se teclea a mano
en el contrato; el cálculo de factura mezcla ese precio con las tarifas del catálogo y puede
producir mantenimiento **negativo** (solo advierte, no bloquea).

**H8 — Huecos de reglas detectados de paso** (no son de UI, pero quedan registrados):
los campos `facturacion_*`/`facturable`/`entrega_confirmada` de contratos no están en
`touchesCFOwnedFields()` (cualquier autenticado puede escribirlos); `empresa/facturacion_config`
es escribible por cualquier autenticado; `clientes` e `inventario_piezas` tienen
`write: isSignedIn()`; `vista-correo.html` no valida rol.

### 1.3 Lo que SÍ funciona (y la propuesta conserva)

- **El pool por serial con kardex** (`equipos_pool` + `movimientos`) como columna vertebral,
  alimentado por triggers ("migración por contacto"). No se toca.
- **La bandeja de pendientes como concepto**: proyección segura sin precios
  (`colaInventarioService`) para un rol que no tiene el módulo Contratos.
- **Flujos transaccionales en modales sobre una lista** (patrón probado en órdenes y en
  "Recibir equipos").
- **Componentes reutilizables ya construidos**: `equipo-ficha.js` (drawer de kardex),
  `serial-field.js` (chip de estado del pool en cualquier campo serial).
- **Señales del home con deep-links** y gating por rol.
- **La activación explícita y auditada** (`gestionarFacturacion`) como modelo de decisión.

---

## 2. Principios de la nueva UI

| # | Principio | Qué corrige |
|---|---|---|
| P1 | **Tres naturalezas, tres superficies**: Trabajo (bandeja) · Estado (existencias) · Referencia (catálogo). Las decisiones de facturación son un cuarto espacio propio. | H1, H2, H3 |
| P2 | **Una pregunta, una pantalla.** ¿Qué hago hoy? → Hoy. ¿Dónde está el equipo X? → Existencias. ¿Cuánto vale/cómo se mapea? → Catálogo. ¿Qué facturo? → Activación. | H1–H4 |
| P3 | **Zoom, no páginas.** Modelo → seriales → ficha con kardex: drill-down en la misma pantalla (fila expandible + drawer), nunca un cambio de página. | H2 |
| P4 | **Acciones como flujos guiados** (modal/asistente) lanzados desde donde estás: Recibir, Conteo, Vender, Dar de baja. Sin páginas satélite de un solo uso. | H5 (cargar-inventario) |
| P5 | **Permisos por columna y por acción, no páginas duplicadas por rol.** Un solo grid de piezas: inventario edita stock, contabilidad edita tarifas, cada uno ve al otro. | H3 |
| P6 | **Un número, un cálculo.** Una única función de stock/diferencia alimenta el tablero, la conciliación y el reporte por correo. | H5 |
| P7 | **La bandeja vacía es el estado de éxito.** Todo lo accionable tiene cola visible con antigüedad y CTA; nada depende de un correo que se puede borrar. | H1 |

---

## 3. Arquitectura propuesta: de 5 tarjetas a 2 espacios

### 3.1 El home

```
HOY                                      PROPUESTA
─────────────────────────────            ─────────────────────────────
Almacén y finanzas                       Almacén y finanzas
├── Pendientes de inventario             ├── ALMACÉN        [badge: trabajo pendiente]
├── Inventario de Radios                 └── FINANZAS       [badge: listos por activar]
├── Equipos por serial
├── Inventario de Piezas
└── Facturación (hub → 5 páginas)
```

Las señales del home (S9, S13, S14, S15…) se conservan pero todas aterrizan en pestañas
de los dos espacios.

### 3.2 ALMACÉN — un espacio, tres pestañas + acciones

**Roles:** inventario y admin operan; gerente solo lectura.

| Pestaña | Contenido | Absorbe |
|---|---|---|
| **Hoy** (landing) | Bandeja unificada de TODO el trabajo pendiente, agrupada por tipo, ordenada por antigüedad con semáforo (ámbar >3d, rojo >7d). Cada ítem con su CTA. Contador total en el badge del home. | `pendientes.html` + las 4 tarjetas-cola de `equipos.html` + 4 señales del home |
| **Existencias** | Tabla por modelo (columnas: bodega, asignado, en cliente, taller, cuarentena, conteo físico, dif.) con **fila expandible** que muestra los seriales; búsqueda universal por serial; clic en serial → **ficha drawer** con kardex. Filtros = las pestañas actuales de equipos.html. | `index.html` + `equipos.html` (pestañas y tabla) + `vista-correo.html` (botón "Copiar reporte") |
| **Piezas** | Un solo grid de repuestos con permisos por columna: stock/mínimos/ubicación (inventario), precio venta/costo/QBO (contabilidad). | `piezas.html` + `piezas-tarifas.html` |

**Barra de acciones** (siempre visible, abre asistentes modales): `+ Recibir equipos` ·
`Conteo físico` · `Registrar venta` · `Importar/Exportar`. Dar de baja, reactivar,
inspección OK, corregir estado siguen como acciones de fila/lote sobre Existencias.

### 3.3 FINANZAS — un espacio, cinco pestañas

**Roles:** contabilidad y admin.

| Pestaña | Contenido | Absorbe |
|---|---|---|
| **Activación** (landing) | El pipeline actual (Pendientes/Listos/Activos/En espera/No facturables) con una mejora clave: cada requisito que falla es un **CTA que abre la corrección en el lugar** (drawer del catálogo para mapear el modelo, drawer del cliente para vincular QBO) en vez de mandarte a otra página. | `facturacion/activacion.html` |
| **Catálogo** | UN grid con tres sub-pestañas — Modelos · Piezas · Cargos — mismo patrón de hoja de cálculo (una sola implementación de CSS/JS), con las columnas QBO integradas y candado visual por rol. La **identidad** del modelo (marca/modelo/aliases/variante-R) también es editable por inventario desde Almacén; tarifas y mapeo QBO solo contabilidad. | `modelos.html` + `piezas-tarifas.html` + `cargos.html` |
| **QuickBooks** | Match de clientes (las 5 sub-vistas actuales) + estado de conexión OAuth + (futuro) bandeja de eventos webhook. | `facturacion/clientes-qbo.html` |
| **Emisión** | Hoy: placeholder honesto con la **vista previa por contrato** (ya existe) y el estado del camino a QBO. Mañana: preview mensual consolidado por cliente + corrida manual + historial de períodos. | Tarjeta muerta del hub |
| **Panorama** | El dashboard financiero, integrado y con la fuente de datos **etiquetada** (hoy: cotizaciones+contratos; cuando exista emisor: facturas reales). | `admin/financiero.html` |

El hub (`facturacion/index.html`) desaparece: las pestañas son la navegación.

### 3.4 Componentes transversales

- **Ficha del equipo** (drawer universal por serial): estado, propiedad, asignación,
  contrato/orden/POC vinculados, kardex completo, acciones contextuales. Ya existe
  (`equipo-ficha.js`); pasa a ser LA forma de ver un equipo desde cualquier módulo.
- **Ficha de catálogo** (drawer modelo/pieza/cargo): identidad + tarifa + mapeo QBO en un
  solo lugar, con secciones bloqueadas según rol. Reemplaza el baile modelos↔tarifas.
- **Asistentes** (modales de 2-3 pasos): Recibir, Conteo, Venta — hoy ya existen como
  modales en equipos.html; se conservan tal cual, solo cambia desde dónde se lanzan.

### 3.5 Mapa de consolidación (13 → 2)

| Página actual | Destino |
|---|---|
| `inventario/pendientes.html` | Almacén · **Hoy** (grupo "De contratos") |
| `inventario/equipos.html` — tarjetas de colas | Almacén · **Hoy** (grupo "Del pool") |
| `inventario/equipos.html` — pestañas/tabla/acciones | Almacén · **Existencias** (nivel serial + acciones) |
| `inventario/index.html` | Almacén · **Existencias** (nivel modelo, mismo grid) |
| `inventario/cargar-inventario.html` | Almacén · asistente **"Conteo físico"** |
| `inventario/vista-correo.html` | Botón **"Copiar reporte"** en Existencias → **retirar página** |
| `inventario/piezas.html` | Almacén · **Piezas** (columnas de stock) |
| `inventario/piezas-tarifas.html` | Almacén · **Piezas** (columnas de tarifas) — espejo en Finanzas · Catálogo |
| `inventario/modelos.html` | Finanzas · **Catálogo · Modelos** (identidad editable desde Almacén) |
| `inventario/cargos.html` | Finanzas · **Catálogo · Cargos** |
| `facturacion/index.html` | Desaparece (pestañas de Finanzas) |
| `facturacion/activacion.html` | Finanzas · **Activación** |
| `facturacion/clientes-qbo.html` | Finanzas · **QuickBooks** |
| `admin/financiero.html` | Finanzas · **Panorama** |

---

## 4. Procesos por flujo (cómo se hace cada cosa en la nueva UI)

> Formato: **Disparador** → quién → pasos en la nueva UI → qué pasa por detrás (sin cambios
> de backend salvo donde se indica). "Hoy" = pantallas que toca en la UI actual.

### ALMACÉN

**F1 · Recibir equipos (alta en bodega)**
- Disparador: llega compra / se encuentra equipo sin ficha.
- Quién: inventario.
- Nueva UI: Almacén → `+ Recibir equipos` → asistente actual de 3 pasos (pegar seriales o
  lector, resolver colisiones/reubicaciones, confirmar). 1 pantalla, 1 modal.
- Detrás: `EquiposPoolService.recibir()` — sin cambios.
- Hoy: home → Equipos por serial → botón Recibir (igual, pero había que saber que vivía ahí).

**F2 · Conteo físico + conciliación (flujo unificado)**
- Disparador: conteo semanal de bodega.
- Quién: inventario.
- Nueva UI: Almacén → `Conteo físico` → asistente: (1) contar por modelo (la captura actual),
  (2) **diff inmediato** contra el pool (la conciliación actual, mismo cálculo P6), (3) las
  diferencias ≠0 se convierten en ítems de la bandeja **Hoy** ("revisar diferencia de conteo").
- Detrás: `inventarioService.guardarInventario()` + una única función compartida de
  agregación (nueva, reemplaza las 3 copias).
- Hoy: cargar-inventario.html (captura) + index.html (columna Dif) + equipos.html (modal
  conciliación) — tres pantallas, dos cálculos distintos, y las diferencias no generan trabajo.

**F3 · Asignar seriales a contrato**
- Disparador: contrato aprobado con serializables (`onApproval` → cola).
- Quién: inventario (también recepción/vendedor por permiso `gestionar-seriales`).
- Nueva UI: Almacén → **Hoy** → ítem "Seriales por asignar · CONTRATO X" → abre la página de
  seriales del contrato (se conserva tal cual: picker del pool FIFO, jalar de POC/órdenes).
  Al guardar, el ítem desaparece de la bandeja.
- Detrás: `saveSerialesManual` + `onSerialWrite` — sin cambios.
- Hoy: pendientes.html → contratos/seriales.html (igual, pero la cola vivía en otra página
  que el rol tenía que conocer).

**F4 · Cambio de serial**
- Disparador: recepción/administración solicita reemplazo (`seriales_cambios`).
- Quién: inventario.
- Nueva UI: Almacén → **Hoy** → ítem "Cambio de serial" → misma página de seriales con
  candado parcial. "Equipo defectuoso" sigue mandando el saliente a cuarentena.
- Detrás: `onSerialCambio` — sin cambios.
- Hoy: pendientes.html → contratos/seriales.html.

**F5 · Transición de equipos (renovación/reemplazo)**
- Disparador: renovación/REEMP con origen vinculado y sin mapeo (la mayoría se
  auto-registra al confirmar entrega vía `onEntregaTransicion`; a la bandeja solo llegan
  las excepciones).
- Quién: inventario / vendedor.
- Nueva UI: Almacén → **Hoy** → grupo "Transiciones" (hoy apagado por atraso acumulado;
  la bandeja lo muestra con su interruptor y el conteo real para decidir reactivarlo).
- Detrás: `onMapeoWrite`, `onEntregaTransicion` — sin cambios.
- Hoy: pendientes.html (cola oculta) → contratos/transicion.html.

**F6 · Devolución: check-in → cuarentena → inspección**
- Disparador: anulación / baja aprobada / renovación entregada → orden de DEVOLUCIÓN
  (automática); el check-in manda unidades a `devuelto_revision` y crea/alimenta la ENTRADA.
- Quién: recepción hace el check-in (módulo Órdenes, sin cambios); **inventario inspecciona**.
- Nueva UI: Almacén → **Hoy** → grupo "Por inspeccionar (cuarentena)" con antigüedad →
  acciones de fila/lote: Inspección OK → bodega (condición reuso) · Dar de baja. La ficha
  drawer muestra de qué contrato/orden vino.
- Detrás: `onOrdenDevolucionWrite`, `onOrdenWritePool`, `liberar()`, `darDeBaja()` — sin cambios.
- Hoy: señal S13 del home → equipos.html?tab=devuelto_revision (la cuarentena solo avisaba
  por cron de correo; H1).

**F7 · Venta directa**
- Disparador: factura ya emitida a mano en QBO.
- Quién: inventario/admin.
- Nueva UI: Almacén → `Registrar venta` → asistente actual (seriales → validación de bodega →
  factura QBO → opcional: crear orden de PROGRAMACIÓN). El feed del home "Órdenes por crear"
  sigue recogiendo ventas sin orden.
- Detrás: `vender()`, `vincularOrdenProgramacion()` — sin cambios.
- Hoy: equipos.html → menú → Registrar venta.

**F8 · Baja y reactivación**
- Nueva UI: acción de fila en Existencias (o desde la ficha drawer). Baja exige motivo;
  reactivar solo desde estado `baja`. Sin cambios de fondo.
- Hoy: equipos.html, igual — solo cambia la superficie.

**F9 · Clasificación, conflictos y verificación**
- Disparador: residuos de migración (`por_clasificar`, `verificado:false`,
  `serial_compartido` con 2+ modelos).
- Quién: inventario.
- Nueva UI: Almacén → **Hoy** → grupos "Por clasificar", "Conflictos", "Sin verificar" con
  las acciones de lote actuales (corregir a bodega, fusionar fichas, marcar verificados).
  Cuando una cola llegue a 0 de forma estable, su grupo desaparece de la bandeja (son colas
  de migración, no de operación).
- Detrás: `corregirABodega()`, `fusionarPoolFicha`, `verificar()` — sin cambios.
- Hoy: tarjetas dentro de equipos.html.

**F10 · Piezas (repuestos)**
- Nueva UI: Almacén → **Piezas**: un grid; inventario edita identidad/stock/mínimos,
  contabilidad edita precio/costo/QBO **en la misma pantalla** (columnas con candado por rol,
  cada rol ve lo que el otro cambió). Consumos siguen descontando desde órdenes.
- Detrás: `piezasService` — sin cambios. Nota: endurecer reglas de campos de precio (H8).
- Hoy: piezas.html y piezas-tarifas.html sin verse entre sí (H3).

**F11 · Reporte de inventario**
- Nueva UI: Existencias → `Exportar` (Excel, igual) y `Copiar reporte` (HTML para correo,
  generado del MISMO cálculo de la tabla — P6). Se retira vista-correo.html.
- Hoy: exportar en index.html + vista-correo.html sin gate (H5, H8).

### FINANZAS

**F12 · Catálogo y tarifas (modelos · piezas · cargos)**
- Disparador: modelo/pieza/cargo nuevo, cambio de precio, mapeo QBO.
- Quién: contabilidad (tarifas/QBO); inventario (identidad de modelos y piezas).
- Nueva UI: Finanzas → **Catálogo** → sub-pestaña correspondiente. Ficha drawer por ítem
  con: identidad · tarifas · mapeo QBO · uso (en cuántos contratos/fichas del pool aparece).
  Importar de QBO y proponer mapeo se conservan como acciones del grid.
- Detrás: `modelosService`, `piezasService`, `cargosService`, callables QBO — sin cambios.
- Hoy: 3 páginas separadas con el mismo patrón triplicado (H3, H4).

**F13 · Vincular clientes ↔ QuickBooks**
- Nueva UI: Finanzas → **QuickBooks**: las 5 vistas actuales (sugeridos/múltiples/sin
  match/vinculados/duplicados) + tarjeta de estado de conexión (entorno, realm, expiración
  del refresh token — hoy invisible y es un riesgo conocido).
- Detrás: `listQBOCustomers` — sin cambios. El campo vinculado será leído por el emisor (F15).
- Hoy: facturacion/clientes-qbo.html.

**F14 · Activar facturación de un contrato**
- Disparador: contrato aprobado/activo; señales de entrega/seriales/firma.
- Quién: contabilidad.
- Nueva UI: Finanzas → **Activación** (landing). Mejora clave: los chips de requisitos
  fallidos son CTAs — "falta mapeo del modelo X" abre la ficha del modelo en drawer;
  "cliente sin QBO" abre el match del cliente; se corrige y se vuelve sin perder el contexto.
  Toggles de auto-activación y alertas se quedan aquí.
- Detrás: `gestionarFacturacion`, `facturacionDiaria` — sin cambios. Nota: unificar el
  `readiness()` duplicado en un módulo compartido (hoy 2 copias que ya divergieron una vez).
- Hoy: activacion.html → saltos a modelos.html / clientes-qbo.html perdiendo contexto.

**F15 · Emisión mensual (futuro) y Panorama**
- Nueva UI: Finanzas → **Emisión**: mientras no exista el emisor, la pestaña muestra la
  vista previa por contrato (ya existe) y el checklist del camino a QBO — honesto, no un
  botón muerto. Cuando exista: preview consolidado por cliente → corrida en borrador →
  emisión, con historial de períodos (`facturacion_periodos`).
  **Panorama**: el dashboard actual con su fuente etiquetada; cuando el emisor exista,
  cambia a facturas reales y las dos nociones de "facturado" (H6) convergen.
- Detrás: pendiente de F1-F6 del plan QBO (`SISTEMA_TOP_DOWN.md` §5.4) — fuera del alcance
  de esta propuesta.

---

## 5. Qué NO cambia

- **Modelo de datos completo**: `equipos_pool` + kardex, colecciones de contratos/órdenes,
  catálogos. Cero migraciones de datos.
- **Todos los triggers y callables**: la máquina de estados del pool, las colas, la
  activación. Esta propuesta es una reorganización de la **capa de presentación**.
- **Los servicios de front** (`equiposPoolService`, `colaInventarioService`, `piezasService`,
  `modelosService`…): se reutilizan; lo que se unifica es quién los pinta.
- **Las páginas de contratos** (`seriales.html`, `transicion.html`): siguen siendo el lugar
  donde se trabaja el detalle del contrato; la bandeja solo cambia cómo se llega.
- **El módulo de Órdenes**: check-in de devolución y cierre de ENTRADA quedan donde están.

---

## 6. Ruta de implementación sugerida (cuando se decida construir)

| Etapa | Entrega | Riesgo |
|---|---|---|
| **E0** | Función única de agregación de stock (mata las 3 copias del cálculo); retirar `vista-correo.html`; redirects. | Bajo |
| **E1** | **Almacén · Hoy**: fusionar `pendientes.html` + tarjetas-cola de `equipos.html` en una bandeja; home pasa a 2 tarjetas con badge. | Bajo (solo lectura + navegación) |
| **E2** | **Almacén · Existencias**: unificar index+equipos con drill-down y ficha drawer; asistentes de Recibir/Conteo/Venta colgados aquí. | Medio (es la página más usada) |
| **E3** | **Almacén · Piezas** y **Finanzas · Catálogo**: un solo grid parametrizado por colección con permisos por columna. | Medio |
| **E4** | **Finanzas** completo: pestañas, CTAs de corrección en contexto en Activación, tarjeta de estado QBO, Panorama integrado. | Bajo |
| **Transversal** | Endurecer reglas (H8): campos `facturacion_*` de contratos, `facturacion_config`, precios de piezas. | — antes de E4 |

Cada etapa deja el sistema funcionando; las páginas viejas pueden convivir con redirect
hasta que su reemplazo esté probado.

---

## 7. Apéndice — hallazgos de limpieza detectados en la auditoría

Para no perderlos (independientes de la propuesta de UI):

1. `vista-correo.html` sin gate de rol (única página del módulo así).
2. Reglas: `facturacion_estado`/`facturable`/`entrega_confirmada` fuera de
   `touchesCFOwnedFields()`; `empresa/facturacion_config` y `clientes.qbo_*` escribibles
   por cualquier autenticado.
3. `readiness()` duplicado en `facturacion-activacion.js` y `facturacionDiaria.js`
   (ya divergieron una vez con `seriales_omitidos_count`).
4. Campos write-only: `clientes.qbo_customer_id`, `facturacion_config.qbo_item_frecuencia_id/
   qbo_item_mantenimiento_id`, `facturacion_entrega_at`, `equipos[].fecha_fin_facturacion`
   (nunca se escribe → una baja no detiene el cálculo).
5. Cargos únicos ("primer pago") no se facturan (`calcularFacturaContrato` los salta).
6. Mantenimiento negativo solo advierte (precio de contrato < alquiler+frecuencia del catálogo).
7. `verHistorico()` con `alert()` en `inventario-index.js`; KPIs compat muertos
   (`kpiAltoMov`/`kpiStockBajo`).
8. `cargar-inventario.html` enlaza a `modelos.html`, inaccesible para el rol inventario.
9. `admin-equipos-cliente.html` reporta desde `ordenes.equipos[]`, no del pool (muestra
   historia de taller, no inventario real).
10. `qbo_webhook_events` es write-only (webhook persiste, nadie procesa).
11. Entorno QBO default `sandbox` mientras el plan declara producción conectada.
12. Refresh token de Intuit (~100 días) sin monitoreo → la tarjeta de estado QBO de F13
    lo haría visible.
