# CeComunica — Iconos de app

Set completo del monograma **CC** (acabado completo: placa navy con volumen,
trazos en relieve, nodo con halo de señal) listo para iOS, Android, web y PWA.

Color de fondo de marca: **`#0B2A47`** (navy). Acento: **`#00B4D8`** (cyan).

---

## 📁 svg/ — fuentes vectoriales
| Archivo | Uso |
|---|---|
| `app-icon-fullbleed.svg` | Cuadrado a sangre completa, sin esquinas redondeadas (lo hace la plataforma) |
| `app-icon-rounded.svg` | Con placa redondeada (rx10) y esquinas transparentes — para web/favicon |
| `app-icon-mono.svg` | Un solo tono, plano — impresión a una tinta |

Si tu pipeline rasteriza solo (Xcode 14+, Android Studio Image Asset),
usa `app-icon-fullbleed.svg` como única fuente.

---

## 🍎 ios/
PNG cuadrados, opacos, full-bleed (iOS redondea las esquinas automáticamente).
`AppIcon-1024.png` es el del App Store. Arrastra la carpeta a un
**AppIcon set** en `Assets.xcassets` o usa "Single Size" con el de 1024.

---

## 🤖 android/
- `legacy/ic_launcher_*.png` — íconos cuadrados clásicos por densidad
  (mdpi…xxxhdpi) → `res/mipmap-*/`
- `adaptive-foreground/ic_launcher_foreground_*.png` — capa frontal del
  ícono adaptativo (el mark centrado dentro de la safe-zone) → `res/mipmap-*/`
- `ic_launcher_background.xml` — fondo navy sólido → `res/drawable/`
- `ic_launcher.xml` — el adaptive-icon que une fondo + frontal →
  `res/mipmap-anydpi-v26/`

(Más simple: en Android Studio, *New → Image Asset → Launcher Icons
(Adaptive)*, foreground = `app-icon-rounded.svg`, background color `#0B2A47`.)

---

## 🌐 web/ (incluye PWA / Next.js)
| Archivo | Uso |
|---|---|
| `icon-512.png`, `icon-192.png` | PWA / manifest |
| `apple-touch-icon.png` (180) | iOS Safari "Añadir a inicio" |
| `favicon-16/32/48.png` | Favicon del navegador |
| `manifest.webmanifest` | Manifiesto PWA (theme/background `#0B2A47`) |

### Next.js (App Router)
Lo más simple es usar la detección automática: copia a `app/` los archivos
`icon.svg`, `icon.png` y `apple-icon.png` que ya van en el paquete de handoff
anterior. **Borra el `app/favicon.ico` viejo** o tendrá prioridad.

### HTML clásico
```html
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0B2A47">
```
