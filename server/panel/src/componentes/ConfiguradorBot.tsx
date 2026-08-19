// Las pestañas del bot, compartidas por los dos sitios donde se editan.
//
// `panel` es nuestra vista: la abre DTGP desde la tarjeta del cliente y lo puede
// todo, incluido mover el ciclo de vida y tocar Operación.
//
// `cliente` es la que ve el dueño dentro de su propio Chatsuite. Cambia lo justo:
// sin Operación —los módulos y el canal no son cosa suya— y sin el selector de
// ciclo, porque pasar un bot a producción es una decisión que se toma con
// nosotros. Lo que se esconde aquí el servidor lo rechaza igual: esta lista es
// para no confundir, no es el control.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Save, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { api, type EstadoBot, type PerfilBot } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Selector } from '@/componentes/bot/campos';
import { FormOperacion, FormPersona } from '@/componentes/bot/formularios';
import { EditorCatalogo, EditorLista, EditorNegocio } from '@/componentes/bot/listas';
import { FormAgenda } from '@/componentes/bot/Agenda';
import { Metricas } from '@/componentes/bot/Metricas';
import { Simulador } from '@/componentes/bot/Simulador';

const CICLO = [
  { valor: 'borrador', texto: 'Borrador — no le contesta a nadie' },
  { valor: 'prueba', texto: 'Prueba — solo al equipo' },
  { valor: 'produccion', texto: 'Producción — a clientes reales' },
];

export const COLOR_CICLO: Record<string, string> = {
  borrador: 'border-border bg-muted text-muted-foreground',
  prueba: 'border-sky-400/30 bg-sky-400/12 text-sky-300',
  produccion: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400',
};

type Pestana = 'simulador' | 'metricas' | 'persona' | 'negocio' | 'catalogo'
  | 'agenda' | 'cierres' | 'respuestas' | 'domicilios' | 'equipo' | 'operacion';

export type Modo = 'panel' | 'cliente';

export function ConfiguradorBot({
  slug, modo, alJob, alSinBot,
}: {
  slug: string;
  modo: Modo;
  alJob?: (id: string) => void;
  alSinBot?: () => void;
}) {
  const [perfil, setPerfil] = useState<PerfilBot | null>(null);
  const [estado, setEstado] = useState<EstadoBot | null>(null);
  const [pestana, setPestana] = useState<Pestana>(modo === 'cliente' ? 'catalogo' : 'simulador');
  const [guardando, setGuardando] = useState(false);

  const esCliente = modo === 'cliente';

  const cargar = useCallback(async () => {
    try {
      setPerfil(await api.bot.perfil(slug));
      setEstado(await api.bot.estado(slug));
    } catch (e) {
      if ((e as Error).message.includes('no tiene bot')) alSinBot?.();
      else toast.error((e as Error).message);
    }
  }, [slug, alSinBot]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    if (!perfil) return;
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
    if (!perfil) return;
    try {
      await api.bot.ciclo(slug, nuevo);
      setPerfil({ ...perfil, estado: nuevo as PerfilBot['estado'] });
      toast.success(`el bot quedó en ${nuevo}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!perfil) return <p className="py-10 text-center text-sm text-muted-foreground">cargando…</p>;

  const modulos = perfil.modulos || [];
  const conTienda = modulos.includes('tienda');
  const conCitas = modulos.includes('citas');

  const pestanas: { id: Pestana; texto: string; visible?: boolean }[] = [
    { id: 'catalogo', texto: 'Catálogo', visible: conTienda },
    { id: 'agenda', texto: 'Agenda', visible: conCitas },
    { id: 'cierres', texto: 'Días cerrados', visible: conCitas },
    { id: 'respuestas', texto: 'Respuestas' },
    { id: 'domicilios', texto: 'Domicilios', visible: conTienda },
    { id: 'negocio', texto: 'Negocio' },
    { id: 'persona', texto: 'Persona' },
    { id: 'equipo', texto: 'Equipo' },
    { id: 'simulador', texto: 'Simulador' },
    { id: 'metricas', texto: 'Métricas' },
    { id: 'operacion', texto: 'Operación', visible: !esCliente },
  ];
  // En nuestro panel el simulador va primero: es la pantalla con la que se deja
  // un bot listo antes de entregarlo. Para el cliente manda el día a día, que es
  // el catálogo o la agenda.
  if (!esCliente) pestanas.sort((a, b) => Number(b.id === 'simulador') - Number(a.id === 'simulador'));

  const visibles = pestanas.filter((p) => p.visible !== false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <Badge className={COLOR_CICLO[perfil.estado]}>{perfil.estado}</Badge>
        {esCliente ? (
          <span className="text-xs text-muted-foreground">
            {perfil.estado === 'produccion'
              ? 'El bot está atendiendo a tus clientes.'
              : 'El bot todavía no atiende a clientes reales. Escríbenos cuando quieras encenderlo.'}
          </span>
        ) : (
          <div className="min-w-56 flex-1">
            <Selector
              valor={perfil.estado}
              alCambiar={(v) => void cambiarCiclo(v)}
              opciones={CICLO.map((c) => ({ valor: c.valor as PerfilBot['estado'], texto: c.texto }))}
            />
          </div>
        )}
        {estado?.caido ? (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <AlertTriangle className="size-3.5" /> el proceso no responde
          </span>
        ) : !esCliente ? (
          <span className="text-xs text-muted-foreground">
            canal {estado?.canal?.canal || perfil.canal?.tipo}
            {estado?.canal?.congelado ? ' · ENVÍOS CONGELADOS' : ''}
            {estado?.convalecencia ? ' · convalecencia' : ''}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-2">
        {visibles.map((p) => (
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
        {pestana === 'simulador' ? <Simulador slug={slug} /> : null}
        {pestana === 'metricas' ? <Metricas slug={slug} /> : null}
        {pestana === 'persona' ? <FormPersona perfil={perfil} alCambiar={setPerfil} /> : null}
        {pestana === 'negocio' ? <EditorNegocio slug={slug} /> : null}
        {pestana === 'catalogo' ? <EditorCatalogo slug={slug} /> : null}
        {pestana === 'agenda' ? <FormAgenda perfil={perfil} alCambiar={setPerfil} /> : null}
        {pestana === 'cierres' ? (
          <EditorLista
            slug={slug}
            archivo="cierres.json"
            titulo="Días que no se atiende — festivos, vacaciones"
            vacio={{ fecha: '', motivo: '' }}
            columnas={[
              { llave: 'fecha', titulo: 'Fecha (AAAA-MM-DD) o deja vacío y usa desde/hasta' },
              { llave: 'motivo', titulo: 'Motivo' },
              { llave: 'desde', titulo: 'Desde (AAAA-MM-DD)' },
              { llave: 'hasta', titulo: 'Hasta (AAAA-MM-DD)' },
            ]}
          />
        ) : null}
        {pestana === 'respuestas' ? (
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
        {pestana === 'domicilios' ? (
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
        {pestana === 'equipo' ? (
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
        {pestana === 'operacion' && !esCliente ? <FormOperacion perfil={perfil} alCambiar={setPerfil} /> : null}
      </div>

      {/* Guardar solo donde se edita el PERFIL; las pestañas de datos guardan
          cada una por su cuenta. */}
      {(pestana === 'persona' || pestana === 'operacion' || pestana === 'agenda') ? (
        <div className="flex justify-end gap-2 border-t pt-3">
          {pestana === 'operacion' && alJob ? (
            <Button
              variant="outline"
              onClick={async () => {
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
  );
}
