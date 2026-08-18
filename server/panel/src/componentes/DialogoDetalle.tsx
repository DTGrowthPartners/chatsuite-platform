import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { api, type Tenant } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';

type Detalle = Tenant & { credenciales?: { email: string; password: string } };

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-muted-foreground">{etiqueta}</span>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  );
}

function Copiable({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(valor);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1600);
        } catch {
          // El portapapeles exige contexto seguro; si falla, se avisa en vez de
          // dejar al usuario creyendo que copio.
          toast.error('el navegador bloqueó el portapapeles', { description: 'selecciónalo a mano' });
        }
      }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs transition-colors hover:bg-accent"
    >
      <span className="truncate">{valor}</span>
      {copiado ? <Check className="size-3 shrink-0 text-emerald-400" /> : <Copy className="size-3 shrink-0 opacity-60" />}
    </button>
  );
}

export function DialogoDetalle({ slug, alCerrar }: { slug: string | null; alCerrar: () => void }) {
  const [datos, setDatos] = useState<Detalle | null>(null);

  useEffect(() => {
    if (!slug) { setDatos(null); return; }
    api.tenant(slug, true).then(setDatos).catch((e) => toast.error((e as Error).message));
  }, [slug]);

  return (
    <Dialog open={!!slug} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{datos?.nombre || 'Cargando…'}</DialogTitle>
          <DialogDescription>Credenciales y datos de la instancia.</DialogDescription>
        </DialogHeader>

        {!datos ? (
          <div className="grid gap-2">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : (
          <div className="grid">
            <Fila etiqueta="Dominio">
              <a
                href={`https://${datos.dominio}`} target="_blank" rel="noopener"
                className="inline-flex items-center gap-1.5 text-marca-2 hover:underline"
              >
                {datos.dominio}<ExternalLink className="size-3.5" />
              </a>
            </Fila>
            <Fila etiqueta="Estado"><Badge variant="outline">{datos.estado}</Badge></Fila>
            <Fila etiqueta="Usuario admin"><Copiable valor={datos.credenciales?.email || '—'} /></Fila>
            <Fila etiqueta="Clave admin"><Copiable valor={datos.credenciales?.password || '—'} /></Fila>
            <Fila etiqueta="Color"><Copiable valor={datos.color} /></Fila>
            <Fila etiqueta="Puerto interno"><Copiable valor={String(datos.puerto)} /></Fila>
            <Fila etiqueta="Directorio"><Copiable valor={`/srv/chatsuite/${datos.slug}`} /></Fila>
            <Fila etiqueta="Creado">
              {new Date(datos.creadoEn).toLocaleString('es-CO')}
            </Fila>
            {datos.ultimoRespaldo && (
              <Fila etiqueta="Último respaldo">
                {new Date(datos.ultimoRespaldo).toLocaleString('es-CO')}
              </Fila>
            )}
          </div>
        )}

        <Button variant="outline" onClick={alCerrar}>Cerrar</Button>
      </DialogContent>
    </Dialog>
  );
}
