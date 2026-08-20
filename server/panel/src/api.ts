// Cliente de la API del panel.

export type Paso = { id: string; titulo: string };
export type EstadoPaso = 'corriendo' | 'ok' | 'error';

export type Tenant = {
  slug: string;
  nombre: string;
  dominio: string;
  puerto: number;
  color: string;
  estado: 'pendiente' | 'aprovisionando' | 'activo' | 'error' | 'detenido' | 'suspendido';
  suspension?: { desde: string; motivo: string; estadoBot: string | null };
  error: string | null;
  creadoEn: string;
  activadoEn?: string;
  ultimoRespaldo?: string;
  pasos: Record<string, EstadoPaso>;
  contenedores: Record<string, string> | null;
};

// Lo que ya vive en este VPS y el panel no administra: instancias anteriores a
// la plataforma, cada una con su compose y su dominio. Solo lectura.
export type Externo = {
  slug: string;
  nombre: string;
  cliente: string;
  tipo: 'chatsuite' | 'bot';
  host: string;
  ruta: string;
  puerto: number;
  nota: string;
  url: string;
  vivo: boolean;
  // Lo reemplaza un tenant de la plataforma: su nombre queda libre para poder
  // darlo de alta, y los dos conviven hasta que se apague el viejo.
  migrando?: boolean;
};

// El perfil del bot es un JSON abierto a proposito: cada modulo agrega sus
// llaves y tiparlo entero aqui obligaria a tocar el panel cada vez que el motor
// gana una opcion. Lo que el panel usa de forma fija si esta tipado.
export type PerfilBot = {
  slug: string;
  estado: 'borrador' | 'prueba' | 'produccion';
  negocio: Record<string, string>;
  canal: { tipo: 'evolution' | 'cloud_api'; evolution: Record<string, string>; cloud_api: Record<string, string> };
  audiencia: 'clientes' | 'equipo' | 'ambos';
  modulos: string[];
  modelo: Record<string, string | number>;
  persona: Record<string, unknown>;
  operacion: Record<string, never> & Record<string, unknown>;
  tienda?: {
    catalogo?: { fotos_por_tanda?: number };
    pdf?: { activo?: boolean; titulo?: string };
    domicilios?: { activo?: boolean; etiqueta?: string; ciudad?: string };
  };
  etiquetas: { nombre: string; titulo?: string }[];
  alertas: Record<string, unknown>;
  [k: string]: unknown;
};

export type EstadoBot = {
  caido?: boolean;
  detalle?: string;
  estado?: string;
  audiencia?: string;
  modulos?: string[];
  pausas?: Record<string, number>;
  convalecencia?: boolean;
  perfil_leido_en?: string;
  canal?: { canal: string; estado_sesion: string | null; congelado: boolean; acuses_vistos: number; envios_ultima_hora: number };
  salientes_ultima_hora?: number;
};

export type Simulacion = {
  ok: boolean;
  mensajes: string[];
  escalaria: boolean;
  motivo: string;
  tools: string[];
  efectos: string[];
  texto_descartado: string[];
  segundos: number;
};

export type Metricas = {
  dias: number;
  total: Record<string, number | Record<string, number>>;
  por_dia: Record<string, Record<string, number>>;
  derivadas: {
    contencion: number | null;
    pedidos_por_100: number | null;
    ms_promedio: number | null;
    tokens_por_atendido: number | null;
  };
  // No es una métrica: es la lista de qué arreglarle al bot.
  sin_datos: { pregunta: string; veces: number; ultima: number }[];
};

export type EstadoWhatsapp = {
  sinWhatsapp?: boolean;
  puerto?: number;
  instancia?: string;
  // 'open' conectado, 'connecting' esperando el QR, 'close' caido.
  conexion?: string | null;
  detalle?: string;
};

export type Qr = {
  base64: string | null;
  codigo?: string | null;
  pairing?: string | null;
  conexion?: string | null;
  error?: string;
};

export type ArchivoDato =
  | 'negocio.md' | 'catalogo.json' | 'respuestas.json'
  | 'domicilios.json' | 'equipo.json' | 'pedidos.json'
  | 'cierres.json' | 'citas.json' | 'system.md';

export type Sistema = {
  memoria: { totalMB: number; usadaMB: number; disponibleMB: number };
  disco: { totalMB: number; usadoMB: number; disponibleMB: number; porcentaje: number };
  tenants: { total: number; activos: number };
  cupoEstimado: number;
  dominioBase: string;
  pasos: Paso[];
};

/**
 * Le pregunta al bot si ya está usando lo que se acaba de guardar.
 *
 * No es adorno: el motor relee por mtime y preguntarle el estado FUERZA esa
 * relectura, así que la hora que vuelve es prueba de que el cambio entró.
 * Guardar y no ver nada se siente igual que guardar y que falle — de ahí que
 * cada guardado termine diciendo a qué hora lo aplicó el bot.
 */
