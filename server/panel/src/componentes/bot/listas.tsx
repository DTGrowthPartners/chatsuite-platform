// Editores de los archivos de datos del bot (catalogo, respuestas, domicilios,
// equipo). Todos guardan en /srv/chatsuite/<slug>/bot/data/ y el motor los
// relee sin reiniciar.
import { useEffect, useState } from 'react';
import { Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { api, leerArchivo, type ArchivoDato } from '@/api';
import { Button } from '@/components/ui/button';
import { Area, Numero, Texto } from './campos';

export type Columna = {
  llave: string;
  titulo: string;
  tipo?: 'texto' | 'numero' | 'area';
  ayuda?: string;
};

type Fila = Record<string, unknown>;

/** Guarda y avisa. Centralizado para que todos los editores se porten igual. */
async function guardar(slug: string, archivo: ArchivoDato, contenido: unknown) {
  try {
    await api.bot.guardarDato(slug, archivo, contenido);
    toast.success('guardado', { description: 'el bot ya lo está usando' });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

export function EditorLista({
  slug, archivo, columnas, vacio, titulo,
}: {
  slug: string; archivo: ArchivoDato; columnas: Columna[];
  vacio: Fila; titulo: string;
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null);

  useEffect(() => {
    api.bot.dato<Fila[]>(slug, archivo)
      .then((r) => setFilas(Array.isArray(r.contenido) ? r.contenido : []))
      .catch((e) => toast.error((e as Error).message));
  }, [slug, archivo]);

  if (!filas) return <p className="py-8 text-center text-sm text-muted-foreground">cargando…</p>;

  const cambiar = (i: number, llave: string, valor: unknown) =>
    setFilas(filas.map((f, j) => (j === i ? { ...f, [llave]: valor } : f)));

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{titulo} · {filas.length}</p>
        <Button size="sm" onClick={() => void guardar(slug, archivo, filas)}>
          <Save className="size-3.5" /> Guardar
        </Button>
      </div>

      <div className="grid gap-2">
        {filas.map((f, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            {columnas.map((c) => (
              <div key={c.llave} className={c.tipo === 'area' ? 'sm:col-span-2' : ''}>
                <span className="mb-1 block text-xs text-muted-foreground">{c.titulo}</span>
                {c.tipo === 'numero' ? (
                  <Numero
                    valor={Number(f[c.llave] ?? 0)}
                    alCambiar={(v) => cambiar(i, c.llave, v)}
                  />
                ) : c.tipo === 'area' ? (
                  <Area filas={3} valor={String(f[c.llave] ?? '')} alCambiar={(v) => cambiar(i, c.llave, v)} />
                ) : (
                  <Texto valor={String(f[c.llave] ?? '')} alCambiar={(v) => cambiar(i, c.llave, v)} />
                )}
              </div>
            ))}
            <div className="sm:col-span-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setFilas(filas.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-3.5" /> Quitar
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        className="justify-self-start border-dashed"
        onClick={() => setFilas([...filas, { ...vacio }])}
      >
        + agregar
      </Button>
    </div>
  );
}

// --- catalogo ----------------------------------------------------------------

const FIJOS = new Set(['id', 'nombre', 'precio', 'imagen']);

/** Los atributos libres del producto, como lineas "clave: valor". */
const aTexto = (p: Fila) => Object.entries(p)
  .filter(([k]) => !FIJOS.has(k))
  .map(([k, v]) => `${k}: ${v}`)
  .join('\n');

function conAtributos(p: Fila, texto: string): Fila {
  const base: Fila = {};
  FIJOS.forEach((k) => { if (p[k] !== undefined) base[k] = p[k]; });
  texto.split('\n').forEach((linea) => {
    const i = linea.indexOf(':');
    if (i <= 0) return;
    const clave = linea.slice(0, i).trim();
    const valor = linea.slice(i + 1).trim();
    if (clave && valor) base[clave] = valor;
  });
  return base;
}

export function EditorCatalogo({ slug }: { slug: string }) {
  const [filas, setFilas] = useState<Fila[] | null>(null);

  useEffect(() => {
    api.bot.dato<Fila[]>(slug, 'catalogo.json')
      .then((r) => setFilas(Array.isArray(r.contenido) ? r.contenido : []))
      .catch((e) => toast.error((e as Error).message));
  }, [slug]);

  if (!filas) return <p className="py-8 text-center text-sm text-muted-foreground">cargando…</p>;

  const cambiar = (i: number, nueva: Fila) => setFilas(filas.map((f, j) => (j === i ? nueva : f)));

  /**
   * El id no lo escribe nadie: lo pone el sistema al crear el producto.
   *
   * Se pide al servidor, que mira el catálogo Y las fotos que quedaron en disco
   * para no reciclar uno: un id repetido heredaría la foto del producto borrado.
   * Al mayor de esos se le suma lo que ya haya en pantalla sin guardar, porque
   * se pueden añadir tres productos seguidos antes de tocar Guardar.
   */
  async function idNuevo(actuales: Fila[]) {
    const { id } = await api.bot.idProducto(slug);
    const numero = (v: unknown) => Number(/^p(\d+)$/i.exec(String(v ?? '').trim())?.[1] || 0);
    const tope = Math.max(numero(id) - 1, ...actuales.map((f) => numero(f.id)));
    return `p${String(tope + 1).padStart(3, '0')}`;
  }

  async function agregar() {
    try {
      setFilas([...filas!, { id: await idNuevo(filas!), nombre: '', precio: null, imagen: '' }]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function subirFoto(i: number, archivo: File) {
    const fila = filas![i];
    try {
      // Un producto de antes de los ids automáticos puede no tener: se le pone
      // en el momento, para que subir la foto nunca dependa de otro campo.
      const id = String(fila.id || '').trim() || await idNuevo(filas!);
      const dataUrl = await leerArchivo(archivo);
      const { imagen } = await api.bot.foto(slug, id, dataUrl);
      cambiar(i, { ...fila, id, imagen });
      toast.success('foto subida', { description: 'recuerda Guardar para que el bot la use' });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {filas.length} productos · los atributos son libres: sirven tallas y colores
          igual que procesador y RAM
        </p>
        <Button size="sm" onClick={() => void guardar(slug, 'catalogo.json', filas)}>
          <Save className="size-3.5" /> Guardar
        </Button>
      </div>

      <div className="grid gap-2">
        {filas.map((p, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs text-muted-foreground">
                Nombre <span className="font-mono opacity-60">· {String(p.id ?? 'sin id')}</span>
              </span>
              <Texto valor={String(p.nombre ?? '')} alCambiar={(v) => cambiar(i, { ...p, nombre: v })} />
            </div>
            <div>
              <span className="mb-1 block text-xs text-muted-foreground">
                Precio · 0 es gratis, vacío es pendiente
              </span>
              <Texto
                valor={p.precio === undefined || p.precio === null ? '' : String(p.precio)}
                alCambiar={(v) => cambiar(i, { ...p, precio: v.trim() === '' ? null : Number(v) })}
              />
            </div>

            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs text-muted-foreground">
                Atributos, uno por línea: <code>clave: valor</code>
              </span>
              <Area
                filas={3}
                valor={aTexto(p)}
                alCambiar={(v) => cambiar(i, conAtributos(p, v))}
                placeholder={'procesador: Ryzen 5\nram: 16GB'}
              />
            </div>

            <div className="grid content-start gap-1">
              <span className="text-xs text-muted-foreground">Foto</span>
              <span className="truncate font-mono text-xs">{String(p.imagen || '—')}</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent">
                <Upload className="size-3.5" /> subir
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => { const a = e.target.files?.[0]; if (a) void subirFoto(i, a); }}
                />
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start text-muted-foreground"
                onClick={() => setFilas(filas.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-3.5" /> Quitar
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        className="justify-self-start border-dashed"
        onClick={() => void agregar()}
      >
        + producto
      </Button>
    </div>
  );
}

// --- negocio.md --------------------------------------------------------------

export function EditorNegocio({ slug }: { slug: string }) {
  const [texto, setTexto] = useState<string | null>(null);

  useEffect(() => {
    api.bot.dato<string>(slug, 'negocio.md')
      .then((r) => setTexto(typeof r.contenido === 'string' ? r.contenido : ''))
      .catch((e) => toast.error((e as Error).message));
  }, [slug]);

  if (texto === null) return <p className="py-8 text-center text-sm text-muted-foreground">cargando…</p>;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        La fuente de verdad del negocio: formas de pago, entregas, horarios, políticas.
        Si algo no está acá, el bot no lo inventa.
      </p>
      <Area filas={18} valor={texto} alCambiar={setTexto} className="font-mono text-xs" />
      <Button size="sm" className="justify-self-end" onClick={() => void guardar(slug, 'negocio.md', texto)}>
        <Save className="size-3.5" /> Guardar
      </Button>
    </div>
  );
}
