import { motion } from 'motion/react';
import { HardDrive, MemoryStick, Users, Gauge } from 'lucide-react';

import type { Sistema } from '@/api';
import { gb } from '@/api';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type Props = { sistema: Sistema | null };

function Metrica({
  icono: Icono, etiqueta, valor, pie, porcentaje, indice,
}: {
  icono: typeof HardDrive; etiqueta: string; valor: string;
  pie: string; porcentaje?: number; indice: number;
}) {
  const alto = (porcentaje ?? 0) >= 80;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // Escalonado por indice: las cuatro tarjetas entran en cascada en vez de
      // aparecer de golpe.
      transition={{ duration: 0.35, delay: indice * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="gap-0 p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Icono className="size-3.5" />
          {etiqueta}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tabular-nums">{valor}</div>
        <div className="text-xs text-muted-foreground">{pie}</div>
        {porcentaje != null && (
          <Progress
            value={porcentaje}
            // Se apunta por data-slot y no por `> div`: la estructura de Base UI
            // es Root > Track > Indicator, asi que el hijo directo del Root es la
            // PISTA. Pintarla dejaba el relleno azul y el hueco rojo, justo al
            // reves de lo que se quiere decir.
            className={cn(
              'mt-3',
              '[&_[data-slot=progress-track]]:h-1.5',
              alto && '[&_[data-slot=progress-indicator]]:bg-destructive',
            )}
          />
        )}
      </Card>
    </motion.div>
  );
}

export function Recursos({ sistema }: Props) {
  if (!sistema) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[7.5rem] rounded-xl" />)}
      </div>
    );
  }

  const { memoria: m, disco: d, tenants, cupoEstimado } = sistema;
  const pctMem = Math.round((m.usadaMB / m.totalMB) * 100);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metrica
        indice={0} icono={MemoryStick} etiqueta="Memoria"
        valor={`${gb(m.usadaMB)} / ${gb(m.totalMB)} GB`}
        pie={`${gb(m.disponibleMB)} GB disponibles`} porcentaje={pctMem}
      />
      {/* Todo se deriva de los mismos MB y se muestra con un decimal: redondear
          cada cifra por separado hacia que la resta no cuadrara en pantalla. */}
      <Metrica
        indice={1} icono={HardDrive} etiqueta="Disco"
        valor={`${gb(d.usadoMB)} / ${gb(d.totalMB)} GB`}
        pie={`${gb(d.disponibleMB)} GB disponibles`} porcentaje={d.porcentaje}
      />
      <Metrica
        indice={2} icono={Users} etiqueta="Clientes"
        valor={`${tenants.activos} / ${tenants.total}`} pie="activos / total"
      />
      <Metrica
        indice={3} icono={Gauge} etiqueta="Cupo estimado"
        valor={`~${cupoEstimado}`} pie="clientes más caben aquí"
      />
    </div>
  );
}
