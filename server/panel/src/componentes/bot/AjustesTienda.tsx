// Los interruptores de la tienda, cada uno encima de lo que gobierna.
//
// Vivían solo en el perfil.json y no tenían formulario en ninguna parte, con un
// efecto feo: `domicilios.activo` nace apagado, así que un cliente podía cargar
// sus zonas y sus precios en la pestaña Domicilios y el bot no ofrecía ninguno.
// La pestaña se veía llena y no hacía nada.
//
// Guardan solos al tocarlos. Son interruptores, y esperar a un botón «Guardar»
// que además está en otra pestaña es la mejor forma de que nadie entienda por
// qué no pasó nada.
import { api, confirmarAplicado, type PerfilBot } from '@/api';
import { toast } from 'sonner';

import { Campo, Numero, Texto } from '@/componentes/bot/campos';

type Props = { slug: string; perfil: PerfilBot; alCambiar: (p: PerfilBot) => void };

function useGuardado({ slug, perfil, alCambiar }: Props) {
  return async (cambio: (p: PerfilBot) => PerfilBot) => {
    const nuevo = cambio(structuredClone(perfil));
    alCambiar(nuevo);
    try {
      await api.bot.guardarPerfil(slug, nuevo);
      toast.success('guardado', { description: await confirmarAplicado(slug) });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
}

export function AjustesCatalogo(props: Props) {
  const guardar = useGuardado(props);
  const tienda = props.perfil.tienda || {};

  return (
    <div className="mb-3 grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
      <Campo etiqueta="Fotos por tanda" ayuda="Más de 4 seguidas y WhatsApp empieza a frenar los envíos. El bot nunca pasa de 10, aunque se escriba más.">
        <Numero
          min={1}
          max={10}
          valor={Number(tienda.catalogo?.fotos_por_tanda ?? 4)}
          alCambiar={(v) => void guardar((p) => {
            p.tienda = { ...p.tienda, catalogo: { ...p.tienda?.catalogo, fotos_por_tanda: v } };
            return p;
          })}
        />
      </Campo>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={Boolean(tienda.pdf?.activo)}
          onChange={(e) => void guardar((p) => {
            p.tienda = { ...p.tienda, pdf: { ...p.tienda?.pdf, activo: e.target.checked } };
            return p;
          })}
        />
        <span>
          <span className="font-medium">Puede mandar el catálogo en PDF</span>
          <span className="block text-xs text-muted-foreground">
            Para quien pide «mándame todo» sin decir qué busca.
          </span>
        </span>
      </label>
      <Campo etiqueta="Título del PDF">
        <Texto
          valor={String(tienda.pdf?.titulo ?? '')}
          alCambiar={(v) => void guardar((p) => {
            p.tienda = { ...p.tienda, pdf: { ...p.tienda?.pdf, titulo: v } };
            return p;
          })}
        />
      </Campo>
    </div>
  );
}

export function AjustesDomicilios(props: Props) {
  const guardar = useGuardado(props);
  const dom = props.perfil.tienda?.domicilios || {};
  const activo = Boolean(dom.activo);

  return (
    <div className="mb-3 grid gap-3 rounded-lg border p-3">
      <label className="flex cursor-pointer items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={activo}
          onChange={(e) => void guardar((p) => {
            p.tienda = { ...p.tienda, domicilios: { ...p.tienda?.domicilios, activo: e.target.checked } };
            return p;
          })}
        />
        <span>
          <span className="font-medium">El negocio hace domicilios</span>
          <span className="block text-xs text-muted-foreground">
            Con esto apagado el bot no pregunta la dirección ni cobra envío, aunque
            haya zonas cargadas aquí abajo.
          </span>
        </span>
      </label>

      {activo ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Cómo llamas a la zona" ayuda="Sale en las preguntas del bot: zona, barrio, comuna…">
            <Texto
              valor={String(dom.etiqueta ?? 'zona')}
              alCambiar={(v) => void guardar((p) => {
                p.tienda = { ...p.tienda, domicilios: { ...p.tienda?.domicilios, etiqueta: v } };
                return p;
              })}
            />
          </Campo>
          <Campo etiqueta="Ciudad donde reparte">
            <Texto
              valor={String(dom.ciudad ?? '')}
              alCambiar={(v) => void guardar((p) => {
                p.tienda = { ...p.tienda, domicilios: { ...p.tienda?.domicilios, ciudad: v } };
                return p;
              })}
            />
          </Campo>
        </div>
      ) : null}
    </div>
  );
}
