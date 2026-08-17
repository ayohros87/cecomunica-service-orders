// @ts-nocheck
// Asistente de bodega — carga una lista de seriales desde el Excel/CSV tal como
// bodega lo manda, muestra el diff ANTES de escribir, y deja resolver ahí mismo
// lo que hoy obliga a escalar por WhatsApp.
//
// POR QUÉ EXISTE. Entre el 2026-08-12 y el 13 bodega mandó seis hojas y en
// cinco no pudo terminar sola. Lo que las trabó no fue dar de alta un radio
// —eso ya funcionaba— sino todo lo demás: reclasificar un lote, comprobar si el
// cliente que el sistema muestra tiene contrato de verdad, marcar una base
// DAÑADA, corregir la propiedad, cargar 45 seriales por un textarea.
//
// POR QUÉ PREGUNTA LA INTENCIÓN PRIMERO. El 2026-08-14 bodega tenía que pasar
// 32 seriales de VM686 a PD686. El asistente los marcó a los 32 como COLISIÓN
// de serial —"marca solo si de verdad es otro equipo que comparte numeración"—
// y la única casilla en pantalla creaba 32 fichas duplicadas. No la marcó:
// cerró el asistente y editó las 32 fichas a mano, de 20:53 a 21:27.
//
// El problema no era que el asistente adivinara mal, sino que no tenía forma de
// que le dijeran qué se estaba intentando hacer. "El serial X existe bajo otro
// modelo" significa o el MISMO radio con el código mal puesto, o DOS radios que
// comparten numeración (el caso Kenwood NX-420/NX-920). En los datos se ven
// idénticos; lo único que los distingue es quien tiene el radio en la mano. Así
// que lo dice bodega en el paso 0, y no se adivina en ninguna parte.
//
// El otro motivo es que hay efectos que no caben en una casilla por fila:
// "reclasificar esta ficha" es un hecho de una fila, pero "y por lo tanto el
// conteo de la fila que vaciaste quedó mal" es un hecho de la OPERACIÓN. Eso es
// lo que se escapó el 14 de agosto y dejó a VM686 contando 32 con una unidad
// viva. Una intención sabe sus propios efectos colaterales; una casilla no.
//
// LA REGLA DE LA CASA: contar un radio es AFIRMAR dónde está. Nada se escribe
// desde el paso 1 — el paso 2 enseña qué va a pasar con cada serial, con la
// evidencia al lado, y quien cuenta decide. Las escrituras salen todas por las
// funciones de EquiposPoolService que ya usa la ficha: ninguna segunda ruta.
//
// API: AsistenteImportar.abrir({ user, onDone }). La página gatea el rol.
// Dependencias del host: firebase compat, EquiposPoolService, ModelosService,
// InventarioService, SerialPatron, Modal, cargarXLSX (js/core/xlsx-loader.js).
window.AsistenteImportar = (() => {

  const esc = (v) => (window.FMT && typeof FMT.esc === 'function') ? FMT.esc(v)
    : String(v == null ? '' : v).replace(/[&<>"']/g, s =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const toast = (m, t) => { if (window.Toast) Toast.show(m, t); };

  const ctx = {
    opts: null, el: null, busy: false,
    intencion: '',       // clave de INTENCIONES — se elige en el paso 0
    modelos: [], modeloId: '',
    modeloOrigenId: '',  // solo "reclasificar": de qué fila vienen
    ubicacion: '',       // solo "ubicacion": a dónde van
    nota: '',            // solo "anotar": el texto libre
    origen: '',          // nombre del archivo o "pegado"
    filas: [],           // filas crudas del archivo (array de arrays)
    columnas: [],        // { idx, muestra, nSeriales }
    colSerial: -1, colNota: -1,
    items: [],           // { crudo, norm, nota, clase, acciones, ... }
    diff: null,
    conteos: null,       // { origen, destino } de inventario_actual, para el paso 2
  };

  const vivo = (c) => !!c && ['activo', 'aprobado'].includes(String(c.estado || '').toLowerCase());
  const TERMINALES = ['baja', 'vendido'];

  // ── Paso 0: la intención ────────────────────────────────────────────────
  //
  // Cada intención decide tres cosas que antes estaban fijas: qué pregunta el
  // paso 1, cómo se clasifica cada serial, y qué efectos colaterales arrastra
  // la operación completa. Todas escriben por funciones que ya existen y ya
  // dejan kardex — ninguna ruta de escritura nueva.

  const INTENCIONES = {

    // 1 · El flujo de siempre: un modelo y la lista de lo que hay en el estante.
    conteo: {
      titulo: 'Conté este estante',
      sub: 'La lista es todo lo que hay físicamente de un modelo. Da de alta lo que falte, trae lo que el sistema tenga en otro lado y fija el conteo.',
      icono: 'clipboard-check',
      pregunta: 'modelo',
      conteo: 'fijar',
      clases: {
        nueva:     { txt: 'Se da de alta',     color: '#15803d' },
        en_bodega: { txt: 'Ya está en bodega', color: 'var(--fg-3)' },
        reubicar:  { txt: 'Hay que traerlo',   color: '#b45309' },
        colision:  { txt: 'Otro modelo',       color: '#b91c1c' },
        bloqueada: { txt: 'No se puede mover', color: '#b91c1c' },
      },
      clasificar(x, env) {
        const arr = x.todas;
        const propia = arr.find(d => EquiposPoolService._mismoModelo(d, env.modeloId, env.label));
        x.ficha = propia || null;
        x.otras = arr.filter(d => d !== propia);
        x.danada = /DA[NÑ]AD/i.test(x.nota || '');

        if (!arr.length)  x.clase = 'nueva';
        else if (!propia) x.clase = 'colision';
        else if (propia.estado === EquiposPoolService.ESTADOS.EN_BODEGA) x.clase = 'en_bodega';
        else if (EquiposPoolService.REUBICABLES_DESDE.includes(propia.estado)) x.clase = 'reubicar';
        else x.clase = 'bloqueada';

        // Se proponen marcadas salvo lo que exige criterio humano (colisión) o
        // lo que el sistema no debe decidir solo.
        x.acciones = {
          crear:     x.clase === 'nueva',
          reubicar:  x.clase === 'reubicar',
          modelo:    !!propia && (!propia.modelo_id || propia.modelo_id !== env.modeloId),
          propiedad: !!propia && propia.propiedad !== 'cecomunica',
          // En una colisión NO se anota: la única ficha con ese serial es la
          // del OTRO modelo, y escribirle "DAÑADA" marcaría un radio ajeno. Si
          // se confirma, la ficha nueva nace sufijada y su id no se conoce
          // hasta después, así que tampoco se intenta.
          nota:      x.danada && x.clase !== 'colision'
                       && (!propia || (propia.notas || '') !== notaDanada()),
          colision:  false,
        };
      },
      detalle(x, env) {
        const f = x.ficha;
        if (x.clase === 'reubicar') return detalleUbicacion(f, x);
        if (x.clase === 'colision') {
          return `ya registrado como <b>${esc(x.otras[0]?.modelo_label || '(sin modelo)')}</b>`
            + ` — si es el MISMO radio con el código mal puesto, cierra y usa`
            + ` <b>“Están con el código equivocado”</b>`;
        }
        if (x.clase === 'bloqueada') {
          return `está en ${esc(estadoLabel(f.estado))}: se resuelve por su propio flujo`;
        }
        if (x.clase === 'en_bodega' && !x.acciones.modelo && !x.acciones.propiedad && !x.acciones.nota) {
          return 'sin cambios';
        }
        return '';
      },
      chips(x, i, env) {
        const f = x.ficha, out = [];
        if (x.acciones.modelo) out.push(chip(i, 'modelo',
          f?.modelo_id ? `Reclasificar de ${esc(f.modelo_label || '(sin modelo)')}` : 'Completar el modelo'));
        if (x.acciones.propiedad) out.push(chip(i, 'propiedad',
          `Propiedad ${esc(f?.propiedad || 'sin dato')} → cecomunica`));
        if (x.acciones.nota) out.push(chip(i, 'nota', 'Marcar DAÑADA'));
        if (x.clase === 'reubicar') out.push(chip(i, 'reubicar', 'Está en mi estante: traerlo a bodega'));
        if (x.clase === 'colision') out.push(chip(i, 'colision', 'Es otro equipo: crear ficha aparte'));
        return out;
      },
      async aplicar(activos, env, user) {
        const r = { creadas: 0, reubicadas: 0, modelo: 0, propiedad: 0, notas: 0, colisiones: 0, errores: [] };
        const motivo = `Toma física de bodega — ${env.archivo}`;

        // Altas: por `recibir`, que ya trae el failsafe de colisión y el batch.
        const nuevas = activos.filter(x => x.acciones.crear).map(x => x.norm);
        if (nuevas.length) {
          const res = await EquiposPoolService.recibir(nuevas, {
            modelo_id: env.modeloId, modelo_label: env.label, condicion: env.cond,
            notas: '', origen: 'toma_fisica',
          }, user);
          r.creadas = res.nuevos;
        }
        const coli = activos.filter(x => x.acciones.colision).map(x => x.norm);
        if (coli.length) {
          const res = await EquiposPoolService.recibir(coli, {
            modelo_id: env.modeloId, modelo_label: env.label, condicion: env.cond,
            origen: 'toma_fisica', confirmarColisiones: true,
          }, user);
          r.colisiones = res.colisiones;
        }

        // El resto, unidad por unidad y por las funciones de siempre. Va en
        // serie a propósito (cada una es una transacción) — con 300 seriales
        // eso son minutos, así que el progreso no es adorno.
        const conTrabajo = activos.filter(x =>
          x.acciones.reubicar || x.acciones.modelo || x.acciones.propiedad || x.acciones.nota);
        let hechas = 0;
        for (const x of conTrabajo) {
          const f = x.ficha;
          progreso(++hechas, conTrabajo.length, x.norm);
          try {
            if (x.acciones.reubicar && f) {
              await EquiposPoolService.corregirABodega(f.id, motivo, user);
              r.reubicadas++;
              f.estado = EquiposPoolService.ESTADOS.EN_BODEGA;
            }
            if (x.acciones.modelo && f) {
              await EquiposPoolService.reclasificarModelo(f.id, {
                modelo_id: env.modeloId, modelo_label: env.label, condicion: env.cond,
                estadoActual: f.estado,
                antes: `${f.modelo_label || '(sin modelo)'} / ${f.condicion || '?'}`,
              }, motivo, user);
              r.modelo++;
            }
            if (x.acciones.propiedad && f) {
              await EquiposPoolService.corregirPropiedad(f.id, 'cecomunica',
                { estadoActual: f.estado, antes: f.propiedad || '' }, motivo, user);
              r.propiedad++;
            }
            if (x.acciones.nota) {
              // Puede ser una ficha recién creada: su id es el serial normalizado.
              const id = f?.id || x.norm;
              await EquiposPoolService.anotar(id, notaDanada(),
                { estadoActual: f?.estado || EquiposPoolService.ESTADOS.EN_BODEGA, antes: f?.notas || '' }, user);
              r.notas++;
            }
          } catch (e) {
            r.errores.push(`${x.norm}: ${e.message || e}`);
          }
        }
        return r;
      },
      resumen: (r) => [
        [r.creadas, 'fichas dadas de alta'], [r.reubicadas, 'traídas a bodega'],
        [r.modelo, 'reclasificadas de modelo'], [r.propiedad, 'con la propiedad corregida'],
        [r.notas, 'marcadas DAÑADA'], [r.colisiones, 'creadas aparte por serial compartido'],
      ],
    },

    // 2 · El caso VM686. Encontrar el serial bajo otro modelo es la CONFIRMACIÓN
    //     de lo que bodega vino a decir, no una colisión.
    reclasificar: {
      titulo: 'Están con el código equivocado',
      sub: 'El mismo radio, mal codificado. Cambia la lista al modelo correcto y mueve el conteo físico.',
      icono: 'replace',
      pregunta: 'origen_destino',
      conteo: 'mover',
      clases: {
        reclasificar:  { txt: 'Se reclasifica',      color: '#15803d' },
        ya_esta:       { txt: 'Ya está en el código', color: 'var(--fg-3)' },
        sin_ficha:     { txt: 'No existe ficha',      color: '#b45309' },
        no_es_origen:  { txt: 'No viene de ese código', color: '#b45309' },
        ambigua:       { txt: 'Serial en varias fichas', color: '#b45309' },
        contrato_vivo: { txt: 'Contrato vigente',     color: '#b91c1c' },
      },
      clasificar(x, env) {
        const arr = x.todas;
        x.acciones = { modelo: false };
        if (!arr.length) { x.clase = 'sin_ficha'; return; }

        // Con origen declarado se trabaja la ficha de ESA fila; sin origen solo
        // se puede si el serial tiene una sola ficha. Nunca se elige por
        // parecido: un serial compartido es justo el caso que no se adivina.
        let f = null;
        if (env.origenId) {
          const cand = arr.filter(d => d.modelo_id === env.origenId
            || EquiposPoolService._mismoModelo(d, env.origenId, env.origenLabel));
          if (cand.length > 1) { x.clase = 'ambigua'; return; }
          if (!cand.length) { x.clase = 'no_es_origen'; x.ficha = arr[0]; return; }
          f = cand[0];
        } else {
          if (arr.length > 1) { x.clase = 'ambigua'; return; }
          f = arr[0];
        }
        x.ficha = f;

        if (f.modelo_id === env.modeloId && (f.condicion || '') === env.cond) {
          x.clase = 'ya_esta'; return;
        }

        // Candado: cambiar QUÉ es un radio que está con un cliente bajo
        // contrato vigente cambia lo que se le factura. Primero se corrige el
        // contrato. La evidencia de si el contrato vive ya está cargada — es el
        // trabajo que pagó el caso B8310025.
        const c = f.asignacion?.contrato_doc_id ? env.contratos.get(f.asignacion.contrato_doc_id) : null;
        if (f.estado === EquiposPoolService.ESTADOS.EN_CLIENTE && vivo(c)) {
          x.clase = 'contrato_vivo'; x.contrato = c; return;
        }

        // Entre familias (VM686 → PD686) no es lo mismo que una variante
        // (PD686 → PD686-R): lo primero queda marcado como decisión de una
        // persona, igual que `repunta-modelo-lista --forzar`.
        x.entreFamilias = !EquiposPoolService._mismoModelo(f, env.modeloId, env.label);
        x.clase = 'reclasificar';
        x.acciones.modelo = true;
      },
      detalle(x, env) {
        const f = x.ficha;
        if (x.clase === 'sin_ficha') {
          return 'ese serial no está en el pool — para darlo de alta usa <b>“Conté este estante”</b>';
        }
        if (x.clase === 'no_es_origen') {
          return `está como <b>${esc(f?.modelo_label || '(sin modelo)')}</b>, no como`
            + ` ${esc(env.origenLabel)} — se deja fuera`;
        }
        if (x.clase === 'ambigua') {
          return `ese serial tiene ${x.todas.length} fichas`
            + ` (${x.todas.map(d => esc(d.modelo_label || '?')).join(', ')})`
            + ` — declara el código de origen para saber cuál tocar`;
        }
        if (x.clase === 'contrato_vivo') {
          return `<b>${esc(x.contrato?.contrato_id || f?.asignacion?.contrato_id || 'contrato')}</b> sigue VIGENTE`
            + ` con ${esc(f?.asignacion?.cliente_nombre || 'el cliente')}: cambiar el modelo cambia lo que se`
            + ` le factura. Corrige el contrato primero.`;
        }
        if (x.clase === 'ya_esta') return 'sin cambios';
        return `está como <b>${esc(f?.modelo_label || '(sin modelo)')}</b> / ${esc(f?.condicion || '?')}`
          + (x.entreFamilias ? ' · <span style="color:#b45309;">cambio entre familias</span>' : '')
          + (f?.estado !== EquiposPoolService.ESTADOS.EN_BODEGA
              ? ` · ${esc(estadoLabel(f?.estado))} (no se mueve de sitio)` : '');
      },
      chips(x, i, env) {
        return x.clase === 'reclasificar'
          ? [chip(i, 'modelo', `Pasar a ${esc(env.label)}`)] : [];
      },
      async aplicar(activos, env, user) {
        const r = { modelo: 0, entreFamilias: 0, errores: [] };
        const conTrabajo = activos.filter(x => x.acciones.modelo && x.ficha);
        let n = 0;
        for (const x of conTrabajo) {
          progreso(++n, conTrabajo.length, x.norm);
          const f = x.ficha;
          try {
            const motivo = `Cambio de código por bodega — ${env.archivo}.`
              + (x.entreFamilias ? ' Decisión manual: cambio ENTRE FAMILIAS.' : '');
            await EquiposPoolService.reclasificarModelo(f.id, {
              modelo_id: env.modeloId, modelo_label: env.label, condicion: env.cond,
              estadoActual: f.estado,
              antes: `${f.modelo_label || '(sin modelo)'} / ${f.condicion || '?'}`,
            }, motivo, user);
            r.modelo++;
            if (x.entreFamilias) r.entreFamilias++;
          } catch (e) { r.errores.push(`${x.norm}: ${e.message || e}`); }
        }
        return r;
      },
      resumen: (r) => [[r.modelo, 'reclasificadas'], [r.entreFamilias, 'de ellas, entre familias']],
    },

    // 3 · Lo que antes era una casilla escondida. Afirmarlo es serio: crea
    //     fichas nuevas con id sufijado.
    colision: {
      titulo: 'Comparten número con otro equipo',
      sub: 'Radios DISTINTOS que traen el mismo serial de fábrica (el caso Kenwood). Crea una ficha aparte para cada uno.',
      icono: 'copy',
      pregunta: 'modelo',
      conteo: null,
      clases: {
        confirmar: { txt: 'Ficha aparte',        color: '#15803d' },
        nueva:     { txt: 'Se da de alta',       color: '#15803d' },
        ya_esta:   { txt: 'Ya está en el modelo', color: '#b45309' },
      },
      clasificar(x, env) {
        const arr = x.todas;
        const propia = arr.find(d => EquiposPoolService._mismoModelo(d, env.modeloId, env.label));
        x.ficha = propia || null;
        x.otras = arr.filter(d => d !== propia);
        if (!arr.length) { x.clase = 'nueva'; x.acciones = { crear: true, colision: false }; return; }
        if (propia) { x.clase = 'ya_esta'; x.acciones = { crear: false, colision: false }; return; }
        // Acá sí va marcada: bodega YA declaró que son equipos distintos.
        x.clase = 'confirmar';
        x.acciones = { crear: false, colision: true };
      },
      detalle(x, env) {
        if (x.clase === 'ya_esta') {
          return `ya hay una ficha de ${esc(env.label)} con ese serial — no se puede`
            + ` distinguir de la que vas a crear; revísala antes`;
        }
        if (x.clase === 'confirmar') {
          return `el otro es <b>${esc(x.otras[0]?.modelo_label || '(sin modelo)')}</b>`
            + ` — se crea una ficha aparte, la suya no se toca`;
        }
        return 'ese serial no existía: entra como alta normal';
      },
      chips(x, i, env) {
        if (x.clase === 'confirmar') return [chip(i, 'colision', 'Sí: es otro equipo')];
        if (x.clase === 'nueva') return [chip(i, 'crear', 'Dar de alta')];
        return [];
      },
      async aplicar(activos, env, user) {
        const r = { colisiones: 0, creadas: 0, errores: [] };
        const coli = activos.filter(x => x.acciones.colision).map(x => x.norm);
        if (coli.length) {
          const res = await EquiposPoolService.recibir(coli, {
            modelo_id: env.modeloId, modelo_label: env.label, condicion: env.cond,
            origen: 'toma_fisica', confirmarColisiones: true,
          }, user);
          r.colisiones = res.colisiones;
        }
        const nuevas = activos.filter(x => x.acciones.crear).map(x => x.norm);
        if (nuevas.length) {
          const res = await EquiposPoolService.recibir(nuevas, {
            modelo_id: env.modeloId, modelo_label: env.label, condicion: env.cond,
            origen: 'toma_fisica',
          }, user);
          r.creadas = res.nuevos;
        }
        return r;
      },
      resumen: (r) => [[r.colisiones, 'fichas creadas aparte'], [r.creadas, 'altas normales']],
    },

    // 4 · Dónde está la unidad, sin tocar qué es ni de quién.
    ubicacion: {
      titulo: 'Corregir dónde están',
      sub: 'El sistema los tiene en otro lado. Tráelos a bodega, o márcalos como paradero desconocido.',
      icono: 'map-pin',
      pregunta: 'ubicacion',
      conteo: null,
      clases: {
        mover:     { txt: 'Se mueve',           color: '#15803d' },
        ya_esta:   { txt: 'Ya está ahí',        color: 'var(--fg-3)' },
        sin_ficha: { txt: 'No existe ficha',    color: '#b45309' },
        bloqueada: { txt: 'No se puede mover',  color: '#b91c1c' },
      },
      clasificar(x, env) {
        const arr = x.todas;
        x.acciones = { mover: false };
        if (!arr.length) { x.clase = 'sin_ficha'; return; }
        if (arr.length > 1) { x.clase = 'bloqueada'; x.ficha = arr[0]; x.multiple = true; return; }
        const f = arr[0];
        x.ficha = f;
        if (f.estado === env.ubicacion) { x.clase = 'ya_esta'; return; }
        const puede = env.ubicacion === EquiposPoolService.ESTADOS.EN_BODEGA
          ? EquiposPoolService.REUBICABLES_DESDE.includes(f.estado)
          : !TERMINALES.includes(f.estado);
        if (!puede) { x.clase = 'bloqueada'; return; }
        x.clase = 'mover';
        x.acciones.mover = true;
      },
      detalle(x, env) {
        const f = x.ficha;
        if (x.clase === 'sin_ficha') return 'ese serial no está en el pool';
        if (x.multiple) return `ese serial tiene ${x.todas.length} fichas — resuélvelo en la ficha`;
        if (x.clase === 'bloqueada') {
          return `está en ${esc(estadoLabel(f.estado))}: se resuelve por su propio flujo`;
        }
        if (x.clase === 'ya_esta') return 'sin cambios';
        return detalleUbicacion(f, x);
      },
      chips(x, i, env) {
        return x.clase === 'mover'
          ? [chip(i, 'mover', env.ubicacion === EquiposPoolService.ESTADOS.EN_BODEGA
              ? 'Está en mi estante: traerlo' : 'No aparece: paradero desconocido')] : [];
      },
      async aplicar(activos, env, user) {
        const r = { movidas: 0, errores: [] };
        const conTrabajo = activos.filter(x => x.acciones.mover && x.ficha);
        const aBodega = env.ubicacion === EquiposPoolService.ESTADOS.EN_BODEGA;
        const motivo = aBodega
          ? `Toma física de bodega: la unidad está en el estante — ${env.archivo}`
          : `Toma física de bodega: no aparece y nada respalda dónde está — ${env.archivo}`;
        let n = 0;
        for (const x of conTrabajo) {
          progreso(++n, conTrabajo.length, x.norm);
          try {
            if (aBodega) await EquiposPoolService.corregirABodega(x.ficha.id, motivo, user);
            else await EquiposPoolService.mandarAPorClasificar(x.ficha.id, motivo, user);
            r.movidas++;
          } catch (e) { r.errores.push(`${x.norm}: ${e.message || e}`); }
        }
        return r;
      },
      resumen: (r) => [[r.movidas, 'unidades movidas']],
    },

    // 5 · Lo que el pool no modela y sí importa. Antes solo existía la cadena
    //     fija "DAÑADA" y todo lo demás había que escalarlo.
    anotar: {
      titulo: 'Anotar algo en estos equipos',
      sub: 'Una nota de bodega en la ficha y en el kardex: dañado, sin batería, en revisión, lo que sea.',
      icono: 'sticky-note',
      pregunta: 'nota',
      conteo: null,
      clases: {
        anotar:    { txt: 'Se anota',        color: '#15803d' },
        ya_esta:   { txt: 'Ya tiene esa nota', color: 'var(--fg-3)' },
        sin_ficha: { txt: 'No existe ficha', color: '#b45309' },
      },
      clasificar(x, env) {
        const arr = x.todas;
        x.acciones = { nota: false };
        if (!arr.length) { x.clase = 'sin_ficha'; return; }
        const f = arr[0];
        x.ficha = f;
        x.otras = arr.slice(1);
        if ((f.notas || '').trim() === (env.nota || '').trim()) { x.clase = 'ya_esta'; return; }
        x.clase = 'anotar';
        x.acciones.nota = true;
      },
      detalle(x, env) {
        const f = x.ficha;
        if (x.clase === 'sin_ficha') return 'ese serial no está en el pool';
        if (x.clase === 'ya_esta') return 'sin cambios';
        const otras = x.otras?.length ? ` · <span style="color:#b45309;">ese serial tiene ${x.todas.length} fichas: se anota la de ${esc(f.modelo_label || '?')}</span>` : '';
        return (f.notas ? `pisa la nota actual: “${esc(f.notas)}”` : `${esc(estadoLabel(f.estado))}`) + otras;
      },
      chips(x, i, env) { return x.clase === 'anotar' ? [chip(i, 'nota', 'Anotar')] : []; },
      async aplicar(activos, env, user) {
        const r = { notas: 0, errores: [] };
        const conTrabajo = activos.filter(x => x.acciones.nota && x.ficha);
        let n = 0;
        for (const x of conTrabajo) {
          progreso(++n, conTrabajo.length, x.norm);
          try {
            await EquiposPoolService.anotar(x.ficha.id, env.nota,
              { estadoActual: x.ficha.estado, antes: x.ficha.notas || '' }, user);
            r.notas++;
          } catch (e) { r.errores.push(`${x.norm}: ${e.message || e}`); }
        }
        return r;
      },
      resumen: (r) => [[r.notas, 'fichas anotadas']],
    },

    // 6 · El paso 2 y nada más. Es verifica-seriales-lista.js con cara de
    //     pantalla: sirve para comprobar una hoja antes de comprometerla.
    revisar: {
      titulo: 'Solo quiero revisar',
      sub: 'Cruza la lista contra el inventario y muestra qué pasaría. No escribe nada.',
      icono: 'search',
      pregunta: 'modelo',
      conteo: null,
      soloLectura: true,
      get clases() { return INTENCIONES.conteo.clases; },
      clasificar(x, env) {
        INTENCIONES.conteo.clasificar(x, env);
        // Sin botón de aplicar las casillas serían decorativas.
        Object.keys(x.acciones).forEach(k => { x.acciones[k] = false; });
      },
      detalle(x, env) { return INTENCIONES.conteo.detalle(x, env); },
      chips() { return []; },
    },
  };

  const intencion = () => INTENCIONES[ctx.intencion] || INTENCIONES.conteo;
  const estadoLabel = (e) => EquiposPoolService.ESTADO_LABELS[e] || e || '—';

  // Detalle compartido: dónde dice el sistema que está la unidad y con qué
  // evidencia. Decir si el contrato sigue VIVO es la pregunta que bodega no
  // pudo responder con B8310025 y por la que escaló — no había tal contrato.
  function detalleUbicacion(f, x) {
    if (!f) return '';
    const quien = f.asignacion?.cliente_nombre ? ` con <b>${esc(f.asignacion.cliente_nombre)}</b>` : '';
    let ct = '';
    if (f.asignacion?.contrato_id) {
      const c = x.contrato;
      ct = ` · contrato ${esc(f.asignacion.contrato_id)} `
        + (!c ? '<span style="color:#b45309;">(ya no existe)</span>'
              : vivo(c) ? `<span style="color:#b91c1c;">(VIGENTE — hay que corregirlo también)</span>`
                        : `<span style="color:var(--fg-3);">(${esc(c.estado)})</span>`);
    } else if (f.asignacion?.cliente_nombre) {
      ct = ' · <span style="color:var(--fg-3);">sin contrato que lo respalde</span>';
    }
    return `el sistema lo tiene en ${esc(estadoLabel(f.estado))}${quien}${ct}`;
  }

  async function abrir(opts = {}) {
    Object.assign(ctx, { opts: opts || {}, filas: [], columnas: [], items: [], diff: null,
      colSerial: -1, colNota: -1, intencion: '', modeloId: '', modeloOrigenId: '',
      ubicacion: EquiposPoolService.ESTADOS.EN_BODEGA, nota: '', origen: '', conteos: null });
    render();
    try {
      const todos = await ModelosService.getModelos();
      // `modelo` se guarda aparte del label porque las hojas titulan la columna
      // con el modelo a secas ("NX-410-R"), sin la marca — ver esNombreDeModelo.
      ctx.modelos = (todos || []).filter(m => m.activo !== false)
        .map(m => ({ id: m.id, label: `${m.marca || ''} ${m.modelo || ''}`.trim(),
                     modelo: m.modelo || '', estado: (m.estado || '').toUpperCase() }))
        .sort((a, b) => a.label.localeCompare(b.label));
    } catch (e) {
      console.warn('No se pudo cargar el catálogo:', e);
      ctx.modelos = [];
    }
    paso0();
  }

  function paso0() {
    const tarjetas = Object.entries(INTENCIONES).map(([k, it]) => `
      <button type="button" class="ai-intencion" data-intencion="${esc(k)}"
        style="display:flex; gap:10px; align-items:flex-start; width:100%; text-align:left;
               border:1px solid var(--border); border-radius:var(--radius-md);
               padding:10px 12px; background:var(--bg-1); cursor:pointer; margin-bottom:8px;">
        <i data-lucide="${esc(it.icono)}" style="width:18px;height:18px;flex:none;margin-top:2px;"></i>
        <span>
          <span style="display:block; font-weight:600; font-size:13.5px;">${esc(it.titulo)}</span>
          <span style="display:block; font-size:12px; color:var(--fg-3); margin-top:2px;">${esc(it.sub)}</span>
        </span>
      </button>`).join('');

    cuerpo(`
      <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
        ¿Qué quieres hacer con esta lista de seriales?</p>
      ${tarjetas}`,
      `<button class="btn btn-ghost" data-action="cerrar">Cancelar</button>`);

    document.querySelectorAll('.ai-intencion').forEach(b => {
      b.addEventListener('click', () => _setIntencion(b.dataset.intencion));
      b.addEventListener('mouseenter', () => { b.style.borderColor = 'var(--accent)'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = 'var(--border)'; });
    });
  }

  function _setIntencion(k) {
    if (!INTENCIONES[k]) return;
    ctx.intencion = k;
    paso1();
  }

  const modeloLabel = (id) => ctx.modelos.find(m => m.id === id)?.label || '';

  // La condición la impone la fila del catálogo, nunca se elige: una ficha no
  // puede decir "reuso" con un modelo que el catálogo tiene como nuevo.
  function condicionDe(id) {
    const m = ctx.modelos.find(x => x.id === id);
    if (!m) return 'nuevo';
    if (m.estado === 'R') return 'reuso';
    if (m.estado === 'N') return 'nuevo';
    return /[\s-]r$/i.test(m.label || '') ? 'reuso' : 'nuevo';
  }

  // ── Paso 1: el contexto que pide la intención + el archivo ──────────────

  function selectModelo(id, sel, etiqueta, ayuda) {
    const opts = ctx.modelos.map(m =>
      `<option value="${esc(m.id)}" ${m.id === sel ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    return `
      <div class="form-field">
        <label class="form-label" for="${id}">${esc(etiqueta)}</label>
        <select class="form-select" id="${id}" onchange="AsistenteImportar._setModelo(this.value, '${id}')">
          <option value="">Seleccione…</option>${opts}
        </select>
        ${ayuda ? `<p id="${id}Hint" style="font-size:12px; color:var(--fg-3); margin:4px 0 0;">${ayuda}</p>` : ''}
      </div>`;
  }

  function encabezadoPaso1() {
    const it = intencion();
    if (it.pregunta === 'modelo') {
      return selectModelo('aiModelo', ctx.modeloId, 'Modelo de la hoja',
        'La condición (nuevo / refurbished) la define el modelo escogido.');
    }
    if (it.pregunta === 'origen_destino') {
      return selectModelo('aiModelo', ctx.modeloId, 'Código CORRECTO (a dónde van)',
          'La condición (nuevo / refurbished) la define el modelo escogido.')
        + selectModelo('aiModeloOrigen', ctx.modeloOrigenId, 'Código equivocado (de dónde vienen) — opcional',
            'Déjalo vacío si no lo sabes. Hace falta cuando un serial tiene más de una ficha, '
            + 'y es lo que permite mover el conteo físico.');
    }
    if (it.pregunta === 'ubicacion') {
      const E = EquiposPoolService.ESTADOS;
      return `
        <div class="form-field">
          <label class="form-label" for="aiUbicacion">¿A dónde van?</label>
          <select class="form-select" id="aiUbicacion" onchange="AsistenteImportar._setUbicacion(this.value)">
            <option value="${E.EN_BODEGA}" ${ctx.ubicacion === E.EN_BODEGA ? 'selected' : ''}>
              Están en mi estante — traerlos a bodega</option>
            <option value="${E.POR_CLASIFICAR}" ${ctx.ubicacion === E.POR_CLASIFICAR ? 'selected' : ''}>
              No aparecen — paradero desconocido</option>
          </select>
        </div>`;
    }
    if (it.pregunta === 'nota') {
      return `
        <div class="form-field">
          <label class="form-label" for="aiNota">La nota que va en cada ficha</label>
          <input class="form-input" id="aiNota" maxlength="180" value="${esc(ctx.nota)}"
            placeholder="Ej.: DAÑADA — reportada por bodega en el conteo físico"
            oninput="AsistenteImportar._setNota(this.value)">
          <p style="font-size:12px; color:var(--fg-3); margin:4px 0 0;">
            Queda en la ficha y en el kardex. Pisa la nota anterior, si había.</p>
        </div>`;
    }
    return '';
  }

  function paso1() {
    const it = intencion();
    cuerpo(`
      <div style="display:flex; align-items:center; gap:8px; margin:0 0 10px;">
        <i data-lucide="${esc(it.icono)}" style="width:16px;height:16px;"></i>
        <b style="font-size:13.5px;">${esc(it.titulo)}</b>
        <button class="btn btn-sm btn-ghost" style="margin-left:auto; font-size:12px;"
          onclick="AsistenteImportar._volverPaso0()">Cambiar</button>
      </div>

      ${encabezadoPaso1()}

      <div id="aiDrop" style="border:2px dashed var(--border); border-radius:var(--radius-md);
           padding:18px; text-align:center; cursor:pointer; margin-top:var(--sp-2);">
        <i data-lucide="file-spreadsheet" style="width:26px;height:26px;"></i>
        <p style="margin:6px 0 2px; font-weight:600;">Arrastra el Excel o CSV aquí</p>
        <p style="margin:0; font-size:12px; color:var(--fg-3);">
          o haz clic para elegirlo · .xlsx, .xls, .csv — la hoja va tal como la mandan</p>
        <input type="file" id="aiFile" accept=".xlsx,.xls,.csv,text/csv" style="display:none;">
      </div>
      <p id="aiArchivoInfo" style="font-size:12.5px; color:var(--fg-3); margin:8px 0 0;"></p>

      <details style="margin-top:var(--sp-2);">
        <summary style="cursor:pointer; font-size:12.5px; color:var(--fg-3);">…o pegar los seriales a mano</summary>
        <textarea class="form-input" id="aiPegar" rows="4" placeholder="Un serial por línea"
          style="font-family:var(--font-mono); margin-top:6px;"></textarea>
        <button class="btn btn-sm" style="margin-top:6px;" onclick="AsistenteImportar._usarPegado()">Usar lo pegado</button>
      </details>`,
      `<button class="btn btn-ghost" onclick="AsistenteImportar._volverPaso0()">← Atrás</button>
       <button class="btn btn-primary" id="aiBtnRevisar" disabled
         onclick="AsistenteImportar._revisar()">Revisar →</button>`);

    const drop = document.getElementById('aiDrop');
    const file = document.getElementById('aiFile');
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', (e) => { if (e.target.files?.[0]) leerArchivo(e.target.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.style.borderColor = 'var(--accent)';
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.style.borderColor = 'var(--border)';
    }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer?.files?.[0];
      if (f) leerArchivo(f);
    });
    sincronizarBoton();
  }

  function _volverPaso0() { paso0(); }

  function _setModelo(id, cual) {
    if (cual === 'aiModeloOrigen') ctx.modeloOrigenId = id;
    else ctx.modeloId = id;
    const hint = document.getElementById(`${cual || 'aiModelo'}Hint`);
    if (hint && cual !== 'aiModeloOrigen') {
      hint.textContent = !id ? 'La condición (nuevo / refurbished) la define el modelo escogido.'
        : condicionDe(id) === 'reuso'
          ? 'Refurbished: la fila del catálogo lleva sufijo -R.'
          : 'Nuevo: la fila del catálogo no lleva sufijo -R.';
    }
    sincronizarBoton();
  }

  function _setUbicacion(v) { ctx.ubicacion = v; sincronizarBoton(); }
  function _setNota(v) { ctx.nota = v; sincronizarBoton(); }

  // Qué hace falta para poder revisar, según lo que pidió la intención.
  function listoParaRevisar() {
    const it = intencion();
    if (!ctx.filas.length) return false;
    if (it.pregunta === 'modelo' || it.pregunta === 'origen_destino') return !!ctx.modeloId;
    if (it.pregunta === 'nota') return !!(ctx.nota || '').trim();
    return true;
  }

  function sincronizarBoton() {
    const btn = document.getElementById('aiBtnRevisar');
    if (btn) btn.disabled = !listoParaRevisar();
  }

  // ── Lectura del archivo ─────────────────────────────────────────────────

  // CSV propio en vez de delegarlo a SheetJS: las hojas de bodega vienen con
  // BOM y separadas por `;` (Excel en español), y el autodetect se equivoca
  // dejando una sola columna con todo dentro.
  function parsearCSV(texto) {
    const limpio = texto.replace(/^﻿/, '');
    const lineas = limpio.split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lineas.length) return [];
    const cand = [';', ',', '\t', '|'];
    const sep = cand
      .map(s => ({ s, n: lineas.slice(0, 10).reduce((a, l) => a + l.split(s).length - 1, 0) }))
      .sort((a, b) => b.n - a.n)[0];
    if (!sep || !sep.n) return lineas.map(l => [l.trim()]);
    return lineas.map(l => l.split(sep.s).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  }

  async function leerArchivo(file) {
    ctx.origen = file.name;
    const info = document.getElementById('aiArchivoInfo');
    if (info) info.textContent = `Leyendo ${file.name}…`;
    try {
      if (/\.csv$/i.test(file.name)) {
        ctx.filas = parsearCSV(await file.text());
      } else {
        const XLSX = await cargarXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const hoja = wb.Sheets[wb.SheetNames[0]];
        ctx.filas = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, raw: false })
          .map(f => (f || []).map(c => String(c ?? '').trim()));
      }
      detectarColumnas();
      if (info) {
        info.innerHTML = ctx.colSerial < 0
          ? `<span style="color:#b45309;">No encontré una columna con seriales en <b>${esc(file.name)}</b>.</span>`
          : `<b>${esc(file.name)}</b> — ${ctx.filas.length} filas. `
            + `Seriales en la ${selectorColumna()}${ctx.colNota >= 0 ? ` · notas en la columna ${ctx.colNota + 1}` : ''}.`;
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error('No se pudo leer el archivo:', e);
      if (info) info.innerHTML = `<span style="color:#b91c1c;">No se pudo leer: ${esc(e.message || e)}</span>`;
      ctx.filas = [];
    }
    sincronizarBoton();
  }

  // ¿Esta celda puede ser un serial? Tres filtros, cada uno puesto por una hoja
  // real que sin él entraba mal:
  //   · largo ≥5 — descarta la columna de numeración (1, 2, 3…) que abre todas
  //     las hojas de bodega.
  //   · sin espacios internos — descarta la columna que repite el MODELO
  //     ("TM-7PLUS R", "PD786G R"): normalizada queda "TM7PLUSR", que es
  //     alfanumérica y trae dígito, así que pasaba por serial en todas las filas
  //     y competía con la columna buena. También mata encabezados como
  //     "30 RADIOS", que si no se colaba como una unidad más.
  //   · el filtro de siempre (alfanumérico con al menos un dígito).
  function pareceSerial(crudo) {
    const v = (crudo || '').toString().trim();
    if (!v || /\s/.test(v)) return false;
    const norm = EquiposPoolService.normalizarSerial(v);
    if (!EquiposPoolService.esSerialValido(norm) || norm.length < 5) return false;
    return !esNombreDeModelo(v);
  }

  // Las hojas titulan la columna con el modelo —"NX-410-R", "TK-D240-R"— y ese
  // título cae DENTRO de la columna de seriales. Normalizado queda "NX410R":
  // alfanumérico, con dígito y de largo suficiente, así que pasaba todos los
  // filtros y entraba como una unidad fantasma más. Se descarta cotejándolo
  // contra el catálogo ENTERO —no contra el modelo elegido—, que es quien sabe
  // qué es un nombre de modelo: por eso "reclasificar", que trabaja con dos
  // filas a la vez, no necesita nada especial acá.
  function esNombreDeModelo(v) {
    const t = EquiposPoolService._tightLabel(v);
    if (!t) return false;
    return ctx.modelos.some(m =>
      EquiposPoolService._tightLabel(m.label) === t ||
      EquiposPoolService._tightLabel(m.modelo || '') === t);
  }

  // Se puntúa por seriales DISTINTOS, no por celdas: un serial es único por
  // definición y el modelo se repite en cada fila. Sin esto, en la hoja de las
  // bases TM-7PLUS la columna del modelo empataba 45 a 45 con la de seriales.
  function detectarColumnas() {
    const ancho = ctx.filas.reduce((m, f) => Math.max(m, f.length), 0);
    ctx.columnas = [];
    for (let i = 0; i < ancho; i++) {
      const unicos = new Set();
      const muestra = [];
      for (const f of ctx.filas) {
        const v = (f[i] || '').toString().trim();
        if (!v) continue;
        if (muestra.length < 3) muestra.push(v);
        if (pareceSerial(v)) unicos.add(EquiposPoolService.normalizarSerial(v));
      }
      ctx.columnas.push({ idx: i, muestra, nSeriales: unicos.size });
    }
    const mejor = [...ctx.columnas].sort((a, b) => b.nSeriales - a.nSeriales)[0];
    ctx.colSerial = mejor && mejor.nSeriales >= 2 ? mejor.idx : -1;
    // Columna de nota: la que traiga BODEGA/DAÑADA/etc. Solo se miran las filas
    // que SÍ traen serial y gana la que más veces lo diga — si no, el subtítulo
    // "BASE DAÑADAS" de una fila suelta se llevaba la elección.
    ctx.colNota = -1;
    if (ctx.colSerial >= 0) {
      const conSerial = ctx.filas.filter(f => pareceSerial(f[ctx.colSerial]));
      let mejorN = 0;
      for (const c of ctx.columnas) {
        if (c.idx === ctx.colSerial) continue;
        const n = conSerial.filter(f =>
          /DA[NÑ]ADA|DA[NÑ]ADO|BODEGA|MALO|BUENO/i.test((f[c.idx] || '').toString())).length;
        if (n > mejorN) { mejorN = n; ctx.colNota = c.idx; }
      }
    }
  }

  function selectorColumna() {
    const opts = ctx.columnas.map(c =>
      `<option value="${c.idx}" ${c.idx === ctx.colSerial ? 'selected' : ''}>`
      + `columna ${c.idx + 1} (${c.nSeriales} seriales${c.muestra.length ? ` · ${esc(c.muestra[0])}…` : ''})`
      + `</option>`).join('');
    return `<select class="cc-input" style="font-size:12px; padding:2px 4px;"
              onchange="AsistenteImportar._setColSerial(this.value)">${opts}</select>`;
  }

  function _setColSerial(idx) { ctx.colSerial = Number(idx); sincronizarBoton(); }

  function _usarPegado() {
    const t = document.getElementById('aiPegar')?.value || '';
    const lineas = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lineas.length) { toast('Pega al menos un serial.', 'bad'); return; }
    ctx.filas = lineas.map(l => [l]);
    ctx.colSerial = 0; ctx.colNota = -1; ctx.origen = 'pegado a mano';
    ctx.columnas = [{ idx: 0, muestra: lineas.slice(0, 3), nSeriales: lineas.length }];
    const info = document.getElementById('aiArchivoInfo');
    if (info) info.innerHTML = `<b>${lineas.length}</b> seriales pegados a mano.`;
    sincronizarBoton();
  }

  // ── Paso 2: el diff ─────────────────────────────────────────────────────

  // El entorno que ve la intención: todo lo que declaró el paso 1 más la
  // evidencia cargada. Se arma una sola vez y se pasa a clasificar/detalle/
  // chips/aplicar, para que ninguna intención lea `ctx` por su cuenta.
  function entorno(contratos) {
    return {
      modeloId: ctx.modeloId,
      label: modeloLabel(ctx.modeloId),
      cond: condicionDe(ctx.modeloId),
      origenId: ctx.modeloOrigenId,
      origenLabel: modeloLabel(ctx.modeloOrigenId),
      ubicacion: ctx.ubicacion,
      nota: (ctx.nota || '').trim(),
      archivo: ctx.origen,
      contratos: contratos || new Map(),
    };
  }

  async function _revisar() {
    const it = intencion();
    if (!listoParaRevisar()) { toast('Falta completar el paso anterior.', 'bad'); return; }
    if (ctx.colSerial < 0) { toast('No hay columna de seriales.', 'bad'); return; }
    cuerpo(`<p style="color:var(--fg-3);">Cruzando ${ctx.filas.length} filas contra el inventario…</p>`, '');

    // 1. Normalizar y deduplicar, conservando el crudo para poder mostrarlo.
    const vistos = new Map();
    const invalidos = [], duplicados = [];
    for (const f of ctx.filas) {
      const crudo = (f[ctx.colSerial] || '').toString().trim();
      if (!crudo) continue;
      // Mismo filtro que la detección de columna: así los encabezados que caen
      // dentro de la columna buena ("30 RADIOS") se descartan acá en vez de
      // entrar como una unidad más.
      if (!pareceSerial(crudo)) { invalidos.push(crudo); continue; }
      const norm = EquiposPoolService.normalizarSerial(crudo);
      if (vistos.has(norm)) { duplicados.push(norm); continue; }
      const nota = ctx.colNota >= 0 ? (f[ctx.colNota] || '').toString().trim() : '';
      vistos.set(norm, { crudo, norm, nota, limpiado: crudo.toUpperCase() !== norm });
    }
    const items = [...vistos.values()];

    // 2. Fichas existentes — por serial_norm (NO por documentId): el failsafe de
    //    colisión crea docs sufijados `serial__modelo`, y buscarlos por id los
    //    daría por inexistentes, duplicando la unidad.
    const fichas = new Map();
    const norms = items.map(i => i.norm);
    for (let i = 0; i < norms.length; i += 10) {
      const snap = await firebase.firestore().collection('equipos_pool')
        .where('serial_norm', 'in', norms.slice(i, i + 10)).get();
      snap.docs.forEach(d => {
        const arr = fichas.get(d.data().serial_norm) || [];
        arr.push({ id: d.id, ...d.data() });
        fichas.set(d.data().serial_norm, arr);
      });
    }

    // 3. Contratos referenciados: para poder decir si el vínculo sigue VIVO.
    //    Es la pregunta que bodega no pudo responder con B8310025 y por la que
    //    escaló — resultó que no había contrato ninguno.
    const contratoIds = new Set();
    fichas.forEach(arr => arr.forEach(d => {
      if (d.asignacion?.contrato_doc_id) contratoIds.add(d.asignacion.contrato_doc_id);
    }));
    const contratos = new Map();
    await Promise.all([...contratoIds].map(async id => {
      try {
        const s = await firebase.firestore().collection('contratos').doc(id).get();
        if (s.exists) contratos.set(id, { id, ...s.data() });
      } catch (e) { /* sin permiso o borrado: se trata como sin evidencia */ }
    }));

    // 4. Clasificar cada serial según la intención declarada.
    const env = entorno(contratos);
    const patron = SerialPatron.revisar(norms);
    const aviso = new Map(patron.revisados.filter(r => r.sospechoso).map(r => [r.serial, r]));
    for (const x of items) {
      x.todas = fichas.get(x.norm) || [];
      x.sospecha = aviso.get(x.norm) || null;
      x.contrato = null;
      it.clasificar(x, env);
      // El contrato del detalle sale de la ficha que la intención eligió.
      const f = x.ficha;
      if (!x.contrato && f?.asignacion?.contrato_doc_id) {
        x.contrato = contratos.get(f.asignacion.contrato_doc_id) || null;
      }
    }

    // 5. Conteo físico: para "mover" hay que enseñar los dos números ANTES,
    //    que es justo lo que faltó el 14 de agosto.
    ctx.conteos = null;
    if (it.conteo === 'mover') {
      try {
        const todos = await InventarioService.getInventarioActual();
        const buscar = (id) => id ? (todos.find(t => t.id === id)?.cantidad ?? null) : null;
        ctx.conteos = { origen: buscar(ctx.modeloOrigenId), destino: buscar(ctx.modeloId) };
      } catch (e) { console.warn('No se pudo leer el conteo actual:', e); }
    }

    ctx.items = items;
    ctx.diff = { invalidos, duplicados, patron };
    paso2();
  }

  const notaDanada = () => `DAÑADA — reportada por bodega en el conteo físico`;

  function progreso(n, total, serial) {
    const barra = document.getElementById('aiBarra');
    const txt = document.getElementById('aiProgreso');
    if (barra) barra.style.width = `${Math.round((n / Math.max(total, 1)) * 100)}%`;
    if (txt) txt.textContent = `${n} de ${total} — ${serial}`;
  }

  // Bloque del conteo físico. En "conteo" es una casilla; en "reclasificar" son
  // dos, y van por separado a propósito: que las unidades ya no estén en el
  // origen es un hecho, pero que falten en el destino NO — si bodega ya las
  // anotó bajo el código bueno, sumarlas las contaría dos veces. Por eso la
  // suma va DESmarcada y con los números a la vista.
  function bloqueConteo(nActivos) {
    const it = intencion();
    if (it.conteo === 'fijar') {
      return `
        <label class="toggle-pill" style="margin-top:var(--sp-2);">
          <input type="checkbox" id="aiFijarConteo" checked>
          Fijar el conteo físico de ${esc(modeloLabel(ctx.modeloId))} en ${nActivos}
        </label>`;
    }
    if (it.conteo !== 'mover') return '';

    const n = ctx.items.filter(x => !x.excluido && x.acciones?.modelo).length;
    if (!n) return '';
    const c = ctx.conteos || { origen: null, destino: null };
    const oLabel = modeloLabel(ctx.modeloOrigenId);
    const dLabel = modeloLabel(ctx.modeloId);
    const num = (v) => v == null ? '—' : v;

    const filaOrigen = ctx.modeloOrigenId ? `
      <label style="display:flex; gap:8px; align-items:flex-start; font-size:12.5px; margin-bottom:6px;">
        <input type="checkbox" id="aiRestarOrigen" ${c.origen == null ? 'disabled' : 'checked'}>
        <span>Restar ${n} del conteo de <b>${esc(oLabel)}</b>
          <span style="color:var(--fg-3);">(${num(c.origen)} → ${c.origen == null ? '—' : Math.max(0, c.origen - n)})</span>
          ${c.origen == null ? '<br><span style="color:var(--fg-3);">esa fila no tiene conteo registrado</span>' : ''}
        </span>
      </label>` : `
      <p style="font-size:12.5px; color:#b45309; margin:0 0 6px;">
        Sin código de origen declarado no se puede tocar el conteo de la fila que se vacía.</p>`;

    return `
      <div style="margin-top:var(--sp-2); border:1px solid var(--border);
           border-radius:var(--radius-sm); padding:10px;">
        <p style="margin:0 0 6px; font-weight:600; font-size:12.5px;">Conteo físico</p>
        ${filaOrigen}
        <label style="display:flex; gap:8px; align-items:flex-start; font-size:12.5px;">
          <input type="checkbox" id="aiSumarDestino">
          <span>Sumar ${n} al conteo de <b>${esc(dLabel)}</b>
            <span style="color:var(--fg-3);">(${num(c.destino)} → ${(c.destino || 0) + n})</span>
            <br><span style="color:var(--fg-3);">márcalo solo si NO los contaste ya bajo el código correcto</span>
          </span>
        </label>
      </div>`;
  }

  function paso2() {
    const it = intencion();
    const CLASES = it.clases;
    const items = ctx.items;
    const cuenta = (c) => items.filter(x => x.clase === c).length;
    const sospechosos = items.filter(x => x.sospecha).length;
    const env = entorno(null);

    const resumen = Object.entries(CLASES)
      .filter(([c]) => cuenta(c))
      .map(([c, m]) => `<span style="color:${m.color}; font-weight:600;">${cuenta(c)}</span> ${esc(m.txt.toLowerCase())}`)
      .join(' · ');

    const filas = items.map((x, i) => {
      const meta = CLASES[x.clase] || { txt: x.clase || '—', color: 'var(--fg-3)' };
      const detalle = it.detalle ? it.detalle(x, env) : '';
      const chips = it.chips ? it.chips(x, i, env) : [];

      const sosp = x.sospecha ? `
        <div style="margin-top:4px; font-size:12px; color:#b45309;">
          <i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-2px;"></i>
          Revisar: ${esc(x.sospecha.motivo)}
          ${x.sospecha.sugerencia ? `<button class="btn btn-sm" style="padding:0 6px; margin-left:4px;"
             onclick="AsistenteImportar._corregirSerial(${i})">Usar ${esc(x.sospecha.sugerencia)}</button>` : ''}
          <button class="btn btn-sm" style="padding:0 6px;" onclick="AsistenteImportar._excluir(${i})">Dejar fuera</button>
        </div>` : '';

      return `<tr style="${x.excluido ? 'opacity:.45;' : ''}">
        <td style="font-family:var(--font-mono); white-space:nowrap;">
          ${esc(x.norm)}
          ${x.limpiado ? `<span title="La hoja traía «${esc(x.crudo)}»" style="color:var(--fg-3);">*</span>` : ''}
        </td>
        <td>
          <span style="color:${meta.color}; font-weight:600;">${esc(meta.txt)}</span>
          ${detalle ? `<div style="font-size:12px; color:var(--fg-3);">${detalle}</div>` : ''}
          ${chips.length ? `<div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:6px;">${chips.join('')}</div>` : ''}
          ${sosp}
        </td>
      </tr>`;
    }).join('');

    const avisos = [];
    if (ctx.diff.invalidos.length) avisos.push(`${ctx.diff.invalidos.length} celda(s) no eran seriales y se ignoraron`);
    if (ctx.diff.duplicados.length) avisos.push(`${ctx.diff.duplicados.length} repetido(s) en la hoja`);
    if (sospechosos) avisos.push(`<b style="color:#b45309;">${sospechosos} con pinta de estar mal tecleado</b>`);

    const nActivos = items.filter(x => !x.excluido).length;
    const titulo = it.pregunta === 'origen_destino'
      ? `${esc(modeloLabel(ctx.modeloOrigenId) || 'sin origen')} → <b>${esc(modeloLabel(ctx.modeloId))}</b>`
      : it.pregunta === 'nota' ? `Nota: “${esc(ctx.nota)}”`
      : it.pregunta === 'ubicacion' ? `Destino: <b>${esc(estadoLabel(ctx.ubicacion))}</b>`
      : `<b>${esc(modeloLabel(ctx.modeloId))}</b>`;

    const pie = it.soloLectura
      ? `<button class="btn btn-ghost" onclick="AsistenteImportar._volver()">← Atrás</button>
         <button class="btn btn-primary" onclick="AsistenteImportar._continuarComoConteo()">
           Continuar como conteo →</button>`
      : `<button class="btn btn-ghost" onclick="AsistenteImportar._volver()">← Atrás</button>
         <button class="btn btn-primary" onclick="AsistenteImportar._aplicar()">
           <i data-lucide="check"></i> Aplicar</button>`;

    cuerpo(`
      <p style="margin:0 0 4px; font-size:13px;">
        ${titulo} · ${items.length} seriales de ${esc(ctx.origen)}
      </p>
      <p style="margin:0 0 8px; font-size:12.5px; color:var(--fg-3);">${resumen || 'sin cambios'}</p>
      ${avisos.length ? `<p style="margin:0 0 8px; font-size:12.5px; color:#b45309;">${avisos.join(' · ')}.</p>` : ''}
      ${ctx.diff.patron.patron ? `<p style="margin:0 0 8px; font-size:12px; color:var(--fg-3);">
        Forma de la serie: ${esc(SerialPatron.describirPatron(ctx.diff.patron.patron))}.</p>` : ''}
      ${it.soloLectura ? `<p style="margin:0 0 8px; font-size:12.5px; color:#15803d;">
        <i data-lucide="shield-check" style="width:13px;height:13px;vertical-align:-2px;"></i>
        Modo revisión: no se va a escribir nada.</p>` : ''}
      <div style="max-height:44vh; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm);">
        <table class="app-table compact" style="margin:0;">
          <thead><tr><th>Serial</th><th>Qué va a pasar</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      ${bloqueConteo(nActivos)}`, pie);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function chip(i, accion, texto) {
    const on = ctx.items[i].acciones?.[accion];
    return `<label style="font-size:12px; display:inline-flex; align-items:center; gap:4px; cursor:pointer;
             border:1px solid var(--border); border-radius:999px; padding:1px 8px;">
      <input type="checkbox" ${on ? 'checked' : ''}
        onchange="AsistenteImportar._toggle(${i}, '${accion}', this.checked)"> ${esc(texto)}</label>`;
  }

  function _toggle(i, accion, on) {
    ctx.items[i].acciones[accion] = on;
    // El bloque del conteo cuenta las reclasificaciones marcadas: si cambian,
    // los números de arriba tienen que cambiar con ellas.
    if (intencion().conteo === 'mover') paso2();
  }

  function _corregirSerial(i) {
    const it = ctx.items[i];
    if (!it.sospecha?.sugerencia) return;
    it.norm = it.sospecha.sugerencia;
    it.crudo = it.sospecha.sugerencia;
    it.sospecha = null;
    toast('Serial corregido. Vuelve a revisar para cruzarlo contra el inventario.', 'warn');
    _revisar();
  }

  function _excluir(i) {
    ctx.items[i].excluido = true;
    Object.keys(ctx.items[i].acciones || {}).forEach(k => { ctx.items[i].acciones[k] = false; });
    paso2();
  }

  function _volver() { paso1(); }

  // Del modo revisión al de escritura sin volver a cargar el archivo.
  function _continuarComoConteo() {
    ctx.intencion = 'conteo';
    _revisar();
  }

  // ── Paso 3: aplicar ─────────────────────────────────────────────────────

  async function _aplicar() {
    const it = intencion();
    if (it.soloLectura) return;
    const user = ctx.opts.user || firebase.auth().currentUser;
    const activos = ctx.items.filter(x => !x.excluido);
    const env = entorno(null);

    // Se leen ANTES de repintar el cuerpo: el paso 3 borra las casillas.
    const fijarConteo = document.getElementById('aiFijarConteo')?.checked;
    const restarOrigen = document.getElementById('aiRestarOrigen')?.checked;
    const sumarDestino = document.getElementById('aiSumarDestino')?.checked;

    ctx.busy = true;
    cuerpo(`<p style="color:var(--fg-3);">Aplicando…</p>
      <div style="height:6px; background:var(--bg-2); border-radius:3px; overflow:hidden; margin-top:8px;">
        <div id="aiBarra" style="height:100%; width:0; background:var(--accent); transition:width .15s;"></div>
      </div>
      <p id="aiProgreso" style="font-size:12px; color:var(--fg-3); margin:6px 0 0;"></p>`, '');

    let r = { errores: [] };
    let conteoTxt = '';
    try {
      r = await it.aplicar(activos, env, user);
      r.errores = r.errores || [];

      if (it.conteo === 'fijar' && fijarConteo) {
        try {
          await InventarioService.guardarInventario([{ modeloId: ctx.modeloId, cantidad: activos.length }]);
          conteoTxt = `conteo físico de ${modeloLabel(ctx.modeloId)} fijado en ${activos.length}`;
        } catch (e) { r.errores.push(`conteo físico: ${e.message || e}`); }
      }
      if (it.conteo === 'mover' && (restarOrigen || sumarDestino) && r.modelo) {
        try {
          const movs = await InventarioService.moverConteo({
            desde: ctx.modeloOrigenId, hacia: ctx.modeloId, cantidad: r.modelo,
            restarOrigen: !!restarOrigen, sumarDestino: !!sumarDestino,
          });
          if (movs.length) {
            conteoTxt = 'conteo físico actualizado: '
              + movs.map(m => `${modeloLabel(m.modeloId)} → ${m.cantidad}`).join(' · ');
          }
        } catch (e) { r.errores.push(`conteo físico: ${e.message || e}`); }
      }
    } catch (e) {
      r.errores = (r.errores || []).concat([e.message || String(e)]);
    } finally {
      ctx.busy = false;
    }

    paso3(r, conteoTxt);
    if (typeof ctx.opts.onDone === 'function') {
      try { ctx.opts.onDone(r); } catch (e) { console.error('onDone del importador falló:', e); }
    }
  }

  function paso3(r, conteoTxt) {
    const it = intencion();
    const linea = (n, txt) => n ? `<li>${n} ${esc(txt)}</li>` : '';
    const hayError = r.errores.length > 0;
    const lineas = (it.resumen ? it.resumen(r) : []).map(([n, t]) => linea(n, t)).join('');
    cuerpo(`
      <p style="font-weight:600; margin:0 0 8px;">
        ${hayError ? 'Aplicado con avisos' : 'Listo'} — ${esc(it.titulo)}
      </p>
      <ul style="margin:0 0 10px 18px; font-size:13px;">
        ${lineas}
        ${conteoTxt ? `<li>${esc(conteoTxt)}</li>` : ''}
      </ul>
      ${hayError ? `<div style="border:1px solid #fecaca; background:#fef2f2; color:#991b1b;
          border-radius:var(--radius-sm); padding:8px; font-size:12.5px; max-height:22vh; overflow:auto;">
          <b>No se pudo con:</b><br>${r.errores.map(e => esc(e)).join('<br>')}</div>` : ''}`,
      `<button class="btn btn-primary" data-action="cerrar">Cerrar</button>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Overlay (mismo patrón que asistente-recibir) ────────────────────────

  function render() {
    document.getElementById('asistenteImportarOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'asistenteImportarOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:720px; width:min(720px, 96vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;">
            <i data-lucide="file-spreadsheet"></i> Asistente de bodega</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" id="aiCuerpo" style="padding:14px 10px;"></div>
        <div class="footer" id="aiPie" style="display:flex; justify-content:flex-end; gap:8px;"></div>
      </div>`;
    const kb = (e) => { if (e.key === 'Escape') cerrar(); };
    ctx.kb = kb;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-action="cerrar"]')) cerrar();
    });
    document.addEventListener('keydown', kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    ctx.el = overlay;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cuerpo(html, pie) {
    const c = document.getElementById('aiCuerpo');
    const p = document.getElementById('aiPie');
    if (c) c.innerHTML = html;
    if (p && pie !== undefined) p.innerHTML = pie;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cerrar() {
    if (ctx.busy || !ctx.el) return;
    ctx.el.remove();
    ctx.el = null;
    document.body.style.overflow = '';
    if (ctx.kb) { document.removeEventListener('keydown', ctx.kb); ctx.kb = null; }
  }

  return { abrir, _setIntencion, _setModelo, _setUbicacion, _setNota, _setColSerial,
           _usarPegado, _revisar, _toggle, _corregirSerial, _excluir, _volver,
           _volverPaso0, _continuarComoConteo, _aplicar,
           _parsearCSV: parsearCSV, _detectar: detectarColumnas,
           _pareceSerial: pareceSerial, _intenciones: INTENCIONES, _ctx: ctx };
})();
