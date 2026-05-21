// Header.jsx — sticky top navigation
// White background, brand logo left, primary nav center, CTA right.

const Header = ({ route, setRoute }) => {
  const navItem = (key, label) => (
    <button
      key={key}
      onClick={() => setRoute(key)}
      className={"hdr-nav-item" + (route === key ? " is-active" : "")}
    >
      {label}
    </button>
  );

  return (
    <header className="hdr">
      <div className="hdr-inner">
        <a href="#" onClick={(e) => { e.preventDefault(); setRoute("home"); }} className="hdr-brand">
          <img src="../../assets/logo-monogram-mark.svg" alt="" className="hdr-mark" />
          <span className="hdr-wordmark">CECOMUNICA</span>
        </a>
        <nav className="hdr-nav">
          {navItem("home",     "Inicio")}
          {navItem("products", "Productos")}
          {navItem("verticals","Soluciones")}
          {navItem("about",    "Nosotros")}
          {navItem("contact",  "Contacto")}
        </nav>
        <div className="hdr-actions">
          <a href="tel:+5072795570" className="hdr-phone">
            <i data-lucide="phone"></i>
            <span>279-5570</span>
          </a>
          <button onClick={() => setRoute("contact")} className="cc-btn cc-btn-primary cc-btn-sm">
            Solicitar cotización
          </button>
        </div>
      </div>
    </header>
  );
};

window.Header = Header;
