# Preparación modular del frontend — plan para hoy

> **Fecha:** 2026-09-04 · **Decisión:** NO migrar a bundler/ES modules ahora. Sí dejar el código listo para que, cuando toque, la migración sea mecánica.
> **Costo:** cero build step, cero cambio visible para el usuario, cero sprint dedicado. Todo se hace de paso, dentro del trabajo funcional normal.

---

## 1. Por qué no migrar hoy

| Dato medido (2026-09-04) | Valor |
|---|---|
| JS propio de `ordenes/index.html`, sin comprimir | 756 KB en 40 archivos |
| Lo mismo con gzip, como viaja al navegador | 209 KB |
| Commits en los últimos 30 días | 315 |
| Archivos de `public/js` tocados en 30 días | 128 de 285 |

No hay dolor de rendimiento que un usuario note. Sí hay un ritmo de cambio funcional que una migración de 179 archivos chocaría de frente. La migración se hace cuando aparezca una de estas tres señales:

1. Un mes de estabilización sin backlog funcional urgente.
2. Un incidente real de producción por versión vieja en caché (no un susto).
3. Una página que mida más de 3 s hasta interactiva en un teléfono de bodega.

## 2. Qué frena hoy una migración (diagnóstico)

Estos son los cuatro obstáculos concretos. El plan ataca cada uno con una regla.

| Obstáculo | Medida | Por qué frena |
|---|---|---|
| **Globales implícitas.** 125 archivos son script plano; 28 de ellos definen 320 funciones top-level que quedan en `window` sin declararlo. | 125 / 179 archivos | Un módulo ES no filtra nada a `window`. Cada función suelta es una dependencia invisible que se rompe al convertir. |
| **Handlers inline.** `onclick="fn()"` en HTML y en strings generados desde JS. | 280 en 48 HTML + 225 en 32 JS = **505** | Es el bloqueo número uno. Los handlers inline solo ven globales. Con módulos dejan de funcionar todos a la vez. |
| **Mutación cruzada de namespaces.** `window.X.y = ...` desde un archivo que no es X. | 3 casos | Pocos, pero cada uno oculta una dependencia circular. |
| **Cache-busting a mano.** Sufijos `?v=` distintos por archivo; etiquetas sin sufijo. | 89 sufijos distintos; **72 etiquetas sin `?v=`** | JS y CSS se cachean 1 h con `stale-while-revalidate` de 24 h. Un archivo sin `?v=` puede servirse viejo hasta un día después del deploy. |

Dato a favor: los 3 duplicados navegador/functions (`pendientes`, `colaInventario`, `senales`) ya tienen test de sincronía. El bundler los eliminaría, pero hoy están controlados.

## 3. Las cinco reglas (vigentes desde hoy)

Aplican a **todo archivo nuevo** y a **todo archivo que se toque por trabajo funcional**. No se hace barrido dedicado.

### R1 · Un archivo = un namespace explícito

Todo archivo JS de `public/js` expone exactamente un nombre en `window`, mediante IIFE, y devuelve su API pública de forma explícita. Nada de funciones sueltas top-level.

```js
// Expone: window.AlgoService
// Depende de: window.Toast, window.OrdenesService
window.AlgoService = (() => {
  function listar() { /* ... */ }
  function guardar() { /* ... */ }
  return { listar, guardar };
})();
```

Cuando se toque un archivo de los 125 planos, se envuelve así. Las funciones que el HTML llama por `onclick` se mantienen en el objeto devuelto y el HTML pasa a llamarlas por `Namespace.fn()` **solo si la regla R2 no aplica todavía** a esa pantalla.

### R2 · Ningún handler inline nuevo

Prohibido `onclick=`, `onchange=`, `oninput=`, `onsubmit=` en HTML nuevo y en strings de `innerHTML` nuevos. Los eventos se enlazan con delegación sobre el contenedor, usando `data-accion`:

