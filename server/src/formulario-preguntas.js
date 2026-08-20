// El cuestionario de onboarding, en un solo sitio.
//
// De aqui comen tres cosas: el formulario que llena el cliente, la vista del
// panel donde se ven las respuestas, y el mapeo al perfil del bot al crear la
// instancia. Tenerlo repetido en el front y en el back garantizaba que un dia
// se desincronizaran, asi que el bundle publico lo pide por la API.
//
// El orden y la numeracion siguen a form/formulario-onboarding-bot.md: si un
// dia se discute una pregunta con el cliente, el numero que ve en pantalla es
// el mismo del documento.
//
// `critico: true` = sin eso el bot no sale a produccion. Es lo que decide la
// barra de "criticas respondidas" del panel, que es la que de verdad importa:
// un formulario al 90% sin las criticas no sirve para arrancar.
//
// `soloBot` limita la pregunta a ciertos modulos. Un consultorio no tiene
// tabla de zonas de domicilio ni precio al por mayor, y arrastrarlo por catorce
// preguntas que no le aplican es la mejor forma de que abandone el formulario.

export const TIPOS_BOT = [
  { id: 'tienda', titulo: 'Ventas', descripcion: 'Vende productos, toma pedidos, cobra y despacha.' },
  { id: 'citas', titulo: 'Citas', descripcion: 'Agenda, reagenda y recuerda citas o reservas.' },
  { id: 'ambos', titulo: 'Ventas y citas', descripcion: 'Las dos cosas: vende y ademas agenda.' },
];

/** Un modulo aplica si el formulario es de ese tipo o del combinado. */
export const aplicaModulo = (tipoBot, modulo) => tipoBot === 'ambos' || tipoBot === modulo;

export const SECCIONES = [
  { id: 'negocio', numero: 1, titulo: 'El negocio', descripcion: 'Lo basico: quienes son y como los encuentran.' },
  { id: 'catalogo', numero: 2, titulo: 'Catalogo y productos', descripcion: 'Que venden y a que precio.', soloBot: 'tienda' },
  { id: 'precios', numero: 3, titulo: 'Precios, promociones y negociacion', descripcion: 'Hasta donde puede llegar el bot con el precio.', soloBot: 'tienda' },
  { id: 'entregas', numero: 4, titulo: 'Entregas, envios y cobertura', descripcion: 'Como le llega el pedido al cliente.', soloBot: 'tienda' },
  { id: 'pagos', numero: 5, titulo: 'Pagos', descripcion: 'Como se cobra y quien confirma.', soloBot: 'tienda' },
  { id: 'cierre', numero: 6, titulo: 'El cierre de la venta', descripcion: 'Que datos se piden y quien remata.', soloBot: 'tienda' },
  { id: 'agenda', numero: 6, titulo: 'La agenda', descripcion: 'Servicios, duracion y quien atiende.', soloBot: 'citas' },
  { id: 'persona', numero: 7, titulo: 'Personalidad del bot', descripcion: 'Como habla. Esto es lo que hace que no parezca un robot.' },
  { id: 'respuestas', numero: 8, titulo: 'Respuestas que ya usan', descripcion: 'Los mensajes que hoy copian y pegan.' },
  { id: 'equipo', numero: 9, titulo: 'Equipo y escalamiento', descripcion: 'Quien atiende y cuando entra un humano.' },
  { id: 'objeciones', numero: 10, titulo: 'Objeciones y casos dificiles', descripcion: 'Lo que mas les preguntan y como lo resuelven.' },
  { id: 'seguimiento', numero: 11, titulo: 'Seguimiento y reactivacion', descripcion: 'Si el bot vuelve a escribir y cada cuanto.' },
  { id: 'tecnico', numero: 12, titulo: 'Canal y datos tecnicos', descripcion: 'Esto normalmente lo llena DT Growth Partners contigo.', dtgp: true },
];

