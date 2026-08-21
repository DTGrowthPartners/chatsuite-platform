// Formularios de onboarding: uno por negocio que va a entrar a la plataforma.
//
// Existe porque cada negocio es distinto y el alta pedia los mismos datos una y
// otra vez por WhatsApp, a pedazos y sin quedar escritos en ningun lado. Aqui el
// dueño del negocio responde a su ritmo, se guarda solo, y al crear la instancia
// las respuestas se vuelcan sobre el perfil del bot.
//
// El almacenamiento sigue la linea de store.js: un directorio por formulario con
// su JSON, escritura atomica y cola de escrituras. Contiene datos del negocio
// (datos de pago, numeros del equipo), asi que va con permisos cerrados.
//
// La puerta del cliente es token largo + clave de seis digitos. El token va en
// el enlace e identifica el formulario; la clave se teclea. Asi un enlace
// reenviado a un grupo de WhatsApp no abre nada por si solo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DIR_TENANTS } from './config.js';
import {
  avance, preguntasDe, respondida, DIAS_SEMANA, PREGUNTAS, SECCIONES,
} from './formulario-preguntas.js';

export const DIR_FORMULARIOS = path.join(DIR_TENANTS, '_formularios');
const ARCHIVO_SECRETO = path.join(DIR_FORMULARIOS, '_secreto');
const NOMBRE_COOKIE = 'chatsuite_form';
const VIDA_SESION_DIAS = 30;

// 25 MB por archivo. El limite se aplica leyendo el cuerpo, no confiando en el
// content-length, porque ese encabezado lo pone el cliente.
export const MAX_ADJUNTO_MB = 25;

// Freno por intentos de clave, por token. En memoria: reiniciar el panel lo
// borra, pero eso ya exige acceso a la maquina.
const INTENTOS = new Map();
const MAX_INTENTOS = 10;
const VENTANA_MS = 15 * 60 * 1000;

let cola = Promise.resolve();

function asegurar() {
  fs.mkdirSync(DIR_FORMULARIOS, { recursive: true, mode: 0o750 });
}

function secreto() {
  asegurar();
  try { return fs.readFileSync(ARCHIVO_SECRETO, 'utf8').trim(); }
  catch {
    const nuevo = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(ARCHIVO_SECRETO, `${nuevo}\n`, { mode: 0o600 });
    return nuevo;
  }
}

const rutaForm = (id) => path.join(DIR_FORMULARIOS, id);
const rutaDatos = (id) => path.join(rutaForm(id), 'datos.json');
export const rutaAdjuntos = (id) => path.join(rutaForm(id), 'adjuntos');

/** Los ids son de nuestra cosecha, pero llegan por la URL: se validan igual. */
const idValido = (id) => typeof id === 'string' && /^[a-f0-9]{12}$/.test(id);

export function leer(id) {
  if (!idValido(id)) return null;
  try { return JSON.parse(fs.readFileSync(rutaDatos(id), 'utf8')); }
  catch { return null; }
}

