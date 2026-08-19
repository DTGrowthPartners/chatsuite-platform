// Canal de WhatsApp por QR: Evolution API, uno por cliente.
//
// La cadena completa es WhatsApp → Evolution → Chatsuite → bot. Evolution NO le
// habla al bot: espeja las conversaciones a Chatsuite y el bot vive de ahi. Por
// eso cambiar de canal despues no toca el bot.
//
// El enlace con Chatsuite se hace en UN SOLO POST /instance/create: settings,
// integracion y creacion automatica del inbox. Crear la instancia suelta y
// enlazarla despues obliga a rehacer parte del enlace a mano.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { contenedor } from './config.js';
import { correr, plantilla } from './provision.js';
import { actualizar, obtener, rutaTenant, leer as leerEstado } from './store.js';
import * as bots from './bots.js';

export const IMAGEN_EVO = process.env.IMAGEN_EVOLUTION || 'evolution-api:2.3.7-dtgp-lidfix';

// Rango propio: 3210-3299 Chatsuites, 3310-3399 bots, 3410-3499 Evolution.
export const PUERTO_EVO_MIN = 3410;
export const PUERTO_EVO_MAX = 3499;

export const rutaEvo = (slug) => path.join(rutaTenant(slug), 'evolution');
const contenedorApi = (slug) => `evo_${slug}_api`;
const contenedorRails = (slug) => contenedor(slug, 'rails');

const secreto = (n = 32) => crypto.randomBytes(n).toString('hex');

export function asignarPuerto() {
  const usados = new Set(leerEstado().tenants.map((t) => t.whatsapp?.puerto).filter(Boolean));
  for (let p = PUERTO_EVO_MIN; p <= PUERTO_EVO_MAX; p += 1) {
    if (!usados.has(p)) return p;
  }
  throw new Error('no quedan puertos libres para Evolution');
}

