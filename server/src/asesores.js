// Asesores del cliente: cada uno con su usuario y su clave en Chatsuite.
//
// Hasta ahora un Chatsuite nacia con UN solo usuario —el admin— y todo el
// equipo entraba con esa misma credencial. Eso hace imposible dos cosas que el
// negocio necesita: saber quien contesto cada mensaje, y repartir las
// conversaciones cuando el bot escala.
//
// Aqui se cruzan las DOS identidades que un asesor tiene y que antes vivian
// separadas sin saber la una de la otra:
//
//   - su usuario de Chatsuite (id numerico, correo, rol) — la fuente de verdad
//     es el Rails del tenant;
//   - su fila en data/equipo.json (telefono, nivel, temas) — que es lo que lee
//     el motor del bot para no tratarlo como cliente y para avisarle.
//
// El pegamento es `agente_id`. Sin el no hay forma de decirle al bot «asignale
// esta conversacion a Juan», porque el bot conoce el telefono de Juan pero no
// su id en Chatwoot.
//
// ⚠️ Un `agent` de Chatwoot SIN InboxMember no ve ni un inbox: entra y se
// encuentra un Chatsuite vacio, sin ningun error. Por eso al crear un asesor se
// le da de alta en todos los inboxes de la cuenta (ver `RUBY_CREAR`).
import crypto from 'node:crypto';

import { contenedor } from './config.js';
import { correr } from './provision.js';
import { obtener } from './store.js';
import { leerDato, escribirDato } from './bots.js';

const contenedorRails = (slug) => contenedor(slug, 'rails');

// Nuestros roles y el de Chatwoot no son el mismo eje y conviene no fingir que
// si. Chatwoot solo tiene dos (`agent` y `administrator`); nosotros
// distinguimos tres porque «dueño» y «supervisor» mandan lo mismo en Chatsuite
// pero no significan lo mismo en la cascada de escalamiento ni en los avisos.
export const ROLES = {
  'dueño': { chatwoot: 'administrator', nivel: 3 },
  supervisor: { chatwoot: 'administrator', nivel: 2 },
  asesor: { chatwoot: 'agent', nivel: 1 },
};

// A quien le llegan los avisos del bot por WhatsApp. `escalada` es el defecto:
// se entera de que un cliente pidio un humano, pero no de cada dato que el bot
// no supo. Con cinco asesores, `todo` para todos es la forma mas rapida de que
// nadie vuelva a mirar los avisos.
export const AVISOS = ['todo', 'escalada', 'ninguno'];

/**
 * Contrasena que pasa la validacion de Chatwoot.
 *
 * Misma forma que la del admin en provision.js y por la misma razon: Chatwoot
 * exige mayuscula, minuscula, digito y caracter especial, y un base64url
 * cumple solo a veces. Se omiten I, O, l, 0 y 1 porque estas claves se dictan
 * por telefono.
 */
export function clave(largo = 14) {
  const grupos = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%^&*_+-=?',
  ];
  const elegir = (alfabeto) => alfabeto[crypto.randomInt(alfabeto.length)];
  const todos = grupos.join('');
  const caracteres = grupos.map(elegir);
  while (caracteres.length < largo) caracteres.push(elegir(todos));
  for (let i = caracteres.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join('');
}

const normalizarTel = (t) => String(t || '').replace(/[^0-9]/g, '');
const idFila = () => crypto.randomBytes(4).toString('hex');

// --- Rails del tenant --------------------------------------------------------

async function rails(slug, ruby, { env, log } = {}) {
  const args = ['exec'];
  // Las claves viajan por variables de entorno del exec y NO como argumentos:
  // un argumento queda a la vista en el `ps` de cualquier usuario de la maquina
  // mientras dure el comando. Misma regla que el bootstrap del alta.
  for (const [k, v] of Object.entries(env || {})) args.push('-e', `${k}=${v}`);
  args.push(contenedorRails(slug), 'bundle', 'exec', 'rails', 'runner', ruby);

  const { salida } = await correr('docker', args, { log });
  const linea = salida.split('\n').reverse().find((l) => l.startsWith('JSON:'));
  if (!linea) throw new Error('el Chatsuite del cliente no respondio; ¿esta encendido?');
  return JSON.parse(linea.slice(5));
}

