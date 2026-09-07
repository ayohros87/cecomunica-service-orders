# Migración del frontend a Vite multipágina — versión corta

> **Fecha:** 2026-09-04, recortado 2026-09-07 · **Estado:** plan, sin ejecutar.
> **Alcance:** solo `public/`. Firestore, rules, Functions y Hosting no cambian de proveedor ni de forma.
> **Esfuerzo:** unas 2 semanas de trabajo concentrado. Todo lo demás (anexo A) se paga de paso con la regla del boy scout, sin proyecto dedicado.

---

## 1. Qué gana la app

| Hoy (medido 2026-09-04, `ordenes/index.html`) | Después de este plan |
|---|---|
| 40 archivos JS propios, 42 etiquetas `<script>` | 1 a 3 archivos por página |
| 756 KB sin minificar, 209 KB gzip | ~350 KB minificado, ~100 KB gzip (estimado) |
| 89 sufijos `?v=` a mano; 72 etiquetas sin sufijo que pueden servirse viejas hasta 24 h | Hash en el nombre; caché inmutable de un año sin riesgo de versión vieja |
| SDK de Firebase por CDN, 5 peticiones a `gstatic`, versión en cada HTML | Una versión pineada en `package.json`, un chunk común cacheado |
| Pestañas secundarias abren con IndexedDB viejo | Gestor multi-pestaña moderno, si la prueba de §4 confirma que compat lo hereda |
| Orden de `<script>` por HTML, frágil, sin verificación | El build falla si falta un archivo |

Lo que NO gana: nada del lado de datos. Las lecturas de Firestore dependen de consultas y listeners, no del empaquetado.

## 2. Inventario de lo que se toca

| Pieza | Medida |
|---|---|
| Páginas HTML como entradas | 103 (7 en raíz + 96 en subcarpetas), excluyendo `tools/` y `dev-diag-*` |
| Referencias a scripts | 917 relativas + 157 absolutas |
| Archivos que definen funciones top-level sin declararlas en `window` | 28 archivos, 320 funciones |
| Cargadores dinámicos de script | 6: `carga-diferida`, `icons`, `layout`, `xlsx-loader`, `contratos-upload`, `imprimir-orden` |
| Tests de functions que cargan archivos de `public/js` como texto | al menos 10 en `functions/test/` |
| CI | comprueba sintaxis de `public/js`, lucide en defer, `@import` al inicio del CSS |
| Node local | v20; Vite 6 lo soporta |

## 3. Principio rector: el puente `window`

Nada deja de escribir en `window`. Los archivos se importan como side effects y siguen exponiendo sus globales; los handlers inline, los tests y el código no convertido funcionan igual. Retirar el puente es deuda del anexo A, no de este plan.

## 4. Paso 0 · Antes de instalar nada (2 horas, cualquier día)

- **Corregir las 72 etiquetas `<script src>` sin `?v=`.** Es riesgo de producción hoy: JS y CSS se cachean 1 h con `stale-while-revalidate` de 24 h. No depende de Vite.
- **Probar la caché multi-pestaña con compat.** En `firebase-init.js`, antes del primer `firebase.firestore()`, llamar a `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` desde el SDK modular y verificar que `firebase.firestore()` devuelve esa misma instancia (compat y modular comparten instancia desde v9). Si funciona, se elimina `enablePersistence` y la auto-reparación de IndexedDB, y desaparece el argumento principal para migrar la API. Si no, se anota y se sigue.

## 5. Fases

### F1 · Globales explícitas, versión mínima (½ día)

En cada uno de los 28 archivos con funciones top-level sueltas, se agrega al final una línea por función que el HTML o otro archivo llama:

```js
// --- puente window (F1) ---
Object.assign(window, { abrirModal, guardarOrden, cerrarModal });
```

Nada se reorganiza. Un script pequeño en `tools/check-modular.js` lista las funciones top-level de cada archivo y las que otros archivos o HTML llaman; con eso la línea se genera casi sola. Los 3 casos de `window.X.y = ...` desde otro archivo se dejan como están: el puente los tolera.

Verificación: el verificador reporta 0 llamadas a funciones no exportadas. Deploy normal.

