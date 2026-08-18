// Autenticacion del panel: pantalla propia y sesion por cookie firmada.
//
// Antes esto era auth_basic de nginx. Funcionaba, pero la ventana gris del
// navegador no se puede maquetar, no permite cerrar sesion y da una primera
// impresion pesima en una herramienta que existe para entregar marcas bien
// hechas.
//
// No entra ninguna dependencia: scrypt y HMAC vienen en node:crypto, y una
// tabla de sesiones en memoria sobra para un panel de un solo operador.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DIR_TENANTS } from './config.js';

const ARCHIVO = path.join(DIR_TENANTS, '_auth.json');
const NOMBRE_COOKIE = 'chatsuite_sesion';
const VIDA_SESION_H = 12;

// Ventana de bloqueo por intentos fallidos. En memoria a proposito: si el
// proceso se reinicia se pierde el conteo, pero reiniciar el panel ya requiere
// acceso a la maquina, asi que no es una via de evasion real.
const INTENTOS = new Map();
const MAX_INTENTOS = 8;
const VENTANA_MS = 15 * 60 * 1000;

function derivar(clave, sal) {
  // scrypt con los parametros por defecto de Node (N=16384): del orden de
  // ~100ms por intento, que es lo que hace inviable probar claves en masa.
  return crypto.scryptSync(clave, sal, 64).toString('hex');
}

export function leerAuth() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); }
  catch { return null; }
}

/** Crea o reemplaza la credencial del panel. */
export function definirClave(usuario, clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const auth = {
    usuario,
    sal,
    hash: derivar(clave, sal),
    // El secreto de firma se guarda para que las sesiones abiertas sobrevivan a
    // un reinicio del panel; regenerarlo en cada arranque obligaria a entrar de
    // nuevo cada vez que se toca el codigo.
    secreto: leerAuth()?.secreto || crypto.randomBytes(32).toString('hex'),
    actualizado: new Date().toISOString(),
  };
  fs.mkdirSync(DIR_TENANTS, { recursive: true, mode: 0o750 });
  fs.writeFileSync(ARCHIVO, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  return auth;
}

function firmar(datos, secreto) {
  return crypto.createHmac('sha256', secreto).update(datos).digest('base64url');
}

function crearToken(auth) {
  const payload = Buffer.from(JSON.stringify({
    u: auth.usuario,
    exp: Date.now() + VIDA_SESION_H * 3600 * 1000,
  })).toString('base64url');
  return `${payload}.${firmar(payload, auth.secreto)}`;
}

function tokenValido(token, auth) {
  if (!token || !auth) return false;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return false;

  const esperada = firmar(payload, auth.secreto);
  // timingSafeEqual necesita buffers del mismo largo; si difieren, la firma ya
  // es invalida y se descarta sin comparar.
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch { return false; }
}

const leerCookies = (cabecera = '') => Object.fromEntries(
  cabecera.split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }).filter(([k]) => k),
);

export function haySesion(req) {
  return tokenValido(leerCookies(req.headers.cookie).chatsuite_sesion, leerAuth());
}

/** Verifica usuario y clave, con freno por intentos fallidos. */
export function intentarEntrar(req, usuario, clave) {
  const ip = req.socket.remoteAddress || 'desconocida';
  const ahora = Date.now();
  const previo = (INTENTOS.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);

  if (previo.length >= MAX_INTENTOS) {
    const faltan = Math.ceil((VENTANA_MS - (ahora - previo[0])) / 60000);
    return { ok: false, error: `demasiados intentos fallidos, espera ${faltan} minutos` };
  }

  const auth = leerAuth();
  if (!auth) return { ok: false, error: 'el panel no tiene credenciales configuradas' };

  const hash = derivar(String(clave || ''), auth.sal);
  const correcto = usuario === auth.usuario
    && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(auth.hash));

  if (!correcto) {
    INTENTOS.set(ip, [...previo, ahora]);
    // Un solo mensaje para usuario malo y clave mala: distinguirlos confirmaria
    // cual de los dos existe.
    return { ok: false, error: 'usuario o clave incorrectos' };
  }

  INTENTOS.delete(ip);
  return { ok: true, cookie: cookieSesion(crearToken(auth), req) };
}

function cookieSesion(valor, req, maxAge = VIDA_SESION_H * 3600) {
  // Secure solo si la peticion llego por HTTPS: sin esta comprobacion, probar el
  // panel en local por http dejaria una cookie que el navegador nunca devuelve.
  const seguro = req.headers['x-forwarded-proto'] === 'https';
  return [
    `${NOMBRE_COOKIE}=${valor}`,
    'Path=/',
    'HttpOnly',                 // fuera del alcance de cualquier JS
    'SameSite=Lax',             // corta el CSRF desde otro sitio
    seguro ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ].filter(Boolean).join('; ');
}

export const cookieBorrada = (req) => cookieSesion('', req, 0);