const RUBY_LISTAR = `
  cuenta = Account.first
  datos = cuenta.account_users.includes(:user).map do |au|
    { id: au.user_id, nombre: au.user.name, email: au.user.email, rol: au.role,
      confirmado: au.user.confirmed?,
      ultimo_ingreso: au.user.last_sign_in_at&.iso8601,
      inboxes: au.user.inbox_members.where(inbox: cuenta.inboxes).count }
  end
  puts "JSON:" + { agentes: datos, inboxes: cuenta.inboxes.count }.to_json
`.trim();

// Crear o actualizar. Es idempotente a proposito: si el correo ya existe se le
// reasigna clave y rol en vez de reventar, que es lo que hace falta tanto para
// «reiniciar la clave» como para recuperarse de un alta a medias.
const RUBY_CREAR = `
  cuenta = Account.first
  correo = ENV.fetch('CS_EMAIL')
  abort('SIN_CORREO') if correo.blank?
  usuario = User.find_by(email: correo)
  ya_existia = !usuario.nil?
  # Crear exige clave. Si se llega aqui sin ella es que se quiso ACTUALIZAR a
  # alguien que ya no esta, y crearlo con una clave vacia moriria en la
  # validacion de Devise con un error que no dice nada de esto.
  abort('SIN_CLAVE') if usuario.nil? && ENV['CS_CLAVE'].blank?
  if usuario.nil?
    usuario = User.new(
      name: ENV.fetch('CS_NOMBRE'),
      display_name: ENV['CS_DISPLAY'].presence || ENV.fetch('CS_NOMBRE').split(' ').first,
      email: correo,
      password: ENV.fetch('CS_CLAVE'),
      password_confirmation: ENV.fetch('CS_CLAVE')
    )
    # Sin esto Chatwoot le manda un correo de confirmacion y le bloquea el
    # ingreso hasta que lo abra. La clave se la entregamos nosotros, asi que la
    # confirmacion solo agregaria un correo que puede no llegar nunca.
    usuario.skip_confirmation!
    usuario.save!
  else
    usuario.name = ENV.fetch('CS_NOMBRE')
    usuario.display_name = ENV['CS_DISPLAY'].presence || usuario.display_name
    if ENV['CS_CLAVE'].present?
      usuario.password = ENV.fetch('CS_CLAVE')
      usuario.password_confirmation = ENV.fetch('CS_CLAVE')
    end
    usuario.skip_confirmation! unless usuario.confirmed?
    usuario.save!
  end

  au = AccountUser.find_or_initialize_by(account_id: cuenta.id, user_id: usuario.id)
  au.role = ENV.fetch('CS_ROL')
  au.save!

  # Un agent SIN InboxMember no ve NINGUN inbox: entra y su Chatsuite esta
  # vacio, sin mensaje de error en ninguna parte (app/policies/inbox_policy.rb
  # resuelve el scope con user.assigned_inboxes). El administrador los ve todos
  # igual, pero se le agrega tambien para que pueda ser asignatario.
  cuenta.inboxes.each do |inbox|
    InboxMember.find_or_create_by!(inbox_id: inbox.id, user_id: usuario.id)
  end

  puts "JSON:" + { id: usuario.id, nombre: usuario.name, email: usuario.email,
                   rol: au.role, confirmado: usuario.confirmed?,
                   ya_existia: ya_existia }.to_json
`.trim();

