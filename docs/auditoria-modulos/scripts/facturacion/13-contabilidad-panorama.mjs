// Recorrido 13: el Panorama financiero como CONTABILIDAD (la pestaña se le muestra; ¿le carga?).
import { abrir, USUARIOS, j } from './_lib.mjs';
const s = await abrir({ email: USUARIOS.contabilidad, viewport: 'escritorio' });
const info = await s.ir('/admin/financiero.html?volver=finanzas');
await s.espera(1500);
console.log('PANORAMA CONTABILIDAD', j(info));
console.log('KPIS', j(await s.textos('.stat-card .value')));
console.log('TABLA', (await s.texto('#tblDaily')).slice(0, 120).replace(/\n/g, ' | '));
console.log('TOASTS', j(await s.toasts()));
console.log('ERRORES', j(s.errores.slice(0, 4)));
await s.captura('93-contabilidad-escritorio-panorama-permiso-denegado');
// ¿Y el Catálogo · Modelos con la callable caída? (documenta cómo se ve el aviso)
await s.ir('/inventario/modelos.html'); await s.espera(1200);
console.log('MODELOS aviso QBO', j((await s.textos('#qboHint, .qbo-hint, [id*=qbo]')).slice(0, 4)));
await s.captura('94-contabilidad-escritorio-catalogo-modelos');
await s.cerrar();
