// Bots de los tenants: aprovisionamiento, configuracion y simulador.
//
// El motor vive aparte (/home/ubuntu/chatsuite-bot) y es UNO solo para todos
// los clientes; lo que cambia por cliente es su perfil. Este modulo es el
// puente entre el panel y ese perfil: crea el directorio del bot, saca los
// tokens de Chatwoot, deja el AgentBot creado, publica el webhook en nginx y
// levanta el proceso.
//
// Todo lo configurable vive en /srv/chatsuite/<slug>/bot/perfil.json, que el
// motor relee al cambiar el mtime: guardar desde el panel aplica al instante,
// sin reiniciar nada.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { PUERTO_PANEL, RAIZ_APP, contenedor } from './config.js';
import { correr } from './provision.js';
import { actualizar, obtener, rutaTenant, leer as leerEstado } from './store.js';

// El motor vive en este mismo repo: panel y motor cambian juntos (el panel
// escribe el perfil.json que el motor lee y llama a su API para el simulador),
// asi que versionarlos aparte solo produce desincronizacion.
export const MOTOR = process.env.MOTOR_BOT || path.resolve(RAIZ_APP, '..', 'bot-engine');
export const PYTHON = path.join(MOTOR, 'venv', 'bin', 'python');

// Rango propio, por encima del de los Chatsuite (3210-3299) para que no se
// pisen nunca. Un bot son ~80 MB, asi que el techo real tampoco es este rango.
export const PUERTO_BOT_MIN = 3310;
export const PUERTO_BOT_MAX = 3399;

export const rutaBot = (slug) => path.join(rutaTenant(slug), 'bot');
export const rutaData = (slug) => path.join(rutaBot(slug), 'data');
const contenedorRails = (slug) => contenedor(slug, 'rails');
export const procesoPm2 = (slug) => `bot-${slug}`;

// Archivos de datos que el panel puede editar, con su forma. La lista es
// cerrada a proposito: es lo que evita que el panel escriba cualquier ruta.
export const DATOS = {
  'negocio.md': { tipo: 'texto', vacio: '' },
  'catalogo.json': { tipo: 'json', vacio: [] },
  'respuestas.json': { tipo: 'json', vacio: [] },
  'domicilios.json': { tipo: 'json', vacio: [] },
  'equipo.json': { tipo: 'json', vacio: [] },
  'pedidos.json': { tipo: 'json', vacio: [], soloLectura: true },
  // Modulo citas
  'cierres.json': { tipo: 'json', vacio: [] },
  'citas.json': { tipo: 'json', vacio: [], soloLectura: true },
  // El unico que no vive en data/: es el prompt escrito a mano del modo
  // experto, y el motor lo lee de prompts/system.md.
  'system.md': { tipo: 'texto', vacio: '', dir: 'prompts' },
};

export function puertosBotUsados() {
  return new Set(leerEstado().tenants.map((t) => t.bot?.puerto).filter(Boolean));
}

/**
 * Puertos que ya tiene alguien escuchando en la maquina.
 *
 * tenants.json NO es la lista completa de lo que corre aqui: los bots de
 * ensayo y todo lo que se levanto a mano viven en pm2 y no aparecen ahi. Dar
 * un puerto ocupado no falla de forma visible —el proceso nuevo entra en bucle
 * de reinicio, pm2 lo da por levantado y el alta sigue— y ademas el panel se
 * queda hablando con el bot DE OTRO CLIENTE, que responde con normalidad.
 * Paso: el bot de un tenant nuevo se llevo el 3311, que era del ensayo de Tu
 * Bodega.
 */
export function puertosEnEscucha() {
  try {
    const salida = execFileSync('ss', ['-ltnH'], { encoding: 'utf8' });
    return new Set(salida.split('\n')
      .map((l) => /:(\d+)\s*$/.exec(l.trim().split(/\s+/)[3] || ''))
      .filter(Boolean)
      .map((m) => Number(m[1])));
  } catch {
    // Sin `ss` se pierde la red de seguridad, pero no se bloquea un alta.
    return new Set();
  }
}

export function asignarPuertoBot() {
  const usados = puertosBotUsados();
  const escuchando = puertosEnEscucha();
  for (let p = PUERTO_BOT_MIN; p <= PUERTO_BOT_MAX; p += 1) {
    if (!usados.has(p) && !escuchando.has(p)) return p;
  }
  throw new Error('no quedan puertos libres para bots');
}

// --- perfil ------------------------------------------------------------------

