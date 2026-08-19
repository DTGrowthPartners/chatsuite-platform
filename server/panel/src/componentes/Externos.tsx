import { motion } from 'motion/react';
import { Bot, ExternalLink, MessagesSquare } from 'lucide-react';

import type { Externo } from '@/api';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Props = { externos: Externo[] | null };

// Deliberadamente mas pequenas que las tarjetas de cliente: esto es una lista de
// referencia, no algo que se opere desde aqui. La tarjeta entera es el enlace,
// que es lo unico que se viene a hacer a esta seccion.
function Tarjeta({ e, indice }: { e: Externo; indice: number }) {
  const Icono = e.tipo === 'bot' ? Bot : MessagesSquare;
  return (
    <motion.a
      href={e.url}
      target="_blank"
      rel="noreferrer"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(indice * 0.04, 0.24), ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="group h-full gap-1.5 p-4 transition-colors hover:border-white/18">
        <div className="flex items-center gap-2">
          <Icono className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.nombre}</span>
          {/* El punto es `title` nativo y no un Tooltip: el trigger de Base UI
              renderiza un boton, y esto vive dentro de un <a>. */}
          <span
            title={e.vivo ? `Responde en :${e.puerto}` : `Nada escucha en :${e.puerto}`}
            className={cn(
              'size-2 shrink-0 rounded-full',
              e.vivo ? 'bg-emerald-400' : 'bg-destructive',
            )}
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{e.host}{e.ruta !== '/' && e.ruta}</span>
          <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
        </div>

        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/70">{e.nota}</p>
      </Card>
    </motion.a>
  );
}

export function Externos({ externos }: Props) {
  return (
    <>
      <h2 className="mb-1 mt-10 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        También viven aquí
      </h2>
      <p className="mb-3 text-xs text-muted-foreground/70">
        Instancias anteriores a la plataforma, cada una con su compose y su dominio. El
        panel no las administra: sus nombres están reservados para que un alta no
        las pise. Los bots se abren por <code className="text-muted-foreground">/admin</code>.
      </p>

      {!externos ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {externos.map((e, i) => <Tarjeta key={e.slug} e={e} indice={i} />)}
        </div>
      )}
    </>
  );
}
