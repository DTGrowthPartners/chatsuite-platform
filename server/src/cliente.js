// Configurador del cliente: las mismas vistas del panel, servidas en el dominio
// del cliente y autenticadas con SU Chatsuite.
//
// El punto es que el dueño —o el asesor que contesta— pueda cambiar precios,
// respuestas o el horario sin pedírnoslo. Hasta ahora eso solo se podia hacer
// desde nuestro panel, y eso convierte cada cambio de precio en un ticket.
//
// Quien entra NO tiene credenciales nuestras: manda las de su sesion de
// Chatwoot (las cabeceras de devise_token_auth que el navegador guarda en la
// cookie) y se validan contra el Rails de SU instancia. Dar acceso al
// configurador = dar usuario administrador en Chatwoot, que es algo que el
// cliente gestiona solo, sin pasar por nosotros.
//
// El slug NUNCA sale del navegador: se deduce del Host de la peticion. Aunque
// alguien edite el JSON que manda, solo puede tocar su propio cliente.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { DIR_PUBLICO } from './config.js';
import { listar, rutaTenant } from './store.js';

const DIR_CLIENTE = path.join(DIR_PUBLICO, 'cliente');
// Lo nombra Vite por el archivo de entrada, no es index.html.
const DOC_INICIAL = 'configurador.html';

// Lo que el cliente puede llamar. Todo lo demas del panel —crear tenants,
// borrar, WhatsApp, el ciclo de vida del bot— queda fuera por omision: es una
// lista blanca, no una lista negra, para que agregar un endpoint al panel no lo
// exponga sin querer.
const PERMITIDAS = new Set([
  'GET /api/bot/perfil',
  'PUT /api/bot/perfil',
  'GET /api/bot/dato',
  'PUT /api/bot/dato',
  'GET /api/bot/id-producto',
  'POST /api/bot/foto',
  'GET /api/bot/estado',
  'GET /api/bot/metricas',
  'POST /api/bot/simular',
  'GET /api/bot/prompt',
  // WhatsApp, solo de lectura: el cliente ve si su numero sigue conectado y
  // reescanea el QR si se cayo. Desconectar, rehacer o eliminar la instancia
  // NO estan aqui a proposito: rehacer reimporta historial y eliminar borra la
  // sesion, y las dos se hacen con nosotros delante.
  'GET /api/whatsapp/estado',
  'GET /api/whatsapp/qr',
]);

// Del perfil, el cliente solo escribe estas dos secciones: la persona del bot y
// el horario de citas. Los modulos, el canal, el modelo y el estado del ciclo se
// conservan tal cual estan en disco.
//
// Esconder la pestaña «Operacion» en la interfaz no es un control: cualquiera
// puede mandar el JSON completo a mano. El control es este filtro.
const SECCIONES_CLIENTE = ['persona', 'citas'];

// --- sesion de Chatwoot ------------------------------------------------------

// Validar contra Rails cuesta ~40ms y el configurador hace varias llamadas por
// pantalla. Un minuto de cache evita convertir cada clic en dos peticiones sin
// alargar de forma apreciable la vida de una sesion revocada.
const CACHE = new Map();
const VIDA_CACHE_MS = 60 * 1000;

function credenciales(req) {
  const token = req.headers['x-cw-token'];
  const client = req.headers['x-cw-client'];
  const uid = req.headers['x-cw-uid'];
  return token && client && uid ? { 'access-token': token, client, uid } : null;
}

/**
 * Pregunta a Rails quien es el que llama.
 *
 * Va directo al puerto del contenedor y no por nginx: nginx descarta las
 * cabeceras con guion bajo y aqui viajan datos de sesion. El Host explicito y
 * el X-Forwarded-Proto son obligatorios: con FORCE_SSL, sin ellos Rails
 * responde 301 y `fetch` acabaria pidiendole el perfil al dominio publico.
 */
async function quienEs(tenant, creds) {
  const r = await fetch(`http://127.0.0.1:${tenant.puerto}/api/v1/profile`, {
    headers: { ...creds, Host: tenant.dominio, 'X-Forwarded-Proto': 'https' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r || r.status !== 200) return null;
  return r.json().catch(() => null);
}

async function autenticar(tenant, req) {
  const creds = credenciales(req);
  if (!creds) return { error: 'entra a tu Chatsuite y vuelve a abrir esta pestaña' };

  const llave = `${tenant.slug}|${creds['access-token']}|${creds.uid}`;
  const guardado = CACHE.get(llave);
  if (guardado && guardado.hasta > Date.now()) return guardado.valor;

  const perfil = await quienEs(tenant, creds);
  let valor;
  if (!perfil) valor = { error: 'tu sesion de Chatsuite no es valida; vuelve a entrar' };
  else if (perfil.role !== 'administrator') {
    // Deliberado: el asesor contesta y ve trabajar al bot, pero no le cambia la
    // configuracion. Quien decide quien es administrador es el dueño, desde su
    // propio Chatsuite.
    valor = { error: 'esto lo edita un administrador de tu Chatsuite; pidele acceso al dueño' };
  } else valor = { usuario: perfil.email };

  CACHE.set(llave, { valor, hasta: Date.now() + VIDA_CACHE_MS });
  return valor;
}

// --- estaticos ---------------------------------------------------------------

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function servirEstatico(res, relativo) {
  const archivo = path.resolve(DIR_CLIENTE, relativo);
  const existe = archivo.startsWith(DIR_CLIENTE) && fs.existsSync(archivo)
    && fs.statSync(archivo).isFile();
  if (!existe) {
    if (path.extname(relativo)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('no encontrado');
    }
    return servirEstatico(res, DOC_INICIAL);
  }
  const tipo = TIPOS[path.extname(archivo)] || 'application/octet-stream';
  // El HTML nunca se cachea: es el que trae los nombres con hash de los assets,
  // y cacheado dejaria al cliente con la version vieja tras cada despliegue.
  const cache = archivo.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable';
  res.writeHead(200, { 'content-type': tipo, 'cache-control': cache });
  fs.createReadStream(archivo).pipe(res);
}

/**
 * El boton flotante, pintado con la marca del cliente.
 *
 * El color se sustituye al servir y no en el navegador: asi el boton nace del
 * color correcto y no parpadea del azul por defecto al de la marca.
 */
function servirInyector(res, tenant) {
  const plantilla = fs.readFileSync(path.join(DIR_CLIENTE, 'inyector.js'), 'utf8');
  const color = /^#[0-9a-fA-F]{6}$/.test(tenant.color || '') ? tenant.color : '#1f93ff';
  const js = plantilla
    .replaceAll('{{COLOR}}', color)
    .replaceAll('{{TEXTO}}', colorTexto(color));
  res.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    // Corto: si cambia la marca del cliente, el boton se pone al dia solo.
    'cache-control': 'public, max-age=300',
  });
  res.end(js);
}

