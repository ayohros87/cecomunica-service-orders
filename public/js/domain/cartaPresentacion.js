// @ts-nocheck
// Carta de presentación — 2 hojas institucionales que se anteponen a las
// cotizaciones de VENTAS (origen 'comercial'). Las de taller (origen 'orden')
// nunca la llevan; el gate vive en CotState.llevaCarta(), no aquí.
//
// Módulo puro: no consulta Firestore ni toca el DOM. Devuelve el HTML de las dos
// `.cq-page` y quien lo llama decide dónde insertarlo. Los estilos están en
// css/print-carta.css.
//
// Contenido institucional fijo (33 años, +200 clientes, beneficios, sectores):
// va aquí como texto. Lo único que se inyecta son los datos del emisor —
// empresa/emisor en Firestore, con fallback en cot-editor-state.js — para que
// un cambio de teléfono o correo no haya que perseguirlo por dos documentos.
//
// El ejecutivo NO aparece: la cotización ya lo firma en el bloque `.cq-sign`.
// Tampoco hay folio de página: la carta no sabe cuántas páginas trae la
// cotización que va detrás, así que numerarla sería mentir.
(() => {
  const esc = (v) => (window.FMT ? FMT.esc(v) : String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  const EMISOR_MIN = {
    razon: 'C Comunica, S.A.',
    dir1: 'C.C. Bal Harbour, Galerías, Mezanine, oficina 5A',
    dir2: 'Vía Italia, Punta Paitilla, Panamá',
    tel: '+507 279-5570',
    email: 'ventas@cecomunica.com',
    web: 'www.cecomunica.com',
  };

  const HORARIO = 'Lun a Vie, 8:00 a.m. – 5:00 p.m.';

  const BENEFICIOS = [
    'Comunicación instantánea y segura',
    'Reducción de tiempos de respuesta',
    'Mayor control operativo',
    'Integración con sistemas tecnológicos',
    'Escalabilidad según el crecimiento',
    'Precios competitivos',
  ];

  const SERVICIOS = [
    'Asesoría personalizada',
    'Instalación y configuración',
    'Soporte técnico especializado',
    'Mantenimiento preventivo y correctivo',
  ];

  const SECTORES = [
    { icon: 'shield', label: 'Seguridad' },
    { icon: 'shopping-cart', label: 'Supermercados' },
    { icon: 'graduation-cap', label: 'Educación' },
    { icon: 'landmark', label: 'Gobierno' },
    { icon: 'bed-double', label: 'Hotelería' },
    { icon: 'more-horizontal', label: 'Y otros servicios' },
  ];

  const STATS = [
    { val: '33', unit: 'años', lbl: 'De trayectoria en el mercado panameño', navy: true },
    { val: '+200', unit: 'clientes', lbl: 'A nivel nacional e internacional' },
    { val: '3', unit: 'tecnologías', lbl: 'TETRA · DMR · POC sobre LTE' },
  ];

  function portada(em) {
    return `
      <div class="cq-page cq-carta cq-carta--cover">
        <div class="k-cover-main">
          <div class="k-cover-brand">
            <img src="/brand/logo-lockup-horizontal-inverse.svg" alt="CeComunica">
          </div>

          <div class="k-cover-kicker"><span class="eyebrow">Carta de presentación</span></div>
          <h1>Comunicación crítica que <em>no falla</em> cuando más importa.</h1>
          <p class="k-cover-lede">Diseñamos, instalamos y damos soporte a redes de radiocomunicación
            crítica para seguridad pública, transporte, salud y emergencias.</p>

          <div class="k-cover-chips">
            <span class="k-pill"><span class="k-dot"></span>TETRA</span>
            <span class="k-pill"><span class="k-dot"></span>DMR</span>
            <span class="k-pill"><span class="k-dot"></span>POC sobre LTE</span>
          </div>

          <div class="k-cover-contact">
            <!-- Solo la localidad (dir2). La dirección postal completa (dir1) es
                 demasiado larga para esta columna — desborda a 4 líneas — y ya
                 viaja en el bloque "De" de la cotización. -->
            <div class="k-cc"><i data-lucide="map-pin"></i><span><b>Oficina</b>${esc(em.dir2)}</span></div>
            <div class="k-cc"><i data-lucide="phone"></i><span><b>Teléfono</b>${esc(em.tel)}</span></div>
            <div class="k-cc"><i data-lucide="mail"></i><span><b>Correo</b>${esc(em.email)}</span></div>
            <div class="k-cc"><i data-lucide="globe"></i><span><b>Web</b>${esc(em.web)}</span></div>
          </div>
        </div>

        <div class="k-cover-photo">
          <img src="/img/carta/cover-team-studio.jpg" alt="Equipo CeComunica con radio de comunicación crítica">
        </div>
        <div class="k-band"></div>
      </div>
    `;
  }

  function quienesSomos(em) {
    return `
      <div class="cq-page cq-carta">
        <div class="k-pad">
          <header class="k-doc-head">
            <div><img src="/brand/logo-lockup-horizontal.svg" alt="CeComunica"></div>
            <div class="k-doc-head__meta">
              <span class="eyebrow">Acerca de</span>
              <h2>Quiénes somos</h2>
            </div>
          </header>

          <div class="k-qs-hero">
            <div>
              <div class="k-section-title">
                <span class="eyebrow">33 años de experiencia</span>
                <h3>Soluciones de radiocomunicación confiables, hechas en Panamá.</h3>
              </div>
              <div class="k-lead-quote">
                <b>CeComunica</b> es una empresa con <b>33 años de experiencia</b>
                brindando soluciones de radiocomunicación en Panamá.
              </div>
              <p class="k-body-copy"><strong>Nuestro objetivo:</strong> ofrecerle una solución
                eficiente, confiable y adaptada a sus necesidades, garantizando calidad, soporte
                técnico y acompañamiento, con propuestas económicas competitivas.</p>
            </div>
            <div class="k-qs-photo">
              <img src="/img/carta/qs-team-advisor.jpg" alt="Asesora CeComunica mostrando un radio">
              <div class="k-qs-cap"><i data-lucide="radio"></i>Asesoría y demostración de equipos en sitio.</div>
            </div>
          </div>

          <div class="k-stat-row">
            ${STATS.map(s => `
              <div class="k-stat${s.navy ? ' k-stat--navy' : ''}">
                <div class="k-stat__val">${esc(s.val)}<span class="k-unit">${esc(s.unit)}</span></div>
                <div class="k-stat__lbl">${esc(s.lbl)}</div>
              </div>
            `).join('')}
          </div>

          <div class="k-cols">
            <div class="k-col-card">
              <h4><i data-lucide="zap"></i>Beneficios</h4>
              <ul class="k-check-list">
                ${BENEFICIOS.map(b => `<li><i data-lucide="check"></i>${esc(b)}</li>`).join('')}
              </ul>
            </div>
            <div class="k-col-card">
              <h4><i data-lucide="wrench"></i>Servicios incluidos</h4>
              <ul class="k-check-list">
                ${SERVICIOS.map(s => `<li><i data-lucide="check"></i>${esc(s)}</li>`).join('')}
              </ul>
            </div>
          </div>

          <div class="k-exp-block">
            <span class="eyebrow">Experiencia · +200 clientes a nivel nacional e internacional</span>
            <div class="k-sectors">
              ${SECTORES.map(s => `<span class="k-sector"><i data-lucide="${esc(s.icon)}"></i>${esc(s.label)}</span>`).join('')}
            </div>
          </div>

          <div class="k-close-strip">
            <div class="k-close-strip__q">
              <span class="eyebrow">Nuestro compromiso</span>
              <p><span class="k-q">“</span>Estamos preparados para acompañar a su organización con
                soluciones de comunicación confiables, innovadoras y adaptadas a sus
                necesidades.<span class="k-q">”</span></p>
            </div>
            <div class="k-close-strip__c">
              <div class="k-cc"><i data-lucide="phone"></i><span><b>${esc(em.tel)}</b>${esc(HORARIO)}</span></div>
              <div class="k-cc"><i data-lucide="mail"></i><span><b>${esc(em.email)}</b></span></div>
              <div class="k-cc"><i data-lucide="globe"></i><span><b>${esc(em.web)}</b></span></div>
            </div>
          </div>

          <footer class="k-pg-foot">${esc(em.razon)} · ${esc(em.dir2)}</footer>
        </div>
        <div class="k-band"></div>
      </div>
    `;
  }

  const CartaPresentacion = {
    // Devuelve las 2 hojas como string. `emisor` es el mismo objeto que usan las
    // vistas de cotización (CotState.bootstrapCatalogos().emisor o el congelado
    // en el mirror público); los huecos se rellenan con EMISOR_MIN.
    html({ emisor } = {}) {
      const em = { ...EMISOR_MIN, ...(emisor || {}) };
      // Un campo vacío en Firestore ('') ganaría al fallback en el spread, así
      // que se repone explícitamente.
      Object.keys(EMISOR_MIN).forEach((k) => { if (!em[k]) em[k] = EMISOR_MIN[k]; });
      return portada(em) + quienesSomos(em);
    },
  };

  window.CartaPresentacion = CartaPresentacion;
})();