function escribirAhora(form) {
  const dir = rutaForm(form.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const temporal = `${rutaDatos(form.id)}.tmp`;
  fs.writeFileSync(temporal, `${JSON.stringify(form, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporal, rutaDatos(form.id));
}

/** Aplica `mutador` sobre un formulario y lo persiste. Serializado. */
export function actualizar(id, mutador) {
  cola = cola.then(async () => {
    const form = leer(id);
    if (!form) throw new Error('el formulario no existe');
    const resultado = await mutador(form);
    form.actualizado = new Date().toISOString();
    escribirAhora(form);
    return resultado ?? form;
  });
  return cola;
}

export function listarIds() {
  asegurar();
  return fs.readdirSync(DIR_FORMULARIOS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && idValido(e.name))
    .map((e) => e.name);
}

// ---------------------------------------------------------------- alta y baja

export function crear({ negocio, tipoBot = 'tienda', contacto = '', nota = '' }) {
  const limpio = String(negocio || '').trim();
  if (!limpio) throw new Error('falta el nombre del negocio');
  if (!['tienda', 'citas', 'ambos'].includes(tipoBot)) throw new Error('tipo de bot invalido');

  const form = {
    version: 1,
    id: crypto.randomBytes(6).toString('hex'),
    token: crypto.randomBytes(24).toString('base64url'),
    // Seis digitos y no una frase: se dicta por telefono sin deletrear. El freno
    // por intentos es lo que la sostiene, no su longitud.
    clave: String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
    negocio: limpio,
    tipoBot,
    contacto: String(contacto || '').trim(),
    nota: String(nota || '').trim(),
    estado: 'abierto',           // abierto | entregado | usado
    creado: new Date().toISOString(),
    actualizado: new Date().toISOString(),
    entregadoEn: null,
    usadoEn: null,
    usadoPor: null,              // slug del tenant que lo consumio
    // Quien respondio cada cosa: el cliente o nosotros adelantandole trabajo.
    respuestas: {},
    origen: {},
    adjuntos: {},
  };
  asegurar();
  fs.mkdirSync(rutaAdjuntos(form.id), { recursive: true, mode: 0o750 });
  escribirAhora(form);
  return form;
}

export function eliminar(id) {
  if (!idValido(id)) throw new Error('id invalido');
  const dir = rutaForm(id);
  if (!fs.existsSync(dir)) throw new Error('el formulario no existe');
  fs.rmSync(dir, { recursive: true, force: true });
}

export const nuevaClave = (id) => actualizar(id, (f) => {
  f.clave = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  return f.clave;
});

// ------------------------------------------------------------------- consulta

/** Ficha corta para la lista del panel. */
export function resumen(form) {
  return {
    id: form.id,
    negocio: form.negocio,
    tipoBot: form.tipoBot,
    contacto: form.contacto,
    nota: form.nota,
    estado: form.estado,
    creado: form.creado,
    actualizado: form.actualizado,
    entregadoEn: form.entregadoEn,
    usadoEn: form.usadoEn,
    usadoPor: form.usadoPor,
    adjuntos: Object.values(form.adjuntos || {}).flat().length,
    avance: avance(form.tipoBot, form.respuestas, form.adjuntos),
  };
}

export function listar() {
  return listarIds()
    .map(leer)
    .filter(Boolean)
    .map(resumen)
    .sort((a, b) => b.creado.localeCompare(a.creado));
}

export function porToken(token) {
  if (!token) return null;
  for (const id of listarIds()) {
    const form = leer(id);
    // Comparacion en tiempo constante: el token es el que identifica, y
    // compararlo con === filtra por prefijo ante un atacante con cronometro.
    if (form && form.token.length === token.length
      && crypto.timingSafeEqual(Buffer.from(form.token), Buffer.from(token))) return form;
  }
  return null;
}

// --------------------------------------------------------------------- acceso

function firmar(payload) {
  return crypto.createHmac('sha256', secreto()).update(payload).digest('base64url');
}

function crearToken(id) {
  const payload = Buffer.from(JSON.stringify({
    f: id, exp: Date.now() + VIDA_SESION_DIAS * 24 * 3600 * 1000,
  })).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

/** Devuelve el id del formulario abierto en esta sesion, o null. */
export function sesionDe(req) {
  const cookies = String(req.headers.cookie || '').split(';').map((c) => c.trim());
  const bruto = cookies.find((c) => c.startsWith(`${NOMBRE_COOKIE}=`));
  if (!bruto) return null;
  const token = decodeURIComponent(bruto.slice(NOMBRE_COOKIE.length + 1));
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;

  const esperada = firmar(payload);
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const { f, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now() && idValido(f) ? f : null;
  } catch { return null; }
}

function cookie(valor, req, maxAge = VIDA_SESION_DIAS * 24 * 3600) {
  const seguro = req.headers['x-forwarded-proto'] === 'https';
  return [
    `${NOMBRE_COOKIE}=${valor}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    seguro ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

export function intentarEntrar(req, token, clave) {
  const ahora = Date.now();
  const llave = String(token || '').slice(0, 32);
  const previo = (INTENTOS.get(llave) || []).filter((t) => ahora - t < VENTANA_MS);
  if (previo.length >= MAX_INTENTOS) {
    const faltan = Math.ceil((VENTANA_MS - (ahora - previo[0])) / 60000);
    return { ok: false, error: `demasiados intentos, espera ${faltan} minutos` };
  }

  const form = porToken(String(token || ''));
  if (!form || String(clave || '').trim() !== form.clave) {
    INTENTOS.set(llave, [...previo, ahora]);
    return { ok: false, error: 'la clave no coincide' };
  }

  INTENTOS.delete(llave);
  return { ok: true, form, cookie: cookie(crearToken(form.id), req) };
}

// ------------------------------------------------------------------ respuesta

const PREGUNTAS_POR_ID = new Map(PREGUNTAS.map((p) => [p.id, p]));

export function guardarRespuesta(id, preguntaId, valor, origen = 'cliente') {
  const pregunta = PREGUNTAS_POR_ID.get(preguntaId);
  if (!pregunta) throw new Error(`pregunta desconocida: ${preguntaId}`);
  return actualizar(id, (f) => {
    if (valor === null || valor === undefined || valor === '') {
      delete f.respuestas[preguntaId];
      delete f.origen[preguntaId];
    } else {
      f.respuestas[preguntaId] = valor;
      f.origen[preguntaId] = origen;
    }

    // Borrar la fila de un producto se lleva su foto. Se recogen aqui, mirando
    // que archivos ya no referencia ninguna fila, en vez de pedirle al navegador
    // que llame a dos endpoints y confie en que ambos lleguen: si el segundo
    // falla, el archivo se queda ocupando disco para siempre.
    if (pregunta.fotos) {
      const usadas = new Set((f.respuestas[preguntaId] || [])
        .map((fila) => fila?.[pregunta.fotos.columna])
        .filter(Boolean));
      const vivos = [];
      for (const a of f.adjuntos[preguntaId] || []) {
        if (usadas.has(a.guardado)) { vivos.push(a); continue; }
        const destino = path.resolve(rutaAdjuntos(id), a.guardado);
        if (destino.startsWith(rutaAdjuntos(id))) fs.rmSync(destino, { force: true });
      }
      f.adjuntos[preguntaId] = vivos;
    }

    return avance(f.tipoBot, f.respuestas, f.adjuntos);
  });
}

/**
 * Un nombre presentable a partir del nombre del archivo.
 *
 * Devuelve cadena vacia cuando el archivo se llama como lo bautizo la camara
 * —IMG_0423, DSC00012, WhatsApp Image 2026…— porque ahi no hay informacion: es
 * preferible un campo en blanco, que salta a la vista y se rellena, a un nombre
 * de producto que dice «Img 0423» y que alguien da por bueno de un vistazo.
 */
export function nombreDesdeArchivo(nombre) {
  const base = String(nombre || '').replace(/\.[^.]+$/, '');
  const limpio = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return '';
  if (/^(img|dsc|dscn|photo|foto|image|imagen|pxl|screenshot|captura|whatsapp)\b/i.test(limpio)) return '';
  // Casi todo digitos: un numero de serie, no un nombre.
  if ((limpio.replace(/\D/g, '').length / limpio.length) > 0.5) return '';
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

export function registrarAdjunto(id, preguntaId, archivo) {
  if (!PREGUNTAS_POR_ID.has(preguntaId)) throw new Error(`pregunta desconocida: ${preguntaId}`);
  return actualizar(id, (f) => {
    const pregunta = PREGUNTAS_POR_ID.get(preguntaId);
    f.adjuntos[preguntaId] ||= [];
    // Una pregunta de archivo unico reemplaza; las de varios acumulan.
    if (!pregunta.varios && !pregunta.fotos) {
      for (const viejo of f.adjuntos[preguntaId]) {
        fs.rmSync(path.join(rutaAdjuntos(id), viejo.guardado), { force: true });
      }
      f.adjuntos[preguntaId] = [];
    }
    f.adjuntos[preguntaId].push(archivo);

    // En las preguntas de tipo lista con fotos, cada archivo estrena su fila. Se
    // hace aqui y no en el navegador para que subir veinte fotos seguidas no
    // dependa de veinte guardados encadenados: cada subida deja la fila escrita.
    if (pregunta.fotos) {
      f.respuestas[preguntaId] ||= [];
      const filas = f.respuestas[preguntaId];
      // Si hay una fila en blanco al final, la foto la ocupa en vez de sumar otra.
      const enBlanco = filas.findIndex((x) => !Object.values(x || {}).some((v) => String(v ?? '').trim()));
      const fila = {
        ...(enBlanco >= 0 ? filas[enBlanco] : {}),
        [pregunta.fotos.columna]: archivo.guardado,
        [pregunta.fotos.columnaNombre]: nombreDesdeArchivo(archivo.nombre),
      };
      if (enBlanco >= 0) filas[enBlanco] = fila;
      else filas.push(fila);
      f.origen[preguntaId] = 'cliente';
    }

    return { adjuntos: f.adjuntos[preguntaId], filas: f.respuestas[preguntaId] };
  });
}

/**
 * Los datos que el cliente escribe sobre un archivo concreto: de que producto es
 * la foto, su precio, su cantidad.
 *
 * Van sobre la ficha del adjunto y no en `respuestas` porque pertenecen al
 * archivo: si lo borra, se van con el. Guardarlos aparte dejaria datos huerfanos
 * apuntando a fotos que ya no existen.
 */
export function metaAdjunto(id, preguntaId, guardado, meta) {
  const pregunta = PREGUNTAS_POR_ID.get(preguntaId);
  if (!pregunta) throw new Error(`pregunta desconocida: ${preguntaId}`);
  const permitidos = new Set((pregunta.camposAdjunto || []).map((c) => c.id));
  if (!permitidos.size) throw new Error('esa pregunta no lleva datos por archivo');

  return actualizar(id, (f) => {
    const ficha = (f.adjuntos[preguntaId] || []).find((a) => a.guardado === guardado);
    if (!ficha) throw new Error('ese adjunto no existe');
    ficha.meta = Object.fromEntries(
      Object.entries(meta || {})
        .filter(([k]) => permitidos.has(k))
        .map(([k, v]) => [k, String(v ?? '').slice(0, 300)]),
    );
    return ficha;
  });
}

export function quitarAdjunto(id, preguntaId, guardado) {
  return actualizar(id, (f) => {
    const pregunta = PREGUNTAS_POR_ID.get(preguntaId);
    // Si la foto colgaba de una fila, la fila se queda pero sin ella: el
    // producto sigue existiendo aunque se retire la imagen.
    if (pregunta?.fotos) {
      for (const fila of f.respuestas[preguntaId] || []) {
        if (fila?.[pregunta.fotos.columna] === guardado) fila[pregunta.fotos.columna] = '';
      }
    }
    const lista = f.adjuntos[preguntaId] || [];
    const i = lista.findIndex((a) => a.guardado === guardado);
    if (i < 0) throw new Error('ese adjunto no existe');
    // El nombre guardado lo genera el servidor, pero se resuelve igual: un
    // '..' colado en el JSON no puede sacar el rm del directorio.
    const destino = path.resolve(rutaAdjuntos(id), lista[i].guardado);
    if (destino.startsWith(rutaAdjuntos(id))) fs.rmSync(destino, { force: true });
    lista.splice(i, 1);
    return lista;
  });
}

export const marcarEntregado = (id) => actualizar(id, (f) => {
  f.estado = f.estado === 'usado' ? 'usado' : 'entregado';
  f.entregadoEn ||= new Date().toISOString();
});

export const marcarUsado = (id, slug) => actualizar(id, (f) => {
  f.estado = 'usado';
  f.usadoEn = new Date().toISOString();
  f.usadoPor = slug;
});

// ---------------------------------------------------------------- volcado

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const lineas = (v) => texto(v).split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * La ventana en la que el bot responde, resuelta a [inicio, fin).
 *
 * Puede salir invertida (17→8) y eso es correcto: el motor entiende el cruce de
 * medianoche. Devuelve null cuando el cliente no lo definio, para no pisar el
 * valor por defecto del perfil con un cero.
 */
/**
 * Las fichas del equipo que el cliente escribio en el formulario.
 *
 * Nacen SIN `agente_id`: son el padron que el bot usa para no tratarlos como
 * clientes y para avisarles, pero todavia no pueden entrar a Chatsuite. El
 * panel las muestra marcadas como «sin acceso», que es la invitacion a darles
 * su usuario. Ver asesores.js.
 *
 * Antes esta pregunta era texto libre y de aqui solo se sacaban los numeros con
 * una expresion regular: el nombre y el rol se perdian, asi que el bot sabia a
 * que numeros no atender pero no quien era cada uno.
 */
export function fichasEquipo(form) {
  const filas = (form.respuestas || {}).equipo;
  if (!Array.isArray(filas)) return [];
  const ROLES = new Set(['dueño', 'supervisor', 'asesor']);
  const salida = [];
  const vistos = new Set();
  for (const f of filas) {
    const telefono = String(f?.telefono || '').replace(/[^0-9]/g, '');
    const nombre = texto(f?.nombre);
    if (!nombre && !telefono) continue;
    // Dos filas con el mismo numero le mandarian cada aviso por duplicado.
    if (telefono && vistos.has(telefono)) continue;
    if (telefono) vistos.add(telefono);
    const rolCrudo = texto(f?.rol).toLowerCase();
    const rol = ROLES.has(rolCrudo) ? rolCrudo : 'asesor';
    salida.push({
      nombre,
      telefono,
      rol,
      nivel: rol === 'dueño' ? 3 : (rol === 'supervisor' ? 2 : 1),
      temas: [],
      // El dueño quiere enterarse de todo; un asesor solo de lo urgente, o con
      // cinco personas nadie vuelve a mirar los avisos.
      avisos: rol === 'asesor' ? 'escalada' : 'todo',
      agente_id: null,
      email: texto(f?.correo).toLowerCase() || null,
    });
  }
  return salida;
}

/**
 * El horario de la agenda, dia por dia, listo para `citas.horario`.
 *
 * Devuelve null si el cliente no contesto nada: pisar el horario sembrado con
 * un objeto vacio dejaria la agenda entera sin huecos, y el bot contestaria
 * «no hay cupo» a todo sin un error en ningun log — que es exactamente el
 * fallo que esta pregunta viene a evitar.
 *
 * Un tramo con horas invalidas o al reves (de 18:00 a 09:00) se descarta en vez
 * de escribirse: el motor lo ignoraria igual (`_horario_del_dia` exige
 * `0 <= ini < fin`), pero guardado se ve como si estuviera configurado.
 */
function horarioSemana(valor) {
  if (!valor || typeof valor !== 'object') return null;
  const aMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
    if (!m) return -1;
    const [h, min] = [Number(m[1]), Number(m[2])];
    return h >= 0 && h <= 24 && min >= 0 && min < 60 ? (h * 60) + min : -1;
  };
  const hhmm = (t) => String(t).trim().padStart(5, '0');

  const salida = {};
  let alguno = false;
  for (const [llave] of DIAS_SEMANA) {
    const bruto = Array.isArray(valor[llave]) ? valor[llave] : [];
    const tramos = bruto
      .filter((t) => t && aMin(t.desde) >= 0 && aMin(t.hasta) > aMin(t.desde))
      .map((t) => ({ desde: hhmm(t.desde), hasta: hhmm(t.hasta) }));
    if (tramos.length) alguno = true;
    salida[llave] = tramos.length ? tramos : null;
  }
  return alguno ? salida : null;
}

function ventanaBot(r) {
  const v = r.horario_bot;
  const negocio = r.horario || {};
  if (!v?.modo) return null;
  if (v.modo === 'siempre') return { inicio: 0, fin: 24 };
  if (v.modo === 'negocio') {
    return Number.isInteger(negocio.desde) && Number.isInteger(negocio.hasta)
      ? { inicio: negocio.desde, fin: negocio.hasta }
      : null;
  }
  return Number.isInteger(v.desde) && Number.isInteger(v.hasta)
    ? { inicio: v.desde, fin: v.hasta }
    : null;
}

/**
 * Lo que el modal de alta puede rellenar solo. Es deliberadamente conservador:
 * solo campos donde la respuesta del cliente tiene una unica lectura posible.
 * Lo demas se propone en el perfil del bot, donde si hay contexto para revisarlo.
 */
export function datosParaAlta(form) {
  const r = form.respuestas || {};
  // El alta configura CUANDO RESPONDE EL BOT, no cuando atiende el negocio: son
  // dos cosas distintas y confundirlas deja al bot callado justo en las horas
  // que el cliente queria cubrir.
  const ventana = ventanaBot(r);
  const logo = (form.adjuntos?.logo || [])[0] || null;
  return {
    nombre: texto(r.nombre_comercial) || form.negocio,
    marca: texto(r.nombre_comercial),
    ciudad: texto(r.ciudad).split(',')[0].trim(),
    // El bot se llama como dijo el cliente; si no lo dijo, lo pone el alta.
    asistente: texto(r.nombre_bot),
    modulos: form.tipoBot === 'ambos' ? ['tienda', 'citas'] : [form.tipoBot],
    domicilios: respondida(null, r.zonas_domicilio),
    horaInicio: ventana ? ventana.inicio : null,
    horaFin: ventana ? ventana.fin : null,
    // Primer numero que aparezca en la respuesta de avisos: es a quien el bot
    // le escribe cuando necesita un dato.
    telefonoAvisos: (texto(r.avisos).match(/\+?\d[\d\s-]{7,}\d/) || [''])[0].replace(/[\s-]/g, ''),
    logo,
  };
}

/**
 * Aplica el formulario sobre un perfil de bot ya sembrado.
 *
 * Solo toca lo que el formulario contesta de forma inequivoca. Todo lo que es
 * matiz —el tono, las objeciones, las politicas— viaja en el briefing, porque
 * meterlo a la fuerza en un campo estructurado lo empobrece.
 */
export function aplicarAPerfil(form, perfil) {
  const r = form.respuestas || {};
  const p = structuredClone(perfil);

  if (texto(r.nombre_comercial)) p.negocio.nombre = texto(r.nombre_comercial);
  if (texto(r.ciudad)) p.negocio.ciudad = texto(r.ciudad).split(',')[0].trim();

  if (texto(r.nombre_bot)) p.persona.nombre = texto(r.nombre_bot);
  if (r.tuteo?.opcion) p.persona.tuteo = r.tuteo.opcion === 'tuteo';
  if (r.emojis?.opcion) p.persona.emojis = r.emojis.opcion;
  if (r.se_presenta?.opcion === 'asistente') p.persona.rol = 'asistente del negocio';

  const nunca = lineas(r.nunca_decir);
  if (nunca.length) p.persona.nunca = [...new Set([...p.persona.nunca, ...nunca])];

  const ESCALAR = {
    molesto: 'El cliente esta molesto, inconforme o pone un reclamo.',
    pide_persona: 'El cliente pide hablar con una persona.',
    negociacion: 'Quiere negociar el precio o condiciones especiales.',
    pago: 'Manda un comprobante o pregunta si le llego el pago.',
    reclamo: 'Pone un reclamo o pide una devolucion.',
    mayorista: 'Es un pedido mayorista grande.',
    no_sabe: 'Pregunta algo que no esta en su informacion.',
  };
  const marcadas = (r.cuando_escalar?.opciones || []).map((o) => ESCALAR[o]).filter(Boolean);
  const extra = texto(r.cuando_escalar?.nota);
  if (marcadas.length || extra) {
    p.persona.cuando_escalar = [...new Set([...marcadas, ...(extra ? [extra] : [])])];
  }

  // El horario de la AGENDA, que no es el del bot. Va tal cual porque la
  // pregunta tiene la misma forma que `citas.horario`: se pregunta por dia
  // justamente para no tener que adivinar nada aqui.
  if (p.citas) {
    const agenda = horarioSemana(r.horario_agenda);
    if (agenda) p.citas.horario = agenda;
  }

  const ventana = ventanaBot(r);
  if (ventana) {
    p.operacion.horario.inicio = ventana.inicio;
    p.operacion.horario.fin = ventana.fin;
  }
  if (texto(r.horario?.mensaje)) p.operacion.horario.mensaje_fuera = texto(r.horario.mensaje);

  if (r.bot_se_aparta?.opcion === 'no') p.operacion.pausa_humano_seg = 0;
  if (r.reenganche?.si === false) p.operacion.reenganche.activo = false;

  if (p.tienda) {
    if (r.catalogo_pdf?.si === false) p.tienda.pdf.activo = false;
    if (respondida(null, r.zonas_domicilio)) {
      p.tienda.domicilios.activo = true;
      if (texto(r.ciudad)) p.tienda.domicilios.ciudad = texto(r.ciudad).split(',')[0].trim();
    }
  }

  // Los numeros del equipo ya NO salen de aqui: la pregunta es una tabla y cada
  // fila se escribe como ficha en equipo.json (ver `fichasEquipo`), que es de
  // donde el motor los lee. `numeros_extra` queda para quien no esta en el
  // padron pero igual quiere el aviso.
  const preguntar = [...texto(r.avisos).matchAll(/\+?\d[\d\s-]{7,}\d/g)]
    .map((m) => m[0].replace(/[\s-]/g, ''));
  if (preguntar.length) p.alertas.numeros_pregunta = [...new Set(preguntar)];

  return p;
}

/**
 * El briefing: todo el formulario en markdown, tal como lo escribio el cliente.
 *
 * Va junto al tenant y es lo que se lee cuando el perfil no alcanza. Se escribe
 * completo aunque parte ya este mapeada: perder el texto original por haberlo
 * resumido en un campo es justo lo que este formulario venia a evitar.
 */
export function briefing(form) {
  const { secciones, preguntas } = preguntasDe(form.tipoBot);
  const r = form.respuestas || {};
  const out = [
    `# Briefing de onboarding — ${form.negocio}`,
    '',
    `Formulario \`${form.id}\` · tipo de bot: ${form.tipoBot} · creado ${form.creado.slice(0, 10)}`,
    `Respuestas: ${avance(form.tipoBot, r, form.adjuntos).hechas} de ${preguntas.length}.`,
    '',
    '> Lo escribio el cliente. No se corrigio la redaccion a proposito: de aqui',
    '> sale la voz del bot.',
    '',
  ];

  for (const seccion of secciones) {
    const suyas = preguntas.filter((p) => p.seccion === seccion.id);
    if (!suyas.some((p) => respondida(p, r[p.id]) || (form.adjuntos?.[p.id] || []).length)) continue;
    out.push(`## ${seccion.numero}. ${seccion.titulo}`, '');

    for (const pregunta of suyas) {
      const valor = r[pregunta.id];
      const archivos = form.adjuntos?.[pregunta.id] || [];
      if (!respondida(pregunta, valor) && !archivos.length) continue;

      out.push(`### ${pregunta.numero}. ${pregunta.pregunta}`);
      if (form.origen?.[pregunta.id] === 'dtgp') out.push('_(lo respondio DT Growth Partners)_');
      out.push('');
      out.push(...formatearValor(pregunta, valor, archivos));
      // En las listas con foto los archivos ya salen en su columna; repetirlos
      // debajo es la misma informacion dos veces.
      if (archivos.length && !pregunta.fotos) {
        out.push('', 'Adjuntos:');
        out.push(...archivos.map((a) => {
          // Lo que el cliente escribio sobre el archivo va en la misma linea:
          // el nombre del fichero por si solo casi nunca dice de que es.
          const datos = (pregunta.camposAdjunto || [])
            .map((c) => [c.etiqueta, texto(a.meta?.[c.id])])
            .filter(([, v]) => v)
            .map(([e, v]) => `${e}: ${v}`)
            .join(' · ');
          const peso = `${Math.round(a.bytes / 1024)} KB`;
          return `- \`${a.nombre}\` (${peso})${datos ? ` — ${datos}` : ''}`;
        }));
      }
      out.push('');
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

function formatearValor(pregunta, valor, archivos = []) {
  if (valor === undefined || valor === null) return [];
  if (pregunta.tipo === 'lista') {
    const filas = (Array.isArray(valor) ? valor : [])
      .filter((f) => Object.values(f || {}).some((v) => texto(v)));
    if (!filas.length) return [];
    // La foto es una columna mas en el briefing: quien lo lea tiene que poder
    // ir al archivo del producto sin cruzar dos listas a mano.
    const cols = pregunta.fotos
      ? [...(pregunta.columnas || []), { id: pregunta.fotos.columna, etiqueta: 'Foto' }]
      : (pregunta.columnas || []);

    // En la celda de la foto va el nombre con el que el cliente la subio, no el
    // que le pusimos en disco: quien lea esto tiene que poder buscarla.
    const porGuardado = new Map(archivos.map((a) => [a.guardado, a.nombre]));
    const celda = (fila, col) => (pregunta.fotos && col.id === pregunta.fotos.columna
      ? porGuardado.get(fila[col.id]) || ''
      : fila[col.id]);

    // Con una sola columna una tabla es ruido; con varias, una tabla markdown se
    // lee de un vistazo y sobrevive al copiar y pegar.
    if (cols.length === 1) return filas.map((f) => `- ${texto(celda(f, cols[0]))}`);

    // Las columnas de texto largo revientan cualquier tabla, asi que esas listas
    // van como bloques.
    if (cols.some((c) => c.largo)) {
      return filas.flatMap((f) => [
        ...cols.map((c) => (texto(celda(f, c)) ? `- **${c.etiqueta}:** ${texto(celda(f, c))}` : null))
          .filter(Boolean),
        '',
      ]).slice(0, -1);
    }

    const escapar = (v) => texto(v).replace(/\|/g, '\\|');
    return [
      `| ${cols.map((c) => c.etiqueta).join(' | ')} |`,
      `| ${cols.map(() => '---').join(' | ')} |`,
      ...filas.map((f) => `| ${cols.map((c) => escapar(celda(f, c)) || '—').join(' | ')} |`),
    ];
  }
  if (pregunta.tipo === 'ventana') {
    const hh = (h) => `${String(h).padStart(2, '0')}:00`;
    if (valor.modo === 'siempre') return ['Todo el dia, todos los dias'];
    if (valor.modo === 'negocio') return ['El mismo horario de atencion del negocio'];
    if (!Number.isInteger(valor.desde) || !Number.isInteger(valor.hasta)) return [];
    const cruza = valor.desde > valor.hasta;
    return [`De ${hh(valor.desde)} a ${hh(valor.hasta)}${cruza ? ' del dia siguiente' : ''}`];
  }
  if (pregunta.tipo === 'horario_semana') {
    const etiquetas = new Map(DIAS_SEMANA);
    return DIAS_SEMANA.map(([llave]) => {
      const tramos = Array.isArray(valor[llave]) ? valor[llave] : [];
      const util = tramos.filter((t) => t && t.desde && t.hasta);
      return `- ${etiquetas.get(llave)}: `
        + (util.length ? util.map((t) => `${t.desde}-${t.hasta}`).join(' y ') : 'no se agenda');
    });
  }
  if (pregunta.tipo === 'horario') {
    const h = valor;
    const rango = Number.isInteger(h.desde) && Number.isInteger(h.hasta)
      ? `De ${String(h.desde).padStart(2, '0')}:00 a ${String(h.hasta).padStart(2, '0')}:00`
      : '';
    return [
      [rango, texto(h.dias) && `Dias: ${texto(h.dias)}`].filter(Boolean).join(' · '),
      texto(h.mensaje) && `Fuera de horario: "${texto(h.mensaje)}"`,
    ].filter(Boolean);
  }
  if (typeof valor === 'object' && valor.opciones) {
    const etiquetas = valor.opciones
      .map((o) => pregunta.opciones?.find((x) => x.id === o)?.texto || o);
    return [
      ...etiquetas.map((e) => `- ${e}`),
      ...(valor.notas || []).map((n) => texto(n)).filter(Boolean).map((n) => `- ${n}`),
      texto(valor.nota) && `- ${texto(valor.nota)}`,
    ].filter(Boolean);
  }
  if (typeof valor === 'object' && valor.opcion !== undefined) {
    const etiqueta = pregunta.opciones?.find((x) => x.id === valor.opcion)?.texto || valor.opcion;
    return [etiqueta, texto(valor.nota)].filter(Boolean);
  }
  if (typeof valor === 'object' && valor.si !== undefined) {
    return [valor.si ? 'Si' : 'No', texto(valor.texto)].filter(Boolean);
  }
  if (typeof valor === 'object') return [JSON.stringify(valor)];

  const s = texto(valor);
  if (!s) return [];
  // Los textos largos van en cita para que se distingan de nuestras notas.
  return s.includes('\n') ? s.split('\n').map((l) => `> ${l}`) : [s];
}

export { avance, preguntasDe, SECCIONES, PREGUNTAS };
