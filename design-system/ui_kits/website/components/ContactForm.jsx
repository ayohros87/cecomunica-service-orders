// ContactForm.jsx — lead-capture form with validation states

const ContactForm = () => {
  const [form, setForm] = React.useState({
    company: "", name: "", email: "", phone: "",
    vertical: "", radios: "", message: ""
  });
  const [submitted, setSubmitted] = React.useState(false);
  const [errors, setErrors] = React.useState({});

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    const er = {};
    if (!form.company) er.company = "Requerido";
    if (!form.name) er.name = "Requerido";
    if (!/.+@.+\..+/.test(form.email)) er.email = "Correo inválido";
    setErrors(er);
    if (Object.keys(er).length === 0) setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="cf-success">
        <div className="cf-success-icon"><i data-lucide="check"></i></div>
        <h3>Solicitud recibida</h3>
        <p>Un ingeniero le contactará en menos de 24 horas hábiles.</p>
      </div>
    );
  }

  return (
    <form className="cf" onSubmit={submit} noValidate>
      <div className="cf-row">
        <Field label="Empresa"   value={form.company} onChange={set("company")} err={errors.company} placeholder="Puerto de Balboa S.A." />
        <Field label="Nombre"    value={form.name}    onChange={set("name")}    err={errors.name}    placeholder="Nombre y apellido" />
      </div>
      <div className="cf-row">
        <Field label="Correo corporativo" type="email" value={form.email} onChange={set("email")} err={errors.email} placeholder="usted@empresa.com" />
        <Field label="Teléfono"  value={form.phone} onChange={set("phone")} placeholder="+507 0000-0000" />
      </div>
      <div className="cf-row">
        <div className="cf-field">
          <label className="cf-lbl">Vertical</label>
          <select className="cc-input" value={form.vertical} onChange={set("vertical")}>
            <option value="">Seleccione…</option>
            <option>Puertos y marítimo</option>
            <option>Gobierno</option>
            <option>Industria y logística</option>
            <option>Infraestructura crítica</option>
            <option>Otro</option>
          </select>
        </div>
        <Field label="Radios estimados" value={form.radios} onChange={set("radios")} placeholder="ej. 50–200" />
      </div>
      <div className="cf-field">
        <label className="cf-lbl">Notas</label>
        <textarea className="cc-input" rows="4" value={form.message} onChange={set("message")} placeholder="Cobertura requerida, plazos, integraciones, etc."></textarea>
      </div>
      <div className="cf-actions">
        <button type="submit" className="cc-btn cc-btn-primary cc-btn-lg">Enviar solicitud</button>
        <span className="cf-fine">Sus datos se utilizan únicamente para responder esta solicitud.</span>
      </div>
    </form>
  );
};

const Field = ({ label, err, ...inputProps }) => (
  <div className="cf-field">
    <label className="cf-lbl">{label}</label>
    <input className={"cc-input" + (err ? " cc-input-err" : "")} {...inputProps} />
    {err && <span className="cf-err">{err}</span>}
  </div>
);

window.ContactForm = ContactForm;
