// Configurador del bot de un cliente.
//
// El orden de las pestañas no es casual: primero el simulador. Es la pantalla
// que permite dejar un bot listo ANTES de entregárselo al cliente, y todo lo
// demás se ajusta mirando lo que ahí se ve.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bot, Save, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { api, type EstadoBot, type PerfilBot, type Tenant } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Selector } from '@/componentes/bot/campos';
import { FormOperacion, FormPersona } from '@/componentes/bot/formularios';
import { EditorCatalogo, EditorLista, EditorNegocio } from '@/componentes/bot/listas';
import { Simulador } from '@/componentes/bot/Simulador';

const CICLO = [
  { valor: 'borrador', texto: 'Borrador — no le contesta a nadie' },
  { valor: 'prueba', texto: 'Prueba — solo al equipo' },
  { valor: 'produccion', texto: 'Producción — a clientes reales' },
];

const COLOR_CICLO: Record<string, string> = {
  borrador: 'border-border bg-muted text-muted-foreground',
  prueba: 'border-sky-400/30 bg-sky-400/12 text-sky-300',
  produccion: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400',
};

type Pestana = 'simulador' | 'persona' | 'negocio' | 'catalogo' | 'respuestas'
  | 'domicilios' | 'equipo' | 'operacion';

export function DialogoBot({
  tenant, alCerrar, alJob,
}: { tenant: Tenant | null; alCerrar: () => void; alJob: (id: string) => void }) {
  const [perfil, setPerfil] = useState<PerfilBot | null>(null);
  const [sinBot, setSinBot] = useState(false);
  const [estado, setEstado] = useState<EstadoBot | null>(null);
  const [pestana, setPestana] = useState<Pestana>('simulador');
  const [guardando, setGuardando] = useState(false);

  const slug = tenant?.slug;

  const cargar = useCallback(async () => {
    if (!slug) return;
    try {
      setPerfil(await api.bot.perfil(slug));
      setSinBot(false);
      setEstado(await api.bot.estado(slug));
    } catch (e) {
      // 404 es el caso normal de un cliente sin bot todavía, no un fallo.
      if ((e as Error).message.includes('no tiene bot')) setSinBot(true);
      else toast.error((e as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) { setPerfil(null); setSinBot(false); setEstado(null); setPestana('simulador'); return; }
    void cargar();
  }, [slug, cargar]);

  async function guardar() {
    if (!slug || !perfil) return;
    setGuardando(true);
    try {
      await api.bot.guardarPerfil(slug, perfil);
      toast.success('perfil guardado', { description: 'el bot lo aplicó sin reiniciar' });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarCiclo(nuevo: string) {
    if (!slug || !perfil) return;
    try {
      await api.bot.ciclo(slug, nuevo);
      setPerfil({ ...perfil, estado: nuevo as PerfilBot['estado'] });
      toast.success(`el bot quedó en ${nuevo}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const modulos = perfil?.modulos || [];
  const conTienda = modulos.includes('tienda');
  const pestanas: { id: Pestana; texto: string; visible?: boolean }[] = [
    { id: 'simulador', texto: 'Simulador' },
    { id: 'persona', texto: 'Persona' },
    { id: 'negocio', texto: 'Negocio' },
    { id: 'catalogo', texto: 'Catálogo', visible: conTienda },
    { id: 'respuestas', texto: 'Respuestas' },
    { id: 'domicilios', texto: 'Domicilios', visible: conTienda },
    { id: 'equipo', texto: 'Equipo' },
    { id: 'operacion', texto: 'Operación' },
  ];

  return (
    // Igual que el alta: acá se editan la persona y la operación sin guardar, y
    // un clic afuera se llevaría los cambios.
    <Dialog open={!!tenant} disablePointerDismissal onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5" /> Bot de {tenant?.nombre}
          </DialogTitle>
          <DialogDescription>
            Todo esto se guarda en el perfil del cliente y aplica sin reiniciar el bot.
          </DialogDescription>
        </DialogHeader>

        {sinBot ? (
          <div className="grid justify-items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Este cliente todavía no tiene bot. Se le crea el AgentBot en Chatsuite,
              se publica el webhook y queda en borrador, sin escribirle a nadie.
            </p>
            <Button
              onClick={async () => {
                if (!slug) return;
                try {
                  const { job } = await api.bot.preparar(slug);
                  alJob(job);
                  alCerrar();
                } catch (e) { toast.error((e as Error).message); }
              }}
            >
              Crear el bot
            </Button>
          </div>
        ) : !perfil ? (
          <p className="py-10 text-center text-sm text-muted-foreground">cargando…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <Badge className={COLOR_CICLO[perfil.estado]}>{perfil.estado}</Badge>
              <div className="min-w-56 flex-1">
                <Selector
                  valor={perfil.estado}
                  alCambiar={(v) => void cambiarCiclo(v)}
                  opciones={CICLO.map((c) => ({ valor: c.valor as PerfilBot['estado'], texto: c.texto }))}
                />
              </div>
              {estado?.caido ? (
                <span className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="size-3.5" /> el proceso no responde
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  canal {estado?.canal?.canal || perfil.canal?.tipo}
                  {estado?.canal?.congelado ? ' · ENVÍOS CONGELADOS' : ''}
                  {estado?.convalecencia ? ' · convalecencia' : ''}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1 border-b pb-2">
              {pestanas.filter((p) => p.visible !== false).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPestana(p.id)}
                  className={[
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    pestana === p.id ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/60',
                  ].join(' ')}
                >
                  {p.texto}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {pestana === 'simulador' && slug ? <Simulador slug={slug} /> : null}
              {pestana === 'persona' ? <FormPersona perfil={perfil} alCambiar={setPerfil} /> : null}
              {pestana === 'negocio' && slug ? <EditorNegocio slug={slug} /> : null}
              {pestana === 'catalogo' && slug ? <EditorCatalogo slug={slug} /> : null}
              {pestana === 'respuestas' && slug ? (
                <EditorLista
                  slug={slug}
                  archivo="respuestas.json"
                  titulo="Respuestas rápidas"
                  vacio={{ id: '', titulo: '', contenido: '', uso: 'referencia' }}
                  columnas={[
                    { llave: 'titulo', titulo: 'Título' },
                    { llave: 'uso', titulo: 'Uso: datos (se manda tal cual) o referencia' },
                    { llave: 'contenido', titulo: 'Contenido', tipo: 'area' },
                  ]}
                />
              ) : null}
              {pestana === 'domicilios' && slug ? (
                <EditorLista
                  slug={slug}
                  archivo="domicilios.json"
                  titulo="Tarifas por zona"
                  vacio={{ zona: '', precio: 0 }}
                  columnas={[
                    { llave: 'zona', titulo: 'Zona o barrio' },
                    { llave: 'precio', titulo: 'Precio (0 = gratis)', tipo: 'numero' },
                  ]}
                />
              ) : null}
              {pestana === 'equipo' && slug ? (
                <EditorLista
                  slug={slug}
                  archivo="equipo.json"
                  titulo="Equipo — a estos el bot no los atiende como clientes, y a ellos les avisa"
                  vacio={{ nombre: '', telefono: '', rol: '' }}
                  columnas={[
                    { llave: 'nombre', titulo: 'Nombre' },
                    { llave: 'telefono', titulo: 'Teléfono con indicativo' },
                    { llave: 'rol', titulo: 'Rol' },
                  ]}
                />
              ) : null}
              {pestana === 'operacion' ? <FormOperacion perfil={perfil} alCambiar={setPerfil} /> : null}
            </div>

            {pestana !== 'simulador' && pestana !== 'negocio' && pestana !== 'catalogo'
              && pestana !== 'respuestas' && pestana !== 'domicilios' && pestana !== 'equipo' ? (
                <div className="flex justify-end gap-2 border-t pt-3">
                  {pestana === 'operacion' ? (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!slug) return;
                        try {
                          const { job } = await api.bot.accion(slug, 'etiquetas');
                          alJob(job);
                        } catch (e) { toast.error((e as Error).message); }
                      }}
                    >
                      <Tags className="size-4" /> Sincronizar etiquetas
                    </Button>
                  ) : null}
                  <Button onClick={() => void guardar()} disabled={guardando}>
                    <Save className="size-4" /> {guardando ? 'Guardando…' : 'Guardar'}
                  </Button>
                </div>
              ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
