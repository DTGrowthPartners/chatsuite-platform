import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut, Plus, ServerCog } from 'lucide-react';
import { toast } from 'sonner';

import { api, SesionExpirada, type Externo, type Sistema, type Tenant } from '@/api';
import { ConsolaJob } from '@/componentes/ConsolaJob';
import { DialogoBorrar } from '@/componentes/DialogoBorrar';
import { DialogoBot } from '@/componentes/DialogoBot';
import { DialogoWhatsapp } from '@/componentes/DialogoWhatsapp';
import { DialogoDetalle } from '@/componentes/DialogoDetalle';
import { DialogoNuevo } from '@/componentes/DialogoNuevo';
import { Externos } from '@/componentes/Externos';
import { Marca } from '@/componentes/Marca';
import { Recursos } from '@/componentes/Recursos';
import { TarjetaCliente } from '@/componentes/TarjetaCliente';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Job = { id: string; slug: string; titulo: string };

export function Panel({ alSalir }: { alSalir: () => void }) {
  const [sistema, setSistema] = useState<Sistema | null>(null);
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [externos, setExternos] = useState<Externo[] | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<Tenant | null>(null);
  const [bot, setBot] = useState<Tenant | null>(null);
  const [wa, setWa] = useState<Tenant | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const [s, t, e] = await Promise.all([api.sistema(), api.tenants(), api.externos()]);
      setSistema(s);
      setTenants(t);
      setExternos(e);
    } catch (e) {
      if (e instanceof SesionExpirada) return alSalir();
      toast.error((e as Error).message);
    }
  }, [alSalir]);

  useEffect(() => { refrescar(); }, [refrescar]);

  // Sondeo de fondo. Se pausa mientras la consola esta abierta: ahi el avance ya
  // llega por SSE y refrescar detras seria trabajo duplicado.
  useEffect(() => {
    if (job) return undefined;
    const reloj = setInterval(refrescar, 15000);
    return () => clearInterval(reloj);
  }, [job, refrescar]);

  async function lanzar(slug: string, accion: string, confirmar?: string) {
    try {
      const r = await api.accion(slug, accion, confirmar);
      setJob({ id: r.job, slug, titulo: `${accion} · ${slug}` });
      setBorrando(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b bg-background/72 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Marca className="size-8" />
            <div className="leading-tight">
              <div className="text-[0.95rem] font-semibold">Chatsuite</div>
              <div className="text-xs text-muted-foreground">Panel de aprovisionamiento</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setNuevo(true)}>
              <Plus /> Nuevo cliente
            </Button>
            <Button variant="ghost" size="icon" onClick={alSalir} title="Cerrar sesión">
              <LogOut className="size-4" />
              <span className="sr-only">Cerrar sesión</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 pb-20 pt-5">
        <Recursos sistema={sistema} />

        <h2 className="mb-3 mt-8 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Clientes
        </h2>

        {!tenants ? (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
          </div>
        ) : tenants.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-dashed px-6 py-16 text-center"
          >
            <ServerCog className="mx-auto size-8 text-muted-foreground/60" />
            <p className="mt-3 font-medium">Todavía no hay clientes</p>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
              Los que ya existían siguen funcionando aparte, abajo.
            </p>
            <Button className="mt-5" onClick={() => setNuevo(true)}>
              <Plus /> Crear el primero
            </Button>
          </motion.div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {tenants.map((t, i) => (
                <TarjetaCliente
                  key={t.slug} tenant={t} indice={i}
                  alDetalle={setDetalle}
                  alBot={setBot}
                  alWhatsapp={setWa}
                  alAccion={(slug, accion) => lanzar(slug, accion)}
                  alBorrar={setBorrando}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        <Externos externos={externos} />
      </main>

      <DialogoNuevo
        abierto={nuevo}
        dominioBase={sistema?.dominioBase || 'dtgp.ai'}
        alCerrar={() => setNuevo(false)}
        alCreado={(j) => { setNuevo(false); setJob(j); refrescar(); }}
      />
      <ConsolaJob
        job={job} pasos={sistema?.pasos || []}
        alCerrar={() => { setJob(null); refrescar(); }}
        alTerminar={refrescar}
      />
      <DialogoDetalle slug={detalle} alCerrar={() => setDetalle(null)} />
      <DialogoBot
        tenant={bot}
        alCerrar={() => { setBot(null); refrescar(); }}
        alJob={(id) => setJob({ id, slug: bot?.slug || '', titulo: `Bot de ${bot?.nombre || ''}` })}
      />
      <DialogoWhatsapp
        tenant={wa}
        alCerrar={() => { setWa(null); refrescar(); }}
        alJob={(id, titulo) => setJob({ id, slug: wa?.slug || '', titulo })}
      />
      <DialogoBorrar
        tenant={borrando}
        alCerrar={() => setBorrando(null)}
        alConfirmar={(slug) => lanzar(slug, 'borrar', slug)}
      />
    </div>
  );
}
