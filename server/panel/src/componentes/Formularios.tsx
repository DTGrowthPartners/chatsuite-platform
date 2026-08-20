import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ClipboardCheck, Copy, Download, FileText, KeyRound, Loader2, Paperclip,
  Plus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { api, type AdjuntoForm, type DetalleForm, type ResumenForm } from '@/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ListaFilas, type Fila } from '@/componentes/ListaFilas';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// Base UI no admite un item con value="" —lo trata como "sin seleccion" y el
// placeholder se come la etiqueta—, asi que "sin responder" viaja con centinela.
const SIN = '__sin__';

// Base UI necesita el mapa valor -> etiqueta para pintar el disparador; sin el
// muestra el valor crudo ("tienda", "8", "propio") en vez del texto.
const HORAS_ITEMS: Record<string, string> = {
  [SIN]: '--',
  ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), `${String(i).padStart(2, '0')}:00`])),
};

const items = (pregunta: { opciones?: { id: string; texto: string }[] }) => ({
  [SIN]: '— sin responder —',
  ...Object.fromEntries((pregunta.opciones || []).map((o) => [o.id, o.texto])),
});

/** Las horas salen en cuatro sitios distintos; una sola pieza para todos. */
function SelectHora({ valor, alCambiar }: {
  valor?: number;
  alCambiar: (h: number) => void;
}) {
  return (
    <Select
      value={Number.isInteger(valor) ? String(valor) : SIN}
      items={HORAS_ITEMS}
      onValueChange={(v) => v !== SIN && alCambiar(Number(v))}
    >
      <SelectTrigger size="sm" className="w-auto min-w-24 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SIN}>--</SelectItem>
        {Array.from({ length: 25 }, (_, i) => (
          <SelectItem key={i} value={String(i)}>{String(i).padStart(2, '0')}:00</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const enlaceDe = (token: string) => `${window.location.origin}/f/${token}`;

async function copiar(texto: string, que: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${que} copiado`);
  } catch {
    toast.error('El navegador no dejo copiar. Selecciona el texto a mano.');
  }
}

const ETIQUETA_ESTADO: Record<string, string> = {
  abierto: 'Sin entregar',
  entregado: 'Con el cliente',
  usado: 'Ya usado en un alta',
};

// ------------------------------------------------------------------ lista

export function Formularios({ alAbrir }: { alAbrir: (id: string) => void }) {
  const [lista, setLista] = useState<ResumenForm[] | null>(null);
  const [tipos, setTipos] = useState<{ id: string; titulo: string; descripcion: string }[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [recienCreado, setRecienCreado] = useState<{ token: string; clave: string; negocio: string } | null>(null);
  const [borrando, setBorrando] = useState<ResumenForm | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const d = await api.formularios.listar();
      setLista(d.formularios);
      setTipos(d.tipos);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, []);

  useEffect(() => { refrescar(); }, [refrescar]);

  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Onboarding
        </h2>
        <Button size="sm" variant="outline" onClick={() => setNuevo(true)}>
          <Plus /> Nuevo formulario
        </Button>
      </div>

      {!lista ? null : lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
          <FileText className="mx-auto size-7 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">Todavía no hay formularios</p>
          <p className="mx-auto mt-1.5 max-w-lg text-sm text-muted-foreground">
            Genera uno por negocio, mándale el enlace y la clave al dueño, y cuando
            responda podrás traerlo al crear su instancia.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lista.map((f) => (
            <Tarjeta
              key={f.id}
              form={f}
              alAbrir={() => alAbrir(f.id)}
              alBorrar={() => setBorrando(f)}
            />
          ))}
        </div>
      )}

      <DialogoNuevoFormulario
        abierto={nuevo}
        tipos={tipos}
        alCerrar={() => setNuevo(false)}
        alCreado={(d) => { setNuevo(false); setRecienCreado(d); refrescar(); }}
      />

      <DialogoEnlace
        datos={recienCreado}
        alCerrar={() => setRecienCreado(null)}
      />

      <DialogoBorrarFormulario
        form={borrando}
        alCerrar={() => setBorrando(null)}
        alBorrado={() => { setBorrando(null); refrescar(); }}
      />

    </section>
  );
}

function Tarjeta({ form, alAbrir, alBorrar }: {
  form: ResumenForm;
  alAbrir: () => void;
  alBorrar: () => void;
}) {
  const { avance } = form;
  return (
    // La tarjeta entera es el area de apertura, asi que el borrado NO puede ser
    // otro <button> dentro: anidar botones es HTML invalido y el navegador los
    // desanida por su cuenta. Va como <div role="button"> con el mismo teclado.
    <div
      role="button"
      tabIndex={0}
      onClick={alAbrir}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alAbrir(); }
      }}
      className="group relative cursor-pointer rounded-xl border bg-card p-4 text-left
        transition hover:border-ring/50 focus-visible:border-ring focus-visible:outline-none"
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); alBorrar(); }}
        aria-label={`Borrar el formulario de ${form.negocio}`}
        title="Borrar"
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-md
          text-muted-foreground opacity-0 transition hover:bg-destructive/15
          hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>

      <div className="flex items-start justify-between gap-3 pr-7">
        <div className="min-w-0">
          <div className="truncate font-medium">{form.negocio}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {ETIQUETA_ESTADO[form.estado]}
            {form.usadoPor && ` · ${form.usadoPor}`}
          </div>
        </div>
        {avance.listo && <Badge variant="secondary" className="shrink-0">Completo</Badge>}
      </div>

      <div className="mt-4 grid gap-1.5">
        <Progress value={avance.porcentaje} className="[&_[data-slot=progress-track]]:h-1.5" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{avance.hechas} de {avance.total} respuestas</span>
          <span className={avance.listo ? 'text-emerald-500' : 'text-amber-500'}>
            {avance.criticasHechas}/{avance.criticas} imprescindibles
          </span>
        </div>
      </div>

      {form.adjuntos > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3" /> {form.adjuntos} adjunto{form.adjuntos === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ borrar

/**
 * Confirmacion de borrado. Es un dialogo y no un doble clic porque esto se lleva
 * por delante lo que el cliente tardo en responder, y los adjuntos con el: no
 * hay papelera de la que sacarlo despues.
 */
function DialogoBorrarFormulario({ form, alCerrar, alBorrado }: {
  form: ResumenForm | null;
  alCerrar: () => void;
  alBorrado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  if (!form) return null;

  async function borrar() {
    setEnviando(true);
    try {
      await api.formularios.borrar(form!.id);
      toast.success(`Formulario de ${form!.negocio} borrado`);
      alBorrado();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && alCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Borrar el formulario de {form.negocio}</DialogTitle>
          <DialogDescription>
            Se van las {form.avance.hechas} respuestas
            {form.adjuntos === 1 && ' y el adjunto'}
            {form.adjuntos > 1 && ` y los ${form.adjuntos} adjuntos`}, y el enlace deja
            de funcionar. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        {form.estado === 'usado' && (
          <Alert>
            <ClipboardCheck className="size-4" />
            <AlertDescription>
              Este formulario se usó para crear <strong>{form.usadoPor}</strong>. Esa
              instancia sigue funcionando —el briefing ya está en su <code>negocio.md</code>—,
              pero pierdes el original y los adjuntos.
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={alCerrar}>Cancelar</Button>
          <Button variant="destructive" onClick={borrar} disabled={enviando}>
            {enviando && <Loader2 className="animate-spin" />}
            <Trash2 /> Borrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ crear

function DialogoNuevoFormulario({ abierto, tipos, alCerrar, alCreado }: {
  abierto: boolean;
  tipos: { id: string; titulo: string; descripcion: string }[];
  alCerrar: () => void;
  alCreado: (d: { token: string; clave: string; negocio: string }) => void;
}) {
  const [negocio, setNegocio] = useState('');
  const [tipoBot, setTipoBot] = useState('tienda');
  const [contacto, setContacto] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function crear() {
    setEnviando(true);
    try {
      const d = await api.formularios.crear({ negocio, tipoBot, contacto, nota });
      alCreado({ token: d.token, clave: d.clave, negocio });
      setNegocio(''); setContacto(''); setNota(''); setTipoBot('tienda');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && alCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo formulario de onboarding</DialogTitle>
          <DialogDescription>
            El tipo de bot decide qué preguntas ve el cliente. Un consultorio no tiene
            tabla de zonas de domicilio ni precio al por mayor.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="negocio">Negocio</Label>
            <Input
              id="negocio" autoFocus value={negocio}
              onChange={(e) => setNegocio(e.target.value)}
              placeholder="Tu Bodega Cartagena"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tipoBot">Qué va a hacer el bot</Label>
            <Select
              value={tipoBot}
              items={Object.fromEntries(tipos.map((t) => [t.id, t.titulo]))}
              onValueChange={(v) => setTipoBot(String(v))}
            >
              <SelectTrigger id="tipoBot"><SelectValue /></SelectTrigger>
              <SelectContent className="max-w-[min(28rem,90vw)]">
                {tipos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex flex-col gap-0.5">
                      <span>{t.titulo}</span>
                      <span className="text-xs text-muted-foreground">{t.descripcion}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contacto">Contacto (opcional)</Label>
            <Input
              id="contacto" value={contacto}
              onChange={(e) => setContacto(e.target.value)}
              placeholder="Nombre y WhatsApp de quien lo va a llenar"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="nota">Nota interna (opcional)</Label>
            <Input
              id="nota" value={nota} onChange={(e) => setNota(e.target.value)}
              placeholder="Para ti, el cliente no la ve"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={alCerrar}>Cancelar</Button>
          <Button onClick={crear} disabled={enviando || !negocio.trim()}>
            {enviando && <Loader2 className="animate-spin" />} Generar enlace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ enlace

function DialogoEnlace({ datos, alCerrar }: {
  datos: { token: string; clave: string; negocio: string } | null;
  alCerrar: () => void;
}) {
  if (!datos) return null;
  const enlace = enlaceDe(datos.token);
  const mensaje = `Hola! Para armar el bot de ${datos.negocio} necesitamos que respondas `
    + `este formulario. Se guarda solo, así que puedes dejarlo a medias y seguir después.\n\n`
    + `${enlace}\n\nClave de acceso: ${datos.clave}`;

  return (
    <Dialog open onOpenChange={(o) => !o && alCerrar()}>
      {/* Mas ancho que el resto de dialogos: aqui hay un enlace largo, una clave
          y el mensaje ya redactado. Con el ancho por defecto (max-w-sm) el
          enlace se partia y el mensaje obligaba a hacer scroll justo cuando lo
          que quieres es leerlo entero de un vistazo antes de copiarlo. */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Listo, este es el enlace</DialogTitle>
          <DialogDescription>
            El enlace y la clave van juntos. Puedes volver a verlos cuando quieras
            abriendo el formulario desde la lista.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Campo etiqueta="Enlace" valor={enlace} />
          <Campo etiqueta="Clave de acceso" valor={datos.clave} mono />

          <div className="grid gap-2">
            <Label>Mensaje listo para pegar</Label>
            <textarea
              readOnly rows={4}
              className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm"
              value={mensaje}
            />
            <Button variant="outline" size="sm" onClick={() => copiar(mensaje, 'Mensaje')}>
              <Copy /> Copiar el mensaje completo
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={alCerrar}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div className="grid gap-2">
      <Label>{etiqueta}</Label>
      <div className="flex gap-2">
        <Input readOnly value={valor} className={mono ? 'font-mono tracking-widest' : ''} />
        <Button variant="outline" size="icon" onClick={() => copiar(valor, etiqueta)}>
          <Copy className="size-4" />
          <span className="sr-only">Copiar {etiqueta}</span>
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ detalle
//
// Vista propia y no un modal. Son 53 preguntas con sus adjuntos: dentro de un
// dialogo quedaba una columna estrecha con scroll propio encima del panel, que
// es exactamente la sensacion de estar mirando algo por una rendija.

export function VistaFormulario({ id, alVolver }: { id: string; alVolver: () => void }) {
  const [datos, setDatos] = useState<DetalleForm | null>(null);
  const [cargando, setCargando] = useState(false);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  useEffect(() => {
    setCargando(true);
    api.formularios.detalle(id)
      .then(setDatos)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setCargando(false));
  }, [id]);

  // Responder por el cliente. Mismo guardado con pausa que en el formulario
  // publico, pero marcado como 'dtgp' para que al revisar se distinga lo que
  // adelantamos nosotros de lo que dijo el negocio.
  const temporizadores = useRef<Record<string, number>>({});
  const responder = useCallback((pregunta: string, valor: unknown, inmediato = false) => {
    setDatos((d) => (d ? {
      ...d,
      formulario: { ...d.formulario, respuestas: { ...d.formulario.respuestas, [pregunta]: valor } },
    } : d));
    window.clearTimeout(temporizadores.current[pregunta]);
    temporizadores.current[pregunta] = window.setTimeout(async () => {
      try {
        const r = await api.formularios.responder(id, pregunta, valor);
        setDatos((d) => (d ? { ...d, resumen: { ...d.resumen, avance: r.avance } } : d));
      } catch (e) {
        toast.error((e as Error).message);
      }
    }, inmediato ? 0 : 900);
  }, [id]);

  async function regenerar() {
    try {
      const r = await api.formularios.nuevaClave(id);
      setDatos((d) => (d ? { ...d, formulario: { ...d.formulario, clave: r.clave } } : d));
      toast.success('Clave nueva. La anterior dejó de servir.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const form = datos?.formulario;
  const avance = datos?.resumen.avance;

  const porSeccion = useMemo(() => {
    if (!datos) return [];
    return datos.secciones.map((s) => ({
      seccion: s,
      preguntas: datos.preguntas.filter((p) => p.seccion === s.id),
    }));
  }, [datos]);

  if (cargando || !form || !avance) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" onClick={alVolver} className="-ml-2 mb-4">
        <ArrowLeft /> Volver a los clientes
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{form.negocio}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ETIQUETA_ESTADO[form.estado]}
          {form.contacto && ` · ${form.contacto}`}
          {form.nota && ` · ${form.nota}`}
        </p>
      </div>

      {/* El enlace y el avance arriba, en dos columnas: es lo que se viene a
          mirar de un vistazo. Las preguntas van debajo, a lo ancho. */}
      <div className="grid gap-4">
        <div className="grid gap-4 rounded-xl border p-4 lg:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Progress value={avance.porcentaje} className="[&_[data-slot=progress-track]]:h-1.5" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{avance.hechas} de {avance.total} respuestas</span>
              <span className={avance.listo ? 'text-emerald-500' : 'text-amber-500'}>
                {avance.criticasHechas}/{avance.criticas} imprescindibles
              </span>
            </div>
          </div>

          <div className="grid gap-3">
            <Campo etiqueta="Enlace" valor={enlaceDe(form.token)} />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Campo etiqueta="Clave de acceso" valor={form.clave} mono />
              </div>
              <Button variant="outline" size="icon" onClick={regenerar} title="Generar clave nueva">
                <KeyRound className="size-4" />
                <span className="sr-only">Generar clave nueva</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={api.formularios.urlBriefing(form.id)}
            target="_blank" rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs
              font-medium transition hover:bg-accent"
          >
            <Download className="size-3.5" /> Ver el briefing
          </a>
          <Button variant="outline" size="sm" onClick={() => setConfirmarBorrado(true)}>
            <Trash2 /> Borrar
          </Button>
        </div>

        <DialogoBorrarFormulario
          form={confirmarBorrado ? datos!.resumen : null}
          alCerrar={() => setConfirmarBorrado(false)}
          alBorrado={alVolver}
        />

        {form.estado === 'usado' && (
          <Alert>
            <ClipboardCheck className="size-4" />
            <AlertDescription>
              Ya se usó para crear <strong>{form.usadoPor}</strong>. Editarlo ahora no
              cambia esa instancia: los cambios hay que llevarlos al configurador del bot.
            </AlertDescription>
          </Alert>
        )}

        <p className="text-xs text-muted-foreground">
          Puedes responder tú mismo cualquier pregunta para adelantarle trabajo al
          cliente. Lo que escribas aquí le aparece marcado como nuestro.
        </p>

        {porSeccion.map(({ seccion, preguntas }) => (
          <div key={seccion.id} className="grid gap-3">
            <h3 className="mt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {seccion.numero}. {seccion.titulo}
              {seccion.dtgp && ' · lo llenas tú'}
            </h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {preguntas.map((p) => (
                <PreguntaPanel
                  key={p.id}
                  pregunta={p}
                  valor={form.respuestas[p.id]}
                  adjuntos={form.adjuntos[p.id] || []}
                  formId={form.id}
                  loPusoDtgp={form.origen[p.id] === 'dtgp'}
                  alResponder={responder}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="pt-2">
          <Button variant="outline" onClick={alVolver}>
            <ArrowLeft /> Volver a los clientes
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreguntaPanel({ pregunta, valor, adjuntos, formId, loPusoDtgp, alResponder }: {
  pregunta: DetalleForm['preguntas'][number];
  valor: unknown;
  adjuntos: AdjuntoForm[];
  formId: string;
  loPusoDtgp: boolean;
  alResponder: (pregunta: string, valor: unknown, inmediato?: boolean) => void;
}) {
  const obj = (valor || {}) as Record<string, unknown>;

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm leading-snug">
        <span className="mr-1.5 tabular-nums text-muted-foreground">{pregunta.numero}.</span>
        {pregunta.pregunta}
        {pregunta.critico && <span className="ml-2 text-[10px] tracking-wide text-amber-500">IMPRESCINDIBLE</span>}
        {loPusoDtgp && <span className="ml-2 text-[10px] tracking-wide text-sky-400">LO PUSIMOS NOSOTROS</span>}
      </div>

      {pregunta.tipo === 'archivo' ? (
        adjuntos.length === 0
          ? <p className="text-xs text-muted-foreground">Sin adjuntos.</p>
          : (
            <ul className="grid gap-1.5">
              {adjuntos.map((a) => (
                <li key={a.guardado}>
                  <a
                    href={api.formularios.urlAdjunto(formId, a.guardado)}
                    className="flex items-center gap-2 text-xs text-sky-400 hover:underline"
                  >
                    <Paperclip className="size-3" />
                    {a.nombre}
                    <span className="text-muted-foreground">{Math.round(a.bytes / 1024)} KB</span>
                  </a>
                  {/* Lo que el cliente escribió sobre el archivo: de qué producto
                      es la foto, su precio, su cantidad. */}
                  {pregunta.camposAdjunto && (
                    <div className="mt-0.5 pl-5 text-xs text-muted-foreground">
                      {pregunta.camposAdjunto
                        .map((c) => [c.etiqueta, a.meta?.[c.id]] as const)
                        .filter(([, v]) => v)
                        .map(([e, v]) => `${e}: ${v}`)
                        .join(' · ') || 'sin datos del producto'}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
      ) : pregunta.tipo === 'opciones' ? (
        <Select
          value={String(obj.opcion ?? SIN)}
          items={items(pregunta)}
          onValueChange={(v) => alResponder(pregunta.id, { ...obj, opcion: v === SIN ? '' : String(v) }, true)}
        >
          <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SIN}>— sin responder —</SelectItem>
            {pregunta.opciones?.map((o) => <SelectItem key={o.id} value={o.id}>{o.texto}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : pregunta.tipo === 'multiple' ? (
        <div className="grid gap-1.5">
          {pregunta.opciones?.map((o) => {
            const marcadas = (obj.opciones as string[]) || [];
            return (
              <label key={o.id} className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={marcadas.includes(o.id)}
                  onCheckedChange={(c) => alResponder(pregunta.id, {
                    ...obj,
                    opciones: c ? [...marcadas, o.id] : marcadas.filter((x) => x !== o.id),
                  }, true)}
                />
                {o.texto}
              </label>
            );
          })}
          {((obj.notas as string[]) || []).filter(Boolean).map((n, i) => (
            <div key={i} className="text-xs text-muted-foreground">+ {n}</div>
          ))}
          {typeof obj.nota === 'string' && obj.nota && (
            <div className="text-xs text-muted-foreground">+ {obj.nota}</div>
          )}
        </div>
      ) : pregunta.tipo === 'si_no' || pregunta.tipo === 'si_no_texto' ? (
        <div className="grid gap-2">
          <div className="flex gap-2">
            {[true, false].map((si) => (
              <Button
                key={String(si)} size="sm"
                variant={obj.si === si ? 'default' : 'outline'}
                onClick={() => alResponder(pregunta.id, { ...obj, si }, true)}
              >
                {si ? 'Sí' : 'No'}
              </Button>
            ))}
          </div>
          {pregunta.tipo === 'si_no_texto' && (
            <textarea
              rows={2}
              className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring"
              placeholder={pregunta.etiquetaTexto}
              value={String(obj.texto ?? '')}
              onChange={(e) => alResponder(pregunta.id, { ...obj, texto: e.target.value })}
            />
          )}
        </div>
      ) : pregunta.tipo === 'lista' ? (
        <ListaFilas
          id={`panel-${pregunta.id}`}
          compacto
          columnas={pregunta.columnas || []}
          etiquetaAgregar={pregunta.etiquetaAgregar}
          filas={(valor as Fila[]) || []}
          alCambiar={(filas) => alResponder(pregunta.id, filas)}
          columnaFoto={pregunta.fotos?.columna}
          urlFoto={(g) => api.formularios.urlAdjunto(formId, g, true)}
        />
      ) : pregunta.tipo === 'ventana' ? (
        <div className="grid gap-2 text-xs">
          <Select
            value={String(obj.modo ?? SIN)}
            items={items(pregunta)}
            onValueChange={(v) => alResponder(pregunta.id, { ...obj, modo: v === SIN ? '' : String(v) }, true)}
          >
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN}>— sin responder —</SelectItem>
              {pregunta.opciones?.map((o) => <SelectItem key={o.id} value={o.id}>{o.texto}</SelectItem>)}
            </SelectContent>
          </Select>
          {obj.modo === 'propio' && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">de</span>
              {(['desde', 'hasta'] as const).map((k) => (
                <SelectHora
                  key={k}
                  valor={obj[k] as number | undefined}
                  alCambiar={(h) => alResponder(pregunta.id, { ...obj, [k]: h }, true)}
                />
              ))}
              {Number.isInteger(obj.desde) && Number.isInteger(obj.hasta)
                && (obj.desde as number) > (obj.hasta as number) && (
                <span className="text-muted-foreground">del día siguiente</span>
              )}
            </div>
          )}
        </div>
      ) : pregunta.tipo === 'horario' ? (
        <div className="grid gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">De</span>
            <SelectHora
              valor={obj.desde as number | undefined}
              alCambiar={(h) => alResponder(pregunta.id, { ...obj, desde: h }, true)}
            />
            <span className="text-muted-foreground">a</span>
            <SelectHora
              valor={obj.hasta as number | undefined}
              alCambiar={(h) => alResponder(pregunta.id, { ...obj, hasta: h }, true)}
            />
          </div>
          <Input
            className="h-8 text-xs" placeholder="Días"
            value={String(obj.dias ?? '')}
            onChange={(e) => alResponder(pregunta.id, { ...obj, dias: e.target.value })}
          />
          <Input
            className="h-8 text-xs" placeholder="Mensaje fuera de horario"
            value={String(obj.mensaje ?? '')}
            onChange={(e) => alResponder(pregunta.id, { ...obj, mensaje: e.target.value })}
          />
        </div>
      ) : pregunta.tipo === 'largo' ? (
        <textarea
          rows={3}
          className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring"
          value={String(valor ?? '')}
          onChange={(e) => alResponder(pregunta.id, e.target.value)}
        />
      ) : (
        <Input
          value={String(valor ?? '')}
          onChange={(e) => alResponder(pregunta.id, e.target.value)}
        />
      )}
    </div>
  );
}
