// La puerta del cliente al formulario de onboarding.
//
// Va aparte del resto de la API y se atiende ANTES de la guardia de sesion del
// panel, igual que el configurador del cliente: quien llena esto no tiene —ni
// debe tener— credenciales del panel. Su sesion es una cookie propia, atada a
// un solo formulario, que no sirve para nada mas.
//
// Todo lo que se escribe pasa por el id que sale de la cookie, nunca por un id
// que venga en el cuerpo: asi una sesion no puede tocar el formulario de otro
// negocio ni aunque lo pida explicitamente.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DIR_PUBLICO } from './config.js';
import * as formularios from './formularios.js';
import { preguntasDe } from './formulario-preguntas.js';

const HTML = path.join(DIR_PUBLICO, 'formulario', 'formulario.html');

const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
};

/** Lo que el cliente ve de su propio formulario. Nunca el token ni la clave. */
function vista(form) {
  return {
    id: form.id,
    negocio: form.negocio,
    tipoBot: form.tipoBot,
    estado: form.estado,
    actualizado: form.actualizado,
    respuestas: form.respuestas,
    origen: form.origen,
    adjuntos: form.adjuntos,
    ...preguntasDe(form.tipoBot),
    avance: formularios.avance(form.tipoBot, form.respuestas, form.adjuntos),
  };
}

/** Nombre con el que se guarda en disco. El del cliente solo se recuerda. */
function nombreSeguro(preguntaId, nombre) {
  const ext = path.extname(String(nombre || '')).slice(0, 12).replace(/[^A-Za-z0-9.]/g, '');
  return `${preguntaId}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

export async function atender(req, res, url, leerCuerpo, leerBinario) {
  const ruta = url.pathname;

  // El enlace que se le manda al cliente. El token no se valida aqui: la app se
  // dibuja igual y es /api/form/sesion quien dice si existe. Responder 404 en la
  // URL convertiria el enlace en un oraculo para adivinar tokens.
  if (ruta.startsWith('/f/')) {
    if (!fs.existsSync(HTML)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('el formulario no esta compilado: corre npm run panel');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(HTML).pipe(res);
  }

  const clave = `${req.method} ${ruta}`;

  // Unica ruta sin sesion: la que la crea.
  if (clave === 'POST /api/form/entrar') {
    const { token, clave: pin } = await leerCuerpo(req);
    const r = formularios.intentarEntrar(req, token, pin);
    if (!r.ok) return json(res, 401, { error: r.error });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': r.cookie,
    });
    return res.end(JSON.stringify({ ok: true, formulario: vista(r.form) }));
  }

  // Antes de entrar, el unico dato que se entrega es el nombre del negocio, y
  // solo a quien ya tiene el token. Sirve para que la pantalla de acceso diga
  // "Onboarding de X" en vez de un formulario anonimo.
  if (clave === 'GET /api/form/sesion') {
    const id = formularios.sesionDe(req);
    if (id) {
      const form = formularios.leer(id);
      if (form) return json(res, 200, { abierto: true, formulario: vista(form) });
    }
    const form = formularios.porToken(url.searchParams.get('token') || '');
    return json(res, 200, {
      abierto: false,
      existe: !!form,
      negocio: form?.negocio || null,
    });
  }

  const id = formularios.sesionDe(req);
  if (!id) return json(res, 401, { error: 'sesion expirada' });
  const form = formularios.leer(id);
  if (!form) return json(res, 404, { error: 'el formulario ya no existe' });

  switch (clave) {
    case 'GET /api/form/datos':
      return json(res, 200, { formulario: vista(form) });

    case 'PUT /api/form/respuesta': {
      // El guardado automatico pega aqui en cada pausa de tecleo. Devuelve el
      // avance para que la barra suba sin pedir el formulario entero.
      const { pregunta, valor } = await leerCuerpo(req);
      const avance = await formularios.guardarRespuesta(id, pregunta, valor, 'cliente');
      return json(res, 200, { avance, guardado: new Date().toISOString() });
    }

    case 'POST /api/form/adjunto': {
      const pregunta = url.searchParams.get('pregunta') || '';
      const nombre = url.searchParams.get('nombre') || 'archivo';
      const datos = await leerBinario(req, formularios.MAX_ADJUNTO_MB);
      if (!datos.length) return json(res, 400, { error: 'el archivo llego vacio' });

      const guardado = nombreSeguro(pregunta, nombre);
      const destino = path.join(formularios.rutaAdjuntos(id), guardado);
      fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o750 });
      fs.writeFileSync(destino, datos, { mode: 0o600 });

      const ficha = {
        nombre: String(nombre).slice(0, 200),
        guardado,
        bytes: datos.length,
        subido: new Date().toISOString(),
      };
      try {
        const { adjuntos, filas } = await formularios.registrarAdjunto(id, pregunta, ficha);
        const fresco = formularios.leer(id);
        return json(res, 200, {
          adjuntos,
          // En las preguntas con fotos, la subida ya dejo escrita la fila del
          // producto: se devuelve para que la pantalla no tenga que adivinarla.
          filas,
          avance: formularios.avance(fresco.tipoBot, fresco.respuestas, fresco.adjuntos),
        });
      } catch (err) {
        // Si el registro falla, el archivo que acaba de aterrizar no queda
        // huerfano ocupando disco sin que nadie sepa de el.
        fs.rmSync(destino, { force: true });
        throw err;
      }
    }

    case 'GET /api/form/adjunto/ver': {
      // La miniatura de una foto ya subida. Va en linea y no como descarga:
      // emparejar fotos con nombres a ciegas, por el nombre del fichero, es
      // justo lo que esta pregunta viene a evitar.
      const guardado = url.searchParams.get('guardado') || '';
      const ficha = Object.values(form.adjuntos || {}).flat().find((a) => a.guardado === guardado);
      if (!ficha) return json(res, 404, { error: 'ese adjunto no existe' });

      const base = formularios.rutaAdjuntos(id);
      const destino = path.resolve(base, guardado);
      if (!destino.startsWith(base) || !fs.existsSync(destino)) {
        return json(res, 404, { error: 'ese adjunto no existe' });
      }
      const tipos = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.heic': 'image/heic', '.gif': 'image/gif',
      };
      res.writeHead(200, {
        'content-type': tipos[path.extname(guardado).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'private, max-age=300',
      });
      return fs.createReadStream(destino).pipe(res);
    }

    case 'POST /api/form/adjunto/meta': {
      // Lo que el cliente escribe sobre una foto concreta: de que producto es,
      // su precio, su cantidad. Se guarda en la ficha del archivo.
      const { pregunta, guardado, meta } = await leerCuerpo(req);
      const ficha = await formularios.metaAdjunto(id, pregunta, guardado, meta);
      return json(res, 200, { adjunto: ficha });
    }

    case 'POST /api/form/adjunto/borrar': {
      const { pregunta, guardado } = await leerCuerpo(req);
      const lista = await formularios.quitarAdjunto(id, pregunta, guardado);
      const fresco = formularios.leer(id);
      return json(res, 200, {
        adjuntos: lista,
        avance: formularios.avance(fresco.tipoBot, fresco.respuestas, fresco.adjuntos),
      });
    }

    case 'POST /api/form/enviar':
      await formularios.marcarEntregado(id);
      return json(res, 200, { ok: true });

    default:
      return json(res, 404, { error: 'ruta no encontrada' });
  }
}
