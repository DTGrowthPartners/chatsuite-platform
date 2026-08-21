// El equipo del cliente: quién entra a Chatsuite y con qué credencial.
//
// Sustituye a la tabla suelta de equipo.json, que solo guardaba nombre,
// teléfono y un rol que no leía nadie. Aquí cada fila es una persona de verdad:
// tiene usuario para entrar, teléfono para que el bot no la confunda con un
// cliente, y un nivel que decide a quién le toca el chat cuando el bot escala.
//
// Las tres advertencias de la lista (`sinAcceso`, `sinFicha`, `sinInboxes`) son
// lo más útil de esta pantalla. Las tres son estados válidos pero casi siempre
// son un olvido, y las tres fallan calladas: la peor es `sinInboxes`, porque la
// persona entra a Chatsuite, no ve ni una conversación y no hay ningún mensaje
// de error que le explique por qué.
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, Check, Copy, KeyRound, Plus, Trash2, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  api, type Asesor, type AvisosAsesor, type RolAsesor,
} from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Campo, Numero, Selector, Texto } from './campos';

const ROLES: { valor: RolAsesor; texto: string }[] = [
  { valor: 'asesor', texto: 'Asesor — contesta' },
  { valor: 'supervisor', texto: 'Supervisor — contesta y configura' },
  { valor: 'dueño', texto: 'Dueño — manda' },
];

const AVISOS: { valor: AvisosAsesor; texto: string }[] = [
  { valor: 'escalada', texto: 'Solo lo urgente' },
  { valor: 'todo', texto: 'Todo' },
  { valor: 'ninguno', texto: 'Nada' },
];

const NIVEL_POR_ROL: Record<RolAsesor, number> = { asesor: 1, supervisor: 2, 'dueño': 3 };

