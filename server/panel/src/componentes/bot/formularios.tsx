// Formularios que componen el perfil del bot.
//
// La persona NO es un textarea gigante: son campos, y el motor arma el system
// prompt con ellos. Quien configura no tiene que saber escribir un prompt. Para
// los casos raros queda el modo experto, que usa prompts/system.md tal cual.
import type { PerfilBot } from '@/api';
import { Area, Campo, ListaTextos, Numero, Selector, Texto } from './campos';

type Props = { perfil: PerfilBot; alCambiar: (p: PerfilBot) => void };

/** Escritura inmutable por ruta punteada: set(p, 'operacion.horario.inicio', 8). */
function set(objeto: PerfilBot, ruta: string, valor: unknown): PerfilBot {
  const partes = ruta.split('.');
  const copia = structuredClone(objeto) as Record<string, unknown>;
  let nodo = copia;
  for (const parte of partes.slice(0, -1)) {
    if (typeof nodo[parte] !== 'object' || nodo[parte] === null) nodo[parte] = {};
    nodo = nodo[parte] as Record<string, unknown>;
  }
  nodo[partes.at(-1) as string] = valor;
  return copia as PerfilBot;
}

const leer = (p: PerfilBot, ruta: string): unknown =>
  ruta.split('.').reduce<unknown>((n, k) => (
    typeof n === 'object' && n !== null ? (n as Record<string, unknown>)[k] : undefined
  ), p);

const texto = (p: PerfilBot, r: string) => String(leer(p, r) ?? '');
const numero = (p: PerfilBot, r: string) => Number(leer(p, r) ?? 0);
const lista = (p: PerfilBot, r: string) => (leer(p, r) as string[]) ?? [];

export function FormPersona({ perfil, alCambiar }: Props) {
  const experto = Boolean(leer(perfil, 'persona.modo_experto'));
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Cómo se llama" ayuda="El nombre con el que se presenta si se lo preguntan">
          <Texto valor={texto(perfil, 'persona.nombre')} alCambiar={(v) => alCambiar(set(perfil, 'persona.nombre', v))} placeholder="Andrés" />
        </Campo>
        <Campo etiqueta="Qué es">
          <Texto valor={texto(perfil, 'persona.rol')} alCambiar={(v) => alCambiar(set(perfil, 'persona.rol', v))} placeholder="asesor comercial" />
        </Campo>
        <Campo etiqueta="Trato">
          <Selector
            valor={leer(perfil, 'persona.tuteo') === false ? 'usted' : 'tu'}
            alCambiar={(v) => alCambiar(set(perfil, 'persona.tuteo', v === 'tu'))}
            opciones={[{ valor: 'tu', texto: 'Tuteo (tú, tienes)' }, { valor: 'usted', texto: 'Usted' }]}
          />
        </Campo>
        <Campo etiqueta="Emojis">
          <Selector
            valor={texto(perfil, 'persona.emojis') || 'pocos'}
            alCambiar={(v) => alCambiar(set(perfil, 'persona.emojis', v))}
            opciones={[
              { valor: 'ninguno', texto: 'Ninguno' },
              { valor: 'pocos', texto: 'Pocos' },
              { valor: 'varios', texto: 'Varios' },
            ]}
          />
        </Campo>
        <Campo etiqueta="Líneas por mensaje">
          <Numero valor={numero(perfil, 'persona.max_lineas') || 3} alCambiar={(v) => alCambiar(set(perfil, 'persona.max_lineas', v))} />
        </Campo>
        <Campo etiqueta="Cómo escribe los precios" ayuda="Un ejemplo; el bot copia el formato">
          <Texto valor={texto(perfil, 'persona.formato_precio')} alCambiar={(v) => alCambiar(set(perfil, 'persona.formato_precio', v))} placeholder="$150.000" />
        </Campo>
      </div>

      <Campo etiqueta="Quién le escribe" ayuda="De dónde vienen los clientes y qué suelen querer. Evita preguntas obvias.">
        <Area valor={texto(perfil, 'persona.quien_te_escribe')} alCambiar={(v) => alCambiar(set(perfil, 'persona.quien_te_escribe', v))} filas={3} />
      </Campo>

      <Campo etiqueta="Reglas de oro" ayuda="Cortas y en imperativo. Son lo que más pesa en cómo suena.">
        <ListaTextos valores={lista(perfil, 'persona.reglas')} alCambiar={(v) => alCambiar(set(perfil, 'persona.reglas', v))} marcador="UNA sola pregunta por mensaje." />
      </Campo>

      <Campo etiqueta="Flujo que sigue" ayuda="Los pasos de la conversación, numerados">
        <Area valor={texto(perfil, 'persona.flujo')} alCambiar={(v) => alCambiar(set(perfil, 'persona.flujo', v))} filas={5} />
      </Campo>

      <Campo etiqueta="Lo que nunca hace">
        <ListaTextos valores={lista(perfil, 'persona.nunca')} alCambiar={(v) => alCambiar(set(perfil, 'persona.nunca', v))} marcador="Inventar precios que no estén en el catálogo." />
      </Campo>

      <Campo etiqueta="Cuándo pasa a un humano">
        <ListaTextos valores={lista(perfil, 'persona.cuando_escalar')} alCambiar={(v) => alCambiar(set(perfil, 'persona.cuando_escalar', v))} marcador="El cliente pide hablar con una persona." />
      </Campo>

      <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          checked={experto}
          onChange={(e) => alCambiar(set(perfil, 'persona.modo_experto', e.target.checked))}
        />
        <span>
          <strong>Modo experto.</strong>{' '}
          <span className="text-muted-foreground">
            Ignora los campos de arriba y usa <code>prompts/system.md</code> tal cual.
            El catálogo y la información del negocio se siguen agregando: son datos, no estilo.
          </span>
        </span>
      </label>
    </div>
  );
}

