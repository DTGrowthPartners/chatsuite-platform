import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check, ChevronLeft, ChevronRight, CircleAlert, CloudUpload, Loader2, Moon, Paperclip,
  PartyPopper, Plus, Save, Sun, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ListaFilas, type Columna, type Fila } from '@/componentes/ListaFilas';
import { LockupDTGP } from '@/componentes/Marca';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { aplicarTema, LLAVE_TEMA, type Tema, temaInicial } from './tema-formulario';

// ---------------------------------------------------------------- tipos

type Opcion = { id: string; texto: string };
type CampoAdjunto = { id: string; etiqueta: string; ancho?: number };

type Pregunta = {
  id: string;
  seccion: string;
  n: number;
  tipo: 'texto' | 'largo' | 'si_no' | 'si_no_texto' | 'opciones' | 'multiple' | 'archivo'
    | 'horario' | 'ventana' | 'lista';
  pregunta: string;
  ayuda?: string;
  critico?: boolean;
  opciones?: Opcion[];
  conNota?: string;
  etiquetaTexto?: string;
  varios?: boolean;
  acepta?: string;
  filas?: number;
  columnas?: Columna[];
  etiquetaAgregar?: string;
  camposAdjunto?: CampoAdjunto[];
  notasVarias?: string;
};

type Seccion = { id: string; numero: number; titulo: string; descripcion: string; dtgp?: boolean };
type Adjunto = {
  nombre: string; guardado: string; bytes: number; subido: string;
  meta?: Record<string, string>;
};
type Avance = {
  total: number; hechas: number; criticas: number; criticasHechas: number;
  porcentaje: number; listo: boolean;
};

type Formulario = {
  id: string;
  negocio: string;
  tipoBot: string;
  estado: string;
  secciones: Seccion[];
  preguntas: Pregunta[];
  respuestas: Record<string, unknown>;
  origen: Record<string, string>;
  adjuntos: Record<string, Adjunto[]>;
  avance: Avance;
};

// ---------------------------------------------------------------- red

