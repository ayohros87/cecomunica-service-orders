// Recorrido 06: login (mensajes, "mantener sesión"), "Ver como" del admin, perfil.
import { abrir, USUARIOS } from 'file:///C:/Projects/cecomunica-service-orders/tools/emulador-almacen/emu-lib.mjs';
// 1) Login con cuenta inexistente: el parche intenta el login y falla → vemos la página de login y probamos el formulario.
{
  const s = await abrir({ email: 'nadie@cecomunica.com', viewport: 'escritorio', carpeta: 'home-nav' });
  const info = await s.ir('/login.html', { esperar: 800 });
  const d = await s.page.evaluate(() => ({ remember: document.getElementById('remember')?.checked, msg: document.getElementById('msg')?.style.display, titulo: document.querySelector('.auth-card h2')?.innerText }));
  console.log('login.html:', info.msTotal, 'ms', JSON.stringify(d), '| errores:', s.errores.slice(0, 3));
  await s.captura('50-login-escritorio');
  await s.page.type('#email', USUARIOS.recepcion); await s.page.type('#password', 'malaclave');
  await s.page.click('#btnLogin'); await s.quieto(800, 6000);
  console.log('clave mala →', await s.texto('#msg'));
  await s.captura('51-login-escritorio-clave-mala');
  // ¿motivo=?
  await s.ir('/login.html?motivo=sesion', { esperar: 500 });
  console.log('?motivo=sesion →', await s.texto('#msg'));
  // deep-link sin sesión: ¿a dónde manda?
  await s.page.goto('http://127.0.0.1:5000/ordenes/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3500));
  console.log('abrir /ordenes/ sin sesión →', await s.page.evaluate(() => location.pathname + location.search));
  await s.cerrar();
}
// 2) Ver como (admin)
{
  const s = await abrir({ email: USUARIOS.admin, viewport: 'escritorio', carpeta: 'home-nav' });
  await s.ir('/admin/index.html', { esperar: 1200 });
  await s.page.click('#launcherVerComo').catch(e => console.log('click ver como falló', e.message));
  await s.quieto(600, 4000);
  const modal = await s.page.evaluate(() => { const m = document.querySelector('.modal-backdrop.open, .cc-sheet.is-open, [role=dialog]'); return m ? m.innerText.replace(/\s+/g, ' ').slice(0, 300) : null; });
  console.log('Ver como abre:', !!modal, '|', modal);
  await s.captura('52-admin-escritorio-ver-como-picker');
  await s.ir('/index.html?as=recepcion', { esperar: 1500 });
  await s.page.waitForFunction(() => !document.querySelector('.kpi.is-loading'), { timeout: 15000 }).catch(() => {});
  const d = await s.page.evaluate(() => ({ banner: document.getElementById('impersonateBanner')?.innerText.replace(/\s+/g, ' ').trim(), senales: [...document.querySelectorAll('[data-signal]')].map(e => e.dataset.signal + '=' + e.querySelector('.kpi__val')?.innerText), tarjetas: [...document.querySelectorAll('#gridModulos .mcard[data-visible="true"]')].map(e => e.querySelector('.mcard__t').innerText), rail: [...document.querySelectorAll('#ccRail .rail__link .rail__txt')].map(e => e.innerText), pie: document.querySelector('.rail__who')?.innerText.replace(/\s+/g, ' ') }));
  console.log('home ?as=recepcion →', JSON.stringify(d));
  await s.captura('53-admin-escritorio-ver-como-recepcion', { full: true });
  // ¿se conserva al navegar?
  await s.page.click('#ccRail a[href="/ordenes/index.html"]').catch(() => {});
  await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  await s.quieto(1000, 10000);
  const d2 = await s.page.evaluate(() => ({ url: location.pathname + location.search, rail: [...document.querySelectorAll('#ccRail .rail__link .rail__txt')].map(e => e.innerText).join(','), pie: document.querySelector('.rail__who')?.innerText.replace(/\s+/g, ' '), btnNueva: !!document.querySelector('#btnNuevaOrden, [data-action="go-nueva-orden"]') }));
  console.log('tras clic en Órdenes desde "Ver como recepción" →', JSON.stringify(d2));
  await s.ir('/index.html?as=contabilidad', { esperar: 1200 });
  console.log('?as=contabilidad →', await s.page.evaluate(() => ({ banner: document.getElementById('impersonateBanner')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 80), senales: document.querySelectorAll('[data-signal]').length, tarjetas: [...document.querySelectorAll('#gridModulos .mcard[data-visible="true"]')].map(e => e.querySelector('.mcard__t').innerText).join(',') })));
  await s.captura('54-admin-escritorio-ver-como-contabilidad');
  // 3) Perfil
  const pi = await s.ir('/perfil.html', { esperar: 1000 });
  console.log('perfil:', pi.msTotal, 'ms', JSON.stringify(await s.page.evaluate(() => ({ nombre: document.getElementById('perfil-nombre').value, rol: document.getElementById('perfil-rol').value, correo: document.getElementById('perfil-correo').value, botones: [...document.querySelectorAll('.app-wrap a.btn, .app-wrap button.btn')].map(b => b.innerText.trim()) }))));
  await s.captura('55-admin-escritorio-perfil');
  const fi = await s.ir('/firma-correo.html', { esperar: 1000 });
  console.log('firma-correo:', fi.msTotal, 'ms', JSON.stringify(await s.page.evaluate(() => ({ nombre: document.getElementById('f-nombre').value, cargo: document.getElementById('f-cargo').value, tel: document.getElementById('f-tel').value, cel: document.getElementById('f-cel').value, email: document.getElementById('f-email').value }))), '| errores:', s.errores.slice(0, 2));
  await s.captura('56-admin-escritorio-firma-correo');
  // Atajos del home: Ctrl+F no navega; g abre Centro
  await s.ir('/index.html', { esperar: 1200 });
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('f'); await s.page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 700));
  console.log('Ctrl+F en el home → url:', await s.page.evaluate(() => location.pathname));
  await s.page.keyboard.press('g');
  await s.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});
  console.log('tecla g en el home → url:', await s.page.evaluate(() => location.pathname));
  await s.cerrar();
}
// 4) Sesión SESSION vs LOCAL: el vendedor con "mantener sesión" desmarcado abriendo un enlace en pestaña nueva (Ctrl+clic) — se documenta desde código (login.html:71 viene marcado por defecto).
