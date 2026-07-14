# App UI Kit — CeComunica

Operational surface kit for the CeComunica platform. Built entirely on top of
`../../colors_and_type.css`. No additional token files needed.

---

## Structure

```
ui_kits/app/
├── index.html               ← portal landing (7 area cards)
├── foundations.html         ← generic components (buttons, forms, modals, dropdowns, tooltips, banners…)
├── ordenes.html             ← Órdenes de Servicio kit + applied examples
├── poc.html                 ← PoC inventory kit
├── contratos.html           ← Contratos kit (list / new / edit / print / verify)
├── cotizaciones.html        ← Cotizaciones kit (list / new / edit / print)
├── clientes.html            ← Clientes kit (list with bulk / edit)
├── inventario.html          ← Inventario kit (radios / modelos / piezas / cargar)
├── print-demo.html          ← print-base.css preview (orden / cotización)
├── print-demo-contrato.html ← print-base.css preview (contrato)
├── app.css                  ← all app-kit styles
├── app-demo.js              ← shared demo-page JS
└── README.md                ← this file
```

---

## Areas

| Area | File | Highlights |
|------|------|------------|
| **Foundations** | `foundations.html` | Buttons · Forms · Modals · Toasts · Empty · KPI · CRUD · Toggle · Combobox · Readiness · Disclosure · Review · Side sheet · Split pane · Details · Bulk bar · XLSX import · **Module grid (home)** · **Auth shell (login)** · **Toggle pill** · **Dropdown** · **Banner / alert** · **Floating tooltip** · **Pager input** · **Responsive cards** · **Empty-state hint** · **Page-header centered** |
| **Órdenes** | `ordenes.html` | Shell · Chips · Tabla · Acordeón · Editable · Footer strip · Galería · Firma · **Aplicado · Lista · Trabajar · Nueva · Progreso de Técnicos · Configuración** |
| **PoC** | `poc.html` | Lista · Batch · **Vendedores rápido · Imprimir equipos** |
| **Contratos** | `contratos.html` | QR · Multi-firma · **Lista · Nuevo · Editar · Imprimir · Verificar (público)** |
| **Cotizaciones** | `cotizaciones.html` | Chips · **Lista · Nueva · Editar · Imprimir** |
| **Clientes** | `clientes.html` | **Lista densa con bulk · Editar (ficha)** |
| **Inventario** | `inventario.html` | **Radios · Modelos · Piezas · Cargar (XLSX)** |

Each area page has its own intra-page nav and a "← Portal" link back to
`index.html`. The portal has no nav — just 7 cards.

---

## New primitives (R3)

Available in `app.css`, demoed in `foundations.html`:

| Primitive | Class | Use case |
|-----------|-------|----------|
| Module grid | `.module-grid` / `.module-card` | Home / launcher with per-role visibility |
| Auth shell | `.auth-shell` / `.auth-brand` / `.auth-card` | Login + reset password |
| Toggle pill | `.toggle-pill` | Compact inline filter switch |
| Dropdown menu | `.dropdown` / `.dropdown-menu` / `.dropdown-item` | Desktop action overflow |
| Floating tooltip | `.tooltip-floating` | Hover preview (e.g. equipos en tabla de contratos) |
| Alert banner | `.alert-banner` (+ success / warning / error) | In-flow status above a page or form |
| Page header centered | `.page-header-centered` | Long-form pages (nueva orden, cotización, contrato) |
| Pager input | `.pager-input` | "Página N / total" for huge tables |
| Responsive cards | `.responsive-table-wrap` / `.responsive-cards` / `.responsive-card` | Table → card stack below 900px |
| Empty-state hint | `.empty-state-hint` | "Sin resultados / Prueba con menos filtros" |

---

## Order state chip map

| Estado | Class |
|--------|-------|
| Recibida | `.chip-estado.chip-recibida` |
| En diagnóstico | `.chip-estado.chip-diagnostico` |
| Cotizada | `.chip-estado.chip-cotizada` |
| Aprobada | `.chip-estado.chip-aprobada` |
| En reparación | `.chip-estado.chip-reparacion` |
| Lista para entrega | `.chip-estado.chip-lista` |
| Entregada | `.chip-estado.chip-entregada` |
| Cancelada | `.chip-estado.chip-cancelada` |
| En espera | `.chip-estado.chip-espera` |

---

## Usage

```html
<link rel="stylesheet" href="../../colors_and_type.css">
<link rel="stylesheet" href="app.css">

<!-- Status chip -->
<span class="chip-estado chip-reparacion">En reparación</span>

<!-- Button -->
<button class="btn btn-primary">
  <i data-lucide="plus"></i> Nueva orden
</button>
```

Lucide icons (same CDN as the website kit):
```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
<script>lucide.createIcons();</script>
```

Recommended app-side icon allowlist: `clipboard-list`, `wrench`, `camera`, `pen-tool`,
`printer`, `qr-code`, `truck`, `user-check`, `clipboard`, `wifi-off`, `search`,
`sliders-horizontal`, `refresh-cw`, `more-horizontal`, `chevron-left`, `chevron-right`,
`alert-triangle`, `check-circle`, `x-circle`, `info`, `save`, `log-out`, `settings`,
`trophy`, `shield`, `home`, `building-2`, `phone`, `mail`, `smartphone`, `file-text`,
`layers`, `receipt`, `users`, `package`, `puzzle`, `briefcase`, `radio-tower`,
`scan-line`, `shield-check`.
