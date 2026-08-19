// Motor de aprovisionamiento: la secuencia de pasos que da de alta un Chatsuite.
//
// Cada paso es idempotente y se puede reintentar por separado. Esa es la razon
// de partirlo asi: la parte fragil no es el docker compose sino lo que depende
// de la red (certbot) y del arranque de Rails (migraciones), y cuando eso falla
// hay que poder retomar sin borrar y empezar de cero.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  DIR_PLANTILLAS, DIR_TENANTS, DOMINIO_BASE, EMAIL_CERTBOT, GENERADOR_MARCA,
  IMAGEN, PUERTO_TENANT_MAX, PUERTO_TENANT_MIN, SLUGS_RESERVADOS, SMTP,
  contenedor, proyecto,
} from './config.js';
import { actualizar, obtener, puertosUsados, rutaTenant } from './store.js';

// --- utilidades --------------------------------------------------------------

/** Ejecuta un comando y vuelca su salida al log del job, linea a linea. */
export function correr(cmd, args, { cwd, env, log, permitirFallo = false } = {}) {
  return new Promise((resolve, reject) => {
    log?.(`$ ${cmd} ${args.join(' ')}`);
    // Sin shell: los argumentos van como arreglo, asi un nombre de cliente con
    // comillas o punto y coma no puede convertirse en otro comando.
    const proceso = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let salida = '';
    const recoger = (buf) => {
      const texto = buf.toString();
      salida += texto;
      texto.split('\n').filter(Boolean).forEach((l) => log?.(`  ${l}`));
    };
    proceso.stdout.on('data', recoger);
    proceso.stderr.on('data', recoger);

    proceso.on('error', reject);
    proceso.on('close', (codigo) => {
      if (codigo === 0 || permitirFallo) return resolve({ codigo, salida });
      return reject(new Error(`${cmd} termino con codigo ${codigo}`));
    });
  });
}

export function plantilla(nombre, valores) {
  const texto = fs.readFileSync(path.join(DIR_PLANTILLAS, nombre), 'utf8');
  // Se falla ruidosamente ante un marcador sin valor: un {{PUERTO}} que llegue
  // vacio al compose produce un contenedor que arranca y no escucha, y eso se
  // diagnostica mucho peor que un error aqui.
  return texto.replace(/\{\{(\w+)\}\}/g, (_, clave) => {
    if (!(clave in valores)) throw new Error(`plantilla ${nombre}: falta el valor {{${clave}}}`);
    return valores[clave];
  });
}

const secreto = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/**
 * Contrasena que pasa la validacion de Chatwoot.
 *
 * Chatwoot exige mayuscula, minuscula, digito y un caracter especial. Un
 * randomBytes().toString('base64url') falla de forma intermitente: solo produce
 * alfanumericos mas '-' y '_', asi que a veces cumple y a veces no, y el alta
 * muere en el bootstrap con "Password must contain at least 1 special
 * character" despues de haber creado ya la cuenta.
 *
 * Se toma uno obligatorio de cada grupo y se rellena el resto; el barajado
 * final evita que la posicion de cada tipo sea predecible.
 */
function clave(largo = 18) {
  const grupos = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',   // sin I ni O: se confunden al dictarlas
    'abcdefghijkmnopqrstuvwxyz',  // sin l
    '23456789',                   // sin 0 ni 1
    '!@#$%^&*_+-=?',              // subconjunto seguro del set que acepta Chatwoot
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

// --- validacion --------------------------------------------------------------

export function validarSlug(slug) {
  if (!slug || typeof slug !== 'string') return 'el slug es obligatorio';
  // Minusculas, digitos y guiones; sin guion al inicio ni al final. Es lo que
  // acepta un subdominio y ademas lo que docker compose tolera como nombre de
  // proyecto sin transformarlo por detras.
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/.test(slug)) {
    return 'usa 3 a 32 caracteres: minusculas, numeros y guiones, sin guion al inicio ni al final';
  }
  if (SLUGS_RESERVADOS.has(slug)) return `"${slug}" esta reservado y no se puede usar`;
  if (obtener(slug)) return `ya existe un cliente con el slug "${slug}"`;
  return null;
}

