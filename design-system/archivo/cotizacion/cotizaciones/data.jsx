/* =============================================================
   Cotizaciones — datos semilla (catálogo, clientes, cotizaciones)
   Mock realista para Panamá · radiocomunicación profesional
   ============================================================= */

/* Emisor fijo (CeComunica) */
const EMISOR = {
  razon: "C Comunica, S.A.",
  ruc: "155678901-2-2024 DV 33",
  dir1: "Punta Paitilla, Calle 53 Este",
  dir2: "Ciudad de Panamá, Panamá",
  tel: "+507 279-5570",
  cel: "+507 6151-5555",
  email: "ventas@cecomunica.com",
  web: "www.cecomunica.com",
};

/* Ejecutivos de ventas (firmante) */
const EJECUTIVOS = [
  { id: "sgil", nombre: "Sandra Gil", rol: "Ejecutiva de Ventas", email: "sandra.gil@cecomunica.com", tel: "+507 6151-5560" },
  { id: "rmoreno", nombre: "Ricardo Moreno", rol: "Gerente Comercial", email: "ricardo.moreno@cecomunica.com", tel: "+507 6151-5562" },
  { id: "lcastillo", nombre: "Lucía Castillo", rol: "Ejecutiva de Cuentas", email: "lucia.castillo@cecomunica.com", tel: "+507 6151-5564" },
];

/* Catálogo de productos / servicios (para autocompletar renglones) */
const CATALOGO = [
  { modelo: "HP785-U1", nombre: "Radio portátil DMR Tier II — Hytera HP785", spec: "UHF 400–470 MHz · IP67 · Bluetooth · GPS", precio: 685.0, cat: "Radios portátiles" },
  { modelo: "HP685-V", nombre: "Radio portátil DMR Tier II — Hytera HP685", spec: "VHF 136–174 MHz · IP67 · pantalla a color", precio: 545.0, cat: "Radios portátiles" },
  { modelo: "PD506-U", nombre: "Radio portátil DMR — Hytera PD506", spec: "UHF · 16 canales · IP54 · entrada de gama", precio: 285.0, cat: "Radios portátiles" },
  { modelo: "MD785-U", nombre: "Radio móvil DMR Tier II — Hytera MD785", spec: "UHF · 25 W · GPS · montaje vehicular", precio: 720.0, cat: "Radios móviles" },
  { modelo: "HM785-U", nombre: "Radio móvil DMR — Hytera HM785", spec: "UHF · 45 W · Bluetooth · pantalla color", precio: 980.0, cat: "Radios móviles" },
  { modelo: "HR1065-U", nombre: "Repetidor DMR Tier II — Hytera HR1065", spec: "UHF · 50 W · doble ranura de tiempo", precio: 3450.0, cat: "Infraestructura" },
  { modelo: "RD985-U", nombre: "Repetidor DMR — Hytera RD985", spec: "UHF · 50 W · IP Multi-site Connect", precio: 4180.0, cat: "Infraestructura" },
  { modelo: "SC20-T", nombre: "Radio TETRA — Sepura SC20", spec: "Portátil TETRA · clase 3L · IP67", precio: 1290.0, cat: "TETRA" },
  { modelo: "SCL3-H", nombre: "Híbrido TETRA + LTE — Sepura SCL3", spec: "PoC + TETRA · Android · cámara", precio: 1650.0, cat: "TETRA" },
  { modelo: "BL2010", nombre: "Batería Li-ion 2000 mAh", spec: "Compatible HP785 / HP685", precio: 48.0, cat: "Accesorios" },
  { modelo: "BL2503", nombre: "Batería Li-ion 2500 mAh alta capacidad", spec: "Compatible serie HP", precio: 62.0, cat: "Accesorios" },
  { modelo: "CH10L07", nombre: "Cargador rápido individual", spec: "Base de escritorio · LED de estado", precio: 39.0, cat: "Accesorios" },
  { modelo: "MCA08", nombre: "Cargador múltiple 6 bahías", spec: "Carga simultánea · gestión de carga", precio: 285.0, cat: "Accesorios" },
  { modelo: "ESM12", nombre: "Micrófono parlante remoto IP67", spec: "Resistente a polvo y agua · clip giratorio", precio: 74.0, cat: "Accesorios" },
  { modelo: "EHN21", nombre: "Auricular con tubo acústico", spec: "Vigilancia · transparente · discreto", precio: 58.0, cat: "Accesorios" },
  { modelo: "AN0160", nombre: "Antena base fibra de vidrio UHF", spec: "6 dBi · incluye kit de montaje", precio: 185.0, cat: "Infraestructura" },
  { modelo: "AN0435", nombre: "Antena Yagi direccional UHF", spec: "9 dBi · 6 elementos · enlace punto a punto", precio: 240.0, cat: "Infraestructura" },
  { modelo: "SRV-PROG", nombre: "Programación y configuración de red", spec: "Servicio de campo · plan de canales · pruebas de cobertura", precio: 750.0, cat: "Servicios" },
  { modelo: "SRV-INST", nombre: "Instalación de repetidor + antena", spec: "Mano de obra · torre/mástil · puesta a punto", precio: 1200.0, cat: "Servicios" },
  { modelo: "SRV-CAP", nombre: "Capacitación de usuarios (4 h)", spec: "En sitio · hasta 15 operadores", precio: 350.0, cat: "Servicios" },
  { modelo: "SRV-MANT", nombre: "Contrato de mantenimiento anual", spec: "2 visitas preventivas · soporte prioritario", precio: 1800.0, cat: "Servicios" },
];

