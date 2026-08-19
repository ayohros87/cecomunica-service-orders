// @ts-nocheck
/* =============================================================
   Icons — pintado centralizado de Lucide con el vendor en defer.
   lucide.min.js (401 KB) pasó de síncrono a defer: este módulo,
   cargado defer INMEDIATAMENTE DESPUÉS del vendor, hace el barrido
   inicial de <i data-lucide> al ejecutarse. Los call-sites inline
   viejos `if (typeof lucide !== 'undefined') lucide.createIcons()`
   quedan como no-ops en parse (el guard da false) y siguen
   funcionando en renders dinámicos post-auth, cuando lucide ya está.

   Regla en el HTML — el par debe ir adyacente y en este orden:
     <script defer src="/js/vendor/lucide.min.js?v=1"></script>
     <script defer src="/js/core/icons.js?v=1"></script>

   Icons.pintar(scope) con scope (nodo o array de nodos) usa
   createIcons({nodes}) y evita recorrer el documento completo.
   ============================================================= */
(() => {
  // Red de seguridad del vendor A MEDIDA (auditoría P3.16): lucide.min.js
  // ahora trae SOLO los ~198 iconos censados (12 KB gz vs 95). Si un render
  // usa un nombre fuera del set, su <i data-lucide> queda sin reemplazar —
  // aquí se detecta, se carga UNA vez el vendor completo
  // (lucide.full.min.js, que redefine window.lucide con todos) y se
  // re-barre. El warn deja el nombre faltante en consola para sumarlo al
  // censo y regenerar el vendor a medida.
  let _fallbackPedido = false;
  function _verificarFaltantes(raices) {
    if (_fallbackPedido) return;
    const ambitos = (raices && raices.length) ? raices : [document];
    const faltantes = [];
    ambitos.forEach(r => {
      try {
        r.querySelectorAll?.('i[data-lucide]')
          .forEach(i => faltantes.push(i.getAttribute('data-lucide')));
      } catch (_) { /* nodo suelto */ }
    });
    if (!faltantes.length) return;
    _fallbackPedido = true;
    console.warn('[Icons] iconos fuera del vendor a medida:',
      Array.from(new Set(faltantes)).join(', '), '— cargando vendor completo');
    const s = document.createElement('script');
    s.src = '/js/vendor/lucide.full.min.js?v=1';
    s.onload = () => { try { lucide.createIcons(); } catch (_) {} };
    document.head.appendChild(s);
  }

  function pintar(scope) {
    if (typeof lucide === 'undefined') return;
    const arr = Array.isArray(scope) ? scope.filter(Boolean) : (scope ? [scope] : null);
    // FIX (auditoría órdenes 2026-08-17): la opción `nodes` NO existe en el
    // vendor (acepta {icons, nameAttr, attrs, root, inTemplates}) — caía al
    // default root:document y CADA refresh re-creaba TODOS los SVGs de la
    // página (~600+ con 50 filas en órdenes): el origen real del parpadeo
    // de iconos que se intentó arreglar con este scoping. `root` SÍ está
    // soportado: el barrido queda local al contenedor pasado.
    if (arr && arr.length) {
      arr.forEach(el => { try { lucide.createIcons({ root: el }); } catch (_) { /* nodo suelto */ } });
    } else {
      lucide.createIcons();
    }
    _verificarFaltantes(arr);
  }
  window.Icons = { pintar };
  // Barrido inicial: como defer el DOM ya está parseado (readyState
  // 'interactive'); el branch 'loading' es red de seguridad por si
  // alguna página lo cargara async.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => pintar());
  } else {
    pintar();
  }
})();