/**
 * Docker es el otro espacio de nombres del VPS, y hasta ahora nadie lo miraba.
 * Si ya hay contenedores o volumenes con el proyecto del tenant, el alta NO
 * crearia lo suyo: `docker compose up` adoptaria los que ya existen y los
 * recrearia con la config nueva. Eso fue exactamente lo que tumbo la instancia
 * vieja de CompuXtreme el 2026-08-19: misma cuenta, otro dueño.
 *
 * Se mira por nombre y no por etiqueta de compose para atrapar tambien lo que
 * alguien haya creado a mano con ese prefijo.
 */
export async function proyectoOcupado(slug) {
  const pr = proyecto(slug);
  const { salida: conts } = await correr(
    'docker', ['ps', '-a', '--filter', `name=^${pr}-`, '--format', '{{.Names}}'], { permitirFallo: true },
  );
  const { salida: vols } = await correr(
    'docker', ['volume', 'ls', '--filter', `name=^${pr}_`, '--format', '{{.Name}}'], { permitirFallo: true },
  );
  const encontrados = [...conts.split('\n'), ...vols.split('\n')].map((x) => x.trim()).filter(Boolean);
  return encontrados.length ? encontrados : null;
}

export function asignarPuerto() {
  const usados = puertosUsados();
  for (let p = PUERTO_TENANT_MIN; p <= PUERTO_TENANT_MAX; p += 1) {
    if (!usados.has(p)) return p;
  }
  throw new Error('no quedan puertos libres en el rango de tenants');
}

// --- los pasos ---------------------------------------------------------------

