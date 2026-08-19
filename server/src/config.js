// Configuracion del provisioner. Todo lo que dependa de la maquina vive aqui.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLUGS_EXTERNOS } from './externos.js';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// Los secretos del panel —hoy las credenciales SMTP con las que los Chatsuites
// de los clientes mandan correo— viven fuera del repo, en instalacion/panel.env.
// Se cargan aqui y no con --env-file para que de igual como se lance el proceso:
// pm2, node a secas o systemd. Si el archivo no esta, el panel arranca igual y
// los Chatsuites salen sin correo, que es como estaban antes.
try {
  process.loadEnvFile(path.resolve(aqui, '..', '..', 'instalacion', 'panel.env'));
} catch { /* sin archivo, sin SMTP */ }

export const RAIZ_APP = path.resolve(aqui, '..');
export const DIR_PLANTILLAS = path.join(RAIZ_APP, 'templates');
export const DIR_PUBLICO = path.join(RAIZ_APP, 'public');
export const GENERADOR_MARCA = path.join(RAIZ_APP, 'bin', 'generar-marca.py');

// Un directorio por tenant: .env, docker-compose.yaml y brand/.
export const DIR_TENANTS = '/srv/chatsuite';
export const ARCHIVO_ESTADO = path.join(DIR_TENANTS, 'tenants.json');
export const DIR_LOGS = path.join(DIR_TENANTS, '_logs');
// Las paginas de "servicio suspendido". Fuera de DIR_TENANTS a proposito: ese
// directorio es 750 y nginx (www-data) no puede leerlo.
export const DIR_SUSPENDIDOS = '/var/www/chatsuite-suspendido';
export const DIR_BACKUPS = path.join(DIR_TENANTS, '_backups');

export const PUERTO_PANEL = Number(process.env.PUERTO_PANEL || 3200);

// Rango propio para los tenants. Empieza en 3210 para dejar aire debajo del
// panel, y esta enteramente libre en esta maquina (verificado contra ss -ltn).
// El techo real no es este rango sino la RAM: ~1.1 GB por tenant.
// Prefijo de los proyectos de docker compose. NO es `chatsuite_`: con ese
// nombre chocaba con las instancias hechas a mano ANTES de la plataforma
// (`chatsuite_compuxtreme`, `chatsuite_tubodegactg`), que siguen esa misma
// convencion. Un alta con uno de esos slugs recreaba SUS contenedores con la
// config del tenant nuevo y tumbaba la instancia del cliente sin avisar; el
// borrado, peor: `docker compose down -v` habria borrado sus volumenes.
export const PREFIJO_PROYECTO = 'cs_';
export const proyecto = (slug) => `${PREFIJO_PROYECTO}${slug}`;
export const contenedor = (slug, servicio) => `${proyecto(slug)}-${servicio}-1`;

export const PUERTO_TENANT_MIN = 3210;
export const PUERTO_TENANT_MAX = 3299;

export const DOMINIO_BASE = process.env.DOMINIO_BASE || 'dtgp.ai';
export const IMAGEN = process.env.IMAGEN_CHATSUITE || 'chatsuite:base';

// Cuenta a la que Let's Encrypt manda los avisos de vencimiento.
export const EMAIL_CERTBOT = process.env.EMAIL_CERTBOT || 'dev@dtgrowthpartners.com';

// Subdominios que el wizard no puede asignar.
//
// Los primeros salen de `externos.js`: lo que ya vive en este VPS se reserva
// solo. `dairo` es el caso que importa —dairo.dtgp.ai hace proxy al bot en
// :8011 y un tenant con ese slug sobrescribiria su sitio de nginx y lo
// tumbaria—, pero vale igual para tubodega.dtgp.ai o cantinabot.dtgp.ai, que
// son clientes reales. El resto son nombres de infraestructura que conviene no
// quemar.
export const SLUGS_RESERVADOS = new Set([
  ...SLUGS_EXTERNOS,
  'www', 'admin', 'api', 'app', 'panel', 'super', 'root',
  'mail', 'correo', 'smtp', 'imap', 'webmail', 'mx',
  'ns1', 'ns2', 'dns', 'cdn', 'static', 'assets',
  'docs', 'status', 'blog', 'help', 'soporte',
  'dev', 'test', 'staging', 'demo', 'lab',
  'chatsuite', 'chatwoot', 'evolution', 'whapi',
]);

// SMTP heredado de las instancias actuales: salen con el dominio de DTGP.
export const SMTP = {
  address: process.env.SMTP_ADDRESS || '',
  username: process.env.SMTP_USERNAME || '',
  password: process.env.SMTP_PASSWORD || '',
};