export function perfilPorDefecto(tenant) {
  return {
    version: 1,
    slug: tenant.slug,
    // Arranca en borrador SIEMPRE: un bot recien creado no le escribe a nadie
    // hasta que alguien lo mueva a produccion a mano.
    estado: 'borrador',
    negocio: {
      // El bot se presenta con la marca comercial, no con la razon social.
      nombre: tenant.marca || tenant.nombre,
      ciudad: tenant.ciudad || '',
      zona_horaria: tenant.zonaHoraria || 'America/Bogota',
      moneda: 'COP',
      color: tenant.color,
      contacto: tenant.sitio || '',
    },
    chatsuite: {
      inbox_id: null,
      contenedor_rails: contenedorRails(tenant.slug),
    },
    canal: {
      tipo: 'evolution',
      evolution: { url: '', instancia: tenant.slug },
      cloud_api: {
        plantilla_alerta: '', plantilla_alerta_idioma: 'es',
        plantilla_reenganche: '', plantilla_reenganche_idioma: 'es',
      },
    },
    audiencia: 'clientes',
    modulos: ['tienda'],
    modelo: { nombre: 'claude-sonnet-4-6', max_tokens: 1000, max_historial: 30 },
    persona: {
      nombre: '', rol: 'asesor comercial', tuteo: true, emojis: 'pocos',
      max_lineas: 3, formato_precio: '$150.000', modo_experto: false,
      quien_te_escribe: '',
      reglas: [
        'UNA sola pregunta por mensaje.',
        'Todo mensaje tuyo termina en una pregunta o en una accion concreta.',
        'Nunca repitas una frase que ya usaste en ese chat.',
      ],
      flujo: '',
      nunca: ['Inventar precios, promociones o datos que no esten en el catalogo.'],
      cuando_escalar: [
        'El cliente pide hablar con una persona.',
        'Esta molesto, inconforme o pone un reclamo.',
        'Quiere negociar el precio o condiciones especiales.',
      ],
    },
    operacion: {
      horario: { inicio: 8, fin: 20, mensaje_fuera: 'ya por hoy cerramos, mañana te respondo temprano' },
      ritmo: { respuesta_min_seg: 15, respuesta_max_seg: 60, max_salientes_hora: 80 },
      pausa_humano_seg: 3600,
      mensaje_handoff: 'ya te comunico con mi compañero, un momento',
      reenganche: { activo: true, ventana_dias: 7 },
    },
    tienda: {
      catalogo: { fotos_por_tanda: 4 },
      pdf: { activo: true, titulo: `Catalogo ${tenant.nombre}` },
      domicilios: { activo: false, etiqueta: 'zona', ciudad: '' },
    },
    // Va siempre, aunque el modulo este apagado, igual que `tienda`: el editor
    // tolera que falte, pero un bot de citas sin horario no tiene un solo hueco
    // libre y contesta "no hay cupo" a todo. Se arranca con L-V y corte de
    // almuerzo, que es lo mas comun, y el cliente lo ajusta.
    citas: {
      agenda: 'propia',
      duracion_min: 30,
      paso_min: 30,
      anticipacion_min: 60,
      direccion: '',
      servicios: [],
      profesionales: [],
      horario: {
        lunes: [{ desde: '08:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }],
        martes: [{ desde: '08:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }],
        miercoles: [{ desde: '08:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }],
        jueves: [{ desde: '08:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }],
        viernes: [{ desde: '08:00', hasta: '12:00' }, { desde: '14:00', hasta: '18:00' }],
        sabado: null,
        domingo: null,
      },
    },
    etiquetas: structuredClone(ETIQUETAS_POR_MODULO.tienda),
    alertas: { usar_equipo: true, numeros_extra: [], numeros_pregunta: [], tipos_whatsapp: ['escalada'] },
  };
}

/**
 * Aplica sobre el perfil lo que se eligio en el modal de alta.
 *
 * Va aparte de perfilPorDefecto porque `preparar` conserva un perfil existente:
 * sembrar aqui deja reintentar el alta del bot sin pisar lo ya configurado a
 * mano, salvo los campos que el alta si define.
 */
// El catalogo de etiquetas es cerrado —Chatwoot crea al vuelo cualquiera que
// reciba—, asi que tiene que corresponder a lo que el bot hace: «pedido» y
// «domicilio» no le sirven a una clinica, ni «reagenda» a una tienda.
const ETIQUETAS_POR_MODULO = {
  tienda: [
    { nombre: 'pedido', titulo: '📦 Pedidos' },
    { nombre: 'cotizacion', titulo: '💬 Cotizaciones' },
    { nombre: 'domicilio', titulo: '🛵 Domicilios' },
    { nombre: 'reclamo', titulo: '⚠️ Reclamos' },
    { nombre: 'seguimiento', titulo: '🔁 Seguimiento' },
  ],
  citas: [
    { nombre: 'cita', titulo: '📅 Citas' },
    { nombre: 'reagenda', titulo: '🔄 Reagendadas' },
    { nombre: 'cancelacion', titulo: '❌ Canceladas' },
    { nombre: 'reclamo', titulo: '⚠️ Reclamos' },
    { nombre: 'seguimiento', titulo: '🔁 Seguimiento' },
  ],
};

/**
 * Deja los bloques de la agenda dentro de [inicio, fin]. Un bloque que quede
 * sin minutos se cae: es preferible un dia sin agenda —visible al configurar—
 * a un turno de cero minutos que el motor ofreceria igual.
 */
function recortarAgenda(horario, inicio, fin) {
  const aMin = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h * 60) + (m || 0);
  };
  const aTexto = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const desde = inicio === null ? 0 : inicio * 60;
  const hasta = fin === null ? 24 * 60 : fin * 60;

  for (const dia of Object.keys(horario)) {
    const bloques = horario[dia];
    if (!Array.isArray(bloques)) continue;
    const recortados = bloques
      .map((b) => ({ d: Math.max(aMin(b.desde), desde), h: Math.min(aMin(b.hasta), hasta) }))
      .filter((b) => b.h > b.d)
      .map((b) => ({ desde: aTexto(b.d), hasta: aTexto(b.h) }));
    horario[dia] = recortados.length ? recortados : null;
  }
}

export function sembrarPerfil(slug, opciones = {}) {
  const perfil = leerPerfil(slug);
  if (!perfil) return;
  if (opciones.asistente) {
    perfil.persona ??= {};
    perfil.persona.nombre = opciones.asistente;
  }

  // Los modulos se combinan: una barberia que ademas vende productos quiere los
  // dos. Las etiquetas se acumulan sin repetir, porque cada modulo trae las
  // suyas y varias coinciden (reclamo, seguimiento).
  const modulos = (opciones.modulos?.length ? opciones.modulos
    : (opciones.modulo ? [opciones.modulo] : []))
    .filter((m) => ETIQUETAS_POR_MODULO[m]);
  if (modulos.length) {
    perfil.modulos = [...new Set(modulos)];
    const vistas = new Map();
    for (const m of perfil.modulos) {
      for (const e of ETIQUETAS_POR_MODULO[m]) if (!vistas.has(e.nombre)) vistas.set(e.nombre, e);
    }
    perfil.etiquetas = [...vistas.values()];
  }

  // Sin esto el bot llena la pestaña Domicilios y no ofrece ninguno: el modulo
  // mira `activo`, no si hay zonas cargadas.
  //
  // Los `??=` son porque este perfil puede venir de disco, de un alta anterior:
  // si le falta una seccion, sembrar no puede reventar a mitad y dejar el perfil
  // sin escribir.
  if (opciones.domicilios !== undefined) {
    perfil.tienda ??= {};
    perfil.tienda.domicilios ??= {};
    perfil.tienda.domicilios.activo = Boolean(opciones.domicilios);
    if (opciones.ciudad) perfil.tienda.domicilios.ciudad = opciones.ciudad;
  }

  // Fuera de este rango el bot contesta el mensaje de «ya cerramos» a toda hora,
  // asi que una hora invalida se ignora en vez de escribirse.
  const hora = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 24
    ? Number(v) : null);
  const inicio = hora(opciones.horario?.inicio);
  const fin = hora(opciones.horario?.fin);
  if (inicio !== null || fin !== null) {
    perfil.operacion ??= {};
    perfil.operacion.horario ??= {};
    if (inicio !== null) perfil.operacion.horario.inicio = inicio;
    if (fin !== null) perfil.operacion.horario.fin = fin;
    // La agenda es OTRO horario —nace 8-12 y 14-18— y el del alta no la tocaba:
    // se elegia atender de 9 a 19 y el bot seguia ofreciendo las 8:00. Se
    // recorta, nunca se estira: los bloques y el corte de almuerzo son del
    // cliente, aqui solo se le quita lo que cae fuera de lo que dijo.
    if (perfil.citas?.horario) recortarAgenda(perfil.citas.horario, inicio, fin);
  }

  escribirPerfil(slug, perfil);

  // El numero de avisos va a equipo.json, que es de donde el motor saca a quien
  // avisar. Sin una sola entrada, `escalar_a_humano` deja la nota en Chatsuite
  // y NO le escribe a nadie: el cliente pide un humano y nadie se entera.
  const telefono = String(opciones.telefonoAvisos || '').replace(/[^0-9]/g, '');
  if (telefono) {
    const equipo = leerDato(slug, 'equipo.json') || [];
    if (!equipo.some((x) => String(x.telefono || '').replace(/[^0-9]/g, '') === telefono)) {
      escribirDato(slug, 'equipo.json', [...equipo, {
        nombre: opciones.nombreAvisos || 'Dueño', telefono, rol: 'dueño',
      }]);
    }
  }
}

export function leerPerfil(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaBot(slug), 'perfil.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export function escribirPerfil(slug, perfil) {
  if (!perfil || typeof perfil !== 'object' || perfil.slug !== slug) {
    throw new Error('el perfil no corresponde a este cliente');
  }
  const dir = rutaBot(slug);
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, 'perfil.json');
  const temporal = `${destino}.tmp`;
  // Atomico: el motor puede estar leyendolo en el mismo instante.
  fs.writeFileSync(temporal, `${JSON.stringify(perfil, null, 2)}\n`);
  fs.renameSync(temporal, destino);
}

// --- archivos de datos -------------------------------------------------------

/** data/ para casi todo; prompts/ para el prompt del modo experto. */
const rutaDe = (slug, spec) => (spec.dir === 'prompts'
  ? path.join(rutaBot(slug), 'prompts')
  : rutaData(slug));

export function leerDato(slug, archivo) {
  const spec = DATOS[archivo];
  if (!spec) throw new Error(`archivo no permitido: ${archivo}`);
  try {
    const crudo = fs.readFileSync(path.join(rutaDe(slug, spec), archivo), 'utf8');
    return spec.tipo === 'json' ? JSON.parse(crudo) : crudo;
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(spec.vacio);
    throw err;
  }
}

export function escribirDato(slug, archivo, contenido) {
  const spec = DATOS[archivo];
  if (!spec) throw new Error(`archivo no permitido: ${archivo}`);
  if (spec.soloLectura) throw new Error(`${archivo} lo escribe el bot, no el panel`);
  if (spec.tipo === 'json' && !Array.isArray(contenido)) {
    throw new Error(`${archivo} debe ser una lista`);
  }
  const dir = rutaDe(slug, spec);
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, archivo);
  const temporal = `${destino}.tmp`;
  fs.writeFileSync(temporal, spec.tipo === 'json'
    ? `${JSON.stringify(contenido, null, 2)}\n`
    : String(contenido));
  fs.renameSync(temporal, destino);
}

/** Guarda la foto de un producto y devuelve el nombre del archivo. */
/**
 * El siguiente id de producto de este cliente.
 *
 * Se toma el mayor y se suma uno, en vez de rellenar huecos: un id reciclado
 * heredaria la foto del producto borrado —los archivos se llaman por id— y el
 * bot mandaria la imagen equivocada, que es de los fallos mas dificiles de ver.
 * Por eso ademas cuentan las fotos que quedaron en disco, no solo el catalogo.
 */
export function siguienteIdProducto(slug) {
  const numeros = [0];
  const anotar = (texto) => {
    const m = /^p(\d+)$/i.exec(String(texto || '').trim());
    if (m) numeros.push(Number(m[1]));
  };

  for (const producto of leerDato(slug, 'catalogo.json') || []) anotar(producto?.id);
  try {
    for (const archivo of fs.readdirSync(path.join(rutaData(slug), 'catalogo-fotos'))) {
      anotar(path.parse(archivo).name);
    }
  } catch { /* todavia no hay fotos */ }

  return `p${String(Math.max(...numeros) + 1).padStart(3, '0')}`;
}

export function guardarFoto(slug, id, base64) {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(base64 || '');
  if (!m) throw new Error('la foto debe ser PNG, JPG o WEBP');
  const extension = m[1] === 'jpeg' ? 'jpg' : m[1];
  const limpio = String(id).replace(/[^a-z0-9._-]/gi, '-');
  const dir = path.join(rutaData(slug), 'catalogo-fotos');
  fs.mkdirSync(dir, { recursive: true });
  const nombre = `${limpio}.${extension}`;
  fs.writeFileSync(path.join(dir, nombre), Buffer.from(m[2], 'base64'));
  return nombre;
}

// --- Chatwoot: tokens, AgentBot y etiquetas ---------------------------------

/**
 * Deja creado el AgentBot y devuelve los DOS tokens que el motor necesita.
 *
 * Hacen falta los dos y no es evidente: el del AgentBot manda mensajes, pero
 * Chatwoot le niega el GET del historial y el POST de etiquetas con 401 — para
 * eso hace falta el de un usuario agente. Con uno solo el bot responde igual y
 * las etiquetas simplemente no aparecen, sin un error visible.
 */
export async function tokensYBot(slug, urlWebhook, log) {
  const tenant = obtener(slug);
  const ruby = `
    account = Account.first
    user = User.find_by(email: ${JSON.stringify(tenant.admin.email)}) || account.users.first
    bot = AgentBot.find_or_initialize_by(account_id: account.id, name: ${JSON.stringify(`Asistente ${tenant.nombre}`)})
    bot.bot_type = 'webhook'
    bot.outgoing_url = ${JSON.stringify(urlWebhook)}
    bot.save!
    # El access_token lo crea un callback al guardar; en un bot recien creado la
    # asociacion puede venir sin cargar, y sin reload esto revienta con nil.
    bot.reload
    AccessToken.create!(owner: bot) if bot.access_token.nil?
    AccessToken.create!(owner: user) if user.access_token.nil?
    puts "JSON:" + { account_id: account.id, bot_id: bot.id,
                     bot_token: bot.reload.access_token.token,
                     read_token: user.reload.access_token.token }.to_json
  `.trim();
  const { salida } = await correr('docker', [
    'exec', contenedorRails(slug), 'bundle', 'exec', 'rails', 'runner', ruby,
  ], { log });
  const linea = salida.split('\n').reverse().find((l) => l.startsWith('JSON:'));
  if (!linea) throw new Error('no se pudieron obtener los tokens de Chatsuite');
  return JSON.parse(linea.slice(5));
}

/**
 * Deja la pestaña «Mi asistente» dentro del panel de conversacion de Chatsuite.
 *
 * Es una Dashboard App nativa, no un parche de la interfaz: sobrevive a los
 * upgrades de Chatwoot y al rebuild de la imagen. Solo se ve dentro de una
 * conversacion —limite de la feature—, por eso ademas hay un boton flotante
 * inyectado por nginx.
 */
export async function registrarDashboardApp(slug, log) {
  const tenant = obtener(slug);
  const url = `https://${tenant.dominio}/bot/config/`;
  const ruby = `
    account = Account.first
    app = DashboardApp.find_or_initialize_by(account_id: account.id, title: 'Mi asistente')
    app.user = account.users.first if app.user_id.nil?
    app.content = [{ 'type' => 'frame', 'url' => ${JSON.stringify(url)} }]
    app.save!
    puts "JSON:" + { id: app.id }.to_json
  `.trim();
  const { salida } = await correr('docker', [
    'exec', contenedorRails(slug), 'bundle', 'exec', 'rails', 'runner', ruby,
  ], { log, permitirFallo: true });
  const linea = salida.split('\n').reverse().find((l) => l.startsWith('JSON:'));
  // Que falle no justifica tumbar el alta: el boton flotante sigue dando acceso
  // y esto se reintenta solo la proxima vez que se prepare el bot.
  if (!linea) log?.('no pude crear la pestaña del asistente en Chatsuite; queda el boton flotante');
  return linea ? JSON.parse(linea.slice(5)) : null;
}

/**
 * Crea en Chatsuite las etiquetas del perfil y una vista guardada por cada una.
 *
 * Las dos cosas juntas a proposito: son sistemas separados (la whitelist vive
 * en el perfil del bot, las vistas en Chatwoot) y tenerlos desincronizados es
 * justo lo que dejo etiquetas huerfanas en Laura/Sandra.
 */
export async function sincronizarEtiquetas(slug, log) {
  const perfil = leerPerfil(slug);
  if (!perfil) throw new Error('este cliente todavia no tiene bot');
  const etiquetas = (perfil.etiquetas || []).filter((e) => e.nombre);

  // Los atributos los declara cada MODULO, no el perfil: agregar un modulo
  // nuevo no debe obligar a tocar el panel. Se le preguntan al propio bot.
  let atributos = [];
  try {
    const esquema = await alBot(slug, '/bot/admin/esquema', { timeoutMs: 15000 });
    atributos = esquema.atributos || [];
  } catch (err) {
    log?.(`no se pudo leer el esquema del bot (${err.message}); solo se sincronizan etiquetas`);
  }
  if (!etiquetas.length && !atributos.length) return { etiquetas: 0, vistas: 0, atributos: 0 };

  // Las etiquetas viajan por variable de entorno y NO interpoladas en el codigo.
  // Motivo: {"nombre":"pedido"} es JSON valido pero Ruby lo lee como clave
  // SIMBOLO, asi que e['nombre'] daba nil, el title quedaba vacio y el save!
  // reventaba con RecordInvalid. Con JSON.parse las claves son strings de verdad.
  const ruby = `
    account = Account.first
    usuario = account.users.first
    creadas = 0
    vistas = 0
    JSON.parse(ENV.fetch('ETIQUETAS_JSON')).each do |e|
      nombre = e['nombre']
      etiqueta = account.labels.find_or_initialize_by(title: nombre)
      if etiqueta.new_record?
        etiqueta.color = e['color'] || '#1F93FF'
        etiqueta.save!
        creadas += 1
      end
      titulo = e['titulo'].presence || nombre
      filtro = account.custom_filters.find_or_initialize_by(name: titulo, filter_type: :conversation, user_id: usuario.id)
      if filtro.new_record?
        filtro.query = { payload: [{ attribute_key: 'labels', filter_operator: 'equal_to',
                                     values: [nombre], query_operator: nil, attribute_model: 'standard' }] }
        filtro.save!
        vistas += 1
      end
    end
    # Sin la DEFINICION, Chatwoot guarda el valor del atributo pero no lo
    # muestra en la barra lateral ni deja filtrar por el: se ve como si el bot
    # no hubiera escrito nada.
    TIPOS = { 'text' => 0, 'number' => 1, 'currency' => 2, 'percent' => 3,
              'link' => 4, 'date' => 5, 'list' => 6, 'checkbox' => 7 }
    MODELOS = { 'conversacion' => 'conversation_attribute', 'contacto' => 'contact_attribute' }
    atributos = 0
    JSON.parse(ENV.fetch('ATRIBUTOS_JSON', '[]')).each do |a|
      modelo = MODELOS[a['modelo']] || 'conversation_attribute'
      d = account.custom_attribute_definitions.find_or_initialize_by(
        attribute_key: a['clave'], attribute_model: modelo
      )
      next unless d.new_record?
      d.attribute_display_name = a['titulo'].presence || a['clave']
      d.attribute_display_type = TIPOS[a['tipo']] || 0
      d.attribute_values = a['valores'] if a['valores'].present?
      d.save!
      atributos += 1
    end
    puts "JSON:" + { etiquetas: creadas, vistas: vistas, atributos: atributos }.to_json
  `.trim();
  const { salida } = await correr('docker', [
    'exec',
    '-e', `ETIQUETAS_JSON=${JSON.stringify(etiquetas)}`,
    '-e', `ATRIBUTOS_JSON=${JSON.stringify(atributos)}`,
    contenedorRails(slug), 'bundle', 'exec', 'rails', 'runner', ruby,
  ], { log });
  const linea = salida.split('\n').reverse().find((l) => l.startsWith('JSON:'));
  return linea ? JSON.parse(linea.slice(5)) : { etiquetas: 0, vistas: 0, atributos: 0 };
}

// --- nginx -------------------------------------------------------------------

/**
 * Publica el webhook del bot en el dominio del cliente.
 *
 * /bot/admin/ queda con 403: son los interruptores del bot y no tienen por que
 * ser alcanzables desde internet. El panel los llama por 127.0.0.1.
 */
export async function publicarNginx(slug, puerto, log) {
  const tenant = obtener(slug);
  const dir = path.join(rutaTenant(slug), 'nginx-extra');
  fs.mkdirSync(dir, { recursive: true });
  const conf = `# Bot de ${tenant.nombre}. Generado por el panel, no editar a mano.
location /bot/admin/ { deny all; return 403; }
location /bot/simular { deny all; return 403; }

# El configurador del cliente: mismas pestañas que en nuestro panel, servidas
# por el panel (:${PUERTO_PANEL}) pero en el dominio del cliente, para que el iframe sea del
# mismo origen que Chatwoot y herede su sesion. Va ANTES de /bot/ porque nginx
# elige el prefijo mas largo, no el orden.
location /bot/config/ {
    proxy_pass http://127.0.0.1:${PUERTO_PANEL}/cliente/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 15m;
    proxy_read_timeout 120s;
}

# El boton flotante. Las Dashboard Apps de Chatwoot solo salen dentro de una
# conversacion, asi que el acceso general se inyecta en el HTML del dashboard.
# Va en /app y NO en /: en el location general dejaria todos los assets de
# Chatwoot sin gzip, porque sub_filter obliga a pedir sin comprimir.
location /app {
    proxy_pass http://127.0.0.1:${tenant.puerto};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Accept-Encoding "";
    sub_filter '</body>' '<script src="/bot/config/inyector.js"></script></body>';
    sub_filter_once on;
    proxy_read_timeout 300s;
}

location /bot/ {
    proxy_pass http://127.0.0.1:${puerto};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
`;
  fs.writeFileSync(path.join(dir, 'bot.conf'), conf);
  // nginx -t antes del reload: un archivo malo tumba TODOS los sitios.
  await correr('sudo', ['nginx', '-t'], { log });
  await correr('sudo', ['systemctl', 'reload', 'nginx'], { log });
}

export async function despublicarNginx(slug, log) {
  const archivo = path.join(rutaTenant(slug), 'nginx-extra', 'bot.conf');
  if (!fs.existsSync(archivo)) return;
  fs.rmSync(archivo, { force: true });
  await correr('sudo', ['nginx', '-t'], { log });
  await correr('sudo', ['systemctl', 'reload', 'nginx'], { log });
}

// --- proceso -----------------------------------------------------------------

export async function arrancar(slug, log) {
  const tenant = obtener(slug);
  const bot = tenant?.bot;
  if (!bot?.puerto) throw new Error('este cliente no tiene bot aprovisionado');
  const nombre = procesoPm2(slug);
  // OJO con --update-env: pm2 toma el entorno del proceso que lo invoca, que es
  // el panel. Sin pasarle estas dos, el bot reiniciaria apuntando al perfil por
  // defecto en vez del de su cliente — y responderia con la configuracion de
  // otro sin que nada fallara.
  const entorno = { CHATSUITE_BOT_PERFIL: rutaBot(slug), PORT: String(bot.puerto) };
  const { codigo } = await correr('pm2', ['describe', nombre], { permitirFallo: true });
  if (codigo === 0) {
    await correr('pm2', ['restart', nombre, '--update-env'], { log, env: entorno });
  } else {
    await correr('pm2', [
      'start', PYTHON, '--name', nombre, '--cwd', MOTOR, '--', path.join(MOTOR, 'ejecutar.py'),
    ], { log, env: entorno });
  }
  await correr('pm2', ['save'], { permitirFallo: true, log });
  await confirmarVivo(slug, bot.puerto, log);
}

/**
 * Que el proceso este arriba de verdad, y que sea el de ESTE cliente.
 *
 * pm2 da por levantado un proceso que entra en bucle de reinicio, asi que sin
 * esto el alta terminaba con «Bot listo» sobre un bot que no arrancaba nunca.
 * Y se compara el slug porque el fallo tipico —el puerto ya ocupado por otro
 * bot— deja al panel hablando con el bot de otro cliente, que contesta 200 a
 * todo: el simulador, las metricas y el prompt serian los del otro.
 */
async function confirmarVivo(slug, puerto, log) {
  const limite = Date.now() + 30000;
  let ultimo = 'no respondio';
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 2000));
    let datos;
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/bot/admin/estado`, {
        signal: AbortSignal.timeout(4000),
      });
      datos = await r.json();
    } catch (err) {
      ultimo = err.message;
      continue;
    }
    if (datos?.slug === slug) {
      log?.(`El bot responde en :${puerto} (${(datos.modulos || []).join(' + ') || 'sin modulos'})`);
      return;
    }
    throw new Error(`el puerto ${puerto} ya era de otro bot ("${datos?.slug}"): `
      + 'el proceso nuevo no puede arrancar y el panel estaria hablando con el bot equivocado');
  }
  throw new Error(`el bot no respondio en :${puerto} (${ultimo}); mira \`pm2 logs ${procesoPm2(slug)}\``);
}