/* Clientes recurrentes (para selector Para) */
const CLIENTES = [
  { id: "acp", razon: "Autoridad del Canal de Panamá", atencion: "Ing. Juan Pérez · Jefe de Telecomunicaciones", ruc: "1020304-1-123456", tel: "+507 272-0000", email: "juan.perez@pancanal.com" },
  { id: "mit", razon: "Manzanillo Intl. Terminal", atencion: "Lcdo. Carlos Him · Compras", ruc: "30506-1-445566", tel: "+507 430-9500", email: "compras@mit.com.pa" },
  { id: "minera", razon: "Minera Panamá, S.A.", atencion: "Ing. Roberto Sáenz · Seguridad Industrial", ruc: "224466-1-778899", tel: "+507 215-8000", email: "r.saenz@minerapanama.com" },
  { id: "spia", razon: "Aeropuerto Tocumen, S.A.", atencion: "Sra. Daniela Vega · Operaciones", ruc: "118822-1-220033", tel: "+507 238-2700", email: "operaciones@tocumen.aero" },
  { id: "bomberos", razon: "Benemérito Cuerpo de Bomberos", atencion: "Cap. Hugo Mendoza · Logística", ruc: "EST-007-2019", tel: "+507 504-2000", email: "logistica@bomberos.gob.pa" },
  { id: "copa", razon: "Petroterminal de Panamá", atencion: "Ing. Ana Lasso · Mantenimiento", ruc: "445577-1-991122", tel: "+507 433-7000", email: "a.lasso@ptp.com.pa" },
];

/* Condiciones por defecto (plantilla) */
const CONDICIONES_DEFAULT = [
  { k: "Tiempo de entrega", v: "4 – 6 semanas tras orden de compra" },
  { k: "Garantía", v: "12 meses contra defectos de fábrica" },
  { k: "Forma de pago", v: "50% anticipo · 50% contra entrega" },
  { k: "Validez de la oferta", v: "15 días calendario" },
  { k: "Instalación", v: "No incluida (cotizable aparte)" },
];

/* Plantillas de condiciones reutilizables */
const PLANTILLAS_COND = [
  { id: "estandar", nombre: "Estándar (venta de equipos)", cond: CONDICIONES_DEFAULT },
  {
    id: "gobierno", nombre: "Sector gobierno / licitación", cond: [
      { k: "Tiempo de entrega", v: "6 – 8 semanas tras orden de compra" },
      { k: "Garantía", v: "24 meses contra defectos de fábrica" },
      { k: "Forma de pago", v: "Contra entrega · crédito 30 días" },
      { k: "Validez de la oferta", v: "30 días calendario" },
      { k: "Instalación", v: "Incluida en sitio" },
    ],
  },
  {
    id: "servicio", nombre: "Servicio / mantenimiento", cond: [
      { k: "Tiempo de respuesta", v: "24 h hábiles" },
      { k: "Vigencia del contrato", v: "12 meses renovables" },
      { k: "Forma de pago", v: "Mensual · transferencia bancaria" },
      { k: "Validez de la oferta", v: "15 días calendario" },
      { k: "Cobertura", v: "Área metropolitana de Panamá" },
    ],
  },
];

/* Estados (ciclo de vida) — mapeados a clases visuales */
const ESTADOS = {
  borrador:   { label: "Borrador",   chip: "chip-espera",     dot: "var(--gray-500)" },
  enviada:    { label: "Enviada",    chip: "chip-recibida",   dot: "#1D4ED8" },
  aprobada:   { label: "Aprobada",   chip: "chip-aprobada",   dot: "#065F46" },
  rechazada:  { label: "Rechazada",  chip: "chip-cancelada",  dot: "#991B1B" },
  vencida:    { label: "Vencida",    chip: "chip-reparacion", dot: "#9A3412" },
  convertida: { label: "Convertida", chip: "chip-cotizada",   dot: "#92400E" },
};
const ESTADO_ORDEN = ["borrador", "enviada", "aprobada", "rechazada", "vencida", "convertida"];

/* Helper: construir renglón desde catálogo */
function itemFromCat(modelo, cant) {
  const p = CATALOGO.find((c) => c.modelo === modelo);
  return { id: uid(), modelo: p.modelo, nombre: p.nombre, spec: p.spec, cant: cant, precio: p.precio, desc: 0 };
}
function uid() { return "i" + Math.random().toString(36).slice(2, 9); }

