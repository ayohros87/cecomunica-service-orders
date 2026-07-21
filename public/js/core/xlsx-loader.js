// @ts-nocheck
// Carga BAJO DEMANDA de SheetJS (~900 KB desde CDN). Las páginas que solo usan
// Excel para exportar/importar no deben descargarla al abrir — se pide con
// `await cargarXLSX()` justo antes del primer uso. Inyecta el <script> una sola
// vez y resuelve cuando window.XLSX está disponible.
(function () {
  let promesa = null;
  window.cargarXLSX = function () {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (promesa) return promesa;
    promesa = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => {
        promesa = null;   // permite reintentar si falló la red
        reject(new Error('No se pudo cargar la librería de Excel'));
      };
      document.head.appendChild(s);
    });
    return promesa;
  };
})();