async function api(slug, ruta, opciones = {}) {
  const wa = obtener(slug)?.whatsapp;
  if (!wa?.puerto) throw new Error('este cliente no tiene WhatsApp aprovisionado');
  const r = await fetch(`http://127.0.0.1:${wa.puerto}${ruta}`, {
    ...opciones,
    headers: { apikey: wa.apikey, 'content-type': 'application/json', ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(opciones.timeoutMs || 30000),
  });
  const texto = await r.text();
  let cuerpo;
  try { cuerpo = texto ? JSON.parse(texto) : {}; }
  catch { throw new Error(`Evolution respondio algo que no es JSON: ${texto.slice(0, 200)}`); }
  if (r.status >= 400) {
    const detalle = cuerpo?.response?.message || cuerpo?.message || texto.slice(0, 200);
    throw new Error(`Evolution ${r.status}: ${JSON.stringify(detalle).slice(0, 300)}`);
  }
  return cuerpo;
}

// --- levantar el stack -------------------------------------------------------

export async function preparar(slug, log) {
  const tenant = obtener(slug);
  if (!tenant) throw new Error('no existe ese cliente');
  if (tenant.estado !== 'activo') {
    throw new Error(`el Chatsuite tiene que estar activo (está en ${tenant.estado})`);
  }

  const puerto = tenant.whatsapp?.puerto || asignarPuerto();
  const apikey = tenant.whatsapp?.apikey || secreto(32);
  const clavePg = tenant.whatsapp?.clavePg || secreto(16);
  const dir = rutaEvo(slug);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });

  fs.writeFileSync(path.join(dir, 'docker-compose.yaml'), plantilla('evolution-compose.tpl', {
    NOMBRE: tenant.nombre, SLUG: slug, PUERTO: String(puerto), IMAGEN: IMAGEN_EVO,
  }));
  fs.writeFileSync(path.join(dir, '.env'), plantilla('evolution-env.tpl', {
    NOMBRE: tenant.nombre, SLUG: slug, PUERTO: String(puerto),
    APIKEY: apikey, CLAVE_PG: clavePg,
    CLAVE_CHATWOOT_PG: tenant.secretos.postgres,
  }), { mode: 0o600 });

  await actualizar((e) => {
    const t = e.tenants.find((x) => x.slug === slug);
    t.whatsapp = {
      ...(t.whatsapp || {}), puerto, apikey, clavePg,
      instancia: slug, estado: 'creando',
      creadoEn: t.whatsapp?.creadoEn || new Date().toISOString(),
    };
  });

  log(`Levantando Evolution en :${puerto}…`);
  await correr('docker', ['compose', 'up', '-d'], { cwd: dir, log });

  // Sondeo en vez de una espera fija: el arranque incluye migraciones de Prisma
  // y tarda distinto en cada maquina.
  log('Esperando a que la API responda…');
  for (let intento = 1; intento <= 40; intento += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/`, { signal: AbortSignal.timeout(4000) });
      if (r.status < 500) { log(`Evolution responde (intento ${intento})`); return; }
    } catch { /* todavia no */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Evolution no respondio despues de 2 minutos; revisa docker compose logs');
}

// --- la instancia y su enlace con Chatsuite ---------------------------------

/**
 * Comprueba que el contenedor RESUELVA el dominio del cliente.
 *
 * No es paranoia: si Evolution arranca antes de que exista el DNS se queda con
 * el NXDOMAIN cacheado EN EL PROCESO, y despues espeja cero mensajes a Chatsuite
 * sin un error legible (el log imprime `[object]`). Desde el host resuelve
 * perfecto, y hasta un `wget` desde dentro del contenedor funciona: hay que
 * mirar el resolver, y si falla, reiniciar el contenedor.
 */
async function asegurarDns(slug, dominio, log) {
  const { codigo } = await correr('docker', [
    'exec', contenedorApi(slug), 'getent', 'hosts', dominio,
  ], { permitirFallo: true, log });
  if (codigo === 0) return;
  log(`El contenedor no resuelve ${dominio}: reiniciando la API para tirar el cache…`);
  await correr('docker', ['compose', 'restart', 'api'], { cwd: rutaEvo(slug), log });
  await new Promise((r) => setTimeout(r, 8000));
  const segundo = await correr('docker', [
    'exec', contenedorApi(slug), 'getent', 'hosts', dominio,
  ], { permitirFallo: true, log });
  if (segundo.codigo !== 0) {
    throw new Error(`el contenedor de Evolution no resuelve ${dominio}; sin eso no espeja nada`);
  }
}

export async function crearInstancia(slug, log, opciones = {}) {
  const tenant = obtener(slug);
  const dominio = tenant.dominio;
  const url = `https://${dominio}`;

  // El enlace apunta a la URL publica, asi que si el dominio no responde por
  // HTTPS la instancia queda a medias y hay que borrarla y rehacerla.
  log(`Verificando que ${url} responda…`);
  const prueba = await fetch(`${url}/app/login`, { signal: AbortSignal.timeout(15000) })
    .catch(() => null);
  if (!prueba || prueba.status >= 400) {
    throw new Error(`${url} no responde todavia; falta DNS o SSL`);
  }
  await asegurarDns(slug, dominio, log);

  const creds = await bots.tokensYBot(slug, `${url}/bot/webhook`, log);

  log(`Creando la instancia «${slug}»…`);
  const cuerpo = {
    instanceName: slug,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',

    rejectCall: false,
    groupsIgnore: false,
    alwaysOnline: false,
    readStatus: false,
    readMessages: true,
    // El historial SOLO se importa al conectar. Si se escanea sin esto puesto,
    // recuperarlo obliga a desconectar y volver a escanear.
    syncFullHistory: Boolean(opciones.importarHistorial),

    chatwootAccountId: String(creds.account_id),
    chatwootToken: creds.read_token,
    chatwootUrl: url,
    chatwootSignMsg: false,
    chatwootReopenConversation: true,
    // Clave para el bot: hace que la conversacion nazca `pending`, que es lo
    // unico que el bot atiende.
    chatwootConversationPending: true,
    chatwootImportContacts: Boolean(opciones.importarHistorial),
    chatwootImportMessages: Boolean(opciones.importarHistorial),
    chatwootDaysLimitImportMessages: 90,
    chatwootMergeBrazilContacts: false,
    chatwootNameInbox: opciones.nombreInbox || 'WhatsApp',
    // Reusa el inbox existente si coincide el nombre, asi que reintentar no
    // duplica nada.
    chatwootAutoCreate: true,
  };

  const r = await api(slug, '/instance/create', { method: 'POST', body: JSON.stringify(cuerpo), timeoutMs: 60000 });
  await actualizar((e) => {
    const t = e.tenants.find((x) => x.slug === slug);
    t.whatsapp = { ...t.whatsapp, estado: 'esperando-qr', importarHistorial: Boolean(opciones.importarHistorial) };
  });
  log('Instancia creada. Falta escanear el QR desde el celular del cliente.');
  return { qr: r?.qrcode?.base64 || null };
}

/**
 * Deja el inbox listo para el bot: le asigna el AgentBot y apaga la asignacion
 * automatica.
 *
 * Lo segundo es lo que mas se olvida: con `enable_auto_assignment` encendido la
 * conversacion nace `open` y asignada a un agente, y el bot —que solo atiende
 * `pending`— no la ve NUNCA. Todo parece bien y el bot simplemente no contesta.
 */
