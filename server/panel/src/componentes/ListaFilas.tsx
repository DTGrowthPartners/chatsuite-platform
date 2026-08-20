import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type Columna = {
  id: string;
  etiqueta: string;
  /** De 1 a 6; cuánto ocupa la columna en la rejilla de la fila. */
  ancho?: number;
  largo?: boolean;
  ejemplo?: string;
  opcional?: boolean;
};

export type Fila = Record<string, string>;

/**
 * Filas que se agregan: productos, cuentas de pago, preguntas y respuestas.
 *
 * Lo usan el formulario del cliente y la vista del panel, que puede responder
 * por él. Vive aquí y no dentro de una de las dos para que no haya dos
 * comportamientos distintos para la misma pregunta.
 *
 * Siempre queda una fila en blanco a la vista. Un botón «agregar» sobre una
 * lista vacía obliga a un clic antes de poder escribir nada, y eso basta para
 * que mucha gente pase de largo la pregunta.
 */
export function ListaFilas({ columnas, filas, etiquetaAgregar, id, compacto, alCambiar }: {
  columnas: Columna[];
  filas: Fila[];
  etiquetaAgregar?: string;
  id: string;
  compacto?: boolean;
  alCambiar: (filas: Fila[]) => void;
}) {
  const vacia = () => Object.fromEntries(columnas.map((c) => [c.id, ''])) as Fila;
  const conBlanco = filas.length ? filas : [vacia()];
  const usada = (f: Fila) => Object.values(f || {}).some((v) => String(v ?? '').trim());

  function escribir(i: number, col: string, v: string) {
    const copia = conBlanco.map((f, j) => (j === i ? { ...f, [col]: v } : f));
    // Al escribir en la última fila aparece otra debajo: se puede cargar una
    // lista entera sin levantar las manos del teclado.
    if (i === copia.length - 1 && usada(copia[i])) copia.push(vacia());
    alCambiar(copia);
  }

  const alto = compacto ? 'h-8' : 'h-9';

  return (
    <div className="grid gap-2">
      {conBlanco.map((fila, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border bg-background/40 p-2">
          <div className="grid flex-1 gap-2 sm:grid-cols-6">
            {columnas.map((c) => {
              const span = Math.min(6, c.ancho ?? 1);
              return (
                <div
                  key={c.id}
                  className="grid gap-1"
                  style={{ gridColumn: `span ${span} / span ${span}` }}
                >
                  <label
                    className="text-[11px] text-muted-foreground"
                    htmlFor={`${id}-${i}-${c.id}`}
                  >
                    {c.etiqueta}
                  </label>
                  {c.largo ? (
                    <textarea
                      id={`${id}-${i}-${c.id}`}
                      rows={2}
                      placeholder={c.ejemplo}
                      className="w-full resize-y rounded-md border bg-transparent px-2.5 py-1.5
                        text-sm outline-none focus:border-ring"
                      value={fila[c.id] ?? ''}
                      onChange={(e) => escribir(i, c.id, e.target.value)}
                    />
                  ) : (
                    <Input
                      id={`${id}-${i}-${c.id}`}
                      className={`${alto} text-sm`}
                      placeholder={c.ejemplo}
                      value={fila[c.id] ?? ''}
                      onChange={(e) => escribir(i, c.id, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <Button
            type="button" variant="ghost" size="icon"
            className="mt-5 shrink-0"
            aria-label="Quitar esta fila"
            // La única fila, si está vacía, no se puede quitar: dejaría la
            // pregunta sin un solo campo donde escribir.
            disabled={conBlanco.length === 1 && !usada(fila)}
            onClick={() => alCambiar(conBlanco.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}

      <Button
        type="button" variant="outline" size="sm" className="justify-self-start"
        onClick={() => alCambiar([...conBlanco, vacia()])}
      >
        <Plus /> {etiquetaAgregar || 'Agregar'}
      </Button>
    </div>
  );
}
