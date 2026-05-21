// VerticalCard.jsx — industry/vertical solution card.
// Used in "Soluciones por industria" grid.

const VerticalCard = ({ icon, title, body, kpis }) => (
  <article className="vert-card">
    <div className="vert-icon"><i data-lucide={icon}></i></div>
    <h3 className="vert-title">{title}</h3>
    <p className="vert-body">{body}</p>
    {kpis && (
      <div className="vert-kpis">
        {kpis.map((k, i) => (
          <div key={i} className="vert-kpi">
            <div className="vert-kpi-v cc-mono">{k.value}</div>
            <div className="vert-kpi-l">{k.label}</div>
          </div>
        ))}
      </div>
    )}
    <a className="vert-link" href="#">Conocer la solución <i data-lucide="arrow-right"></i></a>
  </article>
);

window.VerticalCard = VerticalCard;