### F2 · Vite multipágina, sin tocar lógica (3 a 5 días seguidos)

1. `package.json` en la raíz con `vite` como única dependencia de desarrollo. `npm run dev` y `npm run build`.
2. `vite.config.js`: `root: 'public'`, `build.outDir: '../dist'`, `base: '/'`, y `rollupOptions.input` generado con un glob de `public/**/*.html` que excluye `tools/` y `dev-diag-*`. Una página nueva entra sola.
3. Por cada página, las N etiquetas `<script src="js/...">` se reemplazan por una: `<script type="module" src="js/entry/<pagina>.js">`, que importa los mismos archivos en el mismo orden como side effects:
   ```js
   import '../firebase-init.js';
   import '../core/modulos.js';
   import '../services/usuariosService.js';
   ```
   Los archivos importados no cambian. Un script genera los 103 entries leyendo las etiquetas actuales.
4. Los scripts del CDN de Firebase se quedan como etiquetas clásicas hasta F3. Vite no los toca y corren antes del módulo.
5. `js/vendor` (lucide, etc.) se importa desde el entry. El check de CI "lucide en defer + icons.js adyacente" se retira porque el entry garantiza el orden.
6. Los 6 cargadores dinámicos pasan a `import()`, que Vite convierte en chunk separado.
7. `firebase.json`: `hosting.public` pasa a `dist`; `predeploy: ["npm run build"]`; la cabecera de `**/*.@(js|css)` sube a `max-age=31536000, immutable`. Los `?v=` desaparecen de los HTML.
8. CI: `npm ci && npm run build` antes de los tests; el check de sintaxis de `public/js` se reemplaza por el build.
9. Los tests de `functions/test/` que leen archivos de `public/js` como texto siguen funcionando: los archivos no cambian de forma. Solo `firebase-init.js` y los entries son nuevos.
10. `.gitignore`: `dist/` y `node_modules/` en raíz.

Verificación: `npm run build` sin advertencias; las 10 páginas más usadas en un canal de preview de Hosting; cabeceras confirmadas con `curl -I`. Rollback: `hosting.public` de vuelta a `public` y desplegar. `public/` no se borra ni se mueve.

Riesgo principal: una global implícita que F1 no detectó. El verificador la previene; el preview la atrapa.

### F3 · Firebase compat desde npm (1 día)

`npm i firebase`. `firebase-init.js` importa `firebase/compat/app`, `firebase/compat/auth`, `firebase/compat/firestore`, `firebase/compat/functions`, `firebase/compat/storage` y expone `window.firebase` para que los 121 archivos que usan `firebase.*` sigan igual. En el mismo archivo se exportan `app`, `db`, `auth`, `fns` y `storage` modulares para el código nuevo, según la política de §8. Se quitan las 5 etiquetas de `gstatic` de los 103 HTML (el script de entries lo hace). Si la prueba de §4 funcionó, aquí entra el gestor multi-pestaña.

Verificación: una lectura y una escritura reales desde el preview; login y cierre de sesión.

### F4 · Cierre (1 día)

- `docs/SISTEMA_TOP_DOWN.md` §1 deja de decir "sin build step".
- `tools/check-modular.js` queda en CI en modo informativo.
- Confirmar que `design-system/` y `backups/` están fuera del build.
- Anotar en `PLAN_PREPARACION_MODULAR.md` que R5 (`?v=`) ya no aplica.

## 6. Calendario

| Paso | Esfuerzo | Congela algo |
|---|---|---|
| Paso 0 | 2 horas | no |
| F1 | ½ día | no |
| F2 | 3 a 5 días seguidos | **sí**: `public/*.html` mientras dura |
| F3 | 1 día | no |
| F4 | 1 día | no |

Paso 0 y F1 se pueden hacer cualquier semana. F2 necesita una ventana de 3 a 5 días sin cambios en los HTML. Ritmo actual: 315 commits y 128 archivos JS tocados en 30 días. La ventana llega con una de estas señales:

1. Un mes de estabilización sin backlog funcional urgente.
2. Un incidente real de producción por versión vieja en caché.
3. Una página que mida más de 3 s hasta interactiva en un teléfono de bodega.

## 7. Decisiones que quedan para el dueño

