// CTABand.jsx — full-bleed dark CTA band

const CTABand = ({ setRoute }) => (
  <section className="ctaband">
    <div className="ctaband-grid"></div>
    <div className="ctaband-inner">
      <div>
        <div className="cc-eyebrow ctaband-eb">Listos para desplegar</div>
        <h2 className="ctaband-h">¿Necesita una red lista para producción?</h2>
        <p className="ctaband-sub">Hablemos del alcance, la cobertura y los SLAs. Un ingeniero le contestará en menos de 24 horas hábiles.</p>
      </div>
      <div className="ctaband-actions">
        <button onClick={() => setRoute("contact")} className="cc-btn cc-btn-primary cc-btn-lg">Solicitar cotización</button>
        <a href="tel:+5072795570" className="cc-btn cc-btn-ghost-light cc-btn-lg"><i data-lucide="phone"></i> 279-5570</a>
      </div>
    </div>
  </section>
);

window.CTABand = CTABand;