const PASOS = [
  {
    id: 'marca',
    titulo: 'Generar los assets de marca',
    async ejecutar({ tenant, log }) {
      const dir = rutaTenant(tenant.slug);
      const dirMarca = path.join(dir, 'brand');
      fs.mkdirSync(dirMarca, { recursive: true });

      const origen = path.join(dir, `_logo-original${tenant.logoExtension || '.png'}`);
      if (!fs.existsSync(origen)) {
        throw new Error('no encuentro el logo original; vuelve a subirlo desde el panel');
      }

      const args = [
        GENERADOR_MARCA,
        '--logo', origen,
        '--nombre', tenant.marca || tenant.nombre,
        '--color', tenant.color,
        '--salida', dirMarca,
      ];
      if (tenant.quitarFondo) args.push('--quitar-fondo');

      const { salida } = await correr('python3', args, { log });
      const resumen = JSON.parse(salida.trim().split('\n').filter((l) => l.startsWith('{')).pop());
      log(`marca lista: ${resumen.archivos.length} archivos, acento ${resumen.color_claro}`);

      // La imagen espera estos nombres exactos; si falta uno, el cliente ve un
      // hueco en el sidebar o el favicon de Chatwoot.
      const exigidos = [
        'brand.css', 'sidebar-logo.png', 'watermark.png',
        'logo.svg', 'logo_dark.svg', 'logo_thumbnail.svg',
        'favicon-16x16.png', 'favicon-32x32.png', 'favicon-96x96.png',
      ];
      const faltan = exigidos.filter((f) => !fs.existsSync(path.join(dirMarca, f)));
      if (faltan.length) throw new Error(`el generador no produjo: ${faltan.join(', ')}`);
    },
  },

  {
    id: 'config',
    titulo: 'Escribir .env, compose y bootstrap',
    async ejecutar({ tenant, log }) {
      const dir = rutaTenant(tenant.slug);
      const valores = {
        SLUG: tenant.slug,
        NOMBRE: tenant.nombre,
        DOMINIO: tenant.dominio,
        PUERTO: String(tenant.puerto),
        SECRET_KEY_BASE: tenant.secretos.secretKeyBase,
        POSTGRES_PASSWORD: tenant.secretos.postgres,
        REDIS_PASSWORD: tenant.secretos.redis,
        SMTP_ADDRESS: SMTP.address,
        SMTP_USERNAME: SMTP.username,
        SMTP_PASSWORD: SMTP.password,
      };

      fs.writeFileSync(path.join(dir, '.env'), plantilla('env.tpl', valores), { mode: 0o600 });
      fs.writeFileSync(path.join(dir, 'docker-compose.yaml'), plantilla('compose.tpl', valores));
      // El bootstrap queda junto al tenant para poder reejecutarlo a mano si
      // hace falta; al contenedor entra por docker cp en el paso siguiente.
      fs.copyFileSync(path.join(DIR_PLANTILLAS, 'bootstrap.rb'), path.join(dir, 'bootstrap.rb'));
      log(`.env, docker-compose.yaml y bootstrap.rb escritos en ${dir}`);
    },
  },

  {
    id: 'basedatos',
    titulo: 'Preparar el esquema de la base',
    async ejecutar({ tenant, log }) {
      const dir = rutaTenant(tenant.slug);

      // El entrypoint de Chatwoot espera a Postgres y corre `bundle install`,
      // pero NUNCA crea el esquema. Sin este paso, rails y sidekiq arrancan,
      // fallan con PG::UndefinedTable "installation_configs does not exist" y
      // quedan en bucle de reinicio — sin un error visible en el `up -d`, que
      // devuelve 0 igual.
      //
      // Va antes de levantar el servicio y no despues: si rails ya esta en
      // bucle, compite por la base mientras corren las migraciones.
      await correr('docker', ['compose', 'up', '-d', 'postgres', 'redis'], { cwd: dir, log });

      // `run --rm rails` reutiliza el entrypoint, que ya espera a que Postgres
      // acepte conexiones; por eso no hace falta sondear aqui.
      // db:chatwoot_prepare es idempotente: crea, migra y siembra solo lo que
      // falte, asi que reintentar este paso es seguro.
      await correr('docker', [
        'compose', 'run', '--rm', 'rails',
        'bundle', 'exec', 'rails', 'db:chatwoot_prepare',
      ], { cwd: dir, log });
    },
  },

  {
    id: 'arrancar',
    titulo: 'Levantar los contenedores',
    async ejecutar({ tenant, log }) {
      const dir = rutaTenant(tenant.slug);

      // Si este paso ya habia fallado, se RECREAN los contenedores en vez de
      // solo levantarlos.
      //
      // Motivo real: cuando `up -d` falla a mitad (p. ej. el puerto ocupado por
      // otro proceso), el contenedor queda creado pero SIN RED. Un `up -d`
      // posterior lo ve existente y solo hace start, asi que arranca sin red y
      // se queda esperando a un `postgres` que nunca resuelve. El sintoma es
      // "todavia arrancando..." para siempre, sin ningun error.
      const reintento = tenant.pasos?.arrancar === 'error';
      if (reintento) log('el intento anterior fallo: se recrean los contenedores');
      await correr('docker', ['compose', 'up', '-d', ...(reintento ? ['--force-recreate'] : [])],
        { cwd: dir, log });

      // docker compose materializa la ancla YAML `base` como un contenedor que
      // queda Exited(0) y ensucia el listado. No estorba, pero se borra para que
      // `docker ps -a` refleje solo lo que de verdad corre.
      await correr('docker', ['rm', '-f', contenedor(tenant.slug, 'base')], {
        log, permitirFallo: true,
      });
    },
  },

  {
    id: 'migrar',
    titulo: 'Esperar a que Rails responda',
    async ejecutar({ tenant, log }) {
      // El esquema ya quedo listo en el paso anterior, pero el arranque de
      // Rails todavia tarda (bundle check, carga de la app). No sirve un sleep
      // fijo: se sondea hasta que el puerto conteste.
      const limite = Date.now() + 8 * 60 * 1000;
      let intento = 0;
      while (Date.now() < limite) {
        intento += 1;
        try {
          const respuesta = await fetch(`http://127.0.0.1:${tenant.puerto}/api`, {
            signal: AbortSignal.timeout(5000),
            // Sin 'manual', fetch sigue la redireccion de FORCE_SSL hacia
            // https://<dominio>/api, que todavia no resuelve, y el sondeo falla
            // para siempre aunque Rails este perfecto.
            redirect: 'manual',
          });
          // Cualquier respuesta HTTP significa que Rails ya escucha. Con
          // FORCE_SSL=true la raiz contesta 301, no 200: exigir 2xx aqui
          // esperaria en vano. Un 5xx si es un arranque a medias.
          if (respuesta.status > 0 && respuesta.status < 500) {
            log(`Rails responde en :${tenant.puerto} con ${respuesta.status} (intento ${intento})`);
            return;
          }
        } catch {
          // Todavia arrancando: se reintenta.
        }
        if (intento % 6 === 0) log(`todavia arrancando... (${intento} intentos)`);
        await new Promise((r) => setTimeout(r, 5000));
      }
      throw new Error(
        `Rails no respondio en 8 minutos. Revisa: docker compose -f ${rutaTenant(tenant.slug)}/docker-compose.yaml logs rails`,
      );
    },
  },

  {
    id: 'bootstrap',
    titulo: 'Crear la cuenta, el admin y la marca',
    async ejecutar({ tenant, log }) {
      const nombreRails = contenedor(tenant.slug, 'rails');
      await correr('docker', ['cp', path.join(rutaTenant(tenant.slug), 'bootstrap.rb'), `${nombreRails}:/app/bootstrap.rb`], { log });

      // Las claves viajan por variables de entorno del exec y no como argumentos:
      // los argumentos quedarian visibles en el `ps` de cualquier usuario de la
      // maquina mientras dure el comando.
      await correr('docker', [
        'exec',
        '-e', `CHATSUITE_ADMIN_PASSWORD=${tenant.secretos.adminPassword}`,
        '-e', `CHATSUITE_SUPERADMIN_PASSWORD=${tenant.secretos.superAdminPassword}`,
        '-e', `CHATSUITE_NOMBRE=${tenant.nombre}`,
        '-e', `CHATSUITE_MARCA=${tenant.marca || tenant.nombre}`,
        '-e', `CHATSUITE_SITIO=${tenant.sitio || ''}`,
        '-e', `CHATSUITE_LOCALE=${tenant.locale || 'es'}`,
        '-e', `CHATSUITE_ADMIN_EMAIL=${tenant.admin.email}`,
        '-e', `CHATSUITE_SUPERADMIN_EMAIL=${tenant.admin.superEmail}`,
        '-e', `CHATSUITE_COLOR=${tenant.color}`,
        '-e', `CHATSUITE_DOMINIO=${tenant.dominio}`,
        nombreRails,
        'bundle', 'exec', 'rails', 'runner', '/app/bootstrap.rb',
      ], { log });
    },
  },

  {
    id: 'nginx',
    titulo: 'Publicar el sitio en nginx',
    async ejecutar({ tenant, log }) {
      const dir = rutaTenant(tenant.slug);
      const temporal = path.join(dir, '_nginx.conf');
      fs.mkdirSync(path.join(dir, 'nginx-extra'), { recursive: true });
      fs.writeFileSync(temporal, plantilla('nginx.tpl', {
        NOMBRE: tenant.nombre,
        SLUG: tenant.slug,
        DOMINIO: tenant.dominio,
        PUERTO: String(tenant.puerto),
      }));

      const destino = `/etc/nginx/sites-available/${tenant.dominio}`;
      await correr('sudo', ['cp', temporal, destino], { log });
      await correr('sudo', ['ln', '-sfn', destino, `/etc/nginx/sites-enabled/${tenant.dominio}`], { log });

      // nginx -t antes del reload: un archivo malo tumba TODOS los sitios de la
      // maquina, no solo el que se esta dando de alta.
      await correr('sudo', ['nginx', '-t'], { log });
      await correr('sudo', ['systemctl', 'reload', 'nginx'], { log });
      fs.unlinkSync(temporal);
    },
  },

  {
    id: 'ssl',
    titulo: 'Emitir el certificado',
    async ejecutar({ tenant, log }) {
      // certbot --nginx reescribe el sitio que acaba de quedar publicado: le
      // agrega el bloque 443 con el certificado y la redireccion desde el 80.
      // Por eso la plantilla se escribe sin TLS.
      await correr('sudo', [
        'certbot', '--nginx',
        '-d', tenant.dominio,
        '--non-interactive', '--agree-tos',
        '-m', EMAIL_CERTBOT,
        '--redirect',
        '--keep-until-expiring',
      ], { log });
      await correr('sudo', ['nginx', '-t'], { log });
      await correr('sudo', ['systemctl', 'reload', 'nginx'], { log });
    },
  },
];