// Quitar el acceso, no borrar la persona: destruir el User se llevaria por
// delante la autoria de todos sus mensajes y las conversaciones que tenga
// asignadas. Se le quita el AccountUser, que es lo que da acceso a la cuenta.
const RUBY_QUITAR = `
  cuenta = Account.first
  id = ENV.fetch('CS_ID').to_i
  au = AccountUser.find_by(account_id: cuenta.id, user_id: id)
  if au.nil?
    puts "JSON:" + { ok: true, nota: 'ya no tenia acceso' }.to_json
  elsif au.administrator? && cuenta.account_users.where(role: :administrator).count <= 1
    # Sin un solo administrador el cliente se queda fuera de su propio
    # Chatsuite y hay que entrar por el super_admin a rescatarlo.
    puts "JSON:" + { ok: false, error: 'es el unico administrador' }.to_json
  else
    InboxMember.where(inbox: cuenta.inboxes, user_id: id).destroy_all
    au.destroy!
    puts "JSON:" + { ok: true }.to_json
  end
`.trim();

// --- equipo.json -------------------------------------------------------------

/**
 * Las filas de equipo.json con `id` garantizado.
 *
 * Las que ya existian —la del dueño que siembra el alta, las que el cliente
 * escribio a mano en la tabla— no tienen ni `id` ni `agente_id`. Se les pone
 * uno la primera vez que se leen y se persiste, para que actualizar o borrar
 * pueda apuntar a una fila concreta en vez de adivinar por el nombre.
 */
function filas(slug) {
  const crudas = leerDato(slug, 'equipo.json') || [];
  let cambio = false;
  const salida = crudas.map((f) => {
    if (f && f.id) return f;
    cambio = true;
    return { id: idFila(), ...f };
  });
  if (cambio) escribirDato(slug, 'equipo.json', salida);
  return salida;
}

function guardarFilas(slug, nuevas) {
  escribirDato(slug, 'equipo.json', nuevas);
}

/** Los campos operativos de una fila, con los defectos puestos. */
function normalizarFila(entrante, previa = {}) {
  const rol = ROLES[entrante.rol] ? entrante.rol : (previa.rol || 'asesor');
  const avisos = AVISOS.includes(entrante.avisos)
    ? entrante.avisos
    : (previa.avisos || (rol === 'asesor' ? 'escalada' : 'todo'));
  return {
    id: previa.id || idFila(),
    nombre: String(entrante.nombre ?? previa.nombre ?? '').trim(),
    telefono: normalizarTel(entrante.telefono ?? previa.telefono),
    rol,
    // `nivel` es el orden de la cascada de escalamiento: 1 atiende primero, y
    // se sube de nivel si nadie contesta. Por defecto el del rol.
    nivel: Number.isInteger(entrante.nivel) ? entrante.nivel : (previa.nivel ?? ROLES[rol].nivel),
    // Vacio = se ocupa de todo. Es lo correcto para un equipo chico: filtrar por
    // temas con dos asesores solo consigue que algunas conversaciones no le
    // toquen a nadie.
    temas: Array.isArray(entrante.temas)
      ? entrante.temas.map((t) => String(t).trim()).filter(Boolean)
      : (previa.temas || []),
    avisos,
    agente_id: entrante.agente_id ?? previa.agente_id ?? null,
    email: String(entrante.email ?? previa.email ?? '').trim().toLowerCase() || null,
  };
}

// --- API del modulo ----------------------------------------------------------

/**
 * El equipo del cliente, cruzando Chatsuite con equipo.json.
 *
 * Salen los dos lados aunque no se correspondan, y a proposito:
 *  - un usuario de Chatsuite sin fila (`sinFicha`) contesta pero el bot no lo
 *    conoce: lo trataria como cliente si escribiera desde su celular, y no
 *    recibe avisos;
 *  - una fila sin usuario (`sinAcceso`) recibe avisos y el bot la respeta, pero
 *    esa persona no puede entrar a Chatsuite.
 * Las dos son situaciones validas, pero casi siempre son un olvido, y lo unico
 * peor que un olvido es un olvido que no se ve.
 */
