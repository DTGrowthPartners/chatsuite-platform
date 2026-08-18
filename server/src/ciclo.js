// Ciclo de vida de un tenant ya aprovisionado: arrancar, detener, respaldar,
// borrar, y la foto de recursos que el panel muestra arriba.
import fs from 'node:fs';
import path from 'node:path';

import { DIR_BACKUPS } from './config.js';
import { correr } from './provision.js';
import { actualizar, listar, obtener, rutaTenant } from './store.js';

const composeDe = (slug) => path.join(rutaTenant(slug), 'docker-compose.yaml');

export async function arrancar(slug, log) {
  await correr('docker', ['compose', 'up', '-d'], { cwd: rutaTenant(slug), log });
  await actualizar((e) => {
    e.tenants.find((t) => t.slug === slug).estado = 'activo';
  });
}

export async function detener(slug, log) {
  // `stop`, nunca `down`: down borraria la red y, con -v, los volumenes. Aqui
  // solo se apagan los procesos y los datos quedan intactos.
  await correr('docker', ['compose', 'stop'], { cwd: rutaTenant(slug), log });
  await actualizar((e) => {
    e.tenants.find((t) => t.slug === slug).estado = 'detenido';
  });
}

export async function respaldar(slug, log) {
  const tenant = obtener(slug);
  if (!tenant) throw new Error(`no existe el tenant ${slug}`);

  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destino = path.join(DIR_BACKUPS, `${slug}-${sello}.sql.gz`);

  // pg_dump contra el contenedor del propio tenant. Se escribe a un archivo
  // local por redireccion del shell, que es el unico punto donde hace falta
  // shell — por eso va con `sh -c` y el destino entre comillas.
  await correr('sh', ['-c',
    `docker exec chatsuite_${slug}-postgres-1 pg_dump -U postgres chatwoot | gzip > '${destino}'`,
  ], { log });

  const tam = fs.statSync(destino).size;
  if (tam < 1024) {
    // Un dump valido nunca pesa menos de 1 KB. Si sale asi, pg_dump fallo y el
    // gzip guardo el error: se borra para que nadie confie en un respaldo vacio.
    fs.unlinkSync(destino);
    throw new Error('el respaldo salio vacio; revisa que el contenedor de postgres este arriba');
  }

  log(`respaldo guardado: ${destino} (${(tam / 1024 / 1024).toFixed(1)} MB)`);
  await actualizar((e) => {
    e.tenants.find((t) => t.slug === slug).ultimoRespaldo = new Date().toISOString();
  });
  return destino;
}

export async function borrar(slug, log) {
  const tenant = obtener(slug);
  if (!tenant) throw new Error(`no existe el tenant ${slug}`);

  // Un respaldo antes de destruir nada, pero solo se EXIGE si el tenant llego a
  // estar activo. Un alta que fallo a mitad no tiene datos que perder, y su base
  // suele estar vacia o ni siquiera migrada: exigir el respaldo ahi dejaria el
  // tenant roto e imposible de borrar desde el panel, que es el momento en que
  // mas falta hace poder borrarlo.
  const tuvoDatos = tenant.estado === 'activo' || tenant.activadoEn;
  log(tuvoDatos ? 'respaldando antes de borrar...' : 'nunca llego a activo: el respaldo es opcional');
  try {
    await respaldar(slug, log);
  } catch (err) {
    if (tuvoDatos) throw new Error(`no pude respaldar (${err.message}). Borrado cancelado.`);
    log(`sin respaldo (${err.message}); se continua porque el tenant nunca estuvo activo`);
  }

  // El bot primero. Si no, al borrar el tenant quedan un proceso pm2 vivo
  // apuntando a un directorio archivado y un location de nginx colgando: el
  // proceso reinicia en bucle y nadie sabe de donde salio.
  if (tenant.whatsapp) {
    log('quitando el WhatsApp del cliente...');
    const evolution = await import('./evolution.js');
    await evolution.eliminar(slug, log).catch((err) => log(`evolution: ${err.message}`));
  }

  if (tenant.bot) {
    log('quitando el bot del cliente...');
    const bots = await import('./bots.js');
    await bots.eliminarProceso(slug, log);
    await bots.despublicarNginx(slug, log).catch((err) => log(`nginx del bot: ${err.message}`));
  }

  // -v elimina los volumenes: aqui si es lo que se quiere, y es el unico lugar
  // del provisioner donde aparece.
  await correr('docker', ['compose', 'down', '-v'], {
    cwd: rutaTenant(slug), log, permitirFallo: true,
  });

  await correr('sudo', ['rm', '-f', `/etc/nginx/sites-enabled/${tenant.dominio}`], { log, permitirFallo: true });
  await correr('sudo', ['rm', '-f', `/etc/nginx/sites-available/${tenant.dominio}`], { log, permitirFallo: true });
  await correr('sudo', ['nginx', '-t'], { log });
  await correr('sudo', ['systemctl', 'reload', 'nginx'], { log });

  // El certificado se revoca aparte: dejarlo vivo no rompe nada, pero se acumula
  // en la lista de renovaciones y certbot avisa por correo de algo que ya no existe.
  await correr('sudo', ['certbot', 'delete', '--cert-name', tenant.dominio, '--non-interactive'], {
    log, permitirFallo: true,
  });

  // El directorio se conserva: contiene el logo original y el .env, y ocupa poco.
  // Se marca con un sufijo para que un slug reciclado no lo reutilice sin querer.
  const viejo = rutaTenant(slug);
  const archivado = `${viejo}_borrado_${Date.now()}`;
  if (fs.existsSync(viejo)) fs.renameSync(viejo, archivado);
  log(`directorio archivado en ${archivado}`);

  await actualizar((e) => {
    e.tenants = e.tenants.filter((t) => t.slug !== slug);
  });
}

