// Las instrucciones con las que trabaja el bot: verlas y, si hace falta,
// escribirlas a mano.
//
// Hay dos formas de definir la personalidad, y esta pantalla enseña las dos:
//
// - Por formularios (lo normal). La persona se compone de campos —tono, reglas,
//   qué nunca hace— y el texto de abajo se arma solo. Es lo que evita que nadie
//   tenga que pelear con un prompt de 7 KB para cambiar el tuteo.
// - Escrito a mano («modo experto»). El texto de la persona lo escribes tú y
//   reemplaza esos bloques. El conocimiento del negocio, el catálogo y las
//   respuestas se siguen agregando después: son datos, no estilo, y sacarlos
//   del prompt dejaría al bot inventando precios.
//
// Se puede ir y volver: apagar el modo experto no borra el texto, solo deja de
// usarlo. Por eso encenderlo no es una decisión de la que haya que arrepentirse.
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { api, confirmarAplicado, type PerfilBot } from '@/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Area } from '@/componentes/bot/campos';

type Datos = {
  prompt: string;
  tools: string[];
  etiquetas: string[];
  persona_generada: string;
  modo_experto: boolean;
};

export function Prompt({
  slug, perfil, alCambiar,
}: {
  slug: string;
  perfil: PerfilBot;
  alCambiar: (p: PerfilBot) => void;
}) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [propio, setPropio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const experto = Boolean(perfil.persona?.modo_experto);

  const cargar = useCallback(async () => {
    try {
      const [p, archivo] = await Promise.all([
        api.bot.prompt(slug),
        api.bot.dato<string>(slug, 'system.md'),
      ]);
      setDatos(p as Datos);
      setPropio(typeof archivo.contenido === 'string' ? archivo.contenido : '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [slug]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar() {
    setGuardando(true);
    try {
      await api.bot.guardarDato(slug, 'system.md', propio ?? '');
      toast.success('instrucciones guardadas', { description: await confirmarAplicado(slug) });
      await cargar();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  /** Enciende o apaga el modo experto. Guarda el perfil de una vez: es un
   *  interruptor, y dejarlo pendiente de otro botón «Guardar» que está en otra
   *  pestaña es la forma más segura de que nadie entienda por qué no pasó nada.
   *
   *  Al encenderlo por primera vez se siembra el texto con la persona que el bot
   *  ya venía usando, y se guarda. Abrir el editor en blanco daba a entender que
   *  encender esto borraba lo que había: no lo borra, pero la pantalla lo
   *  parecía, y eso basta para que nadie se atreva a tocarlo. */
  async function cambiarModo(activo: boolean) {
    const nuevo = { ...perfil, persona: { ...perfil.persona, modo_experto: activo } };
    alCambiar(nuevo);
    try {
      await api.bot.guardarPerfil(slug, nuevo);
      const sembrar = activo && !(propio ?? '').trim() && Boolean(datos?.persona_generada);
      if (sembrar) {
        await api.bot.guardarDato(slug, 'system.md', datos!.persona_generada);
        setPropio(datos!.persona_generada);
      }
      toast.success(activo
        ? (sembrar ? 'listo: aquí está la base que el bot ya usaba' : 'ahora manda el texto que escribas aquí')
        : 'vuelve a mandar lo que dicen los formularios');
      await cargar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (error) return <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>;
  if (!datos || propio === null) {
    return <p className="py-8 text-center text-sm text-muted-foreground">armando el prompt…</p>;
  }

  const palabras = datos.prompt.trim().split(/\s+/).length;

  return (
    <div className="grid gap-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
        <Checkbox checked={experto} onCheckedChange={(v) => void cambiarModo(Boolean(v))} />
        <span className="text-sm">
          <span className="font-medium">Escribir las instrucciones a mano</span>
          <span className="block text-xs text-muted-foreground">
            Con esto encendido, el texto de aquí abajo reemplaza a lo que dicen las pestañas
            Persona y Negocio. El catálogo, las respuestas y los horarios se siguen agregando
            solos. Puedes apagarlo cuando quieras: el texto no se pierde.
          </span>
        </span>
      </label>

      {experto ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Tus instrucciones · {propio.trim() ? `${propio.trim().split(/\s+/).length} palabras` : 'vacío'}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // Con texto escrito esto lo pisa entero: se pregunta antes, y
                  // solo se toca el editor —hasta Guardar no se pierde nada.
                  const hayTexto = propio.trim().length > 0;
                  if (hayTexto && !window.confirm('Esto reemplaza lo que escribiste por la base generada. ¿Sigo?')) return;
                  setPropio(datos.persona_generada);
                }}
              >
                <Wand2 className="size-3.5" /> Restaurar la base
              </Button>
              <Button size="sm" onClick={() => void guardar()} disabled={guardando}>
                <Save className="size-3.5" /> {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
          <Area
            filas={18}
            valor={propio}
            alCambiar={setPropio}
            className="font-mono text-xs"
            placeholder={'Eres… \n\n## CÓMO HABLAS\n\n- …'}
          />
          {!propio.trim() ? (
            <p className="text-xs text-amber-500">
              Está vacío: mientras siga así, el bot usa igualmente lo de los formularios.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Así le queda al bot · {palabras.toLocaleString('es-CO')} palabras
            {experto ? ' (con tus instrucciones dentro)' : ' (armado con las otras pestañas)'}
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

        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {datos.prompt}
        </pre>
      </div>
    </div>
  );
}
