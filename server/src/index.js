// Panel de aprovisionamiento de Chatsuite.
//
// Sirve el panel estatico y la API. No trae capa de login propia: va detras de
// nginx con auth basic, igual que el panel /wa/ de compuxtreme. Escucha solo en
// 127.0.0.1, asi que la unica puerta es nginx.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { DIR_PUBLICO, DOMINIO_BASE, GENERADOR_MARCA, PUERTO_PANEL } from './config.js';
import * as auth from './auth.js';
import * as bots from './bots.js';
import * as ciclo from './ciclo.js';
import * as evolution from './evolution.js';
import * as jobs from './jobs.js';
import {
  IDS_PASOS, aprovisionar, correr, nuevoTenant, validarSlug,
} from './provision.js';
import { actualizar, listar, obtener, rutaTenant } from './store.js';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  // El bundle del panel trae las fuentes Geist. Sin este tipo el navegador las
  // recibe como octet-stream, las rechaza y cae a la fuente del sistema.
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
};

function leerCuerpo(req, limiteMB = 12) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    let bytes = 0;
    req.on('data', (t) => {
      bytes += t.length;
      // El logo viaja en base64 dentro del JSON. El limite evita que una subida
      // enorme llene la memoria del proceso.
      if (bytes > limiteMB * 1024 * 1024) {
        reject(new Error(`el cuerpo supera ${limiteMB} MB`));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on('end', () => {
      try { resolve(trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : {}); }
      catch (err) { reject(new Error(`JSON invalido: ${err.message}`)); }
    });
    req.on('error', reject);
  });
}

/** Guarda el logo que subio el panel y devuelve su extension. */
function guardarLogo(slug, logoBase64) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(logoBase64 || '');
  if (!m) throw new Error('el logo debe ser PNG, JPG o WEBP');
  const extension = m[1] === 'jpeg' ? '.jpg' : `.${m[1]}`;
  const dir = rutaTenant(slug);
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, `_logo-original${extension}`);
  fs.writeFileSync(destino, Buffer.from(m[2], 'base64'));
  return { extension, destino };
}

/** Lanza un job en segundo plano y responde de inmediato con su id. */
function enSegundoPlano(slug, titulo, tarea) {
  const job = jobs.crear(slug, titulo);
  const log = jobs.logger(job);
  // Deliberadamente sin await: el panel sigue el avance por SSE. Un alta tarda
  // varios minutos y mantener la peticion abierta la haria morir por timeout.
  (async () => {
    try {
      await tarea(log);
      jobs.terminar(job, true, '\n✓ Terminado');
    } catch (err) {
      jobs.terminar(job, false, `\n✗ Fallo: ${err.message}`);
    }
  })();
  return job;
}

// --- rutas -------------------------------------------------------------------