/** Foto de recursos para la cabecera del panel. */
export async function estadoSistema() {
  const { salida: mem } = await correr('free', ['-m'], { permitirFallo: true });
  // En MB y no en GB: con -BG cada cifra se redondea por separado y la suma no
  // cuadra en pantalla (193 total con 162 usados y 32 libres). El panel divide.
  const { salida: disco } = await correr('df', ['-BM', '--output=size,used,avail,pcent', '/'], { permitirFallo: true });

  const lineaMem = mem.split('\n').find((l) => /^Mem:/.test(l)) || '';
  const [, totalMem, usadaMem, , , , dispMem] = lineaMem.split(/\s+/);
  const lineaDisco = disco.split('\n')[1] || '';
  const [, totalD, usadoD, dispD, pctD] = lineaDisco.match(/(\d+)M\s+(\d+)M\s+(\d+)M\s+(\d+)%/) || [];

  const tenants = listar();
  const activos = tenants.filter((t) => t.estado === 'activo').length;

  // ~1.1 GB por tenant, medido sobre las instancias que ya corren (rails ~400MB,
  // sidekiq ~500MB, postgres ~165MB, redis ~15MB). Es una estimacion para avisar
  // a tiempo, no una reserva.
  // 1.1 GB del Chatsuite mas ~190 MB de su Evolution (api 137 + postgres 47 +
  // redis 5) y ~80 MB del bot. Un cliente completo pesa ~1.4 GB; medirlo por el
  // Chatsuite solo dejaba un cupo optimista que se agotaba antes de tiempo.
  const MB_POR_TENANT = 1400;
  const caben = Math.max(0, Math.floor((Number(dispMem) || 0) / MB_POR_TENANT));

  return {
    memoria: { totalMB: Number(totalMem), usadaMB: Number(usadaMem), disponibleMB: Number(dispMem) },
    disco: { totalMB: Number(totalD), usadoMB: Number(usadoD), disponibleMB: Number(dispD), porcentaje: Number(pctD) },
    tenants: { total: tenants.length, activos },
    cupoEstimado: caben,
  };
}

/** Estado real de los contenedores, para contrastarlo con el estado guardado. */
export async function estadoContenedores() {
  const { salida } = await correr('docker', [
    'ps', '-a', '--filter', 'name=chatsuite_', '--format', '{{.Names}}\t{{.State}}',
  ], { permitirFallo: true });

  const porSlug = {};
  salida.split('\n').filter(Boolean).forEach((linea) => {
    const [nombre, estado] = linea.split('\t');
    const m = nombre.match(/^chatsuite_(.+?)-(rails|sidekiq|postgres|redis)-\d+$/);
    if (!m) return;
    porSlug[m[1]] ||= {};
    porSlug[m[1]][m[2]] = estado;
  });
  return porSlug;
}
