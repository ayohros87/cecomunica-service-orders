# Propuesta "Command Center, en claro"

Contrapropuesta a la maqueta `Rediseño CeComunica - Índice.html` (bundle oscuro de la
carpeta padre). Mantiene la dirección Command Center — rail de señal navy, estado como
señal viva, mono para datos — con dos correcciones de fondo:

## Decisiones

1. **Todo en claro salvo el rail.** El sistema se usa 8 horas al día; el navy queda
   reservado al rail de navegación, la franja de marca del home y acentos. El índice
   de presentación también es claro.
2. **Plantillas construidas sobre las pantallas reales de hoy:**
   - `home.html` — el home real (`public/index.html`): módulos con visibilidad por rol,
     buscador y atajos de teclado (O/P/I/C/V/Q/X/F), más una fila de señales accionables
     (por asignar, asignadas, completadas, cotizaciones en espera) que hoy no existe.
   - `ordenes.html` — bandeja con los **5 estados reales**: POR ASIGNAR, RECIBIDO EN
     MOSTRADOR, ASIGNADO, COMPLETADO (EN OFICINA), ENTREGADO AL CLIENTE.
   - `detalle-orden.html` — sucesor de la eliminada «Trabajar orden» (2026-07-06):
     stepper del ciclo real, intervención por equipo en **modal con materiales**,
     candado por cotización aprobada, fotos e historial.
3. **El pulso animado (`sig--live`) solo en estados que piden acción**
   (POR ASIGNAR, RECIBIDO EN MOSTRADOR). Si todo pulsa, nada destaca.

## Archivos

- `ceco-command.css` — sistema completo (tokens de marca + shell + componentes).
- `index.html` — índice de la propuesta (hub claro).
- `home.html`, `ordenes.html`, `detalle-orden.html` — plantillas ancla navegables.

Fuentes vía Google Fonts e iconos Lucide vía unpkg (requiere internet, igual que la app).
Datos de ejemplo ficticios. Nada de esto toca `public/`.

## Pendiente tras aprobar dirección

Nueva cotización (umbral auto-envío + aprobación por tipo), patrón "seriales con
candado", familia de impresión (cotización formal, contrato, nota de entrega,
reporte KPI), bandejas restantes, panel admin y verificación pública QR.
