// Configuración del módulo `citas`: servicios, quién atiende y el horario.
//
// Vive en el perfil (no en un archivo de datos) porque son decisiones del
// negocio, no una lista que crezca: el motor las relee sin reiniciar.
import type { PerfilBot } from '@/api';
import { Button } from '@/components/ui/button';
import { Campo, ListaTextos, Numero, Texto } from './campos';

type Props = { perfil: PerfilBot; alCambiar: (p: PerfilBot) => void };

const DIAS = [
  ['lunes', 'Lunes'], ['martes', 'Martes'], ['miercoles', 'Miércoles'],
  ['jueves', 'Jueves'], ['viernes', 'Viernes'], ['sabado', 'Sábado'],
  ['domingo', 'Domingo'],
] as const;

type Tramo = { desde: string; hasta: string };
type Servicio = { nombre: string; minutos?: number; precio?: number | null; nota?: string };

const cfg = (p: PerfilBot) => (p.citas as Record<string, unknown>) || {};

function set(p: PerfilBot, llave: string, valor: unknown): PerfilBot {
  return { ...p, citas: { ...cfg(p), [llave]: valor } };
}

export function FormAgenda({ perfil, alCambiar }: Props) {
  const c = cfg(perfil);
  const servicios = (c.servicios as Servicio[]) || [];
  const profesionales = (c.profesionales as string[]) || [];
  const horario = (c.horario as Record<string, Tramo[] | null>) || {};

  const tramos = (dia: string): Tramo[] => {
    const v = horario[dia];
    if (!v) return [];
    return Array.isArray(v) ? v : [v as Tramo];
  };

  const cambiarHorario = (dia: string, nuevos: Tramo[]) =>
    alCambiar(set(perfil, 'horario', { ...horario, [dia]: nuevos.length ? nuevos : null }));

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Duración por defecto (min)" ayuda="si un servicio no la trae">
          <Numero valor={Number(c.duracion_min ?? 30)} alCambiar={(v) => alCambiar(set(perfil, 'duracion_min', v))} />
        </Campo>
        <Campo etiqueta="Cada cuánto empieza un turno (min)" ayuda="30 = 8:00, 8:30, 9:00…">
          <Numero valor={Number(c.paso_min ?? 30)} alCambiar={(v) => alCambiar(set(perfil, 'paso_min', v))} />
        </Campo>
        <Campo etiqueta="Anticipación mínima (min)" ayuda="no se ofrece nada antes de eso">
          <Numero valor={Number(c.anticipacion_min ?? 60)} alCambiar={(v) => alCambiar(set(perfil, 'anticipacion_min', v))} />
        </Campo>
      </div>

      <Campo etiqueta="Dirección donde se atiende" ayuda="el bot la da al confirmar la cita">
        <Texto valor={String(c.direccion ?? '')} alCambiar={(v) => alCambiar(set(perfil, 'direccion', v))} />
      </Campo>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Servicios</span>
        <p className="text-xs text-muted-foreground">
          Sin al menos uno, el bot no puede agendar: no se le entregan las herramientas.
        </p>
        <div className="grid gap-2">
          {servicios.map((s, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-4">
              <div>
                <span className="mb-1 block text-xs text-muted-foreground">Nombre</span>
                <Texto
                  valor={s.nombre || ''}
                  alCambiar={(v) => alCambiar(set(perfil, 'servicios', servicios.map((x, j) => (j === i ? { ...x, nombre: v } : x))))}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-muted-foreground">Minutos</span>
                <Numero
                  valor={Number(s.minutos ?? 30)}
                  alCambiar={(v) => alCambiar(set(perfil, 'servicios', servicios.map((x, j) => (j === i ? { ...x, minutos: v } : x))))}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-muted-foreground">Precio · 0 es gratis</span>
                <Texto
                  valor={s.precio === undefined || s.precio === null ? '' : String(s.precio)}
                  alCambiar={(v) => alCambiar(set(perfil, 'servicios', servicios.map((x, j) => (j === i ? { ...x, precio: v.trim() === '' ? null : Number(v) } : x))))}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-muted-foreground">Nota (opcional)</span>
                <Texto
                  valor={s.nota || ''}
                  alCambiar={(v) => alCambiar(set(perfil, 'servicios', servicios.map((x, j) => (j === i ? { ...x, nota: v } : x))))}
                />
              </div>
              <div className="sm:col-span-4">
                <Button
                  variant="ghost" size="sm" className="text-muted-foreground"
                  onClick={() => alCambiar(set(perfil, 'servicios', servicios.filter((_, j) => j !== i)))}
                >
                  Quitar
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="outline" className="justify-self-start border-dashed"
          onClick={() => alCambiar(set(perfil, 'servicios', [...servicios, { nombre: '', minutos: 30, precio: null }]))}
        >
          + servicio
        </Button>
      </div>

      <Campo
        etiqueta="Quién atiende"
        ayuda="Con dos o más, un horario solo se ocupa cuando todos están tomados. Vacío = no se distingue."
      >
        <ListaTextos
          valores={profesionales}
          alCambiar={(v) => alCambiar(set(perfil, 'profesionales', v.filter((x) => x !== undefined)))}
          marcador="Dra. Ramírez"
        />
      </Campo>

      <div className="grid gap-2">
        <span className="text-sm font-medium">Horario de atención</span>
        <p className="text-xs text-muted-foreground">
          Dos tramos en un día dejan el corte de almuerzo. Un día sin tramos no se atiende.
        </p>
        <div className="grid gap-2">
          {DIAS.map(([llave, titulo]) => {
            const ts = tramos(llave);
            return (
              <div key={llave} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                <span className="w-24 shrink-0 text-sm">{titulo}</span>
                {!ts.length ? <span className="text-xs text-muted-foreground">cerrado</span> : null}
                {ts.map((t, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <div key={i} className="flex items-center gap-1">
                    <input
                      type="time"
                      className="rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus:border-ring"
                      value={t.desde || ''}
                      onChange={(e) => cambiarHorario(llave, ts.map((x, j) => (j === i ? { ...x, desde: e.target.value } : x)))}
                    />
                    <span className="text-xs text-muted-foreground">a</span>
                    <input
                      type="time"
                      className="rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus:border-ring"
                      value={t.hasta || ''}
                      onChange={(e) => cambiarHorario(llave, ts.map((x, j) => (j === i ? { ...x, hasta: e.target.value } : x)))}
                    />
                    <button
                      type="button"
                      className="rounded-md border px-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
                      onClick={() => cambiarHorario(llave, ts.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  onClick={() => cambiarHorario(llave, [...ts, { desde: '08:00', hasta: '12:00' }])}
                >
                  + tramo
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
