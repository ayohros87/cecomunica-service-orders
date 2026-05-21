# App UI Kit — CeComunica

Operational surface kit for the **service-orders / repair workflow** app
(`public/ordenes/*.html`). Companion to `ui_kits/website/` (marketing site).

Built entirely on top of `../../colors_and_type.css`. No additional token files needed.

---

## Structure

```
ui_kits/app/
├── index.html   ← clickable demo (all components on one page)
├── app.css      ← all app-kit styles (imports tokens from ../../colors_and_type.css)
└── README.md    ← this file
```

---

## Components included

| Component | Section in demo | Key classes |
|-----------|----------------|-------------|
| **App shell** — topbar, breadcrumbs, page header | `#app-shell` | `.app-topbar`, `.app-breadcrumbs`, `.app-page-header` |
| **Buttons** — 5 variants × 3 sizes, icon, loading, group | `#buttons` | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-accent` |
| **Status chips** — 9 order states + priority | `#chips` | `.chip-estado`, `.chip-prioridad` |
| **Data table** — sortable, sticky header, filter bar, pagination, skeleton | `#data-table` | `.app-table-wrap`, `table.app-table`, `.filter-bar`, `.app-table-footer` |
| **Form kit** — inputs, selects, textarea, file upload, checkboxes, sections, error states | `#forms` | `.form-field`, `.form-input`, `.form-select`, `.form-textarea`, `.form-file-zone` |
| **Modal / dialog** — confirm + content variants | `#modals` | `.modal-backdrop`, `.modal` |
| **Toasts** — success, error, warning, info | `#toasts` | `.toast-region`, `.toast` |
| **Empty / loading / error states** — skeletons, empty, error | `#empty` | `.app-empty-state`, `.skeleton` |

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

## Planned additions (next iteration)

- [ ] Tabs / accordion — order detail sections (Equipo, Cliente, Intervenciones, Fotos, Cotización)
- [ ] Stepper / timeline — repair progress (`estado_reparacion`, `trabajar-orden`)
- [ ] Photo grid + lightbox — `fotos-taller`
- [ ] Signature pad pattern — `firmar-entrega`
- [ ] Print stylesheet kit — `imprimir-orden`, `nota-entrega`

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
`chevron-right`, `alert-triangle`, `check-circle`, `x-circle`, `info`, `save`,
`log-out`, `settings`, `trophy`, `shield`, `home`, `building-2`, `phone`, `mail`.