```js
// En el render:
`<button data-accion="entregar" data-id="${o.id}">Entregar</button>`

// Una sola vez, en init():
contenedor.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  acciones[btn.dataset.accion]?.(btn.dataset);
});
```

Este es el cambio que más vale. Cada handler que nace con delegación es uno menos de los 505 que la migración tendría que tocar.

### R3 · Nadie muta el namespace de otro

Si un archivo necesita colgar algo en `window.X`, el dueño de X expone una función para eso. Los 3 casos actuales se corrigen cuando se toque el archivo que los contiene.

### R4 · Cabecera de dependencias

Todo archivo abre con dos líneas fijas:

```
// Expone: window.Nombre
// Depende de: window.A, window.B
```

Esa cabecera es la futura lista de `import`. Si "Depende de" y el orden de `<script>` en el HTML no coinciden, es un bug de hoy, no de mañana.

### R5 · Toda etiqueta `<script src>` propia lleva `?v=`

Al tocar cualquier archivo JS, su etiqueta en **todos** los HTML que lo cargan recibe o actualiza el `?v=`. Las 72 etiquetas sin sufijo se van corrigiendo de paso. Esto no espera a la migración: es un riesgo de producción actual.

## 4. Orden de trabajo

### Paso 0 · Verificador (una tarde)

Un script `tools/check-modular.js`, al estilo del `check-css-import-first.js` que ya existe, que imprima cuatro conteos:

- archivos de `public/js` sin IIFE con namespace explícito
- funciones top-level sueltas
- handlers inline en HTML y en JS
- etiquetas `<script src>` propias sin `?v=`

Se corre a mano antes de cada commit grande. La meta es que los cuatro números **solo bajen**. Sin CI, sin bloqueo: es un marcador.

### Paso 1 · Los cinco archivos calientes (un commit cada uno, entre features)

Son los que más se tocan y donde más conflicto habría después:

| Archivo | Ediciones en 30 días |
|---|---|
| `public/js/pages/clientes-centro.js` | 65 |
| `public/js/pages/ordenes-render.js` | 18 |
| `public/js/pages/cot-editor.js` | 15 |
| `public/js/services/ordenesService.js` | 14 |
| `public/js/pages/ordenes-flujo.js` | 14 |

Para cada uno: envolver en IIFE (R1), cabecera (R4), y sustituir los handlers inline que **genera** ese archivo por delegación (R2). Se hace en una ventana sin trabajo en vuelo sobre ese archivo, se despliega solo, y se verifica en producción con la pantalla abierta. Si el archivo tiene handlers inline en el HTML que lo carga, el HTML se toca en el mismo commit.

### Paso 2 · Regla del boy scout (permanente)

Cualquier otro archivo se convierte el día que se toque por una razón funcional. Nunca se abre un archivo solo para convertirlo.

### Paso 3 · Cuando llegue una señal de la sección 1

Con R1–R5 cumplidas en la mayoría de archivos, la migración es esta y nada más:

1. `npm create vite` en modo multipágina, con los 103 HTML como entradas.
2. Cada `window.X = (() => {...})()` pasa a `export const X = {...}` y cada línea "Depende de" a un `import`.
3. Se quitan los `?v=` porque Vite pone hashes.
4. Firebase compat pasa a SDK modular, página por página.
5. Los 3 duplicados navegador/functions pasan a un paquete compartido y se borra el test de sincronía.

Firestore, rules, Functions y hosting no cambian.

## 5. Qué NO hacer

- **No mezclar `type="module"` con scripts globales sin bundler.** Duplica los caminos de carga y agrava el problema de orden.
- **No convertir por barrido.** 315 commits al mes garantizan conflictos.
- **No tocar los duplicados navegador/functions.** Tienen test de sincronía y son el problema del bundler, no de hoy.
- **No cambiar de hosting.** Vercel no acelera nada: los datos, la autenticación y las Functions siguen en Firebase.
