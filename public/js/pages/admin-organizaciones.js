// @ts-nocheck
/**
 * admin-organizaciones.js — Administración de organizaciones (matrices) y sus cuentas.
 *
 * Una organización vive en la colección `organizaciones`; sus "cuentas" son docs
 * de `clientes` con `organizacionId` apuntando aquí. Esta vista permite crear,
 * renombrar, fusionar y eliminar organizaciones, y asignar/quitar cuentas.
 * Todo es aditivo: no toca contratos, órdenes ni equipos POC.
 */
(function () {
  'use strict';

  const State = {
    orgs: [],              // [{ id, nombre, ... , _count }]
    filtro: '',
    seleccionada: null,    // { id, nombre } | null
    cuentas: [],           // cuentas de la org seleccionada
    mergeSel: new Set(),   // ids de orgs marcadas para fusionar
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Carga ───────────────────────────────────────────────────────────
  async function cargarOrgs() {
    try {
      const orgs = await OrganizacionesService.getAllOrgs();
      // Conteo de cuentas en paralelo (las organizaciones suelen ser pocas).
      await Promise.all(orgs.map(async o => {
        try { o._count = (await OrganizacionesService.listCuentas(o.id)).length; }
        catch { o._count = 0; }
      }));
      State.orgs = orgs;
      renderList();
    } catch (e) {
      console.error('Error cargando organizaciones:', e);
      $('ogList').innerHTML = `<div style="padding:14px; color:var(--fg-3); font-size:13px;">Error al cargar organizaciones.</div>`;
    }
  }

  function renderList() {
    const cont = $('ogList');
    const needle = State.filtro ? FMT.normalize(State.filtro) : '';
    let vis = State.orgs;
    if (needle) vis = State.orgs.filter(o => FMT.normalize(o.nombre).includes(needle));
    $('ogResumen').textContent = `${vis.length} organización(es)`;
    if (!vis.length) {
      cont.innerHTML = `<div style="padding:14px; color:var(--fg-3); font-size:13px;">Sin organizaciones. Crea una arriba.</div>`;
      actualizarBotonMerge();
      return;
    }
    cont.innerHTML = vis.map(o => {
      const active = State.seleccionada && State.seleccionada.id === o.id ? 'active' : '';
      const checked = State.mergeSel.has(o.id) ? 'checked' : '';
      return `<div class="og-item ${active}" data-id="${esc(o.id)}">
          <input type="checkbox" class="og-check" data-id="${esc(o.id)}" ${checked} title="Marcar para fusionar">
          <span class="og-name">${esc(o.nombre)}</span>
          <span class="count">${o._count || 0}</span>
        </div>`;
    }).join('');

    cont.querySelectorAll('.og-check').forEach(chk => {
      chk.addEventListener('click', e => e.stopPropagation());
      chk.addEventListener('change', () => {
        if (chk.checked) State.mergeSel.add(chk.dataset.id);
        else State.mergeSel.delete(chk.dataset.id);
        actualizarBotonMerge();
      });
    });
    cont.querySelectorAll('.og-item').forEach(el => {
      el.addEventListener('click', () => {
        const o = State.orgs.find(x => x.id === el.dataset.id);
        if (o) seleccionarOrg(o);
      });
    });
    actualizarBotonMerge();
  }

  function actualizarBotonMerge() {
    const btn = $('btnOgMerge');
    btn.disabled = State.mergeSel.size < 2;
  }

  // ── Detalle ─────────────────────────────────────────────────────────
  async function seleccionarOrg(o) {
    State.seleccionada = { id: o.id, nombre: o.nombre };
    renderList();
    $('ogDetalle').innerHTML = `<div style="padding:24px; text-align:center; color:var(--fg-3); font-size:13px;">Cargando cuentas…</div>`;
    try {
      const fresh = await OrganizacionesService.getOrg(o.id);
      State.org = fresh || o;
      State.cuentas = await OrganizacionesService.listCuentas(o.id);
      renderDetalle();
    } catch (e) {
      console.error('Error cargando cuentas:', e);
      Toast.show('No se pudieron cargar las cuentas.', 'bad');
    }
  }

  function renderDetalle() {
    const o = State.org;
    if (!o) return;
    const cuentas = State.cuentas;
    const filas = cuentas.length
      ? cuentas.map(c => `
          <div class="og-cuenta-row" data-id="${esc(c.id)}">
            <div>
              <strong>${esc(c.nombre || 'Sin nombre')}</strong>
              <div class="og-cuenta-meta">${c.ruc ? 'RUC ' + esc(c.ruc) : 'Sin RUC'}</div>
            </div>
            <button class="btn btn-ghost btn-sm" data-quitar="${esc(c.id)}" title="Quitar de la organización">
              <i data-lucide="user-minus"></i> Quitar
            </button>
          </div>`).join('')
      : `<div style="padding:18px; text-align:center; color:var(--fg-3); font-size:13px;">Esta organización aún no tiene cuentas.</div>`;

    const exento = !!o.itbms_exento;
    $('ogDetalle').innerHTML = `
      <div style="display:flex; align-items:center; gap:var(--sp-2); padding:14px 16px; border-bottom:1px solid var(--border-subtle);">
        <i data-lucide="building-2"></i>
        <strong style="flex:1; font-size:16px;">${esc(o.nombre)}</strong>
        <button class="btn btn-danger-ghost btn-sm" id="btnOgDelete"><i data-lucide="trash-2"></i> Eliminar</button>
      </div>

      <div style="padding:14px 16px; border-bottom:1px solid var(--border-subtle);">
        <div class="ts" style="margin-bottom:10px;">
          <i data-lucide="receipt"></i> Ficha fiscal de la entidad — se sincroniza a sus ${cuentas.length} cuenta(s).
        </div>
        <div class="form-grid-2">
          <div class="form-field" style="grid-column:1/-1">
            <label class="form-label" for="ogfNombre">Razón social <span class="req">*</span></label>
            <input class="form-input" type="text" id="ogfNombre" value="${esc(o.nombre || '')}">
          </div>
          <div class="form-field">
            <label class="form-label" for="ogfRuc">RUC</label>
            <input class="form-input" type="text" id="ogfRuc" value="${esc(o.ruc || '')}" style="font-family:var(--font-mono);">
          </div>
          <div class="form-field">
            <label class="form-label" for="ogfDv">DV</label>
            <input class="form-input" type="text" id="ogfDv" value="${esc(o.dv || '')}" maxlength="2" style="font-family:var(--font-mono);">
          </div>
          <div class="form-field">
            <label class="form-label" for="ogfRep">Representante legal</label>
            <input class="form-input" type="text" id="ogfRep" value="${esc(o.representante || '')}">
          </div>
          <div class="form-field">
            <label class="form-label" for="ogfCed">Cédula del representante</label>
            <input class="form-input" type="text" id="ogfCed" value="${esc(o.representante_cedula || '')}" style="font-family:var(--font-mono);">
          </div>
          <div class="form-field">
            <label class="form-label" for="ogfItbms">ITBMS</label>
            <select class="form-select" id="ogfItbms">
              <option value="false" ${!exento ? 'selected' : ''}>Paga ITBMS (7%)</option>
              <option value="true" ${exento ? 'selected' : ''}>Exento</option>
            </select>
          </div>
          <div class="form-field" id="ogfMotivoWrap" style="${exento ? '' : 'display:none;'}">
            <label class="form-label" for="ogfMotivo">Motivo de exención</label>
            <input class="form-input" type="text" id="ogfMotivo" value="${esc(o.itbms_motivo_exencion || '')}">
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:var(--sp-2); margin-top:10px;">
          <button class="btn btn-primary btn-sm" id="btnOgGuardarFiscal"><i data-lucide="save"></i> Guardar ficha fiscal</button>
          <span class="ts">Al guardar se reescribe la ficha en todas las cuentas de la organización.</span>
        </div>
      </div>

      <div style="padding:12px 16px; border-bottom:1px solid var(--border-subtle);">
        <label class="form-label" for="ogAssignInput">Agregar cuenta existente</label>
        <div class="og-assign">
          <input id="ogAssignInput" class="form-input" type="text" placeholder="Buscar cliente por nombre…" autocomplete="off">
          <div id="ogAssignMenu" class="og-assign-menu" hidden></div>
        </div>
      </div>

      <div id="ogCuentas">${filas}</div>`;

    if (typeof lucide !== 'undefined') lucide.createIcons();

    $('btnOgDelete').addEventListener('click', eliminar);
    $('btnOgGuardarFiscal').addEventListener('click', guardarFichaFiscal);
    $('ogfItbms').addEventListener('change', () => {
      $('ogfMotivoWrap').style.display = ($('ogfItbms').value === 'true') ? '' : 'none';
    });
    $('ogCuentas').querySelectorAll('[data-quitar]').forEach(b => {
      b.addEventListener('click', () => quitarCuenta(b.dataset.quitar));
    });
    bindAssign();
  }

  // ── Asignar cuenta (buscar clientes) ────────────────────────────────
  function bindAssign() {
    const input = $('ogAssignInput');
    const menu = $('ogAssignMenu');
    let t = null;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const term = input.value.trim();
      if (!term) { menu.hidden = true; menu.innerHTML = ''; return; }
      t = setTimeout(async () => {
        try {
          const res = await ClientesService.searchByToken(ClientesService.norm(term), { limit: 8 });
          const yaEnOrg = new Set(State.cuentas.map(c => c.id));
          const opts = res.filter(c => !yaEnOrg.has(c.id));
          menu.innerHTML = opts.length
            ? opts.map(c => `<div class="og-assign-opt" data-id="${esc(c.id)}" data-nombre="${esc(c.nombre)}">
                ${esc(c.nombre)} ${c.organizacionId ? `<span class="og-cuenta-meta">(en ${esc(c.organizacion_nombre || 'otra org')})</span>` : ''}
              </div>`).join('')
            : `<div class="og-assign-opt" style="cursor:default; color:var(--fg-3);">Sin coincidencias.</div>`;
          menu.hidden = false;
          menu.querySelectorAll('.og-assign-opt[data-id]').forEach(el => {
            el.addEventListener('mousedown', e => {
              e.preventDefault();
              asignarCuenta(el.dataset.id, el.dataset.nombre);
            });
          });
        } catch (e) { console.error(e); }
      }, 280);
    });
    input.addEventListener('blur', () => setTimeout(() => { menu.hidden = true; }, 150));
  }

  // ── Acciones ────────────────────────────────────────────────────────
  async function crearOrg() {
    const inp = $('ogNuevoNombre');
    const nombre = (inp.value || '').trim();
    if (!nombre) { Toast.show('Escribe un nombre.', 'warn'); return; }
    try {
      const norm = OrganizacionesService.norm(nombre);
      if (await OrganizacionesService.existsActiveByNorm('nombre_norm', norm)) {
        Toast.show('Ya existe una organización con ese nombre.', 'warn'); return;
      }
      const user = firebase.auth().currentUser;
      const payload = OrganizacionesService.buildOrgPayload({ nombre }, { user, isCreate: true });
      await OrganizacionesService.createOrg(payload);
      inp.value = '';
      Toast.show(`Organización “${nombre}” creada ✅`, 'ok');
      await cargarOrgs();
    } catch (e) {
      console.error('Error creando organización:', e);
      Toast.show('No se pudo crear la organización.', 'bad');
    }
  }

  async function guardarFichaFiscal() {
    const o = State.org;
    const raw = {
      nombre: $('ogfNombre').value,
      ruc: $('ogfRuc').value,
      dv: $('ogfDv').value,
      representante: $('ogfRep').value,
      representante_cedula: $('ogfCed').value,
      itbms_exento: $('ogfItbms').value === 'true',
      itbms_motivo_exencion: $('ogfMotivo') ? $('ogfMotivo').value : '',
    };
    if (!raw.nombre.trim()) { Toast.show('La razón social es obligatoria.', 'warn'); return; }
    try {
      const { affected } = await OrganizacionesService.actualizarFichaFiscal(o.id, raw);
      Toast.show(`Ficha guardada — ${affected} cuenta(s) sincronizada(s) ✅`, 'ok');
      await cargarOrgs();
      await seleccionarOrg({ id: o.id, nombre: raw.nombre.trim() });
    } catch (e) {
      console.error('Error guardando ficha fiscal:', e);
      Toast.show('No se pudo guardar la ficha fiscal.', 'bad');
    }
  }

  async function eliminar() {
    const o = State.seleccionada;
    const n = State.cuentas.length;
    if (!confirm(
      `Eliminar la organización “${o.nombre}”?\n\n` +
      `Sus ${n} cuenta(s) quedarán sueltas (no se eliminan clientes).`
    )) return;
    try {
      const { affected } = await OrganizacionesService.eliminarConCuentas(o.id);
      Toast.show(`Organización eliminada — ${affected} cuenta(s) liberada(s) ✅`, 'ok');
      State.seleccionada = null; State.cuentas = [];
      $('ogDetalle').innerHTML = `<div style="padding:24px; text-align:center; color:var(--fg-3); font-size:13px;">Selecciona una organización.</div>`;
      await cargarOrgs();
    } catch (e) {
      console.error('Error eliminando:', e);
      Toast.show('No se pudo eliminar.', 'bad');
    }
  }

  async function asignarCuenta(clienteId, nombre) {
    const o = State.seleccionada;
    try {
      await OrganizacionesService.asignarCuentas(o.id, [clienteId]);
      Toast.show(`“${nombre}” agregada a ${o.nombre} ✅`, 'ok');
      $('ogAssignInput').value = '';
      $('ogAssignMenu').hidden = true;
      await seleccionarOrg(o);
      await cargarOrgs();
    } catch (e) {
      console.error('Error asignando cuenta:', e);
      Toast.show('No se pudo agregar la cuenta.', 'bad');
    }
  }

  async function quitarCuenta(clienteId) {
    const o = State.seleccionada;
    if (!confirm('¿Quitar esta cuenta de la organización? El cliente no se elimina.')) return;
    try {
      await OrganizacionesService.quitarCuentas([clienteId]);
      Toast.show('Cuenta quitada ✅', 'ok');
      await seleccionarOrg(o);
      await cargarOrgs();
    } catch (e) {
      console.error('Error quitando cuenta:', e);
      Toast.show('No se pudo quitar la cuenta.', 'bad');
    }
  }

  async function fusionar() {
    const ids = Array.from(State.mergeSel);
    if (ids.length < 2) return;
    const nombres = ids.map(id => (State.orgs.find(o => o.id === id) || {}).nombre || id);
    const target = prompt(
      `Fusionar estas organizaciones en una sola:\n\n${nombres.map(n => '• ' + n).join('\n')}\n\n` +
      `Escribe el nombre EXACTO de la que quedará como destino:`,
      nombres[0]
    );
    if (target === null) return;
    const targetNorm = OrganizacionesService.norm(target.trim());
    const targetOrg = State.orgs.find(o => OrganizacionesService.norm(o.nombre) === targetNorm && ids.includes(o.id));
    if (!targetOrg) { Toast.show('El destino debe ser una de las seleccionadas.', 'warn'); return; }
    const sources = ids.filter(id => id !== targetOrg.id);
    if (!confirm(`Fusionar ${sources.length} organización(es) en “${targetOrg.nombre}”? Las demás se eliminarán.`)) return;
    try {
      const { affected } = await OrganizacionesService.fusionar(sources, targetOrg.id);
      Toast.show(`Fusionadas — ${affected} cuenta(s) reasignada(s) ✅`, 'ok');
      State.mergeSel.clear();
      await cargarOrgs();
      await seleccionarOrg({ id: targetOrg.id, nombre: targetOrg.nombre });
    } catch (e) {
      console.error('Error fusionando:', e);
      Toast.show('No se pudieron fusionar.', 'bad');
    }
  }

  // ── Init ────────────────────────────────────────────────────────────
  function bindUI() {
    $('ogSearch').addEventListener('input', e => { State.filtro = e.target.value || ''; renderList(); });
    $('btnOgCrear').addEventListener('click', crearOrg);
    $('ogNuevoNombre').addEventListener('keydown', e => { if (e.key === 'Enter') crearOrg(); });
    $('btnOgMerge').addEventListener('click', fusionar);
  }

  document.addEventListener('DOMContentLoaded', bindUI);

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '../login.html'; return; }
    try {
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;
      if (![ROLES.ADMIN].includes(rol)) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        window.location.href = 'index.html';
        return;
      }
      await cargarOrgs();
    } catch (e) {
      console.error('Error inicializando admin/organizaciones:', e);
      window.location.href = 'index.html';
    }
  });
})();