const rutas = {
  'POST /api/login': async (req, res) => {
    const { usuario, clave } = await leerCuerpo(req);
    const r = auth.intentarEntrar(req, usuario, clave);
    if (!r.ok) return json(res, 401, { error: r.error });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': r.cookie,
    });
    res.end(JSON.stringify({ ok: true }));
  },

  // Abierta a proposito: el SPA la consulta al arrancar para decidir si pinta
  // el login o el panel. No revela nada mas que un booleano.
  'GET /api/sesion': async (req, res) => json(res, 200, { autenticado: auth.haySesion(req) }),

  'POST /api/logout': async (req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': auth.cookieBorrada(req),
    });
    res.end(JSON.stringify({ ok: true }));
  },

  'GET /api/sistema': async (req, res) => {
    const [sistema, contenedores] = await Promise.all([
      ciclo.estadoSistema(), ciclo.estadoContenedores(),
    ]);
    json(res, 200, { ...sistema, contenedores, dominioBase: DOMINIO_BASE, pasos: IDS_PASOS });
  },

  'GET /api/tenants': async (req, res) => {
    const contenedores = await ciclo.estadoContenedores();
    // Los secretos no salen del servidor en el listado. La clave del admin se
    // entrega una sola vez, en el detalle, y solo a pedido.
    const limpios = listar().map(({ secretos, ...t }) => ({
      ...t, contenedores: contenedores[t.slug] || null,
    }));
    json(res, 200, limpios);
  },

  'POST /api/color-sugerido': async (req, res) => {
    const { logo } = await leerCuerpo(req);
    const temporal = `/tmp/chatsuite-color-${Date.now()}.img`;
    const m = /^data:image\/(?:png|jpeg|jpg|webp);base64,(.+)$/s.exec(logo || '');
    if (!m) return json(res, 400, { error: 'el logo debe ser PNG, JPG o WEBP' });
    fs.writeFileSync(temporal, Buffer.from(m[1], 'base64'));
    try {
      const { salida } = await correr('python3', [GENERADOR_MARCA, '--logo', temporal, '--solo-color']);
      json(res, 200, JSON.parse(salida.trim().split('\n').pop()));
    } finally {
      fs.rmSync(temporal, { force: true });
    }
  },

  'POST /api/tenants': async (req, res) => {
    const cuerpo = await leerCuerpo(req);
    const slug = String(cuerpo.slug || '').trim().toLowerCase();

    const problema = validarSlug(slug);
    if (problema) return json(res, 400, { error: problema });
    if (!cuerpo.nombre?.trim()) return json(res, 400, { error: 'el nombre del cliente es obligatorio' });
    if (!/^#?[0-9a-fA-F]{6}$/.test(cuerpo.color || '')) return json(res, 400, { error: 'el color debe ser #RRGGBB' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuerpo.emailAdmin || '')) return json(res, 400, { error: 'el correo del admin no es valido' });

    let logo;
    try { logo = guardarLogo(slug, cuerpo.logo); }
    catch (err) { return json(res, 400, { error: err.message }); }

    // El sitio del cliente alimenta BRAND_URL y los enlaces de terminos y
    // privacidad del dashboard: una URL invalida ahi son tres enlaces rotos.
    const sitio = String(cuerpo.sitio || '').trim();
    if (sitio && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(sitio)) {
      return json(res, 400, { error: 'el sitio web debe empezar por http:// o https://' });
    }
    const IDIOMAS = new Set(['es', 'en', 'pt_BR']);
    if (cuerpo.locale && !IDIOMAS.has(cuerpo.locale)) {
      return json(res, 400, { error: 'idioma no soportado' });
    }

    const tenant = nuevoTenant({
      slug,
      nombre: cuerpo.nombre.trim(),
      marca: String(cuerpo.marca || '').trim(),
      sitio,
      locale: cuerpo.locale,
      zonaHoraria: String(cuerpo.zonaHoraria || '').trim(),
      ciudad: String(cuerpo.ciudad || '').trim(),
      bot: cuerpo.bot,
      color: cuerpo.color.startsWith('#') ? cuerpo.color.toUpperCase() : `#${cuerpo.color.toUpperCase()}`,
      emailAdmin: cuerpo.emailAdmin.trim(),
      quitarFondo: cuerpo.quitarFondo,
      logoExtension: logo.extension,
    });
    await actualizar((e) => { e.tenants.push(tenant); });

    const job = enSegundoPlano(slug, `Alta de ${tenant.nombre}`, (log) => aprovisionar(slug, log));
    json(res, 202, { slug, job: job.id, dominio: tenant.dominio, puerto: tenant.puerto });
  },

  'GET /api/tenant': async (req, res, url) => {
    const tenant = obtener(url.searchParams.get('slug'));
    if (!tenant) return json(res, 404, { error: 'no existe' });
    const { secretos, ...resto } = tenant;
    // Las credenciales solo se devuelven si se piden explicitamente, para que no
    // queden en el historial de peticiones del navegador por un simple refresco.
    const conClaves = url.searchParams.get('credenciales') === 'si';
    json(res, 200, conClaves
      ? { ...resto, credenciales: { email: tenant.admin.email, password: secretos.adminPassword } }
      : resto);
  },

  'POST /api/accion': async (req, res) => {
    const { slug, accion, confirmar } = await leerCuerpo(req);
    const tenant = obtener(slug);
    if (!tenant) return json(res, 404, { error: 'no existe' });

    const acciones = {
      arrancar: (log) => ciclo.arrancar(slug, log),
      detener: (log) => ciclo.detener(slug, log),
      // Corta el servicio del cliente sin borrar nada y con una página que lo
      // explica, en vez del 502 que deja `detener`.
      suspender: (log) => ciclo.suspender(slug, log, confirmar),
      reanudar: (log) => ciclo.reanudar(slug, log),
      respaldar: (log) => ciclo.respaldar(slug, log),
      reintentar: (log) => aprovisionar(slug, log),
      borrar: (log) => {
        // El slug escrito a mano es la unica barrera antes de un `down -v`.
        if (confirmar !== slug) throw new Error('para borrar hay que escribir el slug exacto');
        return ciclo.borrar(slug, log);
      },
    };
    if (!acciones[accion]) return json(res, 400, { error: `accion desconocida: ${accion}` });

    const job = enSegundoPlano(slug, `${accion} ${slug}`, acciones[accion]);
    json(res, 202, { job: job.id });
  },

  // --- bot del cliente -------------------------------------------------------

  'POST /api/bot/preparar': async (req, res) => {
    const { slug } = await leerCuerpo(req);
    const tenant = obtener(slug);
    if (!tenant) return json(res, 404, { error: 'no existe' });
    const job = enSegundoPlano(slug, `Bot de ${tenant.nombre}`, (log) => bots.preparar(slug, log));
    json(res, 202, { job: job.id });
  },

  'GET /api/bot/perfil': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    const perfil = bots.leerPerfil(slug);
    if (!perfil) return json(res, 404, { error: 'este cliente no tiene bot' });
    json(res, 200, perfil);
  },

  'PUT /api/bot/perfil': async (req, res) => {
    const { slug, perfil } = await leerCuerpo(req);
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      bots.escribirPerfil(slug, perfil);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    // No hace falta reiniciar: el motor relee el perfil al cambiar el mtime.
    json(res, 200, { ok: true });
  },

  'GET /api/bot/dato': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    const archivo = url.searchParams.get('archivo');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, { archivo, contenido: bots.leerDato(slug, archivo) });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  },

  'PUT /api/bot/dato': async (req, res) => {
    const { slug, archivo, contenido } = await leerCuerpo(req);
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      bots.escribirDato(slug, archivo, contenido);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  },

  'POST /api/bot/foto': async (req, res) => {
    const { slug, id, foto } = await leerCuerpo(req);
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, { imagen: bots.guardarFoto(slug, id, foto) });
    } catch (err) {
      json(res, 400, { error: err.message });
    }
  },

  'GET /api/bot/estado': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, await bots.estadoBot(slug));
    } catch (err) {
      // El bot caido no es un error del panel: se reporta como estado.
      json(res, 200, { caido: true, detalle: err.message });
    }
  },

  'POST /api/bot/ciclo': async (req, res) => {
    const { slug, estado } = await leerCuerpo(req);
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, await bots.cambiarCiclo(slug, estado));
    } catch (err) {
      json(res, 502, { error: err.message });
    }
  },

  'POST /api/bot/simular': async (req, res) => {
    const { slug, mensajes } = await leerCuerpo(req);
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, await bots.simular(slug, mensajes));
    } catch (err) {
      json(res, 502, { error: err.message });
    }
  },

  'GET /api/bot/metricas': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, await bots.metricas(slug, url.searchParams.get('dias') || 30));
    } catch (err) {
      json(res, 502, { error: err.message });
    }
  },

  'GET /api/bot/prompt': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, await bots.verPrompt(slug));
    } catch (err) {
      json(res, 502, { error: err.message });
    }
  },

  'POST /api/bot/accion': async (req, res) => {
    const { slug, accion } = await leerCuerpo(req);
    const tenant = obtener(slug);
    if (!tenant) return json(res, 404, { error: 'no existe' });
    const acciones = {
      arrancar: (log) => bots.arrancar(slug, log),
      detener: (log) => bots.detener(slug, log),
      etiquetas: (log) => bots.sincronizarEtiquetas(slug, log),
    };
    if (!acciones[accion]) return json(res, 400, { error: `accion desconocida: ${accion}` });
    const job = enSegundoPlano(slug, `bot ${accion} ${slug}`, acciones[accion]);
    json(res, 202, { job: job.id });
  },

  // --- WhatsApp del cliente (Evolution + QR) ---------------------------------

  'POST /api/whatsapp/preparar': async (req, res) => {
    const { slug } = await leerCuerpo(req);
    const tenant = obtener(slug);
    if (!tenant) return json(res, 404, { error: 'no existe' });
    const job = enSegundoPlano(slug, `WhatsApp de ${tenant.nombre}`, async (log) => {
      await evolution.preparar(slug, log);
      await evolution.crearInstancia(slug, log, {
        importarHistorial: false, nombreInbox: 'WhatsApp',
      });
      log('');
      log('Ahora escanea el QR desde el panel, con el celular DEL CLIENTE.');
    });
    json(res, 202, { job: job.id });
  },

  'GET /api/whatsapp/estado': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    json(res, 200, await evolution.estado(slug));
  },

  'GET /api/whatsapp/qr': async (req, res, url) => {
    const slug = url.searchParams.get('slug');
    if (!obtener(slug)) return json(res, 404, { error: 'no existe' });
    try {
      json(res, 200, await evolution.qr(slug));
    } catch (err) {
      json(res, 200, { base64: null, error: err.message });
    }
  },

  'POST /api/whatsapp/accion': async (req, res) => {
    const { slug, accion, importarHistorial } = await leerCuerpo(req);
    const tenant = obtener(slug);
    if (!tenant) return json(res, 404, { error: 'no existe' });
    const acciones = {
      enlazar: (log) => evolution.enlazarBot(slug, log),
      desconectar: (log) => evolution.desconectar(slug, log),
      eliminar: (log) => evolution.eliminar(slug, log),
      // Rehacer la instancia es la unica via para recuperar el historial: la
      // importacion corre SOLO al conectar.
      rehacer: async (log) => {
        await evolution.desconectar(slug, log);
        await evolution.crearInstancia(slug, log, { importarHistorial: Boolean(importarHistorial) });
      },
    };
    if (!acciones[accion]) return json(res, 400, { error: `accion desconocida: ${accion}` });
    const job = enSegundoPlano(slug, `whatsapp ${accion} ${slug}`, acciones[accion]);
    json(res, 202, { job: job.id });
  },

  'GET /api/job': async (req, res, url) => {
    const job = jobs.obtener(url.searchParams.get('id'));
    if (!job) return json(res, 404, { error: 'job no encontrado' });

    // SSE: el panel se suscribe y ve el log del aprovisionamiento en vivo.
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // sin esto nginx acumula y el log llega a golpes
    });

    const enviar = (linea, fin) => {
      if (fin) res.write(`event: fin\ndata: ${JSON.stringify(fin)}\n\n`);
      else res.write(`data: ${JSON.stringify(linea)}\n\n`);
    };

    job.lineas.forEach((l) => enviar(l));
    if (job.terminado) {
      enviar(null, { terminado: true, ok: job.ok });
      return res.end();
    }
    job.suscriptores.add(enviar);
    req.on('close', () => job.suscriptores.delete(enviar));
  },
};