export const PREGUNTAS = [
  // ---- 1. El negocio ----
  {
    id: 'nombre_comercial', seccion: 'negocio', n: 1, critico: true, tipo: 'texto',
    pregunta: 'Nombre comercial del negocio',
    ayuda: 'Tal como quieren que el bot lo diga en el chat.',
  },
  {
    id: 'que_venden', seccion: 'negocio', n: 2, critico: true, tipo: 'texto',
    pregunta: 'Que venden, en una frase',
    ayuda: 'Ejemplo: "ropa de hombre al por mayor y al detal".',
  },
  {
    id: 'ciudad', seccion: 'negocio', n: 3, tipo: 'texto',
    pregunta: 'Ciudad principal y cobertura',
    ayuda: 'Venden solo local, nacional, internacional?',
  },
  {
    id: 'redes', seccion: 'negocio', n: 4, tipo: 'largo',
    pregunta: 'Redes sociales activas y pagina web',
    ayuda: 'Instagram, Facebook, TikTok, sitio web. Una por linea.',
  },
  {
    id: 'punto_fisico', seccion: 'negocio', n: 5, critico: true, tipo: 'si_no_texto',
    pregunta: 'Tienen punto fisico? El cliente puede visitar o recoger?',
    ayuda: 'Si NO tienen: que debe responder el bot cuando pidan la direccion o '
      + '"pasar a recoger". Definirlo desde el dia 1 evita problemas.',
    etiquetaTexto: 'Direccion, o que responde el bot si no hay punto fisico',
  },
  {
    id: 'horario', seccion: 'negocio', n: 6, critico: true, tipo: 'horario',
    pregunta: 'Horario de atencion',
    ayuda: 'Dias y horas. Y que dice el bot fuera de horario.',
  },
  {
    id: 'horario_bot', seccion: 'negocio', n: 6, critico: true, tipo: 'ventana',
    pregunta: 'En que horario responde el bot?',
    ayuda: 'Ojo, no es lo mismo que el horario de atencion. Hay negocios que quieren '
      + 'el bot justo al reves: el equipo atiende de dia y el bot cubre la noche, de '
      + '5:00 p.m. a 8:00 a.m. Un rango que cruza la medianoche es valido.',
    opciones: [
      { id: 'siempre', texto: 'Todo el dia, todos los dias' },
      { id: 'negocio', texto: 'El mismo horario de atencion de la pregunta 6' },
      { id: 'propio', texto: 'Un rango propio (lo defino abajo)' },
    ],
  },
  {
    id: 'origen_clientes', seccion: 'negocio', n: 7, tipo: 'largo',
    pregunta: 'De donde llegan los clientes y cuantos mensajes nuevos esperan al dia',
    ayuda: 'Pauta de Meta, organico, referidos...',
  },

  // ---- 2. Catalogo ----
  {
    id: 'lista_productos', seccion: 'catalogo', n: 8, critico: true, tipo: 'largo',
    pregunta: 'Lista de productos con nombre, precio al detal, tallas y colores',
    ayuda: 'Puedes escribirla aqui o adjuntarla abajo. Si un precio esta por definir, '
      + 'marcalo: el bot no inventa precios.',
  },
  {
    id: 'archivo_catalogo', seccion: 'catalogo', n: 8, critico: true, tipo: 'archivo',
    pregunta: 'Archivo del catalogo',
    ayuda: 'Excel, CSV, JSON o texto. Si lo tienes en varios archivos, subelos todos.',
    varios: true,
    acepta: '.xlsx,.xls,.csv,.json,.txt,.tsv,.ods,.numbers,.pdf',
  },
  {
    id: 'fotos_productos', seccion: 'catalogo', n: 9, critico: true, tipo: 'archivo',
    pregunta: 'Fotos de los productos',
    ayuda: 'Buena luz, minimo una por producto. Puedes subir un ZIP.',
    varios: true,
    acepta: '.zip,.jpg,.jpeg,.png,.webp,.heic',
  },
  {
    id: 'logo', seccion: 'catalogo', n: 9, critico: true, tipo: 'archivo',
    pregunta: 'Logo del negocio',
    ayuda: 'PNG con fondo transparente si lo tienen. De aqui sale la marca del panel.',
    acepta: '.png,.jpg,.jpeg,.svg,.webp',
  },
  {
    id: 'inventario', seccion: 'catalogo', n: 10, tipo: 'opciones',
    pregunta: 'Manejan inventario en tiempo real?',
    opciones: [
      { id: 'afirma', texto: 'El bot puede afirmar "si hay"' },
      { id: 'confirma', texto: 'El bot debe confirmar con el equipo antes de prometer' },
    ],
  },
  {
    id: 'no_manejan', seccion: 'catalogo', n: 11, tipo: 'largo',
    pregunta: 'Que les preguntan que NO manejan, y que debe responder el bot',
    ayuda: 'Ejemplo: "conjuntos deportivos?" → "no manejamos, pero tenemos...".',
  },
  {
    id: 'catalogo_pdf', seccion: 'catalogo', n: 12, tipo: 'si_no',
    pregunta: 'Quieren catalogo en PDF descargable ademas de las fotos sueltas?',
  },

  // ---- 3. Precios ----
  {
    id: 'promocion', seccion: 'precios', n: 13, critico: true, tipo: 'largo',
    pregunta: 'Promocion vigente EXACTA, palabra por palabra',
    ayuda: 'Ejemplo: "3 camisetas por $105.000". Cambia seguido? Quien la actualiza?',
  },
  {
    id: 'por_mayor', seccion: 'precios', n: 14, critico: true, tipo: 'largo',
    pregunta: 'Hay precio al por mayor? Desde cuantas unidades y con que tabla?',
    ayuda: 'A partir de que cantidad debe intervenir un humano?',
  },
  {
    id: 'negociar', seccion: 'precios', n: 15, critico: true, tipo: 'opciones',
    pregunta: 'El bot puede negociar o dar descuentos?',
    opciones: [
      { id: 'no', texto: 'No: precio fijo siempre, y "descuento" pasa a un humano' },
      { id: 'limitado', texto: 'Si, hasta un limite (lo explico abajo)' },
    ],
    conNota: 'Hasta donde puede llegar',
  },
  {
    id: 'esta_caro', seccion: 'precios', n: 16, tipo: 'largo',
    pregunta: 'Cuando el cliente dice "esta caro", que responden hoy?',
    ayuda: 'La respuesta real que usan, no la ideal.',
  },

  // ---- 4. Entregas ----
  {
    id: 'zonas_domicilio', seccion: 'entregas', n: 17, critico: true, tipo: 'largo',
    pregunta: 'Domicilios locales: zonas o barrios con su tarifa',
    ayuda: 'Entre mas completa la tabla, menos veces interrumpe el bot al equipo. '
      + 'Puedes adjuntar el Excel abajo.',
  },
  {
    id: 'archivo_zonas', seccion: 'entregas', n: 17, tipo: 'archivo',
    pregunta: 'Archivo con la tabla de zonas',
    acepta: '.xlsx,.xls,.csv,.json,.txt,.pdf',
    varios: true,
  },
  {
    id: 'envios_nacionales', seccion: 'entregas', n: 18, critico: true, tipo: 'largo',
    pregunta: 'Envios nacionales: transportadora, costo, tiempo y forma de pago',
    ayuda: 'Se paga contra entrega o anticipado?',
  },
  {
    id: 'tiempos_entrega', seccion: 'entregas', n: 19, tipo: 'largo',
    pregunta: 'Tiempos de entrega local',
    ayuda: 'Mismo dia? Franjas? Hora de corte para que salga "hoy"?',
  },
  {
    id: 'monto_minimo', seccion: 'entregas', n: 20, tipo: 'texto',
    pregunta: 'Hay monto minimo para domicilio, o envio gratis desde cierto valor?',
  },

  // ---- 5. Pagos ----
  {
    id: 'metodos_pago', seccion: 'pagos', n: 21, critico: true, tipo: 'largo',
    pregunta: 'Metodos de pago, con los datos exactos que se le dan al cliente',
    ayuda: 'Nequi / Daviplata / cuenta bancaria + numero + titular. El bot los manda literal.',
  },
  {
    id: 'contra_entrega', seccion: 'pagos', n: 22, tipo: 'largo',
    pregunta: 'Pago contra entrega? En que casos si y en cuales se exige anticipo?',
  },
  {
    id: 'confirma_pago', seccion: 'pagos', n: 23, tipo: 'opciones',
    pregunta: 'El bot puede confirmar que un pago llego?',
    ayuda: 'Recomendado: no. Los comprobantes los verifica un humano; el bot solo registra y avisa.',
    opciones: [
      { id: 'no', texto: 'No: lo registra y avisa a un humano' },
      { id: 'si', texto: 'Si, el bot puede darlo por confirmado' },
    ],
  },

  // ---- 6. Cierre ----
  {
    id: 'datos_pedido', seccion: 'cierre', n: 24, critico: true, tipo: 'multiple',
    pregunta: 'Que datos hay que pedirle al cliente para tomar un pedido?',
    opciones: [
      { id: 'nombre', texto: 'Nombre completo' },
      { id: 'telefono', texto: 'Telefono' },
      { id: 'barrio', texto: 'Barrio o zona' },
      { id: 'direccion', texto: 'Direccion' },
      { id: 'referencia', texto: 'Punto de referencia' },
      { id: 'ciudad', texto: 'Ciudad' },
      { id: 'documento', texto: 'Documento de identidad' },
      { id: 'medio_pago', texto: 'Medio de pago' },
      { id: 'correo', texto: 'Correo electronico' },
    ],
    conNota: 'Otro dato que haga falta',
  },
  {
    id: 'quien_cierra', seccion: 'cierre', n: 25, critico: true, tipo: 'opciones',
    pregunta: 'Quien cierra la venta?',
    opciones: [
      { id: 'humano_confirma', texto: 'El bot toma los datos y un humano confirma antes de despachar' },
      { id: 'bot_cierra', texto: 'El bot toma el pedido completo y un humano solo despacha' },
    ],
  },
  {
    id: 'post_pedido', seccion: 'cierre', n: 26, tipo: 'largo',
    pregunta: 'Que pasa despues del pedido?',
    ayuda: 'Tiempos de despacho, mensaje de confirmacion, seguimiento de entrega.',
  },

  // ---- 6b. Agenda (bots de citas) ----
  {
    id: 'servicios', seccion: 'agenda', n: 24, critico: true, tipo: 'largo',
    pregunta: 'Servicios que se agendan, con duracion y precio',
    ayuda: 'Uno por linea. Ejemplo: "Limpieza facial · 45 min · $120.000".',
  },
  {
    id: 'profesionales', seccion: 'agenda', n: 25, critico: true, tipo: 'largo',
    pregunta: 'Quien atiende, y que servicios hace cada uno',
    ayuda: 'Si todos hacen de todo, basta con ponerlo.',
  },
  {
    id: 'reglas_agenda', seccion: 'agenda', n: 26, tipo: 'largo',
    pregunta: 'Reglas de la agenda',
    ayuda: 'Con cuanta anticipacion se puede pedir cita, hasta cuando se puede cancelar, '
      + 'si se cobra anticipo, que pasa si no llegan.',
  },

  // ---- 7. Personalidad ----
  {
    id: 'nombre_bot', seccion: 'persona', n: 27, critico: true, tipo: 'texto',
    pregunta: 'Como se llama quien atiende por el chat?',
    ayuda: 'Recomendado: un nombre de persona, y que no diga que es IA.',
  },
  {
    id: 'se_presenta', seccion: 'persona', n: 27, tipo: 'opciones',
    pregunta: 'Como se presenta?',
    opciones: [
      { id: 'persona', texto: 'Como una persona del equipo' },
      { id: 'asistente', texto: 'Como el asistente del negocio' },
    ],
  },
  {
    id: 'tuteo', seccion: 'persona', n: 28, critico: true, tipo: 'opciones',
    pregunta: 'Como le hablan a los clientes?',
    opciones: [
      { id: 'tuteo', texto: 'De tu' },
      { id: 'usted', texto: 'De usted' },
    ],
  },
  {
    id: 'tono', seccion: 'persona', n: 28, critico: true, tipo: 'largo',
    pregunta: 'Que tono usan?',
    ayuda: 'Formal o relajado, modismos locales si o no. Lo ideal: pega abajo 3 a 5 '
      + 'conversaciones reales de WhatsApp donde vendieron bien. De ahi sacamos la voz.',
  },
  {
    id: 'conversaciones', seccion: 'persona', n: 28, tipo: 'archivo',
    pregunta: 'Conversaciones reales de ventas exitosas',
    ayuda: 'Capturas de pantalla o el export del chat. 3 a 5 basta.',
    varios: true,
    acepta: '.jpg,.jpeg,.png,.webp,.zip,.txt,.pdf',
  },
  {
    id: 'emojis', seccion: 'persona', n: 29, tipo: 'opciones',
    pregunta: 'Emojis?',
    opciones: [
      { id: 'ninguno', texto: 'Ninguno' },
      { id: 'pocos', texto: 'Pocos, los justos' },
      { id: 'muchos', texto: 'Si, con soltura' },
    ],
    conNota: 'Cuales usan siempre y cuales jamas',
  },
  {
    id: 'muletillas', seccion: 'persona', n: 30, tipo: 'largo',
    pregunta: 'Frases de la casa que el bot deberia usar, y las prohibidas',
  },
  {
    id: 'nunca_decir', seccion: 'persona', n: 31, critico: true, tipo: 'largo',
    pregunta: 'Que NUNCA debe decir o prometer el bot?',
    ayuda: 'Garantias, fechas exactas, marcas "originales", datos personales del dueño... '
      + 'Una por linea.',
  },

  // ---- 8. Respuestas rapidas ----
  {
    id: 'respuestas_rapidas', seccion: 'respuestas', n: 32, critico: true, tipo: 'largo',
    pregunta: 'Pega TODOS los mensajes armados que hoy copian y pegan',
    ayuda: 'Bienvenida, promocion, datos para domicilio, datos para envio, calidad y tallas, '
      + 'ubicacion, preguntas frecuentes. Tal cual los mandan, sin editar: el bot los usa '
      + 'literal cuando toca y el cliente no nota el cambio.',
    filas: 12,
  },

  // ---- 9. Equipo ----
  {
    id: 'equipo', seccion: 'equipo', n: 33, critico: true, tipo: 'largo',
    pregunta: 'Quienes atienden? Nombre y numero de WhatsApp de cada uno',
    ayuda: 'Uno por linea, con el numero. El bot no los trata como clientes y les avisa las urgencias.',
  },
  {
    id: 'cuando_escalar', seccion: 'equipo', n: 34, critico: true, tipo: 'multiple',
    pregunta: 'Cuando debe pasar el bot la conversacion a un humano?',
    opciones: [
      { id: 'molesto', texto: 'El cliente esta molesto' },
      { id: 'pide_persona', texto: 'Pide hablar con una persona' },
      { id: 'negociacion', texto: 'Negociacion de precio' },
      { id: 'pago', texto: 'Confirmacion de pago' },
      { id: 'reclamo', texto: 'Reclamo o devolucion' },
      { id: 'mayorista', texto: 'Pedido mayorista grande' },
      { id: 'no_sabe', texto: 'Pregunta que no esta en su informacion' },
    ],
    conNota: 'Otro caso',
  },
  {
    id: 'avisos', seccion: 'equipo', n: 35, critico: true, tipo: 'largo',
    pregunta: 'A quien le avisa el bot cuando necesita un dato, y por que medio?',
    ayuda: 'Un precio pendiente, una zona sin tarifa. Nombre y numero de WhatsApp.',
  },
  {
    id: 'bot_se_aparta', seccion: 'equipo', n: 36, tipo: 'opciones',
    pregunta: 'Si un asesor entra al chat, el bot debe apartarse?',
    ayuda: 'Recomendado: si, una hora.',
    opciones: [
      { id: 'si', texto: 'Si, se calla mientras el humano atiende' },
      { id: 'no', texto: 'No, sigue respondiendo' },
    ],
  },

  // ---- 10. Objeciones ----
  {
    id: 'objeciones', seccion: 'objeciones', n: 37, tipo: 'largo',
    pregunta: 'Las 5 preguntas u objeciones mas repetidas, y como las responden hoy',
    ayuda: 'Texto real, el que usan de verdad.',
    filas: 8,
  },
  {
    id: 'devoluciones', seccion: 'objeciones', n: 38, tipo: 'largo',
    pregunta: 'Politica de cambios, devoluciones y garantias, en palabras simples',
  },
  {
    id: 'reclamo_entregado', seccion: 'objeciones', n: 39, tipo: 'largo',
    pregunta: 'Que hace el bot con un reclamo de un pedido ya entregado?',
  },
  {
    id: 'temas_sensibles', seccion: 'objeciones', n: 40, tipo: 'largo',
    pregunta: 'Hay temas del negocio que el bot debe esquivar por completo?',
  },

  // ---- 11. Seguimiento ----
  {
    id: 'reenganche', seccion: 'seguimiento', n: 41, tipo: 'si_no_texto',
    pregunta: 'Si un cliente pregunta y desaparece, quieren que el bot le escriba despues?',
    ayuda: 'En el canal oficial de WhatsApp, escribir primero despues de 24 h requiere '
      + 'plantillas aprobadas por Meta. Se diseñan en el onboarding.',
    etiquetaTexto: 'Cuanto tiempo despues y maximo cuantas veces',
  },
  {
    id: 'difusiones', seccion: 'seguimiento', n: 42, tipo: 'largo',
    pregunta: 'Enviaran difusiones o campañas salientes? A que base y con que frecuencia?',
  },

  // ---- 12. Tecnico (lo llena DTGP) ----
  {
    id: 'numero_whatsapp', seccion: 'tecnico', n: 43, critico: true, tipo: 'largo',
    pregunta: 'Numero de WhatsApp del negocio',
    ayuda: 'Esta dispuesto el cliente a que ese numero pase a la API oficial de Meta? '
      + 'Deja de funcionar en la app del celular: toda la atencion pasa al panel. '
      + 'Si no, usaran un numero nuevo dedicado?',
  },
  {
    id: 'meta_bm', seccion: 'tecnico', n: 44, critico: true, tipo: 'largo',
    pregunta: 'Acceso al Business Manager de Meta del cliente',
    ayuda: 'O autorizacion para crear app y WABA en su portafolio. La app SIEMPRE en el '
      + 'portafolio del cliente, no en el nuestro.',
  },
  {
    id: 'pauta_ctwa', seccion: 'tecnico', n: 45, tipo: 'si_no_texto',
    pregunta: 'Hay pauta activa de click-to-WhatsApp?',
    ayuda: 'Para montar la atribucion de ventas a anuncios desde el dia 1.',
    etiquetaTexto: 'Detalles de la pauta',
  },
  {
    id: 'reportes', seccion: 'tecnico', n: 46, tipo: 'largo',
    pregunta: 'Que reportes quieren y cada cuanto?',
    ayuda: 'Ejemplo: resumen diario de atendidos, pedidos y escaladas.',
  },
];