export async function listar(slug, log) {
  const tenant = obtener(slug);
  if (!tenant) throw new Error('no existe');
  const { agentes, inboxes } = await rails(slug, RUBY_LISTAR, { log });
  const porId = new Map(agentes.map((a) => [a.id, a]));

  const equipo = filas(slug).map((f) => {
    const cw = f.agente_id != null ? porId.get(f.agente_id) : null;
    if (cw) porId.delete(f.agente_id);
    return {
      ...f,
      nombre: cw?.nombre || f.nombre,
      email: cw?.email || f.email,
      chatwootRol: cw?.rol || null,
      confirmado: cw?.confirmado ?? null,
      ultimoIngreso: cw?.ultimo_ingreso || null,
      // Un agente dado de alta en cero inboxes entra a un Chatsuite vacio.
      sinInboxes: cw ? cw.inboxes === 0 && cw.rol !== 'administrator' : false,
      sinAcceso: !cw,
      sinFicha: false,
    };
  });

  // Lo que quedo en Chatsuite y no tiene fila. El admin del alta cae siempre
  // aqui la primera vez, y esta bien que se vea: es una invitacion a ponerle su
  // telefono para que empiece a recibir los avisos del bot.
  for (const cw of porId.values()) {
    equipo.push({
      id: `cw-${cw.id}`,
      nombre: cw.nombre,
      email: cw.email,
      telefono: '',
      rol: cw.rol === 'administrator' ? 'dueño' : 'asesor',
      nivel: cw.rol === 'administrator' ? 3 : 1,
      temas: [],
      avisos: 'ninguno',
      agente_id: cw.id,
      chatwootRol: cw.rol,
      confirmado: cw.confirmado,
      ultimoIngreso: cw.ultimo_ingreso,
      sinInboxes: cw.inboxes === 0 && cw.rol !== 'administrator',
      sinAcceso: false,
      sinFicha: true,
    });
  }

  return { equipo, inboxes };
}

/**
 * Da de alta a un asesor: usuario en Chatsuite + ficha en equipo.json.
 *
 * Devuelve la clave EN CLARO y es la unica vez que se puede ver: Chatwoot la
 * guarda cifrada y de ahi no vuelve a salir. Si se pierde, se reinicia.
 */
export async function crear(slug, datos, log) {
  const tenant = obtener(slug);
  if (!tenant) throw new Error('no existe');

  const nombre = String(datos.nombre || '').trim();
  const email = String(datos.email || '').trim().toLowerCase();
  const rol = ROLES[datos.rol] ? datos.rol : 'asesor';
  if (!nombre) throw new Error('falta el nombre');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('el correo no es valido');

  const actuales = filas(slug);
  // Solo estorba un correo que YA tiene usuario. Una ficha con correo y sin
  // acceso es justo lo que deja el formulario de onboarding, y es la que hay
  // que enganchar: rechazarla hacia imposible darle acceso a alguien que el
  // cliente ya habia escrito en el formulario.
  if (actuales.some((f) => f.email === email && f.agente_id != null)) {
    throw new Error('esa persona ya tiene usuario en Chatsuite');
  }

  const secreta = clave();
  const creado = await rails(slug, RUBY_CREAR, {
    log,
    env: {
      CS_EMAIL: email,
      CS_NOMBRE: nombre,
      CS_DISPLAY: String(datos.display || '').trim(),
      CS_CLAVE: secreta,
      CS_ROL: ROLES[rol].chatwoot,
    },
  });

  // Si ya habia una ficha con ese telefono y sin usuario —el caso normal: el
  // dueño, que el alta siembra en equipo.json solo con nombre y telefono— se
  // ENGANCHA en vez de crear una segunda. Dos filas con el mismo telefono
  // harian que el bot le mande cada aviso por duplicado.
  // Se engancha por telefono O por correo: la ficha del alta trae telefono, la
  // del formulario suele traer los dos, y la que alguien escribio a mano a
  // veces solo el nombre y el correo. Dos filas para la misma persona le
  // mandarian cada aviso por duplicado.
  const tel = normalizarTel(datos.telefono);
  const previa = actuales.find((f) => f.agente_id == null
    && ((tel && normalizarTel(f.telefono) === tel) || (f.email && f.email === email)));

  const fila = normalizarFila(
    { ...datos, nombre, email, rol, agente_id: creado.id },
    previa || {},
  );
  const nuevas = previa
    ? actuales.map((f) => (f.id === previa.id ? fila : f))
    : [...actuales, fila];
  guardarFilas(slug, nuevas);

  return {
    asesor: fila,
    clave: secreta,
    enganchado: Boolean(previa),
    // Ese correo YA era un usuario de este Chatsuite y se le acaba de cambiar
    // la clave. Casi siempre es el admin del alta, al que se le esta poniendo
    // por fin nombre y telefono de persona; pero si fue un dedazo, quien tuviera
    // esa cuenta se quedo fuera y hay que decirlo.
    yaExistia: Boolean(creado.ya_existia),
  };
}

