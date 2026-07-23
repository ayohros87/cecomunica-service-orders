# Handoff: Carta de presentación (CeComunica)

## Overview
Documento comercial imprimible de **2 páginas** (portada + "Quiénes somos") que acompaña a las cotizaciones de CeComunica. Sirve como carta de presentación de la empresa: una portada de marca con el mensaje principal y datos de contacto, seguida de una página institucional con estadísticas, beneficios, servicios y sectores atendidos.

**Objetivo de la integración:** anteponer la carta a las cotizaciones **de ventas** (`origen = 'comercial'`), de modo que el PDF salga con la carta en las páginas 1–2 y la cotización en la 3. Las cotizaciones **de taller** (`origen = 'orden'`, generadas desde una orden de servicio) **no la llevan nunca** y no muestran el control en el editor.

## About the Design Files
Los archivos de este paquete son **referencias de diseño creadas en HTML/CSS** — un prototipo de alta fidelidad que muestra el aspecto buscado, **no** código de producción para copiar tal cual. La tarea es **recrear este diseño dentro del sistema de cotizaciones existente**, siguiendo sus patrones.

> **Corrección respecto a la versión anterior de este handoff:** decía que la app era React (`ListView`, `EditorView`, `PrintView`, `app.jsx`). **Eso es incorrecto.** El sistema de cotizaciones es **HTML estático + JavaScript vanilla (IIFE + globals en `window`)** sobre Firebase Hosting. No hay React, ni bundler, ni JSX. Los módulos se cargan con `<script defer>` y se comunican por globals (`window.CotState`, `window.CotizacionesService`, `window.CotizacionTotales`, `FMT`). La carta se implementa siguiendo ese mismo patrón — ver "Plan de implementación".

`ceco-next.css` **no debe incorporarse al proyecto.** La app ya tiene los mismos tokens en `public/css/ceco-ui.css` (mismas fuentes, misma paleta) y `.cq-page` ya declara las variables navy/signal/blue que la carta necesita. Traer `ceco-next.css` duplicaría el design system. Está en este paquete solo como referencia de lectura.

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografía, espaciados e imágenes son finales. Recrear la UI de forma pixel-perfect usando los patrones del codebase destino. Las medidas y valores exactos están documentados abajo y en el HTML adjunto.

---

## Screens / Views

