// Jobs con log en vivo. Viven en memoria: son el registro de UNA corrida y lo
// que importa persistir (que paso quedo en ok y cual en error) ya esta en el
// estado del tenant. Ademas se vuelca a disco para poder revisar una alta que
// fallo hace dias.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DIR_LOGS } from './config.js';

const jobs = new Map();

export function crear(slug, titulo) {
  const id = `${slug}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(DIR_LOGS, { recursive: true });
  const job = {
    id,
    slug,
    titulo,
    lineas: [],
    terminado: false,
    ok: null,
    suscriptores: new Set(),
    archivo: path.join(DIR_LOGS, `${id}.log`),
  };
  jobs.set(id, job);

  // Se conservan los ultimos 200 jobs en memoria; el log completo queda en disco.
  if (jobs.size > 200) jobs.delete(jobs.keys().next().value);
  return job;
}

export const obtener = (id) => jobs.get(id) || null;

export function escribir(job, texto) {
  const linea = String(texto);
  job.lineas.push(linea);
  fs.appendFileSync(job.archivo, `${linea}\n`);
  for (const enviar of job.suscriptores) {
    try { enviar(linea); } catch { /* el cliente se fue; lo limpia el 'close' */ }
  }
}

export function terminar(job, ok, mensaje) {
  job.terminado = true;
  job.ok = ok;
  if (mensaje) escribir(job, mensaje);
  for (const enviar of job.suscriptores) {
    try { enviar(null, { terminado: true, ok }); } catch { /* idem */ }
  }
  job.suscriptores.clear();
}

/** Devuelve la funcion `log` que reciben los pasos. */
export const logger = (job) => (texto) => escribir(job, texto);
