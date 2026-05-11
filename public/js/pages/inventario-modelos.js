// @ts-nocheck
    /* ===== Estado global ===== */
    let showInactivos = true;
    let listaModelos = [];
    let modeloEditId = null;
    let ordenCampo = 'marca';
    let ordenAsc = true;
    let dense = false;
    const hiddenCols = new Set(); // 'estado' | 'alto' | 'minimo' | 'activo'

    /* ===== Util ===== */
    function debounce(fn, t=220){ let id; return (...a)=>{ clearTimeout(id); id=setTimeout(()=>fn(...a),t); } }
    function mapTipo(v){ return v==='P'?'Portátil':v==='B'?'Base':v==='C'?'Cámara':'-'; }
    function mapEstado(v){ return v==='N'?'Nuevo':v==='R'?'Reuso':'-'; }

    /* ===== Densidad & columnas ===== */
    function applyDensity(){ document.getElementById('wrapTabla')?.setAttribute('data-density', dense ? 'dense' : 'roomy'); }
    function toggleDensity(){ dense=!dense; applyDensity(); Toast.show(dense?'Vista compacta':'Vista cómoda','ok'); }
    function toggleCol(key, visible){ if(!visible) hiddenCols.add(key); else hiddenCols.delete(key); applyColumnVisibility(); }
    function applyColumnVisibility(){
      const map = { estado: '.col-estado', alto: '.col-alto', minimo: '.col-minimo', activo: '.col-activo' };
      Object.entries(map).forEach(([k, sel])=>{
        const hide = hiddenCols.has(k);
        document.querySelectorAll(sel).forEach(el=>{ el.classList.toggle('hidden-col', hide); });
      });
    }

    /* ===== Auth ===== */
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return window.location.href = "../login.html";
      try{
        const userDoc = await UsuariosService.getUsuario(user.uid);
        const rol = userDoc ? userDoc.rol : null;
        if (!userDoc || (rol !== "administrador" && rol !== "inventario")) {
          document.body.innerHTML = "<h3 style='color:red; text-align:center; margin-top:100px;'>Acceso restringido</h3>";
          return;
        }

        // Dropdown por click
        const dd = document.getElementById('ddVista');
        if (dd){
          const btn = document.getElementById('btnVista');
          btn.addEventListener('click',(ev)=>{ ev.stopPropagation(); dd.classList.toggle('open'); });
          document.addEventListener('click',()=>dd.classList.remove('open'));
        }

        // Listeners de checkboxes de vista (delegado)
        document.addEventListener('change', (e)=>{
          if (e.target.id === 'col-CHK-estado'){ toggleCol('estado', e.target.checked); }
          if (e.target.id === 'col-CHK-alto'){ toggleCol('alto', e.target.checked); }
          if (e.target.id === 'col-CHK-minimo'){ toggleCol('minimo', e.target.checked); }
          if (e.target.id === 'col-CHK-activo'){ toggleCol('activo', e.target.checked); }
          if (e.target.id === 'chk-inactivos'){ showInactivos = e.target.checked; renderizarTablaModelos(listaModelos); }
        });

        // Buscador
        const q = document.getElementById('q');
        if (q){
          q.addEventListener('input', debounce(aplicarFiltroRapido, 220));
          q.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); aplicarFiltroRapido(); }});
        }

        await cargarModelos();
      }catch(e){
        console.error(e); Toast.show('Error validando usuario','bad');
      }
    });

    /* ===== Carga ===== */
    async function cargarModelos(){
      showSkeleton();
      try{
        listaModelos = await ModelosService.getModelos();
      }catch(e){
        console.error(e); Toast.show('Error cargando modelos','bad'); listaModelos=[];
      }
      renderizarTablaModelos(listaModelos);
      actualizarResumen(listaModelos);
    }

    function showSkeleton(){
      const tb = document.getElementById('tablaModelos');
      tb.innerHTML = `
        <tr>
          <td colspan="8" style="padding:20px;">
            <div class="skeleton" style="width:60%; height:12px; margin-bottom:8px;"></div>
            <div class="skeleton" style="width:40%; height:12px;"></div>
          </td>
        </tr>`;
    }

    /* ===== Render ===== */
    function actualizarResumen(lista){
      const total = (lista||[]).length;
      const inact = (lista||[]).filter(m=>m.activo===false).length;
      const altos = (lista||[]).filter(m=>m.alto_movimiento===true).length;
      document.getElementById('resumenModelos').innerHTML =
        `<strong>${total}</strong> modelos · inactivos: <strong>${inact}</strong> · alto mov.: <span class="badge completo">${altos}</span>`;
    }

    function ordenarPor(campo){
      if (ordenCampo === campo) ordenAsc = !ordenAsc;
      else { ordenCampo = campo; ordenAsc = true; }
      renderizarTablaModelos(listaModelos);
    }

    function valorOrden(m, campo){
      if (campo==='marca' || campo==='modelo'){ return (m[campo]||'').toLowerCase(); }
      if (campo==='tipo'){ return m.tipo||''; }
      if (campo==='estado'){ return m.estado||''; }
      if (campo==='alto_movimiento'){ return m.alto_movimiento===true?1:0; }
      if (campo==='minimo'){ return Number.isFinite(m.minimo)?m.minimo:0; }
      if (campo==='activo'){ return m.activo===false?0:1; }
      return '';
    }

    function renderizarTablaModelos(lista){
      const thead = document.getElementById('headerModelos');
      const tbody = document.getElementById('tablaModelos');

      const cols = [
        { campo:'marca', label:'Marca' },
        { campo:'modelo', label:'Modelo' },
        { campo:'tipo', label:'Tipo' },
        { campo:'estado', label:'Estado', cls:'col-estado' },
        { campo:'alto_movimiento', label:'Alto mov.', cls:'col-alto' },
        { campo:'minimo', label:'Mínimo', cls:'col-minimo' },
        { campo:'activo', label:'Activo', cls:'col-activo' }
      ];

      thead.innerHTML = `
        <tr>
          ${cols.map(c=>{
            const isCurr = c.campo === ordenCampo;
            const arrow = isCurr ? (ordenAsc ? '↑' : '↓') : '↕';
            return `<th data-sort="${c.campo}" class="${c.cls||''}" onclick="ordenarPor('${c.campo}')">${c.label} <span class="sort">${arrow}</span></th>`;
          }).join('')}
          <th>Acciones</th>
        </tr>`;

      // Filtro “mostrar inactivos”
      const data = (lista||[]).filter(m => showInactivos ? true : (m.activo !== false));

      // Orden
      data.sort((a,b)=>{
        const va = valorOrden(a, ordenCampo), vb = valorOrden(b, ordenCampo);
        if (typeof va==='number' && typeof vb==='number') return ordenAsc ? va - vb : vb - va;
        return ordenAsc
          ? String(va).localeCompare(String(vb), 'es', {numeric:true, sensitivity:'base'})
          : String(vb).localeCompare(String(va), 'es', {numeric:true, sensitivity:'base'});
      });

      if (data.length===0){
        tbody.innerHTML = `<tr><td colspan="8" style="padding:20px; text-align:center; color:#666;">No hay modelos</td></tr>`;
        applyColumnVisibility(); applyDensity(); return;
      }

      tbody.innerHTML = data.map(m=>{
        const minimo = Number.isFinite(m.minimo) ? m.minimo : 0;
        const activoTxt = (m.activo!==false) ? 'Sí' : 'No';
        return `
          <tr class="${m.activo===false ? 'inactivo' : ''}">
            <td>${m.marca||'-'}</td>
            <td>${m.modelo||'-'}</td>
            <td>${mapTipo(m.tipo)}</td>
            <td class="col-estado">${mapEstado(m.estado)}</td>
            <td class="col-alto" style="text-align:center">${m.alto_movimiento ? '✅' : '❌'}</td>
            <td class="col-minimo mono" style="text-align:right">${minimo}</td>
            <td class="col-activo" style="text-align:center">${activoTxt}</td>
            <td>
              <div class="table-actions">
                <button class="btn sm" onclick="abrirModal('${m.id}')">✏️ Editar</button>
                ${m.activo===false
                  ? `<button class="btn sm" onclick="activarModelo('${m.id}')">Activar</button>`
                  : `<button class="btn sm" onclick="desactivarModelo('${m.id}')">Desactivar</button>`}
                <button class="btn sm danger" onclick="eliminarDefinitivo('${m.id}')">🗑️ Borrar</button>
              </div>
            </td>
          </tr>`;
      }).join('');

      applyColumnVisibility(); applyDensity();
    }

    /* ===== Filtro rápido ===== */
    function aplicarFiltroRapido(){
      const q=(document.getElementById('q')?.value||'').toLowerCase().trim();
      if(!q){ renderizarTablaModelos(listaModelos); actualizarResumen(listaModelos); return; }
      const filtrados = (listaModelos||[]).filter(m=>{
        const marca=(m.marca||'').toLowerCase();
        const mod=(m.modelo||'').toLowerCase();
        const tipo=(mapTipo(m.tipo)||'').toLowerCase();
        return marca.includes(q)||mod.includes(q)||tipo.includes(q);
      });
      renderizarTablaModelos(filtrados); actualizarResumen(filtrados);
    }

    /* ===== Modal ===== */
    function abrirModal(id=null){
      modeloEditId = id;
      const creando = (id===null);
      document.getElementById('modalTitle').textContent = creando ? 'Nuevo modelo' : 'Editar modelo';

      // reset
      setVal('f-marca',''); setVal('f-modelo','');
      document.getElementById('f-tipo').value='P';
      document.getElementById('f-estado').value='N';
      setVal('f-minimo','5');
      document.getElementById('f-alto').checked=false;
      document.getElementById('f-activo').checked=true;
      setVal('f-notas','');

      if(!creando){
        const m = listaModelos.find(x=>x.id===id);
        if (m){
          setVal('f-marca', m.marca||'');
          setVal('f-modelo', m.modelo||'');
          document.getElementById('f-tipo').value = m.tipo||'P';
          document.getElementById('f-estado').value = m.estado||'N';
          setVal('f-minimo', Number.isFinite(m.minimo)?m.minimo:5);
          document.getElementById('f-alto').checked = m.alto_movimiento===true;
          document.getElementById('f-activo').checked = m.activo!==false;
          setVal('f-notas', m.notas||'');
        }
      }
      document.getElementById('overlay').classList.add('show');
    }
    function cerrarModal(){ document.getElementById('overlay').classList.remove('show'); modeloEditId=null; }
    function setVal(id,v){ const el=document.getElementById(id); if(el) el.value=v; }

    async function guardarModelo(){
      const marca=(document.getElementById('f-marca').value||'').trim();
      const modelo=(document.getElementById('f-modelo').value||'').trim();
      const tipo=document.getElementById('f-tipo').value;
      const estado=document.getElementById('f-estado').value;
      const minimo=Math.max(0, Number(document.getElementById('f-minimo').value||0));
      const alto=document.getElementById('f-alto').checked;
      const activo=document.getElementById('f-activo').checked;
      const notas=(document.getElementById('f-notas').value||'').trim();

      if(!marca || !modelo){ Toast.show('Marca y Modelo son requeridos','warn'); return; }

      const payload = {
        marca, modelo, tipo, estado, minimo,
        alto_movimiento: alto, activo, notas,
        actualizado_en: firebase.firestore.FieldValue.serverTimestamp()
      };

      try{
        if (modeloEditId===null){
          await ModelosService.addModelo(payload);
          Toast.show('Modelo creado','ok');
        } else {
          await ModelosService.updateModelo(modeloEditId, payload);
          Toast.show('Modelo actualizado','ok');
        }
        cerrarModal();
        await cargarModelos();
      }catch(e){ console.error(e); Toast.show('Error al guardar','bad'); }
    }

    /* ===== Acciones estado ===== */
    async function desactivarModelo(id){
      try{
        await ModelosService.setActivo(id, false);
        Toast.show('Modelo desactivado','ok'); await cargarModelos();
      }catch(e){ console.error(e); Toast.show('Error','bad');}
    }
    async function activarModelo(id){
      try{
        await ModelosService.setActivo(id, true);
        Toast.show('Modelo activado','ok'); await cargarModelos();
      }catch(e){ console.error(e); Toast.show('Error','bad');}
    }
    async function eliminarDefinitivo(id){
      if(!confirm('¿Eliminar definitivamente este modelo? (borra solo el documento del modelo)')) return;
      try{
        await ModelosService.deleteModelo(id);
        Toast.show('Modelo eliminado','ok'); await cargarModelos();
      }catch(e){ console.error(e); Toast.show('Error al eliminar','bad');}
    }

    /* ===== Exportar Excel ===== */
    function exportarExcel(){
      const wb = XLSX.utils.book_new();
      const wsData = [["Marca","Modelo","Tipo","Estado","Alto mov.","Mínimo","Activo","Notas"]];
      (listaModelos||[]).forEach(m=>{
        wsData.push([
          m.marca||'-', m.modelo||'-', mapTipo(m.tipo), mapEstado(m.estado),
          m.alto_movimiento?'Sí':'No', Number.isFinite(m.minimo)?m.minimo:0,
          (m.activo!==false)?'Sí':'No', m.notas||''
        ]);
      });
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, "Modelos");
      const fecha = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `Modelos_Cecomunica_${fecha}.xlsx`);
    }

    /* ===== Exponer en window (onclick en HTML) ===== */
    window.toggleDensity = toggleDensity;
    window.ordenarPor = ordenarPor;
    window.aplicarFiltroRapido = aplicarFiltroRapido;
    window.abrirModal = abrirModal;
    window.cerrarModal = cerrarModal;
    window.guardarModelo = guardarModelo;
    window.desactivarModelo = desactivarModelo;
    window.activarModelo = activarModelo;
    window.eliminarDefinitivo = eliminarDefinitivo;
    window.exportarExcel = exportarExcel;

    /* ===== Sesión ===== */
    function cerrarSesion(){ firebase.auth().signOut().then(()=>window.location.href="../login.html"); }
    window.cerrarSesion = cerrarSesion;
