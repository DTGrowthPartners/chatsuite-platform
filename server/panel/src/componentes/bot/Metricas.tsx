// Qué ha hecho el bot. Es una vista INTERNA: el cliente no ve nada de esto,
// él solo usa su Chatsuite. Lo financiero vive en DTOS.
import { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { api, type Metricas as Datos } from '@/api';
import { Button } from '@/components/ui/button';

function Cifra({ valor, etiqueta, ayuda }: { valor: string; etiqueta: string; ayuda?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="font-heading text-xl tabular-nums">{valor}</p>
      <p className="text-sm">{etiqueta}</p>
      {ayuda ? <p className="mt-0.5 text-xs text-muted-foreground">{ayuda}</p> : null}
    </div>
  );
}

const num = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('es-CO') : '—');

export function Metricas({ slug }: { slug: string }) {
  const [d, setD] = useState<Datos | null>(null);
  const [dias, setDias] = useState(30);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    api.bot.metricas(slug, dias)
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [slug, dias]);

  if (!d) {
    return <p className="py-10 text-center text-sm text-muted-foreground">
      {cargando ? 'cargando…' : 'sin datos todavía'}
    </p>;
  }

  const t = d.total as Record<string, number>;
  const dv = d.derivadas;
  const tools = (d.total.tools as Record<string, number>) || {};
  const atendidos = t.atendido || 0;
  const dias_con_datos = Object.keys(d.por_dia).length;

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {[7, 30, 90].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setDias(n)}
              className={[
                'rounded-md px-2.5 py-1 text-xs transition-colors',
                dias === n ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60',
              ].join(' ')}
            >
              {n} días
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setDias(dias)} disabled={cargando}>
          <RefreshCw className="size-3.5" /> Actualizar
        </Button>
      </div>

      {!atendidos ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          El bot todavía no ha respondido nada en este período.
        </p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {/* La métrica que importa: qué parte cerró el bot sin que entrara
                un humano. Es lo que se traduce en asesores ahorrados. */}
            <Cifra
              valor={dv.contencion !== null ? `${Math.round(dv.contencion * 100)}%` : '—'}
              etiqueta="Contención"
              ayuda="cerradas sin humano"
            />
            <Cifra valor={num(atendidos)} etiqueta="Mensajes atendidos" ayuda={`en ${dias_con_datos} días con actividad`} />
            <Cifra valor={num(t.pedido || 0)} etiqueta="Pedidos registrados" ayuda={dv.pedidos_por_100 !== null ? `${dv.pedidos_por_100} por cada 100 mensajes` : undefined} />
            <Cifra valor={num(t.escalada || 0)} etiqueta="Escaladas a humano" />
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Cifra
              valor={dv.tokens_por_atendido !== null ? num(dv.tokens_por_atendido) : '—'}
              etiqueta="Tokens por mensaje"
              ayuda="caché incluido"
            />
            <Cifra
              valor={dv.ms_promedio !== null ? `${(dv.ms_promedio / 1000).toFixed(1)}s` : '—'}
              etiqueta="Tarda el modelo"
            />
            <Cifra valor={num(t.fallo || 0)} etiqueta="Fallos" ayuda={t.no_respondio ? `${t.no_respondio} veces no respondió por horario o frenos` : undefined} />
          </div>

          {Object.keys(tools).length ? (
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-medium">Herramientas usadas</p>
              <div className="grid gap-1 text-sm">
                {Object.entries(tools).sort((a, b) => b[1] - a[1]).map(([n, v]) => (
                  <div key={n} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{n}</span>
                    <span className="tabular-nums">{num(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {/* No es una métrica: es la lista de trabajo. Cada línea es un dato que
          le falta al bot, con cuántas veces se lo preguntaron. */}
      <div className="rounded-lg border p-3">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <AlertCircle className="size-4" /> Lo que el bot no supo responder
        </p>
        <p className="mb-2 text-xs text-muted-foreground">
          Cada línea es un dato que falta en el catálogo, en los domicilios o en la
          información del negocio. Si algo se repite, no es un incidente: es una fila
          que hay que agregar.
        </p>
        {!d.sin_datos.length ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            Nada pendiente. El bot respondió todo con lo que tiene.
          </p>
        ) : (
          <div className="grid gap-1">
            {d.sin_datos.map((s) => (
              <div key={s.pregunta} className="flex items-start justify-between gap-3 rounded bg-muted px-2 py-1.5 text-sm">
                <span>{s.pregunta}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{s.veces}×</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