export async function confirmarAplicado(slug: string): Promise<string> {
  try {
    const estado = await api.bot.estado(slug);
    if (estado.caido) return 'el bot no responde ahora mismo: se aplicará al levantarse';
    const sello = estado.perfil_leido_en
      ? new Date(estado.perfil_leido_en).toLocaleTimeString('es-CO')
      : new Date().toLocaleTimeString('es-CO');
    return `el bot lo está usando desde las ${sello}`;
  } catch {
    return 'guardado en disco; el bot lo tomará en el próximo mensaje';
  }
}

/** Se dispara cuando la cookie vence, para que la app vuelva al login. */
export class SesionExpirada extends Error {}

/**
 * El mismo cliente sirve al panel y al configurador del cliente. Cambian dos
 * cosas y solo dos: el prefijo (el configurador se sirve bajo /bot/config/ del
 * dominio del cliente) y de donde salen las credenciales, que ahi son las de su
 * sesion de Chatwoot y viajan por cabecera.
 */
export const contexto = {
  base: '',
  cabeceras: (): Record<string, string> => ({}),
};

export function configurarApi(nuevo: Partial<typeof contexto>) {
  Object.assign(contexto, nuevo);
}

async function pedir<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const extra = contexto.cabeceras();
  const r = await fetch(contexto.base + ruta, Object.keys(extra).length
    ? { ...opciones, headers: { ...(opciones?.headers as Record<string, string>), ...extra } }
    : opciones);
  if (r.status === 401) throw new SesionExpirada('sesión expirada');
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((cuerpo as { error?: string }).error || `error ${r.status}`);
  return cuerpo as T;
}

const enviar = <T>(ruta: string, datos: unknown) => pedir<T>(ruta, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(datos),
});

// ---- formularios de onboarding ----

export type AvanceForm = {
  total: number; hechas: number; criticas: number; criticasHechas: number;
  porcentaje: number; listo: boolean;
};

export type ResumenForm = {
  id: string;
  negocio: string;
  tipoBot: 'tienda' | 'citas' | 'ambos';
  contacto: string;
  nota: string;
  estado: 'abierto' | 'entregado' | 'usado';
  creado: string;
  actualizado: string;
  entregadoEn: string | null;
  usadoEn: string | null;
  usadoPor: string | null;
  adjuntos: number;
  avance: AvanceForm;
};

export type PreguntaForm = {
  id: string;
  seccion: string;
  n: number;
  /** Numero que se muestra, calculado sobre el conjunto filtrado. */
  numero: number;
  tipo: string;
  pregunta: string;
  ayuda?: string;
  critico?: boolean;
  opciones?: { id: string; texto: string }[];
  conNota?: string;
  notasVarias?: string;
  etiquetaTexto?: string;
  varios?: boolean;
  acepta?: string;
  filas?: number;
  columnas?: {
    id: string; etiqueta: string; ancho?: number; largo?: boolean;
    ejemplo?: string; opcional?: boolean;
  }[];
  etiquetaAgregar?: string;
  camposAdjunto?: { id: string; etiqueta: string; ancho?: number }[];
  fotos?: { columna: string; columnaNombre: string; etiqueta: string; acepta: string };
};

export type SeccionForm = {
  id: string; numero: number; titulo: string; descripcion: string; dtgp?: boolean;
};

export type AdjuntoForm = {
  nombre: string; guardado: string; bytes: number; subido: string;
  meta?: Record<string, string>;
};

export type DetalleForm = {
  formulario: ResumenForm & {
    token: string;
    clave: string;
    respuestas: Record<string, unknown>;
    origen: Record<string, string>;
    adjuntos: Record<string, AdjuntoForm[]>;
  };
  preguntas: PreguntaForm[];
  secciones: SeccionForm[];
  resumen: ResumenForm;
};