### Página 1 · Portada (`.sheet.cover` → `.cq-page.cq-carta.cq-carta--cover`)
- **Purpose**: Impacto de marca + mensaje principal + contacto. Primera cara del documento.
- **Layout**: Hoja Letter `816 × 1056 px` (@96dpi; = 8.5"×11"). Fila horizontal de dos columnas:
  - **Columna izquierda (`.cover__main`)**, `flex:1`, padding `54px 44px 46px`, fondo `--navy-900` (#061829) con patrón de puntos (radial-gradient `rgba(120,200,255,.10) 1px` cada `24px`). Distribución vertical en columna con el bloque de título empujado hacia abajo (`margin-top:auto`).
  - **Columna derecha (`.cover__photo`)**, `width:352px`, foto a sangre (`object-fit:cover`, `object-position:42% 6%`) con degradado navy en el borde izquierdo para fundir con el texto.
  - **Banda decorativa inferior (`.band`)**: barra de `6px` a lo ancho, `linear-gradient(90deg, --navy-800, --blue-500 55%, --cyan-400)`.
- **Components**:
  - **Logo** (`.cover__brand img`): lockup blanco/inverso, altura `42px`, arriba a la izquierda.
  - **Eyebrow**: texto "Carta de presentación", `600 12px/1.3`, `letter-spacing:.18em`, mayúsculas, color `--cyan-400` (#43AAEF).
  - **H1** (`.cover h1`): "Comunicación crítica que *no falla* cuando más importa." — `800 37px/1.07` Barlow, `letter-spacing:-.02em`, color #fff, `max-width:14ch`, `text-wrap:balance`. El fragmento "no falla" va en `<em>` con color `--cyan-400` (sin cursiva).
  - **Lede** (`.cover__lede`): párrafo `15px/1.62`, color `rgba(255,255,255,.78)`, `max-width:40ch`. Texto: "Diseñamos, instalamos y damos soporte a redes de radiocomunicación crítica para seguridad pública, transporte, salud y emergencias."
  - **Chips** (`.pill` ×3): "TETRA", "DMR", "POC sobre LTE". Píldora (`border-radius:999px`), borde `1px rgba(120,200,255,.30)`, fondo `rgba(67,170,239,.10)`, texto `600 12.5px` #fff `letter-spacing:.04em`, con un `.dot` de `7px` color `--cyan-400` y glow.
  - **Bloque de contacto** (`.cover__contact`): grid 2 columnas, separado arriba por borde `1px rgba(255,255,255,.14)`. 4 ítems (`.cc`) con icono Lucide `--cyan-400` `16px` + etiqueta en negrita (#fff) y valor `rgba(255,255,255,.82)`. **Estos 4 valores NO se hardcodean** — salen de `catalogos.emisor` (ver "Datos parametrizados"):
    - `map-pin` — **Oficina**: `emisor.dir2` / `emisor.dir1`
    - `phone` — **Teléfono**: `emisor.tel`
    - `mail` — **Correo**: `emisor.email`
    - `globe` — **Web**: `emisor.web`

### Página 2 · Quiénes somos (`.sheet` → `.cq-page.cq-carta`)
- **Purpose**: Credibilidad institucional — trayectoria, cifras, beneficios, servicios, sectores y cierre con contacto.
- **Layout**: Misma hoja `816 × 1056 px`, fondo blanco, `.sheet__pad` padding `38px 52px`, columna flex. Banda decorativa `.band` inferior igual que la portada.
- **Components (de arriba a abajo)**:
  - **Doc-head** (`.doc-head`): fila con lockup a color (altura `38px`) a la izquierda y, a la derecha, eyebrow "Acerca de" + H2 "Quiénes somos" (`700 19px` Barlow, color `--navy-800`). Borde inferior `2px --navy-800`.
  - **QS-hero** (`.qs-hero`): grid `1fr 250px`, gap `24px`.
    - Texto: eyebrow "33 años de experiencia" + H3 "Soluciones de radiocomunicación confiables, hechas en Panamá." (`700 22px/1.14` Barlow, `max-width:32ch`). Debajo, **lead-quote** (`.lead-quote`): recuadro con borde-izquierdo `3px --accent` y fondo `--accent-soft` (#E6F4FB), radio `0 6px 6px 0`, texto `14px/1.5` color `--navy-800`: "**CeComunica** es una empresa con **33 años de experiencia** brindando soluciones de radiocomunicación en Panamá." Luego **body-copy** `13.5px/1.55`: "**Nuestro objetivo:** ofrecerle una solución eficiente, confiable y adaptada a sus necesidades, garantizando calidad, soporte técnico y acompañamiento, con propuestas económicas competitivas."
    - Foto (`.qs-hero__photo`): asesora con radio, radio `10px`, borde `1px --line`, con caption inferior sobre degradado navy + icono `radio`: "Asesoría y demostración de equipos en sitio."
  - **Stat-row** (`.stat-row`): grid 3 columnas, gap `14px`. Tres tarjetas (`.stat`), la primera en variante navy (`.stat--navy`, degradado `--navy-800→--navy-900` + patrón de puntos). Valor `800 30px` Barlow con `.unit` `14px`:
    - **33** años — "De trayectoria en el mercado panameño" (tarjeta navy)
    - **+200** clientes — "A nivel nacional e internacional"
    - **3** tecnologías — "TETRA · DMR · POC sobre LTE"
  - **Cols** (`.cols`): grid 2 columnas, gap `26px`. Dos `.col-card` (borde `1px --line`, radio `10px`, sombra `--shadow-xs`), cada una con `h4` (eyebrow en `--accent` con icono) + lista de checks (icono `check` color `--ok` #1FA56B):
    - **Beneficios** (icono `zap`): Comunicación instantánea y segura · Reducción de tiempos de respuesta · Mayor control operativo · Integración con sistemas tecnológicos · Escalabilidad según el crecimiento · Precios competitivos
    - **Servicios incluidos** (icono `wrench`): Asesoría personalizada · Instalación y configuración · Soporte técnico especializado · Mantenimiento preventivo y correctivo
  - **Exp-block** (`.exp-block`): eyebrow "Experiencia · +200 clientes a nivel nacional e internacional" + fila de **sectores** (`.sector`, píldoras con borde `--line`, fondo `--gray-50`, icono `--accent`): Seguridad (`shield`) · Supermercados (`shopping-cart`) · Educación (`graduation-cap`) · Gobierno (`landmark`) · Hotelería (`bed-double`) · Y otros servicios (`more-horizontal`).
  - **Close-strip** (`.close-strip`): grid `1.45fr 1fr`, fondo `--navy-900` + patrón de puntos, radio `10px`.
    - Izquierda: eyebrow "Nuestro compromiso" + cita `700 15px/1.36` Barlow #fff con comillas `--cyan-400`: "Estamos preparados para acompañar a su organización con soluciones de comunicación confiables, innovadoras y adaptadas a sus necesidades."
    - Derecha: 3 contactos (`.cc`, iconos `--cyan-400`): `emisor.tel` (Lun a Vie, 8:00 a.m. – 5:00 p.m.) · `emisor.email` · `emisor.web`
  - **Pg-foot** (`.pg-foot`): pie con borde superior `1px --line`, izquierda `emisor.razon` + dirección, derecha el folio en mono. **Ver "Decisiones abiertas · Folio de página"** — el prototipo dice "02 / 02", pero integrado a una cotización la carta es 2 de 3.

---

## Contexto del codebase destino

Ruta: `C:\Projects\cecomunica-service-orders` · Firebase Hosting + Firestore.

### Superficies que renderizan el documento (son DOS)

El markup `cq-*` de la cotización está **duplicado** hoy entre dos archivos, y la carta tiene que entrar en ambos:

| Archivo | Quién la ve | Por qué importa |
|---|---|---|
| `public/js/pages/imprimir-cotizacion.js` | Interno (vendedor) | Vista previa e impresión desde el sistema. |
| `public/js/pages/verify-cotizacion.js` | **El cliente** | **La superficie que de verdad cuenta.** Lee el mirror público `cotizacion_verificaciones/{docId}`. |

Las cotizaciones **no se envían como PDF adjunto**: `cot-detalle.js → enviarPorCorreo()` genera un link público (`/verify/cotizacion.html?id=…&v=…`) y manda el link. El cliente abre esa página y presiona "Descargar PDF". **Si la carta solo entra en la vista interna, el cliente nunca la ve.**

### Encaje técnico (favorable)

Ya resuelto por el codebase, no hay que replicarlo:

- `.cq-page` es `width:816px; min-height:1056px` con `-webkit-print-color-adjust: exact` → `public/css/print-cotizacion.css:15-22`. **Mismas dimensiones exactas que las `.sheet` del prototipo.**
- `@page { size: letter; margin: 0 }` ya declarado → `print-cotizacion.css:112`.
- Barlow + IBM Plex Sans + IBM Plex Mono ya se importan → `public/css/ceco-ui.css:1`. No hay que cargar fuentes.
- Lucide ya está local y ambas páginas lo cargan (`/js/vendor/lucide.min.js` + `lucide.createIcons()`).
- Barra de impresión: ya existe `.cc-print-toolbar` con su botón `window.print()`. **No implementar el `.printbar` del prototipo** — es andamiaje de la demo.

### Ajuste necesario en el stage

`.cc-print-stage` está pensado para **una sola hoja** (`print-cotizacion.css:13`):

```css
.cc-print-stage { background:#5b6470; padding:40px; display:flex; justify-content:center; }
```

Con 3 hojas hay que apilarlas:

```css
.cc-print-stage { flex-direction: column; align-items: center; gap: 24px; }
@media print { .cq-page:not(:last-child) { page-break-after: always; } }
```

---

## El corte ventas vs. taller

**Ya existe el discriminador — no hay que crear esquema nuevo.**

- `cot-editor-state.js:232` (`toDoc`) escribe `origen: ui.origen || 'comercial'` por defecto.
- `cotizar-orden.js:589` lo sobrescribe con `doc.origen = 'orden'` y agrega `orden_id` para las cotizaciones que nacen de una orden de taller.

Test canónico, tolerante a documentos legacy anteriores al campo (por eso el `||`):

```js
// en public/js/pages/cot-editor-state.js, exportado por window.CotState
function esCotizacionDeTaller(doc) {
  return (doc?.origen || '') === 'orden' || !!doc?.orden_id;
}

function llevaCarta(doc) {
  return !esCotizacionDeTaller(doc) && doc?.incluye_carta !== false;
}
```

Un solo helper compartido por editor y vista de impresión — no repetir la condición en cada página.

---

## Plan de implementación

### Comportamiento elegido: toggle con default ON *(opción b)*

En cotizaciones **de ventas**, el editor muestra una casilla **"Incluir carta de presentación", marcada por defecto**. El vendedor puede desmarcarla (caso típico: reenvío a un cliente recurrente que ya recibió la carta). En cotizaciones **de taller** la casilla **no se renderiza** y la carta nunca se antepone — no es una casilla deshabilitada, es ausencia total del control.

### Archivos

| Archivo | Acción |
|---|---|
| `public/js/domain/cartaPresentacion.js` | **Nuevo.** IIFE que expone `window.CartaPresentacion.html({ emisor })` → string con las 2 hojas `<div class="cq-page cq-carta">`. Sin fetch, sin estado, sin efectos. |
| `public/css/print-carta.css` | **Nuevo.** Estilos del prototipo scopeados bajo `.cq-carta`, reusando los tokens que `.cq-page` ya declara. |
| `public/js/pages/imprimir-cotizacion.js` | Antepone `CartaPresentacion.html()` si `CotState.llevaCarta(doc)`. |
| `public/js/pages/verify-cotizacion.js` | Antepone la carta si el mirror trae `lleva_carta === true`. |
| `public/cotizaciones/imprimir-cotizacion.html` · `public/verify/cotizacion.html` | Agregar `<link>` a `print-carta.css` y `<script defer>` a `cartaPresentacion.js`. |
| `public/css/print-cotizacion.css` | Stage en columna + `page-break-after` (ver arriba). |
| `public/js/pages/cot-editor.js` | Casilla "Incluir carta de presentación" en el panel de la cotización, visible solo si `!esCotizacionDeTaller(draft)`. |
| `public/js/pages/cot-editor-state.js` | `toUi`: `incluye_carta: typeof doc.incluye_carta === 'boolean' ? doc.incluye_carta : true`. `toDoc`: `incluye_carta: !!ui.incluye_carta`. Exportar `esCotizacionDeTaller` y `llevaCarta` en `window.CotState`. |
| `public/js/pages/cot-detalle.js` | En `enviarPorCorreo()`, agregar `lleva_carta: CotState.llevaCarta(cot)` al payload del mirror (ver abajo). |
| `public/js/services/cotizacionesService.js` | En `ensureVerificacionPublica()`, persistir `lleva_carta: !!payload.lleva_carta`. |
| `public/img/carta/` | **Nuevo.** Las 2 fotos, optimizadas (ver "Assets"). |

### Cómo llega la decisión a la vista pública

La vista pública **no lee la cotización** — lee el mirror congelado `cotizacion_verificaciones/{docId}`, cuyo `snapshot` hoy **no incluye `origen`** (`cot-detalle.js`, objeto `snapshot`). Antes que exponer `origen` al documento público, guardar un booleano ya resuelto:

```js
// cot-detalle.js → enviarPorCorreo(), dentro del payload de ensureVerificacionPublica
lleva_carta: CotState.llevaCarta(cot),
```

Ventajas: la vista pública no necesita conocer la semántica de `origen`, y **los mirrors ya existentes no traen el campo → `undefined` → falsy → sin carta**, que es exactamente el comportamiento retroactivo deseado (ver abajo).

`firestore.rules:187` permite `create/update` a cualquier usuario autenticado **sin whitelist de campos**, así que agregar `lleva_carta` no requiere cambios de reglas.

### Retroactividad

`ensureVerificacionPublica()` es idempotente en el `code` pero **reescribe el `snapshot` en cada envío** (`set(..., { merge: true })`). Consecuencia:

- Links **ya enviados** que nadie vuelva a mandar: se quedan sin carta. Correcto — no se altera un documento que el cliente ya recibió.
- **Reenvío** de una cotización vieja de ventas: el mirror se regenera y **sí** incluirá la carta, según la casilla al momento de reenviar. También correcto.

No hace falta backfill ni migración.

---

## Datos parametrizados

La carta es **institucional y mayormente estática**. Lo único que se inyecta:

| Dato | Fuente |
|---|---|
| Razón social, dirección, teléfono, email, web | `catalogos.emisor` — doc `empresa/emisor` en Firestore, con fallback en `cot-editor-state.js:53` (`EMISOR_FALLBACK`) |

Los valores del fallback ya coinciden con los del prototipo (`+507 279-5570`, `ventas@cecomunica.com`, `www.cecomunica.com`, Vía Italia / Punta Paitilla). **No hardcodear ninguno en la carta** — si mañana cambia el teléfono, debe cambiar en un solo lugar.

**El ejecutivo NO va en la carta**, aunque el handoff anterior lo sugería. La cotización ya lo lleva con nombre, rol, email y teléfono en el bloque de firma (`.cq-sign`). Repetirlo dos páginas antes es ruido y una fuente más de desincronización. Por eso la firma del módulo es `html({ emisor })` y no `html({ emisor, ejecutivo })`.

Cifras institucionales ("33 años", "+200 clientes") quedan como texto fijo en el módulo. Si en algún momento deben ser configurables, su lugar natural es `empresa/emisor`, no un parámetro de render.

---

## State Management
Ninguno propio. La única pieza de estado es el booleano `incluye_carta` en el documento de la cotización, con el mismo ciclo de vida que el resto del borrador (`draft` en `cot-editor.js`, persistido por `toDoc`). Sin data-fetching: la carta no consulta nada, recibe `emisor` que las vistas ya cargan vía `CotState.bootstrapCatalogos()`.

## Interactions & Behavior
- **Impresión**: la maneja la toolbar existente. Cada `.cq-page` = una hoja Letter; salto de página entre hojas.
- **Iconos**: Lucide ya cargado; llamar `lucide.createIcons()` **después** de inyectar el HTML de la carta (las dos vistas ya lo hacen al final del render — basta con que la carta se inyecte antes de esa llamada).
- Sin animaciones ni estados hover propios: es material imprimible.
- **Responsive**: no aplica — documento de tamaño fijo. En pantalla se muestra centrado sobre el fondo del stage.

---

## Design Tokens

**Usar los que ya existen.** `.cq-page` declara (`print-cotizacion.css:18-20`):
`--navy #0B2A47` · `--navy-2 #143A5C` · `--signal #00B4D8` · `--blue #0091D7` · `--ink #0A1219` · `--paper #F5F7FA` · `--stone #E4E9EE` · `--stone-2 #C8D1DA` · `--fg2 #2F3942` · `--fg3 #4A5560` · `--fg4 #6B7884`

Tokens del prototipo que **no** tienen equivalente en `.cq-page` y hay que declarar localmente en `.cq-carta`:
- `--navy-900 #061829` (fondo de portada y close-strip) · `--navy-800 #0B2A47` (= `--navy`)
- `--cyan-400 #43AAEF` (eyebrows, iconos, dots sobre navy)
- `--accent-soft #E6F4FB` (fondo del lead-quote) · `--ok #1FA56B` (checks) · `--line #DDE4EB` · `--gray-50 #F6F8FB`

**Tipografía** (ya disponible): display `var(--font-display)` = Barlow (700/800) · body `var(--font-body)` = IBM Plex Sans · mono `var(--font-mono)` = IBM Plex Mono.
Eyebrow: `600 12px/1.3`, `letter-spacing:.14em` (portada `.18em`), mayúsculas. Tracking display negativo (`-.02em` en H1, `-.01em` en H2/H3).

**Radios**: `4 / 6 / 10 / 14 / 999px`. **Espaciado** base 4px. **Banda decorativa**: `6px`.

---

## Assets

### Logos — usar los del proyecto, no los de este paquete
El codebase ya tiene los oficiales en `public/brand/`:

| Uso | Archivo |
|---|---|
| Portada (sobre navy) | `/brand/logo-lockup-horizontal-inverse.svg` |
| Página 2 (sobre blanco) | `/brand/logo-lockup-horizontal.svg` |

`assets/lockup.svg` y `assets/lockup-inverse.svg` de este paquete son copias de referencia — **no** copiarlas a `public/`.

### Fotos — ya optimizadas y en producción

| Fuente (local) | En la app | Peso |
|---|---|---|
| `assets/photos/team-studio.png` (2.0 MB) | `public/img/carta/cover-team-studio.jpg` 1024×1536 | 154 KB |
| `assets/photos/team-office-woman.png` (2.0 MB) | `public/img/carta/qs-team-advisor.jpg` 500×752 | 68 KB |

Los PNG fuente **están en `.gitignore`** (`design-system/**/assets/photos/`): pesan 4 MB entre los dos y no aportan nada al repo una vez derivados los JPG. Un clon del proyecto **no los tendrá** — si hay que regenerar los assets, pedirlos al autor del handoff o partir de la fotografía original.

Los JPG sí se versionan: son los que sirve la app. Ambos salieron a calidad 86 sin recortes, sobre un presupuesto de 200 KB por imagen — la página pública es la que el cliente abre desde el correo, muchas veces desde el celular, y hasta ahora no cargaba ninguna imagen.

El ancho se eligió ≈2× el de render (portada 352px → 1024 disponible en el original; interior 250px → 500px). `object-position` se conserva: `42% 6%` en la portada, `46% 16%` en la interior.

Son imágenes de referencia: sustituir por fotografía real de CeComunica cuando esté disponible, manteniendo el estilo cool/industrial y regenerando los JPG con el mismo presupuesto de peso.

### Iconos
Lucide (ya local): `map-pin`, `phone`, `mail`, `globe`, `radio`, `zap`, `wrench`, `check`, `shield`, `shopping-cart`, `graduation-cap`, `landmark`, `bed-double`, `more-horizontal`.

---

## Decisiones abiertas

**Folio de página.** El prototipo cierra la página 2 con "02 / 02" porque es un documento suelto. Antepuesta a una cotización de 1 página, el documento pasa a tener 3. Opciones: (a) quitar el folio de la carta y dejarlo solo en la cotización; (b) numerar dinámicamente 01/03 · 02/03 · 03/03. La (a) es más simple y no obliga a que la carta sepa cuántas páginas tiene la cotización — **recomendada** salvo indicación contraria.

---

## Files de este paquete
- `carta-presentacion.html` — prototipo hifi completo (2 páginas, CSS inline en `<style>`). Referencia visual, no código de producción.
- `ceco-next.css` — tokens del design system. **Referencia de lectura únicamente**; no incorporar al proyecto (ver "About the Design Files").
- `assets/` — logos y fotos de referencia. Los logos ya existen en `public/brand/` y son los que usa la implementación. Las fotos (`assets/photos/`) están gitignoradas: ver "Assets · Fotos".