export function FormOperacion({ perfil, alCambiar }: Props) {
  const canal = (leer(perfil, 'canal.tipo') as string) || 'evolution';
  const modulos = perfil.modulos || [];

  const alternarModulo = (nombre: string, activo: boolean) => alCambiar({
    ...perfil,
    modulos: activo ? [...new Set([...modulos, nombre])] : modulos.filter((m) => m !== nombre),
  });

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Canal de WhatsApp" ayuda="Lo único que cambia al migrar. El bot le habla a Chatsuite, no al canal.">
          <Selector
            valor={canal}
            alCambiar={(v) => alCambiar(set(perfil, 'canal.tipo', v))}
            opciones={[
              { valor: 'evolution', texto: 'Evolution (QR, arranque rápido)' },
              { valor: 'cloud_api', texto: 'Cloud API (oficial de Meta)' },
            ]}
          />
        </Campo>
        <Campo etiqueta="A quién atiende">
          <Selector
            valor={perfil.audiencia || 'clientes'}
            alCambiar={(v) => alCambiar({ ...perfil, audiencia: v as PerfilBot['audiencia'] })}
            opciones={[
              { valor: 'clientes', texto: 'Clientes (al equipo lo ignora)' },
              { valor: 'equipo', texto: 'Solo al equipo (bot interno)' },
              { valor: 'ambos', texto: 'Ambos' },
            ]}
          />
        </Campo>
      </div>

      {canal === 'evolution' ? (
        <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
          <Campo etiqueta="URL de Evolution">
            <Texto valor={texto(perfil, 'canal.evolution.url')} alCambiar={(v) => alCambiar(set(perfil, 'canal.evolution.url', v))} placeholder="http://127.0.0.1:3094" />
          </Campo>
          <Campo etiqueta="Instancia">
            <Texto valor={texto(perfil, 'canal.evolution.instancia')} alCambiar={(v) => alCambiar(set(perfil, 'canal.evolution.instancia', v))} />
          </Campo>
        </div>
      ) : (
        <div className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
          <Campo etiqueta="Plantilla de alerta" ayuda="Para avisar al equipo fuera de la ventana de 24 h">
            <Texto valor={texto(perfil, 'canal.cloud_api.plantilla_alerta')} alCambiar={(v) => alCambiar(set(perfil, 'canal.cloud_api.plantilla_alerta', v))} placeholder="alerta_escalamiento_v1" />
          </Campo>
          <Campo etiqueta="Plantilla de reenganche" ayuda="Sin ella, a un cliente con la ventana vencida no se le escribe">
            <Texto valor={texto(perfil, 'canal.cloud_api.plantilla_reenganche')} alCambiar={(v) => alCambiar(set(perfil, 'canal.cloud_api.plantilla_reenganche', v))} />
          </Campo>
        </div>
      )}

      <Campo etiqueta="Módulos" ayuda="Cada uno agrega sus herramientas y su parte del prompt">
        <div className="grid gap-2">
          {[
            { id: 'tienda', texto: 'Tienda — catálogo, fotos, pedidos y domicilios' },
            { id: 'citas', texto: 'Citas — agenda, servicios, profesionales y cancelaciones' },
          ].map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded-md border p-2.5 text-sm">
              <input type="checkbox" checked={modulos.includes(m.id)} onChange={(e) => alternarModulo(m.id, e.target.checked)} />
              {m.texto}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Socios y tareas todavía no existen en el motor.
          </p>
        </div>
      </Campo>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Atiende desde (hora)">
          <Numero valor={numero(perfil, 'operacion.horario.inicio')} alCambiar={(v) => alCambiar(set(perfil, 'operacion.horario.inicio', v))} />
        </Campo>
        <Campo etiqueta="Hasta (hora)">
          <Numero valor={numero(perfil, 'operacion.horario.fin')} alCambiar={(v) => alCambiar(set(perfil, 'operacion.horario.fin', v))} />
        </Campo>
        <Campo etiqueta="Tope de mensajes por hora">
          <Numero valor={numero(perfil, 'operacion.ritmo.max_salientes_hora')} alCambiar={(v) => alCambiar(set(perfil, 'operacion.ritmo.max_salientes_hora', v))} />
        </Campo>
      </div>

      <Campo etiqueta="Mensaje fuera de horario">
        <Texto valor={texto(perfil, 'operacion.horario.mensaje_fuera')} alCambiar={(v) => alCambiar(set(perfil, 'operacion.horario.mensaje_fuera', v))} />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Espera mínima antes de responder (s)" ayuda="También junta los mensajes seguidos del cliente en una sola respuesta">
          <Numero valor={numero(perfil, 'operacion.ritmo.respuesta_min_seg')} alCambiar={(v) => alCambiar(set(perfil, 'operacion.ritmo.respuesta_min_seg', v))} />
        </Campo>
        <Campo etiqueta="Espera máxima (s)">
          <Numero valor={numero(perfil, 'operacion.ritmo.respuesta_max_seg')} alCambiar={(v) => alCambiar(set(perfil, 'operacion.ritmo.respuesta_max_seg', v))} />
        </Campo>
      </div>

      <Campo etiqueta="Etiquetas del CRM" ayuda="Catálogo cerrado: el bot no puede inventar otras. Sincronízalas para crear también sus vistas en Chatsuite.">
        <div className="grid gap-2">
          {(perfil.etiquetas || []).map((e, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="flex gap-2">
              <Texto
                valor={e.nombre}
                alCambiar={(v) => alCambiar({ ...perfil, etiquetas: perfil.etiquetas.map((x, j) => (j === i ? { ...x, nombre: v } : x)) })}
                placeholder="pedido"
              />
              <Texto
                valor={e.titulo || ''}
                alCambiar={(v) => alCambiar({ ...perfil, etiquetas: perfil.etiquetas.map((x, j) => (j === i ? { ...x, titulo: v } : x)) })}
                placeholder="📦 Pedidos"
              />
              <button
                type="button"
                className="shrink-0 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
                onClick={() => alCambiar({ ...perfil, etiquetas: perfil.etiquetas.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="justify-self-start rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
            onClick={() => alCambiar({ ...perfil, etiquetas: [...(perfil.etiquetas || []), { nombre: '', titulo: '' }] })}
          >
            + etiqueta
          </button>
        </div>
      </Campo>
    </div>
  );
}
