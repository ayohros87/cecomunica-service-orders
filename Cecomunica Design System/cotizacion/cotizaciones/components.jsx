/* =============================================================
   Cotizaciones — componentes y helpers compartidos
   ============================================================= */
const { useState, useEffect, useRef, useMemo } = React;

/* ── Helpers de dinero / cálculo ───────────────────────────── */
function money(n) {
  return "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtFecha(iso) {
  if (!iso) return "—";
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const d = new Date(iso + "T00:00:00");
  return d.getDate() + " " + meses[d.getMonth()] + " " + d.getFullYear();
}
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
/* Total de un renglón (aplica descuento por línea) */
function lineTotal(it) {
  const bruto = (it.cant || 0) * (it.precio || 0);
  return bruto * (1 - (it.desc || 0) / 100);
}
/* Totales de la cotización */
function calcTotales(cot) {
  const subtotal = (cot.items || []).reduce((s, it) => s + lineTotal(it), 0);
  const descGlobal = subtotal * (cot.descuentoPct || 0) / 100;
  const base = subtotal - descGlobal;
  const itbms = base * (cot.itbmsPct || 0) / 100;
  const total = base + itbms;
  return { subtotal, descGlobal, base, itbms, total };
}
function cuenta(items) { return (items || []).reduce((s, it) => s + (it.cant || 0), 0); }

/* ── Logo CeComunica (inline, sin dependencia de archivo) ──── */
function Logo({ size = 32 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <rect width="40" height="40" rx="7" fill="#0B2A47" />
      <path d="M18 8H13a9 9 0 0 0 0 24h5" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="square" />
      <path d="M22 8h5a9 9 0 0 1 0 24h-5" stroke="#00B4D8" strokeWidth="3.5" fill="none" strokeLinecap="square" />
      <rect x="18.5" y="18.5" width="3" height="3" fill="#00B4D8" />
    </svg>
  );
}

/* ── Icono lucide (se rehidrata tras render) ───────────────── */
function Icon({ name, size, style }) {
  const ref = useRef(null);
  const s = size || 16;
  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const i = document.createElement("i");
      i.setAttribute("data-lucide", name);
      i.setAttribute("width", s);
      i.setAttribute("height", s);
      ref.current.appendChild(i);
      try { window.lucide.createIcons(); } catch (e) {}
    }
  }, [name, s]);
  return <span ref={ref} className="cc-ico" style={{ display: "inline-flex", width: s, height: s, flexShrink: 0, ...style }}></span>;
}

/* ── Chip de estado (ciclo de vida) ────────────────────────── */
function EstadoChip({ estado }) {
  const e = ESTADOS[estado] || ESTADOS.borrador;
  return <span className={"chip-estado " + e.chip}>{e.label}</span>;
}

/* ── Topbar del módulo ─────────────────────────────────────── */
function TopBar({ onHome }) {
  return (
    <div className="app-topbar">
      <a href="#" className="app-topbar-logo" aria-label="CeComunica" onClick={(e) => { e.preventDefault(); onHome && onHome(); }}>
        <Logo size={30} />
      </a>
      <span className="app-topbar-title">
        <Icon name="receipt" size={18} style={{ color: "var(--accent)" }} />
        Cotizaciones
      </span>
      <div className="app-topbar-spacer"></div>
      <div className="app-topbar-actions">
        <button className="btn btn-ghost btn-sm" onClick={onHome}><Icon name="layout-dashboard" size={14} /> Módulos</button>
        <span className="cc-user">
          <span className="cc-user-avatar">SG</span>
          <span className="cc-user-name">Sandra Gil</span>
        </span>
      </div>
    </div>
  );
}

/* ── Tarjeta de estadística ────────────────────────────────── */
function StatCard({ icon, label, value, sub, tone }) {
  return (
    <div className={"cc-stat" + (tone ? " cc-stat--" + tone : "")}>
      <div className="cc-stat-icon"><Icon name={icon} size={18} /></div>
      <div className="cc-stat-body">
        <div className="cc-stat-value">{value}</div>
        <div className="cc-stat-label">{label}</div>
        {sub && <div className="cc-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

/* ── Modal de confirmación ─────────────────────────────────── */
function ConfirmModal({ open, title, body, confirmLabel, danger, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title"><Icon name={danger ? "alert-triangle" : "help-circle"} size={18} /> {title}</h3>
          <button className="modal-close" onClick={onCancel} aria-label="Cerrar"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body"><p style={{ margin: 0, fontSize: "var(--fs-body-s)", color: "var(--fg-2)", lineHeight: 1.5 }}>{body}</p></div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
          <button className={"btn " + (danger ? "btn-danger" : "btn-primary")} onClick={onConfirm}>{confirmLabel || "Confirmar"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Región de toasts ──────────────────────────────────────── */
function ToastRegion({ toasts, dismiss }) {
  return (
    <div className="toast-region">
      {toasts.map((t) => (
        <div key={t.id} className={"toast toast-" + t.type}>
          <div className="toast-icon"><Icon name={t.icon || "info"} size={16} /></div>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.desc && <div className="toast-desc">{t.desc}</div>}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Cerrar"><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/* Hook de toasts */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  function push(t) {
    const id = uid();
    setToasts((ts) => [...ts, { id, ...t }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3800);
  }
  function dismiss(id) { setToasts((ts) => ts.filter((x) => x.id !== id)); }
  return { toasts, push, dismiss };
}

Object.assign(window, {
  money, fmtFecha, addDays, lineTotal, calcTotales, cuenta,
  Logo, Icon, EstadoChip, TopBar, StatCard, ConfirmModal, ToastRegion, useToasts,
});