// --- servidor ----------------------------------------------------------------

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const clave = `${req.method} ${url.pathname}`;

  // Guardia de sesion. Solo quedan fuera la propia pantalla de acceso y los dos
  // estaticos que necesita para dibujarse; todo lo demas exige cookie valida.
  const ABIERTAS = new Set(['POST /api/login', 'GET /api/sesion']);
  // Solo se guarda la API. Los estaticos del panel se sirven siempre: son el
  // bundle publico del SPA y no contienen datos, y es el propio SPA el que
  // decide si pinta el login o el tablero segun /api/sesion.
  if (url.pathname.startsWith('/api/') && !ABIERTAS.has(clave) && !auth.haySesion(req)) {
    return json(res, 401, { error: 'sesion expirada' });
  }

  if (rutas[clave]) {
    try {
      await rutas[clave](req, res, url);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'ruta no encontrada' });

  // Estaticos del panel. El resolve + comprobacion de prefijo corta cualquier
  // intento de salirse del directorio con ../
  const relativo = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const archivo = path.resolve(DIR_PUBLICO, relativo);
  // Fallback de SPA: una ruta que no corresponde a un archivo devuelve el
  // index, para que recargar en /clientes o pegar un enlace no de 404.
  // Los assets con extension si dan 404, o un tipo mal escrito devolveria HTML
  // y el navegador reportaria un error de MIME imposible de diagnosticar.
  let archivoFinal = archivo;
  if (!archivo.startsWith(DIR_PUBLICO) || !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
    if (path.extname(url.pathname)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('no encontrado');
    }
    archivoFinal = path.join(DIR_PUBLICO, 'index.html');
    if (!fs.existsSync(archivoFinal)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('el panel no esta compilado: corre npm run build en server/panel');
    }
  }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(archivoFinal)] || 'application/octet-stream' });
  fs.createReadStream(archivoFinal).pipe(res);
});

servidor.listen(PUERTO_PANEL, '127.0.0.1', () => {
  console.log(`panel de Chatsuite escuchando en http://127.0.0.1:${PUERTO_PANEL}`);
});