export const api = {
  sistema: () => pedir<Sistema>('/api/sistema'),
  tenants: () => pedir<Tenant[]>('/api/tenants'),
  externos: () => pedir<Externo[]>('/api/externos'),
  tenant: (slug: string, credenciales = false) =>
    pedir<Tenant & { credenciales?: { email: string; password: string } }>(
      `/api/tenant?slug=${encodeURIComponent(slug)}${credenciales ? '&credenciales=si' : ''}`,
    ),
  urlLogo: (slug: string) => `${contexto.base}/api/tenant/logo?slug=${encodeURIComponent(slug)}`,
  colorSugerido: (logo: string) => enviar<{ color: string }>('/api/color-sugerido', { logo }),
  crear: (datos: Record<string, unknown>) =>
    enviar<{ slug: string; job: string; dominio: string }>('/api/tenants', datos),
  accion: (slug: string, accion: string, confirmar?: string) =>
    enviar<{ job: string }>('/api/accion', { slug, accion, confirmar }),
  entrar: (usuario: string, clave: string) => enviar<{ ok: true }>('/api/login', { usuario, clave }),
  salir: () => fetch(`${contexto.base}/api/logout`, { method: 'POST' }),

  formularios: {
    listar: () => pedir<{
      formularios: ResumenForm[];
      tipos: { id: string; titulo: string; descripcion: string }[];
    }>('/api/formularios'),
    crear: (datos: { negocio: string; tipoBot: string; contacto?: string; nota?: string }) =>
      enviar<{ formulario: ResumenForm; token: string; clave: string }>('/api/formularios', datos),
    detalle: (id: string) => pedir<DetalleForm>(`/api/formularios/detalle?id=${encodeURIComponent(id)}`),
    datosAlta: (id: string) => pedir<{
      negocio: string;
      nombre: string;
      marca: string;
      ciudad: string;
      asistente: string;
      modulos: string[];
      domicilios: boolean;
      horaInicio: number | null;
      horaFin: number | null;
      telefonoAvisos: string;
      logo: { nombre: string; datos: string } | null;
      avance: AvanceForm;
    }>(`/api/formularios/alta?id=${encodeURIComponent(id)}`),
    responder: (id: string, pregunta: string, valor: unknown) =>
      pedir<{ avance: AvanceForm }>('/api/formularios/respuesta', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, pregunta, valor }),
      }),
    nuevaClave: (id: string) => enviar<{ clave: string }>('/api/formularios/clave', { id }),
    marcarEntregado: (id: string) => enviar<{ ok: true }>('/api/formularios/entregado', { id }),
    borrar: (id: string) => enviar<{ ok: true }>('/api/formularios/borrar', { id }),
    urlBriefing: (id: string) => `${contexto.base}/api/formularios/briefing?id=${encodeURIComponent(id)}`,
    // `enLinea` para las miniaturas: sin el, el navegador se descarga la foto en
    // vez de pintarla, porque la ruta responde con content-disposition.
    urlAdjunto: (id: string, guardado: string, enLinea = false) =>
      `${contexto.base}/api/formularios/adjunto?id=${encodeURIComponent(id)}`
      + `&archivo=${encodeURIComponent(guardado)}${enLinea ? '&enlinea=1' : ''}`,
  },

  bot: {
    preparar: (slug: string) => enviar<{ job: string }>('/api/bot/preparar', { slug }),
    perfil: (slug: string) => pedir<PerfilBot>(`/api/bot/perfil?slug=${encodeURIComponent(slug)}`),
    // El motor relee el perfil al cambiar el mtime: guardar aplica al instante,
    // sin reiniciar el proceso.
    guardarPerfil: (slug: string, perfil: PerfilBot) =>
      pedir<{ ok: true }>('/api/bot/perfil', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, perfil }),
      }),
    dato: <T>(slug: string, archivo: ArchivoDato) =>
      pedir<{ archivo: string; contenido: T }>(
        `/api/bot/dato?slug=${encodeURIComponent(slug)}&archivo=${encodeURIComponent(archivo)}`,
      ),
    guardarDato: (slug: string, archivo: ArchivoDato, contenido: unknown) =>
      pedir<{ ok: true }>('/api/bot/dato', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, archivo, contenido }),
      }),
    idProducto: (slug: string) =>
      pedir<{ id: string }>(`/api/bot/id-producto?slug=${encodeURIComponent(slug)}`),
    foto: (slug: string, id: string, foto: string) =>
      enviar<{ imagen: string }>('/api/bot/foto', { slug, id, foto }),
    estado: (slug: string) => pedir<EstadoBot>(`/api/bot/estado?slug=${encodeURIComponent(slug)}`),
    ciclo: (slug: string, estado: string) => enviar<{ ok: boolean; estado: string }>('/api/bot/ciclo', { slug, estado }),
    simular: (slug: string, mensajes: { role: string; content: string }[]) =>
      enviar<Simulacion>('/api/bot/simular', { slug, mensajes }),
    metricas: (slug: string, dias = 30) =>
      pedir<Metricas>(`/api/bot/metricas?slug=${encodeURIComponent(slug)}&dias=${dias}`),
    prompt: (slug: string) =>
      pedir<{
        prompt: string; tools: string[]; etiquetas: string[];
        persona_generada: string; modo_experto: boolean;
      }>(`/api/bot/prompt?slug=${encodeURIComponent(slug)}`),
    accion: (slug: string, accion: string) => enviar<{ job: string }>('/api/bot/accion', { slug, accion }),
  },

  whatsapp: {
    preparar: (slug: string) => enviar<{ job: string }>('/api/whatsapp/preparar', { slug }),
    estado: (slug: string) => pedir<EstadoWhatsapp>(`/api/whatsapp/estado?slug=${encodeURIComponent(slug)}`),
    qr: (slug: string) => pedir<Qr>(`/api/whatsapp/qr?slug=${encodeURIComponent(slug)}`),
    accion: (slug: string, accion: string, importarHistorial?: boolean) =>
      enviar<{ job: string }>('/api/whatsapp/accion', { slug, accion, importarHistorial }),
  },
};

/** Lee un File como data URL, que es como viaja el logo al servidor. */
export const leerArchivo = (archivo: File) => new Promise<string>((resolve, reject) => {
  const lector = new FileReader();
  lector.onload = () => resolve(lector.result as string);
  lector.onerror = () => reject(new Error('no pude leer el archivo'));
  lector.readAsDataURL(archivo);
});

export const gb = (mb: number) => (mb / 1024).toFixed(1);
