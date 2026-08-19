// Las instrucciones exactas con las que trabaja el bot.
//
// No es una pantalla de edición: es la de "esto es lo que realmente le dijimos".
// El texto se arma solo con lo que hay en las demás pestañas —la persona, el
// negocio, el catálogo, las respuestas— así que verlo entero es la forma más
// rápida de entender por qué el bot contestó lo que contestó, y de darse cuenta
// de que falta un dato.
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/api';
import { Button } from '@/components/ui/button';

type Datos = { prompt: string; tools: string[]; etiquetas: string[] };

export function Prompt({ slug }: { slug: string }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api.bot.prompt(slug).then(setDatos).catch((e) => setError((e as Error).message));
  }, [slug]);

  if (error) return <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>;
  if (!datos) return <p className="py-8 text-center text-sm text-muted-foreground">armando el prompt…</p>;

  const palabras = datos.prompt.trim().split(/\s+/).length;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {palabras.toLocaleString('es-CO')} palabras · se arma solo con lo que hay en las
          otras pestañas, no se escribe a mano.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(datos.prompt);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 1600);
            } catch {
              toast.error('el navegador bloqueó el portapapeles', { description: 'selecciónalo a mano' });
            }
          }}
        >
          {copiado ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
          {copiado ? 'copiado' : 'Copiar'}
        </Button>
      </div>

      {datos.etiquetas?.length ? (
        <p className="text-xs text-muted-foreground">
          Etiqueta las conversaciones con: {datos.etiquetas.join(' · ')}
        </p>
      ) : null}
      {datos.tools?.length ? (
        <p className="text-xs text-muted-foreground">
          Acciones que puede ejecutar: {datos.tools.join(' · ')}
        </p>
      ) : null}

      <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
        {datos.prompt}
      </pre>
    </div>
  );
}