/* Cotizaciones semilla */
const COTIZACIONES = [
  {
    id: "COT-2025-0142", estado: "enviada", clienteId: "acp", ejecutivoId: "sgil",
    fecha: "2025-05-12", validezDias: 15, moneda: "USD", descuentoPct: 5, itbmsPct: 7,
    intro: "Estimados señores: de acuerdo con su solicitud, presentamos la siguiente cotización de equipos de radiocomunicación profesional y servicios asociados.",
    items: [
      itemFromCat("HP785-U1", 12), itemFromCat("BL2010", 12), itemFromCat("CH10L07", 12),
      itemFromCat("HR1065-U", 1), itemFromCat("AN0160", 1), itemFromCat("SRV-PROG", 1),
    ],
    condiciones: CONDICIONES_DEFAULT,
  },
  {
    id: "COT-2025-0141", estado: "aprobada", clienteId: "mit", ejecutivoId: "sgil",
    fecha: "2025-05-09", validezDias: 15, moneda: "USD", descuentoPct: 0, itbmsPct: 7,
    intro: "Presentamos cotización de equipos móviles DMR y accesorios para flota portuaria.",
    items: [ itemFromCat("MD785-U", 8), itemFromCat("AN0435", 2), itemFromCat("SRV-INST", 1) ],
    condiciones: CONDICIONES_DEFAULT,
  },
  {
    id: "COT-2025-0140", estado: "borrador", clienteId: "minera", ejecutivoId: "rmoreno",
    fecha: "2025-05-08", validezDias: 30, moneda: "USD", descuentoPct: 8, itbmsPct: 7,
    intro: "Cotización de sistema de radiocomunicación crítica para operación minera.",
    items: [ itemFromCat("SC20-T", 24), itemFromCat("ESM12", 24), itemFromCat("MCA08", 4), itemFromCat("SRV-CAP", 1) ],
    condiciones: PLANTILLAS_COND[1].cond,
  },
  {
    id: "COT-2025-0138", estado: "convertida", clienteId: "spia", ejecutivoId: "lcastillo",
    fecha: "2025-04-28", validezDias: 15, moneda: "USD", descuentoPct: 3, itbmsPct: 7,
    intro: "Equipos portátiles DMR y accesorios para operaciones aeroportuarias.",
    items: [ itemFromCat("HP685-V", 30), itemFromCat("BL2503", 30), itemFromCat("EHN21", 30), itemFromCat("SRV-PROG", 1) ],
    condiciones: CONDICIONES_DEFAULT,
  },
  {
    id: "COT-2025-0135", estado: "vencida", clienteId: "bomberos", ejecutivoId: "sgil",
    fecha: "2025-04-10", validezDias: 15, moneda: "USD", descuentoPct: 10, itbmsPct: 0,
    intro: "Cotización de equipos de comunicación para cuerpo de emergencia (exento de ITBMS).",
    items: [ itemFromCat("PD506-U", 40), itemFromCat("CH10L07", 40), itemFromCat("ESM12", 40) ],
    condiciones: PLANTILLAS_COND[1].cond,
  },
  {
    id: "COT-2025-0131", estado: "rechazada", clienteId: "copa", ejecutivoId: "rmoreno",
    fecha: "2025-03-30", validezDias: 15, moneda: "USD", descuentoPct: 0, itbmsPct: 7,
    intro: "Sistema de repetición y mantenimiento para terminal petrolera.",
    items: [ itemFromCat("RD985-U", 1), itemFromCat("AN0435", 2), itemFromCat("SRV-MANT", 1) ],
    condiciones: PLANTILLAS_COND[2].cond,
  },
  {
    id: "COT-2025-0129", estado: "aprobada", clienteId: "acp", ejecutivoId: "lcastillo",
    fecha: "2025-03-22", validezDias: 30, moneda: "USD", descuentoPct: 5, itbmsPct: 7,
    intro: "Ampliación de flota de radios portátiles para cuadrillas de mantenimiento.",
    items: [ itemFromCat("HP785-U1", 20), itemFromCat("BL2010", 20), itemFromCat("ESM12", 20) ],
    condiciones: CONDICIONES_DEFAULT,
  },
  {
    id: "COT-2025-0124", estado: "enviada", clienteId: "minera", ejecutivoId: "sgil",
    fecha: "2025-03-15", validezDias: 30, moneda: "USD", descuentoPct: 6, itbmsPct: 7,
    intro: "Solución híbrida TETRA + LTE para personal distribuido en faena.",
    items: [ itemFromCat("SCL3-H", 15), itemFromCat("BL2503", 15), itemFromCat("SRV-CAP", 1) ],
    condiciones: PLANTILLAS_COND[1].cond,
  },
];

Object.assign(window, {
  EMISOR, EJECUTIVOS, CATALOGO, CLIENTES, CONDICIONES_DEFAULT, PLANTILLAS_COND,
  ESTADOS, ESTADO_ORDEN, COTIZACIONES, itemFromCat, uid,
});