- **Flujo de desarrollo local.** Con Vite es `npm run dev` en `localhost:5173`. Los harness de jsdom y Chrome headless que abren HTML sin build tendrían que apuntar al dev server o a `dist/`.
- **CI bloqueante.** Recomendación: el build bloquea desde F2.

## 8. Política del SDK compat: puente con salida, no destino

Compat es una envoltura sobre el SDK modular. Desde la versión 9 comparten la misma instancia de app, auth y Firestore, y la guía oficial de migración de Google permite mezclarlos en el mismo proyecto. Por eso compat no ancla: lo que sí cuesta es el código mixto durante años y que Google lo elimine en una versión mayor futura, sin fecha anunciada. La política evita las dos cosas sin dedicar semanas.

**Desde F3:**

1. `firebase-init.js` expone las dos formas: `window.firebase` (compat) para el código existente y `export const { app, db, auth, fns, storage }` modulares para el nuevo.
2. **Todo servicio o página nueva nace modular.** Prohibido escribir `firebase.firestore()` en un archivo nuevo.
3. **Todo servicio que se reescriba a fondo pasa a modular** en esa misma reescritura. Con el ritmo actual (14 ediciones al mes en `ordenesService`), en un año el código caliente estará migrado sin proyecto dedicado.
4. **Las funciones que solo existen en modular** (caché persistente, consultas nuevas, Auth) se usan modular desde donde haga falta, aunque el archivo siga en compat para el resto.
5. **Disparador del barrido final:** el anuncio de Google de la versión mayor que elimina compat. Ese día se migra lo que quede, que para entonces serán decenas de archivos fríos, no 121. Hasta ese anuncio, no hay barrido.
6. `tools/check-modular.js` cuenta archivos que aún usan `firebase.*` compat. El número solo baja.

Mientras compat exista, la versión de `firebase` en `package.json` se sube con cada versión mayor para no quedar atrás en parches.

## 9. Qué NO hacer

- No convertir a SPA ni a framework. 103 páginas multipágina son la forma natural de esta app.
- No cambiar de hosting. Otro proveedor serviría el mismo `dist/` sin ventaja.
- No hacer F2 y la API modular a la vez. Cada una cambia una cosa.
- No borrar `public/` hasta F4. Es el rollback de F2.
- No dedicar semanas a nada del anexo A.

---

## Anexo A · Deuda que se paga de paso (no es proyecto)

Evaluado el 2026-09-07. Cada punto se hace solo cuando se toca el archivo por trabajo funcional. Ninguno justifica tiempo dedicado.

| Deuda | Costo como proyecto | Por qué el beneficio es marginal | Regla de paso |
|---|---|---|---|
| Imports reales entre archivos y retiro de los puentes `window` (179 archivos) | 3 a 4 semanas | Tree-shaking casi nulo: cada página usa todo lo que carga. El resto es estética. | Archivo tocado → `export` + `import` de lo que usa; el puente se retira cuando el verificador reporta cero lectores |
| 505 handlers inline (`onclick=`) a delegación | 2 a 3 semanas | Funcionan perfecto con el puente. Solo sirven para poder retirar el puente. | Handler nuevo → `data-accion` + un `addEventListener` por contenedor. Pantalla tocada a fondo → se convierten los suyos |
| API modular de Firebase (121 archivos, 620 llamadas firestore + 223 auth, 237 `FieldValue`, 40 `Timestamp`) | 4 a 6 semanas | 40 a 60 KB gzip menos para usuarios internos con caché caliente. Nadie lo nota. La caché multi-pestaña se consigue con compat (§4). | Política de §8: archivo nuevo nace modular; servicio reescrito a fondo pasa a modular; barrido final solo cuando Google anuncie la versión que elimina compat |
| Paquete `shared/` para los 3 duplicados navegador/functions (`pendientes`, `colaInventario`, `senales`) | 2 días | El test de sincronía ya resuelve el problema y no ha fallado. | Si aparece un cuarto duplicado, entonces sí |
| IIFE con namespace en los 125 archivos planos | 1 semana | `Object.assign(window, {...})` de F1 da el mismo resultado. | Archivo nuevo nace con IIFE (R1 de `PLAN_PREPARACION_MODULAR.md`) |
