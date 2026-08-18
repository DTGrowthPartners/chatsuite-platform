// Piezas de formulario del configurador del bot.
//
// Se escribieron a mano en vez de sumar mas componentes de shadcn: son cuatro
// controles y traer Tabs/Select/Textarea de Radix agregaria dependencias al
// bundle para lo mismo.
import { cn } from '@/lib/utils';

export function Campo({
  etiqueta, ayuda, children,
}: { etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium">{etiqueta}</span>
      {children}
      {ayuda ? <span className="text-xs text-muted-foreground">{ayuda}</span> : null}
    </label>
  );
}

const BASE = 'w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none '
  + 'transition-colors placeholder:text-muted-foreground focus:border-ring';

export function Texto({
  valor, alCambiar, ...resto
}: { valor: string; alCambiar: (v: string) => void } & Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>) {
  return <input {...resto} className={cn(BASE, resto.className)} value={valor} onChange={(e) => alCambiar(e.target.value)} />;
}

export function Numero({
  valor, alCambiar, ...resto
}: { valor: number; alCambiar: (v: number) => void } & Omit<React.ComponentProps<'input'>, 'value' | 'onChange'>) {
  return (
    <input
      {...resto}
      type="number"
      className={cn(BASE, resto.className)}
      value={Number.isFinite(valor) ? valor : 0}
      onChange={(e) => alCambiar(Number(e.target.value))}
    />
  );
}

export function Area({
  valor, alCambiar, filas = 6, ...resto
}: { valor: string; alCambiar: (v: string) => void; filas?: number }
  & Omit<React.ComponentProps<'textarea'>, 'value' | 'onChange' | 'rows'>) {
  return (
    <textarea
      {...resto}
      rows={filas}
      className={cn(BASE, 'resize-y font-normal leading-relaxed', resto.className)}
      value={valor}
      onChange={(e) => alCambiar(e.target.value)}
    />
  );
}

export function Selector<T extends string>({
  valor, alCambiar, opciones,
}: { valor: T; alCambiar: (v: T) => void; opciones: { valor: T; texto: string }[] }) {
  return (
    <select
      className={cn(BASE, 'cursor-pointer')}
      value={valor}
      onChange={(e) => alCambiar(e.target.value as T)}
    >
      {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
    </select>
  );
}

/** Lista de textos sueltos (reglas, "lo que nunca haces", motivos de escalada). */
export function ListaTextos({
  valores, alCambiar, marcador,
}: { valores: string[]; alCambiar: (v: string[]) => void; marcador?: string }) {
  return (
    <div className="grid gap-2">
      {valores.map((v, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i} className="flex gap-2">
          <input
            className={cn(BASE)}
            value={v}
            placeholder={marcador}
            onChange={(e) => alCambiar(valores.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            className="shrink-0 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            onClick={() => alCambiar(valores.filter((_, j) => j !== i))}
            aria-label="quitar"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="justify-self-start rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
        onClick={() => alCambiar([...valores, ''])}
      >
        + agregar
      </button>
    </div>
  );
}
