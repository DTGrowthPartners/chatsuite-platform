// Lo que ya vive en este VPS y el panel NO administra.
//
// Son instancias anteriores a la plataforma: cada una con su compose, su imagen
// y su dominio. Estan aqui por dos razones que van juntas:
//
//  1. Reservar el nombre. Un alta con el slug `tubodega` reescribiria el sitio
//     de nginx de tubodega.dtgp.ai y tumbaria el Chatsuite de un cliente real.
//     Los slugs reservados salen de esta misma lista, asi que no puede pasar
//     que se agregue algo aqui y se olvide reservarlo alla.
//  2. Que se sepa que existen. Sin esto, lo unico que dice donde vive cada
//     cliente es nginx, y hay que entrar por SSH a leerlo.
//
// El puerto es el del servicio en 127.0.0.1: se usa para el chequeo de vida,
// que asi no depende del DNS ni del certificado.

export const EXTERNOS = [
  {
    slug: 'dairo',
    nombre: 'Agente Dairo',
    cliente: 'DT Growth Partners',
    tipo: 'bot',
    host: 'dairo.dtgp.ai',
    ruta: '/admin/',
    puerto: 8011,
    nota: 'El bot de WhatsApp de DTGP. Lo maneja otro sistema, no el motor.',
  },
  {
    slug: 'cantinabot',
    nombre: 'Cantina',
    cliente: 'Cantina',
    tipo: 'bot',
    host: 'cantinabot.dtgp.ai',
    ruta: '/admin/',
    puerto: 8012,
    nota: 'Reservas y mesas. Tambien responde en cantinabot.dtgrowthpartners.com.',
  },
  {
    slug: 'tubodega',
    nombre: 'Tu Bodega',
    cliente: 'Tu Bodega',
    tipo: 'chatsuite',
    host: 'tubodega.dtgp.ai',
    ruta: '/',
    puerto: 3036,
    nota: 'Chatsuite propio, por WhatsApp Cloud API. Alias: tubodegactg.dtgrowthpartners.com.',
  },
  {
    slug: 'compuxtreme',
    nombre: 'CompuXtreme',
    cliente: 'CompuXtreme',
    tipo: 'chatsuite',
    host: 'compuxtreme.dtgrowthpartners.com',
    ruta: '/',
    puerto: 3037,
    nota: 'Chatsuite propio con Evolution aparte.',
  },
  {
    slug: 'ceenford',
    nombre: 'Ceenford',
    cliente: 'Ceenford',
    tipo: 'chatsuite',
    host: 'ceenfordsuite.dtgrowthpartners.com',
    ruta: '/',
    puerto: 3035,
    nota: 'Chatwoot anterior a la plataforma.',
  },
  {
    slug: 'equilibrio',
    nombre: 'Equilibrio Clinic',
    cliente: 'Equilibrio Clinic',
    tipo: 'chatsuite',
    host: 'equilibriocs.dtgrowthpartners.com',
    ruta: '/',
    puerto: 3034,
    nota: 'Chatwoot anterior a la plataforma.',
  },
  {
    slug: 'chatsuitetdairo',
    nombre: 'Chatsuite DTGP',
    cliente: 'DT Growth Partners',
    tipo: 'chatsuite',
    host: 'chatsuitetdairo.dtgrowthpartners.com',
    ruta: '/',
    puerto: 3033,
    nota: 'El Chatwoot interno de DTGP.',
  },
];

// Nombres que no tienen instancia aqui pero si registro DNS en dtgp.ai, o que
// son marcas de clientes que podrian pedir su Chatsuite manana. Reservarlos
// cuesta nada; que un alta pise un registro existente cuesta un rato de
// diagnostico, porque nginx no avisa: simplemente gana el ultimo sitio escrito.
export const NOMBRES_TOMADOS = ['acbfit', 'cantina', 'nanoplush', 'tubodegactg'];

// Los externos que viven bajo dtgp.ai son los unicos que un alta podria pisar:
// el resto esta en otro dominio. Se reservan todos igual, para que el nombre de
// un cliente no acabe repartido entre dos dominios distintos.
export const SLUGS_EXTERNOS = [...EXTERNOS.map((e) => e.slug), ...NOMBRES_TOMADOS];
