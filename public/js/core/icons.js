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
  function pintar(scope) {
    if (typeof lucide === 'undefined') return;
    const arr = Array.isArray(scope) ? scope.filter(Boolean) : (scope ? [scope] : null);
    if (arr && arr.length) lucide.createIcons({ nodes: arr });
    else lucide.createIcons();
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
