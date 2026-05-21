// Footer.jsx — navy footer with brand band

const Footer = () => (
  <footer className="ftr">
    <div className="ftr-inner">
      <div className="ftr-brand">
        <div className="ftr-logo">
          <img src="../../assets/logo-monogram-mark-inverse.svg" alt="" />
          <span>CECOMUNICA</span>
        </div>
        <p className="ftr-tag">Soluciones en Comunicaciones para misión crítica.</p>
        <div className="ftr-contact">
          <div><i data-lucide="map-pin"></i><span>CC Bal Harbour, Via Italia, Punta Paitilla, Panamá</span></div>
          <div><i data-lucide="phone"></i><span>279-5570 · 6151-5555</span></div>
          <div><i data-lucide="mail"></i><span>info@cecomunica.com</span></div>
        </div>
      </div>
      <div className="ftr-cols">
        <div className="ftr-col">
          <div className="cc-eyebrow ftr-h">Productos</div>
          <ul>
            <li><a href="#">Radios DMR</a></li>
            <li><a href="#">TETRA</a></li>
            <li><a href="#">PoC celular</a></li>
            <li><a href="#">Body cameras</a></li>
            <li><a href="#">Accesorios</a></li>
          </ul>
        </div>
        <div className="ftr-col">
          <div className="cc-eyebrow ftr-h">Soluciones</div>
          <ul>
            <li><a href="#">Puertos y marítimo</a></li>
            <li><a href="#">Gobierno</a></li>
            <li><a href="#">Industria y logística</a></li>
            <li><a href="#">Infraestructura crítica</a></li>
          </ul>
        </div>
        <div className="ftr-col">
          <div className="cc-eyebrow ftr-h">Empresa</div>
          <ul>
            <li><a href="#">Nosotros</a></li>
            <li><a href="#">Casos de éxito</a></li>
            <li><a href="#">Contacto</a></li>
          </ul>
        </div>
      </div>
    </div>
    <div className="ftr-fine">
      <span>© 2025 CeComunica, S.A. · Todos los derechos reservados.</span>
      <span className="cc-mono">www.cecomunica.com</span>
    </div>
    <div className="ftr-band"></div>
  </footer>
);

window.Footer = Footer;