export async function detener(slug, log) {
  await correr('pm2', ['stop', procesoPm2(slug)], { permitirFallo: true, log });
  await correr('pm2', ['save'], { permitirFallo: true, log });
}

export async function eliminarProceso(slug, log) {
  await correr('pm2', ['delete', procesoPm2(slug)], { permitirFallo: true, log });
  await correr('pm2', ['save'], { permitirFallo: true, log });
}

// --- llamadas al motor -------------------------------------------------------

async function alBot(slug, ruta, opciones = {}) {
  const bot = obtener(slug)?.bot;
  if (!bot?.puerto) throw new Error('este cliente no tiene bot');
  const respuesta = await fetch(`http://127.0.0.1:${bot.puerto}${ruta}`, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(opciones.timeoutMs || 120000),
  });
  const texto = await respuesta.text();
  try { return JSON.parse(texto); }
  catch { throw new Error(`el bot respondio algo que no es JSON: ${texto.slice(0, 200)}`); }
}

export const estadoBot = (slug) => alBot(slug, '/bot/admin/estado', { timeoutMs: 8000 });
export const verPrompt = (slug) => alBot(slug, '/bot/simular/prompt', { timeoutMs: 15000 });
// Métricas internas: el cliente no ve nada de esto, él solo usa su Chatsuite.
export const metricas = (slug, dias = 30) =>
  alBot(slug, `/bot/admin/metricas?dias=${Number(dias) || 30}`, { timeoutMs: 20000 });
