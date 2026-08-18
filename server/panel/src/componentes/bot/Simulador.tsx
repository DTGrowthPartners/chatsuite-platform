// El chat de prueba: la pantalla que permite dejar un bot listo ANTES de
// entregarselo al cliente.
//
// Corre el motor con el perfil real y las tools de verdad, pero sin mandar
// nada a WhatsApp. Ademas de la respuesta muestra las tools que se llamaron y
// que habria hecho cada una, que es lo que convierte "no me gusta como
// contesta" en algo accionable.
import { useRef, useState } from 'react';
import { Bot, RefreshCw, Send, User, Wrench } from 'lucide-react';
import { toast } from 'sonner';

import { api, type Simulacion } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Turno = { role: 'user' | 'assistant'; content: string };
type Traza = { indice: number; datos: Simulacion };

export function Simulador({ slug }: { slug: string }) {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [trazas, setTrazas] = useState<Traza[]>([]);
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio || cargando) return;
    const conMio: Turno[] = [...turnos, { role: 'user', content: limpio }];
    setTurnos(conMio);
    setTexto('');
    setCargando(true);
    try {
      const r = await api.bot.simular(slug, conMio);
      if (!r.ok) throw new Error('el motor no pudo simular');
      // Cada mensaje que saldria es un turno propio, igual que en WhatsApp.
      const respuestas: Turno[] = r.mensajes.map((m) => ({ role: 'assistant', content: m }));
      setTurnos([...conMio, ...respuestas]);
      setTrazas((t) => [...t, { indice: conMio.length, datos: r }]);
      setTimeout(() => fin.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } catch (e) {
      toast.error((e as Error).message);
      setTurnos(turnos);
      setTexto(limpio);
    } finally {
      setCargando(false);
    }
  }

  const ultima = trazas.at(-1)?.datos;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
      <div className="flex min-h-0 flex-col rounded-lg border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Nada de esto sale a WhatsApp. Las tools se ejecutan en seco.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setTurnos([]); setTrazas([]); }}
            disabled={!turnos.length}
          >
            <RefreshCw className="size-3.5" /> Reiniciar
          </Button>
        </div>

        <div className="max-h-[26rem] min-h-[14rem] space-y-2.5 overflow-y-auto p-3">
          {!turnos.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Escribe como si fueras un cliente.
            </p>
          ) : turnos.map((t, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={[
                'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                t.role === 'user' ? 'bg-primary/15' : 'bg-muted',
              ].join(' ')}
              >
                <span className="mb-1 flex items-center gap-1.5 text-[0.68rem] uppercase tracking-wide text-muted-foreground">
                  {t.role === 'user' ? <User className="size-3" /> : <Bot className="size-3" />}
                  {t.role === 'user' ? 'cliente' : 'bot'}
                </span>
                {t.content}
              </div>
            </div>
          ))}
          {cargando ? <p className="text-center text-xs text-muted-foreground">pensando…</p> : null}
          <div ref={fin} />
        </div>

        <div className="flex gap-2 border-t p-2">
          <input
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-ring"
            placeholder="hola, ¿tienen…?"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
          />
          <Button onClick={() => void enviar()} disabled={cargando || !texto.trim()}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid content-start gap-3 rounded-lg border p-3 text-sm">
        <h4 className="flex items-center gap-1.5 font-medium"><Wrench className="size-4" /> Qué pasó</h4>
        {!ultima ? (
          <p className="text-xs text-muted-foreground">Manda un mensaje para ver la traza.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {ultima.tools.length
                ? ultima.tools.map((t, i) => <Badge key={`${t}-${i}`} variant="secondary">{t}</Badge>)
                : <span className="text-xs text-muted-foreground">sin tools</span>}
            </div>

            {ultima.efectos.length ? (
              <div className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">Habría hecho</span>
                {ultima.efectos.map((e, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <p key={i} className="rounded bg-muted px-2 py-1 text-xs">{e}</p>
                ))}
              </div>
            ) : null}

            {ultima.escalaria ? (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                <strong>Escalaría a un humano.</strong>
                {ultima.motivo ? <p className="mt-1 opacity-80">{ultima.motivo}</p> : null}
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">{ultima.segundos}s</p>
          </>
        )}
      </div>
    </div>
  );
}
