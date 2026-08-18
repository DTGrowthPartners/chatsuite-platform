// Estado de los tenants: un solo JSON con escritura atomica.
//
// Se eligio un archivo y no una base de datos a proposito. El volumen real es
// de decenas de filas y un solo escritor (este proceso), asi que un motor no
// aporta nada y si agrega una pieza mas que respaldar y actualizar. El archivo
// se lee de un vistazo con `cat`, entra entero en un backup y no depende de
// ninguna API experimental.
//
// Contiene secretos (claves de Postgres, Redis y del admin), asi que se crea
// con permisos 600 y el directorio con 750.
import fs from 'node:fs';
import path from 'node:path';
import { ARCHIVO_ESTADO, DIR_TENANTS } from './config.js';

const VACIO = { version: 1, tenants: [] };

// Todas las escrituras pasan por esta cadena de promesas. Sin ella, dos
// peticiones que modifiquen tenants distintos pueden leer el mismo estado y la
// segunda pisa a la primera — el clasico read-modify-write perdido.
let cola = Promise.resolve();

function asegurarDirectorio() {
  fs.mkdirSync(DIR_TENANTS, { recursive: true, mode: 0o750 });
}

export function leer() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_ESTADO, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(VACIO);
    throw err;
  }
}

function escribirAhora(estado) {
  asegurarDirectorio();
  // Escribir a un temporal y renombrar: rename es atomico dentro del mismo
  // sistema de archivos, asi que un corte de luz a media escritura deja el
  // archivo anterior intacto en vez de un JSON truncado.
  const temporal = `${ARCHIVO_ESTADO}.tmp`;
  fs.writeFileSync(temporal, `${JSON.stringify(estado, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporal, ARCHIVO_ESTADO);
}

/** Aplica `mutador` sobre el estado y lo persiste. Serializado. */
export function actualizar(mutador) {
  cola = cola.then(async () => {
    const estado = leer();
    const resultado = await mutador(estado);
    escribirAhora(estado);
    return resultado;
  });
  return cola;
}

export function listar() {
  return leer().tenants;
}

export function obtener(slug) {
  return leer().tenants.find((t) => t.slug === slug) || null;
}

/** Puertos ya comprometidos, incluyendo tenants a medio aprovisionar. */
export function puertosUsados() {
  return new Set(leer().tenants.map((t) => t.puerto).filter(Boolean));
}

export function rutaTenant(slug) {
  return path.join(DIR_TENANTS, slug);
}
