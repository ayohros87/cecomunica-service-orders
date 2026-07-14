# CeComunica — Branding oficial (vigente)

> **Esta carpeta es la identidad actual de la marca.** No hay rediseños
> pendientes: lo que está aquí es lo que la app, los correos y los documentos
> usan hoy. Las exploraciones históricas de logo viven en
> `design-system/archivo/` y ya están cerradas.

Colores de marca: navy **`#0B2A47`** · cyan **`#00B4D8`**
(tokens completos en `design-system/colors_and_type.css`).

## Qué es cada asset

| Asset | Uso |
|---|---|
| `cecomunica-monogram*.svg` | Monograma **CC** — la marca compacta. Base de favicons e íconos de app. Variantes: normal, `-inverse` (fondos oscuros), `-mono` (una tinta) |
| `logo-lockup-horizontal*.svg` | Logo completo horizontal (monograma + wordmark) — headers, documentos apaisados. `-compact` para espacios angostos |
| `logo-lockup-vertical*.svg` | Logo completo vertical — portadas, colateral |
| `logo-wordmark*.svg` | Solo el texto CeComunica — cuando el monograma ya está presente |
| `app-icons/` | Set completo iOS/Android/web/PWA derivado del monograma (ver su LEEME) |

## Assets que viven FUERA de esta carpeta (a propósito)

- **`public/logo_cecomunica.png`** — logo bitmap referenciado con URL absoluta
  desde los emails ya enviados a clientes (`functions/templates/email-base.html`).
  **Nunca moverlo ni renombrarlo.**
- **Favicons y `apple-touch-icon.png` en la raíz de `public/`** — convención web:
  los navegadores/iOS los buscan en la raíz del sitio. Son copia del set de
  `app-icons/web/`.