/** Cambia los datos operativos y, si toca, el rol en Chatsuite. */
export async function actualizar(slug, id, cambios, log) {
  const actuales = filas(slug);
  const previa = actuales.find((f) => f.id === id)
    // Las filas sinFicha se identifican con `cw-<id>`: todavia no existen en
    // equipo.json y guardarlas es justo lo que las crea.
    || (String(id).startsWith('cw-') ? { agente_id: Number(String(id).slice(3)) } : null);
  if (!previa) throw new Error('ese miembro del equipo ya no existe');

  const fila = normalizarFila(cambios, previa);
  if (!fila.nombre) throw new Error('falta el nombre');

  // El rol solo se toca en Chatsuite si la persona tiene usuario, sabemos su
  // correo y el rol de verdad cambio. Sin correo no hay a quien apuntar: el
  // runner crearia un usuario vacio en vez de actualizar a este.
  if (fila.agente_id != null && fila.email
      && ROLES[fila.rol].chatwoot !== cambios.chatwootRol) {
    await rails(slug, RUBY_CREAR, {
      log,
      env: {
        CS_EMAIL: fila.email || '',
        CS_NOMBRE: fila.nombre,
        CS_DISPLAY: '',
        CS_CLAVE: '',            // vacio = no se toca la clave
        CS_ROL: ROLES[fila.rol].chatwoot,
      },
    });
  }

  const existe = actuales.some((f) => f.id === previa.id);
  guardarFilas(slug, existe
    ? actuales.map((f) => (f.id === previa.id ? fila : f))
    : [...actuales, fila]);
  return fila;
}

/** Nueva clave para quien la perdio. La anterior deja de servir al instante. */
export async function reiniciarClave(slug, id, log) {
  const fila = filas(slug).find((f) => f.id === id);
  if (!fila) throw new Error('ese miembro del equipo ya no existe');
  if (fila.agente_id == null) throw new Error('esta persona no tiene usuario en Chatsuite');
  if (!fila.email) throw new Error('esta ficha no tiene correo; vuelve a darla de alta');

  const secreta = clave();
  await rails(slug, RUBY_CREAR, {
    log,
    env: {
      CS_EMAIL: fila.email,
      CS_NOMBRE: fila.nombre,
      CS_DISPLAY: '',
      CS_CLAVE: secreta,
      CS_ROL: ROLES[fila.rol].chatwoot,
    },
  });
  return { clave: secreta };
}

/**
 * Saca a alguien del equipo.
 *
 * `soloFicha` quita la fila pero deja el usuario de Chatsuite: sirve para el
 * admin del alta, que no es una persona del negocio y no tiene por que salir en
 * la lista del bot.
 */
export async function eliminar(slug, id, { soloFicha = false } = {}, log) {
  const actuales = filas(slug);
  const fila = actuales.find((f) => f.id === id);
  const agenteId = fila?.agente_id
    ?? (String(id).startsWith('cw-') ? Number(String(id).slice(3)) : null);

  if (!soloFicha && agenteId != null) {
    const r = await rails(slug, RUBY_QUITAR, { log, env: { CS_ID: String(agenteId) } });
    if (r.ok === false) throw new Error(r.error);
  }
  if (fila) guardarFilas(slug, actuales.filter((f) => f.id !== fila.id));
  return { ok: true };
}