const tokenDeLaUrl = () => decodeURIComponent(window.location.pathname.replace(/^\/f\//, ''));

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(ruta, {
    headers: opciones.body ? { 'content-type': 'application/json' } : undefined,
    ...opciones,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((datos as { error?: string }).error || `error ${r.status}`);
  return datos as T;
}

const KB = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

// ---------------------------------------------------------------- vista

export function FormularioPublico() {
  const [form, setForm] = useState<Formulario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [negocio, setNegocio] = useState<string | null>(null);
  const [existe, setExiste] = useState(true);

  useEffect(() => {
    pedir<{ abierto: boolean; existe?: boolean; negocio?: string; formulario?: Formulario }>(
      `/api/form/sesion?token=${encodeURIComponent(tokenDeLaUrl())}`,
    )
      .then((d) => {
        if (d.abierto && d.formulario) setForm(d.formulario);
        else { setExiste(d.existe !== false); setNegocio(d.negocio || null); }
      })
      .catch(() => setExiste(false))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!form) return <Acceso negocio={negocio} existe={existe} alEntrar={setForm} />;
  return <Cuestionario inicial={form} />;
}

/** Interruptor de tema. Vive en las dos pantallas, acceso y cuestionario. */
function BotonTema() {
  const [tema, setTema] = useState<Tema>(temaInicial);
  return (
    <button
      type="button"
      aria-label={tema === 'oscuro' ? 'Pasar a modo claro' : 'Pasar a modo oscuro'}
      title={tema === 'oscuro' ? 'Modo claro' : 'Modo oscuro'}
      onClick={() => {
        const nuevo: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
        setTema(nuevo);
        aplicarTema(nuevo);
        localStorage.setItem(LLAVE_TEMA, nuevo);
      }}
      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground
        transition hover:bg-accent hover:text-foreground"
    >
      {tema === 'oscuro' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

// ---------------------------------------------------------------- acceso

function Acceso({ negocio, existe, alEntrar }: {
  negocio: string | null;
  existe: boolean;
  alEntrar: (f: Formulario) => void;
}) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      const d = await pedir<{ formulario: Formulario }>('/api/form/entrar', {
        method: 'POST',
        body: JSON.stringify({ token: tokenDeLaUrl(), clave }),
      });
      alEntrar(d.formulario);
    } catch (e) {
      setError((e as Error).message);
      setClave('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-muted/40 p-6">
      <div className="absolute right-4 top-4"><BotonTema /></div>
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {negocio ? `Onboarding de ${negocio}` : 'Formulario de onboarding'}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {existe
              ? 'Escribe la clave de 6 digitos que te enviamos junto a este enlace.'
              : 'Este enlace no corresponde a ningun formulario. Pidenos uno nuevo.'}
          </p>
        </div>

        {existe && (
          <form onSubmit={enviar} className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="clave">Clave de acceso</Label>
                <Input
                  id="clave" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} placeholder="000000" autoFocus required
                  className="text-center text-lg tracking-[0.5em]"
                  value={clave}
                  onChange={(e) => setClave(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              {error && (
                <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
              )}
              <Button type="submit" disabled={enviando || clave.length < 6} className="w-full">
                {enviando && <Loader2 className="animate-spin" />}
                {enviando ? 'Entrando…' : 'Entrar'}
              </Button>
            </div>
          </form>
        )}

        <div className="mt-7 flex justify-center">
          <LockupDTGP className="h-5 opacity-60 dark:opacity-75" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- cuestionario

function Cuestionario({ inicial }: { inicial: Formulario }) {
  const [form, setForm] = useState(inicial);
  const [seccion, setSeccion] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(inicial.estado !== 'abierto');

  // El cliente no ve la seccion tecnica: la llena DTGP con el en una llamada, y
  // pedirle el acceso al Business Manager en un formulario asusta mas de lo que
  // resuelve.
  const secciones = useMemo(() => form.secciones.filter((s) => !s.dtgp), [form.secciones]);
  const actual = secciones[seccion];
  const preguntas = useMemo(
    () => form.preguntas.filter((p) => p.seccion === actual?.id),
    [form.preguntas, actual],
  );

  // Guardado automatico. Cada campo pide su propio guardado tras una pausa de
  // tecleo; el temporizador se lleva por pregunta para que escribir en una no
  // cancele el guardado pendiente de otra.
  const temporizadores = useRef<Record<string, number>>({});
  const guardar = useCallback(async (pregunta: string, valor: unknown) => {
    setGuardando(true);
    try {
      const d = await pedir<{ avance: Avance; guardado: string }>('/api/form/respuesta', {
        method: 'PUT',
        body: JSON.stringify({ pregunta, valor }),
      });
      setForm((f) => ({ ...f, avance: d.avance }));
      setGuardado(d.guardado);
    } catch (e) {
      toast.error(`No se pudo guardar: ${(e as Error).message}`);
    } finally {
      setGuardando(false);
    }
  }, []);

  const cambiar = useCallback((pregunta: string, valor: unknown, inmediato = false) => {
    setForm((f) => ({ ...f, respuestas: { ...f.respuestas, [pregunta]: valor } }));
    window.clearTimeout(temporizadores.current[pregunta]);
    temporizadores.current[pregunta] = window.setTimeout(
      () => guardar(pregunta, valor),
      inmediato ? 0 : 900,
    );
  }, [guardar]);

  // Salir a media escritura no puede costar el ultimo parrafo.
  useEffect(() => {
    const alSalir = () => {
      for (const id of Object.keys(temporizadores.current)) {
        window.clearTimeout(temporizadores.current[id]);
      }
    };
    window.addEventListener('pagehide', alSalir);
    return () => { alSalir(); window.removeEventListener('pagehide', alSalir); };
  }, []);

  async function enviar() {
    try {
      await pedir('/api/form/enviar', { method: 'POST' });
      setEnviado(true);
      toast.success('Listo, ya lo tenemos');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const { avance } = form;
  const faltanCriticas = avance.criticas - avance.criticasHechas;

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-4">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight">{form.negocio}</h1>
              <p className="text-xs text-muted-foreground">Onboarding del bot de WhatsApp</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-xs text-muted-foreground">
                {guardando
                  ? <span className="flex items-center gap-1.5"><Loader2 className="size-3 animate-spin" />Guardando…</span>
                  : guardado
                    ? <span className="flex items-center gap-1.5"><Save className="size-3" />Guardado</span>
                    : 'Se guarda solo'}
              </span>
              <BotonTema />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={avance.porcentaje} className="flex-1 [&_[data-slot=progress-track]]:h-1.5" />
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {avance.hechas}/{avance.total}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-7">
        {enviado && (
          <Alert className="mb-6">
            <PartyPopper className="size-4" />
            <AlertDescription>
              Ya nos enviaste el formulario. Puedes seguir editandolo: tomamos siempre
              la ultima version.
            </AlertDescription>
          </Alert>
        )}

        <nav className="mb-7 flex flex-wrap gap-1.5">
          {secciones.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSeccion(i)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                i === seccion
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.numero}. {s.titulo}
            </button>
          ))}
        </nav>

        {actual && (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-semibold tracking-tight">{actual.titulo}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{actual.descripcion}</p>
            </div>

            <div className="grid gap-5">
              {preguntas.map((p) => (
                <Campo
                  key={p.id}
                  pregunta={p}
                  valor={form.respuestas[p.id]}
                  adjuntos={form.adjuntos[p.id] || []}
                  loPusoDtgp={form.origen[p.id] === 'dtgp'}
                  alCambiar={cambiar}
                  alAdjuntar={(lista, av) => setForm((f) => ({
                    ...f,
                    adjuntos: { ...f.adjuntos, [p.id]: lista },
                    avance: av ?? f.avance,
                  }))}
                />
              ))}
            </div>

            <div className="mt-8 flex items-center justify-between gap-3 border-t pt-6">
              <Button
                variant="outline" type="button" disabled={seccion === 0}
                onClick={() => { setSeccion((i) => i - 1); window.scrollTo({ top: 0 }); }}
              >
                <ChevronLeft /> Anterior
              </Button>

              {seccion < secciones.length - 1 ? (
                <Button
                  type="button"
                  onClick={() => { setSeccion((i) => i + 1); window.scrollTo({ top: 0 }); }}
                >
                  Siguiente <ChevronRight />
                </Button>
              ) : (
                <Button type="button" onClick={enviar}>
                  <Check /> {enviado ? 'Avisar que lo actualice' : 'Enviar el formulario'}
                </Button>
              )}
            </div>

            {seccion === secciones.length - 1 && faltanCriticas > 0 && (
              <Alert className="mt-5" variant="destructive">
                <CircleAlert className="size-4" />
                <AlertDescription>
                  Faltan {faltanCriticas} respuestas marcadas como imprescindibles. Puedes
                  enviarlo igual y completarlas despues, pero el bot no puede salir a
                  produccion sin ellas.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- un campo

function Campo({ pregunta, valor, adjuntos, loPusoDtgp, alCambiar, alAdjuntar }: {
  pregunta: Pregunta;
  valor: unknown;
  adjuntos: Adjunto[];
  loPusoDtgp: boolean;
  alCambiar: (id: string, valor: unknown, inmediato?: boolean) => void;
  alAdjuntar: (lista: Adjunto[], avance?: Avance) => void;
}) {
  const v = valor as Record<string, unknown> | string | undefined;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3">
        <Label htmlFor={pregunta.id} className="text-sm leading-snug font-medium">
          <span className="mr-1.5 text-muted-foreground tabular-nums">{pregunta.n}.</span>
          {pregunta.pregunta}
          {pregunta.critico && (
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-600 dark:text-amber-400">
              IMPRESCINDIBLE
            </span>
          )}
        </Label>
        {pregunta.ayuda && (
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{pregunta.ayuda}</p>
        )}
        {loPusoDtgp && (
          <p className="mt-1.5 text-xs text-sky-600 dark:text-sky-400">
            Esto lo dejamos escrito nosotros para ahorrarte tiempo. Corrigelo si no cuadra.
          </p>
        )}
      </div>

      <Control
        pregunta={pregunta} valor={v} adjuntos={adjuntos}
        alCambiar={alCambiar} alAdjuntar={alAdjuntar}
      />
    </div>
  );
}

function Control({ pregunta, valor, adjuntos, alCambiar, alAdjuntar }: {
  pregunta: Pregunta;
  valor: unknown;
  adjuntos: Adjunto[];
  alCambiar: (id: string, valor: unknown, inmediato?: boolean) => void;
  alAdjuntar: (lista: Adjunto[], avance?: Avance) => void;
}) {
  const obj = (valor || {}) as Record<string, unknown>;
  const nota = (
    pregunta.conNota
      ? (
        <Input
          className="mt-2"
          placeholder={pregunta.conNota}
          value={String(obj.nota ?? '')}
          onChange={(e) => alCambiar(pregunta.id, { ...obj, nota: e.target.value })}
        />
      )
      : null
  );

  switch (pregunta.tipo) {
    case 'texto':
      return (
        <Input
          id={pregunta.id}
          value={String(valor ?? '')}
          onChange={(e) => alCambiar(pregunta.id, e.target.value)}
        />
      );

    case 'largo':
      return (
        <textarea
          id={pregunta.id}
          rows={pregunta.filas ?? 4}
          className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring"
          value={String(valor ?? '')}
          onChange={(e) => alCambiar(pregunta.id, e.target.value)}
        />
      );

    case 'si_no':
    case 'si_no_texto':
      return (
        <div className="grid gap-3">
          <div className="flex gap-2">
            {[true, false].map((si) => (
              <Button
                key={String(si)}
                type="button"
                variant={obj.si === si ? 'default' : 'outline'}
                size="sm"
                onClick={() => alCambiar(pregunta.id, { ...obj, si }, true)}
              >
                {si ? 'Si' : 'No'}
              </Button>
            ))}
          </div>
          {pregunta.tipo === 'si_no_texto' && obj.si !== undefined && (
            <textarea
              rows={3}
              placeholder={pregunta.etiquetaTexto}
              className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring"
              value={String(obj.texto ?? '')}
              onChange={(e) => alCambiar(pregunta.id, { ...obj, texto: e.target.value })}
            />
          )}
        </div>
      );

    case 'opciones':
      return (
        <div className="grid gap-2">
          {pregunta.opciones?.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => alCambiar(pregunta.id, { ...obj, opcion: o.id }, true)}
              className={`rounded-lg border px-3.5 py-2.5 text-left text-sm transition ${
                obj.opcion === o.id ? 'border-primary bg-primary/10' : 'hover:bg-accent'
              }`}
            >
              {o.texto}
            </button>
          ))}
          {nota}
        </div>
      );

    case 'multiple': {
      const marcadas = (obj.opciones as string[]) || [];
      const notas = (obj.notas as string[]) || [];
      return (
        <div className="grid gap-2">
          {pregunta.opciones?.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={marcadas.includes(o.id)}
                onCheckedChange={(c) => alCambiar(pregunta.id, {
                  ...obj,
                  opciones: c ? [...marcadas, o.id] : marcadas.filter((x) => x !== o.id),
                }, true)}
              />
              {o.texto}
            </label>
          ))}

          {/* Las que llevan `notasVarias` admiten tantos añadidos como haga
              falta: con un solo campo, el segundo dato que se te ocurre no cabe
              en ninguna parte. */}
          {pregunta.notasVarias && (
            <div className="mt-1 grid gap-2">
              {notas.map((n, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder={pregunta.notasVarias}
                    value={n}
                    onChange={(e) => {
                      const copia = [...notas];
                      copia[i] = e.target.value;
                      alCambiar(pregunta.id, { ...obj, notas: copia });
                    }}
                  />
                  <Button
                    type="button" variant="ghost" size="icon"
                    aria-label="Quitar este dato"
                    onClick={() => alCambiar(
                      pregunta.id,
                      { ...obj, notas: notas.filter((_, j) => j !== i) },
                      true,
                    )}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button" variant="outline" size="sm" className="justify-self-start"
                onClick={() => alCambiar(pregunta.id, { ...obj, notas: [...notas, ''] }, true)}
              >
                <Plus /> {pregunta.notasVarias}
              </Button>
            </div>
          )}
          {nota}
        </div>
      );
    }

    case 'horario':
      return (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">De</span>
            <HoraSelect
              valor={obj.desde as number | undefined}
              alCambiar={(h) => alCambiar(pregunta.id, { ...obj, desde: h }, true)}
            />
            <span className="text-muted-foreground">a</span>
            <HoraSelect
              valor={obj.hasta as number | undefined}
              alCambiar={(h) => alCambiar(pregunta.id, { ...obj, hasta: h }, true)}
            />
          </div>
          <Input
            placeholder="Que dias? Ej: lunes a sabado"
            value={String(obj.dias ?? '')}
            onChange={(e) => alCambiar(pregunta.id, { ...obj, dias: e.target.value })}
          />
          <Input
            placeholder="Que dice el bot fuera de horario"
            value={String(obj.mensaje ?? '')}
            onChange={(e) => alCambiar(pregunta.id, { ...obj, mensaje: e.target.value })}
          />
        </div>
      );

    case 'lista':
      return (
        <ListaFilas
          id={pregunta.id}
          columnas={pregunta.columnas || []}
          etiquetaAgregar={pregunta.etiquetaAgregar}
          filas={(valor as Fila[]) || []}
          alCambiar={(filas) => alCambiar(pregunta.id, filas)}
        />
      );

    case 'ventana':
      return (
        <div className="grid gap-3">
          <div className="grid gap-2">
            {pregunta.opciones?.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => alCambiar(pregunta.id, { ...obj, modo: o.id }, true)}
                className={`rounded-lg border px-3.5 py-2.5 text-left text-sm transition ${
                  obj.modo === o.id ? 'border-primary bg-primary/10' : 'hover:bg-accent'
                }`}
              >
                {o.texto}
              </button>
            ))}
          </div>

          {obj.modo === 'propio' && (
            <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Responde de</span>
                <HoraSelect
                  valor={obj.desde as number | undefined}
                  alCambiar={(h) => alCambiar(pregunta.id, { ...obj, desde: h }, true)}
                />
                <span className="text-muted-foreground">a</span>
                <HoraSelect
                  valor={obj.hasta as number | undefined}
                  alCambiar={(h) => alCambiar(pregunta.id, { ...obj, hasta: h }, true)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{pistaVentana(obj)}</p>
            </div>
          )}
        </div>
      );

    case 'archivo':
      return <Adjuntos pregunta={pregunta} adjuntos={adjuntos} alAdjuntar={alAdjuntar} />;

    default:
      return null;
  }
}

/** Explica en palabras lo que se acaba de elegir, incluido el cruce de medianoche. */
function pistaVentana(obj: Record<string, unknown>) {
  const desde = obj.desde as number | undefined;
  const hasta = obj.hasta as number | undefined;
  if (!Number.isInteger(desde) || !Number.isInteger(hasta)) return 'Elige las dos horas.';
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  if (desde === hasta) return 'Misma hora de inicio y fin: el bot responde las 24 horas.';
  if (desde! > hasta!) {
    return `El bot responde de ${hh(desde!)} a ${hh(hasta!)} del dia siguiente. `
      + 'Cubre la noche mientras el equipo no esta.';
  }
  return `El bot responde de ${hh(desde!)} a ${hh(hasta!)}. Fuera de eso no contesta.`;
}

// Base UI no admite un item con value="": lo lee como "sin seleccion".
const SIN = '__sin__';

const HORAS_ITEMS: Record<string, string> = {
  [SIN]: '--',
  ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), `${String(i).padStart(2, '0')}:00`])),
};

function HoraSelect({ valor, alCambiar }: { valor?: number; alCambiar: (h: number) => void }) {
  return (
    <Select
      value={Number.isInteger(valor) ? String(valor) : SIN}
      items={HORAS_ITEMS}
      onValueChange={(v) => v !== SIN && alCambiar(Number(v))}
    >
      <SelectTrigger className="w-auto min-w-28"><SelectValue placeholder="--" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={SIN}>--</SelectItem>
        {Array.from({ length: 25 }, (_, i) => (
          <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Adjuntos({ pregunta, adjuntos, alAdjuntar }: {
  pregunta: Pregunta;
  adjuntos: Adjunto[];
  alAdjuntar: (lista: Adjunto[], avance?: Avance) => void;
}) {
  const [subiendo, setSubiendo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    // Uno a uno y no en paralelo: son archivos grandes y el navegador movil se
    // atraganta con varias subidas de 25 MB a la vez.
    for (const archivo of Array.from(archivos)) {
      setSubiendo((n) => n + 1);
      try {
        const r = await fetch(
          `/api/form/adjunto?pregunta=${encodeURIComponent(pregunta.id)}`
          + `&nombre=${encodeURIComponent(archivo.name)}`,
          { method: 'POST', body: archivo },
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `error ${r.status}`);
        alAdjuntar(d.adjuntos, d.avance);
      } catch (e) {
        toast.error(`${archivo.name}: ${(e as Error).message}`);
      } finally {
        setSubiendo((n) => n - 1);
      }
    }
    if (entrada.current) entrada.current.value = '';
  }

  // Mismo guardado con pausa que el resto del formulario, pero por archivo y
  // por campo: escribir el precio de una foto no puede cancelar el guardado
  // pendiente del producto de otra.
  const temporizadores = useRef<Record<string, number>>({});
  function escribirMeta(a: Adjunto, campo: string, valor: string) {
    const meta = { ...(a.meta || {}), [campo]: valor };
    alAdjuntar(adjuntos.map((x) => (x.guardado === a.guardado ? { ...x, meta } : x)));

    const llave = `${a.guardado}:${campo}`;
    window.clearTimeout(temporizadores.current[llave]);
    temporizadores.current[llave] = window.setTimeout(() => {
      pedir('/api/form/adjunto/meta', {
        method: 'POST',
        body: JSON.stringify({ pregunta: pregunta.id, guardado: a.guardado, meta }),
      }).catch((e) => toast.error(`No se pudo guardar: ${(e as Error).message}`));
    }, 900);
  }

  async function quitar(a: Adjunto) {
    try {
      const d = await pedir<{ adjuntos: Adjunto[] }>('/api/form/adjunto/borrar', {
        method: 'POST',
        body: JSON.stringify({ pregunta: pregunta.id, guardado: a.guardado }),
      });
      alAdjuntar(d.adjuntos);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="grid gap-3">
      {adjuntos.length > 0 && (
        <ul className="grid gap-2">
          {adjuntos.map((a) => (
            <li key={a.guardado} className="grid gap-2 rounded-lg border bg-background px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{a.nombre}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{KB(a.bytes)}</span>
                <button
                  type="button" onClick={() => quitar(a)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Quitar ${a.nombre}`}
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Los datos del archivo, si la pregunta los pide. Sin esto, un ZIP
                  de cien fotos llamadas IMG_0423 no le dice a nadie que producto
                  es cual, y alguien tiene que adivinarlo a mano despues. */}
              {pregunta.camposAdjunto && (
                <div className="grid gap-2 border-t pt-2 sm:grid-cols-4">
                  {pregunta.camposAdjunto.map((c) => (
                    <div
                      key={c.id}
                      className="grid gap-1"
                      style={{ gridColumn: `span ${Math.min(4, c.ancho ?? 1)} / span ${Math.min(4, c.ancho ?? 1)}` }}
                    >
                      <label className="text-[11px] text-muted-foreground" htmlFor={`${a.guardado}-${c.id}`}>
                        {c.etiqueta}
                      </label>
                      <Input
                        id={`${a.guardado}-${c.id}`}
                        className="h-8 text-sm"
                        value={a.meta?.[c.id] ?? ''}
                        onChange={(e) => escribirMeta(a, c.id, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div>
        <input
          ref={entrada}
          type="file"
          className="hidden"
          accept={pregunta.acepta}
          multiple={pregunta.varios}
          onChange={(e) => subir(e.target.files)}
        />
        <Button
          type="button" variant="outline" size="sm"
          disabled={subiendo > 0}
          onClick={() => entrada.current?.click()}
        >
          {subiendo > 0 ? <Loader2 className="animate-spin" /> : <CloudUpload />}
          {subiendo > 0
            ? `Subiendo ${subiendo}…`
            : adjuntos.length && !pregunta.varios ? 'Reemplazar archivo' : 'Subir archivo'}
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Hasta 25 MB por archivo{pregunta.varios ? ', puedes subir varios' : ''}.
        </p>
      </div>
    </div>
  );
}