/** Las preguntas que aplican a un tipo de bot, en orden de seccion. */
export function preguntasDe(tipoBot) {
  const secciones = SECCIONES.filter((s) => !s.soloBot || aplicaModulo(tipoBot, s.soloBot));
  const validas = new Set(secciones.map((s) => s.id));
  return {
    secciones,
    preguntas: PREGUNTAS.filter((p) => validas.has(p.seccion)),
  };
}

/** Una respuesta cuenta como dada si tiene algo util dentro. */
export function respondida(pregunta, valor) {
  if (valor === undefined || valor === null) return false;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === 'object') {
    // si_no_texto y las que llevan nota: basta con la parte principal.
    if (valor.opcion !== undefined) return valor.opcion !== null && valor.opcion !== '';
    if (valor.si !== undefined) return valor.si !== null;
    if (valor.archivos !== undefined) return valor.archivos.length > 0;
    if (valor.modo !== undefined) {
      return valor.modo !== 'propio'
        || (Number.isInteger(valor.desde) && Number.isInteger(valor.hasta));
    }
    if (valor.desde !== undefined) return !!valor.desde && !!valor.hasta;
    return Object.values(valor).some((v) => respondida(pregunta, v));
  }
  return String(valor).trim() !== '';
}

/**
 * Avance de un formulario: total y, sobre todo, criticas.
 *
 * Una pregunta de archivo se da por respondida cuando hay algo subido, no
 * cuando hay texto: si no, el catalogo en Excel —que es critico— no habria
 * podido completarse nunca.
 */
export function avance(tipoBot, respuestas = {}, adjuntos = {}) {
  const { preguntas } = preguntasDe(tipoBot);
  const cubierta = (p) => (p.tipo === 'archivo'
    ? (adjuntos[p.id] || []).length > 0
    : respondida(p, respuestas[p.id]));
  const criticas = preguntas.filter((p) => p.critico);
  const hechas = preguntas.filter(cubierta);
  const criticasHechas = criticas.filter(cubierta);
  return {
    total: preguntas.length,
    hechas: hechas.length,
    criticas: criticas.length,
    criticasHechas: criticasHechas.length,
    porcentaje: preguntas.length ? Math.round((hechas.length / preguntas.length) * 100) : 0,
    listo: criticasHechas.length === criticas.length,
  };
}