export const IDS_PASOS = PASOS.map((p) => ({ id: p.id, titulo: p.titulo }));

/** Corre la secuencia completa, marcando el progreso en el estado. */
export async function aprovisionar(slug, log) {
  for (const paso of PASOS) {
    const tenant = obtener(slug);
    if (!tenant) throw new Error(`el tenant ${slug} desaparecio del estado`);

    if (tenant.pasos?.[paso.id] === 'ok') {
      log(`— ${paso.titulo}: ya estaba hecho, se omite`);
      continue;
    }

    log(`\n▶ ${paso.titulo}`);
    await actualizar((e) => {
      const t = e.tenants.find((x) => x.slug === slug);
      t.pasos = { ...t.pasos, [paso.id]: 'corriendo' };
      t.estado = 'aprovisionando';
    });

    try {
      await paso.ejecutar({ tenant, log });
      await actualizar((e) => {
        const t = e.tenants.find((x) => x.slug === slug);
        t.pasos[paso.id] = 'ok';
      });
      log(`✓ ${paso.titulo}`);
    } catch (err) {
      await actualizar((e) => {
        const t = e.tenants.find((x) => x.slug === slug);
        t.pasos[paso.id] = 'error';
        t.estado = 'error';
        t.error = `${paso.titulo}: ${err.message}`;
      });
      log(`✗ ${paso.titulo}: ${err.message}`);
      throw err;
    }
  }

  await actualizar((e) => {
    const t = e.tenants.find((x) => x.slug === slug);
    t.estado = 'activo';
    t.error = null;
    t.activadoEn = new Date().toISOString();
  });
  log(`\n✓ Listo: https://${obtener(slug).dominio}`);

  // El bot va DESPUES de marcar el tenant activo, no como un paso mas: su alta
  // llama a la API de Chatsuite, que recien ahi esta arriba y con certificado.
  // Y si falla, el Chatsuite del cliente ya quedo bueno igual — se reintenta
  // desde la tarjeta sin repetir los 8 pasos.
  const listo = obtener(slug);
  if (listo.botAlAlta) {
    log('\n▶ Bot del cliente');
    try {
      const bots = await import('./bots.js');
      await bots.preparar(slug, log);
      await bots.sembrarPerfil(slug, listo.botAlAlta);
      log('✓ Bot creado, en borrador');
    } catch (err) {
      log(`✗ El bot no se pudo crear: ${err.message}`);
      log('  El Chatsuite quedo bien. Reintentalo desde la tarjeta del cliente.');
    }
  }
}