export async function enlazarBot(slug, log) {
  const tenant = obtener(slug);
  if (!tenant?.bot?.agentBotId) throw new Error('este cliente no tiene bot; créalo primero');
  const ruby = `
    cuenta = Account.first
    inbox = cuenta.inboxes.where(channel_type: 'Channel::Whatsapp').last ||
            cuenta.inboxes.where(channel_type: 'Channel::Api').last ||
            cuenta.inboxes.last
    abort('SIN_INBOX') if inbox.nil?
    inbox.update!(enable_auto_assignment: false)
    bot = AgentBot.find(${Number(tenant.bot.agentBotId)})
    AgentBotInbox.where(inbox_id: inbox.id).destroy_all
    AgentBotInbox.create!(inbox_id: inbox.id, agent_bot_id: bot.id, account_id: cuenta.id, status: 'active')
    puts "JSON:" + { inbox_id: inbox.id, inbox: inbox.name,
                     auto_assignment: inbox.enable_auto_assignment }.to_json
  `.trim();
  const { salida } = await correr('docker', [
    'exec', contenedorRails(slug), 'bundle', 'exec', 'rails', 'runner', ruby,
  ], { log });
  const linea = salida.split('\n').reverse().find((l) => l.startsWith('JSON:'));
  if (!linea) throw new Error('no se pudo enlazar el bot con el inbox');
  const datos = JSON.parse(linea.slice(5));

  // El bot ya sabe por que canal habla: se lo dejamos en su perfil.
  const perfil = bots.leerPerfil(slug);
  if (perfil) {
    perfil.chatsuite = { ...(perfil.chatsuite || {}), inbox_id: datos.inbox_id };
    perfil.canal = {
      ...(perfil.canal || {}),
      tipo: 'evolution',
      evolution: {
        url: `http://127.0.0.1:${tenant.whatsapp.puerto}`,
        instancia: tenant.whatsapp.instancia || slug,
      },
    };
    bots.escribirPerfil(slug, perfil);
    // La apikey de Evolution es secreto: va al .env del bot, no al perfil.
    const rutaEnv = path.join(bots.rutaBot(slug), '.env');
    if (fs.existsSync(rutaEnv)) {
      const env = fs.readFileSync(rutaEnv, 'utf8')
        .replace(/^EVOLUTION_URL=.*$/m, `EVOLUTION_URL=http://127.0.0.1:${tenant.whatsapp.puerto}`)
        .replace(/^EVOLUTION_APIKEY=.*$/m, `EVOLUTION_APIKEY=${tenant.whatsapp.apikey}`);
      fs.writeFileSync(rutaEnv, env, { mode: 0o600 });
      // El .env SI exige reiniciar: solo se lee al arrancar el proceso.
      await bots.arrancar(slug, log);
    }
  }
  log(`Inbox #${datos.inbox_id} «${datos.inbox}» enlazado al bot, con asignación automática apagada`);
  return datos;
}

// --- estado y QR -------------------------------------------------------------

export async function estado(slug) {
  const wa = obtener(slug)?.whatsapp;
  if (!wa?.puerto) return { sinWhatsapp: true };
  try {
    const r = await api(slug, `/instance/connectionState/${wa.instancia || slug}`, { timeoutMs: 8000 });
    return { puerto: wa.puerto, instancia: wa.instancia || slug, conexion: r?.instance?.state || null };
  } catch (err) {
    return { puerto: wa.puerto, instancia: wa.instancia || slug, conexion: null, detalle: err.message };
  }
}

/** El QR vigente. Evolution lo rota solo cada ~40 s, asi que el panel repregunta. */
export async function qr(slug) {
  const wa = obtener(slug)?.whatsapp;
  if (!wa?.puerto) throw new Error('este cliente no tiene WhatsApp');
  const r = await api(slug, `/instance/connect/${wa.instancia || slug}`, { timeoutMs: 20000 });
  return {
    base64: r?.base64 || null,
    codigo: r?.code || null,
    pairing: r?.pairingCode || null,
    // Ya conectado: Evolution devuelve el estado en vez de un QR.
    conexion: r?.instance?.state || null,
  };
}

export async function desconectar(slug, log) {
  const wa = obtener(slug)?.whatsapp;
  await api(slug, `/instance/logout/${wa.instancia || slug}`, { method: 'DELETE' }).catch((e) => {
    log?.(`logout: ${e.message}`);
  });
  await actualizar((e) => {
    const t = e.tenants.find((x) => x.slug === slug);
    if (t.whatsapp) t.whatsapp.estado = 'desconectado';
  });
}

export async function eliminar(slug, log) {
  const tenant = obtener(slug);
  if (!tenant?.whatsapp) return;
  const instancia = tenant.whatsapp.instancia || slug;
  // El delete falla si la sesion sigue abierta: primero logout.
  await api(slug, `/instance/logout/${instancia}`, { method: 'DELETE' }).catch(() => {});
  await api(slug, `/instance/delete/${instancia}`, { method: 'DELETE' }).catch(() => {});
  const dir = rutaEvo(slug);
  if (fs.existsSync(dir)) {
    await correr('docker', ['compose', 'down', '-v'], { cwd: dir, log, permitirFallo: true });
  }
  await actualizar((e) => {
    const t = e.tenants.find((x) => x.slug === slug);
    delete t.whatsapp;
  });
  log?.('Evolution eliminado');
}
