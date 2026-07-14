// ProductCard.jsx — Hytera radio product card
// Resting / hover states from the design system.

const ProductCard = ({ name, model, family, specs, badge }) => (
  <article className="prod-card">
    {badge && <span className="prod-badge">{badge}</span>}
    <div className="prod-thumb">
      <i data-lucide="radio"></i>
    </div>
    <div className="prod-body">
      <div className="prod-family cc-eyebrow">{family}</div>
      <h3 className="prod-name">{name}</h3>
      <div className="cc-mono prod-model">{model}</div>
      <ul className="prod-specs">
        {specs.map((s, i) => (
          <li key={i}><i data-lucide="check"></i><span>{s}</span></li>
        ))}
      </ul>
    </div>
    <div className="prod-foot">
      <button className="cc-btn cc-btn-secondary cc-btn-sm">Ficha técnica</button>
      <button className="cc-btn cc-btn-ghost cc-btn-sm">Cotizar →</button>
    </div>
  </article>
);

window.ProductCard = ProductCard;