/** Arma el registro del tenant antes de correr los pasos. */
export function nuevoTenant({
  slug, nombre, color, emailAdmin, quitarFondo, logoExtension,
  marca, sitio, locale, zonaHoraria, ciudad, bot,
}) {
  return {
    slug,
    nombre,
    // Lo que ve el cliente en su dashboard. Por defecto, el nombre.
    marca: marca || nombre,
    sitio: sitio || '',
    locale: locale || 'es',
    zonaHoraria: zonaHoraria || 'America/Bogota',
    ciudad: ciudad || '',
    // Si se pidio bot desde el alta, se crea al terminar los 8 pasos.
    botAlAlta: bot?.crear ? { asistente: bot.asistente || '', modulo: bot.modulo || 'tienda' } : null,
    dominio: `${slug}.${DOMINIO_BASE}`,
    puerto: asignarPuerto(),
    color,
    imagen: IMAGEN,
    quitarFondo: Boolean(quitarFondo),
    logoExtension: logoExtension || '.png',
    estado: 'pendiente',
    canal: null,
    admin: {
      email: emailAdmin,
      superEmail: `superadmin+${slug}@dtgrowthpartners.com`,
    },
    secretos: {
      secretKeyBase: secreto(64),
      postgres: secreto(16),
      redis: secreto(16),
      adminPassword: clave(),
      superAdminPassword: clave(),
    },
    pasos: {},
    error: null,
    creadoEn: new Date().toISOString(),
  };
}

export { DIR_TENANTS };
