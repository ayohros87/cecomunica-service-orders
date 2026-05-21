// Hero.jsx — signature dark navy hero with product photography
// Uses the existing hero banner asset as the right-side image.

const Hero = ({ setRoute }) => (
  <section className="hero">
    <div className="hero-grid"></div>
    <div className="hero-dots"></div>
    <div className="hero-inner">
      <div className="hero-copy">
        <div className="cc-eyebrow hero-eyebrow">Soluciones en comunicaciones</div>
        <h1 className="hero-h">Comunicaciones críticas,<br/>sin interrupciones.</h1>
        <p className="hero-sub">
          Diseñamos, desplegamos y mantenemos redes de radio TETRA, DMR y push-to-talk
          celular para puertos, gobierno e industria en Panamá y Centroamérica.
        </p>
        <div className="hero-actions">
          <button onClick={() => setRoute("contact")} className="cc-btn cc-btn-primary cc-btn-lg">
            Solicitar cotización
          </button>
          <button onClick={() => setRoute("products")} className="cc-btn cc-btn-ghost-light cc-btn-lg">
            Ver portafolio <i data-lucide="arrow-right"></i>
          </button>
        </div>
        <div className="hero-meta">
          <div className="hero-meta-item">
            <i data-lucide="shield-check"></i>
            <span>Integrador autorizado Hytera</span>
          </div>
          <div className="hero-meta-item">
            <i data-lucide="map-pin"></i>
            <span>Cobertura nacional · Panamá</span>
          </div>
          <div className="hero-meta-item">
            <i data-lucide="headphones"></i>
            <span>Soporte 24/7</span>
          </div>
        </div>
      </div>
      <div className="hero-image">
        <img src="../../assets/hero-products-1.png" alt="Familia de equipos Hytera" />
      </div>
    </div>
    <div className="hero-band"></div>
  </section>
);

window.Hero = Hero;