/** La clave solo se puede ver una vez, así que se muestra hasta que la copien. */
function Credencial({
  email, clave, alCerrar,
}: { email: string; clave: string; alCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const texto = `Chatsuite\nUsuario: ${email}\nClave: ${clave}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      toast.error('el navegador no dejó copiar; selecciónala a mano');
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-emerald-400">
          Listo. Esta clave no se vuelve a mostrar.
        </p>
        <p className="text-xs text-muted-foreground">
          Chatwoot la guarda cifrada, así que de aquí no vuelve a salir. Si se pierde
          se genera una nueva, pero la anterior deja de servir.
        </p>
      </div>
      <pre className="overflow-x-auto rounded-md border bg-background/60 p-2.5 text-xs leading-relaxed">
        {texto}
      </pre>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void copiar()}>
          {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copiado ? 'copiada' : 'Copiar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={alCerrar}>Ya la guardé</Button>
      </div>
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-500">
      <AlertTriangle className="size-3 shrink-0" />
      {children}
    </span>
  );
}

function Fila({
  slug, asesor, alCambiar, alBorrar, alClave,
}: {
  slug: string;
  asesor: Asesor;
  alCambiar: () => void;
  alBorrar: () => void;
  alClave: (email: string, clave: string) => void;
}) {
  const [borrador, setBorrador] = useState(asesor);
  const [ocupado, setOcupado] = useState(false);
  const sucio = JSON.stringify(borrador) !== JSON.stringify(asesor);

  useEffect(() => { setBorrador(asesor); }, [asesor]);

  async function guardar() {
    setOcupado(true);
    try {
      await api.asesores.guardar(slug, asesor.id, {
        nombre: borrador.nombre,
        // Va aunque no se edite: las fichas que salen de Chatsuite y todavia no
        // estan en el padron del bot no tienen correo guardado, y sin el el
        // servidor no sabe a que usuario apuntar para cambiarle el rol.
        email: borrador.email,
        telefono: borrador.telefono,
        rol: borrador.rol,
        nivel: borrador.nivel,
        temas: borrador.temas,
        avisos: borrador.avisos,
        // El servidor lo compara con el rol nuevo para no tocar Chatsuite si no
        // hizo falta: cambiar el rol es la única operación de aquí que entra al
        // Rails del cliente, y cuesta ~1 s.
        chatwootRol: asesor.chatwootRol,
      });
      toast.success('guardado');
      alCambiar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function nuevaClave() {
    setOcupado(true);
    try {
      const { clave } = await api.asesores.clave(slug, asesor.id);
      alClave(asesor.email || '', clave);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function borrar() {
    const que = asesor.sinAcceso
      ? `Quitar a ${asesor.nombre} del equipo del bot?`
      : `Quitar a ${asesor.nombre}? Pierde el acceso a Chatsuite. Sus mensajes y su
         autoría se conservan.`;
    if (!window.confirm(que.replace(/\s+/g, ' '))) return;
    setOcupado(true);
    try {
      await api.asesores.eliminar(slug, asesor.id, asesor.sinAcceso);
      toast.success('fuera del equipo');
      alBorrar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{asesor.nombre || 'sin nombre'}</span>
        {asesor.email ? (
          <span className="text-xs text-muted-foreground">{asesor.email}</span>
        ) : null}
        {asesor.chatwootRol === 'administrator'
          ? <Badge variant="outline" className="text-xs">administra</Badge> : null}
        <span className="grow" />
        {asesor.ultimoIngreso ? (
          <span className="text-xs text-muted-foreground">
            entró {new Date(asesor.ultimoIngreso).toLocaleDateString('es-CO')}
          </span>
        ) : asesor.agente_id ? (
          <span className="text-xs text-muted-foreground">nunca ha entrado</span>
        ) : null}
      </div>

      {asesor.sinInboxes ? (
        <Aviso>
          No está en ningún inbox: entra a Chatsuite y no ve ni una conversación.
          Vuelve a guardar para arreglarlo.
        </Aviso>
      ) : null}
      {asesor.sinAcceso ? (
        <Aviso>
          Recibe los avisos del bot pero no puede entrar a Chatsuite. Dale de alta
          abajo con su correo si tiene que contestar.
        </Aviso>
      ) : null}
      {asesor.sinFicha ? (
        <Aviso>
          Entra a Chatsuite pero el bot no lo conoce. Ponle el teléfono y guarda,
          o el bot lo tratará como un cliente más si escribe desde su celular.
        </Aviso>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo etiqueta="Nombre">
          <Texto valor={borrador.nombre} alCambiar={(v) => setBorrador({ ...borrador, nombre: v })} />
        </Campo>
        <Campo etiqueta="WhatsApp" ayuda="Con indicativo. Así el bot no lo trata como cliente.">
          <Texto
            valor={borrador.telefono}
            placeholder="573001112233"
            alCambiar={(v) => setBorrador({ ...borrador, telefono: v.replace(/[^0-9]/g, '') })}
          />
        </Campo>
        <Campo etiqueta="Rol">
          <Selector
            valor={borrador.rol}
            opciones={ROLES}
            alCambiar={(v) => setBorrador({ ...borrador, rol: v, nivel: NIVEL_POR_ROL[v] })}
          />
        </Campo>
        <Campo etiqueta="Nivel" ayuda="1 atiende primero; los de arriba son el respaldo.">
          <Numero valor={borrador.nivel} min={1} max={9} alCambiar={(v) => setBorrador({ ...borrador, nivel: v })} />
        </Campo>
        <Campo etiqueta="Temas" ayuda="Separados por coma. Vacío = se ocupa de todo.">
          <Texto
            valor={borrador.temas.join(', ')}
            placeholder="reclamo, mayorista"
            alCambiar={(v) => setBorrador({
              ...borrador,
              temas: v.split(',').map((t) => t.trim()).filter(Boolean),
            })}
          />
        </Campo>
        <Campo etiqueta="Avisos por WhatsApp" ayuda="«Todo» para cinco personas es cómo se deja de mirarlos.">
          <Selector
            valor={borrador.avisos}
            opciones={AVISOS}
            alCambiar={(v) => setBorrador({ ...borrador, avisos: v })}
          />
        </Campo>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!sucio || ocupado} onClick={() => void guardar()}>
          Guardar
        </Button>
        {asesor.agente_id ? (
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => void nuevaClave()}>
            <KeyRound className="size-3.5" /> Nueva clave
          </Button>
        ) : null}
        <span className="grow" />
        <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => void borrar()}>
          <Trash2 className="size-3.5" /> Quitar
        </Button>
      </div>
    </div>
  );
}

function Alta({
  slug, alCreado,
}: { slug: string; alCreado: (email: string, clave: string) => void }) {
  const vacio = { nombre: '', email: '', telefono: '', rol: 'asesor' as RolAsesor };
  const [datos, setDatos] = useState(vacio);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    setOcupado(true);
    try {
      const r = await api.asesores.crear(slug, { ...datos, nivel: NIVEL_POR_ROL[datos.rol] });
      setDatos(vacio);
      setAbierto(false);
      if (r.yaExistia) {
        // Le acabamos de cambiar la clave a una cuenta que ya existia. Casi
        // siempre es el admin del alta, al que por fin se le pone nombre de
        // persona; pero si fue un dedazo en el correo, quien tuviera esa cuenta
        // se quedo fuera ahora mismo y hay que verlo.
        toast.warning(`Ese correo ya era un usuario de este Chatsuite. Se le cambió la clave.`);
      } else {
        toast.success(r.enganchado
          ? `${r.asesor.nombre} ya estaba en el equipo; ahora además entra a Chatsuite`
          : `${r.asesor.nombre} ya puede entrar`);
      }
      alCreado(r.asesor.email || datos.email, r.clave);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!abierto) {
    return (
      <Button size="sm" variant="outline" onClick={() => setAbierto(true)}>
        <Plus className="size-3.5" /> Añadir asesor
      </Button>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed p-3">
      <p className="text-sm font-medium">Nuevo asesor</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre">
          <Texto valor={datos.nombre} alCambiar={(v) => setDatos({ ...datos, nombre: v })} />
        </Campo>
        <Campo etiqueta="Correo" ayuda="Es el usuario con el que entra. Que sea uno suyo, real: es por donde recupera la clave.">
          <Texto
            valor={datos.email}
            type="email"
            placeholder="juan@sunegocio.com"
            alCambiar={(v) => setDatos({ ...datos, email: v })}
          />
        </Campo>
        <Campo etiqueta="WhatsApp" ayuda="Opcional, pero sin él el bot lo trata como cliente.">
          <Texto
            valor={datos.telefono}
            placeholder="573001112233"
            alCambiar={(v) => setDatos({ ...datos, telefono: v.replace(/[^0-9]/g, '') })}
          />
        </Campo>
        <Campo etiqueta="Rol">
          <Selector valor={datos.rol} opciones={ROLES} alCambiar={(v) => setDatos({ ...datos, rol: v })} />
        </Campo>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={ocupado || !datos.nombre || !datos.email} onClick={() => void crear()}>
          <UserPlus className="size-3.5" /> {ocupado ? 'creando…' : 'Crear y darle clave'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => { setAbierto(false); setDatos(vacio); }}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function Asesores({ slug }: { slug: string }) {
  const [equipo, setEquipo] = useState<Asesor[] | null>(null);
  const [error, setError] = useState('');
  const [credencial, setCredencial] = useState<{ email: string; clave: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setEquipo((await api.asesores.listar(slug)).equipo);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => { void cargar(); }, [cargar]);

  if (error) return <p className="py-8 text-center text-sm text-amber-500">{error}</p>;
  if (!equipo) return <p className="py-8 text-center text-sm text-muted-foreground">cargando…</p>;

  // Se ordena por nivel y no por nombre: el orden de la lista es el mismo en el
  // que el bot les pasa las conversaciones, y verlo así hace obvio quién está
  // atendiendo y quién es el respaldo.
  const ordenado = [...equipo].sort((a, b) => (a.nivel - b.nivel) || a.nombre.localeCompare(b.nombre));

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Cada uno entra con su propio usuario, y en la conversación se ve quién contestó.
        El bot le pasa el chat al del nivel más bajo que tenga menos conversaciones abiertas.
      </p>

      {credencial ? (
        <Credencial
          email={credencial.email}
          clave={credencial.clave}
          alCerrar={() => setCredencial(null)}
        />
      ) : null}

      {ordenado.map((a) => (
        <Fila
          key={a.id}
          slug={slug}
          asesor={a}
          alCambiar={() => void cargar()}
          alBorrar={() => void cargar()}
          alClave={(email, clave) => setCredencial({ email, clave })}
        />
      ))}

      <Alta
        slug={slug}
        alCreado={(email, clave) => { setCredencial({ email, clave }); void cargar(); }}
      />
    </div>
  );
}
