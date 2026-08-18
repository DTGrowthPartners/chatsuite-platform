import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Loader2, X, Circle } from 'lucide-react';

import { api, type EstadoPaso, type Paso } from '@/api';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Props = {
  job: { id: string; slug: string; titulo: string } | null;
  pasos: Paso[];
  alCerrar: () => void;
  alTerminar: () => void;
};

const ICONO: Record<EstadoPaso | 'espera', typeof Check> = {
  ok: Check, corriendo: Loader2, error: X, espera: Circle,
};

export function ConsolaJob({ job, pasos, alCerrar, alTerminar }: Props) {
  const [lineas, setLineas] = useState<string[]>([]);
  const [avance, setAvance] = useState<Record<string, EstadoPaso>>({});
  const [terminado, setTerminado] = useState(false);
  const cajaRef = useRef<HTMLDivElement>(null);
  const alFinalRef = useRef(true);

  useEffect(() => {
    if (!job) return undefined;
    setLineas([]);
    setAvance({});
    setTerminado(false);

    const fuente = new EventSource(`/api/job?id=${encodeURIComponent(job.id)}`);
    fuente.onmessage = (ev) => setLineas((prev) => [...prev, JSON.parse(ev.data) as string]);
    fuente.addEventListener('fin', () => {
      fuente.close();
      setTerminado(true);
      alTerminar();
    });
    fuente.onerror = () => fuente.close();

    // Los chips de paso salen del estado guardado en el servidor, que es la
    // fuente de verdad y sobrevive a recargar el navegador a media alta.
    const reloj = setInterval(async () => {
      try {
        const t = await api.tenant(job.slug);
        setAvance(t.pasos || {});
        if (t.estado === 'activo' || t.estado === 'error') clearInterval(reloj);
      } catch { clearInterval(reloj); }
    }, 2000);

    return () => { fuente.close(); clearInterval(reloj); };
  }, [job, alTerminar]);

  // Solo se sigue el final si el usuario ya estaba abajo: si subio a leer un
  // error, arrastrarlo en la siguiente linea seria pelearle el scroll.
  useEffect(() => {
    const caja = cajaRef.current;
    if (caja && alFinalRef.current) caja.scrollTop = caja.scrollHeight;
  }, [lineas]);

  return (
    <Dialog open={!!job} onOpenChange={(abierto) => !abierto && alCerrar()}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={terminado}>
        <DialogHeader>
          <DialogTitle>{job?.titulo}</DialogTitle>
          <DialogDescription>
            {terminado ? 'Proceso terminado.' : 'En curso. Puedes cerrar: sigue corriendo en el servidor.'}
          </DialogDescription>
        </DialogHeader>

        {pasos.length > 0 && (
          <ol className="flex flex-wrap gap-1.5">
            {pasos.map((p) => {
              const estado = (avance[p.id] || 'espera') as EstadoPaso | 'espera';
              const Icono = ICONO[estado];
              return (
                <motion.li
                  key={p.id}
                  layout
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                    estado === 'ok' && 'border-emerald-500/35 text-emerald-400',
                    estado === 'corriendo' && 'border-sky-400/40 text-sky-300',
                    estado === 'error' && 'border-destructive/40 text-destructive',
                    estado === 'espera' && 'border-border text-muted-foreground',
                  )}
                >
                  <Icono className={cn('size-3', estado === 'corriendo' && 'animate-spin')} />
                  {p.titulo}
                </motion.li>
              );
            })}
          </ol>
        )}

        <div
          ref={cajaRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            alFinalRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
          className="fuente-consola h-[46vh] overflow-auto rounded-xl border bg-[oklch(0.11_0.02_279)] p-3.5 text-[12.5px] leading-relaxed"
        >
          {lineas.map((l, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-words',
                l.startsWith('✓') && 'text-emerald-400',
                l.startsWith('✗') && 'text-destructive',
                l.startsWith('▶') && 'font-semibold text-sky-300',
                !/^[✓✗▶]/.test(l) && 'text-muted-foreground',
              )}
            >
              {l}
            </div>
          ))}
          {!terminado && <Loader2 className="mt-1 size-3.5 animate-spin text-sky-300" />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