export const simular = (slug, mensajes) => alBot(slug, '/bot/simular', {
  method: 'POST', body: JSON.stringify({ mensajes }),
});
export const cambiarCiclo = (slug, estado) => alBot(slug, '/bot/admin/estado', {
  method: 'POST', body: JSON.stringify({ estado }), timeoutMs: 10000,
});

// --- aprovisionamiento -------------------------------------------------------

/**
 * @param {object} [siembra] lo elegido en el alta (modulos, domicilios, horario…).
 *   Se aplica ANTES de arrancar el proceso y de sincronizar etiquetas: si se
 *   sembrara despues, Chatsuite se quedaria con las etiquetas y los atributos
 *   del perfil por defecto —los de tienda— aunque el bot fuera de citas, y esas
 *   etiquetas de mas no las borra nadie.
 */
export async function preparar(slug, log, siembra = null) {
  const tenant = obtener(slug);
  if (!tenant) throw new Error('no existe ese cliente');
  // Los estados del tenant son: pendiente, aprovisionando, activo, error,
  // detenido. Hace falta 'activo' porque el alta del bot llama a la API de
  // Chatsuite para crear el AgentBot y sacar los tokens.
  if (tenant.estado !== 'activo') {
    throw new Error(`el Chatsuite tiene que estar activo para darle bot (está en ${tenant.estado})`);
  }

  const puerto = tenant.bot?.puerto || asignarPuertoBot();
  const dir = rutaBot(slug);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'catalogo-fotos'), { recursive: true });

  log(`Puerto del bot: ${puerto}`);

  const urlWebhook = `https://${tenant.dominio}/bot/webhook`;
  log('Creando el AgentBot y sacando los tokens de Chatsuite…');
  const creds = await tokensYBot(slug, urlWebhook, log);
  log(`AgentBot #${creds.bot_id} apuntando a ${urlWebhook}`);

  // El .env solo lleva secretos: cambiarlo exige reiniciar, y esta bien.
  // Todo lo demas vive en perfil.json y aplica en caliente.
  const env = [
    `CHATWOOT_URL=https://${tenant.dominio}`,
    `CHATWOOT_ACCOUNT_ID=${creds.account_id}`,
    `CHATWOOT_BOT_TOKEN=${creds.bot_token}`,
    `CHATWOOT_READ_TOKEN=${creds.read_token}`,
    'DARIO_URL=http://127.0.0.1:3457',
    `PORT=${puerto}`,
    'EVOLUTION_URL=',
    'EVOLUTION_APIKEY=',
    'META_SYSTEM_USER_TOKEN=',
    'META_PHONE_NUMBER_ID=',
    'BOT_NUMERO=',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, '.env'), env, { mode: 0o600 });

  if (!leerPerfil(slug)) {
    escribirPerfil(slug, perfilPorDefecto(tenant));
    log('Perfil inicial escrito (en borrador: el bot no le escribe a nadie todavia)');
  } else {
    log('Ya habia un perfil; se conserva');
  }
  // Se siembran vacios los archivos que edita el panel. `pedidos.json` no: lo
  // escribe el bot y escribirDato lo rechaza a proposito; el motor lo crea solo
  // con el primer pedido.
  for (const [archivo, spec] of Object.entries(DATOS)) {
    if (spec.soloLectura) continue;
    const destino = path.join(dir, 'data', archivo);
    if (!fs.existsSync(destino)) escribirDato(slug, archivo, spec.tipo === 'json' ? [] : '');
  }

  if (siembra) {
    sembrarPerfil(slug, siembra);
    const p = leerPerfil(slug);
    log(`Lo elegido en el alta aplicado: ${(p.modulos || []).join(' + ') || 'sin modulos'}`);
  }

  log('Publicando el webhook en nginx…');
  await publicarNginx(slug, puerto, log);

  log('Levantando el proceso…');
  await actualizar((e) => {
    const t = e.tenants.find((x) => x.slug === slug);
    t.bot = {
      puerto, agentBotId: creds.bot_id, webhook: urlWebhook,
      creadoEn: t.bot?.creadoEn || new Date().toISOString(),
    };
  });
  await arrancar(slug, log);

  log('Publicando el configurador del cliente en Chatsuite…');
  await registrarDashboardApp(slug, log);

  log('Creando etiquetas, vistas y atributos en Chatsuite…');
  const r = await sincronizarEtiquetas(slug, log);
  log(`Etiquetas nuevas: ${r.etiquetas} · vistas: ${r.vistas} · atributos: ${r.atributos ?? 0}`);

  log('');
  log('Bot listo y en BORRADOR. Configuralo y probalo en el simulador;');
  log('cuando este afinado, pasalo a prueba y despues a produccion.');
  log('');
  log('OJO: el inbox de WhatsApp necesita enable_auto_assignment = false,');
  log('o la conversacion nace asignada y el bot no la ve nunca.');
}