/**
 * Blanco o negro segun el color de fondo.
 *
 * Con marcas claras —un amarillo, un lima— el texto blanco desaparece. La
 * formula es la luminancia relativa de WCAG; el umbral 0.55 es donde deja de
 * leerse bien en pantalla.
 */
function colorTexto(hex) {
  const canal = (i) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luz = 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
  return luz > 0.55 ? '#111827' : '#ffffff';
}

// --- entrada -----------------------------------------------------------------

const json = (res, codigo, datos) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(datos));
};

function leerTodo(req) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    let bytes = 0;
    req.on('data', (t) => {
      bytes += t.length;
      // El mismo tope que el panel: por aqui suben fotos de productos en base64.
      if (bytes > 12 * 1024 * 1024) rechazar(new Error('el cuerpo supera 12 MB'));
      else trozos.push(t);
    });
    req.on('end', () => resolver(Buffer.concat(trozos)));
    req.on('error', rechazar);
  });
}

/** Un `req` de mentira con el cuerpo ya leido, para reusar los handlers del panel. */
function reconstruir(req, cuerpo, ruta) {
  return Object.assign(Readable.from(cuerpo.length ? [cuerpo] : []), {
    headers: req.headers,
    method: req.method,
    url: ruta,
  });
}

/**
 * Atiende todo lo que cuelga de /cliente/. `rutas` son los handlers del panel:
 * el configurador no reimplementa la API, la reusa con otra puerta de entrada.
 */
export async function atender(req, res, url, rutas) {
  const host = (req.headers.host || '').split(':')[0];
  const tenant = listar().find((t) => t.dominio === host);
  if (!tenant) return json(res, 404, { error: 'este dominio no es de ningun cliente' });

  const resto = url.pathname.replace(/^\/cliente\/?/, '');

  // El inyector es JS publico y sin datos: dibuja el boton flotante dentro de
  // Chatwoot y tiene que cargar antes de que nadie se autentique. Se sirve
  // generado, no estatico, porque lleva el color de marca del cliente.
  if (resto === 'inyector.js') return servirInyector(res, tenant);
  if (!resto.startsWith('api/')) return servirEstatico(res, resto || DOC_INICIAL);

  if (!tenant.bot) return json(res, 404, { error: 'este cliente todavia no tiene bot' });

  const sesion = await autenticar(tenant, req);
  if (sesion.error) return json(res, 401, { error: sesion.error });

  // Quien soy y a quien configuro. Lo pide la app al arrancar: el slug no viaja
  // nunca desde el navegador, asi que tiene que salir de aqui.
  if (resto === 'api/contexto') {
    return json(res, 200, {
      slug: tenant.slug,
      nombre: tenant.nombre,
      dominio: tenant.dominio,
      usuario: sesion.usuario,
    });
  }

  // `resto` ya viene con el prefijo api/, que es el mismo que usan las rutas del
  // panel: /cliente/api/bot/perfil se atiende con el handler de /api/bot/perfil.
  // La query original viaja tal cual (archivo, dias...); solo el slug se pisa.
  const destino = new URL(`/${resto}${url.search}`, 'http://interno');
  const clave = `${req.method} ${destino.pathname}`;
  if (!PERMITIDAS.has(clave)) return json(res, 403, { error: 'esto no se edita desde aqui' });

  // El slug se impone desde el Host, tanto en la query como en el cuerpo.
  destino.searchParams.set('slug', tenant.slug);

  let cuerpo = Buffer.alloc(0);
  if (req.method !== 'GET') {
    try {
      const crudo = await leerTodo(req);
      const datos = crudo.length ? JSON.parse(crudo.toString()) : {};
      datos.slug = tenant.slug;
      if (clave === 'PUT /api/bot/perfil') datos.perfil = filtrarPerfil(tenant.slug, datos.perfil);
      cuerpo = Buffer.from(JSON.stringify(datos));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  const rutaFinal = `${destino.pathname}${destino.search}`;
  await rutas[clave](reconstruir(req, cuerpo, rutaFinal), res, destino);
}

/** Deja pasar solo las secciones del perfil que el cliente puede tocar. */
function filtrarPerfil(slug, entrante) {
  const actual = JSON.parse(fs.readFileSync(path.join(rutaTenant(slug), 'bot', 'perfil.json'), 'utf8'));
  const salida = { ...actual };
  for (const seccion of SECCIONES_CLIENTE) {
    if (entrante && Object.hasOwn(entrante, seccion)) salida[seccion] = entrante[seccion];
  }
  return salida;
}
